ALTER TABLE geographic_areas ADD COLUMN IF NOT EXISTS country_code char(2);

CREATE INDEX IF NOT EXISTS geographic_areas_country_idx ON geographic_areas(country_code);

CREATE TABLE IF NOT EXISTS postal_codes (
  country_code char(2) NOT NULL,
  code text NOT NULL,
  name text,
  centroid geometry(Point, 4326),
  metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (country_code, code)
);

CREATE INDEX IF NOT EXISTS postal_codes_code_idx ON postal_codes(code);
CREATE INDEX IF NOT EXISTS postal_codes_centroid_idx ON postal_codes USING gist(centroid);

CREATE TABLE IF NOT EXISTS postal_code_areas (
  country_code char(2) NOT NULL,
  postal_code text NOT NULL,
  area_id uuid NOT NULL REFERENCES geographic_areas(id) ON DELETE CASCADE,
  source text NOT NULL,
  PRIMARY KEY (country_code, postal_code, area_id),
  FOREIGN KEY (country_code, postal_code) REFERENCES postal_codes(country_code, code) ON DELETE CASCADE
);
