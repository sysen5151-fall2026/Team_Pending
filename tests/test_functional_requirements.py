"""Functional-requirement tests for F.2 Assess Spatial Biodiversity Conditions.

Every test is named after the Innoslate (bio2) requirement it verifies:
    SYS-x.x.x  ->  "Biodiversity Risk Map Requirements"            (system, Ch 5 / Ch 8)
    HMS-x.x.x  ->  "Habitat Modeling Subsystem Requirements"       (component C.2.3, Ch 9)
The mapping test -> requirement -> module -> function ID is in docs/traceability.md.
Pure standard library + pytest; runs in CI via .github/workflows/tests.yml.
"""
from __future__ import annotations

import copy
import json
import math
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from brm.common import load_controls  # noqa: E402
from brm.f2_1_data_ingestion import acquire_environmental_data  # noqa: E402
from brm.f2_2_data_preparation import validate_and_prepare_data  # noqa: E402
from brm.f2_4_spatial_analysis import summarize_site_conditions  # noqa: E402
from brm.f2_6_explanation import explain_results_and_limitations  # noqa: E402
from brm.f2_7_report_generation import export_screening_reports  # noqa: E402
from brm.habitat_modeling import (ModelRunFailed, ParameterError, assemble_model_inputs,  # noqa: E402
                                  calculate_habitat_quality, classify_habitat_risk,
                                  configure_threat_and_sensitivity_parameters,
                                  execute_habitat_quality_model, register_model_run, verify_model_outputs)
from brm.idef0 import REGISTRY, get_trace, load_all_modules, load_model, reset_trace  # noqa: E402
from scripts import run_pipeline  # noqa: E402

load_all_modules()


# ----------------------------------------------------------------------------- fixtures
@pytest.fixture(scope="module")
def controls():
    return load_controls()


@pytest.fixture(scope="module")
def raw():
    return run_pipeline.load_raw()


@pytest.fixture(scope="module")
def prepared(raw, controls):
    acq, ds_id = acquire_environmental_data(raw, {"area_id": "Tompkins County, NY", "needed_sources": run_pipeline.NEEDED},
                                            approved_source_list=controls["approved_source_list"])
    return validate_and_prepare_data(acq, ds_id, data_quality_criteria=controls["data_quality_criteria"])


@pytest.fixture(scope="module")
def batch(prepared, controls):
    return calculate_habitat_quality(prepared[0], habitat_model_parameters=controls["habitat_model_parameters"])


@pytest.fixture(scope="module")
def full_run():
    return run_pipeline.run()


# ============================================================================ SYSTEM (C.2)
def test_SYS_1_4_1_acquire_environmental_data_uses_approved_sources_only(raw, controls):
    acq, ds_id = acquire_environmental_data(raw, {"area_id": "t", "needed_sources": run_pipeline.NEEDED},
                                            approved_source_list=controls["approved_source_list"])
    assert "SCRAPED-BLOG-LAYER" in {r["source_id"] for r in acq["rejected_sources"]}
    assert set(acq["datasets"]) == set(run_pipeline.NEEDED) and not acq["missing_sources"]
    assert re.fullmatch(r"DS-[0-9a-f]{8}", ds_id)


def test_SYS_1_4_2_validate_and_prepare_data(prepared):
    data, report, coverage = prepared
    assert data["crs"] == "EPSG:26918" and coverage["status"] == "COMPLETE"
    assert all(0 <= c["dist_road_km"] for c in data["cells"])


def test_SYS_1_4_3_system_calculates_habitat_quality(full_run):
    res = full_run["_internal"]["habitat_quality_and_degradation_results"]
    assert len(res["cells"]) == 168
    assert all(0.0 <= c["habitat_quality"] <= 1.0 for c in res["cells"])


def test_SYS_1_4_4_summarize_site_conditions(full_run):
    s = full_run["site_screening_summary"]
    assert s["cell_count"] == 4 and s["max_risk"] >= s["mean_risk"] and s["recommendation"]


def test_SYS_1_4_5_display_geographic_results(full_run):
    m = full_run["displayed_risk_map_and_legend"]
    assert m["type"] == "FeatureCollection" and len(m["legend"]) == 5
    assert {f["properties"]["fill"] for f in m["features"]} <= {x["color"] for x in m["legend"]}
    assert full_run["habitat_quality_map"]["metadata"]["layer"] == "habitat_quality"


def test_SYS_1_4_6_explain_results_and_limitations(full_run):
    x = full_run["factor_explanations_and_limitations"]
    assert x["factors"] and x["limitations"] and "not a regulatory determination" in x["disclaimer"]


