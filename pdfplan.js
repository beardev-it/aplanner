/* Lettura piante da PDF vettoriale (pdf.js 3.11 incorporato).
   Estrae le linee e i contorni delle campiture, con layer dai livelli PDF (OCG, esportati da AutoCAD)
   oppure, se assenti, raggruppati per colore e spessore del tratto. */
const PDFPlan = (() => {
  let lib = null;
  function ensureLib() {
    if (lib) return lib;
    if (!window.pdfjsLib) throw new Error('Lettore PDF non disponibile in questa pagina.');
    lib = window.pdfjsLib;
    const w = document.getElementById('pdfjs-worker');
    if (w) lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([w.textContent], { type: 'text/javascript' }));
    return lib;
  }

  async function open(buffer) {
    const L = ensureLib();
    return L.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true }).promise;
  }

  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  function colorOf(a) {
    if (typeof a[0] === 'string') return a[0].toLowerCase();
    if (a.length >= 3) return '#' + hex2(a[0]) + hex2(a[1]) + hex2(a[2]);
    return '#000000';
  }

  function circle3(p0, p1, p2) {
    const ax = p0[0], ay = p0[1], bx = p1[0], by = p1[1], cx = p2[0], cy = p2[1];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-9) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const r = Math.hypot(ax - ux, ay - uy);
    let a0 = Math.atan2(ay - uy, ax - ux), a2 = Math.atan2(cy - uy, cx - ux);
    let sw = Math.abs(a2 - a0) * 180 / Math.PI; if (sw > 180) sw = 360 - sw;
    return { r, sweep: sw };
  }

  /* Legge una pagina. Restituisce segmenti in punti PDF (y verso l'alto), testi, dimensioni e scala rilevata. */
  async function readPage(doc, pageNum, onProgress) {
    const L = ensureLib(), OPS = L.OPS;
    const page = await doc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    const VT = vp.transform; // spazio utente -> vista (y in basso)
    const ol = await page.getOperatorList();
    let oc = null; try { oc = await doc.getOptionalContentConfig(); } catch (e) { }
    const ocName = (props) => {
      try {
        if (!oc || !props) return null;
        if (props.type === 'OCG' && props.id) { const g = oc.getGroup(props.id); return g ? g.name : null; }
        if (props.type === 'OCMD' && props.ids && props.ids.length) { const g = oc.getGroup(props.ids[0]); return g ? g.name : null; }
      } catch (e) { }
      return null;
    };
    const pageArea = vp.width * vp.height;
    let ctm = [1, 0, 0, 1, 0, 0];
    let st = { stroke: '#000000', fill: '#000000', lw: 1, dash: false };
    const stack = [];
    const mc = [];
    let subs = []; // sottopercorsi: {pts:[[x,y]], arcs:[info|null], closed}
    let cur = null;
    const segs = [], seen = new Set();
    let usedOCG = false;

    const T = () => mul(VT, ctm);
    const PH = vp.height;
    const toW = (m, x, y) => { const p = ap(m, x, y); return [p[0], PH - p[1]]; };

    function construct(ops, args) {
      const m = T();
      let j = 0, cx = 0, cy = 0;
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i] | 0;
        if (op === OPS.moveTo) { cx = args[j++]; cy = args[j++]; cur = { pts: [toW(m, cx, cy)], arcs: [], closed: false }; subs.push(cur); }
        else if (op === OPS.lineTo) { cx = args[j++]; cy = args[j++]; if (!cur) { cur = { pts: [toW(m, cx, cy)], arcs: [], closed: false }; subs.push(cur); } else { cur.pts.push(toW(m, cx, cy)); cur.arcs.push(null); } }
        else if (op === OPS.curveTo || op === OPS.curveTo2 || op === OPS.curveTo3) {
          let x1, y1, x2, y2, x3, y3;
          if (op === OPS.curveTo) { x1 = args[j++]; y1 = args[j++]; x2 = args[j++]; y2 = args[j++]; x3 = args[j++]; y3 = args[j++]; }
          else if (op === OPS.curveTo2) { x1 = cx; y1 = cy; x2 = args[j++]; y2 = args[j++]; x3 = args[j++]; y3 = args[j++]; }
          else { x1 = args[j++]; y1 = args[j++]; x3 = args[j++]; y3 = args[j++]; x2 = x3; y2 = y3; }
          if (!cur) { cur = { pts: [toW(m, cx, cy)], arcs: [], closed: false }; subs.push(cur); }
          const x0 = cx, y0 = cy, N = 8, pts = [];
          for (let k = 1; k <= N; k++) {
            const t = k / N, u = 1 - t;
            pts.push(toW(m, u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3));
          }
          const c = circle3(cur.pts[cur.pts.length - 1], pts[N / 2 - 1], pts[N - 1]);
          const info = c ? { r: c.r, sweep: c.sweep, bez: true } : { bez: true };
          for (const p of pts) { cur.pts.push(p); cur.arcs.push(info); }
          cx = x3; cy = y3;
        }
        else if (op === OPS.closePath) { if (cur) cur.closed = true; }
        else if (op === OPS.rectangle) {
          const x = args[j++], y = args[j++], w = args[j++], h = args[j++];
          cur = { pts: [toW(m, x, y), toW(m, x + w, y), toW(m, x + w, y + h), toW(m, x, y + h)], arcs: [null, null, null], closed: true };
          subs.push(cur); cur = null; cx = x; cy = y;
        }
      }
    }

    function emit(kind) {
      const name = mc.length ? mc[mc.length - 1] : null;
      let layer;
      const scaleW = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;
      if (name) { layer = name; usedOCG = true; }
      else if (kind === 'fill') layer = `Campiture ${st.fill}`;
      else layer = `Linee ${st.stroke} ${(st.lw * scaleW * 25.4 / 72).toFixed(2).replace('.', ',')} mm${st.dash ? ' tratteggio' : ''}`;
      for (const s of subs) {
        const p = s.pts; if (p.length < 2) continue;
        if (kind === 'fill') {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
          if ((x1 - x0) * (y1 - y0) > 0.5 * pageArea) continue; // sfondi
          if (!name && Math.max(x1 - x0, y1 - y0) < 4 * 72 / 25.4 && s.arcs.some(a => a && a.bez)) { s.glyph = true; }
        }
        const lay = s.glyph ? 'Testi e simboli (campiture piccole)' : layer;
        const n = p.length, close = s.closed || kind === 'fill';
        for (let k = 0; k < n - 1 + (close ? 1 : 0); k++) {
          const a = p[k], b = p[(k + 1) % n];
          if (Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3) continue;
          const r = (v) => Math.round(v * 50);
          const ka = r(a[0]) + ',' + r(a[1]), kb = r(b[0]) + ',' + r(b[1]);
          const key = ka < kb ? ka + ';' + kb : kb + ';' + ka;
          if (seen.has(key)) continue;
          seen.add(key);
          segs.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], layer: lay, arc: k < s.arcs.length ? s.arcs[k] : null });
        }
      }
    }

    const fn = ol.fnArray, ar = ol.argsArray;
    for (let i = 0; i < fn.length; i++) {
      const f = fn[i], a = ar[i];
      switch (f) {
        case OPS.save: stack.push({ ctm, st: Object.assign({}, st) }); break;
        case OPS.restore: { const s = stack.pop(); if (s) { ctm = s.ctm; st = s.st; } break; }
        case OPS.transform: ctm = mul(ctm, a); break;
        case OPS.paintFormXObjectBegin: stack.push({ ctm, st: Object.assign({}, st) }); if (a && a[0]) ctm = mul(ctm, a[0]); break;
        case OPS.paintFormXObjectEnd: { const s = stack.pop(); if (s) { ctm = s.ctm; st = s.st; } break; }
        case OPS.setLineWidth: st.lw = a[0]; break;
        case OPS.setDash: st.dash = !!(a[0] && a[0].length && a[0].some(v => v > 0)); break;
        case OPS.setStrokeRGBColor: st.stroke = colorOf(a); break;
        case OPS.setFillRGBColor: st.fill = colorOf(a); break;
        case OPS.beginMarkedContentProps: mc.push(a[0] === 'OC' ? (ocName(a[1]) || (mc.length ? mc[mc.length - 1] : null)) : (mc.length ? mc[mc.length - 1] : null)); break;
        case OPS.beginMarkedContent: mc.push(mc.length ? mc[mc.length - 1] : null); break;
        case OPS.endMarkedContent: mc.pop(); break;
        case OPS.constructPath: construct(a[0], a[1]); break;
        case OPS.stroke: case OPS.closeStroke: emit('stroke'); subs = []; cur = null; break;
        case OPS.fill: case OPS.eoFill: emit('fill'); subs = []; cur = null; break;
        case OPS.fillStroke: case OPS.eoFillStroke: case OPS.closeFillStroke: case OPS.closeEOFillStroke: emit('stroke'); subs = []; cur = null; break;
        case OPS.endPath: subs = []; cur = null; break;
      }
      if (onProgress && (i & 16383) === 0) onProgress(i / fn.length);
    }

    // testi
    const texts = [];
    const scaleCount = {};
    try {
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const m = mul(VT, it.transform);
        const h = Math.hypot(m[2], m[3]);
        const rot = Math.atan2(-m[1], m[0]) * 180 / Math.PI;
        texts.push({ x: m[4], y: PH - m[5], h, rot, s: it.str.slice(0, 80), layer: 'Testi PDF' });
        const re = /(?:^|[^\d])1\s*[:\/]\s*(\d{1,4})(?![\d.,])/g; let mm;
        while ((mm = re.exec(it.str))) { const d = +mm[1]; if (d >= 10 && d <= 5000) scaleCount[d] = (scaleCount[d] || 0) + 1; }
      }
    } catch (e) { }
    const best = Object.keys(scaleCount).sort((a, b) => scaleCount[b] - scaleCount[a])[0];
    return { page, segs, texts, width: vp.width, height: vp.height, usedOCG, scaleDenom: best ? +best : null, ops: fn.length };
  }

  // Rende la pagina come immagine di sfondo (lato lungo ~ maxPx)
  async function renderBackground(page, maxPx = 3600) {
    const vp1 = page.getViewport({ scale: 1 });
    const sc = Math.min(maxPx / Math.max(vp1.width, vp1.height), 6);
    const vp = page.getViewport({ scale: sc });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, viewport: vp }).promise;
    return c;
  }

  return { open, readPage, renderBackground };
})();
