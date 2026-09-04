// ===========================================================================
// P17 — THE OTHER RULERS
// ---------------------------------------------------------------------------
// Eighty-odd named people hold land on this map. Before this file, none of them
// wanted anything: the player decided, the world waited. That is the single
// worst thing you can do to a strategy game's tension — if nobody is planning
// against you, waiting is just idling.
//
// So every landed ruler carries an agenda (c.ai) derived from their traits, and
// that agenda turns into deeds: claims fabricated, neighbours weighed, vassals
// squeezed, grudges collected and eventually paid. Most of it happens where you
// cannot see it. Some of it reaches you as a rumour. And when a ruler decides
// you are the weak one, it reaches you as a decision you cannot dodge.
//
// Three rules this file keeps:
//   1. rng only — same seed, same conspiracy.
//   2. one open decision at a time, ever.
//   3. cheap: rulers are processed in daily slices, heavy thinking is monthly.
// ===========================================================================

import { S, rng, ch, ti, pv, alive } from '../core/state.js';
import { YEAR } from '../core/date.js';
import {
  fullName, age, opinion, opinionLabel, remember, kill, skill,
  livingChildren, traitAi, traitMod,
} from './characters.js';
import { grantTitle, vassalsOf, directCountiesOf, TIER } from './realm.js';
import { offer, STAKE } from './decision.js';
// Sibling pieces are being written in parallel. Namespace imports + typeof
// guards mean their shape can change under us without taking the world down.
import * as Memory from './memory.js';
import * as Factions from './factions.js';

// ---------------------------------------------------------------------------
// state namespace — plain JSON, ours alone
// ---------------------------------------------------------------------------
function W() {
  if (!S.ai) {
    S.ai = {
      built: 0,
      lastOfferDay: -9999,
      lastRumorDay: -9999,
      offers: 0, rumors: 0, seizures: 0, murders: 0, pacts: 0, marriages: 0,
      plots: [],        // covert moves aimed at the player
      plotSeq: 1,
      demandsMade: {},  // charId -> day of last demand on the player
    };
  }
  return S.ai;
}


// ---------------------------------------------------------------------------
// Turkish suffixes. Names are generated at runtime, so "Bitlis'na ait" happens
// unless the vowels are actually looked at. Bad grammar in a rumour reads as a
// bug, and a bug is not atmospheric.
// ---------------------------------------------------------------------------
const VOWELS = 'aeıioöuüâîû';
function lastVowel(w) {
  for (let i = w.length - 1; i >= 0; i--) { const c = w[i].toLowerCase(); if (VOWELS.includes(c)) return c; }
  return 'a';
}
const endsVowel = (w) => VOWELS.includes((w[w.length - 1] || '').toLowerCase());
const isBack = (v) => 'aıouâû'.includes(v);
const isRound = (v) => 'oöuü'.includes(v);
/** genitive: -in / -ın / -un / -ün  ("Stephanos'un kâtibi") */
export function gen(n) {
  if (!n) return '';
  const v = lastVowel(n);
  const s = isBack(v) ? (isRound(v) ? 'un' : 'ın') : (isRound(v) ? 'ün' : 'in');
  return `${n}'${endsVowel(n) ? 'n' : ''}${s}`;
}
/** accusative: -i / -ı / -u / -ü  ("Bitlis'i aldı") */
export function acc(n) {
  if (!n) return '';
  const v = lastVowel(n);
  const s = isBack(v) ? (isRound(v) ? 'u' : 'ı') : (isRound(v) ? 'ü' : 'i');
  return `${n}'${endsVowel(n) ? 'y' : ''}${s}`;
}
/** dative: -e / -a  ("Bitlis'e ait") */
export function dat(n) {
  if (!n) return '';
  const s = isBack(lastVowel(n)) ? 'a' : 'e';
  return `${n}'${endsVowel(n) ? 'y' : ''}${s}`;
}
/** ablative: -den / -dan  ("Sökmen'den aldı") */
export function abl(n) {
  if (!n) return '';
  const d = HARD.includes((n[n.length - 1] || '').toLowerCase()) ? 't' : 'd';
  return `${n}'${d}${isBack(lastVowel(n)) ? 'an' : 'en'}`;
}
const HARD = 'pçtkfhsş';
const hardEnd = (n) => HARD.includes((n[n.length - 1] || '').toLowerCase());
/** locative: -de / -da / -te / -ta  ("Bitlis'te") */
export function loc(n) {
  if (!n) return '';
  const d = hardEnd(n) ? 't' : 'd';
  return `${n}'${d}${isBack(lastVowel(n)) ? 'a' : 'e'}`;
}
/** A stable per-character choice, so one man always speaks in one voice. */
function voice(c, arr) { return arr[Math.abs(c?.faceSeed || 0) % arr.length]; }

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/**
 * A ruler's standing wants, read out of their traits. `traitAi` already speaks
 * this language (aggression, claim, gold, scheme, forgive, risk…); this only
 * turns it into six numbers the rest of the file can compare.
 */
export function agenda(c) {
  if (c.ai && c.ai.v === 3) return c.ai;
  const t = (k) => traitAi(c, k);
  const a = {
    v: 3,
    land:    clamp01(0.26 + t('claim') + t('aggression') * 0.55 + (c.base?.martial || 0) / 55),
    gold:    clamp01(0.28 + t('gold') + (c.base?.stewardship || 0) / 55),
    grudge:  clamp01(0.34 - t('forgive') + t('scheme') * 0.3),
    loyalty: clamp01(0.48 + t('loyalty') + t('oathBreak') * -0.8),
    piety:   clamp01(0.26 + t('holyWar') - t('tolerance') * 0.6),
    risk:    clamp01(0.32 + t('risk') + t('aggression') * 0.3),
    guile:   clamp01(0.20 + t('scheme') + (c.base?.intrigue || 0) / 55),
    bond:    clamp01(0.30 + t('ally') + t('gift') * 0.4),   // appetite for pacts and marriages
    heat: 0,            // pressure aimed at the player specifically
    goal: null,         // 'land' | 'gold' | 'revenge' | 'bond' | 'curb'
    goalId: null,
    goalDay: 0,
    lastDeed: -9999,
    told: 0,            // how many rumour steps of this ruler's build-up leaked
  };
  c.ai = a;
  return a;
}

// ---------------------------------------------------------------------------
// the index — rebuilt monthly, never stored in S
// ---------------------------------------------------------------------------
let IDX = { day: -99999, rulers: [], strength: {}, own: {}, income: {},
  counties: {}, nbr: {}, ownerOf: {}, provOf: {} };

function rebuildIndex(day) {
  const counties = {};      // holderId -> [titleId]
  const ownerOf = {};       // provinceId -> holderId
  const provOf = {};        // holderId -> [provinceId]
  for (const t of Object.values(S.titles)) {
    if (!t.holderId || !alive(t.holderId)) continue;
    if (t.tier === TIER.county && t.provinceId) {
      (counties[t.holderId] ||= []).push(t.id);
      (provOf[t.holderId] ||= []).push(t.provinceId);
      ownerOf[t.provinceId] = t.holderId;
    }
  }
  const own = {}, income = {};
  for (const hid of Object.keys(counties)) {
    let lv = 0, inc = 0;
    for (const tid of counties[hid]) {
      const p = pv(ti(tid)?.provinceId);
      if (!p) continue;
      const one = 90 + p.development * 22 + (p.holdings || 1) * 45;
      lv += p.occupiedBy ? one * 0.55 : one;
      inc += p.occupiedBy ? 0 : p.development * 0.09 * (p.taxMult || 1);
    }
    own[hid] = Math.round(lv);
    income[hid] = Math.round(inc * 10) / 10;
  }

  // strength climbs the liege chain: a duke is as strong as his counts let him be
  const strength = {};
  for (const hid of Object.keys(own)) strength[hid] = own[hid];
  for (const hid of Object.keys(own)) {
    let c = ch(hid), guard = 0, carry = own[hid];
    while (c?.liegeId && guard++ < 5) {
      const op = opinion(c.id, c.liegeId);
      carry = carry * clamp(0.30 + op / 300, 0.05, 0.85);
      if (carry < 20) break;
      strength[c.liegeId] = (strength[c.liegeId] || 0) + Math.round(carry);
      c = ch(c.liegeId);
    }
  }

  // who borders whom
  const nbr = {};
  for (const [pid, holder] of Object.entries(ownerOf)) {
    const p = pv(pid);
    if (!p) continue;
    for (const npid of p.neighbors || []) {
      const other = ownerOf[npid];
      if (!other || other === holder) continue;
      (nbr[holder] ||= new Set()).add(other);
    }
  }
  const nbrArr = {};
  for (const k of Object.keys(nbr)) nbrArr[k] = Array.from(nbr[k]);

  // one pass for vassal lists: vassalsOf() walks all 363 characters and used to
  // be called from inside the per-ruler loop, which is where the frame time went
  const vassals = {};
  for (const c of Object.values(S.chars)) {
    if (c.deathDay != null || !c.liegeId) continue;
    (vassals[c.liegeId] ||= []).push(c.id);
  }

  IDX = {
    day,
    rulers: Object.keys(counties).sort(),
    strength, own, income, counties, nbr: nbrArr, ownerOf, provOf, vassals,
    lord: null, playerCounties: [],
  };
  const pid = S.playerId;
  if (pid) {
    IDX.lord = overlordOf(pid);
    IDX.playerCounties = (counties[pid] || []).slice();
  }
}
const vassalIds = (id) => IDX.vassals?.[id] || [];
const vassalsOfCached = (id) => vassalIds(id).map(ch).filter((c) => c && c.deathDay == null);

const strengthOf = (id) => IDX.strength[id] || 0;
/**
 * Who actually sits above this person. `c.liegeId` is rebuilt from titles every
 * year and can come back empty, so fall back to walking the de jure chain —
 * otherwise the player spends most of the game with nobody above them and the
 * whole "your liege wants something" pressure never fires.
 */
function overlordOf(charId) {
  const c = ch(charId);
  if (!c) return null;
  if (c.liegeId && alive(c.liegeId)) return c.liegeId;
  const own = (c.titles || []).map(ti).filter(Boolean).sort((a, b) => b.tier - a.tier)[0];
  let t = own?.dejureLiege ? ti(own.dejureLiege) : null;
  let guard = 0;
  while (t && guard++ < 6) {
    if (t.holderId && t.holderId !== charId && alive(t.holderId)) return t.holderId;
    t = t.dejureLiege ? ti(t.dejureLiege) : null;
  }
  return null;
}
const neighborsOf = (id) => IDX.nbr[id] || [];
const provincesOf = (id) => IDX.provOf[id] || [];
function provinceIdxOf(provinceId) {
  const list = S.mapMeta?.provinces || [];
  for (let i = 0; i < list.length; i++) if (list[i].id === provinceId) return i;
  return null;
}
function sceneOf(charId) {
  const p = provincesOf(charId)[0];
  const i = p != null ? provinceIdxOf(p) : null;
  return i == null ? null : { provinceIdx: i };
}

// ---------------------------------------------------------------------------
// what the player is allowed to hear
// ---------------------------------------------------------------------------
function spyReach() {
  const p = ch(S.playerId);
  if (!p) return 0;
  const spy = S.council?.spymaster ? ch(S.council.spymaster) : null;
  const s = Math.max(spy ? skill(spy, 'intrigue') : 0, skill(p, 'intrigue') * 0.7);
  return clamp01(0.14 + s * 0.038);
}

/** How much this pair of people has to do with the player's life. 0 = nothing. */
function relevance(actorId, targetId) {
  const pid = S.playerId;
  if (!pid) return 0;
  if (actorId === pid || targetId === pid) return 1;
  const p = ch(pid);
  let r = 0;
  for (const id of [actorId, targetId]) {
    const c = ch(id);
    if (!c) continue;
    if (c.liegeId === pid || c.courtOf === pid) r = Math.max(r, 0.85);
    if (p.liegeId && (id === p.liegeId)) r = Math.max(r, 0.9);
    if (c.dynastyId && c.dynastyId === p.dynastyId) r = Math.max(r, 0.7);
    if (neighborsOf(pid).includes(id)) r = Math.max(r, 0.75);
    if ((p.memoriesOf?.[id] || []).length) r = Math.max(r, 0.6);
    if (p.liegeId && ch(p.liegeId)?.liegeId === id) r = Math.max(r, 0.5);
    if (r < 0.45) {
      for (const n of neighborsOf(pid)) if (neighborsOf(n).includes(id)) { r = Math.max(r, 0.45); break; }
    }
  }
  return r;
}

/**
 * A whisper. Not proof — the point is that you half-know things and cannot act
 * on half. Throttled hard so the chronicle stays the player's own story.
 */
function rumor(text, tone = 'ambiguous', { actorId = null, targetId = null, force = 0 } = {}) {
  const A = W();
  if (S.day - A.lastRumorDay < 40 && !force) return false;
  const rel = actorId || targetId ? relevance(actorId, targetId) : 0.5;
  if (rel <= 0.2) return false;
  const chance = clamp01(spyReach() * (0.5 + rel) + force);
  if (!rng.chance(chance)) return false;
  if (text === A.lastLine) return false;
  A.lastRumorDay = S.day;
  A.lastLine = text;
  A.rumors++;
  S.chronicle.push({ day: S.day, kind: 'rumor', text, tone });
  return true;
}

/** Something everybody saw. Land changing hands is never a secret. */
function news(text, tone = 'neutral', { actorId = null, targetId = null } = {}) {
  if (relevance(actorId, targetId) < 0.4) return false;
  S.chronicle.push({ day: S.day, kind: 'world', text, tone });
  return true;
}

/** Hand a deed to P04's ledger if it is there; never depend on it. */
function imprint(o) {
  try { if (typeof Memory.imprint === 'function') Memory.imprint(o); } catch { /* not ready yet */ }
}

