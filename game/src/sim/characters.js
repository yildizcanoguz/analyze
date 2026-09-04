// People. Not stat blocks — the game must be able to say a sentence about anyone
// on the map, because you only feel a loss you can name.

import { S, rng, newId, ch, alive } from '../core/state.js';
import { emit } from '../core/bus.js';
import { ageAt, YEAR, fmtDate } from '../core/date.js';
import { TRAITS, PERSONALITY, CONGENITAL, traitMod, traitAi } from '../content/traits.js';
import { NAMES } from '../content/names.js';

export const SKILLS = ['diplomacy', 'martial', 'stewardship', 'intrigue', 'learning'];
export const SKILL_LABEL = { diplomacy:'Diplomasi', martial:'Askerlik', stewardship:'İdare', intrigue:'Entrika', learning:'İlim' };

export function makeCharacter(opts = {}) {
  const culture = opts.culture || 'turkish';
  const sex = opts.sex || (rng.chance(0.5) ? 'm' : 'f');
  const pool = NAMES[culture] || NAMES.turkish;
  const id = newId('c');
  const c = {
    id,
    name: opts.name || rng.pick(pool[sex]),
    sex,
    culture,
    faith: opts.faith || (culture === 'turkish' || culture === 'kurdish' ? 'sunni' : culture === 'armenian' ? 'miaphysite' : 'orthodox'),
    dynastyId: opts.dynastyId || null,
    birthDay: opts.birthDay ?? -rng.int(18, 55) * YEAR,
    deathDay: null,
    deathCause: null,
    traits: [],
    base: {},
    prowess: 0,
    health: 5 + rng.normal(0, 1),
    stress: 0,
    fertility: 0.5 + rng.float(-0.15, 0.25),
    gold: 0, prestige: 0, piety: 0,
    fatherId: opts.fatherId || null,
    motherId: opts.motherId || null,
    spouseId: null,
    childrenIds: [],
    liegeId: null,
    titles: [],
    opinions: {},           // targetId -> base opinion delta from events
    secrets: [],
    hooks: [],              // {onId, kind:'strong'|'weak', secretId}
    knownSecrets: [],
    memoriesOf: {},         // charId -> [{day, text, delta}]
    faceSeed: (rng.next() * 1e9) | 0,
    ai: {},
  };
  for (const s of SKILLS) c.base[s] = Math.max(0, Math.round(rng.normal(opts.skillMean ?? 6, 3.2)));
  c.prowess = Math.max(0, Math.round(rng.normal(sex === 'm' ? 8 : 5, 3)));

  // personality: 3 traits, never a pair of opposites
  const picked = [];
  const bag = rng.shuffle(PERSONALITY);
  for (const t of bag) {
    if (picked.length >= 3) break;
    if (picked.some((p) => TRAITS[p].opp === t)) continue;
    picked.push(t);
  }
  c.traits.push(...picked);
  // congenital: rare
  if (rng.chance(0.10)) c.traits.push(rng.weighted(
    [{ t:'genius', w:1 }, { t:'intelligent', w:5 }, { t:'slow', w:4 }, { t:'strong', w:5 }, { t:'frail', w:4 }, { t:'beautiful', w:5 }]
  ).t);
  if (opts.traits) for (const t of opts.traits) if (!c.traits.includes(t)) c.traits.push(t);

  S.chars[id] = c;
  return c;
}

export const age = (c) => ageAt(c.birthDay, S.day);
export const isAdult = (c) => age(c) >= 16;
export function fullName(c) {
  if (!c) return '—';
  const d = S.dynasties[c.dynastyId];
  return d ? `${c.name} ${d.name}` : c.name;
}
export function skill(c, k) { return Math.max(0, (c.base[k] || 0) + traitMod(c, k) + (c.bonus?.[k] || 0)); }
export function skills(c) { const o = {}; for (const k of SKILLS) o[k] = skill(c, k); return o; }
export function healthOf(c) { return Math.max(0, c.health + traitMod(c, 'health')); }
export function dread(c) { return Math.max(0, traitMod(c, 'dread') + (c.dreadBonus || 0)); }
export function prowessOf(c) { return Math.max(0, c.prowess + traitMod(c, 'prowess')); }

/** Yearly mortality. Deliberately not gentle: the clock is an antagonist. */
export function mortalityChance(c) {
  const a = age(c);
  const h = healthOf(c);
  let base;
  if (a < 1) base = 0.14;
  else if (a < 5) base = 0.035;
  else if (a < 16) base = 0.010;
  else if (a < 40) base = 0.012;
  else if (a < 50) base = 0.028;
  else if (a < 60) base = 0.055;
  else if (a < 70) base = 0.105;
  else base = 0.19 + (a - 70) * 0.028;
  const hf = Math.pow(0.86, h - 5);
  const stressF = 1 + Math.max(0, c.stress - 60) / 140;
  return Math.min(0.92, base * hf * stressF);
}

