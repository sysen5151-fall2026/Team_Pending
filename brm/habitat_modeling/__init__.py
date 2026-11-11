"""F.2.3 Calculate Habitat Quality — mechanism C.2.3 Habitat Modeling Subsystem.

IDEF0 (Level 2, diagram F.2)
    Input   : Prepared datasets                         (from F.2.2)
    Control : Habitat-model parameters                  (from F.4 IT Development Team)
    Outputs : Habitat-quality and degradation results   -> F.2.4, F.2.5
              Model run record                          -> F.2.6
Requirement : SYS-1.4.3 (parent function), HMS-1.1.1, HMS-1.1.2, HMS-1.2.2, HMS-1.2.3

Level-3 decomposition (diagram F.2.3) — the call order below *is* the diagram:

    Prepared datasets ─► F.2.3.1 ─► Threat-layer inventory ─► F.2.3.2 ─► Approved parameter set (control)
                           └──────► Model input bundle ───────────────► F.2.3.3 ─► Raw model outputs ─► F.2.3.4
                                                     Re-run request ◄───────────────────────────────────┘ │
                     F.2.3.6 ◄─ Run log (F.2.3.3) + QA result (F.2.3.4)        Verified habitat rasters ─► F.2.3.5
"""
from __future__ import annotations

from brm.habitat_modeling.f2_3_1_model_input_builder import assemble_model_inputs
from brm.habitat_modeling.f2_3_2_parameter_configuration_manager import (
    ParameterError, configure_threat_and_sensitivity_parameters)
from brm.habitat_modeling.f2_3_3_invest_engine import execute_habitat_quality_model
from brm.habitat_modeling.f2_3_4_output_qa_checker import verify_model_outputs
from brm.habitat_modeling.f2_3_5_risk_classifier import classify_habitat_risk
from brm.habitat_modeling.f2_3_6_model_run_registry import register_model_run
from brm.idef0 import idef0

MAX_ATTEMPTS = 3


class ModelRunFailed(RuntimeError):
    pass


@idef0("F.2.3", "Calculate Habitat Quality", "C.2.3 Habitat Modeling Subsystem",
       inputs=["Prepared datasets"], controls=["Habitat-model parameters"],
       outputs=["Habitat-quality and degradation results", "Model run record"],
       requirements=["SYS-1.4.3", "HMS-1.1.1", "HMS-1.1.2", "HMS-1.2.2", "HMS-1.2.3"])
def calculate_habitat_quality(prepared_datasets: dict, *, habitat_model_parameters: dict,
                              fault_injection: dict | None = None) -> tuple[dict, dict]:
    model_input_bundle, threat_layer_inventory = assemble_model_inputs(prepared_datasets)       # F.2.3.1
    approved_parameter_set = configure_threat_and_sensitivity_parameters(                     # F.2.3.2
        threat_layer_inventory, habitat_model_parameters=habitat_model_parameters)
    run_logs, qa_results, rerun_request = [], [], None
    for _ in range(MAX_ATTEMPTS):
        raw_model_outputs, run_log = execute_habitat_quality_model(                           # F.2.3.3
            model_input_bundle, rerun_request, approved_parameter_set=approved_parameter_set,
            fault_injection=fault_injection)
        verified, qa_result, rerun_request = verify_model_outputs(                            # F.2.3.4
            raw_model_outputs, expected_cells=threat_layer_inventory["cell_count"])
        run_logs.append(run_log)
        qa_results.append(qa_result)
        if rerun_request is None:
            break
    model_run_record = register_model_run(run_logs, qa_results)                              # F.2.3.6
    if verified is None:
        raise ModelRunFailed(model_run_record)
    results = classify_habitat_risk(verified, risk_classes=approved_parameter_set["risk_classes"])  # F.2.3.5
    results["run_id"] = model_run_record["run_id"]
    return results, model_run_record


__all__ = ["calculate_habitat_quality", "assemble_model_inputs",
           "configure_threat_and_sensitivity_parameters", "execute_habitat_quality_model",
           "verify_model_outputs", "classify_habitat_risk", "register_model_run",
           "ParameterError", "ModelRunFailed"]
