"""Generate deterministic demo *Environmental datasets* (IDEF0 input to F.2.1).

Writes one JSON file per data source to data/raw/.  Values are synthetic but
spatially coherent for a Tompkins County, NY demo grid (14 x 12 cells, 1 km
nominal analysis cells in EPSG:26918).  One un-approved source and three GBIF
gaps are included on purpose so F.2.1 (Approved source list) and F.2.2
(data-gap warning, SYS-2.1.5) have something to catch.

    python scripts/make_raw_demo_data.py
"""
from __future__ import annotations

import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
COLS, ROWS = 14, 12
W, S, E, N = -76.70, 42.27, -76.24, 42.63
CITY = (-76.50, 42.44)               # Ithaca
ROADS = [((-76.70, 42.30), (-76.24, 42.60)),   # NY-13 style diagonal
         ((-76.50, 42.27), (-76.50, 42.63)),   # N-S corridor
         ((-76.70, 42.52), (-76.24, 42.50))]   # E-W corridor
KM_PER_DEG_LAT, KM_PER_DEG_LON = 111.0, 82.0
RETRIEVED = "2026-10-15"


def seg_dist_km(p, a, b):
    ax, ay = a[0] * KM_PER_DEG_LON, a[1] * KM_PER_DEG_LAT
    bx, by = b[0] * KM_PER_DEG_LON, b[1] * KM_PER_DEG_LAT
    px, py = p[0] * KM_PER_DEG_LON, p[1] * KM_PER_DEG_LAT
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def main() -> None:
    rng = random.Random(5151)
    RAW.mkdir(parents=True, exist_ok=True)
    dx, dy = (E - W) / COLS, (N - S) / ROWS
    cells = []
    for r in range(ROWS):
        for c in range(COLS):
            x0, y0 = W + c * dx, S + r * dy
            cid = f"R{r + 1:02d}-C{c + 1:02d}"   # row (south to north), column (west to east)
            centre = (x0 + dx / 2, y0 + dy / 2)
            cells.append((cid, [[[round(x0, 5), round(y0, 5)], [round(x0 + dx, 5), round(y0, 5)],
                                 [round(x0 + dx, 5), round(y0 + dy, 5)], [round(x0, 5), round(y0 + dy, 5)],
                                 [round(x0, 5), round(y0, 5)]]], centre, r, c))

    def write(source_id, title, records, crs="EPSG:26918", license_="public"):
        doc = {"source_id": source_id, "title": title, "crs": crs, "retrieved": RETRIEVED,
               "license": license_, "records": records}
        (RAW / f"{source_id.lower()}.json").write_text(json.dumps(doc, indent=1))

    write("TIGER-BOUNDARY", "U.S. Census TIGER county boundary, gridded",
          [{"cell_id": cid, "geometry": g} for cid, g, *_ in cells], crs="EPSG:4326")

    lc, roads, urban, agri, prot, occ = [], [], [], [], [], []
    for cid, _, (x, y), r, c in cells:
        d_city = math.hypot((x - CITY[0]) * KM_PER_DEG_LON, (y - CITY[1]) * KM_PER_DEG_LAT)
        wet = math.sin(c * 0.9) + math.cos(r * 1.1) + rng.uniform(-0.4, 0.4)
        farm = math.sin((c + r) * 0.45 + 1.2) + rng.uniform(-0.5, 0.5)
        if d_city < 3.0:
            cover = "Mixed habitat"
        elif wet > 1.35:
            cover = "Wetland"
        elif farm > 0.55:
            cover = "Agriculture"
        elif farm > 0.0:
            cover = "Mixed habitat"
        else:
            cover = "Forest"
        lc.append({"cell_id": cid, "land_cover": cover})
        roads.append({"cell_id": cid, "distance_km": round(min(seg_dist_km((x, y), a, b) for a, b in ROADS), 3)})
        urban.append({"cell_id": cid, "distance_km": round(max(0.0, d_city - 3.0) * 0.45 + rng.uniform(0, 0.15), 3)})
        agri.append({"cell_id": cid, "distance_km": 0.0 if cover == "Agriculture"
                     else round(abs(farm - 0.55) * 0.7 + rng.uniform(0, 0.1), 3)})
        prot.append({"cell_id": cid, "protected": bool(cover in ("Forest", "Wetland") and rng.random() < 0.35)})
        base = {"Forest": 42, "Wetland": 55, "Mixed habitat": 30, "Agriculture": 14}[cover]
        occ.append({"cell_id": cid, "species_count": max(0, base + rng.randint(-10, 12))})
    for gap in ("R01-C14", "R07-C13", "R12-C04"):           # intentional data gaps
        occ = [o for o in occ if o["cell_id"] != gap]

    write("USGS-NLCD-LANDCOVER", "NLCD 2021 land cover, reclassified", lc)
    write("OSM-ROADS", "OpenStreetMap roads, distance raster", roads, license_="ODbL")
    write("NLCD-DEVELOPED", "NLCD developed classes, distance raster", urban)
    write("NLCD-CULTIVATED", "NLCD cultivated classes, distance raster", agri)
    write("USGS-PADUS", "Protected Areas Database of the U.S.", prot)
    write("GBIF-OCCURRENCES", "GBIF species occurrence counts", occ, license_="CC-BY")
    write("SCRAPED-BLOG-LAYER", "Unvetted layer copied from a blog (not approved)",
          [{"cell_id": cid, "value": 1} for cid, *_ in cells[:5]], license_="unknown")
    print(f"wrote {len(list(RAW.glob('*.json')))} sources, {len(cells)} cells -> {RAW}")


if __name__ == "__main__":
    main()
