import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Renders every screen and overlay at narrow widths; fails if anything visible leaves the viewport.
execFileSync(process.execPath, ['scripts/build-public.cjs']);
const root = resolve('public');
const shots = process.env.RESPONSIVE_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const server = http.createServer(async (req, res) => {
  if (req.url === '/api/game') {
    let raw = ''; for await (const data of req) raw += data;
    const input = JSON.parse(raw);
    res.setHeader('content-type', 'application/json');
    const stats = { score: 120, correct: 1, streak: 1, streakMax: 1, completedStreaks: 0 };
    if (input.action === 'online') { res.end('{"players":3}'); return; }
    if (input.action === 'leaderboard') {
      // Classement de la semaine : 64 vrais joueurs (noms longs compris) ; l'uid n'est jamais renvoyé.
      const names = ['Alexandre-Maximilien D.', 'Zoé', 'Lou', 'Karim B.', 'Inès', 'Tom', 'Jade', 'Hugo', 'Léa', 'Nina', 'Sam', 'Max'];
      const rows = Array.from({ length: 50 }, (_, i) => ({ name: names[i % names.length], total: 9000 - i * 120, best: 900 - i * 9, guest: i % 5 === 1 }));
      const now = Date.now();
      res.end(JSON.stringify({ week: '2026-11-02', start: now - 3 * 86400000, end: now + 4 * 86400000, rows, me: { rank: 65, name: 'Alice', total: 1200, best: 260 } }));
      return;
    }
    if (input.action === 'start') res.end(JSON.stringify({ sessionId: 's', salt: 's', questions: [{ en: 'Could you possibly tell me where the nearest railway station is located?', level: 3, keys: [] }], settings: input.settings }));
    else if (input.action === 'check') res.end(JSON.stringify({ ok: true, expected: 'Pourriez-vous me dire où se trouve la gare la plus proche ?' }));
    else if (input.action === 'answer') res.end(JSON.stringify({ ok: true, ...stats }));
    else res.end(JSON.stringify({ ...stats, answered: 1, temps: 5, rate: 12, best: { score: 120, rate: 12 }, total: 4820, isNew: true }));
    return;
  }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
  if (!file.startsWith(root) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.png': 'image/png' })[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });

// Visible elements whose box crosses the viewport edge (ignores decorative fixed layers and scroll containers' children).
const overflow = () => {
  const W = innerWidth, H = innerHeight, bad = [];
  const scrollParent = el => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX + s.overflowY) && p !== document.body && p !== document.documentElement) return p; } return null; };
  for (const el of document.querySelectorAll('button, input, h1, h2, .lb-row, #lb-me, #tuto-card, #user-panel, #lb-panel, #settings-card, .card3d, header *')) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0 || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const box = scrollParent(el)?.getBoundingClientRect() || { left: 0, right: W };
    const left = Math.max(0, box.left), right = Math.min(W, box.right);
    if (r.left < left - 1 || r.right > right + 1) bad.push(`${el.id || el.className || el.tagName} [${Math.round(r.left)}..${Math.round(r.right)} / ${W}]`);
  }
  if (document.documentElement.scrollWidth > W + 1) bad.push(`page scrolls horizontally (${document.documentElement.scrollWidth}px)`);
  return [...new Set(bad)];
};

