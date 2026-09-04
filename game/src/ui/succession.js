// P08 — THE HANDOVER.
// ---------------------------------------------------------------------------
// Three surfaces, one feeling:
//   1. a chip that will not go away, naming the child who gets your work;
//   2. a ledger where the law can be changed — now, in prestige, for a payoff
//      that lands in eight years, if you live that long;
//   3. the death itself, staged in acts: the body, what you leave, the new face,
//      and then the sentence that ends you — "artık sen o değilsin".
//
// All DOM nodes are created here and appended to document.body. CSS goes in
// under the p08-succ key. This module may import anything; nothing imports it.

import { S, ch, ti } from '../core/state.js';
import { on } from '../core/bus.js';
import { fmtDate, YEAR } from '../core/date.js';
import { pause, resume } from '../core/clock.js';
import { fullName, age, skills, SKILL_LABEL, opinion, opinionLabel, relation, causeLabel, mortalityChance } from '../sim/characters.js';
import { styleOf, primaryTitle, titleName } from '../sim/realm.js';
import {
  LAWS, LAW_ORDER, currentLaw, lawInfo, pendingLaw,
  successionPreview, successionLine, electiveTally, lawQuote, proposeLaw,
  tickSuccession, handoverPreview, assumeHeir, claimantsOn, lastSuccession,
  disinheritedOf, reignStart, generation,
  disinheritQuote, disinherit, isDisinherited, struckDay,
} from '../sim/succession.js';
import { TRAITS } from '../content/traits.js';
import { renderPortrait } from '../render/portrait.js';
import { SFX, heart, resumeAudio } from '../audio/audio.js';
import { esc } from './decision.js';
import { whisper } from './wait.js';
// Namespace import on purpose: P03 owns reveal.js and is editing it in parallel;
// a named import of something not yet exported would blank the whole screen.
import * as REVEAL from './reveal.js';
import { css } from './_css.js';

let chip, panel, stage;
let lastSig = '';
let lastHeirId = null;
let lastBand = -1;
const edictTold = new Set();
let deathBusy = false;

export function initSuccessionUI() {
  injectCss();
  buildChip();
  on('clock:day', () => { tickSuccession(S.day); refreshChip(); });
  on('sim:month', () => refreshChip());
  on('player:changed', () => { lastHeirId = null; refreshChip(true); });
  on('title:granted', () => refreshChip(true));
  on('char:born', () => refreshChip(true));
  on('char:died', () => refreshChip(true));
  on('succession:law', (e) => {
    refreshChip(true);
    if (e.state === 'active') whisper(`Veraset kanunu değişti: ${LAWS[e.law].name}.`, 'ambiguous');
  });
  on('player:died', (p) => stageDeath(p));
  on('dynasty:extinct', (info) => stageEnd(info));
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input,textarea')) return;
    if (e.key === 'v' || e.key === 'V') { e.preventDefault(); togglePanel(); }
    if (e.key === 'Escape' && panel && !panel.classList.contains('hidden')) closePanel();
  });
  refreshChip(true);
}

// ============================================================ the chip

function buildChip() {
  chip = document.createElement('aside');
  chip.id = 'p08chip';
  chip.title = 'Veraset — kimin sırada olduğunu bilmek zorundasın (V)';
  chip.onclick = () => { resumeAudio(); SFX.page(); togglePanel(); };
  document.body.appendChild(chip);
}

function traitChips(c, max = 3) {
  return (c.traits || []).slice(0, max).map((t) =>
    `<span class="p08t${badTrait(t) ? ' bad' : ''}">${TRAITS[t]?.icon || ''} ${esc(TRAITS[t]?.name || t)}</span>`).join('');
}
function badTrait(t) {
  return ['craven', 'slow', 'frail', 'kinslayer', 'oathbreaker', 'excommunicated', 'ill', 'pox', 'wounded', 'humbled', 'arbitrary', 'arrogant', 'deceitful', 'wrathful', 'greedy', 'paranoid'].includes(t);
}
function years(days) {
  const y = Math.floor(days / YEAR), m = Math.round((days % YEAR) / 30);
  if (y <= 0) return `${Math.max(1, m)} ay`;
  return m > 0 ? `${y} yıl ${m} ay` : `${y} yıl`;
}

let lastComputeDay = -999;
/**
 * The heir list is only frightening if you know the clock is running. This
 * turns the player's own mortality roll into a sentence about their body.
 */
function bodyBand(p) {
  const m = mortalityChance(p);
  if (m < 0.020) return 0;
  if (m < 0.055) return 1;
  if (m < 0.120) return 2;
  return 3;
}
const BODY = [
  null,
  (a) => a >= 45 ? `${a} yaşındasın. Kışlar uzun geliyor.` : `${a} yaşındasın ve bir öksürük yakanı bırakmıyor.`,
  (a) => a >= 45 ? `${a} yaşındasın. Hekim odandan çıkmıyor.` : `Hekim odandan çıkmıyor. Yaşın genç, bedenin değil.`,
  (a) => a >= 55 ? `${a} yaşındasın. Bu kışı çıkarman şüpheli.` : `Bu kışı çıkarman şüpheli. Sarayda herkes varisini konuşuyor.`,
];

