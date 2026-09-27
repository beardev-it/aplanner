/* Catalogo access point MikroTik.
   Valori da mikrotik.com (schede prodotto, settembre 2026): guadagno antenna (dBi) e
   potenza TX massima (dBm, al rate più basso) per banda. beam = apertura orizzontale
   (360 = omnidirezionale). est = valore stimato (non pubblicato nella scheda). */
const MIKROTIK_CATALOG = [
  // ---- Wi-Fi 7 ----
  { id: 'hap_be_lite', name: 'hAP be lite', std: 'Wi-Fi 7', cat: 'Interno', mount: 'Tavolo/parete', b24: { g: 4.4, tx: 26.5 }, b5: { g: 7, tx: 26 }, beam: 360 },
  { id: 'hap_be3_media', name: 'hAP be³ Media', std: 'Wi-Fi 7', cat: 'Interno', mount: 'Tavolo/parete',
    // Potenza da grant FCC ID TV7MA53BE652 (potenza condotta, 2×2 MIMO), convertita: dBm = 10·log10(W·1000)
    b24: { g: 4, tx: 25.1, fcc: [[2412, 2462, 0.3228]] },
    b5: { g: 7.5, tx: 23.7, fcc: [[5180, 5240, 0.1897], [5260, 5320, 0.1469], [5500, 5720, 0.1483], [5745, 5825, 0.2323]] },
    beam: 360, note: 'Potenza TX da certificazione FCC (condotta, 2×2 MIMO): 2,4 GHz 0,3228 W = 25,1 dBm; 5 GHz 0,1897 W = 22,8 dBm (ch 36–48), 0,1469 W = 21,7 dBm (ch 52–64), 0,1483 W = 21,7 dBm (ch 100–144), 0,2323 W = 23,7 dBm (ch 149–165)' },
  // ---- Wi-Fi 6 ----
  { id: 'cap_ax', name: 'cAP ax', std: 'Wi-Fi 6', cat: 'Interno', mount: 'Soffitto/parete', b24: { g: 6, tx: 24 }, b5: { g: 5.5, tx: 24 }, beam: 360 },
  { id: 'wap_ax', name: 'wAP ax', std: 'Wi-Fi 6', cat: 'Esterno', mount: 'Parete/palo', b24: { g: 6.9, tx: 24 }, b5: { g: 7, tx: 23 }, beam: 360 },
  { id: 'wap_ax_lte7', name: 'wAP ax LTE7 kit', std: 'Wi-Fi 6', cat: 'Esterno', mount: 'Parete/palo', b24: { g: 6.9, tx: 24 }, b5: { g: 7, tx: 23 }, beam: 360, est: 'Radio Wi-Fi assunta uguale a wAP ax' },
  { id: 'hap_ax_s', name: 'hAP ax S', std: 'Wi-Fi 6', cat: 'Interno', mount: 'Tavolo', b24: { g: 5.5, tx: 24 }, b5: { g: 6.5, tx: 23 }, beam: 360 },
  { id: 'hap_ax2', name: 'hAP ax²', std: 'Wi-Fi 6', cat: 'Interno', mount: 'Tavolo/parete', b24: { g: 4, tx: 27 }, b5: { g: 4.5, tx: 26 }, beam: 360 },
  { id: 'hap_ax3', name: 'hAP ax³', std: 'Wi-Fi 6', cat: 'Interno', mount: 'Tavolo', b24: { g: 3.3, tx: 29 }, b5: { g: 5.5, tx: 28 }, beam: 360 },
  { id: 'hap_ax_lite', name: 'hAP ax lite', std: 'Wi-Fi 6', cat: 'Interno', mount: 'Tavolo', b24: { g: 4.3, tx: 22 }, b5: null, beam: 360 },
  { id: 'l009_2hax', name: 'L009UiGS-2HaxD-IN', std: 'Wi-Fi 6', cat: 'Interno', mount: 'Tavolo/rack', b24: { g: 4, tx: 30 }, b5: null, beam: 360 },
  { id: 'chateau_pro_ax', name: 'Chateau PRO ax', std: 'Wi-Fi 6', cat: 'Interno', mount: 'Tavolo', b24: { g: 5, tx: 26 }, b5: { g: 6, tx: 26 }, beam: 360, est: 'Potenza TX non pubblicata: stimata 26 dBm' },
  { id: 'chateau_lte18_ax', name: 'Chateau LTE18 ax', std: 'Wi-Fi 6', cat: 'Interno', mount: 'Tavolo', b24: { g: 3, tx: 24 }, b5: { g: 6, tx: 24 }, beam: 360 },
  { id: 'netmetal_ax', name: 'NetMetal ax + HGO omni', std: 'Wi-Fi 6', cat: 'Esterno', mount: 'Palo', b24: { g: 3.3, tx: 29 }, b5: { g: 6.3, tx: 28 }, beam: 360 },
  { id: 'netbox_5_ax', name: 'NetBox 5 ax + HGO omni', std: 'Wi-Fi 6', cat: 'Esterno', mount: 'Palo', b24: null, b5: { g: 6.3, tx: 28 }, beam: 360 },
  { id: 'mantbox_ax_15s', name: 'mANTBox ax 15s (settore)', std: 'Wi-Fi 6', cat: 'Settoriale', mount: 'Palo', b24: { g: 12, tx: 29 }, b5: { g: 15, tx: 28 }, beam: 120, est: 'Apertura settore assunta 120°' },
  { id: 'sxtsq_5ax', name: 'SXTsq 5 ax (direttiva)', std: 'Wi-Fi 6', cat: 'Settoriale', mount: 'Palo/parete', b24: null, b5: { g: 16, tx: 24 }, beam: 27, est: 'Apertura assunta 27°' },
  // ---- Wi-Fi 5 (802.11ac) ----
  { id: 'cap_xl_ac', name: 'cAP XL ac', std: 'Wi-Fi 5', cat: 'Interno', mount: 'Soffitto', b24: { g: 6, tx: 26 }, b5: { g: 5.5, tx: 26 }, beam: 360 },
  { id: 'cap_ac', name: 'cAP ac', std: 'Wi-Fi 5', cat: 'Interno', mount: 'Soffitto/parete', b24: { g: 2, tx: 26 }, b5: { g: 2.5, tx: 26 }, beam: 360 },
  { id: 'hap_ac3', name: 'hAP ac³', std: 'Wi-Fi 5', cat: 'Interno', mount: 'Tavolo', b24: { g: 3, tx: 26 }, b5: { g: 5.5, tx: 26 }, beam: 360 },
  { id: 'hap_ac2', name: 'hAP ac²', std: 'Wi-Fi 5', cat: 'Interno', mount: 'Tavolo/parete', b24: { g: 2.5, tx: 27 }, b5: { g: 2.5, tx: 26 }, beam: 360 },
  { id: 'hap_ac', name: 'hAP ac', std: 'Wi-Fi 5', cat: 'Interno', mount: 'Tavolo', b24: { g: 2.5, tx: 29 }, b5: { g: 2, tx: 28 }, beam: 360 },
  { id: 'hap_ac_lite', name: 'hAP ac lite / TC', std: 'Wi-Fi 5', cat: 'Interno', mount: 'Tavolo/parete', b24: { g: 1.5, tx: 22 }, b5: { g: 2, tx: 23 }, beam: 360 },
  { id: 'rb4011_wifi', name: 'RB4011iGS+5HacQ2HnD-IN', std: 'Wi-Fi 5', cat: 'Interno', mount: 'Tavolo/rack', b24: { g: 3, tx: 28 }, b5: { g: 3, tx: 33 }, beam: 360 },
  { id: 'chateau_lte6_us', name: 'Chateau LTE6-US', std: 'Wi-Fi 5', cat: 'Interno', mount: 'Tavolo', b24: { g: 3, tx: 26 }, b5: { g: 5.5, tx: 26 }, beam: 360 },
  { id: 'omnitik_5_ac', name: 'OmniTIK 5 PoE ac', std: 'Wi-Fi 5', cat: 'Esterno', mount: 'Palo', b24: null, b5: { g: 7.5, tx: 31 }, beam: 360 },
  { id: 'metal_52_ac', name: 'Metal 52 ac + omni', std: 'Wi-Fi 5', cat: 'Esterno', mount: 'Palo', b24: { g: 6, tx: 31 }, b5: { g: 6, tx: 31 }, beam: 360, est: 'Una banda alla volta (radio singola selezionabile)' },
  // ---- Wi-Fi 4 (802.11n, 2.4 GHz) ----
  { id: 'cap', name: 'cAP', std: 'Wi-Fi 4', cat: 'Interno', mount: 'Soffitto/parete', b24: { g: 2, tx: 22 }, b5: null, beam: 360 },
  { id: 'cap_lite', name: 'cAP lite', std: 'Wi-Fi 4', cat: 'Interno', mount: 'Soffitto/parete', b24: { g: 1.5, tx: 22 }, b5: null, beam: 360 },
  { id: 'hap_lite', name: 'hAP lite / TC', std: 'Wi-Fi 4', cat: 'Interno', mount: 'Tavolo', b24: { g: 1.5, tx: 22 }, b5: null, beam: 360 },
  { id: 'hap', name: 'hAP', std: 'Wi-Fi 4', cat: 'Interno', mount: 'Tavolo', b24: { g: 1.5, tx: 22 }, b5: null, beam: 360 },
  { id: 'rb951_2hnd', name: 'RB951Ui-2HnD', std: 'Wi-Fi 4', cat: 'Interno', mount: 'Tavolo', b24: { g: 2.5, tx: 30 }, b5: null, beam: 360 },
  { id: 'map', name: 'mAP', std: 'Wi-Fi 4', cat: 'Interno', mount: 'Portatile', b24: { g: 1.2, tx: 22 }, b5: null, beam: 360 },
  { id: 'map_lite', name: 'mAP lite', std: 'Wi-Fi 4', cat: 'Interno', mount: 'Portatile', b24: { g: 1.5, tx: 22 }, b5: null, beam: 360 },
  { id: 'wap_r', name: 'wAP R', std: 'Wi-Fi 4', cat: 'Esterno', mount: 'Parete/palo', b24: { g: 2, tx: 22 }, b5: null, beam: 360 },
  { id: 'knot', name: 'KNOT', std: 'Wi-Fi 4', cat: 'Interno', mount: 'Guida DIN', b24: { g: 1.5, tx: 22 }, b5: null, beam: 360 },
  { id: 'mantbox_2_12s', name: 'mANTBox 2 12s (settore)', std: 'Wi-Fi 4', cat: 'Settoriale', mount: 'Palo', b24: { g: 12, tx: 30 }, b5: null, beam: 120 },
];

