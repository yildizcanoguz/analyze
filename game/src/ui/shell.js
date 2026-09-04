// HUD wiring. Reads state, never writes it — every button goes through a sim call.
import { S, ch, ti, pv } from '../core/state.js';
import { on, emit } from '../core/bus.js';
import { fmtDate, seasonOf } from '../core/date.js';
import { setSpeed, pause, resume, pauseReason, SPEEDS } from '../core/clock.js';
import { fullName, age, skills, SKILL_LABEL, opinion, opinionLabel, relation, livingChildren } from '../sim/characters.js';
import { styleOf, primaryTitle, incomeOf, realmLevy, vassalsOf, directCountiesOf, countiesOf, titleName } from '../sim/realm.js';
import { TRAITS } from '../content/traits.js';
import { renderPortrait } from '../render/portrait.js';
import { MODES, applyMapMode } from '../render/mapmodes.js';
import { flyTo } from '../render/camera.js';
import { worldOfProvince, setSelected, setHover } from '../render/mapmesh.js';
import { SFX, resumeAudio } from '../audio/audio.js';
import { esc } from './decision.js';
import { CULTURE_LABEL, FAITH_LABEL } from '../content/names.js';

let prev = { gold: 0, prestige: 0, piety: 0 };

export function initShell() {
  buildModeRail();
  wireClock();
  wireBottom();
  on('clock:day', refreshTop);
  on('clock:pause', refreshClock);
  on('clock:resume', refreshClock);
  on('clock:speed', refreshClock);
  on('sim:month', refreshTop);
  on('player:changed', () => { refreshTop(); applyMapMode(S.ui.mapMode); });
  on('title:granted', () => applyMapMode(S.ui.mapMode));
  refreshTop(); refreshClock();
}

function buildModeRail() {
  const rail = document.getElementById('modeRail');
  rail.innerHTML = '';
  for (const [k, m] of Object.entries(MODES)) {
    const b = document.createElement('button');
    b.textContent = m.label;
    b.dataset.mode = k;
    b.onclick = () => { SFX.click(); applyMapMode(k); syncRail(); };
    rail.appendChild(b);
  }
  addEventListener('keydown', (e) => {
    const hit = Object.entries(MODES).find(([, m]) => m.key === e.key);
    if (hit) { applyMapMode(hit[0]); syncRail(); }
  });
  syncRail();
}
function syncRail() {
  for (const b of document.querySelectorAll('#modeRail button')) b.classList.toggle('on', b.dataset.mode === S.ui.mapMode);
}

function wireClock() {
  for (const b of document.querySelectorAll('.speeds button[data-sp]')) {
    b.onclick = () => { resumeAudio(); SFX.click(); setSpeed(+b.dataset.sp); resume(); };
  }
  document.getElementById('pauseBtn').onclick = () => { resumeAudio(); SFX.click(); S.paused ? resume() : pause('manual'); };
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.target.closest('input,textarea')) { e.preventDefault(); resumeAudio(); S.paused ? resume() : pause('manual'); }
  });
}
function refreshClock() {
  document.getElementById('pauseBtn').classList.toggle('on', S.paused);
  for (const b of document.querySelectorAll('.speeds button[data-sp]')) b.classList.toggle('on', !S.paused && +b.dataset.sp === S.speed);
  const r = pauseReason();
  const note = document.getElementById('pauseNote');
  note.textContent = S.paused ? ({ decision:'karar bekleniyor', reveal:'sonuç', manual:'duraklatıldı', death:'ölüm' }[r] || 'duraklatıldı') : '';
}

export function refreshTop() {
  const p = ch(S.playerId);
  if (!p) return;
  document.getElementById('dateLabel').textContent = fmtDate(S.day);
  document.getElementById('rulerName').textContent = fullName(p);
  document.getElementById('rulerStyle').textContent = styleOf(p);
  p._ageCache = age(p);
  p._rank = primaryTitle(p)?.tier ?? 1;
  renderPortrait(p, document.querySelector('#rulerPortrait canvas'));

  setRes('resGold', Math.floor(p.gold), incomeOf(p.id));
  setRes('resPrestige', Math.floor(p.prestige), null);
  setRes('resPiety', Math.floor(p.piety), null);
  setRes('resLevy', realmLevy(p.id), null);
  refreshClock();
}
function setRes(id, val, rate) {
  const el = document.getElementById(id);
  if (!el) return;
  const b = el.querySelector('b'), em = el.querySelector('em');
  if (b.textContent !== String(val)) { b.textContent = val; }
  if (rate != null) {
    em.textContent = (rate >= 0 ? '+' : '') + rate.toFixed(1);
    em.className = rate >= 0 ? 'pos' : 'neg';
  }
}

