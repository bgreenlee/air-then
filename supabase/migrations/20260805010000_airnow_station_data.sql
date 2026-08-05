ALTER TABLE daily_aqi
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'epa_airdata',
  ADD COLUMN IF NOT EXISTS data_status text NOT NULL DEFAULT 'validated',
  ADD COLUMN IF NOT EXISTS calculation_version text;

CREATE TABLE IF NOT EXISTS daily_station_aqi (
  monitor_area_id uuid NOT NULL REFERENCES geographic_areas(id) ON DELETE CASCADE,
  date date NOT NULL,
  pollutant text NOT NULL,
  aqi smallint NOT NULL CHECK (aqi BETWEEN 0 AND 500),
  concentration numeric,
  units text,
  source text NOT NULL,
  source_file text NOT NULL,
  PRIMARY KEY (monitor_area_id, date, pollutant, source)
);

CREATE INDEX IF NOT EXISTS daily_station_aqi_date_idx ON daily_station_aqi(date DESC);