def test_SYS_1_4_7_export_screening_reports(full_run):
    r = full_run["screening_report"]
    assert r["markdown"].startswith("# Biodiversity Screening Report") and r["csv"].count("\n") == 4


def test_SYS_2_1_5_data_gap_warning(prepared, batch, controls):
    data, report, _ = prepared
    assert report["data_gap_cells"] == ["R01-C14", "R07-C13", "R12-C04"] and report["data_gap_warning"]
    s = summarize_site_conditions(data, batch[0], {}, site_selection={"cell_ids": ["R07-C13", "R07-C14"]},
                                  site_summary_rules=controls["site_summary_rules"])
    x = explain_results_and_limitations(s, report, batch[1], interpretation_rules=controls["interpretation_rules"])
    assert s["data_gap_cells"] == ["R07-C13"] and x["limitations"][0].startswith("Missing species records")


def test_SYS_2_4_5_output_traceability(full_run):
    rec = full_run["_internal"]["model_run_record"]
    meta = full_run["displayed_risk_map_and_legend"]["metadata"]
    prov = full_run["factor_explanations_and_limitations"]["provenance"]
    for obj in (meta, prov):
        assert obj["run_id"] == rec["run_id"] and obj["parameter_set_id"] == rec["parameter_set_id"]
    assert rec["run_id"] in full_run["screening_report"]["markdown"]


# ============================================================ COMPONENT C.2.3 — input / output / interface
def test_HMS_1_1_1_accepts_habitat_model_parameters_from_it_team(controls):
    p = controls["habitat_model_parameters"]
    assert "F.4" in p["_idef0"] and "C.4 IT Development Team" in p["_idef0"]


def test_HMS_1_1_2_accepts_prepared_datasets_from_data_preparation(prepared, controls):
    out, rec = calculate_habitat_quality(prepared[0], habitat_model_parameters=controls["habitat_model_parameters"])
    assert rec["dataset_id"] == prepared[0]["dataset_id"]


def test_HMS_1_2_2_provides_results_to_spatial_analysis(prepared, batch, controls):
    s = summarize_site_conditions(prepared[0], batch[0], {}, site_selection={"cell_ids": ["R01-C01"]},
                                  site_summary_rules=controls["site_summary_rules"])
    assert s["run_id"] == batch[1]["run_id"]


def test_HMS_1_2_3_provides_model_run_record_to_explanation(full_run):
    assert full_run["factor_explanations_and_limitations"]["provenance"]["qa"] == "PASS"


def test_HMS_1_3_interfaces_match_idef0_arrows():
    """HMS-1.3.1..1.3.4: the C.2.3 interfaces are exactly the F.2 arrows into/out of F.2.3."""
    l2 = {f["id"]: f for f in load_model()["level2"]["functions"]}
    f23 = l2["F.2.3"]
    assert "Prepared datasets" in l2["F.2.2"]["outputs"] and "Prepared datasets" in f23["inputs"]          # 1.3.1
    assert "Habitat-quality and degradation results" in l2["F.2.4"]["inputs"]                               # 1.3.2
    assert "Habitat-quality and degradation results" in l2["F.2.5"]["inputs"]                               # 1.3.3
    assert "Model run record" in l2["F.2.6"]["inputs"]                                                      # 1.3.4


# ============================================================ COMPONENT C.2.3 — functions F.2.3.1 .. F.2.3.6
def test_HMS_1_4_1_assemble_model_inputs(prepared):
    bundle, inv = assemble_model_inputs(prepared[0])
    assert inv["threats"] == ["agriculture", "road", "urban"] and inv["cell_count"] == len(bundle["cells"]) == 168
    assert {c["accessibility"] for c in bundle["cells"]} <= {0.3, 1.0}


def test_HMS_1_4_2_configure_threat_and_sensitivity_parameters(prepared, controls):
    _, inv = assemble_model_inputs(prepared[0])
    ps = configure_threat_and_sensitivity_parameters(inv, habitat_model_parameters=controls["habitat_model_parameters"])
    assert abs(sum(t["weight_norm"] for t in ps["threats"].values()) - 1) < 1e-12
    bad = copy.deepcopy(controls["habitat_model_parameters"])
    del bad["sensitivity"]["Wetland"]
    with pytest.raises(ParameterError):
        configure_threat_and_sensitivity_parameters(inv, habitat_model_parameters=bad)


