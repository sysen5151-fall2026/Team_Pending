"""Run F.2 end-to-end (offline batch, HMS-2.1.1) and publish results for the web app.

    python scripts/run_pipeline.py            # writes dist/data/* and data/processed/*

Reads : data/raw/*.json (Environmental datasets) and config/* (controls)
Writes: dist/data/risk_grid.geojson            Displayed risk map and legend (F.2.5)
        dist/data/habitat_quality_map.geojson  Habitat-quality map (F.2.5 -> F.1)
        dist/data/prepared_datasets.json       Prepared datasets (F.2.2 -> F.2.3, re-run live in the browser)
        dist/data/model_run_record.json        Model run record (F.2.3.6)
        dist/data/data_quality_report.json     Data-quality report + coverage (F.2.2)
        dist/data/idef0.json                   Innoslate model + code registry + last trace
        dist/data/config/*.json                Controls, so the browser uses the same parameters
        data/processed/sample_screening_report.md
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from brm.common import load_controls  # noqa: E402
from brm.idef0 import REGISTRY, get_trace, load_model, reset_trace  # noqa: E402
from brm.service import assess_spatial_biodiversity_conditions  # noqa: E402

NEEDED = ["TIGER-BOUNDARY", "USGS-NLCD-LANDCOVER", "OSM-ROADS", "NLCD-DEVELOPED", "NLCD-CULTIVATED",
          "USGS-PADUS", "GBIF-OCCURRENCES"]
DEMO_SITE = {"name": "Proposed Route 13 commercial site", "cell_ids": ["R05-C08", "R05-C09", "R06-C08", "R06-C09"]}


def load_raw() -> dict:
    out = {}
    for p in sorted((ROOT / "data" / "raw").glob("*.json")):
        d = json.loads(p.read_text())
        out[d["source_id"]] = d
    return out


def run(fault_injection=None) -> dict:
    reset_trace()
    return assess_spatial_biodiversity_conditions(
        load_raw(), {"area_id": "Tompkins County, NY", "needed_sources": NEEDED},
        {"layer": "risk", "requested_by": "F.5 Local Planner"},
        controls=load_controls(), site_selection=DEMO_SITE, fault_injection=fault_injection)


def main() -> None:
    out = run()
    trace = get_trace()
    i = out["_internal"]
    dist = ROOT / "dist" / "data"
    (dist / "config").mkdir(parents=True, exist_ok=True)
    w = lambda name, obj: (dist / name).write_text(json.dumps(obj, indent=1))
    w("risk_grid.geojson", out["displayed_risk_map_and_legend"])
    w("habitat_quality_map.geojson", out["habitat_quality_map"])
    w("prepared_datasets.json", i["prepared_datasets"])
    w("model_run_record.json", i["model_run_record"])
    w("data_quality_report.json", {"data_quality_report": i["data_quality_report"],
                                   "coverage_validation_result": i["coverage_validation_result"],
                                   "acquired_metadata": i["acquired_metadata"],
                                   "dataset_identifier": i["dataset_identifier"]})
    w("sample_site.json", {"site_selection": DEMO_SITE, "site_screening_summary": out["site_screening_summary"],
                           "factor_explanations_and_limitations": out["factor_explanations_and_limitations"],
                           "screening_report": out["screening_report"]})
    model = load_model()
    model["code_registry"] = REGISTRY
    model["last_batch_trace"] = trace
    w("idef0.json", model)
    for f in (ROOT / "config").iterdir():
        shutil.copy(f, dist / "config" / f.name)
    raw_out = dist / "raw"            # Environmental datasets, so the browser can run F.2.1 itself
    raw_out.mkdir(exist_ok=True)
    for f in (ROOT / "data" / "raw").glob("*.json"):
        shutil.copy(f, raw_out / f.name)
    (raw_out / "index.json").write_text(json.dumps(sorted(f.name for f in (ROOT / "data" / "raw").glob("*.json"))))
    proc = ROOT / "data" / "processed"
    proc.mkdir(parents=True, exist_ok=True)
    (proc / "sample_screening_report.md").write_text(out["screening_report"]["markdown"])
    (proc / "prepared_datasets.json").write_text(json.dumps(i["prepared_datasets"]))
    r = i["model_run_record"]
    print(f"{r['run_id']}  dataset={r['dataset_id']}  params={r['parameter_set_id']}  "
          f"cells={r['cells']}  QA={r['final_qa']}")
    print("classes:", i["habitat_quality_and_degradation_results"]["class_counts"])
    print("trace:", " -> ".join(t["function_id"] for t in trace))


if __name__ == "__main__":
    main()
