/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { Client } from "pg";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  HYPERDRIVE: Hyperdrive;
  AQI_CACHE_VERSION: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

async function cachedApiResponse(request: Request, ctx: ExecutionContext, version: string, maxAge: number, handler: () => Promise<Response>) {
  if (request.method !== "GET") return handler();
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.searchParams.set("__cache_version", version);
  const cache = caches.default;
  const cacheKey = new Request(cacheKeyUrl.toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await handler();
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", `public, max-age=${maxAge}`);
  const cacheable = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
  return cacheable;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/api/locations/search") {
      return cachedApiResponse(request, ctx, env.AQI_CACHE_VERSION || "1", 86_400, async () => {
        const query = url.searchParams.get("q")?.trim() ?? "";
        const lat = url.searchParams.get("lat");
        const lon = url.searchParams.get("lon");
        if (!query && !(lat && lon)) return Response.json({ results: [] });
        const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
        await client.connect();
        try {
        const [city, rawState] = query.split(",", 2);
        const state = rawState?.trim().toUpperCase() || null;
        const result = lat && lon
          ? await client.query(`SELECT c.id::text AS area_id,c.name,c.geoid FROM geographic_areas c
              WHERE c.type='cbsa' AND c.centroid IS NOT NULL AND EXISTS (SELECT 1 FROM daily_aqi d WHERE d.area_id=c.id)
              ORDER BY CASE WHEN c.geom IS NOT NULL AND ST_Covers(c.geom,ST_SetSRID(ST_MakePoint($1,$2),4326)) THEN 0 ELSE 1 END,
                c.centroid <-> ST_SetSRID(ST_MakePoint($1,$2),4326) LIMIT 1`, [Number(lon), Number(lat)])
          : /^\d{5}$/.test(query)
            ? await client.query(`WITH zip AS (
                SELECT centroid FROM geographic_areas WHERE type='zcta' AND geoid=$1
              )
              SELECT c.id::text AS area_id,c.name,c.geoid FROM geographic_areas c,zip
              WHERE c.type='cbsa' AND c.centroid IS NOT NULL
                AND EXISTS (SELECT 1 FROM daily_aqi d WHERE d.area_id=c.id)
              ORDER BY CASE WHEN c.geom IS NOT NULL AND ST_Covers(c.geom,zip.centroid) THEN 0 ELSE 1 END,
                c.centroid <-> zip.centroid LIMIT 1`, [query])
            : await client.query(`WITH matches AS (
                SELECT c.id::text AS area_id,c.name,c.geoid,
                  regexp_replace(p.name, ' (city|town|village|CDP)$', '', 'i') || ', ' || (p.metadata->>'state') || ' → ' || c.name AS label, 'city' AS type, 0 AS priority
                FROM geographic_areas p JOIN geographic_areas c ON c.type='cbsa'
                WHERE p.type='place' AND p.name ILIKE $1 AND ($2::text IS NULL OR p.metadata->>'state'=$2)
                  AND c.geom IS NOT NULL AND ST_Covers(c.geom,p.centroid)
                  AND EXISTS (SELECT 1 FROM daily_aqi d WHERE d.area_id=c.id)
                UNION ALL
                SELECT c.id::text,c.name,c.geoid,c.name,'metro',1
                FROM geographic_areas c WHERE c.type='cbsa' AND c.name ILIKE $1
                  AND EXISTS (SELECT 1 FROM daily_aqi d WHERE d.area_id=c.id)
              ), deduplicated AS (
                SELECT DISTINCT ON (area_id) area_id,name,geoid,label,type,priority FROM matches
                ORDER BY area_id,priority,label
              ) SELECT area_id,name,geoid,label,type FROM deduplicated
              ORDER BY priority,label LIMIT 8`, [`%${city.trim()}%`, state]);
          return Response.json({ query, results: result.rows });
        } finally { await client.end(); }
      });
    }

    if (url.pathname === "/api/aqi/history") {
      return cachedApiResponse(request, ctx, env.AQI_CACHE_VERSION || "1", 3_600, async () => {
      const areaId = url.searchParams.get("location_id");
      const startYear = Number(url.searchParams.get("start_year") ?? url.searchParams.get("year"));
      const endYear = Number(url.searchParams.get("end_year") ?? startYear);
      if (!areaId || !Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear < startYear || endYear - startYear > 19) {
        return new Response("location_id and a year range of up to 20 years are required", { status: 400 });
      }
      const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
      await client.connect();
      try {
        const [area, days] = await Promise.all([
          client.query("SELECT name FROM geographic_areas WHERE id=$1 AND type='cbsa'", [areaId]),
          client.query(`SELECT date::text,aqi,defining_parameter AS pollutant,reporting_sites,source,data_status
            FROM daily_aqi WHERE area_id=$1 AND date >= make_date($2,1,1) AND date < make_date($3 + 1,1,1) ORDER BY date`, [areaId, startYear, endYear]),
        ]);
        if (!area.rowCount) return new Response("AQI area not found", { status: 404 });
        const currentSource = days.rows.find((row) => row.source === "airnow_preliminary")?.source ?? "epa_airdata";
        const daysByYear = Object.fromEntries(Array.from({ length: endYear - startYear + 1 }, (_, index) => [startYear + index, [] as typeof days.rows]));
        for (const day of days.rows) daysByYear[new Date(day.date).getUTCFullYear()].push(day);
        return Response.json({ data_source: { area: area.rows[0].name, type: "metro", source: currentSource }, days_by_year: daysByYear });
      } finally { await client.end(); }
      });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
