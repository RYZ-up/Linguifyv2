import { randomInt, randomUUID, createHash, randomBytes } from 'node:crypto';
import { correctAnswer, questionScore, answerKey } from '../js/answer-check.mjs';
export { normalize, distance, correctAnswer } from '../js/answer-check.mjs';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireThat(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}
export function parseSettings(value) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 400, 'Paramètres invalides.');
  const { direction, mode, level, count, duration } = value;
  requireThat(['en-fr', 'fr-en'].includes(direction) && ['count', 'time'].includes(mode), 400, 'Mode invalide.');
  requireThat(Number.isInteger(level) && level >= 1 && level <= 5, 400, 'Niveau invalide.');
  requireThat(Number.isInteger(count) && count >= 1 && count <= 50, 400, 'Nombre invalide.');
  requireThat(Number.isInteger(duration) && duration >= 20 && duration <= 1800, 400, 'Durée invalide.');
  return { direction, mode, level, count, duration, looseCorrection: value.looseCorrection === true, streakMul: value.streakMul === true };
}
export function createSession(uid, settings, bank, now, seen = []) {
  // Chaque niveau a son propre contenu (mots, phrases courtes, longues, complexes) : pas de mélange avec les niveaux inférieurs.
  const pool = [...bank.values()].filter(q => q.level === settings.level);
  requireThat(pool.length > 0, 503, 'Questions indisponibles.');
  const prior = new Set(seen);
  const fresh = pool.filter(q => !prior.has(q.id));
  const groups = [fresh, pool.filter(q => prior.has(q.id))];
  for (const group of groups) {
    for (let i = group.length - 1; i > 0; i--) { const j = randomInt(i + 1); [group[i], group[j]] = [group[j], group[i]]; }
  }
  const shuffled = groups.flat();
  const size = settings.mode === 'count' ? Math.min(settings.count, pool.length) : 400;
  const ids = Array.from({ length: size }, (_, i) => shuffled[i % shuffled.length].id);
  return { id: randomUUID(), uid, settings, ids, salt: randomBytes(12).toString('hex'), locked: {}, startedAt: now, expiresAt: now + 3600000, deleteAfter: new Date(now + 86400000), ended: false, score: 0, correct: 0, streak: 0, streakMax: 0, completedStreaks: 0, seen: [...new Set([...seen, ids[0]])].slice(-2000) };
}
export function assertSession(session, uid, id, now, allowEnded = false) {
  requireThat(session && session.uid === uid && session.id === id, 404, 'Session introuvable.');
  requireThat(now <= session.expiresAt, 410, 'Session expirée.');
  requireThat(allowEnded || !session.ended, 409, 'Session terminée.');
}
/* Le navigateur reçoit la phrase et les empreintes des réponses exactes (verdict immédiat), jamais les réponses :
   une réponse approchée, la bonne réponse et le score passent par le serveur (action « check »). */
export async function gameQuestions(session, bank) {
  return Promise.all(session.ids.map(async (id, i) => {
    const q = bank.get(id);
    requireThat(q, 503, 'Question indisponible.');
    const keys = new Set(await Promise.all([...q.answers, q.hint].filter(Boolean).map(a => answerKey(session.salt, i, a, session.settings.direction))));
    keys.delete('');
    return { en: q.en, level: q.level, keys: [...keys] };
  }));
}
export const expectedAnswer = q => q?.hint || q?.answers?.[q.answers.length - 1] || '';
export function publicStats(session) {
  return { score: session.score, correct: session.correct, streak: session.streak, streakMax: session.streakMax, completedStreaks: session.completedStreaks };
}
// Fingerprint of one exact answer the AI accepted for one question of this session.
export const answerHash = value => createHash('sha256').update(String(value)).digest('hex');
// The client corrects locally for speed; the server replays every answer and owns the score.
export function finishSession(session, answers, bank, now) {
  if (session.ended) return session;
  requireThat(Array.isArray(answers) && answers.length <= session.ids.length, 400, 'Réponses invalides.');
  const limit = session.settings.mode === 'time' ? session.startedAt + session.settings.duration * 1000 : now;
  const elapsed = Math.min(now, limit) - session.startedAt;
  const next = { ...session, score: 0, correct: 0, streak: 0, streakMax: 0, completedStreaks: 0 };
  let spent = 0, answered = 0;
  for (const [i, a] of answers.entries()) {
    requireThat(a && typeof a.userAnswer === 'string' && a.userAnswer.length <= 300 && Number.isInteger(a.ms) && a.ms >= 500, 400, 'Réponse invalide.');
    spent += a.ms;
    if (spent > elapsed + 1500) break;
    answered++;
    const q = bank.get(session.ids[i]);
    requireThat(q, 503, 'Question indisponible.');
    // Une réponse déjà vérifiée par « check » est figée : impossible de la changer après avoir vu la bonne.
    const lock = session.locked?.[i];
    const ok = lock ? lock.h === answerHash(a.userAnswer) && lock.ok : session.aiOk?.[i] === answerHash(a.userAnswer) || correctAnswer(a.userAnswer, q, session.settings);
    if (!ok) { next.streak = 0; continue; }
    next.correct++;
    next.score += questionScore(q.level, a.ms);
    next.streak++;
    next.streakMax = Math.max(next.streakMax, next.streak);
    if (session.settings.streakMul && next.streak >= 10) {
      next.completedStreaks++; next.score += 20 * next.completedStreaks; next.streak = 0;
    } else if (session.settings.streakMul) next.score += next.streak;
  }
  const temps = Math.max(1, Math.floor(elapsed / 1000));
  const summary = { ...publicStats(next), answered, temps, rate: +(next.correct / temps * 60).toFixed(1), date: new Date(now).toISOString() };
  summary.expected = session.ids.slice(0, answered).map(id => expectedAnswer(bank.get(id)));
  return { ...next, ended: true, summary, seen: [...new Set([...session.seen, ...session.ids.slice(0, answered + 1)])].slice(-2000) };
}
