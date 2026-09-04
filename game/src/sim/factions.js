// ===========================================================================
// P09 — FACTIONS: discontent that organises itself
// ---------------------------------------------------------------------------
// A vassal who merely dislikes you is decoration. A vassal who dislikes you,
// finds three others who do, counts their swords out loud for four years and
// then nails a demand to your gate is an antagonist.
//
// Three rules govern everything here:
//   1. Nothing is born in a day. A faction takes years, and every step of those
//      years leaks to the player as a named, concrete rumour.
//   2. Every tool the player has costs something BEFORE the outcome is known,
//      and the heaviest tools cost something that never comes back.
//   3. The arithmetic is public. The player must always be able to see how many
//      swords are on the other side and how many are still his.
// ===========================================================================

import { S, rng, newId, ch, alive } from '../core/state.js';
import { emit } from '../core/bus.js';
import { YEAR, fromDay, fmtDate } from '../core/date.js';
import {
  fullName, age, remember, opinionLabel, skill, isKin,
  livingChildren, relation, traitAi,
} from './characters.js';
import {
  vassalsOf, realmLevy, levyOf, primaryTitle, titleName, styleOf,
  directCountiesOf, grantTitle, TIER, topLiege,
} from './realm.js';
import { offer, STAKE, openDecisions } from './decision.js';
import { opinionOf, discontent, discontentReason, topGrievance } from './opinion.js';

// --------------------------------------------------------------------- tuning
const MOOD_TO_FOUND = 100;      // ~18 months of grievance before anyone acts
const MOOD_GAIN = 6;            // per month, at maximum discontent
const DEMAND_RATIO = 0.45;      // rebel swords / all swords -> the gate is nailed
const MAX_FACTIONS = 8;
const KNOW_AFTER_DAYS = 240;    // rumours for eight months, then names
const MIN_BREW_DAYS = 3 * YEAR; // a faction that can demand in its first year is a popup
const MIN_MEMBERS_TO_DEMAND = 2;

export const KIND = {
  claimant: {
    id: 'claimant', name: 'Taht İddiası', short: 'taht',
    banner: 'Başka bir kanı tahtta görmek istiyorlar.',
  },
  independence: {
    id: 'independence', name: 'Bağımsızlık', short: 'ayrılık',
    banner: 'Senin mührünü taşımak istemiyorlar.',
  },
  privilege: {
    id: 'privilege', name: 'İmtiyaz', short: 'ahitname',
    banner: 'Vergiden ve kanundan muafiyet istiyorlar.',
  },
};

// ------------------------------------------------------------------ state init
function ensure() {
  if (!Array.isArray(S.factions)) S.factions = [];
  if (!S.factionMood) S.factionMood = {};                 // charId -> 0..~140
  if (!S.charter) S.charter = { taxRelief: 0, autonomy: 0, granted: [] };
}

// ------------------------------------------------------------ Turkish suffixes
// Names are the whole point of this piece; a name with the wrong suffix reads
// like a translation, and translations have no weight.
const VOW = 'aeıioöuüAEIİOÖUÜ';
function lastVowel(s) { for (let i = s.length - 1; i >= 0; i--) if (VOW.includes(s[i])) return s[i].toLowerCase(); return 'e'; }
const endsVowel = (s) => VOW.includes(s[s.length - 1]);
export function gen(n) { const v = lastVowel(n), b = 'aıou'.includes(v), r = 'ouöü'.includes(v); return `${n}'${endsVowel(n) ? 'n' : ''}${b ? (r ? 'un' : 'ın') : (r ? 'ün' : 'in')}`; }
export function dat(n) { const v = lastVowel(n), b = 'aıou'.includes(v); return `${n}'${endsVowel(n) ? 'y' : ''}${b ? 'a' : 'e'}`; }
export function acc(n) { const v = lastVowel(n), b = 'aıou'.includes(v), r = 'ouöü'.includes(v); return `${n}'${endsVowel(n) ? 'y' : ''}${b ? (r ? 'u' : 'ı') : (r ? 'ü' : 'i')}`; }

// ------------------------------------------------------------------- accessors
export function factionsAgainst(charId) { ensure(); return S.factions.filter((f) => f.targetId === charId && isLive(f)); }
export function factionOf(charId) { ensure(); return S.factions.find((f) => f.memberIds.includes(charId) && isLive(f)) || null; }
export function factionById(id) { ensure(); return S.factions.find((f) => f.id === id) || null; }
export function isLive(f) { return f.state === 'brewing' || f.state === 'demanding' || f.state === 'revolt'; }
export function moodOf(charId) { ensure(); return S.factionMood[charId] || 0; }

/**
 * Every sword under a man, whether he likes his liege or not.
 * realmLevy() discounts by opinion, which would make an angry vassal count as
 * zero swords for his liege AND full swords for the faction — the same men on
 * both sides of the subtraction. Rebellion arithmetic has to be conserved.
 */
export function nominalLevy(charId, seen = null) {
  const s0 = seen || new Set();
  if (s0.has(charId)) return 0;          // a liege loop must not eat the stack
  s0.add(charId);
  let lv = levyOf(charId);
  for (const v of vassalsOf(charId)) lv += nominalLevy(v.id, s0);
  return Math.round(lv);
}
/** Swords the faction can actually put in a field. */
export function factionPower(f) {
  let p = 0;
  for (const id of f.memberIds) if (alive(id)) p += nominalLevy(id);
  return Math.round(p);
}
/** Swords still answering the target's summons. */
export function loyalPower(f) {
  return Math.max(0, Math.round(nominalLevy(f.targetId) - factionPower(f)));
}
/** The earliest day this cause could nail anything to a gate. */
export function earliestDemandDay(f) { return f.founded + MIN_BREW_DAYS; }
export function daysUntilReady(f) { return Math.max(0, earliestDemandDay(f) - S.day); }
export function isRipe(f) { return S.day >= earliestDemandDay(f) && f.memberIds.length >= MIN_MEMBERS_TO_DEMAND; }
export function factionRatio(f) {
  const r = factionPower(f), l = loyalPower(f);
  return r / Math.max(1, r + l);
}
/** 0..1 — how close the gate is to having a paper nailed to it. */
export function factionThreat(f) { return Math.max(0, Math.min(1, factionRatio(f) / DEMAND_RATIO)); }
export function swordsToThreshold(f) {
  const l = loyalPower(f), r = factionPower(f);
  const need = (DEMAND_RATIO * (r + l) - r) / (1 - DEMAND_RATIO);
  return Math.max(0, Math.round(need));
}

export function demandLine(f) {
  const led = ch(f.leaderId);
  const pre = f.pretenderId ? ch(f.pretenderId) : null;
  if (f.kind === 'claimant') return `${pre ? fullName(pre) : 'bir başkası'} tahta otursun.`;
  if (f.kind === 'independence') { const t = secessionTitle(f); return `${t ? titleName(t) : 'Toprakları'} senin mühründen çıksın.`; }
  return 'Vergi indirilsin, kanun beylerin lehine değişsin.';
}

// ===========================================================================
// the heartbeat
// ===========================================================================
let lastMonth = null;

export function tickFactions(day) {
  ensure();
  const m = fromDay(day).m;
  if (m !== lastMonth) { lastMonth = m; monthly(day); }
  // A demand that could not be delivered (another decision was on the table)
  // keeps knocking. The envoy does not go home.
  for (const f of S.factions) {
    if (f.state === 'demanding' && !f.demandOffered && day >= (f.nextDemandDay || 0)) tryDeliverDemand(f, day);
    if (f.pendingInvite && f.targetId !== S.playerId) tryDeliverInvite(f, day);
  }
}

function monthly(day) {
  reapDead(day);
  brew(day);
  for (const f of S.factions) {
    if (!isLive(f)) continue;
    recruit(f, day);
    reveal(f, day);
    if (f.state === 'brewing' && isRipe(f) && factionRatio(f) >= DEMAND_RATIO) startDemand(f, day);
    if (f.state === 'revolt') burn(f, day);
    if (f.playerSecret) leakPlayerSecret(f, day);
  }
  cool(day);
}

// --- 1. the dead ------------------------------------------------------------
function reapDead(day) {
  for (const f of S.factions) {
    if (!isLive(f)) continue;
    f.memberIds = f.memberIds.filter((id) => alive(id));
    if (f.pretenderId && !alive(f.pretenderId)) {
      // the whole point of the faction just died in his bed
      dissolve(f, `${gen(ch(f.pretenderId)?.name || 'Adayları')} ölümüyle dağıldı.`, day);
      continue;
    }
    if (!alive(f.leaderId) || !f.memberIds.length) {
      const next = f.memberIds.filter((id) => alive(id)).sort((a, b) => nominalLevy(b) - nominalLevy(a))[0];
      if (!next) { dissolve(f, 'Elebaşısı olmayan bir taraf dağılır.', day); continue; }
      const oldName = ch(f.leaderId)?.name || 'Elebaşı';
      f.leaderId = next;
      signal(f, `${gen(oldName)} yerine ${fullName(ch(next))} geçti. Mühür el değiştirdi, dava değişmedi.`, 'bad', day);
    }
    if (!alive(f.targetId)) {
      // your father's enemies do not bury themselves with him
      const newTarget = ch(f.memberIds[0])?.liegeId || null;
      if (newTarget && alive(newTarget)) {
        f.targetId = newTarget;
        for (const id of f.memberIds) S.factionMood[id] = (S.factionMood[id] || 0) * 0.55;
        signal(f, `Yeni efendiye bir mühlet verdiler. Bir mühlet, af değildir.`, 'ambiguous', day);
      } else dissolve(f, 'Hedefleri toprağın altında.', day);
    }
  }
  S.factions = S.factions.filter((f) => isLive(f) || (day - (f.endedDay || 0)) < 3 * YEAR);
}