// ---------------------------------------------------------------------------
// picking targets
// ---------------------------------------------------------------------------
/** How inviting somebody looks to a wolf. */
function weakness(attackerId, victimId) {
  const a = strengthOf(attackerId), v = strengthOf(victimId);
  if (a <= 0) return 0;
  const ratio = a / Math.max(60, v);
  const victim = ch(victimId);
  if (!victim) return 0;
  let w = clamp01((ratio - 0.85) * 0.9);
  if (age(victim) > 62) w += 0.10;
  if (age(victim) < 17) w += 0.22;                    // a child on a chair
  if (victim.sex === 'f') w += 0.05;
  if (!livingChildren(victim).length) w += 0.10;      // no heir, no future
  const vs = vassalIds(victimId);
  if (vs.length) {
    let sour = 0;
    for (const x of vs) if ((ch(x)?.opinions?.[victimId] || 0) < -12) sour++;
    w += Math.min(0.25, sour * 0.09);
  }
  if (victim.imprisonedBy) w += 0.2;
  return clamp01(w);
}

/** The worst thing this person remembers about that person, as a number. */
function grudgeToward(cId, otherId) {
  const c = ch(cId);
  if (!c) return 0;
  let g = 0;
  for (const m of c.memoriesOf?.[otherId] || []) {
    if (m.delta >= 0) continue;
    const yrs = (S.day - m.day) / YEAR;
    g += -m.delta * Math.max(0, 1 - yrs / (m.life || 25));
  }
  const op = opinion(cId, otherId);
  if (op < -30) g += (-op - 30) * 0.6;
  return g;
}

function claimsOn(titleId) { return ti(titleId)?.claims || []; }
function hasClaim(charId, titleId) { return claimsOn(titleId).some((x) => x.charId === charId); }

// ---------------------------------------------------------------------------
// DEEDS — the small, constant machinery of other people's ambition
// ---------------------------------------------------------------------------

/** Quietly have a scribe find an old deed. The first step of every war. */
function deedClaim(c, a) {
  const cand = [];
  for (const nId of neighborsOf(c.id)) {
    if (nId === c.id) continue;
    for (const pid of provincesOf(nId)) {
      const t = ti(`t_${pid}`);
      if (!t || t.holderId !== nId) continue;
      if (hasClaim(c.id, t.id)) continue;
      const p = pv(pid);
      let w = 1 + weakness(c.id, nId) * 6 + a.land * 4;
      if (p && p.culture === c.culture) w += 2.5;
      if (p && p.faith !== c.faith) w += a.piety * 4;
      w += grudgeToward(c.id, nId) / 26;
      cand.push({ t, nId, p, w });
    }
  }
  if (!cand.length) return false;
  const pick = rng.weighted(cand);
  pick.t.claims.push({ charId: c.id, kind: 'fabricated', day: S.day });
  a.goal = 'land'; a.goalId = pick.nId; a.goalDay = S.day;
  rumor(
    `${gen(fullName(c))} kâtibi eski tapular karıştırıyormuş. Aradığı tapu ${dat(pick.p?.name || 'bir sınır kontluğu')} ait.`,
    'bad', { actorId: c.id, targetId: pick.nId },
  );
  return true;
}

/** Take it. Between two AI rulers this happens off-screen and stays taken. */
function deedSeize(c, a) {
  const mine = [];
  for (const t of Object.values(S.titles)) {
    if (t.tier !== TIER.county || !t.holderId || t.holderId === c.id) continue;
    if (!hasClaim(c.id, t.id)) continue;
    if (t.holderId === S.playerId) continue;           // you never lose land silently
    if (!neighborsOf(c.id).includes(t.holderId)) continue;
    mine.push(t);
  }
  if (!mine.length) return false;
  const t = rng.pick(mine);
  const victim = ch(t.holderId);
  if (!victim) return false;
  const odds = clamp01(0.18 + weakness(c.id, victim.id) * 0.85 + a.risk * 0.15);
  if (!rng.chance(odds * 0.55)) {
    // the muster failed, or a winter got in the way
    c.prestige = Math.max(0, (c.prestige || 0) - 25);
    rumor(`${fullName(c)} kışın ortasında ordusunu dağıtmış. Kimse sebebini söylemiyor.`,
      'ambiguous', { actorId: c.id, targetId: victim.id });
    return true;
  }
  const p = pv(t.provinceId);
  grantTitle(t.id, c.id, 'conquest');
  if (p) { p.unrest = Math.min(100, (p.unrest || 0) + 35); p.development = Math.max(1, p.development - 1); }
  c.prestige = (c.prestige || 0) + 90;
  remember(victim.id, c.id, `${p?.name || 'Toprağını'} zorla aldı.`, -70, 999);
  for (const kid of livingChildren(victim)) remember(kid.id, c.id, `Babanın toprağını o aldı.`, -45, 999);
  W().seizures++;
  news(`${p?.name || 'Bir kontluk'} el değiştirdi: ${fullName(c)} onu ${abl(fullName(victim))} aldı.`,
    'bad', { actorId: c.id, targetId: victim.id });
  imprint({ kind: 'seizure', day: S.day, actorId: c.id, targetId: victim.id, weight: 0.5,
    text: `${fullName(c)}, ${gen(fullName(victim))} toprağını aldı.` });
  a.goal = null; a.goalId = null;
  return true;
}

/** Bind two houses. Alliances are how the map suddenly gets a wall in it. */
function deedMarry(c, a) {
  const mine = marriageCandidates(c.id);
  if (!mine.length) return false;
  const options = [];
  for (const nId of neighborsOf(c.id)) {
    const other = ch(nId);
    if (!other) continue;
    if (opinion(c.id, nId) < -25) continue;
    const theirs = marriageCandidates(nId);
    if (!theirs.length) continue;
    options.push({ nId, theirs, w: 1 + a.bond * 3 + strengthOf(nId) / 900 + clamp(opinion(c.id, nId), -20, 60) / 40 });
  }
  if (!options.length) return false;
  const pickHouse = rng.weighted(options);
  const groomPool = mine.filter((x) => x.sex === 'm');
  const bridePool = pickHouse.theirs.filter((x) => x.sex === 'f');
  const alt1 = mine.filter((x) => x.sex === 'f');
  const alt2 = pickHouse.theirs.filter((x) => x.sex === 'm');
  let g = null, b = null;
  if (groomPool.length && bridePool.length) { g = rng.pick(groomPool); b = rng.pick(bridePool); }
  else if (alt1.length && alt2.length) { g = rng.pick(alt2); b = rng.pick(alt1); }
  if (!g || !b) return false;
  g.spouseId = b.id; b.spouseId = g.id;
  b.courtOf = g.courtOf || c.id;
  const other = ch(pickHouse.nId);
  remember(c.id, other.id, 'Aramızda bir nikâh var.', +32, 45);
  remember(other.id, c.id, 'Aramızda bir nikâh var.', +32, 45);
  W().marriages++; W().pacts++;
  rumor(`${fullName(c)} ile ${fullName(other)} bir nikâhla akraba oldu. İkisi de sana haber vermedi.`,
    'bad', { actorId: c.id, targetId: other.id });
  return true;
}

/** Marriageable people the player could actually hand over — never the player. */
function playerMatches() {
  return marriageCandidates(S.playerId).filter((x) => x.id !== S.playerId);
}

function marriageCandidates(holderId) {
  const out = [];
  const holder = ch(holderId);
  if (!holder) return out;
  for (const k of livingChildren(holder)) {
    if (age(k) >= 14 && !k.spouseId) out.push(k);
  }
  if (!holder.spouseId && age(holder) >= 16) out.push(holder);
  return out;
}

/** Discipline. A liege who never squeezes has no vassals, only guests. */
function deedCurb(c, a) {
  const vs = vassalsOfCached(c.id).filter((v) => v.id !== S.playerId);
  if (!vs.length) return false;
  const sour = vs.map((v) => ({ v, o: opinion(v.id, c.id) })).sort((x, y) => x.o - y.o);
  const worst = sour[0];
  if (worst.o > -12 && a.gold < 0.55) return false;
  const mode = rng.weighted([
    { k: 'tax', w: 2 + a.gold * 5 },
    { k: 'strip', w: (worst.o < -35 ? 2 : 0.3) + a.land * 3 },
    { k: 'iron', w: (worst.o < -45 ? 2.5 : 0.2) + traitMod(c, 'dread') * 0.2 },
    { k: 'gift', w: 1 + a.bond * 4 + (traitAi(c, 'gift') > 0 ? 3 : 0) },
  ]).k;
  const v = worst.v;
  if (mode === 'gift') {
    const amt = Math.min(40, Math.max(8, Math.round((c.gold || 0) * 0.12)));
    if (amt < 6) return false;
    c.gold -= amt; v.gold = (v.gold || 0) + amt;
    remember(v.id, c.id, 'Kışın kesesini açtı.', +22, 20);
    return true;
  }
  if (mode === 'tax') {
    const amt = Math.min(60, Math.max(5, Math.round((v.gold || 0) * 0.3)));
    if (amt < 4) return false;
    v.gold -= amt; c.gold = (c.gold || 0) + amt;
    remember(v.id, c.id, 'Kesemi zorla açtırdı.', -18, 22);
    return true;
  }
  if (mode === 'strip') {
    const own = directCountiesOf(v.id);
    if (own.length < 2) return false;
    const t = own[own.length - 1];
    const loyal = vassalsOfCached(c.id).filter((x) => opinion(x.id, c.id) > 25 && x.id !== v.id);
    const to = loyal.length ? rng.pick(loyal) : c;
    grantTitle(t.id, to.id, 'revoke');
    remember(v.id, c.id, 'Toprağımı elimden aldı.', -55, 999);
    rumor(`${fullName(c)} vassalı ${gen(fullName(v))} toprağını elinden aldı. Divanda kimse itiraz etmemiş.`,
      'bad', { actorId: c.id, targetId: v.id });
    return true;
  }
  // iron: the dungeon
  v.imprisonedBy = c.id;
  remember(v.id, c.id, 'Beni zincire vurdu.', -70, 999);
  for (const other of vs) if (other.id !== v.id) remember(other.id, c.id, `${acc(v.name)} zindana attığını gördüm.`, -12, 25);
  rumor(`${fullName(v)} artık ${gen(fullName(c))} zindanında. Suçunu kimse söyleyemiyor.`,
    'bad', { actorId: c.id, targetId: v.id });
  return true;
}

/** Old blood, paid late. The world keeps books. */
function deedRevenge(c, a) {
  const enemies = [];
  for (const otherId of Object.keys(c.memoriesOf || {})) {
    if (otherId === c.id || !alive(otherId)) continue;
    const g = grudgeToward(c.id, otherId);
    if (g < 30) continue;
    enemies.push({ id: otherId, g });
  }
  if (!enemies.length) return false;
  const target = rng.weighted(enemies, (x) => x.g);
  const t = ch(target.id);
  if (!t) return false;
  if (t.id === S.playerId) { a.heat = Math.min(100, a.heat + 6); return false; }  // you get a decision, not a knife in the dark

  const canKill = a.guile > 0.42 && skill(c, 'intrigue') > 7 && target.g > 55;
  if (canKill && rng.chance(0.30 * a.grudge + 0.10)) {
    const odds = clamp01(0.10 + skill(c, 'intrigue') * 0.028 - skill(t, 'intrigue') * 0.018);
    if (rng.chance(odds)) {
      kill(t, 'murder', c.id);
      W().murders++;
      for (const kid of livingChildren(t)) remember(kid.id, c.id, 'Babamı o öldürdü. Kanıtım yok.', -80, 999);
      rumor(`${gen(fullName(t))} ölümünden bir gün önce ${gen(fullName(c))} adamı şehirdeymiş. Tesadüf olabilir.`,
        'bad', { actorId: c.id, targetId: t.id, force: 0.15 });
      imprint({ kind: 'murder', day: S.day, actorId: c.id, targetId: t.id, weight: 0.6,
        text: `${fullName(c)}, ${acc(fullName(t))} zehirletti.` });
      return true;
    }
    c.prestige = Math.max(0, (c.prestige || 0) - 40);
    remember(t.id, c.id, 'Mutfağıma adam soktu.', -60, 999);
    rumor(`${gen(fullName(t))} aşçısı ortadan kayboldu. ${gen(fullName(c))} adı geçiyor.`,
      'ambiguous', { actorId: c.id, targetId: t.id });
    return true;
  }
  // otherwise: words. Cheaper, slower, and it works.
  const audience = neighborsOf(t.id).concat(vassalIds(t.id)).slice(0, 4);
  if (!audience.length) return false;
  for (const aid of audience) {
    if (aid === c.id) continue;
    remember(aid, t.id, `${c.name} onun hakkında anlatılmayacak şeyler anlattı.`, -12, 14);
  }
  remember(t.id, c.id, 'Arkamdan konuştu.', -14, 18);
  return true;
}

/** Rulers who see a stronger neighbour buy insurance. */
function deedPact(c, a) {
  // Insurance, not friendship: you only swear with someone when a third man
  // frightens you. Otherwise every ruler ends up liking every other one, and a
  // map where nobody is angry has nothing in it.
  const threat = neighborsOf(c.id).some((n) => strengthOf(n) > strengthOf(c.id) * 1.25);
  if (!threat && a.bond < 0.55) return false;
  const opts = [];
  for (const nId of neighborsOf(c.id)) {
    const o = opinion(c.id, nId);
    if (o < 15) continue;
    if (strengthOf(nId) > strengthOf(c.id) * 1.25) continue;
    opts.push({ nId, w: 1 + o / 30 + a.bond * 2 });
  }
  if (!opts.length) return false;
  const pick = rng.weighted(opts);
  const other = ch(pick.nId);
  if (!other) return false;
  remember(c.id, other.id, 'Sınırda yanımda durdu.', +16, 14);
  remember(other.id, c.id, 'Sınırda yanımda durdu.', +16, 14);
  W().pacts++;
  return true;
}

// ---------------------------------------------------------------------------
// THINKING — one ruler, one slice, cheap
// ---------------------------------------------------------------------------
function think(c, day) {
  const a = agenda(c);
  if (c.imprisonedBy) return;
  if (age(c) < 16) return;

  // --- pick a goal now and then --------------------------------------------
  if (!a.goal || day - a.goalDay > 4 * YEAR) {
    const pool = [
      { k: 'land',    w: 1 + a.land * 6 },
      { k: 'gold',    w: 1 + a.gold * 5 },
      { k: 'revenge', w: 0.5 + a.grudge * 5 },
      { k: 'bond',    w: 1 + a.bond * 4 },
      { k: 'curb',    w: 0.6 + (vassalIds(c.id).length ? 3 : 0) },
    ];
    a.goal = rng.weighted(pool).k;
    a.goalDay = day;
  }

  // --- act, but rarely: a ruler is not a machine gun -----------------------
  if (day - a.lastDeed < 150) return;
  if (!rng.chance(0.16 + a.risk * 0.12)) return;
  a.lastDeed = day;
  switch (a.goal) {
    case 'land':    if (!deedClaim(c, a)) deedPact(c, a); break;
    case 'gold':    deedCurb(c, a); break;
    case 'revenge': if (!deedRevenge(c, a)) deedCurb(c, a); break;
    case 'bond':    if (!deedMarry(c, a)) deedPact(c, a); break;
    case 'curb':    deedCurb(c, a); break;
  }
}