function wireBottom() {
  document.getElementById('btnRealm').onclick = () => { SFX.page(); showRealm(); };
  document.getElementById('btnCourt').onclick = () => { SFX.page(); showCourt(); };
  document.getElementById('btnDynasty').onclick = () => { SFX.page(); showDynasty(); };
  document.getElementById('btnChronicle').onclick = () => { SFX.page(); showChronicle(); };
  document.getElementById('rulerChip').onclick = () => { SFX.page(); showChar(S.playerId); };
}

// ---------------------------------------------------------------- province panel
export function showProvince(idx) {
  const meta = S.mapMeta.provinces[idx];
  if (!meta) return hideProvince();
  const p = S.provinces[meta.id];
  const t = ti(`t_${meta.id}`);
  const holder = t?.holderId ? ch(t.holderId) : null;
  const el = document.getElementById('provPanel');
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="phead">
      <div><h3>${esc(p.name)}</h3><div class="sub">${TERRAIN_TR[p.terrain] || p.terrain}${p.coastal ? ' · sahil' : ''}</div></div>
      <button class="close">×</button>
    </div>
    <div class="pbody">
      ${holder ? `<div class="kv"><span>Sahibi</span><span style="cursor:pointer;color:#c9a34e" data-char="${holder.id}">${esc(fullName(holder))}</span></div>` : `<div class="kv"><span>Sahibi</span><span>yok</span></div>`}
      <div class="kv"><span>Kalkınma</span><span>${p.development}</span></div>
      <div class="kv"><span>Kültür</span><span>${CULTURE_LABEL[p.culture] || p.culture}</span></div>
      <div class="kv"><span>İnanç</span><span>${FAITH_LABEL[p.faith] || p.faith}</span></div>
      <div class="kv"><span>Savunma</span><span>+${p.defense}</span></div>
      <div class="kv"><span>Huzursuzluk</span><span style="${p.unrest > 30 ? 'color:#d08a7a' : ''}">${Math.round(p.unrest)}</span></div>
      ${p.occupiedBy ? `<div class="kv"><span style="color:#d08a7a">İşgal altında</span><span>${esc(fullName(ch(p.occupiedBy)))}</span></div>` : ''}
    </div>`;
  el.querySelector('.close').onclick = hideProvince;
  el.querySelector('[data-char]')?.addEventListener('click', (e) => showChar(e.target.dataset.char));
  setSelected(idx);
}
export function hideProvince() { document.getElementById('provPanel').classList.add('hidden'); setSelected(-1); }
const TERRAIN_TR = { plains:'ova', steppe:'bozkır', forest:'orman', hills:'tepelik', mountains:'dağlık', drylands:'kurak', desert:'çöl' };

// ---------------------------------------------------------------- character panel
export function showChar(id) {
  const c = ch(id);
  if (!c) return;
  const p = ch(S.playerId);
  const sk = skills(c);
  const o = opinion(c.id, p.id);
  const el = document.getElementById('charPanel');
  el.classList.remove('hidden');
  c._ageCache = age(c);
  c._rank = primaryTitle(c)?.tier ?? 0;
  el.innerHTML = `
    <div class="phead">
      <div class="portrait" style="width:56px;height:56px"><canvas width="120" height="120"></canvas></div>
      <div><h3>${esc(fullName(c))}</h3><div class="sub">${esc(styleOf(c))} · ${age(c)} ${c.deathDay != null ? '(öldü)' : ''}</div></div>
      <button class="close">×</button>
    </div>
    <div class="pbody">
      <div class="skillgrid">
        ${Object.entries(sk).map(([k, v]) => `<div><b>${v}</b><span>${SKILL_LABEL[k].slice(0, 4)}</span></div>`).join('')}
      </div>
      <div class="traitrow">${(c.traits || []).map((t) => `<span class="trait ${badTrait(t) ? 'bad' : ''}" title="${esc(TRAITS[t]?.desc || '')}">${TRAITS[t]?.icon || ''} ${esc(TRAITS[t]?.name || t)}</span>`).join('')}</div>
      ${c.id !== p.id ? `<div class="kv"><span>Sana bakışı</span><span style="color:${o < -20 ? '#d08a7a' : o > 20 ? '#9dc07e' : '#a8987a'}">${o > 0 ? '+' : ''}${o} · ${opinionLabel(o)}</span></div>` : ''}
      <div class="kv"><span>İlişki</span><span>${relation(p.id, c.id)}</span></div>
      <div class="kv"><span>Kültür / İnanç</span><span>${CULTURE_LABEL[c.culture] || c.culture} · ${FAITH_LABEL[c.faith] || c.faith}</span></div>
      ${c.titles?.length ? `<div class="kv"><span>Unvanlar</span><span>${c.titles.map((t) => esc(titleName(ti(t)))).join(', ')}</span></div>` : ''}
      ${livingChildren(c).length ? `<div style="margin-top:10px;color:#a8987a;font-size:12px">Çocukları</div>
        ${livingChildren(c).map((k) => `<div class="kv"><span style="cursor:pointer;color:#c9a34e" data-char="${k.id}">${esc(k.name)}</span><span>${age(k)}</span></div>`).join('')}` : ''}
      ${memoryLines(c, p)}
    </div>`;
  renderPortrait(c, el.querySelector('.phead canvas'));
  el.querySelector('.close').onclick = () => el.classList.add('hidden');
  for (const a of el.querySelectorAll('[data-char]')) a.addEventListener('click', () => showChar(a.dataset.char));
}
function badTrait(t) { return ['craven','slow','frail','kinslayer','oathbreaker','excommunicated','ill','pox','wounded','humbled','arbitrary','arrogant'].includes(t); }
function memoryLines(c, p) {
  const ms = (c.memoriesOf?.[p.id] || []).slice(-4).reverse();
  if (!ms.length) return '';
  return `<div style="margin-top:12px;color:#a8987a;font-size:12px">Hatırladıkları</div>` +
    ms.map((m) => `<div style="font-size:12px;padding:3px 0;color:${m.delta < 0 ? '#d08a7a' : '#9dc07e'}">${esc(m.text)} <span style="color:#7a6a52">(${m.delta > 0 ? '+' : ''}${m.delta})</span></div>`).join('');
}

// ---------------------------------------------------------------- list panels
function listPanel(title, sub, rows) {
  const el = document.getElementById('charPanel');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="phead"><div><h3>${esc(title)}</h3><div class="sub">${esc(sub)}</div></div><button class="close">×</button></div>
    <div class="pbody">${rows}</div>`;
  el.querySelector('.close').onclick = () => el.classList.add('hidden');
  for (const a of el.querySelectorAll('[data-char]')) a.addEventListener('click', () => showChar(a.dataset.char));
}
function charRow(c, right) {
  return `<div class="kv"><span style="cursor:pointer;color:#c9a34e" data-char="${c.id}">${esc(fullName(c))}</span><span>${right}</span></div>`;
}
export function showRealm() {
  const p = ch(S.playerId);
  const vs = vassalsOf(p.id);
  listPanel('Tebaan', `${countiesOf(p.id).length} kontluk · ${vs.length} vassal`,
    vs.length ? vs.map((v) => { const o = opinion(v.id, p.id); return charRow(v, `<span style="color:${o < -20 ? '#d08a7a' : o > 20 ? '#9dc07e' : '#a8987a'}">${o > 0 ? '+' : ''}${o}</span>`); }).join('')
      : '<div style="color:#a8987a">Kimse sana bağlı değil. Henüz.</div>');
}
export function showCourt() {
  const p = ch(S.playerId);
  const court = Object.values(S.chars).filter((c) => c.deathDay == null && c.courtOf === p.id);
  const roleOf = (id) => Object.entries(S.council || {}).find(([, v]) => v === id)?.[0];
  const ROLE = { chancellor:'Müşavir', marshal:'Serasker', steward:'Defterdar', spymaster:'Casusbaşı', chaplain:'Kadı' };
  listPanel('Sarayın', `${court.length} kişi`,
    court.map((c) => charRow(c, ROLE[roleOf(c.id)] || '')).join('') || '<div style="color:#a8987a">Saray boş.</div>');
}
export function showDynasty() {
  const p = ch(S.playerId);
  const d = S.dynasties[p.dynastyId];
  const mem = Object.values(S.chars).filter((c) => c.dynastyId === p.dynastyId);
  const living = mem.filter((c) => c.deathDay == null);
  listPanel(d?.name || 'Hanedan', `${living.length} yaşayan · ${mem.length - living.length} ölü`,
    living.map((c) => charRow(c, `${age(c)}`)).join(''));
}
export function showChronicle() {
  const rows = S.chronicle.slice(-40).reverse().map((e) =>
    `<div style="padding:5px 0;border-bottom:1px solid rgba(201,163,78,.08);font-size:12.5px;color:${e.tone === 'bad' ? '#d08a7a' : e.tone === 'good' ? '#9dc07e' : '#cfc2a6'}">
      <span style="color:#7a6a52;font-size:11px">${fmtDate(e.day)}</span><br>${esc(e.text)}</div>`).join('');
  listPanel('Vakayiname', 'olan biten', rows || '<div style="color:#a8987a">Henüz bir şey olmadı.</div>');
}
