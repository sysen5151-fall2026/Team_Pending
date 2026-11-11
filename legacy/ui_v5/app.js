/* Biodiversity Risk Map — web app v4.
 *
 * Navigation follows the IDEF0 decomposition from Innoslate (bio2):
 *   Home                       = Level 1 (Metafunction): five functions, one button each
 *   #/assess                   = F.2 Assess Spatial Biodiversity Conditions: seven Level-2 buttons
 *   #/assess/<step>            = one Level-2 function (F.2.1 ... F.2.7), runnable on its own
 *   #/assess/habitat           = F.2.3 Calculate Habitat Quality: six Level-3 steps (F.2.3.1 ... F.2.3.6)
 *   #/conservation, #/review, #/maintain, #/screen = the other Level-1 functions (F.1, F.3, F.4, F.5)
 * Every arrow on the diagrams is a named value in S.o (outputs) or S.ctl (controls); the
 * "Works with" strip on each page shows the function's inputs, controls and outputs and which are available.
 * All computation is done by brm-engine.js, a byte-identical port of the Python package brm/.
 */
/* global L, BRM */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (x, d = 2) => Number(x).toFixed(d);
  const clone = o => JSON.parse(JSON.stringify(o));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const NEEDED = ['TIGER-BOUNDARY', 'USGS-NLCD-LANDCOVER', 'OSM-ROADS', 'NLCD-DEVELOPED', 'NLCD-CULTIVATED', 'USGS-PADUS', 'GBIF-OCCURRENCES'];
  const S = { o: {}, maps: [], site: new Set(), layer: 'risk', fault: false };

  /* ------------------------------------------------------------------ function catalogue (names from the model, routes and plain descriptions) */
  const FN = {
    'F.1': { route: 'conservation', act: 'Set conservation priorities', desc: 'Find the best remaining habitat for your organization to protect, using the habitat-quality map.' },
    'F.2': { route: 'assess', act: 'Open the map system', desc: 'The Biodiversity Risk Map itself: it collects data, models habitat quality, summarizes sites, explains results and writes reports.' },
    'F.3': { route: 'review', act: 'Review evidence', desc: 'Review screening results, decide which data sources are approved and send review requests back to the map.' },
    'F.4': { route: 'maintain', act: 'Maintain the system', desc: 'Keep the habitat-model settings and data-quality rules up to date and publish new versions.' },
    'F.5': { route: 'screen', act: 'Screen a project', desc: 'Enter a proposed development, mark its site on the map and get a screening report.' },
    'F.2.1': { route: 'assess/acquire', desc: 'Load the environmental datasets for the planning area. Only sources on the approved list are accepted.' },
    'F.2.2': { route: 'assess/prepare', desc: 'Check every dataset against the data-quality rules and line them up on the county grid.' },
    'F.2.3': { route: 'assess/habitat', desc: 'Run the InVEST habitat-quality model in six checked steps.' },
    'F.2.4': { route: 'assess/summarize', desc: 'Summarize the cells a proposed site covers: risk, pressures and a recommendation.' },
    'F.2.5': { route: 'assess/display', desc: 'Draw the risk map and the habitat-quality map with a legend.' },
    'F.2.6': { route: 'assess/explain', desc: 'Explain what drives the result and what its limits are.' },
    'F.2.7': { route: 'assess/export', desc: 'Write the screening report and the cell table for download.' },
    'F.2.3.1': { desc: 'Gather land cover, distances to roads, development and farmland, and protection status for every cell.' },
    'F.2.3.2': { desc: 'Check the settings cover every threat and land-cover type, then freeze them under a settings version.' },
    'F.2.3.3': { desc: 'Compute degradation and habitat quality for every cell with the InVEST equations.' },
    'F.2.3.4': { desc: 'Release results only if every cell is present and every value is between 0 and 1. Otherwise ask for a re-run.' },
    'F.2.3.5': { desc: 'Turn habitat quality into a 0–1 risk score and one of five risk classes.' },
    'F.2.3.6': { desc: 'Record the run: data version, settings version, engine version and quality-check history.' },
  };
  const ROUTE2FN = Object.fromEntries(Object.entries(FN).filter(([, v]) => v.route).map(([k, v]) => [v.route, k]));
  const plain = t => String(t).replace(/^[FC](\.\d+)+\s+/, '');
  const fns = () => [].concat(S.model.level1.functions, S.model.level2.functions, S.model.level3.functions);
  const fdef = id => fns().find(f => f.id === id);

  /* ------------------------------------------------------------------ what each arrow means, for tooltips */
  const SOURCE_USE = { 'TIGER-BOUNDARY': 'County outline and the 1 km grid', 'USGS-NLCD-LANDCOVER': 'Land cover of each cell (forest, wetland, farmland, mixed)',
    'OSM-ROADS': 'Distance to the nearest road', 'NLCD-DEVELOPED': 'Distance to developed land (towns, buildings)', 'NLCD-CULTIVATED': 'Distance to farmland',
    'USGS-PADUS': 'Whether the cell is protected land', 'GBIF-OCCURRENCES': 'Number of species observations', 'SCRAPED-BLOG-LAYER': 'Unverified layer copied from a blog' };
  const ID_HELP = {
    DS: 'A fingerprint of exactly which data records were loaded.',
    MB: 'Input bundle: a fingerprint of the model inputs assembled for every cell.',
    PS: 'Settings version: a fingerprint of the frozen model settings (threat weights, distances, suitability, sensitivity, z, k). Any change gives a new ID.',
    RUN: 'Run ID: identifies one model run from its data version, input bundle, settings version and engine.',

  };
  const cellName = id => { const m = /^R(\d+)-C(\d+)$/.exec(id); return m ? `row ${+m[1]} from the south, column ${+m[2]} from the west` : id; };
  /* technical IDs are only shown folded away, each with a plain explanation */
  function tech(items) {
    const rows = items.filter(([, v]) => v);
    return rows.length ? `<details class="tech"><summary>Technical details for tracing this result</summary><dl>${rows.map(([label, v, help]) => `<dt>${esc(label)}: <code>${esc(v)}</code></dt><dd>${esc(help)}</dd>`).join('')}</dl></details>` : '';
  }
  const HELP = {
    DS: 'A fingerprint of exactly which data records were loaded. If any record changes, this code changes.',
    MB: 'A fingerprint of the model inputs assembled for all cells. Same inputs, same code.',
    PS: 'A fingerprint of every model setting. Changing any setting produces a different code, so a result can always be matched to the settings that made it.',
    RUN: 'Identifies this model run from the data, inputs, settings and software version. Re-running with the same data and settings gives the same run ID and the same numbers.',
    ENGINE: 'The habitat-quality method (InVEST, from the Natural Capital Project) and the exact release used.',
    CRS: 'All distances are measured in metres on the UTM zone 18 north map projection (code EPSG:26918), the standard flat-map grid for central New York.',
  };
  /* readable table of the habitat-model settings */
  function paramTable(p) {
    const tot = ['road', 'urban', 'agriculture'].reduce((a, t) => a + p.threats[t].weight, 0) || 1;
    const nm = { road: 'Roads', urban: 'Development (towns, buildings)', agriculture: 'Farmland' };
    const fade = { linear: 'fades evenly with distance', exponential: 'fades quickly, then slowly' };
    return `<table class="ptable"><tr><th>Threat</th><th>Importance</th><th>Reach</th><th>How the effect fades</th></tr>
      ${['road', 'urban', 'agriculture'].map(t => `<tr><td>${nm[t]}</td><td>${Math.round(p.threats[t].weight / tot * 100)}% <small>(weight ${p.threats[t].weight})</small></td><td>${p.threats[t].max_distance_km} km</td><td>${fade[p.threats[t].decay]}</td></tr>`).join('')}</table>
      <p class="small"><b>Importance</b> is each threat's share of the total weight. <b>Reach</b> is the distance beyond which the threat has no effect.</p>
      <table class="ptable"><tr><th>Land cover</th><th>Habitat suitability</th><th>Sensitivity to roads / development / farmland</th></tr>
      ${Object.keys(p.habitat_suitability).map(h => `<tr><td>${esc(h)}</td><td>${p.habitat_suitability[h]}</td><td>${['road', 'urban', 'agriculture'].map(t => p.sensitivity[h][t]).join(' / ')}</td></tr>`).join('')}</table>
      <p class="small"><b>Habitat suitability</b> (0–1): how good this land cover is as habitat when nothing threatens it. <b>Sensitivity</b> (0–1): how strongly that land cover reacts to each threat.</p>
      <p class="small"><b>Half-saturation constant k = ${p.k}</b>: the amount of degradation at which habitat quality is cut in half. <b>Scaling exponent z = ${p.z}</b>: how sharply quality drops once degradation passes k (InVEST recommends 2.5).
      Formula: habitat quality = suitability × (1 − D<sup>z</sup> ÷ (D<sup>z</sup> + k<sup>z</sup>)), where D is the combined threat degradation of the cell. Risk score = 1 − habitat quality.</p>`;
  }
  const RISK_SCALE = 'Risk score runs from 0 (intact, unthreatened habitat) to 1 (poor or heavily degraded habitat). Classes: Very high ≥ 0.80, High 0.60–0.79, Moderate 0.40–0.59, Low 0.20–0.39, Very low below 0.20.';
  const idTag = (v, label) => v ? `<span class="id" title="${esc(ID_HELP[String(v).split('-')[0]] || '')}">${esc(label)} <b>${esc(v)}</b></span>` : '';

  /* ------------------------------------------------------------------ availability of every IDEF0 arrow */
  const CONTROL_KEYS = { 'Approved source list': 'approved_source_list', 'Data-quality criteria': 'data_quality_criteria', 'Habitat-model parameters': 'habitat_model_parameters',
    'Site-summary rules': 'site_summary_rules', 'Map-display rules': 'map_display_rules', 'Interpretation rules': 'interpretation_rules', 'Report template': 'report_template' };
  function have(name) {
    if (CONTROL_KEYS[name]) return true;
    switch (name) {
      case 'Environmental datasets': return !!S.raw;
      case 'Planning area and data needs': case 'Planning area and layer selection': case 'Area and layer selection': case 'Map request': return true;
      case 'Site selection': return S.site.size > 0;
      case 'Review request': return !!S.o['Review request'];
      case 'Run log': case 'QA result': return (S.o[name] || []).length > 0;
      case 'Re-run request': return !!S.o['Re-run request'];
      default: return S.o[name] != null;
    }
  }
  const ORDER = ['Acquired datasets and metadata', 'Dataset identifier', 'Prepared datasets', 'Data-quality report', 'Coverage Validation Result',
    'Model input bundle', 'Threat-layer inventory', 'Approved parameter set', 'Raw model outputs', 'Run log', 'QA result', 'Re-run request',
    'Verified habitat rasters', 'Model run record', 'Habitat-quality and degradation results', 'Site screening summary',
    'Displayed risk map and legend', 'Habitat-quality map', 'Factor explanations and limitations', 'Screening report', 'Conservation priorities'];
  function invalidate(from) { const i = ORDER.indexOf(from); ORDER.slice(i).forEach(k => delete S.o[k]); }

  /* ------------------------------------------------------------------ runners (each = one IDEF0 box) */
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2600); }
  const R = {
    acquire() {
      const env = Object.fromEntries(Object.entries(S.raw).filter(([k]) => S.chosenSources.has(k)));
      const [acq, ds] = BRM.acquireEnvironmentalData(env, { area_id: S.areaName, needed_sources: NEEDED }, { approvedSourceList: S.ctl.approved_source_list });
      invalidate('Acquired datasets and metadata'); S.o['Acquired datasets and metadata'] = acq; S.o['Dataset identifier'] = ds;
    },
    prepare() {
      const [p, rep, cov] = BRM.validateAndPrepareData(S.o['Acquired datasets and metadata'], S.o['Dataset identifier'], { dataQualityCriteria: S.ctl.data_quality_criteria });
      invalidate('Prepared datasets'); Object.assign(S.o, { 'Prepared datasets': p, 'Data-quality report': rep, 'Coverage Validation Result': cov });
    },
    assemble() {
      const [b, inv] = BRM.assembleModelInputs(S.o['Prepared datasets']);
      invalidate('Model input bundle'); Object.assign(S.o, { 'Model input bundle': b, 'Threat-layer inventory': inv });
    },
    configure() {
      const ps = BRM.configureThreatAndSensitivityParameters(S.o['Threat-layer inventory'], { habitatModelParameters: S.ctl.habitat_model_parameters });
      invalidate('Approved parameter set'); S.o['Approved parameter set'] = ps;
    },
    execute() {
      const rr = S.o['Re-run request'] || null;
      const [raw, log] = BRM.executeHabitatQualityModel(S.o['Model input bundle'], rr, { approvedParameterSet: S.o['Approved parameter set'], faultInjection: S.fault ? { attempts: 1 } : null });
      if (!rr) { invalidate('Raw model outputs'); S.o['Run log'] = []; S.o['QA result'] = []; }
      ['Raw model outputs', 'Re-run request', 'Verified habitat rasters', 'Model run record', 'Habitat-quality and degradation results'].concat(ORDER.slice(ORDER.indexOf('Site screening summary'))).forEach(k => delete S.o[k]);
      S.o['Raw model outputs'] = raw; S.o['Run log'].push(log);
    },
    verify() {
      const [v, qa, rr] = BRM.verifyModelOutputs(S.o['Raw model outputs'], { expectedCells: S.o['Threat-layer inventory'].cell_count });
      S.o['QA result'].push(qa); delete S.o['Raw model outputs'];
      if (rr) { S.o['Re-run request'] = rr; delete S.o['Verified habitat rasters']; } else { delete S.o['Re-run request']; S.o['Verified habitat rasters'] = v; }
    },
    register() {
      S.o['Model run record'] = BRM.registerModelRun(S.o['Run log'], S.o['QA result']);
      if (S.o['Habitat-quality and degradation results']) S.o['Habitat-quality and degradation results'].run_id = S.o['Model run record'].run_id;
    },
    classify() {
      const res = BRM.classifyHabitatRisk(S.o['Verified habitat rasters'], { riskClasses: S.o['Approved parameter set'].risk_classes });
      if (S.o['Model run record']) res.run_id = S.o['Model run record'].run_id;
      invalidate('Habitat-quality and degradation results'); S.o['Habitat-quality and degradation results'] = res;
    },
    summarize() {
      const s = BRM.summarizeSiteConditions(S.o['Prepared datasets'], S.o['Habitat-quality and degradation results'], { layer: S.layer },
        { siteSelection: { name: S.siteName, cell_ids: [...S.site].sort() }, siteSummaryRules: S.ctl.site_summary_rules });
      invalidate('Site screening summary'); S.o['Site screening summary'] = s;
    },
    display() {
      const [m, hq] = BRM.displayGeographicResults(S.o['Prepared datasets'], S.o['Habitat-quality and degradation results'], S.o['Site screening summary'] || null,
        { layer: S.layer }, { requested_by: 'map page' }, { mapDisplayRules: S.ctl.map_display_rules });
      S.o['Displayed risk map and legend'] = m; S.o['Habitat-quality map'] = hq;
    },
    explain() {
      S.o['Factor explanations and limitations'] = BRM.explainResultsAndLimitations(S.o['Site screening summary'], S.o['Data-quality report'], S.o['Model run record'],
        { interpretationRules: S.ctl.interpretation_rules, reviewRequest: S.o['Review request'] || null });
      delete S.o['Screening report'];
    },
    exportReport() {
      S.o['Screening report'] = BRM.exportScreeningReports(S.o['Site screening summary'], S.o['Factor explanations and limitations'],
        { reportTemplate: S.ctl.report_template, generated: new Date().toISOString().slice(0, 10) });
    },
  };
  function habitatAll() {
    R.assemble(); R.configure(); R.execute(); R.verify();
    let n = 0; while (S.o['Re-run request'] && n++ < 2) { R.execute(); R.verify(); }
    R.register(); if (S.o['Verified habitat rasters']) R.classify();
  }
  /* run whatever is missing upstream so a Level-1 page can work (F.5 and F.1 use F.2 as a black box) */
  function ensure(target) {
    if (!have('Prepared datasets')) { if (!have('Acquired datasets and metadata')) R.acquire(); R.prepare(); }
    if (!have('Habitat-quality and degradation results') || !have('Model run record')) habitatAll();
    if (target === 'map') { R.display(); return; }
    if (target === 'report') { R.summarize(); R.display(); R.explain(); R.exportReport(); }
  }

  /* ------------------------------------------------------------------ maps */
  const hqColor = q => { const t = Math.max(0, Math.min(1, q)); const a = [230, 239, 219], b = [23, 63, 46]; return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; };
  function clearMaps() { S.maps.forEach(m => m.remove()); S.maps = []; }
  function legendHTML(layer) {
    const c = S.ctl.map_display_rules.colors;
    return layer === 'hq' ? ['0', '0.25', '0.5', '0.75', '1'].map(q => `<span style="background:${hqColor(+q)}" class="${+q < .5 ? 'dk' : ''}">Q ${q}</span>`).join('')
      : Object.keys(c).reverse().map(k => `<span style="background:${c[k]}" class="${k === 'Moderate' || k === 'Low' ? 'dk' : ''}">${k}</span>`).join('');
  }
  function mountMap(el, { layer = 'risk', select = false, highlight = null, onCell = null } = {}) {
    const res = S.o['Habitat-quality and degradation results'];
    const R2 = res ? Object.fromEntries(res.cells.map(c => [c.cell_id, c])) : {};
    const P = S.o['Prepared datasets'] ? Object.fromEntries(S.o['Prepared datasets'].cells.map(c => [c.cell_id, c])) : {};
    const map = L.map(el, { zoomSnap: 0.25, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, opacity: 0.6, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    const gj = { type: 'FeatureCollection', features: S.raw['TIGER-BOUNDARY'].records.map(g => ({ type: 'Feature', properties: { cell_id: g.cell_id }, geometry: { type: 'Polygon', coordinates: g.geometry } })) };
    const style = f => {
      const id = f.properties.cell_id, r = R2[id], gap = P[id] && P[id].species_count == null;
      const sel = select && S.site.has(id), hi = highlight && highlight.has(id);
      return { fillColor: r ? (layer === 'hq' ? hqColor(r.habitat_quality) : S.ctl.map_display_rules.colors[r.risk_class]) : '#C9D3CE',
        fillOpacity: highlight ? (hi ? .92 : .25) : S.ctl.map_display_rules.fill_opacity, color: sel || hi ? '#E3A72F' : (gap ? '#6E1F1B' : '#fff'),
        weight: sel || hi ? 3.5 : (gap ? 1.6 : .7), dashArray: gap && !sel ? '4 3' : null };
    };
    const lyr = L.geoJSON(gj, { style, onEachFeature: (f, l) => {
      const id = f.properties.cell_id;
      l.bindTooltip(() => { const r = R2[id]; return `<b>${id}</b> <span style="color:#5B6B70">(${cellName(id)})</span>${r ? `<br>${esc(r.land_cover)}, risk ${fmt(r.risk_score)} (${r.risk_class.toLowerCase()}), habitat quality ${fmt(r.habitat_quality)}` : '<br>Not scored yet: the habitat model has not run'}`; }, { sticky: true });
      l.on('click', () => { if (select) { S.site.has(id) ? S.site.delete(id) : S.site.add(id); lyr.setStyle(style); } if (onCell) onCell(id); });
    } }).addTo(map);
    setTimeout(() => { map.invalidateSize(); map.fitBounds(lyr.getBounds(), { padding: [12, 12] }); }, 0);
    S.maps.push(map); return { map, restyle: () => lyr.setStyle(style) };
  }

  /* ------------------------------------------------------------------ shared page parts */
  function header(fid, extra = '') {
    const f = fdef(fid);
    return `<div class="phead"><div><div class="who"><i></i>Performed by ${esc(plain(f.mechanism))}</div><h1>${esc(f.name)}</h1><p class="muted">${esc(FN[fid].desc)}</p></div><div>${extra}</div></div>`;
  }
  function icom(fid) {
    const f = fdef(fid);
    const col = (t, list) => `<div><h3>${t}</h3>${(list || []).length ? list.map(n => `<span class="flow ${have(n) ? 'ok' : ''}" title="${have(n) ? 'Available' : 'Not available yet'}">${esc(n)}</span>`).join('') : '<span class="muted small">None</span>'}</div>`;
    return `<div class="icom">${col('Takes in', f.inputs)}${col('Follows these rules', f.controls)}${col('Produces', f.outputs)}</div>`;
  }
  const need = (msg, btnLabel, id) => `<div class="need"><span>${msg}</span>${btnLabel ? `<button class="btn gold" id="${id}">${btnLabel}</button>` : ''}</div>`;
  function setCrumbs(trail) {
    $('crumbs').innerHTML = [['Home', '#/']].concat(trail).map(([t, h], i, a) => i === a.length - 1 ? `<b>${esc(t)}</b>` : `<a href="${h}">${esc(t)}</a><span class="sep">›</span>`).join('');
  }
  function setStatus() {
    const st = [[have('Prepared datasets') ? 'Data checked' : have('Acquired datasets and metadata') ? 'Data loaded' : 'No data loaded', have('Acquired datasets and metadata')],
      [have('Habitat-quality and degradation results') && have('Model run record') ? 'Habitat model run' : 'Habitat model not run', have('Model run record')],
      [have('Site screening summary') ? `Site: ${S.o['Site screening summary'].cell_count} cells` : 'No site screened', have('Site screening summary')]];
    $('status').innerHTML = st.map(([l, on]) => `<span class="${on ? 'on' : ''}">${esc(l)}</span>`).join('');
  }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 500); }
  const kidState = fid => {
    const out = fdef(fid).outputs; const done = out.every(have) || (fid === 'F.2.3' && have('Habitat-quality and degradation results') && have('Model run record'));
    const ready = fdef(fid).inputs.filter(n => !['Re-run request', 'Map request', 'Planning area and layer selection', 'Area and layer selection'].includes(n)).every(have);
    return done ? 'done' : ready ? 'ready' : '';
  };

  /* ================================================================== PAGES */
  const PAGES = {};

  /* ---------- Home: Level 1 ---------- */
  PAGES[''] = () => {
    setCrumbs([]);
    const f = id => fdef(id);
    const card = (id, cls) => {
      const d = f(id), toF2 = (d.outputs || []).filter(o => f('F.2').inputs.concat(f('F.2').controls).includes(o)), fromF2 = (d.inputs || []).filter(o => f('F.2').outputs.includes(o));
      return `<a class="fbtn ${cls}" href="#/${FN[id].route}"><span class="act">${FN[id].act}</span><h2>${esc(d.name)}</h2><p>${esc(FN[id].desc)}</p>
        <div class="gives">Done by <b>${esc(plain(d.mechanism))}</b>${toF2.length ? `<br>Sends the map: ${toF2.map(esc).join(', ')}` : ''}${fromF2.length ? `<br>Gets from the map: ${fromF2.map(esc).join(', ')}` : ''}</div></a>`;
    };
    const core = f('F.2');
    $('app').innerHTML = `
      <section class="intro"><div><h1>Screen development sites for biodiversity risk, before decisions are made.</h1>
        <p class="muted">A prototype for Tompkins County, NY. Pick what you need to do below. The large button opens the map system itself; the others are the people and organizations that work with it.</p></div>
        <div><div class="mapcard" id="homeMap"></div><p class="muted small">${have('Habitat-quality and degradation results') ? 'Coloured by the latest model run.' : 'The 168 one-kilometre cells of the county. They are coloured once the habitat model has run.'}</p></div></section>
      <section class="funcs">
        <a class="fbtn core" href="#/assess"><div><span class="act">${FN['F.2'].act}</span><h2 style="font-size:1.5rem;margin:6px 0">${esc(core.name)}</h2><p>${esc(FN['F.2'].desc)}</p></div>
          <div><div class="ministeps">${S.model.level2.functions.map(k => `<span class="${kidState(k.id) === 'done' ? 'done' : ''}">${esc(k.name)}</span>`).join('')}</div>
          <div class="gives" style="margin-top:12px">Done by <b>${esc(plain(core.mechanism))}</b></div></div></a>
        ${card('F.5', 'side')}${card('F.1', 'side')}${card('F.3', 'side')}${card('F.4', 'side')}
      </section>`;
    mountMap($('homeMap'), {});
    if (have('Habitat-quality and degradation results')) $('homeMap').insertAdjacentHTML('afterend', `<div class="legend">${legendHTML('risk')}</div>`);
  };

  /* ---------- Assess Spatial Biodiversity Conditions: Level 2 hub ---------- */
  PAGES.assess = () => {
    setCrumbs([[fdef('F.2').name, '#/assess']]);
    const res = { 'F.2.1': () => have('Dataset identifier') && `${S.o['Acquired datasets and metadata'].metadata.length} sources loaded, ${S.o['Acquired datasets and metadata'].rejected_sources.length} rejected`,
      'F.2.2': () => have('Coverage Validation Result') && `${S.o['Coverage Validation Result'].prepared_cells} cells ready, ${S.o['Data-quality report'].data_gap_cells.length} with missing species records`,
      'F.2.3': () => have('Model run record') && have('Habitat-quality and degradation results') && `All 168 cells scored, quality check ${S.o['Model run record'].final_qa === 'PASS' ? 'passed' : 'failed'}`,
      'F.2.4': () => have('Site screening summary') && `${S.o['Site screening summary'].site_name}: ${S.o['Site screening summary'].risk_class.toLowerCase()} risk`,
      'F.2.5': () => have('Displayed risk map and legend') && 'Risk map and habitat-quality map drawn',
      'F.2.6': () => have('Factor explanations and limitations') && `${S.o['Factor explanations and limitations'].factors.length} factors explained`,
      'F.2.7': () => have('Screening report') && 'Report ready to download' };
    $('app').innerHTML = header('F.2', `<div class="btns"><button class="btn" id="runAll">Run all seven in order</button><button class="btn quiet" id="resetAll">Start over</button></div>`) + icom('F.2') + `
      <section class="children"><h2>What happens inside</h2><p class="muted small">Open each step in order, or run them all at once. A step turns yellow when everything it needs is available.</p>
      <div class="kids">${S.model.level2.functions.map(k => { const st = kidState(k.id), r = res[k.id](); return `<a class="kid ${st}" href="#/${FN[k.id].route}"><span class="n"></span><h3>${esc(k.name)}</h3>
        <span class="st">${st === 'done' ? 'Done' : st === 'ready' ? 'Ready to run' : 'Waiting for an earlier step'}</span><p>${esc(FN[k.id].desc)}</p>${r ? `<div class="res">${esc(r)}</div>` : ''}</a>`; }).join('')}</div></section>`;
    $('runAll').onclick = () => { if (!S.site.size) S.demoSite.cell_ids.forEach(c => S.site.add(c)); ensure('report'); toast('All seven steps ran'); render(); };
    $('resetAll').onclick = () => { S.o = {}; toast('Cleared all results'); render(); };
  };

  /* ---------- Acquire Environmental Data ---------- */
  PAGES['assess/acquire'] = () => {
    setCrumbs([[fdef('F.2').name, '#/assess'], [fdef('F.2.1').name, '']]);
    const approved = new Set(S.ctl.approved_source_list.approved_sources);
    const acq = S.o['Acquired datasets and metadata'];
    $('app').innerHTML = header('F.2.1') + icom('F.2.1') + `<div class="work">
      <div class="box"><h2>Request data</h2><form id="f" onsubmit="return false">
        <label class="f">Planning area <span>From the local planner</span><input type="text" id="area" value="${esc(S.areaName)}"></label>
        <div><div class="grp">Environmental datasets offered</div>${Object.values(S.raw).sort((a, b) => a.source_id.localeCompare(b.source_id)).map(d => `
          <label class="check"><input type="checkbox" value="${d.source_id}" ${S.chosenSources.has(d.source_id) ? 'checked' : ''}>
          <span>${esc(d.title)} ${approved.has(d.source_id) ? '<span class="tag">Approved</span>' : '<span class="tag bad">Not approved</span>'}<small>${esc(SOURCE_USE[d.source_id] || '')}</small></span></label>`).join('')}</div>
        <button class="btn" id="go">Acquire data</button><p class="muted small">The approved list is set by government agencies. <a href="#/review">Change it</a>.</p></form></div>
      <div>${!acq ? '<div class="empty">Choose datasets and press Acquire data.</div>' : `<div class="box"><h2>Acquired datasets and metadata</h2>
        <p class="small muted">One record = the value for one grid cell. The county is divided into 168 cells of 1 km × 1 km.</p>
        <table><tr><th>Source</th><th>What it provides</th><th>Records</th><th></th></tr>
        ${acq.metadata.map(m => `<tr><td>${esc(m.title)}<br><small>retrieved ${m.retrieved}, licence ${esc(m.license)}</small></td><td><small>${esc(SOURCE_USE[m.source_id] || '')}</small></td><td>${m.records}</td><td><span class="tag">Accepted</span></td></tr>`).join('')}
        ${acq.rejected_sources.map(r => `<tr><td>${esc(S.raw[r.source_id] ? S.raw[r.source_id].title : r.source_id)}</td><td><small>Not on the agency-approved list, so it is not used.</small></td><td></td><td><span class="tag bad">Rejected</span></td></tr>`).join('')}</table>
        ${tech([['Data version', S.o['Dataset identifier'], HELP.DS]])}
        ${acq.missing_sources.length ? `<div class="warn" style="margin-top:10px">Missing needed sources: ${acq.missing_sources.join(', ')}. The next step may fail.</div>` : '<div class="okmsg" style="margin-top:10px">All seven needed sources are in. Next: <a href="#/assess/prepare">Validate and Prepare Data</a>.</div>'}</div>`}</div></div>`;
    $('go').onclick = () => { S.areaName = $('area').value || 'Tompkins County, NY'; S.chosenSources = new Set([...document.querySelectorAll('#f input[type=checkbox]:checked')].map(i => i.value)); R.acquire(); toast('Data acquired'); render(); };
  };

  /* ---------- Validate and Prepare Data ---------- */
  PAGES['assess/prepare'] = () => {
    setCrumbs([[fdef('F.2').name, '#/assess'], [fdef('F.2.2').name, '']]);
    const c = S.ctl.data_quality_criteria, cov = S.o['Coverage Validation Result'], rep = S.o['Data-quality report'], p = S.o['Prepared datasets'];
    $('app').innerHTML = header('F.2.2') + icom('F.2.2') + `<div class="work">
      <div class="box"><h2>Data-quality criteria</h2><p class="muted small">Set by the IT team (<a href="#/maintain">change them</a>).</p>
        <ul class="plain"><li>Every dataset is aligned to the same grid of ${c.cell_size_m / 1000} km × ${c.cell_size_m / 1000} km cells, measured in metres.</li>
        <li>At most ${c.max_missing_fraction * 100}% of cells may lack land cover, distances or protection status; otherwise coverage is marked incomplete.</li>
        <li>Cells with no species observations are kept but flagged, because their biodiversity value may be under-estimated.</li></ul>
        ${tech([['Map projection', c.target_crs, HELP.CRS]])}
        ${have('Acquired datasets and metadata') ? '<button class="btn" id="go">Validate and prepare</button>' : need('Acquire the data first.', 'Acquire data now', 'pre')}</div>
      <div>${!p ? '<div class="empty">Results appear here after validation.</div>' : `<div class="box"><h2>Coverage validation result</h2>
        <div class="stats"><div>Coverage<b>${cov.status === 'COMPLETE' ? 'Complete' : 'Incomplete'}</b></div><div>Cells ready<b>${cov.prepared_cells} of ${cov.grid_cells}</b></div><div>Missing species records<b>${rep.data_gap_cells.length} cells</b></div></div>
        ${rep.data_gap_warning ? `<div class="warn">${esc(rep.data_gap_warning)} Cells ${rep.data_gap_cells.join(', ')}.</div>` : ''}</div>
        <div class="box"><h2>Data-quality report</h2><ul class="plain">${rep.issues.map(i => `<li>${esc(i.source_id)}: ${esc(i.issue)}</li>`).join('') || '<li>No issues.</li>'}${rep.rejected_sources.map(r => `<li>${esc(r.source_id)} was rejected: ${esc(r.reason)}.</li>`).join('')}</ul></div>
        <div class="box"><h2>Prepared datasets</h2><p class="muted small">One row per grid cell, ${p.cells.length} rows. A cell named R01-C03 is in row 1 counted from the south edge and column 3 counted from the west edge. First six rows:</p>
        <table><tr><th>Cell</th><th>Land cover</th><th>Nearest road (km)</th><th>Nearest development (km)</th><th>Nearest farmland (km)</th><th>Protected land</th><th>Species observations</th></tr>
        ${p.cells.slice(0, 6).map(r => `<tr><td>${r.cell_id}</td><td>${esc(r.land_cover)}</td><td>${r.dist_road_km}</td><td>${r.dist_urban_km}</td><td>${r.dist_agriculture_km}</td><td>${r.protected ? 'Yes' : 'No'}</td><td>${r.species_count == null ? '<span class="tag bad">missing</span>' : r.species_count}</td></tr>`).join('')}</table>
        <div class="okmsg" style="margin-top:10px">Next: <a href="#/assess/habitat">Calculate Habitat Quality</a>.</div></div>`}</div></div>`;
    if ($('go')) $('go').onclick = () => { R.prepare(); toast('Data validated and prepared'); render(); };
    if ($('pre')) $('pre').onclick = () => { R.acquire(); render(); };
  };

  /* ---------- Calculate Habitat Quality: Level 3 ---------- */
  PAGES['assess/habitat'] = () => {
    setCrumbs([[fdef('F.2').name, '#/assess'], [fdef('F.2.3').name, '']]);
    const p = S.ctl.habitat_model_parameters, o = S.o;
    const lastLog = (o['Run log'] || []).slice(-1)[0], lastQA = (o['QA result'] || []).slice(-1)[0];
    const steps = [
      { id: 'F.2.3.1', run: 'assemble', can: have('Prepared datasets'), done: have('Model input bundle'),
        out: () => `<b>Model input bundle</b>: inputs gathered for all ${o['Model input bundle'].cells.length} cells. Protected cells count threats at 30% strength, because protection limits access.<br><b>Threat-layer inventory</b>: 3 threats found (roads, development, farmland) and ${o['Threat-layer inventory'].land_cover_classes.length} land-cover types (${o['Threat-layer inventory'].land_cover_classes.join(', ').toLowerCase()}).${tech([['Input bundle code', o['Model input bundle'].bundle_id, HELP.MB], ['Map projection', o['Model input bundle'].crs, HELP.CRS]])}` },
      { id: 'F.2.3.2', run: 'configure', can: have('Threat-layer inventory'), done: have('Approved parameter set'),
        extra: `<details class="tech" ${have('Approved parameter set') ? '' : 'open'}><summary>Settings this step checks (set by the IT team, <a href="#/maintain">change them</a>)</summary>${paramTable(p)}</details>`,
        out: () => { const ps = o['Approved parameter set']; return `<b>Approved parameter set</b>: the settings cover all 3 threats and all ${Object.keys(ps.habitat_suitability).length} land-cover types, and are now frozen for this run. Threat importance: roads ${Math.round(ps.threats.road.weight_norm * 100)}%, development ${Math.round(ps.threats.urban.weight_norm * 100)}%, farmland ${Math.round(ps.threats.agriculture.weight_norm * 100)}%.${tech([['Settings version', ps.parameter_set_id, HELP.PS], ['Model software', `${ps.invest_model} ${ps.invest_version}`, HELP.ENGINE]])}`; } },
      { id: 'F.2.3.3', run: 'execute', can: have('Model input bundle') && have('Approved parameter set') && (!have('Verified habitat rasters') || true), done: have('Raw model outputs') || have('Verified habitat rasters'),
        extra: `<label class="check"><input type="checkbox" id="fault" ${S.fault ? 'checked' : ''}><span>Simulate a faulty first run<small>Corrupts one cell on attempt 1 so the quality check sends it back.</small></span></label>${o['Re-run request'] ? `<div class="warn">Re-run requested: ${esc(o['Re-run request'].reason)}. Run this step again.</div>` : ''}`,
        out: () => lastLog ? `<b>Raw model outputs</b>: degradation and habitat quality computed for ${lastLog.cells_processed} cells${have('Raw model outputs') ? '; waiting for the quality check' : '; handed to the quality check'}.<br><b>Run log</b>: attempt ${lastLog.attempt}, took ${fmt(lastLog.duration_ms, 1)} milliseconds${lastLog.rerun_reason ? '. This was a re-run because the quality check rejected the previous attempt' : ''}.` : '' },
      { id: 'F.2.3.4', run: 'verify', can: have('Raw model outputs'), done: have('Verified habitat rasters'), fail: have('Re-run request'),
        out: () => lastQA ? `<b>QA result</b>: ${lastQA.status === 'PASS' ? `passed. All ${lastQA.checked_cells} cells are present and every value is between 0 and 1.` : `failed. ${lastQA.failures.map(f => `Cell ${f.cell_id} has an invalid ${f.field.replace('_', ' ')} (${/nan/i.test(f.value) ? 'not a number' : f.value})`).join('; ')}.`}<br>${o['Re-run request'] ? '<b>Re-run request</b> sent back to Execute Habitat Quality Model. Run step 3 again.' : '<b>Verified habitat rasters</b>: results released to the next steps.'}` : '' },
      { id: 'F.2.3.5', run: 'classify', can: have('Verified habitat rasters'), done: have('Habitat-quality and degradation results'),
        out: () => { const r = o['Habitat-quality and degradation results']; const c = S.ctl.map_display_rules.colors; return `<b>Habitat-quality and degradation results</b>, number of cells in each risk class: ${Object.entries(r.class_counts).map(([k, v]) => `<span style="color:${c[k]};font-weight:700">${k} ${v}</span>`).join(', ')}.<br><span class="small muted">${RISK_SCALE}</span>`; } },
      { id: 'F.2.3.6', run: 'register', can: have('Run log') && have('QA result') && !have('Raw model outputs'), done: have('Model run record'),
        out: () => { const r = o['Model run record']; return `<b>Model run record</b> saved: ${r.attempts} attempt${r.attempts > 1 ? 's' : ''}, final quality check ${r.final_qa === 'PASS' ? 'passed' : 'failed'}. The record ties the result to the exact data, settings and software, so anyone can reproduce it.${tech([['Run ID', r.run_id, HELP.RUN], ['Data version', r.dataset_id, HELP.DS], ['Settings version', r.parameter_set_id, HELP.PS], ['Model software', r.engine, HELP.ENGINE]])}`; } },
    ];
    $('app').innerHTML = header('F.2.3', `<div class="btns"><button class="btn" id="all" ${have('Prepared datasets') ? '' : 'disabled'}>Run all six steps</button><button class="btn quiet" id="slow" ${have('Prepared datasets') ? '' : 'disabled'}>Play them slowly</button></div>`) + icom('F.2.3') +
      (have('Prepared datasets') ? '' : need('This model needs the prepared datasets.', 'Acquire and prepare data now', 'pre')) + `
      <h2 style="margin:18px 0 12px">The six steps inside</h2>
      <ol class="steps">${steps.map(s => { const f = fdef(s.id); const cls = s.fail ? 'fail' : s.done ? 'done' : s.can ? 'ready' : ''; return `<li class="step ${cls}" id="st-${s.run}"><div class="card">
        <div class="top"><div><h3>${esc(f.name)}</h3><div class="who">${esc(plain(f.mechanism))}</div></div><button class="btn ${s.can ? '' : 'quiet'}" data-run="${s.run}" ${s.can ? '' : 'disabled'}>${s.done && !s.fail ? 'Run again' : 'Run'}</button></div>
        <p class="muted small">${esc(FN[s.id].desc)}</p>
        <div class="io">Takes <b>${f.inputs.map(esc).join(', ')}</b>${f.controls.length ? `; follows <b>${f.controls.map(esc).join(', ')}</b>` : ''}; produces <b>${f.outputs.map(esc).join(', ')}</b>.</div>
        ${s.extra ? `<div class="extra">${s.extra}</div>` : ''}${(s.done || s.fail) && s.out() ? `<div class="out">${s.out()}</div>` : ''}</div></li>`; }).join('')}</ol>
      ${have('Habitat-quality and degradation results') && have('Model run record') ? `<div class="okmsg">Habitat quality is calculated. Next: <a href="#/assess/summarize">Summarize Site Conditions</a> or <a href="#/assess/display">Display Geographic Results</a>.</div>` : ''}`;
    document.querySelectorAll('[data-run]').forEach(b => b.onclick = () => { const k = b.dataset.run; R[k](); render(); const el = $('st-' + k); if (el) el.scrollIntoView({ block: 'center' }); });
    if ($('fault')) $('fault').onchange = e => { S.fault = e.target.checked; };
    if ($('pre')) $('pre').onclick = () => { R.acquire(); R.prepare(); render(); };
    $('all').onclick = () => { habitatAll(); toast('Habitat quality calculated'); render(); };
    $('slow').onclick = async () => {
      const seq = ['assemble', 'configure', 'execute', 'verify']; for (const k of seq) { R[k](); render(); $('st-' + k).scrollIntoView({ block: 'center', behavior: 'smooth' }); await sleep(900); }
      let n = 0; while (S.o['Re-run request'] && n++ < 2) for (const k of ['execute', 'verify']) { R[k](); render(); $('st-' + k).scrollIntoView({ block: 'center', behavior: 'smooth' }); await sleep(900); }
      for (const k of ['register', 'classify']) { R[k](); render(); $('st-' + k).scrollIntoView({ block: 'center', behavior: 'smooth' }); await sleep(900); }
    };
  };

  /* ---------- Summarize Site Conditions ---------- */
  function siteResultHTML(s) {
    const c = S.ctl.map_display_rules.colors[s.risk_class];
    return `<div class="stats"><div>Mean risk<b style="color:${c}">${fmt(s.mean_risk)} ${s.risk_class}</b></div><div>Highest-risk cell<b>${s.max_cell}, ${fmt(s.max_risk)}</b></div>
      <div>Above review threshold<b>${s.cells_over_threshold} of ${s.cell_count}</b></div><div>Species records<b>${s.species_count}</b></div>
      <div>Habitat quality<b>${fmt(s.mean_habitat_quality)}</b></div><div>Degradation<b>${fmt(s.mean_degradation)}</b></div></div>
      <div class="rec"><b>Recommendation:</b> ${esc(s.recommendation)}</div>${s.data_gap_cells.length ? `<div class="warn" style="margin-top:8px">No species records for ${s.data_gap_cells.join(', ')}. Risk may be understated there.</div>` : ''}
      <p class="small muted" style="margin-top:8px">${RISK_SCALE} A cell counts as above the review threshold when its score is at least ${S.ctl.site_summary_rules.review_threshold}. The highest-risk cell ${s.max_cell} is ${cellName(s.max_cell)}.</p>`;
  }
  function siteSelector(id) {
    return `<label class="f">Site name<input type="text" id="sname" value="${esc(S.siteName)}"></label>
      <div class="grp">Site selection: click cells on the map</div><div class="chips" id="${id}">${[...S.site].sort().map(c => `<button type="button" class="chip" data-c="${c}">${c} ×</button>`).join('') || '<span class="muted small">No cells yet</span>'}</div>
      <div class="btns"><button type="button" class="btn quiet" id="demo">Use Route 13 parcel</button><button type="button" class="btn quiet" id="clr">Clear</button></div>`;
  }
  function bindSelector(chipsId, after) {
    const sync = () => { $(chipsId).innerHTML = [...S.site].sort().map(c => `<button type="button" class="chip" data-c="${c}">${c} ×</button>`).join('') || '<span class="muted small">No cells yet</span>';
      $(chipsId).querySelectorAll('.chip').forEach(ch => ch.onclick = () => { S.site.delete(ch.dataset.c); S.mapRef && S.mapRef.restyle(); sync(); }); };
    $('sname').onchange = () => { S.siteName = $('sname').value; };
    $('demo').onclick = () => { S.site = new Set(S.demoSite.cell_ids); S.siteName = S.demoSite.name; $('sname').value = S.siteName; S.mapRef.restyle(); sync(); };
    $('clr').onclick = () => { S.site.clear(); S.mapRef.restyle(); sync(); };
    sync(); return () => { sync(); if (after) after(); };
  }
  PAGES['assess/summarize'] = () => {
    setCrumbs([[fdef('F.2').name, '#/assess'], [fdef('F.2.4').name, '']]);
    const ok = have('Habitat-quality and degradation results') && have('Prepared datasets'), s = S.o['Site screening summary'];
    $('app').innerHTML = header('F.2.4') + icom('F.2.4') + `<div class="work"><div class="box"><h2>Choose the site</h2><form onsubmit="return false">${siteSelector('chips')}
      <p class="muted small">Review threshold ${S.ctl.site_summary_rules.review_threshold} (set by the local planner).</p>
      ${ok ? '<button class="btn" id="go">Summarize site</button>' : need('Needs habitat-quality results.', 'Run the earlier steps', 'pre')}</form></div>
      <div><div class="map" id="m"></div>${s ? `<div class="box" style="margin-top:16px"><h2>Site screening summary: ${esc(s.site_name)}</h2>${siteResultHTML(s)}
        <div class="okmsg" style="margin-top:10px">Next: <a href="#/assess/explain">Explain Results and Limitations</a>.</div></div>` : ''}</div></div>`;
    S.mapRef = mountMap($('m'), { select: true, onCell: () => onCellSync() });
    const onCellSync = bindSelector('chips');
    if ($('go')) $('go').onclick = () => { if (!S.site.size) { toast('Pick at least one cell'); return; } S.siteName = $('sname').value; R.summarize(); toast('Site summarized'); render(); };
    if ($('pre')) $('pre').onclick = () => { ensure(); render(); };
  };

  /* ---------- Display Geographic Results ---------- */
  PAGES['assess/display'] = () => {
    setCrumbs([[fdef('F.2').name, '#/assess'], [fdef('F.2.5').name, '']]);
    const ok = have('Habitat-quality and degradation results'), drawn = have('Displayed risk map and legend');
    $('app').innerHTML = header('F.2.5') + icom('F.2.5') + (!ok ? need('Needs habitat-quality results.', 'Run the earlier steps', 'pre') : !drawn ? need('Results are ready to be drawn.', 'Display results', 'go') : `
      <div class="work"><div class="box"><div class="seg"><button data-l="risk" class="${S.layer === 'risk' ? 'on' : ''}">Displayed risk map</button><button data-l="hq" class="${S.layer === 'hq' ? 'on' : ''}">Habitat-quality map</button></div>
        <div id="cell"><p class="muted small">Click a cell to see what drives its score.</p></div></div>
        <div><div class="map" id="m"></div><div class="legend" id="lg">${legendHTML(S.layer)}</div><p class="muted small">${esc(S.ctl.map_display_rules.attribution)}. Dashed outline: no species records.</p></div></div>`);
    if ($('pre')) $('pre').onclick = () => { ensure(); render(); };
    if ($('go')) $('go').onclick = () => { R.display(); render(); };
    if (!drawn) return;
    const P = Object.fromEntries(S.o['Prepared datasets'].cells.map(c => [c.cell_id, c]));
    const RR = Object.fromEntries(S.o['Habitat-quality and degradation results'].cells.map(c => [c.cell_id, c]));
    mountMap($('m'), { layer: S.layer, onCell: id => {
      const r = RR[id], p = P[id]; const bar = (n, v) => `<div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:.82rem"><span>${n}</span><b>${fmt(v)}</b></div><div style="height:6px;background:#E6ECE8;border-radius:3px"><i style="display:block;height:6px;border-radius:3px;background:var(--lake-2);width:${v * 100}%"></i></div></div>`;
      $('cell').innerHTML = `<h3>${id}, ${esc(r.land_cover.toLowerCase())}${p.protected ? ', protected' : ''}</h3><p style="font-size:1.6rem;font-weight:800;margin:4px 0;color:${S.ctl.map_display_rules.colors[r.risk_class]}">${fmt(r.risk_score)} <span style="font-size:.9rem">${r.risk_class} risk</span></p>
        <p class="small muted">${cellName(id)}</p>
        ${bar('Habitat suitability', r.habitat_suitability)}${bar('Road pressure', r.threat_impact.road)}${bar('Development pressure', r.threat_impact.urban)}${bar('Farmland pressure', r.threat_impact.agriculture)}${bar('Degradation', r.degradation)}${bar('Habitat quality', r.habitat_quality)}
        <p class="small muted">All values run from 0 to 1. Suitability: how good the land cover is as habitat. Pressure: how close and strong each threat is (1 = right at the cell). Degradation: all pressures combined, weighted by importance and the land cover's sensitivity. Habitat quality: suitability reduced by degradation. Risk = 1 − habitat quality.</p>
        <p class="small">${p.species_count == null ? '<span class="tag bad">No species records</span>' : `${p.species_count} species records`}</p>`;
    } });
    document.querySelectorAll('.seg button').forEach(b => b.onclick = () => { S.layer = b.dataset.l; render(); });
  };

  /* ---------- Explain Results and Limitations ---------- */
  PAGES['assess/explain'] = () => {
    setCrumbs([[fdef('F.2').name, '#/assess'], [fdef('F.2.6').name, '']]);
    const ok = have('Site screening summary') && have('Model run record') && have('Data-quality report'), x = S.o['Factor explanations and limitations'], rr = S.o['Review request'];
    $('app').innerHTML = header('F.2.6') + icom('F.2.6') + `<div class="work"><div class="box"><h2>Rules and requests</h2>
      <p class="small"><b>Interpretation rules</b> (set by government agencies): ${S.ctl.interpretation_rules.limitations.length} standing limitations and a disclaimer.</p>
      <p class="small"><b>Review request</b>: ${rr ? `${esc(rr.decision)} from ${esc(rr.reviewer)}, ${esc(rr.agency)}` : 'none yet'} (<a href="#/review">send one</a>).</p>
      ${ok ? '<button class="btn" id="go">Explain results</button>' : need('Needs a site screening summary.', 'Go to Summarize Site Conditions', 'pre')}</div>
      <div>${!x ? '<div class="empty">Explanations appear here.</div>' : `<div class="box"><h2>Why this score: ${esc(S.o['Site screening summary'].site_name)}</h2><ul class="plain">${x.factors.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <h3 style="margin-top:12px">Limitations</h3><ul class="plain">${x.limitations.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        ${x.review_request ? `<div class="note"><b>Agency review:</b> ${esc(x.review_request.decision)}. ${esc(x.review_request.comment)}</div>` : ''}
        <p class="muted small" style="margin-top:10px">${esc(x.disclaimer)}</p>${tech([['Run ID', x.provenance.run_id, HELP.RUN], ['Data version', x.provenance.dataset_id, HELP.DS], ['Settings version', x.provenance.parameter_set_id, HELP.PS]])}
        <div class="okmsg">Next: <a href="#/assess/export">Export Screening Reports</a>.</div></div>`}</div></div>`;
    if ($('go')) $('go').onclick = () => { R.explain(); toast('Results explained'); render(); };
    if ($('pre')) $('pre').onclick = () => { location.hash = '#/assess/summarize'; };
  };

  /* ---------- Export Screening Reports ---------- */
  function md2html(md) {
    const inl = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); let h = '', list = false;
    md.split('\n').forEach(l => { if (/^- /.test(l)) { if (!list) { h += '<ul>'; list = true; } h += `<li>${inl(l.slice(2))}</li>`; return; } if (list) { h += '</ul>'; list = false; }
      if (/^# /.test(l)) h += `<h1>${inl(l.slice(2))}</h1>`; else if (/^## /.test(l)) h += `<h2>${inl(l.slice(3))}</h2>`; else if (/^> /.test(l)) h += `<blockquote>${inl(l.slice(2))}</blockquote>`; else if (l.trim()) h += `<p class="meta">${inl(l)}</p>`; });
    return h + (list ? '</ul>' : '');
  }
  PAGES['assess/export'] = () => {
    setCrumbs([[fdef('F.2').name, '#/assess'], [fdef('F.2.7').name, '']]);
    const ok = have('Factor explanations and limitations') && have('Site screening summary'), rep = S.o['Screening report'];
    $('app').innerHTML = header('F.2.7') + icom('F.2.7') + `<div class="work"><div class="box"><h2>Report template</h2><p class="small muted">Set by government agencies.</p>
      ${ok ? '<div class="btns"><button class="btn" id="go">Export report</button></div>' : need('Needs the explanation step first.', 'Go to Explain Results', 'pre')}
      ${rep ? '<div class="btns" style="margin-top:10px"><button class="btn quiet" id="md">Download .md</button><button class="btn quiet" id="csv">Download .csv</button></div>' : ''}</div>
      <div>${rep ? `<article class="paper">${md2html(rep.markdown)}</article>` : '<div class="empty">The report appears here.</div>'}</div></div>`;
    if ($('go')) $('go').onclick = () => { R.exportReport(); toast('Report exported'); render(); };
    if ($('pre')) $('pre').onclick = () => { location.hash = '#/assess/explain'; };
    if ($('md')) $('md').onclick = () => download('screening-report.md', rep.markdown, 'text/markdown');
    if ($('csv')) $('csv').onclick = () => download('screening-report.csv', rep.csv, 'text/csv');
  };

  /* ---------- Screen Proposed Development Sites (Local Planner) ---------- */
  PAGES.screen = () => {
    setCrumbs([[fdef('F.5').name, '']]);
    const rep = S.o['Screening report'], s = S.o['Site screening summary'];
    $('app').innerHTML = header('F.5') + icom('F.5') + `<div class="work"><div><div class="box"><h2>Proposed development</h2><form onsubmit="return false">
      <label class="f">Project name<input type="text" id="proj" value="${esc(S.project.name)}"></label>
      <label class="f">Applicant<input type="text" id="appl" value="${esc(S.project.applicant)}"></label>
      <label class="f">Planning area<input type="text" id="area" value="${esc(S.areaName)}"></label>
      ${siteSelector('chips')}
      <label class="f">Review threshold <span>Cells at or above this risk get flagged</span><select id="thr">${[0.4, 0.5, 0.6, 0.7].map(v => `<option ${v === S.ctl.site_summary_rules.review_threshold ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <button class="btn" id="go">Screen this site</button><p class="muted small">This sends the site to the Biodiversity Risk Map, which runs any missing steps and returns a screening report.</p></form></div>
      <details class="box guide" style="margin-top:16px" ${s && rep ? '' : 'open'}><summary><h2 style="display:inline">How screening works</h2></summary>
        <h3>1. What you provide</h3><ul class="plain"><li>Project name and applicant, so the report is labelled.</li><li>The planning area (Tompkins County in this prototype).</li><li>The site: click every 1 km grid cell the project touches. Cell R05-C08 means row 5 from the south edge, column 8 from the west edge.</li><li>A review threshold: the risk score at which a cell needs a closer look (0.6 by default).</li></ul>
        <h3>2. What the system does</h3><ul class="plain"><li>Loads only agency-approved data and checks its quality.</li><li>Runs the InVEST habitat-quality model for every cell, with a built-in quality check.</li><li>Averages the risk of your cells, finds the highest-risk cell and the strongest threat, and explains the result.</li></ul>
        <h3>3. Standards used</h3><ul class="plain"><li>Risk score = 1 − habitat quality, from 0 (intact) to 1 (poor or degraded).</li><li>Classes: Very high ≥ 0.80, High 0.60–0.79, Moderate 0.40–0.59, Low 0.20–0.39, Very low below 0.20.</li>
          <li>Recommendation, from the highest-risk cell: ≥ 0.80 field verification before any decision; ≥ 0.60 targeted habitat survey and further review; ≥ 0.40 check recent land-cover change and monitor; below 0.40 routine monitoring.</li><li>Cells without species records are flagged, because their value may be under-estimated.</li></ul>
        <h3>4. Where the result appears</h3><ul class="plain"><li>Right here, below the map: score, class, cells above threshold and the recommendation.</li><li>The full report, with reasons, limitations and data sources: <a href="#/assess/export">Export Screening Reports</a>. Download it as .md (report) or .csv (cell table).</li><li>Agencies see the same evidence on <a href="#/review">Review Environmental Screening Evidence</a> and can request further review.</li></ul>
        <p class="small muted">This is preliminary screening, not a regulatory decision.</p></details></div>
      <div><div class="map" id="m"></div>${rep && s ? `<div class="box" style="margin-top:16px"><h2>Result for ${esc(S.project.name)}</h2>${siteResultHTML(s)}
        <div class="btns" style="margin-top:12px"><a class="btn" href="#/assess/export">Open the screening report</a><button class="btn quiet" id="md">Download report</button></div></div>` : ''}</div></div>`;
    S.mapRef = mountMap($('m'), { select: true, onCell: () => sync() }); const sync = bindSelector('chips');
    $('go').onclick = () => {
      if (!S.site.size) { toast('Click at least one cell on the map'); return; }
      S.project = { name: $('proj').value, applicant: $('appl').value }; S.areaName = $('area').value; S.siteName = $('sname').value || S.project.name;
      S.ctl.site_summary_rules.review_threshold = +$('thr').value; ensure('report'); toast('Site screened'); render();
    };
    if ($('md')) $('md').onclick = () => download('screening-report.md', rep.markdown, 'text/markdown');
  };

  /* ---------- Identify Conservation Priorities (Conservation Organizations) ---------- */
  PAGES.conservation = () => {
    setCrumbs([[fdef('F.1').name, '']]);
    const pr = S.o['Conservation priorities'];
    $('app').innerHTML = header('F.1') + icom('F.1') + `<div class="work"><div class="box"><h2>Your organization</h2><form onsubmit="return false">
      <label class="f">Organization name<input type="text" id="org" value="${esc(S.org.name)}" placeholder="e.g. Finger Lakes Land Trust"></label>
      <label class="f">Habitat to focus on<select id="hab">${['Any', 'Forest', 'Wetland', 'Mixed habitat', 'Agriculture'].map(h => `<option ${h === S.org.habitat ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
      <label class="f">How many areas<select id="cnt">${[5, 10, 15, 20].map(v => `<option ${v === S.org.count ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f">Minimum habitat quality<select id="minq">${[0.5, 0.7, 0.8, 0.9].map(v => `<option ${v === S.org.minq ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="unprot" ${S.org.unprotectedOnly ? 'checked' : ''}><span>Only land that is not yet protected</span></label>
      <button class="btn" id="go">Find priority areas</button></form></div>
      <div><div class="map" id="m"></div>${pr ? `<div class="box" style="margin-top:16px"><h2>Conservation priorities for ${esc(pr.org)}</h2>
        ${pr.rows.length ? `<table><tr><th>Rank</th><th>Cell</th><th>Habitat</th><th>Habitat quality</th><th>Species records</th><th>Protected</th></tr>${pr.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.cell_id}</td><td>${esc(r.land_cover)}</td><td>${fmt(r.habitat_quality)}</td><td>${r.species == null ? '<span class="tag bad">missing</span>' : r.species}</td><td>${r.protected ? 'Yes' : 'No'}</td></tr>`).join('')}</table>
        <div class="btns" style="margin-top:10px"><button class="btn quiet" id="csv">Download list (.csv)</button></div>` : '<div class="warn">No cells match. Lower the minimum habitat quality or choose another habitat.</div>'}</div>` : ''}</div></div>`;
    mountMap($('m'), { layer: 'hq', highlight: pr ? new Set(pr.rows.map(r => r.cell_id)) : null });
    $('go').onclick = () => {
      S.org = { name: $('org').value || 'Unnamed organization', habitat: $('hab').value, count: +$('cnt').value, minq: +$('minq').value, unprotectedOnly: $('unprot').checked };
      if (!have('Habitat-quality map')) ensure('map');
      const P = Object.fromEntries(S.o['Prepared datasets'].cells.map(c => [c.cell_id, c]));
      const rows = S.o['Habitat-quality and degradation results'].cells.filter(c => (S.org.habitat === 'Any' || c.land_cover === S.org.habitat) && c.habitat_quality >= S.org.minq && (!S.org.unprotectedOnly || !P[c.cell_id].protected))
        .map(c => ({ cell_id: c.cell_id, land_cover: c.land_cover, habitat_quality: c.habitat_quality, species: P[c.cell_id].species_count, protected: P[c.cell_id].protected }))
        .sort((a, b) => b.habitat_quality - a.habitat_quality || (b.species || 0) - (a.species || 0)).slice(0, S.org.count);
      S.o['Conservation priorities'] = { org: S.org.name, rows, run_id: S.o['Model run record'].run_id }; toast('Priority areas found'); render();
    };
    if ($('csv')) $('csv').onclick = () => download('conservation-priorities.csv', 'rank,cell_id,habitat,habitat_quality,species_records,protected,run_id\n' + pr.rows.map((r, i) => `${i + 1},${r.cell_id},${r.land_cover},${r.habitat_quality},${r.species ?? ''},${r.protected},${pr.run_id}`).join('\n'), 'text/csv');
  };

  /* ---------- Review Environmental Screening Evidence (Government Agencies) ---------- */
  PAGES.review = () => {
    setCrumbs([[fdef('F.3').name, '']]);
    const x = S.o['Factor explanations and limitations'], rr = S.o['Review request'], approved = new Set(S.ctl.approved_source_list.approved_sources);
    $('app').innerHTML = header('F.3') + icom('F.3') + `<div class="work">
      <div><div class="box"><h2>Review the evidence</h2>${x ? `<p class="small"><b>${esc(S.o['Site screening summary'].site_name)}</b>: ${S.o['Site screening summary'].risk_class} risk, run ${esc(x.provenance.run_id)}.</p><ul class="plain">${x.factors.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : need('No screening evidence yet. A planner has to screen a site first.', 'Screen the Route 13 parcel', 'pre')}
        <form onsubmit="return false" style="margin-top:12px"><label class="f">Reviewer<input type="text" id="rv" value="${esc(rr ? rr.reviewer : '')}" placeholder="Your name"></label>
        <label class="f">Agency<input type="text" id="ag" value="${esc(rr ? rr.agency : 'NYS Department of Environmental Conservation')}"></label>
        <label class="f">Decision<select id="dc">${['Accept as screening evidence', 'Request further field review', 'Request more data'].map(d => `<option ${rr && rr.decision === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label class="f">Comment<textarea id="cm">${esc(rr ? rr.comment : '')}</textarea></label>
        <button class="btn" id="send" ${x ? '' : 'disabled'}>Send review request</button></form>
        ${rr ? `<div class="okmsg" style="margin-top:10px">Review sent. It now appears in <a href="#/assess/explain">Explain Results and Limitations</a> the next time that step runs.</div>` : ''}</div></div>
      <div class="box"><h2>Approved source list</h2><p class="muted small">Only the ticked sources may be loaded by Acquire Environmental Data.</p>
        <form id="asl" onsubmit="return false">${Object.values(S.raw).sort((a, b) => a.source_id.localeCompare(b.source_id)).map(d => `<label class="check"><input type="checkbox" value="${d.source_id}" ${approved.has(d.source_id) ? 'checked' : ''}><span>${esc(d.title)}<small>${d.source_id}, licence ${esc(d.license)}</small></span></label>`).join('')}
        <button class="btn quiet" id="saveAsl">Save approved list</button></form>
        <h3 style="margin-top:16px">Interpretation rules</h3><ul class="plain">${S.ctl.interpretation_rules.limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul><p class="muted small">${esc(S.ctl.interpretation_rules.disclaimer)}</p></div></div>`;
    if ($('pre')) $('pre').onclick = () => { S.site = new Set(S.demoSite.cell_ids); S.siteName = S.demoSite.name; ensure('report'); render(); };
    $('send').onclick = () => { S.o['Review request'] = { reviewer: $('rv').value || 'Reviewer', agency: $('ag').value, decision: $('dc').value, comment: $('cm').value }; delete S.o['Factor explanations and limitations']; delete S.o['Screening report']; R.explain(); toast('Review request sent'); render(); };
    $('saveAsl').onclick = () => {
      const list = [...document.querySelectorAll('#asl input:checked')].map(i => i.value), n = (S.aslRev = (S.aslRev || 0) + 1);
      S.ctl.approved_source_list = Object.assign({}, S.ctl.approved_source_list, { approved_sources: list, version: `ASL-2026.10-r${n}` });
      invalidate('Acquired datasets and metadata'); toast('Approved list saved. Data must be acquired again.'); render();
    };
  };

  /* ---------- Maintain Biodiversity Risk Map (IT Development Team) ---------- */
  PAGES.maintain = () => {
    setCrumbs([[fdef('F.4').name, '']]);
    const d = S.draft || (S.draft = clone(S.ctl.habitat_model_parameters)), q = S.dqDraft || (S.dqDraft = clone(S.ctl.data_quality_criteria));
    const sl = (label, path, min, max, step) => { const v = path.split('.').reduce((o, k) => o[k], d); return `<label class="sl"><div><span>${label}</span><output>${v}</output></div><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-p="${path}"></label>`; };
    const inv = { threats: ['agriculture', 'road', 'urban'], land_cover_classes: Object.keys(d.habitat_suitability).sort(), cell_count: 0 };
    let preview = ''; try { preview = BRM.configureThreatAndSensitivityParameters(inv, { habitatModelParameters: d }).parameter_set_id; } catch (e) { preview = 'invalid'; }
    $('app').innerHTML = header('F.4') + icom('F.4') + `<div class="work">
      <div class="box"><h2>Habitat-model parameters</h2><p class="muted small">Move a slider, then press Publish settings. Publishing replaces the settings that Calculate Habitat Quality uses.</p>
        <div class="grp">How much each threat counts (weights; they are turned into shares of 100%)</div>${sl('Roads', 'threats.road.weight', 0, 1, .05)}${sl('Development', 'threats.urban.weight', 0, 1, .05)}${sl('Farmland', 'threats.agriculture.weight', 0, 1, .05)}
        <div class="grp">How far each threat reaches (km); beyond this distance it has no effect</div>${sl('Roads', 'threats.road.max_distance_km', .5, 6, .5)}${sl('Development', 'threats.urban.max_distance_km', 1, 12, .5)}${sl('Farmland', 'threats.agriculture.max_distance_km', .5, 6, .5)}
        <div class="grp">Habitat suitability (0–1): how good each land cover is as habitat when unthreatened</div>${Object.keys(d.habitat_suitability).map(h => sl(h, `habitat_suitability.${h}`, 0, 1, .05)).join('')}
        <div class="grp">Model shape</div>${sl('Half-saturation constant k', 'k', .05, 1, .05)}<p class="small muted" style="margin:0">The degradation level at which habitat quality is cut in half. Lower k makes the map more sensitive to threats.</p>${sl('Scaling exponent z', 'z', 1, 4, .5)}<p class="small muted" style="margin:0">How sharply quality drops once degradation passes k. InVEST recommends 2.5.</p>
        ${tech([['Settings version these values would get', preview, HELP.PS]])}
        <div class="btns" style="margin-top:12px"><button class="btn" id="pub">Publish settings</button><button class="btn quiet" id="rst">Back to defaults</button></div></div>
      <div><div class="box"><h2>Data-quality criteria</h2><p class="muted small">Used by Validate and Prepare Data. If more cells than this lack land cover, distances or protection status, coverage is marked incomplete.</p>
        <label class="f">Allowed share of incomplete cells<select id="mm">${[0, 0.01, 0.05, 0.1].map(v => `<option value="${v}" ${v === q.max_missing_fraction ? 'selected' : ''}>${v * 100}%</option>`).join('')}</select></label>
        <div class="btns" style="margin-top:12px"><button class="btn quiet" id="pubq">Publish criteria</button></div></div>
        <div class="box"><h2>What publishing does</h2><p class="small">Publishing creates a new version of the settings. The current model results are cleared, because they were made with the old settings. Run <a href="#/assess/habitat">Calculate Habitat Quality</a> again to get results with the new settings.</p>
        <p class="small muted">The map colours for the five risk classes (the map-display rules) are also maintained by the IT team:</p><div class="legend">${legendHTML('risk')}</div></div></div></div>`;
    document.querySelectorAll('[data-p]').forEach(i => i.oninput = () => { const ks = i.dataset.p.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], d)[last] = +i.value; i.closest('label').querySelector('output').textContent = i.value; });
    document.querySelectorAll('[data-p]').forEach(i => i.onchange = () => render());
    $('pub').onclick = () => { const n = (S.hmpRev = (S.hmpRev || 0) + 1); S.ctl.habitat_model_parameters = Object.assign(clone(d), { version: `HMP-2026.10-r${n}` }); S.draft = null; invalidate('Approved parameter set'); toast('Settings published. Re-run Calculate Habitat Quality.'); render(); };
    $('rst').onclick = () => { S.draft = clone(S.defaults.habitat_model_parameters); render(); };
    $('pubq').onclick = () => { q.max_missing_fraction = +$('mm').value; const n = (S.dqRev = (S.dqRev || 0) + 1); S.ctl.data_quality_criteria = Object.assign(clone(q), { version: `DQC-2026.10-r${n}` }); S.dqDraft = null; invalidate('Prepared datasets'); toast('Criteria published. Re-run Validate and Prepare Data.'); render(); };
  };

  /* ------------------------------------------------------------------ router */
  function render() {
    clearMaps();
    const h = (location.hash || '#/').replace(/^#\/?/, ''); const page = PAGES[h] ? h : '';
    const y = page === S.lastPage ? window.scrollY : 0;
    PAGES[page](); setStatus(); S.lastPage = page; window.scrollTo(0, y);
    document.title = (page ? fdef(ROUTE2FN[page]).name + ' · ' : '') + 'Biodiversity Risk Map';
  }

  async function init() {
    const J = async p => { const r = await fetch(p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
    const [model, site, index] = await Promise.all([J('data/idef0.json'), J('data/sample_site.json'), J('data/raw/index.json')]);
    const names = ['approved_source_list', 'data_quality_criteria', 'habitat_model_parameters', 'site_summary_rules', 'map_display_rules', 'interpretation_rules'];
    const ctl = Object.fromEntries(await Promise.all(names.map(async n => [n, await J(`data/config/${n}.json`)])));
    ctl.report_template = await (await fetch('data/config/report_template.md')).text();
    const raws = await Promise.all(index.map(f => J('data/raw/' + f)));
    Object.assign(S, { model, ctl, defaults: clone(ctl), raw: Object.fromEntries(raws.map(d => [d.source_id, d])), demoSite: site.site_selection,
      areaName: 'Tompkins County, NY', siteName: site.site_selection.name, project: { name: 'Route 13 commercial plaza', applicant: 'Example Developments LLC' },
      org: { name: '', habitat: 'Any', count: 10, minq: 0.8, unprotectedOnly: true } });
    S.chosenSources = new Set(Object.keys(S.raw)); site.site_selection.cell_ids.forEach(c => S.site.add(c));
    window.addEventListener('hashchange', render); render();
  }
  init().catch(e => { $('app').innerHTML = `<div class="warn">The app could not load its data (${esc(e.message)}). Serve the <code>dist</code> folder over http, for example <code>python -m http.server 8000</code> inside <code>dist</code>, then open http://localhost:8000.</div>`; console.error(e); });
})();
