// The decision theatre. Four beats: the room, the gate, the wait, the reveal.
// This file owns beats 1–3; reveal.js owns beat 4.

import { S, ch } from '../core/state.js';
import { on, emit } from '../core/bus.js';
import { commit, openDecisions, pendingDecisions, describeWait, stakeLine, isIrreversible } from '../sim/decision.js';
import { fullName, age } from '../sim/characters.js';
import { styleOf } from '../sim/realm.js';
import { renderPortrait } from '../render/portrait.js';
import { flyTo, unlock, Cam } from '../render/camera.js';
import { worldOfProvince } from '../render/mapmesh.js';
import { SFX, heart, setTension, resumeAudio } from '../audio/audio.js';
import { pause } from '../core/clock.js';
import { renderPending, whisper, recomputeHeart } from './wait.js';

const root = () => document.getElementById('decisionRoot');
let current = null;

export function initDecisionUI() {
  on('decision:offered', (d) => { if (!current) show(d); });
}

// ---------------------------------------------------------------- beat 1: room
export async function show(d) {
  current = d;
  resumeAudio();
  pause('decision');
  document.body.classList.add('staged');
  SFX.open();

  // push the camera at whoever this is about, so the map itself looks at them
  if (d.scene?.provinceIdx != null) {
    const w = worldOfProvince(d.scene.provinceIdx);
    if (w) flyTo(w, { dist: d.weight > 0.5 ? 150 : 240, pitch: 0.42, dur: 1.5, lock: true });
  }

  const t = d.targetId ? ch(d.targetId) : null;
  const el = document.createElement('div');
  el.className = 'dec';
  el.innerHTML = `
    <div class="sheet">
      <div class="weighmark" style="background:${weightColor(d.weight)}"></div>
      <div class="dhead">
        ${t ? `<div class="face"><canvas width="150" height="150"></canvas></div>` : ''}
        <div>
          <div class="dkicker">${kicker(d)}</div>
          <h2>${esc(d.title)}</h2>
          ${t ? `<div class="dwho">${esc(fullName(t))} · ${esc(styleOf(t))} · ${age(t)} yaşında</div>` : ''}
        </div>
      </div>
      <div class="dbody">
        ${d.framing ? `<p class="framing">${esc(d.framing)}</p>` : ''}
        ${(d.body || '').split('\n\n').filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('')}
      </div>
      <div class="opts"></div>
    </div>`;
  root().appendChild(el);

  if (t) { t._ageCache = age(t); renderPortrait(t, el.querySelector('.dhead canvas')); }

  const opts = el.querySelector('.opts');
  for (const o of d.options) {
    const b = document.createElement('button');
    b.className = 'opt' + (o.disabled ? ' disabled' : '') + (isIrreversible({ stakes: o.stakes }) ? ' irrev' : '');
    b.innerHTML = `
      <div class="olabel">${esc(o.label)}</div>
      ${o.detail ? `<div class="odetail">${esc(o.detail)}</div>` : ''}
      <div class="ometa">
        ${o.cost?.length ? `<span class="cost">Bedel: ${o.cost.map(costLine).join(' · ')}</span>` : ''}
        ${o.odds != null ? `<span class="odds${o.odds < 0.45 ? ' grim' : ''}">%${Math.round(o.odds * 100)} ihtimal</span>` : ''}
        ${o.waitDays ? `<span class="wait">${humanWait(o.waitDays)} sonra belli olur</span>` : ''}
        ${(o.stakes || []).map((s) => `<span class="stake">${esc(stakeLine(s))}</span>`).join('')}
        ${o.disabled && o.disabledWhy ? `<span class="cost">${esc(o.disabledWhy)}</span>` : ''}
      </div>`;
    b.onmouseenter = () => SFX.hover();
    b.onclick = () => {
      if (o.disabled) return;
      SFX.click();
      if (isIrreversible({ stakes: o.stakes }) || d.weight > 0.55) gate(el, d, o);
      else doCommit(el, d, o);
    };
    opts.appendChild(b);
  }
}

