// ===========================================================================
// P06 — ENTRIKA.  The long plot.
// ---------------------------------------------------------------------------
// A decision is one held breath. A scheme is a year of them.
//
// Four rules hold this piece up:
//
//  1. THE DIE IS CAST AT THE START.  `sealedRoll` is drawn the day you commit
//     and never touched again. Everything you do afterwards — recruiting,
//     bribing, hiding, rushing — moves the THRESHOLD, not the number. So the
//     wait is never a slot machine: it is a sealed letter already riding
//     toward you, and your work is to widen the door it has to fit through.
//
//  2. PROGRESS AND SECRECY PULL AGAINST EACH OTHER.  Every man who makes you
//     faster also makes you louder. Asking for help IS the risk. There is no
//     move on this board that is free.
//
//  3. WHAT YOU SPEND DOES NOT COME BACK.  Abort whenever you like; the gold is
//     gone, the secrecy is gone, and every man you asked still remembers being
//     asked.
//
//  4. THE SHADOWS RUN BOTH WAYS.  Other people plot against you on exactly the
//     same clock, and whether you ever hear about it depends on one man's
//     intrigue score. A plot you never detected still ticks.
//
// No Math.random in here — everything through `rng` — and nothing but plain
// JSON goes into `S`.
// ===========================================================================

import { S, rng, newId, ch, alive, livingChars } from '../core/state.js';
import { emit } from '../core/bus.js';
import { streamed } from '../core/rng.js';
import { YEAR, fmtDate } from '../core/date.js';
import {
  fullName, age, skill, opinion, remember, relation, isKin, kill, traitAi, livingChildren,
} from './characters.js';
import { vassalsOf, directCountiesOf, primaryTitle, titleName, topLiege, TIER } from './realm.js';
import { offer, STAKE } from './decision.js';
import { succeed } from './succession.js';
import {
  SCHEME_TYPES, schemeType, INVITE_YES, INVITE_NO, INVITE_NO_ANGRY,
  EXPOSE_SIGN, LEAK_LINE, WOBBLE, SNITCH,
} from '../content/schemes.js';

export { SCHEME_TYPES, schemeType };
/** Kept for the old stub's import shape. */
export const SCHEMES = { get list() { return S.schemes; } };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const P = () => ch(S.playerId);
const list = () => (S.schemes ||= []);
const live = (sc) => sc.state === 'active' || sc.state === 'ripe';

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

/** How fast the plot walks, in percent per day. */
export function progressRate(sc) {
  const t = schemeType(sc.typeId);
  const o = ch(sc.ownerId);
  if (!t || !o) return 0;
  let f = 0.62 + Math.min(0.95, skill(o, t.skill) * 0.048);
  for (const p of sc.partners) {
    const role = t.roles.find((r) => r.id === p.roleId);
    const c = ch(p.id);
    if (!role || !c) continue;
    f += 0.10 + Math.min(0.16, skill(c, role.skill) * 0.011);
  }
  if (sc.mode === 'rush') f *= 2.05;
  if (sc.mode === 'quiet') f *= 0.18;
  return (100 / t.days) * f;
}

/** How fast the secret leaks, in points of secrecy per day. */
export function heatRate(sc) {
  const t = schemeType(sc.typeId);
  const o = ch(sc.ownerId), tg = ch(sc.targetId);
  if (!t || !o || !tg) return 0;
  let mouths = 1;
  for (const p of sc.partners) {
    const role = t.roles.find((r) => r.id === p.roleId);
    mouths += (role?.heat ?? 0.6);
    if (p.bribe) mouths += 0.20;                 // money leaves a trail
  }
  const conceal = 1 + skill(o, 'intrigue') * 0.055;
  let vigil = 1 + skill(tg, 'intrigue') * 0.045;
  if (tg.traits?.includes('paranoid')) vigil += 0.35;
  if (sc.discovery >= 1) vigil += 0.55;          // once they suspect, they look
  let h = t.heat * mouths * (vigil / conceal);
  if (sc.mode === 'rush') h *= 2.30;
  if (sc.mode === 'quiet') h *= 0.30;
  return h;
}

/** The threshold the sealed roll has to beat. */
export function oddsOf(sc) {
  const t = schemeType(sc.typeId);
  const o = ch(sc.ownerId), tg = ch(sc.targetId);
  if (!t || !o || !tg) return 0;
  let x = t.base + skill(o, t.skill) * 0.021;
  for (const p of sc.partners) {
    const role = t.roles.find((r) => r.id === p.roleId);
    const c = ch(p.id);
    if (!role || !c) continue;
    x += role.succ * (0.55 + Math.min(0.9, skill(c, role.skill) / 16));
  }
  x -= skill(tg, 'intrigue') * 0.011;
  if (tg.traits?.includes('paranoid')) x -= 0.06;
  if (sc.discovery >= 1) x -= 0.14;
  if (sc.mode === 'rush') x -= 0.10;
  x += (sc.oddsBonus || 0);
  return clamp(x, 0.03, 0.94);
}

/**
 * What the player is allowed to see. A schemer with a poor head for this work
 * gets a wide, useless band; a good one gets close to the truth. Never exact —
 * the exact number only appears the night you strike.
 */
export function oddsBand(sc) {
  const o = ch(sc.ownerId);
  const real = oddsOf(sc);
  const sk = o ? skill(o, 'intrigue') : 0;
  const fog = clamp(0.30 - sk * 0.019, 0.045, 0.30);
  const bias = (streamed(S.seed, `band${sc.id}`)() - 0.5) * fog * 0.8;
  const lo = clamp(real + bias - fog, 0.02, 0.97);
  const hi = clamp(real + bias + fog, 0.03, 0.98);
  return { lo, hi, fog };
}

export function daysLeft(sc) {
  const r = progressRate(sc);
  if (r <= 0) return 9999;
  return Math.max(0, Math.round((100 - sc.progress) / r));
}
export function humanDays(d) {
  if (d >= 9000) return 'belirsiz';
  if (d < 30) return `${d} gün`;
  if (d < 365) return `${Math.round(d / 30)} ay`;
  return `${(d / 365).toFixed(1)} yıl`;
}
export function secrecyWord(s) {
  if (s > 82) return 'kimse bilmiyor';
  if (s > 62) return 'iki üç ağız';
  if (s > 42) return 'fısıltı var';
  if (s > 24) return 'konuşuluyor';
  if (s > 10) return 'neredeyse açık';
  return 'kapıda';
}

// ---------------------------------------------------------------------------
// launching
// ---------------------------------------------------------------------------

/** Everyone the player could aim `typeId` at, with a reason attached. */
export function launchTargets(typeId) {
  const t = schemeType(typeId);
  const p = P();
  if (!t || !p) return [];
  const seen = new Set();
  const out = [];
  const consider = (c, why) => {
    if (!c || c.deathDay != null || c.id === p.id || seen.has(c.id)) return;
    if (t.can && !t.can(c)) return;
    if (list().some((sc) => live(sc) && sc.ownerId === p.id && sc.targetId === c.id)) return;
    seen.add(c.id);
    out.push({ id: c.id, why });
  };
  if (p.liegeId) consider(ch(p.liegeId), 'efendin');
  for (const c of Object.values(S.chars)) {
    if (c.deathDay != null) continue;
    if (c.isSibling === p.id) consider(c, 'kardeşin');
  }
  for (const c of livingChildren(p)) consider(c, 'evladın');
  if (p.spouseId) consider(ch(p.spouseId), 'eşin');
  for (const v of vassalsOf(p.id)) consider(v, 'vassalın');
  for (const c of Object.values(S.chars)) {
    if (c.deathDay != null || c.courtOf !== p.id) continue;
    consider(c, 'sarayında');
  }
  // neighbours: whoever holds land touching yours
  for (const mine of directCountiesOf(p.id)) {
    const prov = S.provinces[mine.provinceId];
    for (const nid of prov?.neighbors || []) {
      const nt = S.titles[`t_${nid}`];
      if (nt?.holderId) consider(ch(nt.holderId), 'komşun');
    }
  }
  // anyone who already hates you is worth knowing about
  for (const c of livingChars()) {
    if (opinion(c.id, p.id) < -35 && c.titles?.length) consider(c, 'sana düşman');
  }
  return out.slice(0, 12);
}

