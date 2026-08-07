-- Public data is readable; all writes remain restricted to the database
-- owner/service role used by the importers. Operational tables intentionally
-- have RLS enabled without a public policy.
ALTER TABLE geographic_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE area_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_aqi ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_station_aqi ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_pollutant_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE postal_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE postal_code_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geographic_areas_public_read ON geographic_areas;
CREATE POLICY geographic_areas_public_read ON geographic_areas FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS area_relationships_public_read ON area_relationships;
CREATE POLICY area_relationships_public_read ON area_relationships FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS daily_aqi_public_read ON daily_aqi;
CREATE POLICY daily_aqi_public_read ON daily_aqi FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS monitoring_sites_public_read ON monitoring_sites;
CREATE POLICY monitoring_sites_public_read ON monitoring_sites FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS daily_station_aqi_public_read ON daily_station_aqi;
CREATE POLICY daily_station_aqi_public_read ON daily_station_aqi FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS daily_pollutant_measurements_public_read ON daily_pollutant_measurements;
CREATE POLICY daily_pollutant_measurements_public_read ON daily_pollutant_measurements FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS postal_codes_public_read ON postal_codes;
CREATE POLICY postal_codes_public_read ON postal_codes FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS postal_code_areas_public_read ON postal_code_areas;
CREATE POLICY postal_code_areas_public_read ON postal_code_areas FOR SELECT TO public USING (true);
