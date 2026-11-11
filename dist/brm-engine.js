/* Biodiversity Risk Map — browser engine.
 * Line-for-line port of the Python modules so the web app can run IDEF0
 * functions live (same equations, same canonical hashing => same IDs):
 *   F.2.3   brm/habitat_modeling/__init__.py            calculateHabitatQuality
 *   F.2.3.1 f2_3_1_model_input_builder.py               assembleModelInputs
 *   F.2.3.2 f2_3_2_parameter_configuration_manager.py   configureThreatAndSensitivityParameters
 *   F.2.3.3 f2_3_3_invest_engine.py                     executeHabitatQualityModel
 *   F.2.3.4 f2_3_4_output_qa_checker.py                 verifyModelOutputs
 *   F.2.3.5 f2_3_5_risk_classifier.py                   classifyHabitatRisk
 *   F.2.3.6 f2_3_6_model_run_registry.py                registerModelRun
 *   F.2.4   brm/f2_4_spatial_analysis.py                summarizeSiteConditions
 *   F.2.6   brm/f2_6_explanation.py                     explainResultsAndLimitations
 *   F.2.7   brm/f2_7_report_generation.py               exportScreeningReports
 */
(function (global) {
  'use strict';

  /* ---------- canonical JSON + SHA-256 (matches brm/common.py) ---------- */
  function canonical(o) {
    if (o === null || o === undefined) return 'null';
    if (typeof o === 'number') { if (!isFinite(o)) return 'NaN'; return String(o); }
    if (typeof o === 'boolean') return o ? 'true' : 'false';
    if (typeof o === 'string') return JSON.stringify(o);
    if (Array.isArray(o)) return '[' + o.map(canonical).join(',') + ']';
    return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  function sha256(ascii) {
    const K = [], H = [];
    const isPrime = n => { for (let f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
    const frac = x => ((x - Math.floor(x)) * 4294967296) | 0;
    for (let c = 2, n = 0; n < 64; c++) if (isPrime(c)) { if (n < 8) H[n] = frac(Math.pow(c, 1 / 2)); K[n++] = frac(Math.pow(c, 1 / 3)); }
    const bytes = unescape(encodeURIComponent(ascii));
    const words = []; const bl = bytes.length * 8;
    for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes.charCodeAt(i) << ((3 - i % 4) * 8);
    words[bl >> 5] |= 0x80 << (24 - bl % 32);
    words[(((bl + 64) >> 9) << 4) + 15] = bl;
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let j = 0; j < words.length; j += 16) {
      const w = []; for (let i = 0; i < 16; i++) w[i] = words[j + i] | 0; const h = H.slice();
      for (let i = 0; i < 64; i++) {
        if (i >= 16) {
          const a = w[i - 15], b = w[i - 2];
          w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0;
        }
        const t1 = h[7] + (rotr(h[4], 6) ^ rotr(h[4], 11) ^ rotr(h[4], 25)) + ((h[4] & h[5]) ^ (~h[4] & h[6])) + K[i] + (w[i] | 0);
        const t2 = (rotr(h[0], 2) ^ rotr(h[0], 13) ^ rotr(h[0], 22)) + ((h[0] & h[1]) ^ (h[0] & h[2]) ^ (h[1] & h[2]));
        h.unshift((t1 + t2) | 0); h[4] = (h[4] + t1) | 0; h.pop();
      }
      for (let i = 0; i < 8; i++) H[i] = (H[i] + h[i]) | 0;
    }
    return H.map(x => ('00000000' + (x >>> 0).toString(16)).slice(-8)).join('');
  }
  const digest = (o, n = 8) => sha256(canonical(o)).slice(0, n);
  const r6 = x => (isFinite(x) ? parseFloat(x.toFixed(6)) : x);

  /* ---------- F.2.3.1 Assemble Model Inputs (C.2.3.1 Model Input Builder) ---------- */
  const THREAT_FIELDS = { road: 'dist_road_km', urban: 'dist_urban_km', agriculture: 'dist_agriculture_km' };
  function assembleModelInputs(preparedDatasets) {
    const cells = preparedDatasets.cells.map(c => ({
      cell_id: c.cell_id, land_cover: c.land_cover, accessibility: c.protected ? 0.3 : 1.0,
      threat_distance_km: Object.fromEntries(Object.entries(THREAT_FIELDS).map(([t, f]) => [t, c[f]])),
    }));
    const bundle = { dataset_id: preparedDatasets.dataset_id, crs: preparedDatasets.crs, cell_size_m: preparedDatasets.cell_size_m, cells };
    bundle.bundle_id = 'MB-' + digest(cells);
    const inventory = { bundle_id: bundle.bundle_id, threats: Object.keys(THREAT_FIELDS).sort(),
      land_cover_classes: [...new Set(cells.map(c => c.land_cover))].sort(), cell_count: cells.length };
    return [bundle, inventory];
  }

  /* ---------- F.2.3.2 Configure Threat and Sensitivity Parameters (C.2.3.2) ---------- */
  function configureThreatAndSensitivityParameters(inventory, { habitatModelParameters: p }) {
    const missingT = inventory.threats.filter(t => !(t in p.threats));
    const missingC = inventory.land_cover_classes.filter(c => !(c in p.habitat_suitability) || !(c in p.sensitivity));
    if (missingT.length || missingC.length) throw new Error(`uncovered threats=${missingT} classes=${missingC}`);
    const total = inventory.threats.reduce((a, t) => a + p.threats[t].weight, 0);
    if (total <= 0) throw new Error('threat weights must sum to a positive value');
    const frozen = {
      invest_model: p.invest_model, invest_version: p.invest_version, z: p.z, k: p.k,
      threats: Object.fromEntries(inventory.threats.map(t => [t, Object.assign({}, p.threats[t], { weight_norm: p.threats[t].weight / total })])),
      habitat_suitability: Object.fromEntries(inventory.land_cover_classes.map(c => [c, p.habitat_suitability[c]])),
      sensitivity: Object.fromEntries(inventory.land_cover_classes.map(c => [c, p.sensitivity[c]])),
      risk_classes: p.risk_classes,
    };
    return Object.assign({ parameter_set_id: 'PS-' + digest(frozen), source_version: p.version || null }, frozen);
  }

  /* ---------- F.2.3.3 Execute Habitat Quality Model (C.2.3.3 InVEST engine) ---------- */
  function threatImpact(d, dmax, decay) {
    if (d > dmax) return 0;
    return decay === 'linear' ? 1 - d / dmax : Math.exp(-(2.99 / dmax) * d);
  }
  function executeHabitatQualityModel(bundle, rerunRequest, { approvedParameterSet: ps, faultInjection }) {
    const attempt = 1 + (rerunRequest ? rerunRequest.attempt : 0);
    const t0 = performance.now();
    const threats = Object.keys(ps.threats);
    const cells = bundle.cells.map(c => {
      const lc = c.land_cover;
      const imp = {}; threats.forEach(t => { imp[t] = threatImpact(c.threat_distance_km[t], ps.threats[t].max_distance_km, ps.threats[t].decay); });
      const d = c.accessibility * threats.reduce((a, t) => a + ps.threats[t].weight_norm * imp[t] * ps.sensitivity[lc][t], 0);
      const h = ps.habitat_suitability[lc];
      const dz = Math.pow(d, ps.z), kz = Math.pow(ps.k, ps.z);
      const q = (dz + kz) > 0 ? h * (1 - dz / (dz + kz)) : h;
      return { cell_id: c.cell_id, land_cover: lc, habitat_suitability: h, accessibility: c.accessibility,
        threat_impact: Object.fromEntries(threats.map(t => [t, r6(imp[t])])), degradation: r6(d), habitat_quality: r6(q) };
    });
    if (faultInjection && attempt <= (faultInjection.attempts || 0) && cells.length) cells[Math.floor(cells.length / 2)].habitat_quality = NaN;
    const raw = { bundle_id: bundle.bundle_id, parameter_set_id: ps.parameter_set_id, attempt, cells };
    const runLog = { engine: `${ps.invest_model} ${ps.invest_version}`, dataset_id: bundle.dataset_id, bundle_id: bundle.bundle_id,
      parameter_set_id: ps.parameter_set_id, attempt, rerun_reason: rerunRequest ? rerunRequest.reason : null,
      cells_processed: cells.length, duration_ms: +(performance.now() - t0).toFixed(3) };
    return [raw, runLog];
  }

  /* ---------- F.2.3.4 Verify Model Outputs (C.2.3.4 Output QA Checker) ---------- */
  function verifyModelOutputs(raw, { expectedCells } = {}) {
    const failures = [];
    raw.cells.forEach(c => ['habitat_quality', 'degradation'].forEach(k => {
      const v = c[k]; if (typeof v !== 'number' || isNaN(v) || v < 0 || v > 1) failures.push({ cell_id: c.cell_id, field: k, value: String(v) });
    }));
    if (expectedCells != null && raw.cells.length !== expectedCells) failures.push({ cell_id: '*', field: 'cell_count', value: `${raw.cells.length}/${expectedCells}` });
    const passed = failures.length === 0;
    const qa = { status: passed ? 'PASS' : 'FAIL', checked_cells: raw.cells.length, failures: failures.slice(0, 10), attempt: raw.attempt,
      checks: ['values finite', 'values in [0,1]', 'complete county coverage'] };
    if (passed) return [{ bundle_id: raw.bundle_id, parameter_set_id: raw.parameter_set_id, cells: raw.cells }, qa, null];
    return [null, qa, { attempt: raw.attempt, reason: `${failures.length} cell value(s) failed the QA gate` }];
  }

  /* ---------- F.2.3.5 Classify Habitat Risk (C.2.3.5 Risk Classifier) ---------- */
  const DEFAULT_CLASSES = [{ name: 'Very high', min: 0.8 }, { name: 'High', min: 0.6 }, { name: 'Moderate', min: 0.4 }, { name: 'Low', min: 0.2 }, { name: 'Very low', min: 0 }];
  function riskClass(score, classes = DEFAULT_CLASSES) {
    for (const c of classes.slice().sort((a, b) => b.min - a.min)) if (score >= c.min) return c.name;
    return classes[classes.length - 1].name;
  }
  function classifyHabitatRisk(verified, { riskClasses = DEFAULT_CLASSES } = {}) {
    const cells = verified.cells.map(c => { const s = r6(1 - c.habitat_quality); return Object.assign({}, c, { risk_score: s, risk_class: riskClass(s, riskClasses) }); });
    const counts = Object.fromEntries(riskClasses.map(k => [k.name, 0])); cells.forEach(c => counts[c.risk_class]++);
    return { bundle_id: verified.bundle_id, parameter_set_id: verified.parameter_set_id, class_counts: counts, cells };
  }

  /* ---------- F.2.3.6 Register Model Run (C.2.3.6 Model Run Registry) ---------- */
  function registerModelRun(runLogs, qaResults) {
    const l = runLogs[runLogs.length - 1], q = qaResults[qaResults.length - 1];
    const key = { dataset_id: l.dataset_id, bundle_id: l.bundle_id, parameter_set_id: l.parameter_set_id, engine: l.engine };
    return Object.assign({ run_id: 'RUN-' + digest(key) }, key, { attempts: runLogs.length, final_qa: q.status,
      history: runLogs.map((x, i) => ({ attempt: x.attempt, qa: qaResults[i].status, rerun_reason: x.rerun_reason, duration_ms: x.duration_ms })),
      cells: l.cells_processed });
  }

  /* ---------- F.2.3 Calculate Habitat Quality (C.2.3) — async so the UI can animate each Level-3 box ---------- */
  async function calculateHabitatQuality(prepared, { habitatModelParameters, faultInjection, onStep = async () => {} }) {
    const step = async (fid, fn, info) => { await onStep(fid, 'start', null); const out = fn(); await onStep(fid, 'done', info(out)); return out; };
    const [bundle, inventory] = await step('F.2.3.1', () => assembleModelInputs(prepared),
      ([b, inv]) => ({ 'Model input bundle': `${b.bundle_id} · ${b.cells.length} cells · ${b.crs}`, 'Threat-layer inventory': `threats: ${inv.threats.join(', ')} · classes: ${inv.land_cover_classes.join(', ')}` }));
    const ps = await step('F.2.3.2', () => configureThreatAndSensitivityParameters(inventory, { habitatModelParameters }),
      p => ({ 'Approved parameter set': `${p.parameter_set_id} · z=${p.z} k=${p.k} · w(road,urban,agri)=${['road', 'urban', 'agriculture'].map(t => p.threats[t].weight_norm.toFixed(2)).join('/')}` }));
    const logs = [], qas = []; let rerun = null, verified = null;
    for (let i = 0; i < 3; i++) {
      const [raw, log] = await step('F.2.3.3', () => executeHabitatQualityModel(bundle, rerun, { approvedParameterSet: ps, faultInjection }),
        ([r, lg]) => ({ 'Raw model outputs': `${r.cells.length} cells · attempt ${r.attempt}`, 'Run log': `${lg.engine} · ${lg.duration_ms} ms${lg.rerun_reason ? ' · re-run: ' + lg.rerun_reason : ''}` }));
      const res = await step('F.2.3.4', () => verifyModelOutputs(raw, { expectedCells: inventory.cell_count }),
        ([v, qa, rr]) => Object.assign({ 'QA result': `${qa.status} · ${qa.checked_cells} cells checked` + (qa.failures.length ? ` · ${qa.failures[0].cell_id} ${qa.failures[0].field}=${qa.failures[0].value}` : '') },
          rr ? { 'Re-run request': `attempt ${rr.attempt} → ${rr.reason}` } : { 'Verified habitat rasters': `${v.cells.length} cells released` }));
      [verified] = res; const qa = res[1]; rerun = res[2];
      logs.push(log); qas.push(qa);
      if (!rerun) break;
    }
    const record = await step('F.2.3.6', () => registerModelRun(logs, qas),
      r => ({ 'Model run record': `${r.run_id} · ${r.dataset_id} · ${r.parameter_set_id} · attempts ${r.attempts} · QA ${r.final_qa}` }));
    if (!verified) throw new Error('model run failed QA: ' + record.run_id);
    const results = await step('F.2.3.5', () => classifyHabitatRisk(verified, { riskClasses: ps.risk_classes }),
      r => ({ 'Habitat-quality and degradation results': Object.entries(r.class_counts).map(([k, v]) => `${k} ${v}`).join(' · ') }));
    results.run_id = record.run_id;
    return { results, record, parameterSet: ps };
  }

  /* ---------- F.2.4 Summarize Site Conditions (C.2.4 Spatial Analysis Subsystem) ---------- */
  function summarizeSiteConditions(prepared, results, layerSel, { siteSelection, siteSummaryRules }) {
    const P = Object.fromEntries(prepared.cells.map(c => [c.cell_id, c]));
    const R = Object.fromEntries(results.cells.map(c => [c.cell_id, c]));
    const ids = siteSelection.cell_ids.filter(i => i in R);
    if (!ids.length) throw new Error('site selection contains no screened cells');
    const rows = ids.map(i => Object.assign({}, R[i], { species_count: P[i].species_count, protected: P[i].protected }));
    const mean = rows.reduce((a, r) => a + r.risk_score, 0) / rows.length;
    const top = rows.reduce((a, r) => (r.risk_score > a.risk_score ? r : a));
    const threats = Object.fromEntries(Object.keys(top.threat_impact).map(t => [t, +(rows.reduce((a, r) => a + r.threat_impact[t], 0) / rows.length).toFixed(4)]));
    const rec = siteSummaryRules.recommendations.slice().sort((a, b) => b.min - a.min).find(x => top.risk_score >= x.min).text;
    const avg = k => +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(4);
    return { site_name: siteSelection.name || 'Selected site', cell_ids: ids, layer: layerSel.layer || 'risk', cell_count: rows.length,
      mean_risk: +mean.toFixed(4), risk_class: riskClass(mean), max_cell: top.cell_id, max_risk: top.risk_score,
      cells_over_threshold: rows.filter(r => r.risk_score >= siteSummaryRules.review_threshold).length,
      mean_habitat_quality: avg('habitat_quality'), mean_degradation: avg('degradation'), mean_threat_impact: threats,
      land_cover: [...new Set(rows.map(r => r.land_cover))].sort(), species_count: rows.reduce((a, r) => a + (r.species_count || 0), 0),
      data_gap_cells: rows.filter(r => r.species_count == null).map(r => r.cell_id), recommendation: rec,
      run_id: results.run_id, parameter_set_id: results.parameter_set_id, rules_version: siteSummaryRules.version };
  }

  /* ---------- F.2.6 Explain Results and Limitations (C.2.6 Explanation Subsystem) ---------- */
  const THREAT_LABEL = { road: 'Road pressure', urban: 'Development pressure', agriculture: 'Farmland pressure' };
  function explainResultsAndLimitations(s, dqReport, record, { interpretationRules, reviewRequest = null }) {
    const ranked = Object.entries(s.mean_threat_impact).sort((a, b) => b[1] - a[1]);
    const factors = [`Average habitat quality is ${s.mean_habitat_quality.toFixed(2)} on a 0-1 scale (1 = intact habitat) and average degradation is ${s.mean_degradation.toFixed(2)} (0 = no threat pressure), across ${s.cell_count} cell(s) of ${s.land_cover.join(', ').toLowerCase()}.`];
    ranked.filter(([, v]) => v > 0).forEach(([t, v]) => factors.push(`${THREAT_LABEL[t]}: ${v.toFixed(2)} on a 0-1 scale (1 = the threat is right at the cell, 0 = out of reach).`));
    if (!ranked.some(([, v]) => v > 0)) factors.push('No modelled threat reaches the selected cells.');
    const limitations = interpretationRules.limitations.slice();
    if (s.data_gap_cells.length) limitations.unshift(`Missing species records for ${s.data_gap_cells.join(', ')}: the biodiversity value of these cells may be under-estimated.`);
    if (record.attempts > 1) limitations.push(`The habitat model passed its quality check after ${record.attempts} attempts.`);
    return { factors, limitations, disclaimer: interpretationRules.disclaimer,
      provenance: { run_id: record.run_id, dataset_id: record.dataset_id, parameter_set_id: record.parameter_set_id, engine: record.engine, qa: record.final_qa },
      sources: dqReport.sources.map(m => m.title), review_request: reviewRequest, rules_version: interpretationRules.version };
  }

  /* ---------- F.2.7 Export Screening Reports (C.2.7 Report Generation Subsystem) ---------- */
  function exportScreeningReports(s, x, { reportTemplate, generated }) {
    const body = reportTemplate.split('-->').slice(1).join('-->').replace(/^\s+/, '');
    const v = { site_name: s.site_name, generated, run_id: x.provenance.run_id, parameter_set_id: x.provenance.parameter_set_id,
      cell_count: s.cell_count, mean_risk: s.mean_risk.toFixed(2), risk_class: s.risk_class, max_cell: s.max_cell, max_risk: s.max_risk.toFixed(2),
      coverage_status: s.data_gap_cells.length ? `missing for ${s.data_gap_cells.length} cell(s)` : 'complete', recommendation: s.recommendation,
      factors: x.factors.map(f => '- ' + f).join('\n'), sources: x.sources.map(f => '- ' + f).join('\n'),
      limitations: x.limitations.map(f => '- ' + f).join('\n'), disclaimer: x.disclaimer };
    const md = body.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
    const csv = 'cell_id,site,mean_risk,risk_class,run_id,parameter_set_id\n' + s.cell_ids.map(c => `${c},${s.site_name},${s.mean_risk},${s.risk_class},${x.provenance.run_id},${x.provenance.parameter_set_id}`).join('\n');
    return { markdown: md, csv, formats: ['md', 'csv'], run_id: x.provenance.run_id };
  }


  /* ---------- F.2.1 Acquire Environmental Data (C.2.1 Data Ingestion Subsystem) — port of brm/f2_1_data_ingestion.py ---------- */
  function acquireEnvironmentalData(environmentalDatasets, planningAreaAndDataNeeds, { approvedSourceList }) {
    const approved = new Set(approvedSourceList.approved_sources);
    const needed = planningAreaAndDataNeeds.needed_sources;
    const accepted = {}, rejected = [];
    Object.keys(environmentalDatasets).sort().forEach(sid => {
      if (!approved.has(sid)) { rejected.push({ source_id: sid, reason: 'not on approved source list' }); return; }
      if (needed.includes(sid)) accepted[sid] = environmentalDatasets[sid];
    });
    const missing = needed.filter(s => !(s in accepted));
    const metadata = Object.entries(accepted).map(([sid, ds]) => ({ source_id: sid, title: ds.title, crs: ds.crs, retrieved: ds.retrieved,
      license: ds.license, records: ds.records.length, checksum: digest(ds.records, 12) }));
    const datasetIdentifier = 'DS-' + digest(metadata.map(m => [m.source_id, m.checksum]));
    return [{ planning_area: planningAreaAndDataNeeds.area_id, datasets: accepted, metadata, rejected_sources: rejected,
      missing_sources: missing, approved_source_list_version: approvedSourceList.version }, datasetIdentifier];
  }

  /* ---------- F.2.2 Validate and Prepare Data (C.2.2 Data Preparation Subsystem) — port of brm/f2_2_data_preparation.py ---------- */
  const FIELD_MAP = { 'USGS-NLCD-LANDCOVER': ['land_cover', 'land_cover'], 'OSM-ROADS': ['distance_km', 'dist_road_km'],
    'NLCD-DEVELOPED': ['distance_km', 'dist_urban_km'], 'NLCD-CULTIVATED': ['distance_km', 'dist_agriculture_km'],
    'USGS-PADUS': ['protected', 'protected'], 'GBIF-OCCURRENCES': ['species_count', 'species_count'] };
  const REQUIRED = ['land_cover', 'dist_road_km', 'dist_urban_km', 'dist_agriculture_km', 'protected'];
  function validateAndPrepareData(acquired, datasetIdentifier, { dataQualityCriteria: crit }) {
    const ds = acquired.datasets, issues = [];
    if (!ds['TIGER-BOUNDARY']) throw new Error('The county grid (TIGER-BOUNDARY) was not acquired.');
    if (ds['TIGER-BOUNDARY'].crs !== crit.target_crs) issues.push({ source_id: 'TIGER-BOUNDARY',
      issue: `grid geometry kept in ${ds['TIGER-BOUNDARY'].crs} for web display; analysis values aligned to ${crit.target_crs} ${crit.cell_size_m} m cells` });
    const cells = {}; const order = [];
    ds['TIGER-BOUNDARY'].records.forEach(g => { cells[g.cell_id] = { cell_id: g.cell_id, geometry: g.geometry }; order.push(g.cell_id); });
    Object.entries(FIELD_MAP).forEach(([sid, [key, field]]) => {
      if (!ds[sid]) { issues.push({ source_id: sid, issue: 'source missing' }); return; }
      if (ds[sid].crs !== crit.target_crs) issues.push({ source_id: sid, issue: `reprojected ${ds[sid].crs} -> ${crit.target_crs}` });
      ds[sid].records.forEach(rec => { if (cells[rec.cell_id]) cells[rec.cell_id][field] = rec[key]; });
    });
    const gaps = [], incomplete = [];
    order.forEach(id => { const c = cells[id]; if (c.species_count === undefined) c.species_count = null;
      if (c.species_count === null) gaps.push(id); if (REQUIRED.some(f => c[f] === undefined || c[f] === null)) incomplete.push(id); });
    const complete = order.filter(id => !incomplete.includes(id)).map(id => cells[id]);
    const missingFraction = incomplete.length / Math.max(1, order.length);
    const coverage = { status: missingFraction <= crit.max_missing_fraction ? 'COMPLETE' : 'INCOMPLETE', grid_cells: order.length,
      prepared_cells: complete.length, missing_fraction: +missingFraction.toFixed(4), incomplete_cells: incomplete };
    const report = { criteria_version: crit.version, target_crs: crit.target_crs, issues, data_gap_cells: gaps,
      data_gap_warning: gaps.length ? `${gaps.length} cell(s) have no species-occurrence records; biodiversity value may be under-estimated there.` : null,
      rejected_sources: acquired.rejected_sources, sources: acquired.metadata };
    return [{ dataset_id: datasetIdentifier, crs: crit.target_crs, cell_size_m: crit.cell_size_m, planning_area: acquired.planning_area, cells: complete }, report, coverage];
  }

  /* ---------- F.2.5 Display Geographic Results (C.2.5 Web Map Subsystem) — port of brm/f2_5_web_map.py ---------- */
  function displayGeographicResults(prepared, results, summary, areaAndLayerSelection, mapRequest, { mapDisplayRules }) {
    const P = Object.fromEntries(prepared.cells.map(c => [c.cell_id, c]));
    const sel = new Set(summary ? summary.cell_ids : []);
    const features = results.cells.map(r => { const p = P[r.cell_id]; return { type: 'Feature', geometry: { type: 'Polygon', coordinates: p.geometry },
      properties: { cell_id: r.cell_id, habitat: r.land_cover, species_count: p.species_count, protected: p.protected, habitat_suitability: r.habitat_suitability,
        accessibility: r.accessibility, road_effect: r.threat_impact.road, urban_effect: r.threat_impact.urban, agriculture_effect: r.threat_impact.agriculture,
        degradation: r.degradation, habitat_quality: r.habitat_quality, risk_score: r.risk_score, risk_class: r.risk_class,
        fill: mapDisplayRules.colors[r.risk_class], selected: sel.has(r.cell_id), data_gap: p.species_count == null } }; });
    const meta = { run_id: results.run_id, parameter_set_id: results.parameter_set_id, dataset_id: prepared.dataset_id,
      attribution: mapDisplayRules.attribution, layer: areaAndLayerSelection.layer || 'risk', request: mapRequest };
    return [{ type: 'FeatureCollection', metadata: meta, features, legend: Object.entries(mapDisplayRules.colors).map(([k, v]) => ({ class: k, color: v })),
      fill_opacity: mapDisplayRules.fill_opacity },
      { type: 'FeatureCollection', metadata: Object.assign({}, meta, { layer: 'habitat_quality' }),
        features: features.map(f => ({ type: 'Feature', geometry: f.geometry, properties: { cell_id: f.properties.cell_id, habitat_quality: f.properties.habitat_quality } })) }];
  }

  global.BRM = { canonical, sha256, digest, riskClass, assembleModelInputs, configureThreatAndSensitivityParameters,
    executeHabitatQualityModel, verifyModelOutputs, classifyHabitatRisk, registerModelRun, calculateHabitatQuality,
    summarizeSiteConditions, explainResultsAndLimitations, exportScreeningReports,
    acquireEnvironmentalData, validateAndPrepareData, displayGeographicResults };
})(typeof window !== 'undefined' ? window : globalThis);
