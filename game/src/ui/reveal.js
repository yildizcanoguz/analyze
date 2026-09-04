// Beat 4. The result does not appear; it arrives. Silence, a breath, then the
// sentence — and only then what it costs you going forward.

import { S, ch } from '../core/state.js';
import { on } from '../core/bus.js';
import { fullName } from '../sim/characters.js';
import { SFX, heart, setTension } from '../audio/audio.js';
import { flyTo, unlock } from '../render/camera.js';
import { worldOfProvince } from '../render/mapmesh.js';
import { pause } from '../core/clock.js';
import { esc } from './decision.js';

const root = () => document.getElementById('revealRoot');
const queue = [];
let busy = false;

export function initReveal() {
  on('decision:resolved', (d) => { if (d.weight > 0.16) { queue.push(d); drain(); } });
}

async function drain() {
  if (busy || !queue.length) return;
  busy = true;
  const d = queue.shift();
  await stage(d);
  busy = false;
  if (queue.length) setTimeout(drain, 400);
}

function stage(d) {
  return new Promise((done) => {
    pause('reveal');
    heart(0);
    document.body.classList.add('staged');
    const r = root();
    r.innerHTML = '';
    r.classList.add('breathing');

    if (d.scene?.provinceIdx != null) {
      const w = worldOfProvince(d.scene.provinceIdx);
      if (w) flyTo(w, { dist: 130, pitch: 0.38, dur: 2.2, lock: true });
    }

    // --- the held breath ---
    const b = document.createElement('div');
    b.className = 'breath';
    b.style.position = 'absolute';
    b.style.left = '50%'; b.style.top = '50%';
    r.appendChild(b);
    SFX.breath();

    const delay = d.weight > 0.55 ? 2200 : d.weight > 0.32 ? 1500 : 900;
    setTimeout(() => {
      b.remove();
      const good = !!d.outcome?.success;
      good ? SFX.good() : SFX.bad();
      if (d.outcome?.knell) SFX.knell();

      const el = document.createElement('div');
      el.className = 'reveal';
      el.innerHTML = `
        <div class="beat">${esc(d.outcome?.beat || (good ? 'oldu' : 'olmadı'))}</div>
        <h1 class="${good ? 'good' : 'bad'}">${esc(d.outcome?.title || d.title)}</h1>
        ${(d.outcome?.text || '').split('\n\n').filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('')}
        ${d.outcome?.effects?.length ? `<div class="cons">${d.outcome.effects.map((e) => `<div>${e}</div>`).join('')}</div>` : ''}
        <button class="ok">devam</button>`;
      r.appendChild(el);
      el.querySelector('.ok').onclick = () => {
        r.innerHTML = '';
        r.classList.remove('breathing');
        document.body.classList.remove('staged');
        unlock();
        setTension(0);
        done();
      };
      // let the player sit in it: Enter works, but only after a beat
      setTimeout(() => {
        const h = (e) => { if (e.key === 'Enter' || e.key === 'Escape') { removeEventListener('keydown', h); el.querySelector('.ok')?.click(); } };
        addEventListener('keydown', h);
      }, 900);
    }, delay);
  });
}
