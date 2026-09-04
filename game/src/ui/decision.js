// P01 — THE DECISION THEATRE.  Beats 1–3: the room, the gate, the price.
// (beat 4, the reveal, belongs to P03.)
//
// The single rule of this file: WEIGHT CHANGES THE STAGING. A decision that
// costs a child does not get the same rectangle as a decision that costs four
// coins. Three presentations, chosen by sim/decision.js:
//
//   card  — a small note in the corner. The world keeps running.
//   sheet — the vellum sheet. The world stops.
//   rite  — the world goes black, the camera closes in, the sound drains out,
//           and the options arrive one at a time like men entering a room.

import { S, ch } from '../core/state.js';
import { on, emit } from '../core/bus.js';
import {
  commit, openDecisions, pendingDecisions, describeWait, stakeLine,
  isIrreversible, TIER, tierOf, holdMillis, plannedCost, costPhrase, STAKE,
  lossOf, householdLine,
} from '../sim/decision.js';
import { fullName, age } from '../sim/characters.js';
import { styleOf } from '../sim/realm.js';
import { renderPortrait } from '../render/portrait.js';
import { flyTo, unlock, Cam } from '../render/camera.js';
import { worldOfProvince } from '../render/mapmesh.js';
import { SFX, heart, setTension, resumeAudio } from '../audio/audio.js';
import { pause } from '../core/clock.js';
import { fmtDate } from '../core/date.js';
import { renderPending, whisper, recomputeHeart } from './wait.js';
import { css } from './_css.js';

const root = () => document.getElementById('decisionRoot');
let current = null;
let timers = [];

export function initDecisionUI() {
  injectStyle();
  on('decision:offered', (d) => queueShow(d));
}

/** One thing on the screen at a time — never a decision on top of a reveal. */
function queueShow(d) {
  if (current || d.state !== 'open') return;
  const r = document.getElementById('revealRoot');
  if (r && r.children.length) { setTimeout(() => queueShow(d), 450); return; }
  show(d);
}

// ---------------------------------------------------------------------------
// beat 1 — the room
// ---------------------------------------------------------------------------
export async function show(d) {
  current = d;
  resumeAudio();
  const tier = d.tier || tierOf(d);
  if (tier === TIER.CARD) return showCard(d);
  pause('decision');
  document.body.classList.add('staged');
  return tier === TIER.RITE ? showRite(d) : showSheet(d);
}

// --- the light one: a note in the corner, the clock keeps ticking ------------
function showCard(d) {
  SFX.page();
  const el = document.createElement('div');
  el.className = 'dec p01card';
  el.innerHTML = `
    <div class="csheet">
      <div class="ckicker">${kicker(d)}</div>
      <div class="ctitle">${esc(d.title)}</div>
      ${d.framing ? `<div class="cframe">${esc(firstSentence(d.framing))}</div>` : ''}
      <div class="copts"></div>
    </div>`;
  root().appendChild(el);
  const box = el.querySelector('.copts');
  for (const o of d.options) box.appendChild(cardOption(el, d, o));
}

function cardOption(el, d, o) {
  const b = document.createElement('button');
  b.className = 'copt' + (o.disabled ? ' disabled' : '');
  b.innerHTML = `<span>${esc(o.label)}</span>${costChip(o)}`;
  b.onmouseenter = () => SFX.hover();
  b.onclick = () => { if (o.disabled) return; SFX.click(); doCommit(el, d, o); };
  return b;
}
function costChip(o) {
  const c = (o.cost || [])[0];
  return c ? `<i>${esc(costLine(c))}</i>` : '';
}

