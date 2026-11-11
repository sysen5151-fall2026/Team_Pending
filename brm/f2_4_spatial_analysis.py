"""F.2.4 Summarize Site Conditions — mechanism C.2.4 Spatial Analysis Subsystem.

IDEF0 (Level 2, diagram F.2)
    Inputs  : Prepared datasets, Habitat-quality and degradation results, Planning area and layer selection
    Controls: Site selection (from F.5 Local Planner), Site-summary rules
    Output  : Site screening summary -> F.2.5, F.2.6, F.2.7
Requirement : SYS-1.4.4, SYS-2.1.2
"""
from __future__ import annotations

from brm.habitat_modeling.f2_3_5_risk_classifier import risk_class
from brm.idef0 import idef0


@idef0("F.2.4", "Summarize Site Conditions", "C.2.4 Spatial Analysis Subsystem",
       inputs=["Prepared datasets", "Habitat-quality and degradation results", "Planning area and layer selection"],
       controls=["Site selection", "Site-summary rules"],
       outputs=["Site screening summary"],
       requirements=["SYS-1.4.4", "SYS-2.1.2"])
def summarize_site_conditions(prepared_datasets: dict, habitat_quality_and_degradation_results: dict,
                              planning_area_and_layer_selection: dict, *, site_selection: dict,
                              site_summary_rules: dict) -> dict:
    prepared = {c["cell_id"]: c for c in prepared_datasets["cells"]}
    results = {c["cell_id"]: c for c in habitat_quality_and_degradation_results["cells"]}
    ids = [i for i in site_selection["cell_ids"] if i in results]
    if not ids:
        raise ValueError("site selection contains no screened cells")
    rows = [dict(results[i], species_count=prepared[i].get("species_count"),
                 protected=prepared[i]["protected"]) for i in ids]
    mean = sum(r["risk_score"] for r in rows) / len(rows)
    top = max(rows, key=lambda r: r["risk_score"])
    threats = {t: round(sum(r["threat_impact"][t] for r in rows) / len(rows), 4) for t in top["threat_impact"]}
    rec = next(x["text"] for x in sorted(site_summary_rules["recommendations"], key=lambda x: -x["min"])
               if top["risk_score"] >= x["min"])
    return {"site_name": site_selection.get("name", "Selected site"), "cell_ids": ids,
            "layer": planning_area_and_layer_selection.get("layer", "risk"),
            "cell_count": len(rows), "mean_risk": round(mean, 4), "risk_class": risk_class(mean),
            "max_cell": top["cell_id"], "max_risk": top["risk_score"],
            "cells_over_threshold": sum(r["risk_score"] >= site_summary_rules["review_threshold"] for r in rows),
            "mean_habitat_quality": round(sum(r["habitat_quality"] for r in rows) / len(rows), 4),
            "mean_degradation": round(sum(r["degradation"] for r in rows) / len(rows), 4),
            "mean_threat_impact": threats,
            "land_cover": sorted({r["land_cover"] for r in rows}),
            "species_count": sum(r["species_count"] or 0 for r in rows),
            "data_gap_cells": [r["cell_id"] for r in rows if r["species_count"] is None],
            "recommendation": rec, "run_id": habitat_quality_and_degradation_results.get("run_id"),
            "parameter_set_id": habitat_quality_and_degradation_results["parameter_set_id"],
            "rules_version": site_summary_rules["version"]}
