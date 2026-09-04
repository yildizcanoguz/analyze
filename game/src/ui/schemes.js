// ===========================================================================
// P06 — the scheme board.
// ---------------------------------------------------------------------------
// Two surfaces:
//
//   the rail   — always on screen, left of the map, under the top bar. Every
//                plot you have running and every plot you have caught wind of,
//                as two bars that pull against each other. You cannot look at
//                the map without seeing them.
//
//   the board  — the spread. Target's face, the two dials, the men you asked,
//                the men who said no, and every sign that has reached you so
//                far, in order, dated.
//
// This file owns no shared DOM: it appends its own nodes to document.body and
// injects its own stylesheet under the key `p06-schemes`.
// ===========================================================================

import { S, ch } from '../core/state.js';
import { on } from '../core/bus.js';
import { fmtDate } from '../core/date.js';
import { fullName, age, skill, opinion, opinionLabel, relation, SKILL_LABEL } from '../sim/characters.js';
import { styleOf, titleName } from '../sim/realm.js';
import { renderPortrait } from '../render/portrait.js';
import {
  SCHEME_TYPES, schemeType, mySchemes, myHistory, threats, schemeById,
  launchTargets, canLaunch, launchScheme, abortScheme, setMode,
  candidates, readOf, invite, roleFilled, rolePending,
  oddsOf, oddsBand, daysLeft, humanDays, secrecyWord, progressRate, heatRate,
  spiteRead, askCost, sorestPoint,
} from '../sim/schemes.js';
import * as Wait from './wait.js';
import * as Audio from '../audio/audio.js';
import { css } from './_css.js';

/** relation() says "stranger" for your own cook. Say something truer. */
function tie(p, c) {
  const r = relation(p.id, c.id);
  if (r !== 'yabancı') return r;
  if (Object.values(S.council || {}).includes(c.id)) return 'divanından';
  if (c.courtOf === p.id) return 'sarayından';
  if (c.liegeId === p.id) return 'vassalın';
  return 'yabancı';
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
const sfx = (k) => { try { Audio.SFX?.[k]?.(); } catch {} };
const say = (t, tone) => { try { Wait.whisper?.(t, tone); } catch {} };
const pct = (x) => Math.round(x);

// Portraits are software-rendered one WebGL frame at a time. Painting a dozen
// of them in a single task stalls (and on a software driver, kills) the
// context, so faces arrive a few per frame — which also reads as a room
// filling up rather than a table of rows appearing at once.
let paintQueue = [], painting = false;
function paintFaces(host) {
  paintQueue = paintQueue.filter((c) => c.isConnected);
  for (const cv of host.querySelectorAll('canvas[data-face]')) paintQueue.push(cv);
  if (painting) return;
  painting = true;
  const step = () => {
    let n = 0;
    while (paintQueue.length && n < 2) {
      const cv = paintQueue.shift();
      n++;
      if (!cv.isConnected) continue;
      const c = ch(cv.dataset.face);
      if (!c) continue;
      c._ageCache = age(c);
      try { renderPortrait(c, cv); } catch (e) { console.error(e); }
    }
    if (paintQueue.length) requestAnimationFrame(step);
    else painting = false;
  };
  requestAnimationFrame(step);
}

let rail = null, board = null;
let sel = null;          // selected scheme id
let flow = null;         // {step:'type'|'target'|'seal', typeId, targetId}
let openBoard = false;

// ---------------------------------------------------------------------------
export function initSchemeUI() {
  injectCss();
  buildRail();
  buildBoard();

  on('scheme:sign', ({ text, tone }) => { say(text, tone === 'good' ? 'good' : tone === 'bad' ? 'bad' : 'ambiguous'); sfx('whisper'); refresh(); });
  on('scheme:started', refresh);
  on('scheme:changed', refresh);
  on('scheme:partner', refresh);
  on('scheme:ended', refresh);
  on('scheme:resolved', refresh);
  on('scheme:exposed', refresh);
  on('scheme:ripe', refresh);
  on('scheme:suspected', refresh);
  on('scheme:threat', ({ level }) => { if (level >= 2) sfx('bad'); refresh(); });
  on('clock:day', refresh);
  on('sim:month', refresh);
  on('player:changed', () => { sel = null; flow = null; refresh(); });
  on('decision:offered', () => { if (openBoard) toggleBoard(false); });

  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input,textarea')) return;
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); toggleBoard(!openBoard); }
    if (e.key === 'Escape' && openBoard) toggleBoard(false);
  });

  // a handle for the inspection harness
  window.__P06 = {
    open: () => toggleBoard(true), close: () => toggleBoard(false),
    select: (id) => { sel = id; flow = null; toggleBoard(true); },
    launch: launchScheme, invite, abort: abortScheme, mode: setMode,
    schemes: mySchemes, threats, targets: launchTargets, candidates, odds: oddsOf,
  };
  refresh();
}

// ---------------------------------------------------------------------------
// the rail — the thing you cannot look at the map without seeing
// ---------------------------------------------------------------------------
function buildRail() {
  rail = document.createElement('section');
  rail.id = 'p06rail';
  document.body.appendChild(rail);
  addEventListener('resize', placeRail);
}

/**
 * Twenty-one pieces share one screen. Rather than nail this strip to a
 * coordinate and hope, it docks itself under whatever else is already living in
 * the right-hand column. Reads other pieces' geometry; writes none of it.
 */
function placeRail() {
  if (!rail) return;
  let y = 86;
  for (const el of document.body.children) {
    if (el === rail || el === board) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) continue;
    if (cs.pointerEvents === 'none') continue;                 // tooltips and washes
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.width > innerWidth * 0.5 && r.height > 160) continue; // full-screen overlays
    if (r.right < innerWidth - 70) continue;                    // not in my column
    if (r.top > innerHeight * 0.55) continue;                   // bottom-anchored: sits under me
    y = Math.max(y, r.bottom + 10);
  }
  rail.style.top = `${Math.min(y, Math.round(innerHeight * 0.5))}px`;
}

function refresh() {
  if (!rail) return;
  const mine = mySchemes(), th = threats();
  const idle = !mine.length && !th.length;
  rail.classList.toggle('idle', idle);
  rail.innerHTML = `
    <button class="p06tab${idle ? '' : ' live'}">
      <span class="tk">gölgede</span>
      <span class="tn">${mine.length ? `${mine.length} iş yürüyor` : 'hiçbir şey çevirmiyorsun'}</span>
      ${th.length ? `<span class="tw">${th.length}</span>` : ''}
    </button>
    ${idle ? idleCard() : ''}
    ${mine.map(railCard).join('')}
    ${th.map(threatCard).join('')}`;
  rail.querySelector('.p06tab').onclick = () => { sfx('page'); toggleBoard(!openBoard); };
  for (const el of rail.querySelectorAll('[data-sk]')) {
    el.onclick = () => { sfx('click'); sel = el.dataset.sk; flow = null; toggleBoard(true); };
  }
  const idleEl = rail.querySelector('.p06idle');
  if (idleEl) idleEl.onclick = () => { sfx('page'); flow = { step: 'type' }; sel = null; toggleBoard(true); };
  paintFaces(rail);
  placeRail();
  if (openBoard && canRedraw()) drawBoard();
}

