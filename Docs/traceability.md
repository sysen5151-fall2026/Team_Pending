# Traceability: IDEF0 function → code → requirement → test

Source model: Innoslate project **bio2** (`cloud.innoslate.com/cornell/p/913`), exported in [`model/idef0.json`](../model/idef0.json).
Requirement prefixes: **SYS-** = document *Biodiversity Risk Map Requirements* (C.2); **HMS-** = document *Habitat Modeling Subsystem Requirements* (C.2.3).
Every function listed here is decorated with `@idef0(...)` in its module. `test_IDEF0_code_matches_innoslate_model` fails if a box's mechanism or ICOMs in code differ from the model.

Selected function for the demo: **F.2.3 Calculate Habitat Quality** (parent first-level function **F.2 Assess Spatial Biodiversity Conditions**).

## Level 1 — Metafunction

| Function ID | Function | Mechanism | Module path | Requirement ID | Test name |
|---|---|---|---|---|---|
| F.2 | Assess Spatial Biodiversity Conditions | C.2 Biodiversity Risk Map | `brm/service.py::assess_spatial_biodiversity_conditions` | SYS-1.4.1 … SYS-1.4.7 | `test_SYS_1_4_3_system_calculates_habitat_quality` |

## Level 2 — F.2 decomposition

| Function ID | Function | Mechanism | Module path | Requirement ID | Test name |
|---|---|---|---|---|---|
| F.2.1 | Acquire Environmental Data | C.2.1 Data Ingestion Subsystem | `brm/f2_1_data_ingestion.py::acquire_environmental_data` | SYS-1.4.1 | `test_SYS_1_4_1_acquire_environmental_data_uses_approved_sources_only` |
| F.2.2 | Validate and Prepare Data | C.2.2 Data Preparation Subsystem | `brm/f2_2_data_preparation.py::validate_and_prepare_data` | SYS-1.4.2, SYS-2.1.5 | `test_SYS_1_4_2_validate_and_prepare_data`, `test_SYS_2_1_5_data_gap_warning` |
| F.2.3 | **Calculate Habitat Quality** | **C.2.3 Habitat Modeling Subsystem** | `brm/habitat_modeling/__init__.py::calculate_habitat_quality` | **SYS-1.4.3**, HMS-1.1.1, HMS-1.1.2, HMS-1.2.2, HMS-1.2.3 | `test_SYS_1_4_3_system_calculates_habitat_quality`, `test_HMS_1_1_1_accepts_habitat_model_parameters_from_it_team`, `test_HMS_1_1_2_accepts_prepared_datasets_from_data_preparation`, `test_HMS_1_2_2_provides_results_to_spatial_analysis`, `test_HMS_1_2_3_provides_model_run_record_to_explanation`, `test_HMS_1_3_interfaces_match_idef0_arrows` |
| F.2.4 | Summarize Site Conditions | C.2.4 Spatial Analysis Subsystem | `brm/f2_4_spatial_analysis.py::summarize_site_conditions` | SYS-1.4.4, SYS-2.1.2 | `test_SYS_1_4_4_summarize_site_conditions`, `test_HMS_2_1_1_site_request_does_not_run_habitat_model` |
| F.2.5 | Display Geographic Results | C.2.5 Web Map Subsystem | `brm/f2_5_web_map.py::display_geographic_results` + `dist/app.js` | SYS-1.4.5 | `test_SYS_1_4_5_display_geographic_results` |
| F.2.6 | Explain Results and Limitations | C.2.6 Explanation Subsystem | `brm/f2_6_explanation.py::explain_results_and_limitations` | SYS-1.4.6, SYS-2.4.5 | `test_SYS_1_4_6_explain_results_and_limitations`, `test_SYS_2_4_5_output_traceability` |
| F.2.7 | Export Screening Reports | C.2.7 Report Generation Subsystem | `brm/f2_7_report_generation.py::export_screening_reports` | SYS-1.4.7 | `test_SYS_1_4_7_export_screening_reports` |

## Level 3 — F.2.3 decomposition (component C.2.3)

