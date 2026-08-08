CREATE EXTENSION IF NOT EXISTS unaccent;
SET search_path = public, extensions, pg_catalog;

CREATE OR REPLACE FUNCTION public.immutable_unaccent(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, extensions, pg_catalog
AS $$
  SELECT unaccent(value)
$$;

DROP INDEX IF EXISTS geographic_areas_search_document_idx;
ALTER TABLE geographic_areas DROP COLUMN IF EXISTS search_document;
ALTER TABLE geographic_areas
  ADD COLUMN search_document tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', public.immutable_unaccent(coalesce(name, '') || ' ' || coalesce(metadata->>'country', '')))) STORED;

CREATE INDEX IF NOT EXISTS geographic_areas_search_document_idx
  ON geographic_areas USING gin(search_document);

CREATE INDEX IF NOT EXISTS geographic_areas_name_unaccent_trgm_idx
  ON geographic_areas USING gin(public.immutable_unaccent(lower(name)) gin_trgm_ops);
