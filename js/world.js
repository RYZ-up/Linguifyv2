/* Décor de l'accueil : étoiles qui scintillent posées dans .world */

const world = document.querySelector('.world');
if (world) {
  const sky = document.createElement('div');
  sky.className = 'w-stars';
  for (let i = 0; i < 60; i++) {
    const star = document.createElement('i');
    const size = 1 + Math.random() * 3;
    star.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 62}%;width:${size}px;height:${size}px;animation-delay:${-Math.random() * 4}s;animation-duration:${2 + Math.random() * 3}s`;
    sky.append(star);
  }
  world.prepend(sky);
}

/* Chauves-souris : une ou deux traversent le ciel de temps en temps, derrière les collines.
   Rien ne s'accumule : chaque chauve-souris est retirée à la fin de son vol ; pause quand l'onglet est caché. */
if (world && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const BAT = '<svg viewBox="0 0 100 34" aria-hidden="true">'
    + '<path class="w-bat-l" d="M46 15 C36 6 18 4 2 9 C8 11 11 15 12 20 C16 16 21 16 24 19 C27 15 32 15 35 19 C38 17 43 18 46 23 Z"/>'
    + '<path class="w-bat-r" d="M54 15 C64 6 82 4 98 9 C92 11 89 15 88 20 C84 16 79 16 76 19 C73 15 68 15 65 19 C62 17 57 18 54 23 Z"/>'
    + '<path d="M45 14 L46 7 L48.4 11 L51.6 11 L54 7 L55 14 C56 20 54 25 50 28 C46 25 44 20 45 14 Z"/></svg>';
  const hills = world.querySelector('.w-hill');
  const flight = () => {
    if (document.hidden || world.querySelectorAll('.w-bat').length >= 3) return;
    const ltr = Math.random() < .5, n = Math.random() < .35 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const bat = document.createElement('div');
      bat.className = 'w-bat' + (ltr ? '' : ' rtl');
      bat.innerHTML = BAT;
      // Profondeur : les petites sont loin (plus lentes, plus pâles), les grandes proches
      const depth = Math.random(), size = 20 + depth * 22;
      bat.style.cssText = `top:${8 + Math.random() * 36 + i * 6}%;width:${size}px;opacity:${.45 + depth * .55};animation-duration:${11 - depth * 4 + Math.random() * 2}s;animation-delay:${i * .5}s;--flap:${.28 + (1 - depth) * .1}s`;
      bat.addEventListener('animationend', e => { if (e.target === bat) bat.remove(); });
      world.insertBefore(bat, hills);
    }
  };
  setTimeout(flight, 2500);
  setInterval(flight, 9000);
}
