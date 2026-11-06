import { services } from '../../server/firebase.mjs';
import { getBank } from '../../server/bank.mjs';
import { readInput, authenticate, consumeQuota, json } from '../../server/http.mjs';
import { recordLeaderboard, purgeGuests, readWeekly } from '../../server/leaderboard.mjs';
import { HttpError, requireThat, parseSettings, createSession, assertSession, gameQuestions, finishSession, correctAnswer, answerHash, expectedAnswer } from '../../server/game-core.mjs';
import { aiAccepts } from '../../server/ai.mjs';
import { exactKey } from '../../js/answer-check.mjs';

let onlineCache = { at: 0, n: 0 };
async function countOnline(firestore, now) {
  if (now - onlineCache.at < 60000) return onlineCache.n;
  try {
    const snap = await firestore.collection('privateGameSessions').where('startedAt', '>', now - 15 * 60000).count().get();
    onlineCache = { at: now, n: Number(snap.data().count) || 0 };
  } catch { onlineCache = { at: now, n: onlineCache.n }; }
  return onlineCache.n;
}
export async function handleGame(req, context, deps = {}) {
  try {
    const input = await readInput(req);
    requireThat(['warm', 'online', 'leaderboard', 'start', 'check', 'finish'].includes(input.action), 400, 'Action invalide.');
    const svc = (deps.services || services)();
    if (input.action === 'warm') {
      // Cold-start warm-up from the home screen: no auth, no write, nothing returned.
      (deps.getBank || getBank)('en-fr'); (deps.getBank || getBank)('fr-en');
      // Signed-in players also prime token verification (Google keys + Auth); failures are ignored.
      if (req.headers.get('authorization')) await authenticate(req, svc).catch(() => {});
      // Opens the Firestore channel (gRPC + TLS) now rather than on the player's first click.
      try { await svc.firestore.collection('privateGameQuotas').doc('warm').get(); } catch { /* best effort */ }
      return json({ ok: true });
    }
    if (input.action === 'online') {
      // Public : nombre de parties lancées ces 15 dernières minutes (aucune donnée personnelle), mis en cache 60 s.
      const now = (deps.now || Date.now)();
      requireThat(context?.ip, 503, 'Service indisponible.');
      await consumeQuota(svc.firestore, [[`online-ip:${context.ip}`, 30, 60]], now);
      return json({ players: await countOnline(svc.firestore, now) });
    }
    if (input.action === 'leaderboard') {
      // Public, lecture seule : visible sans compte. Débit limité par adresse IP.
      const now = (deps.now || Date.now)();
      requireThat(context?.ip, 503, 'Service indisponible.');
      requireThat(input.field === 'total' || input.field === 'best', 400, 'Classement invalide.');
      await consumeQuota(svc.firestore, [[`lb-ip:${context.ip}`, 60, 60], ['lb:daily', 300000, 86400]], now);
      const viewer = req.headers.get('authorization') ? await authenticate(req, svc).catch(() => null) : null;
      return json(await readWeekly(svc.database, input.field, viewer?.uid, now));
    }
    const user = await authenticate(req, svc);
    const now = (deps.now || Date.now)();
    requireThat(context?.ip, 503, 'Service indisponible.');
    const limits = [[`uid:${user.uid}`, 120, 60], [`ip:${context.ip}`, 240, 60], ['site:daily', 100000, 86400]];
    if (input.action === 'check') limits.push([`check:${user.uid}`, 90, 60], ['check:daily', 200000, 86400]);
    if (input.action === 'start') limits.push([`start:${user.uid}`, 20, 3600], [`start-ip:${context.ip}`, 60, 3600]);
    // Quota and session run side by side; a quota refusal still fails the request.
    const quota = consumeQuota(svc.firestore, limits, now);
    quota.catch(() => {});
    const ref = svc.firestore.collection('privateGameSessions').doc(user.uid);
    if (input.action === 'check') {
      // Quota et lecture de la partie en parallèle : un aller-retour Firestore de moins.
      const [, session] = await Promise.all([quota, svc.firestore.runTransaction(async tx => (await tx.get(ref)).data())]);
      assertSession(session, user.uid, input.sessionId, now);
      requireThat(Number.isInteger(input.index) && input.index >= 0 && input.index < session.ids.length, 400, 'Question invalide.');
      requireThat(typeof input.userAnswer === 'string' && input.userAnswer.trim() && input.userAnswer.length <= 300, 400, 'Réponse invalide.');
      const q = (deps.getBank || getBank)(session.settings.direction).get(session.ids[input.index]);
      requireThat(q, 503, 'Question indisponible.');
      const expected = expectedAnswer(q);
      // Première réponse envoyée pour une question : elle est figée, la bonne réponse peut alors être montrée.
      const prior = session.locked?.[input.index];
      if (prior) return json({ ok: prior.h === answerHash(input.userAnswer) && prior.ok, expected });
      let ok = correctAnswer(input.userAnswer, q, session.settings);
      // Recopier la phrase à traduire n'est jamais une traduction : refus direct, sans demander à l'IA.
      const copied = exactKey(input.userAnswer, session.settings.direction) === exactKey(q.en, session.settings.direction);
      if (!ok && !copied) {
        // Quota IA et appel à l'IA en même temps ; un quota dépassé annule quand même le verdict.
        const [, verdict] = await Promise.all([
          consumeQuota(svc.firestore, [[`ai:${user.uid}`, 40, 60], ['ai:daily', 20000, 86400]], now),
          (deps.aiAccepts || aiAccepts)({ en: q.en, refs: [...q.answers, q.hint], userAnswer: input.userAnswer, direction: session.settings.direction })
        ]);
        ok = verdict === true;
      }
      const lock = { h: answerHash(input.userAnswer), ok };
      const saved = await svc.firestore.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (current?.id !== session.id || current.ended) return null;
        if (current.locked?.[input.index]) return current.locked[input.index];
        tx.set(ref, { ...current, locked: { ...current.locked, [input.index]: lock } });
        return lock;
      });
      const final = saved || lock;
      return json({ ok: final.h === lock.h && final.ok, expected });
    }
    const [, reply] = await Promise.all([quota, svc.firestore.runTransaction(async tx => {
      const previous = (await tx.get(ref)).data();
      if (input.action === 'start') {
        const settings = parseSettings(input.settings);
        requireThat(!previous || previous.ended || previous.expiresAt < now || now - previous.startedAt > 5000, 429, 'Une partie vient de démarrer.');
        const session = createSession(user.uid, settings, (deps.getBank || getBank)(settings.direction), now, previous?.settings.direction === settings.direction ? previous.seen : []);
        tx.set(ref, session);
        return { sessionId: session.id, salt: session.salt, questions: await gameQuestions(session, (deps.getBank || getBank)(settings.direction)), settings };
      }
      assertSession(previous, user.uid, input.sessionId, now, true);
      const bank = (deps.getBank || getBank)(previous.settings.direction);
      const session = finishSession(previous, input.answers, bank, now);
      tx.set(ref, session);
      return { ...session.summary, sessionId: session.id };
    })]);
    let accountData = null, legacy = null;
    const guest = user.firebase?.sign_in_provider === 'anonymous';
    // Guests are credited too, under their own anonymous uid: linking Google to it keeps the same uid,
    // so a brand-new account inherits the guest's games and an existing account never sees them.
    if (input.action === 'finish') {
      // Session ID makes crediting idempotent, even after retries or concurrent finishes.
      const account = svc.database.ref(`users/${user.uid}/secureGame`);
      const data = { score: reply.score, rate: reply.rate, bonnes: reply.correct, temps: reply.temps, date: reply.date };
      const legacyRead = svc.database.ref(`users/${user.uid}/legacy`).once('value');
      const saved = await account.transaction(current => {
        const next = current || {};
        next.history ||= {};
        if (next.history[reply.sessionId]) return next;
        next.history[reply.sessionId] = data;
        next.total = (Number.isFinite(next.total) ? next.total : 0) + data.score;
        next.playtimeMs = (Number.isFinite(next.playtimeMs) ? next.playtimeMs : 0) + reply.temps * 1000;
        if (!next.best || data.rate > (next.best.rate || 0)) next.best = data;
        return next;
      });
      accountData = saved.snapshot.val();
      legacy = (await legacyRead).val();
      reply.best = accountData.best;
      reply.total = accountData.total;
      reply.playtimeMs = accountData.playtimeMs;
      reply.isNew = accountData.best?.date === data.date;
    }
    if (input.action === 'finish') {
      // The ranking is secondary: a failure here must never lose the finished game.
      const ranking = (async () => {
        try {
          await recordLeaderboard(svc.database, user, input.name, reply, now, guest ? null : accountData, legacy);
          await purgeGuests(svc.database, now);
        } catch (error) { console.error('Leaderboard update failed:', error?.code || error?.name || 'UnknownError'); }
      })();
      // The player gets the result at once; Netlify keeps the function alive until the ranking is saved.
      if (typeof context.waitUntil === 'function') context.waitUntil(ranking);
      else await ranking;
    }
    return json(reply);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    // Do not log tokens, request bodies, answers, credentials or provider responses.
    console.error('Game service failed:', error?.code || error?.name || 'UnknownError');
    return json({ error: 'Service indisponible. Réessaie plus tard.' }, 503);
  }
}
export default handleGame;
export const config = { path: '/api/game', rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
