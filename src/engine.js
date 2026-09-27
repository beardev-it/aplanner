/* Motore: rilevamento spessori muri, indice spaziale, propagazione multi-wall, isolinee. */
const Engine = (() => {

  // ---------- Griglia a bucket (indice spaziale) ----------
  function makeIndex(X1, Y1, X2, Y2, n, cell) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let i = 0; i < n; i++) {
      minx = Math.min(minx, X1[i], X2[i]); maxx = Math.max(maxx, X1[i], X2[i]);
      miny = Math.min(miny, Y1[i], Y2[i]); maxy = Math.max(maxy, Y1[i], Y2[i]);
    }
    if (!isFinite(minx)) { minx = miny = 0; maxx = maxy = 1; }
    // limita numero di bucket
    const W = maxx - minx, H = maxy - miny;
    while ((W / cell) * (H / cell) > 4e6) cell *= 1.5;
    const gx0 = minx - cell, gy0 = miny - cell;
    const nx = Math.ceil((W + 2 * cell) / cell) + 1, ny = Math.ceil((H + 2 * cell) / cell) + 1;
    const counts = new Int32Array(nx * ny + 1);
    const idx = { gx0, gy0, cell, nx, ny };
    for (let i = 0; i < n; i++) traverse(idx, X1[i], Y1[i], X2[i], Y2[i], (b) => { counts[b]++; });
    const start = new Int32Array(nx * ny + 1);
    for (let b = 0; b < nx * ny; b++) start[b + 1] = start[b] + counts[b];
    const fill = start.slice(0, nx * ny);
    const items = new Int32Array(start[nx * ny]);
    for (let i = 0; i < n; i++) traverse(idx, X1[i], Y1[i], X2[i], Y2[i], (b) => { items[fill[b]++] = i; });
    idx.start = start; idx.items = items;
    return idx;
  }

  // Attraversamento Amanatides–Woo dei bucket toccati dal segmento
  function traverse(idx, x1, y1, x2, y2, cb) {
    const { gx0, gy0, cell, nx, ny } = idx;
    let ix = Math.floor((x1 - gx0) / cell), iy = Math.floor((y1 - gy0) / cell);
    const ex = Math.floor((x2 - gx0) / cell), ey = Math.floor((y2 - gy0) / cell);
    const dx = x2 - x1, dy = y2 - y1;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    let tMaxX = dx !== 0 ? ((ix + (sx > 0 ? 1 : 0)) * cell + gx0 - x1) / dx : Infinity;
    let tMaxY = dy !== 0 ? ((iy + (sy > 0 ? 1 : 0)) * cell + gy0 - y1) / dy : Infinity;
    const tdx = dx !== 0 ? cell / Math.abs(dx) : Infinity, tdy = dy !== 0 ? cell / Math.abs(dy) : Infinity;
    let guard = 0;
    while (true) {
      if (ix >= 0 && iy >= 0 && ix < nx && iy < ny) { if (cb(iy * nx + ix) === false) return; }
      if (ix === ex && iy === ey) return;
      if (++guard > 1e6) return;
      if (tMaxX < tMaxY) { if (tMaxX > 1) return; ix += sx; tMaxX += tdx; }
      else { if (tMaxY > 1) return; iy += sy; tMaxY += tdy; }
    }
  }

  /* ---------- Preparazione ostacoli ----------
     segs: [{x1,y1,x2,y2,layer,arc}] in metri
     layerCfg: {nome: {mat, tDefault (m), on}}
     materials: {id: {b24:[base,perCm], b5:[...]}}
     p: {minT, maxT, angTol (gradi), sameLayer, ignoreDoorArcs} */
  function prepare(segs, layerCfg, materials, p) {
    const src = [];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const lc = layerCfg[s.layer];
      if (!lc || !lc.on || lc.mat === 'ignora') continue;
      if (p.ignoreDoorArcs && s.arc && !s.arc.circle && !s.arc.poly && s.arc.sweep >= 45 && s.arc.sweep <= 135 && s.arc.r >= 0.45 && s.arc.r <= 1.6) continue;
      const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      if (L < 0.005) continue;
      src.push(s);
    }
    const n = src.length;
    const X1 = new Float64Array(n), Y1 = new Float64Array(n), X2 = new Float64Array(n), Y2 = new Float64Array(n);
    const layerId = new Int32Array(n);
    const layerNames = []; const layerMap = new Map();
    for (let i = 0; i < n; i++) {
      const s = src[i]; X1[i] = s.x1; Y1[i] = s.y1; X2[i] = s.x2; Y2[i] = s.y2;
      if (!layerMap.has(s.layer)) { layerMap.set(s.layer, layerNames.length); layerNames.push(s.layer); }
      layerId[i] = layerMap.get(s.layer);
    }
    const isArc = new Uint8Array(n); for (let i = 0; i < n; i++) isArc[i] = src[i].arc ? 1 : 0;

    // ---- rilevamento linee parallele (spessore) ----
    const gapL = new Float32Array(n).fill(Infinity), gapR = new Float32Array(n).fill(Infinity);
    const pIdx = makeIndex(X1, Y1, X2, Y2, n, Math.max(p.maxT, 0.25));
    const stamp = new Int32Array(n).fill(-1);
    const sinTol = Math.sin(p.angTol * Math.PI / 180);
    const nb = [];
    for (let i = 0; i < n; i++) {
      if (isArc[i]) continue;
      const dx = X2[i] - X1[i], dy = Y2[i] - Y1[i], L = Math.hypot(dx, dy);
      if (L < 0.02) continue;
      const ux = dx / L, uy = dy / L, nxv = -uy, nyv = ux;
      nb.length = 0;
      traverse(pIdx, X1[i], Y1[i], X2[i], Y2[i], (b) => { nb.push(b); });
      for (const b0 of nb) {
        const bx = b0 % pIdx.nx, by = (b0 / pIdx.nx) | 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const cx = bx + ox, cy = by + oy;
          if (cx < 0 || cy < 0 || cx >= pIdx.nx || cy >= pIdx.ny) continue;
          const b = cy * pIdx.nx + cx;
          for (let k = pIdx.start[b]; k < pIdx.start[b + 1]; k++) {
            const j = pIdx.items[k];
            if (j === i || stamp[j] === i || isArc[j]) continue;
            stamp[j] = i;
            if (p.sameLayer && layerId[j] !== layerId[i]) continue;
            const ddx = X2[j] - X1[j], ddy = Y2[j] - Y1[j], Lj = Math.hypot(ddx, ddy);
            if (Lj < 0.02) continue;
            const cr = Math.abs(ux * ddy - uy * ddx) / Lj;
            if (cr > sinTol) continue;
            const d1 = (X1[j] - X1[i]) * nxv + (Y1[j] - Y1[i]) * nyv;
            const d2 = (X2[j] - X1[i]) * nxv + (Y2[j] - Y1[i]) * nyv;
            if (d1 * d2 <= 0) continue;
            const d = (d1 + d2) / 2, ad = Math.abs(d);
            if (ad < p.minT || ad > p.maxT) continue;
            const t1 = (X1[j] - X1[i]) * ux + (Y1[j] - Y1[i]) * uy;
            const t2 = (X2[j] - X1[i]) * ux + (Y2[j] - Y1[i]) * uy;
            const ov = Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
            if (ov < 0.02 || ov < 0.2 * Math.min(L, Lj)) continue;
            if (d > 0) { if (ad < gapL[i]) gapL[i] = ad; } else { if (ad < gapR[i]) gapR[i] = ad; }
          }
        }
      }
    }

    // ---- spessore efficace per linea ----
    const tw = new Float32Array(n), wallT = new Float32Array(n);
    const paired = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const l = isFinite(gapL[i]) ? gapL[i] : 0, r = isFinite(gapR[i]) ? gapR[i] : 0;
      if (l > 0 || r > 0) { paired[i] = 1; tw[i] = (l + r) / 2; wallT[i] = Math.max(l, r, l + r > p.maxT ? Math.max(l, r) : l + r); }
    }
    // chiusure (testate) corte che collegano linee accoppiate
    const endIdx = makeIndex(X1, Y1, X2, Y2, n, Math.max(p.maxT, 0.25));
    for (let i = 0; i < n; i++) {
      if (paired[i] || isArc[i]) continue;
      const L = Math.hypot(X2[i] - X1[i], Y2[i] - Y1[i]);
      if (L > p.maxT * 1.05 || L < p.minT * 0.9) continue;
      let hits = 0, tsum = 0;
      for (const [px, py] of [[X1[i], Y1[i]], [X2[i], Y2[i]]]) {
        const bx = Math.floor((px - endIdx.gx0) / endIdx.cell), by = Math.floor((py - endIdx.gy0) / endIdx.cell);
        let found = false;
        for (let oy = -1; oy <= 1 && !found; oy++) for (let ox = -1; ox <= 1 && !found; ox++) {
          const cx = bx + ox, cy = by + oy; if (cx < 0 || cy < 0 || cx >= endIdx.nx || cy >= endIdx.ny) continue;
          const b = cy * endIdx.nx + cx;
          for (let k = endIdx.start[b]; k < endIdx.start[b + 1] && !found; k++) {
            const j = endIdx.items[k]; if (!paired[j]) continue;
            if (Math.hypot(X1[j] - px, Y1[j] - py) < 0.02 || Math.hypot(X2[j] - px, Y2[j] - py) < 0.02) { found = true; tsum += wallT[j]; }
          }
        }
        if (found) hits++;
      }
      if (hits === 2) { tw[i] = L / 2; wallT[i] = L; paired[i] = 2; }
    }
    // linee singole: spessore di default del layer
    for (let i = 0; i < n; i++) if (!paired[i]) { const t = layerCfg[layerNames[layerId[i]]].tDefault; tw[i] = t; wallT[i] = t; }

    // ---- coefficienti di perdita ----
    const A24 = new Float32Array(n), B24 = new Float32Array(n), A5 = new Float32Array(n), B5 = new Float32Array(n);
    const matOf = new Array(n);
    for (let i = 0; i < n; i++) {
      let mid = layerCfg[layerNames[layerId[i]]].mat;
      if (mid === 'auto') mid = (typeof autoMaterialFor === 'function' ? autoMaterialFor : (t) => 'laterizio')(wallT[i]);
      const m = materials[mid] || materials.laterizio;
      matOf[i] = mid;
      const frac = wallT[i] > 0 ? Math.min(1, tw[i] / wallT[i]) : 1;
      const tcm = tw[i] * 100;
      A24[i] = m.b24[0] * frac; B24[i] = m.b24[1] * tcm;
      A5[i] = m.b5[0] * frac; B5[i] = m.b5[1] * tcm;
    }
    const rIdx = makeIndex(X1, Y1, X2, Y2, n, 0.75);
    const pairedCount = paired.reduce((a, v) => a + (v === 1 ? 1 : 0), 0);
    return { n, X1, Y1, X2, Y2, tw, wallT, paired, matOf, layerId, layerNames, A24, B24, A5, B5, idx: rIdx, stamp: new Int32Array(n).fill(-1), rayId: 0, pairedCount };
  }

  /* ---------- Propagazione ----------
     ap: {x,y,az(deg),beam, eirp24, eirp5, f24, f5 (MHz)} ; eirp null = banda off
     grid: {x0,y0,cs,w,h}; par: {n (esponente), dh (m), margin} */
  function computeAP(ob, ap, grid, par, rowFrom = 0, rowTo = grid.h, out) {
    const { w, h, x0, y0, cs } = grid;
    if (!out) out = { r24: ap.eirp24 != null ? new Float32Array(w * h) : null, r5: ap.eirp5 != null ? new Float32Array(w * h) : null };
    const { X1, Y1, X2, Y2, A24, B24, A5, B5, idx, stamp } = ob;
    const k24 = ap.eirp24 != null ? ap.eirp24 - (20 * Math.log10(ap.f24) - 27.55) - par.margin : 0;
    const k5 = ap.eirp5 != null ? ap.eirp5 - (20 * Math.log10(ap.f5) - 27.55) - par.margin : 0;
    const nexp = par.n * 10, dh2 = par.dh * par.dh;
    const dir = ap.beam < 360;
    const az = (ap.az || 0) * Math.PI / 180;
    const ax = ap.x, ay = ap.y;
    let L24 = 0, L5 = 0;
    const hit = (b) => {
      for (let k = idx.start[b]; k < idx.start[b + 1]; k++) {
        const i = idx.items[k];
        if (stamp[i] === ob.rayId) continue;
        stamp[i] = ob.rayId;
        // intersezione raggio (ax,ay)->(tx,ty) con segmento i
        const sx = X2[i] - X1[i], sy = Y2[i] - Y1[i];
        const den = rdx * sy - rdy * sx;
        if (den === 0) continue;
        const qx = X1[i] - ax, qy = Y1[i] - ay;
        const t = (qx * sy - qy * sx) / den;
        if (t < 0 || t > 1) continue;
        const u = (qx * rdy - qy * rdx) / den;
        if (u < 0 || u >= 1) continue;
        // secante dell'angolo d'incidenza (limitata a 3)
        const sl = Math.hypot(sx, sy);
        const sn = Math.abs(den) / (sl * rl);
        const sec = sn > 0.333 ? 1 / sn : 3;
        L24 += A24[i] + B24[i] * sec; L5 += A5[i] + B5[i] * sec;
      }
    };
    let rdx = 0, rdy = 0, rl = 1;
    for (let j = rowFrom; j < rowTo; j++) {
      const ty = y0 + (j + 0.5) * cs;
      for (let c = 0; c < w; c++) {
        const tx = x0 + (c + 0.5) * cs;
        rdx = tx - ax; rdy = ty - ay; rl = Math.hypot(rdx, rdy) || 1e-9;
        L24 = 0; L5 = 0;
        ob.rayId++;
        if (ob.n) traverse(idx, ax, ay, tx, ty, hit);
        const d = Math.max(Math.sqrt(rl * rl + dh2), 0.5);
        const pl = nexp * Math.log10(d);
        let patt = 0;
        if (dir) {
          let da = Math.atan2(rdy, rdx) - az; da = Math.atan2(Math.sin(da), Math.cos(da));
          const r = (Math.abs(da) * 180 / Math.PI) / (ap.beam / 2);
          patt = Math.min(3 * r * r, 25);
        }
        const o = j * w + c;
        if (out.r24) out.r24[o] = k24 - pl - Math.min(L24, 150) - patt;
        if (out.r5) out.r5[o] = k5 - pl - Math.min(L5, 150) - patt;
      }
    }
    return out;
  }

  /* ---------- Isolinee (marching squares) ----------
     field: valori ai centri cella; restituisce polilinee in coordinate cella (x=i+0.5) */
  function contour(field, w, h, level) {
    const segA = [], segB = [], pts = new Map();
    const val = (i, j) => { const v = field[j * w + i]; return v !== v ? -1e9 : v; };
    const edgePoint = (id) => {
      if (pts.has(id)) return pts.get(id);
      const e = id >> 1, horiz = (id & 1) === 0;
      const i = e % w, j = (e / w) | 0;
      let x, y;
      if (horiz) { const a = val(i, j), b = val(i + 1, j); const t = (level - a) / (b - a); x = i + t; y = j; }
      else { const a = val(i, j), b = val(i, j + 1); const t = (level - a) / (b - a); x = i; y = j + t; }
      const p = [x + 0.5, y + 0.5]; pts.set(id, p); return p;
    };
    const H = (i, j) => 2 * (j * w + i), V = (i, j) => 2 * (j * w + i) + 1;
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      const a = val(i, j) >= level, b = val(i + 1, j) >= level, c = val(i + 1, j + 1) >= level, d = val(i, j + 1) >= level;
      const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const eB = H(i, j), eR = V(i + 1, j), eT = H(i, j + 1), eL = V(i, j);
      const add = (p, q) => { segA.push(p); segB.push(q); };
      switch (code) {
        case 1: case 14: add(eL, eB); break;
        case 2: case 13: add(eB, eR); break;
        case 3: case 12: add(eL, eR); break;
        case 4: case 11: add(eR, eT); break;
        case 6: case 9: add(eB, eT); break;
        case 7: case 8: add(eL, eT); break;
        case 5: case 10: {
          const center = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 >= level;
          if ((code === 5) === center) { add(eL, eT); add(eB, eR); } else { add(eL, eB); add(eR, eT); }
          break;
        }
      }
    }
    // unione in polilinee
    const adj = new Map();
    const link = (e, s) => { const l = adj.get(e); if (l) l.push(s); else adj.set(e, [s]); };
    for (let s = 0; s < segA.length; s++) { link(segA[s], s); link(segB[s], s); }
    const used = new Uint8Array(segA.length);
    const lines = [];
    for (let s0 = 0; s0 < segA.length; s0++) {
      if (used[s0]) continue;
      used[s0] = 1;
      const chain = [segA[s0], segB[s0]];
      for (let dirn = 0; dirn < 2; dirn++) {
        while (true) {
          const endE = dirn === 0 ? chain[chain.length - 1] : chain[0];
          const cand = adj.get(endE); let nxt = -1;
          if (cand) for (const s of cand) if (!used[s]) { nxt = s; break; }
          if (nxt < 0) break;
          used[nxt] = 1;
          const other = segA[nxt] === endE ? segB[nxt] : segA[nxt];
          if (dirn === 0) chain.push(other); else chain.unshift(other);
        }
      }
      lines.push(chain.map(edgePoint));
    }
    return lines;
  }

  return { prepare, computeAP, contour, makeIndex, traverse };
})();
if (typeof module !== 'undefined') module.exports = Engine;