/* Materiali: perdita per attraversamento = base + perCm * spessore(cm) * sec(angolo), per banda.
   Valori tipici da letteratura (ITU-R P.2040 / misure indoor), modificabili dall'utente. */
const DEFAULT_MATERIALS = [
  { id: 'ignora', name: 'Ignora (non ostacolo)', color: '#b9c2c0', b24: [0, 0], b5: [0, 0] },
  { id: 'auto', name: 'Auto da spessore', color: '#6d4c41', b24: [0, 0], b5: [0, 0] },
  { id: 'ca', name: 'Cemento armato', color: '#37474f', b24: [1, 0.55], b5: [2, 0.85] },
  { id: 'portante', name: 'Muratura portante / blocchi', color: '#5d4037', b24: [1, 0.42], b5: [2, 0.65] },
  { id: 'laterizio', name: 'Laterizio (mattoni)', color: '#a1553a', b24: [1, 0.35], b5: [1.5, 0.55] },
  { id: 'forato', name: 'Tramezzo forato', color: '#c77c52', b24: [1, 0.28], b5: [1.5, 0.45] },
  { id: 'cartongesso', name: 'Cartongesso', color: '#8d9e6a', b24: [1, 0.2], b5: [1.5, 0.3] },
  { id: 'vetro', name: 'Vetro', color: '#3b8fc4', b24: [3, 0], b5: [4, 0] },
  { id: 'vetro_le', name: 'Vetrocamera basso emissivo', color: '#1f5f8b', b24: [12, 0], b5: [18, 0] },
  { id: 'legno', name: 'Legno / porte', color: '#b08a3e', b24: [0.5, 0.6], b5: [1, 0.9] },
  { id: 'arredo', name: 'Arredi', color: '#9c8f6a', b24: [0.2, 0], b5: [0.3, 0] },
  { id: 'metallo', name: 'Metallo', color: '#546e7a', b24: [12, 0], b5: [15, 0] },
];

