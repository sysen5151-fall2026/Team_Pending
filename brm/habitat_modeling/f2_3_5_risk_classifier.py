"""F.2.3.5 Classify Habitat Risk — mechanism C.2.3.5 Risk Classifier.

IDEF0 (Level 3, diagram F.2.3)
    Input   : Verified habitat rasters  (from F.2.3.4)
    Output  : Habitat-quality and degradation results -> F.2.3 boundary -> F.2.4, F.2.5
Requirement : HMS-1.4.5, HMS-1.2.2
"""
from __future__ import annotations

from brm.idef0 import idef0

DEFAULT_CLASSES = [{"name": "Very high", "min": 0.8}, {"name": "High", "min": 0.6},
                   {"name": "Moderate", "min": 0.4}, {"name": "Low", "min": 0.2},
                   {"name": "Very low", "min": 0.0}]


def risk_class(score: float, classes=DEFAULT_CLASSES) -> str:
    for c in sorted(classes, key=lambda c: -c["min"]):
        if score >= c["min"]:
            return c["name"]
    return classes[-1]["name"]


@idef0("F.2.3.5", "Classify Habitat Risk", "C.2.3.5 Risk Classifier",
       inputs=["Verified habitat rasters"],
       outputs=["Habitat-quality and degradation results"],
       requirements=["HMS-1.4.5", "HMS-1.2.2"])
def classify_habitat_risk(verified_habitat_rasters: dict, *, risk_classes=DEFAULT_CLASSES) -> dict:
    """risk_score = 1 - Q, then a five-class label."""
    cells = []
    for c in verified_habitat_rasters["cells"]:
        score = round(1 - c["habitat_quality"], 6)
        cells.append(dict(c, risk_score=score, risk_class=risk_class(score, risk_classes)))
    counts = {k["name"]: 0 for k in risk_classes}
    for c in cells:
        counts[c["risk_class"]] += 1
    return {"bundle_id": verified_habitat_rasters["bundle_id"],
            "parameter_set_id": verified_habitat_rasters["parameter_set_id"],
            "class_counts": counts, "cells": cells}
