# AirThen

Historical air quality.

Historical U.S. AQI exploration with transparent geographic sourcing. A search resolves a point, then selects CBSA AQI only with strong coverage, county AQI otherwise, and nearby monitoring sites as a final fallback.

## Layout

- `app/` — Next.js + TypeScript + Tailwind UI (the `web/` package boundary documents standalone deployment)
- `api/` — REST reference service
- `database/` — PostgreSQL/PostGIS migrations
- `importer/` — Python / Polars bulk-download importer
- `docs/` — architecture and policy

## Run

```bash
npm install && npm run dev
docker compose up --build
```

Load real local data with `python3 -m venv .venv && .venv/bin/pip install -r importer/requirements.txt`, then run `DATABASE_URL=postgresql://clearskies:clearskies@localhost:5433/clearskies .venv/bin/python importer/import_aqi.py --kind cbsa --year 2025` and `DATABASE_URL=postgresql://clearskies:clearskies@localhost:5433/clearskies .venv/bin/python importer/import_reference.py --year 2025`. The API is available at `http://localhost:8000`; for example, both `Bend` and `97701` resolve to Bend–Redmond, OR. See [architecture](docs/architecture.md).

## Cloudflare + Supabase deployment

In GitHub Actions, add `SUPABASE_DB_URL` (a Session pooler SSL connection string) and `CLOUDFLARE_API_TOKEN` (Workers edit permission). Run **Refresh EPA AQI** with `load_reference_data` selected. For an initial backfill, enter `2017` through `2026` in its year-range fields. Pushing to `main` applies pending migrations, then deploys the Worker; the daily workflow refreshes current-year EPA CBSA and county data at 13:17 UTC.

To apply the same tracked migrations from a local terminal, run `DATABASE_URL='postgresql://…?sslmode=require' bash scripts/migrate.sh`. Each migration runs once and is recorded in `clearskies_migrations`.
