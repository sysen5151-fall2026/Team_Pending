"""Create deterministic demonstration cells so the web app works immediately."""
from pathlib import Path
import json,math,random

OUT=Path(__file__).parents[1]/"dist/data/risk_grid.geojson"
random.seed(5151)
features=[]
habitats=["Forest","Wetland","Agriculture","Mixed habitat"]
SUITABILITY={"Forest":1.0,"Wetland":1.0,"Agriculture":0.35,"Mixed habitat":0.7}
SENSITIVITY={
    "Forest":{"road":0.7,"urban":0.9,"agriculture":0.6},
    "Wetland":{"road":0.8,"urban":1.0,"agriculture":0.9},
    "Agriculture":{"road":0.3,"urban":0.5,"agriculture":0.1},
    "Mixed habitat":{"road":0.6,"urban":0.7,"agriculture":0.5},
}
WEIGHTS={"road":0.4,"urban":0.4,"agriculture":0.2}
Z,K=2.5,0.5
lat0,lon0=42.28,-76.70
dy,dx=.055,.075
for row in range(6):
    for col in range(6):
        lat=lat0+row*dy; lon=lon0+col*dx
        species=min(1,max(0,.35+.35*math.sin((row+1)*.8)+random.uniform(-.12,.12)))
        habitat=habitats[(row+2*col)%len(habitats)]
        road=min(1,max(0,.12+(5-row)*.09+random.uniform(-.1,.1)))
        urban=min(1,max(0,.08+col*.11+random.uniform(-.1,.1)))
        agriculture=min(1,max(0,.10+abs(2.5-row)*.08+random.uniform(-.08,.08)))
        accessibility=0.3 if (row+col)%5==0 else (0.65 if (row+col)%3==0 else 1.0)
        sensitivity=SENSITIVITY[habitat]
        degradation=accessibility*sum(WEIGHTS[t]*v*sensitivity[t] for t,v in {"road":road,"urban":urban,"agriculture":agriculture}.items())
        suitability=SUITABILITY[habitat]
        quality=suitability*(1-(degradation**Z/(degradation**Z+K**Z)))
        score=round(1-quality,3)
        coords=[[lon,lat],[lon+dx*.9,lat],[lon+dx*.9,lat+dy*.86],[lon,lat+dy*.86],[lon,lat]]
        features.append({"type":"Feature","properties":{"cell_id":f"TC-{row*6+col+1:04d}","habitat":habitat,"species_count":round(8+species*55),"habitat_suitability":suitability,"accessibility":accessibility,"road_effect":round(road,3),"urban_effect":round(urban,3),"agriculture_effect":round(agriculture,3),"degradation":round(degradation,3),"habitat_quality":round(quality,3),"risk_score":score},"geometry":{"type":"Polygon","coordinates":[coords]}})
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps({"type":"FeatureCollection","features":features},separators=(",",":")))
print(f"Saved {len(features)} demo cells to {OUT}")