export function kill(c, cause = 'natural', killerId = null) {
  if (!c || c.deathDay != null) return;
  c.deathDay = S.day;
  c.deathCause = cause;
  c.killerId = killerId;
  emit('char:died', { id: c.id, cause, killerId });
  S.chronicle.push({ day: S.day, kind: 'death', text: `${fullName(c)} öldü — ${causeLabel(cause)}.`, tone: 'bad', charId: c.id });
}
export function causeLabel(cause) {
  return ({ natural:'eceliyle', illness:'hastalıktan', battle:'savaş meydanında', murder:'suikast', execution:'idam', childbirth:'doğumda', duel:'düelloda', wounds:'yaralarından', starvation:'açlıktan' })[cause] || cause;
}

// --- relationships ----------------------------------------------------------
export function relation(aId, bId) {
  const a = ch(aId), b = ch(bId);
  if (!a || !b) return 'yabancı';
  if (a.fatherId === bId || a.motherId === bId) return 'ebeveyn';
  if (b.fatherId === aId || b.motherId === aId) return 'evlat';
  if (a.spouseId === bId) return 'eş';
  if (a.fatherId && (a.fatherId === b.fatherId || a.motherId === b.motherId)) return 'kardeş';
  if (a.dynastyId && a.dynastyId === b.dynastyId) return 'hanedan';
  if (a.liegeId === bId) return 'efendi';
  if (b.liegeId === aId) return 'vassal';
  return 'yabancı';
}
export function isKin(aId, bId) {
  const r = relation(aId, bId);
  return r === 'ebeveyn' || r === 'evlat' || r === 'kardeş' || r === 'hanedan';
}
export function childrenOf(c) { return (c.childrenIds || []).map(ch).filter(Boolean); }
export function livingChildren(c) { return childrenOf(c).filter((k) => k.deathDay == null); }

export function bear(motherId, fatherId) {
  const m = ch(motherId), f = ch(fatherId);
  if (!m) return null;
  const culture = f?.culture || m.culture;
  const kid = makeCharacter({
    culture, faith: f?.faith || m.faith,
    dynastyId: f?.dynastyId || m.dynastyId,
    birthDay: S.day, fatherId: fatherId || null, motherId,
    skillMean: 4,
  });
  // inheritance: congenital traits pass with real probability
  for (const p of [f, m]) {
    if (!p) continue;
    for (const t of p.traits) {
      if (CONGENITAL.includes(t) && rng.chance(0.30) && !kid.traits.includes(t)) kid.traits.push(t);
    }
  }
  kid.base.diplomacy = Math.round(((f?.base.diplomacy ?? 5) + m.base.diplomacy) / 2 + rng.normal(0, 2));
  kid.base.martial = Math.round(((f?.base.martial ?? 5) + m.base.martial) / 2 + rng.normal(0, 2));
  m.childrenIds.push(kid.id);
  if (f) f.childrenIds.push(kid.id);
  emit('char:born', { id: kid.id, motherId, fatherId });
  return kid;
}

// --- opinion ---------------------------------------------------------------
export function opinion(fromId, toId) {
  const a = ch(fromId), b = ch(toId);
  if (!a || !b) return 0;
  if (fromId === toId) return 100;
  let o = a.opinions?.[toId] || 0;
  // trait chemistry
  for (const at of a.traits) {
    const map = TRAITS[at]?.opinionFrom;
    if (!map) continue;
    for (const bt of b.traits) o += map[bt] || 0;
  }
  for (const bt of b.traits) {
    const g = TRAITS[bt]?.opinionFrom?.['*'];
    if (g) o += g;
  }
  const r = relation(fromId, toId);
  if (r === 'kardeş') o += 10;
  if (r === 'evlat' || r === 'ebeveyn') o += 25;
  if (r === 'eş') o += 20;
  if (r === 'hanedan') o += 12;
  if (a.culture !== b.culture) o -= 15;
  if (a.faith !== b.faith) o -= 25;
  // remembered deeds decay slowly
  for (const m of a.memoriesOf?.[toId] || []) {
    const yrs = (S.day - m.day) / YEAR;
    o += m.delta * Math.max(0, 1 - yrs / (m.life || 25));
  }
  return Math.round(Math.max(-100, Math.min(100, o)));
}
export function remember(fromId, toId, text, delta, life = 25) {
  const a = ch(fromId);
  if (!a) return;
  (a.memoriesOf[toId] ||= []).push({ day: S.day, text, delta, life });
}
export function opinionLabel(o) {
  if (o >= 70) return 'sadık';
  if (o >= 35) return 'hoşnut';
  if (o >= 10) return 'ılımlı';
  if (o > -10) return 'kayıtsız';
  if (o > -35) return 'soğuk';
  if (o > -70) return 'küskün';
  return 'düşman';
}
export { traitMod, traitAi };