/**
 * A day passing must never rebuild something the player is in the middle of:
 * a hold gate, an open room, or the choice of a target.
 */
function canRedraw() {
  if (holdActive) return false;
  if (board.querySelector('.p06modal')) return false;
  if (flow) return false;
  return true;
}

/** An empty panel teaches nothing. Name the man who likes you least. */
function idleCard() {
  const sore = sorestPoint();
  if (!sore) return '';
  const c = ch(sore.id);
  if (!c) return '';
  return `<div class="p06c p06idle">
    <div class="p06row">
      <div class="pf small"><canvas width="88" height="88" data-face="${c.id}"></canvas></div>
      <div class="p06id">
        <b>${esc(fullName(c))}</b>
        <i>${esc(sore.why)} · ${age(c)} yaşında</i>
        <i class="bad">sana ${sore.op > 0 ? '+' : ''}${sore.op} bakıyor</i>
      </div>
    </div>
    <div class="p06sub">Gölgede hiçbir şey yürümüyor. <b>E</b> — bir iş aç.</div>
  </div>`;
}

function railCard(sc) {
  const t = schemeType(sc.typeId);
  const tg = ch(sc.targetId);
  const ripe = sc.state === 'ripe' || sc.progress >= 100;
  const sec = pct(sc.secrecy);
  const lvl = sec > 62 ? '' : sec > 34 ? ' warn' : ' danger';
  return `<div class="p06c${ripe ? ' ripe' : ''}${sec < 34 ? ' hot' : ''}" data-sk="${sc.id}">
    <div class="p06row">
      <div class="pf"><canvas width="96" height="96" data-face="${sc.targetId}"></canvas></div>
      <div class="p06id">
        <b>${t.icon} ${esc(t.name)}</b>
        <i>${esc(tg ? fullName(tg) : '—')}</i>
        <i class="dim">${ripe ? 'bu gece olabilir' : `${humanDays(daysLeft(sc))} kaldı · ${sc.partners.length} ortak`}</i>
      </div>
    </div>
    <div class="p06bars">
      <div class="bl">plan</div><div class="bar prog"><i style="width:${pct(sc.progress)}%"></i></div><div class="bv">%${pct(sc.progress)}</div>
      <div class="bl">gizlilik</div><div class="bar sec${lvl}"><i style="width:${sec}%"></i></div><div class="bv${lvl}">%${sec}</div>
    </div>
    <div class="p06sub${lvl}">${ripe ? '<b class="rp">hazır — sözünü bekliyor</b>'
      : `${esc(secrecyWord(sc.secrecy))}${sc.discovery >= 1 ? ' · <b class="bad">şüpheleniyor</b>' : ''}`}</div>
  </div>`;
}

