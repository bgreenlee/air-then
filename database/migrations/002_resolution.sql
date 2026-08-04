CREATE TABLE location_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), query text NOT NULL, point geometry(Point,4326) NOT NULL,
  searched_area_id uuid REFERENCES geographic_areas(id), county_area_id uuid REFERENCES geographic_areas(id),
  cbsa_area_id uuid REFERENCES geographic_areas(id), selected_data_area_id uuid REFERENCES geographic_areas(id),
  selected_source text NOT NULL CHECK(selected_source IN ('cbsa','county','monitor')),
  reason text NOT NULL, created_at timestamptz DEFAULT now()
);
CREATE INDEX location_resolutions_point_idx ON location_resolutions USING gist(point);