/** Is this ruler close enough to the player to want anything from them? */
function playerRelation(c, pid) {
  const near = neighborsOf(c.id).includes(pid) || (ch(pid)?.courtOf === c.id);
  const isLiege = overlordOf(pid) === c.id;
  const isVassal = overlordOf(c.id) === pid;
  if (!near && !isLiege && !isVassal) return null;
  return { near, isLiege, isVassal };
}

/**
 * How badly this ruler wants something from you, 0..100. Everything the piece
 * does to the player hangs off this number, so it is written to be readable:
 * ambition, your weakness, old blood, a deed in a drawer, and a leash.
 */
function wantOf(c, a, pid, rel) {
  let w = 6 + a.land * 24 + a.risk * 6;
  w += weakness(c.id, pid) * 44;
  w += Math.min(32, grudgeToward(c.id, pid) * 0.42);
  if (a.gold > 0.5) w += 10;
  if (rel.isLiege) w += 24;
  if (rel.isVassal) w += 8;
  for (const tid of IDX.playerCounties) if (hasClaim(c.id, tid)) { w += 28; break; }
  const op = opinion(c.id, pid);
  w -= Math.max(0, op) * 0.45;
  if (op < -40) w += 10;
  return clamp(w, 0, 100);
}

/**
 * The build-up you are allowed to notice. Three rungs, each worse than the last,
 * each deniable. Only the neighbour who wants the most climbs it — four men all
 * "buying grain" in the same season is noise, and noise teaches the player to
 * stop reading. Each ruler speaks in one voice for his whole life.
 */
let threatCache = { day: -1, id: null };
function topThreat() {
  const pid = S.playerId;
  if (threatCache.day === S.day) return threatCache.id ? ch(threatCache.id) : null;
  let best = null;
  for (const id of neighborsOf(pid)) {
    const c = ch(id);
    if (!c || c.deathDay != null || !c.ai?.v) continue;
    if (!best || score(c) > score(best)) best = c;
  }
  const lord = ch(IDX.lord || '');
  if (lord?.ai?.v && (!best || score(lord) > score(best))) best = lord;
  threatCache = { day: S.day, id: best?.id || null };
  return best;
}
/** Ties at heat 100 are common; ambition and old blood break them. */
function score(c) {
  return (c.ai?.heat || 0) + (c.ai?.land || 0) * 18 + Math.min(20, grudgeToward(c.id, S.playerId) * 0.12);
}

function buildupLine(c, rung) {
  const homeProv = pv(provincesOf(c.id)[0]);
  const mineProv = pv(provincesOf(S.playerId)[0]);
  const home = homeProv?.name, mine = mineProv?.name;
  if (rung === 0) return voice(c, [
    `Bir tüccar, ${gen(fullName(c))} kalendeki muhafız sayısını sorduğunu anlattı. Fiyat sormamış.`,
    `${gen(fullName(c))} kâtibi bu kış iki kez ${mine ? loc(mine) : 'senin topraklarında'} görüldü. Kâğıt taşıyordu, mal değil.`,
    `${fullName(c)} senin babanı soruyormuş. Nasıl öldüğünü değil, kimlere borçlu öldüğünü.`,
  ]);
  if (rung === 1) return voice(c, [
    `${fullName(c)} bu yıl tahılını satmıyor. Ambarları dolu, kapıları kapalı.`,
    `${home ? loc(home) : 'Komşunun kalesinde'} demirci gece de çalışıyor. Ne dövdüğünü söyleyen yok.`,
    `${gen(fullName(c))} sofrasında bu ay üç yabancı ağırlanmış. Üçü de at üstünde gelmiş, üçü de gece gitmiş.`,
  ]);
  return voice(c, [
    `${gen(fullName(c))} adamları ${mine ? mine + ' sınırında' : 'sınırında'} ocak yakmış. Sayılarını çoban da bilmiyor.`,
    `${mine ? mine + ' yolundaki' : 'Sınırdaki'} köprüde bu hafta bekçi yok. Bekçiyi kimin çağırdığını kimse hatırlamıyor.`,
    `${fullName(c)} kışlık otu iki katına çıkarmış. O kadar atı yok — henüz.`,
  ]);
}

function leakBuildup(c, a) {
  if (a.told >= 3) return;
  const AT = [30, 55, 76];
  if (a.heat < AT[a.told]) return;
  if (topThreat()?.id !== c.id) return;          // only the man who matters speaks
  const rung = a.told;
  a.told = rung + 1;
  rumor(buildupLine(c, rung), rung === 2 ? 'bad' : 'ambiguous',
    { actorId: c.id, targetId: S.playerId, force: 0.35 });
}

/**
 * Your spymaster's seasonal report. The ladder above only fires when one ruler
 * crosses a rung; this is what keeps the map talking in between, and it is the
 * only reason a quiet decade still feels inhabited. Every line must name someone.
 */
function seasonalReport(day) {
  const A = W();
  if (day - A.lastRumorDay < 74) return;
  const pid = S.playerId, p = ch(pid);
  if (!p) return;
  const lines = [];

  const hot = topThreat();
  if (hot && hot.ai.heat > 34) {
    const pr = pv(provincesOf(hot.id)[0]);
    lines.push({ w: 5, tone: 'bad', t: `${fullName(hot)} bu mevsim üç kez sınıra çıktı. Her seferinde aynı geçidin başında durup geri döndü.` });
    if (pr) lines.push({ w: 3, tone: 'ambiguous', t: `${loc(pr.name)} pazar erken dağılıyor. Halk akşamı kalede geçiriyormuş.` });
  }
  // a deed to your land, in someone else's drawer
  for (const t of directCountiesOf(pid)) {
    const cl = (t.claims || []).find((x) => x.charId !== pid && alive(x.charId));
    if (!cl) continue;
    const who = ch(cl.charId);
    const pr = pv(t.provinceId);
    lines.push({ w: 7, tone: 'bad', t: `${gen(fullName(who))} divanında ${pr?.name || t.name} konuşulmuş. Senin adın geçmemiş — yalnızca toprağın.` });
    break;
  }
  // your own people
  const vs = vassalsOf(pid);
  if (vs.length) {
    const worst = vs.map((v) => ({ v, o: opinion(v.id, pid) })).sort((x, y) => x.o - y.o)[0];
    if (worst.o < -25) lines.push({ w: 6, tone: 'bad', t: `${fullName(worst.v)} bu ay divanına gelmedi. "Yollar kapalı" demiş. Yollar kapalı değil.` });
    else if (worst.o > 30) lines.push({ w: 2, tone: 'good', t: `${fullName(worst.v)} vergisini erken göndermiş. Kâhyan bunu iki kez saydı, inanamadı.` });
  }
  // the wider map: name the man who just got bigger
  if (A.seizures > (A.reportedSeizures || 0)) {
    A.reportedSeizures = A.seizures;
    const grown = IDX.rulers.map(ch).filter(Boolean)
      .sort((x, y) => strengthOf(y.id) - strengthOf(x.id))[0];
    if (grown && grown.id !== pid) {
      lines.push({ w: 5, tone: 'bad', t: `${fullName(grown)} bir bayrak daha indirdi. Tüccarlar yolunu değiştirmiş; yeni yol senin sınırından geçiyor.` });
    }
  }
  // marriages that close a door on you
  const near = neighborsOf(pid).map(ch).filter((x) => x && x.deathDay == null);
  const bound = near.find((x) => Object.keys(x.memoriesOf || {}).some((k) => k !== pid && near.some((y) => y.id === k)));
  if (bound) lines.push({ w: 3, tone: 'ambiguous', t: `${fullName(bound)} bu kış komşularıyla aynı sofrada oturdu. Sen çağrılmadın; kimse bunu tuhaf bulmadı.` });

  if (!lines.length) {
    lines.push({ w: 1, tone: 'ambiguous', t: `Casusun bu mevsim tek bir isim getirmedi. Bundan hoşlanmıyor, sen de hoşlanmamalısın.` });
  }
  if (!rng.chance(clamp01(0.34 + spyReach()))) return;
  const fresh = lines.filter((l) => l.t !== A.lastLine);
  const pick = rng.weighted(fresh.length ? fresh : lines);
  A.lastRumorDay = day;
  A.lastLine = pick.t;
  A.rumors++;
  S.chronicle.push({ day, kind: 'rumor', text: pick.t, tone: pick.tone });
}

// ---------------------------------------------------------------------------
// COVERT PLOTS — things aimed at you that you may never see coming
// ---------------------------------------------------------------------------
function maybePlot(day) {
  const A = W();
  const pid = S.playerId;
  if (!pid || A.plots.length >= 2) return;
  const cands = [];
  for (const id of IDX.rulers) {
    if (id === pid) continue;
    const c = ch(id);
    if (!c || c.deathDay != null) continue;
    const a = agenda(c);
    if (a.guile < 0.45 || a.heat < 35) continue;
    cands.push({ id, w: a.guile * 4 + a.heat / 25 });
  }
  if (!cands.length) return;
  const pick = rng.weighted(cands);
  const kind = rng.weighted([{ k: 'buy', w: 3 }, { k: 'poison', w: 2 }]).k;
  A.plots.push({ id: `plot${A.plotSeq++}`, byId: pick.id, kind, startDay: day, landDay: day + rng.int(300, 700), found: false });
}

function tickPlots(day) {
  const A = W();
  const pid = S.playerId;
  for (let i = A.plots.length - 1; i >= 0; i--) {
    const pl = A.plots[i];
    const by = ch(pl.byId);
    if (!by || by.deathDay != null || !pid) { A.plots.splice(i, 1); continue; }

    // your spymaster gets one chance every season to trip over it
    if (!pl.found && day % 90 === 13 && rng.chance(spyReach() * 0.55)) {
      pl.found = true;
      if (!S.decisions.some((d) => d.state === 'open') && day - A.lastOfferDay > OFFER_COOLDOWN * 0.8) {
        A.lastOfferDay = day; A.offers++;
        offerCaughtSpy(by, pl);
        A.plots.splice(i, 1);
        continue;
      }
      if (!pl.leaked) {
        pl.leaked = true;
        rumor(voice(by, [
          `Casusun bir isim getirdi: ${fullName(by)}. Yanında bir de soru: "Ne yapacaksın?"`,
          `${gen(fullName(by))} adamlarından biri senin ahırında iş aramış. At bilmiyormuş.`,
          `Casusun ${gen(fullName(by))} mührünü masana koydu ve nereden aldığını söylemedi.`,
        ]), 'bad', { actorId: by.id, targetId: pid, force: 0.6 });
      }
    }

    if (day >= pl.landDay) {
      A.plots.splice(i, 1);
      landPlot(by, pl);
    }
  }
}

function landPlot(by, pl) {
  const pid = S.playerId;
  const p = ch(pid);
  if (!p) return;
  if (pl.kind === 'buy') {
    const vs = vassalsOf(pid);
    if (!vs.length) return;
    const v = rng.weighted(vs.map((x) => ({ x, w: Math.max(1, 40 - opinion(x.id, pid)) })), (o) => o.w).x;
    v.gold = (v.gold || 0) + 40;
    remember(v.id, pid, `${gen(by.name)} altınını aldım. Sen bilmiyorsun.`, -40, 40);
    agenda(by).heat = Math.min(100, agenda(by).heat + 10);
    // you find out late, if at all
    rumor(`${fullName(v)} geçen ay ${gen(fullName(by))} sofrasında görülmüş. Ne konuşulduğunu duyan olmamış.`,
      'bad', { actorId: by.id, targetId: v.id, force: 0.25 });
    imprint({ kind: 'bribe', day: S.day, actorId: by.id, targetId: v.id, weight: 0.35,
      text: `${fullName(by)}, vassalın ${acc(fullName(v))} satın aldı.` });
    return;
  }
  // poison: aimed at your household, not at you — the game does not kill you offscreen
  const house = [...livingChildren(p), ...(p.spouseId && alive(p.spouseId) ? [ch(p.spouseId)] : [])];
  const kids = house.filter(Boolean);
  if (!kids.length) return;
  const t = rng.pick(kids);
  if (rng.chance(0.35)) {
    kill(t, 'murder', by.id);
    S.stats.kin_lost = (S.stats.kin_lost || 0) + 1;
    remember(pid, by.id, `${acc(t.name)} o öldürdü. Kanıtın yok.`, -70, 999);
    rumor(`${gen(t.name)} son gecesinde mutfağa bir yabancı girmiş. Aşçı hatırlamıyor.`, 'bad',
      { actorId: by.id, targetId: pid, force: 0.9 });
    imprint({ kind: 'murder', day: S.day, actorId: by.id, targetId: t.id, weight: 0.75,
      text: `${fullName(by)} senin evinden birini aldı.` });
  } else {
    if (!t.traits.includes('ill')) t.traits.push('ill');
    rumor(`${t.name} iki haftadır ateşli. Hekim yediklerini soruyor, cevabı beğenmiyor.`, 'bad',
      { actorId: by.id, targetId: pid, force: 0.6 });
  }
}

// ---------------------------------------------------------------------------
// PRESSURE ON THE PLAYER — the part that becomes a decision
// ---------------------------------------------------------------------------
const OFFER_COOLDOWN = 430;   // days between anything the AI puts in front of you
const WARMUP = 420;           // the first year and a half is yours, not theirs

