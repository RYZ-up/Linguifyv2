/* Mode Halloween : fond de nuit, décor, sons synthétisés, musique.
   index.html l'appelle via window.HW : draw() dans le canvas, sound() dans playSfx, apply() dans applyTheme. */
import { TREE, CAULDRON } from './hwshapes.js';

export const HALLOWEEN = '#ff7a18';
const root = document.documentElement;
export const active = () => root.dataset.mode === 'halloween';
const rnd = (a, b) => Math.random() * (b - a) + a;
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
const mobile = window.matchMedia('(max-width: 860px)');
let audioCtx = null;
let opts = { animations: true, freezeBg: false };

/* Préférences musique (propres à ce mode) */
const MUSIC_KEY = 'lq_hw_music';
const prefs = { vol: 5, muted: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(MUSIC_KEY) || '{}')); } catch { /* ignore */ }

/* Sons Halloween synthétisés (aucun fichier) : thérémine + réverbération de crypte */
let crypt = null;
function cryptVerb() {
  if (crypt) return crypt;
  const len = audioCtx.sampleRate * 2.2, ir = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  crypt = audioCtx.createConvolver();
  crypt.buffer = ir;
  const wet = audioCtx.createGain();
  wet.gain.value = 0.45;
  crypt.connect(wet); wet.connect(audioCtx.destination);
  return crypt;
}
/* Une note : sinus + octave douce, vibrato lent façon thérémine, glissé d'entrée */
function ghostNote(freq, t, dur, vol, { type = 'sine', glide = 0.97, vib = 5.5 } = {}) {
  const o = audioCtx.createOscillator(), o2 = audioCtx.createOscillator(), g = audioCtx.createGain(), g2 = audioCtx.createGain();
  const lfo = audioCtx.createOscillator(), lg = audioCtx.createGain();
  o.type = type; o2.type = 'sine';
  o.frequency.setValueAtTime(freq * glide, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
  o2.frequency.setValueAtTime(freq * 2 * glide, t); o2.frequency.exponentialRampToValueAtTime(freq * 2, t + 0.08);
  lfo.frequency.value = vib; lg.gain.value = freq * 0.012;
  lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
  g2.gain.value = 0.18;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); o2.connect(g2); g2.connect(g);
  g.connect(audioCtx.destination); g.connect(cryptVerb());
  for (const n of [o, o2, lfo]) { n.start(t); n.stop(t + dur + 0.05); }
}
const ST = n => Math.pow(2, n / 12);
export function sound(ctx, key, rate, vol) {
  audioCtx = ctx;
  const t = audioCtx.currentTime + 0.01;
  if (key === 'correct') {
    /* arpège mineur montant (la, do, mi), plus aigu avec la série */
    const base = 330 * rate;
    [0, 3, 7].forEach((n, i) => ghostNote(base * ST(n), t + i * 0.07, 0.55 + i * 0.1, vol * 0.32));
  } else if (key === 'incorrect') {
    /* « wooo » grave : triton dissonant qui glisse vers le bas */
    for (const [f, type] of [[196, 'triangle'], [196 * ST(6), 'sine']]) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), lp = audioCtx.createBiquadFilter();
      o.type = type; lp.type = 'lowpass'; lp.frequency.value = 900;
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.6);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * 0.3, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(lp); lp.connect(g); g.connect(audioCtx.destination); g.connect(cryptVerb());
      o.start(t); o.stop(t + 0.75);
    }
  } else {
    /* carillon d'orgue lugubre : la mineur descendant puis remontée finale */
    [12, 7, 3, 0, 15].forEach((n, i) => ghostNote(220 * ST(n), t + i * 0.16, i === 4 ? 1.6 : 0.6, vol * 0.3, { type: 'triangle', vib: 4 }));
  }
}


/* ── Musique d'Halloween : seulement dans ce mode. Les navigateurs bloquent le son avant toute interaction,
   donc on retente au premier clic / touche. ── */
let music = null;
const wantMusic = () => active() && !prefs.muted && prefs.vol > 0 && !document.hidden;
function syncMusic() {
  if (!wantMusic()) { music?.pause(); return; }
  if (!music) {
    music = new Audio('/assets/halloween-music.mp3');
    music.loop = true;
  }
  music.volume = prefs.vol / 10 * 0.5;
  if (music.paused) music.play().catch(() => { /* attend une interaction */ });
}
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { if (wantMusic() && (!music || music.paused)) syncMusic(); }, true);
document.addEventListener('visibilitychange', syncMusic);


