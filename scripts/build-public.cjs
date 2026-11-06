const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
// Build from an explicit allowlist, never from the repository root.
if (path.dirname(output) !== root || path.basename(output) !== 'public') throw new Error('Unsafe output directory');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output);
const files = ['index.html', '404.html', 'manifest.json', 'sw.js', 'favicon.ico', 'apple-touch-icon.png', 'apple-touch-icon-hw.png', 'robots.txt', 'sitemap.xml'];
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(output, file));
const assets = ['9.png', 'Jack O Lantern Witch.json', 'Spider.json', 'chat-silhouette.json', 'ctfbackground.json', 'halloween-music.mp3', '4.png', '5.png', '6.png', '7.png', '8.png', 'logo.png', 'icon-192.png', 'icon-512.png', 'achievement.mp3', 'correct.mp3', 'incorrect.mp3', '5a3ef944-117d-11ee-a1ad-3f2ca2b1255d.json', '5a3fd62a-117d-11ee-a1ae-ab9745c41f84.json', '5a40df34-117d-11ee-a1af-5fe2367006a3.json', 'UFO 404.json'];
fs.mkdirSync(path.join(output, 'assets'));
for (const file of assets) fs.copyFileSync(path.join(root, 'assets', file), path.join(output, 'assets', file));
const localScripts = ['halloween.js', 'hwshapes.js', 'answer-check.mjs', 'week.mjs', 'world.js'];
fs.mkdirSync(path.join(output, 'js'));
for (const file of localScripts) fs.copyFileSync(path.join(root, 'js', file), path.join(output, 'js', file));
const scripts = new Set();
const remoteScripts = new Set();
for (const file of ['index.html', '404.html']) {
  const html = fs.readFileSync(path.join(output, file), 'utf8');
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const source = match[1].match(/\bsrc="([^"]+)"/);
    if (source?.[1].startsWith('https://')) remoteScripts.add(source[1]);
    else if (!source && match[2].trim()) scripts.add(`'sha256-${crypto.createHash('sha256').update(match[2].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  }
}
const csp = [
  "manifest-src 'self'",
  "default-src 'none'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
  `script-src 'self' ${[...scripts].join(' ')} ${[...remoteScripts].join(' ')} https://apis.google.com https://*.europe-west1.firebasedatabase.app`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  "img-src 'self' data: https://www.gstatic.com https://www.google.com",
  "media-src 'self'", "worker-src 'self' blob:",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.europe-west1.firebasedatabase.app wss://*.europe-west1.firebasedatabase.app",
  "frame-src https://ton-projet-firebase.firebaseapp.com https://*.europe-west1.firebasedatabase.app",
  "upgrade-insecure-requests"
].join('; ');
const headers = `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n  Cross-Origin-Opener-Policy: same-origin-allow-popups\n  Cross-Origin-Resource-Policy: same-origin\n  Cache-Control: no-cache\n/api/*\n  Cache-Control: private, no-store\n  Netlify-CDN-Cache-Control: no-store\n  X-Robots-Tag: noindex\n`;
fs.writeFileSync(path.join(output, '_headers'), headers);
console.log(`Public build: ${files.length + assets.length + localScripts.length + 2} allowlisted files. Private banks and server code excluded.`);
