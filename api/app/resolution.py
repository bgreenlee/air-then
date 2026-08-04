"""Pure source-selection policy; spatial lookups are supplied by the repository."""
from dataclasses import dataclass

@dataclass(frozen=True)
class Candidate:
    area_id: str
    coverage: float
    label: str

def select_source(cbsa: Candidate | None, county: Candidate | None, monitors: list[Candidate], minimum_coverage: float = .90):
    if cbsa and cbsa.coverage >= minimum_coverage:
        return "cbsa", cbsa, f"Location is inside {cbsa.label}, which has strong daily monitoring coverage."
    if county and county.coverage > 0:
        return "county", county, f"Location is outside a well-covered CBSA; {county.label} is the best available county record."
    if monitors:
        nearest = monitors[0]
        return "monitor", nearest, f"No area-level AQI record is available; using the nearest reporting monitor, {nearest.label}."
    return None, None, "No AQI source is available for this location and year."