| Function ID | Function | Mechanism | Module path | Requirement ID | Test name |
|---|---|---|---|---|---|
| F.2.3.1 | Assemble Model Inputs | C.2.3.1 Model Input Builder | `brm/habitat_modeling/f2_3_1_model_input_builder.py::assemble_model_inputs` | HMS-1.4.1, HMS-2.1.4 | `test_HMS_1_4_1_assemble_model_inputs`, `test_HMS_2_1_4_complete_county_coverage` |
| F.2.3.2 | Configure Threat and Sensitivity Parameters | C.2.3.2 Parameter Configuration Manager | `brm/habitat_modeling/f2_3_2_parameter_configuration_manager.py::configure_threat_and_sensitivity_parameters` | HMS-1.4.2, HMS-2.1.6, HMS-2.3.2 | `test_HMS_1_4_2_configure_threat_and_sensitivity_parameters`, `test_HMS_2_1_6_parameter_change_creates_new_parameter_set`, `test_HMS_2_3_2_parameters_are_configuration_not_code` |
| F.2.3.3 | Execute Habitat Quality Model | C.2.3.3 InVEST Habitat Quality Engine | `brm/habitat_modeling/f2_3_3_invest_engine.py::execute_habitat_quality_model` | HMS-1.4.3, HMS-2.1.2, HMS-2.1.3, HMS-2.3.1 | `test_HMS_1_4_3_execute_habitat_quality_model_equation`, `test_HMS_2_1_2_model_run_duration`, `test_HMS_2_1_3_deterministic_model_output`, `test_HMS_2_1_3_browser_engine_matches_python`, `test_HMS_2_3_1_pinned_invest_release` |
| F.2.3.4 | Verify Model Outputs | C.2.3.4 Output QA Checker | `brm/habitat_modeling/f2_3_4_output_qa_checker.py::verify_model_outputs` | HMS-1.4.4, HMS-2.1.5 | `test_HMS_1_4_4_verify_model_outputs_requests_rerun`, `test_HMS_2_1_5_output_quality_gate` |
| F.2.3.5 | Classify Habitat Risk | C.2.3.5 Risk Classifier | `brm/habitat_modeling/f2_3_5_risk_classifier.py::classify_habitat_risk` | HMS-1.4.5, HMS-1.2.2 | `test_HMS_1_4_5_classify_habitat_risk` |
| F.2.3.6 | Register Model Run | C.2.3.6 Model Run Registry | `brm/habitat_modeling/f2_3_6_model_run_registry.py::register_model_run` | HMS-1.4.6, HMS-1.2.3, HMS-2.4.2 | `test_HMS_1_4_6_register_model_run`, `test_HMS_2_4_2_model_run_record` |

## Requirement flow-down (Ch 8–9): system-wide → C.2.3

| System requirement (C.2) | Component requirement (C.2.3) | Method | How the code meets it | Test name |
|---|---|---|---|---|
| SYS-2.1.2 Site Result Response Time (3 s p95) | HMS-2.1.1 Off-Request-Path Processing | Apportionment (1.5 s Spatial Analysis + 0.3 s Explanation + 1.2 s Web Map + **0 s Habitat Modeling**) | F.2.3 runs in `scripts/run_pipeline.py`; site requests only read results | `test_HMS_2_1_1_site_request_does_not_run_habitat_model` |
| SYS-2.1.4 Reproducible Results | HMS-2.1.3 Deterministic Model Output (≤ 1e-6) | Equivalence | IDs are SHA-256 of canonical JSON; no randomness in F.2.3.x | `test_HMS_2_1_3_deterministic_model_output`, `test_HMS_2_1_3_browser_engine_matches_python` |
| SYS-2.1.1 County-wide Coverage | HMS-2.1.4 Complete County Coverage | Equivalence | QA gate checks cell count = grid | `test_HMS_2_1_4_complete_county_coverage` |
| SYS-2.4.5 Output Traceability | HMS-2.1.5 Output Quality Gate; HMS-2.4.2 Model Run Record | Synthesis | F.2.3.4 gate + F.2.3.6 record carried to every output | `test_HMS_2_1_5_output_quality_gate`, `test_SYS_2_4_5_output_traceability` |
| SYS-2.1.7 Access Control | HMS-2.1.6 Parameter Change Access Control | Equivalence | parameters only via `config/` (IT team) → new `PS-` ID | `test_HMS_2_1_6_parameter_change_creates_new_parameter_set` |
| SYS-2.3.1 Habitat Model Technology | HMS-2.3.1 Pinned InVEST Release | Equivalence | `invest_version` pinned in config, written to Run log | `test_HMS_2_3_1_pinned_invest_release` |
| SYS-2.3.2 Configurable Data Updates | HMS-2.3.2 Parameters as Configuration | Synthesis | no ecological constants in `f2_3_*.py` | `test_HMS_2_3_2_parameters_are_configuration_not_code` |

## Model ↔ code conformance

| Check | Test name |
|---|---|
| Every IDEF0 box (F.2, F.2.1–F.2.7, F.2.3.1–F.2.3.6) has a registered function with identical mechanism and ICOMs | `test_IDEF0_code_matches_innoslate_model` |
| This table lists every registered function and only real test names | `test_traceability_doc_covers_every_function_and_test` |
| `contracts/api-v1.yaml` has one operation per F.2.3.x box and a schema per internal arrow | `test_contract_covers_f23_internal_flows` |
