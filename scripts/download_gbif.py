"""Download coordinate-bearing GBIF occurrences for Tompkins County."""
from pathlib import Path
import time
import pandas as pd
import requests

API = "https://api.gbif.org/v1/occurrence/search"
OUT = Path(__file__).parents[1] / "data/raw/gbif_occurrences.csv"
FIELDS = ["key","scientificName","species","decimalLatitude","decimalLongitude","eventDate","basisOfRecord","occurrenceStatus","issues"]

def main(limit=5000):
    rows=[]
    for offset in range(0,limit,300):
        params={"stateProvince":"New York","county":"Tompkins","hasCoordinate":"true","occurrenceStatus":"PRESENT","limit":300,"offset":offset}
        response=requests.get(API,params=params,timeout=45)
        response.raise_for_status()
        batch=response.json().get("results",[])
        if not batch: break
        rows.extend({k:r.get(k) for k in FIELDS} for r in batch)
        if len(batch)<300: break
        time.sleep(.15)
    frame=pd.DataFrame(rows).dropna(subset=["decimalLatitude","decimalLongitude"])
    frame=frame.drop_duplicates(subset=["key"])
    OUT.parent.mkdir(parents=True,exist_ok=True)
    frame.to_csv(OUT,index=False)
    print(f"Saved {len(frame):,} records to {OUT}")

if __name__=="__main__": main()
