// Serveur de développement : `npm run dev`, puis http://localhost:8888.
// Sert public/ (même en-têtes que Netlify) et fait tourner le vrai /api/game (netlify/functions/game.mjs)
// avec des services Firebase factices en mémoire : aucune donnée réelle n'est lue ni écrite côté serveur.
// Le navigateur se connecte toujours au vrai Firebase Auth (invité), mais le jeton n'est pas vérifié ici.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.PORT) || 8888;
process.env.ALLOWED_ORIGINS = `http://localhost:${PORT},http://127.0.0.1:${PORT}`;
const { handleGame } = await import('../netlify/functions/game.mjs');

execFileSync(process.execPath, ['scripts/build-public.cjs'], { stdio: 'inherit' });
const root = resolve('public');
// Relue à chaque requête : un nouveau build change les empreintes des scripts autorisés.
const csp = () => readFileSync('public/_headers', 'utf8').match(/Content-Security-Policy: (.+)/)[1];

/* Firestore et Realtime Database en mémoire, avec juste ce que le jeu utilise */
const docs = new Map(), nodes = new Map();
const firestore = {
  collection: name => ({ doc: id => ({ path: `${name}/${id}`, async get() { return { data: () => docs.get(`${name}/${id}`) }; } }) }),
  async runTransaction(fn) {
    const writes = [];
    const out = await fn({ get: async ref => ({ data: () => docs.get(ref.path) }), set: (ref, value) => writes.push([ref.path, structuredClone(value)]) });
    writes.forEach(([path, value]) => docs.set(path, value));
    return out;
  }
};
// Requête triée sur les enfants d'un chemin (classement de la semaine compris).
function query(path, field = null, after = null, limit = Infinity) {
  const chain = { orderByChild: f => query(path, f, after, limit), startAfter: v => query(path, field, v, limit), startAt: () => chain, endAt: () => chain, equalTo: () => chain,
    limitToFirst: () => chain, limitToLast: n => query(path, field, after, n),
    async once() {
      let kids = [...nodes].filter(([k]) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(([k, v]) => ({ key: k.slice(path.length + 1), val: () => v }));
      if (field) kids = kids.filter(c => after === null || (Number(c.val()?.[field]) || 0) > after).sort((x, y) => (x.val()?.[field] || 0) - (y.val()?.[field] || 0)).slice(-limit);
      return { forEach: fn => kids.forEach(fn), numChildren: () => kids.length, val: () => null };
    } };
  return chain;
}
const database = {
  ref: path => ({
    ...query(path),
    async once() { const v = nodes.get(path); return { val: () => v ?? null, forEach() {} }; },
    async transaction(fn) { const next = fn(structuredClone(nodes.get(path) ?? null)); nodes.set(path, next); return { snapshot: { val: () => next } }; },
    async update() {}, async set(v) { nodes.set(path, v); }
  })
};
const services = () => ({
  firestore, database,
  auth: { async verifyIdToken(token) { return { uid: 'dev-' + createHash('sha256').update(token).digest('hex').slice(0, 12), firebase: { sign_in_provider: 'anonymous' } }; } }
});

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/api/game') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
    const t0 = Date.now();
    const reply = await handleGame(request, { ip: '127.0.0.1' }, { services });
    console.log(`/api/game ${reply.status} en ${Date.now() - t0} ms`);
    res.writeHead(reply.status, Object.fromEntries(reply.headers));
    return res.end(Buffer.from(await reply.arrayBuffer()));
  }
  let path = decodeURIComponent(url.pathname);
  if (path === '/' ) path = '/index.html';
  let file = resolve(root, '.' + path);
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end('Introuvable'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Security-Policy': csp(), 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
}).on('error', e => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`Le port ${PORT} est déjà pris : Linguify tourne sûrement déjà sur http://localhost:${PORT}. Sinon : PORT=8889 npm run dev`);
  process.exit(1);
}).listen(PORT, '127.0.0.1', () => console.log(`Linguify en local : http://localhost:${PORT}  (parties sur un serveur factice, rien n'est enregistré)`));