export function refreshChip(force = false) {
  if (!chip || !S.playerId) return;
  if (!force && S.day - lastComputeDay < 5) return;
  lastComputeDay = S.day;
  const p = ch(S.playerId);
  if (!p) return;
  const prev = successionPreview(p.id);
  const pend = pendingLaw();
  const h = prev?.heir || null;
  const band = bodyBand(p);
  const sig = [currentLaw(), h?.id, h && age(h), prev?.fragments, prev?.heirs.length, band,
    pend ? pend.law + Math.floor((pend.doneDay - S.day) / 30) : '', deathBusy].join('|');
  if (!force && sig === lastSig) return;
  lastSig = sig;

  if (h && lastHeirId && h.id !== lastHeirId && !deathBusy) {
    whisper(`Varisin artık ${fullName(h)} — ${age(h)} yaşında.`, 'ambiguous');
  }
  if (h) lastHeirId = h.id;
  if (band > lastBand && lastBand >= 0 && !deathBusy && BODY[band]) {
    whisper(BODY[band](age(p)), 'bad');
  }
  lastBand = band;

  if (pend) edictTells(p, pend);

  const L = lawInfo();
  chip.innerHTML = `
    <div class="p08k"><span class="dot"></span>VERASET · ${esc(L.name)}</div>
    ${BODY[band] ? `<div class="p08body b${band}">${esc(BODY[band](age(p)))}</div>` : ''}
    ${h ? `
      <div class="p08who">
        <div class="p08face"><canvas width="110" height="110"></canvas></div>
        <div class="p08nm">
          <b>${esc(fullName(h))}</b>
          <span>${age(h)} yaşında · ${esc(relation(p.id, h.id))}${
            age(h) >= 12 ? ` · sana ${opinionLabel(opinion(h.id, p.id))}` : ''}</span>
          <div class="p08tr">${traitChips(h)}</div>
        </div>
      </div>` : `<div class="p08none">Sıradaki kimse yok.</div>`}
    <div class="p08line">${esc(successionLine(p.id))}</div>
    ${pend ? `<div class="p08pend">
        <span>${esc(LAWS[pend.law].name)} fermanı yolda</span>
        <b>${years(Math.max(0, pend.doneDay - S.day))}</b>
        <i style="width:${Math.round(100 * Math.min(1, (S.day - pend.sealedDay) / Math.max(1, pend.doneDay - pend.sealedDay)))}%"></i>
      </div>` : ''}`;
  if (h) {
    h._ageCache = age(h); h._rank = primaryTitle(h)?.tier ?? 0;
    renderPortrait(h, chip.querySelector('.p08face canvas'));
  }
}

/**
 * An eight-year wait must not be a silent progress bar. These arrive on their
 * own schedule and tell you nothing certain — only that people are talking.
 */
const EDICT_TELLS = [
  [0.22, (p, q) => `Ferman sandıkta. ${q.losers[0] ? q.losers[0].name + ' onu duyduğunu saklamıyor.' : 'Sarayda fısıltı var.'}`],
  [0.55, () => 'Kadılar fermanı bir kez daha okudu. Bir vassalın divandan erken çıktı.'],
  [0.86, (p, q) => `Mühür yaklaşıyor. ${q.losers[0] ? q.losers[0].name + ' artık seninle göz göze gelmiyor.' : 'Kimse kanunu konuşmuyor, herkes kanunu düşünüyor.'}`],
];
function edictTells(p, pend) {
  const span = Math.max(1, pend.doneDay - pend.sealedDay);
  const prog = (S.day - pend.sealedDay) / span;
  for (let i = 0; i < EDICT_TELLS.length; i++) {
    const key = `${pend.sealedDay}:${i}`;
    if (prog < EDICT_TELLS[i][0] || edictTold.has(key)) continue;
    edictTold.add(key);
    const q = lawQuote(pend.law) || { losers: [] };
    whisper(EDICT_TELLS[i][1](p, q), 'ambiguous');
  }
}

// ============================================================ the ledger

function togglePanel() {
  if (panel && !panel.classList.contains('hidden')) return closePanel();
  openPanel();
}
function closePanel() { panel?.classList.add('hidden'); }

function openPanel() {
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'p08panel';
    document.body.appendChild(panel);
  }
  panel.classList.remove('hidden');
  drawPanel();
}

let openLaw = null;
let openStrike = null;

function drawPanel() {
  const p = ch(S.playerId);
  if (!p || !panel) return;
  const prev = successionPreview(p.id);
  const L = lawInfo();
  const pend = pendingLaw();
  const heirsAll = prev.heirs;
  const heirs = heirsAll.slice(0, 6);
  const tally = prev.law === 'elective' ? electiveTally(p.id) : null;
  const heirIds = new Set(heirsAll.map((h) => h.id));
  const dis = disinheritedOf(p.id).filter((d) => !heirIds.has(d.id) || isDisinherited(d.id)).slice(0, 6);
  const claims = claimantsOn(p.id);

  panel.innerHTML = `
    <div class="p08sheet">
      <div class="p08head">
        <div>
          <div class="p08kick">${fmtDate(S.day)} · ${generation()}. kuşak · ${years(S.day - reignStart())}dır tahttasın</div>
          <h2>Veraset</h2>
          <div class="p08sub">${esc(L.name)} — ${esc(L.line)}</div>
        </div>
        <button class="p08x">×</button>
      </div>

      <div class="p08warn">${esc(successionLine(p.id))}</div>

      <div class="p08sec">Kanun</div>
      ${pend ? `<div class="p08sealed">
          <b>${esc(LAWS[pend.law].name)}</b> fermanı ${fmtDate(pend.sealedDay)} günü mühürlendi.
          Yürürlüğe girmesine <b>${years(Math.max(0, pend.doneDay - S.day))}</b> var.
          Ödediğin ${pend.prestige} itibar geri gelmez; o güne yetişemezsen mühür seninle gömülür.
        </div>` : `<div class="p08laws">${LAW_ORDER.map(lawCard).join('')}</div>`}
      ${openLaw && !pend ? lawConfirm(openLaw) : ''}

      <div class="p08sec">Sıradakiler</div>
      <div class="p08rows">
        ${heirs.length ? heirs.map((h, i) => heirRow(h, i, prev, tally)).join('')
          : '<div class="p08empty">Kimse yok. Bugün ölsen hanedanın da ölür.</div>'}
      </div>

      ${dis.length ? `<div class="p08sec">Payı olmayanlar</div>
        <div class="p08rows">${dis.map((d) => `
          <div class="p08row muted">
            <div class="p08rn"><b class="${isDisinherited(d.id) ? 'struck' : ''}">${esc(fullName(d))}</b><span>${age(d)} · ${esc(relation(p.id, d.id))}</span></div>
            <div class="p08rs">${isDisinherited(d.id)
              ? `<em>${fmtDate(struckDay(d.id))} günü mirastan çıkardın</em>`
              : 'hiçbir şey — <em>ve bunu bilecek</em>'}</div>
          </div>`).join('')}</div>` : ''}

      ${claims.length ? `<div class="p08sec">Toprağında hak iddia edenler</div>
        <div class="p08rows">${claims.slice(0, 6).map((c) => `
          <div class="p08row claim">
            <div class="p08rn"><b>${esc(c.name)}</b><span>${c.age} yaşında</span></div>
            <div class="p08rs">${esc(c.titleName)} üzerinde hak — ${fmtDate(c.day)}</div>
          </div>`).join('')}</div>` : ''}

    </div>`;

  panel.querySelector('.p08x').onclick = () => { SFX.click(); closePanel(); };
  for (const c of panel.querySelectorAll('.p08face canvas')) {
    const id = c.parentElement.dataset.char;
    const x = ch(id);
    if (x) { x._ageCache = age(x); x._rank = primaryTitle(x)?.tier ?? 0; renderPortrait(x, c); }
  }
  for (const b of panel.querySelectorAll('[data-law]')) {
    b.onclick = () => { SFX.click(); openLaw = openLaw === b.dataset.law ? null : b.dataset.law; drawPanel(); };
  }
  for (const b of panel.querySelectorAll('[data-strike]')) {
    b.onclick = (e) => { e.stopPropagation(); SFX.click(); openStrike = openStrike === b.dataset.strike ? null : b.dataset.strike; drawPanel(); };
  }
  const st = panel.querySelector('.p08dostrike');
  if (st) st.onclick = () => {
    const t = ch(st.dataset.do);
    if (disinherit(st.dataset.do)) {
      SFX.commit();
      whisper(`${fullName(t)}'i mirastan çıkardın. Bir daha geri alamazsın.`, 'bad');
      openStrike = null;
      refreshChip(true);
    }
    drawPanel();
  };
  const seal = panel.querySelector('.p08seal');
  if (seal) seal.onclick = () => {
    const done = proposeLaw(openLaw);
    if (done) {
      SFX.commit();
      whisper(`${LAWS[openLaw].name} fermanını mühürledin. ${LAWS[openLaw].years} yıl sonra.`, 'ambiguous');
      openLaw = null;
      refreshChip(true);
    }
    drawPanel();
  };
}