/* Classificazione "Auto da spessore" (spessore totale muro in metri) */
function autoMaterialFor(t) {
  if (t <= 0.135) return 'forato';
  if (t <= 0.28) return 'laterizio';
  return 'portante';
}

/* Ipotesi materiale dal nome layer */
function guessMaterialForLayer(name) {
  const n = name.toUpperCase();
  const has = (...k) => k.some(s => n.includes(s));
  if (has('QUOT', 'DIM', 'TEST', 'TEXT', 'HATCH', 'TRATT', 'CAMPIT', 'ASSI', 'GRID', 'DEFPOINT', 'CARTIG', 'TITLE', 'VIEWPORT', 'SEZ', 'SIMB', 'NOTE', 'LEGEND', 'ARROW', 'FRECC', 'LIVELL', 'PAVIM', 'ARIA', 'AREA', 'LOCALI', 'ROOM', 'SPACE', 'QUOTE')) return 'ignora';
  const tokens = n.split(/[^A-Z0-9]+/);
  if (tokens.includes('CA') || tokens.includes('CLS') || tokens.includes('C.A') || has('CEMENT', 'PILAST', 'CONCRETE', 'SETTO', 'SETTI', 'COLUMN', 'COLONN', 'STRUTT')) return 'ca';
  if (has('CARTON', 'GESS', 'GYPS', 'DRYWALL', 'PARTITION')) return 'cartongesso';
  if (has('VETR', 'GLASS', 'GLAZ', 'FINESTR', 'WINDOW', 'SERRAM', 'INFISS', 'VETRAT', 'CURTAIN')) return 'vetro';
  if (/PORT[AEI](?!NT)/.test(n) || has('DOOR')) return 'legno';
  if (has('PORTANT')) return 'portante';
  if (has('ARRED', 'FURN', 'MOBIL', 'SANIT', 'CUCIN', 'KITCHEN', 'EQUIP', 'TAVOL', 'SEDIE', 'LETT')) return 'arredo';
  if (has('METAL', 'ASCENS', 'ELEV', 'LIFT', 'ACCIAI', 'STEEL', 'SCAFF', 'RACK')) return 'metallo';
  if (has('MUR', 'WALL', 'PARET', 'TRAMEZ', 'TAMPON', 'MURAT')) return 'auto';
  if (n === '0') return 'auto';
  return 'auto';
}

