// Background: the HyperFrames night grid loop (videos/bg-loop, 12 s, seamless).
// A portrait screen gets videos/bg-loop-portrait.
// The canvas grid draws first and stays when the video cannot play.
// Reduced motion: one still canvas frame and no video.

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;
const canvas = document.querySelector('.grid-canvas');
const ctx = canvas.getContext('2d');
let video = null;
let raf = 0;
let start = performance.now();

function size() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}

// Simple version of the video scene: horizon glow and a grid floor that moves toward the viewer.
function drawGrid(p) {
  const W = canvas.width;
  const H = canvas.height;
  const hz = H * 0.56;
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, hz, 0, W / 2, hz, Math.max(W, H) * 0.6);
  glow.addColorStop(0, 'rgba(255,43,214,0.35)');
  glow.addColorStop(0.4, 'rgba(110,40,200,0.15)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const f = H * 0.5;
  const zNear = f / (H - hz);
  ctx.lineWidth = 1;
  for (let k = 0; k < 30; k++) {
    const z = zNear + ((((k - p * 3) % 30) + 30) % 30) * 0.9;
    ctx.strokeStyle = `rgba(0,240,255,${Math.max(0, 0.6 - z / 27)})`;
    const y = hz + f / z;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,43,214,0.25)';
  for (let i = -20; i <= 20; i++) {
    ctx.beginPath(); ctx.moveTo(W / 2 + (f * i * 0.9) / zNear, H); ctx.lineTo(W / 2, hz); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,120,240,0.6)';
  ctx.fillRect(0, hz - 1, W, 2);
}

function loop(now) {
  drawGrid(((now - start) / 12000) % 1);
  raf = requestAnimationFrame(loop);
}

function stopLoop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

function setVideo(active) {
  root.classList.toggle('has-bg-video', active);
  if (active) stopLoop();
  else if (!reduce.matches && !raf) raf = requestAnimationFrame(loop);
}

function mount() {
  video = document.createElement('video');
  video.className = 'bg-video';
  video.setAttribute('aria-hidden', 'true');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.preload = 'auto';
  const name = window.matchMedia('(orientation: portrait)').matches ? 'bg-loop-portrait' : 'bg-loop';
  video.poster = `media/${name}.jpg`;
  [[`media/${name}.webm`, 'video/webm'], [`media/${name}.mp4`, 'video/mp4']].forEach(([src, type]) => {
    const s = document.createElement('source');
    s.src = src;
    s.type = type;
    video.append(s);
  });
  video.addEventListener('playing', () => setVideo(true));
  video.addEventListener('error', () => setVideo(false), true);
  canvas.after(video);
}

function sync() {
  if (reduce.matches) {
    if (video) video.pause();
    stopLoop();
    root.classList.remove('has-bg-video');
    drawGrid(0);
    return;
  }
  if (!video) mount();
  if (!root.classList.contains('has-bg-video') && !raf) raf = requestAnimationFrame(loop);
  if (!document.hidden) video.play().catch(() => setVideo(false));
}

size();
drawGrid(0);
sync();
reduce.addEventListener('change', sync);
window.addEventListener('resize', () => { size(); if (!raf) drawGrid(0); });
document.addEventListener('visibilitychange', () => {
  if (!video || reduce.matches) return;
  if (document.hidden) { video.pause(); stopLoop(); } else sync();
});
