"""Load Census TIGER/Line reference layers into geographic_areas."""
import argparse

LAYERS = {"place": "places", "county": "counties", "cbsa": "cbsas", "zcta": "zctas"}

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--layer", choices=LAYERS, required=True); parser.add_argument("--year", type=int, required=True)
    args = parser.parse_args()
    print(f"Fetch Census TIGER/Line {LAYERS[args.layer]} for {args.year}, normalize GEOID/name/geometry, then upsert geographic_areas.")

if __name__ == "__main__": main()
