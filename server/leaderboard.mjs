import { weekInfo, previousWeekId } from '../js/week.mjs';
export const GUEST_TTL_MS = 86400000;

// Public names only: first name + initial for accounts, the chosen nickname for guests.
export function publicName(user, guestName) {
  const clean = value => String(value ?? '').normalize('NFC').replace(/[\p{C}<>]/gu, '').replace(/\s+/g, ' ').trim();
  if (user.firebase?.sign_in_provider === 'anonymous') return clean(guestName).slice(0, 16) || 'Invité';
  const [first = '', last = ''] = clean(user.name).split(' ');
  return (first.slice(0, 16) + (last ? ` ${last[0].toUpperCase()}.` : '')) || 'Joueur';
}

// Scores earned before server verification, frozen once by scripts/backfill-leaderboard.mjs.
export function legacyStats(userNode) {
  const scores = Object.values(userNode?.history || {}).map(h => Number(h?.score) || 0);
  const total = Number(userNode?.total);
  return { total: Number.isFinite(total) && total > 0 ? Math.round(total) : 0, best: Math.max(0, Number(userNode?.best?.score) || 0, ...scores) };
}
// account: the saved secureGame record (accounts only), so existing totals are reflected.
export async function recordLeaderboard(database, user, guestName, summary, now, account = null, legacy = null) {
  const guest = user.firebase?.sign_in_provider === 'anonymous';
  const accountBest = account && Math.max(0, Number(legacy?.best) || 0, ...Object.values(account.history || {}).map(h => Number(h.score) || 0));
  const legacyTotal = Number(legacy?.total) || 0;
  await database.ref(`leaderboard/${user.uid}`).transaction(current => {
    const next = current || { total: 0, best: 0 };
    // The session ID makes crediting idempotent, even after retries or concurrent finishes.
    if (next.lastSession === summary.sessionId) return next;
    next.lastSession = summary.sessionId;
    next.name = publicName(user, guestName);
    next.total = account ? (Number(account.total) || 0) + legacyTotal : (Number.isFinite(next.total) ? next.total : 0) + summary.score;
    next.best = account ? accountBest : Math.max(Number.isFinite(next.best) ? next.best : 0, summary.score);
    next.guest = guest;
    next.updatedAt = now;
    // Guest accounts are deleted after 24 h (server/guest-cleanup.mjs): their ranking never stays.
    if (guest) next.expiresAt = now + GUEST_TTL_MS;
    else delete next.expiresAt;
    return next;
  });
  // Classement de la semaine (remis à zéro le lundi 0 h, heure de Paris) : écrit par le serveur seul.
  const week = weekInfo(now);
  await database.ref(`weekly/${week.id}/${user.uid}`).transaction(current => {
    const next = current || { total: 0, best: 0 };
    if (next.lastSession === summary.sessionId) return next;
    next.lastSession = summary.sessionId;
    next.name = publicName(user, guestName);
    next.total = (Number(next.total) || 0) + summary.score;
    next.best = Math.max(Number(next.best) || 0, summary.score);
    next.guest = guest;
    if (guest) next.expiresAt = now + GUEST_TTL_MS;
    return next;
  });
}

const cache = new Map();
/* Lecture publique (sans compte) : pseudo et scores seulement, jamais l'uid. Le joueur connecté reçoit sa place. */
export async function readWeekly(database, field, uid, now) {
  const week = weekInfo(now);
  const base = `weekly/${week.id}`, key = `${week.id}:${field}`;
  let rows = cache.get(key);
  if (!rows || now - rows.at > 30000) {
    const snap = await database.ref(base).orderByChild(field).limitToLast(50).once('value');
    const list = [];
    snap.forEach(c => { const v = c.val() || {}; list.push({ uid: c.key, name: String(v.name || 'Joueur').slice(0, 20), total: Number(v.total) || 0, best: Number(v.best) || 0, guest: v.guest === true }); });
    list.sort((a, b) => b[field] - a[field]);
    rows = { at: now, list };
    cache.set(key, rows);
  }
  let me = null;
  if (uid) {
    const mine = (await database.ref(`${base}/${uid}`).once('value')).val();
    if (mine) {
      const above = await database.ref(base).orderByChild(field).startAfter(Number(mine[field]) || 0).once('value');
      me = { rank: above.numChildren() + 1, name: mine.name, total: Number(mine.total) || 0, best: Number(mine.best) || 0, guest: mine.guest === true };
    }
  }
  return { week: week.id, start: week.start, end: week.end, rows: rows.list.map(({ uid: id, ...r }) => (id === uid ? { ...r, me: true } : r)), me };
}

// Accounts have no expiresAt; startAt(1) skips them because null sorts first.
export async function purgeGuests(database, now) {
  const stale = await database.ref('leaderboard').orderByChild('expiresAt').startAt(1).endAt(now).limitToFirst(50).once('value');
  const updates = {};
  stale.forEach(child => { updates[child.key] = null; });
  if (Object.keys(updates).length) await database.ref('leaderboard').update(updates);
  const week = weekInfo(now).id;
  const staleWeek = await database.ref(`weekly/${week}`).orderByChild('expiresAt').startAt(1).endAt(now).limitToFirst(50).once('value');
  const weekly = {};
  staleWeek.forEach(child => { weekly[`${week}/${child.key}`] = null; });
  // Les semaines terminées depuis plus de 7 jours sont effacées.
  weekly[previousWeekId(now, 2)] = null;
  await database.ref('weekly').update(weekly);
}
