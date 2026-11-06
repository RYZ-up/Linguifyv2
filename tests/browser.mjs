import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { answerKey } from '../js/answer-check.mjs';

execFileSync(process.execPath, ['scripts/build-public.cjs']);
const root = resolve('public');
const csp = readFileSync('public/_headers', 'utf8').match(/Content-Security-Policy: (.+)/)[1];
const debugSourceMaps = [
  "https://unpkg.com/@lottiefiles/lottie-player@2.0.2/dist/lottie-player.js.map",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.js.map",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js.map",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth-compat.js.map",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-database-compat.js.map",
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check-compat.js.map"
];
const observed = [];
let warmed = 0;
const server = http.createServer(async (req, res) => {
  if (req.url === '/api/game') {
    let raw = ''; for await (const data of req) raw += data;
    const input = JSON.parse(raw);
    if (input.action === 'warm') { warmed++; res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); return; }
    if (input.action === 'leaderboard') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ week: 'w', start: 0, end: Date.now() + 1e8, rows: [], me: null })); return; }
    if (input.action === 'online') { res.setHeader('content-type', 'application/json'); res.end('{"players":3}'); return; }
    observed.push(input);
    assert.equal(req.headers.authorization, 'Bearer browser.test');
    res.setHeader('content-type', 'application/json');
    const stats = { score: 50, correct: 1, streak: 1, streakMax: 1, completedStreaks: 0 };
    const refs = ['Bonjour', 'Au revoir'];
    const questions = await Promise.all([{ en: 'Hello!', level: 1 }, { en: 'Goodbye!', level: 1 }].slice(0, input.settings?.count ?? 2)
      .map(async (q, i) => ({ ...q, keys: [await answerKey('salt', i, refs[i], 'en-fr')] })));
    if (input.action === 'start') res.end(JSON.stringify({ sessionId: 'server-session', salt: 'salt', questions, settings: input.settings }));
    else if (input.action === 'check') res.end(JSON.stringify({ ok: input.userAnswer === 'Salut' || input.userAnswer === refs[input.index], expected: refs[input.index] }));
    else if (input.action === 'finish') res.end(JSON.stringify({ ...stats, answered: 1, temps: 5, rate: 12, best: { score: 50, rate: 12 }, total: 50, isNew: true }));
    else { res.statusCode = 400; res.end('{}'); }
    return;
  }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) { res.statusCode = 404; res.end(); return; }
  if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg' })[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  let longPollScripts = 0;
  const loadedSourceMaps = [];
  page.on('pageerror', e => errors.push(e.message));
  // Firebase credentials and external services are mocked; run the actual app with its CSP.
  await page.route(/^https:\/\//, route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('https://ton-projet-firebase-default-rtdb.europe-west1.firebasedatabase.app/.lp?**', route => {
    longPollScripts++;
    return route.fulfill({ contentType: 'application/javascript', body: 'window.__firebaseLongPollLoaded = true;' });
  });
  await page.route(/\.map(?:\?|$)/, route => {
    loadedSourceMaps.push(route.request().url());
    return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ version: 3, sources: [], names: [], mappings: '' }) });
  });
  await page.addInitScript(() => {
    localStorage.setItem('lq_onboard_v1', '1');
    localStorage.setItem('lq_hw_music', JSON.stringify({ vol: 0, muted: true }));
    localStorage.setItem('lq_questions_v5', JSON.stringify([{ answers: ['secret'] }]));
    const user = { uid: 'alice', isAnonymous: false, displayName: 'Alice', getIdToken: async () => 'browser.test' };
    const auth = { currentUser: user, onAuthStateChanged: cb => setTimeout(() => cb(user), 0), signOut: async () => {}, signInWithPopup: async () => {} };
    const db = { ref: () => ({ once: async () => ({ val: () => null }), set: async () => {}, limitToLast() { return this; } }) };
    window.firebase = { initializeApp: () => {}, auth: () => auth, database: () => db };
    window.Chart = class { destroy() {} };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser?.uid === 'alice').catch(error => { console.error('Browser errors:', errors); throw error; });
  const cdp = await page.context().newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  assert.ok(manifest.data?.includes('Linguify'), 'CSP must allow the application manifest');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://ton-projet-firebase-default-rtdb.europe-west1.firebasedatabase.app/.lp?start=t&test=1';
    script.onload = resolve; script.onerror = () => reject(new Error('Firebase long polling blocked'));
    document.head.appendChild(script);
  }));
  assert.equal(await page.evaluate(() => window.__firebaseLongPollLoaded), true);
  assert.equal(longPollScripts, 1);
  const blockedMaps = await page.evaluate(async urls => Promise.all(urls.map(url => fetch(url).then(() => false, () => true))), debugSourceMaps);
  assert.deepEqual(blockedMaps, debugSourceMaps.map(() => true), 'Source maps must stay out of the production CSP');
  assert.deepEqual(loadedSourceMaps, []);
  await page.evaluate(() => { settings.mode = 'count'; settings.count = 1; settings.autoNext = false; settings.autoValidate = false; });
  await page.locator('#tuto-close').click({ timeout: 1200 }).catch(() => {});
  // The tutorial is static; dismiss whichever close element the old UI exposes.
  await page.evaluate(() => { if (typeof closeTuto === 'function') closeTuto(); });
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => document.getElementById('p-txt').textContent === 'Hello!');
  assert.equal(await page.evaluate(() => localStorage.getItem('lq_questions_v5')), null);
  assert.doesNotMatch(await page.evaluate(() => JSON.stringify(gPhrases)), /Bonjour|Au revoir/, 'answers never reach the browser');
  await page.locator('#ans-input').fill('Bonjour');
  await page.locator('#btn-val').click();
  await page.waitForFunction(() => gWaiting === true);
  await page.locator('#btn-val').click();
  await page.waitForFunction(() => document.getElementById('s-results').classList.contains('active'));
  assert.equal(await page.locator('#res-bonnes').textContent(), '1/1');
  assert.deepEqual(observed.map(x => x.action), ['start', 'check', 'finish'], 'each answer is locked by the server');
  assert.equal(observed[2].answers[0].userAnswer, 'Bonjour');
  assert.equal(await page.locator('#set-autovalid').isChecked(), true, 'auto validation is on by default');
  await page.evaluate(() => { settings.count = 2; settings.autoValidate = true; });
  await page.locator('#btn-replay').click();
  // The previous game also showed « Hello! »: wait for the new one to be ready.
  await page.waitForFunction(() => document.getElementById('p-txt').textContent === 'Hello!' && !gWaiting && gResults.length === 0);
  await page.locator('#ans-input').pressSequentially('bonjou');
  assert.equal(await page.evaluate(() => gWaiting), false, 'an unfinished answer is not validated');
  await page.locator('#ans-input').pressSequentially('R');
  await page.waitForFunction(() => gWaiting === true, null, { timeout: 2000 });
  assert.equal(await page.evaluate(() => gResults.at(-1)), true, 'exact answer validated without Enter');
  await page.locator('#btn-val').click();
  await page.waitForFunction(() => document.getElementById('p-txt').textContent === 'Goodbye!');
  await page.locator('#ans-input').fill('Salut');
  await page.locator('#btn-val').click();
  await page.waitForFunction(() => gWaiting === true);
  assert.equal(await page.evaluate(() => gResults.at(-1)), true, 'approximate answer accepted by the AI');
  assert.equal(observed.at(-1).action, 'check');
  await page.locator('#btn-val').click();
  await page.waitForFunction(() => document.getElementById('s-results').classList.contains('active'));
  await page.evaluate(() => { settings.count = 2; });
  await page.locator('#btn-replay').click();
  await page.waitForFunction(() => document.getElementById('p-txt').textContent === 'Hello!');
  await page.evaluate(() => { gIdx = 1; loadPhrase(1); });
  await page.locator('#ans-input').fill('incorrect');
  await page.locator('#btn-val').click();
  await page.waitForFunction(() => gWaiting === true);
  assert.match(await page.locator('#p-txt').textContent(), /Au revoir/, 'correction is shown');
  await page.evaluate(() => { document.getElementById('set-level').value = '3'; document.getElementById('set-level').dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.getElementById('s-home').classList.contains('active'), null, { timeout: 1000 });
  assert.equal(observed.at(-1).action, 'finish', 'changing a game setting ends the game');
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => document.getElementById('s-game').classList.contains('active'));
  await page.locator('#btn-quit').click();
  await page.locator('#btn-quit-confirm').click();
  await page.waitForFunction(() => document.getElementById('s-home').classList.contains('active'), null, { timeout: 1000 });
  await page.waitForFunction(() => document.querySelector('#lottie-mascot lottie-player[src]'));
  assert.equal(observed.at(-1).action, 'finish', 'quitting still records the game in the background');
  assert.equal(await page.evaluate(async () => {
    try { await fetch('https://untrusted.example/security-probe'); return false; }
    catch { return true; }
  }), true, 'CSP must continue to block unrelated origins');
  assert.ok(warmed >= 1, 'home screen warms the server up');
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: CSP manifest, Firebase long polling, source maps blocked, blocked unrelated paths and origins, local correction, live hints, start/finish only. Firebase and third-party libraries mocked.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
