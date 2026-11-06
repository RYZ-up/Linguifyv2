import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createSession, parseSettings, gameQuestions, finishSession, assertSession, correctAnswer } from '../server/game-core.mjs';
import { answerKey } from '../js/answer-check.mjs';
import { readInput, authenticate, consumeQuota } from '../server/http.mjs';
import { handleGame } from '../netlify/functions/game.mjs';
import oldAI from '../netlify/functions/ai-correct.mjs';
import { getBank } from '../server/bank.mjs';
import { recordLeaderboard, legacyStats, GUEST_TTL_MS } from '../server/leaderboard.mjs';

process.env.ALLOWED_ORIGINS = 'https://linguify.fr';
const settings = { direction: 'fr-en', mode: 'count', count: 2, duration: 60, level: 1, streakMul: true };
const bank = new Map([
  ['a', { id: 'a', en: 'Bonjour', level: 1, answers: ['Hello'], hint: 'Hello' }],
  ['b', { id: 'b', en: 'Au revoir', level: 1, answers: ['Goodbye'], hint: 'Goodbye' }]
]);
const request = input => new Request('https://linguify.fr/api/game', { method: 'POST', headers: { origin: 'https://linguify.fr', 'content-type': 'application/json', authorization: 'Bearer valid.token' }, body: JSON.stringify(input) });
const status = n => error => error.status === n;
const session = () => createSession('alice', parseSettings(settings), bank, 10000);

function fakeServices(provider = 'google.com') {
  const docs = new Map();
  const accounts = new Map();
  let chain = Promise.resolve();
  return {
    docs, accounts,
    auth: { verifyIdToken: async (token, revoked) => { assert.equal(revoked, true); if (token !== 'valid.token') throw Error(); return { uid: 'alice', firebase: { sign_in_provider: provider } }; } },
    firestore: {
      collection: collection => ({ doc: id => `${collection}/${id}` }),
      runTransaction(callback) {
        const result = chain.then(async () => {
          const staged = new Map();
          const response = await callback({ get: async ref => ({ data: () => structuredClone(docs.get(ref)) }), set: (ref, value) => staged.set(ref, structuredClone(value)) });
          for (const [key, value] of staged) docs.set(key, value);
          return response;
        });
        chain = result.catch(() => {});
        return result;
      }
    },
    database: { store: accounts, ref: path => ({ once: async () => ({ val: () => structuredClone(accounts.get(path) ?? null) }), transaction: async callback => { const data = callback(structuredClone(accounts.get(path))); accounts.set(path, data); return { snapshot: { val: () => data } }; } }) }
  };
}

