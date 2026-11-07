# Route table (Lab Manual Ch 6): product entry point → use case → IDEF0 function

The web app (`dist/`) is organised exactly like the IDEF0 decomposition in Innoslate (bio2).
Each function is a button. Pressing it opens that function's page, and a function that has children lists them as buttons.
The UI shows function names only; the IDs below are for traceability.

| Route | Page (function name) | Level | IDEF0 ID | Actor / mechanism | What the user can do |
|---|---|---|---|---|---|
| `#/` | Home | 1 | Metafunction | all | Five buttons, one per Level-1 function, each with what it sends to and gets from the map |
| `#/screen` (+ `/locate`, `/overlay`, `/summarize`, `/download` = F.5.1–F.5.4) | Screen Proposed Development Sites | 1 → 2 | F.5 | C.5 Local Planner | Enter project name, pick site cells → runs F.2 → screening result and report |
| `#/conservation` (+ `/filters`, `/inspect`, `/evidence`, `/export` = F.1.1–F.1.4) | Identify Conservation Priorities | 1 → 2 | F.1 | C.1 Conservation Organizations | Enter organization and habitat type → top 10 cells from the Habitat-quality map |
| `#/review` (+ `/coverage`, `/approve`, `/method`, `/decision` = F.3.1–F.3.4) | Review Environmental Screening Evidence | 1 → 2 | F.3 | C.3 Government Agencies | Read factor explanations; send a Review request; edit the Approved source list |
| `#/maintain` (+ `/acquire`, `/grid`, `/calculate`, `/publish`, `/package` = F.4.1–F.4.5) | Maintain Biodiversity Risk Map | 1 → 2 | F.4 | C.4 IT Development Team | Change and save the Habitat-model parameters (threat weights, k, z) |
| `#/assess` | Assess Spatial Biodiversity Conditions | 1 → hub of Level 2 | F.2 | C.2 Biodiversity Risk Map | Seven buttons for F.2.1–F.2.7 with status; *Run all seven in order*; *Start over* |
| `#/assess/acquire` | Acquire Environmental Data | 2 | F.2.1 | C.2.1 Data Ingestion Subsystem | Choose datasets → accepted / rejected sources, Dataset identifier |
| `#/assess/prepare` | Validate and Prepare Data | 2 | F.2.2 | C.2.2 Data Preparation Subsystem | Validate → Coverage validation result, Data-quality report, Prepared datasets |
| `#/assess/habitat` | Calculate Habitat Quality | 2 → hub of Level 3 | F.2.3 | C.2.3 Habitat Modeling Subsystem | Six step buttons (below) and *Run all 6 steps* |
| ↳ step 1 | Assemble Model Inputs | 3 | F.2.3.1 | C.2.3.1 Model Input Builder | Run → Model input bundle, Threat-layer inventory |
| ↳ step 2 | Configure Threat and Sensitivity Parameters | 3 | F.2.3.2 | C.2.3.2 Parameter Configuration Manager | Run → Approved parameter set |
| ↳ step 3 | Execute Habitat Quality Model | 3 | F.2.3.3 | C.2.3.3 InVEST Habitat Quality Engine | Run (optionally simulate a fault) → Raw model outputs, Run log |
| ↳ step 4 | Verify Model Outputs | 3 | F.2.3.4 | C.2.3.4 Output QA Checker | Run → QA result and either Verified habitat rasters or a Re-run request back to step 3 |
| ↳ step 5 | Classify Habitat Risk | 3 | F.2.3.5 | C.2.3.5 Risk Classifier | Run → Habitat-quality and degradation results |
| ↳ step 6 | Register Model Run | 3 | F.2.3.6 | C.2.3.6 Model Run Registry | Run → Model run record |
| `#/assess/summarize` | Summarize Site Conditions | 2 | F.2.4 | C.2.4 Spatial Analysis Subsystem | Pick cells → Site screening summary |
| `#/assess/display` | Display Geographic Results | 2 | F.2.5 | C.2.5 Web Map Subsystem | Draw → risk map / habitat-quality map, cell details |
| `#/assess/explain` | Explain Results and Limitations | 2 | F.2.6 | C.2.6 Explanation Subsystem | Explain → factors, limitations, review note, provenance |
| `#/assess/export` | Export Screening Reports | 2 | F.2.7 | C.2.7 Report Generation Subsystem | Export → report preview, .md and .csv downloads |
| `python scripts/run_pipeline.py` | (batch) | — | F.2 | C.4 runs it | Same chain in Python; output must match the browser (test `test_HMS_2_1_3_browser_engine_matches_python`) |

Every function page has a one-line *Done by / Uses / Follows / Gives* strip. These are the mechanism, inputs, controls and outputs of the box on the IDEF0.
The page code is `dist/app.js` (`PAGES[...]`), and every computation is a call into `dist/brm-engine.js`, the port of `brm/`.


The Level-2 steps of F.1, F.3, F.4 and F.5 come from the Innoslate hierarchy diagrams (stored in `model/idef0.json` under `level2_actors`). Every screened site is evaluated per plot (grid cell) and as a whole (*Summarize Site Risk*, *Summarize Site Conditions*).
