// ===========================================================================
// P09 — THE REALM SCREEN: the room, and who is in it
// ---------------------------------------------------------------------------
// A vassal list that prints "-42" teaches nothing. This screen answers three
// questions and refuses to answer anything else:
//   who hates you, exactly why (line by line, with the years left on each
//   grudge), and how many swords the men who hate you can actually raise.
//
// Above it sits a banner that never goes away while a faction is alive, because
// a threat you have to go looking for is not a threat.
// ===========================================================================

import { S, ch, ti } from '../core/state.js';
import { on } from '../core/bus.js';
import { fmtDate, YEAR } from '../core/date.js';
import {
  fullName, age, opinion, opinionLabel, skill, relation,
} from '../sim/characters.js';
import {
  styleOf, primaryTitle, vassalsOf, realmLevy, levyOf, countiesOf, titleName, incomeOf,
} from '../sim/realm.js';
import {
  opinionBreakdown, opinionOf, discontent, discontentReason, topGrievance, LINE, opinionInYears,
} from '../sim/opinion.js';
import {
  KIND, factionsAgainst, factionOf, factionPower, loyalPower, factionRatio,
  factionThreat, swordsToThreshold, demandLine, moodOf, charterSummary,
  offerGift, offerOffice, offerBetrothal, offerImprison, offerCharter,
  toolPrice, grantableTitleFor, gen, dat, acc, isLive,
  nominalLevy, daysUntilReady, earliestDemandDay, isRipe,
} from '../sim/factions.js';
import { TRAITS } from '../content/traits.js';
import { CULTURE_LABEL, FAITH_LABEL } from '../content/names.js';
import { renderPortrait } from '../render/portrait.js';
import { css } from './_css.js';
import { openDecisions, commit } from '../sim/decision.js';
import { esc, show as showDecision } from './decision.js';
import { whisper } from './wait.js';
import { SFX } from '../audio/audio.js';

let screenEl = null, bannerEl = null, tipEl = null;
let open = false;
const expanded = new Set();

// ===========================================================================
export function initRealmUI() {
  injectCss();
  buildBanner();
  buildTip();

  // The shell's "Tebaa" button still calls its own list panel; intercept it in
  // the capture phase so the player gets this screen without shell.js changing.
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('#btnRealm');
    if (!b) return;
    e.stopPropagation(); e.preventDefault();
    try { SFX.page(); } catch {}
    toggle();
  }, true);

  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input,textarea')) return;
    if (e.key === 'v' || e.key === 'V') toggle();
    if (e.key === 'Escape' && open) close();
  });
  addEventListener('p09:realm', () => toggle());

  on('faction:signal', ({ text, tone }) => { whisper(text, tone); paintBanner(); });
  on('faction:known', () => { paintBanner(); queueRender(); });
  on('faction:demand', () => paintBanner());
  on('faction:revolt', () => paintBanner());
  on('faction:resolved', () => { paintBanner(); queueRender(); });
  on('faction:shrank', () => { paintBanner(); queueRender(); });
  on('faction:exposed', () => paintBanner());
  on('sim:month', () => { paintBanner(); queueRender(); });
  on('player:changed', () => { paintBanner(); queueRender(); });
  on('decision:offered', () => { if (open) close(); });
  on('world:ready', () => paintBanner());
  paintBanner();

  // handle for the inspection harness — read-only, no game state written here
  window.__p09 = {
    open: () => openScreen(), close, toggle,
    breakdown: (a, b) => opinionBreakdown(a, b),
    verify: () => verifyAll(),
    factions: () => (S.factions || []).map(summarise),
    facesPending: () => faceQueue.length,
    // Test affordance, same spirit as window.__advance: answer whatever decision
    // is on the table so a harness can reach year 1080 without a human hand.
    answer: (key) => {
      const d = openDecisions()[0];
      if (!d) return null;
      const opt = d.options.find((o) => o.key === key && !o.disabled) || d.options.find((o) => !o.disabled);
      if (!opt) return null;
      commit(d.id, opt.key);
      return { title: d.title, chose: opt.key, label: opt.label };
    },
    mood: () => ({ ...(S.factionMood || {}) }),
    // Harness only: re-stage whatever decision is open. A test script that
    // commits through the sim (instead of clicking) leaves P01's modal behind;
    // this puts the real sheet back on screen so it can be photographed.
    clearStage: () => {
      close();
      const dr = document.getElementById('decisionRoot'); if (dr) dr.innerHTML = '';
      const rr = document.getElementById('revealRoot'); if (rr) { rr.innerHTML = ''; rr.className = ''; }
      document.body.classList.remove('staged');
      return true;
    },
    showOpen: () => {
      window.__p09.clearStage();
      const d = openDecisions()[0];
      if (!d) return null;
      showDecision(d);
      return d.title;
    },
    charter: () => charterSummary(),
  };
}

function summarise(f) {
  return {
    id: f.id, kind: f.kind, state: f.state, known: f.known,
    leader: fullName(ch(f.leaderId)),
    target: fullName(ch(f.targetId)),
    pretender: f.pretenderId ? fullName(ch(f.pretenderId)) : null,
    members: f.memberIds.map((id) => fullName(ch(id))),
    power: factionPower(f), loyal: loyalPower(f),
    ratio: +factionRatio(f).toFixed(3), threat: +factionThreat(f).toFixed(3),
    needSwords: swordsToThreshold(f),
    foundedDay: f.founded, ageYears: +((S.day - f.founded) / YEAR).toFixed(1),
    demand: demandLine(f),
    lastSignals: f.joinLog.slice(-3).map((j) => j.text),
  };
}

