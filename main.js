'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const log = require('./logger');
const { createEngine } = require('./proxy');

// Log file lives in the OS log folder: ~/Library/Logs/Fiddler/fiddler.log on macOS.
let logDir;
try { logDir = app.getPath('logs'); } catch (e) { logDir = path.join(app.getPath('userData'), 'logs'); }
log.init(logDir);
log.info('app', 'Fiddler ' + app.getVersion() + ' starting (electron ' + process.versions.electron + ', node ' + process.versions.node + ')');
log.info('app', 'Log file: ' + log.file());

process.on('uncaughtException', (err) => log.error('main', 'Uncaught exception', err));
process.on('unhandledRejection', (err) => log.error('main', 'Unhandled rejection', err));

const engine = createEngine(log);
const PROXY_PORT = 8888;

ipcMain.handle('proxy:start', async () => {
  log.info('proxy', 'Start requested on port ' + PROXY_PORT);
  try {
    const s = await engine.start(PROXY_PORT);
    log.info('proxy', 'Started and listening on 127.0.0.1:' + s.port);
    return s;
  } catch (e) {
    log.error('proxy', 'Start failed on port ' + PROXY_PORT, e);
    const s = engine.status();
    s.error = String((e && e.message) || e);
    return s;
  }
});
ipcMain.handle('proxy:stop', async () => {
  log.info('proxy', 'Stop requested');
  try {
    const s = await engine.stop();
    log.info('proxy', 'Stopped');
    return s;
  } catch (e) {
    log.error('proxy', 'Stop failed', e);
    const s = engine.status();
    s.error = String((e && e.message) || e);
    return s;
  }
});
ipcMain.handle('proxy:status', () => engine.status());
ipcMain.handle('sessions:list', () => engine.list());
ipcMain.handle('sessions:get', (event, id) => engine.get(id));
ipcMain.handle('sessions:clear', () => { engine.clear(); log.info('sessions', 'Cleared'); return { ok: true }; });
ipcMain.handle('composer:send', async (event, payload) => {
  const p = payload || {};
  log.info('composer', (p.method || 'GET') + ' ' + (p.url || '(no url)'));
  try {
    const s = await engine.composerSend(p);
    if (s && s.error) log.error('composer', 'Request failed: ' + s.error);
    else log.info('composer', 'Response ' + (s && s.status) + ' in ' + (s && s.durationMs) + ' ms');
    return s;
  } catch (e) {
    log.error('composer', 'Composer threw', e);
    return { error: String((e && e.message) || e) };
  }
});

// ---- Log panel IPC ----
ipcMain.handle('log:tail', (event, n) => log.tail(n));
ipcMain.handle('log:file', () => log.file());
ipcMain.handle('log:clear', () => { log.clear(); log.info('log', 'Log panel cleared'); return { ok: true }; });
ipcMain.handle('log:reveal', () => {
  const f = log.file();
  if (!f) return { ok: false, error: 'No log file (see console output)' };
  shell.showItemInFolder(f);
  return { ok: true, file: f };
});
// Errors raised inside the renderer land in the same log file.
ipcMain.on('log:renderer', (event, entry) => {
  const e = entry || {};
  log.raw(e.level || 'error', 'renderer', e.message || '(no message)', e.detail || null);
});

let win = null;
let unsubscribe = null;

// Packaged builds get the icon from the bundle; in dev (`npm start`) the dock
// would otherwise show the generic Electron icon.
function setDevDockIcon() {
  if (app.isPackaged || process.platform !== 'darwin' || !app.dock) return;
  const icon = path.join(__dirname, 'build', 'icon.png');
  try {
    if (require('fs').existsSync(icon)) app.dock.setIcon(icon);
  } catch (e) {
    log.warn('app', 'Could not set dock icon: ' + (e && e.message));
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win.loadFile('index.html');

  // Push every new log line straight into the Log panel.
  if (unsubscribe) unsubscribe();
  unsubscribe = log.subscribe((entry) => {
    if (win && !win.isDestroyed() && win.webContents) {
      try { win.webContents.send('log:line', entry); } catch (e) {}
    }
  });

  win.webContents.on('render-process-gone', (e, details) =>
    log.error('window', 'Renderer process gone: ' + details.reason));
  win.webContents.on('preload-error', (e, file, error) =>
    log.error('window', 'Preload error in ' + file, error));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  setDevDockIcon();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { log.info('app', 'Quitting'); engine.stop(); });