// --- the middle one: the vellum sheet ---------------------------------------
function showSheet(d) {
  SFX.open();
  pushCamera(d, 220);
  const t = d.targetId ? ch(d.targetId) : null;
  const el = document.createElement('div');
  el.className = 'dec';
  el.innerHTML = `
    <div class="sheet">
      <div class="weighmark" style="background:${weightColor(d.weight)}"></div>
      <div class="dhead">
        ${t ? `<div class="face"><canvas width="150" height="150"></canvas></div>` : ''}
        <div>
          <div class="dkicker">${kicker(d)} · ${fmtDate(S.day)}</div>
          <h2>${esc(d.title)}</h2>
          ${t ? `<div class="dwho">${esc(fullName(t))} · ${esc(styleOf(t))} · ${age(t)} yaşında</div>` : ''}
        </div>
      </div>
      <div class="dbody">
        ${d.framing ? `<p class="framing">${esc(d.framing)}</p>` : ''}
        ${paras(d.body)}
      </div>
      <div class="opts"></div>
    </div>`;
  root().appendChild(el);
  if (t) { t._ageCache = age(t); renderPortrait(t, el.querySelector('.dhead canvas')); }
  const opts = el.querySelector('.opts');
  for (const o of d.options) opts.appendChild(sheetOption(el, d, o));
}

function sheetOption(el, d, o) {
  const b = document.createElement('button');
  b.className = 'opt' + (o.disabled ? ' disabled' : '') + (isIrreversible({ stakes: o.stakes }) ? ' irrev' : '');
  b.innerHTML = `
    <div class="olabel">${esc(o.label)}</div>
    ${o.detail ? `<div class="odetail">${esc(o.detail)}</div>` : ''}
    <div class="ometa">${metaBits(o, d).join('')}</div>`;
  b.onmouseenter = () => SFX.hover();
  b.onclick = () => choose(el, d, o);
  return b;
}

// --- the heavy one: a rite ---------------------------------------------------
function showRite(d) {
  SFX.open();
  setTimeout(() => SFX.breath(), 260);
  setTension(0);                       // the room goes quiet before it goes dark
  pushCamera(d, 130);
  heart(1);

  const t = d.targetId ? ch(d.targetId) : null;
  const el = document.createElement('div');
  el.className = 'dec rite';
  el.innerHTML = `
    <div class="ritebg"></div>
    <div class="ritewrap">
      <div class="ritehead stg">
        ${t ? `<div class="rface"><canvas width="240" height="240"></canvas></div>` : ''}
        <div class="rid">
          <div class="rkicker">${kicker(d)} · ${fmtDate(S.day)}</div>
          <h1 class="rtitle">${esc(d.title)}</h1>
          ${t ? `<div class="rwho">${esc(fullName(t))} · ${esc(styleOf(t))} · ${age(t)} yaşında</div>` : ''}
        </div>
      </div>
      <div class="rbody"></div>
      <div class="ropts"></div>
      <div class="rfoot stg">bu kararı bir kez vereceksin · seçmek için bir seçeneğe bas</div>
    </div>`;
  root().appendChild(el);
  if (t) { t._ageCache = age(t); renderPortrait(t, el.querySelector('.rface canvas')); }

  const body = el.querySelector('.rbody');
  if (d.framing) { const p = document.createElement('p'); p.className = 'framing stg'; p.textContent = d.framing; body.appendChild(p); }
  for (const txt of (d.body || '').split('\n\n').filter(Boolean)) {
    const p = document.createElement('p'); p.className = 'stg'; p.textContent = txt; body.appendChild(p);
  }
  const opts = el.querySelector('.ropts');
  for (const o of d.options) {
    const b = sheetOption(el, d, o);
    b.classList.add('stg');
    opts.appendChild(b);
  }

  // Everything arrives in order. Impatience is allowed — one click brings the
  // whole room in at once — but it costs you a click you meant for an option.
  const steps = Array.from(el.querySelectorAll('.stg'));
  let i = 0;
  const gaps = [420, 900];
  clearTimers();
  steps.forEach((n, k) => {
    const at = k === 0 ? 380 : 380 + gaps[0] + (k - 1) * 560;
    timers.push(setTimeout(() => {
      n.classList.add('in');
      if (n.classList.contains('opt')) SFX.page();
      if (++i >= steps.length) el.classList.add('open');
    }, at));
  });
  el.querySelector('.ritebg').onclick = () => revealAll(el);
}

function revealAll(el) {
  clearTimers();
  for (const n of el.querySelectorAll('.stg')) n.classList.add('in');
  el.classList.add('open');
}
function clearTimers() { for (const t of timers) clearTimeout(t); timers = []; }

