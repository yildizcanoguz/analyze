// ===========================================================================
// P03 — AÇIĞA ÇIKIŞ.  Beat 4 of the tension spine.
// ---------------------------------------------------------------------------
// A result does not appear. It arrives.
//
// The player committed months ago, paid up front, and has been living with it
// since. When the answer finally lands, the game owes them a moment — not a
// text box. So this file is a director, not a renderer:
//
//   silence  ->  a held breath  ->  ONE WORD  ->  pause  ->  the sentence
//            ->  the consequences, one at a time  ->  only then, a way out.
//
// Three stagings, because a tax return and a dead child must not look alike:
//   light  (w < .25)   a card in the corner; the world keeps turning
//   mid    (.25–.5)    the screen darkens, one column of text, no face
//   heavy  (w > .5)    full scene: camera, portrait, letterbox, long silences
//
// Good and bad are separated by temperature and by *timing*: a bad answer comes
// colder, later and quieter. A good one is warm but never a celebration —
// in this game winning is also billed to you, just later.
// ===========================================================================

import { S, ch } from '../core/state.js';
import { on } from '../core/bus.js';
import { fullName } from '../sim/characters.js';
import { SFX, heart, setTension } from '../audio/audio.js';
import { flyTo, unlock } from '../render/camera.js';
import { worldOfProvince } from '../render/mapmesh.js';
import { renderPortrait } from '../render/portrait.js';
import { pause, resume, pauseReason } from '../core/clock.js';
// namespace import: 20 other pieces are editing their files in parallel, and a
// named import of something they have not exported yet would blank the screen.
import * as DEC from '../sim/decision.js';
import { fmtDate, fromDay, ageAt } from '../core/date.js';
import { esc } from './decision.js';
import { css } from './_css.js';

const root = () => document.getElementById('revealRoot');
const queue = [];
let busy = false;
let live = null;          // the scene currently on screen, if any
let cardHost = null;

export function initReveal() {
  style();
  // Inspection affordance, same spirit as main.js's `__advance`: stage a given
  // outcome payload immediately, or pass nothing to dismiss what is on screen.
  // `_slow: n` stretches every beat n-fold and `_freeze: ms` halts the scene at
  // one of them. It only draws; it never touches the sim.
  window.__stageReveal = (d) => {
    if (!d) { live?.close(); return 'closed'; }
    const spec = { weight: 0.6, ...d };
    live?.close();
    if (weightClass(spec) === 'light') card(spec); else { queue.push(spec); drain(); }
    return weightClass(spec);
  };
  on('decision:resolved', (d) => {
    if (!d || (d.weight ?? 0) <= 0.14) return;
    if (weightClass(d) === 'light') { card(d); return; }   // never blocks the queue
    queue.push(d);
    drain();
  });
}

/**
 * Stage an arbitrary moment in P03's language, for the beats that are not
 * decisions — the player's own death, a title going extinct. Same spec shape as
 * a resolved decision: {weight, irreversible, targetId, scene, committedDay,
 * resolveDay, title, outcome:{success, knell, beat, title, text, effects}}.
 * Returns a promise that settles when the player has dismissed it.
 */
export function stageMoment(spec) {
  const d = { weight: 0.7, ...spec };
  if (weightClass(d) === 'light') { card(d); return Promise.resolve(); }
  return new Promise((res) => { queue.push(Object.assign(d, { _done: res })); drain(); });
}

// ---------------------------------------------------------------------------
// weight classes — the single most important thing in this file
// ---------------------------------------------------------------------------
function weightClass(d) {
  // A death is always a rite, whatever the arithmetic said.
  if (isDeath(d)) return 'heavy';
  // The sim's tier (sim/decision.js) decides what counts as a rite; below that
  // the reveal keeps its own floor, because stopping the whole screen for a
  // middling outcome is exactly what dilutes the heavy ones.
  let tier = null;
  try { tier = DEC.tierOf ? DEC.tierOf(d) : d.tier || null; } catch { tier = null; }
  const w = d.weight ?? 0;
  if (tier === 'rite' || w > 0.5) return 'heavy';
  return w >= 0.25 ? 'mid' : 'light';
}

