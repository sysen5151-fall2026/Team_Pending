"""F.2.2 Validate and Prepare Data — mechanism C.2.2 Data Preparation Subsystem.

IDEF0 (Level 2, diagram F.2)
    Input   : Acquired datasets and metadata (from F.2.1)
    Control : Data-quality criteria          (from F.4 IT Development Team)
    Outputs : Prepared datasets          -> F.2.3, F.2.4, F.2.5
              Data-quality report        -> F.2.6
              Coverage Validation Result -> F.2.6 / web map warning
Requirement : SYS-1.4.2, SYS-2.1.1, SYS-2.1.5, SYS-2.4.1
"""
from __future__ import annotations

from brm.idef0 import idef0

FIELD_MAP = {  # source_id -> (record key, prepared field)
    "USGS-NLCD-LANDCOVER": ("land_cover", "land_cover"),
    "OSM-ROADS": ("distance_km", "dist_road_km"),
    "NLCD-DEVELOPED": ("distance_km", "dist_urban_km"),
    "NLCD-CULTIVATED": ("distance_km", "dist_agriculture_km"),
    "USGS-PADUS": ("protected", "protected"),
    "GBIF-OCCURRENCES": ("species_count", "species_count"),
}
REQUIRED = ("land_cover", "dist_road_km", "dist_urban_km", "dist_agriculture_km", "protected")


@idef0("F.2.2", "Validate and Prepare Data", "C.2.2 Data Preparation Subsystem",
       inputs=["Acquired datasets and metadata"], controls=["Data-quality criteria"],
       outputs=["Prepared datasets", "Data-quality report", "Coverage Validation Result"],
       requirements=["SYS-1.4.2", "SYS-2.1.1", "SYS-2.1.5", "SYS-2.4.1"])
def validate_and_prepare_data(acquired_datasets_and_metadata: dict, dataset_identifier: str, *,
                              data_quality_criteria: dict) -> tuple[dict, dict, dict]:
    ds = acquired_datasets_and_metadata["datasets"]
    crit = data_quality_criteria
    issues = []
    grid = ds["TIGER-BOUNDARY"]["records"]
    if ds["TIGER-BOUNDARY"]["crs"] != crit["target_crs"]:
        issues.append({"source_id": "TIGER-BOUNDARY",
                       "issue": f'grid geometry kept in {ds["TIGER-BOUNDARY"]["crs"]} for web display; '
                                f'analysis values aligned to {crit["target_crs"]} {crit["cell_size_m"]} m cells'})
    cells = {g["cell_id"]: {"cell_id": g["cell_id"], "geometry": g["geometry"]} for g in grid}
    for sid, (key, field) in FIELD_MAP.items():
        if sid not in ds:
            issues.append({"source_id": sid, "issue": "source missing"})
            continue
        if ds[sid]["crs"] != crit["target_crs"]:
            issues.append({"source_id": sid, "issue": f'reprojected {ds[sid]["crs"]} -> {crit["target_crs"]}'})
        for rec in ds[sid]["records"]:
            if rec["cell_id"] in cells:
                cells[rec["cell_id"]][field] = rec[key]
    gaps, incomplete = [], []
    for c in cells.values():
        c.setdefault("species_count", None)
        if c["species_count"] is None:
            gaps.append(c["cell_id"])
        if any(c.get(f) is None for f in REQUIRED):
            incomplete.append(c["cell_id"])
    complete = [c for c in cells.values() if c["cell_id"] not in incomplete]
    missing_fraction = len(incomplete) / max(1, len(cells))
    coverage = {"status": "COMPLETE" if missing_fraction <= crit["max_missing_fraction"] else "INCOMPLETE",
                "grid_cells": len(cells), "prepared_cells": len(complete),
                "missing_fraction": round(missing_fraction, 4), "incomplete_cells": incomplete}
    report = {"criteria_version": crit["version"], "target_crs": crit["target_crs"],
              "issues": issues, "data_gap_cells": gaps,
              "data_gap_warning": (f"{len(gaps)} cell(s) have no species-occurrence records; "
                                   "biodiversity value may be under-estimated there.") if gaps else None,
              "rejected_sources": acquired_datasets_and_metadata["rejected_sources"],
              "sources": acquired_datasets_and_metadata["metadata"]}
    prepared = {"dataset_id": dataset_identifier, "crs": crit["target_crs"], "cell_size_m": crit["cell_size_m"],
                "planning_area": acquired_datasets_and_metadata["planning_area"], "cells": complete}
    return prepared, report, coverage
