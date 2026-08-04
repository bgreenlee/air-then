CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE area_type AS ENUM ('place','county','cbsa','zcta','monitor');
CREATE TYPE relationship_type AS ENUM ('contains','within','served_by','nearby');
CREATE TABLE geographic_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type area_type NOT NULL, geoid text NOT NULL,
  name text NOT NULL, state_fips char(2), geom geometry(Geometry,4326), centroid geometry(Point,4326),
  metadata jsonb NOT NULL DEFAULT '{}', UNIQUE(type, geoid)
);
CREATE INDEX geographic_areas_geom_idx ON geographic_areas USING gist(geom);
CREATE INDEX geographic_areas_centroid_idx ON geographic_areas USING gist(centroid);
CREATE INDEX geographic_areas_name_idx ON geographic_areas USING gin(name gin_trgm_ops);
CREATE TABLE area_relationships (
  parent_area_id uuid NOT NULL REFERENCES geographic_areas(id) ON DELETE CASCADE,
  child_area_id uuid NOT NULL REFERENCES geographic_areas(id) ON DELETE CASCADE,
  relationship relationship_type NOT NULL, confidence numeric(4,3),
  PRIMARY KEY(parent_area_id,child_area_id,relationship)
);
CREATE TABLE daily_aqi (
  area_id uuid NOT NULL REFERENCES geographic_areas(id) ON DELETE CASCADE, date date NOT NULL,
  aqi smallint NOT NULL CHECK(aqi BETWEEN 0 AND 500), defining_parameter text,
  reporting_sites smallint, source_file text NOT NULL, PRIMARY KEY(area_id,date)
);
CREATE INDEX daily_aqi_area_date_idx ON daily_aqi(area_id,date DESC);
CREATE TABLE monitoring_sites (
  area_id uuid PRIMARY KEY REFERENCES geographic_areas(id) ON DELETE CASCADE,
  epa_site_id text UNIQUE NOT NULL, county_area_id uuid REFERENCES geographic_areas(id),
  cbsa_area_id uuid REFERENCES geographic_areas(id), active boolean NOT NULL DEFAULT true
);
CREATE TABLE import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL, year int, started_at timestamptz DEFAULT now(),
  completed_at timestamptz, rows_loaded bigint DEFAULT 0, checksum text, status text NOT NULL DEFAULT 'running'
);
