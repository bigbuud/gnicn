'use strict';
// gnicn - minimale video-player server, geen externe dependencies.
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const VIDEO_DIR = path.resolve(process.env.VIDEO_DIR || '/videos');
const TRASH_DIR = process.env.TRASH_DIR ? path.resolve(process.env.TRASH_DIR) : null;
const ALLOW_DELETE = (process.env.ALLOW_DELETE || 'true').toLowerCase() === 'true';
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS = process.env.AUTH_PASS || '';
const EXTS = new Set(
  (process.env.EXTENSIONS || 'mp4,m4v,webm,mkv,mov,ogv,avi')
    .split(',')
    .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
);
const MIME = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  avi: 'video/x-msvideo',
};
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function checkAuth(req, res) {
  if (!AUTH_USER) return true;
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString().split(':');
    if (u === AUTH_USER && rest.join(':') === AUTH_PASS) return true;
  }
  send(res, 401, 'Authenticatie vereist', { 'WWW-Authenticate': 'Basic realm="gnicn"' });
  return false;
}

// Voorkomt dat paden buiten VIDEO_DIR bereikt worden.
function safeResolve(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const full = path.resolve(VIDEO_DIR, rel);
  return full.startsWith(VIDEO_DIR + path.sep) ? full : null;
}

function extOf(p) {
  return path.extname(p).slice(1).toLowerCase();
}

async function scan(dir, base = '', out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (TRASH_DIR && full === TRASH_DIR) continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    if (ent.isDirectory()) await scan(full, rel, out);
    else if (ent.isFile() && EXTS.has(extOf(ent.name))) out.push(rel);
  }
  return out;
}

async function serveVideo(req, res, rel) {
  const full = safeResolve(rel);
  if (!full || !EXTS.has(extOf(full))) return send(res, 400, 'Ongeldig pad');
  let st;
  try {
    st = await fsp.stat(full);
    if (!st.isFile()) throw new Error('geen bestand');
  } catch {
    return send(res, 404, 'Niet gevonden');
  }
  const size = st.size;
  const type = MIME[extOf(full)] || 'application/octet-stream';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
      return send(res, 416, 'Ongeldige range', { 'Content-Range': `bytes */${size}` });
    }
    if (m[1] === '') {
      start = Math.max(0, size - parseInt(m[2], 10));
    } else {
      start = parseInt(m[1], 10);
      if (m[2] !== '') end = Math.min(parseInt(m[2], 10), size - 1);
    }
    if (start > end || start >= size) {
      return send(res, 416, 'Range buiten bereik', { 'Content-Range': `bytes */${size}` });
    }
    status = 206;
    base['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  base['Content-Length'] = end - start + 1;
  res.writeHead(status, base);
  if (req.method === 'HEAD' || size === 0) return res.end();
  const stream = fs.createReadStream(full, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

async function moveToTrash(full, rel) {
  let dest = path.join(TRASH_DIR, rel);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.access(dest);
    const p = path.parse(dest);
    dest = path.join(p.dir, `${p.name}.${Date.now()}${p.ext}`);
  } catch {
    /* bestaat nog niet: prima */
  }
  try {
    await fsp.rename(full, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fsp.copyFile(full, dest); // ander volume
    await fsp.unlink(full);
  }
}

async function deleteVideo(res, rel) {
  if (!ALLOW_DELETE) return send(res, 403, { error: 'Wissen is uitgeschakeld' });
  const full = safeResolve(rel);
  if (!full || !EXTS.has(extOf(full))) return send(res, 400, { error: 'Ongeldig pad' });
  try {
    const st = await fsp.stat(full);
    if (!st.isFile()) return send(res, 404, { error: 'Niet gevonden' });
    if (TRASH_DIR) await moveToTrash(full, rel);
    else await fsp.unlink(full);
    return send(res, 200, { ok: true, trashed: !!TRASH_DIR });
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, { error: 'Niet gevonden' });
    console.error('Wissen mislukt:', e.message);
    return send(res, 500, { error: `Wissen mislukt: ${e.code || e.message}` });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') return send(res, 200, 'ok');
    if (!checkAuth(req, res)) return;

    if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
      const html = await fsp.readFile(INDEX_HTML);
      return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (url.pathname === '/api/config' && req.method === 'GET') {
      return send(res, 200, { allowDelete: ALLOW_DELETE, trash: !!TRASH_DIR });
    }
    if (url.pathname === '/api/list' && req.method === 'GET') {
      const files = (await scan(VIDEO_DIR)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return send(res, 200, { files });
    }
    if (url.pathname === '/video' && (req.method === 'GET' || req.method === 'HEAD')) {
      return serveVideo(req, res, url.searchParams.get('path'));
    }
    if (url.pathname === '/api/video' && req.method === 'DELETE') {
      return deleteVideo(res, url.searchParams.get('path'));
    }
    return send(res, 404, 'Niet gevonden');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'Interne fout');
    else res.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`gnicn luistert op :${PORT}`);
  console.log(`Map: ${VIDEO_DIR} | wissen: ${ALLOW_DELETE ? (TRASH_DIR ? 'naar ' + TRASH_DIR : 'definitief') : 'uit'} | login: ${AUTH_USER ? 'aan' : 'uit'}`);
});
