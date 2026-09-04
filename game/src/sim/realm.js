// Titles, vassals, the de jure skeleton. Land is the only thing in this game that
// is genuinely permanent, which is why losing it hurts.

import { S, newId, ch, ti, pv, rng, alive } from '../core/state.js';
import { emit } from '../core/bus.js';
import { fullName } from './characters.js';

export const TIER = { barony: 0, county: 1, duchy: 2, kingdom: 3, empire: 4 };
export const TIER_NAME = ['Baronluk', 'Kontluk', 'Düklük', 'Krallık', 'İmparatorluk'];
export const TIER_ADJ = ['Baron', 'Kont', 'Dük', 'Kral', 'İmparator'];

export function makeTitle(o) {
  const id = o.id || newId('t');
  const t = {
    id, name: o.name, tier: o.tier,
    holderId: o.holderId || null,
    dejureLiege: o.dejureLiege || null,
    dejureVassals: o.dejureVassals || [],
    provinceId: o.provinceId || null,
    claims: [],
    createdDay: S.day,
    history: [],
  };
  S.titles[id] = t;
  return t;
}

export function titleName(t) {
  if (!t) return '—';
  return `${TIER_NAME[t.tier]} ${t.name}`;
}
export function primaryTitle(c) {
  if (!c?.titles?.length) return null;
  return c.titles.map(ti).filter(Boolean).sort((a, b) => b.tier - a.tier)[0];
}
export function styleOf(c) {
  const t = primaryTitle(c);
  if (!t) return c?.sex === 'f' ? 'Leydi' : 'Lord';
  let adj = TIER_ADJ[t.tier];
  if (c.sex === 'f') adj = ({ Baron:'Barones', Kont:'Kontes', Dük:'Düşes', Kral:'Kraliçe', İmparator:'İmparatoriçe' })[adj] || adj;
  return `${adj} ${t.name}`;
}

export function grantTitle(titleId, charId, reason = 'grant') {
  const t = ti(titleId);
  if (!t) return;
  const prev = t.holderId;
  if (prev && ch(prev)) ch(prev).titles = ch(prev).titles.filter((x) => x !== titleId);
  t.holderId = charId;
  t.history.push({ day: S.day, holderId: charId, reason, from: prev });
  const c = ch(charId);
  if (c && !c.titles.includes(titleId)) c.titles.push(titleId);
  recomputeVassalage();
  emit('title:granted', { titleId, charId, prev, reason });
}

/** Rebuild liege links from title hierarchy: whoever holds your de jure liege is your liege. */
export function recomputeVassalage() {
  for (const c of Object.values(S.chars)) c.liegeId = null;
  for (const t of Object.values(S.titles)) {
    if (!t.holderId) continue;
    let p = t.dejureLiege ? ti(t.dejureLiege) : null;
    while (p) {
      if (p.holderId && p.holderId !== t.holderId) {
        const h = ch(t.holderId);
        // your liege is the holder of your highest title's nearest held superior
        const own = primaryTitle(h);
        if (own && own.id === t.id) h.liegeId = p.holderId;
        break;
      }
      p = p.dejureLiege ? ti(p.dejureLiege) : null;
    }
  }
}
export function vassalsOf(charId) {
  return Object.values(S.chars).filter((c) => c.deathDay == null && c.liegeId === charId);
}
export function realmOf(charId, out = new Set()) {
  out.add(charId);
  for (const v of vassalsOf(charId)) if (!out.has(v.id)) realmOf(v.id, out);
  return out;
}
export function countiesOf(charId) {
  const realm = realmOf(charId);
  return Object.values(S.titles).filter((t) => t.tier === TIER.county && t.holderId && realm.has(t.holderId));
}
export function directCountiesOf(charId) {
  return Object.values(S.titles).filter((t) => t.tier === TIER.county && t.holderId === charId);
}
export function topLiege(charId) {
  let c = ch(charId), guard = 0;
  while (c?.liegeId && guard++ < 30) c = ch(c.liegeId);
  return c?.id || charId;
}
export function isIndependent(charId) { return !ch(charId)?.liegeId; }

// --- economy / levy ---------------------------------------------------------
export function incomeOf(charId) {
  const c = ch(charId);
  if (!c) return 0;
  let inc = 0;
  for (const t of directCountiesOf(charId)) {
    const p = pv(t.provinceId);
    if (!p) continue;
    inc += p.development * 0.09 * (p.taxMult || 1) * (1 + (p.buildings?.length || 0) * 0.10);
  }
  // vassal tax scales with how much they like you
  for (const v of vassalsOf(charId)) {
    const vi = incomeOf(v.id);
    const op = (v.opinions?.[charId] || 0);
    inc += vi * Math.max(0.05, 0.25 + op / 400);
  }
  return Math.round(inc * 10) / 10;
}
export function levyOf(charId) {
  const c = ch(charId);
  if (!c) return 0;
  let lv = 0;
  for (const t of directCountiesOf(charId)) {
    const p = pv(t.provinceId);
    if (!p) continue;
    lv += 90 + p.development * 22 + (p.holdings || 1) * 45;
  }
  return Math.round(lv);
}
export function realmLevy(charId) {
  let lv = levyOf(charId);
  for (const v of vassalsOf(charId)) {
    const op = v.opinions?.[charId] || 0;
    lv += realmLevy(v.id) * Math.max(0, 0.35 + op / 260);
  }
  return Math.round(lv);
}
export function realmSize(charId) { return countiesOf(charId).length; }