/* ── Décor Halloween : scène de l'arbre en fond + araignée pendue (desktop) ── */
let decorBox = null;
function decor(on) {
  if (!on) { decorBox?.remove(); decorBox = null; return; }
  if (decorBox) return;
  decorBox = document.createElement('div');
  decorBox.className = 'hw-decor';
  decorBox.setAttribute('aria-hidden', 'true');
  decorBox.innerHTML = '<div class="hw-scene"></div><div class="hw-cat"></div><div class="hw-spider"><div class="hw-spider-p"></div></div>';
  document.body.insertBefore(decorBox, document.getElementById('bg-canvas').nextSibling);
  const box = decorBox;
  /* Chargement après l'affichage de la page, une animation à la fois : évite le gel au démarrage */
  const idle = cb => (window.requestIdleCallback || (f => setTimeout(f, 200)))(cb, { timeout: 2500 });
  const add = (sel, src, speed, mode) => {
    if (box !== decorBox) return;
    const p = document.createElement('lottie-player');
    p.setAttribute('src', src);
    p.setAttribute('speed', speed);
    p.setAttribute('background', 'transparent');
    p.setAttribute('loop', '');
    if (mode) p.setAttribute('mode', mode);
    if (!opts.freezeBg) p.setAttribute('autoplay', '');
    box.querySelector(sel).appendChild(p);
  };
  const start = () => setTimeout(() => idle(() => Promise.resolve().then(() => {
    add('.hw-scene', '/assets/ctfbackground.json', 0.7, 'bounce');  // aller-retour : pas de saut en fin de boucle
    add('.hw-cat', '/assets/chat-silhouette.json', 0.6);
    if (!mobile.matches) setTimeout(() => idle(() => add('.hw-spider-p', '/assets/Spider.json', 0.6, 'bounce')), 1500);
  }).catch(() => {})), 600);
  document.readyState === 'complete' ? start() : window.addEventListener('load', start, { once: true });
}


