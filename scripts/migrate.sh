#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to a direct PostgreSQL connection string.}"

psql "$DATABASE_URL" --set ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS clearskies_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for migration in supabase/migrations/*.sql; do
  filename="$(basename "$migration")"
  applied="$(psql "$DATABASE_URL" --tuples-only --no-align --set ON_ERROR_STOP=1 \
    --set migration_name="$filename" \
    --command "SELECT EXISTS (SELECT 1 FROM clearskies_migrations WHERE filename = :'migration_name')")"
  if [ "$applied" = "t" ]; then
    echo "Already applied: $filename"
    continue
  fi
  echo "Applying: $filename"
  psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file "$migration"
  psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --set migration_name="$filename" \
    --command "INSERT INTO clearskies_migrations (filename) VALUES (:'migration_name')"
done