/* Limiti EIRP (dBm) per canale.
   ETSI: EN 300 328 (2,4 GHz: 20 dBm), EN 301 893 (5150–5350: 23 dBm; 5470–5725: 30 dBm con TPC),
   5725–5875 (ch 149–165): SRD EN 300 440, 25 mW = 14 dBm. */
const REG_LIMITS = {
  etsi: { name: 'ETSI UE (limite per canale)', lim: (band, f) => band === '24' ? 20 : f < 5350 ? 23 : f < 5725 ? 30 : 14 },
  none: { name: 'Nessun limite (potenza max scheda)', lim: () => 99 },
};

/* Potenza TX massima (dBm) per banda e frequenza; usa i dati FCC per sotto-banda se presenti */
const wToDbm = (w) => 10 * Math.log10(w * 1000);
function maxTxFor(spec, f) {
  if (!spec) return null;
  if (spec.fcc) {
    const r = spec.fcc.find(([a, b]) => f >= a - 10 && f <= b + 10);
    if (r) return Math.round(wToDbm(r[2]) * 10) / 10;
  }
  return spec.tx;
}

if (typeof module !== 'undefined') module.exports = { MIKROTIK_CATALOG, DEFAULT_MATERIALS, autoMaterialFor, guessMaterialForLayer, REG_LIMITS, maxTxFor, wToDbm };