function heirRow(h, i, prev, tally) {
  const p = ch(S.playerId);
  const q = disinheritQuote(h.id);
  const share = prev.shares.find((s) => s.id === h.id);
  const o = opinion(h.id, p.id);
  const vote = tally?.find((t) => t.id === h.id);
  const sk = skills(h);
  const gets = share
    ? share.titleIds.map((t) => esc(titleName(ti(t)))).join(', ')
    : i === 0 ? 'tahtı'
    : prev.law === 'partition' && prev.counties < 2 ? 'pay yok — bölünecek toprak yok'
    : prev.law === 'elective' ? 'oy yetmiyor'
    : 'hiçbir şey';
  return `
    <div class="p08row${i === 0 ? ' first' : ''}">
      <div class="p08face" data-char="${h.id}"><canvas width="90" height="90"></canvas></div>
      <div class="p08rn">
        <b>${i === 0 ? '★ ' : `${i + 1}. `}${esc(fullName(h))}</b>
        <span>${age(h)} yaşında · ${esc(relation(p.id, h.id))} · ${esc(styleOf(h))}</span>
        <div class="p08tr">${traitChips(h, 4)}</div>
      </div>
      <div class="p08rs">
        <div class="gets">${gets}</div>
        <div class="mini">${['diplomacy', 'martial', 'stewardship', 'intrigue', 'learning'].map((k) => `<i title="${SKILL_LABEL[k]}">${sk[k]}</i>`).join('')}</div>
        ${vote ? `<div class="vote${vote.votes ? '' : ' zero'}">${vote.votes} oy${vote.voters.length ? ` · ${vote.voters.slice(0, 3).map((v) => esc(ch(v)?.name || '')).join(', ')}` : ''}</div>` : ''}
        <div class="op" style="color:${o < -20 ? '#d08a7a' : o > 20 ? '#9dc07e' : '#a8987a'}">sana ${o > 0 ? '+' : ''}${o} · ${opinionLabel(o)}</div>
        ${q?.eligible ? `<button class="p08strike" data-strike="${h.id}">mirastan çıkar</button>` : ''}
      </div>
      ${openStrike === h.id && q?.eligible ? strikeConfirm(q) : ''}
    </div>`;
}

function strikeConfirm(q) {
  const p = ch(S.playerId);
  const can = Math.floor(p.prestige) >= q.prestige;
  return `
    <div class="p08sconf">
      <div class="cwarn">${esc(q.name)}, ${q.age} yaşında. Adını kendi elinle sileceksin.
        Bir daha geri alınmaz; listede kalır ve o listeyi o da görür.</div>
      <div class="crow"><span>Şimdi ödersin</span><b class="${can ? '' : 'no'}">${q.prestige} itibar</b></div>
      <div class="crow"><span>O günden sonra</span><b class="no">ömür boyu kin · toprağına iddia</b></div>
      ${q.witnesses.length ? `<div class="crow tall"><span>Bunu görecekler</span><b class="no">${q.witnesses.map((w) => `${esc(w.name)} (${w.age})`).join(', ')}</b></div>` : ''}
      <button class="p08dostrike" data-do="${q.targetId}" ${can ? '' : 'disabled'}>${can ? 'adını sil' : `${q.prestige - Math.floor(p.prestige)} itibar eksik`}</button>
    </div>`;
}

function lawCard(id) {
  const L = LAWS[id];
  const cur = id === currentLaw();
  const q = cur ? null : lawQuote(id);
  return `
    <div class="p08law${cur ? ' on' : ''}${openLaw === id ? ' sel' : ''}" ${cur ? '' : `data-law="${id}"`}>
      <div class="ln">${esc(L.name)}</div>
      <div class="lk">${esc(L.kicker)}</div>
      <div class="ld">${esc(L.line)}</div>
      ${cur ? `<div class="lc now">yürürlükte</div>`
        : `<div class="lc${q && !q.affordable ? ' cant' : ''}">${q ? q.prestige : '—'} itibar · ${L.years} yıl</div>`}
    </div>`;
}

function lawConfirm(id) {
  const q = lawQuote(id);
  const L = LAWS[id];
  if (!q) return '';
  return `
    <div class="p08confirm">
      <div class="cwarn">${esc(L.pain)}</div>
      <div class="crow"><span>Şimdi ödersin</span><b class="${q.affordable ? '' : 'no'}">${q.prestige} itibar</b></div>
      <div class="crow"><span>Yürürlüğe girer</span><b>${q.years} yıl sonra — ${fmtDate(S.day + q.days)}</b></div>
      ${q.losers.length ? `<div class="crow tall"><span>Payını sildiğin</span><b class="no">${q.losers.map((l) => `${esc(l.name)} (${l.age})`).join(', ')}</b></div>` : ''}
      ${q.gainers.length ? `<div class="crow tall"><span>Pay verdiğin</span><b class="yes">${q.gainers.map((l) => `${esc(l.name)} (${l.age})`).join(', ')}</b></div>` : ''}
      ${q.vassalMood < 0 ? `<div class="crow"><span>Vassalların</span><b class="no">bunu kendi zararına görecek</b></div>` : ''}
      ${q.vassalMood > 0 ? `<div class="crow"><span>Vassalların</span><b class="yes">söz hakkı kazanacak</b></div>` : ''}
      <div class="cfoot">Ferman bugün mühürlenir, ${q.years} yıl sonra açılır. O gün tahtta olmayabilirsin — itibar yine de gider.</div>
      <button class="p08seal" ${q.affordable ? '' : 'disabled'}>${q.affordable ? 'fermanı mühürle' : `${q.prestige - Math.floor(ch(S.playerId).prestige)} itibar eksik`}</button>
    </div>`;
}