// ------------------------------------------------------------- beat 2: the gate
// You must physically hold the button down. Your own hand becomes complicit.
function gate(el, d, o) {
  const g = document.createElement('div');
  g.className = 'gate';
  const stakes = (o.stakes || []).map((s) => `<b>${esc(stakeLine(s))}</b>`).join('<br>');
  g.innerHTML = `
    <div class="ghint">bir kez daha düşün</div>
    <div class="gq">${esc(o.confirm || confirmLine(d, o))}</div>
    <div class="gcost">${stakes || 'Bu karardan dönüş yok.'}
      ${o.odds != null ? `<br><br>Sonucu <b>%${Math.round(o.odds * 100)}</b> ihtimalle lehine.` : ''}
      ${o.waitDays ? `<br>Öğrenmen <b>${humanWait(o.waitDays)}</b> sürecek.` : ''}</div>
    <button class="holdbtn"><i></i><span>basılı tut</span></button>
    <button class="cancel">vazgeç</button>`;
  el.querySelector('.sheet').appendChild(g);
  SFX.breath();
  heart(2);

  const btn = g.querySelector('.holdbtn'), fill = g.querySelector('i'), span = g.querySelector('span');
  let raf = null, t0 = 0;
  const NEED = 1500;
  const step = (ts) => {
    if (!t0) t0 = ts;
    const p = Math.min(1, (ts - t0) / NEED);
    fill.style.width = `${p * 100}%`;
    span.textContent = p < 1 ? `bırakma…  ${Math.ceil((1 - p) * NEED / 1000)}` : 'tamam';
    if (p < 1) raf = requestAnimationFrame(step);
    else { stopHold(); doCommit(el, d, o); }
  };
  const startHold = (e) => { e.preventDefault(); t0 = 0; raf = requestAnimationFrame(step); };
  const stopHold = () => { if (raf) cancelAnimationFrame(raf); raf = null; t0 = 0; fill.style.width = '0%'; span.textContent = 'basılı tut'; };
  btn.addEventListener('pointerdown', startHold);
  btn.addEventListener('pointerup', stopHold);
  btn.addEventListener('pointerleave', stopHold);
  g.querySelector('.cancel').onclick = () => { stopHold(); heart(0); g.remove(); SFX.page(); };
}

function doCommit(el, d, o) {
  SFX.commit();
  heart(0);
  el.remove();
  current = null;
  document.body.classList.remove('staged');
  unlock();
  commit(d.id, o.key);
  flashResources(o.cost);
  // if more decisions are queued, they come one at a time — never a stack
  const next = openDecisions()[0];
  if (next) setTimeout(() => show(next), 700);
  else recomputeHeart();
}

// ---------------------------------------------------------------- helpers
function weightColor(w) {
  if (w > 0.6) return '#8a2a20';
  if (w > 0.38) return '#a8712a';
  if (w > 0.2) return '#8a7a3a';
  return '#5a5a4a';
}
function kicker(d) {
  return ({ scheme:'Gölgede', event:'Sarayda', war:'Sınırda', succession:'Veraset', edict:'Ferman', council:'Divan', death:'Ecel' })[d.kind] || 'Karar';
}
function confirmLine(d, o) {
  const t = d.targetId ? ch(d.targetId) : null;
  if ((o.stakes || []).some((s) => s.kind === 'kin')) return `Kendi kanından birini mi?`;
  if ((o.stakes || []).some((s) => s.kind === 'life')) return t ? `${fullName(t)} bir daha nefes almasın mı?` : 'Bir can mı?';
  if ((o.stakes || []).some((s) => s.kind === 'oath')) return 'Verdiğin sözü bozacaksın.';
  if ((o.stakes || []).some((s) => s.kind === 'title')) return 'Toprak el değiştirecek. Kalıcı olarak.';
  return 'Bunun geri dönüşü yok.';
}
function costLine(c) {
  return ({ gold:`${c.value} altın`, prestige:`${c.value} itibar`, piety:`${c.value} dindarlık` })[c.kind] || stakeLine(c);
}
function humanWait(days) {
  if (days < 30) return `${days} gün`;
  if (days < 365) return `${Math.round(days / 30)} ay`;
  return `${(days / 365).toFixed(1)} yıl`;
}
function flashResources(cost = []) {
  for (const c of cost) {
    const el = document.getElementById('res' + c.kind[0].toUpperCase() + c.kind.slice(1));
    if (el) { el.classList.add('drain'); setTimeout(() => el.classList.remove('drain'), 1200); }
  }
  if (cost.some((c) => c.kind === 'gold')) SFX.coin();
}
export function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }
export function hasOpenDecision() { return !!current; }
export { whisper };
