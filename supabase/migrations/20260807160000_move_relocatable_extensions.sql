CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension extension
    JOIN pg_namespace namespace
      ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'pg_trgm'
      AND extension.extrelocatable
      AND namespace.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_extension extension
    JOIN pg_namespace namespace
      ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'unaccent'
      AND extension.extrelocatable
      AND namespace.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER EXTENSION unaccent SET SCHEMA extensions';
  END IF;
END
$$;

-- Recreate the wrapper after relocation so its fixed search path is recorded
-- even when the preceding migration partially ran before being corrected.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, extensions, pg_catalog
AS $$
  SELECT unaccent(value)
$$;
