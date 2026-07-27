// Entry point. Owned by integration.
import Engine from './core/engine.js';

const canvas = document.getElementById('view');
const boot = document.getElementById('boot');
const bar = document.getElementById('boot-bar');
const status = document.getElementById('boot-status');

const engine = new Engine(canvas);

const ctx = await engine.boot((p, label) => {
  bar.style.width = `${Math.round(p * 100)}%`;
  status.textContent = label;
});

bar.style.width = '100%';
status.textContent = 'ready';

// Expose for automation / the capture harness.
window.__game = ctx;
window.__engine = engine;
window.__missing = engine.missing;
window.__failed = engine.failed.map(f => ({ id: f.id, message: f.err?.message, stack: f.err?.stack }));

if (engine.missing.length) console.warn('[boot] systems not yet implemented:', engine.missing.join(', '));
if (engine.failed.length) console.error('[boot] systems failed:', engine.failed);

engine.start();

// Fade the boot overlay once the first real frame is on screen.
requestAnimationFrame(() => requestAnimationFrame(() => {
  boot.classList.add('hidden');
  setTimeout(() => { boot.style.display = 'none'; }, 700);
}));

// Pointer lock on click (skipped for automated capture).
if (!new URLSearchParams(location.search).has('nolock')) {
  canvas.addEventListener('click', () => ctx.input.requestLock());
}
