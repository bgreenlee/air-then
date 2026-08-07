CREATE TABLE IF NOT EXISTS daily_pollutant_measurements (
  area_id uuid NOT NULL REFERENCES geographic_areas(id) ON DELETE CASCADE,
  date date NOT NULL,
  pollutant text NOT NULL,
  value numeric NOT NULL,
  units text NOT NULL,
  observation_count integer NOT NULL DEFAULT 1,
  source text NOT NULL,
  source_location_id text NOT NULL,
  source_file text NOT NULL,
  PRIMARY KEY (area_id, date, pollutant, source)
);

CREATE INDEX IF NOT EXISTS daily_pollutant_measurements_area_date_idx
  ON daily_pollutant_measurements(area_id, date DESC);