const failures = [];
for (const [w, h] of [[240, 520], [280, 600], [320, 568], [360, 640], [375, 667], [390, 844], [414, 896], [568, 320], [768, 1024], [1440, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https:\/\//, route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.addInitScript(() => {
    localStorage.setItem('lq_hw_music', JSON.stringify({ vol: 0, muted: true }));
    const names = ['Alexandre-Maximilien D.', 'Zoé', 'Lou', 'Karim B.', 'Inès', 'Tom', 'Jade', 'Hugo', 'Léa', 'Nina', 'Sam', 'Max'];
    const board = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`u${i}`, { name: names[i % names.length], total: 9000 - i * 120, best: 900 - i * 9, guest: i % 5 === 1 }]));
    board.alice = { name: 'Alice', total: 1200, best: 260 };
    const snap = entries => ({ forEach: cb => entries.forEach(([key, v]) => cb({ key, val: () => v })), numChildren: () => entries.length, val: () => Object.fromEntries(entries) });
    const query = (path, field, op = []) => ({
      orderByChild: f => query(path, f, op),
      limitToLast: n => query(path, field, [...op, ['last', n]]),
      startAfter: v => query(path, field, [...op, ['after', v]]),
      once: async () => {
        if (path.startsWith('leaderboard/')) { const v = board[path.slice(12)]; return { val: () => v ?? null }; }
        if (path !== 'leaderboard') return { val: () => null, forEach() {}, numChildren: () => 0 };
        let e = Object.entries(board).sort((a, b) => a[1][field] - b[1][field]);
        for (const [k, n] of op) e = k === 'last' ? e.slice(-n) : e.filter(([, v]) => v[field] > n);
        return snap(e);
      },
      set: async () => {}, limitToFirst() { return this; }
    });
    const user = { uid: 'alice', isAnonymous: false, displayName: 'Alice Martin', email: 'alice@example.com', getIdToken: async () => 't' };
    const auth = { currentUser: user, onAuthStateChanged: cb => setTimeout(() => cb(user), 0), signOut: async () => {}, signInWithPopup: async () => {} };
    window.firebase = { initializeApp: () => {}, auth: () => auth, database: () => ({ ref: p => query(p || '', 'total') }) };
    window.Chart = class { destroy() {} };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof currentUser !== 'undefined' && currentUser?.uid === 'alice');
  await page.waitForTimeout(1100);
  const check = async name => {
    await page.waitForTimeout(350);
    const bad = await page.evaluate(overflow);
    if (bad.length) failures.push(`${w}x${h} ${name}: ${bad.join(', ')}`);
    if (shots) await page.screenshot({ path: join(shots, `${w}x${h}-${name}.png`) });
  };
  // Tutorial: every step, including the one that opens the account menu.
  const steps = await page.evaluate(() => TUTO_STEPS.length);
  for (let i = 0; i < steps; i++) {
    if (i === 0) await page.evaluate(() => openTuto()); else await page.locator('#tuto-next').click();
    await check(`tuto-${i + 1}`);
    assert.equal(await page.evaluate(() => panelOpen), !!(await page.evaluate(i => TUTO_STEPS[i]?.menu, i)), `menu state at step ${i + 1}`);
  }
  await page.locator('#tuto-next').click();
  assert.equal(await page.evaluate(() => panelOpen || document.getElementById('tuto').classList.contains('open')), false, 'tutorial and menu closed at the end');
  await check('home');
  await page.locator('#btn-leaderboard').click();
  await page.waitForSelector('.lb-row');
  await check('leaderboard');
  // Ma place = rang réel + rivaux simulés au-dessus de moi ; une mention signale les joueurs simulés.
  const rows = await page.locator('.lb-row').count();
  assert.ok(rows > 50 && rows <= 100, `real players plus simulated rivals (${rows})`);
  assert.match(await page.locator('#lb-note').textContent(), /simulés/, 'simulated players are disclosed');
  const rank = Number(await page.locator('#lb-me .lb-rank').textContent());
  assert.ok(rank > 65 && rank <= 115, `my rank counts rivals above me (${rank})`);
  assert.match(await page.locator('#lb-reset').textContent(), /lundi/);
  await page.locator('.lb-tab[data-lb="best"]').click();
  await page.waitForTimeout(300);
  await check('leaderboard-best');
  await page.keyboard.press('Escape');
  await page.locator('#user-toggle').click();
  await check('user-panel');
  await page.evaluate(() => closePanel());
  await page.locator('#btn-settings-toggle').click();
  await check('settings');
  await page.evaluate(() => closeSettingsModal());
  await page.evaluate(() => { settings.mode = 'count'; settings.count = 1; settings.autoNext = false; });
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => document.getElementById('s-game').classList.contains('active'));
  await check('game');
  await page.locator('#ans-input').fill('Could you tell me');
  await page.locator('#btn-val').click();
  await page.waitForFunction(() => gWaiting === true, null, { timeout: 5000 }).catch(async e => { console.error(errors, await page.evaluate(() => [gWaiting, document.getElementById('ans-input').value, document.getElementById('btn-val').disabled])); throw e; });
  await check('game-answered');
  await page.locator('#btn-val').click();
  await page.waitForFunction(() => document.getElementById('s-results').classList.contains('active'));
  await check('results');
  // Rejouer accessible sans défiler, même avec la proposition de niveau affichée
  await page.evaluate(() => { document.getElementById('lvl-up').hidden = false; });
  await page.waitForTimeout(1600);
  if (h >= 560) {
    const bottom = await page.evaluate(() => document.getElementById('btn-replay').getBoundingClientRect().bottom - innerHeight);
    if (bottom > 0) failures.push(`${w}x${h} results: Rejouer ${Math.round(bottom)}px sous l'écran`);
  }
  if (errors.length) failures.push(`${w}x${h} errors: ${errors.join(' | ')}`);
  await page.close();
}
await browser.close();
server.close();
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Responsive checks passed from 240 to 1440 px and landscape: tutorial, weekly leaderboard with disclosed simulated rivals and rank, account, settings, game, results.');
