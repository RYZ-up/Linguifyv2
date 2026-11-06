import { createHash } from 'node:crypto';
import { HttpError, requireThat } from './game-core.mjs';

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Authorization, Origin' } });
}
export async function readInput(req) {
  requireThat(req.method === 'POST', 405, 'Méthode interdite.');
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  requireThat(allowed.length > 0, 503, 'Service non configuré.');
  requireThat(allowed.includes(req.headers.get('origin')), 403, 'Origine interdite.');
  requireThat(req.headers.get('sec-fetch-site') !== 'cross-site', 403, 'Origine interdite.');
  requireThat(req.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 415, 'JSON requis.');
  const declared = req.headers.get('content-length');
  requireThat(!declared || (Number.isFinite(Number(declared)) && Number(declared) <= 131072), 413, 'Requête trop volumineuse.');
  const reader = req.body?.getReader();
  requireThat(reader, 400, 'Requête vide.');
  let size = 0;
  const parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 131072) { await reader.cancel(); throw new HttpError(413, 'Requête trop volumineuse.'); }
    parts.push(Buffer.from(value));
  }
  let input;
  try { input = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new HttpError(400, 'JSON invalide.'); }
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 400, 'Requête invalide.');
  return input;
}
export async function authenticate(req, svc) {
  const bearer = req.headers.get('authorization') || '';
  requireThat(/^Bearer [A-Za-z0-9._-]{1,4096}$/.test(bearer), 401, 'Connexion requise.');
  let user;
  try { user = await svc.auth.verifyIdToken(bearer.slice(7), true); } catch { throw new HttpError(401, 'Connexion expirée.'); }
  return user;
}
export async function consumeQuota(firestore, keys, now = Date.now()) {
  const refs = keys.map(([key, limit, seconds]) => ({ ref: firestore.collection('privateGameQuotas').doc(createHash('sha256').update(key).digest('hex')), limit, seconds }));
  await firestore.runTransaction(async tx => {
    const snaps = await Promise.all(refs.map(({ ref }) => tx.get(ref)));
    const values = refs.map(({ limit, seconds }, i) => {
      const bucket = Math.floor(now / (seconds * 1000));
      const prior = snaps[i].data();
      const count = prior?.bucket === bucket ? prior.count + 1 : 1;
      requireThat(count <= limit, 429, 'Limite de requêtes atteinte. Réessaie plus tard.');
      return { bucket, count, expiresAt: new Date(now + 172800000) };
    });
    refs.forEach(({ ref }, i) => tx.set(ref, values[i]));
  });
}
