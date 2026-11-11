/* Biodiversity Risk Map — simple web app.
 * Pages follow the IDEF0 model in Innoslate (bio2):
 *   Home            = Level 1: five function buttons
 *   #/assess        = Assess Spatial Biodiversity Conditions: seven Level-2 buttons
 *   #/assess/habitat= Calculate Habitat Quality: six Level-3 steps
 * All calculations come from brm-engine.js (same code as the Python package brm/).
 */
/* global L, BRM */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f2 = x => Number(x).toFixed(2);
  const NEEDED = ['TIGER-BOUNDARY', 'USGS-NLCD-LANDCOVER', 'OSM-ROADS', 'NLCD-DEVELOPED', 'NLCD-CULTIVATED', 'USGS-PADUS', 'GBIF-OCCURRENCES'];
  const S = { o: {}, maps: [], site: new Set(), fault: false };

  /* ---------------- one short sentence per function ---------------- */
  const INFO = {
    'F.1': ['conservation', 'Find the best remaining habitat for a conservation group to protect.'],
    'F.2': ['assess', 'The map system: it gets data, models habitat quality, checks a site, explains the result and writes a report.'],
    'F.3': ['review', 'A government agency reviews the screening result and decides which data sources are allowed.'],
    'F.4': ['maintain', 'The IT team keeps the model settings up to date.'],
    'F.5': ['screen', 'A planner enters a proposed project and gets a screening result for its site.'],
    'F.2.1': ['assess/acquire', 'Load the map data. Only approved sources are accepted.'],
    'F.2.2': ['assess/prepare', 'Check the data and line it up on the county grid.'],
    'F.2.3': ['assess/habitat', 'Score the habitat quality of every grid cell (six steps inside).'],
    'F.2.4': ['assess/summarize', 'Summarize the risk for the cells of one site.'],
    'F.2.5': ['assess/display', 'Show the results on a map.'],
    'F.2.6': ['assess/explain', 'Explain why the site got its score and what the limits are.'],
    'F.2.7': ['assess/export', 'Write the screening report.'],
    'F.2.3.1': [null, 'Collect the inputs for every cell: land cover, distance to roads, towns and farms, and protection.'],
    'F.2.3.2': [null, 'Check the model settings and lock them for this run.'],
    'F.2.3.3': [null, 'Run the InVEST habitat-quality calculation.'],
    'F.2.3.4': [null, 'Check the results. If something is wrong, ask step 3 to run again.'],
    'F.2.3.5': [null, 'Turn habitat quality into a risk score and a risk level.'],
    'F.2.3.6': [null, 'Save a record of the run so it can be repeated.'],
  };
  const ROUTE = Object.fromEntries(Object.entries(INFO).filter(([, v]) => v[0]).map(([k, v]) => [v[0], k]));
  const fn = id => [].concat(S.model.level1.functions, S.model.level2.functions, S.model.level3.functions).find(f => f.id === id);
  const who = id => fn(id).mechanism.replace(/^[FC](\.\d+)+\s+/, '');
  const cellName = id => { const m = /^R(\d+)-C(\d+)$/.exec(id); return m ? `row ${+m[1]} from the south, column ${+m[2]} from the west` : id; };
  const LEVELS = 'Risk = 1 − habitat quality (0 = healthy habitat, 1 = poor habitat). Very high ≥ 0.8, High ≥ 0.6, Moderate ≥ 0.4, Low ≥ 0.2, Very low below 0.2.';

  /* ---------------- calculations: one function per IDEF0 box ---------------- */
  const has = k => S.o[k] != null;
  function clearFrom(k) {
    const order = ['acq', 'prep', 'bundle', 'ps', 'raw', 'verified', 'record', 'results', 'summary', 'map', 'explain', 'report', 'priorities'];
    order.slice(order.indexOf(k)).forEach(x => delete S.o[x]);
    if (order.indexOf(k) <= order.indexOf('raw')) { S.o.logs = []; S.o.qas = []; delete S.o.rerun; }
  }
  const run = {
    acquire() { clearFrom('acq'); const [a, id] = BRM.acquireEnvironmentalData(S.raw, { area_id: 'Tompkins County, NY', needed_sources: NEEDED }, { approvedSourceList: S.ctl.approved_source_list }); S.o.acq = a; S.o.dsid = id; },
    prepare() { clearFrom('prep'); const [p, rep, cov] = BRM.validateAndPrepareData(S.o.acq, S.o.dsid, { dataQualityCriteria: S.ctl.data_quality_criteria }); Object.assign(S.o, { prep: p, dq: rep, cov }); },
    assemble() { clearFrom('bundle'); const [b, inv] = BRM.assembleModelInputs(S.o.prep); Object.assign(S.o, { bundle: b, inv }); },
    configure() { clearFrom('ps'); S.o.ps = BRM.configureThreatAndSensitivityParameters(S.o.inv, { habitatModelParameters: S.ctl.habitat_model_parameters }); },
    execute() {
      const rr = S.o.rerun || null; if (!rr) clearFrom('raw'); else clearFrom('verified');
      const [raw, log] = BRM.executeHabitatQualityModel(S.o.bundle, rr, { approvedParameterSet: S.o.ps, faultInjection: S.fault ? { attempts: 1 } : null });
      S.o.raw = raw; S.o.logs.push(log); delete S.o.rerun;
    },
    verify() { const [v, qa, rr] = BRM.verifyModelOutputs(S.o.raw, { expectedCells: S.o.inv.cell_count }); S.o.qas.push(qa); delete S.o.raw; if (rr) S.o.rerun = rr; else S.o.verified = v; },
    classify() { const r = BRM.classifyHabitatRisk(S.o.verified, { riskClasses: S.o.ps.risk_classes }); if (S.o.record) r.run_id = S.o.record.run_id; S.o.results = r; },
    register() { S.o.record = BRM.registerModelRun(S.o.logs, S.o.qas); if (S.o.results) S.o.results.run_id = S.o.record.run_id; },
    summarize() { clearFrom('summary'); S.o.summary = BRM.summarizeSiteConditions(S.o.prep, S.o.results, {}, { siteSelection: { name: S.siteName, cell_ids: [...S.site].sort() }, siteSummaryRules: S.ctl.site_summary_rules }); },
    display() { const [m] = BRM.displayGeographicResults(S.o.prep, S.o.results, S.o.summary || null, {}, {}, { mapDisplayRules: S.ctl.map_display_rules }); S.o.map = m; },
    explain() { S.o.explain = BRM.explainResultsAndLimitations(S.o.summary, S.o.dq, S.o.record, { interpretationRules: S.ctl.interpretation_rules, reviewRequest: S.o.review || null }); delete S.o.report; },
    export() { S.o.report = BRM.exportScreeningReports(S.o.summary, S.o.explain, { reportTemplate: S.ctl.report_template, generated: new Date().toISOString().slice(0, 10) }); },
  };
  function habitatAll() {
    run.assemble(); run.configure(); run.execute(); run.verify();
    let n = 0; while (S.o.rerun && n++ < 2) { run.execute(); run.verify(); }
    run.register(); if (S.o.verified) run.classify();
  }
  /* run everything that is still missing (used by the planner and conservation pages) */
  function ensure(upTo) {
    if (!has('prep')) { if (!has('acq')) run.acquire(); run.prepare(); }
    if (!has('results') || !has('record')) habitatAll();
    if (upTo === 'report') { run.summarize(); run.display(); run.explain(); run.export(); }
  }

  /* ---------------- icons (simple line icons) ---------------- */
  const ICON = {
    'F.1': '<path d="M12 21c-4-3-7-6.5-7-10a7 7 0 0 1 14 0c0 3.5-3 7-7 10z"/><path d="M9 11l2 2 4-4"/>',
    'F.2': '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14"/>',
    'F.3': '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 14l2 2 4-4"/>',
    'F.4': '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1"/>',
    'F.5': '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  };
  const icon = id => `<div class="ic"><svg viewBox="0 0 24 24">${ICON[id]}</svg></div>`;
  function toast(t) { let el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); } el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2200); }

  /* ---------------- map ---------------- */
  const hq = q => `rgb(${[230, 239, 219].map((v, i) => Math.round(v + ([23, 63, 46][i] - v) * q)).join(',')})`;
  const legend = () => `<div class="legend">${Object.entries(S.ctl.map_display_rules.colors).reverse().map(([k, c]) => `<span style="background:${c}" class="${k === 'Low' || k === 'Moderate' ? 'd' : ''}">${k}</span>`).join('')}</div>`;
  const badge = cls => `<span class="badge" style="background:${S.ctl.map_display_rules.colors[cls]};${cls === 'Low' || cls === 'Moderate' ? 'color:#17262B' : ''}">${cls}</span>`;
  function map(el, { pick = false, layer = 'risk', mark = null, onPick = null, still = false } = {}) {
    const R = S.o.results ? Object.fromEntries(S.o.results.cells.map(c => [c.cell_id, c])) : {};
    const m = L.map(el, { zoomSnap: .25, scrollWheelZoom: false, zoomControl: !still, attributionControl: !still, dragging: !still });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { opacity: .6, attribution: '&copy; OpenStreetMap' }).addTo(m);
    const style = f => { const id = f.properties.id, r = R[id], on = (pick && S.site.has(id)) || (mark && mark.has(id));
      return { fillColor: r ? (layer === 'hq' ? hq(r.habitat_quality) : S.ctl.map_display_rules.colors[r.risk_class]) : '#c9d3ce', fillOpacity: mark && !on ? .3 : .85, color: on ? '#E3A72F' : '#fff', weight: on ? 3.5 : .7 }; };
    const g = L.geoJSON({ type: 'FeatureCollection', features: S.raw['TIGER-BOUNDARY'].records.map(r => ({ type: 'Feature', properties: { id: r.cell_id }, geometry: { type: 'Polygon', coordinates: r.geometry } })) },
      { style, onEachFeature: (f, l) => { const id = f.properties.id;
        l.bindTooltip(() => { const r = R[id]; return `<b>${id}</b> · ${cellName(id)}${r ? `<br>${r.land_cover}, risk ${f2(r.risk_score)} (${r.risk_class})` : ''}`; }, { sticky: true });
        l.on('click', () => { if (pick) { S.site.has(id) ? S.site.delete(id) : S.site.add(id); g.setStyle(style); if (onPick) onPick(); } }); } }).addTo(m);
    setTimeout(() => { m.invalidateSize(); m.fitBounds(g.getBounds(), { padding: [10, 10] }); }, 0);
    S.maps.push(m);
  }
  const siteChips = () => `<div class="chips" id="chips" style="margin-top:8px">${[...S.site].sort().map(c => `<span>${c}</span>`).join('') || '<span>no cells yet</span>'}</div>`;
  const refreshChips = () => { $('chips').outerHTML = siteChips(); };

  /* ---------------- page frame ---------------- */
  function pills() {
    $('pills').innerHTML = [['Data', has('prep')], ['Habitat model', has('results') && has('record')], ['Site', has('summary')]].map(([t, on]) => `<span class="${on ? 'on' : ''}">${on ? '✓ ' : ''}${t}</span>`).join('');
  }
  function frame(id, body, parent, actions = '') {
    const f = fn(id);
    $('crumbs').innerHTML = `<a href="#/">Home</a>${parent ? `<i>›</i><a href="#/${INFO[parent][0]}">${esc(fn(parent).name)}</a>` : ''}<i>›</i>${esc(f.name)}`;
    const chips = (a, empty) => (a && a.length ? `<div class="chips">${a.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : `<span class="muted">${empty}</span>`);
    $('app').innerHTML = `<div class="phead"><div><div class="who"><i></i>Done by ${esc(who(id))}</div><h1>${esc(f.name)}</h1><p class="muted">${INFO[id][1]}</p></div><div class="row" style="margin:0">${actions}</div></div>
      <div class="icom"><div style="--c:#7FA6B3"><b>Uses</b>${chips(f.inputs, 'nothing')}</div><div style="--c:#9C86CF"><b>Follows these rules</b>${chips(f.controls, 'no rules')}</div><div style="--c:#E3A72F"><b>Gives</b>${chips(f.outputs, 'nothing')}</div></div>${body}`;
  }
  const need = (text, id) => `<div class="note"><span>${text}</span><button class="btn gold" id="${id}">Do it for me</button></div>`;
  const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text])); a.download = name; a.click(); };
  const P = {};

  /* ---------------- Home (Level 1) ---------------- */
  P[''] = () => {
    $('crumbs').innerHTML = '';
    const steps = S.model.level2.functions, done = stageDone();
    const card = id => `<a class="fcard" href="#/${INFO[id][0]}">${icon(id)}<div><h3>${esc(fn(id).name)}</h3><p>${INFO[id][1]}</p><span class="by">${esc(who(id))}</span></div></a>`;
    $('app').innerHTML = `<section class="hero"><div><span class="kicker">Tompkins County, NY · prototype</span><h1>Check a site for biodiversity risk before you build.</h1>
        <p class="lead">Every button on this page is one function from our IDEF0 model. Open the map system to run it step by step, or screen a project directly.</p>
        <div class="row"><a class="btn" href="#/assess">Open the map system</a><a class="btn light" href="#/screen">Screen a project</a></div></div>
        <div><div class="mapbox"><div class="map" id="hm"></div>${has('results') ? legend() : ''}</div><p class="small muted">${has('results') ? 'Risk for each 1 km grid cell, from the latest run.' : '168 grid cells of 1 km × 1 km. They get coloured once the habitat model has run.'}</p></div></section>
      <div class="sectiontitle"><h2>What you can do</h2><span class="small muted">Level 1 of the IDEF0 model</span></div>
      <div class="cards">
        <a class="fcard core" href="#/assess">${icon('F.2')}<div><h3>${esc(fn('F.2').name)}</h3><p>${INFO['F.2'][1]}</p><span class="by">${esc(who('F.2'))}</span>
          <div class="chips">${steps.map(k => `<span class="${done[k.id] ? 'ok' : ''}">${done[k.id] ? '✓ ' : ''}${esc(k.name)}</span>`).join('')}</div></div></a>
        ${['F.5', 'F.1', 'F.3', 'F.4'].map(card).join('')}</div>`;
    map($('hm'), { still: true });
  };

  /* ---------------- Assess Spatial Biodiversity Conditions (Level 2) ---------------- */
  const stageDone = () => ({ 'F.2.1': has('acq'), 'F.2.2': has('prep'), 'F.2.3': has('results') && has('record'), 'F.2.4': has('summary'), 'F.2.5': has('map'), 'F.2.6': has('explain'), 'F.2.7': has('report') });
  P.assess = () => {
    const done = stageDone();
    frame('F.2', `<div class="sectiontitle"><h2>Seven steps inside</h2><span class="small muted">Level 2 · open them in order</span></div>
      <div class="flowgrid">${S.model.level2.functions.map((k, i) => `<a class="stage ${done[k.id] ? 'done' : ''} ${k.id === 'F.2.3' ? 'key' : ''}" href="#/${INFO[k.id][0]}">
        ${k.id === 'F.2.3' ? '<span class="tag">6 steps inside</span>' : ''}<span class="n">${done[k.id] ? '✓' : i + 1}</span><h3>${esc(k.name)}</h3><p>${INFO[k.id][1]}</p>
        <span class="st">${done[k.id] ? 'Done' : 'Not run yet'}</span></a>`).join('')}</div>`, null,
      `<button class="btn" id="all">Run all 7 steps</button><button class="btn light" id="reset">Start over</button>`);
    $('all').onclick = () => { if (!S.site.size) S.demo.cell_ids.forEach(c => S.site.add(c)); ensure('report'); toast('All 7 steps done'); render(); };
    $('reset').onclick = () => { S.o = { logs: [], qas: [] }; toast('Cleared'); render(); };
  };

  P['assess/acquire'] = () => {
    const a = S.o.acq;
    frame('F.2.1', a ? `<div class="srcs">${a.metadata.map(m => `<div class="src"><i>✓</i><span>${esc(m.title)}</span></div>`).join('')}
        ${a.rejected_sources.map(r => `<div class="src no"><i>✗</i><span>${esc(S.raw[r.source_id].title)}<br><small class="muted">rejected: not on the approved list</small></span></div>`).join('')}</div>
        <div class="okline">✓ ${a.metadata.length} sources loaded. Next: <a href="#/assess/prepare">Validate and Prepare Data</a></div>`
      : `<div class="panel"><p>Press <b>Load data</b> to collect the ${Object.keys(S.raw).length} datasets offered for the county.</p></div>`, 'F.2', `<button class="btn" id="go">${a ? 'Load again' : 'Load data'}</button>`);
    $('go').onclick = () => { run.acquire(); toast('Data loaded'); render(); };
  };
  P['assess/prepare'] = () => {
    const ok = has('prep');
    frame('F.2.2', !has('acq') ? need('Load the data first.', 'pre') : ok ? `<div class="stats">
        <div class="stat"><small>Grid cells ready</small><b>${S.o.cov.prepared_cells} / ${S.o.cov.grid_cells}</b><span>each cell is 1 km × 1 km</span></div>
        <div class="stat"><small>Coverage</small><b style="color:var(--moss)">${S.o.cov.status === 'COMPLETE' ? 'Complete' : 'Incomplete'}</b><span>no cell is missing core data</span></div>
        <div class="stat"><small>Cells without species records</small><b style="color:var(--bad)">${S.o.dq.data_gap_cells.length}</b><span>${S.o.dq.data_gap_cells.join(', ')}</span></div></div>
        <div class="okline">✓ Data checked. Next: <a href="#/assess/habitat">Calculate Habitat Quality</a></div>`
      : `<div class="panel"><p>Press <b>Check data</b> to test the loaded data and line it up on the county grid.</p></div>`, 'F.2', has('acq') ? `<button class="btn" id="go">${ok ? 'Check again' : 'Check data'}</button>` : '');
    if ($('go')) $('go').onclick = () => { run.prepare(); toast('Data checked'); render(); };
    if ($('pre')) $('pre').onclick = () => { run.acquire(); render(); };
  };

  /* ---------------- Calculate Habitat Quality (Level 3) ---------------- */
  P['assess/habitat'] = () => {
    const o = S.o, lastQA = (o.qas || []).slice(-1)[0], lastLog = (o.logs || []).slice(-1)[0];
    const steps = [
      ['F.2.3.1', 'assemble', has('prep'), has('bundle'), () => `Inputs ready for ${o.bundle.cells.length} cells.`],
      ['F.2.3.2', 'configure', has('bundle'), has('ps'), () => `Settings locked. Threat weight: roads ${Math.round(o.ps.threats.road.weight_norm * 100)}%, towns ${Math.round(o.ps.threats.urban.weight_norm * 100)}%, farms ${Math.round(o.ps.threats.agriculture.weight_norm * 100)}%.`],
      ['F.2.3.3', 'execute', has('bundle') && has('ps'), !!lastLog, () => `Calculated ${lastLog.cells_processed} cells (attempt ${lastLog.attempt}).`],
      ['F.2.3.4', 'verify', has('raw'), !!lastQA, () => lastQA.status === 'PASS' ? 'Check passed: every value is OK.' : `Check failed: cell ${lastQA.failures[0].cell_id} has a bad value. Run step 3 again.`, has('rerun')],
      ['F.2.3.5', 'classify', has('verified'), has('results'), () => Object.entries(o.results.class_counts).map(([k, v]) => `${k} ${v}`).join(' · ') + ' cells'],
      ['F.2.3.6', 'register', (o.qas || []).length > 0 && !has('raw'), has('record'), () => `Run saved after ${o.record.attempts} attempt${o.record.attempts > 1 ? 's' : ''}.`],
    ];
    frame('F.2.3', (has('prep') ? '' : need('This needs the checked data from Validate and Prepare Data.', 'pre')) + `
      <div class="toolbar"><span class="small"><b>Level 3:</b> press <b>Run</b> on each step in order.</span>
        <label class="chk" style="margin:0 0 0 auto"><input type="checkbox" id="fault" ${S.fault ? 'checked' : ''}> Simulate an error in step 3</label></div>
      <ol class="timeline">${steps.map(([id, k, can, done, res, fail], i) => `<li class="tl ${fail ? 'fail' : done ? 'done' : can ? 'ready' : ''}"><div class="dot">${done && !fail ? '✓' : i + 1}</div>
        <div class="box"><h3>${esc(fn(id).name)}</h3><button class="btn ${can ? '' : 'light'}" data-k="${k}" ${can ? '' : 'disabled'}>Run</button>
          <p>${INFO[id][1]} <span class="by">· ${esc(who(id))}</span></p>${done ? `<div class="out">${res()}</div>` : ''}</div></li>`).join('')}</ol>
      ${has('results') && has('record') ? `<div class="okline">✓ Every grid cell now has a habitat-quality score and a risk level. Next: <a href="#/assess/summarize">Summarize Site Conditions</a></div>` : ''}`,
      'F.2', `<button class="btn" id="all" ${has('prep') ? '' : 'disabled'}>Run all 6 steps</button><a class="btn light" href="#/maintain">Model settings</a>`);
    document.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { run[b.dataset.k](); render(); });
    $('fault').onchange = e => { S.fault = e.target.checked; };
    $('all').onclick = () => { habitatAll(); toast('Habitat model done'); render(); };
    if ($('pre')) $('pre').onclick = () => { run.acquire(); run.prepare(); render(); };
  };

  function siteResult(s) {
    return `<div class="stats">
      <div class="stat"><small>Average risk</small><b>${f2(s.mean_risk)}</b>${badge(s.risk_class)}</div>
      <div class="stat"><small>Highest-risk cell</small><b>${s.max_cell}</b><span>${cellName(s.max_cell)}, risk ${f2(s.max_risk)}</span></div>
      <div class="stat"><small>Cells at review level (${S.ctl.site_summary_rules.review_threshold}+)</small><b>${s.cells_over_threshold} / ${s.cell_count}</b><span>need a closer look</span></div>
      <div class="stat"><small>Species records</small><b>${s.species_count}</b><span>in the selected cells</span></div></div>
      <div class="rec"><b>Recommendation:</b> ${esc(s.recommendation)}</div>
      ${s.data_gap_cells.length ? `<div class="warn">No species records for ${s.data_gap_cells.join(', ')}, so their risk may be underestimated.</div>` : ''}
      <p class="scale">${LEVELS}</p>`;
  }
  P['assess/summarize'] = () => {
    frame('F.2.4', has('results') ? `<div class="two"><div class="panel"><h2>Choose the site</h2><label>Site name<input type="text" id="sn" value="${esc(S.siteName)}"></label>
        <p class="hint">Click cells on the map to add or remove them.</p>${siteChips()}
        <div class="row"><button class="btn" id="go">Summarize</button><button class="btn light" id="demo">Use example site</button></div></div>
        <div><div class="map" id="m"></div>${legend()}</div></div>${has('summary') ? `<h2 style="margin-top:22px">${esc(S.o.summary.site_name)}</h2>${siteResult(S.o.summary)}` : ''}`
      : need('This needs habitat quality results first.', 'pre'), 'F.2');
    if ($('pre')) { $('pre').onclick = () => { ensure(); render(); }; return; }
    map($('m'), { pick: true, onPick: refreshChips });
    $('demo').onclick = () => { S.site = new Set(S.demo.cell_ids); render(); };
    $('go').onclick = () => { if (!S.site.size) return toast('Pick at least one cell'); S.siteName = $('sn').value; run.summarize(); toast('Site summarized'); render(); };
  };
  P['assess/display'] = () => {
    S.layer = S.layer || 'risk';
    frame('F.2.5', has('results') ? `<div class="panel"><div class="seg"><button data-l="risk" class="${S.layer === 'risk' ? 'on' : ''}">Risk map</button><button data-l="hq" class="${S.layer === 'hq' ? 'on' : ''}">Habitat-quality map</button></div>
      <div class="map" id="m" style="margin-top:12px;height:480px"></div>${S.layer === 'risk' ? legend() : '<p class="hint">Darker green = better habitat.</p>'}<p class="hint">Hover over a cell to see its name and score.</p></div>`
      : need('This needs habitat quality results first.', 'pre'), 'F.2');
    if ($('pre')) { $('pre').onclick = () => { ensure(); render(); }; return; }
    if (!has('map')) run.display();
    map($('m'), { layer: S.layer });
    document.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { S.layer = b.dataset.l; render(); });
  };
  P['assess/explain'] = () => {
    const x = S.o.explain;
    frame('F.2.6', !has('summary') ? `<div class="note"><span>First choose a site in Summarize Site Conditions.</span><a class="btn gold" href="#/assess/summarize">Go there</a></div>`
      : x ? `<div class="two" style="grid-template-columns:1fr 1fr"><div class="panel"><h2>Why this score</h2><ul class="nice">${x.factors.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
          <div class="panel"><h2>Keep in mind</h2><ul class="nice" style="--c:var(--gold)">${x.limitations.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div></div>
          ${x.review_request ? `<div class="rec"><b>Agency review:</b> ${esc(x.review_request.decision)}. ${esc(x.review_request.comment)}</div>` : ''}<p class="scale">${esc(x.disclaimer)}</p>`
        : `<div class="panel"><p>Press <b>Explain</b> to get the reasons behind the score for <b>${esc(S.o.summary.site_name)}</b>.</p></div>`, 'F.2', has('summary') ? `<button class="btn" id="go">Explain</button>` : '');
    if ($('go')) $('go').onclick = () => { run.explain(); render(); };
  };
  function md2html(md) {
    let h = '', ul = false; const i = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    md.split('\n').forEach(l => { if (l.startsWith('- ')) { if (!ul) { h += '<ul>'; ul = true; } h += `<li>${i(l.slice(2))}</li>`; return; } if (ul) { h += '</ul>'; ul = false; }
      if (l.startsWith('# ')) h += `<h1>${i(l.slice(2))}</h1>`; else if (l.startsWith('## ')) h += `<h2>${i(l.slice(3))}</h2>`; else if (l.startsWith('> ')) h += `<p class="muted small">${i(l.slice(2))}</p>`; else if (l.trim()) h += `<p>${i(l)}</p>`; });
    return h + (ul ? '</ul>' : '');
  }
  P['assess/export'] = () => {
    const r = S.o.report;
    frame('F.2.7', !has('explain') ? `<div class="note"><span>First run Explain Results and Limitations.</span><a class="btn gold" href="#/assess/explain">Go there</a></div>`
      : r ? `<div class="paper">${md2html(r.markdown)}</div>` : `<div class="panel"><p>Press <b>Write report</b> to create the screening report.</p></div>`, 'F.2',
      has('explain') ? `<button class="btn" id="go">Write report</button>${r ? '<button class="btn light" id="dl">Download</button>' : ''}` : '');
    if ($('go')) $('go').onclick = () => { run.export(); toast('Report written'); render(); };
    if ($('dl')) $('dl').onclick = () => download('screening-report.md', r.markdown);
  };

  /* ---------------- the other Level 1 functions ---------------- */
  P.screen = () => {
    frame('F.5', `<div class="two"><div class="panel"><h2>Your project</h2><label>Project name<input type="text" id="pn" value="${esc(S.project)}"></label>
      <p class="hint">Click the grid cells the project covers.</p>${siteChips()}
      <div class="row"><button class="btn" id="go">Screen this site</button><button class="btn light" id="demo">Use example site</button></div></div>
      <div><div class="map" id="m"></div>${has('results') ? legend() : ''}</div></div>
      ${has('summary') && has('report') ? `<h2 style="margin-top:22px">Result for ${esc(S.o.summary.site_name)}</h2>${siteResult(S.o.summary)}<div class="row"><a class="btn light" href="#/assess/export">See the full report</a><a class="btn light" href="#/assess/explain">Why this score?</a></div>` : ''}`);
    map($('m'), { pick: true, onPick: refreshChips });
    $('demo').onclick = () => { S.site = new Set(S.demo.cell_ids); render(); };
    $('go').onclick = () => { if (!S.site.size) return toast('Pick at least one cell'); S.project = $('pn').value; S.siteName = S.project; ensure('report'); toast('Site screened'); render(); };
  };
  P.conservation = () => {
    const pr = S.o.priorities;
    frame('F.1', `<div class="two"><div class="panel"><h2>Your organization</h2><label>Organization name<input type="text" id="org" value="${esc(S.org)}" placeholder="e.g. Finger Lakes Land Trust"></label>
      <label>Habitat type<select id="hab">${['Any', 'Forest', 'Wetland', 'Mixed habitat'].map(h => `<option ${h === S.hab ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="unp" checked> Only land that is not protected yet</label>
      <div class="row"><button class="btn" id="go">Find top 10 areas</button></div></div>
      <div><div class="map" id="m"></div><p class="hint">Darker green = better habitat. Yellow outline = chosen areas.</p></div></div>
      ${pr ? `<div class="panel" style="margin-top:20px"><h2>Top areas for ${esc(pr.org)}</h2><table><tr><th>Rank</th><th>Cell</th><th>Where</th><th>Habitat</th><th>Habitat quality</th></tr>${pr.rows.map((r, i) => `<tr><td><span class="rank">${i + 1}</span></td><td><b>${r.cell_id}</b></td><td class="muted">${cellName(r.cell_id)}</td><td>${r.land_cover}</td><td>${f2(r.habitat_quality)}</td></tr>`).join('')}</table></div>` : ''}`);
    map($('m'), { layer: 'hq', mark: pr ? new Set(pr.rows.map(r => r.cell_id)) : null });
    $('go').onclick = () => {
      S.org = $('org').value || 'My organization'; S.hab = $('hab').value; ensure();
      const prot = Object.fromEntries(S.o.prep.cells.map(c => [c.cell_id, c.protected]));
      const rows = S.o.results.cells.filter(c => (S.hab === 'Any' || c.land_cover === S.hab) && (!$('unp').checked || !prot[c.cell_id])).sort((a, b) => b.habitat_quality - a.habitat_quality).slice(0, 10);
      S.o.priorities = { org: S.org, rows }; toast('Top areas found'); render();
    };
  };
  P.review = () => {
    const x = S.o.explain, ok = new Set(S.ctl.approved_source_list.approved_sources);
    frame('F.3', `<div class="two" style="grid-template-columns:1fr 1fr"><div class="panel"><h2>Review a result</h2>
      ${x ? `<p><b>${esc(S.o.summary.site_name)}</b> ${badge(S.o.summary.risk_class)} average risk ${f2(S.o.summary.mean_risk)}</p>
        <label>Your name<input type="text" id="rv"></label><label>Decision<select id="dc"><option>Accept</option><option>Ask for a field survey</option><option>Ask for more data</option></select></label>
        <label>Comment<input type="text" id="cm"></label><div class="row"><button class="btn" id="send">Send review</button></div>
        ${S.o.review ? `<div class="okline">✓ Review sent: ${esc(S.o.review.decision)}. It now shows in <a href="#/assess/explain">Explain Results</a>.</div>` : ''}`
        : `<div class="note"><span>No result to review yet.</span><a class="btn gold" href="#/screen">Screen a site</a></div>`}</div>
      <div class="panel"><h2>Approved data sources</h2><p class="hint">Only ticked sources can be loaded.</p>
        ${Object.values(S.raw).map(d => `<label class="chk"><input type="checkbox" value="${d.source_id}" ${ok.has(d.source_id) ? 'checked' : ''}> ${esc(d.title)}</label>`).join('')}
        <div class="row"><button class="btn light" id="save">Save list</button></div></div></div>`);
    if ($('send')) $('send').onclick = () => { S.o.review = { reviewer: $('rv').value, decision: $('dc').value, comment: $('cm').value }; run.explain(); run.export(); toast('Review sent'); render(); };
    $('save').onclick = () => { S.ctl.approved_source_list = Object.assign({}, S.ctl.approved_source_list, { approved_sources: [...document.querySelectorAll('.panel input[type=checkbox]:checked')].map(i => i.value) }); clearFrom('acq'); delete S.o.dsid; toast('List saved. Load the data again.'); render(); };
  };
  P.maintain = () => {
    const p = S.ctl.habitat_model_parameters;
    const sl = (label, get, set, min, max, step) => `<div class="sl"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${get(p)}" data-set="${set}"><output>${get(p)}</output></div>`;
    frame('F.4', `<div class="two" style="grid-template-columns:1fr 1fr"><div class="panel"><h2>Threat weights</h2><p class="hint">How much each threat counts.</p>
        ${sl('Roads', q => q.threats.road.weight, 'threats.road.weight', 0, 1, .05)}${sl('Towns', q => q.threats.urban.weight, 'threats.urban.weight', 0, 1, .05)}${sl('Farms', q => q.threats.agriculture.weight, 'threats.agriculture.weight', 0, 1, .05)}</div>
      <div class="panel"><h2>Model shape</h2><p class="hint"><b>k</b>: how much damage cuts habitat quality in half. <b>z</b>: how fast quality drops after that (InVEST uses 2.5).</p>
        ${sl('k', q => q.k, 'k', .05, 1, .05)}${sl('z', q => q.z, 'z', 1, 4, .5)}</div></div>
      ${S.saved ? `<div class="okline">✓ Saved. Re-run <a href="#/assess/habitat">Calculate Habitat Quality</a> to use the new settings.</div>` : ''}`, null,
      `<button class="btn" id="save">Save settings</button><button class="btn light" id="def">Back to default</button>`);
    document.querySelectorAll('[data-set]').forEach(i => i.oninput = () => { const ks = i.dataset.set.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], p)[last] = +i.value; i.nextElementSibling.textContent = i.value; S.saved = false; });
    $('save').onclick = () => { clearFrom('ps'); S.saved = true; toast('Settings saved'); render(); };
    $('def').onclick = () => { S.ctl.habitat_model_parameters = JSON.parse(JSON.stringify(S.defaults)); clearFrom('ps'); S.saved = false; render(); };
  };

  /* ---------------- router ---------------- */
  function render() {
    S.maps.forEach(m => m.remove()); S.maps = [];
    const h = (location.hash || '#/').replace(/^#\/?/, '');
    (P[h] || P[''])(); pills();
  }
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  async function init() {
    const J = async u => (await fetch(u)).json();
    const [model, site, idx] = await Promise.all([J('data/idef0.json'), J('data/sample_site.json'), J('data/raw/index.json')]);
    const names = ['approved_source_list', 'data_quality_criteria', 'habitat_model_parameters', 'site_summary_rules', 'map_display_rules', 'interpretation_rules'];
    const ctl = Object.fromEntries(await Promise.all(names.map(async n => [n, await J(`data/config/${n}.json`)])));
    ctl.report_template = await (await fetch('data/config/report_template.md')).text();
    const raws = await Promise.all(idx.map(f => J('data/raw/' + f)));
    Object.assign(S, { model, ctl, defaults: JSON.parse(JSON.stringify(ctl.habitat_model_parameters)), raw: Object.fromEntries(raws.map(d => [d.source_id, d])),
      demo: site.site_selection, siteName: site.site_selection.name, project: 'Route 13 commercial plaza', org: '', hab: 'Any' });
    S.o.logs = []; S.o.qas = [];
    site.site_selection.cell_ids.forEach(c => S.site.add(c));
    render();
  }
  init().catch(e => { $('app').innerHTML = `<p>Could not load data: ${esc(e.message)}. Open this page through <code>python -m http.server</code> inside the <code>dist</code> folder.</p>`; });
})();
