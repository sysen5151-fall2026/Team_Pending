# Biodiversity Risk Map

A complete SYSEN 5151 MVP for screening biodiversity risk across Tompkins County, New York. The repository contains a browser-based decision dashboard, the Stanford Natural Capital Project InVEST Habitat Quality equations, scripts for accessing public data, and demonstration data that make the interface usable immediately.

## What the application does

- Displays scored geographic cells on an interactive Leaflet map.
- Filters cells by risk level and dominant habitat.
- Shows each score's four component indicators.
- Adjusts the priority threshold and exports priority cells to CSV.
- Clearly labels the included data as a prototype and explains appropriate use.

## Run the included demonstration

Because browsers block local `fetch()` calls from `file://` pages, serve the project directory:

```bash
cd dist
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Build a map from public data

Create and activate a Python environment, then install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Download the county boundary and up to 5,000 GBIF occurrences:

```bash
python scripts/download_boundary.py
python scripts/download_gbif.py
```

Optional layers may be placed at these paths:

- `data/raw/protected_areas.geojson`: PAD-US polygons clipped to Tompkins County.
- `data/raw/roads.geojson`: OpenStreetMap road lines.
- `data/raw/land_cover.tif`: a USGS Annual NLCD GeoTIFF.

Build the scored GeoJSON used by the dashboard:

```bash
python scripts/build_risk_grid.py
```

Refresh the browser. The app loads `dist/data/risk_grid.geojson`, so no JavaScript change is required.

## InVEST Habitat Quality model

The project uses the authoritative InVEST Habitat Quality equation:

```text
Q_xj = H_j × [1 − D_xj^z / (D_xj^z + k^z)]
Risk_xj = 1 − Q_xj
```

The prototype uses InVEST's fixed `z = 2.5` and a documented prototype value `k = 0.5` because degradation is normalized. Threat weights, maximum distances, habitat suitability, sensitivity, and `k` require literature or expert calibration before decision use. GBIF species records are retained for validation and context rather than inserted into the standard equation.

Source: [Natural Capital Project InVEST Habitat Quality documentation](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/habitat_quality.html). The output is a screening score—not a prediction of species loss or a substitute for field assessment.

## Data sources

- Species observations: GBIF Occurrence API
- County boundary: U.S. Census TIGER/Line
- Land cover: USGS Annual NLCD (manual GeoTIFF download)
- Protected areas: USGS PAD-US (manual state download and conversion)
- Roads: OpenStreetMap

Review each source's license, citation guidance, coordinate quality, temporal coverage, and sampling limitations before presenting results.

## Project structure

```text
dist/                       deployable web application
  index.html
  styles.css
  app.js
  data/risk_grid.geojson
scripts/
  download_boundary.py
  download_gbif.py
  build_risk_grid.py
  make_demo_data.py
tests/test_scoring.py
requirements.txt
```

## Suggested next improvement

Implement NLCD zonal statistics for habitat condition and land-cover change. Keep the raw class percentages visible so users can understand why an area received its score.