function pressurePlayer(day) {
  const A = W();
  const pid = S.playerId;
  if (day < WARMUP) return;   // the world watches you before it moves on you
  if (!pid || S.pendingPlayer) return;
  if (S.decisions.some((d) => d.state === 'open')) return;         // one at a time, always
  if (day - A.lastOfferDay < OFFER_COOLDOWN) return;
  const p = ch(pid);
  if (!p || p.deathDay != null) return;

  // A world that has stayed quiet too long is a broken world, so the bar drops
  // the longer nobody has bothered you.
  const bar = day - A.lastOfferDay > 6 * YEAR ? 34 : 52;
  const lordId = overlordOf(pid);
  const cands = [];
  for (const id of IDX.rulers) {
    if (id === pid) continue;
    const c = ch(id);
    if (!c || c.deathDay != null || c.imprisonedBy) continue;
    const a = agenda(c);
    if (a.heat < bar) continue;
    if (day - (A.demandsMade[id] || -9999) < 3 * YEAR) continue;
    cands.push({ c, a, w: (a.heat - bar + 4) * (id === lordId ? 1.6 : 1) });
  }
  if (!cands.length) return;

  const pick = rng.weighted(cands);
  const c = pick.c, a = pick.a;

  const menu = [];
  const own = directCountiesOf(pid);
  const claimed = own.filter((t) => hasClaim(c.id, t.id));
  // A ruler with one county has nothing to cede — taking it ends the game in all
  // but name, so the wolves ask for gold or blood instead.
  if (own.length > 1 && claimed.length && strengthOf(c.id) > strengthOf(pid) * 0.85) menu.push({ k: 'land', w: 6 + a.land * 6 });
  if (c.id === lordId) menu.push({ k: 'liege', w: 9 });
  if (a.gold > 0.4 && p.gold > 40) menu.push({ k: 'tribute', w: 3 + a.gold * 5 });
  if (playerMatches().length && marriageCandidates(c.id).length && opinion(c.id, pid) > -55) menu.push({ k: 'marry', w: 3 + a.bond * 6 });
  const badVassal = vassalsOfCached(pid).map((v) => ({ v, o: opinion(v.id, pid) })).sort((x, y) => x.o - y.o)[0];
  if (badVassal && badVassal.o < -30 && badVassal.v.id !== c.id) menu.push({ k: 'vassal', w: 4 });
  // A count with one county still has a knee to bend and a road through his land.
  if (!A.tribute && strengthOf(c.id) > strengthOf(pid) * 1.5) menu.push({ k: 'oath', w: 5 + a.land * 5 });
  if (A.tribute && A.tribute.toId === c.id && day - A.tribute.sinceDay > 3 * YEAR) menu.push({ k: 'free', w: 9 });
  if (neighborsOf(c.id).length > 1) menu.push({ k: 'pass', w: 4 + a.risk * 4 });
  if (!menu.length) menu.push({ k: 'tribute', w: 1 });

  // A ruler who asks for the same thing five reigns running is a script, not a
  // neighbour. Recent demands go to the back of the queue, and the same kind of
  // demand cannot come back for four years.
  A.kindDay ||= {};
  const recent = A.lastKinds || [];
  for (const m of menu) {
    if (recent.includes(m.k)) m.w *= 0.08;
    const since = day - (A.kindDay[m.k] ?? -9999);
    if (since < 4 * YEAR) m.w *= Math.max(0.05, since / (4 * YEAR));
  }
  const kind = rng.weighted(menu).k;
  A.lastKinds = [kind, ...recent].slice(0, 3);
  A.kindDay[kind] = day;
  A.lastOfferDay = day;
  A.demandsMade[c.id] = day;
  A.offers++;

  // The letter is written while the warnings are still on the table — the reset
  // happens after, or `foretold()` would never see the build-up it refers to.
  if (kind === 'land') offerLandUltimatum(c, a, rng.pick(claimed));
  else if (kind === 'liege') offerLiegeDemand(c, a);
  else if (kind === 'marry') offerMarriage(c, a);
  else if (kind === 'vassal') offerVassalDefiance(badVassal.v);
  else if (kind === 'oath') offerOath(c, a);
  else if (kind === 'free') offerBreakTribute(c, a);
  else if (kind === 'pass') offerPassage(c, a);
  else offerTribute(c, a);

  a.heat = 25;
  a.told = 0;
}

// --- 1. give me that county --------------------------------------------------
function offerLandUltimatum(c, a, title) {
  const pid = S.playerId, p = ch(pid);
  const prov = pv(title.provinceId);
  const mine = strengthOf(pid), theirs = strengthOf(c.id);
  const defOdds = clamp(0.22 + (mine / Math.max(120, mine + theirs)) * 0.9 + (prov?.defense || 0) * 0.02, 0.12, 0.86);
  const bribe = Math.max(50, Math.round(theirs / 14));
  const name = prov?.name || title.name;

  offer({
    kind: 'war',
    title: voice(c, [`${name} İçin Bir Mektup`, `Sandıktaki Tapu`, `${name} Kimin?`]),
    targetId: c.id,
    scene: sceneOf(c.id) || sceneOf(pid),
    framing: `${foretold(c)}${gen(fullName(c))} mührünü taşıyan bir mektup geldi. Getiren adam cevabı beklerken oturmadı bile.`,
    body: `"${name} benim dedemindi. Tapusu sandığımda duruyor ve mürekkebi senin doğumundan eski.\n\nBu kışı kan dökmeden geçirmek ikimizin de işine gelir."\n\nKâhyan haritayı açtı ve iki sayı söyledi: onun toplayabileceği ${theirs} kılıç, senin ${mine}. Sonra sustu ve seni bekledi.`,
    options: [
      {
        key: 'yield',
        label: `${acc(name)} ona ver.`,
        detail: 'Bir mektupla toprak kaybetmek. Vassalların bunu duyacak ve kendi sınırlarını düşünecek.',
        confirm: `${name} bir daha senin olmayacak. Emin misin?`,
        stakes: [{ kind: STAKE.TITLE, who: name, irreversible: true }, { kind: STAKE.REPUTATION }],
        waitDays: 40,
        tone: 'bad',
        onCommit() {
          grantTitle(title.id, c.id, 'cession');
          remember(c.id, pid, 'Bir mektupla toprağını verdi.', +25, 30);
          for (const v of vassalsOf(pid)) remember(v.id, pid, `${acc(name)} savaşmadan verdi.`, -22, 35);
        },
        onResolve() {
          p.prestige = Math.max(0, p.prestige - 70);
          agenda(c).heat = 40;
          return {
            success: true, beat: 'verildi',
            title: `${name} Artık Onun`,
            text: `Bayrağı indirdiler, yenisini çektiler. Kalede kalan otuz adamın çoğu geri dönmedi — orada iş buldular.\n\nVassalların bu ay divana geç geldi. Hiçbiri sebep söylemedi.`,
            effects: [`<b>${name}</b> kalıcı olarak gitti`, '−70 itibar', 'Vassalların hatırlıyor'],
          };
        },
      },
      {
        key: 'defy',
        label: 'Reddet. Gelirse karşılarım.',
        detail: `Adamlarını toplamak para ister. Kışı savaşla geçirmek daha çok ister.`,
        confirm: `${fullName(c)} bu cevabı savaş sayacak.`,
        cost: [{ kind: STAKE.GOLD, value: Math.max(0, Math.min(70, Math.floor(p.gold * 0.3))) }],
        stakes: [{ kind: STAKE.TITLE, who: name }, { kind: STAKE.LIFE, who: 'adamlarının' }],
        odds: defOdds,
        waitDays: 260,
        tone: 'bad',
        tells: [
          { at: 0.25, text: () => `${gen(fullName(c))} öncüleri ${name} sınırında görüldü. Köylüler tahılı gömüyor.`, goodTone: 'ambiguous', badTone: 'bad' },
          { at: 0.55, text: () => `Kâhyan bu sabah iki kez saydı: ambarda kırk gün var. Kuşatma kırk günden uzun sürer.`, goodTone: 'ambiguous', badTone: 'bad' },
          { at: 0.82, text: () => `Sınırdan gelen haberler kesildi. Üç gündür hiçbir atlı gelmiyor.`, goodTone: 'good', badTone: 'bad' },
        ],
        onResolve(d, ok) {
          const prov2 = pv(title.provinceId);
          if (ok) {
            p.prestige += 140;
            if (!p.traits.includes('victorious') && rng.chance(0.4)) p.traits.push('victorious');
            c.prestige = Math.max(0, (c.prestige || 0) - 120);
            remember(c.id, pid, 'Beni sınırdan geri çevirdi.', -45, 60);
            for (const v of vassalsOf(pid)) remember(v.id, pid, 'Toprağı için durdu.', +25, 30);
            agenda(c).heat = 10;
            if (prov2) prov2.unrest = Math.min(100, (prov2.unrest || 0) + 15);
            imprint({ kind: 'defence', day: S.day, actorId: pid, targetId: c.id, weight: 0.5,
              text: `${name} önünde ${acc(fullName(c))} geri çevirdin.` });
            return {
              success: true, beat: 'durdu',
              title: `${name} Önünde Durdular`,
              text: `Üç hafta beklediler, sonra çekildiler. Kimse bir meydan savaşı görmedi; sadece açlık ve çamur.\n\nDönerken ${gen(name)} değirmenini yaktılar. O kadarını yapabildiler.`,
              effects: ['+140 itibar', `<b>${fullName(c)}</b> geri çekildi`, 'Vassalların gördü'],
            };
          }
          grantTitle(title.id, c.id, 'conquest');
          if (prov2) { prov2.unrest = Math.min(100, (prov2.unrest || 0) + 45); prov2.development = Math.max(1, prov2.development - 2); }
          p.prestige = Math.max(0, p.prestige - 90);
          if (!p.traits.includes('humbled')) p.traits.push('humbled');
          remember(pid, c.id, `${acc(name)} benden aldı.`, -80, 999);
          W().seizures++;
          imprint({ kind: 'defeat', day: S.day, actorId: c.id, targetId: pid, weight: 0.7,
            text: `${fullName(c)} ${acc(name)} senden aldı.` });
          return {
            success: false, beat: 'düştü', knell: true,
            title: `${name} Düştü`,
            text: `Kapıyı içeriden açtılar. Kimin açtığını hiç öğrenemedin, ama bir isim duydun ve o isim hâlâ senin sofrana oturuyor.\n\nAltınını harcadın, adamlarını gömdün, toprağı da verdin.`,
            effects: [`<b>${name}</b> kaybedildi`, '−90 itibar', '<b>Ezik</b> damgası', 'Ödediğin altın geri gelmedi'],
          };
        },
      },
      {
        key: 'buy',
        label: `Altın gönder — bu kış olmasın.`,
        detail: `${bribe} altın. Ne söz verildiğini yazıya dökmüyorlar.`,
        cost: [{ kind: STAKE.GOLD, value: bribe }],
        stakes: [{ kind: STAKE.GOLD, value: bribe }],
        odds: clamp(0.42 + (bribe / Math.max(60, strengthOf(c.id) / 8)) * 0.2, 0.35, 0.78),
        waitDays: 150,
        disabled: p.gold < bribe,
        disabledWhy: `Kesende ${bribe} altın yok`,
        tells: [
          { at: 0.4, text: () => `${gen(fullName(c))} adamı altını saydı, teşekkür etmedi.`, goodTone: 'ambiguous', badTone: 'ambiguous' },
          { at: 0.8, text: () => `Sınır köylerinden biri bu hafta vergi vermedi. Kime verdiğini söylemiyorlar.`, goodTone: 'good', badTone: 'bad' },
        ],
        onResolve(d, ok) {
          if (ok) {
            agenda(c).heat = 20;
            remember(c.id, pid, 'Kesesi açık bir komşu.', +10, 15);
            return {
              success: true, beat: 'bu kış olmadı',
              title: 'Bu Kış Gelmediler',
              text: `Kar eridi, kimse gelmedi. Kâhyan defteri kapatırken bir şey söyledi: "Efendim, bu bir barış değil. Bu bir kira."\n\nGelecek kış aynı kapı çalınacak.`,
              effects: [`${bribe} altın gitti`, 'Bu yıl savaş yok', 'O senin ödeyeceğini öğrendi'],
            };
          }
          agenda(c).heat = 92;
          remember(pid, c.id, 'Altınımı aldı, yine de geldi.', -60, 999);
          return {
            success: false, beat: 'yetmedi', knell: true,
            title: 'Altını Aldı, Yine de Geldi',
            text: `Kesen boşaldı ve sınırda hiçbir şey değişmedi. Elçisi geri geldi, aynı mektubu getirdi, sadece rakam büyüdü.\n\nBir adamı bir kez satın alırsan fiyatını öğretirsin.`,
            effects: [`${bribe} altın karşılıksız gitti`, `<b>${fullName(c)}</b> yakında yine gelecek`],
          };
        },
      },
    ],
  });
}