def test_HMS_1_4_3_execute_habitat_quality_model_equation(controls):
    inv = {"threats": ["road"], "land_cover_classes": ["Forest"], "cell_count": 1}
    ps = configure_threat_and_sensitivity_parameters(inv, habitat_model_parameters=controls["habitat_model_parameters"])
    bundle = {"bundle_id": "MB-x", "dataset_id": "DS-x", "cells": [
        {"cell_id": "A", "land_cover": "Forest", "accessibility": 1.0, "threat_distance_km": {"road": 0.0}}]}
    raw, log = execute_habitat_quality_model(bundle, approved_parameter_set=ps)
    d = 1.0 * 1.0 * 1.0 * controls["habitat_model_parameters"]["sensitivity"]["Forest"]["road"]
    z, k = ps["z"], ps["k"]
    assert math.isclose(raw["cells"][0]["habitat_quality"], 1.0 * (1 - d ** z / (d ** z + k ** z)), abs_tol=1e-6)
    assert log["engine"].endswith(ps["invest_version"])


def test_HMS_1_4_4_verify_model_outputs_requests_rerun():
    raw = {"bundle_id": "b", "parameter_set_id": "p", "attempt": 1,
           "cells": [{"cell_id": "A", "habitat_quality": float("nan"), "degradation": 0.1}]}
    verified, qa, rerun = verify_model_outputs(raw, expected_cells=1)
    assert verified is None and qa["status"] == "FAIL" and rerun["attempt"] == 1


def test_HMS_1_4_5_classify_habitat_risk():
    out = classify_habitat_risk({"bundle_id": "b", "parameter_set_id": "p", "cells": [
        {"cell_id": str(q), "habitat_quality": q} for q in (0.05, 0.3, 0.5, 0.7, 0.95)]})
    assert [c["risk_class"] for c in out["cells"]] == ["Very high", "High", "Moderate", "Low", "Very low"]


def test_HMS_1_4_6_register_model_run(prepared, controls):
    _, rec = calculate_habitat_quality(prepared[0], habitat_model_parameters=controls["habitat_model_parameters"],
                                       fault_injection={"attempts": 1})
    assert rec["attempts"] == 2 and [h["qa"] for h in rec["history"]] == ["FAIL", "PASS"]
    assert register_model_run([{"dataset_id": "d", "bundle_id": "b", "parameter_set_id": "p", "engine": "e", "attempt": 1,
                                "rerun_reason": None, "duration_ms": 1, "cells_processed": 1}],
                              [{"status": "PASS"}])["run_id"].startswith("RUN-")


# ============================================================ COMPONENT C.2.3 — system-wide (flow-down)
def test_HMS_2_1_1_site_request_does_not_run_habitat_model(prepared, batch, controls):
    """Apportionment of SYS-2.1.2 (3 s): Spatial Analysis budget 1.5 s, Habitat Modeling 0 s on the request path."""
    reset_trace()
    t0 = time.perf_counter()
    summarize_site_conditions(prepared[0], batch[0], {}, site_selection={"cell_ids": [c["cell_id"] for c in prepared[0]["cells"]]},
                              site_summary_rules=controls["site_summary_rules"])
    assert time.perf_counter() - t0 < 1.5
    assert not any(t["function_id"].startswith("F.2.3") for t in get_trace())


def test_HMS_2_1_2_model_run_duration(prepared, controls):
    t0 = time.perf_counter()
    calculate_habitat_quality(prepared[0], habitat_model_parameters=controls["habitat_model_parameters"])
    assert time.perf_counter() - t0 < 30 * 60


def test_HMS_2_1_3_deterministic_model_output(prepared, controls, batch):
    again, rec = calculate_habitat_quality(prepared[0], habitat_model_parameters=controls["habitat_model_parameters"])
    a = {c["cell_id"]: c["habitat_quality"] for c in batch[0]["cells"]}
    assert max(abs(c["habitat_quality"] - a[c["cell_id"]]) for c in again["cells"]) <= 1e-6
    assert rec["run_id"] == batch[1]["run_id"]


def test_HMS_2_1_4_complete_county_coverage(batch, prepared):
    assert len(batch[0]["cells"]) == prepared[2]["grid_cells"] == 168


def test_HMS_2_1_5_output_quality_gate(prepared, controls):
    with pytest.raises(ModelRunFailed):
        calculate_habitat_quality(prepared[0], habitat_model_parameters=controls["habitat_model_parameters"],
                                  fault_injection={"attempts": 99})


def test_HMS_2_1_6_parameter_change_creates_new_parameter_set(prepared, controls, batch):
    p = copy.deepcopy(controls["habitat_model_parameters"])
    p["threats"]["urban"]["weight"] = 0.6
    out, rec = calculate_habitat_quality(prepared[0], habitat_model_parameters=p)
    assert rec["parameter_set_id"] != batch[1]["parameter_set_id"] and rec["run_id"] != batch[1]["run_id"]