function isDeath(d) {
  if (d.outcome?.knell === true) return true;
  const t = d.targetId ? ch(d.targetId) : null;
  return !!(t && t.deathDay != null && S.day - t.deathDay <= 1);
}

// Beats, in ms. Bad news is slower than good news; death is slower than both.
function tempo(kind, tone, slow = 1) {
  const base = kind === 'heavy'
    ? { hush: 650, breath: 1900, word: 1450, sentence: 950, para: 900, effect: 480, gate: 1600 }
    : { hush: 260, breath: 900, word: 780, sentence: 620, para: 540, effect: 310, gate: 620 };
  const k = tone === 'death' ? 1.3 : tone === 'bad' ? 1.12 : 1;
  const o = {};
  for (const key in base) o[key] = Math.round(base[key] * k * (slow > 0 ? slow : 1));
  o.gate = Math.max(o.gate, (kind === 'heavy' ? 1500 : 500) * (slow > 0 ? slow : 1));  // never instantly clickable
  return o;
}

// ---------------------------------------------------------------------------
// queue
// ---------------------------------------------------------------------------
async function drain() {
  if (busy || !queue.length) return;
  busy = true;
  const d = queue.shift();
  try { await scene(d); } catch (e) { console.error(e); cleanup(); }
  try { d._done?.(); } catch { /* caller's problem */ }
  busy = false;
  if (queue.length) setTimeout(drain, 700);
}

