'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createEngine } = require('./proxy');

const engine = createEngine();
const PROXY_PORT = 8888;

ipcMain.handle('proxy:start', async () => {
  try {
    return await engine.start(PROXY_PORT);
  } catch (e) {
    const s = engine.status();
    s.error = String((e && e.message) || e);
    return s;
  }
});
ipcMain.handle('proxy:stop', () => engine.stop());
ipcMain.handle('proxy:status', () => engine.status());
ipcMain.handle('sessions:list', () => engine.list());
ipcMain.handle('sessions:get', (event, id) => engine.get(id));
ipcMain.handle('sessions:clear', () => { engine.clear(); return { ok: true }; });
ipcMain.handle('composer:send', (event, payload) => engine.composerSend(payload || {}));

let win = null;
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
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { engine.stop(); });