/* ── Nuit d'Halloween : ciel + lune + cimetière pré-rendus, étoiles/chauves-souris/brume animées ── */
let night = null;
function buildNight(W, H, dpr) {
  const off = document.createElement('canvas');
  off.width = W * dpr; off.height = H * dpr;
  let c = off.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#07060f'); sky.addColorStop(0.55, '#1a1033'); sky.addColorStop(1, '#2a1438');
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  /* sur mobile, la lune descend dans la zone vide à droite : en haut elle passe derrière le titre */
  const mx = W * 0.8, my = W < 600 ? H * 0.46 : H * 0.2, mr = Math.max(W < 600 ? 20 : 28, Math.min(W, H) * 0.06);
  const halo = c.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 5);
  halo.addColorStop(0, 'rgba(255,214,150,0.28)'); halo.addColorStop(1, 'rgba(255,214,150,0)');
  c.fillStyle = halo; c.fillRect(0, 0, W, H);
  c.fillStyle = '#fbe7c0'; c.beginPath(); c.arc(mx, my, mr, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(190,160,120,0.35)';
  for (const [dx, dy, r] of [[-0.3, -0.2, 0.22], [0.25, 0.3, 0.16], [0.1, -0.45, 0.1]]) {
    c.beginPath(); c.arc(mx + dx * mr, my + dy * mr, r * mr, 0, Math.PI * 2); c.fill();
  }
  /* 2e couche, dessinée APRÈS les étoiles et chauves-souris : rien ne traverse la silhouette */
  const fg = document.createElement('canvas');
  fg.width = W * dpr; fg.height = H * dpr;
  c = fg.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  /* colline, grilles, tombes, arbre, marmite : une seule silhouette */
  const base = H * 0.86;
  const hillY = x => base - Math.sin(x / W * Math.PI * 3) * H * 0.025 - Math.sin(x / 90) * 6;
  c.fillStyle = '#0b0714';
  c.strokeStyle = '#0b0714';
  /* colline débordant de chaque côté : aucun bord visible, quelle que soit la largeur */
  c.beginPath(); c.moveTo(-20, H + 20); c.lineTo(-20, hillY(-20));
  for (let x = -20; x < W + 20; x += 10) c.lineTo(x, hillY(x));
  c.lineTo(W + 20, hillY(W + 20)); c.lineTo(W + 20, H + 20); c.closePath(); c.fill();
  /* point le plus bas de la colline sous un objet : rien ne flotte quand la pente change sous sa base */
  const ground = (x, half) => Math.max(hillY(x - half), hillY(x), hillY(x + half));
  const silhouette = (shape, x, y, sc) => {
    c.save(); c.translate(x, y); c.scale(sc, sc);
    for (const d of shape.d) c.fill(new Path2D(d));
    c.restore();
  };
  /* Tombes et croix : jamais l'une sur l'autre, ni sur le chat ou la marmite (devant l'arbre et la grille : voulu) */
  const used = [];
  const free = (l, r) => l >= 0 && r <= W && used.every(([a, b]) => r <= a || l >= b);
  const mobileW = W < 600;
  const sw = Math.min(W * 0.95, H * 1.45), k = sw / 1920, k0 = Math.min(W * 0.62, H * 0.95) / 1920;
  const left = W * 0.18 - TREE.x * k;
  const tx = left + TREE.x * k, ty = ground(tx, 200 * k) + TREE.h * k * 0.03, top = ty - TREE.y * k;
  const ck = k0 * 0.85, cx = tx + 510 * k + 175 * ck;
  used.push([cx - 175 * ck, cx + 175 * ck]);
  const catS = Math.max(26, Math.min(H * 0.08, W * 0.08));
  const catX = Math.max(cx + 175 * ck + catS * 0.5, W * 0.64), catY = ground(catX, catS * 0.2) + catS * 0.03;
  used.push([catX - catS * 0.4, catX + catS * 0.25]);
  /* grilles qui suivent la colline : à gauche derrière l'arbre, et à droite après le chat */
  const fence = (x0, x1) => {
    const step = mobileW ? 10 : 13, hgt = mobileW ? 30 : 40;
    for (let x = x0; x <= x1; x += step) {
      const y = hillY(x) + 6;
      c.fillRect(x - 1.5, y - hgt, 3, hgt);
      c.beginPath(); c.moveTo(x - 4.5, y - hgt + 4); c.lineTo(x, y - hgt - 7); c.lineTo(x + 4.5, y - hgt + 4); c.closePath(); c.fill();
    }
    c.lineWidth = 3;
    for (const off of [hgt * 0.75, hgt * 0.3]) {
      c.beginPath(); c.moveTo(x0, hillY(x0) + 6 - off);
      for (let x = x0; x <= x1; x += 6) c.lineTo(x, hillY(x) + 6 - off);
      c.stroke();
    }
  };
  fence(-20, W * (mobileW ? 0.3 : 0.22));
  const fx0 = Math.max(catX + catS * 0.4, W * (mobileW ? 0.8 : 0.76));
  if (W - fx0 > 40) fence(fx0, W + 20);
  /* tombes et croix dans les espaces libres, jamais l'une sur l'autre */
  const gap = mobileW ? 8 : 14, maxW = mobileW ? 20 : 30, minW = mobileW ? 11 : 14;
  for (let x = gap; x < W; ) {
    const w = rnd(minW, maxW), l = x, r = x + w;
    if (!free(l - gap / 2, r + gap / 2)) { x += 6; continue; }
    used.push([l, r]);
    const gx = (l + r) / 2;
    c.save(); c.translate(gx, ground(gx, w / 2) + rnd(3, 6)); c.rotate(rnd(-0.1, 0.1));
    c.beginPath();
    if (Math.random() < 0.5) {
      const h = w * rnd(1.6, 2.2), t = Math.max(3, w * 0.2);
      c.rect(-t / 2, -h, t, h + 6); c.rect(-w * 0.42, -h * 0.75, w * 0.84, t);
    } else {
      const h = w * rnd(1.2, 1.6);
      c.moveTo(-w / 2, 6); c.lineTo(-w / 2, -h + w / 2); c.arc(0, -h + w / 2, w / 2, Math.PI, 0); c.lineTo(w / 2, 6); c.closePath();
    }
    c.fill();
    c.restore();
    x = r + gap + rnd(gap, gap * 5);
  }
  silhouette(TREE, tx, ty, k);
  silhouette(CAULDRON, cx, ground(cx, 150 * ck) + CAULDRON.h * ck * 0.28, ck);
  const rs = document.documentElement.style;
  rs.setProperty('--hw-x', left + 'px'); rs.setProperty('--hw-y', top + 'px'); rs.setProperty('--hw-w', sw + 'px');
  rs.setProperty('--cat-x', catX - catS * 0.55 + 'px'); rs.setProperty('--cat-y', catY - catS * 0.86 + 'px'); rs.setProperty('--cat-s', catS + 'px');
  const stars = Array.from({ length: Math.round(W * H / 9000) }, () => ({ x: rnd(0, W), y: rnd(0, base * 0.85), r: rnd(0.4, 1.3), p: rnd(0, Math.PI * 2), s: rnd(0.15, 0.6) }))
    .filter(st => Math.hypot(st.x - mx, st.y - my) > mr * 1.15);   // pas d'étoile devant la lune
  return { off, fg, stars, bats: [], nextBat: performance.now() + rnd(15000, 25000), W, H };
}
function drawBat(c, b, now) {
  const flap = Math.sin(now / 70 + b.p) * 0.6;
  c.save(); c.translate(b.x, b.y); c.scale(b.s * b.dir, b.s);
  c.fillStyle = '#05030a';
  c.beginPath(); c.ellipse(0, 0, 3, 5, 0, 0, Math.PI * 2); c.fill();
  for (const d of [-1, 1]) {
    c.beginPath(); c.moveTo(0, -1);
    c.quadraticCurveTo(d * 8, -8 - flap * 8, d * 16, -2 - flap * 10);
    c.quadraticCurveTo(d * 11, 0, d * 9, 3); c.quadraticCurveTo(d * 5, 1, 0, 3);
    c.fill();
  }
  c.restore();
}
function drawNight(ctx, W0, H0, paused, now) {
  if (!night || night.W !== W0 || night.H !== H0) night = buildNight(W0, H0, window.devicePixelRatio || 1);
  const { W, H } = night, t = now / 1000;
  ctx.drawImage(night.off, 0, 0, W, H);
  for (const st of night.stars) {
    ctx.globalAlpha = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * st.s + st.p));
    ctx.fillStyle = '#fff6e0';
    ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (!paused) {
    if (now > night.nextBat) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      for (let i = 0, n = rndInt(1, 2); i < n; i++) night.bats.push({ x: dir > 0 ? -40 - i * 30 : W + 40 + i * 30, y: rnd(H * 0.08, H * 0.45) + i * 14, vy: rnd(-12, 12), v: rnd(70, 110) * dir, dir, s: rnd(0.8, 1.5), p: rnd(0, 6) });
      night.nextBat = now + rnd(25000, 40000);
    }
    night.bats = night.bats.filter(b => b.x > -80 && b.x < W + 80);
    /* Déplacement au temps écoulé : même vitesse quelle que soit la cadence d'affichage */
    const dt = Math.min(0.1, (now - (night.last || now)) / 1000);
    for (const b of night.bats) { b.x += b.v * dt; b.y += (b.vy + Math.sin(now / 300 + b.p) * 36) * dt; drawBat(ctx, b, now); }
  }
  ctx.drawImage(night.fg, 0, 0, W, H);
  night.last = now;
}


