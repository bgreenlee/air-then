"""Load EPA AirData bulk files into PostgreSQL/PostGIS; never called at request time."""
import argparse
import io
import os
import zipfile

import polars as pl
import psycopg
import requests

BASE = "https://aqs.epa.gov/aqsweb/airdata"


def download(kind: str, year: int) -> pl.DataFrame:
    response = requests.get(f"{BASE}/daily_aqi_by_{kind}_{year}.zip", timeout=120)
    response.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        name = next(n for n in archive.namelist() if n.endswith(".csv"))
        return pl.read_csv(archive.read(name), try_parse_dates=True)


def load_cbsa(frame: pl.DataFrame, year: int, database_url: str) -> int:
    rows = frame.select([
        pl.col("CBSA Code").cast(pl.Utf8).alias("geoid"), pl.col("CBSA").alias("name"),
        pl.col("Date").cast(pl.Utf8).alias("date"), pl.col("AQI").cast(pl.Int16).alias("aqi"),
        pl.col("Defining Parameter").alias("parameter"), pl.col("Number of Sites Reporting").cast(pl.Int16).alias("sites"),
    ]).drop_nulls(["aqi"]).filter(pl.col("aqi") <= 500)
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute("""CREATE TEMP TABLE staging_aqi (
          geoid text, name text, date date, aqi smallint, parameter text, sites smallint
        ) ON COMMIT DROP""")
        with cur.copy("COPY staging_aqi (geoid,name,date,aqi,parameter,sites) FROM STDIN") as copy:
            for row in rows.iter_rows():
                copy.write_row(row)
        cur.execute("""INSERT INTO geographic_areas (type, geoid, name, metadata)
          SELECT DISTINCT 'cbsa'::area_type, geoid, name, jsonb_build_object('source','EPA AirData')
          FROM staging_aqi ON CONFLICT (type, geoid) DO UPDATE SET name = EXCLUDED.name""")
        cur.execute("""INSERT INTO daily_aqi (area_id,date,aqi,defining_parameter,reporting_sites,source_file)
          SELECT area.id, stage.date, stage.aqi, stage.parameter, stage.sites, %s
          FROM staging_aqi stage JOIN geographic_areas area ON area.type='cbsa' AND area.geoid=stage.geoid
          ON CONFLICT (area_id,date) DO UPDATE SET aqi=EXCLUDED.aqi, defining_parameter=EXCLUDED.defining_parameter,
          reporting_sites=EXCLUDED.reporting_sites, source_file=EXCLUDED.source_file""", (f"daily_aqi_by_cbsa_{year}.zip",))
        return rows.height


def load_county(frame: pl.DataFrame, year: int, database_url: str) -> int:
    rows = frame.select([
        (pl.col("State Code") + pl.col("County Code")).alias("geoid"),
        (pl.col("county Name") + pl.lit(" County, ") + pl.col("State Name")).alias("name"),
        pl.col("State Code").alias("state_fips"), pl.col("Date").cast(pl.Utf8).alias("date"),
        pl.col("AQI").cast(pl.Int16).alias("aqi"), pl.col("Defining Parameter").alias("parameter"),
        pl.col("Number of Sites Reporting").cast(pl.Int16).alias("sites"),
    ]).drop_nulls(["aqi"]).filter(pl.col("aqi") <= 500)
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute("""CREATE TEMP TABLE staging_aqi (
          geoid text, name text, state_fips text, date date, aqi smallint, parameter text, sites smallint
        ) ON COMMIT DROP""")
        with cur.copy("COPY staging_aqi (geoid,name,state_fips,date,aqi,parameter,sites) FROM STDIN") as copy:
            for row in rows.iter_rows(): copy.write_row(row)
        cur.execute("""INSERT INTO geographic_areas (type, geoid, name, state_fips, metadata)
          SELECT 'county'::area_type, geoid, MIN(name), MIN(state_fips), jsonb_build_object('source','EPA AirData')
          FROM staging_aqi GROUP BY geoid ON CONFLICT (type, geoid) DO UPDATE SET name=EXCLUDED.name""")
        cur.execute("""INSERT INTO daily_aqi (area_id,date,aqi,defining_parameter,reporting_sites,source_file)
          SELECT area.id,stage.date,MAX(stage.aqi),MAX(stage.parameter),MAX(stage.sites),%s FROM staging_aqi stage
          JOIN geographic_areas area ON area.type='county' AND area.geoid=stage.geoid GROUP BY area.id,stage.date
          ON CONFLICT (area_id,date) DO UPDATE SET aqi=EXCLUDED.aqi,defining_parameter=EXCLUDED.defining_parameter,
          reporting_sites=EXCLUDED.reporting_sites,source_file=EXCLUDED.source_file""", (f"daily_aqi_by_county_{year}.zip",))
        return rows.height


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--kind", choices=["cbsa", "county"], required=True)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = parser.parse_args()
    if not args.database_url:
        parser.error("Set DATABASE_URL or pass --database-url")
    count = (load_cbsa if args.kind == "cbsa" else load_county)(download(args.kind, args.year), args.year, args.database_url)
    print(f"Loaded {count:,} real EPA {args.kind} daily AQI rows for {args.year}.")


if __name__ == "__main__":
    main()