// --- 2. your liege wants something ------------------------------------------
function offerLiegeDemand(liege, a) {
  const pid = S.playerId, p = ch(pid);
  const kid = livingChildren(p).filter((k) => age(k) >= 5 && age(k) <= 15)[0];
  const gold = Math.max(40, Math.round(p.gold * 0.45));
  const wantsHostage = !!kid && rng.chance(0.45);

  offer({
    kind: 'edict',
    title: wantsHostage ? voice(liege, ['Efendinin İstediği Şey', 'Bahara Kadar']) : voice(liege, ['Efendinin Defteri', 'Sefer Var']),
    targetId: liege.id,
    scene: sceneOf(liege.id) || sceneOf(pid),
    framing: `${gen(fullName(liege))} mührü. Mektubun ilk satırında "rica" kelimesi yok.`,
    body: wantsHostage
      ? `"Sadakat söylenmez, gösterilir. ${kid.name} bu bahar benim sarayımda büyüsün. İyi bakılır, iyi öğretilir, ve geri gelir."\n\nGeri gelir. Mektubun tek yalanı bu değil ama en kibar olanı bu.`
      : `"Bu yıl seferim var ve senin kesen benim kesemdir. ${gold} altın, hasat vaktine kadar."\n\nAltını kim topladıysa senin adına toplamış olacak. Köylerinde bunu böyle anlatmayacaklar.`,
    options: [
      {
        key: 'obey',
        label: wantsHostage ? `${acc(kid.name)} gönder.` : `Altını gönder.`,
        detail: wantsHostage ? 'Sarayında bir çocuğun olacak. Rehin kelimesi kullanılmayacak.' : 'Kesen boşalır, adın temiz kalır.',
        confirm: wantsHostage ? `${kid.name} bu bahar gidiyor. Ne zaman döneceğini kimse söylemiyor.` : null,
        cost: wantsHostage ? [] : [{ kind: STAKE.GOLD, value: gold }],
        stakes: wantsHostage ? [{ kind: STAKE.KIN, who: kid.name, irreversible: true }] : [{ kind: STAKE.GOLD, value: gold }],
        waitDays: wantsHostage ? 300 : 60,
        odds: wantsHostage ? 0.72 : null,
        tone: 'neutral',
        onCommit() {
          if (wantsHostage) { kid.courtOf = liege.id; kid.hostageOf = liege.id; }
          remember(liege.id, pid, wantsHostage ? 'Çocuğunu bana yolladı.' : 'Kesesini açtı.', +35, 30);
        },
        tells: wantsHostage ? [
          { at: 0.35, text: () => `${abl(kid.name)} mektup geldi. El yazısı düzgünleşmiş. Kelimeleri onun değil.`, goodTone: 'ambiguous', badTone: 'ambiguous' },
          { at: 0.75, text: () => `Efendinin sarayından dönen bir adam, çocukları avluda gördüğünü söylüyor. Sayı vermedi.`, goodTone: 'good', badTone: 'bad' },
        ] : null,
        onResolve(d, ok) {
          if (!wantsHostage) {
            return { success: true, beat: 'ödendi', title: 'Kese Boşaldı', text: `Altın gitti, mektup geldi: iki satır teşekkür.\n\nKöyler bu kış eksik yiyecek. Onlara kimin aldığını sen söylemek zorundasın.`, effects: [`−${gold} altın`, `<b>${fullName(liege)}</b> +35`] };
          }
          if (ok) {
            remember(pid, liege.id, 'Çocuğuma iyi baktı.', +20, 25);
            return { success: true, beat: 'döndü', title: `${kid.name} Döndü`, text: `İki yıl sonra döndü. Boyu uzamış, Rumca öğrenmiş, ve sana bakışı değişmiş.\n\nArtık senin çocuğun ama senin sarayının çocuğu değil.`, effects: [`<b>${kid.name}</b> sağ döndü`, `Efendinle aran düzeldi`] };
          }
          kill(kid, 'illness');
          S.stats.kin_lost = (S.stats.kin_lost || 0) + 1;
          remember(pid, liege.id, `${kid.name} onun sarayında öldü.`, -70, 999);
          return { success: false, beat: 'dönmedi', knell: true, title: `${kid.name} Dönmedi`, text: `Mektup kısaydı: ateş, üç gün, ve başsağlığı.\n\nSen o mektubu okurken efendinin sarayında kimse cenaze görmedi. Sadece bir oda boşaldı.`, effects: [`<b>${kid.name}</b> öldü`, `Efendine karşı kalıcı kin`] };
        },
      },
      {
        key: 'refuse',
        label: 'Hayır de.',
        detail: 'Bir kez hayır dersen, ikinci mektup gelmez. Onun yerine adamları gelir.',
        confirm: 'Efendine hayır demek yeminini zorlar.',
        stakes: [{ kind: STAKE.OATH }, { kind: STAKE.REPUTATION }],
        waitDays: 200,
        odds: clamp(0.30 + skill(p, 'martial') * 0.02 + strengthOf(pid) / 4000, 0.2, 0.75),
        tone: 'bad',
        tells: [
          { at: 0.4, text: () => `Efendinin divanından iki vassalın çağrıldı. Sen çağrılmadın.`, goodTone: 'ambiguous', badTone: 'bad' },
          { at: 0.8, text: () => `Bu ay verginin yarısı geri döndü: köyler kime ödeyeceğini bilmiyor.`, goodTone: 'good', badTone: 'bad' },
        ],
        onCommit() {
          remember(liege.id, pid, 'Yüzüme hayır dedi.', -50, 60);
          agenda(liege).heat = Math.min(100, agenda(liege).heat + 25);
        },
        onResolve(d, ok) {
          if (ok) {
            p.prestige += 90;
            for (const v of vassalsOf(pid)) remember(v.id, pid, 'Efendisine hayır diyebildi.', +18, 25);
            return { success: true, beat: 'yuttu', title: 'Yuttu', text: `Cevap gelmedi. Aylarca gelmedi. Sonra bir gün divanda seni yine çağırdılar ve hiçbir şey olmamış gibi davrandılar.\n\nBu bir af değil. Bu bir defter kaydı.`, effects: ['+90 itibar', 'Vassalların bunu gördü', `<b>${fullName(liege)}</b> unutmadı`] };
          }
          const own2 = directCountiesOf(pid);
          const t = own2.length > 1 ? own2[own2.length - 1] : null;
          if (t) {
            grantTitle(t.id, liege.id, 'revoke');
            remember(pid, liege.id, 'Bir kontluğumu aldı.', -80, 999);
          } else {
            p.gold = Math.max(0, p.gold - gold);
            remember(pid, liege.id, 'Kesemi zorla boşalttı.', -60, 999);
          }
          p.prestige = Math.max(0, p.prestige - 60);
          if (!p.traits.includes('oathbreaker')) p.traits.push('oathbreaker');
          return { success: false, beat: 'aldı', knell: true, title: 'Ferman Okundu',
            text: `Adamları kapıya geldi, mektubu yüksek sesle okudular ve kimse kılıcına davranmadı — seninkiler de.\n\n${t ? `${pv(t.provinceId)?.name || 'Bir kontluk'} artık onun.` : 'Ambarını ve keseni boşalttılar; toprağını almadılar çünkü alacak ikinci bir toprağın yok.'} Yemininin ne kadar ucuz olduğunu herkes duydu.`,
            effects: [t ? `<b>${pv(t.provinceId)?.name}</b> alındı` : `Kesen boşaltıldı`, '<b>Sözünden Dönen</b> damgası', '−60 itibar'] };
        },
      },
    ],
  });
}

// --- 3. a marriage that is also a leash --------------------------------------
function offerMarriage(c, a) {
  const pid = S.playerId, p = ch(pid);
  const mine = playerMatches();
  const theirs = marriageCandidates(c.id);
  if (!mine.length || !theirs.length) return;
  const kid = rng.pick(mine);
  const match = rng.pick(theirs);
  const lv = strengthOf(c.id);

  offer({
    kind: 'event',
    title: voice(c, ['Bir Nikâh Teklifi', 'Eşikteki Elçi', 'Gülümseyen Adam']),
    targetId: c.id,
    scene: sceneOf(c.id) || sceneOf(pid),
    framing: `${gen(fullName(c))} elçisi eşikte ayakkabılarını çıkarırken bile gülümsüyordu. İyi haber getiren adamlar böyle durmaz.`,
    body: `"${kid.name} için geldim. Efendim ${c.name}, ${match.name} ile nikâhını istiyor. Karşılığında sınırda bir daha ok atılmayacak ve efendim senin bayrağın altında ${lv} kılıç toplayacak."\n\n${kid.name} ${age(kid)} yaşında. Bu sabah avluda koşarken sesini duydun; şimdi elçinin sesini duyuyorsun.`,
    options: [
      {
        key: 'give',
        label: `${acc(kid.name)} ver. Bu bir ittifak.`,
        detail: 'Bir çocuk gider, bir sınır kapanır. Hangisinin daha ağır olduğunu yıllar sonra anlarsın.',
        confirm: `${kid.name} bu evden gidecek. Geri gelmesi senin elinde değil.`,
        stakes: [{ kind: STAKE.KIN, who: kid.name, irreversible: true }],
        waitDays: 220,
        odds: 0.68,
        tone: 'neutral',
        onCommit() {
          kid.spouseId = match.id; match.spouseId = kid.id;
          kid.courtOf = c.id;
          remember(c.id, pid, 'Aramızda bir nikâh var.', +45, 45);
          remember(pid, c.id, 'Aramızda bir nikâh var.', +25, 45);
          W().marriages++;
        },
        tells: [
          { at: 0.35, text: () => `${abl(kid.name)} ilk mektup geldi. Üç satır ve bir soru: "Beni ne zaman çağıracaksın?"`, goodTone: 'ambiguous', badTone: 'bad' },
          { at: 0.75, text: () => `${gen(fullName(c))} adamları bu ay sınırda görünmedi. İlk defa.`, goodTone: 'good', badTone: 'ambiguous' },
        ],
        onResolve(d, ok) {
          if (ok) {
            agenda(c).heat = 0;
            p.prestige += 60;
            return {
              success: true, beat: 'tuttu', title: 'Sınır Sessiz',
              text: `İki yıl geçti ve sınırda tek bir ok atılmadı. ${kid.name} bir kış mektubunda "burada kar daha erken yağıyor" yazdı, başka bir şey yazmadı.\n\nBir çocuğun sessizliğiyle satın alınmış bir barış, yine de barıştır.`,
              effects: [`<b>${fullName(c)}</b> artık müttefikin`, '+60 itibar', `<b>${kid.name}</b> orada yaşıyor`],
            };
          }
          remember(pid, c.id, `${acc(kid.name)} verdim, sözünü tutmadı.`, -60, 999);
          agenda(c).heat = 70;
          return {
            success: false, beat: 'tutmadı', knell: true, title: 'Nikâh Yetmedi',
            text: `${kid.name} gitti ve sınır yine kanadı. Elçi bu sefer gelmedi bile; haberi bir çobandan aldın.\n\nÇocuğunu verdin. Karşılığında aldığın şeyin adı yok.`,
            effects: [`<b>${kid.name}</b> onların sarayında`, 'İttifak boş çıktı', `<b>${fullName(c)}</b> yine sınırda`],
          };
        },
      },
      {
        key: 'refuse',
        label: 'Reddet.',
        detail: 'Elçi gülümsemeyi bırakacak. Sonrası onun bileceği iş.',
        stakes: [{ kind: STAKE.REPUTATION }],
        waitDays: 120,
        odds: 0.5,
        tone: 'neutral',
        onCommit() {
          remember(c.id, pid, 'Kızımı/oğlumu reddetti.', -40, 50);
          agenda(c).heat = Math.min(100, agenda(c).heat + 30);
        },
        tells: [
          { at: 0.5, text: () => `${fullName(c)} başka bir kapı çalmış. Kimin kapısı olduğunu söyleyen yok.`, goodTone: 'ambiguous', badTone: 'bad' },
        ],
        onResolve(d, ok) {
          // he marries someone else — and that someone is usually your neighbour
          const others = neighborsOf(c.id).filter((x) => x !== pid).map(ch).filter(Boolean);
          const ally = others.length ? rng.pick(others) : null;
          if (ally) {
            remember(c.id, ally.id, 'Aramızda bir nikâh var.', +35, 45);
            remember(ally.id, c.id, 'Aramızda bir nikâh var.', +35, 45);
            W().pacts++;
          }
          if (ok) {
            return { success: true, beat: 'geçti', title: 'Elçi Bir Daha Gelmedi', text: `${kid.name} avluda kaldı. ${fullName(c)} başka bir eve kız verdi ve bu yıl sınırda bir şey olmadı.\n\nBazen hayır demek sadece hayır demektir.`, effects: [`<b>${kid.name}</b> yanında`, ally ? `<b>${fullName(c)}</b> ile <b>${fullName(ally)}</b> akraba oldu` : ''].filter(Boolean) };
          }
          agenda(c).heat = 85;
          return { success: false, beat: 'pahalıya', title: 'Başka Bir Eve Verdiler', text: `${fullName(c)} kızını ${ally ? fullName(ally) : 'bir komşuna'} verdi. Düğün üç gün sürdü ve senin adın hiç anılmadı.\n\nŞimdi iki sınırın var ve ikisi de aynı kapıya bakıyor.`, effects: [ally ? `<b>${fullName(c)}</b> + <b>${fullName(ally)}</b> ittifakı` : 'Yeni bir ittifak', `<b>${kid.name}</b> yanında kaldı`] };
        },
      },
    ],
  });
}