// --- 2. grievance accumulates, then someone acts ----------------------------
function brew(day) {
  if (S.factions.filter(isLive).length >= MAX_FACTIONS) return;
  const lieges = candidateLieges();
  for (const liegeId of lieges) {
    const vs = vassalsOf(liegeId).filter((v) => v.deathDay == null && age(v) >= 16);
    if (vs.length < 2) continue;
    for (const v of vs) {
      if (v.id === S.playerId) continue;          // the player joins; he is never conscripted
      const d = discontent(v.id, liegeId);
      const cur = S.factionMood[v.id] || 0;
      const gain = d * MOOD_GAIN * (1 + (S.charter.autonomy || 0) * 0.30) - (d < 0.12 ? 5 : 0);
      const next = Math.max(0, Math.min(150, cur + gain));
      S.factionMood[v.id] = next;
      leakPatience(v, liegeId, cur, next, vs, day);
      if (next < MOOD_TO_FOUND) continue;
      if (factionOf(v.id)) continue;
      const existing = factionsAgainst(liegeId);
      // join an existing cause rather than splintering — one cause is scarier
      if (existing.length) { join(existing[0], v.id, day, true); S.factionMood[v.id] = 40; continue; }
      if (S.factions.filter(isLive).length >= MAX_FACTIONS) return;
      found(v, liegeId, day);
      S.factionMood[v.id] = 40;
    }
  }
}

// ---------------------------------------------------------------------------
// The leak, before there is anything to leak.
// A faction that announces itself the day it is founded is a jump scare. What
// the player must get, months earlier, is a man behaving oddly with another
// man — and the job of joining those two facts is the player's, not the game's.
// ---------------------------------------------------------------------------
const PATIENCE_MARKS = [30, 55, 80];

function leakPatience(v, liegeId, before, after, peers, day) {
  const mark = PATIENCE_MARKS.find((m) => before < m && after >= m);
  if (mark == null) return;
  const seen = ch(liegeId);
  const isPlayers = liegeId === S.playerId;
  // his liege's other malcontents: the man he would be sitting with
  const partner = peers
    .filter((x) => x.id !== v.id && x.deathDay == null && (S.factionMood[x.id] || 0) > 20)
    .sort((a, b) => (S.factionMood[b.id] || 0) - (S.factionMood[a.id] || 0))[0];
  const text = patienceLine(mark, v, partner, seen);
  if (!text) return;
  S.chronicle.push({ day, kind: 'unrest', tone: 'ambiguous', text, charId: v.id });
  if (isPlayers) emit('faction:signal', { factionId: null, text, tone: 'ambiguous', charId: v.id });
  else if (ch(S.playerId)?.liegeId === liegeId && rng.chance(0.5)) {
    emit('faction:signal', { factionId: null, text, tone: 'ambiguous', charId: v.id });
  }
}

/** Three stages: he withdraws, he is seen with someone, he starts buying iron. */
function patienceLine(mark, v, partner, liege) {
  const n = v.name;
  if (mark === PATIENCE_MARKS[0]) {
    return rng.pick([
      `${n} bu kış divana gelmedi. Hastaymış — ama aynı hafta avdaymış.`,
      `${gen(n)} vergisi tam geldi, mektubu gelmedi. Yirmi yıldır her keseyle bir mektup gelirdi.`,
      `${n} sofrada senin sağına oturmayı bıraktı. Kimse yerini değiştirmesini istemedi.`,
      `${gen(n)} kâhyası bu ay iki kez senin kâtibine sordu: "Kanun tam olarak ne diyor?"`,
      `${n} bir mektubu senin ulağınla değil, kendi adamıyla yolladı. Yol aynı yol.`,
    ]);
  }
  if (mark === PATIENCE_MARKS[1]) {
    if (!partner) {
      return rng.pick([
        `${n} bu ay üç kez sınırı geçti. Nereye gittiğini söyleyen yok.`,
        `${gen(n)} kalesinde bu hafta beş at fazla vardı. Beş at, beş misafir demektir.`,
        `${n} kızını uzaktaki bir beyle nişanladı. Sana danışılmadı, haber bile geç geldi.`,
      ]);
    }
    const q = partner.name;
    return rng.pick([
      `${n} bu ay üç kez ${gen(q)} kalesine gitti. Dördüncüsünde geceyi orada geçirdi.`,
      `${n} ile ${q} aynı gece aynı handa kaldı. Han sahibi kimseyi hatırlamıyor.`,
      `${gen(q)} düğününde ${n} baş köşede oturdu. Sen çağrılmadın.`,
      `${gen(n)} oğlu ${gen(q)} yanına "terbiye görmeye" gönderildi. Bunu sana kimse sormadı.`,
      `${n} ile ${q} kışın ortasında aynı gün ava çıkmış. İkisi de av getirmemiş.`,
    ]);
  }
  return rng.pick([
    `${gen(v.name)} demircisi bu ay kırk mızrak demiri ısmarlamış. Sipariş senin defterine düşmedi.`,
    `${gen(v.name)} ambarları dolu. Kışa daha çok var, hasada da.`,
    `${v.name} kalesinin surunda üç gündür taşçı çalışıyor. Duvar sağlamdı.`,
    `${gen(v.name)} adamları bu ay iki kez teçhizatlı geçtiler. Kimse kimseye bakmadı.`,
    `${v.name} bu sabah sana selam verdi — önce verdi, eğilmeden. Fark ettin.`,
  ]);
}

/** Only lieges that can matter to the player: him, and everyone above him. */
function candidateLieges() {
  const out = new Set();
  if (S.playerId) {
    out.add(S.playerId);
    let c = ch(S.playerId), guard = 0;
    while (c?.liegeId && guard++ < 8) { out.add(c.liegeId); c = ch(c.liegeId); }
  }
  return [...out];
}

function found(founder, liegeId, day) {
  const kind = pickKind(founder, liegeId);
  const f = {
    id: newId('fx'),
    kind: kind.id,
    targetId: liegeId,
    leaderId: founder.id,
    pretenderId: kind.pretenderId || null,
    demandTitleId: kind.demandTitleId || null,
    memberIds: [founder.id],
    joinLog: [{ day, charId: founder.id, text: `${fullName(founder)} ilk mührü bastı.` }],
    founded: day,
    known: false,
    knownDay: null,
    state: 'brewing',
    demandOffered: false,
    lastSignalDay: day,
    playerSecret: false,
    concessions: [],
    endedDay: null,
    reason: discontentReason(founder.id, liegeId),
  };
  S.factions.push(f);
  emit('faction:formed', { faction: f, hidden: true });
  if (liegeId === S.playerId) {
    signal(f, rumourLine(day), 'ambiguous', day);
  }
  S.chronicle.push({ day, kind: 'faction', tone: 'bad', text: `${fullName(founder)} sessizce bir taraf kurdu.` });
}

function pickKind(founder, liegeId) {
  const liege = ch(liegeId);
  // 1. a pretender with real blood: someone of the liege's dynasty who was passed over
  const pretenders = Object.values(S.chars).filter((c) =>
    c.deathDay == null && c.id !== liegeId && age(c) >= 16 &&
    (c.dynastyId === liege?.dynastyId || c.isSibling === liegeId) &&
    (c.id !== S.playerId));
  if (pretenders.length && discontent(founder.id, liegeId) > 0.45 && rng.chance(0.45)) {
    const pre = rng.weighted(pretenders.map((c) => ({ c, w: 1 + Math.max(0, traitAi(c, 'claim')) * 4 + (c.isSibling === liegeId ? 3 : 0) })), (x) => x.w).c;
    return { id: 'claimant', pretenderId: pre.id };
  }
  // 2. a man with his own land and his own tongue wants out
  const own = primaryTitle(founder);
  const differs = founder.culture !== liege?.culture || founder.faith !== liege?.faith;
  const held = liegeTitleOver(founder.id, liegeId);
  if (own && held && (own.tier >= TIER.duchy || differs) && rng.chance(differs ? 0.65 : 0.30)) {
    return { id: 'independence', demandTitleId: held.id };
  }
  // 3. everyone else just wants to pay less and be judged by nobody
  return { id: 'privilege' };
}

