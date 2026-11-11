# Demo video script — "Model to product" (≈ 10 min)

Selected function: **F.2.3 Calculate Habitat Quality** (performed by **C.2.3 Habitat Modeling Subsystem**), child of first-level function **F.2 Assess Spatial Biodiversity Conditions** (performed by **C.2 Biodiversity Risk Map**).
This is the same function used in the class demo. Record separately from the DL demo video.

**Before recording**
- Run `python3 scripts/make_raw_demo_data.py && python3 scripts/run_pipeline.py`, then `cd dist && python3 -m http.server 8000`.
- Tabs to open: Innoslate bio2 (Metafunction IDEF0, F.2 IDEF0, F.2.3 IDEF0, F.2 hierarchy, C.2 asset diagram, both requirement documents); the app at `http://localhost:8000/`; GitHub repo (`docs/traceability.md`, the module, the test file, Actions tab, `contracts/api-v1.yaml`, `docs/route-table.md`).
- In the app, start from Home with nothing run yet. If needed, use **Start over** on the Assess page. The UI shows function names only; IDs are in `docs/route-table.md`.

---

## 0. Opening — 0:00–0:40

> "Our product is the Biodiversity Risk Map. It lets a county planner screen a proposed development site for biodiversity risk before a planning decision. In our model it is function F.2, *Assess Spatial Biodiversity Conditions*, and its mechanism is C.2, the Biodiversity Risk Map. Today we follow one function, **F.2.3 Calculate Habitat Quality**, from the Innoslate model into the running product, then into the code, then into the requirements."

## Part 1 — Model to product (0:40–4:30)

### 1(1) Brief IDEF0 with physical mechanisms — 0:40–1:30
*Innoslate: Metafunction IDEF0.*
> "At the top level we have five functions, each with its physical mechanism at the bottom of the box: F.1 Conservation Organizations, F.2 our Biodiversity Risk Map, F.3 Government Agencies, F.4 the IT Development Team, F.5 the Local Planner."

*App: Home.*
> "The home page is the same diagram: five buttons, one per function. Each one says who performs it and what it sends to or gets from the map."

### 1(2) Second-level IDEF0 and hierarchies — 1:30–2:40
*Innoslate: F.2 IDEF0, then the F.2 hierarchy diagram, then the C.2 asset diagram.*
> "F.2 decomposes into F.2.1 to F.2.7, each performed by its own subsystem, C.2.1 to C.2.7. F.2.3 takes Prepared datasets, is controlled by Habitat-model parameters, and outputs Habitat-quality and degradation results plus a Model run record."

*App: click **Assess Spatial Biodiversity Conditions**.*
> "Inside the map system are the same seven functions as buttons, in data-flow order. The strip at the top lists this box's inputs, controls and outputs from the diagram. "

### 1(3) How the product carries out F.2.3 — 2:40–4:30
1. Click **Acquire Environmental Data**, then **Load data**. Point out that the unapproved blog layer is rejected.
2. Click **Validate and Prepare Data**, then **Check data**. Point out the 168 prepared cells and the 3 cells with missing species records.
3. Open **Calculate Habitat Quality**.
   > "This is the third level: six steps, each performed by one component of the Habitat Modeling Subsystem."
4. Tick **Simulate an error in step 3**, then press **Run** on each step in order:
   - **Assemble Model Inputs** produces the model input bundle and the threat-layer inventory.
   - **Configure Threat and Sensitivity Parameters** produces the approved parameter set.
   - **Execute Habitat Quality Model** produces the raw outputs and a run log.
   - **Verify Model Outputs** fails one cell and sends a **Re-run request** back to step 3: the feedback arrow on the diagram.
   - Run **Execute** again, then **Verify**, which now passes.
   - Run **Classify Habitat Risk**, then **Register Model Run**.
5. Go to **Maintain Biodiversity Risk Map**. Move *Towns* to 0.8 and press **Save settings**.
   > "That's F.4 changing a control. The results are cleared."

   Back in **Calculate Habitat Quality**, press **Run all 6 steps**. Step 2 shows the new threat percentages.
6. Go to **Screen Proposed Development Sites**, the Local Planner. Click **Use example site**, then **Screen this site**. The result comes back, along with the report in **Export Screening Reports**.

## Part 2 — Codebase to model (4:30–7:30)

1. **`docs/traceability.md`** (4:30–5:10): scroll to the Level 3 table.
   > "One row per function: function ID, module path, requirement ID, test name."
