/* Biodiversity Risk Map — simple web app.
 * Pages follow the IDEF0 model and hierarchy diagrams in Innoslate (bio2):
 *   Home                 = Level 1: five function buttons (F.1-F.5)
 *   #/assess             = F.2 -> F.2.1 ... F.2.7;  #/assess/habitat = F.2.3 -> F.2.3.1 ... F.2.3.6
 *   #/conservation       = F.1 -> F.1.1 ... F.1.4
 *   #/review             = F.3 -> F.3.1 ... F.3.4
 *   #/maintain           = F.4 -> F.4.1 ... F.4.5
 *   #/screen             = F.5 -> F.5.1 ... F.5.4
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
    'F.1.1': ['conservation/filters', 'Choose the habitat type and risk levels you care about, and see which grid cells match.'],
    'F.1.2': ['conservation/inspect', 'Click a matching cell to see what drives its score.'],
    'F.1.3': ['conservation/evidence', 'Ask the map system for the evidence behind the cells you picked.'],
    'F.1.4': ['conservation/export', 'Rank the matching cells and download the priority list.'],
    'F.3.1': ['review/coverage', 'Check that the data covers the whole county before trusting any result.'],
    'F.3.2': ['review/approve', 'Approve which data sources may be used and which limitations must be shown.'],
    'F.3.3': ['review/method', 'See how the score is calculated and the evidence for the current site.'],
    'F.3.4': ['review/decision', 'Record the decision on the screened site.'],
    'F.4.1': ['maintain/acquire', 'Refresh the source datasets from their providers.'],
    'F.4.2': ['maintain/grid', 'Build the 1 km study grid that every dataset is lined up on.'],
    'F.4.3': ['maintain/calculate', 'Set the model settings and calculate risk scores for every cell.'],
    'F.4.4': ['maintain/publish', 'Publish the new scores so planners and conservation groups use them.'],
    'F.4.5': ['maintain/package', 'Package the scored grid as files for download.'],
    'F.5.1': ['screen/locate', 'Name the project and mark the plots it covers on the map.'],
    'F.5.2': ['screen/overlay', 'Lay the plots over the county risk map.'],
    'F.5.3': ['screen/summarize', 'Get the risk for each plot and for the whole site.'],
    'F.5.4': ['screen/download', 'Download the screening report and the plot table.'],
  };
  const ROUTE = Object.fromEntries(Object.entries(INFO).filter(([, v]) => v[0]).map(([k, v]) => [v[0], k]));
  const KIDS = () => S.model.level2_actors;
  const fn = id => {
    const f = [].concat(S.model.level1.functions, S.model.level2.functions, S.model.level3.functions).find(x => x.id === id);
    if (f) return f;
    const parent = id.split('.').slice(0, 2).join('.'), k = (KIDS()[parent] || []).find(x => x.id === id);
    return k ? { id, name: k.name, mechanism: fn(parent).mechanism, inputs: [], controls: [], outputs: [] } : null;
  };
  const who = id => fn(id).mechanism.replace(/^[FC](\.\d+)+\s+/, '');
  const cellName = id => { const m = /^R(\d+)-C(\d+)$/.exec(id); return m ? `row ${+m[1]} from the south, column ${+m[2]} from the west` : id; };
  const LEVELS = 'Risk = 1 − habitat quality (0 = healthy habitat, 1 = poor habitat). Very high ≥ 0.8, High ≥ 0.6, Moderate ≥ 0.4, Low ≥ 0.2, Very low below 0.2.';

  /* ---------------- calculations: one function per IDEF0 box ---------------- */
  const has = k => S.o[k] != null;
  function clearFrom(k) {
    const order = ['acq', 'prep', 'bundle', 'ps', 'raw', 'verified', 'record', 'results', 'published', 'summary', 'map', 'explain', 'report', 'priorities'];
    order.slice(order.indexOf(k)).forEach(x => delete S.o[x]);
    if (order.indexOf(k) <= order.indexOf('raw')) { S.o.logs = []; S.o.qas = []; delete S.o.rerun; }
    if (order.indexOf(k) <= order.indexOf('ps')) delete S.sr;   /* data or parameters changed: the site-only run is stale */
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
  /* Screen a project: run the habitat model ONLY on the plots the planner selected.
     The county run is reused when it already exists (nothing is recalculated). */
  function scoreSite() {
    if (!has('prep')) { if (!has('acq')) run.acquire(); run.prepare(); }
    const ids = [...S.site].sort(), key = ids.join(',');
    if (has('results') && has('record')) return;                 /* county already scored: just look the plots up */
    if (S.sr && S.sr.key === key) return;                        /* same plots already scored */
    const sub = Object.assign({}, S.o.prep, { cells: S.o.prep.cells.filter(c => S.site.has(c.cell_id)) });
    const [bundle, inv] = BRM.assembleModelInputs(sub);
    /* parameters are frozen for every land-cover class in the county, so the parameter set ID is the same as a county run */
    const countyInv = Object.assign({}, inv, { land_cover_classes: [...new Set(S.o.prep.cells.map(c => c.land_cover))].sort() });
    const ps = BRM.configureThreatAndSensitivityParameters(countyInv, { habitatModelParameters: S.ctl.habitat_model_parameters });
    const logs = [], qas = []; let rr = null, verified = null;
    for (let n = 0; n < 3; n++) {
      const [raw, log] = BRM.executeHabitatQualityModel(bundle, rr, { approvedParameterSet: ps, faultInjection: S.fault ? { attempts: 1 } : null });
      logs.push(log);
      const [v, qa, again] = BRM.verifyModelOutputs(raw, { expectedCells: inv.cell_count }); qas.push(qa);
      if (!again) { verified = v; break; } rr = again;
    }
    const record = BRM.registerModelRun(logs, qas);
    if (!verified) { toast('The habitat model failed its quality check'); return; }
    const results = BRM.classifyHabitatRisk(verified, { riskClasses: ps.risk_classes }); results.run_id = record.run_id;
    S.sr = { key, ids, results, record, computed: inv.cell_count, total: S.o.prep.cells.length };
    clearFrom('summary');
  }
  /* where the screening pages read their scores from */
  const scr = () => (has('results') && has('record')) ? { results: S.o.results, record: S.o.record, mode: 'county' }
    : (S.sr && S.sr.key === [...S.site].sort().join(',')) ? { results: S.sr.results, record: S.sr.record, mode: 'site' } : null;
  const scopeNote = () => { const x = scr(); if (!x) return '';
    return x.mode === 'site'
      ? `<div class="okline">✓ The habitat model ran on your ${S.sr.computed} plot${S.sr.computed > 1 ? 's' : ''} only (${S.sr.computed} of ${S.sr.total} cells), run ${x.record.run_id}. The rest of the county was not calculated.</div>`
      : `<div class="okline">✓ Used the existing county run ${x.record.run_id}. Nothing was recalculated for this site.</div>`; };
  const needSite = id => `<div class="note"><span>Your ${S.site.size} plot${S.site.size > 1 ? 's have' : ' has'} not been scored yet. Only these plots will be calculated, not the whole county.</span><button class="btn gold" id="${id}">Calculate my ${S.site.size} plot${S.site.size > 1 ? 's' : ''}</button></div>`;
  const bindSite = id => { if ($(id)) $(id).onclick = () => { scoreSite(); toast(`${S.site.size} plot${S.site.size > 1 ? 's' : ''} scored`); render(); }; return !!$(id); };
  function screenReport() {
    const x = scr();
    clearFrom('summary');
    S.o.summary = BRM.summarizeSiteConditions(S.o.prep, x.results, {}, { siteSelection: { name: S.siteName, cell_ids: [...S.site].sort() }, siteSummaryRules: S.ctl.site_summary_rules });
    S.o.explain = BRM.explainResultsAndLimitations(S.o.summary, S.o.dq, x.record, { interpretationRules: S.ctl.interpretation_rules, reviewRequest: S.o.review || null });
    S.o.report = BRM.exportScreeningReports(S.o.summary, S.o.explain, { reportTemplate: S.ctl.report_template, generated: new Date().toISOString().slice(0, 10) });
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
  function map(el, { pick = false, layer = 'risk', mark = null, onPick = null, onCell = null, still = false, results = S.o.results } = {}) {
    const R = results ? Object.fromEntries(results.cells.map(c => [c.cell_id, c])) : {};
    const m = L.map(el, { zoomSnap: .25, scrollWheelZoom: false, zoomControl: !still, attributionControl: !still, dragging: !still });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { opacity: .6, attribution: '&copy; OpenStreetMap' }).addTo(m);
    const style = f => { const id = f.properties.id, r = R[id], on = (pick && S.site.has(id)) || (mark && mark.has(id));
      return { fillColor: r ? (layer === 'hq' ? hq(r.habitat_quality) : S.ctl.map_display_rules.colors[r.risk_class]) : '#c9d3ce', fillOpacity: mark && !on ? .3 : .85, color: on ? '#E3A72F' : '#fff', weight: on ? 3.5 : .7 }; };
    const g = L.geoJSON({ type: 'FeatureCollection', features: S.raw['TIGER-BOUNDARY'].records.map(r => ({ type: 'Feature', properties: { id: r.cell_id }, geometry: { type: 'Polygon', coordinates: r.geometry } })) },
      { style, onEachFeature: (f, l) => { const id = f.properties.id;
        l.bindTooltip(() => { const r = R[id]; return `<b>${id}</b> · ${cellName(id)}${r ? `<br>${r.land_cover}, risk ${f2(r.risk_score)} (${r.risk_class})` : ''}`; }, { sticky: true });
        l.on('click', () => { if (pick) { S.site.has(id) ? S.site.delete(id) : S.site.add(id); g.setStyle(style); if (onPick) onPick(); } if (onCell) onCell(id); }); } }).addTo(m);
    setTimeout(() => { m.invalidateSize(); m.fitBounds(g.getBounds(), { padding: [10, 10] }); }, 0);
    S.maps.push(m);
  }
  const siteChips = () => `<div class="chips" id="chips" style="margin-top:8px">${[...S.site].sort().map(c => `<span>${c}</span>`).join('') || '<span>no cells yet</span>'}</div>`;
  const refreshChips = () => { $('chips').outerHTML = siteChips(); };

  /* ---------------- page frame ---------------- */
  function pills() {
    $('pills').innerHTML = [['Data', has('prep')], [S.sr && !has('results') ? `Habitat model (${S.sr.computed} plots)` : 'Habitat model', (has('results') && has('record')) || !!S.sr], ['Site', has('summary')]].map(([t, on]) => `<span class="${on ? 'on' : ''}">${on ? '✓ ' : ''}${t}</span>`).join('');
  }
  function frame(id, body, parent, actions = '') {
    const f = fn(id);
    $('crumbs').innerHTML = `<a href="#/">Home</a>${parent ? `<i>›</i><a href="#/${INFO[parent][0]}">${esc(fn(parent).name)}</a>` : ''}<i>›</i>${esc(f.name)}`;
    const chips = (a, empty) => (a && a.length ? `<div class="chips">${a.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : `<span class="muted">${empty}</span>`);
    $('app').innerHTML = `<div class="phead"><div><div class="who"><i></i>Done by ${esc(who(id))}</div><h1>${esc(f.name)}</h1><p class="muted">${INFO[id][1]}</p></div><div class="row" style="margin:0">${actions}</div></div>
      ${(f.inputs || []).length + (f.controls || []).length + (f.outputs || []).length ? `<div class="icom"><div style="--c:#7FA6B3"><b>Uses</b>${chips(f.inputs, 'nothing')}</div><div style="--c:#9C86CF"><b>Follows these rules</b>${chips(f.controls, 'no rules')}</div><div style="--c:#E3A72F"><b>Gives</b>${chips(f.outputs, 'nothing')}</div></div>` : ''}${body}`;
  }
  const need = (text, id) => `<div class="note"><span>${text}</span><button class="btn gold" id="${id}">Do it for me</button></div>`;
  const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text])); a.download = name; a.click(); };
  const P = {};

  /* ---------------- Home (Level 1) ---------------- */
  P[''] = () => {
    $('crumbs').innerHTML = '';
    const steps = S.model.level2.functions, done = stageDone();
    const card = id => `<a class="fcard" href="#/${INFO[id][0]}">${icon(id)}<div><h3>${esc(fn(id).name)}</h3><p>${INFO[id][1]}</p><span class="by">${esc(who(id))}</span>
      <div class="chips kids">${KIDS()[id].map(k => `<span>${esc(k.name)}</span>`).join('')}</div></div></a>`;
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
        <div><div class="map" id="m"></div>${legend()}</div></div>${has('summary') ? `<h2 style="margin-top:22px">${esc(S.o.summary.site_name)}</h2>${siteResult(S.o.summary)}<h2 style="margin-top:22px">Each plot</h2>${plotTable(plots(S.o.summary.cell_ids))}` : ''}`
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

  /* ================= shared helpers for the Level-1 sub-functions ================= */
  const recFor = score => S.ctl.site_summary_rules.recommendations.slice().sort((a, b) => b.min - a.min).find(r => score >= r.min).text;
  const THREAT = { road: 'Roads', urban: 'Towns', agriculture: 'Farms' };
  /* evaluate every plot (grid cell) on its own */
  function plots(ids, results = S.o.results) {
    const R = Object.fromEntries(results.cells.map(c => [c.cell_id, c])), Pp = Object.fromEntries(S.o.prep.cells.map(c => [c.cell_id, c]));
    return ids.map(id => { const r = R[id], p = Pp[id], top = Object.entries(r.threat_impact).sort((a, b) => b[1] - a[1])[0];
      return { id, where: cellName(id), land: r.land_cover, hq: r.habitat_quality, risk: r.risk_score, cls: r.risk_class, threat: top[1] > 0 ? `${THREAT[top[0]]} (${f2(top[1])})` : 'none',
        species: p.species_count, protected: p.protected, review: r.risk_score >= S.ctl.site_summary_rules.review_threshold, rec: recFor(r.risk_score) }; });
  }
  function plotTable(rows) {
    return `<div class="panel" style="margin-top:16px;padding:0;overflow:auto"><table class="plots"><tr><th>Plot</th><th>Location</th><th>Land cover</th><th>Habitat quality</th><th>Risk</th><th>Main threat</th><th>Species records</th><th>What to do</th></tr>
      ${rows.map((r, i) => `<tr class="${r.review ? 'flag' : ''}"><td><span class="rank">${i + 1}</span> <b>${r.id}</b></td><td class="muted small">${r.where}</td><td>${r.land}${r.protected ? ' <span class="mini">protected</span>' : ''}</td>
        <td>${f2(r.hq)}</td><td><b>${f2(r.risk)}</b> ${badge(r.cls)}</td><td>${r.threat}</td><td>${r.species == null ? '<span class="mini bad">missing</span>' : r.species}</td><td class="small">${esc(r.rec)}</td></tr>`).join('')}</table></div>`;
  }
  const plotsCSV = rows => 'plot,cell,row_from_south,column_from_west,land_cover,habitat_quality,risk_score,risk_level,main_threat,species_records,above_review_level,recommendation\n' +
    rows.map((r, i) => { const m = /^R(\d+)-C(\d+)$/.exec(r.id); return [i + 1, r.id, +m[1], +m[2], r.land, r.hq, r.risk, r.cls, r.threat, r.species ?? '', r.review ? 'yes' : 'no', `"${r.rec}"`].join(','); }).join('\n');
  /* hub page for a Level-1 function: its sub-functions as buttons (from the Innoslate hierarchy diagram) */
  function hub(id, done, intro, actions = '') {
    const kids = KIDS()[id];
    frame(id, `${intro || ''}<div class="sectiontitle"><h2>${kids.length} steps inside</h2><span class="small muted">From the Innoslate hierarchy diagram</span></div>
      <div class="flowgrid">${kids.map((k, i) => `<a class="stage ${done[k.id] ? 'done' : ''}" href="#/${INFO[k.id][0]}"><span class="n">${done[k.id] ? '✓' : i + 1}</span><h3>${esc(k.name)}</h3><p>${INFO[k.id][1]}</p>
        <span class="st">${done[k.id] ? 'Done' : 'Not done yet'}</span></a>`).join('')}</div>`, null, actions);
  }
  const subNav = (id) => { const p = id.split('.').slice(0, 2).join('.'), kids = KIDS()[p], i = kids.findIndex(k => k.id === id);
    return `<div class="subnav">${i > 0 ? `<a class="btn light" href="#/${INFO[kids[i - 1].id][0]}">← ${esc(kids[i - 1].name)}</a>` : `<a class="btn light" href="#/${INFO[p][0]}">← All steps</a>`}
      ${i < kids.length - 1 ? `<a class="btn" href="#/${INFO[kids[i + 1].id][0]}">Next: ${esc(kids[i + 1].name)} →</a>` : `<a class="btn" href="#/${INFO[p][0]}">Back to ${esc(fn(p).name)}</a>`}</div>`; };
  const needModel = id => `<div class="note"><span>The county has not been scored yet.</span><button class="btn gold" id="${id}">Score the county now</button></div>`;
  const bindNeed = id => { if ($(id)) $(id).onclick = () => { ensure(); toast('County scored'); render(); }; return !!$(id); };

  /* ================= F.5 Screen Proposed Development Sites ================= */
  P.screen = () => {
    hub('F.5', { 'F.5.1': S.site.size > 0 && S.located, 'F.5.2': S.overlaid, 'F.5.3': has('summary'), 'F.5.4': S.downloaded },
      '<p>A planner screens a proposed project in four steps. Every plot (grid cell) of the site is evaluated on its own, and the site as a whole.</p>',
      `<button class="btn" id="fast">Screen the example site in one go</button>`);
    $('fast').onclick = () => { S.site = new Set(S.demo.cell_ids); S.located = true; S.overlaid = true; S.siteName = S.project; scoreSite(); if (scr()) screenReport(); location.hash = '#/screen/summarize'; };
  };
  P['screen/locate'] = () => {
    frame('F.5.1', `<div class="two"><div class="panel"><h2>Your project</h2><label>Project name<input type="text" id="pn" value="${esc(S.project)}"></label>
      <label>Applicant<input type="text" id="ap" value="${esc(S.applicant)}"></label>
      <label>Plots (grid cells)<span class="hint">Click cells on the map, or type cell names like R05-C08 separated by commas.</span><input type="text" id="cells" value="${[...S.site].sort().join(', ')}"></label>
      <div class="row"><button class="btn" id="save">Save site</button><button class="btn light" id="demo">Use example site</button><button class="btn light" id="clr">Clear</button></div>
      ${S.located ? `<div class="okline">✓ Site saved with ${S.site.size} plot${S.site.size > 1 ? 's' : ''}.</div>` : ''}</div>
      <div><div class="map" id="m"></div><p class="hint">Cell R05-C08 = row 5 from the south edge, column 8 from the west edge. Each cell is 1 km × 1 km.</p></div></div>${subNav('F.5.1')}`, 'F.5');
    map($('m'), { pick: true, onPick: () => { $('cells').value = [...S.site].sort().join(', '); S.located = false; } });
    $('demo').onclick = () => { S.site = new Set(S.demo.cell_ids); S.located = false; render(); };
    $('clr').onclick = () => { S.site.clear(); S.located = false; render(); };
    $('save').onclick = () => {
      const ids = $('cells').value.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean), valid = new Set(S.raw['TIGER-BOUNDARY'].records.map(r => r.cell_id));
      const bad = ids.filter(i => !valid.has(i)); if (bad.length) return toast(`Unknown cell: ${bad.join(', ')}`);
      if (!ids.length) return toast('Pick at least one cell');
      S.site = new Set(ids); S.project = $('pn').value; S.applicant = $('ap').value; S.siteName = S.project; S.located = true; S.overlaid = false; clearFrom('summary'); toast('Site saved'); render();
    };
  };
  P['screen/overlay'] = () => {
    frame('F.5.2', !S.located ? `<div class="note"><span>Locate the site first.</span><a class="btn gold" href="#/screen/locate">Locate Site</a></div>`
      : !scr() ? needSite('nm') : `${scopeNote()}<div class="panel"><div class="map" id="m" style="height:470px"></div>${legend()}<p class="hint">Yellow outline = your ${S.site.size} plots.${scr().mode === 'site' ? ' Grey cells were not calculated.' : ''}</p></div>
        <div class="stats">${plots([...S.site].sort(), scr().results).map((r, i) => `<div class="stat"><small>Plot ${i + 1} · ${r.id}</small><b>${f2(r.risk)}</b>${badge(r.cls)}</div>`).join('')}</div>${subNav('F.5.2')}`, 'F.5');
    if (bindSite('nm') || !S.located) return;
    S.overlaid = true; map($('m'), { mark: S.site, results: scr().results });
  };
  P['screen/summarize'] = () => {
    const ready = S.located && !!scr();
    frame('F.5.3', !S.located ? `<div class="note"><span>Locate the site first.</span><a class="btn gold" href="#/screen/locate">Locate Site</a></div>` : !scr() ? needSite('nm')
      : `${scopeNote()}${has('summary') ? `<h2>Whole site: ${esc(S.o.summary.site_name)}</h2>${siteResult(S.o.summary)}<h2 style="margin-top:24px">Each plot</h2><p class="small muted">Every plot is judged on its own. Rows with a yellow edge are at or above the review level ${S.ctl.site_summary_rules.review_threshold}.</p>${plotTable(plots(S.o.summary.cell_ids, scr().results))}`
        : `<div class="panel"><p>Press <b>Summarize</b> to evaluate each of the ${S.site.size} plots and the site as a whole.</p></div>`}${subNav('F.5.3')}`, 'F.5', ready ? '<button class="btn" id="go">Summarize</button>' : '');
    if (bindSite('nm')) return;
    if ($('go')) $('go').onclick = () => { S.siteName = S.project; screenReport(); toast('Site summarized'); render(); };
  };
  P['screen/download'] = () => {
    const ok = has('summary') && has('report');
    frame('F.5.4', ok ? `<div class="stats"><div class="stat"><small>Screening report</small><b>.md</b><span>result, reasons, limits, data sources</span><div class="row"><button class="btn" id="md">Download report</button></div></div>
        <div class="stat"><small>Plot table</small><b>.csv</b><span>one row per plot, opens in Excel</span><div class="row"><button class="btn" id="csv">Download plot table</button></div></div></div>
        <div class="row"><a class="btn light" href="#/assess/export">Preview the report</a></div>${subNav('F.5.4')}`
      : `<div class="note"><span>Summarize the site first.</span><a class="btn gold" href="#/screen/summarize">Summarize Site Risk</a></div>`, 'F.5');
    if (!ok) return;
    $('md').onclick = () => { download(`${S.project.replace(/\W+/g, '-')}-screening-report.md`, S.o.report.markdown); S.downloaded = true; };
    $('csv').onclick = () => { download(`${S.project.replace(/\W+/g, '-')}-plots.csv`, plotsCSV(plots(S.o.summary.cell_ids, (scr() || {}).results || S.o.results))); S.downloaded = true; };
  };

  /* ================= F.1 Identify Conservation Priorities ================= */
  const F1 = () => S.f1;
  function f1Matches() {
    const f = F1(), Pp = Object.fromEntries(S.o.prep.cells.map(c => [c.cell_id, c]));
    return S.o.results.cells.filter(c => (f.hab === 'Any' || c.land_cover === f.hab) && f.classes.has(c.risk_class) && c.habitat_quality >= f.minq && (!f.unprot || !Pp[c.cell_id].protected))
      .sort((a, b) => b.habitat_quality - a.habitat_quality || (Pp[b.cell_id].species_count || 0) - (Pp[a.cell_id].species_count || 0)).map(c => c.cell_id);
  }
  P.conservation = () => {
    hub('F.1', { 'F.1.1': !!F1().matches, 'F.1.2': !!F1().inspected, 'F.1.3': !!F1().evidence, 'F.1.4': !!F1().exported },
      `<div class="panel" style="margin-bottom:18px"><label style="margin-top:0">Organization name<input type="text" id="org" value="${esc(F1().org)}" placeholder="e.g. Finger Lakes Land Trust"></label><p class="hint">Used to label your evidence and priority list.</p></div>`);
    $('org').onchange = e => { F1().org = e.target.value; };
  };
  P['conservation/filters'] = () => {
    const f = F1();
    frame('F.1.1', !has('results') ? needModel('nm') : `<div class="two"><div class="panel"><h2>Filters</h2>
      <label>Habitat type<select id="hab">${['Any', 'Forest', 'Wetland', 'Mixed habitat', 'Agriculture'].map(h => `<option ${h === f.hab ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
      <label>Risk levels to include</label>${Object.keys(S.ctl.map_display_rules.colors).map(c => `<label class="chk"><input type="checkbox" class="cls" value="${c}" ${f.classes.has(c) ? 'checked' : ''}> ${badge(c)}</label>`).join('')}
      <label>Minimum habitat quality: <output id="mqv">${f.minq}</output><input type="range" id="mq" min="0" max="1" step="0.05" value="${f.minq}" style="width:100%"></label>
      <label class="chk"><input type="checkbox" id="unp" ${f.unprot ? 'checked' : ''}> Only land that is not protected yet</label>
      <div class="row"><button class="btn" id="go">Apply filters</button></div></div>
      <div><div class="map" id="m"></div><p class="hint">${f.matches ? `<b>${f.matches.length}</b> of 168 cells match (yellow outline).` : 'Apply the filters to see matching cells.'}</p></div></div>${subNav('F.1.1')}`, 'F.1');
    if (bindNeed('nm')) return;
    map($('m'), { layer: 'hq', mark: f.matches ? new Set(f.matches) : null });
    $('mq').oninput = e => { $('mqv').textContent = e.target.value; };
    $('go').onclick = () => { f.hab = $('hab').value; f.classes = new Set([...document.querySelectorAll('.cls:checked')].map(i => i.value)); f.minq = +$('mq').value; f.unprot = $('unp').checked; f.matches = f1Matches(); f.inspected = null; f.evidence = null; toast(`${f.matches.length} cells match`); render(); };
  };
  P['conservation/inspect'] = () => {
    const f = F1();
    frame('F.1.2', !f.matches ? `<div class="note"><span>Apply the filters first.</span><a class="btn gold" href="#/conservation/filters">Select Area and Risk filters</a></div>`
      : `<div class="two"><div class="panel"><h2>Matching cells</h2><div class="chips pickable">${f.matches.slice(0, 30).map(c => `<span data-c="${c}" class="${c === f.inspected ? 'on' : ''}">${c}</span>`).join('')}</div>
        <p class="hint">${f.matches.length > 30 ? `Showing the best 30 of ${f.matches.length}. ` : ''}Click a cell here or on the map.</p><div id="detail">${f.inspected ? cellDetail(f.inspected) : ''}</div></div>
        <div><div class="map" id="m"></div></div></div>${subNav('F.1.2')}`, 'F.1');
    if (!f.matches) return;
    const show = c => { f.inspected = c; render(); };
    map($('m'), { layer: 'hq', mark: new Set(f.matches), onCell: show });
    document.querySelectorAll('.pickable span').forEach(s => s.onclick = () => show(s.dataset.c));
  };
  function cellDetail(id) {
    const r = plots([id])[0], c = S.o.results.cells.find(x => x.cell_id === id);
    const bar = (n, v) => `<div class="bar"><span>${n}</span><i><b style="width:${v * 100}%"></b></i><em>${f2(v)}</em></div>`;
    return `<h3 style="margin-top:14px">${id} <span class="muted small">${r.where}</span></h3><p>${r.land}${r.protected ? ', protected' : ''} · risk <b>${f2(r.risk)}</b> ${badge(r.cls)}</p>
      ${bar('Habitat suitability', c.habitat_suitability)}${bar('Road pressure', c.threat_impact.road)}${bar('Town pressure', c.threat_impact.urban)}${bar('Farm pressure', c.threat_impact.agriculture)}${bar('Habitat quality', c.habitat_quality)}
      <p class="hint">${r.species == null ? 'No species records.' : `${r.species} species records.`} Pressure 1 = the threat is right at the cell.</p>`;
  }
  P['conservation/evidence'] = () => {
    const f = F1(), ev = f.evidence;
    frame('F.1.3', !f.matches || !f.matches.length ? `<div class="note"><span>Find matching cells first.</span><a class="btn gold" href="#/conservation/filters">Select Area and Risk filters</a></div>`
      : `<div class="panel"><h2>Which cells?</h2><p class="hint">Tick up to 10 cells (the best ones are ticked).</p><div class="chips pickable">${f.matches.slice(0, 20).map((c, i) => `<label class="chk chipchk"><input type="checkbox" class="ev" value="${c}" ${(f.evCells ? f.evCells.includes(c) : i < 5) ? 'checked' : ''}> ${c}</label>`).join('')}</div>
        <div class="row"><button class="btn" id="go">Request evidence</button></div></div>
        ${ev ? `<div class="two" style="grid-template-columns:1fr 1fr;margin-top:16px"><div class="panel"><h2>Evidence</h2><ul class="nice">${ev.factors.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
          <div class="panel"><h2>Data sources</h2><ul class="nice" style="--c:var(--moss)">${ev.sources.map(t => `<li>${esc(t)}</li>`).join('')}</ul><h2 style="margin-top:12px">Limits</h2><ul class="nice" style="--c:var(--gold)">${ev.limitations.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div></div>` : ''}${subNav('F.1.3')}`, 'F.1');
    if (!$('go')) return;
    $('go').onclick = () => {
      const cells = [...document.querySelectorAll('.ev:checked')].map(i => i.value).slice(0, 10); if (!cells.length) return toast('Tick at least one cell');
      const s = BRM.summarizeSiteConditions(S.o.prep, S.o.results, {}, { siteSelection: { name: `${f.org || 'Conservation'} candidates`, cell_ids: cells }, siteSummaryRules: S.ctl.site_summary_rules });
      f.evCells = cells; f.evidence = BRM.explainResultsAndLimitations(s, S.o.dq, S.o.record, { interpretationRules: S.ctl.interpretation_rules }); toast('Evidence received'); render();
    };
  };
  P['conservation/export'] = () => {
    const f = F1();
    frame('F.1.4', !f.matches || !f.matches.length ? `<div class="note"><span>Find matching cells first.</span><a class="btn gold" href="#/conservation/filters">Select Area and Risk filters</a></div>`
      : `<div class="panel"><label style="margin-top:0">How many priority areas?<select id="n">${[5, 10, 15, 20].map(v => `<option ${v === f.n ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
        ${plotTable(plots(f.matches.slice(0, f.n)))}<div class="row"><button class="btn" id="dl">Download priority list (.csv)</button></div>${subNav('F.1.4')}`, 'F.1');
    if (!$('dl')) return;
    $('n').onchange = e => { f.n = +e.target.value; render(); };
    $('dl').onclick = () => { download(`${(f.org || 'conservation').replace(/\W+/g, '-')}-priority-areas.csv`, plotsCSV(plots(f.matches.slice(0, f.n)))); f.exported = true; toast('Priority list downloaded'); };
  };

  /* ================= F.3 Review Environmental Screening Evidence ================= */
  P.review = () => hub('F.3', { 'F.3.1': S.f3.coverage != null, 'F.3.2': S.f3.approved, 'F.3.3': S.f3.presented, 'F.3.4': S.f3.decisions.length > 0 },
    '<p>A government agency checks the data, approves what may be used, looks at the method and evidence, and records the decision on a site.</p>');
  P['review/coverage'] = () => {
    const c = S.o.cov;
    frame('F.3.1', !has('prep') ? `<div class="note"><span>The data has not been checked yet.</span><button class="btn gold" id="pre">Load and check data</button></div>`
      : `<div class="stats"><div class="stat"><small>Grid cells with complete data</small><b>${c.prepared_cells} / ${c.grid_cells}</b><span>${c.status === 'COMPLETE' ? 'whole county covered' : 'coverage incomplete'}</span></div>
        <div class="stat"><small>Cells without species records</small><b style="color:var(--bad)">${S.o.dq.data_gap_cells.length}</b><span>${S.o.dq.data_gap_cells.join(', ')}</span></div>
        <div class="stat"><small>Rejected sources</small><b>${S.o.acq.rejected_sources.length}</b><span>${S.o.acq.rejected_sources.map(r => S.raw[r.source_id].title).join(', ') || 'none'}</span></div></div>
        <div class="panel" style="margin-top:16px"><h2>Your check</h2><div class="row" style="margin-top:0"><button class="btn" data-v="ok">Coverage is acceptable</button><button class="btn light" data-v="no">Not acceptable</button></div>
        ${S.f3.coverage != null ? `<div class="${S.f3.coverage ? 'okline' : 'warn'}">${S.f3.coverage ? '✓ Coverage accepted.' : 'Coverage not accepted. Results should not be used until the gaps are filled.'}</div>` : ''}</div>${subNav('F.3.1')}`, 'F.3');
    if ($('pre')) { $('pre').onclick = () => { run.acquire(); run.prepare(); render(); }; return; }
    document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { S.f3.coverage = b.dataset.v === 'ok'; render(); });
  };
  P['review/approve'] = () => {
    const ok = new Set(S.ctl.approved_source_list.approved_sources);
    frame('F.3.2', `<div class="two" style="grid-template-columns:1fr 1fr"><div class="panel"><h2>Approved data sources</h2><p class="hint">Only ticked sources can be loaded by the map.</p>
        ${Object.values(S.raw).map(d => `<label class="chk"><input type="checkbox" class="src" value="${d.source_id}" ${ok.has(d.source_id) ? 'checked' : ''}> ${esc(d.title)}</label>`).join('')}</div>
      <div class="panel"><h2>Limitations every result must show</h2><ul class="nice" style="--c:var(--gold)">${S.ctl.interpretation_rules.limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
        <p class="hint">${esc(S.ctl.interpretation_rules.disclaimer)}</p></div></div>
      <div class="row"><button class="btn" id="go">Approve</button></div>${S.f3.approved ? '<div class="okline">✓ Data sources and limitations approved.</div>' : ''}${subNav('F.3.2')}`, 'F.3');
    $('go').onclick = () => {
      const list = [...document.querySelectorAll('.src:checked')].map(i => i.value), changed = list.sort().join() !== [...ok].sort().join();
      S.ctl.approved_source_list = Object.assign({}, S.ctl.approved_source_list, { approved_sources: list }); S.f3.approved = true;
      if (changed) { clearFrom('acq'); delete S.o.dsid; toast('Approved list changed: data must be loaded again'); } else toast('Approved'); render();
    };
  };
  P['review/method'] = () => {
    const p = S.ctl.habitat_model_parameters, tot = p.threats.road.weight + p.threats.urban.weight + p.threats.agriculture.weight, x = S.o.explain;
    S.f3.presented = true;
    frame('F.3.3', `<div class="two" style="grid-template-columns:1fr 1fr"><div class="panel"><h2>Method</h2>
        <ol class="steps-list"><li>Each 1 km cell gets its land cover and its distance to roads, towns and farms.</li><li>Each threat fades with distance and is weighted: roads ${Math.round(p.threats.road.weight / tot * 100)}%, towns ${Math.round(p.threats.urban.weight / tot * 100)}%, farms ${Math.round(p.threats.agriculture.weight / tot * 100)}%.</li>
          <li>Protected land feels threats at 30% strength.</li><li>Habitat quality = suitability × (1 − D<sup>z</sup> ÷ (D<sup>z</sup> + k<sup>z</sup>)), with k = ${p.k} and z = ${p.z} (InVEST Habitat Quality).</li><li>Risk = 1 − habitat quality, grouped into five levels.</li></ol></div>
      <div class="panel"><h2>Evidence for the current site</h2>${x ? `<p><b>${esc(S.o.summary.site_name)}</b> ${badge(S.o.summary.risk_class)}</p><ul class="nice">${x.factors.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">No site has been screened yet. <a href="#/screen">Screen a site</a>.</p>'}</div></div>${subNav('F.3.3')}`, 'F.3');
  };
  P['review/decision'] = () => {
    const s = S.o.summary;
    frame('F.3.4', !s ? `<div class="note"><span>No site has been screened yet.</span><a class="btn gold" href="#/screen">Screen a site</a></div>`
      : `<div class="two"><div class="panel"><h2>${esc(s.site_name)}</h2><p>${badge(s.risk_class)} average risk ${f2(s.mean_risk)}, ${s.cells_over_threshold} of ${s.cell_count} plots at review level.</p>
        <label>Reviewer<input type="text" id="rv" placeholder="Your name"></label><label>Decision<select id="dc"><option>Accept screening, no further action</option><option>Accept with conditions</option><option>Require a field survey</option><option>Ask for more data</option></select></label>
        <label>Notes<input type="text" id="cm"></label><div class="row"><button class="btn" id="go">Record decision</button></div></div>
        <div class="panel"><h2>Decision log</h2>${S.f3.decisions.length ? `<table><tr><th>Site</th><th>Decision</th><th>Reviewer</th><th>Notes</th></tr>${S.f3.decisions.map(d => `<tr><td>${esc(d.site)}</td><td><b>${esc(d.decision)}</b></td><td>${esc(d.reviewer)}</td><td class="small">${esc(d.comment)}</td></tr>`).join('')}</table>` : '<p class="muted">No decisions yet.</p>'}</div></div>${subNav('F.3.4')}`, 'F.3');
    if (!s) return;
    $('go').onclick = () => { const d = { site: s.site_name, reviewer: $('rv').value || 'Reviewer', decision: $('dc').value, comment: $('cm').value }; S.f3.decisions.unshift(d); S.o.review = d; run.explain(); run.export(); toast('Decision recorded'); render(); };
  };

  /* ================= F.4 Maintain Biodiversity Risk Map ================= */
  P.maintain = () => hub('F.4', { 'F.4.1': has('acq'), 'F.4.2': has('prep'), 'F.4.3': has('results') && has('record'), 'F.4.4': has('published'), 'F.4.5': S.packaged },
    '<p>The IT team keeps the map running: refresh data, build the grid, calculate scores, publish them and deliver files.</p>');
  P['maintain/acquire'] = () => {
    const a = S.o.acq;
    frame('F.4.1', `<div class="panel" style="padding:0"><table><tr><th>Source</th><th>What it gives</th><th>Records</th><th>Retrieved</th><th>Status</th></tr>
      ${Object.values(S.raw).map(d => { const ok = a && a.metadata.some(m => m.source_id === d.source_id), rej = a && a.rejected_sources.some(r => r.source_id === d.source_id);
        return `<tr><td><b>${esc(d.title)}</b></td><td class="small">${SRC[d.source_id] || ''}</td><td>${d.records.length}</td><td>${d.retrieved}</td><td>${ok ? '<span class="mini">loaded</span>' : rej ? '<span class="mini bad">not approved</span>' : '<span class="mini grey">not loaded</span>'}</td></tr>`; }).join('')}</table></div>
      <div class="row"><button class="btn" id="go">${a ? 'Refresh data' : 'Acquire source data'}</button></div>${subNav('F.4.1')}`, 'F.4');
    $('go').onclick = () => { run.acquire(); toast('Source data acquired'); render(); };
  };
  P['maintain/grid'] = () => {
    frame('F.4.2', !has('acq') ? `<div class="note"><span>Acquire the source data first.</span><a class="btn gold" href="#/maintain/acquire">Acquire Source Data</a></div>`
      : `<div class="two"><div class="panel"><h2>Study grid</h2><ul class="nice"><li>12 rows × 14 columns = 168 cells</li><li>Each cell is 1 km × 1 km</li><li>Cell names: R(row from south)-C(column from west)</li><li>Every dataset is lined up on this grid</li></ul>
        <div class="row"><button class="btn" id="go">${has('prep') ? 'Rebuild grid' : 'Build study grid'}</button></div>${has('prep') ? `<div class="okline">✓ ${S.o.cov.prepared_cells} cells built.</div>` : ''}</div>
        <div><div class="map" id="m"></div></div></div>${subNav('F.4.2')}`, 'F.4');
    if (!$('go')) return;
    map($('m'), {});
    $('go').onclick = () => { run.prepare(); toast('Study grid built'); render(); };
  };
  P['maintain/calculate'] = () => {
    const p = S.ctl.habitat_model_parameters;
    const sl = (label, get, set, min, max, step) => `<div class="sl"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${get(p)}" data-set="${set}"><output>${get(p)}</output></div>`;
    frame('F.4.3', `<div class="two" style="grid-template-columns:1fr 1fr"><div class="panel"><h2>Threat weights</h2><p class="hint">How much each threat counts.</p>
        ${sl('Roads', q => q.threats.road.weight, 'threats.road.weight', 0, 1, .05)}${sl('Towns', q => q.threats.urban.weight, 'threats.urban.weight', 0, 1, .05)}${sl('Farms', q => q.threats.agriculture.weight, 'threats.agriculture.weight', 0, 1, .05)}
        <h2 style="margin-top:16px">Threat reach (km)</h2><p class="hint">Beyond this distance a threat has no effect.</p>
        ${sl('Roads', q => q.threats.road.max_distance_km, 'threats.road.max_distance_km', .5, 6, .5)}${sl('Towns', q => q.threats.urban.max_distance_km, 'threats.urban.max_distance_km', 1, 12, .5)}${sl('Farms', q => q.threats.agriculture.max_distance_km, 'threats.agriculture.max_distance_km', .5, 6, .5)}</div>
      <div class="panel"><h2>Model shape</h2><p class="hint"><b>k</b>: how much damage cuts habitat quality in half. <b>z</b>: how fast quality drops after that (InVEST uses 2.5).</p>
        ${sl('k', q => q.k, 'k', .05, 1, .05)}${sl('z', q => q.z, 'z', 1, 4, .5)}
        <h2 style="margin-top:16px">Habitat suitability</h2><p class="hint">How good each land cover is as habitat (0–1).</p>
        ${Object.keys(p.habitat_suitability).map(h => sl(h, q => q.habitat_suitability[h], `habitat_suitability.${h}`, 0, 1, .05)).join('')}</div></div>
      <div class="row"><button class="btn" id="go" ${has('prep') ? '' : 'disabled'}>Calculate risk scores</button><button class="btn light" id="def">Back to default</button><a class="btn light" href="#/assess/habitat">See the 6 model steps</a></div>
      ${!has('prep') ? '<div class="note" style="margin-top:12px"><span>Build the study grid first.</span><a class="btn gold" href="#/maintain/grid">Build Study Grid</a></div>' : ''}
      ${has('results') && has('record') ? `<div class="okline">✓ All 168 cells scored: ${Object.entries(S.o.results.class_counts).map(([k, v]) => `${k} ${v}`).join(' · ')}. Next: publish them.</div>` : ''}${subNav('F.4.3')}`, 'F.4');
    document.querySelectorAll('[data-set]').forEach(i => i.oninput = () => { const ks = i.dataset.set.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], p)[last] = +i.value; i.nextElementSibling.textContent = i.value; });
    $('go').onclick = () => { habitatAll(); toast('Risk scores calculated'); render(); };
    $('def').onclick = () => { S.ctl.habitat_model_parameters = JSON.parse(JSON.stringify(S.defaults)); clearFrom('ps'); render(); };
  };
  P['maintain/publish'] = () => {
    const pub = S.o.published;
    frame('F.4.4', !(has('results') && has('record')) ? `<div class="note"><span>Calculate the risk scores first.</span><a class="btn gold" href="#/maintain/calculate">Calculate Risk Scores</a></div>`
      : `<div class="two"><div class="panel"><h2>Ready to publish</h2><div class="distbar">${Object.entries(S.o.results.class_counts).reverse().map(([k, v]) => `<span style="flex:${v};background:${S.ctl.map_display_rules.colors[k]}" title="${k} ${v}"></span>`).join('')}</div>
        <ul class="nice">${Object.entries(S.o.results.class_counts).map(([k, v]) => `<li>${badge(k)} ${v} cells</li>`).join('')}</ul>
        <div class="row"><button class="btn" id="go">${pub ? 'Publish again' : 'Publish risk dataset'}</button></div>${pub ? `<div class="okline">✓ Published on ${pub.date}. Planners and conservation groups now see these scores.</div>` : ''}</div>
        <div><div class="map" id="m"></div>${legend()}</div></div>${subNav('F.4.4')}`, 'F.4');
    if (!$('go')) return;
    map($('m'), {});
    $('go').onclick = () => { S.o.published = { date: new Date().toLocaleString() }; toast('Risk dataset published'); render(); };
  };
  P['maintain/package'] = () => {
    frame('F.4.5', !has('published') ? `<div class="note"><span>Publish the risk dataset first.</span><a class="btn gold" href="#/maintain/publish">Publish Risk Dataset</a></div>`
      : `<div class="stats"><div class="stat"><small>All 168 cells</small><b>.csv</b><span>table for Excel</span><div class="row"><button class="btn" id="csv">Download table</button></div></div>
        <div class="stat"><small>Map layer</small><b>.geojson</b><span>for GIS software (QGIS, ArcGIS)</span><div class="row"><button class="btn" id="gj">Download map layer</button></div></div></div>${subNav('F.4.5')}`, 'F.4');
    if (!$('csv')) return;
    const all = () => plots(S.o.results.cells.map(c => c.cell_id));
    $('csv').onclick = () => { download('risk-grid-all-cells.csv', plotsCSV(all())); S.packaged = true; };
    $('gj').onclick = () => { if (!has('map')) run.display(); download('risk-grid.geojson', JSON.stringify(S.o.map)); S.packaged = true; };
  };
  const SRC = { 'TIGER-BOUNDARY': 'County outline and grid', 'USGS-NLCD-LANDCOVER': 'Land cover of each cell', 'OSM-ROADS': 'Distance to roads', 'NLCD-DEVELOPED': 'Distance to towns',
    'NLCD-CULTIVATED': 'Distance to farms', 'USGS-PADUS': 'Protected land', 'GBIF-OCCURRENCES': 'Species records', 'SCRAPED-BLOG-LAYER': 'Unverified layer from a blog' };

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
      demo: site.site_selection, siteName: site.site_selection.name, project: 'Route 13 commercial plaza', applicant: 'Example Developments LLC',
      f1: { org: '', hab: 'Any', classes: new Set(['Very low', 'Low']), minq: 0.7, unprot: true, n: 10 }, f3: { coverage: null, approved: false, presented: false, decisions: [] } });
    S.o.logs = []; S.o.qas = [];
    site.site_selection.cell_ids.forEach(c => S.site.add(c)); S.located = true;
    render();
  }
  init().catch(e => { $('app').innerHTML = `<p>Could not load data: ${esc(e.message)}. Open this page through <code>python -m http.server</code> inside the <code>dist</code> folder.</p>`; });
})();
