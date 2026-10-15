# Traceability

One row per module: function identifier and name from the IDEF0 model, module path from the repository.

`biodiversity_risk_map_service/` does not appear here because it is not a function on the IDEF0. It is the mechanism ("Biodiversity Risk Map System") that calls 1.1.1 through 1.1.7 in sequence; the model does not require it to have its own ICOM row, and forcing one would be vocabulary sharing, not the structural match this increment is after.

| Function ID | Function Name | Module |
|---|---|---|
| 1.1.1 | Acquire Environmental Data | `data_acquisition/` |
| 1.1.2 | Validate and Prepare Data | `data_validation/` |
| 1.1.3 | Calculate Habitat Quality | `habitat_quality/` |
| 1.1.4 | Summarize Site Conditions | `site_summary/` |
| 1.1.5 | Display Geographic Results | `geographic_display/` |
| 1.1.6 | Explain Results and Limitations | `results_explanation/` |
| 1.1.7 | Export Screening Reports | `report_export/` |
