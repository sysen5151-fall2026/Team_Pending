"""F.2.6 Explain Results and Limitations — mechanism C.2.6 Explanation Subsystem.

IDEF0 (Level 2, diagram F.2)
    Inputs  : Site screening summary, Data-quality report, Model run record
    Controls: Interpretation rules (from F.3), Review request (from F.3)
    Output  : Factor explanations and limitations -> F.2.7, F.3
Requirement : SYS-1.4.6, SYS-2.1.5, SYS-2.4.4, SYS-2.4.5
"""
from __future__ import annotations

from brm.idef0 import idef0

THREAT_LABEL = {"road": "Road pressure", "urban": "Development pressure", "agriculture": "Farmland pressure"}


@idef0("F.2.6", "Explain Results and Limitations", "C.2.6 Explanation Subsystem",
       inputs=["Site screening summary", "Data-quality report", "Model run record"],
       controls=["Interpretation rules", "Review request"],
       outputs=["Factor explanations and limitations"],
       requirements=["SYS-1.4.6", "SYS-2.1.5", "SYS-2.4.4", "SYS-2.4.5"])
def explain_results_and_limitations(site_screening_summary: dict, data_quality_report: dict,
                                    model_run_record: dict, *, interpretation_rules: dict,
                                    review_request: dict | None = None) -> dict:
    s = site_screening_summary
    ranked = sorted(s["mean_threat_impact"].items(), key=lambda kv: -kv[1])
    factors = [f"Average habitat quality is {s['mean_habitat_quality']:.2f} on a 0-1 scale (1 = intact habitat) and average "
               f"degradation is {s['mean_degradation']:.2f} (0 = no threat pressure), across {s['cell_count']} cell(s) of "
               f"{', '.join(s['land_cover']).lower()}."]
    factors += [f"{THREAT_LABEL[t]}: {v:.2f} on a 0-1 scale (1 = the threat is right at the cell, 0 = out of reach)."
                for t, v in ranked if v > 0]
    if not any(v > 0 for _, v in ranked):
        factors.append("No modelled threat reaches the selected cells.")
    limitations = list(interpretation_rules["limitations"])
    gaps = [c for c in s["data_gap_cells"]]
    if gaps:
        limitations.insert(0, f"Missing species records for {', '.join(gaps)}: the biodiversity value of these cells "
                              f"may be under-estimated.")
    if model_run_record["attempts"] > 1:
        limitations.append(f"The habitat model passed its quality check after {model_run_record['attempts']} attempts.")
    return {"factors": factors, "limitations": limitations, "disclaimer": interpretation_rules["disclaimer"],
            "provenance": {"run_id": model_run_record["run_id"], "dataset_id": model_run_record["dataset_id"],
                           "parameter_set_id": model_run_record["parameter_set_id"],
                           "engine": model_run_record["engine"], "qa": model_run_record["final_qa"]},
            "sources": [m["title"] for m in data_quality_report["sources"]],
            "review_request": review_request, "rules_version": interpretation_rules["version"]}
