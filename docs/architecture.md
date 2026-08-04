# Architecture

`searched location` and `selected data area` are distinct entities. A search first resolves a point, spatially finds its county and optional CBSA, then selects an AQI source.

1. Use CBSA data only when the location is inside it and its annual coverage meets the configured threshold (default 90%).
2. Otherwise use the containing county if it has AQI data.
3. Otherwise return nearby monitors ranked by distance and completeness.

Every response includes `data_source.area`, `data_source.type`, and a human-readable `reason`. No location is coerced into a CBSA.

## REST contract

- `GET /v1/locations/search?q=98101` — autocomplete candidates and resolved points.
- `GET /v1/aqi/history?location_id=...&year=2024` — daily values and source disclosure.
- `GET /v1/aqi/annual-summary?location_id=...&years=2020,2024` — comparison metrics.
- `GET /v1/monitors/nearby?lon=...&lat=...` — fallback monitor candidates.
