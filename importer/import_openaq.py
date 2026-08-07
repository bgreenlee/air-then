"""Import daily pollutant means from OpenAQ CSV.GZ archive files."""
import argparse
import csv
import datetime as dt
import gzip
import os
from collections import defaultdict
from pathlib import Path

import psycopg


def read_measurements(data_dir: Path, location_id: str):
    totals = defaultdict(lambda: [0.0, 0, ""])
    pattern = f"location-{location_id}-*.csv.gz"
    for path in sorted(data_dir.rglob(pattern)):
        with gzip.open(path, "rt", newline="") as handle:
            for row in csv.DictReader(handle):
                if row.get("location_id") != location_id or not row.get("value"):
                    continue
                try:
                    timestamp = dt.datetime.fromisoformat(row["datetime"])
                    value = float(row["value"])
                except (KeyError, TypeError, ValueError):
                    continue
                if not row.get("parameter") or not row.get("units"):
                    continue
                key = (timestamp.date(), row["parameter"], row["units"])
                totals[key][0] += value
                totals[key][1] += 1
                # Keep provenance portable; absolute temp paths are not useful
                # once the rows are loaded into the production database.
                totals[key][2] = str(path.relative_to(data_dir))
    return [(date, pollutant, total / count, units, count, source_file)
            for (date, pollutant, units), (total, count, source_file) in sorted(totals.items())]


def load(database_url: str, data_dir: Path, location_id: str, name: str, latitude: float, longitude: float, country: str = "France", provider: str = "EEA France") -> int:
    rows = read_measurements(data_dir, location_id)
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO geographic_areas(type, geoid, name, centroid, metadata)
          VALUES ('monitor', %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326),
                  jsonb_build_object('source', 'OpenAQ', 'source_location_id', %s::text,
                                     'provider', %s::text, 'country', %s::text))
          ON CONFLICT(type, geoid) DO UPDATE SET name=EXCLUDED.name,
            centroid=EXCLUDED.centroid, metadata=EXCLUDED.metadata
          RETURNING id""", (f"openaq:{location_id}", name, longitude, latitude, location_id, provider, country))
        area_id = cur.fetchone()[0]
        cur.executemany("""INSERT INTO daily_pollutant_measurements
          (area_id, date, pollutant, value, units, observation_count, source, source_location_id, source_file)
          VALUES (%s,%s,%s,%s,%s,%s,'openaq',%s,%s)
          ON CONFLICT(area_id,date,pollutant,source) DO UPDATE SET value=EXCLUDED.value,
            units=EXCLUDED.units, observation_count=EXCLUDED.observation_count,
            source_file=EXCLUDED.source_file""",
          [(area_id, date, pollutant, value, units, count, location_id, source_file)
           for date, pollutant, value, units, count, source_file in rows])
    return len(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--location-id", required=True)
    parser.add_argument("--name", default="Paris · Place de l’Opéra")
    parser.add_argument("--latitude", type=float, default=48.8702740002815)
    parser.add_argument("--longitude", type=float, default=2.332500000221789)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    args = parser.parse_args()
    if not args.database_url:
        parser.error("Set DATABASE_URL")
    print(f"Loaded {load(args.database_url, args.data_dir, args.location_id, args.name, args.latitude, args.longitude):,} daily pollutant rows.")


if __name__ == "__main__":
    main()
