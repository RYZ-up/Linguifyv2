// Guest (anonymous) accounts live 24 h: after that the account, its game data and its ranking are deleted.
// Only Google accounts are kept. Run every hour by netlify/functions/purge-guests.mjs.
export const GUEST_MAX_AGE_MS = 86400000;
const CHUNK = 100;

export function isExpiredGuest(user, now) {
  const created = Date.parse(user.metadata?.creationTime);
  return !user.providerData?.length && Number.isFinite(created) && now - created >= GUEST_MAX_AGE_MS;
}

async function deleteData({ database, firestore }, uids) {
  const updates = {};
  for (const uid of uids) for (const root of ['users', 'leaderboard', 'push']) updates[`${root}/${uid}`] = null;
  await database.ref('').update(updates);
  const batch = firestore.batch();
  uids.forEach(uid => batch.delete(firestore.collection('privateGameSessions').doc(uid)));
  await batch.commit();
}

export async function purgeExpiredGuests(svc, now) {
  const expired = [];
  let pageToken;
  do {
    const page = await svc.auth.listUsers(1000, pageToken);
    expired.push(...page.users.filter(u => isExpiredGuest(u, now)).map(u => u.uid));
    pageToken = page.pageToken;
  } while (pageToken);
  for (let i = 0; i < expired.length; i += CHUNK) {
    const uids = expired.slice(i, i + CHUNK);
    // Data first: if the run stops halfway, a still-existing account is retried next hour.
    await deleteData(svc, uids);
    await svc.auth.deleteUsers(uids);
  }
  // Guest rankings whose account is gone (e.g. kept by the former high-score rule).
  const keys = [], gone = new Set(expired);
  (await svc.database.ref('leaderboard').orderByChild('guest').equalTo(true).once('value')).forEach(child => { if (!gone.has(child.key)) keys.push(child.key); });
  const orphans = [];
  for (let i = 0; i < keys.length; i += CHUNK) {
    const { notFound } = await svc.auth.getUsers(keys.slice(i, i + CHUNK).map(uid => ({ uid })));
    orphans.push(...notFound.map(id => id.uid));
  }
  if (orphans.length) await svc.database.ref('leaderboard').update(Object.fromEntries(orphans.map(uid => [uid, null])));
  return { deleted: expired.length, orphans: orphans.length };
}
