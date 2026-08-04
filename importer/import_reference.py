"""Load lightweight Census Gazetteer centroids for local search resolution."""
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
        for row in cbsas:
            cur.execute("""UPDATE geographic_areas SET centroid=ST_SetSRID(ST_MakePoint(%s,%s),4326)
              WHERE type='cbsa' AND geoid=%s""", (row["INTPTLONG"], row["INTPTLAT"], row["GEOID"]))
        for row in zctas:
            cur.execute("""INSERT INTO geographic_areas(type,geoid,name,centroid,metadata) VALUES
              ('zcta',%s,%s,ST_SetSRID(ST_MakePoint(%s,%s),4326),jsonb_build_object('source','Census Gazetteer'))
              ON CONFLICT(type,geoid) DO UPDATE SET centroid=EXCLUDED.centroid""", (row["GEOID"], f"ZIP {row['GEOID']}", row["INTPTLONG"], row["INTPTLAT"]))
    print(f"Loaded {len(cbsas):,} CBSA and {len(zctas):,} ZCTA Census reference centroids.")

if __name__ == "__main__": main()
