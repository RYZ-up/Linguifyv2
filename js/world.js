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
  const BAT = '<svg viewBox="0 0 100 50" aria-hidden="true">'
    + '<path class="w-bat-l" d="M50 22 C44 14 34 8 20 8 C24 12 25 16 24 20 C19 17 12 17 4 21 C10 22 14 26 15 31 C20 27 27 27 32 30 C35 27 40 26 44 28 Z"/>'
    + '<path class="w-bat-r" d="M50 22 C56 14 66 8 80 8 C76 12 75 16 76 20 C81 17 88 17 96 21 C90 22 86 26 85 31 C80 27 73 27 68 30 C65 27 60 26 56 28 Z"/>'
    + '<path d="M44 18 L45 10 L48 15 L52 15 L55 10 L56 18 C57 24 55 31 50 34 C45 31 43 24 44 18 Z"/>'
    + '<circle class="w-bat-eye" cx="47.6" cy="18.5" r="1.1"/><circle class="w-bat-eye" cx="52.4" cy="18.5" r="1.1"/></svg>';
  const hills = world.querySelector('.w-hill');
  const flight = () => {
    if (document.hidden || world.querySelectorAll('.w-bat').length >= 3) return;
    const ltr = Math.random() < .5, n = Math.random() < .35 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const bat = document.createElement('div');
      bat.className = 'w-bat' + (ltr ? '' : ' rtl');
      bat.innerHTML = BAT;
      // Profondeur : les petites sont loin (plus lentes, plus pâles), les grandes proches
      const depth = Math.random(), size = 30 + depth * 34;
      bat.style.cssText = `top:${8 + Math.random() * 36 + i * 6}%;width:${size}px;opacity:${.55 + depth * .45};animation-duration:${11 - depth * 4 + Math.random() * 2}s;animation-delay:${i * .5}s;--flap:${.2 + (1 - depth) * .08}s`;
      bat.addEventListener('animationend', e => { if (e.target === bat) bat.remove(); });
      world.insertBefore(bat, hills);
    }
  };
  setTimeout(flight, 2500);
  setInterval(flight, 9000);
}
