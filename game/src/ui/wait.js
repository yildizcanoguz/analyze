// P02 — BEKLEYIŞ. Between committing and knowing.
//
// This is the piece that decides whether a wait is dead time or the worst part
// of the game. It owns: the pending ribbon, the whispers that arrive mid-wait,
// the heartbeat under the music, and the clock's own nerves.
//
// The governing idea: once you have paid for something you cannot stop, the
// SCREEN ITSELF should stop being comfortable. Colour drains, the edges close
// in and tremble on the beat of your own pulse, and the letter you sent sits in
// the corner counting down in days — with a face on it.

import { S, ch } from '../core/state.js';
import { on } from '../core/bus.js';
import { pendingDecisions, describeWait, stakeLine } from '../sim/decision.js';
import { fullName, age } from '../sim/characters.js';
import { styleOf } from '../sim/realm.js';
import { renderPortrait } from '../render/portrait.js';
import { SFX, heart, setTension } from '../audio/audio.js';
import { setSpeed } from '../core/clock.js';
import { initTells, tellsOf, pumpTells, reliabilityOf } from '../sim/tells.js';
import { fmtDate } from '../core/date.js';
import { esc } from './decision.js';
import { css } from './_css.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function initWait() {
  injectCss();
  initTells();
  ensureFx();
  on('decision:tell', ({ d, text, tone }) => {
    whisper(text, tone); SFX.whisper(tone); flashCard(d);
    if (d && d.state === 'pending' && d.weight > 0.24) announce(text, tone);
  });
  on('decision:closing', (d) => slowTheWorld(d));
  on('decision:committed', () => { renderPending(); tickWait(true); });
  on('decision:resolved', (d) => { cards.get(d.id)?.el.remove(); cards.delete(d.id); hideTip(); renderPending(); tickWait(true); });
  on('clock:day', () => { renderPending(); tickWait(); });
  setInterval(() => tickWait(), 260);
}

// =============================================================== the screen itself
// A single fixed overlay. Everything it does is opacity and transform, so the
// map underneath keeps its framerate.
// They are siblings, not children: mix-blend-mode only reaches the page behind
// if nothing above it isolates the group.
let FX = null;
function ensureFx() {
  if (FX && document.body.contains(FX.edge)) return FX;
  const mk = (cls) => { const e = document.createElement('div'); e.className = `p02fx ${cls}`; document.body.appendChild(e); return e; };
  FX = { drain: mk('fx-drain'), vig: mk('fx-vig'), edge: mk('fx-edge'), grain: mk('fx-grain') };
  FX.beat = mk('fx-beat');
  FX.beat.innerHTML = '<i></i>';
  FX.ghost = document.createElement('div');
  FX.ghost.id = 'p02ghost';
  FX.ghost.hidden = true;
  FX.ghost.innerHTML = '<b></b><span></span>';
  document.body.appendChild(FX.ghost);
  return FX;
}
const V = (k, v) => document.documentElement.style.setProperty(k, v);

// =============================================================== the wait, per tick
let lastRate = -1, lastQuiet = null;

function pressureNow() {
  const list = pendingDecisions();
  if (!list.length) return null;
  let lead = null, best = -1;
  for (const d of list) {
    const span = Math.max(1, d.resolveDay - d.committedDay);
    const prog = clamp01((S.day - d.committedDay) / span);
    const press = d.weight * (0.48 + 0.52 * prog);
    if (press > best) { best = press; lead = { d, prog, press, left: Math.max(0, d.resolveDay - S.day) }; }
  }
  return lead;
}

