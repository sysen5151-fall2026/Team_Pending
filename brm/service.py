"""F.2 Assess Spatial Biodiversity Conditions — mechanism C.2 Biodiversity Risk Map.

Level-1 box (Metafunction IDEF0).  This orchestrator wires the seven Level-2
functions exactly as the arrows on the F.2 IDEF0 diagram do.

    Inputs  : Environmental datasets, Planning area and data needs, Map request, Review request
    Controls: Approved source list, Data-quality criteria, Habitat-model parameters, Site selection,
              Site-summary rules, Map-display rules, Interpretation rules, Report template
    Outputs : Displayed risk map and legend, Habitat-quality map, Site screening summary,
              Factor explanations and limitations, Screening report
"""
from __future__ import annotations

from brm.f2_1_data_ingestion import acquire_environmental_data
from brm.f2_2_data_preparation import validate_and_prepare_data
from brm.f2_4_spatial_analysis import summarize_site_conditions
from brm.f2_5_web_map import display_geographic_results
from brm.f2_6_explanation import explain_results_and_limitations
from brm.f2_7_report_generation import export_screening_reports
from brm.habitat_modeling import calculate_habitat_quality
from brm.idef0 import idef0


@idef0("F.2", "Assess Spatial Biodiversity Conditions", "C.2 Biodiversity Risk Map",
       inputs=["Environmental datasets", "Planning area and data needs", "Map request", "Review request"],
       controls=["Approved source list", "Data-quality criteria", "Habitat-model parameters", "Site selection",
                 "Site-summary rules", "Map-display rules", "Interpretation rules", "Report template"],
       outputs=["Displayed risk map and legend", "Habitat-quality map", "Site screening summary",
                "Factor explanations and limitations", "Screening report"],
       requirements=["SYS-1.4.1", "SYS-1.4.2", "SYS-1.4.3", "SYS-1.4.4", "SYS-1.4.5", "SYS-1.4.6", "SYS-1.4.7"])
def assess_spatial_biodiversity_conditions(environmental_datasets: dict, planning_area_and_data_needs: dict,
                                           map_request: dict, review_request: dict | None = None, *,
                                           controls: dict, site_selection: dict,
                                           fault_injection: dict | None = None) -> dict:
    acquired, dataset_id = acquire_environmental_data(                                         # F.2.1
        environmental_datasets, planning_area_and_data_needs,
        approved_source_list=controls["approved_source_list"])
    prepared, dq_report, coverage = validate_and_prepare_data(                                 # F.2.2
        acquired, dataset_id, data_quality_criteria=controls["data_quality_criteria"])
    hq_results, run_record = calculate_habitat_quality(                                        # F.2.3
        prepared, habitat_model_parameters=controls["habitat_model_parameters"],
        fault_injection=fault_injection)
    layer_sel = {"area_id": planning_area_and_data_needs["area_id"], "layer": map_request.get("layer", "risk")}
    summary = summarize_site_conditions(                                                       # F.2.4
        prepared, hq_results, layer_sel, site_selection=site_selection,
        site_summary_rules=controls["site_summary_rules"])
    risk_map, hq_map = display_geographic_results(                                             # F.2.5
        prepared, hq_results, summary, layer_sel, map_request,
        map_display_rules=controls["map_display_rules"])
    explanation = explain_results_and_limitations(                                             # F.2.6
        summary, dq_report, run_record, interpretation_rules=controls["interpretation_rules"],
        review_request=review_request)
    report = export_screening_reports(                                                         # F.2.7
        summary, explanation, report_template=controls["report_template"])
    return {"displayed_risk_map_and_legend": risk_map, "habitat_quality_map": hq_map,
            "site_screening_summary": summary, "factor_explanations_and_limitations": explanation,
            "screening_report": report,
            # internal flows kept for traceability / the web trace view
            "_internal": {"acquired_metadata": {k: v for k, v in acquired.items() if k != "datasets"},
                          "dataset_identifier": dataset_id, "prepared_datasets": prepared,
                          "data_quality_report": dq_report, "coverage_validation_result": coverage,
                          "habitat_quality_and_degradation_results": hq_results,
                          "model_run_record": run_record}}
