// Equivalente Node di build.py: concatena src/ in dist/artifact.html e dist/WiFiCoverage.html.
// Usato dagli script npm (build:web) così la build non dipende dal comando "python3",
// che su Windows spesso non esiste (solo "python") e rompeva la compilazione in CI.
'use strict';
const fs = require('fs');
const path = require('path');

const src = (...p) => path.join('src', ...p);
const read = (p) => fs.readFileSync(p, 'utf8');

const css = read(src('style.css'));
const body = read(src('body.html'));
const js = ['catalog.js', 'dxf.js', 'engine.js', 'pdfplan.js', 'demo.js', 'app.js']
  .map((f) => read(src(f)))
  .join('\n');
const vendor =
  '<script>\n' + read(src('vendor', 'pdf.min.js')) + '\n</script>\n' +
  '<script type="text/plain" id="pdfjs-worker">\n' + read(src('vendor', 'pdf.worker.min.js')) + '\n</script>\n' +
  '<script>\n' + read(src('vendor', 'jspdf.umd.min.js')) + '\n</script>\n';

const head =
  '<title>WiFi Coverage Planner</title>\n' +
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">\n' +
  '<style>\n' + css + '</style>\n';

fs.mkdirSync('dist', { recursive: true });

const artifact = head + body + vendor + '<script>\n' + js + '\n</script>\n';
fs.writeFileSync(path.join('dist', 'artifact.html'), artifact);

const full =
  '<!DOCTYPE html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  head + '</head>\n<body>\n' + body + vendor + '<script>\n' + js + '\n</script>\n</body>\n</html>\n';
fs.writeFileSync(path.join('dist', 'WiFiCoverage.html'), full);

console.log(full.length);
