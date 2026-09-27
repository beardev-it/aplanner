# APlanner

Pianificazione della copertura WiFi: posiziona access point MikroTik su una pianta CAD (DXF o PDF in scala) e calcola la mappa di copertura tenendo conto di pareti, arredi e spessore degli ostacoli.

Il cuore dell'applicazione è una web app in un unico file HTML (nessuna dipendenza esterna, funziona anche offline). Questo repository la incapsula anche come app desktop nativa (Electron) per Windows, macOS e Linux.

## Struttura del progetto

```
src/            sorgenti della web app (catalog.js, dxf.js, engine.js, pdfplan.js, app.js, body.html, style.css)
src/vendor/     librerie di terze parti vendorizzate (pdf.js, jsPDF)
build.py        concatena src/ in dist/WiFiCoverage.html (web app autonoma) e dist/artifact.html
dist/           output della build web + LEGGIMI.md (guida utente in italiano)
electron/       wrapper Electron (finestra nativa, menu, gestione dei download/esportazioni)
build-resources/ icona dell'app
samples/        piante DXF/PDF di prova
test/           script Playwright per i test automatici
.github/workflows/build.yml  compila gli installer per Windows/macOS/Linux e li pubblica su GitHub Release
```

## Uso rapido (solo web app)

`dist/WiFiCoverage.html` è autosufficiente: si apre così com'è in Chrome o Edge, senza installare nulla.

## Sviluppo dell'app desktop

Richiede Node.js 22+.

```bash
npm install          # installa Electron ed electron-builder
npm start             # ricompila la web app e apre l'app desktop in modalità sviluppo
```

## Creare gli installer

```bash
npm run dist:linux    # AppImage + .deb (compilabile su Linux)
npm run dist:win      # installer NSIS (.exe) — richiede Windows, o Wine su Linux/Mac
npm run dist:mac      # .dmg + .zip — richiede macOS
npm run dist:all      # tutti e tre, se l'ambiente lo consente
```

Gli installer generati sono in `release/`.

### Build automatica multipiattaforma (consigliata)

Compilare macOS richiede un Mac reale (Apple non consente la compilazione incrociata) e la build Windows è più affidabile su un runner Windows nativo. Il workflow `.github/workflows/build.yml` risolve il problema compilando su GitHub Actions, che fornisce macchine Windows, macOS e Linux reali:

- **push di un tag** `v1.0.0` (es. `git tag v1.0.0 && git push origin v1.0.0`) → compila su tutti e tre i sistemi e pubblica automaticamente una GitHub Release con gli installer allegati;
- **avvio manuale** (tab "Actions" → "Build APlanner" → "Run workflow") → compila e carica gli installer come artifact, senza pubblicare una release;
- **pull request** → compila per verificare che tutto funzioni, senza pubblicare nulla.

## Licenza

Uso interno.