// ---------------------------------------------------------------------------
// the staged reveal (mid + heavy)
// ---------------------------------------------------------------------------
function scene(d) {
  return new Promise((done) => {
    const kind = weightClass(d);
    const good = !!d.outcome?.success;
    const death = isDeath(d);
    const tone = death ? 'death' : good ? 'good' : 'bad';
    const t = tempo(kind, tone, d._slow || 1);
    const heavy = kind === 'heavy';

    const timers = [];
    let closed = false;
    // `_freeze` (inspection only) stops the scene at a given beat so a slow
    // capture can photograph that beat instead of whatever came after it.
    const at = (ms, fn) => {
      if (d._freeze != null && ms > d._freeze) return;
      timers.push(setTimeout(() => { if (!closed) fn(); }, ms));
    };

    pause('reveal');
    heart(0);
    setTension(death ? 1 : good ? 0.2 : 0.6);
    document.body.classList.add('staged', 'rv-staging');
    if (heavy) document.body.classList.add('rv-cine');

    const r = root();
    r.innerHTML = '';

    // the map is the backdrop, so push the camera at the place this happened
    const w3 = heavy && d.scene?.provinceIdx != null ? worldOfProvince(d.scene.provinceIdx) : null;
    if (w3) flyTo(w3, { dist: 118, pitch: 0.29, dur: 3.8, lock: true });

    // ---- the room ---------------------------------------------------------
    // class `reveal` is kept so the rest of the app can tell this overlay is up
    const el = document.createElement('div');
    el.className = `reveal rv rv-${kind} rv-${tone}`;
    el.innerHTML = `
      <div class="rv-scrim"></div>
      ${heavy ? '<div class="rv-bar top"></div><div class="rv-bar bot"></div>' : ''}
      <div class="rv-breath"><i></i><i></i><i></i><b></b></div>
      <div class="rv-stage">
        ${heavy ? '<div class="rv-face"><div class="rv-frame"><canvas width="320" height="320"></canvas><div class="rv-lid t"></div><div class="rv-lid b"></div></div></div>' : ''}
        <div class="rv-col"></div>
      </div>`;
    r.appendChild(el);
    const col = el.querySelector('.rv-col');
    el.classList.add('lit');

    // ---- the face (heavy only): a name you can look at while you wait ------
    const who = heavy ? (d.targetId ? ch(d.targetId) : null) || ch(S.playerId) : null;
    if (who) {
      const face = el.querySelector('.rv-face');
      try {
        who._ageCache = ageAt(who.birthDay, who.deathDay ?? S.day);
        renderPortrait(who, face.querySelector('canvas'));
      } catch (e) { console.error(e); }
      const cap = document.createElement('div');
      cap.className = 'rv-who';
      cap.innerHTML = `<span>${esc(fullName(who))}</span><em>${lifespan(who)}</em>`;
      face.appendChild(cap);
      at(t.hush * 0.4, () => face.classList.add('in'));
    }

    // ---- 1. silence, then a breath ----------------------------------------
    at(t.hush, () => { el.classList.add('breath'); SFX.breath(); });

    // ---- 2. one word ------------------------------------------------------
    const wordAt = t.hush + t.breath;
    at(Math.max(0, wordAt - 700 * (d._slow || 1)), () => {
      const when = document.createElement('div');
      when.className = 'rv-when';
      when.textContent = waitedLine(d);
      col.appendChild(when);
    });
    at(wordAt, () => {
      el.classList.remove('breath');
      el.classList.add('spoken');
      if (death) SFX.knell(); else if (good) SFX.good(); else SFX.bad();
      if (death && w3) flyTo(w3, { dist: 330, pitch: 0.58, dur: 7.5, lock: true });

      const word = document.createElement('div');
      word.className = 'rv-word';
      word.textContent = beatWord(d, heavy, good);
      col.appendChild(word);
      if (who) at(240 * (d._slow || 1), () => el.querySelector('.rv-face')?.classList.add(death ? 'gone' : 'seen'));
    });

    // ---- 3. the word steps aside; the sentence arrives ---------------------
    const titleAt = wordAt + t.word;
    at(titleAt, () => {
      col.querySelector('.rv-word')?.classList.add('small');
      const h = document.createElement('h1');
      h.className = 'rv-title';
      h.textContent = d.outcome?.title || d.title || '';
      col.appendChild(h);
      // A mid reveal has no portrait, so it says the name out loud instead —
      // the thing at stake always has a name and an age in this game.
      const subj = !heavy && d.targetId ? ch(d.targetId) : null;
      if (subj) {
        const w2 = document.createElement('div');
        w2.className = 'rv-sub';
        w2.textContent = `${fullName(subj)} · ${lifespan(subj)}`;
        col.appendChild(w2);
      }
    });

    // ---- 4. the paragraphs, one after another -----------------------------
    const paras = String(d.outcome?.text || '').split('\n\n').map((x) => x.trim()).filter(Boolean);
    let cursor = titleAt + t.sentence;
    const body = document.createElement('div');
    body.className = 'rv-text';
    at(cursor - 1, () => col.appendChild(body));
    paras.forEach((p, i) => {
      at(cursor + i * t.para, () => {
        const n = document.createElement('p');
        n.textContent = p;
        body.appendChild(n);
      });
    });
    cursor += paras.length * t.para;

    // ---- 5. what it costs you, line by line -------------------------------
    const effects = (d.outcome?.effects || []).filter(Boolean);
    const paid = paidLine(d);
    if (effects.length || paid || (heavy && lastTell(d))) {
      const box = document.createElement('div');
      box.className = 'rv-eff';
      at(cursor, () => {
        col.appendChild(box);
        // What you were told while you waited, quoted back at you. Half of these
        // were noise; you will not be able to tell which until you read it here.
        const tell = heavy ? lastTell(d) : null;
        if (tell) {
          const n = document.createElement('div');
          n.className = 'rv-tell';
          n.textContent = `Beklerken sana şu söylenmişti: “${tell.text}”`;
          box.appendChild(n);
        }
        // The price you paid before you knew anything comes next: the reveal is
        // a bill, and the top line was already debited months ago.
        if (paid) {
          const n = document.createElement('div');
          n.className = 'rv-paid';
          n.textContent = paid;
          box.appendChild(n);
        }
      });
      effects.forEach((e, i) => {
        at(cursor + 180 * (d._slow || 1) + i * t.effect, () => {
          const n = document.createElement('div');
          n.className = 'rv-line ' + effectTone(e);
          n.innerHTML = String(e);
          box.appendChild(n);
          SFX.page();
        });
      });
      cursor += 180 * (d._slow || 1) + Math.min(effects.length, 3) * t.effect;
    }

    // ---- 6. the mark it leaves --------------------------------------------
    if (heavy) {
      at(cursor, () => {
        const m = document.createElement('div');
        m.className = 'rv-mark';
        m.textContent = d.irreversible
          ? 'Geri dönüşü yoktu. Kayda geçti.'
          : good ? 'Bu sefer kazandın. Bedeli sonra sorulacak.'
            : 'Bunu sen seçtin.';
        col.appendChild(m);
      });
    }

    // ---- 7. the way out — locked for a while ------------------------------
    at(cursor, () => {
      const b = document.createElement('button');
      b.className = 'rv-ok';
      b.disabled = true;
      b.innerHTML = `<span>devam</span><i></i>`;
      col.appendChild(b);
      b.style.setProperty('--gate', t.gate + 'ms');
      void b.offsetHeight;
      b.classList.add('arm');
      b.onclick = () => { if (!b.disabled) close(); };
      at(t.gate, () => { b.disabled = false; b.classList.add('open'); });
      // Enter only once the button itself is live.
      at(t.gate + 60, () => {
        const h = (ev) => {
          // deliberately not Space: that is the shell's pause key, and a single
          // press must not both dismiss this and start time moving again
          if (ev.key === 'Enter' || ev.key === 'Escape') {
            removeEventListener('keydown', h); ev.preventDefault(); close();
          }
        };
        addEventListener('keydown', h);
        timers.push(setTimeout(() => removeEventListener('keydown', h), 600000));
      });
    });

    live = { close };

    function close() {
      if (closed) return;
      closed = true;
      if (live && live.close === close) live = null;
      for (const id of timers) clearTimeout(id);
      el.classList.add('out');
      setTimeout(() => { if (root().contains(el)) el.remove(); cleanup(); done(); }, 420);
    }
  });
}