export function canLaunch(typeId, targetId) {
  const t = schemeType(typeId);
  const p = P(), tg = ch(targetId);
  if (!t) return { ok: false, why: 'böyle bir entrika yok' };
  if (!p || !tg || tg.deathDay != null) return { ok: false, why: 'hedef yok' };
  if (t.can && !t.can(tg)) return { ok: false, why: 'bu kişiye uymuyor' };
  if (p.gold < t.gold) return { ok: false, why: `${t.gold} altının yok` };
  if (list().some((sc) => live(sc) && sc.ownerId === p.id && sc.targetId === targetId)) {
    return { ok: false, why: 'bu kişiye karşı zaten bir işin var' };
  }
  if (mySchemes().length >= 3) return { ok: false, why: 'aynı anda en fazla üç iş çevirebilirsin' };
  return { ok: true, why: '' };
}

/**
 * Commit. Gold leaves the treasury on this line, before anyone knows anything,
 * and the roll that decides the whole year is drawn on the next.
 */
export function launchScheme(typeId, targetId, opts = {}) {
  const t = schemeType(typeId);
  const ownerId = opts.ownerId || S.playerId;
  const o = ch(ownerId), tg = ch(targetId);
  if (!t || !o || !tg) return null;
  if (!opts.ownerId) {
    const chk = canLaunch(typeId, targetId);
    if (!chk.ok) return null;
  }
  o.gold -= t.gold;

  let titleId = opts.titleId || null;
  if (t.needsTitle && !titleId) titleId = directCountiesOf(targetId)[0]?.id || null;

  const sc = {
    id: newId('sk'),
    typeId, ownerId, targetId, titleId,
    startDay: S.day,
    progress: 0,
    secrecy: 100,
    mode: 'normal',
    modeUntil: 0,
    goldSpent: t.gold,
    sealedRoll: rng.next(),          // ← the whole year, decided on this line
    oddsBonus: 0,
    partners: [],
    invites: [],
    refusals: [],
    signs: [],
    phasesFired: [],
    wobbled: [],
    discovery: 0,                     // 0 unseen · 1 suspected · 2 named
    byAI: !!opts.ownerId,
    state: 'active',
    lastMonth: -1,
    ambient: 0,
  };
  list().push(sc);

  if (!sc.byAI) {
    sign(sc, opts.openingLine || `${t.name} başladı. ${t.gold} altın gitti ve bir daha gelmeyecek.`, 'ambiguous');
    S.chronicle.push({ day: S.day, kind: 'scheme', text: `${t.name}: ${fullName(tg)}. Kimse bilmiyor.`, tone: 'ambiguous' });
  }
  emit('scheme:started', sc);
  return sc;
}

/** Walk away. Nothing comes back. */
export function abortScheme(id) {
  const sc = list().find((x) => x.id === id);
  if (!sc || !live(sc)) return;
  const t = schemeType(sc.typeId);
  sc.state = 'aborted';
  sc.endDay = S.day;
  for (const p of sc.partners) {
    const c = ch(p.id);
    if (c) remember(c.id, sc.ownerId, 'Bizi yarı yolda bıraktı.', -28, 40);
  }
  S.memories.push({
    id: newId('m'), day: S.day, kind: 'scheme', schemeId: sc.id,
    title: `${t.name}: vazgeçtin`, text: `${fullName(ch(sc.targetId))} için başlattığın işi yarıda bıraktın. ${sc.goldSpent} altın orada kaldı.`,
    weight: 0.3, targetId: sc.targetId, success: false, irreversible: true, recalls: 0,
  });
  S.chronicle.push({ day: S.day, kind: 'scheme', text: `${t.name} yarıda bırakıldı. ${sc.goldSpent} altın geri gelmedi.`, tone: 'bad' });
  emit('scheme:ended', sc);
}

/** normal · quiet (lie low) · rush. Each is a real trade, none is free. */
export function setMode(id, mode) {
  const sc = list().find((x) => x.id === id);
  if (!sc || !live(sc)) return;
  const o = ch(sc.ownerId);
  const price = mode === 'rush' ? 25 : mode === 'quiet' ? 12 : 0;
  if (price && o.gold < price) return;
  o.gold -= price;
  sc.goldSpent += price;
  sc.mode = mode;
  sc.modeUntil = mode === 'normal' ? 0 : S.day + (mode === 'rush' ? 60 : 90);
  if (mode === 'rush') sign(sc, 'Adamlara "acele" dedin. Acele eden adam iz bırakır.', 'bad');
  if (mode === 'quiet') sign(sc, 'Herkes evine gönderildi. Üç ay kimse kimseyi tanımıyor.', 'ambiguous');
  emit('scheme:changed', sc);
}

// ---------------------------------------------------------------------------
// co-conspirators — the tension engine
// ---------------------------------------------------------------------------

export function roleFilled(sc, roleId) { return sc.partners.some((p) => p.roleId === roleId); }
export function rolePending(sc, roleId) { return sc.invites.some((i) => i.state === 'pending' && i.roleId === roleId); }

/** Everyone you could ask, and what each of them would bring. */
export function candidates(sc) {
  const t = schemeType(sc.typeId);
  const o = ch(sc.ownerId);
  if (!t || !o) return [];
  const taken = new Set(sc.partners.map((p) => p.id));
  const asked = new Set([...sc.invites.map((i) => i.id), ...sc.refusals.map((r) => r.id)]);
  const pool = [];
  for (const c of livingChars()) {
    if (c.id === o.id || c.id === sc.targetId) continue;
    if (taken.has(c.id) || asked.has(c.id)) continue;
    if (age(c) < 16) continue;
    const near = c.courtOf === o.id || c.liegeId === o.id || c.dynastyId === o.dynastyId
      || Object.values(S.council || {}).includes(c.id);
    if (!near) continue;
    pool.push(c);
  }
  pool.sort((a, b) => opinion(b.id, o.id) - opinion(a.id, o.id));
  return pool.slice(0, 8).map((c) => ({ id: c.id }));
}

/** True willingness, 0..1. Never shown raw. */
export function willingness(sc, charId, roleId, bribe = 0) {
  const t = schemeType(sc.typeId);
  const c = ch(charId), o = ch(sc.ownerId), tg = ch(sc.targetId);
  if (!t || !c || !o || !tg) return 0;
  let w = 0.36;
  w += opinion(c.id, o.id) / 210;
  w -= opinion(c.id, tg.id) / 250;
  w -= t.danger * 0.32;
  w += traitAi(c, 'scheme') * 0.50;
  w += traitAi(c, 'risk') * 0.18;
  w -= traitAi(c, 'loyalty') * 0.22;
  w += traitAi(c, 'oathBreak') * 0.15;
  w += skill(o, 'diplomacy') * 0.010;
  if (isKin(c.id, tg.id)) w -= t.lethal ? 0.55 : 0.28;
  if (c.liegeId === tg.id) w -= 0.34;
  if (c.spouseId === tg.id) w -= 0.85;
  if (c.courtOf === o.id) w += 0.12;
  const role = t.roles.find((r) => r.id === roleId);
  if (role) w += (skill(c, role.skill) - 6) * 0.012;   // people like doing what they are good at
  w += bribe > 0 ? (bribe >= 50 ? 0.26 : 0.13) : 0;
  return clamp01(w);
}

/** What your spymaster's read of a man looks like — wrong often enough to hurt. */
export function readOf(sc, charId, roleId, bribe = 0) {
  const o = ch(sc.ownerId);
  const real = willingness(sc, charId, roleId, bribe);
  const fog = clamp(0.34 - skill(o, 'intrigue') * 0.022, 0.05, 0.34);
  const noise = (streamed(S.seed, `read${sc.id}${charId}`)() - 0.5) * 2 * fog;
  const seen = clamp01(real + noise);
  const word = seen > 0.72 ? 'hevesli' : seen > 0.54 ? 'eder gibi' : seen > 0.36 ? 'belli değil' : seen > 0.20 ? 'zor' : 'asla';
  return { seen, word, sure: fog < 0.14 };
}

export function invite(schemeId, charId, roleId, bribe = 0) {
  const sc = list().find((x) => x.id === schemeId);
  if (!sc || !live(sc)) return null;
  const t = schemeType(sc.typeId);
  const c = ch(charId), o = ch(sc.ownerId);
  if (!t || !c || !o) return null;
  if (roleFilled(sc, roleId) || rolePending(sc, roleId)) return null;
  if (bribe && o.gold < bribe) bribe = 0;
  if (bribe) { o.gold -= bribe; sc.goldSpent += bribe; }

  // Asking is itself an exposure. You just handed a man your throat.
  sc.secrecy = Math.max(0, sc.secrecy - (3 + t.danger * 5));
  sc.invites.push({ id: charId, roleId, bribe, day: S.day, answerDay: S.day + rng.int(6, 18), state: 'pending' });
  sign(sc, `${fullName(c)}'e soruldu. Artık bir kişi daha biliyor — cevabı ne olursa olsun.`, 'ambiguous');
  emit('scheme:changed', sc);
  return sc;
}

