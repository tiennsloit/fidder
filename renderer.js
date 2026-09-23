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

let sessions = [];
let selectedId = null;
let activeTab = 'resBody';
let dirty = true;

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
      + '<td>' + esc(s.kind) + '</td>'
      + '<td>' + esc(s.method) + '</td>'
      + '<td class="url" title="' + esc(s.url) + '">' + esc(s.url) + '</td>'
      + '<td>' + esc(s.time || '') + '</td>'
      + '<td>' + (s.elapsed != null ? s.elapsed : '') + '</td>'
      + '<td>' + fmtBytes(s.responseBodyBytes || 0) + '</td>'
      + '<td class="err">' + esc(s.error || '') + '</td>'
      + '</tr>';
  }
  tbody.innerHTML = h;
}

function renderInspector() {
  const s = sessions.find((x) => x.id === selectedId);
  if (!s) {
    info.textContent = 'No session selected';
    pre.textContent = '';
    return;
  }
  info.textContent = s.method + ' ' + (s.url || s.target) + '  ->  ' + statusText(s) + (s.elapsed != null ? '  (' + s.elapsed + ' ms)' : '');
  if (activeTab === 'reqHeaders') pre.textContent = headersText(s.options ? s.options.headers : null);
  else if (activeTab === 'reqBody') pre.textContent = s.requestBody || '(empty)';
  else if (activeTab === 'resHeaders') pre.textContent = s.statusLine ? (s.statusLine + '\n\n' + headersText(s.responseHeaders)) : headersText(s.responseHeaders);
  else pre.textContent = pretty(s.responseBody, s.responseHeaders ? s.responseHeaders['content-type'] : '');
}

async function poll() {
  try {
    const st = await window.fiddlerAPI.status();
    if (st.running) {
      badge.textContent = 'o Proxy running on 127.0.0.1:' + st.port;
      badge.className = 'badge on';
      startBtn.disabled = true; stopBtn.disabled = false;
    } else {
      badge.textContent = 'o Proxy stopped';
      badge.className = 'badge off';
      startBtn.disabled = false; stopBtn.disabled = true;
    }
    sessions = await window.fiddlerAPI.listSessions();
    if (selectedId && !sessions.find((x) => x.id === selectedId)) selectedId = null;
    renderTable();
    renderInspector();
    if (dirty) { const wrap = byId('tableWrap'); wrap.scrollTop = wrap.scrollHeight; dirty = true; }
  } catch (e) {}
}

startBtn.onclick = async () => {
  startBtn.disabled = true;
  try {
    const r = await window.fiddlerAPI.startProxy();
    if (r && r.error) alert('Proxy failed: ' + r.error);
  } catch (e) {
    alert('Proxy failed: ' + ((e && e.message) || e));
  }
  await poll();
};
stopBtn.onclick = async () => {
  try { await window.fiddlerAPI.stopProxy(); } catch (e) { alert('Stop failed: ' + ((e && e.message) || e)); }
  await poll();
};
clearBtn.onclick = async () => {
  try { await window.fiddlerAPI.clearSessions(); } catch (e) {}
  selectedId = null;
  poll();
};
composerToggle.onclick = () => {
  composerPanel.style.display = composerPanel.style.display === 'block' ? 'none' : 'block';
};
tbody.onclick = (e) => {
  const tr = e.target.closest('tr.row');
  if (tr) { selectedId = Number(tr.dataset.id); dirty = false; renderTable(); renderInspector(); }
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
  const r = await window.fiddlerAPI.composerSend({
    method: compMethod.value,
    url: compUrl.value,
    headers: parseHeaders(compHeaders.value),
    body: compBody.value,
  });
  compSend.disabled = false;
  if (r && r.error) alert('Composer error: ' + r.error);
  else if (r && r.id) selectedId = r.id;
  poll();
};

poll();
setInterval(() => { poll(); }, 1000);