function threatCard(sc) {
  const t = schemeType(sc.typeId);
  const tg = ch(sc.targetId), o = ch(sc.ownerId);
  const named = sc.discovery >= 2;
  return `<div class="p06c threat" data-sk="${sc.id}">
    <div class="p06row">
      <div class="pf">${named ? `<canvas width="96" height="96" data-face="${sc.ownerId}"></canvas>` : '<div class="noface">?</div>'}</div>
      <div class="p06id">
        <b>👁 ${named ? esc(t.name) : 'Bir şeyler dönüyor'}</b>
        <i>${named && o ? esc(fullName(o)) : 'casusun isim getiremedi'}</i>
        <i class="bad">${named ? `hedef: ${esc(tg ? fullName(tg) : '—')}` : 'ne kadar ilerlediğini bilmiyorsun'}</i>
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// the board
// ---------------------------------------------------------------------------
function buildBoard() {
  board = document.createElement('div');
  board.id = 'p06board';
  board.hidden = true;
  board.innerHTML = `<div class="p06bg"></div><div class="p06sheet"><aside class="p06left"></aside><main class="p06right"></main></div>`;
  document.body.appendChild(board);
  board.querySelector('.p06bg').onclick = () => toggleBoard(false);
}

function overlayBusy() {
  return !!document.querySelector('#decisionRoot .dec, #revealRoot .reveal, #revealRoot .breath, #revealRoot .rv');
}
function toggleBoard(v) {
  if (v && overlayBusy()) return;      // never sit on top of a staged moment
  openBoard = v;
  board.hidden = !v;
  if (v) { sfx('open'); drawBoard(); }
}

function drawBoard() {
  const mine = mySchemes(), th = threats(), hist = myHistory();
  if (sel && !schemeById(sel)) sel = null;
  if (!sel && !flow && mine.length) sel = mine[0].id;
  if (!sel && !flow && !mine.length) flow = { step: 'type' };

  const left = board.querySelector('.p06left');
  left.innerHTML = `
    <div class="p06head"><h2>Gölgede</h2><div class="sub">${fmtDate(S.day)}</div></div>
    <button class="p06new${flow ? ' on' : ''}">+ yeni entrika</button>
    <div class="p06list">
      ${mine.length ? `<div class="lgrp">senin işlerin</div>` : `<div class="lempty">Şu an hiçbir şey çevirmiyorsun.</div>`}
      ${mine.map((sc) => listRow(sc, sc.id === sel)).join('')}
      ${th.length ? `<div class="lgrp warn">sana karşı</div>${th.map((sc) => listRow(sc, sc.id === sel, true)).join('')}` : ''}
      ${hist.length ? `<div class="lgrp">geride kalanlar</div>${hist.map(histRow).join('')}` : ''}
    </div>`;
  left.querySelector('.p06new').onclick = () => { sfx('click'); flow = { step: 'type' }; sel = null; drawBoard(); };
  for (const el of left.querySelectorAll('[data-sk]')) {
    el.onclick = () => { sfx('click'); sel = el.dataset.sk; flow = null; drawBoard(); };
  }

  const right = board.querySelector('.p06right');
  if (flow) return drawFlow(right);
  const sc = schemeById(sel);
  if (!sc) { right.innerHTML = `<div class="p06empty">Soldan bir iş seç, ya da yeni bir tane aç.</div>`; return; }
  if (sc.byAI) return drawThreat(right, sc);
  drawDetail(right, sc);
}

function listRow(sc, on, threat = false) {
  const t = schemeType(sc.typeId);
  const tg = ch(sc.targetId);
  return `<div class="lrow${on ? ' on' : ''}${threat ? ' threat' : ''}" data-sk="${sc.id}">
    <span class="ic">${threat ? '👁' : t.icon}</span>
    <div><b>${threat && sc.discovery < 2 ? 'İsimsiz' : esc(t.name)}</b><i>${esc(tg ? fullName(tg) : '—')}</i></div>
    ${threat ? '' : `<span class="mini">%${pct(sc.progress)}</span>`}
  </div>`;
}
function histRow(sc) {
  const t = schemeType(sc.typeId);
  const tg = ch(sc.targetId);
  const word = sc.state === 'exposed' ? 'ifşa' : sc.state === 'aborted' ? 'bırakıldı' : sc.success ? 'oldu' : 'olmadı';
  const cls = sc.state === 'exposed' || sc.success === false ? 'bad' : sc.success ? 'good' : 'dim';
  return `<div class="lrow past"><span class="ic">${t.icon}</span><div><b>${esc(t.name)}</b><i>${esc(tg ? tg.name : '—')}</i></div><span class="mini ${cls}">${word}</span></div>`;
}

// --- detail -----------------------------------------------------------------
function drawDetail(host, sc) {
  const t = schemeType(sc.typeId);
  const tg = ch(sc.targetId);
  const p = ch(S.playerId);
  const band = oddsBand(sc);
  const ripe = sc.state === 'ripe' || sc.progress >= 100;
  const months = Math.round((S.day - sc.startDay) / 30);
  const op = tg ? opinion(tg.id, p.id) : 0;

  host.innerHTML = `
    <div class="dhead">
      <div class="face"><canvas width="180" height="180"></canvas></div>
      <div class="dwho">
        <div class="kick">${t.icon} ${esc(t.name)} · ${esc(t.kicker)}</div>
        <h1>${esc(tg ? fullName(tg) : '—')}</h1>
        <div class="sub">${tg ? `${esc(styleOf(tg))} · ${age(tg)} yaşında · ${esc(relation(p.id, tg.id))}` : ''}</div>
        <div class="sub2">sana bakışı ${op > 0 ? '+' : ''}${op} · ${esc(opinionLabel(op))} · entrikası ${tg ? skill(tg, 'intrigue') : '—'}</div>
      </div>
      <div class="dclock">
        <div class="big">${ripe ? 'HAZIR' : humanDays(daysLeft(sc))}</div>
        <div class="lil">${months} aydır sürüyor</div>
        <div class="lil">${sc.goldSpent} altın gitti</div>
      </div>
    </div>

    <div class="dials">
      <div class="dial">
        <div class="dl">Plan <b>%${pct(sc.progress)}</b></div>
        <div class="bar prog big"><i style="width:${pct(sc.progress)}%"></i></div>
        <div class="dn">günde +%${progressRate(sc).toFixed(2)}</div>
      </div>
      <div class="dial">
        <div class="dl">Gizlilik <b>%${pct(sc.secrecy)}</b> — ${esc(secrecyWord(sc.secrecy))}</div>
        <div class="bar sec big${sc.secrecy < 34 ? ' danger' : ''}"><i style="width:${pct(sc.secrecy)}%"></i></div>
        <div class="dn">günde −%${heatRate(sc).toFixed(2)}${sc.discovery >= 1 ? ' · <b class="bad">hedefin şüpheleniyor</b>' : ''}</div>
      </div>
    </div>

    <div class="oddsline">
      <span class="ol">Kestirebildiğin kadarıyla</span>
      <span class="ov">%${pct(band.lo * 100)} – %${pct(band.hi * 100)}</span>
      <span class="oh">${band.fog < 0.10 ? 'casusluğun iyi; bu tahmine yakın güvenebilirsin' : band.fog < 0.20 ? 'bu bir tahmin, fazlası değil' : 'bu işten anlamıyorsun; sayı bir avuntu'}</span>
    </div>
    <div class="sealed">Sonucu belirleyen sayı <b>${fmtDate(sc.startDay)}</b> günü atıldı ve bir daha dokunulmadı.
      Ortak katmak, para dökmek, beklemek — hiçbiri o sayıyı değiştirmiyor. Sadece kapıyı genişletiyor.</div>

    <div class="cols">
      <div class="col">
        <div class="ch">Ortaklar <i>${sc.partners.length}/${t.roles.length}</i></div>
        ${t.roles.map((r) => roleBlock(sc, r)).join('')}
        ${sc.refusals.length ? `<div class="ch">Reddedenler</div>${sc.refusals.map((r) => {
          const c = ch(r.id);
          return `<div class="pref">${esc(c ? fullName(c) : '—')} <i>${r.betrayed ? 've dışarıda konuşuyor' : 'sustu — şimdilik'}</i></div>`;
        }).join('')}` : ''}
      </div>
      <div class="col">
        <div class="ch">Şimdiye kadarki işaretler</div>
        <div class="signs">
          ${sc.signs.length ? sc.signs.slice().reverse().map((s) =>
            `<div class="sg ${s.tone}"><span class="sd">${fmtDate(s.day)}</span>${esc(s.text)}</div>`).join('')
            : '<div class="sg ambiguous">Henüz hiçbir haber gelmedi.</div>'}
        </div>
      </div>
    </div>

    <div class="acts">
      <button class="act${sc.mode === 'quiet' ? ' on' : ''}" data-mode="quiet">Gölgeye çekil <i>12 altın · üç ay · plan durur, gizlilik toparlar</i></button>
      <button class="act${sc.mode === 'rush' ? ' on' : ''}" data-mode="rush">Aceleye getir <i>25 altın · iki ay · iki kat hız, iki kat gürültü</i></button>
      ${sc.mode !== 'normal' ? `<button class="act" data-mode="normal">Normale dön <i>bedava</i></button>` : ''}
      <button class="act drop">Vazgeç <i>${sc.goldSpent} altın ve ${months} ay geri gelmez</i></button>
    </div>`;

  if (tg) { tg._ageCache = age(tg); renderPortrait(tg, host.querySelector('.face canvas')); }
  for (const b of host.querySelectorAll('[data-mode]')) {
    b.onclick = () => { sfx('click'); setMode(sc.id, b.dataset.mode); drawBoard(); };
  }
  host.querySelector('.drop').onclick = () => confirmDrop(sc);
  for (const b of host.querySelectorAll('[data-inv]')) {
    b.onclick = () => { sfx('click'); openInvite(sc, b.dataset.inv); };
  }
}

function roleBlock(sc, role) {
  const t = schemeType(sc.typeId);
  const held = sc.partners.find((p) => p.roleId === role.id);
  const pend = sc.invites.find((i) => i.state === 'pending' && i.roleId === role.id);
  if (held) {
    const c = ch(held.id);
    const nerveW = held.nerve > 60 ? 'sağlam' : held.nerve > 38 ? 'huzursuz' : held.nerve > 22 ? 'titriyor' : 'çekilmek üzere';
    return `<div class="prole filled">
      <div class="pr1"><b>${esc(role.name)}</b><span>${esc(c ? fullName(c) : '—')}</span></div>
      <div class="pr2">${esc(SKILL_LABEL[role.skill])} ${c ? skill(c, role.skill) : 0} · +%${Math.round(role.succ * 100)} ihtimal · +${role.heat.toFixed(1)} gürültü</div>
      <div class="pr3 ${held.nerve < 30 ? 'bad' : ''}">cesareti: ${esc(nerveW)} <i>(${held.nerve})</i></div>
    </div>`;
  }
  if (pend) {
    const c = ch(pend.id);
    return `<div class="prole pending"><div class="pr1"><b>${esc(role.name)}</b><span>${esc(c ? fullName(c) : '—')}</span></div>
      <div class="pr2">cevabını bekliyorsun · ${Math.max(0, pend.answerDay - S.day)} gün</div></div>`;
  }
  return `<div class="prole empty">
    <div class="pr1"><b>${esc(role.name)}</b><span class="dim">boş</span></div>
    <div class="pr2">${esc(role.hint)}</div>
    <button class="mini-btn" data-inv="${role.id}">birini çağır</button>
  </div>`;
}

// --- invite panel -----------------------------------------------------------
function openInvite(sc, roleId) {
  const t = schemeType(sc.typeId);
  const role = t.roles.find((r) => r.id === roleId);
  const p = ch(S.playerId);
  const tg = ch(sc.targetId);
  const cost = askCost(sc);
  const cands = candidates(sc);
  const modal = document.createElement('div');
  modal.className = 'p06modal';
  modal.innerHTML = `<div class="mbg"></div><div class="mbox">
    <div class="mhead"><h3>${esc(role.name)} arıyorsun</h3><div class="sub">${esc(role.hint)}</div></div>
    <div class="mwarn">
      Kimi seçersen seç, ona <b>${esc(fullName(tg))}</b> için ne planladığını söylemek zorundasın.
      Sorman <b>−${cost} gizlilik</b>. Reddederse daha fazlası. Reddedip konuşursa hepsi.
    </div>
    <div class="mrows">
      ${cands.length ? cands.map((cd) => {
        const c = ch(cd.id);
        const r0 = readOf(sc, cd.id, roleId, 0);
        const sp = spiteRead(sc, cd.id);
        const op = opinion(c.id, p.id);
        const opT = opinion(c.id, sc.targetId);
        return `<button class="mrow" data-pick="${c.id}">
          <div class="mface"><canvas width="88" height="88" data-face="${c.id}"></canvas></div>
          <div class="mwho">
            <b>${esc(fullName(c))}</b>
            <i>${age(c)} yaşında · ${esc(tie(p, c))} · ${esc(SKILL_LABEL[role.skill])} ${skill(c, role.skill)}</i>
            <i class="dim">sana ${op > 0 ? '+' : ''}${op} · hedefe ${opT > 0 ? '+' : ''}${opT}</i>
          </div>
          <div class="mreads">
            <div class="rd"><span>kabul</span><b class="${r0.word === 'hevesli' ? 'good' : (r0.word === 'asla' || r0.word === 'zor') ? 'bad' : ''}">${esc(r0.word)}</b></div>
            <div class="rd"><span>reddederse</span><b class="${sp.hot ? 'bad' : ''}">${esc(sp.word)}</b></div>
          </div>
        </button>`;
      }).join('') : '<div class="lempty">Çağırabileceğin kimse kalmadı.</div>'}
    </div>
    <button class="mclose">kapat</button>
  </div>`;
  board.appendChild(modal);
  paintFaces(modal);
  modal.querySelector('.mbg').onclick = () => modal.remove();
  modal.querySelector('.mclose').onclick = () => modal.remove();
  for (const b of modal.querySelectorAll('[data-pick]')) {
    b.onclick = () => { sfx('click'); askRoom(modal, sc, roleId, b.dataset.pick); };
  }
}

/**
 * The second beat: one man, one face, one sentence you cannot unsay. Asking is
 * the risk — so it gets its own room rather than a row in a list.
 */
function askRoom(modal, sc, roleId, charId) {
  const t = schemeType(sc.typeId);
  const role = t.roles.find((r) => r.id === roleId);
  const c = ch(charId), p = ch(S.playerId), tg = ch(sc.targetId);
  const sp = spiteRead(sc, charId);
  const cost = askCost(sc);
  const line = t.lethal
    ? `«${fullName(tg)} ölsün istiyorum. Bana yardım eder misin?»`
    : `«${fullName(tg)} için bir işim var. Sen varsın diye düşündüm.»`;
  const box = modal.querySelector('.mbox');
  box.classList.add('room');
  box.innerHTML = `
    <div class="askhead">
      <div class="askface"><canvas width="160" height="160" data-face="${c.id}"></canvas></div>
      <div>
        <div class="askkick">${esc(role.name)} · ${esc(t.name)}</div>
        <h3>${esc(fullName(c))}</h3>
        <div class="sub">${esc(styleOf(c))} · ${age(c)} yaşında · ${esc(tie(p, c))}</div>
      </div>
    </div>
    <p class="askline">${esc(line)}</p>
    <p class="asknote">Bunu söyledikten sonra, kabul etse de etmese de, bu adam bilecek.
      ${sp.hot ? `Kâhyan diyor ki <b class="bad">${esc(sp.word)}</b> — reddederse ${esc(tg.name)}'in kapısını çalabilir.`
               : `Kâhyanın kanaati: reddederse <b>${esc(sp.word)}</b>. Kâhyan bazen yanılır.`}</p>
    <div class="askcost">
      <div><b>−${cost}</b><span>gizlilik, sorman yeter</span></div>
      <div><b>+%${Math.round(role.succ * 100)}</b><span>kabul ederse ihtimal</span></div>
      <div><b>+${role.heat.toFixed(1)}</b><span>ağız, her gün konuşur</span></div>
    </div>
    <div class="askbtns">
      <button data-ask="0">Bedava sor</button>
      <button data-ask="20" ${p.gold < 20 ? 'disabled' : ''}>20 altınla sor<i>ikna eder, iz bırakır</i></button>
      <button data-ask="50" ${p.gold < 50 ? 'disabled' : ''}>50 altınla sor<i>çoğu adamı eder</i></button>
    </div>
    <button class="mclose">vazgeç — kimse bir şey duymadı</button>`;
  paintFaces(box);
  box.querySelector('.mclose').onclick = () => modal.remove();
  for (const b of box.querySelectorAll('[data-ask]')) {
    b.onclick = () => {
      sfx('commit');
      invite(sc.id, charId, roleId, Number(b.dataset.ask));
      modal.remove();
      drawBoard();
    };
  }
}

// --- threat view ------------------------------------------------------------
function drawThreat(host, sc) {
  const t = schemeType(sc.typeId);
  const o = ch(sc.ownerId), tg = ch(sc.targetId);
  const named = sc.discovery >= 2;
  host.innerHTML = `
    <div class="dhead threat">
      <div class="face">${named ? '<canvas width="180" height="180"></canvas>' : '<div class="noface">?</div>'}</div>
      <div class="dwho">
        <div class="kick">👁 sana karşı</div>
        <h1>${named ? esc(fullName(o)) : 'Bir isim yok'}</h1>
        <div class="sub">${named ? `${esc(t.name)} · hedef ${esc(tg ? fullName(tg) : '—')}` : 'casusun bir şey duydu, kim olduğunu söyleyemedi'}</div>
      </div>
    </div>
    <div class="tbody">
      ${named
        ? `<p>${esc(fullName(o))} aylardır çalışıyor. Ne kadar ilerlediğini sana kimse söyleyemez — bunu ancak o biliyor.</p>
           <p>Elinde iki şey var: bildiğin gerçeği ve onun bilmediğin gerçeğini. Hangisinin daha ağır olduğunu iş bittiğinde öğreneceksin.</p>`
        : `<p>Kâhyan bir şey duymuş. Ahırda fazladan bir at, mutfakta susan iki kişi, geç dönen bir hizmetkâr.</p>
           <p>Casusun bir isim getiremedi. İsim getirememek, isim olmadığı anlamına gelmiyor.</p>`}
      <div class="tnote">Bunu durdurmak senin elinde değil. Casusunun becerisi elinde. Divanda daha iyi bir casusbaşı, karanlıkta daha az sürpriz demektir.</div>
    </div>`;
  if (named && o) { o._ageCache = age(o); renderPortrait(o, host.querySelector('.face canvas')); }
}

// ---------------------------------------------------------------------------
// the new-scheme flow: type → target → the gate
// ---------------------------------------------------------------------------
function drawFlow(host) {
  const p = ch(S.playerId);
  if (flow.step === 'type') {
    host.innerHTML = `
      <div class="fhead"><h1>Ne çevireceksin?</h1>
        <p>Her biri farklı bir beceriyle yürür, farklı sürer, farklı gürültü çıkarır. Ucuz olan sessiz olandır; işe yarayan olan pahalı olandır.</p></div>
      <div class="tgrid">
        ${SCHEME_TYPES.map((t) => `
          <button class="tcard" data-type="${t.id}" ${p.gold < t.gold ? 'disabled' : ''}>
            <div class="tc1"><span class="ic">${t.icon}</span><b>${esc(t.name)}</b></div>
            <div class="tc2">${esc(t.blurb)}</div>
            <div class="tc3">
              <span>${esc(SKILL_LABEL[t.skill])} <b>${skill(p, t.skill)}</b></span>
              <span>${Math.round(t.days / 30)} ay</span>
              <span class="${p.gold < t.gold ? 'bad' : ''}">${t.gold} altın</span>
              <span class="heat h${t.heat > 0.2 ? '3' : t.heat > 0.1 ? '2' : '1'}">${t.heat > 0.2 ? 'çok gürültülü' : t.heat > 0.1 ? 'gürültülü' : 'sessiz'}</span>
            </div>
          </button>`).join('')}
      </div>`;
    for (const b of host.querySelectorAll('[data-type]')) {
      b.onclick = () => { sfx('click'); flow = { step: 'target', typeId: b.dataset.type }; drawBoard(); };
    }
    return;
  }

  const t = schemeType(flow.typeId);
  if (flow.step === 'target') {
    const rows = launchTargets(flow.typeId);
    host.innerHTML = `
      <div class="fhead"><h1>${t.icon} ${esc(t.targetHint)}</h1>
        <p>${esc(t.blurb)}</p></div>
      <div class="tglist">
        ${rows.length ? rows.map((r) => {
          const c = ch(r.id);
          const op = opinion(c.id, p.id);
          const chk = canLaunch(flow.typeId, r.id);
          return `<button class="tgrow" data-tg="${r.id}" ${chk.ok ? '' : 'disabled'}>
            <div class="mface"><canvas width="96" height="96" data-face="${c.id}"></canvas></div>
            <div class="mwho"><b>${esc(fullName(c))}</b>
              <i>${esc(styleOf(c))} · ${age(c)} yaşında · ${esc(r.why)}</i>
              <i class="dim">sana ${op > 0 ? '+' : ''}${op} · ${esc(opinionLabel(op))} · entrika ${skill(c, 'intrigue')}</i></div>
            <div class="tgend">${chk.ok ? '→' : esc(chk.why)}</div>
          </button>`;
        }).join('') : '<div class="lempty">Bu iş için uygun kimse yok.</div>'}
      </div>
      <button class="back">← geri</button>`;
    paintFaces(host);
    for (const b of host.querySelectorAll('[data-tg]')) {
      b.onclick = () => { sfx('click'); flow = { step: 'seal', typeId: flow.typeId, targetId: b.dataset.tg }; drawBoard(); };
    }
    host.querySelector('.back').onclick = () => { flow = { step: 'type' }; drawBoard(); };
    return;
  }

  // --- the gate: you hold your own hand down on it --------------------------
  const tg = ch(flow.targetId);
  const chk = canLaunch(flow.typeId, flow.targetId);
  host.innerHTML = `
    <div class="seal">
      <div class="sface"><canvas width="200" height="200"></canvas></div>
      <div class="skick">${t.icon} ${esc(t.name)}</div>
      <h1>${esc(fullName(tg))}</h1>
      <div class="ssub">${esc(styleOf(tg))} · ${age(tg)} yaşında · ${esc(relation(ch(S.playerId).id, tg.id))}</div>
      <div class="spay">
        <div><b>${t.gold} altın</b><span>şimdi gider, sonucu bilmeden</span></div>
        <div><b>${Math.round(t.days / 30)} ay</b><span>en iyi ihtimalle</span></div>
        <div><b>${esc(SKILL_LABEL[t.skill])} ${skill(ch(S.playerId), t.skill)}</b><span>bu işi taşıyan sayı</span></div>
      </div>
      <p class="swarn">Bastığın an sonucu belirleyen sayı atılacak ve bir daha değişmeyecek. Bundan sonra yapacağın her şey — ortak bulmak, para dökmek, saklanmak — sadece o sayının sığması gereken kapıyı genişletir.</p>
      <p class="swarn2">Vazgeçebilirsin. Harcadığın geri gelmez.</p>
      ${chk.ok ? `<button class="holdb"><i></i><span>basılı tut</span></button>` : `<div class="sbad">${esc(chk.why)}</div>`}
      <button class="back">← vazgeç</button>
    </div>`;
  tg._ageCache = age(tg);
  renderPortrait(tg, host.querySelector('.sface canvas'));
  host.querySelector('.back').onclick = () => { flow = { step: 'target', typeId: flow.typeId }; drawBoard(); };
  const btn = host.querySelector('.holdb');
  if (btn) wireHold(btn, 1600, () => {
    sfx('commit');
    const sc = launchScheme(flow.typeId, flow.targetId);
    flow = null;
    if (sc) sel = sc.id;
    drawBoard();
  });
}

function confirmDrop(sc) {
  const t = schemeType(sc.typeId);
  const months = Math.round((S.day - sc.startDay) / 30);
  const modal = document.createElement('div');
  modal.className = 'p06modal';
  modal.innerHTML = `<div class="mbg"></div><div class="mbox narrow">
    <div class="mhead"><h3>Vazgeçecek misin?</h3></div>
    <p class="mtxt">${months} ay ve ${sc.goldSpent} altın orada kalır. Gizliliğin geri gelmez.
      ${sc.partners.length ? `<b>${sc.partners.map((x) => fullName(ch(x.id))).join(', ')}</b> bu işten haberdar ve haberdar kalacaklar.` : ''}</p>
    <button class="holdb"><i></i><span>basılı tut</span></button>
    <button class="mclose">geri dön</button>
  </div>`;
  board.appendChild(modal);
  modal.querySelector('.mbg').onclick = () => modal.remove();
  modal.querySelector('.mclose').onclick = () => modal.remove();
  wireHold(modal.querySelector('.holdb'), 1200, () => { abortScheme(sc.id); modal.remove(); sel = null; drawBoard(); });
}

/**
 * Your own hand has to stay on it. Driven by a wall-clock interval rather than
 * requestAnimationFrame: this page renders a software-rasterised 3D scene, and
 * on a slow frame budget a rAF-driven gate can sit at zero for two seconds and
 * then reset when you let go. A gate that punishes a slow machine is not a
 * gate, it is a bug.
 */
let holdActive = false;
function wireHold(btn, need, done) {
  const fill = btn.querySelector('i'), span = btn.querySelector('span');
  let timer = null, t0 = 0;
  const tick = () => {
    const q = Math.min(1, (performance.now() - t0) / need);
    fill.style.width = `${q * 100}%`;
    span.textContent = q < 1 ? `bırakma…  ${Math.ceil((1 - q) * need / 1000)}` : 'tamam';
    if (q >= 1) { stop(); done(); }
  };
  const start = (e) => {
    if (e) e.preventDefault();
    if (timer) return;
    holdActive = true;
    t0 = performance.now();
    tick();
    timer = setInterval(tick, 40);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null; holdActive = false;
    fill.style.width = '0%'; span.textContent = 'basılı tut';
  };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('mousedown', start);
  btn.addEventListener('touchstart', start, { passive: false });
  for (const ev of ['pointerup', 'mouseup', 'pointerleave', 'mouseleave', 'pointercancel', 'touchend']) {
    btn.addEventListener(ev, stop);
  }
}

// ---------------------------------------------------------------------------
function injectCss() {
  css('p06-schemes', `
/* Docks itself under whatever else occupies the right column (see placeRail). */
#p06rail{position:fixed;right:14px;top:86px;z-index:23;width:300px;
  display:flex;flex-direction:column;gap:7px;max-height:calc(100vh - 160px);overflow-y:auto;overflow-x:hidden}
