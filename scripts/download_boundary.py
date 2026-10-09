"""Download US Census county boundaries and extract Tompkins County (FIPS 36109)."""
from pathlib import Path
import geopandas as gpd

SOURCE="https://www2.census.gov/geo/tiger/TIGER2025/COUNTY/tl_2025_us_county.zip"
OUT=Path(__file__).parents[1]/"data/raw/tompkins_county.geojson"

def main():
    counties=gpd.read_file(SOURCE)
    county=counties[counties["GEOID"]=="36109"]
    if county.empty: raise RuntimeError("Tompkins County was not found in the Census file")
    OUT.parent.mkdir(parents=True,exist_ok=True)
    county.to_crs(4326).to_file(OUT,driver="GeoJSON")
    print(f"Saved county boundary to {OUT}")

if __name__=="__main__": main()