/** The title the target actually holds that sits over this man's land. */
function liegeTitleOver(charId, liegeId) {
  const own = primaryTitle(ch(charId));
  let t = own?.dejureLiege ? S.titles[own.dejureLiege] : null;
  let guard = 0;
  while (t && guard++ < 8) {
    if (t.holderId === liegeId) return t;
    t = t.dejureLiege ? S.titles[t.dejureLiege] : null;
  }
  return null;
}
/** Re-resolved at demand time: land changes hands while a cause brews. */
function secessionTitle(f) {
  const named = f.demandTitleId ? S.titles[f.demandTitleId] : null;
  if (named && named.holderId === f.targetId) return named;
  for (const id of f.memberIds) {
    const t = liegeTitleOver(id, f.targetId);
    if (t) return t;
  }
  return null;
}

// --- 3. recruitment: one man a month, and every one of them leaks ------------
function recruit(f, day) {
  const pool = vassalsOf(f.targetId).filter((v) =>
    v.deathDay == null && age(v) >= 16 && !f.memberIds.includes(v.id) && v.id !== S.playerId && !v.imprisonedBy);
  if (!pool.length) return;
  const led = ch(f.leaderId);
  const pull = 0.030 + skill(led, 'diplomacy') * 0.003 + f.memberIds.length * 0.004 + (S.charter.autonomy || 0) * 0.015;
  const cands = pool.map((v) => ({ v, w: discontent(v.id, f.targetId) }));
  const hot = cands.filter((x) => x.w > 0.12);
  if (!hot.length) return;
  const pick = rng.weighted(hot, (x) => x.w);
  if (!rng.chance(Math.min(0.17, pick.w * pull * 3.2))) return;
  join(f, pick.v.id, day, false);
}

function join(f, charId, day, self) {
  if (f.memberIds.includes(charId)) return;
  f.memberIds.push(charId);
  const c = ch(charId), led = ch(f.leaderId);
  const line = joinLine(c, led, day);
  f.joinLog.push({ day, charId, text: line });
  emit('faction:joined', { faction: f, charId });
  if (f.targetId === S.playerId) signal(f, f.known ? line : rumourLine(day), f.known ? 'bad' : 'ambiguous', day);
}

/** The leak. Never "a vassal joined a faction" — always a man doing a thing. */
function joinLine(c, led, day) {
  const n = c.name, l = led.name;
  return rng.pick([
    `${n} bu ay üç kez ${gen(l)} kalesine gitti. Dördüncüsünde geceyi orada geçirdi.`,
    `${gen(n)} mührü ${gen(l)} sofrasındaki bir kâğıdın altında görülmüş. Kâğıdı kimse okuyamamış.`,
    `${n} bu kış vergisini eksik yolladı. Kâhyan sormaya korkuyor.`,
    `${gen(l)} düğününde ${n} baş köşede oturdu. Sen çağrılmadın.`,
    `${n} ile ${l} aynı gece aynı handa kaldı. Han sahibi hiçbir şey hatırlamıyor.`,
    `${gen(n)} adamları ${gen(l)} sancağı altında av yapıyor. Av mevsimi değil.`,
    `${n} kilerini boşaltıp tahıl aldı. Kışa daha çok var.`,
    `${gen(n)} oğlu ${gen(l)} yanına "terbiye görmeye" gönderildi. Kimse bunu sana danışmadı.`,
  ]);
}
function rumourLine(day) {
  return rng.pick([
    'Beylerinden biri bu ay iki kez sınırı geçti. Kimin yanına gittiğini söylemiyorlar.',
    'Divanda bir sandalye boş kaldı. Sebebi sorulduğunda herkes başka yere baktı.',
    'Bir ulak gece yarısı kaleden çıktı. Nöbetçi onu tanıdığını söylüyor ama adını vermiyor.',
    'Kâhyan bu ay iki mühür fazla mum harcandığını yazmış. Kimin için yakıldığını yazmamış.',
    'Şarap tüccarı, kuzeye beklenenden çok fıçı gittiğini söylüyor. Kalabalık bir sofra var demek.',
  ]);
}

// --- 4. rumour becomes a name ----------------------------------------------
function reveal(f, day) {
  if (f.known) return;
  if (day - f.founded < KNOW_AFTER_DAYS) return;   // eight months of rumour, minimum
  f.known = true;
  f.knownDay = day;
  const led = ch(f.leaderId);
  emit('faction:known', { faction: f });
  if (f.targetId === S.playerId) {
    signal(f, `Artık bir adı var: ${fullName(led)} ve ${f.memberIds.length - 1} bey. ${demandLine(f)}`, 'bad', day);
    S.chronicle.push({ day, kind: 'faction', tone: 'bad', text: `${gen(led.name)} tarafı açığa çıktı — ${KIND[f.kind].name}.` });
  }
  maybeInvitePlayer(f, day);
}

// --- 5. the demand ----------------------------------------------------------
function startDemand(f, day) {
  f.state = 'demanding';
  f.demandDay = day;
  f.known = true;
  emit('faction:demand', { faction: f });
  if (f.targetId === S.playerId) {
    signal(f, `${gen(ch(f.leaderId).name)} elçisi avluda. Atından inmedi.`, 'bad', day);
    tryDeliverDemand(f, day);
  } else {
    // it is not your gate — but it is the gate of the man who owns you
    if (ch(S.playerId)?.liegeId === f.targetId) {
      signal(f, `${gen(ch(f.targetId).name)} kapısına bir ferman çakılmış. Senin adın yok — henüz.`, 'ambiguous', day);
    }
    resolveAiDemand(f, day);
  }
}

/** The player's own gate. Everything below is paid before anything is known. */
function tryDeliverDemand(f, day) {
  if (f.demandOffered) return;
  if (openDecisions().length) return;              // one open decision at a time
  f.demandOffered = true;
  const led = ch(f.leaderId), p = ch(S.playerId);
  const rebel = factionPower(f), loyal = loyalPower(f);
  const pre = f.pretenderId ? ch(f.pretenderId) : null;
  const members = f.memberIds.map(ch).filter(Boolean);
  const roster = members.map((m) => `${fullName(m)} (${nominalLevy(m.id)} asker)`).join(', ');
  const yrs = Math.max(1, Math.round((day - f.founded) / YEAR));

  const odds = battleOdds(f);
  const bribe = Math.round(40 + nominalLevy(f.leaderId) / 6);
  const canBribe = p.gold >= bribe;

  const yield_ = yieldOption(f, led, pre);

  offer({
    kind: 'faction',
    title: kindTitle(f),
    targetId: f.leaderId,
    framing: `${fullName(led)} ${yrs} yıldır bu kâğıdı yazıyordu. Bu sabah kalenin kapısına çakılmış hâlde buldun. Mum mührü hâlâ ılık.`,
    body: `Altında ${members.length} mühür var: ${roster}.\n\n` +
      `${demandCall(f, pre)}\n\n` +
      `Kâhyan rakamları iki kez saydı: onların ${rebel} askeri var, sana ${loyal} kişi kaldı. ` +
      `Elçi avluda, atından inmedi. Cevabını bekliyor.`,
    options: [
      yield_,
      {
        key: 'refuse',
        label: 'Reddet. Sancakları çıkar.',
        detail: `${loyal} kişiyle ${rebel} kişinin üstüne gideceksin. Kâhyan yüzüne bakmıyor.`,
        cost: [{ kind: STAKE.GOLD, value: Math.min(Math.max(30, Math.round(loyal / 14)), Math.max(1, Math.floor(p.gold))) }],
        stakes: [{ kind: STAKE.LIFE, who: 'kendi tebaanın' }, { kind: STAKE.TITLE, who: 'tahtın', irreversible: true }],
        waitDays: 380 + rng.int(0, 160),
        odds,
        tone: 'bad',
        onCommit(d) { igniteRevolt(f, day); },
        tells: revoltTells(f),
        onResolve(d, ok) { return endRevolt(f, ok); },
      },
      {
        key: 'arrest',
        label: `${acc(led.name)} zindana at.`,
        detail: 'Elçiyi geri yollamak yerine efendisini içeri alırsın. Bunu her bey duyar.',
        stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.OATH }],
        waitDays: 50,
        odds: Math.min(0.9, 0.32 + skill(p, 'intrigue') * 0.045 - factionRatio(f) * 0.25),
        onCommit() { arrestPrice(f); },
        tells: [{ at: 0.5, text: () => `Zindancı, ${gen(led.name)} hücresine iki kez yemek gittiğini söylüyor. Bir kişilik hücreye.`, goodTone: 'ambiguous', badTone: 'bad' }],
        onResolve(d, ok) { return endArrest(f, ok); },
      },
      {
        key: 'bribe',
        label: `${acc(led.name)} satın al — ${bribe} altın.`,
        detail: canBribe ? 'Altın sadakat satın almaz. Sessizlik satın alır. Bazen yeter.' : 'Kesende bu kadar altın yok.',
        disabled: !canBribe,
        disabledWhy: `${bribe} altın gerekiyor, ${Math.floor(p.gold)} altının var`,
        cost: [{ kind: STAKE.GOLD, value: bribe }],
        stakes: [{ kind: STAKE.SECRET, label: 'diğerleri duyabilir' }],
        waitDays: 120,
        odds: Math.min(0.88, 0.30 + skill(p, 'diplomacy') * 0.035 + Math.max(0, traitAi(led, 'gold')) * 0.5),
        onResolve(d, ok) { return endBribe(f, ok); },
      },
    ],
  });
}

