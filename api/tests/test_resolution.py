from app.resolution import Candidate, select_source

def test_cbsa_requires_good_coverage():
    choice, area, _ = select_source(Candidate("m", .92, "Metro"), Candidate("c", 1, "County"), [])
    assert (choice, area.area_id) == ("cbsa", "m")

def test_county_is_not_forced_into_cbsa():
    choice, area, _ = select_source(Candidate("m", .50, "Metro"), Candidate("c", .88, "County"), [])
    assert (choice, area.area_id) == ("county", "c")