// ---------------------------------------------------------------------------
// beat 2 — the gate.  You must physically hold it down; your own hand signs.
// ---------------------------------------------------------------------------
function choose(el, d, o) {
  if (o.disabled) return;
  SFX.click();
  if (isIrreversible({ stakes: o.stakes }) || d.weight > 0.45) gate(el, d, o);
  else doCommit(el, d, o);
}

function gate(el, d, o) {
  const host = el.querySelector('.sheet') || el.querySelector('.ritewrap') || el;
  const g = document.createElement('div');
  g.className = 'gate' + (el.classList.contains('rite') ? ' gfull' : '');
  const NEED = holdMillis(d, o);
  const bill = plannedCost(d, o);
  const loss = lossOf(d, o);
  // Money and piety are on the bill below; the line above is only for the
  // things that have no price.
  const priced = new Set([STAKE.GOLD, STAKE.PRESTIGE, STAKE.PIETY]);
  const stakes = (o.stakes || []).filter((s) => !priced.has(s.kind)).map((s) => `<b>${esc(stakeLine(s))}</b>`).join('<br>');
  g.innerHTML = `
    <div class="gscroll">
    <div class="ghint">bir kez daha düşün</div>
    <div class="gq">${esc(o.confirm || confirmLine(d, o))}</div>
    ${loss.map((l) => `
      <div class="gloss">
        <div class="glname">${esc(l.age)} yaşındaki ${esc(l.address)} <b>${esc(l.name)}</b></div>
        <div class="glsub">${esc(householdLine(l))} Sana bakışı: ${l.opinion > 0 ? '+' : ''}${l.opinion}.</div>
      </div>`).join('')}
    <div class="gcost">${stakes || 'Bu karardan dönüş yok.'}
      ${o.odds != null ? `<br><br>Sonucu <b>%${Math.round(o.odds * 100)}</b> ihtimalle lehine.` : ''}
      ${o.waitDays ? `<br>Öğrenmen <b>${humanWait(o.waitDays)}</b> sürecek.` : ''}</div>
    ${bill.length ? `<div class="gbill"><div class="gbh">parmağını kaldırdığın an gidecekler</div>
      ${bill.map((c) => `<div class="gbl">${esc(costPhrase(c))}</div>`).join('')}</div>` : ''}
    <button class="holdbtn"><i></i><span>basılı tut · ${(NEED / 1000).toFixed(1)} sn</span></button>
    <div class="gnote"></div>
    <button class="cancel">vazgeç</button>
    </div>`;
  host.appendChild(g);
  SFX.breath();
  heart(2);

  const btn = g.querySelector('.holdbtn'), fill = g.querySelector('i'), span = g.querySelector('span');
  const note = g.querySelector('.gnote');
  const idle = `basılı tut · ${(NEED / 1000).toFixed(1)} sn`;
  let raf = null, t0 = 0, best = 0, lets = 0;

  const step = (ts) => {
    if (!t0) t0 = ts;
    const p = Math.min(1, (ts - t0) / NEED);
    best = Math.max(best, p);
    fill.style.width = `${p * 100}%`;
    span.textContent = p < 1 ? `bırakma…  ${((1 - p) * NEED / 1000).toFixed(1)}` : 'tamam';
    if (p < 1) raf = requestAnimationFrame(step);
    else { cancelHold(); doCommit(el, d, o); }
  };
  const cancelHold = () => { if (raf) cancelAnimationFrame(raf); raf = null; t0 = 0; };
  const startHold = (e) => {
    e.preventDefault();
    if (raf) return;
    t0 = 0; btn.classList.add('holding'); g.classList.add('holding');
    heart(3);
    raf = requestAnimationFrame(step);
  };
  // Letting go is not neutral. The bar snaps back to zero and the room notices.
  const release = () => {
    if (!raf) return;
    cancelHold();
    btn.classList.remove('holding'); g.classList.remove('holding');
    fill.classList.add('snap');
    fill.style.width = '0%';
    span.textContent = idle;
    setTimeout(() => fill.classList.remove('snap'), 420);
    g.classList.add('flinch');
    setTimeout(() => g.classList.remove('flinch'), 480);
    heart(2);
    SFX.whisper('bad');
    lets++;
    note.textContent = lets === 1 ? 'elini çektin. baştan.'
      : lets === 2 ? 'yine çektin. sayaç sıfırlandı.'
      : 'her seferinde en baştan başlıyor.';
    note.classList.remove('in'); void note.offsetWidth; note.classList.add('in');
  };
  btn.addEventListener('pointerdown', startHold);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('pointercancel', release);
  g.querySelector('.cancel').onclick = () => { cancelHold(); heart(0); g.remove(); SFX.page(); };
}