function kindTitle(f) {
  if (f.kind === 'claimant') return 'Kapına Çakılan Ferman';
  if (f.kind === 'independence') return 'Ayrılık Fermanı';
  return 'Ahitname Dayatması';
}
function demandCall(f, pre) {
  if (f.kind === 'claimant') return `İstedikleri tek şey yazılı: tahtı ${dat(pre ? fullName(pre) : 'bir başkasına')} bırakacaksın. Sana kontluklarını bırakacaklarını da eklemişler — bir lütuf gibi.`;
  if (f.kind === 'independence') {
    const t = secessionTitle(f);
    return `İstedikleri tek şey yazılı: ${t ? titleName(t) : 'o topraklar'} senin mühründen çıkacak. Bir daha vergi de asker de yok.`;
  }
  return 'İstedikleri tek şey yazılı: vergiden muafiyet ve kendi mahkemeleri. Bir kez imzalarsan torunun da bu kâğıda bağlı olacak.';
}

function yieldOption(f, led, pre) {
  if (f.kind === 'claimant') {
    return {
      key: 'yield',
      label: `Tahtı ${dat(pre ? pre.name : 'ona')} bırak.`,
      detail: 'Ayakta kalırsın. Ama artık selam verdiğin adam sensin.',
      stakes: [{ kind: STAKE.TITLE, who: 'birincil unvanın', irreversible: true }, { kind: STAKE.REPUTATION }],
      waitDays: 0,
      onResolve() { return cedeThrone(f); },
    };
  }
  if (f.kind === 'independence') {
    const t = secessionTitle(f);
    return {
      key: 'yield',
      label: `${t ? titleName(t) : 'Toprakları'} bırak.`,
      detail: 'Bir imza. Sonra sınırın oradan geçiyor.',
      stakes: [{ kind: STAKE.TITLE, who: t ? titleName(t) : 'bir düklük', irreversible: true }],
      waitDays: 0,
      onResolve() { return cedeLand(f); },
    };
  }
  return {
    key: 'yield',
    label: 'Ahitnameyi imzala.',
    detail: 'Kalıcı vergi indirimi ve beylerin kendi mahkemesi. Torunun da bu kâğıda bağlı olacak.',
    stakes: [{ kind: STAKE.OATH, irreversible: true }],
    waitDays: 0,
    onResolve() { return signCharter(f); },
  };
}

// --- outcomes ---------------------------------------------------------------
function cedeThrone(f) {
  const p = ch(S.playerId), pre = ch(f.pretenderId) || ch(f.leaderId);
  const t = primaryTitle(p);
  if (t) grantTitle(t.id, pre.id, 'faction_yield');
  for (const id of f.memberIds) {
    const c = ch(id); if (!c) continue;
    c.opinions[S.playerId] = (c.opinions[S.playerId] || 0) + 20;
    remember(id, S.playerId, 'Kavgasız çekildi.', +18, 20);
  }
  close(f, 'won');
  return {
    success: false,
    title: 'Taç El Değiştirdi',
    text: `Töreni avluda yaptılar, içeride değil. ${fullName(pre)} senin oturduğun taşa oturdu.\n\n` +
      `Sana kontluklarını bıraktılar. Artık bir beysin. Beyler eğilir.`,
    effects: [`<b>${t ? titleName(t) : 'Birincil unvanın'}</b> gitti — geri gelmez`, `Artık ${fullName(pre)} senin efendin`],
  };
}
function cedeLand(f) {
  const t = secessionTitle(f);
  const led = ch(f.leaderId);
  if (t && t.holderId === f.targetId) grantTitle(t.id, led.id, 'faction_yield');
  for (const id of f.memberIds) remember(id, S.playerId, 'Kan dökmeden yolumuzu açtı.', +25, 25);
  close(f, 'won');
  return {
    success: false,
    title: 'Sınır Yeniden Çizildi',
    text: `Mührü bastığın anda kâtip kâğıdı hemen aldı — fikrin değişmesin diye.\n\n` +
      `${t ? titleName(t) : 'O topraklar'} artık ${gen(fullName(led))}. Aynı yolları kullanıyorsunuz. Aynı sofraya oturmuyorsunuz.`,
    effects: [`<b>${t ? titleName(t) : 'Bir düklük'}</b> elinden çıktı — kalıcı`, `Yıllık gelirin düştü`],
  };
}
function signCharter(f) {
  ensure();
  const p = ch(S.playerId);
  let lost = 0;
  for (const t of directCountiesOf(S.playerId)) {
    const prov = S.provinces[t.provinceId];
    if (!prov) continue;
    const before = prov.taxMult || 1;
    prov.taxMult = Math.round(before * 0.86 * 100) / 100;
    lost += (before - prov.taxMult) * prov.development * 0.09;
  }
  S.charter.taxRelief += 14;
  S.charter.autonomy += 1;
  S.charter.granted.push({ day: S.day, toId: f.leaderId, kind: f.kind });
  for (const v of vassalsOf(S.playerId)) {
    v.opinions[S.playerId] = (v.opinions[S.playerId] || 0) + 22;
  }
  close(f, 'won');
  return {
    success: false,
    title: 'Ahitname Mühürlendi',
    text: `Kâtip iki nüsha yazdı. Biri sende kalıyor, biri onlarda. Onlarınki daha güzel yazılmış.\n\n` +
      `Beylerin bu akşam senin adına içiyor. Yarın sabah vergi kâtibin sana yeni rakamları getirecek.`,
    effects: [
      `Kendi topraklarında vergi kalıcı olarak <b>%14</b> düştü`,
      `Tüm vassalların <b>+22</b> kalıcı sadakat`,
      `Bundan sonra her fraksiyon daha hızlı büyüyecek — <b>kâğıt böyle yazıyor</b>`,
    ],
  };
}

