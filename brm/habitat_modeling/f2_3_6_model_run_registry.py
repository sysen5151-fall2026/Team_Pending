"""F.2.3.6 Register Model Run — mechanism C.2.3.6 Model Run Registry.

IDEF0 (Level 3, diagram F.2.3)
    Inputs  : Run log    (from F.2.3.3, one per attempt)
              QA result  (from F.2.3.4, one per attempt)
    Output  : Model run record -> F.2.3 boundary -> F.2.6 Explain Results and Limitations
Requirement : HMS-1.4.6, HMS-1.2.3, HMS-2.4.2
"""
from __future__ import annotations

from brm.common import digest
from brm.idef0 import idef0


@idef0("F.2.3.6", "Register Model Run", "C.2.3.6 Model Run Registry",
       inputs=["Run log", "QA result"],
       outputs=["Model run record"],
       requirements=["HMS-1.4.6", "HMS-1.2.3", "HMS-2.4.2"])
def register_model_run(run_log: list[dict], qa_result: list[dict]) -> dict:
    """Combine every attempt's run log and QA result into one traceable record."""
    last_log, last_qa = run_log[-1], qa_result[-1]
    key = {"dataset_id": last_log["dataset_id"], "bundle_id": last_log["bundle_id"],
           "parameter_set_id": last_log["parameter_set_id"], "engine": last_log["engine"]}
    return {"run_id": "RUN-" + digest(key), **key,
            "attempts": len(run_log), "final_qa": last_qa["status"],
            "history": [{"attempt": l["attempt"], "qa": q["status"], "rerun_reason": l["rerun_reason"],
                         "duration_ms": l["duration_ms"]} for l, q in zip(run_log, qa_result)],
            "cells": last_log["cells_processed"]}
