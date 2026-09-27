/* Genera una pianta DXF di esempio (ufficio 32 × 18 m, unità mm) */
function buildDemoDXF() {
  const E = [];
  const line = (l, x1, y1, x2, y2) => E.push(`0\nLINE\n8\n${l}\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0`);
  const arc = (l, cx, cy, r, a1, a2) => E.push(`0\nARC\n8\n${l}\n10\n${cx}\n20\n${cy}\n30\n0\n40\n${r}\n50\n${a1}\n51\n${a2}`);
  const text = (l, x, y, h, s) => E.push(`0\nTEXT\n8\n${l}\n10\n${x}\n20\n${y}\n30\n0\n40\n${h}\n1\n${s}`);
  const rect = (l, x, y, w, h) => { const p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; E.push(`0\nLWPOLYLINE\n8\n${l}\n90\n4\n70\n1\n` + p.map(q => `10\n${q[0]}\n20\n${q[1]}`).join('\n')); };
  // muro rettilineo asse-parallelo con aperture [[pos, larghezza, tipo]] ; tipo 'P' porta, 'F' finestra
  function wall(layer, x1, y1, x2, y2, t, open = []) {
    const hz = y1 === y2, L = hz ? x2 - x1 : y2 - y1, h = t / 2;
    const P = (s, o) => hz ? [x1 + s, y1 + o] : [x1 + o, y1 + s];
    const cuts = open.slice().sort((a, b) => a[0] - b[0]);
    let s = 0; const pieces = [];
    for (const [pos, w] of cuts) { pieces.push([s, pos]); s = pos + w; }
    pieces.push([s, L]);
    for (const [a, b] of pieces) {
      if (b - a < 1) continue;
      const A1 = P(a, -h), B1 = P(b, -h), A2 = P(a, h), B2 = P(b, h);
      line(layer, ...A1, ...B1); line(layer, ...A2, ...B2);
      if (a > 0) line(layer, ...A1, ...A2);
      if (b < L) line(layer, ...B1, ...B2);
    }
    for (const [pos, w, tp] of cuts) {
      if (tp === 'P') {
        const [hx, hy] = P(pos, h), [ex, ey] = P(pos + w, h);
        if (hz) { line('PORTE', hx, hy, hx, hy + w); arc('PORTE', hx, hy, w, 0, 90); }
        else { line('PORTE', hx, hy, hx + w, hy); arc('PORTE', hx, hy, w, 0, 90); }
      } else if (tp === 'F') {
        const [a1, b1] = P(pos, 0), [a2, b2] = P(pos + w, 0);
        line('FINESTRE', a1, b1, a2, b2);
        const [c1, d1] = P(pos, -h), [c2, d2] = P(pos + w, -h); line('FINESTRE', c1, d1, c2, d2);
        const [e1, f1] = P(pos, h), [e2, f2] = P(pos + w, h); line('FINESTRE', e1, f1, e2, f2);
      }
    }
  }
  const W = 32000, H = 18000, T = 300;
  // perimetro (muratura portante 30 cm) con finestre
  wall('MURI_PERIMETRALI', 0, 0, W, 0, T, [[2000, 1800, 'F'], [7000, 1800, 'F'], [13500, 2400, 'P'], [20000, 1800, 'F'], [26000, 1800, 'F']]);
  wall('MURI_PERIMETRALI', 0, H, W, H, T, [[2000, 1800, 'F'], [7000, 1800, 'F'], [14000, 1800, 'F'], [20000, 1800, 'F'], [26000, 1800, 'F']]);
  wall('MURI_PERIMETRALI', 0, -T / 2, 0, H + T / 2, T, [[6000, 1800, 'F'], [12000, 1800, 'F']]);
  wall('MURI_PERIMETRALI', W, -T / 2, W, H + T / 2, T, [[6000, 1800, 'F'], [12000, 1800, 'F']]);
  // corridoio centrale y 7.5–10 m: tramezzi 10 cm con porte
  wall('TRAMEZZI', 150, 7500, W - 150, 7500, 100, [[3000, 900, 'P'], [9500, 900, 'P'], [17000, 900, 'P'], [25500, 900, 'P']]);
  wall('TRAMEZZI', 150, 10000, 11000, 10000, 100, [[3500, 900, 'P'], [8000, 900, 'P']]);
  // pareti uffici sud (tramezzi)
  for (const x of [6000, 12000, 19000]) wall('TRAMEZZI', x, 150, x, 7450, 100);
  // uffici nord
  wall('TRAMEZZI', 5500, 10050, 5500, H - 150, 100);
  // vano scala/ascensore in c.a. 25 cm
  wall('CA_SETTI', 11000, 10000, 11000, H - 150, 250);
  wall('CA_SETTI', 15500, 10000, 15500, H - 150, 250);
  wall('CA_SETTI', 11125, 10000, 15375, 10000, 250, [[1200, 1000, 'P']]);
  rect('ASCENSORE', 13200, 14000, 2000, 2400);
  // open space nord-est con parete vetrata
  line('VETRATE', 15625, 10000, W - 150, 10000);
  line('VETRATE', 15625, 10060, W - 150, 10060);
  // sala riunioni in cartongesso 12.5 cm
  wall('CARTONGESSO', 26000, 10060, 26000, H - 150, 125, [[1500, 900, 'P']]);
  // arredi
  for (let x = 17000; x < 25000; x += 2600) for (let y = 11500; y < 17000; y += 2200) rect('ARREDI', x, y, 1600, 800);
  for (const [x, y] of [[1000, 1000], [7000, 1000], [13000, 1000], [20000, 1000], [26000, 1000]]) { rect('ARREDI', x, y, 1800, 800); rect('ARREDI', x, y + 3500, 1800, 800); }
  rect('ARREDI', 27500, 12500, 3000, 1400);
  rect('ARMADI_METALLICI', 30000, 1000, 600, 4000);
  // testi e quote
  text('TESTI', 2000, 4000, 400, 'Ufficio 1'); text('TESTI', 8000, 4000, 400, 'Ufficio 2'); text('TESTI', 14500, 4000, 400, 'Ufficio 3'); text('TESTI', 24000, 4000, 400, 'Ufficio 4');
  text('TESTI', 14000, 8500, 400, 'Corridoio'); text('TESTI', 2000, 14000, 400, 'Archivio'); text('TESTI', 7000, 14000, 400, 'Ufficio 5');
  text('TESTI', 12000, 16800, 400, 'Scala/ascensore'); text('TESTI', 19000, 17000, 400, 'Open space'); text('TESTI', 27500, 16500, 400, 'Sala riunioni');
  line('QUOTE', 0, -1500, W, -1500); text('QUOTE', W / 2 - 800, -1300, 350, '32.00 m');
  const hdr = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n`;
  const layers = ['MURI_PERIMETRALI', 'TRAMEZZI', 'CA_SETTI', 'CARTONGESSO', 'VETRATE', 'FINESTRE', 'PORTE', 'ARREDI', 'ARMADI_METALLICI', 'ASCENSORE', 'TESTI', 'QUOTE'];
  const tables = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n` + layers.map((l, i) => `0\nLAYER\n2\n${l}\n70\n0\n62\n${i + 1}\n6\nCONTINUOUS`).join('\n') + `\n0\nENDTAB\n0\nENDSEC\n`;
  return hdr + tables + `0\nSECTION\n2\nENTITIES\n` + E.join('\n') + `\n0\nENDSEC\n0\nEOF\n`;
}
if (typeof module !== 'undefined') module.exports = buildDemoDXF;
