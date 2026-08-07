"""Backfill recently active OpenAQ reference monitors from AWS archives."""
import argparse
import json
import os
import subprocess
from datetime import date
from pathlib import Path

import requests

from import_openaq import load

API_URL = "https://api.openaq.org/v3/locations"
S3_PREFIX = "s3://openaq-data-archive/records/csv.gz"


def locations(api_key: str, iso: str, active_since: str):
    results = []
    page = 1
    while True:
        response = requests.get(API_URL, params={"iso": iso, "monitor": "true", "limit": 1000, "page": page}, headers={"X-API-Key": api_key}, timeout=60)
        response.raise_for_status()
        batch = response.json()["results"]
        results.extend(row for row in batch if (row.get("datetimeLast", {}).get("utc") or "") >= active_since)
        if len(batch) < 1000:
            break
        page += 1
    return results


def download(data_root: Path, location_id: int, start_year: int, end_year: int):
    for year in range(start_year, end_year + 1):
        target = data_root / str(location_id) / str(year)
        target.mkdir(parents=True, exist_ok=True)
        subprocess.run(["aws", "s3", "cp", "--no-sign-request", "--region", "us-east-1", "".join((S3_PREFIX, f"/locationid={location_id}/year={year}/")), str(target) + "/", "--recursive"], check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--api-key", default=os.getenv("OPENAQ_API_KEY"))
    parser.add_argument("--iso", default="FR", help="ISO 3166-1 alpha-2 country code")
    parser.add_argument("--data-dir", type=Path, default=Path("/tmp/openaq-france"))
    parser.add_argument("--registry", type=Path, default=Path("/tmp/openaq-france-locations.json"))
    parser.add_argument("--active-since", default="2025-01-01")
    parser.add_argument("--start-year", type=int, default=2016)
    parser.add_argument("--end-year", type=int, default=2025)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.api_key:
        parser.error("Set OPENAQ_API_KEY or pass --api-key")
    if not args.dry_run and not args.database_url:
        parser.error("Set DATABASE_URL or use --dry-run")
    if args.end_year < args.start_year:
        parser.error("--end-year must be >= --start-year")
    monitors = locations(args.api_key, args.iso.upper(), args.active_since)
    args.registry.parent.mkdir(parents=True, exist_ok=True)
    args.registry.write_text(json.dumps(monitors, indent=2) + "\n")
    print(f"Found {len(monitors):,} {args.iso.upper()} reference monitors active since {args.active_since}.")
    if args.dry_run:
        print(f"Dry run: would download {args.start_year}-{args.end_year} and import into the database.")
        return
    for index, location in enumerate(monitors, 1):
        location_id = location["id"]
        print(f"[{index}/{len(monitors)}] {location_id} {location['name']}")
        download(args.data_dir, location_id, args.start_year, args.end_year)
        load(args.database_url, args.data_dir / str(location_id), str(location_id), location["name"], location["coordinates"]["latitude"], location["coordinates"]["longitude"], location["country"]["name"], location["provider"]["name"], args.iso)


if __name__ == "__main__":
    main()
