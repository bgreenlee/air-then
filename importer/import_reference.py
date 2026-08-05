"""Load lightweight Census Gazetteer centroids for search resolution in bulk."""
import argparse, csv, io, json, os, zipfile
import psycopg, requests
import shapefile

BASE = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer"

def fetch(year, layer):
    url = f"{BASE}/{year}_Gazetteer/{year}_Gaz_{layer}_national.zip"
    response = requests.get(url, timeout=120); response.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        name = next(n for n in archive.namelist() if n.endswith(".txt"))
        return list(csv.DictReader(io.TextIOWrapper(archive.open(name)), delimiter="|"))

def fetch_cbsa_boundaries(year):
    url = f"https://www2.census.gov/geo/tiger/TIGER{year}/CBSA/tl_{year}_us_cbsa.zip"
    response = requests.get(url, timeout=180); response.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        base = next(name[:-4] for name in archive.namelist() if name.endswith(".shp"))
        reader = shapefile.Reader(
            shp=io.BytesIO(archive.read(base + ".shp")),
            shx=io.BytesIO(archive.read(base + ".shx")),
            dbf=io.BytesIO(archive.read(base + ".dbf")),
        )
        return [(record.record.as_dict()["GEOID"], json.dumps(record.shape.__geo_interface__)) for record in reader.iterShapeRecords()]

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--year", type=int, default=2025); parser.add_argument("--with-cbsa-boundaries", action="store_true"); parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    args = parser.parse_args()
    if not args.database_url: parser.error("Set DATABASE_URL")
    cbsas, zctas, places = fetch(args.year, "cbsa"), fetch(args.year, "zcta"), fetch(args.year, "place")
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
        cur.execute("CREATE TEMP TABLE staging_places (geoid text,name text,state_fips text,state_abbr text,lat double precision,lon double precision) ON COMMIT DROP")
        with cur.copy("COPY staging_places (geoid,name,state_fips,state_abbr,lat,lon) FROM STDIN") as copy:
            for row in places: copy.write_row((row["GEOID"], row["NAME"], row["GEOID"][:2], row["USPS"], row["INTPTLAT"], row["INTPTLONG"]))
        cur.execute("""INSERT INTO geographic_areas(type,geoid,name,state_fips,centroid,metadata)
          SELECT 'place'::area_type,geoid,name,state_fips,ST_SetSRID(ST_MakePoint(lon,lat),4326),jsonb_build_object('source','Census Gazetteer','state',state_abbr)
          FROM staging_places ON CONFLICT(type,geoid) DO UPDATE SET name=EXCLUDED.name,centroid=EXCLUDED.centroid,metadata=EXCLUDED.metadata""")
        if args.with_cbsa_boundaries:
            boundaries = fetch_cbsa_boundaries(args.year)
            cur.execute("CREATE TEMP TABLE staging_cbsa_geometry (geoid text, geom_json text) ON COMMIT DROP")
            with cur.copy("COPY staging_cbsa_geometry (geoid,geom_json) FROM STDIN") as copy:
                for row in boundaries: copy.write_row(row)
            cur.execute("""UPDATE geographic_areas area SET geom=ST_SetSRID(ST_GeomFromGeoJSON(stage.geom_json),4326)
              FROM staging_cbsa_geometry stage WHERE area.type='cbsa' AND area.geoid=stage.geoid""")
    print(f"Loaded {len(cbsas):,} CBSA, {len(zctas):,} ZCTA, and {len(places):,} place Census references.")

if __name__ == "__main__": main()