let lastPump = -1, lastCeil = -1;
export function tickWait(force = false) {
  ensureFx();
  const ceil = ribbonCeiling();
  const moved = Math.abs(ceil - lastCeil) > 8;
  if (S.day !== lastPump || moved) { lastPump = S.day; lastCeil = ceil; pumpTells(S.day); renderPending(); }
  const lead = pressureNow();

  if (!lead) {
    V('--wt', '0');
    document.body.classList.remove('p02-waiting', 'p02-close', 'p02-closing');
    document.body.style.removeProperty('--p02-after');
    if (lastRate !== 0) { heart(0); lastRate = 0; }
    if (lastQuiet !== false) { setTension(0); lastQuiet = false; }
    FX.ghost.hidden = true;
    return;
  }

  const { d, prog, press, left } = lead;
  V('--wt', clamp01(press * 1.35).toFixed(3));
  document.body.classList.add('p02-waiting');
  document.body.classList.toggle('p02-closing', prog > 0.86 && d.weight > 0.3);

  // The heartbeat is a curve, not a switch: it rises with what is at stake and
  // again, much harder, as the day comes.
  let rate = 0;
  if (d.weight > 0.16) {
    rate = 0.7 + d.weight * 0.95 + Math.pow(prog, 2.2) * (1.0 + d.weight * 1.9);
    rate = Math.min(4.2, rate);
  }
  if (force || Math.abs(rate - lastRate) > 0.07) { heart(rate); lastRate = rate; }
  V('--beat', rate > 0 ? `${Math.round(1300 / rate)}ms` : '1300ms');

  // Silence is an instrument. In the last stretch the world's drone drops away
  // and the only thing left in the room is your own pulse.
  const quiet = prog > 0.93 && d.weight > 0.34;
  if (force || quiet !== lastQuiet) { setTension(quiet ? 0 : clamp01(d.weight)); lastQuiet = quiet; }

  // In the last days the count stops hiding in the corner and stands in the
  // middle of the map, faint and enormous, beating.
  const ghostOn = left <= 7 && d.weight > 0.28;
  FX.ghost.hidden = !ghostOn;
  if (ghostOn) {
    const [gn, gu] = countdown(left);
    FX.ghost.firstChild.textContent = gn;
    FX.ghost.lastChild.textContent = left <= 0 ? 'öğreneceksin' : `${gu} kaldı`;
    FX.ghost.classList.toggle('hot', d.weight > 0.45 || !!d.irreversible);
  }

  // The date stops being a date and becomes a countdown.
  const near = left <= 30 && d.weight > 0.28;
  document.body.classList.toggle('p02-close', near);
  if (near) document.body.style.setProperty('--p02-after', JSON.stringify(left <= 0 ? ' · bugün' : ` · ${left} gün`));
  else document.body.style.removeProperty('--p02-after');
}

/** `decision:closing` means the sim thinks you are running at it too fast. */
let slowedFor = null;
function slowTheWorld(d) {
  if (!d || slowedFor === d.id) return;
  slowedFor = d.id;
  if (S.speed > 2) setSpeed(2);
  whisper('Günler ağırlaştı. Yaklaşıyor.', 'ambiguous');
}

// ================================================================= the ribbon
const cards = new Map();   // decisionId -> {el, refs}
let moreEl = null, tipEl = null;

/**
 * The ribbon owns the top-right band and nothing else. It grows DOWN to a
 * ceiling measured against whatever piece is using the middle of the right
 * edge, then wraps LEFT into a second column. It never walks down the screen
 * into someone else's lane.
 */
function ribbonCeiling() {
  const rail = document.getElementById('p06rail');
  const r = rail && rail.getClientRects().length ? rail.getBoundingClientRect() : null;
  const limit = r && r.height > 4 ? r.top - 14 : window.innerHeight * 0.54;
  return Math.max(96, Math.min(window.innerHeight * 0.54, limit) - 86);
}