// --- 4. pay me and I will not come this winter --------------------------------
function offerTribute(c, a) {
  const pid = S.playerId, p = ch(pid);
  const amt = clamp(Math.round(p.gold * 0.35) + 20, 25, 200);
  const prov = pv(provincesOf(pid)[0]);

  offer({
    kind: 'war',
    title: voice(c, ['Kış Vergisi', 'Sayılmış Tahıl', 'Hediye Diyorlar']),
    targetId: c.id,
    scene: sceneOf(pid),
    framing: `${foretold(c)}${gen(fullName(c))} adamları ${prov?.name || 'sınır köylerinde'} tahıl saydı. Sormadan, defter tutarak.`,
    body: `Elçisi kısa konuştu: "${amt} altın. Buna vergi demeyeceğiz, hediye diyeceğiz. Efendim hediyeleri hatırlar."\n\nKöy muhtarı kapıda duruyor. Sana bakıyor. Cevabı o taşıyacak.`,
    options: [
      {
        key: 'pay', label: 'Öde.',
        detail: 'Bir kez ödersen fiyatını öğretirsin. Ödemezsen bu kışı öğretirsin.',
        cost: [{ kind: STAKE.GOLD, value: amt }],
        disabled: p.gold < amt,
        disabledWhy: `Kesende ${amt} altın yok`,
        stakes: [{ kind: STAKE.GOLD, value: amt }],
        waitDays: 120, odds: 0.7,
        tone: 'neutral',
        tells: [{ at: 0.6, text: () => `${gen(fullName(c))} adamları bu ay köylerde görünmedi. Muhtar yine de tahılı gömüyor.`, goodTone: 'good', badTone: 'ambiguous' }],
        onResolve(d, ok) {
          if (ok) { agenda(c).heat = 22; return { success: true, beat: 'geçti', title: 'Bu Kış Sessiz', text: `Kimse gelmedi. Kâhyan defteri kapattı ve tek kelime etti: "Seneye."`, effects: [`−${amt} altın`, 'Bu kış huzurlu'] }; }
          agenda(c).heat = 88;
          if (prov) prov.unrest = Math.min(100, (prov.unrest || 0) + 20);
          return { success: false, beat: 'yetmedi', title: 'Yine Geldiler', text: `Altını aldılar ve iki ay sonra yine geldiler. Bu sefer defter tutmadılar; doğrudan ambarı açtılar.\n\nKöylüler artık senin adamlarına da bakmıyor.`, effects: [`−${amt} altın`, `${prov?.name || 'Köylerin'} huzursuz`] };
        },
      },
      {
        key: 'refuse', label: 'Muhtarı boş gönder.',
        detail: 'Cevap yok, cevaptır. Karşılığını köyler öder.',
        stakes: [{ kind: STAKE.REPUTATION }],
        waitDays: 170, odds: clamp(0.30 + strengthOf(pid) / Math.max(200, strengthOf(pid) + strengthOf(c.id)) * 0.7, 0.2, 0.8),
        tone: 'bad',
        tells: [
          { at: 0.45, text: () => `Sınırdaki iki köy bu hafta pazara inmedi.`, goodTone: 'ambiguous', badTone: 'bad' },
          { at: 0.8, text: () => `Gece ufukta bir ışık vardı. Sabah oradan duman geliyordu.`, goodTone: 'good', badTone: 'bad' },
        ],
        onCommit() { remember(c.id, pid, 'Elçimi boş gönderdi.', -35, 40); },
        onResolve(d, ok) {
          if (ok) { p.prestige += 60; agenda(c).heat = 30; return { success: true, beat: 'gelmediler', title: 'Blöftü', text: `Gelmediler. Muhtar üç ay her sabah ufka baktı, sonra bakmayı bıraktı.\n\nBazen bir adam sadece ne kadar korktuğunu ölçmek ister.`, effects: ['+60 itibar', 'Köyler yerinde'] }; }
          if (prov) { prov.unrest = Math.min(100, (prov.unrest || 0) + 40); prov.development = Math.max(1, prov.development - 2); }
          p.gold = Math.max(0, p.gold - Math.round(amt * 0.6));
          remember(pid, c.id, 'Köylerimi yaktı.', -65, 999);
          return { success: false, beat: 'yandı', title: 'İki Köy Yandı', knell: true, text: `Kar yağmadan geldiler. Ambarları boşalttılar, değirmeni yaktılar ve kimseyi öldürmediler — öldürselerdi bir daha gelemezlerdi.\n\nMuhtar ertesi gün geldi. Hiçbir şey söylemedi, sadece durdu.`, effects: [`${prov?.name || 'Sınır köyleri'} yakıldı`, 'Kalkınma düştü', 'Kesen yine eksildi'] };
        },
      },
      {
        key: 'kill', label: 'Elçiyi as.',
        detail: 'Cevabın sınırdaki her kapıda konuşulur. Bir daha kimse kolay kolay defter tutmaz.',
        confirm: 'Elçi öldürmek bir savaş ilanıdır. Herkes böyle anlar.',
        stakes: [{ kind: STAKE.LIFE, who: 'elçinin' }, { kind: STAKE.REPUTATION }],
        waitDays: 200, odds: clamp(0.24 + strengthOf(pid) / Math.max(200, strengthOf(pid) + strengthOf(c.id)) * 0.6, 0.15, 0.7),
        tone: 'bad',
        tells: [{ at: 0.5, text: () => `Sınırın öte yanında kilise çanları çalmış. Ölü için değil, toplanmak için.`, goodTone: 'ambiguous', badTone: 'bad' }],
        onCommit() {
          p.dreadBonus = (p.dreadBonus || 0) + 4;
          remember(c.id, pid, 'Elçimi astı.', -80, 999);
          agenda(c).heat = 100;
          for (const v of vassalsOf(pid)) remember(v.id, pid, 'Bir elçiyi astı. Sebebi vardı, ama yine de astı.', -8, 20);
        },
        onResolve(d, ok) {
          if (ok) { p.prestige += 110; return { success: true, beat: 'korktular', title: 'Sınırda Kimse Defter Tutmuyor', text: `Ceset üç gün kapıda kaldı. Dördüncü gün ${gen(fullName(c))} adamları geldi, aldılar ve tek kelime etmeden gittiler.\n\nO kıştan sonra kimse senin köylerinde tahıl saymadı.`, effects: ['+110 itibar', 'Korkun arttı', `<b>${fullName(c)}</b> kalıcı düşman`] }; }
          const own3 = directCountiesOf(pid);
          const t = own3.length > 1 ? own3[own3.length - 1] : null;
          if (t) { grantTitle(t.id, c.id, 'conquest'); W().seizures++; }
          else { p.gold = Math.max(0, p.gold - Math.round(amt * 1.5)); }
          p.prestige = Math.max(0, p.prestige - 80);
          return { success: false, beat: 'ödedin', title: 'Bedelini Ödedin', knell: true, text: `Bir elçinin hayatı ucuzdur; bir savaşın değil. Bahar geldiğinde kapında değil, kalenin içindeydiler.\n\n${t ? pv(t.provinceId)?.name : 'Bir kontluk'} artık onun.`, effects: [t ? `<b>${pv(t.provinceId)?.name}</b> kaybedildi` : 'Toprak kaybedildi', '−80 itibar'] };
        },
      },
    ],
  });
}

// --- 5. your own vassal has decided you are finished ---------------------------
function offerVassalDefiance(v) {
  const pid = S.playerId, p = ch(pid);
  const t = directCountiesOf(v.id)[0];
  const prov = t ? pv(t.provinceId) : null;
  const owed = Math.max(20, Math.round((IDX.income[v.id] || 8) * 12));

  offer({
    kind: 'council',
    title: `${v.name} Vergi Vermiyor`,
    targetId: v.id,
    scene: sceneOf(v.id) || sceneOf(pid),
    framing: `Defterdarın üç kez gitti, üç kez boş döndü. Dördüncüsünde kapıyı açmamışlar.`,
    body: `${fullName(v)} bu yıl ${owed} altın borçlu. Borcu inkâr etmiyor; sadece ödemiyor.\n\nSana bakışını biliyorsun: ${opinionLabel(opinion(v.id, pid))}. Diğer vassalların da bunu biliyor ve seni izliyorlar. Bu ay verdiğin cevap onların gelecek yıl ne ödeyeceğini belirleyecek.`,
    options: [
      {
        key: 'crush', label: 'Adamlarını topla ve kapısına git.',
        detail: 'Kendi vassalının üstüne yürümek. Diğerleri bunu ya ders alır ya da örnek.',
        confirm: `${gen(fullName(v))} kapısına silahla gitmek geri alınamaz.`,
        cost: [{ kind: STAKE.GOLD, value: Math.max(0, Math.min(50, Math.floor(p.gold * 0.25))) }],
        stakes: [{ kind: STAKE.LIFE, who: fullName(v) }, { kind: STAKE.REPUTATION }],
        waitDays: 150,
        odds: clamp(0.35 + skill(p, 'martial') * 0.025 + (strengthOf(pid) - strengthOf(v.id)) / 2600, 0.2, 0.86),
        tone: 'bad',
        tells: [
          { at: 0.4, text: () => `İki vassalın çağrına geç cevap verdi. "Yolda" diyorlar.`, goodTone: 'ambiguous', badTone: 'bad' },
          { at: 0.8, text: () => `${prov?.name || 'Kalesinin'} kapısı kapalı ve burçlarda adam var.`, goodTone: 'ambiguous', badTone: 'bad' },
        ],
        onResolve(d, ok) {
          if (ok) {
            v.imprisonedBy = pid;
            p.gold += owed;
            for (const x of vassalsOf(pid)) remember(x.id, pid, `${acc(v.name)} zincire vurdu. Ben de ödemiyordum.`, -10, 20);
            for (const x of vassalsOf(pid)) if (opinion(x.id, pid) < -20) x.gold = Math.max(0, (x.gold || 0) - 5);
            p.dreadBonus = (p.dreadBonus || 0) + 3;
            return { success: true, beat: 'ödedi', title: 'Kapı Açıldı', text: `Üçüncü gün kendisi açtı kapıyı. Borcu saydı, sonra zincire vurulurken hiçbir şey söylemedi.\n\nDiğer vassalların bu ay vergilerini erken gönderdi. Hiçbiri seninle göz göze gelmedi.`, effects: [`+${owed} altın`, `<b>${v.name}</b> zindanda`, 'Korkun arttı', 'Vassalların −10'] };
          }
          p.prestige = Math.max(0, p.prestige - 70);
          for (const x of vassalsOf(pid)) remember(x.id, pid, `${gen(v.name)} kapısından geri döndü.`, -25, 30);
          try { if (typeof Factions.joinFaction === 'function') Factions.joinFaction(v.id, 'discontent'); } catch { /* P09 not ready */ }
          v.faction = 'discontent';
          return { success: false, beat: 'döndün', title: 'Kapıdan Döndün', knell: true, text: `Kale duruyordu, kapı kapalıydı, ve senin adamların kışı orada geçiremezdi.\n\nDönerken kimse konuşmadı. Konuşmaya gerek yoktu: herkes ne gördüğünü biliyordu.`, effects: ['−70 itibar', 'Tüm vassalların −25', `<b>${v.name}</b> artık açıkça karşında`] };
        },
      },
      {
        key: 'bargain', label: 'Borcunu sil, sadakatini al.',
        detail: 'Ucuz görünüyor. Diğer vassalların da fiyat listesini öğreniyor.',
        stakes: [{ kind: STAKE.GOLD, value: owed }, { kind: STAKE.REPUTATION }],
        waitDays: 90, odds: clamp(0.45 + skill(p, 'diplomacy') * 0.025, 0.3, 0.85),
        tone: 'neutral',
        onCommit() { remember(v.id, pid, 'Borcumu sildi.', +40, 30); },
        onResolve(d, ok) {
          for (const x of vassalsOf(pid)) if (x.id !== v.id) remember(x.id, pid, `${gen(v.name)} borcunu sildi. Benimkini de silebilir.`, -12, 20);
          if (ok) return { success: true, beat: 'kazandın', title: 'Bir Adam Satın Alındı', text: `${fullName(v)} bu ilkbahar divanına geldi ve senin yanında oturdu.\n\nUcuza aldın. Diğerleri fiyatı gördü.`, effects: [`<b>${v.name}</b> +40`, 'Diğer vassalların −12'] };
          return { success: false, beat: 'yutmadı', title: 'Borcu Sildin, Adamı Alamadın', text: `Borcu sildin. Teşekkür bile etmedi — hakkı olduğunu düşünüyor.\n\nBu yıl da vergi gelmeyecek. Şimdi hem altın yok, hem otorite.`, effects: [`${owed} altın karşılıksız`, 'Vassalların −12'] };
        },
      },
      {
        key: 'wait', label: 'Bir şey yapma.',
        detail: 'Belki kendi kendine düzelir. Belki diğerleri de dener.',
        stakes: [{ kind: STAKE.REPUTATION }],
        waitDays: 300, odds: 0.35,
        tone: 'neutral',
        tells: [{ at: 0.6, text: () => `Bu ay iki vassalın vergisini yarım gönderdi. Not iliştirmişler: "hasat kötüydü".`, goodTone: 'ambiguous', badTone: 'bad' }],
        onResolve(d, ok) {
          if (ok) return { success: true, beat: 'geçti', title: 'Kendi Kendine Ödedi', text: `Sonbaharda altın geldi. Eksik değildi ama geç gelmişti ve bunu ikiniz de biliyordunuz.`, effects: [`+${owed} altın`] };
          const others = vassalsOf(pid).filter((x) => x.id !== v.id).slice(0, 3);
          for (const x of others) remember(x.id, pid, 'O ödemedi, ben niye ödeyeyim?', -30, 35);
          return { success: false, beat: 'yayıldı', title: 'Üç Kapı Daha Kapandı', text: `${v.name} ödemedi ve kimse ona bir şey olmadı. Bu, bir vassalın öğrenebileceği en pahalı ders.\n\nBu kış defterdarın dört kapıdan boş döndü.`, effects: ['Üç vassalın daha −30', 'Gelirin düştü'] };
        },
      },
    ],
  });
}


