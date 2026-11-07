# User guide: screening a proposed development site

This guide is for the person screening a site, normally a county planner or a reviewer working for one.

## 1. What you provide

| Item | Where you enter it | Example |
|---|---|---|
| Project name | *Screen Proposed Development Sites* form | Route 13 commercial plaza |
| The site | Click every 1 km grid cell the project touches on the map | R05-C08, R05-C09, R06-C08, R06-C09 |
| (Review level) | fixed at 0.6 in `config/site_summary_rules.json` | Cells with a risk score at or above this are counted |

Cell names give the grid position. R05-C08 means row 5 counted from the south edge of the county and column 8 counted from the west edge. The county grid has 12 rows and 14 columns of 1 km × 1 km cells.

## 2. How to operate

1. Open the app and press **Screen Proposed Development Sites** on the home page.
2. Fill in the form. Click the cells on the map, or press **Use example site**.
3. Press **Screen this site**. The map system runs every step it still needs:
   1. acquire the approved data
   2. check the data quality
   3. run the habitat model, with its built-in quality check
   4. summarize the site
   5. explain the result
   6. write the report
4. Read the result under the map, then press **See the full report** for the full report.

To see or demonstrate each step separately, open **Assess Spatial Biodiversity Conditions** instead and run the seven steps one by one. **Calculate Habitat Quality** opens its six internal steps.

## 3. Standards used

| What | Standard |
|---|---|
| Risk score | 1 − habitat quality, from 0 (intact, unthreatened habitat) to 1 (poor or heavily degraded habitat) |
| Habitat quality | InVEST Habitat Quality: suitability × (1 − Dᶻ ÷ (Dᶻ + kᶻ)). D is the combined threat degradation; k = 0.3 and z = 2.5 by default |
| Risk classes | Very high ≥ 0.80 · High 0.60–0.79 · Moderate 0.40–0.59 · Low 0.20–0.39 · Very low < 0.20 |
| Recommendation (based on the highest-risk cell) | ≥ 0.80 field verification before any decision · ≥ 0.60 targeted habitat survey and further review · ≥ 0.40 check recent land-cover change and monitor · below 0.40 routine monitoring |
| Data | Only sources on the agency-approved list are used. At most 1% of cells may lack core data. Cells without species records are flagged |
| Model quality | Results are released only if all 168 cells are present and every value is between 0 and 1; otherwise the model re-runs |

The threat weights, k and z can be changed on *Maintain Biodiversity Risk Map*.

## 4. Where the result appears

- **Under the map** on *Screen Proposed Development Sites*: average risk score and class, highest-risk cell, number of cells above the threshold, species records and the recommendation.
- **Export Screening Reports**: the full report, with the result, how to read the score, the reasons, data sources and limitations. You can download it as `.md` (report) or `.csv` (one row per cell).
- **Review Environmental Screening Evidence**: the agency reviewer sees the same evidence and can accept it or request further review. That review then appears in the explanation.

The result is preliminary ecological screening. It is not a regulatory determination.