function answerInvite(sc, inv) {
  const t = schemeType(sc.typeId);
  const c = ch(inv.id), o = ch(sc.ownerId), tg = ch(sc.targetId);
  if (!c || c.deathDay != null || !o || !tg) { inv.state = 'no'; return; }
  const w = willingness(sc, inv.id, inv.roleId, inv.bribe);
  if (rng.chance(w)) {
    inv.state = 'yes';
    sc.partners.push({
      id: inv.id, roleId: inv.roleId, joinedDay: S.day, bribe: inv.bribe,
      nerve: Math.round(clamp(52 + traitAi(c, 'risk') * 40 + opinion(c.id, o.id) * 0.25, 18, 96)),
    });
    remember(c.id, o.id, 'Onunla aynı sırra ortak oldunuz.', +14, 30);
    if (!sc.byAI) sign(sc, rng.pick(INVITE_YES)(c, sc, tg), 'good');
    emit('scheme:partner', { sc, charId: inv.id, joined: true });
  } else {
    inv.state = 'no';
    sc.secrecy = Math.max(0, sc.secrecy - (5 + t.danger * 7));
    remember(c.id, o.id, 'Ona ağzına alınmayacak bir şey teklif etti.', -18, 35);
    // Will he talk? That is the whole price of asking.
    const spite = clamp01(0.08 + t.danger * 0.20
      + Math.max(0, opinion(c.id, tg.id)) / 300
      - opinion(c.id, o.id) / 320
      + (c.traits?.includes('honest') ? 0.16 : 0)
      + (c.traits?.includes('just') ? 0.10 : 0)
      - (c.traits?.includes('craven') ? 0.10 : 0));
    const betrays = rng.chance(spite);
    sc.refusals.push({ id: inv.id, day: S.day, betrayed: betrays });
    if (!sc.byAI) sign(sc, rng.pick(betrays ? INVITE_NO_ANGRY : INVITE_NO)(c, sc, tg), 'bad');
    emit('scheme:partner', { sc, charId: inv.id, joined: false });
    if (betrays && !sc.byAI) queueOffer(sc, () => snitchDecision(sc, c));
  }
}

// ---------------------------------------------------------------------------
// signs — what reaches you while you wait
// ---------------------------------------------------------------------------

function sign(sc, text, tone = 'ambiguous') {
  sc.signs.push({ day: S.day, text, tone });
  if (sc.signs.length > 14) sc.signs.shift();
  if (!sc.byAI) {
    emit('scheme:sign', { sc, text, tone });
    S.chronicle.push({ day: S.day, kind: 'scheme', text, tone });
  }
}

/** Is the sealed roll currently inside the door? Signs lean off this. */
function leaning(sc) { return sc.sealedRoll < oddsOf(sc); }

// ---------------------------------------------------------------------------
// the daily tick
// ---------------------------------------------------------------------------

export function tickSchemes(day) {
  const arr = list();
  for (let i = arr.length - 1; i >= 0; i--) {
    const sc = arr[i];
    if (!live(sc)) {
      if (sc.endDay != null && day - sc.endDay > 400) arr.splice(i, 1);
      continue;
    }
    stepScheme(sc, day);
  }
  maybeSpawnAI(day);
}

function stepScheme(sc, day) {
  const t = schemeType(sc.typeId);
  const o = ch(sc.ownerId), tg = ch(sc.targetId);

  // --- the plot dies with the people in it ---------------------------------
  if (!t || !o || o.deathDay != null) return collapse(sc, 'owner');
  if (!tg || tg.deathDay != null) return collapse(sc, 'target');
  if (!sc.byAI && sc.ownerId !== S.playerId) return collapse(sc, 'owner');

  // --- invitations come back -----------------------------------------------
  for (const inv of sc.invites) {
    if (inv.state === 'pending' && day >= inv.answerDay) answerInvite(sc, inv);
  }

  // --- modes expire --------------------------------------------------------
  if (sc.mode !== 'normal' && sc.modeUntil && day >= sc.modeUntil) {
    sc.mode = 'normal'; sc.modeUntil = 0;
    if (!sc.byAI) sign(sc, 'Herkes yerine döndü. İş kaldığı yerden yürüyor.', 'ambiguous');
  }

  // --- the two dials -------------------------------------------------------
  if (sc.state === 'active') sc.progress = Math.min(100, sc.progress + progressRate(sc));
  sc.secrecy = clamp(sc.secrecy - heatRate(sc) + (sc.mode === 'quiet' ? 0.26 : 0), 0, 100);

  // --- narrative phases ----------------------------------------------------
  for (let i = 0; i < (t.signs || []).length; i++) {
    const s = t.signs[i];
    if (sc.progress / 100 < s.at || sc.phasesFired.includes(i)) continue;
    sc.phasesFired.push(i);
    if (sc.byAI) continue;
    if (s.tone === 'lean') {
      const good = leaning(sc);
      sign(sc, (good ? s.good : s.bad)(sc, tg), good ? 'good' : 'bad');
    } else {
      sign(sc, s.text(sc, tg), s.tone || 'ambiguous');
    }
  }

  // --- monthly business ----------------------------------------------------
  const month = Math.floor(day / 30);
  if (month !== sc.lastMonth) {
    sc.lastMonth = month;
    monthly(sc, day);
  }

  // --- the target begins to smell it ---------------------------------------
  if (sc.discovery === 0 && sc.secrecy < 34) {
    sc.discovery = 1;
    if (!sc.byAI) sign(sc, rng.pick(EXPOSE_SIGN)(sc, tg), 'bad');
    emit('scheme:suspected', sc);
  }
  if (sc.secrecy <= 0 && sc.discovery < 2) {
    sc.discovery = 2;
    return sc.byAI ? aiExposed(sc) : exposeScheme(sc);
  }
  // A named plot keeps knocking until the player is free to hear it.
  if (sc.byAI && sc.discovery >= 2 && !sc.threatOffered) {
    queueOffer(sc, () => threatDecision(sc, ch(sc.ownerId), ch(sc.targetId)));
  }

  // --- ripe: the night arrives ---------------------------------------------
  if (sc.state === 'active' && sc.progress >= 100) {
    sc.state = 'ripe';
    sc.ripeDay = day;
    if (!sc.byAI) sign(sc, 'Hazır. Artık sadece senin sözün eksik.', 'ambiguous');
    emit('scheme:ripe', sc);
  }
  if (sc.state === 'ripe') {
    if (sc.byAI) { if (day >= sc.ripeDay + 3) resolveAI(sc); }
    else queueOffer(sc, () => strikeDecision(sc));
  }
}

function monthly(sc, day) {
  const t = schemeType(sc.typeId);
  const tg = ch(sc.targetId);

  // random leak: the world is full of loose mouths
  const leakP = 0.05 + sc.partners.length * 0.045 + (sc.mode === 'rush' ? 0.09 : 0);
  if (rng.chance(leakP)) {
    const bite = 2 + rng.int(0, 7) + sc.partners.length * 2;
    sc.secrecy = Math.max(0, sc.secrecy - bite);
    if (!sc.byAI) sign(sc, rng.pick(LEAK_LINE)(), 'bad');
  }

  // nerve: men are not tools, they are men
  for (const p of sc.partners) {
    const c = ch(p.id);
    if (!c || c.deathDay != null) { p.nerve = -1; continue; }
    let d = (100 - sc.secrecy) * 0.055 + t.danger * 1.4;
    d -= traitAi(c, 'risk') * 6;
    if (c.traits?.includes('craven')) d += 3.2;
    if (c.traits?.includes('brave')) d -= 2.4;
    if (c.traits?.includes('patient')) d -= 1.2;
    p.nerve = Math.round(clamp(p.nerve - d, -1, 100));
    if (p.nerve >= 0 && p.nerve < 24 && !sc.wobbled.includes(p.id)) {
      if (sc.byAI) { sc.wobbled.push(p.id); dropPartner(sc, p.id); }
      else if (queueOffer(sc, () => wobbleDecision(sc, c))) sc.wobbled.push(p.id);
    }
  }
  // remove the dead
  sc.partners = sc.partners.filter((p) => p.nerve >= 0);

  // AI plots hum in the background whether you hear them or not
  if (sc.byAI && sc.discovery === 0) aiDetectionRoll(sc);
  if (sc.byAI && sc.discovery === 1 && !sc.threatOffered) aiNameRoll(sc);
  if (sc.byAI) aiAmbient(sc, day);
}

