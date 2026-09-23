'use strict';
const byId = (id) => document.getElementById(id);
const tbody = byId('tblBody');
const pre = byId('inspectorPre');
const info = byId('sessionInfo');
const startBtn = byId('startBtn');
const stopBtn = byId('stopBtn');
const clearBtn = byId('clearBtn');
const badge = byId('proxyBadge');
const composerToggle = byId('composerToggle');
const composerPanel = byId('composerPanel');
const compMethod = byId('compMethod');
const compUrl = byId('compUrl');
const compHeaders = byId('compHeaders');
const compBody = byId('compBody');
const compSend = byId('compSend');
const logToggle = byId('logToggle');
const logPanel = byId('logPanel');
const logPre = byId('logPre');
const logPathEl = byId('logPath');
const logRevealBtn = byId('logRevealBtn');
const logClearBtn = byId('logClearBtn');

const API = window.fiddlerAPI;

let sessions = [];
let selected = null;      // full session object from getSession()
let selectedId = null;
let activeTab = 'resBody';
let autoScroll = true;

function uiLog(level, message, detail) {
  try { API.logWrite(level, message, detail); } catch (e) {}
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function fmtBytes(n) {
  n = n || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toTimeString().slice(0, 8);
}
function headersText(h) {
  if (!h) return '(none)';
  return Object.entries(h).map(([k, v]) => k + ': ' + v).join('\n') || '(none)';
}
function pretty(body, contentType) {
  if (!body) return '(empty)';
  if (contentType && contentType.indexOf('json') !== -1) {
    try { return JSON.stringify(JSON.parse(body), null, 2); } catch (e) {}
  }
  return body;
}
function statusClass(st) {
  if (!st) return 'st0';
  return 'st' + Math.floor(st / 100);
}
function statusText(s) {
  return s.status ? String(s.status) : (s.error ? 'ERR' : '---');
}

function renderTable() {
  if (!sessions.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No sessions captured yet</td></tr>';
    return;
  }
  let h = '';
  for (const s of sessions.slice(-300)) {
    h += '<tr class="row' + (s.id === selectedId ? ' selected' : '') + '" data-id="' + s.id + '">'
      + '<td>' + s.id + '</td>'
      + '<td class="' + statusClass(s.status) + '">' + statusText(s) + '</td>'
      + '<td>' + esc(s.protocol) + '</td>'
      + '<td>' + esc(s.method) + '</td>'
      + '<td class="url" title="' + esc(s.url) + '">' + esc(s.url) + '</td>'
      + '<td>' + esc(fmtTime(s.time)) + '</td>'
      + '<td>' + (s.durationMs != null ? s.durationMs : '') + '</td>'
      + '<td>' + fmtBytes(s.size || 0) + '</td>'
      + '<td class="err">' + esc(s.error || '') + '</td>'
      + '</tr>';
  }
  tbody.innerHTML = h;
}

function renderInspector() {
  const s = selected;
  if (!s) {
    info.textContent = 'No session selected';
    pre.textContent = '';
    return;
  }
  info.textContent = s.method + ' ' + s.url + '  ->  ' + statusText(s)
    + (s.durationMs != null ? '  (' + s.durationMs + ' ms)' : '')
    + (s.error ? '  [' + s.error + ']' : '');
  if (activeTab === 'reqHeaders') pre.textContent = headersText(s.reqHeaders);
  else if (activeTab === 'reqBody') pre.textContent = s.reqBody || '(empty)';
  else if (activeTab === 'resHeaders') pre.textContent = headersText(s.resHeaders);
  else {
    pre.textContent = pretty(s.resBody, s.resHeaders ? s.resHeaders['content-type'] : '')
      + (s.resBodyTruncated ? '\n\n--- truncated at 200 KB ---' : '');
  }
}

async function selectSession(id) {
  selectedId = id;
  autoScroll = false;
  try {
    selected = await API.getSession(id);
  } catch (e) {
    selected = null;
    uiLog('error', 'Could not load session ' + id, (e && e.stack) || String(e));
  }
  renderTable();
  renderInspector();
}

async function poll() {
  try {
    const st = await API.proxyStatus();
    if (st && st.running) {
      badge.textContent = '● Proxy running on 127.0.0.1:' + st.port;
      badge.className = 'badge on';
      startBtn.disabled = true; stopBtn.disabled = false;
    } else {
      badge.textContent = '● Proxy stopped';
      badge.className = 'badge off';
      startBtn.disabled = false; stopBtn.disabled = true;
    }
    sessions = await API.listSessions();
    if (selectedId && !sessions.find((x) => x.id === selectedId)) {
      selectedId = null; selected = null;
    }
    renderTable();
    renderInspector();
    if (autoScroll) { const wrap = byId('tableWrap'); wrap.scrollTop = wrap.scrollHeight; }
  } catch (e) {
    // Never swallow this again - a broken poll is exactly what hid the
    // "proxy is running" state before.
    badge.textContent = '● UI error - see Log';
    badge.className = 'badge off';
    uiLog('error', 'poll() failed: ' + ((e && e.message) || e), (e && e.stack) || null);
  }
}

startBtn.onclick = async () => {
  startBtn.disabled = true;
  uiLog('info', 'Start Proxy clicked');
  try {
    const r = await API.startProxy();
    if (r && r.error) {
      uiLog('error', 'Proxy start failed: ' + r.error);
      showLog();
      alert('Proxy failed: ' + r.error);
    }
  } catch (e) {
    uiLog('error', 'startProxy threw: ' + ((e && e.message) || e), (e && e.stack) || null);
    showLog();
    alert('Proxy failed: ' + ((e && e.message) || e));
  }
  await poll();
};
stopBtn.onclick = async () => {
  uiLog('info', 'Stop Proxy clicked');
  try { await API.stopProxy(); }
  catch (e) {
    uiLog('error', 'stopProxy threw: ' + ((e && e.message) || e), (e && e.stack) || null);
    alert('Stop failed: ' + ((e && e.message) || e));
  }
  await poll();
};
clearBtn.onclick = async () => {
  try { await API.clearSessions(); } catch (e) { uiLog('error', 'clearSessions failed', String(e)); }
  selectedId = null; selected = null; autoScroll = true;
  poll();
};
composerToggle.onclick = () => {
  composerPanel.style.display = composerPanel.style.display === 'block' ? 'none' : 'block';
};

// ---- Log panel ----
function logLineHtml(e) {
  return '<div class="logline lv-' + esc(e.level) + '">'
    + '<span class="lt">' + esc((e.time || '').slice(11, 23)) + '</span> '
    + '<span class="ls">[' + esc(e.scope) + ']</span> '
    + esc(e.message)
    + (e.detail ? '<div class="ld">' + esc(e.detail) + '</div>' : '')
    + '</div>';
}
function appendLog(e) {
  const atBottom = logPre.scrollTop + logPre.clientHeight >= logPre.scrollHeight - 30;
  logPre.insertAdjacentHTML('beforeend', logLineHtml(e));
  while (logPre.childElementCount > 2000) logPre.removeChild(logPre.firstElementChild);
  if (atBottom) logPre.scrollTop = logPre.scrollHeight;
}
function showLog() {
  logPanel.style.display = 'flex';
  logPre.scrollTop = logPre.scrollHeight;
}
logToggle.onclick = () => {
  if (logPanel.style.display === 'flex') logPanel.style.display = 'none';
  else showLog();
};
logRevealBtn.onclick = async () => {
  const r = await API.logReveal();
  if (r && !r.ok) alert(r.error || 'No log file');
};
logClearBtn.onclick = async () => {
  await API.logClear();
  logPre.innerHTML = '';
};

tbody.onclick = (e) => {
  const tr = e.target.closest('tr.row');
  if (tr) selectSession(Number(tr.dataset.id));
};
document.querySelectorAll('.tab').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    activeTab = b.dataset.tab;
    renderInspector();
  };
});
function parseHeaders(t) {
  const o = {};
  for (const line of t.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return o;
}
compSend.onclick = async () => {
  if (!compUrl.value) { alert('Enter a URL first'); return; }
  compSend.disabled = true;
  try {
    const r = await API.composerSend({
      method: compMethod.value,
      url: compUrl.value,
      headers: parseHeaders(compHeaders.value),
      body: compBody.value,
    });
    if (r && r.error) alert('Composer error: ' + r.error);
    else if (r && r.id) { await poll(); await selectSession(r.id); compSend.disabled = false; return; }
  } catch (e) {
    uiLog('error', 'composerSend threw: ' + ((e && e.message) || e), (e && e.stack) || null);
    alert('Composer error: ' + ((e && e.message) || e));
  }
  compSend.disabled = false;
  poll();
};

async function initLog() {
  try {
    const file = await API.logFile();
    logPathEl.textContent = file || '(log file unavailable - stdout only)';
    logPathEl.title = file || '';
    const lines = await API.logTail(500);
    logPre.innerHTML = lines.map(logLineHtml).join('');
    logPre.scrollTop = logPre.scrollHeight;
    API.onLogLine(appendLog);
  } catch (e) {
    logPathEl.textContent = 'Log bridge unavailable: ' + ((e && e.message) || e);
  }
}

initLog();
poll();
setInterval(poll, 1000);
