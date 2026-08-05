/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { Client } from "pg";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  HYPERDRIVE: Hyperdrive;
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

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/locations/search") {
      const query = url.searchParams.get("q")?.trim() ?? "";
      const lat = url.searchParams.get("lat");
      const lon = url.searchParams.get("lon");
      if (!query && !(lat && lon)) return Response.json({ results: [] });
      const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
      await client.connect();
      try {
        const result = lat && lon
          ? await client.query(`SELECT c.id::text AS area_id,c.name,c.geoid FROM geographic_areas c
              WHERE c.type='cbsa' AND c.centroid IS NOT NULL AND EXISTS (SELECT 1 FROM daily_aqi d WHERE d.area_id=c.id)
              ORDER BY c.centroid <-> ST_SetSRID(ST_MakePoint($1,$2),4326) LIMIT 1`, [Number(lon), Number(lat)])
          : /^\d{5}$/.test(query)
            ? await client.query(`WITH zip AS (
                SELECT centroid FROM geographic_areas WHERE type='zcta' AND geoid=$1
              )
              SELECT c.id::text AS area_id,c.name,c.geoid FROM geographic_areas c,zip
              WHERE c.type='cbsa' AND c.centroid IS NOT NULL
                AND EXISTS (SELECT 1 FROM daily_aqi d WHERE d.area_id=c.id)
              ORDER BY c.centroid <-> zip.centroid LIMIT 1`, [query])
            : await client.query(`SELECT id::text AS area_id,name,geoid FROM geographic_areas
              WHERE type='cbsa' AND EXISTS (SELECT 1 FROM daily_aqi d WHERE d.area_id=geographic_areas.id)
                AND name ILIKE $1
              ORDER BY name LIMIT 8`, [`%${query.split(",")[0].trim()}%`]);
        return Response.json({ query, results: result.rows.map((row) => ({ ...row, label: row.name, type: "metro" })) });
      } finally { await client.end(); }
    }

    if (url.pathname === "/api/aqi/history") {
      const areaId = url.searchParams.get("location_id");
      const year = Number(url.searchParams.get("year"));
      if (!areaId || !Number.isInteger(year)) return new Response("location_id and year are required", { status: 400 });
      const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
      await client.connect();
      try {
        const [area, days] = await Promise.all([
          client.query("SELECT name FROM geographic_areas WHERE id=$1 AND type='cbsa'", [areaId]),
          client.query(`SELECT date::text,aqi,defining_parameter AS pollutant,reporting_sites,source,data_status
            FROM daily_aqi WHERE area_id=$1 AND EXTRACT(YEAR FROM date)=$2 ORDER BY date`, [areaId, year]),
        ]);
        if (!area.rowCount) return new Response("AQI area not found", { status: 404 });
        const currentSource = days.rows.find((row) => row.source === "airnow_preliminary")?.source ?? "epa_airdata";
        return Response.json({ data_source: { area: area.rows[0].name, type: "metro", source: currentSource }, days: days.rows });
      } finally { await client.end(); }
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