2. **The module** (5:10–6:00): open `brm/habitat_modeling/f2_3_3_invest_engine.py`.
   > "The docstring has the function ID F.2.3.3, the mechanism C.2.3.3 and its ICOMs. The signature is the ICOMs: `model_input_bundle` and `rerun_request` are inputs, the keyword-only `approved_parameter_set` is the control, and the return tuple is the two outputs."

   Then show `brm/habitat_modeling/__init__.py`. The call order there is the F.2.3 diagram, including the re-run loop.
3. **Tests** (6:00–6:40): open `tests/test_functional_requirements.py`.
   > "Tests are named after requirement IDs, for example `test_HMS_2_1_3_deterministic_model_output` and `test_HMS_1_4_4_verify_model_outputs_requests_rerun`. `test_IDEF0_code_matches_innoslate_model` fails if any code box drifts from the Innoslate ICOMs."
4. **CI** (6:40–7:00): open the GitHub Actions tab and show a green run of `tests.yml` on Python 3.10 and 3.12.
5. **`contracts/api-v1.yaml`** (7:00–7:15): one operation per F.2.3.x box, with `x-idef0-function`. Show the schemas for Model input bundle, Approved parameter set, Re-run request (the 409 response) and Model run record.
6. **`docs/route-table.md`** (7:15–7:30): the entry point `#/model/F.2.3` maps to the use case *Maintain the habitat model* (IT Development Team). `#/site` maps to *Screen a proposed development site*.

## Part 3 — Requirements in Innoslate (7:30–9:30)

1. **Ch 5 system functional requirement** (7:30–8:00): open *Biodiversity Risk Map Requirements*, section 1.4.
   > "1.4.3: The Biodiversity Risk Map shall Calculate Habitat Quality. This is the functional requirement for F.2.3 under the parent F.2."
2. **Ch 9 component specification** (8:00–8:50): open *Habitat Modeling Subsystem Requirements*.
   - Functional, 1.4.1–1.4.6: one per F.2.3.x box.
   - Input, 1.1.1–1.1.2: Habitat-model parameters from the IT Development Team; Prepared datasets from Data Preparation.
   - Output, 1.2.2–1.2.3: results to Spatial Analysis; Model run record to Explanation.
   - Interface, 1.3.1–1.3.4.
3. **Ch 8–9 flow-down** (8:50–9:30): show system requirement 2.1.2 *Site Result Response Time* (3 s p95). It is satisfied by C.2 and traced to HMS-2.1.1 *Off-Request-Path Processing*.
   > "The method is **apportionment**. The 3 s budget is split 1.5 s Spatial Analysis, 0.3 s Explanation, 1.2 s Web Map and 0 s Habitat Modeling. So the model must run in batch. The product showed this as a site answer in about 1 ms and the test `test_HMS_2_1_1_site_request_does_not_run_habitat_model`."

   Optionally add a second example: SYS-2.1.4 → HMS-2.1.3 (equivalence, ≤ 1e-6), the identical run IDs.

## Close — 9:30–10:00
> "To summarize: the Level 1 actors supply the controls; the Level 2 subsystems are our modules and pages; the Level 3 components of F.2.3 run step by step in the product. Every box has a module, a requirement and a passing test."

---

## Peer-review worksheet: our own answers (to prepare for reviewers)

| Item | Our answer |
|---|---|
| Product goal | Help a county planner screen a proposed development site for biodiversity risk, with explanation and an exportable report. It is preliminary screening, not a regulatory decision. |
| Selected function | F.2.3 Calculate Habitat Quality (C.2.3 Habitat Modeling Subsystem); parent F.2. |
| Does the product match the 2nd-level IDEF0? | Yes. The seven F.2.x functions are separate modules, `brm/service.py` wires them in the arrow order, and a test checks that every module's ICOMs equal the model's. |
| Known differences / conflicts (be upfront) | (1) **F.2.5** is split. Python builds the styled GeoJSON and the browser renders it, so C.2.5 spans two files. (2) **Dataset identifier** and **Coverage Validation Result** leave the F.2 boundary on the diagram but have no consumer box. The product shows them on the *Data* screen. (3) F.2.6 accepts the **Review request** control but does not change behaviour with it yet. (4) The browser re-implements F.2.3.x for the live demo. A parity test keeps it identical to Python. |
| Likely question | "Is the data real?" No. It is deterministic demo data shaped like the real sources. The legacy GIS pipeline (`scripts/build_risk_grid.py`) shows how the real NLCD, OSM, PAD-US and GBIF layers would feed F.2.1. |