// ============================================================ the death

let holdTimer = null;
function holdWorld(on) {
  if (holdTimer) { clearInterval(holdTimer); holdTimer = null; }
  // The shell binds Space to unpause; a player who taps it mid-eulogy should not
  // find three years gone behind the overlay.
  if (on) holdTimer = setInterval(() => { if (!S.paused) pause('death'); }, 200);
}

function stageDeath({ deadId, heirId }) {
  if (deathBusy) return;
  deathBusy = true;
  pause('death');
  holdWorld(true);
  closePanel();
  shimMain(true);
  // The world tick is still handing out titles in the loop above us; let it
  // finish before we read the board.
  setTimeout(() => runDeath(deadId, heirId), 0);
}

function ensureStage() {
  if (!stage) {
    stage = document.createElement('div');
    stage.id = 'p08death';
    document.body.appendChild(stage);
  }
  stage.classList.remove('hidden');
  document.body.classList.add('staged');
  return stage;
}

let actKey = null;
function dropActKey() { if (actKey) { removeEventListener('keydown', actKey); actKey = null; } }

function act(html, onNext, opts = {}) {
  const r = ensureStage();
  dropActKey();
  r.innerHTML = `<div class="p08act${opts.tight ? ' tight' : ''}">${html}</div>`;
  const el = r.querySelector('.p08act');
  if (onNext) {
    const b = document.createElement('button');
    b.className = 'p08next';
    b.textContent = opts.label || 'devam';
    b.style.opacity = '0';
    el.appendChild(b);
    let used = false;
    b.onclick = () => { if (used) return; used = true; dropActKey(); SFX.page(); onNext(); };
    setTimeout(() => { b.style.opacity = '1'; }, opts.wait ?? 1400);
    setTimeout(() => {
      if (used) return;
      actKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); b.click(); } };
      addEventListener('keydown', actKey);
    }, (opts.wait ?? 1400) + 200);
  }
  return el;
}

function portraitBlock(c, mod = '') {
  return `<div class="p08big${mod ? ' ' + mod : ''}" data-char="${c.id}"><canvas width="240" height="240"></canvas></div>`;
}
function paintPortraits(root) {
  for (const d of root.querySelectorAll('[data-char]')) {
    const c = ch(d.dataset.char);
    const cv = d.querySelector('canvas');
    if (c && cv) { c._ageCache = age(c); c._rank = primaryTitle(c)?.tier ?? 0; renderPortrait(c, cv); }
  }
}

function runDeath(deadId, heirId) {
  const dead = ch(deadId);
  const last = lastSuccession() || {};
  const reign = Math.max(0, Math.round(((last.reignTo ?? S.day) - (last.reignFrom ?? 0)) / YEAR));
  const where = last.seatName || 'kendi yatağın';
  heart(0);

  const effects = [
    reign > 0 ? `<b>${reign} yıl</b> tahtta kaldın.` : 'Tahtta bir yıl bile duramadın.',
    last.kidsLeft ? `Geriye <b>${last.kidsLeft}</b> çocuk ve <b>${last.dynastyLeft}</b> kişilik bir hanedan kaldı.`
      : `Geriye <b>${last.dynastyLeft || 0}</b> kişilik bir hanedan kaldı; senden bir evlat kalmadı.`,
    last.doomedLaw ? `Mühürlediğin <b>${esc(LAWS[last.doomedLaw.law].name)}</b> fermanı açılmadan kaldı.` : '',
  ].filter(Boolean);

  // P03 owns the game's death language (silence → breath → one word → the
  // sentence → the cost, line by line, with the face going grey). Use it for
  // the heaviest beat instead of inventing a second one; fall back to our own
  // staging if that export is not there.
  const spec = {
    weight: 1, irreversible: true, targetId: deadId,
    title: 'Öldün.',
    outcome: {
      success: false, knell: true, beat: 'bir ömür bitti', title: 'Öldün.',
      // P03 prints paragraphs with textContent — pass raw text, not escaped.
      text: `${fullName(dead)} · ${age(dead)} yaşında · ${last.style || styleOf(dead)}\n\n`
        + `Son nefesini ${where}'de verdin. Kimse odaya girmiyor; dışarıda birileri çoktan konuşuyor.`,
      effects,
    },
  };
  let p = null;
  try { if (typeof REVEAL.stageMoment === 'function') p = REVEAL.stageMoment(spec); } catch (e) { p = null; }
  if (p && typeof p.then === 'function') { p.then(() => act2()).catch(() => act2()); return; }
  act1Local(dead, last, reign, where);
}

/** Fallback for the first beat if P03's staging is unavailable. */
function act1Local(dead, last, reign, where) {
  SFX.knell();
  const el = act(`
    <div class="p08kick">${fmtDate(S.day)} · ${esc(causeLabel(dead.deathCause || 'natural'))}</div>
    ${portraitBlock(dead)}
    <h1>Öldün.</h1>
    <div class="p08name">${esc(fullName(dead))} · ${age(dead)} yaşında · ${esc(last.style || styleOf(dead))}</div>
    <p>${reign > 0 ? `${reign} yıl tahtta kaldın.` : 'Tahtta bir yıl bile duramadın.'} Son nefesini ${esc(where)}'de verdin.</p>
    <p class="dim">Kimse odaya girmiyor. Dışarıda birileri çoktan konuşuyor.</p>
  `, () => act2(), { label: 'geriye ne kaldı', wait: 2600 });
  paintPortraits(el);
}