function dropPartner(sc, charId) {
  sc.partners = sc.partners.filter((p) => p.id !== charId);
  sc.secrecy = Math.max(0, sc.secrecy - 7);
  emit('scheme:changed', sc);
}

function collapse(sc, why) {
  sc.state = 'aborted';
  sc.endDay = S.day;
  if (!sc.byAI) {
    const t = schemeType(sc.typeId);
    S.chronicle.push({
      day: S.day, kind: 'scheme', tone: 'bad',
      text: why === 'target'
        ? `${t?.name || 'Bir iş'} anlamını yitirdi: hedef öldü. ${sc.goldSpent} altın boşa gitti.`
        : `${t?.name || 'Bir iş'} sahipsiz kaldı.`,
    });
  }
  emit('scheme:ended', sc);
}

// ---------------------------------------------------------------------------
// decisions — the moments the plot puts a question in front of you
// ---------------------------------------------------------------------------

/** One open decision at a time, always. Anything else waits for tomorrow. */
function queueOffer(sc, fn) {
  if (S.decisions.some((d) => d.state === 'open')) return false;
  if (sc.offerLock === S.day) return false;
  sc.offerLock = S.day;
  fn();
  return true;
}

const sceneOf = (charId) => {
  const t = directCountiesOf(charId)[0];
  if (!t) return null;
  const i = (S.mapMeta?.provinces || []).findIndex((p) => p.id === t.provinceId);
  return i < 0 ? null : { provinceIdx: i };
};

// --- a refused man is walking toward your target ---------------------------
function snitchDecision(sc, c) {
  const t = schemeType(sc.typeId);
  const tg = ch(sc.targetId);
  const p = P();
  const kin = isKin(p.id, c.id);
  offer({
    kind: 'scheme',
    title: SNITCH.title(c),
    targetId: c.id,
    scene: sceneOf(sc.targetId),
    framing: SNITCH.framing(c, sc, tg),
    body: SNITCH.body(c, sc, tg, t),
    options: [
      {
        key: 'silence', label: 'Sustur.',
        detail: 'Bir ağız kapanır. Bir mezar açılır.',
        confirm: `${fullName(c)} bu geceden sonra konuşmasın mı?`,
        cost: [{ kind: STAKE.GOLD, value: 45 }],
        stakes: kin ? [{ kind: STAKE.KIN, who: fullName(c) }, { kind: STAKE.SOUL }]
                    : [{ kind: STAKE.LIFE, who: fullName(c) }, { kind: STAKE.SOUL }],
        waitDays: 20,
        odds: clamp(0.42 + skill(p, 'intrigue') * 0.035, 0.15, 0.9),
        tells: [{ at: 0.6, text: () => `${c.name} üç gündür sofrada yok.`, goodTone: 'ambiguous', badTone: 'bad' }],
        onResolve(d, ok) {
          if (ok) {
            kill(c, 'murder', p.id);
            if (kin) { if (!p.traits.includes('kinslayer')) p.traits.push('kinslayer'); S.stats.kin_lost++; }
            sc.secrecy = Math.min(100, sc.secrecy + 16);
            sign(sc, `${c.name} artık konuşmuyor. Kimse nedenini sormuyor.`, 'ambiguous');
            return {
              beat: 'sustu', knell: true, title: `${fullName(c)} Sustu`,
              text: `Onu değirmenin altında buldular. Su çoktan işini görmüştü.\n\nSırrın yerinde duruyor. Sırrın için ödediğin şey de yerinde duruyor — o hiç gitmeyecek.`,
              effects: ['+16 gizlilik', kin ? '<b>Kan Dökücü</b> — kalıcı' : `<b>${fullName(c)}</b> öldü`, '−45 altın'],
            };
          }
          sc.secrecy = Math.max(0, sc.secrecy - 30);
          remember(c.id, p.id, 'Beni öldürtmeye kalktı.', -90, 999);
          return {
            beat: 'kaçtı', title: 'Kaçtı ve Konuştu',
            text: `Adamların kapıya vardığında yatak boştu. Üç gün sonra ${tg.name}'in kalesinde görüldü.\n\nArtık iki şey biliyorlar: ne yaptığını ve ne yapmaya hazır olduğunu.`,
            effects: ['−30 gizlilik', `<b>${fullName(c)}</b> düşmanın`, '−45 altın'],
          };
        },
      },
      {
        key: 'buy', label: 'Ağzını parayla kapat.',
        detail: 'Bir kez susturur. İkinci kez daha pahalı olur.',
        cost: [{ kind: STAKE.GOLD, value: 70 }],
        stakes: [{ kind: STAKE.SECRET }],
        waitDays: 0,
        onResolve() {
          sc.secrecy = Math.min(100, sc.secrecy + 10);
          remember(c.id, p.id, 'Susmam için para verdi.', +10, 20);
          (c.hooks ||= []).push({ onId: p.id, kind: 'weak', label: 'Sustuğu için para aldı.', day: S.day });
          sign(sc, `${c.name} kesesini aldı ve gitti. Kese boşalınca ne olacağını ikiniz de biliyorsunuz.`, 'ambiguous');
          return {
            success: true, beat: 'aldı', title: 'Aldı',
            text: `Parayı saymadı bile. Saymaması iyi değil — saymayan adam, bunun ilk ödeme olduğunu düşünüyor demektir.`,
            effects: ['+10 gizlilik', '−70 altın', `<b>${fullName(c)}</b> artık senin üzerinde bir koz taşıyor`],
          };
        },
      },
      {
        key: 'let', label: 'Bırak gitsin.',
        detail: 'Belki konuşmaz. Belki de şu anda konuşuyor.',
        stakes: [{ kind: STAKE.SECRET }],
        waitDays: 45,
        odds: 0.40,
        tells: [{ at: 0.5, text: () => `${tg.name}'in kapısında bu hafta iki yeni yüz var.`, goodTone: 'ambiguous', badTone: 'bad' }],
        onResolve(d, ok) {
          if (ok) {
            sign(sc, `${c.name} bir daha ağzını açmadı. Şimdilik.`, 'good');
            return { beat: 'konuşmadı', title: 'Konuşmadı', text: `Aylar geçti. ${fullName(c)} kimseye bir şey söylemedi.\n\nAma her karşılaştığınızda başını hafifçe eğiyor. O eğiliş, bir kayıt tutuyor.`, effects: ['Sırrın duruyor', `<b>${fullName(c)}</b> hatırlıyor`] };
          }
          sc.secrecy = Math.max(0, sc.secrecy - 42);
          return { beat: 'konuştu', title: 'Konuştu', text: `Kime söylediğini bilmiyorsun. Kaç kişiye söylediğini de bilmiyorsun.\n\nSadece ${tg.name}'in bu hafta iki kez adını sorduğunu biliyorsun.`, effects: ['−42 gizlilik', 'Hedefin şüpheleniyor'] };
        },
      },
    ],
  });
}