test('start hands out phrases and answer fingerprints, never the answers or bank IDs', async () => {
  const s = session();
  const qs = await gameQuestions(s, bank);
  assert.equal(qs.length, s.ids.length);
  assert.deepEqual(Object.keys(qs[0]).sort(), ['en', 'keys', 'level']);
  assert.doesNotMatch(JSON.stringify(qs), /"id"|Hello|Goodbye/i);
  const i = s.ids.indexOf('a');
  assert.ok(qs[i].keys.includes(await answerKey(s.salt, i, 'hello', s.settings.direction)), 'exact answer recognised by fingerprint');
  assert.equal(qs[i].keys.includes(await answerKey(s.salt, i, 'goodbye', s.settings.direction)), false);
  assert.equal(qs[i].keys.includes(await answerKey('other-salt', i, 'hello', s.settings.direction)), false, 'fingerprints are tied to the session');
});
test('the first answer checked for a question is locked and cannot be changed after seeing the solution', async () => {
  const svc = fakeServices(); let now = 10000;
  const deps = { services: () => svc, getBank: () => bank, now: () => now, aiAccepts: async () => false };
  const call = async payload => { const res = await handleGame(request(payload), { ip: '127.0.0.1' }, deps); return { status: res.status, data: await res.json() }; };
  const { data: start } = await call({ action: 'start', settings });
  assert.doesNotMatch(JSON.stringify(start), /Hello|Goodbye/i);
  now = 12000;
  const wrong = await call({ action: 'check', sessionId: start.sessionId, index: 0, userAnswer: 'nonsense' });
  assert.equal(wrong.data.ok, false);
  assert.ok(wrong.data.expected, 'the solution is shown once the answer is locked');
  const retry = await call({ action: 'check', sessionId: start.sessionId, index: 0, userAnswer: wrong.data.expected });
  assert.equal(retry.data.ok, false, 'a second try on the same question is refused');
  const end = await call({ action: 'finish', sessionId: start.sessionId, answers: [{ userAnswer: wrong.data.expected, ms: 1500 }] });
  assert.equal(end.data.correct, 0, 'finish cannot swap in the solution');
  assert.equal(end.data.expected.length, 1);
});
test('correction preserves negations, subject, numbers and word order', () => {
  const question = ref => ({ answers: [ref], hint: ref });
  assert.equal(correctAnswer("I'm ready!", question('I am ready'), settings), true);
  assert.equal(correctAnswer('I am not ready', question('I am ready'), settings), false);
  assert.equal(correctAnswer('He is ready', question('She is ready'), settings), false);
  assert.equal(correctAnswer('There are 11 apples', question('There are 12 apples'), settings), false);
  assert.equal(correctAnswer('Dogs chase cats', question('Cats chase dogs'), settings), false);
  assert.equal(correctAnswer('I am happpy', question('I am happy'), settings), true);
});
test('finish replays answers server-side and ignores client verdicts', () => {
  const s = session();
  const good = bank.get(s.ids[0]).hint;
  const done = finishSession(s, [{ userAnswer: good, ms: 1500, correct: false }, { userAnswer: 'wrong', ms: 1500, correct: true }], bank, 14000);
  assert.equal(done.summary.correct, 1);
  assert.equal(done.summary.answered, 2);
  assert.ok(done.summary.score > 0);
  assert.deepEqual(finishSession(done, [], bank, 20000).summary, done.summary);
});
test('ownership, expiry, timing and input limits are enforced', () => {
  const s = session();
  assert.throws(() => assertSession(s, 'bob', s.id, 11000), status(404));
  assert.throws(() => assertSession(s, 'alice', 'forged', 11000), status(404));
  assert.throws(() => assertSession(s, 'alice', s.id, s.expiresAt + 1), status(410));
  const good = bank.get(s.ids[0]).hint;
  assert.throws(() => finishSession(s, [{ userAnswer: good, ms: 100 }], bank, 12000), status(400));
  assert.throws(() => finishSession(s, [{ userAnswer: 'x'.repeat(301), ms: 1000 }], bank, 12000), status(400));
  assert.throws(() => finishSession(s, 'nope', bank, 12000), status(400));
  // Claimed answer times beyond the real elapsed time are not counted.
  assert.equal(finishSession(s, [{ userAnswer: good, ms: 60000 }], bank, 12000).summary.correct, 0);
  const time = { ...s, settings: { ...settings, mode: 'time', duration: 20 } };
  assert.equal(finishSession(time, [{ userAnswer: good, ms: 25000 }], bank, 99000).summary.correct, 0);
  const done = finishSession(s, [], bank, 12000);
  assert.doesNotThrow(() => assertSession(done, 'alice', s.id, 12001, true));
});
test('client cannot configure an unbounded game or inject score fields', () => {
  for (const bad of [{ level: 6 }, { count: 51 }, { count: 1.1 }, { duration: 99999 }, { direction: '../data' }]) assert.throws(() => parseSettings({ ...settings, ...bad }), status(400));
  assert.equal(parseSettings({ ...settings, score: 999999, uid: 'bob' }).score, undefined);
});
test('request guard rejects bad origin, oversized body, content type and method', async () => {
  assert.deepEqual(await readInput(request({ action: 'start' })), { action: 'start' });
  await assert.rejects(readInput(new Request('https://linguify.fr/api/game')), status(405));
  const foreign = request({}); foreign.headers.set('origin', 'https://evil.example');
  await assert.rejects(readInput(foreign), status(403));
  const plain = request({}); plain.headers.set('content-type', 'text/plain');
  await assert.rejects(readInput(plain), status(415));
  await assert.rejects(readInput(request({ data: 'x'.repeat(140000) })), status(413));
});
test('Firebase authentication is mandatory, including revoked tokens', async () => {
  const svc = fakeServices();
  for (const value of ['', 'Bearer forged']) {
    const req = request({}); req.headers.set('authorization', value);
    await assert.rejects(authenticate(req, svc), status(401));
  }
});
test('persistent quotas survive new requests and concurrent calls', async () => {
  const svc = fakeServices();
  await Promise.all(Array.from({ length: 3 }, () => consumeQuota(svc.firestore, [['uid:alice', 3, 60]], 10000)));
  await assert.rejects(consumeQuota(svc.firestore, [['uid:alice', 3, 60]], 10000), status(429));
  await consumeQuota(svc.firestore, [['uid:alice', 3, 60]], 70000);
});
test('API ignores forged references and scores; concurrent finishes credit exactly once', async () => {
  const svc = fakeServices(); let now = 10000;
  const deps = { services: () => svc, getBank: () => bank, now: () => now };
  const call = async payload => { const res = await handleGame(request(payload), { ip: '127.0.0.1' }, deps); return { status: res.status, data: await res.json() }; };
  const start = await call({ action: 'start', settings });
  assert.equal(start.status, 200);
  assert.doesNotMatch(JSON.stringify(start.data), /"ids"/);
  const sessionId = start.data.sessionId;
  now = 12000;
  assert.equal((await call({ action: 'answer', sessionId, index: 0, userAnswer: 'wrong' })).status, 400);
  const answers = [{ userAnswer: 'wrong', ms: 1000, correct: true }];
  const finished = await Promise.all([call({ action: 'finish', sessionId, answers, score: 99999 }), call({ action: 'finish', sessionId, answers })]);
  assert.equal(finished[0].status, 200);
  assert.equal(finished[1].status, 200);
  assert.equal(finished[0].data.score, 0);
  const account = svc.accounts.get('users/alice/secureGame');
  assert.equal(account.total, 0);
  assert.equal(Object.keys(account.history).length, 1);
  assert.equal(account.playtimeMs, finished[0].data.temps * 1000);
  assert.equal(finished[1].data.playtimeMs, account.playtimeMs);
});
test('warm-up needs no token, writes nothing and returns nothing', async () => {
  const svc = fakeServices();
  const anonymous = request({ action: 'warm' }); anonymous.headers.delete('authorization');
  const res = await handleGame(anonymous, { ip: '127.0.0.1' }, { services: () => svc, getBank: () => bank });
  const forged = request({ action: 'warm' }); forged.headers.set('authorization', 'Bearer forged');
  assert.equal((await handleGame(forged, { ip: '127.0.0.1' }, { services: () => svc, getBank: () => bank })).status, 200);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(svc.accounts.size, 0);
});
test('AI second opinion credits only the exact answer it accepted', async () => {
  const svc = fakeServices(); let now = 10000; const asked = [];
  const deps = { services: () => svc, getBank: () => bank, now: () => now, aiAccepts: async q => { asked.push(q.userAnswer); return q.userAnswer === 'close enough'; } };
  const call = async payload => { const res = await handleGame(request(payload), { ip: '127.0.0.1' }, deps); return { status: res.status, data: await res.json() }; };
  const { data: { sessionId } } = await call({ action: 'start', settings });
  now = 14000;
  assert.equal((await call({ action: 'check', sessionId, index: 0, userAnswer: 'close enough' })).data.ok, true);
  assert.equal((await call({ action: 'check', sessionId, index: 1, userAnswer: 'nonsense' })).data.ok, false);
  assert.equal((await call({ action: 'check', sessionId: 'forged', index: 0, userAnswer: 'x' })).status, 404);
  const end = await call({ action: 'finish', sessionId, answers: [{ userAnswer: 'close enough', ms: 1500 }, { userAnswer: 'nonsense', ms: 1500 }] });
  assert.equal(end.data.correct, 1);
  // The accepted fingerprint does not carry over to a different answer or question.
  assert.deepEqual(asked, ['close enough', 'nonsense']);
});
test('copying the phrase to translate is refused without asking the AI', async () => {
  const svc = fakeServices(); let now = 10000; const asked = [];
  const deps = { services: () => svc, getBank: () => bank, now: () => now, aiAccepts: async q => { asked.push(q.userAnswer); return true; } };
  const call = async payload => (await handleGame(request(payload), { ip: '127.0.0.1' }, deps)).json();
  const { sessionId, questions } = await call({ action: 'start', settings });
  now = 14000;
  assert.equal((await call({ action: 'check', sessionId, index: 0, userAnswer: questions[0].en.toUpperCase() + ' !' })).ok, false);
  assert.deepEqual(asked, [], 'the AI is never asked about a copy');
  const end = await call({ action: 'finish', sessionId, answers: [{ userAnswer: questions[0].en, ms: 1500 }] });
  assert.equal(end.correct, 0);
});
test('anonymous games are kept under the guest uid and ranked as guest', async () => {
  const svc = fakeServices('anonymous'); let now = 10000;
  const deps = { services: () => svc, getBank: () => bank, now: () => now };
  const response = await handleGame(request({ action: 'start', settings }), { ip: '127.0.0.1' }, deps);
  const { sessionId } = await response.json(); now = 12000;
  const end = await handleGame(request({ action: 'finish', sessionId, answers: [], name: ' <b>Zoé</b>\u0000 ' }), { ip: '127.0.0.1' }, deps);
  assert.equal(end.status, 200);
  assert.equal(svc.accounts.has('users/alice/secureGame'), true);
  const entry = svc.accounts.get('leaderboard/alice');
  assert.equal(entry.guest, true);
  assert.equal(entry.name, 'bZoé/b');
  assert.equal(entry.expiresAt, 12000 + GUEST_TTL_MS);
});
test('leaderboard reflects account totals, credits each session once and hides last names', async () => {
  const db = fakeServices().database;
  const user = { uid: 'bob', name: 'Robert Martin Durand', firebase: { sign_in_provider: 'google.com' } };
  const account = { total: 300, history: { s1: { score: 120 }, s2: { score: 180 } } };
  await recordLeaderboard(db, user, 'ignored', { sessionId: 's2', score: 180 }, 1000, account);
  await recordLeaderboard(db, user, 'ignored', { sessionId: 's2', score: 180 }, 2000, { total: 999, history: {} });
  assert.deepEqual(db.store.get('leaderboard/bob'), { total: 300, best: 180, lastSession: 's2', name: 'Robert M.', guest: false, updatedAt: 1000 });
  const guest = { uid: 'g', firebase: { sign_in_provider: 'anonymous' } };
  await recordLeaderboard(db, guest, '', { sessionId: 'x', score: 40 }, 1000);
  await recordLeaderboard(db, guest, 'Max', { sessionId: 'y', score: 30 }, 5000);
  assert.deepEqual([db.store.get('leaderboard/g').total, db.store.get('leaderboard/g').best, db.store.get('leaderboard/g').name], [70, 40, 'Max']);
});
test('pre-server scores stay on the leaderboard after new games', async () => {
  assert.deepEqual(legacyStats({ total: 500, best: { score: 40 }, history: { a: { score: 90 }, b: { score: 10 } } }), { total: 500, best: 90 });
  const db = fakeServices().database;
  const user = { uid: 'old', name: 'Ana Lopez', firebase: { sign_in_provider: 'google.com' } };
  await recordLeaderboard(db, user, '', { sessionId: 's1', score: 30 }, 1000, { total: 30, history: { s1: { score: 30 } } }, { total: 500, best: 90 });
  assert.equal(db.store.get('leaderboard/old').total, 530);
  assert.equal(db.store.get('leaderboard/old').best, 90);
});
test('guest rankings always expire, whatever the score', async () => {
  const db = fakeServices().database;
  const guest = { uid: 'g2', firebase: { sign_in_provider: 'anonymous' } };
  await recordLeaderboard(db, guest, 'Speedy', { sessionId: 'b', score: 5000 }, 2000);
  assert.equal(db.store.get('leaderboard/g2').expiresAt, 2000 + GUEST_TTL_MS);
  assert.equal(db.store.get('leaderboard/g2').name, 'Speedy');
});
test('retired paid AI endpoint fails closed', async () => {
  assert.equal((await oldAI(request({ mode: 'ping' }))).status, 410);
});
test('both real banks are private, loadable, and every reference validates', () => {
  for (const direction of ['en-fr', 'fr-en']) {
    const real = getBank(direction);
    assert.ok(real.size > 0);
    for (const q of real.values()) assert.equal(correctAnswer(q.hint, q, { direction }), true, q.id);
  }
});
test('public artifact excludes banks, sources, configs and server code; CSP contains no script unsafe-inline', () => {
  execFileSync(process.execPath, ['scripts/build-public.cjs']);
  for (const name of ['data', 'questions', 'questions1', 'server', 'netlify', 'firebase-rules', '.env', '.env.example', '.git', 'package.json', 'README.md']) assert.equal(existsSync(`public/${name}`), false, name);
  assert.deepEqual(readdirSync('public').sort(), ['404.html', '_headers', 'apple-touch-icon-hw.png', 'apple-touch-icon.png', 'assets', 'favicon.ico', 'index.html', 'js', 'manifest.json', 'robots.txt', 'sitemap.xml', 'sw.js']);
  for (const file of ['js/halloween.js', 'js/hwshapes.js', 'js/answer-check.mjs', 'assets/halloween-music.mp3', 'assets/Jack O Lantern Witch.json', 'assets/9.png']) assert.equal(existsSync(`public/${file}`), true, file);
  const headers = readFileSync('public/_headers', 'utf8');
  assert.doesNotMatch(headers.match(/script-src[^;]+/)[0], /unsafe-inline|unsafe-eval/);
  const html = readFileSync('public/index.html', 'utf8');
  assert.doesNotMatch(html, /questions-fr-en.json|questions-en-fr.json|saveBest\(|saveHistory\(|GROQ_API_KEY/);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/src=|application\/ld\+json/.test(match[1])) new vm.Script(match[2]);
  }
});
