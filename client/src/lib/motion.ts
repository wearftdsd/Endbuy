/**
 * Effets de mouvement qui suivent la souris (« motion control ») :
 *  - halo lumineux qui suit le curseur avec un léger retard ;
 *  - [data-tilt]      : l'élément s'incline en 3D vers le curseur ;
 *  - [data-magnetic]  : l'élément est attiré vers le curseur ;
 *  - [data-spotlight] : un reflet suit le curseur à la surface de l'élément ;
 *  - [data-parallax]  : l'élément se décale selon la position du curseur (profondeur = valeur).
 * Tout est piloté par délégation d'événements et requestAnimationFrame : aucun écouteur par élément.
 * Désactivé si l'utilisateur coupe les effets ou demande moins d'animations.
 */
const root = document.documentElement;
let enabled = false;
let glow: HTMLDivElement | null = null;
let pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false };
const glowPos = { x: pointer.x, y: pointer.y };
let raf = 0;
let tiltEl: HTMLElement | null = null;
let magnetEl: HTMLElement | null = null;
let spotEl: HTMLElement | null = null;
let parallaxEls: HTMLElement[] = [];
let parallaxScan = 0;

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function closest(target: EventTarget | null, attr: string): HTMLElement | null {
  return target instanceof Element ? (target.closest(`[${attr}]`) as HTMLElement | null) : null;
}

function resetTilt(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove('is-tilting');
  el.style.setProperty('--rx', '0deg');
  el.style.setProperty('--ry', '0deg');
  el.style.setProperty('--tz', '0px');
}

function resetMagnet(el: HTMLElement | null) {
  if (!el) return;
  el.style.setProperty('--magx', '0px');
  el.style.setProperty('--magy', '0px');
}

function onMove(e: PointerEvent) {
  if (e.pointerType === 'touch') return;
  pointer = { x: e.clientX, y: e.clientY, active: true };

  const t = closest(e.target, 'data-tilt');
  if (t !== tiltEl) {
    resetTilt(tiltEl);
    tiltEl = t;
  }
  const m = closest(e.target, 'data-magnetic');
  if (m !== magnetEl) {
    resetMagnet(magnetEl);
    magnetEl = m;
  }
  const s = closest(e.target, 'data-spotlight');
  if (s !== spotEl) {
    spotEl?.style.setProperty('--spot', '0');
    spotEl = s;
  }
  if (!raf) raf = requestAnimationFrame(frame);
}

function onLeave() {
  pointer.active = false;
  resetTilt(tiltEl);
  resetMagnet(magnetEl);
  spotEl?.style.setProperty('--spot', '0');
  tiltEl = magnetEl = spotEl = null;
  if (glow) glow.style.opacity = '0';
}

function frame() {
  raf = 0;
  if (!enabled) return;
  const { x, y } = pointer;

  if (tiltEl) {
    const r = tiltEl.getBoundingClientRect();
    const strength = Number(tiltEl.dataset.tilt) || 8;
    const px = (x - r.left) / r.width - 0.5;
    const py = (y - r.top) / r.height - 0.5;
    tiltEl.classList.add('is-tilting');
    tiltEl.style.setProperty('--rx', `${(-py * strength).toFixed(2)}deg`);
    tiltEl.style.setProperty('--ry', `${(px * strength).toFixed(2)}deg`);
    tiltEl.style.setProperty('--tz', `${Math.min(10, strength)}px`);
    tiltEl.style.setProperty('--gx', `${((px + 0.5) * 100).toFixed(1)}%`);
    tiltEl.style.setProperty('--gy', `${((py + 0.5) * 100).toFixed(1)}%`);
  }
  if (magnetEl) {
    const r = magnetEl.getBoundingClientRect();
    const pull = Number(magnetEl.dataset.magnetic) || 0.25;
    magnetEl.style.setProperty('--magx', `${((x - (r.left + r.width / 2)) * pull).toFixed(1)}px`);
    magnetEl.style.setProperty('--magy', `${((y - (r.top + r.height / 2)) * pull).toFixed(1)}px`);
  }
  if (spotEl) {
    const r = spotEl.getBoundingClientRect();
    spotEl.style.setProperty('--lx', `${(x - r.left).toFixed(0)}px`);
    spotEl.style.setProperty('--ly', `${(y - r.top).toFixed(0)}px`);
    spotEl.style.setProperty('--spot', '1');
  }

  // Parallaxe : on rescanne la page de temps en temps (éléments ajoutés / retirés).
  const now = performance.now();
  if (now - parallaxScan > 1000) {
    parallaxEls = Array.from(document.querySelectorAll<HTMLElement>('[data-parallax]'));
    parallaxScan = now;
  }
  const nx = x / window.innerWidth - 0.5;
  const ny = y / window.innerHeight - 0.5;
  for (const el of parallaxEls) {
    const depth = Number(el.dataset.parallax) || 20;
    el.style.setProperty('--px', `${(-nx * depth).toFixed(1)}px`);
    el.style.setProperty('--py', `${(-ny * depth).toFixed(1)}px`);
  }

  // Halo qui suit le curseur avec inertie.
  glowPos.x += (x - glowPos.x) * 0.16;
  glowPos.y += (y - glowPos.y) * 0.16;
  if (glow) {
    glow.style.transform = `translate3d(${glowPos.x.toFixed(1)}px, ${glowPos.y.toFixed(1)}px, 0)`;
    glow.style.opacity = pointer.active ? '1' : '0';
  }
  if (Math.abs(x - glowPos.x) > 0.5 || Math.abs(y - glowPos.y) > 0.5) raf = requestAnimationFrame(frame);
}

function attach() {
  if (!glow) {
    glow = document.createElement('div');
    glow.className = 'cursor-glow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);
  }
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
}

function detach() {
  window.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerleave', onLeave);
  window.removeEventListener('blur', onLeave);
  onLeave();
  glow?.remove();
  glow = null;
  for (const el of document.querySelectorAll<HTMLElement>('[data-parallax]')) {
    el.style.removeProperty('--px');
    el.style.removeProperty('--py');
  }
}

/** Active ou coupe les effets (préférence utilisateur + « réduire les animations »). */
export function setMotionEnabled(wanted: boolean) {
  const next = wanted && !reducedQuery.matches && !window.matchMedia('(pointer: coarse)').matches;
  if (next === enabled) return;
  enabled = next;
  root.dataset.motion = enabled ? 'on' : 'off';
  if (enabled) attach();
  else detach();
}

reducedQuery.addEventListener?.('change', () => setMotionEnabled(root.dataset.motionWanted !== 'false'));