/** Every breakdown must agree with sim/characters.js#opinion(), or it is lying. */
function verifyAll() {
  const out = { checked: 0, bad: [] };
  const p = ch(S.playerId);
  const people = Object.values(S.chars).filter((c) => c.deathDay == null).slice(0, 400);
  for (const c of people) {
    for (const t of [S.playerId, p?.liegeId].filter(Boolean)) {
      if (c.id === t) continue;
      out.checked++;
      const mine = opinionOf(c.id, t), real = opinion(c.id, t);
      if (mine !== real) out.bad.push({ from: c.id, to: t, mine, real });
    }
  }
  return out;
}

// ===========================================================================
// the banner — the threat you cannot click away
// ===========================================================================
function buildBanner() {
  bannerEl = document.createElement('div');
  bannerEl.id = 'p09banner';
  bannerEl.className = 'hidden';
  bannerEl.onclick = () => { try { SFX.page(); } catch {} openScreen(); };
  document.body.appendChild(bannerEl);
}

export function paintBanner() {
  if (!bannerEl) return;
  const p = ch(S.playerId);
  if (!p) return;
  const fs = factionsAgainst(S.playerId);
  const mine = (S.factions || []).find((f) => isLive(f) && f.memberIds.includes(S.playerId));
  if (!fs.length && !mine) {
    const restless = Object.entries(S.factionMood || {})
      .filter(([id]) => ch(id)?.deathDay == null && ch(id)?.liegeId === S.playerId)
      .sort((a, b) => b[1] - a[1])[0];
    if (restless && restless[1] > 35) {
      bannerEl.className = 'calm';
      bannerEl.innerHTML = `<span class="sig">◇</span><span class="txt">Beylerin arasında bir kıpırtı var</span>
        <span class="sub">${esc(ch(restless[0]).name)} son aylarda az konuşuyor</span>`;
      return;
    }
    bannerEl.className = 'hidden';
    return;
  }
  if (mine && !fs.length) {
    bannerEl.className = 'secret';
    const led = ch(mine.leaderId);
    bannerEl.innerHTML = `<span class="sig">✎</span><span class="txt">${esc(gen(fullName(led)))} kâğıdında senin mührün var</span>
      <span class="sub">${mine.playerSecret ? 'Efendin henüz bilmiyor' : 'Efendin biliyor'} · ${mine.memberIds.length} mühür</span>`;
    return;
  }
  const f = fs.sort((a, b) => factionThreat(b) - factionThreat(a))[0];
  const th = factionThreat(f);
  const led = ch(f.leaderId);
  const hot = f.state === 'demanding' || f.state === 'revolt' || th > 0.75;
  bannerEl.className = hot ? 'hot' : '';
  const label = f.state === 'revolt' ? 'AYAKLANMA'
    : f.state === 'demanding' ? 'FERMAN KAPIDA'
      : f.known ? KIND[f.kind].name.toUpperCase() : 'BİR ŞEYLER DÖNÜYOR';
  const who = f.known ? esc(fullName(led)) : 'adı henüz yok';
  bannerEl.innerHTML = `
    <span class="sig">⚑</span>
    <span class="txt">${label} — ${who}</span>
    <span class="bar"><i style="width:${Math.round(th * 100)}%"></i></span>
    <span class="sub">${factionPower(f)} / ${loyalPower(f)} asker${f.state === 'brewing'
      ? (swordsToThreshold(f) ? ` · eşiğe ${swordsToThreshold(f)} kaldı` : (daysUntilReady(f) ? ` · ${Math.ceil(daysUntilReady(f) / 30)} ay` : ' · hazır'))
      : ''}</span>`;
}

// ===========================================================================
// the screen
// ===========================================================================
// Rebuilding the ledger costs twenty portraits; a fast-forwarded decade must
// not do it once per simulated month.
let renderQueued = 0;
function queueRender() {
  if (!open || renderQueued) return;
  renderQueued = setTimeout(() => { renderQueued = 0; if (open) render(); }, 900);
}

function toggle() { open ? close() : openScreen(); }
export function close() {
  open = false;
  if (screenEl) { screenEl.classList.add('gone'); setTimeout(() => { if (!open && screenEl) screenEl.remove(); screenEl = null; }, 220); }
  hideTip();
}
export function openScreen() {
  if (!screenEl) {
    screenEl = document.createElement('div');
    screenEl.id = 'p09screen';
    document.body.appendChild(screenEl);
  }
  open = true;
  screenEl.classList.remove('gone');
  render();
}

function render() {
  if (!screenEl) return;
  const p = ch(S.playerId);
  if (!p) return;
  const vs = vassalsOf(p.id).filter((v) => v.deathDay == null).sort((a, b) => opinionOf(a.id, p.id) - opinionOf(b.id, p.id));
  const fs = factionsAgainst(p.id);
  const mineF = (S.factions || []).filter((f) => isLive(f) && f.memberIds.includes(p.id));
  const liege = p.liegeId ? ch(p.liegeId) : null;
  const ch_ = charterSummary();

  const total = nominalLevy(p.id);
  const rebel = fs.reduce((s, f) => s + factionPower(f), 0);

  screenEl.innerHTML = `
    <div class="p09sheet">
      <div class="p09head">
        <div>
          <h2>Tebaa ve Fraksiyonlar</h2>
          <div class="p09sub">${esc(fullName(p))} · ${esc(styleOf(p))} · ${fmtDate(S.day)}</div>
        </div>
        <button class="p09close" title="Kapat (Esc)">×</button>
      </div>

      <div class="p09arith">
        <div><b>${total}</b><span>çağırabildiğin asker</span></div>
        <div class="${rebel > 0 ? 'bad' : ''}"><b>${rebel}</b><span>tarafta olan asker</span></div>
        <div><b>${vs.length}</b><span>sana bağlı bey</span></div>
        <div><b>${countiesOf(p.id).length}</b><span>kontluk</span></div>
        ${ch_.taxRelief ? `<div class="bad"><b>−%${ch_.taxRelief}</b><span>ahitname vergisi</span></div>` : ''}
      </div>

      <div class="p09body">
        ${factionsBlock(fs, mineF, p)}
        ${vassalsBlock(vs, p)}
        ${signsBlock()}
        ${liege ? liegeBlock(liege, p) : ''}
      </div>
    </div>`;

  screenEl.querySelector('.p09close').onclick = () => { try { SFX.click(); } catch {} close(); };
  screenEl.onclick = (e) => { if (e.target === screenEl) close(); };
  wire(p);
  paintPortraits();
}

