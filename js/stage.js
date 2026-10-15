// Hero parallax: pointer tilt (max 6 degrees) and scroll depth on the hero layers only.
// The forms never move. Reduced motion turns it all off.
const stage = document.querySelector('[data-stage]');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const layers = stage ? [...stage.querySelectorAll('[data-depth]')] : [];
const MAX_TILT = 6;

let px = 0;
let py = 0;
let tx = 0;
let ty = 0;
let frame = 0;

function apply() {
  frame = 0;
  // Ease toward the pointer target, so the scene follows with a little weight.
  tx += (px - tx) * 0.12;
  ty += (py - ty) * 0.12;
  const rect = stage.getBoundingClientRect();
  const scroll = Math.max(0, Math.min(1, -rect.top / Math.max(1, rect.height)));
  // Small screens keep the layers flat in z, so the text never grows past the screen edge.
  const zScale = window.innerWidth < 820 ? 0 : 0.2;
  layers.forEach((l) => {
    const d = Number(l.dataset.depth);
    const lift = scroll * d * -0.6;
    l.style.transform = `translate3d(${(tx * d) / 18}px, ${(ty * d) / 18 + lift}px, ${d * zScale}px) rotateX(${-ty * MAX_TILT}deg) rotateY(${tx * MAX_TILT}deg)`;
  });
  if (Math.abs(px - tx) > 0.001 || Math.abs(py - ty) > 0.001) request();
}

function request() {
  if (!frame) frame = requestAnimationFrame(apply);
}

function onPointer(e) {
  if (e.pointerType === 'touch') return;
  px = (e.clientX / window.innerWidth) * 2 - 1;
  py = (e.clientY / window.innerHeight) * 2 - 1;
  request();
}

function reset() {
  layers.forEach((l) => { l.style.transform = ''; });
}

function sync() {
  window.removeEventListener('pointermove', onPointer);
  window.removeEventListener('scroll', request);
  if (reduce.matches || !stage) {
    reset();
    return;
  }
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('scroll', request, { passive: true });
  request();
}

sync();
reduce.addEventListener('change', sync);
