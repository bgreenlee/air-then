"""Production local API backed by the imported PostgreSQL/PostGIS data."""
import os
from contextlib import contextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import psycopg
from psycopg.rows import dict_row

app = FastAPI(title="Clear Skies AQI API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://localhost:5173"], allow_methods=["GET"], allow_headers=["*"])

@contextmanager
def db():
    url = os.getenv("DATABASE_URL")
    if not url: raise RuntimeError("DATABASE_URL is required")
    with psycopg.connect(url, row_factory=dict_row) as connection:
        yield connection

def resolve(query: str):
    with db() as conn, conn.cursor() as cur:
        if query.strip().replace("-", "").isdigit() and len(query.strip()) == 5:
            cur.execute("""WITH point AS (SELECT centroid FROM geographic_areas WHERE type='zcta' AND geoid=%s)
              SELECT c.id::text, c.name, c.geoid FROM geographic_areas c, point
              WHERE c.type='cbsa' AND c.centroid IS NOT NULL AND EXISTS (SELECT 1 FROM daily_aqi d WHERE d.area_id=c.id)
              ORDER BY c.centroid <-> point.centroid LIMIT 1""", (query.strip(),))
        else:
            cur.execute("""SELECT id::text, name, geoid FROM geographic_areas
              WHERE type='cbsa' AND name ILIKE %s AND EXISTS (SELECT 1 FROM daily_aqi d WHERE d.area_id=geographic_areas.id)
              ORDER BY name LIMIT 8""", (f"%{query.strip()}%",))
        return cur.fetchall()

@app.get("/v1/locations/search")
def search(q: str = Query(min_length=2)):
    rows = resolve(q)
    return {"query": q, "results": [{"area_id": row["id"], "label": row["name"], "geoid": row["geoid"], "type": "cbsa"} for row in rows]}

@app.get("/v1/aqi/history")
def history(location_id: str, year: int):
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT name FROM geographic_areas WHERE id=%s AND type='cbsa'", (location_id,))
        area = cur.fetchone()
        if not area: raise HTTPException(404, "AQI area not found")
        cur.execute("""SELECT date::text, aqi, defining_parameter AS pollutant, reporting_sites
          FROM daily_aqi WHERE area_id=%s AND EXTRACT(YEAR FROM date)=%s ORDER BY date""", (location_id, year))
        days = cur.fetchall()
    return {"location_id": location_id, "year": year, "data_source": {"area": area["name"], "type": "cbsa", "reason": "EPA CBSA aggregate with imported daily records."}, "days": days}