#p06rail.idle{opacity:.86}
#p06rail.idle:hover{opacity:1}
body.staged #p06rail{opacity:.10;pointer-events:none;transition:opacity .6s}
.p06tab{display:flex;align-items:center;gap:9px;background:linear-gradient(160deg,rgba(28,20,13,.94),rgba(16,11,8,.94));
  border:1px solid var(--edge-2);border-left:3px solid #5a4a2a;color:var(--txt-dim);padding:7px 12px;cursor:pointer;
  font-family:var(--serif);text-align:left;transition:all .18s;position:relative}
.p06tab:hover{border-left-color:var(--gold);color:var(--gold-2)}
.p06tab.live{border-left-color:var(--gold);color:var(--gold-2)}
.p06tab .tk{font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#7a6a52}
.p06tab .tn{font-size:13px;letter-spacing:.4px}
.p06tab .tw{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:rgba(122,31,26,.75);
  border:1px solid var(--blood-2);color:#e8b5a8;font-size:11px;padding:1px 7px;border-radius:2px;animation:p06pulse 2.2s ease-in-out infinite}
@keyframes p06pulse{0%,100%{opacity:.75}50%{opacity:1;box-shadow:0 0 12px rgba(168,48,40,.55)}}

.p06c{background:linear-gradient(160deg,rgba(26,19,12,.95),rgba(15,11,8,.95));border:1px solid var(--edge-2);
  border-left:3px solid #6a5a34;padding:8px 11px 9px;cursor:pointer;box-shadow:var(--shadow);animation:p06in .45s ease}
@keyframes p06in{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}
.p06c:hover{border-color:var(--edge)}
.p06c.ripe{border-left-color:var(--gold-2);animation:p06glow 2.2s ease-in-out infinite}
@keyframes p06glow{0%,100%{box-shadow:var(--shadow)}50%{box-shadow:var(--shadow),0 0 20px rgba(201,163,78,.5)}}
.p06c.hot{border-left-color:var(--blood-2)}
.p06c.threat{border-left-color:var(--blood-2);background:linear-gradient(160deg,rgba(38,16,13,.95),rgba(15,9,8,.95))}
.p06row{display:flex;gap:10px;align-items:center;margin-bottom:7px}
.pf{width:44px;height:44px;flex:0 0 44px;border:1px solid var(--edge-2);overflow:hidden;background:#140f0a}
.pf.small{width:36px;height:36px;flex:0 0 36px}
.pf canvas{width:100%;height:100%;display:block}
.pf .noface{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#5a4a34}
.p06id{min-width:0;flex:1}
.p06id b{display:block;font-size:12.5px;color:var(--gold-2);font-weight:500;letter-spacing:.3px}
.p06id i{display:block;font-size:11px;color:var(--txt-dim);font-style:normal;line-height:1.4;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p06id i.dim{color:#7a6a52}
.p06id i.bad{color:#c9836f}
.p06idle{cursor:pointer;border-left-color:#4a3c28}
.p06idle:hover{border-left-color:var(--gold)}
.p06bars{display:grid;grid-template-columns:46px 1fr 34px;gap:3px 6px;align-items:center}
.p06bars .bl{font-size:9.5px;letter-spacing:1px;text-transform:uppercase;color:#7a6a52}
.p06bars .bv{font-size:10.5px;color:var(--txt-dim);text-align:right;font-variant-numeric:tabular-nums}
.bar{height:4px;background:rgba(0,0,0,.6);position:relative;overflow:hidden}
.bar i{position:absolute;inset:0 auto 0 0;transition:width .5s linear}
.bar.prog i{background:linear-gradient(90deg,#8a7a3a,var(--gold-2))}
.bar.sec i{background:linear-gradient(90deg,#3d5a3a,#7fa860)}
.bar.sec.warn i{background:linear-gradient(90deg,#8a6a2a,#d8a84e)}
.bar.sec.danger i{background:linear-gradient(90deg,#7a1f1a,#d05a48)}
.p06bars .bv.warn{color:#d8a84e}
.p06bars .bv.danger{color:#d08a7a}
.bar.big{height:7px}
.p06sub{margin-top:7px;font-size:10.5px;color:#8a7a5c;letter-spacing:.2px}
.p06sub.warn{color:#c9a34e}
.p06sub.danger{color:#d08a7a}
.p06sub .rp{color:var(--gold-2)}
.p06sub .bad{color:#d08a7a}
.p06tab .tn{font-size:12.5px;letter-spacing:.3px;line-height:1.35}

/* ---------- board ---------- */
#p06board{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center}
#p06board[hidden]{display:none}
.p06bg{position:absolute;inset:0;background:rgba(4,3,2,.86)}
.p06sheet{position:relative;width:min(1180px,94vw);height:min(820px,90vh);display:grid;grid-template-columns:264px 1fr;
  background:linear-gradient(168deg,rgba(30,23,16,.99),rgba(18,13,9,.99));border:1px solid var(--edge);
  box-shadow:0 30px 90px rgba(0,0,0,.75);overflow:hidden;animation:p06up .35s ease}
@keyframes p06up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.p06left{border-right:1px solid var(--edge-2);padding:16px 12px;overflow-y:auto;background:rgba(0,0,0,.24)}
.p06right{padding:20px 26px;overflow-y:auto}
.p06head h2{margin:0;font-size:19px;color:var(--gold-2);font-weight:500;letter-spacing:1.5px}
.p06head .sub{font-size:10.5px;color:#7a6a52;letter-spacing:1.4px;text-transform:uppercase;margin-bottom:14px}
.p06new{width:100%;background:rgba(201,163,78,.08);border:1px solid var(--edge-2);color:var(--gold-2);
  padding:8px;font-family:var(--serif);font-size:12.5px;cursor:pointer;margin-bottom:14px;transition:all .16s}
.p06new:hover,.p06new.on{background:rgba(201,163,78,.2);border-color:var(--gold)}
.lgrp{font-size:9.5px;letter-spacing:2px;text-transform:uppercase;color:#6a5a44;margin:12px 0 6px}
.lgrp.warn{color:#a8564a}
.lempty{font-size:12px;color:#7a6a52;line-height:1.6;padding:6px 2px}
.lrow{display:flex;align-items:center;gap:8px;padding:7px 8px;cursor:pointer;border-left:2px solid transparent;transition:all .15s}
.lrow:hover{background:rgba(201,163,78,.07)}
.lrow.on{background:rgba(201,163,78,.13);border-left-color:var(--gold)}
.lrow.threat{border-left-color:rgba(168,48,40,.5)}
.lrow.past{opacity:.55;cursor:default}
.lrow .ic{font-size:13px}
.lrow b{display:block;font-size:12px;color:var(--gold-2);font-weight:500}
.lrow i{display:block;font-size:11px;color:var(--txt-dim);font-style:normal}
.lrow .mini{margin-left:auto;font-size:11px;color:#8a7a5c;font-variant-numeric:tabular-nums}
.mini.good{color:#9dc07e}.mini.bad{color:#d08a7a}.mini.dim{color:#7a6a52}
.p06empty{color:#8a7a5c;font-size:13px;padding:40px 0;text-align:center}

/* ---------- detail ---------- */
.dhead{display:flex;gap:18px;align-items:flex-start;padding-bottom:16px;border-bottom:1px solid var(--edge-2)}
.dhead .face{width:96px;height:96px;flex:0 0 96px;border:1px solid var(--edge);overflow:hidden;background:#140f0a}
.dhead .face canvas{width:100%;height:100%;display:block}
.dhead .noface{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:40px;color:#4a3c2a}
.dwho{flex:1;min-width:0}
.dwho .kick{font-size:10px;letter-spacing:2.2px;text-transform:uppercase;color:#8a7a58}
.dwho h1{margin:3px 0 4px;font-size:26px;color:var(--vellum);font-weight:400;letter-spacing:.4px}
.dwho .sub{font-size:12.5px;color:var(--txt-dim)}
.dwho .sub2{font-size:11.5px;color:#7a6a52;margin-top:2px}
.dclock{text-align:right;flex:0 0 auto}
.dclock .big{font-size:22px;color:var(--gold-2);letter-spacing:1px}
.dclock .lil{font-size:11px;color:#7a6a52}

.dials{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin:16px 0 6px}
.dial .dl{font-size:12px;color:var(--txt-dim);margin-bottom:5px}
.dial .dl b{color:var(--vellum);font-variant-numeric:tabular-nums}
.dial .dn{font-size:10.5px;color:#7a6a52;margin-top:4px}
.dial .dn .bad{color:#d08a7a}

.oddsline{display:flex;align-items:baseline;gap:12px;margin:14px 0 4px;padding:8px 12px;background:rgba(0,0,0,.28);border-left:2px solid var(--edge-2)}
.oddsline .ol{font-size:10.5px;letter-spacing:1.6px;text-transform:uppercase;color:#7a6a52}
.oddsline .ov{font-size:19px;color:var(--gold-2);font-variant-numeric:tabular-nums}
.oddsline .oh{font-size:11px;color:#8a7a5c;font-style:italic}
.sealed{font-size:11.5px;color:#8a7a5c;line-height:1.65;padding:6px 12px 12px;border-left:2px solid transparent}
.sealed b{color:var(--gold-2)}

.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:8px}
.ch{font-size:9.5px;letter-spacing:2px;text-transform:uppercase;color:#6a5a44;margin:10px 0 7px;border-bottom:1px solid var(--edge-2);padding-bottom:4px}
.ch i{float:right;font-style:normal;color:#8a7a5c}
.prole{padding:7px 9px;margin-bottom:6px;background:rgba(0,0,0,.22);border-left:2px solid #4a3c28}
.prole.filled{border-left-color:#7fa860}
.prole.pending{border-left-color:var(--gold)}
.pr1{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.pr1 b{font-size:12.5px;color:var(--gold-2);font-weight:500}
.pr1 span{font-size:12px;color:var(--vellum)}
.pr1 .dim{color:#6a5a44}
.pr2{font-size:11px;color:#8a7a5c;margin-top:3px;line-height:1.5}
.pr3{font-size:11px;color:#9dc07e;margin-top:3px}
.pr3.bad{color:#d08a7a}
.pr3 i{color:#7a6a52;font-style:normal}
.mini-btn{margin-top:6px;background:rgba(201,163,78,.09);border:1px solid var(--edge-2);color:var(--gold-2);
  font-family:var(--serif);font-size:11px;padding:3px 10px;cursor:pointer;transition:all .15s}
.mini-btn:hover{background:rgba(201,163,78,.22);border-color:var(--gold)}
.pref{font-size:11.5px;color:var(--txt-dim);padding:3px 0}
.pref i{color:#d08a7a;font-style:normal;font-size:11px}
.signs{max-height:230px;overflow-y:auto}
.sg{font-size:11.5px;line-height:1.6;padding:5px 0 5px 9px;border-left:2px solid var(--edge-2);margin-bottom:4px;color:#cbbd97}
.sg .sd{display:block;font-size:9.5px;color:#6a5a44;letter-spacing:.8px}
.sg.good{border-left-color:#5d8a48;color:#b9cfa6}
.sg.bad{border-left-color:var(--blood-2);color:#dfae9f}
.sg.ambiguous{border-left-color:#8a7a48;font-style:italic}

.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px;padding-top:14px;border-top:1px solid var(--edge-2)}
.act{flex:1 1 200px;text-align:left;background:rgba(0,0,0,.3);border:1px solid var(--edge-2);color:var(--txt);
  padding:8px 12px;font-family:var(--serif);font-size:12.5px;cursor:pointer;transition:all .15s}
.act:hover{border-color:var(--edge);background:rgba(201,163,78,.1)}
.act.on{border-color:var(--gold);background:rgba(201,163,78,.18);color:var(--gold-2)}
.act i{display:block;font-size:10.5px;color:#7a6a52;font-style:normal;margin-top:2px}
.act.drop{border-color:rgba(168,48,40,.4);color:#dfae9f}
.act.drop:hover{background:rgba(122,31,26,.22)}

.tbody{padding:18px 4px;font-size:13.5px;line-height:1.75;color:var(--txt)}
.tbody p{margin:0 0 12px}
.tnote{margin-top:16px;padding:10px 14px;background:rgba(0,0,0,.3);border-left:2px solid var(--blood-2);
  font-size:12px;color:#c9b092;line-height:1.65}

/* ---------- flow ---------- */
.fhead h1{margin:0 0 6px;font-size:24px;color:var(--vellum);font-weight:400}
.fhead p{margin:0 0 18px;font-size:12.5px;color:#8a7a5c;line-height:1.7;max-width:62ch}
.tgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tcard{text-align:left;background:rgba(0,0,0,.3);border:1px solid var(--edge-2);color:var(--txt);
  padding:11px 13px;font-family:var(--serif);cursor:pointer;transition:all .16s}
.tcard:hover:not(:disabled){border-color:var(--gold);background:rgba(201,163,78,.1)}
.tcard:disabled{opacity:.42;cursor:not-allowed}
.tc1{display:flex;align-items:baseline;gap:8px}
.tc1 .ic{font-size:15px}
.tc1 b{font-size:15px;color:var(--gold-2);font-weight:500;letter-spacing:.4px}
.tc2{font-size:11.5px;color:#9a8a6a;line-height:1.6;margin:5px 0 8px;min-height:38px}
.tc3{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:10.5px;color:#7a6a52}
.tc3 b{color:var(--vellum)}
.tc3 .bad{color:#d08a7a}
.tc3 .heat.h1{color:#7fa860}.tc3 .heat.h2{color:#c9a34e}.tc3 .heat.h3{color:#d08a7a}

.tglist{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.tgrow{display:flex;align-items:center;gap:12px;text-align:left;background:rgba(0,0,0,.26);border:1px solid var(--edge-2);
  color:var(--txt);padding:8px 12px;font-family:var(--serif);cursor:pointer;transition:all .15s}
.tgrow:hover:not(:disabled){border-color:var(--gold);background:rgba(201,163,78,.09)}
.tgrow:disabled{opacity:.4;cursor:not-allowed}
.mface{width:48px;height:48px;flex:0 0 48px;border:1px solid var(--edge-2);overflow:hidden;background:#140f0a}
.mface canvas{width:100%;height:100%;display:block}
.mwho{flex:1;min-width:0}
.mwho b{display:block;font-size:13.5px;color:var(--gold-2);font-weight:500}
.mwho i{display:block;font-size:11px;color:var(--txt-dim);font-style:normal}
.mwho i.dim{color:#7a6a52}
.tgend{margin-left:auto;font-size:11.5px;color:#8a7a5c}
.back{background:none;border:1px solid var(--edge-2);color:var(--txt-dim);font-family:var(--serif);
  font-size:12px;padding:5px 14px;cursor:pointer;margin-top:6px}
.back:hover{color:var(--gold-2);border-color:var(--edge)}

.seal{text-align:center;padding:8px 20px 20px;max-width:620px;margin:0 auto}
.sface{width:120px;height:120px;margin:0 auto 12px;border:1px solid var(--edge);overflow:hidden;background:#140f0a}
.sface canvas{width:100%;height:100%;display:block}
.skick{font-size:10px;letter-spacing:2.6px;text-transform:uppercase;color:#8a7a58}
.seal h1{margin:4px 0 2px;font-size:28px;color:var(--vellum);font-weight:400}
.ssub{font-size:12.5px;color:var(--txt-dim);margin-bottom:16px}
.spay{display:flex;justify-content:center;gap:26px;margin:14px 0 16px;padding:12px 0;border-top:1px solid var(--edge-2);border-bottom:1px solid var(--edge-2)}
.spay div{display:flex;flex-direction:column;gap:2px}
.spay b{font-size:16px;color:var(--gold-2);font-variant-numeric:tabular-nums}
.spay span{font-size:10.5px;color:#7a6a52}
.swarn{font-size:12.5px;color:#c9b092;line-height:1.75;margin:0 0 8px}
.swarn2{font-size:12px;color:#8a7a5c;margin:0 0 18px}
.sbad{color:#d08a7a;font-size:13px;margin:10px 0}
.holdb{position:relative;overflow:hidden;background:rgba(122,31,26,.28);border:1px solid var(--blood-2);color:#e8c8bd;
  font-family:var(--serif);font-size:14px;letter-spacing:1.6px;padding:11px 34px;cursor:pointer;display:block;margin:0 auto 10px}
.holdb i{position:absolute;left:0;top:0;bottom:0;width:0%;background:rgba(168,48,40,.55);transition:width .05s linear;z-index:0}
.holdb span{position:relative;z-index:1}
.holdb:hover{border-color:#d05a48}

/* ---------- modal ---------- */
.p06modal{position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center}
.p06modal .mbg{position:absolute;inset:0;background:rgba(4,3,2,.72)}
.mbox{position:relative;width:min(760px,90%);max-height:82%;overflow-y:auto;background:linear-gradient(170deg,rgba(34,26,17,.99),rgba(20,15,10,.99));
  border:1px solid var(--edge);box-shadow:0 22px 70px rgba(0,0,0,.7);padding:18px 22px}
.mbox.narrow{width:min(460px,88%);text-align:center}
.mhead h3{margin:0;font-size:19px;color:var(--gold-2);font-weight:500}
.mhead .sub{font-size:11.5px;color:#8a7a5c;margin-bottom:10px}
.mwarn{font-size:11.5px;color:#dfae9f;background:rgba(122,31,26,.18);border-left:2px solid var(--blood-2);padding:7px 11px;margin-bottom:12px;line-height:1.6}
.mtxt{font-size:13px;color:var(--txt);line-height:1.7;margin:6px 0 18px}
.mrows{display:flex;flex-direction:column;gap:6px}
.mrow{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:rgba(0,0,0,.25);
  border:1px solid var(--edge-2);padding:8px 12px;font-family:var(--serif);color:var(--txt);cursor:pointer;transition:all .15s}
.mrow:hover{border-color:var(--gold);background:rgba(201,163,78,.09)}
.mreads{margin-left:auto;display:flex;gap:16px;text-align:right}
.mreads .rd span{display:block;font-size:9px;letter-spacing:1.6px;text-transform:uppercase;color:#6a5a44}
.mreads .rd b{display:block;font-size:11.5px;font-weight:400;color:#a8987a;letter-spacing:.6px}
.mreads .rd b.good{color:#9dc07e}
.mreads .rd b.bad{color:#d08a7a}

.mbox.room{width:min(560px,90%)}
.askhead{display:flex;gap:14px;align-items:center;margin-bottom:12px}
.askface{width:88px;height:88px;flex:0 0 88px;border:1px solid var(--edge);overflow:hidden;background:#140f0a}
.askface canvas{width:100%;height:100%;display:block}
.askkick{font-size:9.5px;letter-spacing:2.2px;text-transform:uppercase;color:#8a7a58}
.askhead h3{margin:2px 0 2px;font-size:21px;color:var(--vellum);font-weight:400}
.askhead .sub{font-size:12px;color:var(--txt-dim)}
.askline{font-size:16px;color:var(--gold-2);line-height:1.6;margin:14px 0 10px;padding-left:12px;
  border-left:2px solid var(--edge);font-style:italic}
.asknote{font-size:12.5px;color:#a8987a;line-height:1.7;margin:0 0 14px}
.asknote b{color:var(--vellum)}
.asknote b.bad{color:#d08a7a}
.askcost{display:flex;gap:22px;padding:10px 0;margin-bottom:14px;
  border-top:1px solid var(--edge-2);border-bottom:1px solid var(--edge-2)}
.askcost div{display:flex;flex-direction:column;gap:1px}
.askcost b{font-size:15px;color:var(--gold-2);font-variant-numeric:tabular-nums}
.askcost span{font-size:10px;color:#7a6a52}
.askbtns{display:flex;gap:8px;flex-wrap:wrap}
.askbtns button{flex:1 1 140px;background:rgba(122,31,26,.20);border:1px solid rgba(168,48,40,.45);color:#e8c8bd;
  font-family:var(--serif);font-size:12.5px;padding:9px 12px;cursor:pointer;transition:all .15s;line-height:1.35}
.askbtns button i{display:block;font-style:normal;font-size:10px;color:#a8887a;margin-top:2px}
.askbtns button:hover:not(:disabled){background:rgba(168,48,40,.34);border-color:#d05a48}
.askbtns button:disabled{opacity:.35;cursor:not-allowed}
.mclose{display:block;margin:14px auto 0;background:none;border:1px solid var(--edge-2);color:var(--txt-dim);
  font-family:var(--serif);font-size:12px;padding:5px 16px;cursor:pointer}
.mclose:hover{color:var(--gold-2);border-color:var(--edge)}
`);
}