function battleOdds(f) {
  const p = ch(S.playerId);
  const l = loyalPower(f), r = factionPower(f);
  const base = l / Math.max(1, l + r);
  const mart = (skill(p, 'martial') - 6) * 0.018;
  return Math.max(0.06, Math.min(0.94, base + mart));
}
function revoltTells(f) {
  return [
    { at: 0.22, text: () => `${rng.pick(['Bir köy yandı', 'Bir değirmen yakıldı', 'Bir köprü yıkıldı'])}. Kimin yaktığı belli değil, ama kimin toprağı olduğu belli.`, goodTone: 'ambiguous', badTone: 'bad' },
    { at: 0.48, text: () => { const m = f.memberIds.map(ch).filter(Boolean); const x = m.length ? rng.pick(m) : null; return x ? `${gen(fullName(x))} adamları geri çekildi. Yorgunluk mu, pazarlık mı, bilinmiyor.` : 'Cephede bir hareketlilik var.'; }, goodTone: 'good', badTone: 'ambiguous' },
    { at: 0.74, text: () => `Serasker haber yolladı: "Efendim, ${rng.pick(['erzak on güne yeter', 'hastalık ordugâha girdi', 'atların yarısı topal'])}."`, goodTone: 'ambiguous', badTone: 'bad' },
  ];
}
function igniteRevolt(f, day) {
  f.state = 'revolt';
  f.revoltDay = day;
  emit('faction:revolt', { faction: f });
  for (const id of f.memberIds) {
    for (const t of directCountiesOf(id)) {
      const prov = S.provinces[t.provinceId];
      if (prov) prov.unrest = Math.min(100, (prov.unrest || 0) + 45);
    }
  }
  S.chronicle.push({ day, kind: 'faction', tone: 'bad', text: `${gen(ch(f.leaderId).name)} sancağı açıldı. İç savaş başladı.` });
}
function burn(f, day) {
  // a civil war is not a progress bar: it eats the country while you wait
  const p = ch(S.playerId);
  if (p && f.targetId === S.playerId) p.stress = Math.min(100, (p.stress || 0) + 0.8);
  for (const id of [...f.memberIds, f.targetId]) {
    for (const t of directCountiesOf(id)) {
      const prov = S.provinces[t.provinceId];
      if (prov) prov.unrest = Math.min(100, (prov.unrest || 0) + 3);
    }
  }
}
function endRevolt(f, ok) {
  const led = ch(f.leaderId);
  const members = f.memberIds.map(ch).filter(Boolean);
  const p = ch(S.playerId);
  for (const id of [...f.memberIds, f.targetId]) {
    for (const t of directCountiesOf(id)) {
      const prov = S.provinces[t.provinceId];
      if (prov) prov.unrest = Math.max(0, (prov.unrest || 0) - 30);
    }
  }
  if (ok) {
    for (const m of members) {
      m.imprisonedBy = S.playerId;
      m.opinions[S.playerId] = (m.opinions[S.playerId] || 0) - 30;
      remember(m.id, S.playerId, 'Sancağını yere indirtti.', -40, 45);
      for (const k of Object.values(S.chars)) {
        if (k.deathDay == null && k.id !== m.id && isKin(k.id, m.id)) remember(k.id, S.playerId, `${gen(m.name)} zincirini gördü.`, -25, 40);
      }
    }
    if (p) { p.dreadBonus = (p.dreadBonus || 0) + 6; p.prestige += 150; }
    close(f, 'crushed');
    return {
      success: true,
      title: 'Sancak Yere İndi',
      text: `${gen(fullName(led))} atı ürktü ve onu kendi adamlarının önünde yere attı. Kalkmasını beklediler. Kalkmadı.\n\n` +
        `Şimdi hepsi zincirde. Avluda duruyorlar, yüzleri sana dönük değil. Kimse bağırmıyor — asıl korkutucu olan bu.`,
      effects: [`${members.length} bey zindanda`, '+6 dehşet', '+150 itibar', 'Akrabaları bunu unutmayacak'],
    };
  }
  // losing enforces the original demand, and adds the bill for the war
  const extra = [];
  if (p) { p.gold = Math.max(0, p.gold - Math.round(p.gold * 0.4)); p.prestige = Math.max(0, p.prestige - 200); extra.push('Hazinenin %40\'ı yağmalandı', '−200 itibar'); }
  let enforced;
  if (f.kind === 'claimant') enforced = cedeThrone(f);
  else if (f.kind === 'independence') enforced = cedeLand(f);
  else enforced = signCharter(f);
  return {
    success: false,
    title: 'Yenildin',
    text: `Ordun ${rng.pick(['bir dere yatağında', 'kar altında', 'bir geçidin ağzında'])} dağıldı. Serasker geri dönmedi.\n\n` +
      `${fullName(led)} çadırına girdiğinde ayağa kalkmanı beklemedi. Kâğıdı önüne koydu — dört yıl önce yazdığı kâğıdı. Aynı kâğıt.\n\n` +
      `İmzaladın. Savaşmadan imzalasaydın da aynı şeyi imzalayacaktın; sadece daha az insan ölecekti.`,
    effects: [...extra, ...(enforced.effects || [])],
  };
}
function arrestPrice(f) {
  // paid the instant you commit, before you know whether the chains hold
  const p = ch(S.playerId);
  if (p) p.dreadBonus = (p.dreadBonus || 0) + 3;
  for (const v of vassalsOf(S.playerId)) {
    if (v.id === f.leaderId) continue;
    remember(v.id, S.playerId, 'Bir beyini yargılamadan zincire vurdu.', -18, 30);
  }
}
function endArrest(f, ok) {
  const led = ch(f.leaderId);
  if (ok) {
    led.imprisonedBy = S.playerId;
    remember(f.leaderId, S.playerId, 'Zincire vurdu.', -60, 999);
    f.memberIds = f.memberIds.filter((id) => id !== f.leaderId);
    for (const id of f.memberIds) S.factionMood[id] = (S.factionMood[id] || 0) + 25;
    if (!f.memberIds.length) { close(f, 'crushed'); }
    else { f.leaderId = f.memberIds.sort((a, b) => nominalLevy(b) - nominalLevy(a))[0]; f.state = 'brewing'; f.demandOffered = false; f.nextDemandDay = S.day + 180; }
    return {
      success: true,
      title: 'Zincirler Tuttu',
      text: `Elçiyi yolladın, ardından atlıları. ${fullName(led)} yemeğin ortasında yakalandı; çorbası hâlâ sıcaktı.\n\n` +
        `Diğer beyler bunu duydu. Hiçbiri bir şey söylemedi. Hiçbiri.`,
      effects: [`${fullName(led)} zindanda — <b>seni ömür boyu hatırlayacak</b>`, 'Tüm vassalların −18 sadakat', f.memberIds.length ? `Taraf dağılmadı: ${f.memberIds.length} mühür duruyor` : 'Taraf dağıldı'],
    };
  }
  for (const v of vassalsOf(S.playerId)) {
    if (discontent(v.id, S.playerId) > 0.35 && !f.memberIds.includes(v.id)) join(f, v.id, S.day, false);
  }
  f.state = 'brewing'; f.demandOffered = false; f.nextDemandDay = S.day + 90;
  return {
    success: false,
    title: 'Yatak Soğuktu',
    text: `Atlıların kapıyı kırdığında oda boştu. Şamdan devrilmiş, mum hâlâ tütüyordu — biri onu uyardı.\n\n` +
      `Şimdi ${fullName(led)} bir yerlerde, sana kızgın, özgür ve haklı. Ve artık herkes senin ne yapmaya kalktığını biliyor.`,
    effects: [`${fullName(led)} kaçtı`, `Taraf büyüdü: ${f.memberIds.length} mühür`, 'Tüm vassalların −18 sadakat'],
  };
}
function endBribe(f, ok) {
  const led = ch(f.leaderId);
  if (ok) {
    led.opinions[S.playerId] = (led.opinions[S.playerId] || 0) + 25;
    remember(f.leaderId, S.playerId, 'Kesesini açtı, kimseye söylemedi.', +30, 15);
    f.memberIds = f.memberIds.filter((id) => id !== f.leaderId);
    if (!f.memberIds.length) close(f, 'dissolved');
    else { f.leaderId = f.memberIds.sort((a, b) => nominalLevy(b) - nominalLevy(a))[0]; f.state = 'brewing'; f.demandOffered = false; }
    return {
      success: true,
      title: 'Sustu',
      text: `Keseyi masaya koydun, açmadı bile. Sadece başını salladı ve gitti.\n\n` +
        `Ferman kapıdan indirildi. Kimse indirdiğini görmedi. ${f.memberIds.length ? `Ama altındaki ${f.memberIds.length} mühür hâlâ duruyor.` : 'Geriye kâğıt izi bile kalmadı.'}`,
      effects: [`${fullName(led)} taraftan çekildi`, f.memberIds.length ? `${f.memberIds.length} bey hâlâ örgütlü` : 'Taraf dağıldı'],
    };
  }
  for (const id of f.memberIds) remember(id, S.playerId, 'Bizi altınla bölmeye kalktı.', -20, 30);
  f.demandOffered = false;
  f.nextDemandDay = S.day + 120;
  return {
    success: false,
    title: 'Altını Aldı',
    text: `Keseyi aldı, saydı, cebine koydu. Sonra kâğıdı tekrar önüne sürdü.\n\n` +
      `"Bu, kâğıdın bedeli değildi efendim," dedi. "Bu, sadece bugünün bedeliydi."\n\n` +
      `Ertesi sabah diğer beyler de duymuştu. Satın alınmaya çalışılmak bir hakarettir.`,
    effects: ['Altın gitti — <b>karşılığı yok</b>', 'Tarafın tamamı −20 sadakat', 'Ferman hâlâ kapıda'],
  };
}

function close(f, state) {
  f.state = state;
  f.endedDay = S.day;
  emit('faction:resolved', { faction: f, state });
}
function dissolve(f, why, day) {
  f.state = 'dissolved';
  f.endedDay = day;
  if (f.targetId === S.playerId) signal(f, `Taraf dağıldı. ${why}`, 'good', day);
  emit('faction:resolved', { faction: f, state: 'dissolved' });
}

// --- AI-side demands (not your gate, but you can watch it burn) --------------
function resolveAiDemand(f, day) {
  const target = ch(f.targetId);
  const led = ch(f.leaderId);
  if (!target || !led) return;
  const strong = nominalLevy(f.targetId) - factionPower(f) > factionPower(f);
  if (strong && rng.chance(0.55)) {
    for (const id of f.memberIds) remember(id, f.targetId, 'Fermanımızı yırttı.', -25, 30);
    dissolve(f, `${fullName(target)} fermanı yırttı ve kimse atına binmedi.`, day);
  } else {
    const st = f.kind === 'independence' ? secessionTitle(f) : null;
    if (st && st.holderId === f.targetId) grantTitle(st.id, f.leaderId, 'faction_ai');
    for (const id of f.memberIds) remember(id, f.targetId, 'Boyun eğdi.', +20, 20);
    close(f, 'won');
    if (ch(S.playerId)?.liegeId === f.targetId) {
      signal(f, `${fullName(target)} boyun eğdi. Beyler ne isterse aldı. Sen de bir bey olduğunu hatırlıyorsun.`, 'ambiguous', day);
    }
  }
}

// ===========================================================================
// The other side of the leash: when the player is somebody's vassal
// ===========================================================================
function maybeInvitePlayer(f, day) {
  const p = ch(S.playerId);
  if (!p || f.targetId !== p.liegeId) return;
  if (f.invited || f.memberIds.includes(S.playerId)) return;
  if (f.memberIds.length < 2) return;
  f.invited = true;
  f.pendingInvite = true;
  tryDeliverInvite(f, day);
}

