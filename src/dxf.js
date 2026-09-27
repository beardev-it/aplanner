/* Parser DXF ASCII minimale ma robusto: HEADER, TABLES(LAYER), BLOCKS, ENTITIES.
   Entità supportate: LINE, LWPOLYLINE, POLYLINE/VERTEX, ARC, CIRCLE, ELLIPSE, SPLINE,
   INSERT (blocchi annidati, MINSERT), TEXT, MTEXT, SOLID/3DFACE (bordi). */
const DXF = (() => {
  const INSUNITS_TO_M = { 0: null, 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 7: 1000, 8: 0.0000254, 10: 0.9144, 14: 0.1 };

  function decode(buffer) {
    const bytes = new Uint8Array(buffer);
    const head = String.fromCharCode.apply(null, bytes.subarray(0, 22));
    if (head.startsWith('AutoCAD Binary DXF')) throw new Error('DXF binario non supportato: salva come DXF ASCII.');
    if (/^AC10\d\d/.test(head)) throw new Error('Questo è un file DWG. Convertilo in DXF con lo script "converti_dwg_in_dxf.bat" (ODA File Converter) oppure da AutoCAD con Salva con nome → DXF.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  }

  function tokenize(text) {
    const lines = text.split(/\r\n|\r|\n/);
    const codes = [], vals = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const c = parseInt(lines[i], 10);
      if (isNaN(c)) { i -= 1; continue; } // riallineamento su righe spurie
      codes.push(c); vals.push(lines[i + 1].trim());
    }
    return { codes, vals };
  }

  // Raggruppa i token in entità: [{type, g: [[code,val],...]}]
  function readEntities(codes, vals, start, endMarker) {
    const out = [];
    let i = start, cur = null;
    while (i < codes.length) {
      if (codes[i] === 0) {
        const v = vals[i];
        if (v === endMarker || v === 'ENDSEC') break;
        cur = { type: v, g: [] };
        out.push(cur);
      } else if (cur) cur.g.push([codes[i], vals[i]]);
      i++;
    }
    return { list: out, next: i };
  }

  function parse(text) {
    const { codes, vals } = tokenize(text);
    const res = { header: {}, layers: {}, blocks: {}, entities: [] };
    let i = 0;
    while (i < codes.length) {
      if (codes[i] === 0 && vals[i] === 'SECTION' && codes[i + 1] === 2) {
        const name = vals[i + 1];
        i += 2;
        if (name === 'HEADER') {
          let key = null;
          while (i < codes.length && !(codes[i] === 0 && vals[i] === 'ENDSEC')) {
            if (codes[i] === 9) { key = vals[i]; res.header[key] = {}; }
            else if (key) res.header[key][codes[i]] = vals[i];
            i++;
          }
        } else if (name === 'TABLES') {
          const r = readEntities(codes, vals, i, '__none__');
          for (const e of r.list) if (e.type === 'LAYER') {
            const nm = gv(e.g, 2); if (nm == null) continue;
            const col = parseInt(gv(e.g, 62) || '7', 10);
            const flags = parseInt(gv(e.g, 70) || '0', 10);
            res.layers[nm] = { color: Math.abs(col), off: col < 0, frozen: (flags & 1) === 1 };
          }
          i = r.next;
        } else if (name === 'BLOCKS') {
          const r = readEntities(codes, vals, i, '__none__');
          let blk = null;
          for (const e of r.list) {
            if (e.type === 'BLOCK') { blk = { name: gv(e.g, 2), bx: num(e.g, 10), by: num(e.g, 20), ents: [] }; if (blk.name) res.blocks[blk.name] = blk; }
            else if (e.type === 'ENDBLK') blk = null;
            else if (blk) blk.ents.push(e);
          }
          i = r.next;
        } else if (name === 'ENTITIES') {
          const r = readEntities(codes, vals, i, '__none__');
          res.entities = r.list; i = r.next;
        }
      }
      i++;
    }
    const iu = res.header.$INSUNITS ? parseInt(res.header.$INSUNITS[70], 10) : 0;
    res.insunits = isNaN(iu) ? 0 : iu;
    res.unitToM = INSUNITS_TO_M[res.insunits] || null;
    return res;
  }

  function gv(g, code) { for (let k = 0; k < g.length; k++) if (g[k][0] === code) return g[k][1]; return null; }
  function num(g, code, def = 0) { const v = gv(g, code); const f = v == null ? NaN : parseFloat(v); return isNaN(f) ? def : f; }
  function all(g, code) { const o = []; for (const p of g) if (p[0] === code) o.push(parseFloat(p[1])); return o; }

  // Matrice affine 2D [a,b,c,d,e,f]: x' = a x + c y + e ; y' = b x + d y + f
  const I = [1, 0, 0, 1, 0, 0];
  function mul(m, n) { return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; }
  function ap(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

  function bulgePts(x1, y1, x2, y2, b, out) {
    // aggiunge punti intermedi dell'arco (escluso primo, escluso ultimo)
    const th = 4 * Math.atan(b), dx = x2 - x1, dy = y2 - y1, c = Math.hypot(dx, dy);
    if (c < 1e-12 || Math.abs(b) < 1e-6) return;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const off = (c / 2) * (1 - b * b) / (2 * b);
    const nx = -dy / c, ny = dx / c;
    const cx = mx + nx * off, cy = my + ny * off;
    const R = Math.hypot(x1 - cx, y1 - cy);
    const a1 = Math.atan2(y1 - cy, x1 - cx);
    const n = Math.max(2, Math.min(32, Math.ceil(Math.abs(th) / (Math.PI / 16))));
    for (let k = 1; k < n; k++) { const a = a1 + th * k / n; out.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
  }

  /* Appiattisce in segmenti in coordinate disegno.
     Ritorna {segs:[{x1,y1,x2,y2,layer,arc:{r,sweep}|null}], texts:[{x,y,h,rot,s,layer}]} */
  function flatten(dxf, opts = {}) {
    const segs = [], texts = [];
    const maxDepth = 10;
    const layerOf = (e, parentLayer) => { let l = gv(e.g, 8) || '0'; if (l === '0' && parentLayer) l = parentLayer; return l; };
    const pushSeg = (m, x1, y1, x2, y2, layer, arc) => {
      const [a, b] = ap(m, x1, y1), [c, d] = ap(m, x2, y2);
      if (!isFinite(a + b + c + d)) return;
      if (a === c && b === d) return;
      segs.push({ x1: a, y1: b, x2: c, y2: d, layer, arc: arc || null });
    };
    const pushPoly = (m, pts, closed, layer, arcInfo) => {
      for (let k = 0; k + 1 < pts.length; k++) pushSeg(m, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], layer, arcInfo);
      if (closed && pts.length > 2) pushSeg(m, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], layer, arcInfo);
    };
    const ocs = (g) => num(g, 230, 1) < 0 ? [-1, 0, 0, 1, 0, 0] : I; // estrusione -Z: specchia X
    const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

    function walk(list, m, parentLayer, depth) {
      let polyline = null;
      for (let idx = 0; idx < list.length; idx++) {
        const e = list[idx], g = e.g;
        if (depth === 0 && gv(g, 67) === '1') continue; // entità dello spazio carta (layout): non fanno parte della pianta
        const layer = layerOf(e, parentLayer);
        switch (e.type) {
          case 'LINE': pushSeg(m, num(g, 10), num(g, 20), num(g, 11), num(g, 21), layer); break;
          case 'LWPOLYLINE': {
            const mm = mul(m, ocs(g));
            const flags = parseInt(gv(g, 70) || '0', 10);
            const pts = []; let last = null;
            const verts = [];
            for (const [c, v] of g) {
              if (c === 10) { last = { x: parseFloat(v), y: 0, b: 0 }; verts.push(last); }
              else if (c === 20 && last) last.y = parseFloat(v);
              else if (c === 42 && last) last.b = parseFloat(v);
            }
            const closed = (flags & 1) === 1;
            let arcish = false;
            for (let k = 0; k < verts.length; k++) {
              const v = verts[k]; pts.push([v.x, v.y]);
              const nx = verts[k + 1] || (closed ? verts[0] : null);
              if (nx && v.b) { bulgePts(v.x, v.y, nx.x, nx.y, v.b, pts); arcish = true; }
            }
            if (closed && pts.length > 2) pts.push(pts[0]);
            pushPoly(mm, pts, false, layer, arcish && verts.length <= 3 ? { poly: true } : null);
            break;
          }
          case 'POLYLINE': {
            const flags = parseInt(gv(g, 70) || '0', 10);
            polyline = (flags & (16 | 64)) ? null : { layer, closed: (flags & 1) === 1, verts: [], m: mul(m, ocs(g)) };
            break;
          }
          case 'VERTEX':
            if (polyline) { const vf = parseInt(gv(g, 70) || '0', 10); if (!(vf & 16)) polyline.verts.push({ x: num(g, 10), y: num(g, 20), b: num(g, 42) }); }
            break;
          case 'SEQEND':
            if (polyline) {
              const v = polyline.verts, pts = [];
              for (let k = 0; k < v.length; k++) {
                pts.push([v[k].x, v[k].y]);
                const nx = v[k + 1] || (polyline.closed ? v[0] : null);
                if (nx && v[k].b) bulgePts(v[k].x, v[k].y, nx.x, nx.y, v[k].b, pts);
              }
              if (polyline.closed && pts.length > 2) pts.push(pts[0]);
              pushPoly(polyline.m, pts, false, polyline.layer);
              polyline = null;
            }
            break;
          case 'ARC': case 'CIRCLE': {
            const mm = mul(m, ocs(g));
            const cx = num(g, 10), cy = num(g, 20), r = num(g, 40);
            let a1 = 0, a2 = 360;
            if (e.type === 'ARC') { a1 = num(g, 50); a2 = num(g, 51); if (Math.abs(a2 - a1) < 1e-6) break; if (a2 <= a1) a2 += 360; } // arco degenere (angoli uguali): ignorato
            const sweep = a2 - a1;
            const n = Math.max(4, Math.min(72, Math.ceil(sweep / 7.5)));
            const pts = [];
            for (let k = 0; k <= n; k++) { const a = (a1 + sweep * k / n) * Math.PI / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
            pushPoly(mm, pts, false, layer, { r: r * scaleOf(mm), sweep, circle: e.type === 'CIRCLE' });
            break;
          }
          case 'ELLIPSE': {
            const cx = num(g, 10), cy = num(g, 20), mx = num(g, 11), my = num(g, 21), ratio = num(g, 40, 1);
            let p1 = num(g, 41, 0), p2 = num(g, 42, Math.PI * 2); if (p2 <= p1) p2 += Math.PI * 2;
            const mm = mul(m, ocs(g));
            const ex = [mx, my], ey = [-my * ratio, mx * ratio];
            const n = Math.max(8, Math.ceil((p2 - p1) / (Math.PI / 24)));
            const pts = [];
            for (let k = 0; k <= n; k++) { const t = p1 + (p2 - p1) * k / n; pts.push([cx + ex[0] * Math.cos(t) + ey[0] * Math.sin(t), cy + ex[1] * Math.cos(t) + ey[1] * Math.sin(t)]); }
            pushPoly(mm, pts, false, layer);
            break;
          }
          case 'SPLINE': {
            let xs = all(g, 11), ys = all(g, 21);
            if (xs.length < 2) { xs = all(g, 10); ys = all(g, 20); }
            const pts = xs.map((x, k) => [x, ys[k]]);
            pushPoly(m, pts, (parseInt(gv(g, 70) || '0', 10) & 1) === 1, layer);
            break;
          }
          case 'SOLID': case '3DFACE': case 'TRACE': {
            const p = [[num(g, 10), num(g, 20)], [num(g, 11), num(g, 21)], [num(g, 13, num(g, 12)), num(g, 23, num(g, 22))], [num(g, 12), num(g, 22)]];
            pushPoly(m, p, true, layer);
            break;
          }
          case 'TEXT': case 'MTEXT': {
            if (opts.noText) break;
            let s = '';
            if (e.type === 'TEXT') s = gv(g, 1) || '';
            else { for (const [c, v] of g) if (c === 3 || c === 1) s += v; s = cleanMText(s); }
            if (!s.trim()) break;
            const x = num(g, 10), y = num(g, 20);
            const [px, py] = ap(m, x, y);
            let rot = num(g, 50, 0);
            if (e.type === 'MTEXT' && gv(g, 11) != null) rot = Math.atan2(num(g, 21), num(g, 11)) * 180 / Math.PI;
            const mr = Math.atan2(m[1], m[0]) * 180 / Math.PI;
            texts.push({ x: px, y: py, h: num(g, 40, 1) * scaleOf(m), rot: rot + mr, s: s.slice(0, 80), layer, mtext: e.type === 'MTEXT' });
            break;
          }
          case 'DIMENSION': {
            const blk = dxf.blocks[gv(g, 2)];
            if (blk && depth < maxDepth) walk(blk.ents, m, layer, depth + 1);
            break;
          }
          case 'INSERT': {
            if (depth >= maxDepth) break;
            const blk = dxf.blocks[gv(g, 2)]; if (!blk) break;
            const sx = num(g, 41, 1), sy = num(g, 42, 1), rot = num(g, 50, 0) * Math.PI / 180;
            const cols = Math.max(1, parseInt(gv(g, 70) || '1', 10)), rows = Math.max(1, parseInt(gv(g, 71) || '1', 10));
            const cs = num(g, 44, 0), rs = num(g, 45, 0);
            const px = num(g, 10), py = num(g, 20);
            const cr = Math.cos(rot), sr = Math.sin(rot);
            for (let rI = 0; rI < Math.min(rows, 100); rI++) for (let cI = 0; cI < Math.min(cols, 100); cI++) {
              const ox = cI * cs, oy = rI * rs;
              const T = [1, 0, 0, 1, px + ox * cr - oy * sr, py + ox * sr + oy * cr];
              const R = [cr, sr, -sr, cr, 0, 0];
              const S = [sx, 0, 0, sy, 0, 0];
              const B = [1, 0, 0, 1, -blk.bx, -blk.by];
              const mm = mul(m, mul(ocs(g), mul(T, mul(R, mul(S, B)))));
              walk(blk.ents, mm, layer, depth + 1);
            }
            break;
          }
        }
      }
    }
    walk(dxf.entities, I, null, 0);
    return { segs, texts };
  }

  function cleanMText(s) {
    return s.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;\\{}]*;/g, '').replace(/\\[~Ll Oo Kk]/g, '').replace(/[{}]/g, '').replace(/\\\\/g, '\\').replace(/%%[cCdDpP]/g, '').trim();
  }

  return { decode, parse, flatten, INSUNITS_TO_M };
})();
if (typeof module !== 'undefined') module.exports = DXF;