// ---------------------------------------------------------------- factions
function factionsBlock(fs, mineF, p) {
  if (!fs.length && !mineF.length) {
    const restless = vassalsOf(p.id).filter((v) => moodOf(v.id) > 30).sort((a, b) => moodOf(b.id) - moodOf(a.id));
    return `<section class="p09sec">
      <h3>Fraksiyonlar</h3>
      <div class="p09empty">
        Kimse örgütlenmiş değil. ${restless.length
          ? `Ama <b>${esc(restless[0].name)}</b> bir süredir sessiz — ${esc(discontentReason(restless[0].id, p.id).toLowerCase())}.`
          : 'Şimdilik.'}
        ${grantableCharter(p)}
      </div>
    </section>`;
  }
  const cards = [...fs.map((f) => factionCard(f, p, false)), ...mineF.map((f) => factionCard(f, p, true))].join('');
  return `<section class="p09sec"><h3>Fraksiyonlar</h3>${cards}${fs.length ? grantableCharter(p) : ''}</section>`;
}

function grantableCharter(p) {
  return `<div class="p09tools p09toolsWide">
    <button data-tool="charter" title="Kalıcı vergi indirimi ve beylerin kendi mahkemesi">Ahitname ver — kalıcı vergi indirimi</button>
  </div>`;
}

