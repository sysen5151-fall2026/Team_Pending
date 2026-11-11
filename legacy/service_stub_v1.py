"""biodiversity_risk_map_service -- the mechanism of 1.1.

Not a function on the IDEF0, so it has no ICOM row. It calls 1.1.1 through
1.1.7 in the order the model's data flows require.
"""
from data_acquisition import acquire_environmental_data
from data_validation import validate_and_prepare_data
from habitat_quality import calculate_habitat_quality
from site_summary import summarize_site_conditions
from geographic_display import display_geographic_results
from results_explanation import explain_results_and_limitations
from report_export import export_screening_report


def assess_spatial_biodiversity_conditions(
    environmental_datasets, site_selection, *, controls: dict
):
    """1.1 in: environmental_datasets, site_selection.
    controls: the control inputs shown on the 1.1.x diagram.
    out: (habitat_quality_map, screening_report)."""
    acquired = acquire_environmental_data(
        environmental_datasets, approved_source_list=controls["approved_source_list"]
    )
    prepared, dq_report = validate_and_prepare_data(
        acquired, data_quality_criteria=controls["data_quality_criteria"]
    )
    habitat = calculate_habitat_quality(
        prepared, habitat_model_parameters=controls["habitat_model_parameters"]
    )
    summary = summarize_site_conditions(
        prepared, habitat, site_selection,
        site_summary_rules=controls["site_summary_rules"],
    )
    habitat_map = display_geographic_results(
        prepared, habitat, summary, map_display_rules=controls["map_display_rules"]
    )
    explanations = explain_results_and_limitations(
        dq_report, summary, interpretation_rules=controls["interpretation_rules"]
    )
    report = export_screening_report(
        summary, explanations, report_template=controls["report_template"]
    )
    return habitat_map, report