// --- 7. bend the knee: a tributary is not a vassal, but the road is the same ---
function offerOath(c, a) {
  const pid = S.playerId, p = ch(pid);
  const per = clamp(Math.round((IDX.income[pid] || 6) * 26), 20, 160);
  const mine = strengthOf(pid), theirs = strengthOf(c.id);

  offer({
    kind: 'edict',
    title: voice(c, ['Kırk Atlı, Eşikte', 'Eyerden İnmeyen Adam', 'Avludaki Gölge']),
    targetId: c.id,
    scene: sceneOf(pid),
    framing: `${foretold(c)}${gen(fullName(c))} seraskeri kırk atlıyla avluna girdi ve inmedi. Atlar terli değil; yolu ağır ağır gelmişler.`,
    body: `"Efendim ${c.name} sana bir yol açıyor. Yılda ${per} altın gönder, bayrağını da onun yanında taşı. Karşılığında sınırın onun sınırı olur.\n\nBu bir teklif değil. Bir tarih."\n\nSerasker eyerin üstünde bekliyor. Avluda senin kaç adamın olduğunu o da sayıyor, sen de.`,
    options: [
      {
        key: 'kneel', label: 'Kabul et. Vergiye bağlan.',
        detail: `Her yıl ${per} altın. Ve artık senin savaşın onun savaşı.`,
        confirm: 'Bir kez vergiye bağlanan, kendi adına konuşmayı bırakır.',
        stakes: [{ kind: STAKE.OATH }, { kind: STAKE.REPUTATION }],
        waitDays: 240, odds: 0.66, tone: 'neutral',
        onCommit() {
          W().tribute = { toId: c.id, perYear: per, sinceDay: S.day };
          p.prestige = Math.max(0, p.prestige - 80);
          remember(c.id, pid, 'Bana vergiye bağlandı.', +40, 60);
          for (const v of vassalsOfCached(pid)) remember(v.id, pid, 'Başkasının bayrağı altına girdi.', -25, 40);
        },
        tells: [
          { at: 0.4, text: () => `İlk vergi gitti. Kâhyan makbuz istedi; adamları güldü ve makbuz vermedi.`, goodTone: 'ambiguous', badTone: 'bad' },
          { at: 0.8, text: () => `${gen(fullName(c))} sancağı bu ay senin kalendeki burca da çekildi. Kimin astığını kimse söylemiyor.`, goodTone: 'ambiguous', badTone: 'bad' },
        ],
        onResolve(d, ok) {
          agenda(c).heat = 12;
          if (ok) return { success: true, beat: 'korundun', title: 'Sınırın Artık Onun Sınırı',
            text: `İki komşu bu yıl senin köylerine yaklaşmadı. Yaklaşamadılar: arkanda bir isim var.\n\nO ismin ne kadara mal olduğunu her hasat sonunda kâhyan sana hatırlatıyor.`,
            effects: [`Yılda ${per} altın gidiyor`, `<b>${fullName(c)}</b> seni koruyor`, '−80 itibar'] };
          return { success: false, beat: 'yutuldun', title: 'Vergi Verdin, Koruma Almadın', knell: true,
            text: `Altın her yıl gitti. Sınırda bir şey değişmedi; sadece artık kimse senin adını tek başına anmıyor.\n\nBir adamın gölgesinde durursan, güneşi de o keser.`,
            effects: [`Yılda ${per} altın gidiyor`, 'Koruma gelmedi', 'Vassalların bunu gördü'] };
        },
      },
      {
        key: 'refuse', label: 'Serasker gitsin. Cevabım yok.',
        detail: 'Kırk atlı geldiği gibi gider. Arkasından gelecek olan kırk atlı olmayacak.',
        confirm: `${fullName(c)} bu sessizliği cevap sayacak.`,
        cost: [{ kind: STAKE.GOLD, value: Math.max(0, Math.min(45, Math.floor(p.gold * 0.25))) }],
        stakes: [{ kind: STAKE.LIFE, who: 'adamlarının' }, { kind: STAKE.REPUTATION }],
        waitDays: 300,
        odds: clamp(0.20 + mine / Math.max(200, mine + theirs) * 0.85, 0.15, 0.8),
        tone: 'bad',
        tells: [
          { at: 0.3, text: () => `Serasker sınırı geçerken geri dönüp kaleye baktı. Sadece baktı.`, goodTone: 'ambiguous', badTone: 'bad' },
          { at: 0.7, text: () => `Bu hafta üç köylü ailesini alıp içeri, kale eteğine taşındı. Kimse onlara git demedi.`, goodTone: 'ambiguous', badTone: 'bad' },
        ],
        onCommit() { remember(c.id, pid, 'Seraskerimi eşikten çevirdi.', -55, 70); agenda(c).heat = 95; },
        onResolve(d, ok) {
          const prov = pv(provincesOf(pid)[0]);
          if (ok) {
            p.prestige += 130;
            if (!p.traits.includes('victorious') && rng.chance(0.35)) p.traits.push('victorious');
            for (const v of vassalsOfCached(pid)) remember(v.id, pid, 'Diz çökmedi.', +30, 40);
            return { success: true, beat: 'gelmediler', title: 'Kırk Atlı Bir Daha Gelmedi',
              text: `Bir kış boyunca her sabah surdan baktın. Gelmediler.\n\nİlkbaharda öğrendin: başka bir kapıya gitmişler ve orada diz çökmüşler. Sen çökmedin ve bunu herkes biliyor.`,
              effects: ['+130 itibar', 'Vassalların gördü', `<b>${fullName(c)}</b> başka kapı buldu`] };
          }
          if (prov) { prov.unrest = Math.min(100, (prov.unrest || 0) + 40); prov.development = Math.max(1, prov.development - 3); }
          p.gold = Math.max(0, p.gold - Math.round(per * 1.4));
          p.prestige = Math.max(0, p.prestige - 70);
          if (!p.traits.includes('humbled')) p.traits.push('humbled');
          remember(pid, c.id, 'Ekinimi yaktı, sonra vergisini aldı.', -75, 999);
          W().tribute = { toId: c.id, perYear: per, sinceDay: S.day, forced: true };
          return { success: false, beat: 'zorla', title: 'Ekin Biçilmeden Yandı', knell: true,
            text: `Hasat vaktinde geldiler. Kimseyi öldürmediler; tarlaları yaktılar ve durup seyrettiler.\n\nSerasker aynı avluya girdi, yine inmedi, aynı rakamı söyledi. Bu sefer pazarlık yoktu.`,
            effects: [`${prov?.name || 'Toprakların'} yakıldı`, `Yılda ${per} altın — zorla`, '<b>Ezik</b> damgası'] };
        },
      },
    ],
  });
}

// --- 8. the tribute you have been paying for years ----------------------------
function offerBreakTribute(c, a) {
  const pid = S.playerId, p = ch(pid);
  const A = W();
  const per = A.tribute?.perYear || 40;
  const years = Math.max(1, Math.round((S.day - (A.tribute?.sinceDay || S.day)) / YEAR));
  const paid = per * years;

  offer({
    kind: 'edict',
    title: `${years} Yıllık Defter`,
    targetId: c.id,
    scene: sceneOf(pid),
    framing: `Kâhyan defteri açtı ve tek bir rakam gösterdi: ${paid}. ${gen(fullName(c))} kesesine giden altın.`,
    body: `"Efendim," dedi, "bu parayla iki kale yapardık."\n\nBu yılın vergisi hazır, arabaya yüklendi, sürücü bekliyor. Bir kelime söylersen araba çıkmaz.\n\nBir kelime söylersen ${c.name} bunu bir savaş ilanı sayar.`,
    options: [
      {
        key: 'pay', label: 'Araba çıksın.',
        detail: 'Bir yıl daha. Bir yıl daha hep söylenir.',
        cost: [{ kind: STAKE.GOLD, value: Math.max(0, Math.min(per, Math.floor(p.gold))) }],
        stakes: [{ kind: STAKE.GOLD, value: per }],
        waitDays: 40, tone: 'neutral',
        onResolve() {
          return { success: true, beat: 'ödendi', title: 'Araba Çıktı',
            text: `Kâhyan defteri kapattı ve bir şey söylemedi. Söylemediği şey odaya asıldı ve orada kaldı.`,
            effects: [`−${per} altın`, 'Defter büyüyor'] };
        },
      },
      {
        key: 'stop', label: 'Arabayı boşalt.',
        detail: `${years} yıldır ödüyorsun. Durduğun gün savaş başlar ve bunu ikiniz de bilirsiniz.`,
        confirm: 'Vergiyi kesmek savaş ilanıdır. Geri dönüşü yok.',
        stakes: [{ kind: STAKE.OATH }, { kind: STAKE.LIFE, who: 'adamlarının' }],
        waitDays: 280,
        odds: clamp(0.24 + strengthOf(pid) / Math.max(200, strengthOf(pid) + strengthOf(c.id)) * 0.9, 0.18, 0.85),
        tone: 'bad',
        tells: [
          { at: 0.25, text: () => `${gen(fullName(c))} elçisi geldi, karşılanmadı, bekletildi, sonra gitti. Hiçbir şey söylemedi.`, goodTone: 'ambiguous', badTone: 'bad' },
          { at: 0.6, text: () => `Kâhyan bu ay altınları saymadı; sakladı. Nereye sakladığını sana bile söylemiyor.`, goodTone: 'ambiguous', badTone: 'ambiguous' },
          { at: 0.88, text: () => `Sınırdaki değirmenci ailesini alıp gitmiş. Değirmen dönüyor, içeride kimse yok.`, goodTone: 'good', badTone: 'bad' },
        ],
        onCommit() {
          W().tribute = null;
          remember(c.id, pid, 'Vergimi kesti.', -70, 999);
          agenda(c).heat = 100;
        },
        onResolve(d, ok) {
          if (ok) {
            p.prestige += 160;
            for (const v of vassalsOfCached(pid)) remember(v.id, pid, 'Boyunduruğu kırdı.', +35, 50);
            imprint({ kind: 'freedom', day: S.day, actorId: pid, targetId: c.id, weight: 0.6,
              text: `${gen(fullName(c))} vergisini kestin ve ayakta kaldın.` });
            return { success: true, beat: 'kırıldı', title: 'Araba Boşaldı',
              text: `Geldiler. Üç hafta surların dibinde durdular, sonra çekildiler — kışı senin tarlanda geçiremezlerdi.\n\nKâhyan o akşam defteri getirdi ve önünde yaktı. Kâğıt yanarken kimse konuşmadı.`,
              effects: ['+160 itibar', `Yıllık ${per} altın sende kalıyor`, 'Vassalların gördü'] };
          }
          const own = directCountiesOf(pid);
          const t = own.length > 1 ? own[own.length - 1] : null;
          if (t) { grantTitle(t.id, c.id, 'conquest'); W().seizures++; }
          p.gold = Math.max(0, p.gold - per * 2);
          W().tribute = { toId: c.id, perYear: Math.round(per * 1.6), sinceDay: S.day, forced: true };
          p.prestige = Math.max(0, p.prestige - 110);
          return { success: false, beat: 'pahalıya', title: 'Defter Yeniden Açıldı', knell: true,
            text: `Kapıyı kırmadılar; kâhyanı çağırıp defteri istediler. Rakamı kendileri yazdı.\n\n${t ? `${pv(t.provinceId)?.name} da o deftere yazıldı.` : 'Bu yılki hasadın tamamı o deftere yazıldı.'}`,
            effects: [t ? `<b>${pv(t.provinceId)?.name}</b> gitti` : 'Hasadın gitti', `Vergi ${Math.round(per * 1.6)} altına çıktı`, '−110 itibar'] };
        },
      },
    ],
  });
}

// --- 9. an army wants to walk through your fields -----------------------------
function offerPassage(c, a) {
  const pid = S.playerId, p = ch(pid);
  const prov = pv(provincesOf(pid)[0]);
  const foe = neighborsOf(c.id).map(ch).filter((x) => x && x.id !== pid && x.deathDay == null)[0];
  const toll = clamp(Math.round(strengthOf(c.id) / 22), 20, 120);

  offer({
    kind: 'war',
    title: voice(c, ['Geçit', 'Dar Yol', 'Üç Günlük Yol']),
    targetId: c.id,
    scene: sceneOf(pid),
    framing: `${gen(fullName(c))} ordusu üç günlük yolda ve gitmek istediği yer senin tarlalarının öte yanında.`,
    body: `Elçi haritayı senin masana serdi, parmağını ${prov ? prov.name : 'topraklarının'} üstüne koydu ve orada bıraktı.\n\n"Geçeriz, geçeriz. Sadece nasıl geçeceğimizi sen söyle."\n\n${foe ? `Gittikleri yer ${gen(fullName(foe))} toprağı. Bu savaş senin savaşın değil — henüz.` : 'Nereye gittiklerini söylemiyor.'}`,
    options: [
      {
        key: 'allow', label: 'Geçsinler.',
        detail: 'Bir ordu geçtiği yerden yiyerek geçer. Ama dostluk da bir mahsuldür.',
        stakes: [{ kind: STAKE.REPUTATION }],
        waitDays: 140, odds: 0.62, tone: 'neutral',
        onCommit() {
          if (prov) prov.development = Math.max(1, prov.development - 1);
          remember(c.id, pid, 'Ordumu topraklarından geçirdi.', +35, 40);
          if (foe) remember(foe.id, pid, 'Düşmanımın ordusunu topraklarından geçirdi.', -40, 50);
        },
        tells: [{ at: 0.5, text: () => `Ordu geçti. İki köyde tavuk kalmamış, bir köyde kız kalmamış.`, goodTone: 'ambiguous', badTone: 'bad' }],
        onResolve(d, ok) {
          agenda(c).heat = Math.max(0, agenda(c).heat - 35);
          if (ok) return { success: true, beat: 'geçtiler', title: 'Geçtiler ve Gittiler',
            text: `On gün sürdü. Onuncu gün tarlalarda çamurdan başka bir şey yoktu ama kimse ölmedi.\n\n${fullName(c)} dönüşte bir at yolladı. At iyi bir at.`,
            effects: [`<b>${fullName(c)}</b> +35`, 'Kalkınma düştü', foe ? `<b>${fullName(foe)}</b> −40` : ''].filter(Boolean) };
          if (prov) { prov.unrest = Math.min(100, (prov.unrest || 0) + 30); prov.development = Math.max(1, prov.development - 2); }
          return { success: false, beat: 'pahalıya', title: 'Geçerken Yediler', knell: false,
            text: `Ambarları açtılar, "sonra öderiz" dediler, ödemediler. Bir köy muhtarı karşı çıktı ve şimdi o köyün muhtarı yok.\n\nSenin toprağında, senin adına, senden izinli.`,
            effects: [`${prov?.name || 'Toprağın'} huzursuz`, 'Kalkınma düştü', 'Köylüler senin adını anıyor'] };
        },
      },
      {
        key: 'toll', label: `Geçit parası iste — ${toll} altın.`,
        detail: 'Bir orduya fiyat söylemek cesaret ister. Cesaret bazen pahalıdır.',
        stakes: [{ kind: STAKE.GOLD, value: toll }, { kind: STAKE.REPUTATION }],
        waitDays: 120,
        odds: clamp(0.34 + skill(p, 'diplomacy') * 0.028, 0.25, 0.82),
        tone: 'neutral',
        onResolve(d, ok) {
          if (ok) {
            p.gold += toll;
            remember(c.id, pid, 'Geçit parası aldı benden.', -18, 25);
            return { success: true, beat: 'ödediler', title: 'Ödediler',
              text: `Saydılar, homurdandılar, ödediler. Serasker geçerken sana bakmadı bile.\n\nAltın kesende. Ama bir daha o adamdan iyilik bekleme.`,
              effects: [`+${toll} altın`, `<b>${fullName(c)}</b> −18`] };
          }
          if (prov) prov.unrest = Math.min(100, (prov.unrest || 0) + 25);
          remember(c.id, pid, 'Ordumdan para istedi.', -45, 60);
          agenda(c).heat = Math.min(100, agenda(c).heat + 25);
          return { success: false, beat: 'gülüştüler', title: 'Parayı Vermediler, Yine de Geçtiler',
            text: `Elçi güldü. Serasker gülmedi — daha kötüsü, cevap bile vermedi.\n\nOrdusu geçti, tarlaların çiğnendi ve sen kapıda durup saydın.`,
            effects: ['Altın gelmedi', `${prov?.name || 'Tarların'} çiğnendi`, `<b>${fullName(c)}</b> seni not etti`] };
        },
      },
      {
        key: 'block', label: 'Geçidi kapat.',
        detail: 'Bir orduya hayır demek, o orduyu üstüne çekmektir.',
        confirm: 'Geçidi kapatmak savaş demektir.',
        cost: [{ kind: STAKE.GOLD, value: Math.max(0, Math.min(40, Math.floor(p.gold * 0.2))) }],
        stakes: [{ kind: STAKE.LIFE, who: 'adamlarının' }],
        waitDays: 200,
        odds: clamp(0.26 + (prov?.defense || 0) * 0.05 + strengthOf(pid) / Math.max(200, strengthOf(pid) + strengthOf(c.id)) * 0.6, 0.18, 0.8),
        tone: 'bad',
        tells: [
          { at: 0.35, text: () => `Geçidin başında iki gün beklediler. Üçüncü gün ateş yakmadılar.`, goodTone: 'ambiguous', badTone: 'bad' },
          { at: 0.75, text: () => `Dağdaki çobanlar aşağı indi. Sürüleriyle birlikte.`, goodTone: 'ambiguous', badTone: 'bad' },
        ],
        onCommit() {
          remember(c.id, pid, 'Yolumu kesti.', -60, 80);
          if (foe) remember(foe.id, pid, 'Düşmanımın yolunu kesti.', +50, 60);
        },
        onResolve(d, ok) {
          if (ok) {
            p.prestige += 120;
            p.dreadBonus = (p.dreadBonus || 0) + 3;
            return { success: true, beat: 'döndüler', title: 'Geçit Kapalı Kaldı',
              text: `Dar bir yol, yüksek iki yamaç ve senin doksan adamın. Saydılar ve gitmediler.\n\nDört gün sonra geri döndüler. ${foe ? `${fullName(foe)} o kışı sana borçlu geçirdi.` : 'O savaş başlamadan bitti.'}`,
              effects: ['+120 itibar', foe ? `<b>${fullName(foe)}</b> +50` : '', 'Korkun arttı'].filter(Boolean) };
          }
          if (prov) { prov.unrest = Math.min(100, (prov.unrest || 0) + 45); prov.development = Math.max(1, prov.development - 2); }
          p.prestige = Math.max(0, p.prestige - 60);
          remember(pid, c.id, 'Geçitte adamlarımı kırdı.', -70, 999);
          return { success: false, beat: 'kırıldı', title: 'Geçit Açıldı', knell: true,
            text: `Yamaçtan indiler; kimse yamaçtan inebileceklerini düşünmemişti. Geçit sabaha açıktı.\n\nAdamlarını gömerken ${fullName(c)} çoktan öbür tarafa varmıştı.`,
            effects: ['Adamlarını kaybettin', `${prov?.name || 'Toprağın'} çiğnendi`, '−60 itibar'] };
        },
      },
    ],
  });
}

