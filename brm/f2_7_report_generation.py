"""F.2.7 Export Screening Reports — mechanism C.2.7 Report Generation Subsystem.

IDEF0 (Level 2, diagram F.2)
    Inputs  : Site screening summary, Factor explanations and limitations
    Control : Report template (from F.3)
    Output  : Screening report -> F.5 Local Planner
Requirement : SYS-1.4.7, SYS-2.1.3, SYS-2.4.2, SYS-2.4.4
"""
from __future__ import annotations

from brm.idef0 import idef0


@idef0("F.2.7", "Export Screening Reports", "C.2.7 Report Generation Subsystem",
       inputs=["Site screening summary", "Factor explanations and limitations"],
       controls=["Report template"],
       outputs=["Screening report"],
       requirements=["SYS-1.4.7", "SYS-2.1.3", "SYS-2.4.2", "SYS-2.4.4"])
def export_screening_reports(site_screening_summary: dict, factor_explanations_and_limitations: dict, *,
                             report_template: str, generated: str = "2026-11-01") -> dict:
    s, x = site_screening_summary, factor_explanations_and_limitations
    body = report_template.split("-->", 1)[-1].lstrip()
    md = body.format(
        site_name=s["site_name"], generated=generated, run_id=x["provenance"]["run_id"],
        parameter_set_id=x["provenance"]["parameter_set_id"], cell_count=s["cell_count"],
        mean_risk=f"{s['mean_risk']:.2f}", risk_class=s["risk_class"], max_cell=s["max_cell"],
        max_risk=f"{s['max_risk']:.2f}",
        coverage_status=(f"missing for {len(s['data_gap_cells'])} cell(s)" if s["data_gap_cells"] else "complete"),
        recommendation=s["recommendation"],
        factors="\n".join(f"- {f}" for f in x["factors"]),
        sources="\n".join(f"- {t}" for t in x["sources"]),
        limitations="\n".join(f"- {t}" for t in x["limitations"]),
        disclaimer=x["disclaimer"])
    csv = "cell_id,site,mean_risk,risk_class,run_id,parameter_set_id\n" + "\n".join(
        f"{c},{s['site_name']},{s['mean_risk']},{s['risk_class']},{x['provenance']['run_id']},"
        f"{x['provenance']['parameter_set_id']}" for c in s["cell_ids"])
    return {"markdown": md, "csv": csv, "formats": ["md", "csv"], "run_id": x["provenance"]["run_id"]}
