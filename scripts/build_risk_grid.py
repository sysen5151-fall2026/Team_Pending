"""Build a transparent 1 km biodiversity-risk grid.

Required raw inputs:
  data/raw/tompkins_county.geojson
  data/raw/gbif_occurrences.csv
Optional inputs:
  data/raw/protected_areas.geojson
  data/raw/roads.geojson
  data/raw/land_cover.tif
"""
from pathlib import Path
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.geometry import box

ROOT=Path(__file__).parents[1]
RAW=ROOT/"data/raw"
OUT=ROOT/"dist/data/risk_grid.geojson"
Z,K=2.5,0.5
THREAT_WEIGHTS={"road":0.4,"urban":0.4,"agriculture":0.2}
HABITAT_SUITABILITY={"Forest":1.0,"Wetland":1.0,"Agriculture":0.35,"Mixed habitat":0.7}
HABITAT_SENSITIVITY={
    "Forest":{"road":0.7,"urban":0.9,"agriculture":0.6},
    "Wetland":{"road":0.8,"urban":1.0,"agriculture":0.9},
    "Agriculture":{"road":0.3,"urban":0.5,"agriculture":0.1},
    "Mixed habitat":{"road":0.6,"urban":0.7,"agriculture":0.5},
}

def normalize(series):
    series=series.fillna(0).astype(float)
    span=series.max()-series.min()
    return (series-series.min())/span if span else pd.Series(0,index=series.index,dtype=float)

def create_grid(boundary,cell_size=1000):
    area=boundary.to_crs(32618)
    xmin,ymin,xmax,ymax=area.total_bounds
    cells=[box(x,y,x+cell_size,y+cell_size) for x in np.arange(xmin,xmax,cell_size) for y in np.arange(ymin,ymax,cell_size)]
    grid=gpd.GeoDataFrame({"geometry":cells},crs=area.crs)
    grid=gpd.clip(grid,area)
    grid=grid[grid.area>(cell_size*cell_size*.15)].reset_index(drop=True)
    grid["cell_id"]=[f"TC-{i+1:04d}" for i in range(len(grid))]
    return grid

def main():
    boundary=gpd.read_file(RAW/"tompkins_county.geojson")
    grid=create_grid(boundary)
    obs=pd.read_csv(RAW/"gbif_occurrences.csv")
    points=gpd.GeoDataFrame(obs,geometry=gpd.points_from_xy(obs.decimalLongitude,obs.decimalLatitude),crs=4326).to_crs(grid.crs)
    joined=gpd.sjoin(points,grid,predicate="within")
    richness=joined.groupby("index_right")["scientificName"].nunique()
    grid["species_count"]=grid.index.to_series().map(richness).fillna(0)

    protected_path=RAW/"protected_areas.geojson"
    if protected_path.exists():
        protected=gpd.read_file(protected_path).to_crs(grid.crs)
        overlap=gpd.overlay(grid[["cell_id","geometry"]],protected[["geometry"]],how="intersection")
        protected_area=overlap.groupby("cell_id").geometry.apply(lambda x:x.area.sum())
        grid["protected_fraction"]=(grid.cell_id.map(protected_area).fillna(0)/grid.area).clip(0,1)
    else: grid["protected_fraction"]=0
    # InVEST beta: 1 means fully accessible to threats; protection reduces accessibility.
    grid["accessibility"]=(1-0.7*grid["protected_fraction"]).clip(0.3,1)

    roads_path=RAW/"roads.geojson"
    if roads_path.exists():
        roads=gpd.read_file(roads_path).to_crs(grid.crs)
        joined_roads=gpd.overlay(grid[["cell_id","geometry"]],roads[["geometry"]],how="intersection",keep_geom_type=False)
        road_length=joined_roads.groupby("cell_id").geometry.apply(lambda x:x.length.sum())
        grid["road_length_m"]=grid.cell_id.map(road_length).fillna(0)
        grid["road_effect"]=normalize(grid["road_length_m"])
    else: grid["road_effect"]=0

    # Replace these neutral effects using NLCD zonal statistics in the production study.
    grid["urban_effect"]=0
    grid["agriculture_effect"]=0
    grid["habitat"]="Mixed habitat"
    grid["habitat_suitability"]=grid.habitat.map(HABITAT_SUITABILITY)
    grid["degradation"]=0.0
    for threat in THREAT_WEIGHTS:
        effect=grid[f"{threat}_effect"]
        sensitivity=grid.habitat.map(lambda h:HABITAT_SENSITIVITY[h][threat])
        grid["degradation"]+=THREAT_WEIGHTS[threat]*effect*sensitivity
    grid["degradation"]*=grid["accessibility"]
    d=grid["degradation"]
    grid["habitat_quality"]=grid.habitat_suitability*(1-(d**Z/(d**Z+K**Z)))
    grid["risk_score"]=(1-grid.habitat_quality).clip(0,1).round(3)
    OUT.parent.mkdir(parents=True,exist_ok=True)
    fields=["cell_id","habitat","species_count","habitat_suitability","accessibility","road_effect","urban_effect","agriculture_effect","degradation","habitat_quality","risk_score","geometry"]
    grid.to_crs(4326)[fields].to_file(OUT,driver="GeoJSON")
    print(f"Saved {len(grid):,} scored cells to {OUT}")

if __name__=="__main__": main()