// --- 6. you caught his man in your kitchen -------------------------------------
function offerCaughtSpy(by, plot) {
  const pid = S.playerId, p = ch(pid);
  const spy = S.council?.spymaster ? ch(S.council.spymaster) : null;

  offer({
    kind: 'scheme',
    title: voice(by, ['Mutfakta Bir Yabancı', 'Kapağı Açılmamış Şişe', 'Cebinden Çıkan Mühür']),
    targetId: by.id,
    scene: sceneOf(pid),
    framing: `${spy ? fullName(spy) : 'Casusun'} bir adamı avluya getirdi. Adamın cebinden çıkan mühür ${dat(fullName(by))} ait.`,
    body: plot.kind === 'poison'
      ? `Adam üç gündür senin mutfağında çalışıyormuş. Kimse ne zaman geldiğini hatırlamıyor.\n\nÜzerinden çıkan şeyi ${spy ? spy.name : 'casusun'} masaya koydu ve eliyle itti. Küçük bir şişe. Kapağı açılmamış.`
      : `Adam bir kese taşıyormuş ve kesenin gideceği kapıyı biliyor. Senin vassallarından birinin kapısı.\n\n${spy ? spy.name : 'Casusun'} ismi söylemedi. "Önce ne yapacağını söyle," dedi.`,
    options: [
      {
        key: 'hang', label: 'As. Herkes görsün.',
        detail: `${fullName(by)} mesajı alacak. Sınırdaki herkes de alacak.`,
        confirm: 'Bir adamı asmak geri alınamaz.',
        stakes: [{ kind: STAKE.LIFE, who: 'yakalanan adamın' }],
        waitDays: 120, odds: 0.6, tone: 'bad',
        onCommit() { p.dreadBonus = (p.dreadBonus || 0) + 3; agenda(by).heat = Math.min(100, agenda(by).heat + 35); },
        tells: [{ at: 0.6, text: () => `${gen(fullName(by))} sarayından bir ay boyunca haber gelmedi.`, goodTone: 'ambiguous', badTone: 'bad' }],
        onResolve(d, ok) {
          if (ok) return { success: true, beat: 'anladı', title: 'Bir Daha Denemedi', text: `Ceset iki gün kapıda kaldı. ${fullName(by)} bir daha senin mutfağına adam sokmadı.\n\nBaşka kapılar denedi. Ama seninkini değil.`, effects: ['Korkun arttı', `<b>${fullName(by)}</b> geri çekildi`] };
          agenda(by).heat = 95;
          return { success: false, beat: 'kışkırttın', title: 'Bir Adam Astın, Bir Düşman Kazandın', knell: true, text: `${fullName(by)} cenazeyi kendi parasıyla kaldırdı ve adamın ailesine toprak verdi.\n\nŞimdi orada senin adını bilen bir ev daha var.`, effects: [`<b>${fullName(by)}</b> kalıcı düşman`, 'Yeni bir kin doğdu'] };
        },
      },
      {
        key: 'turn', label: 'Geri gönder — ama artık senin için çalışsın.',
        detail: 'Ucuz ve tehlikeli. Bir kez satılan adam iki kez satılır.',
        cost: [{ kind: STAKE.GOLD, value: 35 }],
        stakes: [{ kind: STAKE.SECRET }],
        waitDays: 260, odds: clamp(0.30 + (spy ? skill(spy, 'intrigue') : 0) * 0.035, 0.25, 0.8), tone: 'neutral',
        tells: [
          { at: 0.4, text: () => `Adamdan ilk haber geldi: ${fullName(by)} bu bahar bir şey planlıyormuş. Fazlasını yazmamış.`, goodTone: 'good', badTone: 'ambiguous' },
          { at: 0.85, text: () => `İkinci mektup gelmedi.`, goodTone: 'ambiguous', badTone: 'bad' },
        ],
        onResolve(d, ok) {
          if (ok) {
            agenda(by).heat = Math.max(0, agenda(by).heat - 40);
            agenda(by).told = 0;
            return { success: true, beat: 'senin oldu', title: 'Artık Onun Sofrasında Senin Adamın Var', text: `Mektuplar düzenli geliyor. ${gen(fullName(by))} ne planladığını sen ondan önce öğreniyorsun.\n\nBu, sahip olabileceğin en rahatsız edici huzur.`, effects: [`<b>${fullName(by)}</b>'in planlarını görüyorsun`, 'Casusun memnun'] };
          }
          p.secrets.push({ id: `turned_${by.id}`, kind: 'doubleagent', day: S.day });
          remember(pid, by.id, 'Adamımı geri çevirdi.', -40, 60);
          return { success: false, beat: 'çevirdiler', title: 'Adamı Geri Çevirdiler', knell: true, text: `Adam iki mektup yazdı, sonra sustu. Üçüncü mektubu ${fullName(by)} yazdı — senin kalendeki muhafız sayısını sana bildiriyordu.\n\nŞimdi o senin evini biliyor.`, effects: ['Casusun ele geçti', `<b>${fullName(by)}</b> kalenin içini biliyor`] };
        },
      },
      {
        key: 'quiet', label: 'Kimseye söyleme. Bekle.',
        detail: 'Bildiğini bilmesinler. En ucuz seçenek her zaman en ucuz değildir.',
        stakes: [{ kind: STAKE.SECRET }],
        waitDays: 200, odds: 0.45, tone: 'neutral',
        tells: [{ at: 0.55, text: () => `Mutfakta bir şey değişti ama ne olduğunu kimse söyleyemiyor.`, goodTone: 'ambiguous', badTone: 'bad' }],
        onResolve(d, ok) {
          if (ok) return { success: true, beat: 'geçti', title: 'Hiçbir Şey Olmadı', text: `Adam bir gece kayboldu. Kimse aramadı, kimse sormadı.\n\nBazen bir kapıyı kapalı tutmak yeter.`, effects: ['Kimse bir şey öğrenmedi'] };
          landPlot(by, plot);
          return { success: false, beat: 'geç kaldın', title: 'Beklemek de Bir Karardı', knell: true, text: `Beklediğin şey oldu. Bekleyerek olmasına izin verdin.\n\nCasusun sana bakmıyor artık.`, effects: ['Plan gerçekleşti'] };
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// slower drums
// ---------------------------------------------------------------------------
/**
 * The one place the player's neighbours are weighed. It used to run inside the
 * daily slice, which meant `vassalsOf` and `opinion` were called thousands of
 * times a year for a number that moves like a glacier. Once a month is plenty.
 */
function updatePressure(day) {
  const pid = S.playerId;
  if (!pid) return;
  const seen = new Set();
  const list = neighborsOf(pid).slice();
  if (IDX.lord) list.push(IDX.lord);
  for (const id of vassalIds(pid)) list.push(id);
  for (const id of list) {
    if (id === pid || seen.has(id)) continue;
    seen.add(id);
    const c = ch(id);
    if (!c || c.deathDay != null) continue;
    const a = agenda(c);
    const rel = playerRelation(c, pid) || { near: true, isLiege: IDX.lord === id, isVassal: false };
    const want = wantOf(c, a, pid, rel);
    a.heat = clamp(a.heat + (want - a.heat) * 0.10, 0, 100);
    if (a.heat < 18) a.told = 0;         // a build-up that cooled can start again
    leakBuildup(c, a);
  }
  // everyone else cools off
  for (const id of IDX.rulers) {
    if (seen.has(id) || id === pid) continue;
    const c = ch(id);
    if (c?.ai?.v && c.ai.heat > 0) c.ai.heat *= 0.94;
  }
}

function monthlyMoves(day) {
  // The player's own irreversible deeds raise the temperature around them.
  const pid = S.playerId;
  if (!pid) return;
  const recent = (S.memories || []).filter((m) => m.day > day - 400 && m.weight > 0.4);
  if (recent.length) {
    for (const id of neighborsOf(pid)) {
      const c = ch(id);
      if (!c || c.deathDay != null) continue;
      const a = agenda(c);
      a.heat = clamp(a.heat + recent.length * 1.2 * (0.4 + a.land), 0, 100);
    }
  }
  // the tribute you swore to pay leaves the treasury whether you look or not
  const A = W();
  if (A.tribute) {
    const lord = ch(A.tribute.toId);
    if (!lord || lord.deathDay != null) {
      A.tribute = null;
    } else {
      const p2 = ch(S.playerId);
      const due = A.tribute.perYear / 12;
      if (p2) {
        const paid = Math.min(p2.gold, due);
        p2.gold = Math.max(0, p2.gold - paid);
        lord.gold = (lord.gold || 0) + paid;
        if (paid < due * 0.9 && rng.chance(0.25)) {
          rumor(`${gen(fullName(lord))} tahsildarı bu ay eli boş döndü. Bir daha eli boş dönmeyecek.`,
            'bad', { actorId: lord.id, targetId: S.playerId, force: 0.4 });
        }
      }
    }
  }
  maybePlot(day);
}

function yearlyMoves(day) {
  // Once a year the wolves that have been sharpening claims actually bite.
  const movers = [];
  for (const id of IDX.rulers) {
    const c = ch(id);
    if (!c || c.deathDay != null || c.imprisonedBy) continue;
    const a = agenda(c);
    if (a.goal !== 'land' && a.land < 0.5) continue;
    movers.push({ c, a, w: 1 + a.land * 4 + a.risk * 3 });
  }
  if (!movers.length) return;
  const n = Math.min(6, 2 + Math.floor(movers.length / 12));
  for (let i = 0; i < n; i++) {
    const pick = rng.weighted(movers);
    if (!pick) break;
    deedSeize(pick.c, pick.a);
    movers.splice(movers.indexOf(pick), 1);
    if (!movers.length) break;
  }
}

// ---------------------------------------------------------------------------
// the tick
// ---------------------------------------------------------------------------
const SLICES = 13;

export function tickAI(day) {
  if (!S.playerId) return;
  try {
    if (day - IDX.day >= 30 || day < IDX.day) rebuildIndex(day);
    const rulers = IDX.rulers;
    if (!rulers.length) return;

    const slice = ((day % SLICES) + SLICES) % SLICES;
    for (let i = slice; i < rulers.length; i += SLICES) {
      const c = ch(rulers[i]);
      if (!c || c.deathDay != null) continue;
      think(c, day);
    }

    tickPlots(day);
    if (day % 30 === 3) updatePressure(day);
    if (day % 90 === 41) seasonalReport(day);
    if (day % 30 === 7) monthlyMoves(day);
    if (day % YEAR === 21) yearlyMoves(day);
    pressurePlayer(day);
  } catch (e) {
    // A sibling piece changing shape under us must never stop the world.
    console.error('[ai] tick', e);
  }
}

/**
 * If the player was given warnings, the letter should say so. A signal you read
 * and then watched come true is worth more than the signal or the blow alone.
 */
function foretold(c) {
  const t = c.ai?.told || 0;
  if (t >= 3) return voice(c, [
    'Üç mevsimdir bu mektubu bekliyordun. Geldi.',
    'Sınırdaki ateşleri sayan çobanın haklıymış.',
    'Casusun aylardır bu ismi söylüyordu. Bugün mühür de geldi.',
  ]) + ' ';
  if (t === 2) return 'Bir şey olacağını biliyordun; ne olacağını bilmiyordun. ';
  return '';
}

/** For panels and tooltips: what does this ruler want from you, in one line? */
export function aiIntent(charId) {
  const c = ch(charId);
  if (!c || !c.ai || c.id === S.playerId) return null;
  const a = c.ai;
  if (a.heat > 78) return 'senin toprağını istiyor';
  if (a.heat > 50) return 'seni tartıyor';
  if (a.goal === 'land') return 'sınır tapuları karıştırıyor';
  if (a.goal === 'gold') return 'kesesini düşünüyor';
  if (a.goal === 'revenge') return 'bir defter tutuyor';
  if (a.goal === 'bond') return 'akrabalık arıyor';
  if (a.goal === 'curb') return 'vassallarını sıkıyor';
  return null;
}

export function aiStats() { return { ...W() }; }
