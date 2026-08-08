-- Operational data is only accessed through direct owner/service connections.
-- Explicit deny policies document that these tables are not part of the public
-- Data API while allowing database owners and BYPASSRLS roles to keep working.
CREATE TABLE IF NOT EXISTS public.clearskies_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clearskies_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clearskies_migrations_no_client_access
  ON public.clearskies_migrations;
CREATE POLICY clearskies_migrations_no_client_access
  ON public.clearskies_migrations
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS import_runs_no_client_access
  ON public.import_runs;
CREATE POLICY import_runs_no_client_access
  ON public.import_runs
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS location_resolutions_no_client_access
  ON public.location_resolutions;
CREATE POLICY location_resolutions_no_client_access
  ON public.location_resolutions
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);
