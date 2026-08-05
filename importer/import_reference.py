"""Load lightweight Census Gazetteer centroids for search resolution in bulk."""
import argparse, csv, io, os, zipfile
import psycopg, requests

BASE = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer"

def fetch(year, layer):
    url = f"{BASE}/{year}_Gazetteer/{year}_Gaz_{layer}_national.zip"
    response = requests.get(url, timeout=120); response.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        name = next(n for n in archive.namelist() if n.endswith(".txt"))
        return list(csv.DictReader(io.TextIOWrapper(archive.open(name)), delimiter="|"))

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--year", type=int, default=2025); parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    args = parser.parse_args()
    if not args.database_url: parser.error("Set DATABASE_URL")
    cbsas, zctas = fetch(args.year, "cbsa"), fetch(args.year, "zcta")
    with psycopg.connect(args.database_url) as conn, conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE staging_cbsa (geoid text, lat double precision, lon double precision) ON COMMIT DROP")
        with cur.copy("COPY staging_cbsa (geoid,lat,lon) FROM STDIN") as copy:
            for row in cbsas: copy.write_row((row["GEOID"], row["INTPTLAT"], row["INTPTLONG"]))
        cur.execute("""UPDATE geographic_areas area SET centroid=ST_SetSRID(ST_MakePoint(stage.lon,stage.lat),4326)
          FROM staging_cbsa stage WHERE area.type='cbsa' AND area.geoid=stage.geoid""")
        cur.execute("CREATE TEMP TABLE staging_zcta (geoid text, lat double precision, lon double precision) ON COMMIT DROP")
        with cur.copy("COPY staging_zcta (geoid,lat,lon) FROM STDIN") as copy:
            for row in zctas: copy.write_row((row["GEOID"], row["INTPTLAT"], row["INTPTLONG"]))
        cur.execute("""INSERT INTO geographic_areas(type,geoid,name,centroid,metadata)
          SELECT 'zcta'::area_type,geoid,'ZIP ' || geoid,ST_SetSRID(ST_MakePoint(lon,lat),4326),jsonb_build_object('source','Census Gazetteer')
          FROM staging_zcta ON CONFLICT(type,geoid) DO UPDATE SET centroid=EXCLUDED.centroid""")
    print(f"Loaded {len(cbsas):,} CBSA and {len(zctas):,} ZCTA Census reference centroids.")

if __name__ == "__main__": main()
