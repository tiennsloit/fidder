'use strict';
const fs = require('fs');
const path = require('path');

const MAX_BUFFER = 2000;      // lines kept in memory for the in-app Log panel
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const buffer = [];
let seq = 0;
let logFile = null;
let sinks = [];               // functions that receive each new entry (renderer push)

function ts() {
  return new Date().toISOString();
}

function rotateIfBig() {
  if (!logFile) return;
  try {
    const st = fs.statSync(logFile);
    if (st.size > MAX_FILE_BYTES) fs.renameSync(logFile, logFile + '.1');
  } catch (e) { /* file may not exist yet */ }
}

// dir: directory the log file lives in. Safe to call more than once.
function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'fiddler.log');
    rotateIfBig();
    fs.appendFileSync(logFile, '\n=== Fiddler started ' + ts() + ' ===\n');
  } catch (e) {
    logFile = null;
    buffer.push({ id: ++seq, time: ts(), level: 'error', scope: 'logger',
      message: 'Could not open log file in ' + dir + ': ' + (e && e.message) });
  }
  return logFile;
}

function log(level, scope, message, detail) {
  const entry = {
    id: ++seq,
    time: ts(),
    level: level || 'info',           // info | warn | error
    scope: scope || 'app',
    message: String(message == null ? '' : message),
    detail: detail == null ? null : (typeof detail === 'string' ? detail : safeJson(detail))
  };
  buffer.push(entry);
  while (buffer.length > MAX_BUFFER) buffer.shift();

  const line = entry.time + ' [' + entry.level.toUpperCase() + '] [' + entry.scope + '] '
    + entry.message + (entry.detail ? '\n    ' + entry.detail.replace(/\n/g, '\n    ') : '') + '\n';
  if (logFile) {
    try { fs.appendFileSync(logFile, line); } catch (e) { /* disk full / permissions */ }
  }
  // Always mirror to stdout so `npm start` from a terminal shows the same stream.
  process.stdout.write(line);

  for (const s of sinks) {
    try { s(entry); } catch (e) { /* a dead window must not break logging */ }
  }
  return entry;
}

function safeJson(v) {
  try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
}

function errorDetail(e) {
  if (!e) return null;
  if (e instanceof Error) return (e.stack || (e.name + ': ' + e.message));
  return typeof e === 'string' ? e : safeJson(e);
}

module.exports = {
  init,
  file: () => logFile,
  dir: () => (logFile ? path.dirname(logFile) : null),
  tail: (n) => buffer.slice(-(n || MAX_BUFFER)),
  clear: () => { buffer.length = 0; },
  subscribe: (fn) => { sinks.push(fn); return () => { sinks = sinks.filter((s) => s !== fn); }; },
  info: (scope, msg, detail) => log('info', scope, msg, detail),
  warn: (scope, msg, detail) => log('warn', scope, msg, detail),
  error: (scope, msg, err) => log('error', scope, msg, errorDetail(err)),
  raw: log
};
