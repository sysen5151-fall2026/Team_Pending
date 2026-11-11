"""F.2.1 Acquire Environmental Data — mechanism C.2.1 Data Ingestion Subsystem.

IDEF0 (Level 2, diagram F.2)
    Inputs  : Environmental datasets, Planning area and data needs
    Control : Approved source list   (from F.3 Government Agencies)
    Outputs : Acquired datasets and metadata -> F.2.2
              Dataset identifier             -> F.2.2 / Model run record
Requirement : SYS-1.4.1, SYS-2.3.2, SYS-2.4.3
"""
from __future__ import annotations

from brm.common import digest
from brm.idef0 import idef0


@idef0("F.2.1", "Acquire Environmental Data", "C.2.1 Data Ingestion Subsystem",
       inputs=["Environmental datasets", "Planning area and data needs"],
       controls=["Approved source list"],
       outputs=["Acquired datasets and metadata", "Dataset identifier"],
       requirements=["SYS-1.4.1", "SYS-2.3.2", "SYS-2.4.3"])
def acquire_environmental_data(environmental_datasets: dict[str, dict], planning_area_and_data_needs: dict,
                               *, approved_source_list: dict) -> tuple[dict, str]:
    approved = set(approved_source_list["approved_sources"])
    needed = planning_area_and_data_needs["needed_sources"]
    accepted, rejected = {}, []
    for sid, ds in sorted(environmental_datasets.items()):
        if sid not in approved:
            rejected.append({"source_id": sid, "reason": "not on approved source list"})
            continue
        if sid in needed:
            accepted[sid] = ds
    missing = [s for s in needed if s not in accepted]
    metadata = [{"source_id": sid, "title": ds["title"], "crs": ds["crs"], "retrieved": ds["retrieved"],
                 "license": ds["license"], "records": len(ds["records"]), "checksum": digest(ds["records"], 12)}
                for sid, ds in accepted.items()]
    dataset_identifier = "DS-" + digest([(m["source_id"], m["checksum"]) for m in metadata])
    return ({"planning_area": planning_area_and_data_needs["area_id"], "datasets": accepted,
             "metadata": metadata, "rejected_sources": rejected, "missing_sources": missing,
             "approved_source_list_version": approved_source_list["version"]},
            dataset_identifier)
