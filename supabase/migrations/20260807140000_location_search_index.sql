ALTER TABLE geographic_areas
  ADD COLUMN IF NOT EXISTS search_document tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(metadata->>'country', ''))) STORED;

CREATE INDEX IF NOT EXISTS geographic_areas_search_document_idx
  ON geographic_areas USING gin(search_document);

CREATE INDEX IF NOT EXISTS geographic_areas_name_trgm_idx
  ON geographic_areas USING gin(lower(name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS geographic_areas_country_trgm_idx
  ON geographic_areas USING gin(lower(metadata->>'country') gin_trgm_ops);
