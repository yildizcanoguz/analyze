// The world's own heartbeat. Runs whether you are looking or not — which is the
// point: a strategy game where nothing happens unless you click is a menu.

import { S, rng, ch, ti, pv, alive, livingChars } from '../core/state.js';
import { emit } from '../core/bus.js';
import { YEAR, fromDay, seasonOf } from '../core/date.js';
import { age, mortalityChance, kill, bear, opinion, remember, fullName, livingChildren } from './characters.js';
import { incomeOf, realmLevy, vassalsOf, primaryTitle, grantTitle, recomputeVassalage, directCountiesOf, TIER } from './realm.js';
import { tickDecisions } from './decision.js';
import { tryFireEvents } from '../content/events.js';
import { succeed } from './succession.js';

let lastYear = null, lastMonth = null;

export function tickDay(day) {
  tickDecisions(day);
  const { y, m } = fromDay(day);
  if (m !== lastMonth) { lastMonth = m; monthly(day); }
  if (y !== lastYear) { lastYear = y; yearly(day, y); }
  if (day % 11 === 0) tryFireEvents(day);
}

function monthly(day) {
  const p = ch(S.playerId);
  if (p) {
    p.gold += incomeOf(p.id);
    p.prestige += 1 + (primaryTitle(p)?.tier || 0) * 1.5;
    p.piety += 0.8;
    p.stress = Math.max(0, p.stress - 1.2);
  }
  // AI rulers accumulate too, roughly
  for (const c of livingChars()) {
    if (c.id === S.playerId || !c.titles?.length) continue;
    c.gold += incomeOf(c.id) * 0.9;
    c.prestige += 1;
  }
  // unrest cools, occupied provinces don't
  for (const prov of Object.values(S.provinces)) {
    prov.unrest = Math.max(0, prov.unrest - (prov.occupiedBy ? 0 : 1.5));
  }
  emit('sim:month', day);
}

function yearly(day, year) {
  // --- death ---------------------------------------------------------------
  for (const c of livingChars()) {
    if (rng.chance(mortalityChance(c))) {
      const a = age(c);
      kill(c, a > 55 ? 'natural' : rng.chance(0.6) ? 'illness' : 'natural');
    }
  }
  // --- births --------------------------------------------------------------
  for (const c of livingChars()) {
    if (c.sex !== 'f' || !c.spouseId || !alive(c.spouseId)) continue;
    const a = age(c);
    if (a < 16 || a > 45) continue;
    const f = 0.22 * c.fertility * (1 - Math.max(0, a - 32) / 22);
    if (rng.chance(Math.max(0, f))) {
      if (rng.chance(0.035)) { kill(c, 'childbirth'); continue; }
      bear(c.id, c.spouseId);
    }
  }
  // --- succession for anyone who died holding land -------------------------
  for (const t of Object.values(S.titles)) {
    if (t.holderId && !alive(t.holderId)) succeed(t);
  }
  recomputeVassalage();

  // --- opinion drift: memories fade, cultures grate -------------------------
  for (const c of livingChars()) {
    if (!c.liegeId) continue;
    const l = ch(c.liegeId);
    if (!l) continue;
    const o = opinion(c.id, c.liegeId);
    if (o < -40 && rng.chance(0.12)) {
      c.faction = 'discontent';
      emit('sim:unrest', { charId: c.id, liegeId: c.liegeId });
    }
  }
  // --- development creeps ---------------------------------------------------
  for (const prov of Object.values(S.provinces)) {
    if (prov.unrest < 20 && rng.chance(0.10)) prov.development = Math.min(24, prov.development + 1);
    if (prov.unrest > 50 && rng.chance(0.14)) prov.development = Math.max(1, prov.development - 1);
  }
  emit('sim:year', year);
}
