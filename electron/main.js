// APlanner – applicazione desktop (Electron)
// Incapsula la web app (dist/WiFiCoverage.html) in una finestra nativa,
// senza modificarne la logica: tutto il calcolo di copertura resta nel browser incorporato.
'use strict';
const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_HTML = path.join(__dirname, '..', 'dist', 'WiFiCoverage.html');
const isMac = process.platform === 'darwin';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0e1420',
    show: false,
    autoHideMenuBar: !isMac,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(APP_HTML);

  // apre eventuali link esterni (es. documentazione) nel browser di sistema, non nella finestra dell'app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Le esportazioni dell'app (PNG, DXF, PDF, progetto .wifimap.json) usano un normale
// <a download>: qui intercettiamo il download per mostrare una finestra "Salva con nome"
// nativa invece di salvare silenziosamente, cosa che il browser incorporato non farebbe da solo.
function setupDownloads() {
  session.defaultSession.on('will-download', (event, item) => {
    const suggested = item.getFilename();
    const defaultDir = fs.existsSync(app.getPath('documents')) ? app.getPath('documents') : app.getPath('downloads');
    const chosen = dialog.showSaveDialogSync(mainWindow, {
      title: 'Salva file',
      defaultPath: path.join(defaultDir, suggested),
    });
    if (chosen) {
      item.setSavePath(chosen);
    } else {
      item.cancel();
    }
  });
}

function buildMenu() {
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit', label: 'Esci' },
      ],
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'undo', label: 'Annulla' },
        { role: 'redo', label: 'Ripeti' },
        { type: 'separator' },
        { role: 'cut', label: 'Taglia' },
        { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'selectAll', label: 'Seleziona tutto' },
      ],
    },
    {
      label: 'Vista',
      submenu: [
        { role: 'reload', label: 'Ricarica' },
        { role: 'toggleDevTools', label: 'Strumenti sviluppo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normale' },
        { role: 'zoomIn', label: 'Aumenta zoom' },
        { role: 'zoomOut', label: 'Riduci zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
      ],
    },
    {
      label: 'Finestra',
      submenu: [
        { role: 'minimize', label: 'Riduci a icona' },
        ...(isMac ? [{ role: 'zoom', label: 'Zoom' }, { role: 'front', label: 'Porta tutto avanti' }] : [{ role: 'close', label: 'Chiudi' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  setupDownloads();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
