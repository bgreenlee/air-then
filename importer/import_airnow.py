"""Import AirNow daily monitor observations and derive preliminary metro AQI.

AirNow daily files provide the EPA-defined daily AQI for each monitor and
pollutant.  We retain those rows, then use the worst valid monitor/pollutant
AQI for each CBSA and date as the preliminary metro value.
"""
import argparse
import csv
import datetime as dt
import io
import os

import psycopg
import requests

BASE = "https://files.airnowtech.org/airnow"


def fetch_text(path: str) -> str:
    response = requests.get(f"{BASE}/{path}", timeout=120)
    response.raise_for_status()
    return response.text


def fetch_sites(reference_date: dt.date) -> list[tuple]:
    """Get AirNow monitor metadata, including its EPA CBSA assignment."""
    text = fetch_text(f"{reference_date:%Y}/{reference_date:%Y%m%d}/monitoring_site_locations.dat")
    sites = {}
    for row in csv.reader(io.StringIO(text), delimiter="|"):
        if len(row) < 20 or row[12] != "US" or not row[0] or not row[15]:
            continue
        try:
            sites[row[0]] = (row[0], row[3] or row[0], row[15].strip(), float(row[8]), float(row[9]))
        except ValueError:
            continue
    return list(sites.values())


def fetch_daily(day: dt.date) -> list[tuple]:
    text = fetch_text(f"{day:%Y}/{day:%Y%m%d}/daily_data_v2.dat")
    records = []
    for row in csv.reader(io.StringIO(text), delimiter="|"):
        # date, AQS id, site, parameter, units, concentration, duration,
        # agency, AQI, category, latitude, longitude, full AQS id
        if len(row) < 10 or not row[1] or row[8] in ("", "-999"):
            continue
        try:
            aqi = int(float(row[8]))
            concentration = float(row[5]) if row[5] not in ("", "-999") else None
        except ValueError:
            continue
        if 0 <= aqi <= 500:
            records.append((row[1], row[3], aqi, concentration, row[4]))
    return records


def load(database_url: str, reference_date: dt.date, start: dt.date, end: dt.date, retain_station_days: int) -> int:
    sites = fetch_sites(reference_date)
    cutoff = end - dt.timedelta(days=retain_station_days - 1)
    loaded = 0

    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute("""CREATE TEMP TABLE staging_sites (
          epa_site_id text, name text, cbsa_geoid text, lat double precision, lon double precision
        ) ON COMMIT DROP""")
        with cur.copy("COPY staging_sites (epa_site_id,name,cbsa_geoid,lat,lon) FROM STDIN") as copy:
            for row in sites:
                copy.write_row(row)
        cur.execute("""INSERT INTO geographic_areas(type,geoid,name,centroid,metadata)
          SELECT 'monitor'::area_type,epa_site_id,name,ST_SetSRID(ST_MakePoint(lon,lat),4326),
                 jsonb_build_object('source','AirNow') FROM staging_sites
          ON CONFLICT(type,geoid) DO UPDATE SET name=EXCLUDED.name,centroid=EXCLUDED.centroid""")
        cur.execute("""INSERT INTO monitoring_sites(area_id,epa_site_id,cbsa_area_id,active)
          SELECT monitor.id,stage.epa_site_id,cbsa.id,true FROM staging_sites stage
          JOIN geographic_areas monitor ON monitor.type='monitor' AND monitor.geoid=stage.epa_site_id
          JOIN geographic_areas cbsa ON cbsa.type='cbsa' AND cbsa.geoid=stage.cbsa_geoid
          ON CONFLICT(area_id) DO UPDATE SET epa_site_id=EXCLUDED.epa_site_id,cbsa_area_id=EXCLUDED.cbsa_area_id,active=true""")
        cur.execute("""CREATE TEMP TABLE staging_daily (
          epa_site_id text,date date,pollutant text,aqi smallint,concentration numeric,units text,source_file text
        ) ON COMMIT DROP""")
        cur.execute("DELETE FROM daily_station_aqi WHERE source='airnow_preliminary' AND date < %s", (cutoff,))
        day = start
        while day <= end:
            try:
                observations = fetch_daily(day)
            except requests.HTTPError as error:
                if error.response.status_code == 404:
                    day += dt.timedelta(days=1)
                    continue
                raise
            rows = [(site_id, day, pollutant, aqi, concentration, units, f"airnow/{day:%Y/%Y%m%d}/daily_data_v2.dat")
                    for site_id, pollutant, aqi, concentration, units in observations]
            loaded += len(rows)
            cur.execute("TRUNCATE staging_daily")
            with cur.copy("COPY staging_daily (epa_site_id,date,pollutant,aqi,concentration,units,source_file) FROM STDIN") as copy:
                for row in rows:
                    copy.write_row(row)
            if day >= cutoff:
                cur.execute("""INSERT INTO daily_station_aqi(monitor_area_id,date,pollutant,aqi,concentration,units,source,source_file)
                  SELECT monitor.area_id,stage.date,stage.pollutant,stage.aqi,stage.concentration,stage.units,'airnow_preliminary',stage.source_file
                  FROM staging_daily stage JOIN monitoring_sites monitor ON monitor.epa_site_id=stage.epa_site_id
                  WHERE monitor.cbsa_area_id IS NOT NULL
                  ON CONFLICT(monitor_area_id,date,pollutant,source) DO UPDATE SET aqi=EXCLUDED.aqi,concentration=EXCLUDED.concentration,
                    units=EXCLUDED.units,source_file=EXCLUDED.source_file""")
            cur.execute("""INSERT INTO daily_aqi(area_id,date,aqi,defining_parameter,reporting_sites,source_file,source,data_status,calculation_version)
              SELECT monitor.cbsa_area_id,stage.date,MAX(stage.aqi),
                (array_agg(stage.pollutant ORDER BY stage.aqi DESC,stage.pollutant))[1],
                COUNT(DISTINCT monitor.area_id),'AirNow daily monitor observations','airnow_preliminary','preliminary','airnow-daily-v1'
              FROM staging_daily stage JOIN monitoring_sites monitor ON monitor.epa_site_id=stage.epa_site_id
              WHERE monitor.cbsa_area_id IS NOT NULL
              GROUP BY monitor.cbsa_area_id,stage.date
              ON CONFLICT(area_id,date) DO UPDATE SET aqi=EXCLUDED.aqi,defining_parameter=EXCLUDED.defining_parameter,
                reporting_sites=EXCLUDED.reporting_sites,source_file=EXCLUDED.source_file,source=EXCLUDED.source,
                data_status=EXCLUDED.data_status,calculation_version=EXCLUDED.calculation_version""")
            day += dt.timedelta(days=1)
    return loaded


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-date", type=dt.date.fromisoformat, required=True)
    parser.add_argument("--end-date", type=dt.date.fromisoformat, required=True)
    parser.add_argument("--retain-station-days", type=int, default=45)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    args = parser.parse_args()
    if not args.database_url:
        parser.error("Set DATABASE_URL")
    if args.end_date < args.start_date:
        parser.error("end-date must not be before start-date")
    count = load(args.database_url, args.end_date, args.start_date, args.end_date, args.retain_station_days)
    print(f"Loaded {count:,} AirNow preliminary station AQI rows.")


if __name__ == "__main__":
    main()
