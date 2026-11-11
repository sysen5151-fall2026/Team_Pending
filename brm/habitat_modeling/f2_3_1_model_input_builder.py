"""F.2.3.1 Assemble Model Inputs — mechanism C.2.3.1 Model Input Builder.

IDEF0 (Level 3, diagram F.2.3)
    Input   : Prepared datasets            (from F.2.2 via the F.2.3 boundary)
    Output  : Model input bundle           -> F.2.3.3
              Threat-layer inventory       -> F.2.3.2
Requirement : HMS-1.4.1, HMS-1.1.2, HMS-2.1.4
"""
from __future__ import annotations

from brm.common import digest
from brm.idef0 import idef0

THREAT_FIELDS = {"road": "dist_road_km", "urban": "dist_urban_km", "agriculture": "dist_agriculture_km"}


@idef0("F.2.3.1", "Assemble Model Inputs", "C.2.3.1 Model Input Builder",
       inputs=["Prepared datasets"],
       outputs=["Model input bundle", "Threat-layer inventory"],
       requirements=["HMS-1.4.1", "HMS-1.1.2", "HMS-2.1.4"])
def assemble_model_inputs(prepared_datasets: dict) -> tuple[dict, dict]:
    """Build the InVEST input bundle (land cover + threat distances + access)."""
    cells = prepared_datasets["cells"]
    bundle_cells = [{
        "cell_id": c["cell_id"],
        "land_cover": c["land_cover"],
        "accessibility": 0.3 if c["protected"] else 1.0,
        "threat_distance_km": {t: c[f] for t, f in THREAT_FIELDS.items()},
    } for c in cells]
    model_input_bundle = {
        "dataset_id": prepared_datasets["dataset_id"],
        "crs": prepared_datasets["crs"],
        "cell_size_m": prepared_datasets["cell_size_m"],
        "cells": bundle_cells,
    }
    model_input_bundle["bundle_id"] = "MB-" + digest(bundle_cells)
    threat_layer_inventory = {
        "bundle_id": model_input_bundle["bundle_id"],
        "threats": sorted(THREAT_FIELDS),
        "land_cover_classes": sorted({c["land_cover"] for c in cells}),
        "cell_count": len(cells),
    }
    return model_input_bundle, threat_layer_inventory