function cleanup() {
  document.body.classList.remove('staged', 'rv-cine', 'rv-staging');
  unlock();
  setTension(0);
  heart(0);
  const open = DEC.openDecisions ? DEC.openDecisions() : [];
  if (!open.length && pauseReason() === 'reveal') resume();
}

// ---------------------------------------------------------------------------
// light: a card in the corner. The world does not stop for a tax return.
// ---------------------------------------------------------------------------
function card(d) {
  if (!cardHost || !cardHost.isConnected) {
    cardHost = document.createElement('div');
    cardHost.className = 'rv-cards';
    root().appendChild(cardHost);
  }
  const good = !!d.outcome?.success;
  const el = document.createElement('div');
  el.className = `rv-card ${good ? 'good' : 'bad'}`;
  const first = String(d.outcome?.text || '').split('\n\n')[0] || '';
  const t = d.targetId ? ch(d.targetId) : null;
  el.innerHTML = `
    <div class="rv-cbeat">${esc(d.outcome?.beat || (good ? 'oldu' : 'olmadı'))}${t ? ' · ' + esc(fullName(t)) : ''}</div>
    <div class="rv-ctitle">${esc(d.outcome?.title || d.title || '')}</div>
    ${first ? `<div class="rv-cbody">${esc(first)}</div>` : ''}
    ${(d.outcome?.effects || []).length ? `<div class="rv-ceff">${d.outcome.effects.map((e) => `<div>${e}</div>`).join('')}</div>` : ''}`;
  cardHost.appendChild(el);
  while (cardHost.children.length > 3) cardHost.firstChild.remove();
  SFX.page();
  void el.offsetHeight;
  el.classList.add('in');
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 500); };
  el.onclick = kill;
  setTimeout(kill, 11000);
}

// ---------------------------------------------------------------------------
// words
// ---------------------------------------------------------------------------
function beatWord(d, heavy, good) {
  let s = String(d.outcome?.beat || (good ? 'oldu' : 'olmadı')).trim();
  if (heavy) s = s.replace(/[.…]+$/, '') + '.';
  return s;
}