function tryDeliverInvite(f, day) {
  if (!f.pendingInvite) return;
  if (openDecisions().length) return;
  const p = ch(S.playerId);
  const liege = ch(f.targetId), led = ch(f.leaderId);
  if (!p || !liege || !led || !isLive(f)) { f.pendingInvite = false; return; }
  f.pendingInvite = false;
  const members = f.memberIds.map(ch).filter(Boolean);
  const grievance = topGrievance(S.playerId, f.targetId);
  const believeOdds = Math.min(0.9, 0.28 + skill(p, 'diplomacy') * 0.03 + Math.max(0, opinionOf(f.targetId, S.playerId)) / 200);

  offer({
    kind: 'faction',
    title: 'Gece Gelen Adam',
    targetId: f.leaderId,
    framing: `${fullName(led)} kendi gelmedi — kardeşini yolladı. Adam yemek yemedi, oturmadı, adını söylemedi.`,
    body: `"${gen(led.name)} sofrasında bir yer var," dedi. "${members.length} mühür bastı bile. ` +
      `${gen(fullName(liege))} seni ne kadar sevdiğini biliyorsun."\n\n` +
      (grievance ? `Doğru söylüyor. Aklından geçen şey şu: ${grievance.label}\n\n` : '') +
      `Kâğıdı masaya bıraktı. Mum yanıyor. Adam kapıda bekliyor, sırtı sana dönük.`,
    options: [
      {
        key: 'join',
        label: 'Mührünü bas.',
        detail: 'Yeminini bozuyorsun. Kâğıt seni ömür boyu bağlar — ve bir gün birinin eline geçer.',
        stakes: [{ kind: STAKE.OATH, irreversible: true }, { kind: STAKE.SECRET }],
        waitDays: 0,
        onResolve() { return playerJoins(f); },
      },
      {
        key: 'refuse',
        label: 'Geri çevir. Kimseye söyleme.',
        detail: 'Ne kazanırsın ne kaybedersin. Sadece bir kapı kapanır.',
        waitDays: 0,
        stakes: [{ kind: STAKE.REPUTATION }],
        onResolve() {
          remember(f.leaderId, S.playerId, 'Kapısını çaldık, geri çevirdi.', -18, 25);
          return {
            success: true, title: 'Adam Gitti',
            text: `Kâğıdı katladı, koynuna koydu. Kapıda bir an durdu.\n\n"Efendim," dedi, "bu kâğıt bir daha çalınmayacak."\n\nSonra gitti. Mum hâlâ yanıyor.`,
            effects: [`<b>${fullName(led)}</b> seni bir daha çağırmayacak`],
          };
        },
      },
      {
        key: 'tell',
        label: 'Efendine haber ver.',
        detail: 'Adları söylersin. Bedeli, isimleri söylemeden önce ödenir: o beyler bunu ölene kadar bilecek.',
        stakes: [{ kind: STAKE.OATH }, { kind: STAKE.REPUTATION }],
        waitDays: 90,
        odds: believeOdds,
        onCommit() {
          // the price lands the moment you speak, not when it works
          for (const id of f.memberIds) remember(id, S.playerId, 'Bizi efendisine sattı.', -45, 999);
        },
        tells: [{ at: 0.55, text: () => `${gen(fullName(liege))} kâhyası seni iki kez süzdü ve bir şey sormadı.`, goodTone: 'ambiguous', badTone: 'bad' }],
        onResolve(d, ok) { return playerInforms(f, ok); },
      },
    ],
  });
}

function playerJoins(f) {
  f.memberIds.push(S.playerId);
  f.playerSecret = true;
  f.playerJoinedDay = S.day;
  const led = ch(f.leaderId);
  for (const id of f.memberIds) {
    if (id === S.playerId) continue;
    remember(id, S.playerId, 'Aynı kâğıda mühür bastık.', +30, 40);
  }
  return {
    success: true,
    title: 'Mum Söndü',
    text: `Mührünü ısıttın ve bastın. Balmumu kâğıdı biraz yaktı; iz kaldı.\n\n` +
      `Adam kâğıdı aldı, koynuna soktu ve gitti. O kâğıt artık senin elinde değil.\n\n` +
      `Yarın sabah ${gen(fullName(ch(f.targetId)))} divanına gideceksin ve yüzüne bakacaksın.`,
    effects: [`${gen(fullName(led))} tarafındasın`, 'Kâğıt bir başkasının elinde — <b>geri alınamaz</b>', 'Efendin henüz bilmiyor'],
  };
}
function playerInforms(f, ok) {
  const liege = ch(f.targetId), led = ch(f.leaderId);
  if (ok) {
    led.imprisonedBy = f.targetId;
    f.memberIds = f.memberIds.filter((id) => id !== f.leaderId);
    if (liege) liege.opinions[S.playerId] = (liege.opinions[S.playerId] || 0) + 35;
    remember(f.targetId, S.playerId, 'Sadakatini bir gece yarısı gösterdi.', +40, 60);
    if (!f.memberIds.length) close(f, 'crushed');
    else f.leaderId = f.memberIds[0];
    return {
      success: true,
      title: 'İnandı',
      text: `${fullName(liege)} seni dinlerken hiçbir şey söylemedi. Sonra kâtibini çağırdı.\n\n` +
        `${fullName(led)} üç gün sonra kendi avlusunda yakalandı. Kalabalık toplanmıştı; herkes senin orada olmadığını fark etti.\n\n` +
        `Efendin sana bir kese yolladı. Kesenin içinde bir not yoktu.`,
      effects: [`Efendinin gözünde <b>+40</b>`, `${fullName(led)} zindanda`, 'Diğer beyler adını biliyor — <b>kalıcı</b>'],
    };
  }
  return {
    success: false,
    title: 'İnanmadı',
    text: `${fullName(liege)} seni sonuna kadar dinledi. Sonra gülümsedi.\n\n` +
      `"Bir bey diğer beyleri ihbar ediyorsa," dedi, "ya doğru söylüyordur ya da kendi payını istiyordur. İkisi de hoşuma gitmedi."\n\n` +
      `Kapıdan çıkarken avludaki adamların sana nasıl baktığını gördün. Haber senden önce çıkmış.`,
    effects: ['Efendin inanmadı', 'Fraksiyonun tamamı seni <b>ömür boyu</b> hatırlayacak', 'Kâğıt hâlâ dolaşıyor'],
  };
}

/** A secret has a shelf life. Yours is being carried around by other men. */
function leakPlayerSecret(f, day) {
  if (!f.playerSecret || !f.memberIds.includes(S.playerId)) return;
  const liege = ch(f.targetId);
  if (!liege) return;
  if (!rng.chance(0.035 + f.memberIds.length * 0.006)) return;
  f.playerSecret = false;
  remember(f.targetId, S.playerId, 'Yemin listesinde adını gördü.', -55, 999);
  const p = ch(S.playerId);
  if (p) p.stress = Math.min(100, (p.stress || 0) + 20);
  S.chronicle.push({ day, kind: 'faction', tone: 'bad', text: `${fullName(liege)} o kâğıdı gördü.` });
  emit('faction:exposed', { faction: f });
  signal(f, `${fullName(liege)} bu sabah divanda senin adını okudu. Sonra devam etti — hiçbir şey olmamış gibi. Asıl korkutucu olan bu.`, 'bad', day);
}

// --- signals ----------------------------------------------------------------
function signal(f, text, tone, day) {
  f.lastSignalDay = day;
  emit('faction:signal', { factionId: f.id, text, tone });
}

function cool(day) {
  // grudges cool a little when nothing is happening; a realm can calm down
  for (const id of Object.keys(S.factionMood)) {
    if (!alive(id)) { delete S.factionMood[id]; continue; }
    if (factionOf(id)) continue;
    const v = Math.max(0, S.factionMood[id] - 1.5);
    if (v <= 0) delete S.factionMood[id]; else S.factionMood[id] = v;
  }
}

// ===========================================================================
// The player's tools. Every one of them costs before it works, and the two
// heaviest ones cost something that never comes back.
// ===========================================================================
export const TOOL_BUSY = 'Önündeki karara cevap vermeden başka bir şeye el atamazsın.';

function guard() { return openDecisions().length === 0; }

