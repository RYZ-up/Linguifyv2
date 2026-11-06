export function normalize(value, direction) {
  let s = value.toLowerCase().replace(/[’‘`´]/g, "'");
  if (direction === 'fr-en') {
    const contractions = { "can't": 'cannot', "won't": 'will not', "shan't": 'shall not', "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are', "it's": 'it is', "he's": 'he is', "she's": 'she is', "that's": 'that is', "let's": 'let us' };
    for (const [a, b] of Object.entries(contractions)) s = s.replaceAll(a, b);
    s = s.replace(/n't\b/g, ' not').replace(/'ve\b/g, ' have').replace(/'ll\b/g, ' will').replace(/'re\b/g, ' are').replace(/'d\b/g, ' would');
  }
  return s.replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function distance(a, b, limit = 2) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...row) > limit) return limit + 1;
    prev = row;
  }
  return prev[b.length];
}
// Forme comparée mot à mot. Métier ou nationalité : « je suis un cuisinier » vaut « je suis cuisinier »
// (article ajouté par calque de « I am a cook ») ; appliqué aux deux côtés, une référence avec article reste comparable.
export function exactKey(raw, direction) {
  const s = normalize(String(raw ?? ''), direction);
  return direction === 'en-fr' ? s.replace(/(^| )(suis|es|est|sommes|etes|sont) (un|une|des) /g, '$1$2 ') : s;
}
/* Empreinte d'une réponse exacte, liée à la partie et à la question : le navigateur reconnaît une réponse juste
   sans recevoir les réponses en clair. */
export async function answerKey(salt, index, raw, direction) {
  const key = exactKey(raw, direction);
  if (!key) return '';
  const bytes = new TextEncoder().encode(`${salt}:${index}:${key}`);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('');
}
export function correctAnswer(raw, question, settings) {
  const u = exactKey(raw, settings.direction);
  if (!u) return false;
  return [...question.answers, ...(question.hint ? [question.hint] : [])].some(ref => {
    const a = exactKey(ref, settings.direction);
    if (u === a) return true;
    // Never erase pronouns, numbers, negations or word order to accept an answer.
    const words = u.split(' '), expected = a.split(' ');
    if (words.length !== expected.length) return false;
    const protectedWord = /^(?:\d+|i|you|he|she|it|we|they|je|tu|il|elle|on|nous|vous|ils|elles|ne|pas|not|no|never|cannot|jamais|plus)$/;
    let typos = 0;
    for (let i = 0; i < words.length; i++) {
      const x = words[i], y = expected[i];
      if (x === y) continue;
      if (protectedWord.test(x) || protectedWord.test(y) || Math.min(x.length, y.length) < 5) return false;
      typos += distance(x, y, 1);
      if (typos > (settings.looseCorrection ? 2 : 1)) return false;
    }
    return true;
  });
}
export function questionScore(level, ms) {
  return Math.min(50, Math.round(level * 10 / Math.max(0.1, ms / 60000)));
}
if (typeof window !== 'undefined') window.answerCheck = { normalize, distance, correctAnswer, questionScore, exactKey, answerKey };