function act2() {
  const last = lastSuccession() || {};
  const dead = ch(last.deadId);
  const seed = last.seed || {};
  const st = S.stats || {};
  const s0 = seed.stats || {};
  const d = (k) => Math.max(0, (st[k] || 0) - (s0[k] || 0));
  const lands = (last.heldTitleIds || []).length;
  const dLand = lands - (seed.titles || 0);

  // The ledger is a global one; other rulers write in it too. A eulogy that
  // lists a Byzantine's land grab is not a eulogy.
  const all = S.memories || [];
  const mine = all.filter((m) => (m.decisionId || m.kind === 'law' || m.kind === 'succession' ||
    m.targetId === last.deadId) && m.day >= (last.reignFrom ?? 0));
  const mems = (mine.length ? mine : []).slice(-3).reverse();

  const from = fmtDate(last.reignFrom ?? 0), to = fmtDate(last.reignTo ?? S.day);
  const el = act(`
    <div class="p08kick">${esc(from)} — ${esc(to)}</div>
    <h1 class="small">${esc(fullName(dead))}'in defteri</h1>
    <div class="p08grid">
      <div><b>${d('decisionsMade')}</b><span>verdiğin karar</span></div>
      <div><b class="${d('irreversible') ? 'no' : ''}">${d('irreversible')}</b><span>geri dönüşü olmayan</span></div>
      <div><b class="${dLand < 0 ? 'no' : dLand > 0 ? 'yes' : ''}">${lands}</b><span>${
        dLand === 0 ? 'unvan — devraldığın kadar' : dLand > 0 ? `unvan · ${dLand} tanesi senin` : `unvan · ${-dLand} tanesini kaybettin`}</span></div>
      <div><b>${last.dynastyLeft ?? '—'}</b><span>ardında kalan hanedan</span></div>
    </div>
    ${mems.length ? `<div class="p08mem">${mems.map((m) => `
        <div><i>${fmtDate(m.day)}</i>${esc(m.text)}</div>`).join('')}</div>`
      : `<p class="dim">Vakayiname senin adına tek satır yazmadı. Adından başka bir şey bırakmadın.</p>`}
    ${d('kin_lost') ? `<p class="bad">Kendi kanından ${d('kin_lost')} kişi senin yüzünden gitti.</p>` : ''}
    ${d('oaths_broken') ? `<p class="bad">${d('oaths_broken')} yeminini bozdun. Onlar hatırlıyor.</p>` : ''}
    ${last.kidsLeft ? `<p class="dim">${last.kidsLeft} çocuğun sağ. Biri tahtı alacak, diğerleri seyredecek.</p>` : ''}
  `, () => act3(), { label: 'kim geliyor', wait: 1800 });
  paintPortraits(el);
}

function act3() {
  const last = lastSuccession() || {};
  const dead = ch(last.deadId), heir = ch(last.heirId);
  const hv = handoverPreview(last.deadId, last.heirId, false);
  const worst = hv.vassals.slice().sort((a, b) => a.delta - b.delta).slice(0, 3);
  const bows = hv.liege ? [hv.liege, ...worst] : worst;
  const tr = (heir.traits || []).slice(0, 3).map((t) => TRAITS[t]?.name || t);
  const dropped = hv.skills.filter((s) => s.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2);
  const risen = hv.skills.filter((s) => s.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 2);

  const el = act(`
    <div class="p08kick">şimdi sen busun</div>
    ${portraitBlock(heir, 'small')}
    <h1 class="small">${esc(fullName(heir))}</h1>
    <div class="p08name">${age(heir)} yaşında${tr.length ? ` · ${esc(tr.join(', '))}` : ''}</div>
    <p>${heirSentence(heir, dead)}</p>
    <div class="p08cost">
      <div class="ch">Devrin bedeli</div>
      ${bows.length ? bows.map((v, i) => `
        <div class="cl"><span>${i === 0 && hv.liege ? 'Efendin ' : ''}${esc(v.name)} (${v.age})</span>
          <b>${v.before > 0 ? '+' : ''}${v.before} → <em class="${v.delta < 0 ? 'no' : 'yes'}">${v.after > 0 ? '+' : ''}${v.after}</em></b>
          <i>${esc(v.why)}</i></div>`).join('')
        : `<div class="cl none">Sana diz çöken kimse yok. Kaybedecek sadakatin de yok.</div>`}
      ${last.doomedLaw ? `<div class="cl"><span>${esc(LAWS[last.doomedLaw.law].name)} fermanı</span>
          <b class="no">mühürde kaldı</b>
          <i>Baban ${last.doomedLaw.prestige} itibar ödedi, ${years(last.doomedLaw.left)} kalmıştı. Kanun onunla gömüldü.</i></div>` : ''}
      ${hv.allies.length ? `<div class="cl"><span>Babanın dostları</span><b class="no">bitti</b>
          <i>${hv.allies.slice(0, 3).map((a) => esc(a.name)).join(', ')} — ${hv.allies.length > 1 ? 'hepsi babana' : 'babana'} borçluydu, sana değil.</i></div>` : ''}
      ${hv.feuds.length ? `<div class="cl"><span>Babanın düşmanları</span><b class="no">sende</b>
          <i>${hv.feuds.slice(0, 3).map((f) => `${esc(f.name)} (${f.age})`).join(', ')} hesabı senden soracak.</i></div>` : ''}
      ${last.disinherited?.length ? `<div class="cl"><span>Mirastan çıkanlar</span><b class="no">hak iddia ediyor</b>
          <i>${last.disinherited.slice(0, 3).map((d) => `${esc(fullName(ch(d)))} (${age(ch(d))})`).join(', ')} toprağın üstünde iddia sahibi.</i></div>` : ''}
      ${last.fragments > 1 ? `<div class="cl"><span>Ülke</span><b class="no">${last.fragments} parça</b>
          <i>Babanın kurduğu şey bugün bölündü.</i></div>` : ''}
      <div class="cl tightrow"><span>Kasa ve itibar — gerisini cenaze aldı</span>
        <b>${hv.gold.inherited} altın · ${hv.prestige.inherited} itibar</b></div>
      ${dropped.length ? `<div class="cl tightrow"><span>Onun elinden geldiği kadar gelmiyor</span><b class="no">${dropped.map((d) => `${d.label} ${d.delta}`).join(', ')}</b></div>` : ''}
      ${risen.length ? `<div class="cl tightrow"><span>Ondan iyi olduğun yer</span><b class="yes">${risen.map((d) => `${d.label} +${d.delta}`).join(', ')}</b></div>` : ''}
    </div>
  `, () => finish(), { label: 'devral', wait: 2000, tight: true });
  paintPortraits(el);
}