// --- a partner has lost his nerve ------------------------------------------
function wobbleDecision(sc, c) {
  const t = schemeType(sc.typeId);
  const tg = ch(sc.targetId);
  const p = P();
  const kin = isKin(p.id, c.id);
  offer({
    kind: 'scheme',
    title: WOBBLE.title(c),
    targetId: c.id,
    scene: sceneOf(sc.targetId),
    framing: WOBBLE.framing(c, sc, tg),
    body: WOBBLE.body(c, sc, tg, t),
    options: [
      {
        key: 'silence', label: 'Bu kapıdan çıkmasın.',
        detail: 'Bildiği her şeyle birlikte.',
        confirm: kin ? 'Kendi kanından birini mi?' : `${fullName(c)} bu geceyi görmesin mi?`,
        stakes: kin ? [{ kind: STAKE.KIN, who: fullName(c) }, { kind: STAKE.SOUL }]
                    : [{ kind: STAKE.LIFE, who: fullName(c) }, { kind: STAKE.SOUL }],
        waitDays: 14,
        odds: clamp(0.55 + skill(p, 'intrigue') * 0.03, 0.2, 0.92),
        onResolve(d, ok) {
          dropPartner(sc, c.id);
          if (ok) {
            kill(c, 'murder', p.id);
            if (kin) { if (!p.traits.includes('kinslayer')) p.traits.push('kinslayer'); S.stats.kin_lost++; }
            sc.secrecy = Math.min(100, sc.secrecy + 12);
            sign(sc, `${c.name} bir daha gelmedi. Diğerleri bunu gördü ve daha sessiz çalışıyorlar.`, 'ambiguous');
            for (const q of sc.partners) q.nerve = Math.max(0, q.nerve - 14);
            return {
              beat: 'çıkmadı', knell: true, title: `${fullName(c)} O Kapıdan Çıkmadı`,
              text: `Sabah odayı temizlediler. Kar hâlâ yağıyordu ve bu iyi oldu.\n\nGeri kalan ortakların bugün seninle göz göze gelmedi. Yarın da gelmeyecekler. Ama kalacaklar.`,
              effects: ['+12 gizlilik', kin ? '<b>Kan Dökücü</b> — kalıcı' : `<b>${fullName(c)}</b> öldü`, 'Diğer ortakların −14 cesaret'],
            };
          }
          sc.secrecy = Math.max(0, sc.secrecy - 34);
          remember(c.id, p.id, 'Beni susturmaya kalktı.', -95, 999);
          return { beat: 'kaçtı', title: 'Yaralandı ve Kaçtı', text: `Bıçak omzuna girdi ve o koştu. Kanla birlikte bir yol bıraktı — o yolu takip etmek için deha gerekmiyor.`, effects: ['−34 gizlilik', `<b>${fullName(c)}</b> hayatta ve konuşacak`] };
        },
      },
      {
        key: 'pay', label: 'Payını iki katına çıkar.',
        detail: 'Korkuyu para bastırır. Bir süre.',
        cost: [{ kind: STAKE.GOLD, value: 55 }],
        stakes: [{ kind: STAKE.GOLD, value: 55 }],
        waitDays: 0,
        disabled: (P()?.gold || 0) < 55, disabledWhy: '55 altının yok',
        onResolve() {
          const pt = sc.partners.find((x) => x.id === c.id);
          if (pt) pt.nerve = Math.min(100, pt.nerve + 42);
          sign(sc, `${c.name} parayı aldı ve kaldı. Yüzü hâlâ kâğıt gibi.`, 'ambiguous');
          return {
            success: true, beat: 'kaldı', title: 'Kaldı',
            text: `Keseyi masaya koydun. Ona bakmadı, keseye baktı, sonra aldı.\n\nBu adam bir daha korktuğunda ne kadar isteyeceğini şimdi öğrendi.`,
            effects: ['−55 altın', `<b>${c.name}</b> +42 cesaret`, 'Bir dahaki sefere daha pahalı'],
          };
        },
      },
      {
        key: 'release', label: 'Bırak gitsin.',
        detail: 'Bilen bir adam, dışarıda, serbest.',
        stakes: [{ kind: STAKE.SECRET }],
        waitDays: 0,
        onResolve() {
          dropPartner(sc, c.id);
          sc.secrecy = Math.max(0, sc.secrecy - 15);
          remember(c.id, p.id, 'Gitmeme izin verdi.', +25, 25);
          sign(sc, `${c.name} gitti. Arkasına bakmadı — ama arkasında bir şey bıraktı.`, 'bad');
          return {
            success: true, beat: 'gitti', title: 'Gitti',
            text: `Teşekkür etti. Teşekkür etmesi en kötüsüydü.\n\nArtık dışarıda, senin adını bilen ve sana borcu olmayan bir adam var.`,
            effects: ['−15 gizlilik', 'Bir ortak eksildi', `<b>${fullName(c)}</b> her şeyi biliyor`],
          };
        },
      },
    ],
  });
}

// --- the night itself -------------------------------------------------------
function strikeDecision(sc) {
  const t = schemeType(sc.typeId);
  const tg = ch(sc.targetId);
  const o = ch(sc.ownerId);
  const odds = oddsOf(sc);
  const st = t.strike;
  sc.state = 'striking';

  const monthsSpent = Math.round((S.day - sc.startDay) / 30);
  const partnerLine = sc.partners.length
    ? `Yanında ${sc.partners.map((p) => fullName(ch(p.id))).join(', ')} var. Her biri bu geceyi hatırlayacak.`
    : `Yanında kimse yok. Bunu tek başına taşıyacaksın — ve tek başına taşıyabileceğin tek şey bu olacak.`;

  offer({
    kind: 'scheme',
    title: `${t.name}: ${fullName(tg)}`,
    targetId: sc.targetId,
    scene: sceneOf(sc.targetId),
    framing: `${monthsSpent} aydır bunun için çalışıyorsun. Bu gece hazır.`,
    body: `${partnerLine}\n\n` +
          `${sc.goldSpent} altın harcadın. Gizliliğin ${Math.round(sc.secrecy)}'de — ${secrecyWord(sc.secrecy)}.\n\n` +
          `Şunu bil: sonucu belirleyen sayı bu işe başladığın gün atıldı ve bir daha dokunulmadı. Bu gece yaptığın şey o sayıyı değiştirmiyor; sadece kapının ne kadar geniş olduğunu belirliyor.`,
    options: [
      {
        key: 'strike', label: st.verb,
        detail: st.detail,
        confirm: st.confirm(tg),
        stakes: st.stakes(sc, tg),
        waitDays: st.waitDays,
        odds,
        tells: st.tells,
        onCommit(d) {
          // The roll was sealed a year ago. Honour it.
          d.sealedRoll = sc.sealedRoll;
          d.trueOdds = odds;
          d.willSucceed = sc.sealedRoll < odds;
        },
        onResolve(d, ok) {
          sc.state = 'done'; sc.endDay = S.day; sc.success = ok;
          const out = ok ? t.onSuccess(sc, tg, o) : t.onFail(sc, tg, o);
          emit('scheme:resolved', sc);
          const spent = `${monthsSpent} ay, ${sc.goldSpent} altın${sc.partners.length ? `, ${sc.partners.length} ortak` : ''}.`;
          return { ...out, effects: [...(out.effects || []), `<i>${spent}</i>`] };
        },
      },
      {
        key: 'hold', label: 'Bir ay daha bekle.',
        detail: 'Daha iyi bir gece olabilir. Ya da bu, olabilecek en iyi geceydi.',
        waitDays: 0,
        onResolve() {
          sc.state = 'active';
          sc.progress = 92;
          sc.oddsBonus = (sc.oddsBonus || 0) + 0.05;
          sc.secrecy = Math.max(0, sc.secrecy - 11);
          sign(sc, 'Beklemeyi seçtin. Adamların bekliyor. Bekleyen adam konuşur.', 'ambiguous');
          return { success: true, beat: 'beklendi', title: 'Bekledin', text: 'Bu gece olmadı.', effects: ['+%5 ihtimal', '−11 gizlilik'] };
        },
      },
      {
        key: 'drop', label: 'Vazgeç.',
        detail: `${sc.goldSpent} altın ve ${monthsSpent} ay geri gelmeyecek.`,
        stakes: [{ kind: STAKE.GOLD, value: sc.goldSpent }],
        waitDays: 0,
        onResolve() {
          abortScheme(sc.id);
          return {
            success: true, beat: 'bıraktın', title: 'Vazgeçtin',
            text: `Adamlara haber saldın. Bazıları rahatladı. Bazıları rahatlamadı.\n\n${fullName(tg)} bu geceyi hiç bilmeyecek. Sen bileceksin.`,
            effects: [`${sc.goldSpent} altın gitti`, `${monthsSpent} ay gitti`, 'Ortakların hatırlıyor'],
          };
        },
      },
    ],
  });
}

