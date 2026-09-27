/* WiFi Coverage – applicazione */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AP_COLORS = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#e377c2', '#8c564b', '#b5b21f', '#3a3f99', '#5f7a1f', '#b4464b'];
  const UNIT_NAMES = { 0.001: 'millimetri', 0.01: 'centimetri', 0.1: 'decimetri', 1: 'metri', 0.0254: 'pollici', 0.3048: 'piedi' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('wifimap.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('wifimap.' + k, JSON.stringify(v)); } catch (e) { } },
  };

  // ---------------- stato ----------------
  const S = {
    fileName: '', raw: null, header: {}, layerInfo: {},
    unitToM: 0.001, unitSource: '',
    layers: {},
    materials: loadMaterials(),
    det: { minT: 0.03, maxT: 0.6, angTol: 3, sameLayer: true, ignoreDoorArcs: true },
    segsM: [], textsM: [], ob: null, bboxM: null,
    area: null,
    aps: [], nextAp: 1,
    band: '5', mode: 'server', thr: -67, shade: true,
    res: 320, smooth: true, n: 2.2, hAp: 2.7, hCli: 1.0, margin: 0, reg: 'etsi',
    grid: null, results: new Map(), geomVer: 0,
    view: { cx: 0, cy: 0, s: 20 }, tool: 'select', selected: null,
    addModel: 'cap_ax', showTexts: true, wallColor: 'mat',
    pdf: null, bg: null, hiLayer: null, wallMat: 'laterizio', wallT: 12,
    catalog: MIKROTIK_CATALOG.concat(store.get('customAps', [])),
  };
  let composite = null;
  let K = 1; // scala elementi grafici (esportazione PNG) // {canvas, contours, stats}
  let planPaths = null;
  let computing = null;

  function loadMaterials() {
    const saved = store.get('materials', null);
    const m = {};
    for (const d of DEFAULT_MATERIALS) m[d.id] = JSON.parse(JSON.stringify(d));
    if (saved) for (const id in saved) if (m[id]) { m[id].b24 = saved[id].b24; m[id].b5 = saved[id].b5; }
    return m;
  }

  // ---------------- utilità ----------------
  const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? '–' : v.toFixed(d).replace('.', ',').replace('-', '−');
  function toast(msg, ms = 3500) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
  function setStatus(msg) { $('statusMsg').textContent = msg || ''; }
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  const modelOf = (id) => S.catalog.find(m => m.id === id) || S.catalog[0];
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ACI = { 1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#888888', 8: '#808080', 9: '#c0c0c0' };
  function aciColor(i) { return ACI[i] || `hsl(${(i * 37) % 360} 55% 50%)`; }
  function chanFreq(band, ch) { return band === '24' ? 2407 + 5 * ch : 5000 + 5 * ch; }
  const CH24 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const CH5 = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 149, 153, 157, 161, 165];

  // ---------------- caricamento DXF ----------------
  function loadDxfText(text, name) {
    let dxf;
    try { dxf = DXF.parse(text); } catch (e) { toast(e.message, 7000); return; }
    const flat = DXF.flatten(dxf);
    if (!flat.segs.length) { toast('Nessuna linea trovata nel file. Controlla che il disegno sia nello spazio modello.', 6000); return; }
    S.fileName = name; S.header = { insunits: dxf.insunits };
    S.raw = flat;
    // layer
    const info = {};
    for (const s of flat.segs) (info[s.layer] = info[s.layer] || { count: 0, color: 7 }).count++;
    for (const t of flat.texts) (info[t.layer] = info[t.layer] || { count: 0, color: 7 }).texts = ((info[t.layer].texts) || 0) + 1;
    for (const l in info) if (dxf.layers[l]) info[l].color = dxf.layers[l].color;
    S.layerInfo = info;
    S.layers = {};
    for (const l in info) {
      const off = dxf.layers[l] && (dxf.layers[l].off || dxf.layers[l].frozen);
      S.layers[l] = { mat: guessMaterialForLayer(l), tDefault: 0.1, on: !off };
    }
    // unità
    const door = doorUnit(flat.segs);
    if (dxf.unitToM && (!door || door.u === dxf.unitToM)) { S.unitToM = dxf.unitToM; S.unitSource = 'dal file ($INSUNITS)' + (door ? `, confermata dalle porte (anta media ${fmt(door.r * door.u, 2)} m)` : ''); }
    else if (door) {
      S.unitToM = door.u;
      S.unitSource = `ricavata dalle porte (${door.n} aperture, anta media ${fmt(door.r * door.u, 2)} m)` + (dxf.unitToM ? `; il file dichiara ${UNIT_NAMES[dxf.unitToM] || '?'}` : '');
      if (dxf.unitToM) setTimeout(() => toast(`Unità corretta in ${UNIT_NAMES[door.u]}: il file dichiara ${UNIT_NAMES[dxf.unitToM]}, ma in quel caso le porte sarebbero larghe ${fmt(door.r * dxf.unitToM * 100, 2)} cm.`, 9000), 50);
    }
    else if (dxf.unitToM) { S.unitToM = dxf.unitToM; S.unitSource = 'dal file ($INSUNITS)'; }
    else { S.unitToM = guessUnit(flat.segs); S.unitSource = 'stimata dalle dimensioni: verifica'; }
    S.area = null; S.aps = []; S.selected = null; S.nextAp = 1;
    rebuildGeometry(true);
    fitView();
    renderApPanel(); render();
    toast(`Caricato ${name}: ${flat.segs.length.toLocaleString('it-IT')} segmenti, ${Object.keys(info).length} layer.`);
  }

  /* Unità ricavata dalle porte: conta i quarti di cerchio il cui raggio, in una data unità,
     cade tra 0,6 e 1,3 m (ante di porta). Restituisce {u, r} con l'unità più coerente. */
  const DOOR_UNITS = [1, 0.01, 0.001, 0.0254, 0.1];
  function doorUnit(segs) {
    const seen = new Set(), rs = [];
    for (const sg of segs) {
      const a = sg.arc; if (!a || a.circle || a.poly || seen.has(a)) continue;
      seen.add(a); if (a.sweep >= 80 && a.sweep <= 100 && a.r > 0) rs.push(a.r);
    }
    let best = null;
    for (const u of DOOR_UNITS) {
      const inr = rs.filter(r => r * u >= 0.6 && r * u <= 1.3);
      if (inr.length >= 8 && (!best || inr.length > best.n)) { inr.sort((x, y) => x - y); best = { u, n: inr.length, r: inr[inr.length >> 1] }; }
    }
    return best;
  }

  function guessUnit(segs) {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const s of segs) { minx = Math.min(minx, s.x1, s.x2); maxx = Math.max(maxx, s.x1, s.x2); miny = Math.min(miny, s.y1, s.y2); maxy = Math.max(maxy, s.y1, s.y2); }
    const span = Math.max(maxx - minx, maxy - miny);
    if (span > 2000) return 0.001; if (span > 400) return 0.01; return 1;
  }

  function readFile(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const head = String.fromCharCode.apply(null, new Uint8Array(r.result, 0, Math.min(5, r.result.byteLength)));
      if (head === '%PDF-' || /\.pdf$/i.test(file.name)) { loadPdf(r.result, file.name); return; }
      try { const text = DXF.decode(r.result); S.pdf = null; S.bg = null; loadDxfText(text, file.name); }
      catch (e) { toast(e.message, 8000); }
    };
    r.readAsArrayBuffer(file);
  }

  // ---------------- caricamento PDF ----------------
  const PT_TO_M = 0.0254 / 72;
  async function loadPdf(buffer, name) {
    setStatus('Lettura del PDF…'); progress(0.02);
    let doc;
    try { doc = await PDFPlan.open(buffer); }
    catch (e) { progress(1); toast('PDF non leggibile: ' + (e && e.message ? e.message : e), 8000); return; }
    S.pdf = { doc, name, page: 1, pages: doc.numPages };
    await loadPdfPage(1);
  }

  async function loadPdfPage(n) {
    const { doc, name } = S.pdf;
    S.pdf.page = n;
    let r;
    try { r = await PDFPlan.readPage(doc, n, f => progress(0.05 + f * 0.6)); }
    catch (e) { progress(1); toast('Errore nella lettura della pagina ' + n + ': ' + e.message, 8000); return; }
    setStatus('Rendering dello sfondo…');
    let bgc = null;
    try { bgc = await PDFPlan.renderBackground(r.page); } catch (e) { }
    S.fileName = name + (S.pdf.pages > 1 ? ` · pag. ${n}` : '');
    S.raw = { segs: r.segs, texts: r.texts };
    const info = {};
    for (const sg of r.segs) (info[sg.layer] = info[sg.layer] || { count: 0, color: 7 }).count++;
    for (const l in info) { const m = l.match(/#([0-9a-f]{6})/i); if (m) info[l].css = '#' + m[1]; }
    S.layerInfo = info; S.layers = {};
    for (const l in info) {
      let mat = r.usedOCG ? guessMaterialForLayer(l) : pdfStyleGuess(l, info[l].count);
      if (/tratteggio|#ffffff|^Testi e simboli/i.test(l)) mat = 'ignora';
      S.layers[l] = { mat, tDefault: 0.1, on: true };
    }
    S.det.sameLayer = !!r.usedOCG; // senza livelli le due facce di un muro possono finire in gruppi diversi
    S.pdf.usedOCG = r.usedOCG; S.pdf.wmm = r.width * 25.4 / 72; S.pdf.hmm = r.height * 25.4 / 72;
    S.pdf.textScale = r.scaleDenom || null;
    const denom = r.scaleDenom || 100;
    S.pdf.scale = denom;
    S.unitToM = denom * PT_TO_M;
    S.unitSource = r.scaleDenom ? `scala 1:${denom} letta dal PDF` : 'scala 1:100 ipotizzata: verifica con una misura nota';
    S.bg = bgc ? { canvas: bgc, w: r.width, h: r.height, show: true, opacity: r.segs.length ? 0.35 : 0.8 } : null;
    S.area = null; S.aps = []; S.selected = null; S.nextAp = 1; S.drawn = [];
    rebuildGeometry(true);
    fitView(); renderApPanel(); render(); progress(1);
    if (!r.segs.length) toast('Il PDF non contiene linee vettoriali (probabilmente è una scansione). La pianta è mostrata come sfondo: tara la scala e disegna i muri dalla scheda Ostacoli.', 10000);
    else toast(`Caricato ${S.fileName}: ${r.segs.length.toLocaleString('it-IT')} segmenti in ${Object.keys(info).length} gruppi${r.usedOCG ? ' (livelli PDF)' : ' (per colore e spessore)'}. ${r.scaleDenom ? 'Scala 1:' + denom + ' letta dal PDF.' : 'Scala non trovata: ipotizzata 1:100, verificala.'}`, 7000);
  }

  /* PDF senza livelli: materiale proposto dal tratto.
     Campiture scure e linee scure spesse (>= 0,15 mm) = muri; linee sottili, colorate o chiare = arredi, quote, annotazioni (ignorate). */
  function pdfStyleGuess(name, count) {
    const m = name.match(/#([0-9a-f]{6})/i); if (!m) return 'auto';
    const [r, g, b] = hexRgb('#' + m[1]);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255, sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    if (sat > 0.25) return 'ignora';
    if (/^Campiture/.test(name)) return lum < 0.6 && count >= 4 ? 'auto' : 'ignora';
    const w = parseFloat((name.match(/([\d,]+) mm/) || [0, '0'])[1].replace(',', '.'));
    return w >= 0.15 && lum < 0.45 ? 'auto' : 'ignora';
  }

  function rescale(nu, source) {
    const f = nu / S.unitToM; S.unitToM = nu; S.unitSource = source;
    for (const ap of S.aps) { ap.x *= f; ap.y *= f; }
    if (S.area) S.area = { x0: S.area.x0 * f, y0: S.area.y0 * f, x1: S.area.x1 * f, y1: S.area.y1 * f };
    rebuildGeometry(false); fitView(); render();
  }

  // ---------------- geometria ----------------
  function rebuildGeometry(resetArea) {
    if (!S.raw) return;
    const k = S.unitToM;
    S.segsM = S.raw.segs.map(s => ({ x1: s.x1 * k, y1: s.y1 * k, x2: s.x2 * k, y2: s.y2 * k, layer: s.layer, arc: s.arc ? Object.assign({}, s.arc, { r: s.arc.r != null ? s.arc.r * k : undefined }) : null }));
    S.textsM = S.raw.texts.map(t => Object.assign({}, t, { x: t.x * k, y: t.y * k, h: t.h * k }));
    const t0 = performance.now();
    S.ob = Engine.prepare(S.segsM, S.layers, S.materials, S.det);
    // bbox di tutti e degli ostacoli
    let b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const ob = S.ob;
    for (let i = 0; i < ob.n; i++) { b.x0 = Math.min(b.x0, ob.X1[i], ob.X2[i]); b.x1 = Math.max(b.x1, ob.X1[i], ob.X2[i]); b.y0 = Math.min(b.y0, ob.Y1[i], ob.Y2[i]); b.y1 = Math.max(b.y1, ob.Y1[i], ob.Y2[i]); }
    if (!isFinite(b.x0)) { for (const s of S.segsM) { b.x0 = Math.min(b.x0, s.x1, s.x2); b.x1 = Math.max(b.x1, s.x1, s.x2); b.y0 = Math.min(b.y0, s.y1, s.y2); b.y1 = Math.max(b.y1, s.y1, s.y2); } }
    if (!isFinite(b.x0) && S.bg) b = { x0: 0, y0: 0, x1: S.bg.w * k, y1: S.bg.h * k };
    S.bboxM = isFinite(b.x0) ? b : null;
    const mc = S.bboxM ? mainCluster(ob, S.bboxM) : { area: null, parts: 1 };
    S.autoArea = mc.area; S.parts = mc;
    if (resetArea) S.area = null;
    buildPlanPaths();
    S.geomVer++;
    S.results.clear();
    setStatus(`Ostacoli pronti in ${Math.round(performance.now() - t0)} ms`);
    updateGrid();
    renderObstaclePanel();
    renderPlanPanel();
    scheduleCompute();
  }

  function calcArea() {
    if (S.area) return S.area;
    const b = S.autoArea || S.bboxM; if (!b) return null;
    const m = 1.5;
    return { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m };
  }

  /* Area automatica: la parte di disegno più estesa (edificio principale).
     Esclude cornici e cartigli: le linee lunghe quanto il foglio non contano e le parti staccate
     da più di ~6 m vengono separate. */
  function mainCluster(ob, b) {
    const W = b.x1 - b.x0, H = b.y1 - b.y0, big = Math.max(W, H);
    if (!(big > 0) || ob.n < 20) return { area: null, parts: 1 };
    const c = Math.max(0.5, big / 500), nx = Math.ceil(W / c) + 1, ny = Math.ceil(H / c) + 1;
    const occ = new Float32Array(nx * ny);
    for (let i = 0; i < ob.n; i++) {
      const L = Math.hypot(ob.X2[i] - ob.X1[i], ob.Y2[i] - ob.Y1[i]);
      if (L > 0.35 * big) continue;
      const steps = Math.max(1, Math.ceil(L / (c / 2)));
      for (let k = 0; k <= steps; k++) {
        const x = ob.X1[i] + (ob.X2[i] - ob.X1[i]) * k / steps, y = ob.Y1[i] + (ob.Y2[i] - ob.Y1[i]) * k / steps;
        occ[Math.floor((y - b.y0) / c) * nx + Math.floor((x - b.x0) / c)] += L / (steps + 1);
      }
    }
    const rad = Math.max(1, Math.round(3 / c));
    const lab = new Int32Array(nx * ny).fill(-1);
    const comps = [];
    const q = new Int32Array(nx * ny);
    for (let s0 = 0; s0 < nx * ny; s0++) {
      if (!occ[s0] || lab[s0] >= 0) continue;
      const id = comps.length; let qh = 0, qt = 0; q[qt++] = s0; lab[s0] = id;
      const cp = { w: 0, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
      while (qh < qt) {
        const o = q[qh++], ox = o % nx, oy = (o / nx) | 0;
        cp.w += occ[o]; cp.x0 = Math.min(cp.x0, ox); cp.x1 = Math.max(cp.x1, ox); cp.y0 = Math.min(cp.y0, oy); cp.y1 = Math.max(cp.y1, oy);
        for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
          const X = ox + dx, Y = oy + dy; if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
          const t = Y * nx + X; if (occ[t] && lab[t] < 0) { lab[t] = id; q[qt++] = t; }
        }
      }
      comps.push(cp);
    }
    comps.sort((a, z) => z.w - a.w);
    const m0 = comps[0]; if (!m0) return { area: null, parts: 1 };
    const parts = comps.filter(cp => cp.w > 0.08 * m0.w);
    const box = (cp) => ({ x0: b.x0 + cp.x0 * c, y0: b.y0 + cp.y0 * c, x1: b.x0 + (cp.x1 + 1) * c, y1: b.y0 + (cp.y1 + 1) * c });
    return { area: box(m0), parts: parts.length, others: parts.slice(1).map(box) };
  }

  function updateGrid() {
    const a = calcArea(); if (!a) { S.grid = null; return; }
    const W = a.x1 - a.x0, H = a.y1 - a.y0;
    const cs = Math.max(Math.max(W, H) / S.res, 0.05);
    const w = Math.max(2, Math.ceil(W / cs)), h = Math.max(2, Math.ceil(H / cs));
    const key = [a.x0, a.y0, cs, w, h].map(v => v.toFixed(4)).join('|');
    if (!S.grid || S.grid.key !== key) { S.grid = { x0: a.x0, y0: a.y0, cs, w, h, key }; S.results.clear(); }
  }

  function buildPlanPaths() {
    // percorsi per materiale (ostacoli) + layer ignorati
    const byMat = {};
    const ob = S.ob;
    for (let i = 0; i < ob.n; i++) {
      const m = ob.matOf[i];
      const p = byMat[m] || (byMat[m] = { path: new Path2D(), tw: 0, cnt: 0 });
      p.path.moveTo(ob.X1[i], ob.Y1[i]); p.path.lineTo(ob.X2[i], ob.Y2[i]);
    }
    const faint = new Path2D();
    const obSet = new Set();
    for (const s of S.segsM) {
      const lc = S.layers[s.layer];
      if (!lc || !lc.on) continue;
      if (lc.mat === 'ignora') { faint.moveTo(s.x1, s.y1); faint.lineTo(s.x2, s.y2); }
    }
    // archi porte ignorati: disegnati tenui
    if (S.det.ignoreDoorArcs) for (const s of S.segsM) {
      const lc = S.layers[s.layer];
      if (lc && lc.on && lc.mat !== 'ignora' && s.arc && !s.arc.circle && !s.arc.poly && s.arc.sweep >= 45 && s.arc.sweep <= 135 && s.arc.r >= 0.45 && s.arc.r <= 1.6) { faint.moveTo(s.x1, s.y1); faint.lineTo(s.x2, s.y2); }
    }
    planPaths = { byMat, faint };
  }

  // ---------------- AP ----------------
  function apBandParams(ap, band) {
    const m = modelOf(ap.model);
    const spec = band === '24' ? m.b24 : m.b5;
    if (!spec || !(band === '24' ? ap.on24 : ap.on5)) return null;
    const f = chanFreq(band, band === '24' ? ap.ch24 : ap.ch5);
    const txMax = maxTxFor(spec, f);
    const txSet = band === '24' ? ap.tx24 : ap.tx5;
    const tx = txSet == null || txSet === '' ? txMax : Math.min(+txSet, txMax);
    const lim = (REG_LIMITS[S.reg] || REG_LIMITS.etsi).lim(band, f);
    const eirpRaw = tx + spec.g;
    return { tx, txMax, g: spec.g, eirpRaw, lim, eirp: Math.min(eirpRaw, lim), capped: eirpRaw > lim, f };
  }
  // valori della tendina potenza TX: da 1 dBm al massimo del modello (per il canale scelto)
  function txSteps(txMax) {
    const v = []; for (let t = 1; t < txMax - 0.05; t++) v.push(t);
    v.push(txMax); return v;
  }

  function addAp(x, y, modelId) {
    const m = modelOf(modelId);
    const used = new Set(S.aps.map(a => a.color));
    const color = AP_COLORS.find(c => !used.has(c)) || AP_COLORS[S.aps.length % AP_COLORS.length];
    const k = S.aps.length;
    const ap = {
      id: 'ap' + (S.nextAp), name: 'AP' + (S.nextAp++), model: m.id, x, y, color,
      on24: !!m.b24, on5: !!m.b5, tx24: null, tx5: null,
      ch24: [1, 6, 11][k % 3], ch5: [36, 52, 100, 116, 132, 44, 60, 108, 124, 140][k % 10], az: 0,
    };
    S.aps.push(ap);
    S.selected = ap.id;
    renderApPanel();
    scheduleCompute();
    return ap;
  }

  function removeAp(id) {
    S.aps = S.aps.filter(a => a.id !== id);
    S.results.delete(id);
    if (S.selected === id) S.selected = null;
    composite = null;
    renderApPanel(); rebuildComposite(); render();
  }

  function apKey(ap) {
    const p24 = apBandParams(ap, '24'), p5 = apBandParams(ap, '5');
    const m = modelOf(ap.model);
    return JSON.stringify([S.geomVer, S.grid && S.grid.key, S.n, S.hAp, S.hCli, S.margin, ap.x.toFixed(3), ap.y.toFixed(3), ap.az, m.beam, p24 && p24.eirp, p24 && p24.f, p5 && p5.eirp, p5 && p5.f]);
  }

  // ---------------- calcolo (asincrono a blocchi) ----------------
  function scheduleCompute() {
    clearTimeout(scheduleCompute._t);
    scheduleCompute._t = setTimeout(runCompute, 30);
  }

  function runCompute() {
    if (!S.ob || !S.grid) return;
    const token = {}; computing = token;
    const todo = S.aps.filter(ap => { const r = S.results.get(ap.id); return !r || r.key !== apKey(ap); });
    for (const id of [...S.results.keys()]) if (!S.aps.find(a => a.id === id)) S.results.delete(id);
    if (!todo.length) { rebuildComposite(); render(); progress(1); return; }
    const g = S.grid;
    const par = { n: S.n, dh: Math.abs(S.hAp - S.hCli), margin: S.margin };
    let ai = 0, row = 0, out = null, cur = null;
    const total = todo.length * g.h; let done = 0;
    const t0 = performance.now();
    const step = () => {
      if (computing !== token) return;
      const tEnd = performance.now() + 24;
      while (performance.now() < tEnd) {
        if (!cur) {
          const ap = todo[ai]; const m = modelOf(ap.model);
          const p24 = apBandParams(ap, '24'), p5 = apBandParams(ap, '5');
          cur = { ap, key: apKey(ap), e: { x: ap.x, y: ap.y, az: ap.az, beam: m.beam, eirp24: p24 ? p24.eirp : null, eirp5: p5 ? p5.eirp : null, f24: p24 ? p24.f : 2437, f5: p5 ? p5.f : 5500 } };
          out = { r24: cur.e.eirp24 != null ? new Float32Array(g.w * g.h) : null, r5: cur.e.eirp5 != null ? new Float32Array(g.w * g.h) : null };
          row = 0;
        }
        const rows = Math.max(1, Math.min(g.h - row, 8));
        if (S.ob.rayId > 2e9) { S.ob.rayId = 0; S.ob.stamp.fill(-1); }
        Engine.computeAP(S.ob, cur.e, g, par, row, row + rows, out);
        row += rows; done += rows;
        if (row >= g.h) {
          S.results.set(cur.ap.id, { key: cur.key, r24: out.r24, r5: out.r5 });
          cur = null; ai++;
          if (ai >= todo.length) {
            progress(1);
            setStatus(`Calcolati ${todo.length} AP in ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s · griglia ${g.w}×${g.h} (${fmt(g.cs * 100, 0)} cm)`);
            rebuildComposite(); render(); renderStats();
            return;
          }
        }
      }
      progress(done / total);
      setTimeout(step, 0);
    };
    progress(0.001);
    step();
  }
  function progress(f) { $('prog').style.width = (f >= 1 ? 100 : f * 100) + '%'; if (f >= 1) setTimeout(() => { if ($('prog').style.width === '100%') $('prog').style.width = '0'; }, 600); }

  // ---------------- composizione mappa ----------------
  function bandFields() {
    const list = [];
    for (const ap of S.aps) {
      const r = S.results.get(ap.id);
      if (!r || r.key !== apKey(ap)) continue;
      let f = S.band === '24' ? r.r24 : r.r5;
      if (f && S.smooth) {
        const rad = Math.max(1, Math.min(6, Math.round(0.3 / S.grid.cs)));
        const ck = S.band + ':' + rad;
        r.blur = r.blur || {};
        if (!r.blur[ck]) r.blur[ck] = boxBlur(f, S.grid.w, S.grid.h, rad);
        f = r.blur[ck];
      }
      if (f) list.push({ ap, f });
    }
    return list;
  }

  // sfocatura separabile (2 passate di media mobile) in dB: simula la diffrazione ai bordi d'ombra
  function boxBlur(src, w, h, r) {
    let a = Float32Array.from(src), b = new Float32Array(src.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < h; j++) {
        const o = j * w;
        for (let i = 0; i < w; i++) {
          let s = 0, n = 0;
          for (let k = Math.max(0, i - r); k <= Math.min(w - 1, i + r); k++) { s += a[o + k]; n++; }
          b[o + i] = s / n;
        }
      }
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
          let s = 0, n = 0;
          for (let k = Math.max(0, j - r); k <= Math.min(h - 1, j + r); k++) { s += b[k * w + i]; n++; }
          a[j * w + i] = s / n;
        }
      }
    }
    return a;
  }

  const HEAT = [[-50, '#0e6b4f'], [-60, '#4cae4f'], [-67, '#a6d854'], [-70, '#f2d03b'], [-75, '#f59e2e'], [-80, '#e8552d'], [-85, '#b8322a']];
  const SINR = [[25, '#1a7f37'], [20, '#4cae4f'], [15, '#a6d854'], [10, '#f2d03b'], [5, '#f59e2e'], [0, '#e8552d'], [-99, '#b8322a']];
  function stepColor(tab, v) { for (const [t, c] of tab) if (v >= t) return c; return null; }

  function rebuildComposite() {
    composite = null;
    const g = S.grid; if (!g) return;
    const fields = bandFields();
    const N = g.w * g.h;
    const best = new Float32Array(N).fill(-200), second = new Float32Array(N).fill(-200);
    const bi = new Int16Array(N).fill(-1);
    for (let k = 0; k < fields.length; k++) {
      const f = fields[k].f;
      for (let o = 0; o < N; o++) {
        const v = f[o];
        if (v > best[o]) { second[o] = best[o]; best[o] = v; bi[o] = k; } else if (v > second[o]) second[o] = v;
      }
    }
    // SINR (co-canale)
    let sinr = null;
    if (S.mode === 'sinr' && fields.length) {
      sinr = new Float32Array(N);
      const noise = Math.pow(10, -95 / 10);
      const chans = fields.map(x => S.band === '24' ? x.ap.ch24 : x.ap.ch5);
      const overlap24 = (a, b) => Math.abs(a - b) < 5;
      for (let o = 0; o < N; o++) {
        const k = bi[o]; if (k < 0) { sinr[o] = -99; continue; }
        let I = noise;
        for (let q = 0; q < fields.length; q++) {
          if (q === k) continue;
          const same = S.band === '24' ? overlap24(chans[q], chans[k]) : chans[q] === chans[k];
          if (same) { const fac = S.band === '24' ? Math.max(0, 1 - Math.abs(chans[q] - chans[k]) / 5) : 1; I += fac * Math.pow(10, fields[q].f[o] / 10); }
        }
        sinr[o] = best[o] - 10 * Math.log10(I);
      }
    }
    // raster (sovracampionato con interpolazione bilineare)
    const ss = N > 400000 ? 1 : 2;
    const W = g.w * ss, H = g.h * ss;
    const cnv = document.createElement('canvas'); cnv.width = W; cnv.height = H;
    const ctx = cnv.getContext('2d');
    const img = ctx.createImageData(W, H), d = img.data;
    const cols = fields.map(x => hexRgb(x.ap.color));
    const thr = S.thr;
    const sample = (arr, fx, fy) => {
      const x = Math.min(Math.max(fx, 0), g.w - 1.001), y = Math.min(Math.max(fy, 0), g.h - 1.001);
      const i = x | 0, j = y | 0, tx = x - i, ty = y - j, o = j * g.w + i;
      return (arr[o] * (1 - tx) + arr[o + 1] * tx) * (1 - ty) + (arr[o + g.w] * (1 - tx) + arr[o + g.w + 1] * tx) * ty;
    };
    const heatRgb = HEAT.map(([t, c]) => [t, hexRgb(c)]), sinrRgb = SINR.map(([t, c]) => [t, hexRgb(c)]);
    const vals = new Float32Array(fields.length);
    for (let py = 0; py < H; py++) {
      const fy = (H - 1 - py + 0.5) / ss - 0.5;
      for (let px = 0; px < W; px++) {
        const fx = (px + 0.5) / ss - 0.5;
        const p = (py * W + px) * 4;
        if (!fields.length) continue;
        let bv = -999, bk = -1;
        for (let k = 0; k < fields.length; k++) { const v = sample(fields[k].f, fx, fy); vals[k] = v; if (v > bv) { bv = v; bk = k; } }
        if (S.mode === 'server') {
          if (bv < thr) continue;
          const c = cols[bk];
          const a = S.shade ? 0.26 + 0.44 * Math.min(1, (bv - thr) / Math.max(8, -40 - thr)) : 0.42;
          d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = a * 255;
        } else if (S.mode === 'areas') {
          let r = 0, gg = 0, b = 0, a = 0;
          for (let k = 0; k < fields.length; k++) {
            if (vals[k] < thr) continue;
            const al = S.shade ? 0.14 + 0.16 * Math.min(1, (vals[k] - thr) / Math.max(8, -40 - thr)) : 0.2;
            const c = cols[k];
            r = r * (1 - al) + c[0] * al; gg = gg * (1 - al) + c[1] * al; b = b * (1 - al) + c[2] * al; a = a + al * (1 - a);
          }
          if (a > 0) { d[p] = r / a; d[p + 1] = gg / a; d[p + 2] = b / a; d[p + 3] = Math.min(0.75, a) * 255; }
        } else if (S.mode === 'heat') {
          let c = null; for (const [t, rgb] of heatRgb) if (bv >= t) { c = rgb; break; }
          if (!c) continue;
          d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 0.55 * 255;
        } else if (S.mode === 'sinr') {
          if (bv < -85) continue;
          const sv = sample(sinr, fx, fy);
          let c = null; for (const [t, rgb] of sinrRgb) if (sv >= t) { c = rgb; break; }
          d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 0.55 * 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    // isolinee
    const contours = [];
    const padded = (fn) => {
      const w2 = g.w + 2, h2 = g.h + 2, f = new Float32Array(w2 * h2).fill(-1e6);
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) f[(j + 1) * w2 + i + 1] = fn(j * g.w + i);
      return { f, w2, h2 };
    };
    const toWorld = (lines) => lines.map(l => l.map(([x, y]) => [g.x0 + (x - 1) * g.cs, g.y0 + (y - 1) * g.cs]));
    if (S.mode === 'server') {
      fields.forEach((fl, k) => {
        const { f, w2, h2 } = padded(o => { const v = fl.f[o]; return Math.min(bi[o] === k ? v - second[o] : v - best[o], v - thr); });
        contours.push({ color: fl.ap.color, width: 2, lines: toWorld(Engine.contour(f, w2, h2, 0)), ap: fl.ap });
      });
    } else if (S.mode === 'areas') {
      fields.forEach((fl) => {
        const { f, w2, h2 } = padded(o => fl.f[o]);
        contours.push({ color: fl.ap.color, width: 2, lines: toWorld(Engine.contour(f, w2, h2, thr)), ap: fl.ap });
      });
    } else if (S.mode === 'heat') {
      for (const lv of [-50, -60, -67, -70, -75, -80, -85]) {
        const { f, w2, h2 } = padded(o => best[o]);
        contours.push({ color: null, width: lv === thr ? 2 : 0.8, lines: toWorld(Engine.contour(f, w2, h2, lv)), level: lv });
      }
    } else if (S.mode === 'sinr' && fields.length) {
      const { f, w2, h2 } = padded(o => best[o]);
      contours.push({ color: null, width: 1.4, lines: toWorld(Engine.contour(f, w2, h2, thr)), level: thr });
    }
    // statistiche
    let cov = 0, cnt = new Array(fields.length).fill(0), over2 = 0;
    for (let o = 0; o < N; o++) { if (best[o] >= thr) { cov++; cnt[bi[o]]++; if (second[o] >= thr) over2++; } }
    composite = { canvas: cnv, contours, best, bi, fields, stats: { cov: cov / N, cnt, over2: over2 / N, N } };
    renderLegend(); renderStats();
  }

  // ---------------- vista ----------------
  const cv = $('cv'); let ctx = cv.getContext('2d');
  let dpr = 1, CW = 0, CH = 0;
  function resize() {
    const r = cv.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    CW = r.width; CH = r.height;
    cv.width = Math.max(1, Math.round(CW * dpr)); cv.height = Math.max(1, Math.round(CH * dpr));
    render();
  }
  const sx = (x) => (x - S.view.cx) * S.view.s + CW / 2;
  const sy = (y) => CH / 2 - (y - S.view.cy) * S.view.s;
  const wx = (px) => (px - CW / 2) / S.view.s + S.view.cx;
  const wy = (py) => S.view.cy - (py - CH / 2) / S.view.s;

  function fitView() {
    const a = calcArea() || { x0: 0, y0: 0, x1: 30, y1: 20 };
    const r = cv.getBoundingClientRect(); CW = r.width || 800; CH = r.height || 600;
    S.view.cx = (a.x0 + a.x1) / 2; S.view.cy = (a.y0 + a.y1) / 2;
    S.view.s = Math.min((CW - 60) / (a.x1 - a.x0), (CH - 60) / (a.y1 - a.y0));
    if (!isFinite(S.view.s) || S.view.s <= 0) S.view.s = 20;
  }

  function render() {
    if (!CW) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssVar('--paper'); ctx.fillRect(0, 0, CW, CH);
    const a = calcArea();
    // sfondo PDF
    if (S.bg && S.bg.show) {
      const k = S.unitToM, dark = cssVar('--paper').toLowerCase() !== '#fbfcfb';
      ctx.save(); ctx.globalAlpha = S.bg.opacity;
      if (dark) ctx.filter = 'invert(1) hue-rotate(180deg)';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(S.bg.canvas, sx(0), sy(S.bg.h * k), S.bg.w * k * S.view.s, S.bg.h * k * S.view.s);
      ctx.restore();
    }
    // griglia 1 m / 5 m
    drawGrid();
    // mappa
    if (composite && S.grid) {
      const g = S.grid;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(composite.canvas, sx(g.x0), sy(g.y0 + g.h * g.cs), g.w * g.cs * S.view.s, g.h * g.cs * S.view.s);
    }
    // pianta
    if (planPaths) {
      ctx.save();
      ctx.setTransform(dpr * S.view.s, 0, 0, -dpr * S.view.s, dpr * (CW / 2 - S.view.cx * S.view.s), dpr * (CH / 2 + S.view.cy * S.view.s));
      ctx.lineCap = 'round';
      ctx.lineWidth = 1 / S.view.s;
      ctx.strokeStyle = cssVar('--plan-faint');
      ctx.stroke(planPaths.faint);
      const ink = cssVar('--plan-ink');
      for (const m in planPaths.byMat) {
        const mat = S.materials[m];
        ctx.strokeStyle = S.wallColor === 'mat' && mat ? mat.color : ink;
        ctx.lineWidth = (m === 'arredo' ? 1 : 1.4) / S.view.s;
        ctx.stroke(planPaths.byMat[m].path);
      }
      ctx.restore();
      if (S.wallColor === 'mat') {
        // ripassa in inchiostro sottile per leggibilità
      }
    }
    // layer evidenziato (passaggio del mouse sulla tabella)
    if (S.hiLayer) {
      ctx.beginPath();
      for (const sg of S.segsM) if (sg.layer === S.hiLayer) { ctx.moveTo(sx(sg.x1), sy(sg.y1)); ctx.lineTo(sx(sg.x2), sy(sg.y2)); }
      ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 3; ctx.globalAlpha = .85; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // muro in disegno
    if (S.tool === 'wall' && wallDraw.pts.length) {
      const last = wallDraw.pts[wallDraw.pts.length - 1];
      const m = S.materials[S.wallMat];
      ctx.strokeStyle = m ? m.color : cssVar('--accent'); ctx.lineWidth = Math.max(2, S.wallT / 100 * S.view.s); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx(last[0]), sy(last[1]));
      if (hoverW) { const h = orthoSnap(last, hoverW); ctx.lineTo(sx(h[0]), sy(h[1])); }
      ctx.globalAlpha = .6; ctx.stroke(); ctx.globalAlpha = 1;
    }
    // testi
    if (S.showTexts && S.textsM.length && S.textsM.length < 6000) {
      ctx.fillStyle = cssVar('--muted');
      for (const t of S.textsM) {
        const lc = S.layers[t.layer]; if (lc && !lc.on) continue;
        const hpx = t.h * S.view.s; if (hpx < 5) continue;
        const X = sx(t.x), Y = sy(t.y); if (X < -300 || X > CW + 300 || Y < -100 || Y > CH + 100) continue;
        ctx.save(); ctx.translate(X, Y); ctx.rotate(-t.rot * Math.PI / 180);
        ctx.font = `${Math.min(hpx, 40)}px ${cssVar('--sans')}`; ctx.textBaseline = t.mtext ? 'top' : 'alphabetic';
        ctx.fillText(t.s, 0, 0); ctx.restore();
      }
    }
    // isolinee
    if (composite) {
      ctx.lineJoin = 'round';
      for (const c of composite.contours) {
        ctx.beginPath();
        for (const l of c.lines) { l.forEach(([x, y], i) => i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))); }
        if (c.color) {
          ctx.strokeStyle = cssVar('--paper'); ctx.lineWidth = c.width + 2; ctx.globalAlpha = .7; ctx.stroke(); ctx.globalAlpha = 1;
          ctx.strokeStyle = c.color; ctx.lineWidth = c.width;
        } else { ctx.strokeStyle = cssVar('--plan-ink'); ctx.lineWidth = c.width; ctx.globalAlpha = .55; }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    // altre parti staccate del disegno (non incluse nell'area automatica)
    if (!S.area && S.parts && S.parts.others) {
      ctx.setLineDash([2, 4]); ctx.strokeStyle = cssVar('--plan-faint'); ctx.lineWidth = 1;
      for (const o of S.parts.others) ctx.strokeRect(sx(o.x0), sy(o.y1), (o.x1 - o.x0) * S.view.s, (o.y1 - o.y0) * S.view.s);
      ctx.setLineDash([]);
    }
    // area di calcolo
    if (a) {
      ctx.setLineDash([6, 5]); ctx.strokeStyle = cssVar('--muted'); ctx.lineWidth = 1;
      ctx.strokeRect(sx(a.x0), sy(a.y1), (a.x1 - a.x0) * S.view.s, (a.y1 - a.y0) * S.view.s); ctx.setLineDash([]);
    }
    if (drag && drag.kind === 'area') {
      const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1), y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
      ctx.fillStyle = 'rgba(11,110,122,.08)'; ctx.fillRect(sx(x0), sy(y1), (x1 - x0) * S.view.s, (y1 - y0) * S.view.s);
      ctx.strokeStyle = cssVar('--accent'); ctx.strokeRect(sx(x0), sy(y1), (x1 - x0) * S.view.s, (y1 - y0) * S.view.s);
    }
    // calibrazione
    if (calib.pts.length) {
      ctx.strokeStyle = cssVar('--accent'); ctx.fillStyle = cssVar('--accent'); ctx.lineWidth = 2;
      ctx.beginPath(); calib.pts.forEach(([x, y], i) => i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))); if (calib.hover && calib.pts.length === 1) ctx.lineTo(sx(calib.hover[0]), sy(calib.hover[1])); ctx.stroke();
      for (const [x, y] of calib.pts) { ctx.beginPath(); ctx.arc(sx(x), sy(y), 4, 0, 7); ctx.fill(); }
    }
    // AP
    for (const ap of S.aps) drawAp(ap);
    if (S.tool === 'add' && hoverW) {
      ctx.globalAlpha = .5; drawApShape(sx(hoverW[0]), sy(hoverW[1]), cssVar('--accent'), false); ctx.globalAlpha = 1;
    }
    drawScalebar();
  }

  function drawGrid() {
    const s = S.view.s; if (s < 4) return;
    const step = s > 40 ? 1 : s > 12 ? 5 : 10;
    ctx.strokeStyle = cssVar('--grid'); ctx.lineWidth = 1; ctx.beginPath();
    const x0 = Math.floor(wx(0) / step) * step, x1 = wx(CW), y0 = Math.floor(wy(CH) / step) * step, y1 = wy(0);
    for (let x = x0; x <= x1; x += step) { const X = Math.round(sx(x)) + .5; ctx.moveTo(X, 0); ctx.lineTo(X, CH); }
    for (let y = y0; y <= y1; y += step) { const Y = Math.round(sy(y)) + .5; ctx.moveTo(0, Y); ctx.lineTo(CW, Y); }
    ctx.stroke();
  }

  function drawApShape(X, Y, color, sel) {
    ctx.save(); ctx.translate(X, Y); ctx.scale(K, K); X = 0; Y = 0;
    ctx.beginPath(); ctx.arc(X, Y, sel ? 11 : 9, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = sel ? 3 : 2; ctx.strokeStyle = cssVar('--paper'); ctx.stroke();
    if (sel) { ctx.beginPath(); ctx.arc(X, Y, 15, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); }
    // icona onde
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(X, Y + 2.5, 4.2, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(X, Y + 2.5, 1.2, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  }
  function drawAp(ap) {
    const X = sx(ap.x), Y = sy(ap.y), sel = ap.id === S.selected;
    const m = modelOf(ap.model);
    if (m.beam < 360) {
      const r = 40, a0 = -(ap.az * Math.PI / 180);
      ctx.beginPath(); ctx.moveTo(X, Y); ctx.arc(X, Y, r, a0 - m.beam * Math.PI / 360, a0 + m.beam * Math.PI / 360); ctx.closePath();
      ctx.fillStyle = ap.color + '33'; ctx.fill(); ctx.strokeStyle = ap.color; ctx.lineWidth = 1; ctx.stroke();
    }
    drawApShape(X, Y, ap.color, sel);
    const p = apBandParams(ap, S.band);
    ctx.save(); ctx.translate(X, Y); ctx.scale(K, K);
    const label = ap.name, sub = p ? `${m.name} · ch ${S.band === '24' ? ap.ch24 : ap.ch5} · ${fmt(p.tx, p.tx % 1 ? 1 : 0)} dBm` : `${m.name} · banda off`;
    ctx.font = `600 12px ${cssVar('--sans')}`;
    const w1 = ctx.measureText(label).width; ctx.font = `11px ${cssVar('--mono')}`; const w2 = ctx.measureText(sub).width;
    const bw = Math.max(w1, w2) + 12, bx = 16, by = -18;
    ctx.fillStyle = cssVar('--panel'); ctx.globalAlpha = .9; roundRect(bx, by, bw, 34, 5); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = ap.color; ctx.lineWidth = 1; roundRect(bx, by, bw, 34, 5); ctx.stroke();
    ctx.fillStyle = cssVar('--ink'); ctx.font = `600 12px ${cssVar('--sans')}`; ctx.fillText(label, bx + 6, by + 14);
    ctx.fillStyle = p ? cssVar('--muted') : cssVar('--danger'); ctx.font = `11px ${cssVar('--mono')}`; ctx.fillText(sub, bx + 6, by + 28);
    ctx.restore();
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function drawScalebar() {
    const target = 110 / S.view.s;
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    const v = [1, 2, 5, 10].map(k => k * p).filter(x => x <= target).pop() || p;
    const sb = $('scalebar');
    sb.querySelector('i').style.width = (v * S.view.s) + 'px';
    sb.querySelector('span').textContent = v >= 1 ? `${fmt(v, 0)} m` : `${fmt(v * 100, 0)} cm`;
  }

  // ---------------- interazione ----------------
  let drag = null, hoverW = null;
  const calib = { active: false, pts: [], hover: null };
  const wallDraw = { pts: [], shift: false };
  function orthoSnap(a, b) {
    if (!wallDraw.shift) return b;
    return Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? [b[0], a[1]] : [a[0], b[1]];
  }
  function addDrawnWall(a, b) {
    const m = S.materials[S.wallMat]; if (!m) return;
    const k = S.unitToM, t = S.wallT;
    const layer = `Disegnati · ${m.name} ${String(t).replace('.', ',')} cm`;
    if (!S.layers[layer]) { S.layers[layer] = { mat: S.wallMat, tDefault: t / 100, on: true }; S.layerInfo[layer] = { count: 0, css: m.color }; }
    const sg = { x1: a[0] / k, y1: a[1] / k, x2: b[0] / k, y2: b[1] / k, layer, arc: null };
    S.raw.segs.push(sg); S.layerInfo[layer].count++;
    (S.drawn = S.drawn || []).push(sg);
    rebuildGeometry(false); render();
  }
  function undoDrawnWall() {
    const sg = (S.drawn || []).pop(); if (!sg) { toast('Nessun muro disegnato da annullare.'); return; }
    const i = S.raw.segs.lastIndexOf(sg); if (i >= 0) S.raw.segs.splice(i, 1);
    const li = S.layerInfo[sg.layer]; if (li && --li.count <= 0) { delete S.layerInfo[sg.layer]; delete S.layers[sg.layer]; }
    if (wallDraw.pts.length > 1) wallDraw.pts.pop();
    rebuildGeometry(false); render();
  }
  function evW(e) { const r = cv.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top; return [wx(px), wy(py), px, py]; }
  function hitAp(px, py) { for (let i = S.aps.length - 1; i >= 0; i--) { const a = S.aps[i]; if (Math.hypot(sx(a.x) - px, sy(a.y) - py) < 14) return a; } return null; }

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const [x, y, px, py] = evW(e);
    if (S.tool === 'add') { addAp(x, y, S.addModel); setTool('select'); render(); return; }
    if (S.tool === 'calib') {
      calib.pts.push([x, y]);
      if (calib.pts.length === 2) { const d = Math.hypot(calib.pts[1][0] - calib.pts[0][0], calib.pts[1][1] - calib.pts[0][1]); $('calibMeas').textContent = (S.bg ? fmt(d / S.unitToM * 25.4 / 72, 2) + ' mm su carta · ' : '') + fmt(d, 3) + ' m alla scala attuale'; $('calibApply').disabled = false; $('calibReal').focus(); setTool('select', true); }
      render(); return;
    }
    if (S.tool === 'area') { drag = { kind: 'area', x0: x, y0: y, x1: x, y1: y }; return; }
    if (S.tool === 'wall') {
      wallDraw.shift = e.shiftKey;
      let p = [x, y];
      if (wallDraw.pts.length) {
        const last = wallDraw.pts[wallDraw.pts.length - 1];
        p = orthoSnap(last, p);
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) * S.view.s < 4) { wallDraw.pts = []; render(); return; } // doppio clic: fine
        addDrawnWall(last, p);
      }
      wallDraw.pts.push(p); render(); return;
    }
    const ap = hitAp(px, py);
    if (ap) { S.selected = ap.id; drag = { kind: 'ap', ap, dx: ap.x - x, dy: ap.y - y, moved: false }; renderApPanel(); render(); return; }
    drag = { kind: 'pan', px, py, cx: S.view.cx, cy: S.view.cy };
  });
  cv.addEventListener('pointermove', (e) => {
    const [x, y, px, py] = evW(e);
    hoverW = [x, y];
    if (drag) {
      if (drag.kind === 'pan') { S.view.cx = drag.cx - (px - drag.px) / S.view.s; S.view.cy = drag.cy + (py - drag.py) / S.view.s; }
      else if (drag.kind === 'ap') { drag.ap.x = x + drag.dx; drag.ap.y = y + drag.dy; drag.moved = true; }
      else if (drag.kind === 'area') { drag.x1 = x; drag.y1 = y; }
      render();
    } else {
      if (S.tool === 'add') render();
      if (S.tool === 'wall') { wallDraw.shift = e.shiftKey; render(); }
      if (S.tool === 'calib' && calib.pts.length === 1) { calib.hover = [x, y]; render(); }
      cv.style.cursor = S.tool !== 'select' ? 'crosshair' : hitAp(px, py) ? 'grab' : 'default';
    }
    updateStatusbar(x, y);
  });
  cv.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.kind === 'ap' && drag.moved) { renderApPanel(); scheduleCompute(); }
    if (drag.kind === 'area') {
      const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1), y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
      if (x1 - x0 > 1 && y1 - y0 > 1) { S.area = { x0, y0, x1, y1 }; updateGrid(); scheduleCompute(); renderPlanPanel(); }
      setTool('select');
    }
    drag = null; render();
  });
  cv.addEventListener('dblclick', () => { if (S.tool === 'wall') { wallDraw.pts = []; render(); } });
  cv.addEventListener('pointerleave', () => { hoverW = null; if (S.tool === 'add') render(); });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y, px, py] = evW(e);
    zoomAt(px, py, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  function zoomAt(px, py, f) {
    const x = wx(px), y = wy(py);
    S.view.s = Math.min(Math.max(S.view.s * f, 0.2), 2000);
    S.view.cx = x - (px - CW / 2) / S.view.s; S.view.cy = y + (py - CH / 2) / S.view.s;
    render();
  }
  $('zIn').onclick = () => zoomAt(CW / 2, CH / 2, 1.4);
  $('zOut').onclick = () => zoomAt(CW / 2, CH / 2, 1 / 1.4);
  $('zFit').onclick = () => { fitView(); render(); };
  window.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected) { removeAp(S.selected); e.preventDefault(); }
    if (e.key === 'Escape') { setTool('select'); calib.pts = []; render(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && S.drawn && S.drawn.length) { undoDrawnWall(); e.preventDefault(); }
  });

  function setTool(t, keepCalib) {
    S.tool = t;
    const hint = $('toolHint');
    const msgs = { add: `Fai clic sulla pianta per posizionare: ${modelOf(S.addModel).name}. Esc per annullare.`, calib: 'Fai clic su due punti di distanza nota. Esc per annullare.', area: 'Trascina un rettangolo per l\'area di calcolo. Esc per annullare.', wall: 'Muri: clic su ogni vertice, doppio clic per staccare, Maiusc per linee orizzontali/verticali, Esc per finire, Ctrl+Z annulla.' };
    hint.hidden = !msgs[t]; hint.textContent = msgs[t] || '';
    if (t !== 'calib' && !keepCalib) calib.pts = [];
    if (t !== 'wall') wallDraw.pts = [];
    const bw = document.getElementById('btnWall'); if (bw) bw.classList.toggle('primary', t === 'wall');
    cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
  }

  function updateStatusbar(x, y) {
    const sb = $('statusbar');
    let html = `<span>x <b>${fmt(x, 2)}</b> m · y <b>${fmt(y, 2)}</b> m</span>`;
    const g = S.grid;
    if (g && composite) {
      const i = Math.floor((x - g.x0) / g.cs), j = Math.floor((y - g.y0) / g.cs);
      if (i >= 0 && j >= 0 && i < g.w && j < g.h) {
        const o = j * g.w + i;
        const arr = composite.fields.map(f => ({ ap: f.ap, v: f.f[o] })).sort((a, b) => b.v - a.v);
        if (arr.length) {
          html += `<span>Migliore: <b style="color:${arr[0].ap.color}">${esc(arr[0].ap.name)}</b> <b>${fmt(arr[0].v, 0)} dBm</b></span>`;
          html += '<span>' + arr.slice(1, 6).map(a => `${esc(a.ap.name)} ${fmt(a.v, 0)}`).join(' · ') + '</span>';
        }
      }
    }
    sb.innerHTML = html;
  }

  // ---------------- pannelli ----------------
  function renderPlanPanel() {
    const fi = $('fileInfo');
    if (!S.raw) { fi.innerHTML = '<dt>File</dt><dd>nessuno</dd>'; return; }
    const b = S.bboxM;
    fi.innerHTML = `<dt>File</dt><dd>${esc(S.fileName)}</dd><dt>Segmenti</dt><dd>${S.raw.segs.length.toLocaleString('it-IT')}</dd><dt>Layer</dt><dd>${Object.keys(S.layers).length}</dd>` +
      (b && isFinite(b.x0) ? `<dt>Ingombro ostacoli</dt><dd>${fmt(b.x1 - b.x0, 2)} × ${fmt(b.y1 - b.y0, 2)} m</dd>` : '');
    const isPdf = !!(S.pdf || S.bg);
    $('unitRow').hidden = isPdf; $('pdfBox').hidden = !isPdf;
    if (isPdf) {
      const denom = S.unitToM / PT_TO_M;
      if (document.activeElement !== $('pdfScale')) $('pdfScale').value = +denom.toFixed(2);
      const wmm = S.pdf && S.pdf.wmm ? S.pdf.wmm : S.bg.w * 25.4 / 72, hmm = S.pdf && S.pdf.hmm ? S.pdf.hmm : S.bg.h * 25.4 / 72;
      const aa = calcArea();
      $('sheetInfo').innerHTML = `<dt>Foglio (stampa)</dt><dd>${fmt(wmm, 1)} × ${fmt(hmm, 1)} mm${isoName(wmm, hmm)}</dd>` +
        `<dt>Reale a 1:${fmt(denom, denom % 1 ? 1 : 0)}</dt><dd>${fmt(wmm * denom / 1000, 2)} × ${fmt(hmm * denom / 1000, 2)} m</dd>` +
        (aa ? `<dt>Area di calcolo</dt><dd>${fmt((aa.x1 - aa.x0) / S.unitToM * 25.4 / 72, 1)} × ${fmt((aa.y1 - aa.y0) / S.unitToM * 25.4 / 72, 1)} mm → ${fmt(aa.x1 - aa.x0, 2)} × ${fmt(aa.y1 - aa.y0, 2)} m</dd>` : '') +
        `<dt>1 mm su carta</dt><dd>${fmt(denom / 1000, 3)} m reali</dd>`;
      const us = S.unitSource || '';
      const ts = S.pdf && S.pdf.textScale;
      const diff = ts ? Math.abs(denom - ts) / ts : 0;
      $('unitHint').innerHTML = esc(us.charAt(0).toUpperCase() + us.slice(1)) + '. ' +
        (diff > 0.02 ? `<b>Il cartiglio indica 1:${ts}, ma la misura dà 1:${fmt(denom, 1)} (${fmt(diff * 100, 1)}% di differenza): vale la misura.</b>` :
          'Verifica la scala misurando la scala grafica (0–10 m) o una quota con <b>Calibra con una misura nota</b>: se il PDF è stato ridimensionato in stampa, la scala scritta non corrisponde.');
      const pr = $('pdfPageRow'); pr.hidden = !(S.pdf && S.pdf.pages > 1);
      if (S.pdf && S.pdf.pages > 1) { $('pdfPage').innerHTML = Array.from({ length: S.pdf.pages }, (_, i) => `<option value="${i + 1}">Pagina ${i + 1}</option>`).join(''); $('pdfPage').value = S.pdf.page; }
      $('bgShow').checked = !!(S.bg && S.bg.show); $('bgOpacity').value = S.bg ? S.bg.opacity : 0.35;
    } else {
      const sel = $('unitSel');
      const known = Object.keys(UNIT_NAMES).find(k => Math.abs(+k - S.unitToM) < 1e-12);
      sel.value = known || 'custom';
      $('unitHint').textContent = known ? `Unità ${S.unitSource || ''}.` : `Scala calibrata: 1 unità = ${fmt(S.unitToM * 1000, 4)} mm.`;
    }
    const a = calcArea();
    $('areaInfo').innerHTML = a ? `<dt>Dimensioni</dt><dd>${fmt(a.x1 - a.x0, 1)} × ${fmt(a.y1 - a.y0, 1)} m</dd><dt>Tipo</dt><dd>${S.area ? 'disegnata' : 'automatica' + (S.parts && S.parts.parts > 1 ? ` (parte principale di ${S.parts.parts})` : '')}</dd>` + (S.grid ? `<dt>Griglia</dt><dd>${S.grid.w} × ${S.grid.h} celle da ${fmt(S.grid.cs * 100, 0)} cm</dd>` : '') : '';
  }

  function isoName(w, h) {
    const A = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297] };
    const a = Math.min(w, h), b = Math.max(w, h);
    for (const k in A) { if (Math.abs(a - A[k][0]) < 3 && Math.abs(b - A[k][1]) < 3) return ` (${k})`; if (Math.abs(a - A[k][0]) < 3 && b > A[k][1] + 3) return ` (${k} esteso)`; }
    return '';
  }

  function renderObstaclePanel() {
    $('detMin').value = +(S.det.minT * 100).toFixed(1); $('detMax').value = +(S.det.maxT * 100).toFixed(1);
    $('detAng').value = S.det.angTol; $('detSame').checked = S.det.sameLayer; $('detArcs').checked = S.det.ignoreDoorArcs;
    // istogramma spessori
    const hist = {}; const ob = S.ob;
    if (ob) for (let i = 0; i < ob.n; i++) if (ob.paired[i] === 1) { const k = Math.round(ob.wallT[i] * 100); hist[k] = (hist[k] || 0) + 1; }
    const keys = Object.keys(hist).map(Number).sort((a, b) => a - b);
    const top = keys.sort((a, b) => hist[b] - hist[a]).slice(0, 8).sort((a, b) => a - b);
    const mx = Math.max(1, ...top.map(k => hist[k]));
    $('thickHist').innerHTML = top.length ? top.map(k => `<div><span>${k} cm</span><i style="width:${hist[k] / mx * 100}%"></i><span>${hist[k]}</span></div>`).join('') + `<p class="hint">${ob.pairedCount} linee riconosciute come facce di muri su ${ob.n} ostacoli.</p>` : '<p class="hint">Nessuna coppia di linee parallele trovata: tutti gli ostacoli usano lo spessore di default del layer.</p>';
    // tabella layer
    const tb = $('layerTbl').querySelector('tbody');
    const names = Object.keys(S.layers).sort((a, b) => (S.layerInfo[b].count || 0) - (S.layerInfo[a].count || 0));
    const matOpts = Object.values(S.materials).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    tb.innerHTML = names.map((l, i) => `<tr data-l="${esc(l)}"><td><input type="checkbox" data-f="on" ${S.layers[l].on ? 'checked' : ''} aria-label="Attiva ${esc(l)}"></td>
      <td class="lname" title="${esc(l)} · ${S.layerInfo[l].count || 0} segmenti"><span class="sw" style="background:${S.layerInfo[l].css || aciColor(S.layerInfo[l].color)}"></span>${esc(l)}</td>
      <td><select data-f="mat" aria-label="Materiale ${esc(l)}">${matOpts}</select></td>
      <td><input type="number" data-f="t" min="0.5" max="100" step="0.5" value="${+(S.layers[l].tDefault * 100).toFixed(1)}" aria-label="Spessore ${esc(l)}"></td></tr>`).join('');
    tb.querySelectorAll('tr').forEach(tr => { tr.querySelector('select').value = S.layers[tr.dataset.l].mat; });
    // materiali
    const mt = $('matTbl').querySelector('tbody');
    mt.innerHTML = Object.values(S.materials).filter(m => m.id !== 'ignora' && m.id !== 'auto').map(m => `<tr data-m="${m.id}"><td><span class="sw" style="background:${m.color}"></span>${esc(m.name)}</td>
      <td><input type="number" step="0.5" data-k="b24.0" value="${m.b24[0]}"></td><td><input type="number" step="0.05" data-k="b24.1" value="${m.b24[1]}"></td>
      <td><input type="number" step="0.5" data-k="b5.0" value="${m.b5[0]}"></td><td><input type="number" step="0.05" data-k="b5.1" value="${m.b5[1]}"></td></tr>`).join('');
  }

  $('layerTbl').addEventListener('mouseover', (e) => { const tr = e.target.closest('tr[data-l]'); const l = tr ? tr.dataset.l : null; if (l !== S.hiLayer) { S.hiLayer = l; render(); } });
  $('layerTbl').addEventListener('mouseleave', () => { if (S.hiLayer) { S.hiLayer = null; render(); } });
  $('layerTbl').addEventListener('change', (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const L = S.layers[tr.dataset.l], f = e.target.dataset.f;
    if (f === 'on') L.on = e.target.checked;
    if (f === 'mat') L.mat = e.target.value;
    if (f === 't') L.tDefault = Math.max(0.005, (+e.target.value || 10) / 100);
    rebuildGeometry(false); render();
  });
  $('matTbl').addEventListener('change', (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const [b, i] = e.target.dataset.k.split('.');
    S.materials[tr.dataset.m][b][+i] = +e.target.value || 0;
    const save = {}; for (const id in S.materials) save[id] = { b24: S.materials[id].b24, b5: S.materials[id].b5 };
    store.set('materials', save);
    rebuildGeometry(false);
  });
  $('matReset').onclick = () => { store.set('materials', null); S.materials = loadMaterials(); rebuildGeometry(false); render(); };
  for (const [id, key, mul] of [['detMin', 'minT', 0.01], ['detMax', 'maxT', 0.01], ['detAng', 'angTol', 1]]) $(id).addEventListener('change', (e) => { const v = +e.target.value; if (v > 0) { S.det[key] = v * mul; rebuildGeometry(false); render(); } });
  $('detSame').onchange = (e) => { S.det.sameLayer = e.target.checked; rebuildGeometry(false); render(); };
  $('detArcs').onchange = (e) => { S.det.ignoreDoorArcs = e.target.checked; rebuildGeometry(false); render(); };

  // catalogo
  function renderCatalog() {
    const q = $('catSearch').value.trim().toLowerCase(), f = $('catFilter').value;
    const list = S.catalog.filter(m => (!q || m.name.toLowerCase().includes(q) || m.std.toLowerCase().includes(q)) &&
      (f === 'all' || (f === 'dual' && m.b24 && m.b5) || (f === '24' && m.b24) || (f === '5' && m.b5)));
    $('catList').innerHTML = list.map(m => `<button class="cat-item ${m.id === S.addModel ? 'on' : ''}" data-id="${m.id}">
      <b>${esc(m.name)}</b><span>${m.b24 ? '<span class="chip b24">2,4</span> ' : ''}${m.b5 ? '<span class="chip b5">5</span>' : ''}</span>
      <small>${esc(m.std)} · ${esc(m.cat)}${m.beam < 360 ? ' · ' + m.beam + '°' : ''}</small>
      <small>${m.b24 ? `${fmt(m.b24.g, 1)} dBi/${fmt(m.b24.tx, 1)} dBm` : ''}${m.b24 && m.b5 ? ' · ' : ''}${m.b5 ? `${fmt(m.b5.g, 1)} dBi/${fmt(m.b5.tx, 1)} dBm` : ''}</small></button>`).join('') || '<p class="hint" style="padding:10px">Nessun modello corrisponde alla ricerca.</p>';
    const m = modelOf(S.addModel);
    $('catNote').textContent = `${m.name}: montaggio ${m.mount.toLowerCase()}, antenna ${m.beam < 360 ? 'settoriale ' + m.beam + '°' : 'omnidirezionale'}.` + (m.note ? ` ${m.note}.` : '') + (m.est ? ` Nota: ${m.est}.` : '');
  }
  $('catList').addEventListener('click', (e) => { const b = e.target.closest('.cat-item'); if (!b) return; S.addModel = b.dataset.id; renderCatalog(); });
  $('catList').addEventListener('dblclick', (e) => { const b = e.target.closest('.cat-item'); if (!b) return; S.addModel = b.dataset.id; setTool('add'); });
  $('catSearch').oninput = renderCatalog; $('catFilter').onchange = renderCatalog;
  $('btnPlace').onclick = () => { if (!S.raw) { toast('Carica prima una pianta.'); return; } setTool('add'); };
  $('btnCustom').onclick = () => { $('customBox').hidden = !$('customBox').hidden; };
  $('cuAdd').onclick = () => {
    const nm = $('cuName').value.trim() || 'AP personalizzato';
    const b = (g, t) => ($(t).value === '' ? null : { g: +$(g).value || 0, tx: +$(t).value });
    const m = { id: 'custom_' + Date.now(), name: nm, std: 'Personalizzato', cat: 'Personalizzato', mount: 'n.d.', b24: b('cuG24', 'cuT24'), b5: b('cuG5', 'cuT5'), beam: Math.min(360, Math.max(10, +$('cuBeam').value || 360)) };
    if (!m.b24 && !m.b5) { toast('Indica la potenza di almeno una banda.'); return; }
    S.catalog.push(m); store.set('customAps', S.catalog.filter(x => x.id.startsWith('custom_')));
    S.addModel = m.id; renderCatalog(); $('customBox').hidden = true; toast(`${nm} aggiunto al catalogo.`);
  };

  function renderApPanel() {
    $('apList').innerHTML = S.aps.length ? S.aps.map(a => {
      const m = modelOf(a.model);
      return `<button class="ap-row ${a.id === S.selected ? 'on' : ''}" data-id="${a.id}"><span class="ap-dot" style="background:${a.color}"></span><span>${esc(a.name)} <small>${esc(m.name)}</small></span><small>${a.on24 && m.b24 ? '2,4 ' : ''}${a.on5 && m.b5 ? '5' : ''}</small></button>`;
    }).join('') : '<p class="hint">Nessun AP. Scegli un modello e premi “Posiziona sulla pianta”.</p>';
    const ap = S.aps.find(a => a.id === S.selected);
    const box = $('apEdit');
    if (!ap) { box.hidden = true; renderLegend(); return; }
    box.hidden = false;
    const m = modelOf(ap.model);
    const modelOpts = S.catalog.map(x => `<option value="${x.id}" ${x.id === ap.model ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const bandRow = (band) => {
      const spec = band === '24' ? m.b24 : m.b5; const lbl = band === '24' ? '2,4 GHz' : '5 GHz';
      if (!spec) return `<div class="row"><label>${lbl}</label><span class="hint">non supportata</span></div>`;
      const on = band === '24' ? ap.on24 : ap.on5, ch = band === '24' ? ap.ch24 : ap.ch5;
      const p = apBandParams(Object.assign({}, ap, band === '24' ? { on24: true } : { on5: true }), band);
      const chs = (band === '24' ? CH24 : CH5).map(c => `<option ${c === ch ? 'selected' : ''}>${c}</option>`).join('');
      const opts = txSteps(p.txMax).map(t => {
        const e = t + p.g, cap = e > p.lim;
        const sel = Math.abs(t - p.tx) < 0.05 ? 'selected' : '';
        return `<option value="${t}" ${sel}>${fmt(t, t % 1 ? 1 : 0)} dBm → EIRP ${fmt(Math.min(e, p.lim), 1)} dBm${cap ? ' (limite UE)' : ''}${t === p.txMax ? ' · max' : ''}</option>`;
      }).join('');
      return `<div class="row"><label><input type="checkbox" data-f="on${band}" ${on ? 'checked' : ''}> ${lbl}</label>
        <select data-f="ch${band}" aria-label="Canale ${lbl}">${chs}</select></div>
        <div class="row"><label>Potenza TX</label><select data-f="tx${band}" aria-label="Potenza TX ${lbl}">${opts}</select></div>
        <p class="hint">TX ${fmt(p.tx, 1)} dBm + antenna omni ${fmt(p.g, 1)} dBi = <b>EIRP ${fmt(p.eirpRaw, 1)} dBm</b>${p.capped ? ` → limitato a <b>${fmt(p.lim, 0)} dBm</b> dalla norma (${S.reg === 'etsi' ? 'ETSI' : ''} ch ${ch})` : ''}. Max modello su questo canale: ${fmt(p.txMax, 1)} dBm.</p>`;
    };
    box.innerHTML = `<div class="row"><span class="ap-dot" style="background:${ap.color}"></span><input type="text" data-f="name" value="${esc(ap.name)}" aria-label="Nome AP" style="flex:1"><input type="color" data-f="color" value="${ap.color}" aria-label="Colore"></div>
      <div class="row"><label>Modello</label><select data-f="model">${modelOpts}</select></div>
      ${m.est ? `<p class="hint">${esc(m.est)}.</p>` : ''}${m.note ? `<p class="hint">${esc(m.note)}.</p>` : ''}
      ${bandRow('24')}${bandRow('5')}
      ${m.beam < 360 ? `<div class="row"><label>Orientamento (°)</label><input type="number" data-f="az" value="${ap.az}" step="5"></div>` : ''}
      <div class="row"><label>Posizione (m)</label><input type="number" data-f="x" value="${ap.x.toFixed(2)}" step="0.1" aria-label="X"><input type="number" data-f="y" value="${ap.y.toFixed(2)}" step="0.1" aria-label="Y"></div>
      <div class="row"><button class="btn danger" id="apDel">Elimina AP</button></div>`;
    $('apDel').onclick = () => removeAp(ap.id);
    renderLegend();
  }
  $('apList').addEventListener('click', (e) => { const b = e.target.closest('.ap-row'); if (!b) return; S.selected = b.dataset.id; renderApPanel(); render(); });
  $('apEdit').addEventListener('change', (e) => {
    const ap = S.aps.find(a => a.id === S.selected); if (!ap) return;
    const f = e.target.dataset.f, v = e.target.value;
    if (f === 'name') ap.name = v || ap.name;
    else if (f === 'color') ap.color = v;
    else if (f === 'model') { ap.model = v; const m = modelOf(v); ap.on24 = !!m.b24; ap.on5 = !!m.b5; ap.tx24 = ap.tx5 = null; }
    else if (f === 'on24' || f === 'on5') ap[f] = e.target.checked;
    else if (f === 'ch24' || f === 'ch5') ap[f] = +v;
    else if (f === 'tx24' || f === 'tx5') { const band = f.slice(2), p = apBandParams(Object.assign({}, ap, { on24: true, on5: true }), band); ap[f] = Math.abs(+v - p.txMax) < 0.05 ? null : +v; }
    else if (f === 'az') ap.az = +v || 0;
    else if (f === 'x' || f === 'y') ap[f] = +v;
    renderApPanel(); rebuildComposite(); render(); scheduleCompute();
  });

  function renderLegend() {
    const lg = $('legend');
    const band = S.band === '24' ? '2,4 GHz' : '5 GHz';
    const titles = { server: 'Provenienza del segnale', areas: 'Area coperta da ogni AP', heat: 'Livello di segnale', sinr: 'SINR co-canale' };
    let h = `<h4>${titles[S.mode]} · ${band}</h4>`;
    if (S.mode === 'server' || S.mode === 'areas') {
      const st = composite && composite.stats;
      const idx = new Map(composite ? composite.fields.map((f, k) => [f.ap.id, k]) : []);
      h += S.aps.map(ap => {
        const p = apBandParams(ap, S.band); const k = idx.get(ap.id);
        const pct = st && k != null ? fmt(st.cnt[k] / st.N * 100, 0) + '%' : '';
        return `<div class="lg-row"><span class="lg-sw" style="background:${ap.color}"></span><span>${esc(ap.name)} · ${esc(modelOf(ap.model).name)}${p ? ` · ch ${S.band === '24' ? ap.ch24 : ap.ch5}` : ''}</span><span title="TX + guadagno antenna = EIRP">${p ? `${fmt(p.tx, p.tx % 1 ? 1 : 0)}+${fmt(p.g, 1)} → ${fmt(p.eirp, 1)}` : 'off'}${S.mode === 'server' && pct ? ' · ' + pct : ''}</span></div>`;
      }).join('') || '<span class="hint">Nessun AP posizionato.</span>';
      h += `<span class="hint">Valori: TX + guadagno antenna → EIRP (dBm).</span>`;
      h += `<span class="hint">Linea colorata: confine dell'area servita${S.mode === 'areas' ? ' da ogni AP' : ''} con segnale ≥ ${fmt(S.thr, 0)} dBm.</span>`;
    } else if (S.mode === 'heat') {
      const lab = ['≥ −50', '−50 … −60', '−60 … −67', '−67 … −70', '−70 … −75', '−75 … −80', '−80 … −85'];
      h += HEAT.map(([t, c], i) => `<div class="lg-row"><span class="lg-sw" style="background:${c}"></span><span>${lab[i]}</span><span>dBm</span></div>`).join('');
    } else {
      const lab = ['≥ 25', '20 … 25', '15 … 20', '10 … 15', '5 … 10', '0 … 5', '< 0'];
      h += SINR.map(([t, c], i) => `<div class="lg-row"><span class="lg-sw" style="background:${c}"></span><span>${lab[i]}</span><span>dB</span></div>`).join('');
      h += '<span class="hint">Rapporto tra AP migliore e AP sullo stesso canale più rumore (−95 dBm).</span>';
    }
    lg.innerHTML = h;
  }

  function renderStats() {
    const st = composite && composite.stats;
    if (!st) { $('stats').innerHTML = ''; return; }
    $('stats').innerHTML = `<dt>Copertura ≥ ${fmt(S.thr, 0)} dBm</dt><dd>${fmt(st.cov * 100, 1)}% dell'area</dd><dt>Con 2+ AP sopra soglia</dt><dd>${fmt(st.over2 * 100, 1)}%</dd><dt>AP calcolati</dt><dd>${composite.fields.length}</dd>`;
  }

  // ---------------- controlli globali ----------------
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.pane').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
    store.set('tab', b.dataset.tab);
  });
  $('bandSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.band = b.dataset.band; syncSeg(); rebuildComposite(); render(); });
  $('modeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.mode = b.dataset.mode; syncSeg(); rebuildComposite(); render(); });
  function syncSeg() {
    document.querySelectorAll('#bandSeg button').forEach(b => b.classList.toggle('on', b.dataset.band === S.band));
    document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
    const hints = {
      server: 'Ogni area ha il colore dell\'AP che vi arriva più forte; la linea colorata delimita la zona servita da ciascun AP.',
      areas: 'Ogni AP disegna la propria area di copertura sopra soglia, con il suo contorno: le sovrapposizioni mostrano dove arrivano più segnali.',
      heat: 'Intensità del segnale migliore in dBm, con isolinee ai livelli della legenda.',
      sinr: 'Qualità in presenza di AP sullo stesso canale. Cambia i canali degli AP per ridurre l\'interferenza.',
    };
    $('modeHint').textContent = hints[S.mode];
  }
  $('thr').oninput = (e) => { S.thr = +e.target.value; $('thrVal').textContent = fmt(S.thr, 0) + ' dBm'; clearTimeout($('thr')._t); $('thr')._t = setTimeout(() => { rebuildComposite(); render(); }, 60); };
  $('shade').onchange = (e) => { S.shade = e.target.checked; rebuildComposite(); render(); };
  $('smooth').onchange = (e) => { S.smooth = e.target.checked; rebuildComposite(); render(); };
  for (const [id, key] of [['pn', 'n'], ['hAp', 'hAp'], ['hCli', 'hCli'], ['margin', 'margin']]) $(id).addEventListener('change', (e) => { S[key] = +e.target.value; scheduleCompute(); });
  $('reg').innerHTML = Object.entries(REG_LIMITS).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
  $('txAll').onchange = (e) => {
    const v = e.target.value;
    for (const ap of S.aps) { ap.tx24 = v === 'max' ? null : +v; ap.tx5 = v === 'max' ? null : +v; }
    e.target.value = '';
    renderApPanel(); render(); scheduleCompute();
    toast(v === 'max' ? 'Tutti gli AP alla potenza massima del modello.' : `Potenza TX ${v} dBm su tutti gli AP (limitata al massimo di ogni modello).`);
  };
  $('txAll').innerHTML = '<option value="">Scegli…</option><option value="max">Massima del modello</option>' + Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}">${i + 1} dBm</option>`).join('');
  $('reg').onchange = (e) => { S.reg = e.target.value; renderApPanel(); render(); scheduleCompute(); };
  $('res').onchange = (e) => { S.res = +e.target.value; updateGrid(); renderPlanPanel(); scheduleCompute(); };
  $('showTexts').onchange = (e) => { S.showTexts = e.target.checked; render(); };
  $('wallColor').onchange = (e) => { S.wallColor = e.target.value; render(); };
  $('unitSel').onchange = (e) => { if (e.target.value !== 'custom') rescale(+e.target.value, 'impostata manualmente'); };
  $('pdfScale').onchange = (e) => { if (!S.bg && !S.pdf) return; const v = +String(e.target.value).replace(',', '.'); if (v > 0) rescale(v * PT_TO_M, `scala 1:${fmt(v, v % 1 ? 1 : 0)} impostata manualmente`); };
  $('pdfPage').onchange = (e) => { if (S.pdf) loadPdfPage(+e.target.value); };
  $('bgShow').onchange = (e) => { if (S.bg) { S.bg.show = e.target.checked; render(); } };
  $('bgOpacity').oninput = (e) => { if (S.bg) { S.bg.opacity = +e.target.value; render(); } };
  // muri disegnati a mano
  $('wallMat').innerHTML = Object.values(S.materials).filter(m => m.id !== 'ignora' && m.id !== 'auto').map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  $('wallMat').value = S.wallMat; $('wallT').value = S.wallT;
  $('wallMat').onchange = (e) => { S.wallMat = e.target.value; };
  $('wallT').onchange = (e) => { S.wallT = Math.max(1, +e.target.value || 12); };
  $('btnWall').onclick = () => { if (!S.raw) { toast('Carica prima una pianta.'); return; } setTool(S.tool === 'wall' ? 'select' : 'wall'); };
  $('btnWallUndo').onclick = () => undoDrawnWall();
  $('btnCalib').onclick = () => { if (!S.raw) return; calib.pts = []; $('calibBox').hidden = false; $('calibApply').disabled = true; $('calibMeas').textContent = '–'; setTool('calib'); };
  $('calibCancel').onclick = () => { calib.pts = []; $('calibBox').hidden = true; setTool('select'); render(); };
  $('calibApply').onclick = () => {
    const real = +$('calibReal').value; if (calib.pts.length < 2 || !(real > 0)) { toast('Inserisci la distanza reale in metri.'); return; }
    const d = Math.hypot(calib.pts[1][0] - calib.pts[0][0], calib.pts[1][1] - calib.pts[0][1]);
    calib.pts = []; $('calibBox').hidden = true;
    const nu = S.unitToM * real / d;
    if (S.bg) { const den = nu / PT_TO_M; rescale(nu, `scala 1:${fmt(den, 1)} calcolata da una misura nota (${fmt(d / S.unitToM * 25.4 / 72, 2)} mm su carta = ${fmt(real, 2)} m)`); toast(`Scala calcolata: 1:${fmt(den, 1)}.`, 6000); }
    else { rescale(nu, 'calibrata con una misura nota'); toast('Scala aggiornata.'); }
  };
  $('btnArea').onclick = () => { if (S.raw) setTool('area'); };
  $('btnAreaReset').onclick = () => { S.area = null; updateGrid(); renderPlanPanel(); scheduleCompute(); render(); };

  // file
  $('btnOpen').onclick = () => $('fileDxf').click();
  $('drop').onclick = () => $('fileDxf').click();
  $('fileDxf').onchange = (e) => { readFile(e.target.files[0]); e.target.value = ''; };
  const stage = $('stage');
  for (const el of [stage, $('drop')]) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); $('drop').classList.add('over'); });
    el.addEventListener('dragleave', () => $('drop').classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); $('drop').classList.remove('over');
      const f = e.dataTransfer.files[0]; if (!f) return;
      if (/\.(json|wifimap)$/i.test(f.name)) loadProjectFile(f); else readFile(f);
    });
  }
  $('btnDemo').onclick = () => loadDemo();

  function loadDemo() {
    S.pdf = null; S.bg = null;
    loadDxfText(buildDemoDXF(), 'esempio_ufficio.dxf');
    addAp(7.5, 4.2, 'cap_ax'); addAp(24, 4.2, 'cap_ax'); addAp(21.5, 14, 'cap_xl_ac'); addAp(3, 14.5, 'hap_ax2');
    S.selected = null; renderApPanel(); render();
  }

  // ---------------- salvataggio / esportazione ----------------
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    toast(`Scaricato ${name}`);
  }
  const baseName = () => (S.fileName || 'progetto').replace(/\.[^.]+$/, '');

  $('btnSave').onclick = () => {
    if (!S.raw) { toast('Niente da salvare: carica una pianta.'); return; }
    const r = (v) => Math.round(v * 1e4) / 1e4;
    const proj = {
      app: 'wifimap', version: 1, fileName: S.fileName, unitToM: S.unitToM, unitSource: S.unitSource,
      raw: { segs: S.raw.segs.map(s => [r(s.x1), r(s.y1), r(s.x2), r(s.y2), s.layer, s.arc]), texts: S.raw.texts },
      layerInfo: S.layerInfo, layers: S.layers, det: S.det, area: S.area, aps: S.aps, nextAp: S.nextAp,
      bg: S.bg ? { w: S.bg.w, h: S.bg.h, show: S.bg.show, opacity: S.bg.opacity, img: (S.bg.canvas.toDataURL ? S.bg.canvas.toDataURL('image/jpeg', 0.82) : S.bg.src) } : null,
      pdf: S.pdf ? { name: S.pdf.name, page: S.pdf.page, pages: 1 } : null,
      settings: { band: S.band, mode: S.mode, thr: S.thr, res: S.res, n: S.n, hAp: S.hAp, hCli: S.hCli, margin: S.margin, reg: S.reg, shade: S.shade, smooth: S.smooth },
      customAps: S.catalog.filter(x => x.id.startsWith('custom_')),
      materials: Object.fromEntries(Object.entries(S.materials).map(([k, m]) => [k, { b24: m.b24, b5: m.b5 }])),
    };
    download(baseName() + '.wifimap.json', JSON.stringify(proj), 'application/json');
  };
  $('btnLoad').onclick = () => $('fileProj').click();
  $('fileProj').onchange = (e) => { loadProjectFile(e.target.files[0]); e.target.value = ''; };
  function loadProjectFile(f) {
    if (!f) return;
    f.text().then(txt => {
      let p; try { p = JSON.parse(txt); } catch (e) { toast('File di progetto non valido.'); return; }
      if (p.app !== 'wifimap') { toast('Il file non è un progetto WiFi Coverage.'); return; }
      S.fileName = p.fileName; S.unitToM = p.unitToM; S.unitSource = p.unitSource || '';
      S.raw = { segs: p.raw.segs.map(a => ({ x1: a[0], y1: a[1], x2: a[2], y2: a[3], layer: a[4], arc: a[5] })), texts: p.raw.texts || [] };
      S.layerInfo = p.layerInfo; S.layers = p.layers; Object.assign(S.det, p.det); S.area = p.area;
      for (const c of p.customAps || []) if (!S.catalog.find(x => x.id === c.id)) S.catalog.push(c);
      if (p.materials) for (const k in p.materials) if (S.materials[k]) { S.materials[k].b24 = p.materials[k].b24; S.materials[k].b5 = p.materials[k].b5; }
      S.aps = p.aps || []; S.nextAp = p.nextAp || S.aps.length + 1; S.selected = null;
      S.pdf = null; S.bg = null; S.drawn = [];
      if (p.bg && p.bg.img) {
        const img = new Image(); img.src = p.bg.img;
        S.bg = { canvas: img, src: p.bg.img, w: p.bg.w, h: p.bg.h, show: p.bg.show, opacity: p.bg.opacity };
        img.onload = () => render();
        S.pdf = p.pdf ? { name: p.pdf.name, page: 1, pages: 1, doc: null } : null;
      }
      Object.assign(S, p.settings || {}); if (!REG_LIMITS[S.reg]) S.reg = 'etsi';
      syncControls(); rebuildGeometry(false); fitView(); renderApPanel(); render();
      toast(`Progetto ${f.name} aperto.`);
    });
  }

  const MODE_TITLES = { server: 'Provenienza del segnale', areas: 'Area coperta da ogni AP', heat: 'Livello di segnale', sinr: 'SINR co-canale' };

  // rende la mappa corrente (con didascalia e legenda AP) su una tela fuori schermo, senza scaricarla
  function renderMapCanvas(W = 2400, caption = true) {
    const a = calcArea();
    const sc = W / (a.x1 - a.x0), H = Math.round((a.y1 - a.y0) * sc);
    const cap = caption ? 70 : 0;
    const saved = { view: Object.assign({}, S.view), CW, CH, dpr };
    const off = document.createElement('canvas'); off.width = W; off.height = H + cap;
    const octx = off.getContext('2d');
    S.view = { cx: (a.x0 + a.x1) / 2, cy: (a.y0 + a.y1) / 2, s: sc }; CW = W; CH = H; dpr = 1; K = 2;
    drawTo(octx, () => render());
    S.view = saved.view; CW = saved.CW; CH = saved.CH; dpr = saved.dpr; K = 1;
    if (caption) {
      octx.fillStyle = cssVar('--panel'); octx.fillRect(0, H, W, cap);
      octx.fillStyle = cssVar('--ink'); octx.font = `600 22px ${cssVar('--sans')}`;
      octx.fillText(`${S.fileName} · ${MODE_TITLES[S.mode]} · ${S.band === '24' ? '2,4' : '5'} GHz · soglia ${S.thr} dBm`, 20, H + 30);
      octx.font = `16px ${cssVar('--mono')}`; let x = 20;
      for (const ap of S.aps) { const t = `${ap.name} ${modelOf(ap.model).name}`; octx.fillStyle = ap.color; octx.fillRect(x, H + 45, 14, 14); octx.fillStyle = cssVar('--ink'); octx.fillText(t, x + 20, H + 58); x += octx.measureText(t).width + 44; }
    }
    render();
    return { canvas: off, W, H: H + cap };
  }

  $('btnPng').onclick = () => {
    if (!S.grid) return;
    const { canvas: off } = renderMapCanvas(2400, true);
    off.toBlob(b => download(`${baseName()}_${S.mode}_${S.band === '24' ? '2g4' : '5g'}.png`, b));
  };
  function drawTo(c2, fn) { const keep = ctx; ctx = c2; try { fn(); } finally { ctx = keep; } }

  $('btnDxfOut').onclick = () => {
    if (!composite) { toast('Nessuna mappa calcolata.'); return; }
    const k = 1 / S.unitToM;
    const ACIS = [[1, [255, 0, 0]], [2, [255, 255, 0]], [3, [0, 255, 0]], [4, [0, 255, 255]], [5, [0, 0, 255]], [6, [255, 0, 255]], [30, [255, 127, 0]], [140, [0, 127, 255]], [200, [127, 0, 255]], [34, [127, 63, 0]], [92, [63, 127, 0]], [12, [165, 0, 0]]];
    const aciOf = (hex) => { const c = hexRgb(hex); let best = 7, bd = 1e9; for (const [i, r] of ACIS) { const d = (r[0] - c[0]) ** 2 + (r[1] - c[1]) ** 2 + (r[2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } } return best; };
    const bandTag = S.band === '24' ? '2G4' : '5G';
    const layers = new Map();
    const ents = [];
    const lname = (s) => ('WIFI_' + bandTag + '_' + s).replace(/[<>\/\\":;?*|=,]/g, '_').slice(0, 60);
    for (const c of composite.contours) {
      const L = lname(c.ap ? c.ap.name : ('ISO_' + Math.abs(c.level)));
      layers.set(L, c.ap ? aciOf(c.ap.color) : 8);
      for (const l of c.lines) {
        if (l.length < 2) continue;
        ents.push(`0\nPOLYLINE\n8\n${L}\n66\n1\n70\n0\n10\n0\n20\n0\n30\n0`);
        for (const [x, y] of l) ents.push(`0\nVERTEX\n8\n${L}\n10\n${(x * k).toFixed(4)}\n20\n${(y * k).toFixed(4)}\n30\n0`);
        ents.push(`0\nSEQEND\n8\n${L}`);
      }
    }
    const La = 'WIFI_AP';
    layers.set(La, 1);
    for (const ap of S.aps) {
      const p = apBandParams(ap, S.band);
      ents.push(`0\nCIRCLE\n8\n${La}\n62\n${aciOf(ap.color)}\n10\n${(ap.x * k).toFixed(4)}\n20\n${(ap.y * k).toFixed(4)}\n30\n0\n40\n${(0.25 * k).toFixed(4)}`);
      ents.push(`0\nTEXT\n8\n${La}\n10\n${((ap.x + 0.4) * k).toFixed(4)}\n20\n${((ap.y + 0.1) * k).toFixed(4)}\n30\n0\n40\n${(0.3 * k).toFixed(4)}\n1\n${ap.name} ${modelOf(ap.model).name}${p ? ' ch' + (S.band === '24' ? ap.ch24 : ap.ch5) + ' ' + p.eirp.toFixed(0) + 'dBm' : ''}`);
    }
    const iu = { 0.001: 4, 0.01: 5, 1: 6, 0.0254: 1, 0.3048: 2, 0.1: 14 }[S.unitToM] || 0;
    const out = `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n${iu}\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n${layers.size}\n` +
      [...layers].map(([n, c]) => `0\nLAYER\n2\n${n}\n70\n0\n62\n${c}\n6\nCONTINUOUS`).join('\n') + `\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n` + ents.join('\n') + `\n0\nENDSEC\n0\nEOF\n`;
    download(`${baseName()}_copertura_${bandTag}.dxf`, out.replace(/\n/g, '\r\n'), 'application/dxf');
  };

  // ---------------- report PDF ----------------
  function pdfEnsure(doc, y, need) { if (y + need > 283) { doc.addPage(); return 20; } return y; }
  function pdfSection(doc, x, y, title) {
    y = pdfEnsure(doc, y, 12);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(30, 41, 59);
    doc.text(title, x, y);
    doc.setDrawColor(196, 205, 213); doc.setLineWidth(0.3); doc.line(x, y + 1.8, x + 182, y + 1.8);
    doc.setTextColor(20);
    return y + 7.5;
  }
  function pdfPara(doc, x, y, w, text, fs = 9) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(fs); doc.setTextColor(60);
    const lines = doc.splitTextToSize(text, w);
    y = pdfEnsure(doc, y, lines.length * 4.2 + 2);
    doc.text(lines, x, y);
    doc.setTextColor(20);
    return y + lines.length * 4.2 + 2;
  }
  function pdfKV(doc, x, y, w, rows) {
    const half = w / 2, valW = half - 4;
    for (let i = 0; i < rows.length; i += 2) {
      const cellLines = []; let maxLines = 1;
      for (let c = 0; c < 2; c++) {
        const r = rows[i + c];
        if (!r) { cellLines.push(null); continue; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
        const lines = doc.splitTextToSize(String(r[1]), valW);
        cellLines.push(lines); maxLines = Math.max(maxLines, lines.length);
      }
      const rowH = 4.6 + maxLines * 4.2 + 2;
      y = pdfEnsure(doc, y, rowH);
      for (let c = 0; c < 2; c++) {
        const r = rows[i + c]; if (!r) continue;
        const cx = x + c * half;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); doc.setTextColor(120);
        doc.text(r[0], cx, y);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(25);
        doc.text(cellLines[c], cx, y + 4.6);
      }
      y += rowH;
    }
    doc.setTextColor(20);
    return y;
  }
  function pdfTable(doc, x, y, colW, headers, rows, note) {
    const totalW = colW.reduce((a, b) => a + b, 0), lineH = 3.5;
    function rowH(cells) {
      let h = 5;
      for (let i = 0; i < cells.length; i++) { const l = doc.splitTextToSize(String(cells[i] ?? ''), colW[i] - 3); h = Math.max(h, l.length * lineH + 2.8); }
      return h;
    }
    function draw(cells, bold, fill) {
      const h = rowH(cells);
      if (fill) { doc.setFillColor(fill[0], fill[1], fill[2]); doc.rect(x, y - 3.6, totalW, h, 'F'); }
      let cx = x;
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8.3); doc.setTextColor(bold ? 25 : 55);
      for (let i = 0; i < cells.length; i++) { doc.text(doc.splitTextToSize(String(cells[i] ?? ''), colW[i] - 3), cx + 1.5, y); cx += colW[i]; }
      doc.setDrawColor(228); doc.setLineWidth(0.15); doc.line(x, y + h - 3.4, x + totalW, y + h - 3.4);
      y += h;
    }
    const hfill = [240, 244, 248];
    draw(headers, true, hfill);
    for (const r of rows) {
      const h = rowH(r);
      if (y + h > 283) { doc.addPage(); y = 20; draw(headers, true, hfill); }
      draw(r, false, null);
    }
    y += 3;
    if (note) y = pdfPara(doc, x, y, totalW, note, 7.6);
    doc.setTextColor(20);
    return y;
  }

  // disegna mappa + sintesi + elenco AP per UNA banda (usata sia dal report singolo che, due volte, da quello combinato)
  function pdfBandBlock(doc, mx, cw, y, band) {
    const bandLbl = band === '24' ? '2,4 GHz' : '5 GHz';
    S.band = band; rebuildComposite();
    y = pdfSection(doc, mx, y, `Mappa di copertura · ${bandLbl}`);
    const { canvas: mapCv } = renderMapCanvas(1500, true);
    const imgW = cw, imgH = imgW * mapCv.height / mapCv.width;
    y = pdfEnsure(doc, y, imgH);
    doc.addImage(mapCv.toDataURL('image/jpeg', 0.86), 'JPEG', mx, y, imgW, imgH);
    doc.setDrawColor(210); doc.setLineWidth(0.2); doc.rect(mx, y, imgW, imgH);
    y += imgH + 6;

    const st = composite.stats;
    const a = calcArea();
    const areaM2 = a ? (a.x1 - a.x0) * (a.y1 - a.y0) : null;
    y = pdfKV(doc, mx, y, cw, [
      ['Mappa visualizzata', MODE_TITLES[S.mode] + ' · ' + bandLbl],
      ['Soglia di riferimento', fmt(S.thr, 0) + ' dBm'],
      ['Copertura ≥ soglia', fmt(st.cov * 100, 1) + '% dell’area di calcolo'],
      ['Area con 2 o più AP sopra soglia', fmt(st.over2 * 100, 1) + '%'],
      ['AP attivi in banda ' + bandLbl, `${composite.fields.length} di ${S.aps.length} totali in progetto`],
      ['Area di calcolo', areaM2 != null ? `${fmt(a.x1 - a.x0, 1)} × ${fmt(a.y1 - a.y0, 1)} m ≈ ${fmt(areaM2, 0)} m²` : '–'],
    ]);
    y += 3;

    y = pdfSection(doc, mx, y, `Access point in banda ${bandLbl}`);
    const apRows = [];
    for (const ap of S.aps) {
      const p = apBandParams(ap, band); if (!p) continue;
      const m = modelOf(ap.model), ch = band === '24' ? ap.ch24 : ap.ch5;
      apRows.push([
        ap.name, m.name, String(ch), (p.f / 1000).toFixed(3).replace('.', ',') + ' GHz',
        fmt(p.tx, p.tx % 1 ? 1 : 0), fmt(p.g, 1), fmt(p.eirp, 1) + (p.capped ? ' *' : ''), `${fmt(ap.x, 1)}, ${fmt(ap.y, 1)}`,
      ]);
    }
    if (apRows.length) {
      y = pdfTable(doc, mx, y, [18, 34, 16, 22, 16, 18, 20, 26], ['AP', 'Modello', 'Canale', 'Frequenza', 'TX dBm', 'Guad. dBi', 'EIRP dBm', 'Pos. X,Y (m)'], apRows,
        `* EIRP limitato dal regolamento selezionato (${(REG_LIMITS[S.reg] || REG_LIMITS.etsi).name}). EIRP = potenza TX + guadagno antenna, con antenna omnidirezionale salvo indicazione diversa nel modello.`);
    } else {
      y = pdfPara(doc, mx, y, cw, `Nessun access point attivo in banda ${bandLbl}.`);
    }
    return y + 3;
  }

  $('btnReport').onclick = () => {
    if (!S.grid) { toast('Calcola prima la mappa di copertura.'); return; }
    if (!(window.jspdf && window.jspdf.jsPDF)) { toast('Libreria PDF non disponibile.'); return; }
    const scope = $('reportScope') ? $('reportScope').value : 'cur';
    const bands = scope === 'both' ? ['24', '5'] : [S.band];
    const origBand = S.band;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    // i font base di jsPDF non hanno alcuni simboli unicode: li sostituiamo con equivalenti ASCII
    const PDF_REPL = { '≥': '>=', '≤': '<=', '≈': '~', '−': '-', '–': '-' };
    const pdfClean = (s) => typeof s === 'string' ? s.replace(/[≥≤≈−–]/g, (c) => PDF_REPL[c]) : s;
    const _text = doc.text.bind(doc), _split = doc.splitTextToSize.bind(doc);
    doc.text = (txt, x, yy, opt) => _text(Array.isArray(txt) ? txt.map(pdfClean) : pdfClean(txt), x, yy, opt);
    doc.splitTextToSize = (txt, w, opt) => _split(pdfClean(txt), w, opt);
    const mx = 14, cw = 182;
    let y = 18;
    const now = new Date();
    const titleBand = scope === 'both' ? '2,4 e 5 GHz' : (S.band === '24' ? '2,4 GHz' : '5 GHz');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(20);
    doc.text(`Report di copertura WiFi · ${titleBand}`, mx, y); y += 6.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(110);
    doc.text(`${S.fileName || 'progetto'}  ·  generato il ${now.toLocaleDateString('it-IT')} alle ${now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`, mx, y);
    doc.setTextColor(20); y += 7;

    for (const band of bands) {
      y = pdfBandBlock(doc, mx, cw, y, band);
      if (bands.length > 1 && band !== bands[bands.length - 1]) { doc.addPage(); y = 20; }
    }

    // ripristina lo stato originale della mappa a schermo
    S.band = origBand; rebuildComposite(); render();

    // parametri di calcolo (comuni a entrambe le bande)
    y = pdfSection(doc, mx, y, 'Parametri del modello di calcolo');
    y = pdfKV(doc, mx, y, cw, [
      ['Esponente di perdita di percorso (n)', fmt(S.n, 2)],
      ['Altezza AP / client', `${fmt(S.hAp, 1)} m / ${fmt(S.hCli, 1)} m`],
      ['Margine aggiuntivo', fmt(S.margin, 1) + ' dB'],
      ['Limite normativo EIRP', (REG_LIMITS[S.reg] || REG_LIMITS.etsi).name],
      ['Risoluzione griglia di calcolo', S.res + ' celle sul lato maggiore'],
      ['Ombre morbide (diffrazione bordi)', S.smooth ? 'attiva' : 'disattiva'],
      ['Scala / unità del disegno', `${UNIT_NAMES[S.unitToM] || S.unitToM} (${S.unitSource || 'non specificata'})`],
      ['File di origine', S.fileName || '–'],
    ]);
    y += 2;

    // materiali e ostacoli
    const matUse = new Map();
    for (const [lname, lc] of Object.entries(S.layers)) {
      if (!lc || !lc.on || lc.mat === 'ignora') continue;
      const mid = lc.mat === 'auto' ? 'auto' : lc.mat;
      const g = matUse.get(mid) || { layers: [] }; g.layers.push(lname); matUse.set(mid, g);
    }
    if (matUse.size) {
      y = pdfSection(doc, mx, y, 'Ostacoli e materiali usati');
      const matRows = [...matUse].map(([mid, g]) => {
        const mat = S.materials[mid] || S.materials.auto;
        const att = (b) => mid === 'auto' ? 'da spessore rilevato' : `${fmt(mat[b][0], 1)} dB + ${fmt(mat[b][1], 2)} dB/cm`;
        return [mat.name, g.layers.length > 4 ? g.layers.slice(0, 4).join(', ') + ` (+${g.layers.length - 4})` : g.layers.join(', '), att('b24'), att('b5')];
      });
      y = pdfTable(doc, mx, y, [40, 62, 40, 40], ['Materiale', 'Layer del disegno', 'Attenuazione 2,4 GHz', 'Attenuazione 5 GHz'], matRows,
        'Attenuazione per attraversamento = base + (dB/cm) × spessore muro, aumentata fino a ×3 per incidenza obliqua.');
    }

    // note
    y = pdfSection(doc, mx, y, 'Note');
    y = pdfPara(doc, mx, y, cw, 'I risultati sono una stima di progetto basata su un modello multi-wall (COST 231) applicato alla geometria letta dalla pianta, con attenuazione stimata per ogni ostacolo attraversato. Conviene verificarli con un sopralluogo strumentale, specialmente in presenza di materiali o arredi non censiti nella pianta.');

    const tag = scope === 'both' ? 'entrambe_le_bande' : (S.band === '24' ? '2g4' : '5g');
    doc.save(`${baseName()}_report_${tag}.pdf`);
    toast('Report PDF generato.');
  };

  function syncControls() {
    $('thr').value = S.thr; $('thrVal').textContent = fmt(S.thr, 0) + ' dBm';
    $('pn').value = S.n; $('hAp').value = S.hAp; $('hCli').value = S.hCli; $('margin').value = S.margin;
    $('reg').value = S.reg; $('res').value = S.res; $('shade').checked = S.shade; $('smooth').checked = S.smooth;
    syncSeg();
  }

  // tema
  const rerender = () => { rebuildComposite(); render(); };
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rerender); } catch (e) { }
  new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // avvio
  window.addEventListener('resize', () => { resize(); });
  const tab = store.get('tab', null); if (tab) { const b = document.querySelector(`#tabs button[data-tab="${tab}"]`); if (b) b.click(); }
  syncControls(); renderCatalog(); renderPlanPanel(); renderApPanel();
  resize();
  loadDemo();
  window.WiFiMap = { S, loadDxfText, addAp, rebuildComposite, render };
})();
