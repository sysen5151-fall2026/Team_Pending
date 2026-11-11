"""F.2.3.3 Execute Habitat Quality Model — mechanism C.2.3.3 InVEST Habitat Quality Engine.

IDEF0 (Level 3, diagram F.2.3)
    Inputs  : Model input bundle  (from F.2.3.1)
              Re-run request      (feedback from F.2.3.4, optional)
    Control : Approved parameter set (from F.2.3.2)
    Outputs : Raw model outputs   -> F.2.3.4
              Run log             -> F.2.3.6
Requirement : HMS-1.4.3, HMS-2.3.1, HMS-2.1.3

Equations (InVEST Habitat Quality, Sharp et al.):
    i_rxy  = 1 - d/dmax                      (linear decay)
           = exp(-(2.99/dmax) * d)           (exponential decay)
    D_xj   = beta_x * sum_r (w_r / sum w) * i_rxy * S_jr
    Q_xj   = H_j * (1 - D^z / (D^z + k^z))
    risk   = 1 - Q
"""
from __future__ import annotations

import math
import time

from brm.idef0 import idef0


def threat_impact(distance_km: float, max_distance_km: float, decay: str) -> float:
    if distance_km > max_distance_km:
        return 0.0
    if decay == "linear":
        return 1.0 - distance_km / max_distance_km
    return math.exp(-(2.99 / max_distance_km) * distance_km)


@idef0("F.2.3.3", "Execute Habitat Quality Model", "C.2.3.3 InVEST Habitat Quality Engine",
       inputs=["Model input bundle", "Re-run request"], controls=["Approved parameter set"],
       outputs=["Raw model outputs", "Run log"],
       requirements=["HMS-1.4.3", "HMS-2.3.1", "HMS-2.1.3"])
def execute_habitat_quality_model(model_input_bundle: dict, rerun_request: dict | None = None, *,
                                  approved_parameter_set: dict, fault_injection: dict | None = None
                                  ) -> tuple[dict, dict]:
    """Run the habitat-quality equations for every cell.

    ``fault_injection`` is a demo/test hook only: ``{"attempts": 1}`` corrupts
    one cell on the first attempt so the F.2.3.4 -> F.2.3.3 re-run loop can be
    shown.
    """
    ps = approved_parameter_set
    attempt = 1 + (rerun_request["attempt"] if rerun_request else 0)
    t0 = time.perf_counter()
    cells = []
    for c in model_input_bundle["cells"]:
        lc = c["land_cover"]
        impacts = {t: threat_impact(c["threat_distance_km"][t], spec["max_distance_km"], spec["decay"])
                   for t, spec in ps["threats"].items()}
        d = c["accessibility"] * sum(spec["weight_norm"] * impacts[t] * ps["sensitivity"][lc][t]
                                     for t, spec in ps["threats"].items())
        h = ps["habitat_suitability"][lc]
        dz, kz = d ** ps["z"], ps["k"] ** ps["z"]
        q = h * (1 - dz / (dz + kz)) if (dz + kz) > 0 else h
        cells.append({"cell_id": c["cell_id"], "land_cover": lc, "habitat_suitability": h,
                      "accessibility": c["accessibility"],
                      "threat_impact": {t: round(v, 6) for t, v in impacts.items()},
                      "degradation": round(d, 6), "habitat_quality": round(q, 6)})
    if fault_injection and attempt <= fault_injection.get("attempts", 0) and cells:
        cells[len(cells) // 2]["habitat_quality"] = float("nan")
    raw_model_outputs = {"bundle_id": model_input_bundle["bundle_id"],
                         "parameter_set_id": ps["parameter_set_id"], "attempt": attempt, "cells": cells}
    run_log = {"engine": f'{ps["invest_model"]} {ps["invest_version"]}',
               "dataset_id": model_input_bundle["dataset_id"],
               "bundle_id": model_input_bundle["bundle_id"],
               "parameter_set_id": ps["parameter_set_id"],
               "attempt": attempt,
               "rerun_reason": rerun_request["reason"] if rerun_request else None,
               "cells_processed": len(cells),
               "duration_ms": round((time.perf_counter() - t0) * 1000, 3)}
    return raw_model_outputs, run_log