// ---------------------------------------------------------------------------
// beat 3 — the price, paid now
// ---------------------------------------------------------------------------
async function doCommit(el, d, o) {
  clearTimers();
  SFX.commit();
  heart(0);
  const bill = plannedCost(d, o);
  el.querySelector('.gate')?.remove();
  el.classList.add('spent');                  // the room empties, the bill stays
  await payScene(bill);
  el.remove();
  current = null;
  document.body.classList.remove('staged');
  unlock();
  commit(d.id, o.key);                        // sim charges exactly what was shown
  const next = openDecisions()[0];
  if (next) setTimeout(() => queueShow(next), 700);
  else recomputeHeart();
}

// --- the bill, item by item, while the numbers fall ------------------------
const RES_OF = { gold: 'resGold', prestige: 'resPrestige', piety: 'resPiety' };

function payScene(bill) {
  if (!bill.length) return Promise.resolve();
  const K = (typeof window !== 'undefined' && window.__payScale) || 1;   // inspection affordance
  return new Promise((done) => {
    document.body.classList.add('p01paying');
    const el = document.createElement('div');
    el.className = 'p01pay';
    el.innerHTML = `<div class="paywrap">
      <div class="paykick">şimdi ödedin</div>
      <div class="paylines"></div>
      <div class="paystamp">geri gelmez</div>
    </div>`;
    root().appendChild(el);
    const host = el.querySelector('.paylines');
    const p = ch(S.playerId);

    bill.forEach((c, i) => {
      setTimeout(() => {
        const row = document.createElement('div');
        row.className = 'payline';
        row.innerHTML = `<span class="pt">${esc(costPhrase(c))}</span><s></s>`;
        host.appendChild(row);
        requestAnimationFrame(() => row.classList.add('in'));
        const resId = RES_OF[c.kind];
        if (resId && p) {
          const from = Math.floor(p[c.kind] ?? 0);
          tickResource(resId, from, from - c.value);
          ghost(resId, `−${c.value}`);
          const chip = document.getElementById(resId);
          if (chip) { chip.classList.add('drain'); setTimeout(() => chip.classList.remove('drain'), 1200); }
          SFX.coin();
        } else {
          SFX.whisper('bad');
        }
      }, (180 + i * 340) * K);
    });

    const endAt = (180 + bill.length * 340) * K;
    setTimeout(() => { el.querySelector('.paystamp').classList.add('in'); SFX.page(); }, endAt + 120 * K);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => { el.remove(); document.body.classList.remove('p01paying'); done(); }, 420);
    }, endAt + 1050 * K);
  });
}