def test_HMS_2_3_1_pinned_invest_release(controls):
    assert re.fullmatch(r"\d+\.\d+\.\d+", controls["habitat_model_parameters"]["invest_version"])


def test_HMS_2_3_2_parameters_are_configuration_not_code(prepared, controls, batch):
    src = "".join(p.read_text() for p in (ROOT / "brm" / "habitat_modeling").glob("f2_3_*.py"))
    assert "weight\": 0." not in src and "Forest" not in src
    p = copy.deepcopy(controls["habitat_model_parameters"])
    p["habitat_suitability"]["Forest"] = 0.5
    out, _ = calculate_habitat_quality(prepared[0], habitat_model_parameters=p)
    assert out["cells"] != batch[0]["cells"]


def test_HMS_2_4_2_model_run_record(batch):
    rec = batch[1]
    for key in ("run_id", "dataset_id", "bundle_id", "parameter_set_id", "engine", "attempts", "final_qa", "history"):
        assert key in rec


# ============================================================ model <-> code conformance (Codebase to model)
def test_IDEF0_code_matches_innoslate_model():
    m = load_model()
    boxes = [f for f in m["level1"]["functions"] if f["id"] == "F.2"] + m["level2"]["functions"] + m["level3"]["functions"]
    for f in boxes:
        reg = REGISTRY[f["id"]]
        assert reg["mechanism"] == f["mechanism"], f["id"]
        for k in ("inputs", "controls", "outputs"):
            assert reg[k] == f.get(k, []), (f["id"], k)


def test_traceability_doc_covers_every_function_and_test():
    doc = (ROOT / "docs" / "traceability.md").read_text()
    names = {n for n in globals() if n.startswith("test_")}
    for fid in list(REGISTRY):
        assert f"| {fid} " in doc, fid
    for t in re.findall(r"`(test_[A-Za-z0-9_]+)`", doc):
        assert t in names, t


def test_contract_covers_f23_internal_flows():
    y = (ROOT / "contracts" / "api-v1.yaml").read_text()
    for fid in ("F.2.3.1", "F.2.3.2", "F.2.3.3", "F.2.3.4", "F.2.3.5", "F.2.3.6"):
        assert f"x-idef0-function: {fid}" in y
    for flow in ("Model input bundle", "Threat-layer inventory", "Approved parameter set", "Raw model outputs",
                 "Run log", "Verified habitat rasters", "QA result", "Re-run request", "Model run record"):
        assert flow in y, flow


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_HMS_2_1_3_browser_engine_matches_python(tmp_path):
    run_pipeline.main()
    script = tmp_path / "parity.js"
    script.write_text("""
global.performance=require('perf_hooks').performance;require(process.argv[2]+'/dist/brm-engine.js');
const fs=require('fs'),D=process.argv[2]+'/dist/data/';
const prep=JSON.parse(fs.readFileSync(D+'prepared_datasets.json')),hmp=JSON.parse(fs.readFileSync(D+'config/habitat_model_parameters.json'));
const grid=JSON.parse(fs.readFileSync(D+'risk_grid.geojson')),rec=JSON.parse(fs.readFileSync(D+'model_run_record.json'));
const J=f=>JSON.parse(fs.readFileSync(D+f));const raw={};J('raw/index.json').forEach(f=>{const d=J('raw/'+f);raw[d.source_id]=d;});
const need=["TIGER-BOUNDARY","USGS-NLCD-LANDCOVER","OSM-ROADS","NLCD-DEVELOPED","NLCD-CULTIVATED","USGS-PADUS","GBIF-OCCURRENCES"];
const [acq,ds]=BRM.acquireEnvironmentalData(raw,{area_id:'Tompkins County, NY',needed_sources:need},{approvedSourceList:J('config/approved_source_list.json')});
const [p2]=BRM.validateAndPrepareData(acq,ds,{dataQualityCriteria:J('config/data_quality_criteria.json')});
if(JSON.stringify(p2)!==JSON.stringify(prep)){console.log(JSON.stringify({js:'prep-mismatch',py:'',m:1}));process.exit(0);}
BRM.calculateHabitatQuality(p2,{habitatModelParameters:hmp}).then(o=>{const py=Object.fromEntries(grid.features.map(f=>[f.properties.cell_id,f.properties.habitat_quality]));
let m=0;o.results.cells.forEach(c=>m=Math.max(m,Math.abs(c.habitat_quality-py[c.cell_id])));console.log(JSON.stringify({js:o.record.run_id,py:rec.run_id,m}));});""")
    out = json.loads(subprocess.check_output(["node", str(script), str(ROOT)], text=True))
    assert out["js"] == out["py"] and out["m"] <= 1e-6
