'use strict';
const { contextBridge, ipcRenderer } = require('electron');

function send(level, message, detail) {
  try { ipcRenderer.send('log:renderer', { level: level, message: message, detail: detail }); } catch (e) {}
}

// Anything the renderer throws goes to the same log file instead of dying
// silently in a DevTools console nobody has open.
window.addEventListener('error', (e) => {
  send('error', 'Uncaught ' + (e.message || 'error'),
    (e.error && e.error.stack) || (e.filename + ':' + e.lineno + ':' + e.colno));
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  send('error', 'Unhandled promise rejection: ' + ((r && r.message) || r),
    (r && r.stack) || null);
});

contextBridge.exposeInMainWorld('fiddlerAPI', {
  startProxy: () => ipcRenderer.invoke('proxy:start'),
  stopProxy: () => ipcRenderer.invoke('proxy:stop'),
  proxyStatus: () => ipcRenderer.invoke('proxy:status'),
  // Alias kept because the renderer used to call status(); both work now.
  status: () => ipcRenderer.invoke('proxy:status'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getSession: (id) => ipcRenderer.invoke('sessions:get', id),
  clearSessions: () => ipcRenderer.invoke('sessions:clear'),
  composerSend: (payload) => ipcRenderer.invoke('composer:send', payload),

  // ---- logging ----
  logTail: (n) => ipcRenderer.invoke('log:tail', n),
  logFile: () => ipcRenderer.invoke('log:file'),
  logClear: () => ipcRenderer.invoke('log:clear'),
  logReveal: () => ipcRenderer.invoke('log:reveal'),
  logWrite: (level, message, detail) => send(level, message, detail),
  onLogLine: (cb) => {
    const h = (event, entry) => cb(entry);
    ipcRenderer.on('log:line', h);
    return () => ipcRenderer.removeListener('log:line', h);
  }
});