function heirSentence(heir, dead) {
  const a = age(heir);
  const bits = [];
  if (a < 12) bits.push('Bir çocuk. Divanda ayakları yere değmiyor.');
  else if (a < 16) bits.push('Henüz reşit değil; senin adına başkaları konuşacak.');
  else if (a > 55) bits.push('Yaşlı bir adam. Bu taht ona uzun süre kalmayacak.');
  if ((heir.traits || []).includes('craven')) bits.push('Korkak olduğunu herkes biliyor.');
  if ((heir.traits || []).includes('slow')) bits.push('Ağır anlıyor ve bunu saklayamıyor.');
  if ((heir.traits || []).includes('ambitious')) bits.push('Bu günü bekliyordu.');
  if (!bits.length) bits.push('Senin verdiğin kararların faturasını o ödeyecek.');
  return esc(bits.join(' '));
}

function finish() {
  const last = lastSuccession() || {};
  const heir = ch(last.heirId);
  const c = assumeHeir() || heir;
  refreshChip(true);
  const el = act(`
    <div class="p08kick">${fmtDate(S.day)}</div>
    <h1 class="small quiet">Artık ${esc(fullName(c))}'sin.</h1>
    <div class="p08name">${esc(styleOf(c))} · ${generation()}. kuşak</div>
  `, null);
  paintPortraits(el);
  setTimeout(() => {
    stage.classList.add('gone');
    setTimeout(() => {
      stage.classList.add('hidden');
      stage.classList.remove('gone');
      stage.innerHTML = '';
      document.body.classList.remove('staged');
      deathBusy = false;
      holdWorld(false);
      shimMain(false);
      refreshChip(true);
      if (!S.decisions.some((d) => d.state === 'open')) resume();
    }, 900);
  }, 2300);
}

// ============================================================ the end of a house

function stageEnd(info) {
  deathBusy = true;
  pause('death');
  closePanel();
  shimMain(true);
  setTimeout(() => {
    SFX.knell();
    heart(0);
    const reigns = (info.reigns || []).slice(-5);
    const el = act(`
      <div class="p08kick">${fmtDate(info.day)}</div>
      ${portraitBlock(ch(info.deadId))}
      <h1 class="bad">${info.reason === 'elected-away' ? 'Taç elinden çıktı.' : 'Hanedanın bitti.'}</h1>
      <div class="p08name">${esc(info.name)} · ${info.age} yaşında</div>
      <p>${info.reason === 'elected-away'
        ? `Vassalların oy verdi ve tahtı ${esc(info.usurperName || 'bir yabancıya')} verdi. ${esc(info.dynasty)} adı artık bir hanedan adı değil.`
        : `Ardında kimse kalmadı. ${esc(info.dynasty)} adını taşıyan son kişi sendin.`}</p>
      ${reigns.length ? `<div class="p08mem">${reigns.map((r) => `
        <div><i>${r.years} yıl</i>${esc(r.name)} — ${r.deathAge} yaşında ${esc(causeLabel(r.cause))}</div>`).join('')}
        <div><i>${info.reignYears} yıl</i>${esc(info.name)} — son</div></div>` : ''}
      <p class="dim">${info.generation > 1 ? `${info.generation} kuşak buraya kadar geldi.` : 'Tek kuşak. Bir isim, bir mezar.'}</p>
      <p class="dim">Oyun burada biter. Yeniden başlamak için sayfayı tazele.</p>
    `, null);
    paintPortraits(el);
    setTimeout(() => shimMain(false), 1500);
  }, 0);
}

// ============================================================ temporary shim
// main.js still owns a one-paragraph death notice (wireDeath/showDeath). Until
// the coordinator removes it — see docs/REQUESTS.md — pull it off the screen the
// moment it appears. It is identified by its own button label, which no other
// overlay in the game uses.
let shimTimer = null;
function shimMain(active) {
  if (shimTimer) { clearInterval(shimTimer); shimTimer = null; }
  const sweep = () => {
    const r = document.getElementById('revealRoot');
    if (!r) return;
    for (const b of r.querySelectorAll('.reveal button.ok')) {
      if (b.textContent.trim() === 'devral') {
        b.closest('.reveal').remove();
        r.classList.remove('breathing');
      }
    }
  };
  sweep();
  if (active) shimTimer = setInterval(sweep, 150);
  else { let n = 0; shimTimer = setInterval(() => { sweep(); if (++n > 24) { clearInterval(shimTimer); shimTimer = null; } }, 150); }
}

// ============================================================ style

function injectCss() { css('p08-succ', STYLE); }

