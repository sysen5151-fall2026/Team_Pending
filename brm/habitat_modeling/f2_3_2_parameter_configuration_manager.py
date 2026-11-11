"""F.2.3.2 Configure Threat and Sensitivity Parameters — mechanism C.2.3.2 Parameter Configuration Manager.

IDEF0 (Level 3, diagram F.2.3)
    Input   : Threat-layer inventory       (from F.2.3.1)
    Control : Habitat-model parameters     (from F.4 / C.4 IT Development Team, config/habitat_model_parameters.json)
    Output  : Approved parameter set       -> control of F.2.3.3
Requirement : HMS-1.4.2, HMS-1.1.1, HMS-2.1.6, HMS-2.3.2
"""
from __future__ import annotations

from brm.common import digest
from brm.idef0 import idef0


class ParameterError(ValueError):
    """Raised when the parameters do not cover the threat-layer inventory."""


@idef0("F.2.3.2", "Configure Threat and Sensitivity Parameters", "C.2.3.2 Parameter Configuration Manager",
       inputs=["Threat-layer inventory"], controls=["Habitat-model parameters"],
       outputs=["Approved parameter set"],
       requirements=["HMS-1.4.2", "HMS-1.1.1", "HMS-2.1.6", "HMS-2.3.2"])
def configure_threat_and_sensitivity_parameters(threat_layer_inventory: dict, *,
                                                habitat_model_parameters: dict) -> dict:
    """Check the parameters against the inventory and freeze them with an ID."""
    p = habitat_model_parameters
    missing_threats = [t for t in threat_layer_inventory["threats"] if t not in p["threats"]]
    missing_classes = [c for c in threat_layer_inventory["land_cover_classes"]
                       if c not in p["habitat_suitability"] or c not in p["sensitivity"]]
    if missing_threats or missing_classes:
        raise ParameterError(f"uncovered threats={missing_threats} classes={missing_classes}")
    total = sum(p["threats"][t]["weight"] for t in threat_layer_inventory["threats"])
    if total <= 0:
        raise ParameterError("threat weights must sum to a positive value")
    for t, spec in p["threats"].items():
        if spec["decay"] not in ("linear", "exponential") or spec["max_distance_km"] <= 0:
            raise ParameterError(f"bad decay spec for {t}")
    frozen = {
        "invest_model": p["invest_model"],
        "invest_version": p["invest_version"],
        "z": p["z"], "k": p["k"],
        "threats": {t: dict(p["threats"][t], weight_norm=p["threats"][t]["weight"] / total)
                    for t in threat_layer_inventory["threats"]},
        "habitat_suitability": {c: p["habitat_suitability"][c] for c in threat_layer_inventory["land_cover_classes"]},
        "sensitivity": {c: p["sensitivity"][c] for c in threat_layer_inventory["land_cover_classes"]},
        "risk_classes": p["risk_classes"],
    }
    return {"parameter_set_id": "PS-" + digest(frozen), "source_version": p.get("version"), **frozen}