/** Gold. The cheapest tool, and the one that most often buys nothing. */
export function offerGift(charId) {
  ensure();
  if (!guard()) return { ok: false, why: TOOL_BUSY };
  const c = ch(charId), p = ch(S.playerId);
  if (!c || !p) return { ok: false, why: 'Kimse yok.' };
  const price = Math.max(20, Math.min(220, Math.round(25 + nominalLevy(charId) / 9)));
  if (p.gold < price) return { ok: false, why: `${price} altın gerekiyor; ${Math.floor(p.gold)} altının var.` };
  const o = opinionOf(charId, S.playerId);
  const f = factionOf(charId);
  const odds = Math.max(0.12, Math.min(0.88, 0.26 + skill(p, 'diplomacy') * 0.028 + (o + 70) / 320 + Math.max(0, traitAi(c, 'gold')) * 0.35));
  const g = topGrievance(charId, S.playerId);
  offer({
    kind: 'faction',
    title: 'Kese',
    targetId: charId,
    framing: `${fullName(c)} bu sabah divanda oturdu ve bir kez bile sana bakmadı.`,
    body: `${price} altın bir yıllık gelirinin ${Math.round(price / Math.max(1, p.gold) * 100)}%'i kadar. ` +
      `${g ? `Onun defterinde şu satır var: "${g.label}"` : 'Defterinde ne yazdığını bilmiyorsun.'}\n\n` +
      `Altın bir kini silmez. Bazen sadece üstünü örter — ve örtü, çıplaklıktan iyidir.`,
    options: [
      {
        key: 'give', label: `Keseyi ver — ${price} altın`,
        detail: 'Altın şimdi gider. Karşılığını üç ay sonra öğrenirsin.',
        cost: [{ kind: STAKE.GOLD, value: price }],
        stakes: [{ kind: STAKE.GOLD, value: price }],
        waitDays: 90, odds,
        onCommit() { remember(charId, S.playerId, 'Kesesini açtı.', +10, 6); },
        tells: [{ at: 0.6, text: () => `${fullName(c)} yeni bir at aldı. Altınının nereye gittiğini görüyorsun.`, goodTone: 'good', badTone: 'ambiguous' }],
        onResolve(d, ok) {
          if (ok) {
            remember(charId, S.playerId, 'Zor bir kışta kesesini açtı.', +32, 20);
            if (f) leaveFaction(f, charId, 'kese');
            return { success: true, title: 'Kese Tuttu', text: `${fullName(c)} bir ay sonra sana bir at yolladı. Attan anlamazsın ama iyi bir at olduğunu görüyorsun.\n\n${f ? 'Kâğıttaki mührünü de kazıttırmış.' : 'Bir şey söylemedi. Söylemesi de gerekmiyordu.'}`, effects: [`<b>${c.name}</b> +32 sadakat`, f ? 'Taraftan çekildi' : ''].filter(Boolean) };
          }
          remember(charId, S.playerId, 'Altınıyla bizi susturacağını sandı.', -12, 20);
          return { success: false, title: 'Altını Aldı', text: `Keseyi aldı. Teşekkür bile etti.\n\nSonraki divanda yine sana bakmadı.`, effects: [`${price} altın gitti — <b>karşılığı yok</b>`, `<b>${c.name}</b> −12 sadakat`] };
        },
      },
    ],
  });
  return { ok: true };
}

/** Land and authority. Permanent, and it makes him stronger for next time. */
export function offerOffice(charId) {
  ensure();
  if (!guard()) return { ok: false, why: TOOL_BUSY };
  const c = ch(charId), p = ch(S.playerId);
  if (!c || !p) return { ok: false, why: 'Kimse yok.' };
  const t = grantableTitle(charId);
  if (!t) return { ok: false, why: 'Verebileceğin bir unvan yok.' };
  const f = factionOf(charId);
  const before = nominalLevy(charId);
  offer({
    kind: 'faction',
    title: 'Yetki',
    targetId: charId,
    framing: `${fullName(c)} yıllardır aynı şeyi istiyor: kendi mührüyle karar verebilmeyi.`,
    body: `${titleName(t)} senin elinde. Verirsen bir daha alamazsın — ne sen, ne oğlun.\n\n` +
      `${gen(c.name)} şu an ${before} askeri var. Bu unvanla daha fazlası olacak. ` +
      `Doyurduğun kurt, aç kurttan büyüktür.`,
    options: [
      {
        key: 'grant', label: `${titleName(t)} unvanını ver.`,
        detail: 'Geri dönüşü yok. Yetki verilir, ödünç verilmez.',
        stakes: [{ kind: STAKE.TITLE, who: titleName(t), irreversible: true }],
        waitDays: 200, odds: Math.min(0.9, 0.48 + skill(p, 'diplomacy') * 0.022 - Math.max(0, -traitAi(c, 'loyalty')) * 0.4),
        onCommit() {
          grantTitle(t.id, charId, 'faction_appease');
          remember(charId, S.playerId, 'Mührümü kendi elime verdi.', +30, 999);
        },
        tells: [{ at: 0.5, text: () => `${fullName(c)} yeni mührünü kullanmaya başladı. İlk kararı kendi sınırını genişletmek oldu.`, goodTone: 'ambiguous', badTone: 'bad' }],
        onResolve(d, ok) {
          const after = nominalLevy(charId);
          if (ok) {
            if (f) leaveFaction(f, charId, 'yetki');
            remember(charId, S.playerId, 'Bana bir unvan verdi.', +45, 999);
            return { success: true, title: 'Doydu', text: `${fullName(c)} yeni unvanıyla kendi divanını kurdu ve ilk kararında senin adını hayırla andı.\n\nBir unvan eksildi. Bir düşman da eksildi. Hangisinin daha pahalı olduğunu on yıl sonra anlarsın.`, effects: [`<b>${titleName(t)}</b> kalıcı olarak gitti`, `<b>${c.name}</b> +45 sadakat`, `Askeri gücü ${before} → ${after}`] };
          }
          return { success: false, title: 'İştahı Açıldı', text: `Mührü aldı, kullandı, sonra bir daha geldi.\n\n"Efendim," dedi, "artık bir düklük konuşabiliriz."\n\nAç bir adamı doyurursan, aç olduğunu öğrenirsin.`, effects: [`<b>${titleName(t)}</b> gitti — <b>karşılığı yok</b>`, `Askeri gücü ${before} → ${after}`, f ? 'Hâlâ tarafta' : 'Hâlâ küskün'] };
        },
      },
    ],
  });
  return { ok: true };
}

function grantableTitle(charId) {
  const p = ch(S.playerId);
  const c = ch(charId);
  if (!p || !c) return null;
  const own = primaryTitle(c);
  // best: the de jure duchy above his land — real authority, real delegation
  if (own?.dejureLiege) {
    const dl = S.titles[own.dejureLiege];
    if (dl && dl.holderId === S.playerId) return dl;
  }
  const counties = directCountiesOf(S.playerId);
  if (counties.length > 1) return counties[counties.length - 1];
  return null;
}

/** A child, a bed, and a claim on your throne that outlives all of you. */
export function offerBetrothal(charId) {
  ensure();
  if (!guard()) return { ok: false, why: TOOL_BUSY };
  const c = ch(charId), p = ch(S.playerId);
  if (!c || !p) return { ok: false, why: 'Kimse yok.' };
  const kid = livingChildren(p).filter((k) => !k.spouseId && !k.betrothedTo && age(k) >= 4).sort((a, b) => a.birthDay - b.birthDay)[0];
  if (!kid) return { ok: false, why: 'Yola çıkarabileceğin yaşta bir evladın yok.' };
  const groom = livingChildren(c).filter((k) => !k.spouseId && k.sex !== kid.sex)[0] || c;
  const t = primaryTitle(p);
  const f = factionOf(charId);
  offer({
    kind: 'faction',
    title: 'Nikâh Bağı',
    targetId: charId,
    framing: `${fullName(kid)} ${age(kid)} yaşında. Bu sabah avluda, senin adını taşıyan bir bayrağın altında oynuyordu.`,
    body: `${fullName(c)} ile aranızdaki her şeyi bir nikâhla bağlayabilirsin. ` +
      `${fullName(kid)} onun kalesine gider; orada büyür, orada yemek yer, orada kimin haklı olduğunu öğrenir.\n\n` +
      `Ve ${gen(fullName(c))} soyu ${t ? titleName(t) : 'unvanın'} üzerinde bir hak sahibi olur. Sen yaşarken kullanmazlar. ` +
      `Torunun için aynı şeyi söyleyemem.`,
    options: [
      {
        key: 'betroth', label: `${fullName(kid)} ile ${fullName(groom)} nişanlansın.`,
        detail: 'Evladın bu akşam yola çıkar. Hak, kâğıda bugün yazılır.',
        cost: [{ kind: STAKE.PRESTIGE, value: 60 }],
        stakes: [{ kind: STAKE.KIN, who: fullName(kid) }, { kind: STAKE.TITLE, who: 'unvanın üstünde bir hak', irreversible: true }],
        waitDays: 150, odds: Math.min(0.92, 0.55 + skill(p, 'diplomacy') * 0.025),
        onCommit() {
          kid.betrothedTo = groom.id;
          kid.courtOf = charId;
          if (t) t.claims.push({ charId, kind: 'marriage', day: S.day });
          remember(kid.id, charId, 'Beni kendi sofrasında büyüttü.', +55, 999);
          remember(charId, S.playerId, 'Kızını/oğlunu bana emanet etti.', +25, 999);
        },
        tells: [{ at: 0.6, text: () => `${fullName(kid)} bir mektup yolladı. El yazısı değişmiş — orada birisi ona yazmayı öğretiyor.`, goodTone: 'ambiguous', badTone: 'ambiguous' }],
        onResolve(d, ok) {
          if (ok) {
            if (f) leaveFaction(f, charId, 'nikâh');
            remember(charId, S.playerId, 'Artık aynı kanız.', +40, 999);
            return { success: true, title: 'Kan Karıştı', text: `Düğün onun kalesinde oldu. Sen üç gün sonra haberi aldın.\n\n${fullName(kid)} mutlu görünüyormuş. Bunu sana anlatan adam, senin adamın değildi.`, effects: [`<b>${c.name}</b> +40 kalıcı sadakat`, f ? 'Taraftan çekildi' : '', `${t ? titleName(t) : 'Unvanın'} üzerinde <b>kalıcı hak</b> verdin`].filter(Boolean) };
          }
          return { success: false, title: 'Çocuğu Aldı, Kâğıdı Aldı', text: `Nişan yapıldı. Sonra ${fullName(c)} bir şey daha istedi.\n\nEvladın onun kalesinde. Hak onun kâğıdında. Elinde ne kaldığını sayıyorsun.`, effects: [`${fullName(kid)} onun sarayında`, `${t ? titleName(t) : 'Unvanın'} üzerinde <b>kalıcı hak</b>`, 'Hâlâ küskün'] };
        },
      },
    ],
  });
  return { ok: true };
}