export const draw = (ctx, W, H, paused) => drawNight(ctx, W, H, paused, performance.now());

function savePrefs() { try { localStorage.setItem(MUSIC_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }
function syncMusicUI() {
  const off = prefs.muted || !prefs.vol;
  const r = document.getElementById('set-music'), p = document.getElementById('music-pct'), i = document.querySelector('#btn-music-mute i');
  if (r) r.value = prefs.vol;
  if (p) p.textContent = off ? 'Off' : prefs.vol * 10 + '%';
  if (i) i.className = 'fa-solid ' + (off ? 'fa-volume-xmark' : 'fa-volume-high');
}
document.getElementById('set-music')?.addEventListener('input', e => {
  prefs.vol = +e.target.value;
  if (prefs.vol) prefs.muted = false;
  savePrefs(); syncMusicUI(); syncMusic();
});
document.getElementById('btn-music-mute')?.addEventListener('click', () => {
  if (!prefs.vol) { prefs.vol = 5; prefs.muted = false; } else prefs.muted = !prefs.muted;
  savePrefs(); syncMusicUI(); syncMusic();
});
syncMusicUI();

/* Appelé par applyTheme() et persistSettings() */
export function apply(color, settings) {
  if (settings) opts = settings;
  const on = (color || '').toLowerCase() === HALLOWEEN;
  if (on) root.dataset.mode = 'halloween'; else delete root.dataset.mode;
  decor(on && opts.animations !== false);
  syncMusic();
  document.querySelectorAll('.hw-decor lottie-player').forEach(l => {
    try { opts.freezeBg ? l.pause() : l.play(); } catch { /* pas encore chargé */ }
  });
}

window.HW = { active, draw, sound, apply };
/* le module se charge après le script principal : on rattrape l'état déjà posé */
let saved = {};
try { saved = JSON.parse(localStorage.getItem('lq_settings_v1') || '{}') || {}; } catch { /* ignore */ }
apply(active() ? HALLOWEEN : '', { animations: saved.animations !== false, freezeBg: !!saved.freezeBg });