export function renderPending() {
  const host = document.getElementById('pending');
  if (!host) return;
  const list = pendingDecisions().slice().sort((a, b) => (a.resolveDay - S.day) - (b.resolveDay - S.day));
  const live = new Set(list.map((d) => d.id));
  for (const [id, c] of cards) if (!live.has(id)) { c.el.remove(); cards.delete(id); }
  if (!moreEl) { moreEl = document.createElement('div'); moreEl.className = 'pmore'; }

  const cap = ribbonCeiling();
  const tight = cap < 170;                 // not even room for one full card
  host.style.setProperty('--p02cap', `${Math.round(cap)}px`);

  for (const [i, d] of list.entries()) {
    let c = cards.get(d.id);
    if (!c) { c = buildCard(d); cards.set(d.id, c); }
    host.appendChild(c.el);                // re-append = re-order: soonest on top
    c.el.hidden = false;
    c.el.classList.toggle('lead', i === 0 && !tight);
    updateCard(c, d);
  }
  host.appendChild(moreEl);

  // Two columns of room, no more — a stack of five must not flatten the one
  // that lands tomorrow.
  const budget = cap * 2 - 40;
  let used = 0, hidden = 0;
  for (const [i, d] of list.entries()) {
    const c = cards.get(d.id);
    const h = c.el.offsetHeight + 10;
    if (i > 0 && used + h > budget) { c.el.hidden = true; hidden++; }
    else used += h;
  }
  moreEl.textContent = hidden ? `+${hidden} karar daha yolda` : '';
  moreEl.hidden = !hidden;
}

function buildCard(d) {
  const t = d.targetId ? ch(d.targetId) : null;
  const el = document.createElement('article');
  el.className = 'pend';
  el.innerHTML = `
    <div class="pgrid">
      ${t ? '<div class="pface"><canvas width="128" height="128"></canvas></div>' : '<div class="pface none">✉</div>'}
      <div class="pmain">
        <div class="pkick"></div>
        <div class="ptitle">${esc(d.title)}</div>
        <div class="pwho"></div>
      </div>
      <div class="pnum"><b></b><span></span></div>
    </div>
    <div class="pstakes"></div>
    <div class="bar"><i></i></div>
    <div class="pfoot"><span class="pdots"></span><span class="podds"></span></div>
    <div class="pstop">Bunu artık durduramazsın. Mektup yola çıktı.</div>`;
  if (t) { t._ageCache = age(t); renderPortrait(t, el.querySelector('.pface canvas')); }
  el.addEventListener('mouseenter', () => { showTip(el, d); SFX.hover(); });
  el.addEventListener('mouseleave', () => hideTip());
  el.addEventListener('click', () => {
    el.classList.add('nostop');
    SFX.whisper('bad');
    clearTimeout(el._st);
    el._st = setTimeout(() => el.classList.remove('nostop'), 4200);
  });
  return {
    el,
    kick: el.querySelector('.pkick'), who: el.querySelector('.pwho'),
    num: el.querySelector('.pnum b'), unit: el.querySelector('.pnum span'),
    stakes: el.querySelector('.pstakes'), bar: el.querySelector('.bar i'),
    dots: el.querySelector('.pdots'), odds: el.querySelector('.podds'),
  };
}

