"""F.2.3.4 Verify Model Outputs — mechanism C.2.3.4 Output QA Checker.

IDEF0 (Level 3, diagram F.2.3)
    Input   : Raw model outputs        (from F.2.3.3)
    Outputs : Verified habitat rasters -> F.2.3.5
              QA result                -> F.2.3.6
              Re-run request           -> F.2.3.3 (feedback loop)
Requirement : HMS-1.4.4, HMS-2.1.5, HMS-2.1.4
"""
from __future__ import annotations

import math

from brm.idef0 import idef0


@idef0("F.2.3.4", "Verify Model Outputs", "C.2.3.4 Output QA Checker",
       inputs=["Raw model outputs"],
       outputs=["Verified habitat rasters", "QA result", "Re-run request"],
       requirements=["HMS-1.4.4", "HMS-2.1.5", "HMS-2.1.4"])
def verify_model_outputs(raw_model_outputs: dict, *, expected_cells: int | None = None
                         ) -> tuple[dict | None, dict, dict | None]:
    """Quality gate: every cell present, finite and inside [0, 1]."""
    cells = raw_model_outputs["cells"]
    failures = []
    for c in cells:
        for key in ("habitat_quality", "degradation"):
            v = c[key]
            if not isinstance(v, (int, float)) or math.isnan(v) or not 0.0 <= v <= 1.0:
                failures.append({"cell_id": c["cell_id"], "field": key, "value": str(v)})
    if expected_cells is not None and len(cells) != expected_cells:
        failures.append({"cell_id": "*", "field": "cell_count", "value": f"{len(cells)}/{expected_cells}"})
    passed = not failures
    qa_result = {"status": "PASS" if passed else "FAIL", "checked_cells": len(cells),
                 "failures": failures[:10], "attempt": raw_model_outputs["attempt"],
                 "checks": ["values finite", "values in [0,1]", "complete county coverage"]}
    if passed:
        verified = {k: raw_model_outputs[k] for k in ("bundle_id", "parameter_set_id", "cells")}
        return verified, qa_result, None
    rerun_request = {"attempt": raw_model_outputs["attempt"],
                     "reason": f"{len(failures)} cell value(s) failed the QA gate"}
    return None, qa_result, rerun_request