function tickResource(id, from, to, ms = 820) {
  const b = document.getElementById(id)?.querySelector('b');
  if (!b) return;
  const t0 = performance.now();
  const step = (ts) => {
    const k = Math.min(1, (ts - t0) / ms);
    b.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A number that leaves the purse and does not come back. */
function ghost(resId, text) {
  const chip = document.getElementById(resId);
  if (!chip) return;
  const r = chip.getBoundingClientRect();
  const g = document.createElement('div');
  g.className = 'p01ghost';
  g.textContent = text;
  g.style.left = `${r.left + r.width / 2}px`;
  g.style.top = `${r.bottom - 4}px`;
  document.body.appendChild(g);
  setTimeout(() => g.remove(), 1500);
}

// ---------------------------------------------------------------- helpers
function pushCamera(d, dist) {
  if (d.scene?.provinceIdx == null) return;
  const w = worldOfProvince(d.scene.provinceIdx);
  if (w) flyTo(w, { dist, pitch: 0.42, dur: dist < 160 ? 2.2 : 1.5, lock: true });
}
function paras(s) { return (s || '').split('\n\n').filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join(''); }
function firstSentence(s) {
  const m = String(s || '').match(/^[^.!?]*[.!?]/);
  return m ? m[0] : String(s || '');
}
function metaBits(o, d) {
  const out = [];
  const bill = plannedCost(d || {}, o);
  if (bill.length) out.push(`<span class="cost">Şimdi ödersin: ${bill.map(costPhrase).join(' · ')}</span>`);
  if (o.odds != null) out.push(`<span class="odds${o.odds < 0.45 ? ' grim' : ''}">%${Math.round(o.odds * 100)} ihtimal</span>`);
  if (o.waitDays) out.push(`<span class="wait">${humanWait(o.waitDays)} sonra belli olur</span>`);
  for (const s of o.stakes || []) out.push(`<span class="stake">${esc(stakeLine(s))}</span>`);
  if (o.disabled && o.disabledWhy) out.push(`<span class="cost">${esc(o.disabledWhy)}</span>`);
  return out;
}
function weightColor(w) {
  if (w > 0.6) return '#8a2a20';
  if (w > 0.38) return '#a8712a';
  if (w > 0.2) return '#8a7a3a';
  return '#5a5a4a';
}
function kicker(d) {
  return ({ scheme:'Gölgede', event:'Sarayda', war:'Sınırda', succession:'Veraset', edict:'Ferman', council:'Divan', death:'Ecel', echo:'Geçmişten' })[d.kind] || 'Karar';
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

// ---------------------------------------------------------------------------
// This piece owns its own stylesheet (ui/style.css belongs to P18).
// ---------------------------------------------------------------------------
function injectStyle() {
  css('p01-decision', `
/* ---------- tier 1: the corner card ---------- */
.dec.p01card{position:absolute;inset:auto 14px 58px auto;display:block;width:330px;pointer-events:none;z-index:2}
.dec.p01card .csheet{pointer-events:auto;
  background:linear-gradient(168deg,rgba(232,220,192,.97),rgba(206,190,157,.97));
  border:1px solid #6b573a;border-left:3px solid #8a7a3a;color:#221a11;
  box-shadow:0 16px 44px rgba(0,0,0,.6);padding:11px 13px 12px;
  animation:p01cardIn .45s cubic-bezier(.16,1,.3,1)}
@keyframes p01cardIn{from{opacity:0;transform:translateX(26px)}to{opacity:1;transform:none}}
.dec.p01card .ckicker{font-size:9.5px;letter-spacing:2px;text-transform:uppercase;color:#7a6236}
.dec.p01card .ctitle{font-size:16px;color:#2a1d10;margin:3px 0 4px;letter-spacing:.2px}
.dec.p01card .cframe{font-size:12px;line-height:1.55;color:#54432a;font-style:italic;margin-bottom:9px}
.dec.p01card .copts{display:flex;flex-direction:column;gap:5px}
.dec.p01card .copt{display:flex;justify-content:space-between;align-items:baseline;gap:8px;width:100%;
  text-align:left;font-family:var(--serif);font-size:13px;color:#241a10;cursor:pointer;
  background:rgba(255,252,244,.55);border:1px solid rgba(90,70,42,.36);padding:6px 9px;transition:all .15s}
.dec.p01card .copt:hover{background:rgba(255,253,247,.95);border-color:#8a6a2e}
.dec.p01card .copt i{font-style:normal;font-size:11px;color:#8a3a2a;white-space:nowrap}
.dec.p01card .copt.disabled{opacity:.4;cursor:not-allowed}

/* ---------- tier 3: the rite ---------- */
.dec.rite{align-items:stretch;justify-content:stretch}
.dec.rite .ritebg{position:absolute;inset:0;background:
  radial-gradient(ellipse at 50% 42%, rgba(40,26,12,.34), transparent 46%),
  rgba(4,3,2,.90);
  animation:p01fadein 1.1s ease both;cursor:default}
@keyframes p01fadein{from{opacity:0}to{opacity:1}}
.dec.rite .ritewrap{position:relative;z-index:1;margin:auto;width:min(880px,88vw);max-height:92vh;overflow-y:auto;
  padding:26px 10px;display:flex;flex-direction:column;gap:14px}
.dec.rite .ritehead{display:flex;gap:24px;align-items:center}
.dec.rite .rface{width:132px;height:132px;flex:0 0 auto;border:1px solid rgba(201,163,78,.34);background:#120c07;
  overflow:hidden;box-shadow:inset 0 0 40px rgba(0,0,0,.9), 0 0 60px rgba(0,0,0,.7);filter:saturate(.72) contrast(1.05)}
.dec.rite .rface canvas{width:100%;height:100%;display:block}
.dec.rite .rkicker{font-size:10.5px;letter-spacing:4px;text-transform:uppercase;color:#8a7248;margin-bottom:10px}
.dec.rite .rtitle{margin:0 0 8px;font-size:40px;line-height:1.12;font-weight:400;letter-spacing:.6px;color:#e6d09a;
  text-shadow:0 0 60px rgba(201,163,78,.22)}
.dec.rite .rwho{font-size:13.5px;color:#a2906c;letter-spacing:.3px}
.dec.rite .rbody{max-width:720px}
.dec.rite .rbody p{margin:0 0 13px;font-size:16.5px;line-height:1.85;color:#cdbfa2}
.dec.rite .rbody p.framing{font-style:italic;color:#a99a7c}
.dec.rite .ropts{display:flex;flex-direction:column;gap:9px;margin-top:6px}
.dec.rite .rfoot{font-size:10.5px;letter-spacing:2.6px;text-transform:uppercase;color:#6b5c40;margin-top:4px}
/* options on black, not on vellum */
.dec.rite .opt{background:linear-gradient(180deg,rgba(30,22,14,.86),rgba(18,13,8,.86));
  border:1px solid rgba(201,163,78,.24);border-left:2px solid rgba(201,163,78,.4);color:#ddcfb2;padding:14px 18px}
.dec.rite .opt:hover{background:linear-gradient(180deg,rgba(48,35,20,.95),rgba(28,20,12,.95));
  border-color:rgba(201,163,78,.55);transform:translateX(5px)}
.dec.rite .opt .olabel{font-size:17px;color:#e8d7ac}
.dec.rite .opt .odetail{color:#9d8f72}
.dec.rite .opt .cost{color:#d08a7a}
.dec.rite .opt .odds{color:#9dc07e}
.dec.rite .opt .odds.grim{color:#d08a7a}
.dec.rite .opt .wait{color:#8a7a5c}
.dec.rite .opt .stake{color:#d8a08e;border-color:rgba(200,90,70,.34);background:rgba(160,50,40,.12)}
.dec.rite .opt.irrev{border-left-color:#a8302a}
.dec.rite .opt.irrev::after{color:#c9705e;opacity:.9}
.dec.rite .gate{background:linear-gradient(175deg,rgba(12,8,5,.985),rgba(6,4,3,.995))}

/* ---------- the gate's bill ---------- */
.gate .gbill{border-top:1px solid rgba(201,163,78,.20);border-bottom:1px solid rgba(201,163,78,.20);
  padding:12px 22px;max-width:520px}
.gate .gbh{font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#7a6a52;margin-bottom:7px}
.gate .gbl{font-size:14px;color:#e8c9c0;line-height:1.75}
.gate .gbl::before{content:"— ";color:#a8302a}

/* ---------- the gate ---------- */
.gate.gfull{position:fixed;inset:0;z-index:5}
.gate .gscroll{display:flex;flex-direction:column;align-items:center;gap:18px;max-height:100%;
  overflow-y:auto;padding:24px 10px;width:100%}
.gate .gloss{border-left:2px solid rgba(168,48,40,.6);padding:8px 0 8px 16px;max-width:560px;text-align:left}
.gate .glname{font-size:17px;color:#e6d09a;letter-spacing:.2px}
.gate .glname b{color:#f0dcae;font-weight:600}
.gate .glsub{font-size:13px;color:#9d8f72;margin-top:4px;line-height:1.6}
.gate .gnote{font-size:12px;letter-spacing:1.6px;color:#c9705e;min-height:15px;opacity:0}
.gate .gnote.in{animation:p01note 2.6s ease forwards}
@keyframes p01note{0%{opacity:0}12%{opacity:1}72%{opacity:1}100%{opacity:0}}
.gate .holdbtn.holding{border-color:#d05a48;box-shadow:0 0 26px rgba(168,48,40,.45)}
.gate .holdbtn i.snap{transition:width .18s ease}
.gate.holding{animation:p01tense 2.4s ease-in-out infinite}
@keyframes p01tense{0%,100%{transform:none}50%{transform:scale(1.004)}}
.gate.flinch{animation:p01flinch .42s cubic-bezier(.36,.07,.19,.97)}
@keyframes p01flinch{0%,100%{transform:translateX(0)}
  15%{transform:translateX(-7px)}35%{transform:translateX(6px)}
  55%{transform:translateX(-4px)}78%{transform:translateX(2px)}}

/* ---------- the bill, paid on screen ---------- */
body.p01paying #topbar{opacity:1 !important;transition:opacity .35s ease}
.p01pay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  pointer-events:auto;background:rgba(3,2,1,.62);animation:p01fadein .3s ease both}
.p01pay.out{opacity:0;transition:opacity .4s ease}
.p01pay .paywrap{text-align:center}
.p01pay .paykick{font-size:11px;letter-spacing:5px;text-transform:uppercase;color:#8a7248;margin-bottom:20px}
.p01pay .payline{font-size:21px;color:#d8c49a;margin:0 0 12px;position:relative;display:inline-block;
  opacity:0;transform:translateY(8px);transition:opacity .3s ease, transform .3s ease}
.p01pay .payline.in{opacity:1;transform:none}
.p01pay .paylines{display:flex;flex-direction:column;align-items:center}
.p01pay .payline s{position:absolute;left:0;top:52%;height:1px;width:0;background:#a8302a;display:block}
.p01pay .payline.in s{width:100%;transition:width .5s .18s cubic-bezier(.2,.8,.2,1)}
.p01pay .paystamp{margin-top:22px;font-size:13px;letter-spacing:6px;text-transform:uppercase;color:#c9705e;
  border:1px solid rgba(168,48,40,.55);padding:9px 22px;display:inline-block;
  opacity:0;transform:scale(1.5) rotate(-3deg)}
.p01pay .paystamp.in{opacity:.95;transform:scale(1) rotate(-3deg);transition:opacity .3s ease, transform .35s cubic-bezier(.2,.9,.3,1)}
.p01ghost{position:fixed;z-index:120;pointer-events:none;transform:translate(-50%,0);
  font-family:var(--serif);font-size:19px;color:#e07a62;text-shadow:0 2px 10px rgba(0,0,0,.9);
  animation:p01ghost 1.4s cubic-bezier(.2,.7,.3,1) forwards}
@keyframes p01ghost{0%{opacity:0;transform:translate(-50%,-4px) scale(.9)}
  18%{opacity:1;transform:translate(-50%,4px) scale(1.08)}
  100%{opacity:0;transform:translate(-50%,42px) scale(.95)}}
.dec.spent .sheet,.dec.spent .ritewrap{opacity:0;transform:scale(.985);transition:opacity .35s ease,transform .35s ease}

/* the staged entrance */
.dec.rite .stg{opacity:0;transform:translateY(12px);filter:blur(3px);pointer-events:none}
.dec.rite .stg.in{opacity:1;transform:none;filter:none;pointer-events:auto;
  transition:opacity .55s ease, transform .55s cubic-bezier(.16,1,.3,1), filter .55s ease}
.dec.rite .rfoot.stg.in{opacity:.75}
`);
}