function factionCard(f, p, isMine) {
  const led = ch(f.leaderId);
  const th = factionThreat(f);
  const yrs = ((S.day - f.founded) / YEAR).toFixed(1);
  const members = f.memberIds.map(ch).filter(Boolean);
  const pre = f.pretenderId ? ch(f.pretenderId) : null;
  const signals = f.joinLog.slice(-3).reverse();
  const hints = f.joinLog.filter((x) => !x.founder).slice(-3).reverse();

  // Until it has a name you get the trail, not the conclusion. Joining the dots
  // is the player's job; a game that does it for him has taken the tension away.
  if (!f.known) {
    return `<div class="p09fac rumour">
      <div class="p09facHead">
        <div class="p09face masked">?</div>
        <div class="p09facWho">
          <div class="p09kind">Söylenti <span class="p09flag">adı yok</span></div>
          <div class="p09lead dim">Beylerinden bazıları bir şey konuşuyor</div>
          <div class="p09want">“Ne istediklerini bilmiyorsun. Kaç kişi olduklarını da.”</div>
        </div>
        <div class="p09facAge">${yrs} yıl<span>süredir</span></div>
      </div>
      ${hints.length ? `<div class="p09signals">${hints.map((x) => `<div>“${esc(x.text)}”<span>${fmtDate(x.day)}</span></div>`).join('')}</div>` : ''}
      <div class="p09gnum"><span>Casusun daha fazlasını söyleyemiyor. Bekle ve izle.</span></div>
    </div>`;
  }

  const state = f.state === 'revolt' ? '<span class="p09flag hot">AYAKLANMA</span>'
    : f.state === 'demanding' ? '<span class="p09flag hot">FERMAN KAPIDA</span>' : '';

  return `<div class="p09fac${f.state === 'revolt' || f.state === 'demanding' ? ' hot' : ''}${isMine ? ' mine' : ''}">
    <div class="p09facHead">
      <div class="p09face"><canvas width="128" height="128" data-face="${f.leaderId}"></canvas></div>
      <div class="p09facWho">
        <div class="p09kind">${esc(KIND[f.kind].name)} ${state}</div>
        <div class="p09lead" data-op="${f.leaderId}">${esc(fullName(led))}</div>
        <div class="p09want">“${esc(demandLine(f))}”</div>
        ${pre ? `<div class="p09note">Aday: <b>${esc(fullName(pre))}</b>, ${age(pre)} yaşında${pre.isSibling === p.id ? ' — senin kardeşin' : ''}</div>` : ''}
        ${isMine ? `<div class="p09note mine">Senin mührün de bu kâğıtta. ${f.playerSecret ? 'Efendin henüz bilmiyor.' : '<b>Efendin biliyor.</b>'}</div>` : ''}
      </div>
      <div class="p09facAge">${yrs} yıl<span>örgütleniyor</span></div>
    </div>

    <div class="p09gauge">
      <div class="p09bar"><i style="width:${Math.min(100, Math.round(th * 100))}%"></i><u style="left:100%"></u></div>
      <div class="p09gnum">
        <span><b>${factionPower(f)}</b> asker tarafta</span>
        <span><b>${loyalPower(f)}</b> asker sende</span>
        <span class="${th > 0.7 ? 'bad' : ''}">${f.state !== 'brewing' ? 'eşik aşıldı'
          : swordsToThreshold(f) > 0 ? `eşiğe <b>${swordsToThreshold(f)}</b> asker kaldı`
          : '<b>asker yeter</b> — günü bekliyorlar'}</span>
        ${f.state === 'brewing' ? `<span class="${daysUntilReady(f) ? '' : 'bad'}">${daysUntilReady(f)
          ? `ferman en erken <b>${fmtDate(earliestDemandDay(f))}</b>`
          : (factionRatio(f) >= 0.45 ? '<b>ferman yazıldı bile</b>' : 'ferman için asker yetmiyor — <b>henüz</b>')}</span>` : ''}
      </div>
    </div>

    <div class="p09members">
      ${members.map((m) => `<span class="p09chip${m.id === S.playerId ? ' you' : ''}"${m.id === S.playerId ? '' : ` data-op="${m.id}"`}>${esc(m.id === S.playerId ? 'sen' : m.name)} <b>${nominalLevy(m.id)}</b></span>`).join('')}
    </div>

    ${signals.length ? `<div class="p09signals">${signals.map((x) => `<div>“${esc(x.text)}”<span>${fmtDate(x.day)}</span></div>`).join('')}</div>` : ''}

    ${!isMine ? `<div class="p09tools">
      <button data-tool="gift" data-id="${f.leaderId}">Kese — ${toolPrice('gift', f.leaderId)} altın</button>
      ${grantableTitleFor(f.leaderId) ? `<button data-tool="office" data-id="${f.leaderId}">Yetki ver — ${esc(titleName(grantableTitleFor(f.leaderId)))}</button>` : ''}
      <button data-tool="betroth" data-id="${f.leaderId}">Nikâh bağı</button>
      <button data-tool="prison" data-id="${f.leaderId}" class="danger">Zincire vur</button>
    </div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- vassals
function vassalsBlock(vs, p) {
  if (!vs.length) {
    return `<section class="p09sec"><h3>Tebaan</h3>
      <div class="p09empty">Kimse sana bağlı değil. Bir kontsun; senin de bir efendin var.</div></section>`;
  }
  return `<section class="p09sec"><h3>Tebaan <span>(${vs.length})</span></h3>
    <div class="p09list">${vs.map((v) => vassalRow(v, p)).join('')}</div></section>`;
}

function vassalRow(v, p) {
  const o = opinionOf(v.id, p.id);
  const f = factionOf(v.id);
  const lv = nominalLevy(v.id);
  const mood = moodOf(v.id);
  const t = primaryTitle(v);
  const isOpen = expanded.has(v.id);
  return `<div class="p09row${isOpen ? ' open' : ''}" data-row="${v.id}">
    <div class="p09rowMain" data-toggle="${v.id}">
      <div class="p09faceSm"><canvas width="110" height="110" data-face="${v.id}"></canvas></div>
      <div class="p09rowWho">
        <div class="p09name">${esc(fullName(v))}</div>
        <div class="p09meta">${esc(t ? titleName(t) : styleOf(v))} · ${age(v)} · ${(v.traits || []).slice(0, 3).map((x) => esc(TRAITS[x]?.name || x)).join(', ')}</div>
      </div>
      <div class="p09levy" title="Çağırabildiği asker">⚔ ${lv}</div>
      <div class="p09patience" title="${esc(patienceTip(v, p, mood, f))}">
        <i style="width:${Math.min(100, Math.round((f ? 100 : mood) / 100 * 100))}%" class="${f ? 'done' : mood > 70 ? 'hot' : ''}"></i>
        <span>${f ? 'örgütlendi' : mood < 8 ? 'sakin' : `sabır %${Math.max(0, 100 - Math.round(mood))}`}</span>
      </div>
      <div class="p09op ${opClass(o)}" data-op="${v.id}">${o > 0 ? '+' : ''}${o}<span>${esc(opinionLabel(o))}</span></div>
      <div class="p09badges">
        ${f && f.known ? `<span class="p09flag ${f.state === 'brewing' ? '' : 'hot'}">${esc(KIND[f.kind].short)}</span>` : ''}
        ${f && !f.known ? `<span class="p09flag warm">söylenti</span>` : ''}
        ${!f && mood > 45 ? `<span class="p09flag warm" title="Sabrı tükeniyor">huzursuz</span>` : ''}
        ${v.imprisonedBy ? `<span class="p09flag hot">zindanda</span>` : ''}
      </div>
      <div class="p09caret">${isOpen ? '▾' : '▸'}</div>
    </div>
    ${isOpen ? vassalDetail(v, p, o) : ''}
  </div>`;
}

function patienceTip(v, p, mood, f) {
  if (f) return `${v.name} artık bir tarafın içinde.`;
  if (mood < 8) return `${v.name} yerinden memnun.`;
  const d = discontent(v.id, p.id);
  const months = d > 0.02 ? Math.ceil((100 - mood) / (d * 6)) : 999;
  return `${discontentReason(v.id, p.id)} — bu gidişle ${months > 240 ? 'hiçbir zaman' : `yaklaşık ${months} ay içinde`} birileriyle oturur.`;
}

const MAX_LINES = 9;
function foldLines(lines) {
  if (lines.length <= MAX_LINES + 1) return lines.map(lineRow).join('');
  const head = lines.slice(0, MAX_LINES);
  const tail = lines.slice(MAX_LINES);
  const rest = Math.round(tail.reduce((s2, l) => s2 + l.value, 0));
  return head.map(lineRow).join('') +
    `<div class="p09line rest"><span>${tail.length} küçük kayıt daha</span><b class="${rest < 0 ? 'neg' : 'pos'}">${rest > 0 ? '+' : ''}${rest}</b></div>`;
}

function vassalDetail(v, p, o) {
  const lines = opinionBreakdown(v.id, p.id);
  const in10 = opinionInYears(v.id, p.id, 10);
  const price = toolPrice('gift', v.id);
  const gt = grantableTitleFor(v.id);
  return `<div class="p09detail">
    <div class="p09why">
      <div class="p09whyHead">Neden böyle bakıyor</div>
      ${foldLines(lines) || '<div class="p09line"><span>Hiçbir şey. Sadece kayıtsız.</span></div>'}
      <div class="p09line total"><span>Toplam</span><b class="${opClass(o)}">${o > 0 ? '+' : ''}${o}</b></div>
      <div class="p09line drift"><span>On yıl sonra, hiçbir şey yapmazsan</span><b class="${opClass(in10)}">${in10 > 0 ? '+' : ''}${in10}</b></div>
    </div>
    <div class="p09tools">
      <button data-tool="gift" data-id="${v.id}">Kese — ${price} altın</button>
      ${gt ? `<button data-tool="office" data-id="${v.id}">Yetki ver — ${esc(titleName(gt))}</button>` : ''}
      <button data-tool="betroth" data-id="${v.id}">Nikâh bağı</button>
      <button data-tool="prison" data-id="${v.id}" class="danger">Zincire vur</button>
    </div>
  </div>`;
}

function lineRow(l) {
  const cls = l.value < 0 ? 'neg' : 'pos';
  const times = l.count > 1 ? ` <u>×${l.count}</u>` : '';
  const tail = l.kind === LINE.MEMORY
    ? (l.decaying ? `<em>${l.yearsLeft < 1 ? 'son yılı' : `${Math.round(l.yearsLeft)} yıl kaldı`}</em>` : '<em>hiç geçmez</em>')
    : (l.kind === LINE.CLAMP ? '<em>tavan</em>' : '');
  return `<div class="p09line"><span>${esc(l.label)}${times}</span>${tail}<b class="${cls}">${l.value > 0 ? '+' : ''}${Math.round(l.value)}</b></div>`;
}

// ------------------------------------------------------------------- the trail
// Whispers fade in eleven seconds. A threat you are supposed to watch grow has
// to be re-readable, so every sign is kept here with the date it arrived.
function signsBlock() {
  const rows = (S.chronicle || []).filter((e) => e.kind === 'unrest' || e.kind === 'faction').slice(-12).reverse();
  if (!rows.length) return '';
  return `<section class="p09sec"><h3>İşaretler <span>(son ${rows.length})</span></h3>
    <div class="p09signs">${rows.map((e) => `<div class="${e.kind === 'faction' ? 'hot' : ''}">
      <span>${fmtDate(e.day)}</span>${esc(e.text)}</div>`).join('')}</div></section>`;
}

// ---------------------------------------------------------------- your liege
function liegeBlock(liege, p) {
  const peers = vassalsOf(liege.id).filter((c) => c.id !== p.id && c.deathDay == null)
    .sort((a, b) => opinionOf(a.id, liege.id) - opinionOf(b.id, liege.id)).slice(0, 8);
  const mine = opinionOf(p.id, liege.id);
  const his = opinionOf(liege.id, p.id);
  const g = topGrievance(p.id, liege.id);
  const fs = factionsAgainst(liege.id);
  return `<section class="p09sec"><h3>Senin Efendin</h3>
    <div class="p09liege">
      <div class="p09faceSm"><canvas width="110" height="110" data-face="${liege.id}"></canvas></div>
      <div class="p09rowWho">
        <div class="p09name">${esc(fullName(liege))}</div>
        <div class="p09meta">${esc(styleOf(liege))} · ${age(liege)} · ${esc(nominalLevy(liege.id))} asker</div>
        ${g ? `<div class="p09note">Sen ona bakarken bunu düşünüyorsun: “${esc(g.label)}”</div>` : ''}
      </div>
      <div class="p09op ${opClass(his)}" data-op="${liege.id}:${p.id}">${his > 0 ? '+' : ''}${his}<span>sana bakışı</span></div>
      <div class="p09op ${opClass(mine)}" data-op="${p.id}:${liege.id}">${mine > 0 ? '+' : ''}${mine}<span>senin bakışın</span></div>
    </div>
    ${fs.length ? `<div class="p09note warn">${esc(gen(fullName(liege)))} kapısında ${fs.length} taraf var. En büyüğü ${fs[0].memberIds.length} mühür, ${factionPower(fs[0])} asker.</div>` : ''}
    ${peers.length ? `<div class="p09peerHead">Aynı kapıya bağlı beyler — kimin sabrı tükeniyor</div>
      <div class="p09peers">${peers.map((c) => {
        const oo = opinionOf(c.id, liege.id);
        const ff = factionOf(c.id);
        return `<div class="p09peer" data-op="${c.id}:${liege.id}"><span>${esc(fullName(c))}</span>
          <em>${esc(styleOf(c))}</em>
          <b class="${opClass(oo)}">${oo > 0 ? '+' : ''}${oo}</b>
          ${ff ? `<span class="p09flag ${ff.known ? '' : 'warm'}">${esc(ff.known ? KIND[ff.kind].short : 'söylenti')}</span>` : ''}</div>`;
      }).join('')}</div>` : ''}
  </section>`;
}

// ---------------------------------------------------------------- wiring
function wire(p) {
  for (const el of screenEl.querySelectorAll('[data-toggle]')) {
    el.onclick = () => {
      const id = el.dataset.toggle;
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      try { SFX.click(); } catch {}
      render();
    };
  }
  for (const el of screenEl.querySelectorAll('[data-tool]')) {
    el.onclick = (e) => {
      e.stopPropagation();
      const kind = el.dataset.tool, id = el.dataset.id;
      const fn = { gift: offerGift, office: offerOffice, betroth: offerBetrothal, prison: offerImprison }[kind];
      let r;
      if (kind === 'charter') r = offerCharter(factionsAgainst(S.playerId)[0]?.id || null);
      else r = fn(id);
      if (r && r.ok === false) { whisper(r.why, 'ambiguous'); return; }
      try { SFX.click(); } catch {}
      close();
    };
  }
  for (const el of screenEl.querySelectorAll('[data-op]')) {
    const raw = el.dataset.op;
    const [a, b] = raw.includes(':') ? raw.split(':') : [raw, S.playerId];
    el.onmouseenter = (e) => showTip(a, b, e);
    el.onmousemove = (e) => moveTip(e);
    el.onmouseleave = hideTip;
  }
}

// A face costs a GL render. Twenty faces at once freeze the screen, so they are
// sculpted one per frame: the ledger appears immediately and the room fills in.
let faceQueue = [], facePumping = false;
function paintPortraits() {
  faceQueue = Array.from(screenEl.querySelectorAll('canvas[data-face]'));
  if (!facePumping) { facePumping = true; requestAnimationFrame(pumpFaces); }
}
function pumpFaces() {
  const cv = faceQueue.shift();
  if (!cv) { facePumping = false; return; }
  if (cv.isConnected) {
    const c = ch(cv.dataset.face);
    if (c) {
      c._ageCache = age(c);
      c._rank = primaryTitle(c)?.tier ?? 0;
      try { renderPortrait(c, cv); } catch {}
    }
  }
  requestAnimationFrame(pumpFaces);
}

// ---------------------------------------------------------------- tooltip
function buildTip() {
  tipEl = document.createElement('div');
  tipEl.id = 'p09tip';
  tipEl.className = 'hidden';
  document.body.appendChild(tipEl);
}
function showTip(fromId, toId, e) {
  const lines = opinionBreakdown(fromId, toId);
  const from = ch(fromId), to = ch(toId);
  if (!from || !to) return;
  const tot = opinionOf(fromId, toId);
  tipEl.innerHTML = `<div class="p09tipHead">${esc(fullName(from))} → ${esc(toId === S.playerId ? 'sen' : fullName(to))}</div>` +
    foldLines(lines) +
    `<div class="p09line total"><span>Toplam</span><b class="${opClass(tot)}">${tot > 0 ? '+' : ''}${tot}</b></div>`;
  tipEl.classList.remove('hidden');
  moveTip(e);
}
function moveTip(e) {
  if (!tipEl || tipEl.classList.contains('hidden')) return;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = e.clientX + 16, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 16;
  if (y + h > innerHeight - 8) y = Math.max(8, e.clientY - h - 14);
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
}
function hideTip() { tipEl?.classList.add('hidden'); }

function opClass(o) { return o <= -35 ? 'neg2' : o < -10 ? 'neg' : o >= 35 ? 'pos2' : o > 10 ? 'pos' : 'mid'; }

// ===========================================================================
function injectCss() {
  css('p09-realm', `
/* ---- the banner: a threat you cannot click away ---- */
#p09banner{position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:23;cursor:pointer;
  display:flex;align-items:center;gap:10px;padding:7px 16px;max-width:min(640px,72vw);
  background:linear-gradient(180deg,rgba(30,20,13,.96),rgba(16,11,8,.96));
  border:1px solid var(--edge);border-top:2px solid var(--gold);box-shadow:var(--shadow);
  font-family:var(--serif);color:var(--txt);animation:p09in .5s ease}
#p09banner.hidden{display:none}
#p09banner:hover{border-color:var(--gold-2);background:linear-gradient(180deg,rgba(44,30,18,.97),rgba(22,15,10,.97))}
#p09banner .sig{color:var(--gold);font-size:15px}
#p09banner .txt{font-size:13px;letter-spacing:1.1px;color:var(--gold-2);white-space:nowrap;text-transform:uppercase}
#p09banner .sub{font-size:11.5px;color:var(--txt-dim);white-space:nowrap;font-variant-numeric:tabular-nums}
#p09banner .bar{width:110px;height:4px;background:rgba(0,0,0,.6);position:relative;flex:0 0 auto;overflow:hidden}
#p09banner .bar i{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,var(--gold),var(--gold-2));transition:width .8s ease}
#p09banner.hot{border-top-color:var(--blood-2);animation:p09pulse 2s ease-in-out infinite}
#p09banner.hot .txt{color:#e8b5a8}
#p09banner.hot .bar i{background:linear-gradient(90deg,#8a2a20,#d05a48)}
#p09banner.calm{border-top-color:#6b5a38;opacity:.85}
#p09banner.calm .txt{color:#b8a67e;text-transform:none;letter-spacing:.4px;font-size:12.5px}
#p09banner.secret{border-top-color:#6a5a8a}
#p09banner.secret .txt{color:#b9a8d0}
@keyframes p09pulse{0%,100%{box-shadow:var(--shadow)}50%{box-shadow:var(--shadow),0 0 26px rgba(168,48,40,.5)}}
@keyframes p09in{from{opacity:0;transform:translate(-50%,-10px)}to{opacity:1;transform:translate(-50%,0)}}
body.staged #p09banner{opacity:.10;pointer-events:none;transition:opacity .5s}

/* ---- the screen ---- */
#p09screen{position:fixed;inset:0;z-index:34;display:flex;align-items:flex-start;justify-content:center;
  padding:70px 20px 56px;background:rgba(4,3,2,.86);animation:p09fade .22s ease}
#p09screen.gone{opacity:0;transition:opacity .2s ease;pointer-events:none}
@keyframes p09fade{from{opacity:0}to{opacity:1}}
.p09sheet{width:min(1080px,94vw);max-height:100%;display:flex;flex-direction:column;
  background:linear-gradient(170deg,#1d1710,#14100b);border:1px solid var(--edge);
  box-shadow:var(--shadow);animation:p09rise .3s cubic-bezier(.16,1,.3,1)}
@keyframes p09rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.p09head{display:flex;align-items:center;gap:14px;padding:14px 18px 12px;border-bottom:1px solid var(--edge-2);
  background:linear-gradient(180deg,rgba(201,163,78,.10),transparent)}
.p09head h2{margin:0;font-size:20px;font-weight:500;color:var(--gold-2);letter-spacing:.5px}
.p09sub{font-size:11.5px;color:var(--txt-dim);letter-spacing:.8px;text-transform:uppercase;margin-top:3px}
.p09close{margin-left:auto;background:none;border:none;color:var(--txt-dim);font-size:24px;cursor:pointer;line-height:1;padding:0 4px}
.p09close:hover{color:var(--gold-2)}

.p09arith{display:flex;gap:0;border-bottom:1px solid var(--edge-2);background:rgba(0,0,0,.25)}
.p09arith div{flex:1;padding:9px 14px;border-right:1px solid var(--edge-2);text-align:center}
.p09arith div:last-child{border-right:none}
.p09arith b{display:block;font-size:19px;color:var(--gold-2);font-variant-numeric:tabular-nums}
.p09arith span{font-size:10.5px;color:var(--txt-dim);letter-spacing:.6px;text-transform:uppercase}
.p09arith .bad b{color:#d08a7a}

.p09body{overflow-y:auto;padding:4px 18px 18px}
.p09sec{margin-top:16px}
.p09sec h3{margin:0 0 9px;font-size:12px;letter-spacing:2.6px;text-transform:uppercase;color:#8a7a58;font-weight:500}
.p09sec h3 span{color:#6a5c42}
.p09empty{color:var(--txt-dim);font-size:13px;line-height:1.7;padding:8px 0}
.p09empty b{color:var(--gold-2)}

/* ---- faction card ---- */
.p09fac{border:1px solid var(--edge-2);border-left:3px solid var(--gold);background:rgba(0,0,0,.28);
  padding:12px 14px;margin-bottom:10px}
.p09fac.hot{border-left-color:var(--blood-2);background:rgba(60,18,14,.22)}
.p09fac.mine{border-left-color:#7a6aa8;background:rgba(30,24,46,.28)}
.p09fac.rumour{border-left-color:#6b5a38;border-style:dashed}
.p09face.masked{display:flex;align-items:center;justify-content:center;color:#5d4f36;font-size:30px;
  border:1px dashed rgba(201,163,78,.28)}
.p09lead.dim{color:#9a8a6a;font-style:italic;font-size:15px}
.p09facHead{display:flex;gap:12px;align-items:flex-start}
.p09face{width:62px;height:62px;flex:0 0 auto;border:1px solid var(--edge);background:#1a140e;overflow:hidden;
  box-shadow:inset 0 0 18px rgba(0,0,0,.7)}
.p09face canvas{width:100%;height:100%;display:block}
.p09facWho{flex:1;min-width:0}
.p09kind{font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:#8a7a58;margin-bottom:2px}
.p09lead{font-size:16px;color:var(--gold-2);cursor:default}
.p09want{font-size:13px;color:var(--txt);font-style:italic;margin-top:3px;line-height:1.5}
.p09note{font-size:12px;color:var(--txt-dim);margin-top:4px;line-height:1.6}
.p09note b{color:var(--gold-2)}
.p09note.mine{color:#c3b0e0}
.p09note.warn{color:#d5a294;margin-top:8px}
.p09facAge{text-align:right;font-size:15px;color:var(--gold-2);font-variant-numeric:tabular-nums;flex:0 0 auto}
.p09facAge span{display:block;font-size:9.5px;color:var(--txt-dim);letter-spacing:.8px;text-transform:uppercase}

.p09gauge{margin:10px 0 8px}
.p09bar{height:7px;background:rgba(0,0,0,.6);position:relative;border:1px solid rgba(201,163,78,.14)}
.p09bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#7a6a2e,var(--gold-2));transition:width .6s ease}
.p09bar u{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--blood-2);transform:translateX(-1px)}
.p09fac.hot .p09bar i{background:linear-gradient(90deg,#8a2a20,#d05a48)}
.p09gnum{display:flex;gap:18px;margin-top:6px;font-size:11.5px;color:var(--txt-dim);flex-wrap:wrap}
.p09gnum b{color:var(--gold-2);font-variant-numeric:tabular-nums}
.p09gnum .bad,.p09gnum .bad b{color:#d08a7a}

.p09members{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}
.p09chip{font-size:11.5px;padding:3px 9px;border:1px solid var(--edge-2);background:rgba(201,163,78,.06);color:var(--txt)}
.p09chip b{color:var(--gold-2);font-variant-numeric:tabular-nums}
.p09chip.you{border-color:#7a6aa8;background:rgba(90,74,150,.18);color:#c3b0e0}

.p09signals{margin:8px 0 4px;border-left:2px solid var(--edge-2);padding-left:10px}
.p09signals div{font-size:12px;color:#bdae8e;font-style:italic;line-height:1.6;padding:2px 0}
.p09signals span{font-style:normal;color:#6a5c42;font-size:10.5px;margin-left:8px}

.p09tools{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;align-items:flex-start;align-content:flex-start}
.p09tools button{flex:0 0 auto;align-self:flex-start;background:rgba(0,0,0,.35);border:1px solid var(--edge-2);color:var(--txt-dim);
  padding:6px 12px;font-family:var(--serif);font-size:12px;cursor:pointer;letter-spacing:.3px;transition:all .15s}
.p09tools button:hover{border-color:var(--edge);color:var(--gold-2);background:rgba(201,163,78,.10)}
.p09tools button.danger{border-color:rgba(168,48,40,.35);color:#c08878}
.p09tools button.danger:hover{border-color:var(--blood-2);color:#e8b5a8;background:rgba(122,31,26,.22)}
.p09toolsWide{margin-top:6px}

/* ---- vassal rows ---- */
.p09list{border-top:1px solid var(--edge-2)}
.p09row{border-bottom:1px solid rgba(201,163,78,.08)}
.p09rowMain{display:flex;align-items:center;gap:11px;padding:7px 4px;cursor:pointer}
.p09rowMain:hover{background:rgba(201,163,78,.06)}
.p09faceSm{width:40px;height:40px;flex:0 0 auto;border:1px solid var(--edge-2);background:#1a140e;overflow:hidden}
.p09faceSm canvas{width:100%;height:100%;display:block}
.p09face,.p09faceSm{background:radial-gradient(circle at 38% 34%, #3a2a1a, #140e09 70%)}
.p09rowWho{flex:1;min-width:0}
.p09name{font-size:14px;color:var(--gold-2)}
.p09meta{font-size:11.5px;color:var(--txt-dim);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p09levy{font-size:12.5px;color:var(--txt-dim);font-variant-numeric:tabular-nums;width:66px;text-align:right;flex:0 0 auto}
.p09op{width:74px;flex:0 0 auto;text-align:right;font-size:16px;font-variant-numeric:tabular-nums;cursor:help}
.p09op span{display:block;font-size:10px;letter-spacing:.5px;color:var(--txt-dim);text-transform:uppercase}
.p09op.neg2{color:#d0705e}.p09op.neg{color:#c09080}.p09op.mid{color:#a8987a}
.p09op.pos{color:#a8bb8a}.p09op.pos2{color:#8fc06e}
.p09patience{width:92px;flex:0 0 auto;cursor:help}
.p09patience i{display:block;height:4px;background:linear-gradient(90deg,#6b5a38,var(--gold));transition:width .8s ease}
.p09patience i.hot{background:linear-gradient(90deg,#8a4a20,#d05a48)}
.p09patience i.done{background:var(--blood-2)}
.p09patience span{display:block;font-size:9.5px;color:var(--txt-dim);letter-spacing:.4px;margin-top:3px;
  border-top:1px solid rgba(201,163,78,.10);padding-top:2px}
.p09badges{width:96px;flex:0 0 auto;display:flex;gap:4px;justify-content:flex-end}
.p09caret{width:14px;flex:0 0 auto;color:#6a5c42;font-size:11px}
.p09flag{font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;padding:2px 6px;border:1px solid var(--edge-2);
  color:#b8a67e;background:rgba(201,163,78,.07);white-space:nowrap}
.p09flag.hot{border-color:var(--blood-2);color:#e8b5a8;background:rgba(122,31,26,.25)}
.p09flag.warm{border-color:#7a6a3a;color:#cbbd97}

.p09detail{padding:4px 4px 14px 55px;display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start;animation:p09fade .2s ease}
.p09why{flex:1;min-width:300px}
.p09whyHead{font-size:10.5px;letter-spacing:2px;text-transform:uppercase;color:#8a7a58;margin-bottom:5px}
.p09line{display:flex;align-items:baseline;gap:8px;font-size:12.5px;padding:2.5px 0;
  border-bottom:1px solid rgba(201,163,78,.06);line-height:1.5}
.p09line span{flex:1;color:var(--txt)}
.p09line em{font-style:normal;font-size:10.5px;color:#6a5c42;letter-spacing:.4px;white-space:nowrap}
.p09line b{width:44px;text-align:right;font-variant-numeric:tabular-nums;flex:0 0 auto}
.p09line b.neg{color:#d0705e}.p09line b.pos{color:#8fc06e}
.p09line.total{margin-top:5px;border-top:1px solid var(--edge-2);border-bottom:none;padding-top:6px}
.p09line.total span{color:var(--gold-2);letter-spacing:.5px}
.p09line.total b{font-size:15px}
.p09line u{text-decoration:none;color:#8a7a58;font-size:11px}
.p09line.rest span{color:var(--txt-dim);font-style:italic}
.p09line.drift{border-bottom:none;opacity:.72}
.p09line.drift span{color:var(--txt-dim);font-style:italic}
.p09line b.neg2{color:#d0705e}.p09line b.pos2{color:#8fc06e}.p09line b.mid{color:#a8987a}

/* ---- the trail of signs ---- */
.p09signs{border-top:1px solid var(--edge-2)}
.p09signs div{font-size:12.5px;color:#bdae8e;line-height:1.65;padding:4px 0;
  border-bottom:1px solid rgba(201,163,78,.06);font-style:italic}
.p09signs div.hot{color:#dfae9f;font-style:normal}
.p09signs span{font-style:normal;color:#6a5c42;font-size:10.5px;margin-right:10px;
  font-variant-numeric:tabular-nums;display:inline-block;min-width:104px}

/* ---- liege block ---- */
.p09liege{display:flex;align-items:center;gap:12px;padding:8px 4px;border-top:1px solid var(--edge-2);border-bottom:1px solid var(--edge-2)}
.p09peerHead{font-size:10.5px;letter-spacing:1.6px;text-transform:uppercase;color:#8a7a58;margin:10px 0 4px}
.p09peers{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:2px 16px}
.p09peer{display:flex;align-items:baseline;gap:8px;font-size:12.5px;padding:3px 0;border-bottom:1px solid rgba(201,163,78,.06)}
.p09peer span:first-child{color:var(--txt)}
.p09peer em{font-style:normal;font-size:11px;color:#6a5c42;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p09peer b{font-variant-numeric:tabular-nums}
.p09peer b.neg2{color:#d0705e}.p09peer b.neg{color:#c09080}.p09peer b.mid{color:#a8987a}
.p09peer b.pos,.p09peer b.pos2{color:#8fc06e}

/* ---- tooltip ---- */
#p09tip{position:fixed;z-index:95;pointer-events:none;width:330px;padding:10px 12px;
  background:rgba(16,11,7,.985);border:1px solid var(--edge);box-shadow:var(--shadow);font-family:var(--serif)}
#p09tip.hidden{display:none}
.p09tipHead{font-size:12px;color:var(--gold-2);letter-spacing:.6px;margin-bottom:6px;
  padding-bottom:5px;border-bottom:1px solid var(--edge-2)}
`);
}
