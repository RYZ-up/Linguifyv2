import test from 'node:test';
import assert from 'node:assert/strict';
import { isExpiredGuest, purgeExpiredGuests, GUEST_MAX_AGE_MS } from '../server/guest-cleanup.mjs';

const DAY = GUEST_MAX_AGE_MS, NOW = Date.parse('2026-11-05T12:00:00Z');
const user = (uid, ageMs, providers = []) => ({ uid, providerData: providers.map(providerId => ({ providerId })), metadata: { creationTime: new Date(NOW - ageMs).toUTCString() } });

test('only anonymous users older than 24 h are expired', () => {
  assert.equal(isExpiredGuest(user('old', DAY + 1000), NOW), true);
  assert.equal(isExpiredGuest(user('fresh', DAY - 60000), NOW), false);
  assert.equal(isExpiredGuest(user('google', 10 * DAY, ['google.com']), NOW), false);
  // A guest who linked Google keeps the same uid but is no longer anonymous.
  assert.equal(isExpiredGuest(user('linked', 10 * DAY, ['google.com']), NOW), false);
  assert.equal(isExpiredGuest({ uid: 'broken', providerData: [], metadata: {} }, NOW), false);
});

function fakeServices(users, leaderboard = {}) {
  const live = new Map(users.map(u => [u.uid, u])), removed = [], dbUpdates = {}, docs = [];
  const pages = [users.slice(0, 2), users.slice(2)];
  return {
    live, removed, dbUpdates, docs,
    auth: {
      async listUsers(max, token) { const i = token ? Number(token) : 0; return { users: pages[i] || [], pageToken: i + 1 < pages.length ? String(i + 1) : undefined }; },
      async deleteUsers(uids) { uids.forEach(uid => { live.delete(uid); removed.push(uid); }); return { successCount: uids.length, failureCount: 0 }; },
      async getUsers(ids) { return { users: ids.filter(({ uid }) => live.has(uid)).map(({ uid }) => live.get(uid)), notFound: ids.filter(({ uid }) => !live.has(uid)) }; }
    },
    database: {
      ref(path) {
        return {
          async update(values) { for (const [k, v] of Object.entries(values)) dbUpdates[path ? `${path}/${k}` : k] = v; },
          orderByChild() { return { equalTo() { return { async once() { return { forEach(fn) { Object.entries(leaderboard).filter(([, e]) => e.guest).forEach(([key]) => fn({ key })); } }; } }; } }; }
        };
      }
    },
    firestore: {
      collection(name) { return { doc: id => ({ path: `${name}/${id}` }) }; },
      batch() { const ops = []; return { delete(ref) { ops.push(ref.path); }, async commit() { docs.push(...ops); } }; }
    }
  };
}

test('purge deletes expired guests, their data and orphan guest rankings', async () => {
  const svc = fakeServices([user('g1', 2 * DAY), user('acc', 9 * DAY, ['google.com']), user('g2', DAY + 5), user('g3', 3600e3)],
    { g1: { guest: true }, g3: { guest: true }, ghost: { guest: true }, acc: { guest: false } });
  const report = await purgeExpiredGuests(svc, NOW);
  assert.deepEqual(svc.removed.sort(), ['g1', 'g2']);
  assert.deepEqual([...svc.live.keys()].sort(), ['acc', 'g3']);
  for (const uid of ['g1', 'g2']) for (const root of ['users', 'leaderboard', 'push']) assert.equal(svc.dbUpdates[`${root}/${uid}`], null);
  // A guest ranking whose account no longer exists (kept by the old high-score rule) is removed too.
  assert.equal(svc.dbUpdates['leaderboard/ghost'], null);
  assert.equal('leaderboard/g3' in svc.dbUpdates, false);
  assert.equal('users/acc' in svc.dbUpdates, false);
  assert.deepEqual(svc.docs.sort(), ['privateGameSessions/g1', 'privateGameSessions/g2']);
  assert.deepEqual(report, { deleted: 2, orphans: 1 });
});
