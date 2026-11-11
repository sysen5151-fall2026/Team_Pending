/* Biodiversity Risk Map — web app (C.2.5 Web Map Subsystem front end).
 *
 * Routes (see docs/route-table.md):
 *   #/map          View biodiversity risk map (Local Planner / Conservation Org.) -> F.2.5 (+ F.2.3 results)
 *   #/site         Screen a proposed development site (Local Planner)            -> F.2.4 -> F.2.5 -> F.2.6 -> F.2.7
 *   #/model/F.2.3  Maintain and re-run the habitat model (IT Development Team)   -> F.2.3.1 ... F.2.3.6 (live)
 *   #/data         Review data sources and quality (Government Agencies / IT)    -> F.2.1, F.2.2
 */
/* global L, BRM */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const S = { site: new Set(), layer: 'risk', lastOut: {}, cfg: {} };

  /* ------------------------------------------------------------------ data */
  async function getJSON(p) { const r = await fetch(p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); }
  async function getText(p) { const r = await fetch(p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.text(); }

  function resultsFromGrid(grid) {
    return { run_id: grid.metadata.run_id, parameter_set_id: grid.metadata.parameter_set_id,
      cells: grid.features.map(f => { const p = f.properties; return { cell_id: p.cell_id, land_cover: p.habitat,
        habitat_suitability: p.habitat_suitability, accessibility: p.accessibility,
        threat_impact: { road: p.road_effect, urban: p.urban_effect, agriculture: p.agriculture_effect },
        degradation: p.degradation, habitat_quality: p.habitat_quality, risk_score: p.risk_score, risk_class: p.risk_class }; }) };
  }

  /* ------------------------------------------------------------------ trace footer */
  function setTrace(fids, note) {
    $('traceChips').innerHTML = fids.map(f => `<span class="chip ${f.split('.').length > 3 ? 'l3' : 'f'}" data-f="${f}" title="${esc(fname(f))}">${f} ${esc(fname(f))}</span>`).join('<span style="opacity:.5">→</span>');
    $('traceTime').textContent = note || '';
    document.querySelectorAll('#traceChips .chip').forEach(c => c.onclick = () => { location.hash = '#/model/F.2.3'; setTimeout(() => openBox(c.dataset.f), 50); });
    fids.forEach(f => document.querySelectorAll(`svg .box[data-f="${f}"]`).forEach(b => { b.classList.remove('running', 'fail'); b.classList.add('done'); }));
  }
  const allFns = () => [].concat(S.model.level1.functions, S.model.level2.functions, S.model.level3.functions);
  const fdef = id => allFns().find(f => f.id === id);
  const fname = id => (fdef(id) || {}).name || '';

  /* ------------------------------------------------------------------ map (F.2.5) */
  let map, gridLayer;
  const hqColor = q => { const t = Math.max(0, Math.min(1, q)); const a = [224, 236, 210], b = [24, 92, 64]; return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; };
  function cellResult(id) { return S.R[id]; }
  function styleFor(f) {
    const r = cellResult(f.properties.cell_id); const p = f.properties;
    const hf = $('habitatFilter').value; const show = hf === 'all' || r.land_cover === hf;
    const sel = S.site.has(p.cell_id) && S.route === 'site';
    return { fillColor: S.layer === 'risk' ? S.cfg.map.colors[r.risk_class] : hqColor(r.habitat_quality),
      fillOpacity: show ? S.cfg.map.fill_opacity : 0.06, color: sel ? '#111' : (p.data_gap ? '#7a1d1d' : '#ffffff'),
      weight: sel ? 3 : (p.data_gap ? 2 : 0.8), dashArray: p.data_gap && !sel ? '4 3' : null, opacity: 1 };
  }
  function buildMap() {
    map = L.map('map', { zoomControl: false, preferCanvas: false }).setView([42.45, -76.47], 10);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    map.attributionControl.addAttribution(S.cfg.map.attribution);
    gridLayer = L.geoJSON(S.grid, { style: styleFor, onEachFeature: (f, l) => {
      l.on('click', () => onCellClick(f.properties.cell_id));
      l.bindTooltip(() => { const r = cellResult(f.properties.cell_id); return `<b>${r.cell_id}</b> · ${r.land_cover}<br>risk ${r.risk_score.toFixed(2)} (${r.risk_class}) · Q ${r.habitat_quality.toFixed(2)}`; }, { sticky: true });
    } }).addTo(map);
    S.needFit = true;
  }
  function restyle() { if (gridLayer) gridLayer.setStyle(styleFor); renderLegend(); }
  function renderLegend() {
    const lg = $('legend');
    if (S.layer === 'risk') { lg.className = 'legend'; lg.innerHTML = Object.entries(S.cfg.map.colors).map(([k, v]) => `<span style="background:${v}">${k}</span>`).join(''); }
    else { lg.className = 'legend hq'; lg.innerHTML = [0, .25, .5, .75, 1].map(q => `<span style="background:${hqColor(q)};color:${q > .5 ? '#fff' : '#123'}">Q ${q}</span>`).join(''); }
    const counts = {}; S.results.cells.forEach(c => { counts[c.risk_class] = (counts[c.risk_class] || 0) + 1; });
    $('classCounts').innerHTML = `${S.results.cells.length} cells · ` + Object.keys(S.cfg.map.colors).map(k => `${k} <b>${counts[k] || 0}</b>`).join(' · ');
  }
  function onCellClick(id) {
    if (S.route === 'site') { S.site.has(id) ? S.site.delete(id) : S.site.add(id); restyle(); runSite(); return; }
    const r = cellResult(id), p = S.P[id];
    $('cellCard').hidden = false; $('cellTitle').textContent = `${id} · ${r.land_cover}${p.protected ? ' · protected' : ''}`;
    $('cellScore').textContent = r.risk_score.toFixed(2); $('cellScore').style.color = S.cfg.map.colors[r.risk_class];
    $('cellClass').textContent = r.risk_class + ' risk'; $('cellRun').textContent = S.record.run_id;
    const bars = [['Habitat suitability H', r.habitat_suitability], ['Accessibility β', r.accessibility], ['Road threat impact', r.threat_impact.road],
      ['Urban threat impact', r.threat_impact.urban], ['Agriculture threat impact', r.threat_impact.agriculture], ['Degradation D', r.degradation], ['Habitat quality Q', r.habitat_quality]];
    $('cellBars').innerHTML = bars.map(([n, v]) => `<div class="kv"><span>${n}</span><span>${v.toFixed(3)}</span></div><div class="bar"><i style="width:${v * 100}%"></i></div>`).join('') +
      `<div class="kv"><span>Species records</span><span>${p.species_count == null ? '<span class="bad">data gap</span>' : p.species_count}</span></div>`;
    $('addToSite').onclick = () => { S.site.add(id); location.hash = '#/site'; };
    setTrace(['F.2.3', 'F.2.5'], `cell ${id} · ${S.record.run_id}`);
  }

  /* ------------------------------------------------------------------ site screening (F.2.4 -> F.2.6 -> F.2.7) */
  function runSite() {
    if (!S.site.size) { $('summary').innerHTML = '<p class="hint">No cells selected yet.</p>'; $('explain').innerHTML = ''; $('siteCells').innerHTML = ''; S.summary = null; return; }
    const t0 = performance.now();
    const sel = { name: $('siteName').value || 'Selected site', cell_ids: [...S.site].sort() };
    const s = BRM.summarizeSiteConditions(S.prepared, S.results, { layer: S.layer }, { siteSelection: sel, siteSummaryRules: S.cfg.ssr });
    const x = BRM.explainResultsAndLimitations(s, S.dq.data_quality_report, S.record, { interpretationRules: S.cfg.ir });
    const ms = performance.now() - t0;
    S.summary = s; S.explain = x;
    S.lastOut['F.2.4'] = { 'Site screening summary': `${s.cell_count} cells · mean risk ${s.mean_risk.toFixed(2)} (${s.risk_class})` };
    S.lastOut['F.2.6'] = { 'Factor explanations and limitations': `${x.factors.length} factors · ${x.limitations.length} limitations` };
    $('siteCells').innerHTML = sel.cell_ids.map(c => `<span class="chip" data-c="${c}" title="remove">${c} ×</span>`).join('');
    document.querySelectorAll('#siteCells .chip').forEach(ch => ch.onclick = () => { S.site.delete(ch.dataset.c); restyle(); runSite(); });
    $('summary').innerHTML = `
      <div class="sumgrid">
        <div>Mean risk<b style="color:${S.cfg.map.colors[s.risk_class]}">${s.mean_risk.toFixed(2)} · ${s.risk_class}</b></div>
        <div>Highest cell<b>${s.max_cell} · ${s.max_risk.toFixed(2)}</b></div>
        <div>Cells ≥ review threshold<b>${s.cells_over_threshold} / ${s.cell_count}</b></div>
        <div>Species records<b>${s.species_count}</b></div>
      </div>
      <div class="rec">${esc(s.recommendation)}</div>
      ${s.data_gap_cells.length ? `<div class="warn">⚠ Data-gap warning (SYS-2.1.5): ${s.data_gap_cells.join(', ')} have no species-occurrence records.</div>` : ''}
      <div class="prov">answered in ${ms.toFixed(1)} ms from precomputed ${s.run_id} (SYS-2.1.2 budget 3 s; F.2.3 is off the request path — HMS-2.1.1)</div>`;
    $('explain').innerHTML = `<b style="font-size:12px">Contributing factors</b><ul class="tight">${x.factors.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      <b style="font-size:12px">Limitations</b><ul class="tight">${x.limitations.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      <div class="warn" style="background:#f3f4f2;border-color:#999">${esc(x.disclaimer)}</div>
      <div class="prov">Provenance (SYS-2.4.5): ${x.provenance.run_id} · ${x.provenance.dataset_id} · ${x.provenance.parameter_set_id} · ${esc(x.provenance.engine)} · QA ${x.provenance.qa}</div>`;
    setTrace(['F.2.4', 'F.2.5', 'F.2.6'], `site "${sel.name}" · ${ms.toFixed(1)} ms`);
  }
  function makeReport() {
    if (!S.summary) runSite(); if (!S.summary) return null;
    const rep = BRM.exportScreeningReports(S.summary, S.explain, { reportTemplate: S.cfg.rt, generated: new Date().toISOString().slice(0, 10) });
    S.lastOut['F.2.7'] = { 'Screening report': `${rep.formats.join(' + ')} · ${rep.run_id}` };
    setTrace(['F.2.4', 'F.2.6', 'F.2.7'], `report for ${S.summary.site_name}`);
    return rep;
  }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 500); }

  /* ------------------------------------------------------------------ IDEF0 renderer */
  function wrap(t, n) { const w = t.split(' '), lines = ['']; w.forEach(x => { if ((lines[lines.length - 1] + ' ' + x).trim().length > n) lines.push(x); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + x).trim(); }); return lines; }
  function drawIdef0(el, fns, opts = {}) {
    const W = 152, H = 62, DX = 196, DY = 84, ML = 150, MT = 64, n = fns.length;
    const TW = ML + (n - 1) * DX + W + 170, TH = MT + (n - 1) * DY + H + 70;
    const pos = fns.map((f, i) => ({ x: ML + i * DX, y: MT + i * DY }));
    const idx = Object.fromEntries(fns.map((f, i) => [f.id, i]));
    const parts = []; const paths = [];
    const portY = (i, k, m) => pos[i].y + (H * (k + 1)) / (m + 1);
    const portX = (i, k, m) => pos[i].x + 34 + ((W - 44) * (k + 1)) / (m + 1);
    fns.forEach((f, i) => {
      const outs = f.outputs, ins = f.inputs, ctls = f.controls || [];
      outs.forEach((o, k) => {
        const ay = portY(i, k, outs.length), ax = pos[i].x + W; let consumed = false;
        fns.forEach((g, j) => {
          if (j === i) return;
          const ii = g.inputs.indexOf(o), cc = (g.controls || []).indexOf(o);
          if (ii >= 0) {
            consumed = true; const by = portY(j, ii, g.inputs.length), bx = pos[j].x;
            if (j > i) { const mx = bx - 12 - ii * 7; paths.push({ d: `M${ax},${ay} H${mx} V${by} H${bx}`, cls: '', from: f.id, lbl: o }); }
            else { const off = 10 + k * 6, low = Math.max(pos[i].y, pos[j].y) + H + 16 + off; paths.push({ d: `M${ax},${ay} h${off} V${low} H${bx - 14 - off} V${by} H${bx}`, cls: 'fb', from: f.id, lbl: o }); }
          }
          if (cc >= 0) { consumed = true; const cx = portX(j, cc, g.controls.length); paths.push({ d: `M${ax},${ay} H${cx} V${pos[j].y}`, cls: 'ctl', from: f.id, lbl: o }); }
        });
        if (!consumed || (opts.boundaryOutputs || []).includes(o)) paths.push({ d: `M${ax},${ay} H${TW - 8}`, cls: '', from: f.id, lbl: o, bnd: true });
        parts.push(`<text class="lbl" x="${ax + 4}" y="${ay - 3}">${esc(o)}</text>`);
      });
      ins.forEach((inp, k) => {
        if (fns.some((g, j) => j !== i && g.outputs.includes(inp))) return;
        const by = portY(i, k, ins.length);
        paths.push({ d: `M8,${by} H${pos[i].x}`, cls: '', lbl: inp, bnd: true });
        parts.push(`<text class="lbl bnd" x="10" y="${by - 3}">${esc(inp)}</text>`);
      });
      ctls.forEach((c, k) => {
        if (fns.some((g, j) => j !== i && g.outputs.includes(c))) return;
        const cx = portX(i, k, ctls.length);
        paths.push({ d: `M${cx},${10 + k * 12} V${pos[i].y}`, cls: 'ctl', lbl: c, bnd: true });
        parts.push(`<text class="lbl ctl bnd" x="${cx + 3}" y="${18 + k * 12}">${esc(c)}</text>`);
      });
      const mx = pos[i].x + 18;
      paths.push({ d: `M${mx},${TH - 6} V${pos[i].y + H}`, cls: 'mech', lbl: f.mechanism });
      parts.push(`<text class="lbl mech" x="${mx + 4}" y="${pos[i].y + H + 13}">${esc(f.mechanism)}</text>`);
    });
    const boxes = fns.map((f, i) => {
      const ln = wrap(f.name, 22);
      return `<g class="box${opts.zoom && opts.zoom.includes(f.id) ? ' zoom' : ''}" data-f="${f.id}"><rect x="${pos[i].x}" y="${pos[i].y}" width="${W}" height="${H}" rx="2"/>
        <text class="id" x="${pos[i].x + W - 6}" y="${pos[i].y + H - 6}" text-anchor="end">${f.id}</text>
        ${ln.map((l, k) => `<text class="nm" x="${pos[i].x + W / 2}" y="${pos[i].y + 20 + k * 14}" text-anchor="middle">${esc(l)}</text>`).join('')}
        ${opts.zoom && opts.zoom.includes(f.id) ? `<text class="id" x="${pos[i].x + 6}" y="${pos[i].y + H - 6}">▼ L3</text>` : ''}<title>${f.id} ${esc(f.name)} — ${esc(f.mechanism)}</title></g>`;
    }).join('');
    const defs = `<defs>${['', 'ctl', 'mech', 'fb', 'hot'].map(c => `<marker id="ah${c}" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${{ '': '#56645c', ctl: '#6a4fb3', mech: '#2b6cb0', fb: '#9f1d20', hot: '#c8682c' }[c]}"/></marker>`).join('')}</defs>`;
    el.innerHTML = `<svg viewBox="0 0 ${TW} ${TH}" xmlns="http://www.w3.org/2000/svg">${defs}
      ${paths.map(p => `<path class="flow ${p.cls}" data-from="${p.from || ''}" d="${p.d}" marker-end="url(#ah${p.cls})"><title>${esc(p.lbl)}</title></path>`).join('')}
      ${boxes}${parts.join('')}</svg>`;
    el.querySelectorAll('.box').forEach(b => b.addEventListener('click', () => openBox(b.dataset.f)));
  }
  function boxState(fid, state) {
    document.querySelectorAll(`svg .box[data-f="${fid}"]`).forEach(b => { b.classList.remove('running', 'done', 'fail'); if (state) b.classList.add(state); });
    if (state === 'done' || state === 'fail') document.querySelectorAll('svg path.flow.hot').forEach(p => p.classList.remove('hot'));
    document.querySelectorAll(`svg path.flow[data-from="${fid}"]`).forEach(p => { p.classList.toggle('hot', state === 'done' || state === 'fail'); });
  }

  /* ------------------------------------------------------------------ Level 1 + hierarchies */
  function drawLevel1() {
    const f2 = S.model.level1.functions.find(f => f.id === 'F.2');
    const f2in = new Set([...f2.inputs, ...f2.controls]);
    $('level1').innerHTML = S.model.level1.functions.map(f => {
      const gives = (f.outputs || []).filter(o => f2in.has(o) && f.id !== 'F.2');
      const takes = (f.inputs || []).filter(o => f2.outputs.includes(o) && f.id !== 'F.2');
      return `<div class="l1box${f.id === 'F.2' ? ' sel' : ''}" data-f="${f.id}"><div class="id">${f.id}</div><div class="nm">${esc(f.name)}</div>
        ${f.id === 'F.2' ? `<div class="gives">5 outputs · 4 inputs · 8 controls<br>decomposed below ▼</div>` :
          `${gives.length ? `<div class="gives">supplies F.2: ${gives.map(g => `<em>${esc(g)}</em>`).join(', ')}</div>` : ''}${takes.length ? `<div class="gives">uses from F.2: ${takes.map(esc).join(', ')}</div>` : ''}`}
        <div class="mc">⟂ ${esc(f.mechanism)}</div></div>`;
    }).join('');
    document.querySelectorAll('.l1box').forEach(b => b.onclick = () => openBox(b.dataset.f));
  }
  function tree(rootName, map, sel) {
    const kids = map[rootName] || [];
    return `<li><span class="n${sel.includes(rootName) ? ' sel' : ''}">${esc(rootName)}</span>${kids.length ? `<ul>${kids.map(k => tree(k, map, sel)).join('')}</ul>` : ''}</li>`;
  }
  function drawHier() {
    const fmap = {}; const lab = id => `${id} ${fname(id)}`;
    Object.entries(S.model.function_hierarchy).forEach(([p, ks]) => { fmap[lab(p)] = ks.map(lab); });
    $('hier').innerHTML = `<div class="tree"><h4>Function hierarchy (Innoslate: hierarchy diagram of F.2)</h4><ul>${tree(lab('F.2'), fmap, [lab('F.2.3')])}</ul></div>
      <div class="tree"><h4>Asset hierarchy (Innoslate: asset diagram of C.2 / C.2.3)</h4><ul>${tree('C.2 Biodiversity Risk Map', S.model.asset_hierarchy, ['C.2.3 Habitat Modeling Subsystem'])}</ul></div>`;
  }

  /* ------------------------------------------------------------------ box drawer */
  function openBox(fid) {
    const f = fdef(fid); if (!f) return;
    const reg = (S.model.code_registry || {})[fid] || {};
    const reqs = reg.requirements || [];
    const pills = (a, c) => (a && a.length ? a.map(x => `<span class="pill ${c}">${esc(x)}</span>`).join('') : '<span class="hint">—</span>');
    const out = S.lastOut[fid];
    $('drawerBody').innerHTML = `<div class="fhead"><span class="fid">${fid}</span>${esc(f.name)}</div>
      <table class="icom"><tr><td>Inputs</td><td>${pills(f.inputs, '')}</td></tr><tr><td>Controls</td><td>${pills(f.controls, 'c')}</td></tr>
      <tr><td>Outputs</td><td>${pills(f.outputs, 'o')}</td></tr><tr><td>Mechanism</td><td>${pills([f.mechanism], 'm')}</td></tr>
      ${reg.module ? `<tr><td>Code</td><td><code>${esc(reg.path)}</code><br><code>${esc(reg.callable)}()</code></td></tr>` : ''}</table>
      ${reqs.length ? `<b style="font-size:12px">Requirements (Innoslate bio2)</b><ul class="tight">${reqs.map(r => `<li><span class="pill r">${r}</span> ${esc((S.model.requirements[r] || {}).text || '')}</li>`).join('')}</ul>` : ''}
      ${out ? `<b style="font-size:12px">Latest output in this session</b><ul class="tight">${Object.entries(out).map(([k, v]) => `<li><b>${esc(k)}</b>: <code>${esc(v)}</code></li>`).join('')}</ul>` : ''}
      ${fid === 'F.2.3' ? '<button class="btn" id="goL3">Show Level 3 and run it ▼</button>' : ''}`;
    $('drawer').hidden = false;
    const g = $('goL3'); if (g) g.onclick = () => { $('drawer').hidden = true; document.querySelector('.lvl.l3').scrollIntoView({ behavior: 'smooth' }); };
  }

  /* ------------------------------------------------------------------ live F.2.3 run */
  const SL = [['road weight', p => p.threats.road, 'weight', 0, 1, .05], ['urban weight', p => p.threats.urban, 'weight', 0, 1, .05],
    ['agriculture weight', p => p.threats.agriculture, 'weight', 0, 1, .05], ['urban max distance km', p => p.threats.urban, 'max_distance_km', 1, 12, .5],
    ['half-saturation k', p => p, 'k', .05, 1, .05], ['scaling z', p => p, 'z', 1, 4, .5]];
  function drawSliders() {
    $('sliders').innerHTML = SL.map(([n, get, key, a, b, st], i) => `<label>${n}<input type="range" min="${a}" max="${b}" step="${st}" value="${get(S.params)[key]}" data-i="${i}"><output>${get(S.params)[key]}</output></label>`).join('');
    $('sliders').querySelectorAll('input').forEach(inp => inp.oninput = () => { const [, get, key] = SL[+inp.dataset.i]; get(S.params)[key] = +inp.value; inp.nextElementSibling.textContent = inp.value; });
  }
  async function runLive() {
    const btn = $('runModel'); btn.disabled = true; const slow = $('slow').checked;
    const log = $('stepLog'); log.innerHTML = ''; $('runVerdict').innerHTML = '';
    S.model.level3.functions.forEach(f => boxState(f.id, null)); boxState('F.2.3', 'running');
    const t0 = performance.now(); const order = [];
    try {
      const out = await BRM.calculateHabitatQuality(S.prepared, { habitatModelParameters: S.params, faultInjection: $('fault').checked ? { attempts: 1 } : null,
        onStep: async (fid, phase, info) => {
          if (phase === 'start') { boxState(fid, 'running'); if (slow) await sleep(550); return; }
          const fb = info && info['Re-run request'];
          boxState(fid, fb ? 'fail' : 'done'); order.push(fid); S.lastOut[fid] = info;
          const li = document.createElement('li'); if (fb) li.className = 'fb';
          li.innerHTML = `<span class="sid">${fid}</span> ${esc(fname(fid))} <i style="color:#2b6cb0">(${esc(fdef(fid).mechanism.split(' ').slice(1).join(' '))})</i>` +
            Object.entries(info).map(([k, v]) => `<span class="out"><b>${esc(k)}</b> → ${esc(v)}</span>`).join('');
          log.appendChild(li); log.scrollTop = log.scrollHeight;
          if (slow) await sleep(450);
        } });
      const ms = performance.now() - t0;
      const batch = S.batchR;
      S.results = out.results; S.record = out.record; S.ps = out.parameterSet; S.R = Object.fromEntries(out.results.cells.map(c => [c.cell_id, c]));
      S.lastOut['F.2.3'] = { 'Habitat-quality and degradation results': `${out.results.cells.length} cells`, 'Model run record': out.record.run_id };
      boxState('F.2.3', 'done'); restyle(); badge();
      let maxd = 0, changed = 0; out.results.cells.forEach(c => { maxd = Math.max(maxd, Math.abs(c.habitat_quality - batch[c.cell_id].habitat_quality)); if (c.risk_class !== batch[c.cell_id].risk_class) changed++; });
      const same = out.parameterSet.parameter_set_id === S.batchRecord.parameter_set_id;
      $('runVerdict').innerHTML = same
        ? `<div class="verdict">✔ Same inputs + same parameter set as the Python batch run → <b>${out.record.run_id}</b> = batch <b>${S.batchRecord.run_id}</b>; max |ΔQ| = ${maxd.toExponential(1)} ≤ 1e-6 (HMS-2.1.3 → SYS-2.1.4, equivalence).</div>`
        : `<div class="verdict diff">New control → new parameter set <b>${out.parameterSet.parameter_set_id}</b> (batch ${S.batchRecord.parameter_set_id}, HMS-2.1.6). ${changed} of ${out.results.cells.length} cells changed risk class; run <b>${out.record.run_id}</b>. Map updated.</div>`;
      setTrace(['F.2.3.1', 'F.2.3.2', ...order.filter(f => f === 'F.2.3.3' || f === 'F.2.3.4'), 'F.2.3.6', 'F.2.3.5'], `F.2.3 live run ${ms.toFixed(0)} ms · ${out.record.attempts} attempt(s)`);
    } catch (e) { $('runVerdict').innerHTML = `<div class="warn">${esc(e.message)}</div>`; boxState('F.2.3', 'fail'); }
    btn.disabled = false;
  }

  /* ------------------------------------------------------------------ data & QA view */
  function drawData() {
    const d = S.dq; const meta = d.acquired_metadata;
    $('sources').innerHTML = `<table class="t"><tr><th>Source</th><th>Records</th><th>CRS</th><th>Checksum</th></tr>
      ${d.data_quality_report.sources.map(m => `<tr><td><span class="ok">✔</span> ${esc(m.source_id)}<br><span class="hint">${esc(m.title)}</span></td><td>${m.records}</td><td>${m.crs}</td><td><code>${m.checksum}</code></td></tr>`).join('')}
      ${meta.rejected_sources.map(r => `<tr><td><span class="bad">✖</span> ${esc(r.source_id)}</td><td colspan="3" class="bad">${esc(r.reason)}</td></tr>`).join('')}</table>
      <p class="prov">Dataset identifier: <b>${d.dataset_identifier}</b> · list ${esc(meta.approved_source_list_version)}</p>`;
    const c = d.coverage_validation_result, q = d.data_quality_report;
    $('dq').innerHTML = `<div class="sumgrid"><div>Coverage Validation Result<b class="${c.status === 'COMPLETE' ? 'ok' : 'bad'}">${c.status}</b></div><div>Prepared cells<b>${c.prepared_cells} / ${c.grid_cells}</b></div>
      <div>Target CRS<b>${q.target_crs}</b></div><div>Criteria<b>${esc(q.criteria_version)}</b></div></div>
      ${q.data_gap_warning ? `<div class="warn">⚠ ${esc(q.data_gap_warning)} Cells: ${q.data_gap_cells.join(', ')}</div>` : ''}
      <b style="font-size:12px">Preparation log</b><ul class="tight">${q.issues.map(i => `<li>${esc(i.source_id)}: ${esc(i.issue)}</li>`).join('') || '<li>no issues</li>'}</ul>`;
    const files = [['approved_source_list.json', 'F.2.1'], ['data_quality_criteria.json', 'F.2.2'], ['habitat_model_parameters.json', 'F.2.3 (F.2.3.2)'], ['site_summary_rules.json', 'F.2.4'],
      ['map_display_rules.json', 'F.2.5'], ['interpretation_rules.json', 'F.2.6'], ['report_template.md', 'F.2.7']];
    $('controls').innerHTML = `<table class="t"><tr><th>Control file</th><th>Enters</th><th>Supplied by (Level 1)</th></tr>${files.map(([f, to]) => {
      const j = S.cfgRaw[f]; const owner = typeof j === 'string' ? (j.match(/Owner: (.+?\))/) || [, ''])[1] : (j._idef0.match(/Owner: (.+?\))/) || [, ''])[1];
      return `<tr><td><a href="data/config/${f}" target="_blank"><code>config/${f}</code></a></td><td>${to}</td><td>${esc(owner)}</td></tr>`; }).join('')}</table>`;
  }

  /* ------------------------------------------------------------------ routing */
  function badge() { $('runBadge').textContent = `${S.record.run_id} · ${S.record.parameter_set_id} · ${S.record.dataset_id}`; }
  function route() {
    const h = location.hash || '#/map'; const r = h.split('/')[1] || 'map'; S.route = r;
    document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.route === r));
    const mapRoute = r === 'map' || r === 'site';
    $('view-map').classList.toggle('on', mapRoute); $('view-model').classList.toggle('on', r === 'model'); $('view-data').classList.toggle('on', r === 'data');
    $('side-map').classList.toggle('on', r === 'map'); $('side-site').classList.toggle('on', r === 'site');
    $('drawer').hidden = true;
    if (mapRoute && map) { setTimeout(() => { map.invalidateSize(); if (S.needFit) { map.fitBounds(gridLayer.getBounds(), { padding: [16, 16] }); S.needFit = false; } }, 30); restyle(); }
    if (r === 'site') runSite();
    if (r === 'map') setTrace(['F.2.3', 'F.2.5'], `displayed ${S.record.run_id}`);
    if (r === 'data') setTrace(['F.2.1', 'F.2.2'], `${S.dq.dataset_identifier}`);
    if (r === 'model') setTrace(['F.2', 'F.2.3'], 'IDEF0 levels 1-3');
  }

  /* ------------------------------------------------------------------ init */
  async function init() {
    const [model, grid, prepared, record, dq, site] = await Promise.all(['data/idef0.json', 'data/risk_grid.geojson', 'data/prepared_datasets.json',
      'data/model_run_record.json', 'data/data_quality_report.json', 'data/sample_site.json'].map(getJSON));
    const names = ['approved_source_list.json', 'data_quality_criteria.json', 'habitat_model_parameters.json', 'site_summary_rules.json', 'map_display_rules.json', 'interpretation_rules.json'];
    const cfgs = await Promise.all(names.map(n => getJSON('data/config/' + n)));
    S.cfgRaw = Object.fromEntries(names.map((n, i) => [n, cfgs[i]])); S.cfgRaw['report_template.md'] = await getText('data/config/report_template.md');
    S.cfg = { map: S.cfgRaw['map_display_rules.json'], ssr: S.cfgRaw['site_summary_rules.json'], ir: S.cfgRaw['interpretation_rules.json'], rt: S.cfgRaw['report_template.md'] };
    S.defaultParams = S.cfgRaw['habitat_model_parameters.json']; S.params = JSON.parse(JSON.stringify(S.defaultParams));
    Object.assign(S, { model, grid, prepared, record, dq, batchRecord: record });
    S.P = Object.fromEntries(prepared.cells.map(c => [c.cell_id, c]));
    S.results = resultsFromGrid(grid); S.R = Object.fromEntries(S.results.cells.map(c => [c.cell_id, c])); S.batchR = S.R;
    site.site_selection.cell_ids.forEach(c => S.site.add(c)); $('siteName').value = site.site_selection.name;
    S.lastOut['F.2.1'] = { 'Dataset identifier': dq.dataset_identifier, 'Acquired datasets and metadata': `${dq.data_quality_report.sources.length} sources accepted, ${dq.acquired_metadata.rejected_sources.length} rejected` };
    S.lastOut['F.2.2'] = { 'Coverage Validation Result': dq.coverage_validation_result.status, 'Data-quality report': `${dq.data_quality_report.data_gap_cells.length} data-gap cells` };
    S.lastOut['F.2.3.6'] = { 'Model run record': `${record.run_id} (batch, scripts/run_pipeline.py)` };
    badge();
    try { buildMap(); } catch (e) { $('mapNotice').hidden = false; $('mapNotice').textContent = 'Map library failed to load: ' + e.message; }
    if (!navigator.onLine) { $('mapNotice').hidden = false; $('mapNotice').textContent = 'Offline: basemap tiles unavailable; the risk grid is still shown.'; }
    drawLevel1();
    drawIdef0($('level2'), model.level2.functions, { zoom: ['F.2.3'], boundaryOutputs: ['Displayed risk map and legend', 'Habitat-quality map', 'Site screening summary', 'Factor explanations and limitations', 'Screening report'] });
    drawIdef0($('level3'), model.level3.functions, { boundaryOutputs: ['Habitat-quality and degradation results', 'Model run record'] });
    drawHier(); drawSliders(); drawData();
    // events
    document.querySelectorAll('#layerToggle button').forEach(b => b.onclick = () => { S.layer = b.dataset.layer; document.querySelectorAll('#layerToggle button').forEach(x => x.classList.toggle('on', x === b)); restyle(); setTrace(['F.2.5'], b.textContent); });
    [...new Set(S.results.cells.map(c => c.land_cover))].sort().forEach(h => $('habitatFilter').add(new Option(h, h)));
    $('habitatFilter').onchange = restyle;
    $('clearSite').onclick = () => { S.site.clear(); restyle(); runSite(); };
    $('demoSite').onclick = () => { S.site = new Set(site.site_selection.cell_ids); $('siteName').value = site.site_selection.name; restyle(); runSite(); };
    $('siteName').onchange = runSite;
    $('exportMd').onclick = () => { const r = makeReport(); if (r) download('screening-report.md', r.markdown, 'text/markdown'); };
    $('exportCsv').onclick = () => { const r = makeReport(); if (r) download('screening-report.csv', r.csv, 'text/csv'); };
    $('previewReport').onclick = () => { const r = makeReport(); if (r) { $('reportText').textContent = r.markdown; $('reportDialog').showModal(); } };
    $('runModel').onclick = runLive;
    $('resetParams').onclick = () => { S.params = JSON.parse(JSON.stringify(S.defaultParams)); drawSliders(); };
    $('drawerClose').onclick = () => { $('drawer').hidden = true; };
    window.addEventListener('hashchange', route);
    route();
  }
  init().catch(e => { document.body.insertAdjacentHTML('afterbegin', `<div class="warn" style="margin:8px">Could not start: ${esc(e.message)} — run <code>python3 scripts/run_pipeline.py</code> then serve <code>dist/</code> over http.</div>`); console.error(e); });
})();