/** Chains. Fast, certain-looking, and it costs you every other man in the room. */
export function offerImprison(charId) {
  ensure();
  if (!guard()) return { ok: false, why: TOOL_BUSY };
  const c = ch(charId), p = ch(S.playerId);
  if (!c || !p) return { ok: false, why: 'Kimse yok.' };
  const f = factionOf(charId);
  const others = vassalsOf(S.playerId).filter((v) => v.id !== charId).length;
  const kin = Object.values(S.chars).filter((k) => k.deathDay == null && k.id !== charId && isKin(k.id, charId)).length;
  offer({
    kind: 'faction',
    title: 'Zincir',
    targetId: charId,
    framing: `${fullName(c)} bu akşam senin sofranda yemek yiyecek. Adamların kapıda hazır.`,
    body: `Bir beyi yargısız zincire vurmak hızlıdır. Bedeli de hızlı gelir: ` +
      `${others} vassalın bunu duyacak ve her biri kendi boynunu düşünecek. ` +
      `${kin ? `${gen(c.name)} ${kin} akrabası bunu hiç unutmayacak.` : ''}\n\n` +
      `Zindanda bir adam, kaledeki bir adamdan daha az tehlikelidir. Ama zindan bazen boş çıkar.`,
    options: [
      {
        key: 'seize', label: 'Sofrada yakala.',
        detail: 'Bedelin tamamı bu akşam ödenir. Zincirin tutup tutmadığını iki ay sonra öğrenirsin.',
        stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.OATH, irreversible: true }],
        waitDays: 55,
        odds: Math.max(0.15, Math.min(0.92, 0.36 + skill(p, 'intrigue') * 0.042 - (f ? factionRatio(f) * 0.3 : 0))),
        onCommit() {
          p.dreadBonus = (p.dreadBonus || 0) + 3;
          for (const v of vassalsOf(S.playerId)) {
            if (v.id === charId) continue;
            remember(v.id, S.playerId, 'Bir beyini yargılamadan zincire vurdu.', -18, 30);
          }
        },
        tells: [{ at: 0.5, text: () => `Zindancı, ${gen(c.name)} hiç konuşmadığını söylüyor. Hiç.`, goodTone: 'ambiguous', badTone: 'bad' }],
        onResolve(d, ok) {
          if (ok) {
            c.imprisonedBy = S.playerId;
            remember(charId, S.playerId, 'Zincire vurdu.', -60, 999);
            for (const k of Object.values(S.chars)) {
              if (k.deathDay == null && k.id !== charId && isKin(k.id, charId)) remember(k.id, S.playerId, `${gen(c.name)} zincirini gördü.`, -30, 60);
            }
            if (f) leaveFaction(f, charId, 'zincir');
            return { success: true, title: 'Zincirler Tuttu', text: `Çorbanın ikinci kâsesindeydi. Kalkmaya çalışmadı bile.\n\nAvludan geçirirken kimse pencereye çıkmadı. Herkes pencerenin arkasındaydı.`, effects: [`<b>${c.name}</b> zindanda`, `${others} vassalın −18 sadakat`, `${kin} akrabası −30 — <b>uzun sürer</b>`] };
          }
          if (f) { for (const v of vassalsOf(S.playerId)) if (discontent(v.id, S.playerId) > 0.3 && !f.memberIds.includes(v.id)) join(f, v.id, S.day, false); }
          return { success: false, title: 'Sandalye Boştu', text: `Sofraya oturmadı. "Karnım tok efendim," diye haber yollamış.\n\nŞimdi kalesinde, kapıları kapalı, ve her bey ne yapmaya kalktığını biliyor.`, effects: [`<b>${c.name}</b> kaçtı`, `${others} vassalın −18 sadakat`, f ? 'Taraf büyüdü' : ''].filter(Boolean) };
        },
      },
    ],
  });
  return { ok: true };
}

/** The charter. Permanent law, offered before anyone nails anything to a gate. */
export function offerCharter(factionId) {
  ensure();
  if (!guard()) return { ok: false, why: TOOL_BUSY };
  const f = factionById(factionId);
  const p = ch(S.playerId);
  if (!p) return { ok: false, why: 'Kimse yok.' };
  const vs = vassalsOf(S.playerId);
  const inc = directCountiesOf(S.playerId).reduce((s, t) => s + ((S.provinces[t.provinceId]?.development || 0) * 0.09 * (S.provinces[t.provinceId]?.taxMult || 1)), 0);
  offer({
    kind: 'faction',
    title: 'Ahitname',
    targetId: f ? f.leaderId : null,
    framing: `Kâtibin kâğıdı hazırladı. İki nüsha. Mürekkep henüz kurumadı.`,
    body: `Kimse senden istemedi — henüz. Şimdi verirsen lütuf olur; fermanla isterlerse teslimiyet.\n\n` +
      `Kendi topraklarından toplanan vergi kalıcı olarak %14 düşer (yılda yaklaşık ${Math.round(inc * 12 * 0.14)} altın). ` +
      `${vs.length} vassalın kalıcı olarak yumuşar. Ve bu kâğıt, senden sonra gelen her fraksiyonun işini kolaylaştırır — çünkü beyler bir kez tattıklarını unutmaz.`,
    options: [
      {
        key: 'sign', label: 'İmzala.',
        detail: 'Bedeli bugün, tamamı ve kalıcı olarak ödenir. Yeter mi, üç ay sonra belli olur.',
        stakes: [{ kind: STAKE.OATH, irreversible: true }],
        waitDays: 90, odds: f ? Math.min(0.9, 0.42 + (1 - factionRatio(f)) * 0.5) : 0.85,
        onCommit() { applyCharter(); },
        tells: [{ at: 0.6, text: () => `Vergi kâtibin yeni rakamları getirdi. İki kez saydırdın, değişmedi.`, goodTone: 'ambiguous', badTone: 'bad' }],
        onResolve(d, ok) {
          if (ok) {
            if (f) close(f, 'dissolved');
            return { success: true, title: 'Kâğıt İşe Yaradı', text: `Beylerin bu akşam senin adına içti. Kâhyan gelirin ne kadar düştüğünü söylemek için sabahı bekledi.\n\nBir hükümdarın en pahalı hediyesi, istenmeden verilendir.`, effects: ['Vergin kalıcı %14 düştü', `${vs.length} vassalın +22 kalıcı sadakat`, f ? 'Taraf dağıldı' : 'Kimse örgütlenmedi', 'Gelecekteki fraksiyonlar daha hızlı büyüyecek'] };
          }
          return { success: false, title: 'Yetmedi', text: `Kâğıdı okudular, imzaladılar, sonra bir tane daha istediler.\n\n"Bu bir başlangıç efendim," dedi ${f ? fullName(ch(f.leaderId)) : 'biri'}. Başlangıç, sonu olan şeydir.`, effects: ['Vergin kalıcı %14 düştü — <b>karşılığı yok</b>', 'Gelecekteki fraksiyonlar daha hızlı büyüyecek'] };
        },
      },
    ],
  });
  return { ok: true };
}

function applyCharter() {
  ensure();
  for (const t of directCountiesOf(S.playerId)) {
    const prov = S.provinces[t.provinceId];
    if (!prov) continue;
    prov.taxMult = Math.round((prov.taxMult || 1) * 0.86 * 100) / 100;
  }
  S.charter.taxRelief += 14;
  S.charter.autonomy += 1;
  S.charter.granted.push({ day: S.day, toId: null, kind: 'voluntary' });
  for (const v of vassalsOf(S.playerId)) v.opinions[S.playerId] = (v.opinions[S.playerId] || 0) + 22;
}

function leaveFaction(f, charId, why) {
  f.memberIds = f.memberIds.filter((id) => id !== charId);
  S.factionMood[charId] = 0;
  if (!f.memberIds.length) { close(f, 'dissolved'); return; }
  if (f.leaderId === charId) f.leaderId = f.memberIds.sort((a, b) => nominalLevy(b) - nominalLevy(a))[0];
  if (f.state === 'demanding' && factionRatio(f) < DEMAND_RATIO) { f.state = 'brewing'; f.demandOffered = false; f.nextDemandDay = S.day + 60; }
  emit('faction:shrank', { faction: f, charId, why });
}

// Read-only helpers the realm screen needs.
export function charterSummary() { ensure(); return { ...S.charter }; }
export function toolPrice(kind, charId) {
  if (kind === 'gift') return Math.max(20, Math.min(220, Math.round(25 + nominalLevy(charId) / 9)));
  return 0;
}
export function grantableTitleFor(charId) { return grantableTitle(charId); }
