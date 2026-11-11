"""F.2.5 Display Geographic Results — mechanism C.2.5 Web Map Subsystem.

IDEF0 (Level 2, diagram F.2)
    Inputs  : Prepared datasets, Habitat-quality and degradation results, Site screening summary,
              Area and layer selection, Map request
    Control : Map-display rules
    Outputs : Displayed risk map and legend (-> F.5 Local Planner), Habitat-quality map (-> F.1)
Requirement : SYS-1.4.5, SYS-2.2.1, SYS-2.4.3

The Python side builds the styled GeoJSON + legend; dist/app.js (Leaflet) renders it.
"""
from __future__ import annotations

from brm.idef0 import idef0


@idef0("F.2.5", "Display Geographic Results", "C.2.5 Web Map Subsystem",
       inputs=["Prepared datasets", "Habitat-quality and degradation results", "Site screening summary",
               "Area and layer selection", "Map request"],
       controls=["Map-display rules"],
       outputs=["Displayed risk map and legend", "Habitat-quality map"],
       requirements=["SYS-1.4.5", "SYS-2.2.1", "SYS-2.4.3"])
def display_geographic_results(prepared_datasets: dict, habitat_quality_and_degradation_results: dict,
                               site_screening_summary: dict | None, area_and_layer_selection: dict,
                               map_request: dict, *, map_display_rules: dict) -> tuple[dict, dict]:
    geom = {c["cell_id"]: c for c in prepared_datasets["cells"]}
    selected = set(site_screening_summary["cell_ids"]) if site_screening_summary else set()
    colors = map_display_rules["colors"]
    feats = []
    for r in habitat_quality_and_degradation_results["cells"]:
        p = geom[r["cell_id"]]
        props = {"cell_id": r["cell_id"], "habitat": r["land_cover"], "species_count": p.get("species_count"),
                 "protected": p["protected"], "habitat_suitability": r["habitat_suitability"],
                 "accessibility": r["accessibility"], "road_effect": r["threat_impact"]["road"],
                 "urban_effect": r["threat_impact"]["urban"],
                 "agriculture_effect": r["threat_impact"]["agriculture"], "degradation": r["degradation"],
                 "habitat_quality": r["habitat_quality"], "risk_score": r["risk_score"],
                 "risk_class": r["risk_class"], "fill": colors[r["risk_class"]],
                 "selected": r["cell_id"] in selected, "data_gap": p.get("species_count") is None}
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "Polygon", "coordinates": p["geometry"]}})
    meta = {"run_id": habitat_quality_and_degradation_results.get("run_id"),
            "parameter_set_id": habitat_quality_and_degradation_results["parameter_set_id"],
            "dataset_id": prepared_datasets["dataset_id"], "attribution": map_display_rules["attribution"],
            "layer": area_and_layer_selection.get("layer", "risk"), "request": map_request}
    risk_map = {"type": "FeatureCollection", "metadata": meta, "features": feats,
                "legend": [{"class": k, "color": v} for k, v in colors.items()],
                "fill_opacity": map_display_rules["fill_opacity"]}
    hq_map = {"type": "FeatureCollection", "metadata": dict(meta, layer="habitat_quality"),
              "features": [{"type": "Feature", "geometry": f["geometry"],
                            "properties": {"cell_id": f["properties"]["cell_id"],
                                           "habitat_quality": f["properties"]["habitat_quality"]}}
                           for f in feats]}
    return risk_map, hq_map
