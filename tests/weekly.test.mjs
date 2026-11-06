import test from 'node:test';
import assert from 'node:assert/strict';
import { recordLeaderboard, readWeekly, purgeGuests } from '../server/leaderboard.mjs';
import { weekInfo } from '../js/week.mjs';

// Base en mémoire : juste ce que le classement utilise.
function fakeDb() {
  const nodes = new Map();
  const children = path => [...nodes].filter(([k]) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(([k, v]) => [k.slice(path.length + 1), v]);
  const query = (path, field = null, after = null, limit = Infinity) => ({
    orderByChild: f => query(path, f, after, limit), startAfter: v => query(path, field, v, limit), limitToLast: n => query(path, field, after, n),
    startAt: () => query(path, 'expiresAt', 0), endAt: () => query(path, field, after, limit), limitToFirst: () => query(path, field, after, limit),
    async once() {
      let kids = children(path);
      if (field) kids = kids.filter(([, v]) => after === null || (Number(v?.[field]) || 0) > after).filter(([, v]) => field !== 'expiresAt' || v?.expiresAt).sort((a, b) => (a[1][field] || 0) - (b[1][field] || 0)).slice(-limit);
      return { forEach: fn => kids.forEach(([key, v]) => fn({ key, val: () => v })), numChildren: () => kids.length, val: () => nodes.get(path) ?? null };
    }
  });
  return {
    nodes,
    ref: path => ({
      ...query(path),
      async transaction(fn) { const next = fn(structuredClone(nodes.get(path) ?? null)); nodes.set(path, next); return { snapshot: { val: () => next } }; },
      async update(u) { for (const [k, v] of Object.entries(u)) { const full = `${path}/${k}`; if (v === null) for (const key of [...nodes.keys()]) if (key === full || key.startsWith(full + '/')) nodes.delete(key); } }
    })
  };
}
const alice = { uid: 'alice-uid', name: 'Alice Martin', firebase: { sign_in_provider: 'google.com' } };
const guest = { uid: 'guest-uid', firebase: { sign_in_provider: 'anonymous' } };
const NOW = Date.parse('2026-11-06T12:00:00Z');

test('weekly ranking: server-written, idempotent, public without uid, reset on Monday Paris time', async () => {
  const db = fakeDb();
  await recordLeaderboard(db, alice, '', { sessionId: 's1', score: 300 }, NOW);
  await recordLeaderboard(db, alice, '', { sessionId: 's1', score: 300 }, NOW); // retry: counted once
  await recordLeaderboard(db, alice, '', { sessionId: 's2', score: 100 }, NOW + 1000);
  await recordLeaderboard(db, guest, 'Zoé', { sessionId: 'g1', score: 500 }, NOW);
  const pub = await readWeekly(db, 'total', null, NOW + 60000);
  assert.equal(pub.week, '2026-11-02');
  assert.deepEqual(pub.rows.map(r => [r.name, r.total, r.best]), [['Zoé', 500, 500], ['Alice M.', 400, 300]]);
  assert.doesNotMatch(JSON.stringify(pub), /alice-uid|guest-uid/, 'no uid in the public ranking');
  assert.equal(pub.me, null);
  const mine = await readWeekly(db, 'total', 'alice-uid', NOW + 60000);
  assert.deepEqual([mine.me.rank, mine.me.total], [2, 400]);
  assert.equal(mine.rows.find(r => r.me)?.name, 'Alice M.');
  // Lundi 9 novembre, 0 h 30 à Paris : nouvelle semaine, classement vide.
  const monday = Date.parse('2026-11-08T23:30:00Z');
  assert.equal(weekInfo(monday).id, '2026-11-09');
  const fresh = await readWeekly(db, 'total', 'alice-uid', monday);
  assert.deepEqual([fresh.rows.length, fresh.me], [0, null]);
});

test('weekly ranking: expired guests leave the current week', async () => {
  const db = fakeDb();
  await recordLeaderboard(db, guest, 'Zoé', { sessionId: 'g1', score: 500 }, NOW);
  await purgeGuests(db, NOW + 86400001);
  assert.equal(db.nodes.has('weekly/2026-11-02/guest-uid'), false);
});
