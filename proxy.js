'use strict';
const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns');
const { URL } = require('url');

const MAX_BODY = 200 * 1024; // capture at most 200 KB per body
const MAX_SESSIONS = 500;
const UPSTREAM_TIMEOUT = 30000;
function FDL(m){if(!process.env.FIDDLER_DEBUG)return;try{require('fs').appendFileSync('/tmp/fiddler-debug.log',new Date().toISOString()+' '+m+String.fromCharCode(10));}catch(e){}}
try { net.setDefaultAutoSelectFamily(true); } catch (e) {}
try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}

function createEngine() {
  const sessions = [];
  let nextId = 1;

  function addSession(s) {
    s.id = nextId++;
    sessions.push(s);
    while (sessions.length > MAX_SESSIONS) sessions.shift();
    return s;
  }

  function collect(stream, cb) {
    const chunks = [];
    let size = 0;
    let truncated = false;
    stream.on('data', (c) => {
      if (size + c.length > MAX_BODY) {
        const room = MAX_BODY - size;
        if (room > 0) chunks.push(c.slice(0, room));
        size = MAX_BODY;
        truncated = true;
      } else {
        chunks.push(c);
        size += c.length;
      }
    });
    stream.on('end', () => cb(null, Buffer.concat(chunks), truncated));
    stream.on('error', (err) => cb(err, Buffer.concat(chunks), truncated));
  }

  // ---- Plain HTTP forward proxy: captures full request + response ----
  function handleProxyRequest(clientReq, clientRes) {
    const started = Date.now();
    FDL('ENTER '+clientReq.method+' '+clientReq.url);
    let targetUrl = clientReq.url;
    if (!/^https?:\/\//i.test(targetUrl)) {
      const host = clientReq.headers.host || 'localhost';
      targetUrl = 'http://' + host + targetUrl;
    }
    let target;
    try {
      target = new URL(targetUrl);
    } catch (e) {
      clientRes.writeHead(400, { 'Content-Type': 'text/plain' });
      clientRes.end('Bad proxy request URL: ' + clientReq.url);
      return;
    }

      collect(clientReq, (reqErr, reqBody) => {
        FDL('COLLECTED_REQ err='+(reqErr&&reqErr.message));
      const fwdHeaders = Object.assign({}, clientReq.headers);
      delete fwdHeaders['proxy-connection'];
      fwdHeaders.host = target.host;
      fwdHeaders['content-length'] = reqBody.length;

      const lib = target.protocol === 'https:' ? https : http;
      const upReq = lib.request({
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: clientReq.method,
        headers: fwdHeaders
      }, (upRes) => {
        FDL('UPRES '+upRes.statusCode+' te='+upRes.headers['transfer-encoding']+' cl='+upRes.headers['content-length']);
        collect(upRes, (resErr, resBody, resTrunc) => {
          addSession({
            kind: 'proxy',
            time: new Date(started).toISOString(),
            durationMs: Date.now() - started,
            method: clientReq.method,
            url: target.href,
            host: target.host,
            protocol: target.protocol.replace(':', ''),
            reqHeaders: clientReq.headers,
            reqBody: reqBody.toString('utf8'),
            status: upRes.statusCode,
            resHeaders: upRes.headers,
            resBody: resBody.toString('utf8'),
            resBodyTruncated: resTrunc,
            size: resBody.length,
            error: resErr ? String(resErr.message || resErr) : null
          });
          const headers = Object.assign({}, upRes.headers);
          for (const h of ['transfer-encoding', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade']) delete headers[h];
          headers['content-length'] = resBody.length;
          clientRes.writeHead(upRes.statusCode, headers);
          clientRes.end(resBody);
          FDL('SENT '+upRes.statusCode+' len='+(resBody&&resBody.length));
        });
      });
       upReq.setTimeout(UPSTREAM_TIMEOUT, () => upReq.destroy(new Error('Upstream timeout')));
       const connectWatch = setTimeout(() => upReq.destroy(new Error('Upstream connect timeout')), 10000);
       upReq.on('response', () => clearTimeout(connectWatch));
       upReq.on('error', () => clearTimeout(connectWatch));
       upReq.on('close', () => clearTimeout(connectWatch));
      upReq.on('error', (err) => {
        FDL('UPREQ_ERR '+(err && err.message));
        addSession({
          kind: 'proxy',
          time: new Date(started).toISOString(),
          durationMs: Date.now() - started,
          method: clientReq.method,
          url: target.href,
          host: target.host,
          protocol: target.protocol.replace(':', ''),
          reqHeaders: clientReq.headers,
          reqBody: reqBody.toString('utf8'),
          status: 502,
          resHeaders: {},
          resBody: String(err.message || err),
          resBodyTruncated: false,
          size: 0,
          error: String(err.message || err)
        });
        if (!clientRes.headersSent) clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
        clientRes.end('Proxy upstream error: ' + (err.message || err));
      });
      if (reqBody.length) upReq.write(reqBody);
      upReq.end();
    });
  }

  // ---- HTTPS CONNECT tunnel (encrypted; we log the tunnel itself) ----
  function handleConnect(clientReq, clientSocket, head) {
    const started = Date.now();
    const parts = (clientReq.url || '').split(':');
    const host = parts[0];
    const port = parseInt(parts[1], 10) || 443;
    const upstream = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
      addSession({
        kind: 'tunnel',
        time: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        method: 'CONNECT',
        url: 'https://' + host + ':' + port,
        host: host + ':' + port,
        protocol: 'https',
        reqHeaders: clientReq.headers || {},
        reqBody: '',
        status: 200,
        resHeaders: {},
        resBody: '(HTTPS tunnel - the traffic is encrypted; body capture would need a CA certificate, not included in this simple build)',
        resBodyTruncated: false,
        size: 0,
        error: null
      });
    });
    upstream.on('error', (err) => {
      addSession({
        kind: 'tunnel',
        time: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        method: 'CONNECT',
        url: 'https://' + host + ':' + port,
        host: host + ':' + port,
        protocol: 'https',
        reqHeaders: clientReq.headers || {},
        reqBody: '',
        status: 502,
        resHeaders: {},
        resBody: '',
        resBodyTruncated: false,
        size: 0,
        error: String(err.message || err)
      });
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
    clientSocket.on('error', () => upstream.destroy());
  }

  // ---- Composer: fire an HTTP request straight from the app ----
  function composerSend(payload) {
    return new Promise((resolve) => {
      const started = Date.now();
      const method = (payload.method || 'GET').toUpperCase();
      let target;
      try {
        target = new URL(payload.url);
      } catch (e) {
        return resolve(addSession({
          kind: 'composer', time: new Date(started).toISOString(), durationMs: 0,
          method: method, url: payload.url, host: '-', protocol: '-',
          reqHeaders: payload.headers || {}, reqBody: payload.body || '',
          status: 0, resHeaders: {}, resBody: '', resBodyTruncated: false, size: 0,
          error: 'Invalid URL'
        }));
      }
      const lib = target.protocol === 'https:' ? https : http;
      const bodyBuf = Buffer.from(payload.body || '', 'utf8');
      const headers = Object.assign({}, payload.headers || {});
      if (bodyBuf.length) headers['content-length'] = bodyBuf.length;
      const req = lib.request({
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: method,
        headers: headers
      }, (res) => {
        collect(res, (resErr, resBody, resTrunc) => {
          resolve(addSession({
            kind: 'composer',
            time: new Date(started).toISOString(),
            durationMs: Date.now() - started,
            method: method,
            url: target.href,
            host: target.host,
            protocol: target.protocol.replace(':', ''),
            reqHeaders: headers,
            reqBody: payload.body || '',
            status: res.statusCode,
            resHeaders: res.headers,
            resBody: resBody.toString('utf8'),
            resBodyTruncated: resTrunc,
            size: resBody.length,
            error: resErr ? String(resErr.message || resErr) : null
          }));
        });
      });
      req.setTimeout(UPSTREAM_TIMEOUT, () => req.destroy(new Error('Request timeout')));
      req.on('error', (err) => {
        resolve(addSession({
          kind: 'composer',
          time: new Date(started).toISOString(),
          durationMs: Date.now() - started,
          method: method,
          url: target.href,
          host: target.host,
          protocol: target.protocol.replace(':', ''),
          reqHeaders: headers,
          reqBody: payload.body || '',
          status: 0,
          resHeaders: {},
          resBody: '',
          resBodyTruncated: false,
          size: 0,
          error: String(err.message || err)
        }));
      });
      if (bodyBuf.length) req.write(bodyBuf);
      req.end();
    });
  }

  const server = http.createServer(handleProxyRequest);
  server.on('connect', handleConnect);

  let running = false;
  let currentPort = null;

  const engine = {
    start(port) {
      return new Promise((resolve, reject) => {
        if (running) return resolve(engine.status());
        server.once('error', reject);
        server.listen(port || 8888, '127.0.0.1', () => {
          server.removeListener('error', reject);
          running = true;
          currentPort = server.address().port;
          resolve(engine.status());
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        if (!running) return resolve(engine.status());
        if (server.closeAllConnections) server.closeAllConnections();
        server.close(() => { running = false; resolve(engine.status()); });
      });
    },
    status() {
      return { running: running, port: currentPort, count: sessions.length };
    },
    list() {
      return sessions.map((s) => ({
        id: s.id, kind: s.kind, time: s.time, method: s.method, url: s.url,
        host: s.host, protocol: s.protocol, status: s.status,
        durationMs: s.durationMs, size: s.size, error: s.error
      }));
    },
    get(id) {
      return sessions.find((s) => s.id === Number(id)) || null;
    },
    clear() {
      sessions.length = 0;
    },
    composerSend: composerSend
  };
  return engine;
}

module.exports = { createEngine };