function updateCard(c, d) {
  const span = Math.max(1, d.resolveDay - d.committedDay);
  const prog = clamp01((S.day - d.committedDay) / span);
  const left = Math.max(0, d.resolveDay - S.day);
  const t = d.targetId ? ch(d.targetId) : null;

  c.el.classList.toggle('hot', d.weight > 0.45 || !!d.irreversible);
  c.el.classList.toggle('imminent', left <= 14);
  c.kick.textContent = d.irreversible ? 'geri dönüşü yok' : 'yola çıktı';
  c.who.textContent = t ? `${fullName(t)} · ${styleOf(t)} · ${t.deathDay != null ? 'öldü' : age(t) + ' yaşında'}` : kindLine(d);

  const [n, u] = countdown(left);
  c.num.textContent = n; c.unit.textContent = u;

  const paid = (d.paid || []).map(paidLine).filter(Boolean);
  const risk = (d.stakes || []).map((s) => stakeLine(s)).filter(Boolean);
  c.stakes.innerHTML =
    (paid.length ? `<div class="pst paid"><em>ödedin</em>${paid.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '') +
    (risk.length ? `<div class="pst risk"><em>riskte</em>${risk.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '');

  c.bar.style.width = `${(prog * 100).toFixed(1)}%`;
  c.odds.textContent = d.shownOdds != null ? `%${Math.round(d.shownOdds * 100)} ihtimal` : 'kesin';

  const log = tellsOf(d);
  c.dots.innerHTML = log.length
    ? log.slice(-6).map((x) => `<i class="${x.tone}"></i>`).join('') + `<u>${log.length} işaret</u>`
    : '<u>henüz haber yok</u>';
}

function ensureTip() {
  if (tipEl && document.body.contains(tipEl)) return tipEl;
  tipEl = document.createElement('div');
  tipEl.id = 'p02tip';
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  return tipEl;
}
function showTip(el, d) {
  const tip = ensureTip();
  const log = tellsOf(d);
  const r = reliabilityOf(d);
  tip.innerHTML = `
    <div class="tphead">Bugüne kadar gelen haberler</div>
    ${log.length ? log.map((x) => `<div class="tp ${x.tone}"><b>${esc(fmtDate(x.day))} · ${esc(dayLabel(x.day, d))}</b>${esc(x.text)}</div>`).join('')
                 : '<div class="tp none">Hiçbir şey duymadın. Bu da bir haber.</div>'}
    ${r ? `<div class="tptrust">${r.name ? `Gözün <b>${esc(r.name)}</b>. ` : 'Kimse senin için bakmıyor. '}Getirdiği haberin güveni: <b class="t${Math.round(r.v * 4)}">${esc(r.label)}</b></div>` : ''}
    <div class="tpfoot">İşaretlerin bir kısmı yalan. Hangisi olduğunu ancak sonunda öğrenirsin — ve o zaman geri dönemezsin.</div>`;
  tip.hidden = false;
  const b = el.getBoundingClientRect();
  const h = tip.offsetHeight, w = tip.offsetWidth;
  tip.style.left = `${Math.max(8, b.left - w - 12)}px`;
  tip.style.top = `${Math.max(8, Math.min(b.top, window.innerHeight - h - 12))}px`;
}
function hideTip() { if (tipEl) tipEl.hidden = true; }

function dayLabel(day, d) {
  const since = day - (d.committedDay || 0);
  return since <= 0 ? 'aynı gün' : `${since}. gün`;
}
function countdown(left) {
  if (left <= 0) return ['bugün', ''];
  if (left < 60) return [String(left), 'gün'];
  if (left < 365) return [String(Math.round(left / 30)), 'ay'];
  return [(left / 365).toFixed(1), 'yıl'];
}
function paidLine(c) {
  return ({ gold: `${c.value} altın`, prestige: `${c.value} itibar`, piety: `${c.value} dindarlık` })[c.kind] || '';
}
function kindLine(d) {
  return ({ scheme: 'gölgede bir iş', war: 'sınırda', event: 'sarayda', edict: 'ferman', council: 'divanda' })[d.kind] || 'bekliyorsun';
}
function flashCard(d) {
  const c = cards.get(d?.id);
  if (!c) return;
  c.el.classList.remove('news');
  void c.el.offsetWidth;
  c.el.classList.add('news');
  updateCard(c, d);
}

/** A sign lands across the middle of the screen before it settles into the log. */
let newsEl = null, newsTimer = null, newsHide = null;
function announce(text, tone) {
  if (document.body.classList.contains('staged')) return;
  if (!newsEl || !document.body.contains(newsEl)) {
    newsEl = document.createElement('div');
    newsEl.id = 'p02news';
    document.body.appendChild(newsEl);
  }
  newsEl.className = tone || 'ambiguous';
  newsEl.innerHTML = `<em>beklerken bir haber geldi</em><p>${esc(text)}</p>`;
  newsEl.hidden = false;
  void newsEl.offsetWidth;
  newsEl.classList.add('in');
  clearTimeout(newsTimer);
  clearTimeout(newsHide);
  newsTimer = setTimeout(() => {
    newsEl.classList.remove('in');
    newsHide = setTimeout(() => { if (newsEl && !newsEl.classList.contains('in')) newsEl.hidden = true; }, 900);
  }, 4600);
}

export function recomputeHeart() { tickWait(true); }

// ================================================================== whispers
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

// ======================================================================= css
function injectCss() {
  css('p02-wait', `
/* ---------- the screen while you wait ---------- */
:root{--wt:0;--beat:1300ms}
.p02fx{position:fixed;inset:0;pointer-events:none;z-index:6;transition:opacity 1.4s ease}
body.staged .p02fx{opacity:0 !important;transition:opacity .4s ease}
/* colour leaves the world */
.fx-drain{background:#6d6d6d;mix-blend-mode:saturation;opacity:calc(var(--wt) * .60)}
/* the room narrows */
.fx-vig{background:radial-gradient(ellipse at 50% 46%, transparent 24%, rgba(8,5,4,.46) 66%, rgba(3,2,2,.88) 100%);
  opacity:calc(var(--wt) * .95)}
/* the edges close in, and never sit perfectly still */
.fx-edge{box-shadow:inset 0 0 150px 38px rgba(78,16,12,.80), inset 0 0 0 1px rgba(168,48,40,.22);
  opacity:calc(var(--wt) * var(--wt) * .9);animation:p02drift 9s ease-in-out infinite;will-change:transform}
@keyframes p02drift{0%,100%{transform:translate3d(0,0,0)}33%{transform:translate3d(-2px,1px,0)}66%{transform:translate3d(2px,-1px,0)}}
body.p02-closing .fx-edge{animation:p02drift 9s ease-in-out infinite, p02tremor .1s steps(2,end) infinite}
@keyframes p02tremor{0%{margin:0}50%{margin:-2px 0 0 2px}100%{margin:2px 0 0 -2px}}

/* your own pulse, drawn on the frame of the screen: lub — dub — silence */
.fx-beat{opacity:calc(var(--wt) * .95)}
.fx-beat i{position:absolute;inset:0;display:block;
  box-shadow:inset 0 0 110px 16px rgba(158,28,20,.62), inset 0 0 0 2px rgba(196,60,44,.30);
  animation:p02pulse var(--beat) linear infinite;will-change:opacity}
@keyframes p02pulse{0%{opacity:.95}7%{opacity:.22}15%{opacity:.72}28%{opacity:.05}100%{opacity:.05}}

/* candlelight is never steady, and neither are you */
.fx-grain{inset:-8%;opacity:calc(var(--wt) * .30);will-change:transform;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='180' height='180' filter='url(%23n)' opacity='0.55'/></svg>");
  animation:p02grain .42s steps(1,end) infinite}
@keyframes p02grain{0%{transform:translate3d(0,0,0)}25%{transform:translate3d(-9px,6px,0)}
  50%{transform:translate3d(7px,-8px,0)}75%{transform:translate3d(-5px,-4px,0)}100%{transform:translate3d(6px,7px,0)}}

/* the last days, written across the map so you cannot look away from them */
#p02ghost{position:fixed;inset:0;z-index:7;pointer-events:none;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:2px;animation:p02ghostin 1.2s ease both}
body.staged #p02ghost{opacity:0;transition:opacity .4s ease}
@keyframes p02ghostin{from{opacity:0;letter-spacing:40px}to{opacity:1;letter-spacing:0}}
#p02ghost b{font-size:min(30vh,240px);line-height:.9;font-weight:400;color:rgba(216,197,138,.13);
  font-variant-numeric:tabular-nums;animation:p02ghostbeat var(--beat) ease-out infinite}
#p02ghost span{font-size:15px;letter-spacing:9px;text-transform:uppercase;color:rgba(216,197,138,.24)}
#p02ghost.hot b{color:rgba(196,70,54,.17)}
#p02ghost.hot span{color:rgba(214,130,112,.34)}
@keyframes p02ghostbeat{0%{transform:scale(1.018)}16%{transform:scale(1)}100%{transform:scale(1)}}

/* a sign does not scroll past in the corner; it lands in front of you */
#p02news{position:fixed;left:50%;top:27%;transform:translate(-50%,-8px);z-index:25;pointer-events:none;
  width:min(620px,72vw);text-align:center;opacity:0;transition:opacity .5s ease,transform .5s cubic-bezier(.16,1,.3,1)}
#p02news.in{opacity:1;transform:translate(-50%,0)}
body.staged #p02news{opacity:0}
#p02news em{display:block;font-style:normal;font-size:10px;letter-spacing:4.5px;text-transform:uppercase;
  color:#8a7248;margin-bottom:9px}
#p02news p{margin:0;font-size:21px;line-height:1.55;color:#e2d6b6;letter-spacing:.2px;
  text-shadow:0 2px 26px rgba(0,0,0,.95),0 0 60px rgba(0,0,0,.8)}
#p02news.bad p{color:#e8b0a0}
#p02news.good p{color:#c3d8ac}
#p02news.ambiguous p{color:#dcccA4;font-style:italic}

/* the date becomes a countdown */
body.p02-close .date{color:#e79a88;text-shadow:0 0 22px rgba(168,48,40,.55);animation:p02datebeat var(--beat) ease-in-out infinite}
body.p02-close #dateLabel::after{content:var(--p02-after,"");color:#c9705e;letter-spacing:.6px}
@keyframes p02datebeat{0%,100%{opacity:1}55%{opacity:.62}}

/* ---------- the letter you cannot recall ---------- */
#pending{position:fixed;right:14px;top:86px;z-index:22;display:flex;flex-flow:column wrap-reverse;
  align-content:flex-start;gap:10px;width:auto;max-width:min(700px,58vw);max-height:var(--p02cap,240px)}
.pend{position:relative;cursor:default;padding:0;overflow:visible;width:330px;flex:0 0 auto;
  background:linear-gradient(158deg, rgba(32,23,15,.975), rgba(15,11,8,.975));
  border:1px solid var(--edge);border-left:3px solid var(--gold);
  box-shadow:0 16px 44px rgba(0,0,0,.7);animation:pendIn .55s cubic-bezier(.16,1,.3,1)}
@keyframes pendIn{from{opacity:0;transform:translateX(34px)}to{opacity:1;transform:none}}
.pend .pgrid{display:grid;grid-template-columns:46px 1fr auto;gap:10px;align-items:start;padding:10px 12px 6px}
.pend .pface{width:46px;height:46px;border:1px solid var(--edge-2);background:#1a140e;overflow:hidden;
  box-shadow:inset 0 0 16px rgba(0,0,0,.75)}
.pend .pface canvas{width:100%;height:100%;display:block}
.pend .pface.none{display:flex;align-items:center;justify-content:center;color:#6b5a3c;font-size:20px}
.pmore{width:330px;flex:0 0 auto;font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;color:#8a7248;text-align:right;padding:2px 4px 0}
.pend.lead{border-left-width:4px}
.pend:not(.lead) .pgrid{grid-template-columns:30px 1fr auto;padding:7px 11px 4px;gap:9px}
.pend:not(.lead) .pface{width:30px;height:30px}
.pend:not(.lead) .pface.none{font-size:14px}
.pend:not(.lead) .ptitle{font-size:12.5px}
.pend:not(.lead) .pwho{display:none}
.pend:not(.lead) .pstakes{display:none}
.pend:not(.lead) .pnum b{font-size:17px}
.pend:not(.lead) .pnum span{font-size:9px}
.pend:not(.lead) .pfoot{padding:4px 11px 6px;font-size:9.5px}
.pend .pkick{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#8a7248;margin-bottom:2px}
.pend .ptitle{font-size:14px;color:var(--gold-2);letter-spacing:.3px;line-height:1.25}
.pend .pwho{font-size:11px;color:var(--txt-dim);line-height:1.4;margin-top:2px}
.pend .pnum{text-align:right;line-height:1;padding-left:4px}
.pend .pnum b{display:block;font-size:26px;font-weight:400;color:#d8c58a;font-variant-numeric:tabular-nums}
.pend .pnum span{font-size:10px;color:var(--txt-dim);letter-spacing:1.4px;text-transform:uppercase}
.pend .pstakes{padding:0 12px 6px;display:flex;flex-direction:column;gap:3px}
.pend .pst{font-size:10.5px;line-height:1.5;display:flex;flex-wrap:wrap;gap:5px;align-items:baseline}
.pend .pst em{font-style:normal;letter-spacing:1.4px;text-transform:uppercase;font-size:8.5px;color:#6f5f42;min-width:38px}
.pend .pst.paid span{color:#b8905a}
.pend .pst.risk span{color:#d08a7a;border:1px solid rgba(168,48,40,.30);background:rgba(122,31,26,.16);padding:0 5px}
.pend .bar{height:3px;background:rgba(0,0,0,.6);position:relative;overflow:hidden;margin:0 0 0 0}
.pend .bar i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#8a6a2e,var(--gold-2));transition:width .5s linear}
.pend .pfoot{display:flex;justify-content:space-between;align-items:center;padding:6px 12px 9px;font-size:10.5px;color:var(--txt-dim)}
.pend .pdots{display:flex;align-items:center;gap:4px}
.pend .pdots i{width:6px;height:6px;border-radius:50%;background:#7a6a52;display:block}
.pend .pdots i.good{background:#7fa860}.pend .pdots i.bad{background:#c05a4a}.pend .pdots i.ambiguous{background:#a8913f}
.pend .pdots u{text-decoration:none;font-size:10px;color:#7a6a52;margin-left:3px}
.pend .podds{font-variant-numeric:tabular-nums;color:#a8987a}
.pend.hot{border-left-color:var(--blood-2)}
.pend.hot .bar i{background:linear-gradient(90deg,#6b2018,#d05a48)}
.pend.hot .pnum b{color:#e2a291}
.pend.imminent{animation:pendIn .55s cubic-bezier(.16,1,.3,1), hotpulse var(--beat,1200ms) ease-in-out infinite}
@keyframes hotpulse{0%,100%{box-shadow:0 16px 44px rgba(0,0,0,.7)}50%{box-shadow:0 16px 44px rgba(0,0,0,.7), 0 0 26px rgba(168,48,40,.55)}}
.pend.news{animation:pendNews 1.5s ease}
@keyframes pendNews{0%{background-color:rgba(201,163,78,.30)}100%{background-color:transparent}}

/* click it and the game says no */
.pend .pstop{max-height:0;overflow:hidden;opacity:0;transition:max-height .3s ease,opacity .3s ease,padding .3s ease;
  font-size:11px;line-height:1.45;color:#f0c4b8;background:rgba(122,31,26,.55);border-top:1px solid rgba(168,48,40,.55);
  padding:0 12px;letter-spacing:.2px}
.pend.nostop{position:relative;z-index:2}
.pend.nostop .pstop{max-height:80px;opacity:1;padding:8px 12px}
.pend.nostop{animation:pendDeny .42s ease}
@keyframes pendDeny{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}45%{transform:translateX(5px)}70%{transform:translateX(-3px)}}

/* everything you have been told, in one place */
#p02tip{position:fixed;z-index:88;width:326px;padding:11px 13px;pointer-events:none;
  background:rgba(12,8,6,.985);border:1px solid var(--edge);box-shadow:var(--shadow);animation:p02tipin .16s ease}
@keyframes p02tipin{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}
#p02tip .tphead{font-size:9.5px;letter-spacing:1.8px;text-transform:uppercase;color:#7a6a52;margin-bottom:7px}
#p02tip .tp{font-size:11.5px;line-height:1.55;padding:4px 0 4px 9px;border-left:2px solid var(--edge-2);margin-bottom:4px;color:#cfc2a6}
#p02tip .tp b{display:block;font-size:9.5px;font-weight:400;letter-spacing:1px;color:#7a6a52;text-transform:uppercase}
#p02tip .tp.good{border-left-color:#5d8a48}.pend .tp.bad{border-left-color:var(--blood-2)}
#p02tip .tp.ambiguous{border-left-color:#8a7a48;font-style:italic}
#p02tip .tp.none{color:#8a7a60;font-style:italic;border-left-color:transparent;padding-left:0}
#p02tip .tptrust{margin-top:8px;padding-top:7px;border-top:1px solid var(--edge-2);font-size:11px;color:#a8987a;line-height:1.5}
#p02tip .tptrust b{color:var(--gold-2);font-weight:400}
#p02tip .tptrust b.t0,#p02tip .tptrust b.t1{color:#c9705e}
#p02tip .tpfoot{margin-top:6px;font-size:10.5px;color:#8a7a60;line-height:1.5;font-style:italic}
`);
}