// --- caught before you were ready -------------------------------------------
function exposeScheme(sc) {
  const t = schemeType(sc.typeId);
  const tg = ch(sc.targetId);
  const p = P();
  sc.state = 'exposed';
  sc.endDay = S.day;

  const doDamage = (mult, extra) => {
    remember(tg.id, p.id, `${t.name} kurduğunu öğrendi.`, Math.round(-70 * mult), 999);
    (tg.hooks ||= []).push({ onId: p.id, kind: mult > 0.8 ? 'strong' : 'weak', label: `${t.name} girişimini biliyor.`, day: S.day });
    p.prestige -= Math.round(70 * mult);
    for (const v of vassalsOf(p.id)) remember(v.id, p.id, 'Yakalandı.', Math.round(-16 * mult), 35);
    S.memories.push({
      id: newId('m'), day: S.day, kind: 'scheme', schemeId: sc.id,
      title: `${t.name} ifşa oldu`, text: `${fullName(tg)} senin ne yapmaya çalıştığını öğrendi. ${extra}`,
      weight: 0.8, targetId: sc.targetId, success: false, irreversible: true, recalls: 0,
    });
  };

  const ransom = Math.max(20, Math.min(Math.floor(p.gold), 100));
  S.chronicle.push({ day: S.day, kind: 'scheme', tone: 'bad', text: `${t.name} ifşa oldu: ${fullName(tg)} biliyor.` });
  emit('scheme:exposed', sc);

  offer({
    kind: 'scheme',
    title: 'Kapına Dayandılar',
    targetId: sc.targetId,
    scene: sceneOf(sc.targetId),
    framing: `${fullName(tg)}'in ulağı avluda bekliyor. Yanında dört atlı var ve hiçbiri inmedi.`,
    body: `Mektup kısa: adın, tarih, ve iki tanığın adı.\n\n` +
          `${sc.goldSpent} altın harcadın, ${Math.round((S.day - sc.startDay) / 30)} ay uğraştın ve sonunu göremedin. Kalan tek soru, bunun sana kaça mal olacağı.`,
    options: [
      {
        key: 'deny', label: 'İnkâr et.',
        detail: 'İki tanık var. İki tanık, üç olmadıkça bir şey değildir.',
        cost: [{ kind: STAKE.PRESTIGE, value: 30 }],
        stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.OATH }],
        waitDays: 50,
        odds: clamp(0.30 + skill(p, 'intrigue') * 0.030 + skill(p, 'diplomacy') * 0.018, 0.10, 0.85),
        tells: [{ at: 0.5, text: () => `Tanıklardan biri şehirden ayrılmış. Kendi isteğiyle mi, belli değil.`, goodTone: 'good', badTone: 'bad' }],
        onResolve(d, ok) {
          if (ok) {
            doDamage(0.35, 'İnkâr ettin ve tuttu.');
            return { beat: 'tuttu', title: 'İnkâr Tuttu', text: `Tanıklardan biri ifadesini geri aldı. Neden geri aldığını sormadın.\n\n${fullName(tg)} sana inanmadı. Ama artık kanıtlayamıyor, ve kanıtlanamayan şey — resmen — olmamıştır.`, effects: ['−30 itibar', `<b>${fullName(tg)}</b> −25 (kanıtı yok)`] };
          }
          doDamage(1.25, 'İnkâr ettin ve yalanın da yakalandı.');
          if (!p.traits.includes('oathbreaker')) p.traits.push('oathbreaker');
          return { beat: 'tutmadı', knell: true, title: 'İkinci Yalan', text: `Üçüncü tanık iki gün sonra çıktı. Senin kendi kâhyandı.\n\nArtık sadece ne yaptığını değil, yakalandıktan sonra ne yaptığını da biliyorlar. İkincisi daha ağır.`, effects: ['−30 itibar', '<b>Sözünden Dönen</b> damgası', `<b>${fullName(tg)}</b> −87 — kalıcı`] };
        },
      },
      {
        key: 'admit', label: 'Kabul et ve bedelini öde.',
        detail: 'Onurunu değil, kelleni kurtarırsın.',
        cost: [{ kind: STAKE.GOLD, value: ransom }],
        stakes: [{ kind: STAKE.REPUTATION }],
        waitDays: 0,
        onResolve() {
          doDamage(0.7, 'Kabul ettin ve fidye ödedin.');
          remember(tg.id, p.id, 'En azından yüzüme söyledi.', +14, 40);
          return {
            success: true, beat: 'ödedin', title: 'Ödedin',
            text: `Ulağın önünde kabul ettin. Adam şaşırdı; kabul eden az oluyor.\n\n${fullName(tg)} altını aldı. Aldı ama unutmadı — hiçbir zaman unutmayacak.`,
            effects: [`−${ransom} altın`, '−49 itibar', `<b>${fullName(tg)}</b> −49`],
          };
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// the other direction — plots aimed at you
// ---------------------------------------------------------------------------

export function myFamily() {
  const p = P();
  if (!p) return [];
  const out = [p];
  for (const k of livingChildren(p)) out.push(k);
  if (p.spouseId && alive(p.spouseId)) out.push(ch(p.spouseId));
  return out;
}

function maybeSpawnAI(day) {
  if (day < 100 || day % 30 !== 7) return;
  const p = P();
  if (!p) return;
  const mine = list().filter((sc) => live(sc) && sc.byAI && myFamily().some((f) => f.id === sc.targetId));
  if (mine.length >= 2) return;
  if (!rng.chance(0.30)) return;

  // Who has a reason? Ambition, a grudge, or a claim on what you hold.
  const pool = [];
  for (const c of livingChars()) {
    if (c.id === p.id || age(c) < 16) continue;
    if (c.imprisonedBy) continue;
    const op = opinion(c.id, p.id);
    const near = c.liegeId === p.id || c.courtOf === p.id || p.liegeId === c.id || c.dynastyId === p.dynastyId;
    const claims = Object.values(S.titles).some((t) => t.holderId === p.id && (t.claims || []).some((cl) => cl.charId === c.id));
    if (!near && !claims && op > -45) continue;
    let w = 0;
    if (op < 0) w += -op * 0.35;
    w += traitAi(c, 'scheme') * 45;
    if (claims) w += 40;
    if (c.isSibling === p.id) w += 30;
    if (near) w += 12;
    w += skill(c, 'intrigue') * 1.6;
    if (w > 6) pool.push({ c, w });
  }
  if (!pool.length) return;
  const pick = rng.weighted(pool);
  const plotter = pick.c;

  const fam = myFamily();
  const targets = [
    { t: p, w: 45 },
    ...fam.filter((f) => f.id !== p.id).map((f) => ({ t: f, w: age(f) < 16 ? 22 : 14 })),
  ];
  const target = rng.weighted(targets).t;

  const opts = [];
  const op = opinion(plotter.id, p.id);
  if (op < -25) opts.push({ id: 'murder', w: 34 });
  opts.push({ id: 'secret', w: 26 });
  opts.push({ id: 'defame', w: 18 });
  if (target.id === p.id && op < -15) opts.push({ id: 'abduct', w: 14 });
  if (Object.values(S.titles).some((t) => t.holderId === p.id)) opts.push({ id: 'fabricate', w: 20 });
  if (plotter.liegeId === p.id && op < -40) opts.push({ id: 'revolt', w: 24 });
  const typeId = rng.weighted(opts).id;
  const tp = schemeType(typeId);
  if (!tp || (tp.can && !tp.can(target))) return;
  if (plotter.gold < tp.gold * 0.5) return;

  const sc = launchScheme(typeId, target.id, { ownerId: plotter.id });
  if (!sc) return;
  // AI recruits straight away — that is why their plots move faster than yours.
  const helpers = livingChars().filter((c) =>
    c.id !== plotter.id && c.id !== target.id && age(c) >= 16 &&
    (c.courtOf === plotter.id || c.liegeId === plotter.id));
  for (const role of tp.roles) {
    if (!helpers.length || !rng.chance(0.45)) continue;
    const h = rng.pick(helpers);
    if (sc.partners.some((x) => x.id === h.id)) continue;
    sc.partners.push({ id: h.id, roleId: role.id, joinedDay: S.day, bribe: 0, nerve: 60 });
  }
}

/** Your spymaster earns his salary here, or does not. */
function aiDetectionRoll(sc) {
  const p = P();
  const spy = ch(S.council?.spymaster);
  const plotter = ch(sc.ownerId);
  if (!p || !plotter) return;
  const power = (spy && spy.deathDay == null ? skill(spy, 'intrigue') : 0) + skill(p, 'intrigue') * 0.45;
  let chance = 0.015 + power * 0.0075 - skill(plotter, 'intrigue') * 0.005 + (100 - sc.secrecy) * 0.0016;
  if (plotter.courtOf === p.id || plotter.liegeId === p.id) chance += 0.03;
  if (!rng.chance(clamp(chance, 0.004, 0.4))) return;
  sc.discovery = 1;
  emit('scheme:threat', { sc, level: 1 });
  emit('scheme:sign', {
    sc, tone: 'bad',
    text: spy ? `${fullName(spy)} bir şey duymuş ama adını söyleyemiyor. "Bir şeyler dönüyor efendim," diyor. Fazlası yok.`
              : 'Bir şeyler dönüyor. Kimin döndürdüğünü söyleyecek bir casusun yok.',
  });
  S.chronicle.push({ day: S.day, kind: 'scheme', tone: 'bad', text: 'Casusun bir şey duydu ama isim getiremedi.' });
}

/** Undetected plots still breathe on the back of your neck. */
function aiAmbient(sc, day) {
  if (sc.discovery >= 2) return;
  if (!rng.chance(0.16)) return;
  sc.ambient = (sc.ambient || 0) + 1;
  const lines = [
    'Kâhyan bugün seninle göz göze gelmedi.',
    'Gece nöbetçisi kalede tanımadığı bir at olduğunu söylüyor. Sabah at yoktu.',
    'Mutfakta iki kişi sen girince sustu.',
    'Ahırda bir eyer eksik. Kimse binmemiş.',
    'Sarayında bir hizmetkâr geceleri geç dönüyor. Nereden döndüğünü söylemiyor.',
  ];
  emit('scheme:sign', { sc: null, tone: 'ambiguous', text: rng.pick(lines) });
}

/** Their secrecy hit zero: you catch them mid-work, for free. */
function aiExposed(sc) {
  sc.discovery = 2;
  emit('scheme:threat', { sc, level: 2 });
  queueOffer(sc, () => threatDecision(sc, ch(sc.ownerId), ch(sc.targetId)));
}

/** The rumour acquires a face. */
function aiNameRoll(sc) {
  const p = P();
  const spy = ch(S.council?.spymaster);
  const plotter = ch(sc.ownerId);
  if (!p || !plotter) return;
  const power = (spy && spy.deathDay == null ? skill(spy, 'intrigue') : 0) + skill(p, 'intrigue') * 0.45;
  const chance = 0.03 + power * 0.011 - skill(plotter, 'intrigue') * 0.006;
  if (!rng.chance(clamp(chance, 0.008, 0.35))) return;
  sc.discovery = 2;
  emit('scheme:threat', { sc, level: 2 });
  queueOffer(sc, () => threatDecision(sc, plotter, ch(sc.targetId)));
}

function threatDecision(sc, plotter, target) {
  const t = schemeType(sc.typeId);
  const p = P();
  const spy = ch(S.council?.spymaster);
  const mine = target.id === p.id;
  sc.threatOffered = true;

  offer({
    kind: 'scheme',
    title: 'Casusun Bir İsim Getirdi',
    targetId: plotter.id,
    scene: sceneOf(plotter.id),
    framing: `${spy ? fullName(spy) : 'Adamlarından biri'} kapıyı arkasından kapattı ve ancak ondan sonra konuştu.`,
    body: `"${fullName(plotter)}," diyor. "${t.name}. ${mine ? 'Hedef sizsiniz.' : `Hedef ${fullName(target)}.`}"\n\n` +
          `Ne zamandır sürdüğünü söyleyemiyor. Ne kadar ilerlediğini de. Sadece adı getirdi — ve adı getirmek, bu işte en zor kısımdır.\n\n` +
          `${mine ? 'Bu adam senin ölümünü aylardır planlıyor ve sen bugüne kadar onunla aynı sofraya oturdun.' : `${target.name} bunu bilmiyor. Söylersen bilecek.`}`,
    options: [
      {
        key: 'confront', label: 'Yüzleş.',
        detail: 'Bildiğini bilsin. İşi bırakır — ve seni ömür boyu hatırlar.',
        cost: [{ kind: STAKE.PRESTIGE, value: 25 }],
        stakes: [{ kind: STAKE.REPUTATION }],
        waitDays: 0,
        onResolve() {
          sc.state = 'aborted'; sc.endDay = S.day;
          remember(plotter.id, p.id, 'Beni herkesin önünde yakaladı.', -55, 999);
          emit('scheme:ended', sc);
          return {
            success: true, beat: 'yüzleştin', title: `${fullName(plotter)} Sustu`,
            text: `Divanda ismini söylemedin. Sadece "biliyorum" dedin ve ona baktın. Salon anlamadı; o anladı.\n\nİşi bıraktı. Ama bırakan bir adam, unutan bir adam değildir.`,
            effects: ['−25 itibar', 'Komplo durdu', `<b>${fullName(plotter)}</b> −55 — kalıcı düşman`],
          };
        },
      },
      {
        key: 'counter', label: 'Sen de ona bir iş aç.',
        detail: 'Bilmediğini sanıyor. Bu, sahip olabileceğin en büyük avantaj.',
        cost: [{ kind: STAKE.GOLD, value: 60 }],
        stakes: [{ kind: STAKE.SECRET }, { kind: STAKE.LIFE, who: fullName(plotter) }],
        waitDays: 0,
        disabled: (P()?.gold || 0) < 60 + (schemeType('secret')?.gold || 0), disabledWhy: 'yeterli altının yok',
        onResolve() {
          const counter = launchScheme('secret', plotter.id, {
            openingLine: `${fullName(plotter)}'in defterini karıştırmaya başladın. O senin bildiğini bilmiyor.`,
          });
          if (counter) counter.oddsBonus = 0.14;
          return {
            success: true, beat: 'karşılık', title: 'Sessizce',
            text: `Ona hiçbir şey söylemedin. Ertesi gün sofrada yanına oturdun ve şarabını sen doldurdun.\n\nŞimdi iki komplo aynı anda yürüyor ve o bunlardan sadece birini biliyor.`,
            effects: ['−60 altın', `<b>${fullName(plotter)}</b> hakkında bir iş açıldı`, 'Komplosu hâlâ sürüyor'],
          };
        },
      },
      {
        key: 'watch', label: 'Sus. İzle.',
        detail: 'İlerlemesine izin ver. Nereye vardığını gör. Vardığı yer sen olabilirsin.',
        stakes: [{ kind: STAKE.SECRET }, mine ? { kind: STAKE.LIFE, who: 'kendi hayatın' } : { kind: STAKE.LIFE, who: fullName(target) }],
        waitDays: 0,
        onResolve() {
          sc.watched = true;
          return {
            success: true, beat: 'izliyorsun', title: 'Bekliyorsun',
            text: `Hiçbir şey yapmadın. Bu da bir karardı ve en pahalısı olabilir.\n\nBundan sonra ${plotter.name} her odaya girdiğinde nefesini tutacaksın. O ise hiçbir şey fark etmeyecek.`,
            effects: ['Komplo sürüyor', 'Her adımını göreceksin', mine ? 'Hedef sensin' : `Hedef <b>${fullName(target)}</b>`],
          };
        },
      },
    ],
  });
}

/** An AI plot reaches its night. */
function resolveAI(sc) {
  const t = schemeType(sc.typeId);
  const plotter = ch(sc.ownerId), target = ch(sc.targetId);
  const p = P();
  if (!t || !plotter || !target || !p) { collapse(sc, 'owner'); return; }
  const ok = sc.sealedRoll < oddsOf(sc);
  sc.state = 'done'; sc.endDay = S.day; sc.success = ok;
  emit('scheme:resolved', sc);

  if (!ok) {
    // Their year of work falls apart in your courtyard.
    remember(p.id, plotter.id, 'Beni öldürmeye kalktı.', -80, 999);
    (p.hooks ||= []).push({ onId: plotter.id, kind: 'strong', label: `${t.name} girişimini biliyorsun.`, day: S.day });
    S.chronicle.push({ day: S.day, kind: 'scheme', tone: 'good', text: `${fullName(plotter)}'in ${t.name.toLocaleLowerCase('tr')} girişimi bozuldu.` });
    if (S.decisions.some((d) => d.state === 'open')) return;
    offer({
      kind: 'scheme', title: 'Elimizde Bir Adam Var', targetId: plotter.id,
      scene: sceneOf(plotter.id),
      framing: `Gece yarısı avluda bir bağırış. Sabaha karşı önünde diz çökmüş bir adam vardı.`,
      body: `Bir şey itiraf etmedi ama cebinden çıkan mektupta bir mühür vardı: ${fullName(plotter)}.\n\n` +
            (sc.discovery >= 1 ? `Casusun aylar önce sana bunu söylemişti. Sen bekledin. İyi ki beklemişsin — ya da kötü ki; bu, ne yapacağına bağlı.`
                               : `Bunu bugüne kadar hiç bilmiyordun. Aylardır senin kalende yürüyordu.`),
      options: [
        { key: 'exec', label: 'Adamı as. Mührü sakla.',
          detail: 'Bir ceset bir mesajdır. Mühür bir kozdur.',
          stakes: [{ kind: STAKE.LIFE, who: 'yakalanan adam' }],
          waitDays: 0,
          onResolve() {
            p.dreadBonus = (p.dreadBonus || 0) + 4;
            (p.hooks ||= []).push({ onId: plotter.id, kind: 'strong', label: 'Mühürlü mektup elinde.', day: S.day });
            return { success: true, beat: 'asıldı', title: 'Sabah Kapıda Asılıydı', text: `Kimse ne olduğunu sormadı. Sormamaları, herkesin bildiği anlamına geliyor.\n\n${fullName(plotter)} bugün divana gelmedi.`, effects: ['+4 dehşet', `<b>${fullName(plotter)}</b> üzerinde koz`] };
          } },
        { key: 'free', label: 'Adamı geri gönder. Mektubu da.',
          detail: 'Korku bazen cesetten daha uzun yaşar.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 0,
          onResolve() {
            remember(plotter.id, p.id, 'Adamımı sağ geri gönderdi. Bu bir tehditti.', -20, 60);
            return { success: true, beat: 'geri döndü', title: 'Adamı Geri Gönderdin', text: `Atına bindirdiler, mektubu koynuna koydular, kapıyı açtılar.\n\n${fullName(plotter)} o mektubu okurken ne düşündü, bilmiyorsun. Ama bir daha aynı rahatlıkla uyumadı.`, effects: [`<b>${fullName(plotter)}</b> biliyor ki biliyorsun`] };
          } },
      ],
    });
    return;
  }

  // It worked.
  const dead = t.lethal || sc.typeId === 'murder';
  if (dead) {
    const wasPlayer = target.id === p.id;
    kill(target, 'murder', plotter.id);
    S.chronicle.push({ day: S.day, kind: 'scheme', tone: 'bad', text: `${fullName(target)} zehirlendi. Arkasında ${fullName(plotter)} vardı — bunu bilen var mı, belli değil.` });
    if (wasPlayer) {
      // Hand it to succession immediately; the death overlay does the rest.
      for (const tid of [...(target.titles || [])]) {
        const ti2 = S.titles[tid];
        if (ti2) { try { succeed(ti2); } catch (e) { console.error(e); } }
      }
      return;
    }
    if (S.decisions.some((d) => d.state === 'open')) return;
    offer({
      kind: 'scheme', title: `${fullName(target)} Öldü`, targetId: target.id,
      scene: sceneOf(p.id),
      framing: `Sabah uyanmadı. Hekim iki saat baktı, sonra sadece başını salladı.`,
      body: (sc.discovery >= 2 ? `Kimin yaptığını biliyorsun: ${fullName(plotter)}. Casusun sana aylar önce söylemişti ve sen bekledin.\n\nBeklemek de bir karardı.`
            : sc.discovery === 1 ? `Casusun aylar önce "bir şeyler dönüyor" demişti. İsim getirememişti. Şimdi isim kendiliğinden ortaya çıktı: ${fullName(plotter)}.`
            : `Kimse bir şey bilmiyor. Kâhyan yemekte bir şey olduğunu söylüyor ama kanıtı yok.\n\nSen de bilmiyorsun. Bilmemek, en ağır olanıdır.`) +
            `\n\n${age(target)} yaşındaydı.`,
      options: [
        { key: 'blood', label: 'Kan davası aç.',
          detail: sc.discovery >= 1 ? `${fullName(plotter)}'i biliyorsun. Herkes de bilsin.` : 'Kimin yaptığını bilmiyorsun ama birine ödetmen gerek.',
          cost: [{ kind: STAKE.PRESTIGE, value: 20 }],
          stakes: [{ kind: STAKE.OATH }, { kind: STAKE.REPUTATION }],
          waitDays: 0,
          onResolve() {
            remember(p.id, plotter.id, `${fullName(target)}'i öldürttü.`, -100, 999);
            (p.hooks ||= []).push({ onId: plotter.id, kind: 'strong', label: `${fullName(target)}'in kanı.`, day: S.day });
            return { success: true, beat: 'kan davası', title: 'Defteri Açtın', text: `Cenazede konuşmadın. Ertesi gün kâtibine bir isim yazdırdın ve o kâğıdı sakladın.\n\nO kâğıt bir gün birinin önüne konacak.`, effects: ['−20 itibar', `<b>${fullName(plotter)}</b> üzerinde kalıcı bir kin`, 'Bir gün geri gelecek'] };
          } },
        { key: 'quiet', label: 'Sessizce göm.',
          detail: 'Zayıf görünmemek bazen adalet aramaktan önemlidir.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 0,
          onResolve() {
            p.stress = (p.stress || 0) + 18;
            return { success: true, beat: 'gömüldü', title: 'Sessizce', text: `Üç gün sonra her şey eskisi gibiydi. Divan toplandı, vergi sayıldı, kar yağdı.\n\nSadece sen bir odaya girdiğinde hâlâ orada olup olmadığına bakıyorsun.`, effects: ['+18 gerginlik', 'Kimse hesap vermedi'] };
          } },
      ],
    });
    return;
  }

  // non-lethal payloads
  if (sc.typeId === 'defame') {
    p.prestige -= 80;
    for (const v of vassalsOf(p.id)) remember(v.id, p.id, 'Hakkındaki hikâyeyi herkes duydu.', -30, 30);
    S.chronicle.push({ day: S.day, kind: 'scheme', tone: 'bad', text: `Hakkında bir hikâye dolaşıyor ve kimse kaynağını söylemiyor.` });
  } else if (sc.typeId === 'secret') {
    (plotter.hooks ||= []).push({ onId: p.id, kind: 'strong', label: 'Senin hakkında bir şey biliyor.', day: S.day });
    S.chronicle.push({ day: S.day, kind: 'scheme', tone: 'bad', text: `${fullName(plotter)} bugün sana bakarken fazla uzun gülümsedi.` });
  } else if (sc.typeId === 'fabricate') {
    const mine = directCountiesOf(p.id);
    const tt = mine[mine.length - 1];
    if (tt) tt.claims.push({ charId: plotter.id, kind: 'fabricated', day: S.day });
    S.chronicle.push({ day: S.day, kind: 'scheme', tone: 'bad', text: `${fullName(plotter)} elinde bir belgeyle çıkageldi: ${tt ? tt.name : 'toprağın'} üzerinde hak iddia ediyor.` });
  } else if (sc.typeId === 'abduct') {
    p.imprisonedBy = plotter.id;
    S.chronicle.push({ day: S.day, kind: 'scheme', tone: 'bad', text: `Yolda kesildin. ${fullName(plotter)}'in zindanındasın.` });
  } else if (sc.typeId === 'revolt') {
    plotter.faction = 'claimant';
    for (const pt of sc.partners) { const m = ch(pt.id); if (m) m.faction = 'claimant'; }
    S.chronicle.push({ day: S.day, kind: 'scheme', tone: 'bad', text: `${fullName(plotter)} bayrak açtı. Yanında ${sc.partners.length} sancak var.` });
  }
  emit('scheme:threat', { sc, level: 3 });
}


// ---------------------------------------------------------------------------
// read-only views for the UI
// ---------------------------------------------------------------------------

export function mySchemes() {
  return list().filter((sc) => live(sc) && !sc.byAI && sc.ownerId === S.playerId);
}
export function myHistory() {
  return list().filter((sc) => !live(sc) && !sc.byAI && sc.ownerId === S.playerId).slice(-6);
}
/** Plots aimed at you or yours that you have any inkling of. */
export function threats() {
  const fam = new Set(myFamily().map((f) => f.id));
  return list().filter((sc) => live(sc) && sc.byAI && sc.discovery >= 1 && fam.has(sc.targetId));
}
/** Everything aimed at you, seen or not. Never shown; used by tests. */
export function hiddenThreats() {
  const fam = new Set(myFamily().map((f) => f.id));
  return list().filter((sc) => live(sc) && sc.byAI && fam.has(sc.targetId));
}
export function schemeById(id) { return list().find((x) => x.id === id) || null; }
