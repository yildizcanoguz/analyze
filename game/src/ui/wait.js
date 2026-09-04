// P02 — BEKLEYIŞ. Between committing and knowing.
//
// This is the piece that decides whether a wait is dead time or the worst part
// of the game. It owns: the pending ribbon, the whispers that arrive mid-wait,
// the heartbeat under the music, and the clock's own nerves.

import { S, ch } from '../core/state.js';
import { on } from '../core/bus.js';
import { pendingDecisions, describeWait } from '../sim/decision.js';
import { fullName } from '../sim/characters.js';
import { SFX, heart, setTension } from '../audio/audio.js';
import { esc } from './decision.js';

export function initWait() {
  on('decision:tell', ({ d, text, tone }) => { whisper(text, tone); SFX.whisper(tone); });
  on('decision:closing', () => { heart(3); });
  on('decision:committed', () => renderPending());
  on('decision:resolved', () => { renderPending(); recomputeHeart(); });
  on('clock:day', () => renderPending());
  setInterval(recomputeHeart, 2000);
}

// ------------------------------------------------------------- beat 3: the wait
export function renderPending() {
  const host = document.getElementById('pending');
  if (!host) return;
  const list = pendingDecisions();
  host.innerHTML = '';
  for (const d of list) {
    const span = Math.max(1, d.resolveDay - d.committedDay);
    const prog = Math.min(1, (S.day - d.committedDay) / span);
    const t = d.targetId ? ch(d.targetId) : null;
    const el = document.createElement('div');
    el.className = 'pend' + (d.weight > 0.45 || d.irreversible ? ' hot' : '');
    el.innerHTML = `
      <div class="ptitle">${esc(d.title)}</div>
      <div class="psub">${t ? esc(fullName(t)) + ' · ' : ''}${describeWait(d)} kaldı</div>
      ${d.shownOdds != null ? `<div class="odds">%${Math.round(d.shownOdds * 100)}</div>` : ''}
      <div class="bar"><i style="width:${prog * 100}%"></i></div>`;
    host.appendChild(el);
  }
}

export function recomputeHeart() {
  const list = pendingDecisions();
  if (!list.length) { heart(0); setTension(0); return; }
  let worst = 0, closest = 1;
  for (const d of list) {
    worst = Math.max(worst, d.weight);
    const span = Math.max(1, d.resolveDay - d.committedDay);
    closest = Math.min(closest, Math.max(0, (d.resolveDay - S.day) / span));
  }
  setTension(worst);
  if (worst > 0.35) heart(1 + (1 - closest) * 2);
  else heart(0);
}

// ---------------------------------------------------------------- whispers
const whisperHost = () => document.getElementById('whispers');
export function whisper(text, tone = 'ambiguous') {
  const h = whisperHost();
  if (!h) return;
  const el = document.createElement('div');
  el.className = `whisper ${tone}`;
  el.textContent = text;
  h.appendChild(el);
  while (h.children.length > 6) h.firstChild.remove();
  setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 1500); }, 11000);
}