/** The last signal that reached you during the wait, straight from the record. */
function lastTell(d) {
  const log = S.chronicle || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const c = log[i];
    if (c && c.kind === 'tell' && c.decisionId === d.id && c.text) return c;
  }
  return null;
}

/** What the choice already cost you, back when you still knew nothing. */
function paidLine(d) {
  const paid = (d.paid || []).filter(Boolean);
  if (!paid.length) return '';
  const parts = paid.map((c) => {
    if (c.kind === 'gold') return `${c.value} altın`;
    if (c.kind === 'prestige') return `${c.value} itibar`;
    if (c.kind === 'piety') return `${c.value} dindarlık`;
    try { return DEC.stakeLine ? DEC.stakeLine(c) : (c.label || ''); } catch { return c.label || ''; }
  }).filter(Boolean);
  return parts.length ? `Peşin ödediğin: ${parts.join(' · ')}` : '';
}

/** A consequence is a gain or a loss; the tick mark says which, quietly. */
function effectTone(html) {
  const t = String(html).replace(/<[^>]*>/g, '');
  // Losses win the tie: "+25 gerginlik" is a plus sign on a wound.
  if (/öld[üu]|gitti|düştü|kayb|firar|hapis|ayaklan|kin tut|rakib|gerginlik|stres|dehşet|günah|aforoz|isyan/i.test(t)
      || /[−–-]\s?[0-9]/.test(t)) return 'down';
  if (/[+]\s?[0-9]/.test(t) || /iyileşti|kalktı|doydu|sustu|kazan|sadakat|itibar|dindarlık/i.test(t)) return 'up';
  return '';
}

/** The line that reminds you how long you carried this. */
function waitedLine(d) {
  const waited = Math.max(0, (d.resolveDay ?? S.day) - (d.committedDay ?? S.day));
  const date = fmtDate(S.day);
  if (waited < 2) return date;
  return `${humanWait(waited)} önce verdiğin karar · ${date}`;
}

function humanWait(days) {
  if (days < 30) return `${days} gün`;
  if (days < 365) return `${Math.round(days / 30)} ay`;
  const y = Math.floor(days / 365), m = Math.round((days % 365) / 30);
  return m ? `${y} yıl ${m} ay` : `${y} yıl`;
}

function lifespan(c) {
  const b = fromDay(c.birthDay).y;
  if (c.deathDay != null) return `${b} – ${fromDay(c.deathDay).y}`;
  return `${ageAt(c.birthDay, S.day)} yaşında`;
}