const STYLE = `
#p08chip{position:fixed;left:56px;top:88px;z-index:22;width:306px;cursor:pointer;
  background:linear-gradient(160deg,rgba(28,20,13,.96),rgba(16,12,8,.96));
  border:1px solid rgba(201,163,78,.32);border-left:3px solid #7a1f1a;
  box-shadow:0 18px 60px rgba(0,0,0,.6);padding:9px 11px 10px;transition:border-color .2s,transform .2s}
#p08chip:hover{border-color:rgba(201,163,78,.6);transform:translateX(2px)}
body.staged #p08chip{opacity:.10;pointer-events:none;transition:opacity .6s}
#p08chip .p08k{font-size:9.5px;letter-spacing:2.2px;text-transform:uppercase;color:#8a7a58;margin-bottom:7px;display:flex;align-items:center;gap:6px}
#p08chip .dot{width:5px;height:5px;border-radius:50%;background:#a83028;box-shadow:0 0 8px rgba(168,48,40,.9);animation:p08pulse 2.8s ease-in-out infinite}
@keyframes p08pulse{0%,100%{opacity:.45}50%{opacity:1}}
.p08who{display:flex;gap:9px;align-items:flex-start}
.p08face{width:46px;height:46px;flex:0 0 46px;border:1px solid rgba(201,163,78,.3);overflow:hidden;background:#1a140e}
.p08face canvas{width:100%;height:100%;display:block}
.p08nm{min-width:0;flex:1}
.p08nm b{display:block;font-size:14px;color:#e8c877;font-weight:500;letter-spacing:.2px;line-height:1.25}
.p08nm span{display:block;font-size:11px;color:#a8987a;margin-top:1px}
.p08tr{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px}
.p08t{font-size:9.5px;padding:1px 5px;border:1px solid rgba(201,163,78,.22);color:#cbbd97;background:rgba(0,0,0,.3);white-space:nowrap}
.p08t.bad{border-color:rgba(168,48,40,.45);color:#dfae9f}
#p08chip .p08body{font-size:11.5px;line-height:1.45;margin:-2px 0 8px;padding:4px 8px;
  background:rgba(122,31,26,.16);border-left:2px solid rgba(168,48,40,.5);color:#dfae9f;letter-spacing:.2px}
#p08chip .p08body.b3{background:rgba(122,31,26,.34);border-left-color:#a83028;color:#f0c0b0}
#p08chip .p08line{margin-top:8px;font-size:11.5px;line-height:1.5;color:#cfc2a6;font-style:italic;
  border-top:1px solid rgba(201,163,78,.14);padding-top:7px}
#p08chip .p08none{font-size:13px;color:#d08a7a}
#p08chip .p08pend{margin-top:7px;position:relative;font-size:10.5px;color:#a8987a;display:flex;justify-content:space-between;
  padding-bottom:6px}
#p08chip .p08pend b{color:#c9a34e;font-weight:500}
#p08chip .p08pend i{position:absolute;left:0;bottom:0;height:2px;background:linear-gradient(90deg,#7a5a2a,#c9a34e)}

/* ---------- ledger ---------- */
#p08panel{position:fixed;inset:0;z-index:64;display:flex;align-items:center;justify-content:center;
  background:rgba(5,4,3,.84)}
#p08panel.hidden{display:none}
.p08sheet{width:min(940px,94vw);max-height:88vh;overflow-y:auto;background:linear-gradient(170deg,rgba(30,23,16,.99),rgba(18,13,9,.99));
  border:1px solid rgba(201,163,78,.34);box-shadow:0 30px 90px rgba(0,0,0,.8);padding:20px 24px 26px}
.p08head{display:flex;align-items:flex-start;gap:12px;border-bottom:1px solid rgba(201,163,78,.16);padding-bottom:12px}
.p08head h2{margin:2px 0 3px;font-size:26px;font-weight:400;color:#e8c877;letter-spacing:1px}
.p08kick{font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#8a7a58}
.p08sub{font-size:13px;color:#a8987a}
.p08x{margin-left:auto;background:none;border:none;color:#a8987a;font-size:24px;cursor:pointer;line-height:1}
.p08x:hover{color:#e8c877}
.p08warn{margin:14px 0 4px;padding:10px 14px;border-left:3px solid #7a1f1a;background:rgba(122,31,26,.13);
  font-size:14.5px;color:#e8dcc6;line-height:1.6}
.p08sec{margin:20px 0 8px;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#8a7a58;
  border-bottom:1px solid rgba(201,163,78,.12);padding-bottom:5px}
.p08rows{display:flex;flex-direction:column;gap:1px}
.p08row{display:flex;gap:11px;align-items:flex-start;padding:9px 10px;background:rgba(0,0,0,.22)}
.p08row.first{background:rgba(201,163,78,.09);border-left:2px solid #c9a34e}
.p08row.muted{opacity:.82;border-left:2px solid rgba(168,48,40,.5)}
.p08row.claim{border-left:2px solid #a83028}
.p08row .p08face{width:38px;height:38px;flex:0 0 38px}
.p08rn{flex:1;min-width:0}
.p08rn b{display:block;font-size:14px;color:#e8dcc6;font-weight:500}
.p08rn span{font-size:11px;color:#a8987a}
.p08rs{text-align:right;font-size:11.5px;color:#a8987a;min-width:190px}
.p08rs .gets{color:#cfc2a6;font-size:12.5px}
.p08rs em{font-style:italic;color:#d08a7a}
.p08rs .mini{margin-top:3px;display:flex;gap:4px;justify-content:flex-end}
.p08rs .mini i{font-style:normal;font-size:10.5px;color:#8a7a58;background:rgba(0,0,0,.4);padding:1px 5px;
  border:1px solid rgba(201,163,78,.14);font-variant-numeric:tabular-nums}
.p08rs .vote{margin-top:3px;color:#c9a34e}
.p08rs .vote.zero{color:#7a6a52}
.p08rs .op{margin-top:2px}
.p08empty{padding:12px;color:#d08a7a;font-size:14px}
.p08rn b.struck{text-decoration:line-through;color:#8a7a58}
.p08strike{margin-top:5px;background:none;border:1px solid rgba(168,48,40,.42);color:#c9705e;font-family:inherit;
  font-size:10.5px;letter-spacing:.8px;padding:3px 9px;cursor:pointer;transition:all .18s}
.p08strike:hover{background:rgba(168,48,40,.22);color:#e8a89a}
.p08sconf{grid-column:1/-1;width:100%;margin-top:9px;padding:11px 13px;border:1px solid rgba(168,48,40,.45);
  background:rgba(122,31,26,.13);text-align:left}
.p08row{flex-wrap:wrap}
.p08dostrike{margin-top:10px;width:100%;padding:9px;background:rgba(168,48,40,.2);border:1px solid rgba(168,48,40,.6);
  color:#e8c877;font-family:inherit;font-size:13px;letter-spacing:1.6px;cursor:pointer}
.p08dostrike:hover:not(:disabled){background:rgba(168,48,40,.36)}
.p08dostrike:disabled{opacity:.42;cursor:not-allowed;color:#8a7a58;border-color:rgba(201,163,78,.2)}

.p08laws{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.p08law{padding:11px 12px 12px;background:rgba(0,0,0,.28);border:1px solid rgba(201,163,78,.16);cursor:pointer;transition:all .18s}
.p08law:hover{border-color:rgba(201,163,78,.5);background:rgba(201,163,78,.07)}
.p08law.on{border-color:#c9a34e;background:rgba(201,163,78,.13);cursor:default}
.p08law.sel{border-color:#a83028;background:rgba(168,48,40,.12)}
.p08law .ln{font-size:15px;color:#e8c877;letter-spacing:.3px}
.p08law .lk{font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#8a7a58;margin:2px 0 6px}
.p08law .ld{font-size:12px;color:#bdae90;line-height:1.5;min-height:52px}
.p08law .lc{font-size:11.5px;color:#c9a34e;border-top:1px solid rgba(201,163,78,.14);padding-top:6px;margin-top:4px}
.p08law .lc.now{color:#9dc07e}
.p08law .lc.cant{color:#c9705e}
.p08confirm{margin-top:12px;padding:14px 16px;border:1px solid rgba(168,48,40,.4);background:rgba(122,31,26,.10)}
.p08confirm .cwarn{font-size:13.5px;color:#dfae9f;line-height:1.6;margin-bottom:10px}
.crow{display:flex;justify-content:space-between;gap:16px;padding:4px 0;border-bottom:1px solid rgba(201,163,78,.08);font-size:12.5px;color:#a8987a}
.crow b{color:#e8dcc6;font-weight:500;text-align:right}
.crow b.no{color:#d08a7a}.crow b.yes{color:#9dc07e}
.crow.tall b{max-width:60%;line-height:1.5}
.cfoot{margin-top:10px;font-size:12px;color:#8a7a58;font-style:italic;line-height:1.6}
.p08seal{margin-top:12px;width:100%;padding:11px;background:rgba(168,48,40,.18);border:1px solid rgba(168,48,40,.55);
  color:#e8c877;font-family:inherit;font-size:14px;letter-spacing:1.4px;cursor:pointer;transition:all .2s}
.p08seal:hover:not(:disabled){background:rgba(168,48,40,.34)}
.p08seal:disabled{opacity:.42;cursor:not-allowed;border-color:rgba(201,163,78,.2);color:#8a7a58}
.p08sealed{padding:12px 14px;border:1px solid rgba(201,163,78,.28);background:rgba(0,0,0,.28);font-size:13px;
  color:#cfc2a6;line-height:1.7}
.p08sealed b{color:#e8c877}

/* ---------- death ---------- */
#p08death{position:fixed;inset:0;z-index:120;display:block;overflow-y:auto;
  background:radial-gradient(ellipse at 50% 42%,rgba(18,12,8,.94),rgba(3,2,2,.99) 72%);
  animation:p08fade 1.6s ease both;padding:26px}
#p08death.hidden{display:none}
#p08death.gone{opacity:0;transition:opacity .9s ease}
@keyframes p08fade{from{opacity:0}to{opacity:1}}
.p08act{max-width:720px;margin:0 auto;min-height:calc(100vh - 52px);display:flex;flex-direction:column;
  align-items:center;justify-content:center;text-align:center;animation:p08rise 1.4s cubic-bezier(.16,1,.3,1) both}
.p08act.tight{justify-content:center;gap:0}
.p08act.tight h1.small{font-size:27px;margin-bottom:6px}
.p08act.tight .p08name{margin-bottom:12px}
.p08act.tight p{font-size:15px;margin-bottom:8px}
.p08act.tight .p08next{margin-top:16px}
@keyframes p08rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.p08act .p08kick{margin-bottom:20px}
.p08big.small{width:96px;height:96px;margin-bottom:10px}
.p08big{width:170px;height:170px;margin:0 auto 18px;border:1px solid rgba(201,163,78,.34);overflow:hidden;
  background:#120d09;box-shadow:0 0 60px rgba(0,0,0,.9), inset 0 0 40px rgba(0,0,0,.7);
  filter:grayscale(.55) contrast(1.05);animation:p08lift 2.6s ease both}
@keyframes p08lift{from{opacity:0;transform:scale(1.06)}to{opacity:1;transform:none}}
.p08big canvas{width:100%;height:100%;display:block}
.p08act h1{font-size:52px;margin:0 0 10px;font-weight:400;letter-spacing:2px;color:#d8c98a;
  text-shadow:0 0 60px rgba(216,201,138,.28)}
.p08act h1.small{font-size:34px}
.p08act h1.quiet{color:#c9a34e}
.p08act h1.bad{color:#c9705e;text-shadow:0 0 60px rgba(168,48,40,.4)}
.p08name{font-size:13px;letter-spacing:1.6px;text-transform:uppercase;color:#8a7a58;margin-bottom:20px}
.p08act p{font-size:17px;line-height:1.85;color:#cfc2a6;margin:0 0 12px}
.p08act p.dim{font-size:14.5px;color:#8a7a58;font-style:italic}
.p08act p.bad{color:#d08a7a;font-size:15px}
.p08grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0 18px;width:100%}
.p08grid div{padding:10px 6px;background:rgba(0,0,0,.4);border:1px solid rgba(201,163,78,.14)}
.p08grid b{display:block;font-size:26px;color:#e8c877;font-weight:400;font-variant-numeric:tabular-nums}
.p08grid b.no{color:#c9705e}
.p08grid b.yes{color:#9dc07e}
.p08grid span{font-size:10.5px;color:#8a7a58;letter-spacing:.6px}
.p08mem{text-align:left;margin:16px auto 6px;max-width:620px;width:100%;border-top:1px solid rgba(201,163,78,.14);padding-top:12px}
.p08mem div{font-size:13.5px;color:#bdae90;padding:5px 0;line-height:1.6}
.p08mem i{display:inline-block;min-width:118px;color:#7a6a52;font-style:normal;font-size:11.5px}
.p08cost{text-align:left;margin:14px auto 4px;max-width:640px;width:100%;max-height:44vh;overflow-y:auto;
  padding-right:4px;scrollbar-width:thin}
.p08cost .ch{font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#8a7a58;
  border-bottom:1px solid rgba(201,163,78,.14);padding-bottom:6px;margin-bottom:8px}
.p08cost .cl{display:grid;grid-template-columns:1fr auto;gap:3px 14px;padding:6px 0;
  border-bottom:1px solid rgba(201,163,78,.07);font-size:13px;color:#cfc2a6}
.p08cost .cl.tightrow{padding:5px 0}
.p08cost .cl span{color:#a8987a}
.p08cost .cl b{font-weight:500;color:#e8dcc6;font-variant-numeric:tabular-nums;text-align:right}
.p08cost .cl b em{font-style:normal;color:#d08a7a}
.p08cost .cl b em.yes{color:#9dc07e}
.p08cost .cl b.no{color:#d08a7a}
.p08cost .cl b.yes{color:#9dc07e}
.p08cost .cl i{grid-column:1/-1;font-size:11.5px;color:#7a6a52;font-style:italic;line-height:1.5}
.p08cost .cl.none{color:#8a7a58}
.p08next{align-self:center;margin-top:26px;padding:11px 44px;background:rgba(201,163,78,.10);border:1px solid rgba(201,163,78,.34);
  color:#e8c877;font-family:inherit;font-size:14px;letter-spacing:2.6px;text-transform:lowercase;cursor:pointer;
  transition:opacity 1.2s ease,background .2s}
.p08next:hover{background:rgba(201,163,78,.24)}
`;
