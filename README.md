# Biodiversity Risk Map (BRM)

SYSEN 5151 · Team Pending · Tompkins County, NY prototype.

The product implements IDEF0 function **F.2 Assess Spatial Biodiversity Conditions** (mechanism **C.2 Biodiversity Risk Map**) from the Innoslate model *bio2*, with **all three IDEF0 levels visible in the running app and in the code**:

| IDEF0 level | Innoslate diagram | In the product | In the code |
|---|---|---|---|
| Level 1 | Metafunction (F.1–F.5) | Home page: five buttons. Each opens a working page (screen a project, set conservation priorities, review evidence, maintain the system, open the map system) | `brm/service.py` (F.2) + `config/*` (one file per control arrow) |
| Level 2 | F.2 → F.2.1 … F.2.7 | *Assess Spatial Biodiversity Conditions* page: seven buttons; each step runs on its own page | `brm/f2_1_…py` … `brm/f2_7_…py` |
| Level 3 | F.2.3 → F.2.3.1 … F.2.3.6 | *Calculate Habitat Quality* page: six step buttons, run one at a time (with the quality-check re-run loop) or all at once | `brm/habitat_modeling/f2_3_1_…py` … `f2_3_6_…py` |

## Run it

```bash
python3 scripts/make_raw_demo_data.py    # Environmental datasets (deterministic demo data) -> data/raw/
python3 scripts/run_pipeline.py          # F.2 batch run -> dist/data/ (prints RUN-/DS-/PS- identifiers)
cd dist && python3 -m http.server 8000   # open http://localhost:8000
```

No third-party Python packages are needed for the engine; tests need only `pytest` (`pip install -r requirements-test.txt`).
Leaflet is vendored in `dist/vendor/leaflet`, so the app works offline (basemap tiles need internet; the risk grid does not).

```bash
python3 -m pytest tests/test_functional_requirements.py -v   # tests named by requirement ID
```

## Screening only the selected site

*Screen a project* (F.5) runs the habitat model **only on the plots the planner selects** (e.g. 4 of 168 cells), using the same approved parameter set as a county run, so each plot gets exactly the same score it would get in a full run. If the county has already been scored, the screening pages reuse that run and calculate nothing. The page states which of the two happened and the run ID.

## Repository map (codebase → model)

| Path | What it is |
|---|---|
| `model/idef0.json` | The three IDEF0 levels, hierarchies and requirements exported from Innoslate bio2 |
| `brm/idef0.py` | `@idef0(...)` decorator: binds each Python function to its IDEF0 box (ID, mechanism, ICOMs, requirements) and records a run trace |
| `brm/service.py` | F.2 orchestrator — call order = arrows on the F.2 IDEF0 |
| `brm/habitat_modeling/` | F.2.3 and its six Level-3 component modules |
| `config/` | Every control arrow of F.2 as a versioned file, with its Level-1 owner |
| `dist/brm-engine.js` | Browser port of F.2.3.x, F.2.4, F.2.6, F.2.7 (same hashes → same run IDs as Python) |
| `dist/app.js` | Web app (C.2.5): routes in `docs/route-table.md` |
| `docs/traceability.md` | Function ID → module → requirement ID → test name |
| `docs/route-table.md` | Product entry point → use case → IDEF0 functions (Lab Manual Ch 6) |
| `contracts/api-v1.yaml` | OpenAPI contract, one operation per F.2.3.x box, one schema per internal arrow (Lab Manual Ch 7) |
| `tests/test_functional_requirements.py` | Tests named `test_SYS_…` / `test_HMS_…` after Innoslate requirement IDs |
| `.github/workflows/tests.yml` | CI: regenerate data, run pipeline, run tests (Python 3.10 + 3.12, Node for the JS parity test) |
| `docs/user-guide-screening.md` | How to screen a site: what to provide, how to operate, the standards used and where results appear |
| `docs/demo-video-script.md` | 10-minute demo video script mapped to the Canvas rubric and the peer-review worksheet |
| `legacy/` | Earlier stubs and README kept for reference (`legacy/README_v1.md` describes the original public-data GIS pipeline in `scripts/build_risk_grid.py`) |

## Habitat quality model (F.2.3.3)

InVEST Habitat Quality (pinned release in `config/habitat_model_parameters.json`):

```
i_rxy = 1 − d/d_max  (linear)  or  exp(−2.99·d/d_max)  (exponential)
D_xj  = β_x · Σ_r (w_r / Σw) · i_rxy · S_jr
Q_xj  = H_j · (1 − D^z / (D^z + k^z))          risk = 1 − Q   → five classes (F.2.3.5)
```

All weights, distances, suitability and sensitivity values are prototype values for demonstration and need expert calibration. Results are preliminary ecological screening only, not regulatory determinations.
