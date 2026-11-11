/* Biodiversity Risk Map — web app (front end of C.2.5 Web Map Subsystem).
 *
 * Routes (docs/route-table.md):
 *   #/home         Dashboard: map, quick site check, processing pipeline (F.2.1-F.2.7), feature tiles
 *   #/map          View the county risk map                   -> F.2.5 (+ F.2.3 results per cell)
 *   #/site         Screen a proposed development site         -> F.2.4 -> F.2.5 -> F.2.6
 *   #/model/F.2.3  Run the habitat model step by step         -> F.2.3.1 ... F.2.3.6 (live); "How it works" = IDEF0 L1-L3
 *   #/data         Data sources, quality checks, rule files   -> F.2.1, F.2.2
 *   #/reports      Screening report                           -> F.2.7
 * The "Model IDs" switch overlays the Innoslate function ID on every feature.
 */
/* global L, BRM */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmt = (x, d = 2) => Number(x).toFixed(d);
  const S = { site: new Set(), layer: 'risk', lastOut: {}, maps: {} };

  const ROLES = [
    { id: 'planner', label: 'Planner', fn: 'F.5', mech: 'C.5 Local Planner', text: 'Local planners screen proposed sites and choose which cells to check.' },
    { id: 'conservation', label: 'Conservation group', fn: 'F.1', mech: 'C.1 Conservation Organizations', text: 'Conservation groups use the habitat-quality layer to set priorities.' },
    { id: 'agency', label: 'Agency', fn: 'F.3', mech: 'C.3 Government Agencies', text: 'Agencies approve data sources, interpretation rules and the report template, and review the evidence.' },
    { id: 'it', label: 'IT team', fn: 'F.4', mech: 'C.4 IT Development Team', text: 'The IT team maintains the model settings, data-quality rules and map styling.' },
  ];
  const STAGES = {
    'F.2.1': { t: 'Collect data', who: 'Agency-approved sources', go: '#/data' },
    'F.2.2': { t: 'Check quality', who: 'IT team quality rules', go: '#/data' },
    'F.2.3': { t: 'Model habitat', who: 'IT team model settings', go: '#/model/F.2.3' },
    'F.2.4': { t: 'Summarize sites', who: 'Planner picks the site', go: '#/site' },
    'F.2.5': { t: 'Draw the map', who: 'IT team map style', go: '#/map' },
    'F.2.6': { t: 'Explain results', who: 'Agency interpretation rules', go: '#/site' },
    'F.2.7': { t: 'Write the report', who: 'Agency report template', go: '#/reports' },
  };
  const STEPS = {
    'F.2.3.1': { t: 'Assemble inputs', d: 'Gathers land cover, distances to roads, towns and farmland, and protection status for every cell.' },
    'F.2.3.2': { t: 'Approve settings', d: 'Checks the settings cover every threat and land-cover type, then freezes them under a parameter-set ID.' },
    'F.2.3.3': { t: 'Run InVEST', d: 'Computes threat degradation and habitat quality for each cell with the pinned InVEST equations.' },
    'F.2.3.4': { t: 'Quality check', d: 'Releases results only if every cell is present and every value is between 0 and 1.' },
    'F.2.3.6': { t: 'Record the run', d: 'Writes the run ID, data version, parameter set, engine version and QA history.' },
    'F.2.3.5': { t: 'Classify risk', d: 'Turns habitat quality into a risk score and one of five classes for the map.' },
  };

  /* ---------------------------------------------------------------- data */
  const getJSON = async p => { const r = await fetch(p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); };
  const getText = async p => { const r = await fetch(p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.text(); };
  function resultsFromGrid(grid) {
    return { run_id: grid.metadata.run_id, parameter_set_id: grid.metadata.parameter_set_id,
      cells: grid.features.map(({ properties: p }) => ({ cell_id: p.cell_id, land_cover: p.habitat, habitat_suitability: p.habitat_suitability,
        accessibility: p.accessibility, threat_impact: { road: p.road_effect, urban: p.urban_effect, agriculture: p.agriculture_effect },
        degradation: p.degradation, habitat_quality: p.habitat_quality, risk_score: p.risk_score, risk_class: p.risk_class })) };
  }
  const allFns = () => [].concat(S.model.level1.functions, S.model.level2.functions, S.model.level3.functions);
  const fdef = id => allFns().find(f => f.id === id);
  const fname = id => (fdef(id) || {}).name || '';
  const plain = t => String(t).replace(/^[FC](\.\d+)+\s+/, '');
  const classColor = c => S.cfg.map.colors[c];
  const classNames = () => Object.keys(S.cfg.map.colors);

  /* ---------------------------------------------------------------- trace */
  function setTrace(fids, note) {
    S.lastTrace = { fids, note };
  }

  /* ---------------------------------------------------------------- maps (F.2.5) */
  const hqColor = q => { const t = Math.max(0, Math.min(1, q)); const a = [230, 239, 219], b = [23, 63, 46]; return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; };
  function styleFor(kind) {
    return f => {
      const id = f.properties.cell_id, r = S.R[id], gap = f.properties.data_gap;
      const hf = kind === 'big' ? $('habitatFilter').value : 'all';
      const show = hf === 'all' || r.land_cover === hf;
      const sel = kind !== 'big' && S.site.has(id);
      return { fillColor: S.layer === 'risk' || kind !== 'big' ? classColor(r.risk_class) : hqColor(r.habitat_quality),
        fillOpacity: show ? S.cfg.map.fill_opacity : 0.08, color: sel ? '#E3A72F' : (gap ? '#6E1F1B' : '#ffffff'),
        weight: sel ? 3.5 : (gap ? 1.6 : 0.7), dashArray: gap && !sel ? '4 3' : null, opacity: 1 };
    };
  }
  function makeMap(el, kind, onClick) {
    const map = L.map(el, { zoomSnap: 0.25, zoomControl: kind !== 'home', attributionControl: kind !== 'home', scrollWheelZoom: kind !== 'home' });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, opacity: 0.55, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    if (kind !== 'home') map.attributionControl.addAttribution(S.cfg.map.attribution);
    const layer = L.geoJSON(S.grid, { style: styleFor(kind), onEachFeature: (f, l) => {
      l.on('click', () => onClick(f.properties.cell_id));
      l.bindTooltip(() => { const r = S.R[f.properties.cell_id]; return `<b>${r.cell_id}</b> ${esc(r.land_cover)}<br>Risk ${fmt(r.risk_score)} (${r.risk_class.toLowerCase()})`; }, { sticky: true });
    } }).addTo(map);
    const m = { map, layer, kind, fitted: false };
    S.maps[kind] = m; return m;
  }
  function showMap(kind) {
    const m = S.maps[kind]; if (!m) return;
    setTimeout(() => { m.map.invalidateSize(); if (!m.fitted) { m.map.fitBounds(m.layer.getBounds(), { padding: [18, 18] }); m.fitted = true; } }, 20);
  }
  function restyle() {
    Object.values(S.maps).forEach(m => m.layer.setStyle(styleFor(m.kind)));
    const leg = S.layer === 'risk' ? classNames().slice().reverse().map(k => `<span style="background:${classColor(k)}" class="${k === 'Moderate' || k === 'Low' ? 'dk' : ''}">${k}</span>`).join('')
      : ['0', '0.25', '0.5', '0.75', '1'].map(q => `<span style="background:${hqColor(+q)}" class="${+q < .5 ? 'dk' : ''}">Q ${q}</span>`).join('');
    $('bigLegend').innerHTML = leg;
    $('homeLegend').innerHTML = classNames().slice().reverse().map(k => `<span style="background:${classColor(k)}" class="${k === 'Moderate' || k === 'Low' ? 'dk' : ''}">${k}</span>`).join('');
    const counts = {}; S.results.cells.forEach(c => { counts[c.risk_class] = (counts[c.risk_class] || 0) + 1; });
    $('homeCounts').textContent = `${S.results.cells.length} one-kilometre cells, ${(counts['Very high'] || 0) + (counts.High || 0)} at high or very high risk`;
    $('classList').innerHTML = classNames().map(k => `<div class="classrow"><i style="background:${classColor(k)}"></i><span>${k}</span><b>${counts[k] || 0}</b></div>`).join('');
    $('tDist').innerHTML = classNames().slice().reverse().map(k => `<span style="background:${classColor(k)};flex:${counts[k] || 0}" title="${k} ${counts[k] || 0}"></span>`).join('');
  }

  /* ---------------------------------------------------------------- cell detail (map page) */
  function cellDetail(id) {
    const r = S.R[id], p = S.P[id];
    const f = (n, v, cls = '') => `<div class="factor ${cls}"><div><span>${n}</span><b>${fmt(v)}</b></div><div class="bar"><i style="width:${Math.min(100, v * 100)}%"></i></div></div>`;
    $('cellDetail').innerHTML = `<h3>${id}, ${esc(r.land_cover.toLowerCase())}${p.protected ? ', protected' : ''}</h3>
      <div class="score"><b style="color:${classColor(r.risk_class)}">${fmt(r.risk_score)}</b><span>${r.risk_class} risk</span></div>
      ${f('Habitat suitability', r.habitat_suitability)}${f('Road pressure', r.threat_impact.road, 'threat')}${f('Urban pressure', r.threat_impact.urban, 'threat')}
      ${f('Farmland pressure', r.threat_impact.agriculture, 'threat')}${f('Degradation', r.degradation, 'threat')}${f('Habitat quality', r.habitat_quality)}
      <p class="small">${p.species_count == null ? '<span class="tag bad">No species records</span>' : `${p.species_count} species records`}</p>
      <div class="actions"><button class="btn quiet" id="addCell">Add to site</button></div>`;
    $('addCell').onclick = () => { S.site.add(id); location.hash = '#/site'; };
    setTrace(['F.2.3', 'F.2.5'], `${id} from ${S.record.run_id}`);
  }

  /* ---------------------------------------------------------------- site screening (F.2.4 -> F.2.6) */
  function computeSite() {
    if (!S.site.size) { S.summary = null; return null; }
    const t0 = performance.now();
    const sel = { name: $('siteName').value || 'Selected site', cell_ids: [...S.site].sort() };
    S.summary = BRM.summarizeSiteConditions(S.prepared, S.results, { layer: S.layer }, { siteSelection: sel, siteSummaryRules: S.cfg.ssr });
    S.explain = BRM.explainResultsAndLimitations(S.summary, S.dq.data_quality_report, S.record, { interpretationRules: S.cfg.ir });
    S.siteMs = performance.now() - t0;
    S.lastOut['F.2.4'] = { 'Site screening summary': `${S.summary.cell_count} cells, mean risk ${fmt(S.summary.mean_risk)} (${S.summary.risk_class})` };
    S.lastOut['F.2.6'] = { 'Factor explanations and limitations': `${S.explain.factors.length} factors, ${S.explain.limitations.length} limitations` };
    return S.summary;
  }
  const ring = s => `<div class="verdict"><div class="ring" style="--v:${s.mean_risk};--c:${classColor(s.risk_class)}"><b>${fmt(s.mean_risk)}</b></div>
    <div><div class="cls" style="color:${classColor(s.risk_class)}">${s.risk_class} risk</div><div class="muted small">${s.cell_count} cell${s.cell_count > 1 ? 's' : ''}, highest ${s.max_cell} at ${fmt(s.max_risk)}</div></div></div>`;
  function renderQuick() {
    const s = computeSite();
    $('qBody').innerHTML = !s ? '<p class="muted">No cells selected. Click the map to start.</p>' :
      `${ring(s)}<div class="stats"><div>Above review threshold<b>${s.cells_over_threshold} of ${s.cell_count}</b></div><div>Species records<b>${s.species_count}</b></div>
      <div>Land cover<b style="font-size:.9rem">${esc(s.land_cover.join(', '))}</b></div><div>Strongest pressure<b style="font-size:.9rem">${{ road: 'Roads', urban: 'Development', agriculture: 'Farmland' }[Object.entries(s.mean_threat_impact).sort((a, b) => b[1] - a[1])[0][0]]}</b></div></div>
      <div class="rec">${esc(s.recommendation)}</div>${s.data_gap_cells.length ? `<div class="gap">Missing species records for ${s.data_gap_cells.join(', ')}. The risk may be understated there.</div>` : ''}`;
  }
  function renderSite() {
    const s = computeSite();
    $('siteCells').innerHTML = [...S.site].sort().map(c => `<button class="chip" data-c="${c}" aria-label="Remove ${c}">${c} ×</button>`).join('');
    document.querySelectorAll('#siteCells .chip').forEach(ch => ch.onclick = () => { S.site.delete(ch.dataset.c); restyle(); renderSite(); });
    if (!s) { $('siteResult').innerHTML = '<div class="section"><p class="muted">Click cells on the map to define the site.</p></div>'; return; }
    const x = S.explain;
    $('siteResult').innerHTML = `
      <div class="section" data-fn="F.2.4">${ring(s)}
        <div class="stats"><div>Cells above review threshold<b>${s.cells_over_threshold} of ${s.cell_count}</b></div><div>Species records<b>${s.species_count}</b></div>
          <div>Habitat quality<b>${fmt(s.mean_habitat_quality)}</b></div><div>Degradation<b>${fmt(s.mean_degradation)}</b></div></div>
        <div class="rec">${esc(s.recommendation)}</div>
        ${s.data_gap_cells.length ? `<div class="gap">Missing species records for ${s.data_gap_cells.join(', ')}. The risk may be understated there.</div>` : ''}
        <p class="prov">Answered in ${fmt(S.siteMs, 1)} ms from model run ${s.run_id}. The habitat model runs ahead of time, so site checks stay fast.</p></div>
      <div class="section" data-fn="F.2.6"><h3>Why this score</h3><ul class="plain">${x.factors.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <h3 style="margin-top:12px">What to keep in mind</h3><ul class="plain">${x.limitations.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <p class="disclaimer">${esc(x.disclaimer)}</p>
        <p class="prov">Run ${x.provenance.run_id}, data ${x.provenance.dataset_id}, settings ${x.provenance.parameter_set_id}, ${esc(x.provenance.engine)}, quality check ${x.provenance.qa.toLowerCase()}</p></div>`;
    setTrace(['F.2.4', 'F.2.5', 'F.2.6'], `${s.site_name}, ${fmt(S.siteMs, 1)} ms`);
  }
  function onSiteClick(id) { S.site.has(id) ? S.site.delete(id) : S.site.add(id); restyle(); S.route === 'site' ? renderSite() : renderQuick(); }

  /* ---------------------------------------------------------------- reports (F.2.7) */
  function md2html(md) {
    const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    let html = '', list = false;
    md.split('\n').forEach(line => {
      if (/^- /.test(line)) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(line.slice(2))}</li>`; return; }
      if (list) { html += '</ul>'; list = false; }
      if (/^# /.test(line)) html += `<h1>${inline(line.slice(2))}</h1>`;
      else if (/^## /.test(line)) html += `<h2>${inline(line.slice(3))}</h2>`;
      else if (/^> /.test(line)) html += `<blockquote>${inline(line.slice(2))}</blockquote>`;
      else if (line.trim()) html += `<p class="meta">${inline(line)}</p>`;
    });
    return html + (list ? '</ul>' : '');
  }
  function makeReport() {
    if (!computeSite()) return null;
    const rep = BRM.exportScreeningReports(S.summary, S.explain, { reportTemplate: S.cfg.rt, generated: new Date().toISOString().slice(0, 10) });
    S.lastOut['F.2.7'] = { 'Screening report': `${rep.formats.join(' + ')}, run ${rep.run_id}` };
    return rep;
  }
  function renderReport() {
    const rep = makeReport();
    $('paper').innerHTML = rep ? md2html(rep.markdown) : '<p class="muted">Pick at least one cell on the Screen a site page to create a report.</p>';
    $('repNote').textContent = rep ? `${S.summary.cell_count} cells from "${S.summary.site_name}", model run ${rep.run_id}.` : 'No site selected yet.';
    setTrace(['F.2.4', 'F.2.6', 'F.2.7'], rep ? rep.run_id : '');
  }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 500); }

  /* ---------------------------------------------------------------- home pipeline (Level 2) */
  function renderPipeline() {
    const dq = S.dq, q = dq.data_quality_report, rec = S.record;
    const status = {
      'F.2.1': [`${q.sources.length} sources loaded`, `${dq.acquired_metadata.rejected_sources.length} unapproved source rejected`],
      'F.2.2': [`${dq.coverage_validation_result.prepared_cells} of ${dq.coverage_validation_result.grid_cells} cells complete`, `${q.data_gap_cells.length} cells missing species records`, 'warn'],
      'F.2.3': [`Run ${rec.run_id}`, `Quality check ${rec.final_qa === 'PASS' ? 'passed' : 'failed'}, ${rec.attempts} attempt${rec.attempts > 1 ? 's' : ''}`],
      'F.2.4': ['On request', 'Reads the stored results'],
      'F.2.5': ['5 risk classes', 'Plus a habitat-quality layer'],
      'F.2.6': [`${S.cfg.ir.limitations.length} standing limitations`, 'Disclaimer on every result'],
      'F.2.7': ['Report and cell table', 'Stamped with the run ID'],
    };
    $('stages').innerHTML = S.model.level2.functions.map(f => {
      const [a, b, w] = status[f.id];
      return `<li data-go="${STAGES[f.id].go}" data-fn="${f.id}" tabindex="0"><span class="st ${w || ''}"><i></i>${w ? 'Check' : 'Ready'}</span>
        <b>${STAGES[f.id].t}</b><small>${esc(a)}</small><small>${esc(b)}</small><div class="who">${esc(STAGES[f.id].who)}</div></li>`;
    }).join('');
    document.querySelectorAll('#stages li').forEach(li => { li.onclick = () => { location.hash = li.dataset.go; }; li.onkeydown = e => { if (e.key === 'Enter') li.click(); }; });
    $('pipeNote').textContent = `Data ${rec.dataset_id}, settings ${rec.parameter_set_id}, run ${rec.run_id}`;
    $('tModelRun').textContent = `Published run ${S.batchRecord.run_id}`;
    $('tSources').innerHTML = `${q.sources.length} <small>approved sources</small>`;
    $('tSourcesNote').textContent = `${q.data_gap_cells.length} cells missing species records, 1 source rejected`;
  }

  /* ---------------------------------------------------------------- roles (Level 1) */
  function renderRoles() {
    $('roleSeg').innerHTML = ROLES.map(r => `<button data-r="${r.id}" class="${S.role === r.id ? 'on' : ''}" data-fn="${r.fn}">${r.label}</button>`).join('');
    document.querySelectorAll('#roleSeg button').forEach(b => b.onclick = () => { S.role = b.dataset.r; renderRoles(); });
    const r = ROLES.find(x => x.id === S.role);
    if (S.route === 'home') $('pageSub').textContent = r.text;
    document.querySelectorAll('.tile').forEach(t => t.classList.toggle('match', (t.dataset.roles || '').split(' ').includes(S.role)));
  }

  /* ---------------------------------------------------------------- model lab (Level 3, live) */
  const SL = [
    ['Threat weights', 'Roads', p => p.threats.road, 'weight', 0, 1, .05], [null, 'Towns and development', p => p.threats.urban, 'weight', 0, 1, .05],
    [null, 'Farmland', p => p.threats.agriculture, 'weight', 0, 1, .05],
    ['Reach of threats', 'Development reach (km)', p => p.threats.urban, 'max_distance_km', 1, 12, .5],
    ['Model shape', 'Half-saturation k', p => p, 'k', .05, 1, .05], [null, 'Scaling z', p => p, 'z', 1, 4, .5]];
  function renderSliders() {
    $('sliders').innerHTML = SL.map(([g, n, get, key, a, b, st], i) => `${g ? `<div class="slgroup">${g}</div>` : ''}<label class="sl"><div><span>${n}</span><output>${get(S.params)[key]}</output></div>
      <input type="range" min="${a}" max="${b}" step="${st}" value="${get(S.params)[key]}" data-i="${i}"></label>`).join('');
    $('sliders').querySelectorAll('input').forEach(inp => inp.oninput = () => { const [, , get, key] = SL[+inp.dataset.i]; get(S.params)[key] = +inp.value; inp.closest('label').querySelector('output').textContent = inp.value; });
  }
  function renderSteps() {
    $('steps').innerHTML = Object.entries(STEPS).map(([fid, s]) => `<li class="step" data-step="${fid}"><div class="card">
      <h3><span style="font-size:inherit;color:inherit;font-weight:700">${s.t}</span><span>${esc(plain(fdef(fid).mechanism))}</span></h3>
      <p>${s.d}</p><div class="loop">Sent back for a re-run</div><div class="out"></div></div></li>`).join('');
  }
  function renderOutcome(out) {
    const batch = S.batchR, bc = {}, nc = {};
    S.batchResults.cells.forEach(c => { bc[c.risk_class] = (bc[c.risk_class] || 0) + 1; });
    (out ? out.results : S.results).cells.forEach(c => { nc[c.risk_class] = (nc[c.risk_class] || 0) + 1; });
    const max = Math.max(...Object.values(bc), ...Object.values(nc));
    let html = '<h2>Result</h2>';
    if (!out) html += '<p class="muted small">Run the model to compare with the published map.</p>';
    else {
      let maxd = 0, changed = 0;
      out.results.cells.forEach(c => { maxd = Math.max(maxd, Math.abs(c.habitat_quality - batch[c.cell_id].habitat_quality)); if (c.risk_class !== batch[c.cell_id].risk_class) changed++; });
      const same = out.parameterSet.parameter_set_id === S.batchRecord.parameter_set_id;
      html += same ? `<div class="okbox">Same data and settings as the published map, and the same run ID: <b>${out.record.run_id}</b>. Largest difference in habitat quality: ${maxd.toExponential(0)}.</div>`
        : `<div class="okbox new">New settings <b>${out.parameterSet.parameter_set_id}</b> changed the risk class of <b>${changed}</b> of ${out.results.cells.length} cells. Run <b>${out.record.run_id}</b> now drives the map.</div>`;
      if (out.record.attempts > 1) html += `<p class="small">The quality check rejected attempt 1 and the run passed on attempt ${out.record.attempts}.</p>`;
    }
    html += `<div class="cmp">${classNames().map(k => `<div class="cmprow"><span>${k}</span><div class="bars"><i class="old" style="width:${(bc[k] || 0) / max * 100}%;background:${classColor(k)}"></i><i style="width:${(nc[k] || 0) / max * 100}%;background:${classColor(k)}"></i></div><b>${nc[k] || 0}</b></div>`).join('')}</div>
      <p class="muted small">Faded bar: published map. Solid bar: current run.</p>
      <div class="actions col"><a class="btn quiet" href="#/map">See it on the map</a>${out && out.parameterSet.parameter_set_id !== S.batchRecord.parameter_set_id ? '<button class="btn quiet" id="restore">Go back to published run</button>' : ''}</div>`;
    $('outcome').innerHTML = html;
    const rb = $('restore'); if (rb) rb.onclick = restorePublished;
  }
  function restorePublished() {
    S.results = S.batchResults; S.R = S.batchR; S.record = S.batchRecord; S.params = JSON.parse(JSON.stringify(S.defaultParams));
    renderSliders(); renderSteps(); renderOutcome(null); restyle(); badge(); renderPipeline();
  }
  async function runLive() {
    const btn = $('runModel'); btn.disabled = true; btn.textContent = 'Running…';
    const slow = $('slow').checked; renderSteps(); const order = []; const t0 = performance.now();
    const li = fid => document.querySelector(`.step[data-step="${fid}"]`);
    try {
      const out = await BRM.calculateHabitatQuality(S.prepared, { habitatModelParameters: S.params, faultInjection: $('fault').checked ? { attempts: 1 } : null,
        onStep: async (fid, phase, info) => {
          const el = li(fid);
          if (phase === 'start') { el.classList.remove('done', 'fail'); el.classList.add('running'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); if (slow) await sleep(600); return; }
          const fb = info['Re-run request'];
          el.classList.remove('running'); el.classList.add(fb ? 'fail' : 'done'); order.push(fid); S.lastOut[fid] = info;
          const o = el.querySelector('.out');
          o.innerHTML += Object.entries(info).map(([k, v]) => `<div><b>${esc(k)}</b>: ${esc(v)}</div>`).join('');
          if (slow) await sleep(450);
        } });
      S.results = out.results; S.record = out.record; S.R = Object.fromEntries(out.results.cells.map(c => [c.cell_id, c]));
      S.lastOut['F.2.3'] = { 'Habitat-quality and degradation results': `${out.results.cells.length} cells`, 'Model run record': out.record.run_id };
      renderOutcome(out); restyle(); badge(); renderPipeline();
      setTrace(['F.2.3', ...order], `${fmt(performance.now() - t0, 0)} ms, ${out.record.attempts} attempt(s)`);
    } catch (e) { $('outcome').innerHTML = `<h2>Result</h2><div class="gap">${esc(e.message)}</div>`; }
    btn.disabled = false; btn.textContent = 'Run model';
  }

  /* ---------------------------------------------------------------- "How it works": IDEF0 levels 1-3 */
  function wrap(t, n) { const lines = ['']; t.split(' ').forEach(x => { if ((lines[lines.length - 1] + ' ' + x).trim().length > n) lines.push(x); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + x).trim(); }); return lines; }
  function drawIdef0(el, fns, opts = {}) {
    const W = 152, H = 62, DX = 196, DY = 84, ML = 150, MT = 64, n = fns.length;
    const TW = ML + (n - 1) * DX + W + 170, TH = MT + (n - 1) * DY + H + 70;
    const pos = fns.map((f, i) => ({ x: ML + i * DX, y: MT + i * DY }));
    const parts = [], paths = [];
    const portY = (i, k, m) => pos[i].y + (H * (k + 1)) / (m + 1);
    const portX = (i, k, m) => pos[i].x + 34 + ((W - 44) * (k + 1)) / (m + 1);
    fns.forEach((f, i) => {
      const ctls = f.controls || [];
      f.outputs.forEach((o, k) => {
        const ay = portY(i, k, f.outputs.length), ax = pos[i].x + W; let used = false;
        fns.forEach((g, j) => {
          if (j === i) return;
          const ii = g.inputs.indexOf(o), cc = (g.controls || []).indexOf(o);
          if (ii >= 0) {
            used = true; const by = portY(j, ii, g.inputs.length), bx = pos[j].x;
            if (j > i) paths.push({ d: `M${ax},${ay} H${bx - 12 - ii * 7} V${by} H${bx}`, cls: '', lbl: o });
            else { const off = 10 + k * 6, low = Math.max(pos[i].y, pos[j].y) + H + 16 + off; paths.push({ d: `M${ax},${ay} h${off} V${low} H${bx - 14 - off} V${by} H${bx}`, cls: 'fb', lbl: o }); }
          }
          if (cc >= 0) { used = true; paths.push({ d: `M${ax},${ay} H${portX(j, cc, g.controls.length)} V${pos[j].y}`, cls: 'ctl', lbl: o }); }
        });
        if (!used || (opts.boundaryOutputs || []).includes(o)) paths.push({ d: `M${ax},${ay} H${TW - 8}`, cls: '', lbl: o });
        parts.push(`<text class="lbl" x="${ax + 4}" y="${ay - 3}">${esc(o)}</text>`);
      });
      f.inputs.forEach((inp, k) => {
        if (fns.some((g, j) => j !== i && g.outputs.includes(inp))) return;
        const by = portY(i, k, f.inputs.length);
        paths.push({ d: `M8,${by} H${pos[i].x}`, cls: '', lbl: inp }); parts.push(`<text class="lbl bnd" x="10" y="${by - 3}">${esc(inp)}</text>`);
      });
      ctls.forEach((c, k) => {
        if (fns.some((g, j) => j !== i && g.outputs.includes(c))) return;
        const cx = portX(i, k, ctls.length);
        paths.push({ d: `M${cx},${10 + k * 12} V${pos[i].y}`, cls: 'ctl', lbl: c }); parts.push(`<text class="lbl ctl bnd" x="${cx + 3}" y="${18 + k * 12}">${esc(c)}</text>`);
      });
      const mx = pos[i].x + 18;
      paths.push({ d: `M${mx},${TH - 6} V${pos[i].y + H}`, cls: 'mech', lbl: f.mechanism });
      parts.push(`<text class="lbl mech" x="${mx + 4}" y="${pos[i].y + H + 13}">${esc(plain(f.mechanism))}</text>`);
    });
    const colors = { '': '#5d6d70', ctl: '#6a4fb3', mech: '#2b6cb0', fb: '#A8322D' };
    el.innerHTML = `<svg viewBox="0 0 ${TW} ${TH}" xmlns="http://www.w3.org/2000/svg"><defs>${Object.entries(colors).map(([c, v]) => `<marker id="ah${c}" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${v}"/></marker>`).join('')}</defs>
      ${paths.map(p => `<path class="flow ${p.cls}" d="${p.d}" marker-end="url(#ah${p.cls})"><title>${esc(p.lbl)}</title></path>`).join('')}
      ${fns.map((f, i) => `<g class="box${(opts.zoom || []).includes(f.id) ? ' zoom' : ''}" data-f="${f.id}" tabindex="0"><rect x="${pos[i].x}" y="${pos[i].y}" width="${W}" height="${H}" rx="2"/>
        ${wrap(f.name, 22).map((l, k) => `<text class="nm" x="${pos[i].x + W / 2}" y="${pos[i].y + 24 + k * 14}" text-anchor="middle">${esc(l)}</text>`).join('')}<title>${esc(f.name)}</title></g>`).join('')}
      ${parts.join('')}</svg>`;
    el.querySelectorAll('.box').forEach(b => { b.onclick = () => openBox(b.dataset.f); b.onkeydown = e => { if (e.key === 'Enter') openBox(b.dataset.f); }; });
  }
  function renderHow() {
    const f2 = S.model.level1.functions.find(f => f.id === 'F.2'); const f2in = new Set([...f2.inputs, ...f2.controls]);
    $('level1').innerHTML = S.model.level1.functions.map(f => {
      const gives = (f.outputs || []).filter(o => f2in.has(o) && f.id !== 'F.2'), takes = (f.inputs || []).filter(o => f2.outputs.includes(o) && f.id !== 'F.2');
      return `<div class="l1${f.id === 'F.2' ? ' sel' : ''}" data-f="${f.id}" tabindex="0"><b>${esc(f.name)}</b>
        ${f.id === 'F.2' ? '<span>This product. Opened up below.</span>' : `${gives.length ? `<div>Provides: ${gives.map(esc).join(', ')}</div>` : ''}${takes.length ? `<div class="muted">Uses: ${takes.map(esc).join(', ')}</div>` : ''}`}
        <div class="mech">${esc(plain(f.mechanism))}</div></div>`;
    }).join('');
    document.querySelectorAll('.l1').forEach(b => b.onclick = () => openBox(b.dataset.f));
    drawIdef0($('level2'), S.model.level2.functions, { zoom: ['F.2.3'], boundaryOutputs: f2.outputs });
    drawIdef0($('level3'), S.model.level3.functions, { boundaryOutputs: ['Habitat-quality and degradation results', 'Model run record'] });
    const lab = id => fname(id), fmap = {};
    Object.entries(S.model.function_hierarchy).forEach(([p, ks]) => { fmap[lab(p)] = ks.map(lab); });
    const tree = (root, map, sel) => `<li><span class="n${sel.includes(root) ? ' sel' : ''}">${esc(plain(root))}</span>${(map[root] || []).length ? `<ul>${map[root].map(k => tree(k, map, sel)).join('')}</ul>` : ''}</li>`;
    $('hier').innerHTML = `<div class="tree"><p class="muted small">Functions</p><ul>${tree(lab('F.2'), fmap, [lab('F.2.3')])}</ul></div>
      <div class="tree"><p class="muted small">Assets that perform them</p><ul>${tree('C.2 Biodiversity Risk Map', S.model.asset_hierarchy, ['C.2.3 Habitat Modeling Subsystem'])}</ul></div>`;
  }
  function openBox(fid) {
    const f = fdef(fid); if (!f) return;
    const reg = (S.model.code_registry || {})[fid] || {}, out = S.lastOut[fid];
    const pills = (a, c) => (a && a.length ? a.map(x => `<span class="pill ${c}">${esc(x)}</span>`).join('') : '<span class="muted">none</span>');
    $('drawerBody').innerHTML = `<h2>${esc(f.name)}</h2>
      <table class="icom"><tr><td>Inputs</td><td>${pills(f.inputs, '')}</td></tr><tr><td>Controls</td><td>${pills(f.controls, 'c')}</td></tr>
      <tr><td>Outputs</td><td>${pills(f.outputs, 'o')}</td></tr><tr><td>Performed by</td><td>${pills([plain(f.mechanism)], 'm')}</td></tr>
      ${reg.path ? `<tr><td>Code</td><td><code>${esc(reg.path)}</code><br><code>${esc(reg.callable)}()</code></td></tr>` : ''}</table>
      ${(reg.requirements || []).length ? `<h3>Requirements</h3><ul class="plain">${reg.requirements.map(r => `<li>${esc((S.model.requirements[r] || {}).text || '')}</li>`).join('')}</ul>` : ''}
      ${out ? `<h3 style="margin-top:12px">Latest output</h3><ul class="plain">${Object.entries(out).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join('')}</ul>` : ''}`;
    $('drawer').hidden = false;
  }

  /* ---------------------------------------------------------------- data page (F.2.1, F.2.2) */
  function renderData() {
    const d = S.dq, q = d.data_quality_report, c = d.coverage_validation_result;
    $('sources').innerHTML = `<table><tr><th>Source</th><th>Records</th><th>Coordinate system</th><th>Status</th></tr>
      ${q.sources.map(m => `<tr><td>${esc(m.title)}<br><small>${esc(m.source_id)}, retrieved ${m.retrieved}</small></td><td>${m.records}</td><td>${m.crs}</td><td><span class="tag">Loaded</span></td></tr>`).join('')}
      ${d.acquired_metadata.rejected_sources.map(r => `<tr><td>${esc(r.source_id)}</td><td colspan="2"><small>${esc(r.reason)}</small></td><td><span class="tag bad">Rejected</span></td></tr>`).join('')}</table>
      <p class="prov">Data version ${d.dataset_identifier}</p>`;
    $('dq').innerHTML = `<div class="stats"><div>Coverage<b>${c.status === 'COMPLETE' ? 'Complete' : 'Incomplete'}</b></div><div>Cells ready<b>${c.prepared_cells} of ${c.grid_cells}</b></div>
      <div>Coordinate system<b>${q.target_crs}</b></div><div>Rule version<b>${esc(q.criteria_version)}</b></div></div>
      ${q.data_gap_warning ? `<div class="gap">${esc(q.data_gap_warning)} Cells ${q.data_gap_cells.join(', ')}.</div>` : ''}
      <ul class="plain">${q.issues.map(i => `<li>${esc(i.issue)}</li>`).join('')}</ul>`;
    const files = [['approved_source_list.json', 'Which sources may be loaded', 'F.2.1'], ['data_quality_criteria.json', 'Data-quality thresholds', 'F.2.2'],
      ['habitat_model_parameters.json', 'Habitat model settings', 'F.2.3'], ['site_summary_rules.json', 'Review threshold and recommendations', 'F.2.4'],
      ['map_display_rules.json', 'Map colours and attribution', 'F.2.5'], ['interpretation_rules.json', 'Limitations and disclaimer', 'F.2.6'], ['report_template.md', 'Report layout', 'F.2.7']];
    const owner = j => ((typeof j === 'string' ? j : j._idef0).match(/\(C\.\d (.+?)\)/) || [, ''])[1];
    const ver = j => (typeof j === 'string' ? (j.match(/version: (\S+)/) || [, ''])[1] : j.version);
    $('controls').innerHTML = `<table><tr><th>Rule</th><th>Set by</th><th>Version</th><th>File</th></tr>${files.map(([f, label, fn]) =>
      `<tr><td>${label}</td><td>${esc(owner(S.cfgRaw[f]))}</td><td>${esc(ver(S.cfgRaw[f]) || '')}</td><td><a href="data/config/${f}" target="_blank" rel="noopener"><code>${f}</code></a></td></tr>`).join('')}</table>`;
  }

  /* ---------------------------------------------------------------- routing */
  const TITLES = {
    home: ['Tompkins County biodiversity screening', null],
    map: ['Risk map', 'Every one-kilometre cell in the county, scored by the habitat model'],
    site: ['Screen a site', 'Pick the cells a project would touch and see the risk, the reasons and the caveats'],
    model: ['Habitat model', 'Run the InVEST habitat-quality model and see each step check its work'],
    data: ['Data and quality', 'Where the map’s data comes from and how it is checked'],
    reports: ['Screening report', 'A shareable summary of the current site'],
  };
  function badge() { $('runText').textContent = `Run ${S.record.run_id}`; $('runPill').classList.toggle('changed', S.record.run_id !== S.batchRecord.run_id); }
  function route() {
    const h = location.hash || '#/home'; const [path, query] = h.slice(2).split('?'); const r = (path.split('/')[0]) || 'home';
    S.route = TITLES[r] ? r : 'home';
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.route === S.route));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('on', p.id === 'page-' + S.route));
    $('pageTitle').textContent = TITLES[S.route][0];
    $('pageSub').textContent = TITLES[S.route][1] || ROLES.find(x => x.id === S.role).text;
    $('drawer').hidden = true;
    if (query && query.includes('layer=hq')) setLayer('hq');
    if (S.route === 'home') { showMap('home'); renderQuick(); setTrace(['F.2.1', 'F.2.2', 'F.2.3', 'F.2.4', 'F.2.5'], `run ${S.record.run_id}`); }
    if (S.route === 'map') { showMap('big'); setTrace(['F.2.3', 'F.2.5'], S.layer === 'risk' ? 'Displayed risk map and legend' : 'Habitat-quality map'); }
    if (S.route === 'site') { showMap('site'); renderSite(); }
    if (S.route === 'model') setTrace(['F.2.3'], 'Calculate Habitat Quality');
    if (S.route === 'data') setTrace(['F.2.1', 'F.2.2'], S.dq.dataset_identifier);
    if (S.route === 'reports') renderReport();
    restyle();
  }
  function setLayer(l) { S.layer = l; document.querySelectorAll('#layerSeg button').forEach(x => x.classList.toggle('on', x.dataset.layer === l)); restyle(); }

  /* ---------------------------------------------------------------- init */
  async function init() {
    const [model, grid, prepared, record, dq, site] = await Promise.all(['data/idef0.json', 'data/risk_grid.geojson', 'data/prepared_datasets.json',
      'data/model_run_record.json', 'data/data_quality_report.json', 'data/sample_site.json'].map(getJSON));
    const names = ['approved_source_list.json', 'data_quality_criteria.json', 'habitat_model_parameters.json', 'site_summary_rules.json', 'map_display_rules.json', 'interpretation_rules.json'];
    const cfgs = await Promise.all(names.map(n => getJSON('data/config/' + n)));
    S.cfgRaw = Object.fromEntries(names.map((n, i) => [n, cfgs[i]])); S.cfgRaw['report_template.md'] = await getText('data/config/report_template.md');
    S.cfg = { map: S.cfgRaw['map_display_rules.json'], ssr: S.cfgRaw['site_summary_rules.json'], ir: S.cfgRaw['interpretation_rules.json'], rt: S.cfgRaw['report_template.md'] };
    S.defaultParams = S.cfgRaw['habitat_model_parameters.json']; S.params = JSON.parse(JSON.stringify(S.defaultParams));
    Object.assign(S, { model, grid, prepared, record, dq, batchRecord: record, demoSite: site.site_selection, role: 'planner' });
    S.P = Object.fromEntries(prepared.cells.map(c => [c.cell_id, c]));
    S.results = S.batchResults = resultsFromGrid(grid); S.R = S.batchR = Object.fromEntries(S.results.cells.map(c => [c.cell_id, c]));
    site.site_selection.cell_ids.forEach(c => S.site.add(c)); $('siteName').value = site.site_selection.name;
    S.lastOut['F.2.1'] = { 'Dataset identifier': dq.dataset_identifier, 'Acquired datasets and metadata': `${dq.data_quality_report.sources.length} sources loaded, ${dq.acquired_metadata.rejected_sources.length} rejected` };
    S.lastOut['F.2.2'] = { 'Coverage Validation Result': dq.coverage_validation_result.status, 'Data-quality report': `${dq.data_quality_report.data_gap_cells.length} cells missing species records` };
    S.lastOut['F.2.3.6'] = { 'Model run record': `${record.run_id} (published batch run)` };

    makeMap('homeMap', 'home', onSiteClick); makeMap('bigMap', 'big', cellDetail); makeMap('siteMap', 'site', onSiteClick);
    [...new Set(S.results.cells.map(c => c.land_cover))].sort().forEach(h => $('habitatFilter').add(new Option(h, h)));
    badge(); renderPipeline(); renderRoles(); renderSliders(); renderSteps(); renderOutcome(null); renderHow(); renderData();

    document.querySelectorAll('#layerSeg button').forEach(b => b.onclick = () => { setLayer(b.dataset.layer); setTrace(['F.2.5'], b.dataset.layer === 'risk' ? 'Displayed risk map and legend' : 'Habitat-quality map'); });
    $('habitatFilter').onchange = restyle;
    const useDemo = () => { S.site = new Set(S.demoSite.cell_ids); $('siteName').value = S.demoSite.name; restyle(); S.route === 'site' ? renderSite() : renderQuick(); };
    $('qReset').onclick = useDemo; $('demoSite').onclick = useDemo;
    $('clearSite').onclick = () => { S.site.clear(); restyle(); renderSite(); };
    $('siteName').onchange = renderSite;
    $('exportMd').onclick = () => { const r = makeReport(); if (r) download('screening-report.md', r.markdown, 'text/markdown'); };
    $('exportCsv').onclick = () => { const r = makeReport(); if (r) download('screening-report.csv', r.csv, 'text/csv'); };
    $('runModel').onclick = runLive;
    $('resetParams').onclick = () => { S.params = JSON.parse(JSON.stringify(S.defaultParams)); renderSliders(); };
    document.querySelectorAll('.labtabs button').forEach(b => b.onclick = () => {
      document.querySelectorAll('.labtabs button').forEach(x => x.classList.toggle('on', x === b));
      $('tab-lab').hidden = b.dataset.tab !== 'lab'; $('tab-how').hidden = b.dataset.tab !== 'how';
      if (b.dataset.tab === 'how') setTrace(['F.2', 'F.2.3'], 'IDEF0 levels 1 to 3');
    });
    $('drawerClose').onclick = () => { $('drawer').hidden = true; };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $('drawer').hidden = true; });
    window.addEventListener('hashchange', route);
    route();
  }
  init().catch(e => { document.body.insertAdjacentHTML('afterbegin', `<div class="gap" style="margin:10px">The app could not load its data (${esc(e.message)}). Run <code>python3 scripts/run_pipeline.py</code>, then serve the <code>dist</code> folder over http.</div>`); console.error(e); });
})();