// ---------------------------------------------------------------------------
// look
// ---------------------------------------------------------------------------
function style() {
  css('p03-reveal', `
/* ---- P03 açığa çıkış ------------------------------------------------- */
.rv{position:absolute;inset:0;max-width:none;padding:0;text-align:left;pointer-events:auto;
  --ink:#f0e6d0; --dim:#9c8f76; --hair:rgba(201,163,78,.30);
  --gl:radial-gradient(120% 90% at 50% 16%, rgba(6,4,3,.10), rgba(6,4,3,.84) 58%, rgba(4,3,2,.97))}
.rv.out{opacity:0;transition:opacity .4s ease}
.rv-good{--ink:#e9d9a8; --dim:#a4936c; --hair:rgba(201,163,78,.34)}
.rv-bad{ --ink:#ded4c4; --dim:#8d8b86; --hair:rgba(150,158,170,.26);
  --gl:radial-gradient(120% 90% at 50% 16%, rgba(7,9,13,.16), rgba(6,8,12,.86) 58%, rgba(4,5,8,.97))}
.rv-death{--ink:#cfc8bb; --dim:#7f7d78; --hair:rgba(150,158,170,.22);
  --gl:radial-gradient(120% 92% at 50% 14%, rgba(6,7,10,.26), rgba(5,6,9,.90) 54%, rgba(3,4,6,.99))}
.rv-scrim{position:absolute;inset:0;background:var(--gl);animation:rvFade .8s ease both}
@keyframes rvFade{from{opacity:0}to{opacity:1}}

/* the map itself is the backdrop of a heavy scene, so let it show through */
body.staged.rv-cine #dim{opacity:.30}

/* letterbox: only the heavy scene gets to be a scene */
.rv-bar{position:absolute;left:0;right:0;height:76px;background:#050403;
  animation:rvBar 1.5s cubic-bezier(.16,1,.3,1) both}
.rv-bar.top{top:0}.rv-bar.bot{bottom:0}
@keyframes rvBar{from{height:0}to{height:76px}}

/* ---- the held breath: rings on a still surface, not one blob ---------- */
.rv-breath{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;transition:opacity .8s ease}
.rv.breath .rv-breath{opacity:1}
.rv-breath i{position:absolute;left:-40px;top:-40px;width:80px;height:80px;border-radius:50%;
  border:1px solid var(--hair);opacity:0;transform:scale(.2)}
.rv.breath .rv-breath i{animation:rvRing 3.4s cubic-bezier(.22,.61,.36,1) infinite}
.rv.breath .rv-breath i:nth-child(2){animation-delay:.85s}
.rv.breath .rv-breath i:nth-child(3){animation-delay:1.7s}
.rv-breath b{position:absolute;left:0;top:0;height:1px;width:0;transform:translate(-50%,0);
  background:linear-gradient(90deg,transparent,var(--hair),transparent)}
.rv.breath .rv-breath b{animation:rvHorizon 3.6s ease-in-out infinite}
@keyframes rvRing{0%{transform:scale(.2);opacity:0}12%{opacity:.85}100%{transform:scale(7);opacity:0}}
@keyframes rvHorizon{0%,100%{width:0;opacity:0}45%{width:760px;opacity:.9}}
/* death closes in instead of opening out */
.rv-death.breath .rv-breath i{animation:rvRingIn 3.4s cubic-bezier(.4,0,.2,1) infinite}
@keyframes rvRingIn{0%{transform:scale(7);opacity:0}20%{opacity:.7}100%{transform:scale(.15);opacity:0}}

/* ---- the stage ------------------------------------------------------- */
.rv-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  gap:clamp(28px,4vw,62px);padding:96px 40px}
.rv-mid .rv-stage{padding:60px 40px}
.rv-col{width:min(620px,58vw);max-height:100%;overflow-y:auto;scrollbar-width:none;
  display:flex;flex-direction:column;align-items:flex-start}
.rv-col::-webkit-scrollbar{display:none}
.rv-mid .rv-col{width:min(600px,72vw);text-align:center;align-items:center}

/* ---- the face -------------------------------------------------------- */
.rv-face{position:relative;width:clamp(190px,19vw,236px);flex:0 0 auto;opacity:0}
.rv-face.in{animation:rvFaceIn 2.2s cubic-bezier(.16,1,.3,1) both}
@keyframes rvFaceIn{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
/* the frame crops in on the head and puts candlelight back around it, so a
   portrait reads as a person in a dark room rather than a model on a plinth */
.rv-frame{position:relative;overflow:hidden;border:1px solid var(--hair);background:#0a0705;
  box-shadow:0 26px 74px rgba(0,0,0,.78)}
.rv-frame canvas{width:100%;height:auto;display:block;transform:scale(1.12) translateY(2%);
  transform-origin:50% 40%;filter:saturate(.80) brightness(.72) contrast(1.04);transition:filter 2.6s ease}
.rv-frame::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(115% 95% at 42% 34%, rgba(255,214,150,.10), rgba(0,0,0,0) 44%, rgba(0,0,0,.62) 88%);
  box-shadow:inset 0 0 46px rgba(0,0,0,.72)}
.rv-face.seen .rv-frame canvas{filter:saturate(.94) brightness(.92) contrast(1.02)}
.rv-face.gone .rv-frame canvas{filter:grayscale(.94) brightness(.50) contrast(.98)}
.rv-death .rv-frame::after{background:radial-gradient(115% 95% at 42% 34%, rgba(150,170,200,.05), rgba(0,0,0,0) 40%, rgba(0,0,0,.78) 86%)}
.rv-lid{position:absolute;left:0;right:0;height:0;background:#050506;transition:height 2.8s cubic-bezier(.4,0,.2,1);z-index:2}
.rv-lid.t{top:0}.rv-lid.b{bottom:0}
.rv-face.gone .rv-lid{height:12%}
.rv-who{margin-top:13px;font-size:13px;letter-spacing:.4px;color:var(--dim);line-height:1.5}
.rv-who span{display:block;color:var(--ink);font-size:16.5px;letter-spacing:.5px;margin-bottom:2px}
.rv-who em{font-style:normal;font-size:11.5px;letter-spacing:1.8px;text-transform:uppercase;opacity:.78}
.rv-death .rv-who span{color:#b9b2a6}

/* ---- the word -------------------------------------------------------- */
.rv-when{font-size:11.5px;letter-spacing:3px;text-transform:uppercase;color:var(--dim);opacity:0;
  margin-bottom:20px;animation:rvUp 1.4s .1s ease both}
.rv-word{font-size:clamp(38px,5.2vw,70px);line-height:1;color:var(--ink);letter-spacing:-.5px;
  font-weight:400;margin:0;animation:rvWord 1.5s cubic-bezier(.16,1,.3,1) both;
  transition:font-size 1.1s cubic-bezier(.16,1,.3,1), letter-spacing 1.1s ease, color 1.1s ease, opacity 1.1s ease, margin 1.1s ease}
.rv-bad .rv-word,.rv-death .rv-word{animation-duration:2.1s}
.rv-word.small{font-size:12.5px;letter-spacing:5px;text-transform:uppercase;color:var(--dim);margin-bottom:14px}
@keyframes rvWord{from{opacity:0;filter:blur(14px);transform:translateY(16px)}to{opacity:1;filter:none;transform:none}}
@keyframes rvUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

/* ---- the sentence ---------------------------------------------------- */
.rv-heavy .rv-title{font-size:clamp(28px,3.1vw,44px)}
.rv .rv-title{font-size:clamp(23px,2.4vw,34px);font-weight:400;line-height:1.22;margin:0 0 18px;
  letter-spacing:.3px;color:var(--ink);animation:rvUp 1.5s ease both}
.rv-good .rv-title{color:#e3cf92;text-shadow:0 0 60px rgba(216,201,138,.22)}
.rv-bad .rv-title{color:#cfc6b6}
.rv-death .rv-title{color:#c2bbae;text-shadow:0 0 50px rgba(120,130,150,.16)}
.rv-sub{font-size:12.5px;letter-spacing:1.7px;text-transform:uppercase;color:var(--dim);opacity:.8;
  margin:-8px 0 18px;animation:rvUp 1.5s .25s ease both}
.rv .rv-text{margin:0}
.rv .rv-text p{font-size:clamp(15px,1.12vw,17.5px);line-height:1.9;color:#cdc2ab;margin:0 0 13px;
  animation:rvUp 1.6s ease both;max-width:60ch}
.rv-bad .rv-text p,.rv-death .rv-text p{color:#bdb8ad}

/* ---- the consequences, one at a time --------------------------------- */
.rv-eff{margin-top:24px;border-top:1px solid var(--hair);padding-top:14px;width:100%;
  display:flex;flex-direction:column;gap:2px}
.rv-mid .rv-eff{align-items:stretch;width:auto;max-width:min(460px,80vw);margin-left:auto;margin-right:auto;text-align:left}
.rv-line{font-size:13.5px;line-height:1.95;color:var(--dim);letter-spacing:.3px;
  animation:rvSlide 1.1s cubic-bezier(.16,1,.3,1) both}
.rv-line b{color:#c9a34e;font-weight:400}
/* a gain and a loss must be separable at a glance, without shouting in red */
.rv-line.up{color:#c2b088}
.rv-line.up::before{background:#c9a34e;opacity:.9;height:2px}
.rv-line.down{color:#8e8880}
.rv-line.down::before{background:#8e8880;opacity:.75}
.rv-good .rv-line.down::before{background:#9a7a68;opacity:.8}
.rv-bad .rv-line.up,.rv-death .rv-line.up{color:#b6b0a4}
.rv-bad .rv-line.up::before,.rv-death .rv-line.up::before{background:#9a9488}
.rv-tell{font-size:12.5px;line-height:1.85;color:var(--dim);opacity:.7;font-style:italic;
  padding-bottom:8px;margin-bottom:6px;border-bottom:1px dashed rgba(255,255,255,.07);
  animation:rvUp 1.2s ease both}
.rv-paid{font-size:12.5px;line-height:1.9;color:var(--dim);opacity:.72;letter-spacing:.4px;
  padding-bottom:8px;margin-bottom:6px;border-bottom:1px dashed rgba(255,255,255,.07);
  animation:rvUp 1.2s ease both}
.rv-bad .rv-line b,.rv-death .rv-line b{color:#a9a49a}
.rv-line::before{content:'';display:inline-block;width:15px;height:1px;background:currentColor;
  vertical-align:middle;margin-right:11px;opacity:.55}
@keyframes rvSlide{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}
.rv-mark{margin-top:20px;font-size:13px;letter-spacing:.4px;color:var(--dim);opacity:.85;
  animation:rvUp 1.6s ease both}

/* ---- the way out, locked at first ------------------------------------ */
.rv-ok{position:relative;margin-top:34px;padding:12px 44px;background:transparent;border:1px solid var(--hair);
  color:var(--dim);font-family:var(--serif);font-size:13.5px;letter-spacing:2.6px;text-transform:uppercase;
  cursor:default;opacity:.5;transition:color .5s ease,background .3s ease,border-color .5s ease,opacity .6s ease;
  overflow:hidden;animation:rvBtnIn 1.1s ease both}
@keyframes rvBtnIn{from{opacity:0;transform:translateY(10px)}to{opacity:.5;transform:none}}
.rv-ok i{position:absolute;left:0;bottom:0;height:1px;width:0;background:var(--hair)}
.rv-ok.arm i{animation:rvGate var(--gate,1500ms) linear forwards}
@keyframes rvGate{from{width:0}to{width:100%}}
.rv-ok.open{animation:none;opacity:1;color:#e0cf94;border-color:rgba(201,163,78,.5);cursor:pointer}
.rv-ok.open:hover{background:rgba(201,163,78,.14)}
.rv-death .rv-ok.open,.rv-bad .rv-ok.open{color:#cfc8bb;border-color:rgba(160,168,180,.42)}
.rv-death .rv-ok.open:hover,.rv-bad .rv-ok.open:hover{background:rgba(160,168,180,.10)}

/* ---- light: a card in the corner, the world keeps turning ------------- */
.rv-cards{position:absolute;left:60px;top:92px;width:312px;display:flex;flex-direction:column;gap:8px;
  pointer-events:auto;z-index:2}
.rv-card{background:rgba(18,13,9,.94);border:1px solid rgba(201,163,78,.20);border-left:2px solid #6b5a32;
  padding:11px 14px 12px;box-shadow:0 12px 34px rgba(0,0,0,.55);cursor:pointer;opacity:0}
.rv-card.in{animation:rvCardIn .55s cubic-bezier(.16,1,.3,1) both}
@keyframes rvCardIn{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}
.rv-card.out{opacity:0;transform:translateX(-14px);transition:opacity .45s ease,transform .45s ease}
.rv-card.bad{border-left-color:#6a5450}
.rv-card:hover{background:rgba(26,19,13,.97)}
.rv-cbeat{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#8a7a58;margin-bottom:5px}
.rv-ctitle{font-size:15px;color:#d8c98a;line-height:1.3;letter-spacing:.3px}
.rv-card.bad .rv-ctitle{color:#c3b8a6}
.rv-cbody{font-size:12.5px;line-height:1.6;color:#a8987a;margin-top:6px;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.rv-ceff{margin-top:8px;padding-top:7px;border-top:1px solid rgba(201,163,78,.14);
  font-size:11.5px;line-height:1.75;color:#8d7f62}
.rv-ceff b{color:#c9a34e;font-weight:400}
`);
}
