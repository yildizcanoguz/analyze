// ===========================================================================
// P09 — THE OPINION ECONOMY
// ---------------------------------------------------------------------------
// A number that says "-42" and nothing else does not create tension; it creates
// irritation. A penalty you cannot read is a penalty you cannot answer, and a
// player who cannot answer stops caring.
//
// So every modifier that sim/characters.js#opinion() folds into its single
// integer is itemised here as a line with a name, a value, and — where it
// matters — how many years are left before the world forgets.
//
// This module never changes opinion(); it mirrors it. verifyOpinion() exists so
// that a drift between the two is caught loudly instead of quietly lying to the
// player.
// ===========================================================================

import { S, ch } from '../core/state.js';
import { YEAR } from '../core/date.js';
import { TRAITS } from '../content/traits.js';
import { relation, traitAi } from './characters.js';
import { CULTURE_LABEL, FAITH_LABEL } from '../content/names.js';

// Line kinds, so the UI can group and colour without parsing Turkish.
export const LINE = {
  BASE: 'base',           // permanent, written by deeds (charters, betrayals)
  TRAIT: 'trait',         // personality chemistry
  BRAND: 'brand',         // a mark everyone reacts to: kinslayer, oathbreaker
  BLOOD: 'blood',         // kinship
  CULTURE: 'culture',
  FAITH: 'faith',
  MEMORY: 'memory',       // remembered deeds, decaying
  CLAMP: 'clamp',         // the ±100 ceiling actually bit
};

const RELATION_LINE = {
  'kardeş':  { v: 10, label: 'Kan bağı — kardeş' },
  'evlat':   { v: 25, label: 'Kan bağı — evlat' },
  'ebeveyn': { v: 25, label: 'Kan bağı — ebeveyn' },
  'eş':      { v: 20, label: 'Nikâh bağı' },
  'hanedan': { v: 12, label: 'Aynı hanedan' },
};

/**
 * Every modifier in `from`'s opinion of `to`, one line each.
 *
 * @returns {Array<{label:string, value:number, kind:string, decaying?:boolean,
 *                  yearsLeft?:number, full?:number, day?:number}>}
 *          Ordered: heaviest absolute value first, so the reason a man hates you
 *          is the first thing you read.
 */
export function opinionBreakdown(fromId, toId, opts = {}) {
  const a = ch(fromId), b = ch(toId);
  let lines = [];
  if (!a || !b) return lines;
  if (fromId === toId) return [{ label: 'Kendine bakış', value: 100, kind: LINE.BASE }];

  const you = opts.you === undefined ? S.playerId : opts.you;
  const second = toId === you;   // "sen" phrasing when the target is the player

  // 1. the permanent ledger — set by charters, betrayals, sworn concessions
  const base = a.opinions?.[toId] || 0;
  if (base) lines.push({ label: base > 0 ? 'Verdiğin söz tutuldu' : 'Aranızdaki eski hesap', value: base, kind: LINE.BASE });

  // 2. personality chemistry — his traits meeting yours
  for (const at of a.traits || []) {
    const map = TRAITS[at]?.opinionFrom;
    if (!map) continue;
    for (const bt of b.traits || []) {
      const v = map[bt] || 0;
      if (!v) continue;
      lines.push({
        label: second ? `O ${tn(at)} — sen ${tn(bt)}` : `${tn(at)} ↔ ${tn(bt)}`,
        value: v, kind: LINE.TRAIT,
      });
    }
  }
  // 3. brands the whole world reacts to
  for (const bt of b.traits || []) {
    const g = TRAITS[bt]?.opinionFrom?.['*'];
    if (!g) continue;
    lines.push({ label: `Damga: ${tn(bt)}`, value: g, kind: LINE.BRAND });
  }

  // 4. blood
  const r = relation(fromId, toId);
  const rl = RELATION_LINE[r];
  if (rl) lines.push({ label: rl.label, value: rl.v, kind: LINE.BLOOD });

  // 5. the two things nobody chooses
  if (a.culture !== b.culture) {
    lines.push({
      label: second ? `Farklı kültür — o ${cul(a.culture)}, sen ${cul(b.culture)}` : `Farklı kültür (${cul(a.culture)} / ${cul(b.culture)})`,
      value: -15, kind: LINE.CULTURE,
    });
  }
  if (a.faith !== b.faith) {
    lines.push({
      label: second ? `Farklı inanç — o ${fth(a.faith)}, sen ${fth(b.faith)}` : `Farklı inanç (${fth(a.faith)} / ${fth(b.faith)})`,
      value: -25, kind: LINE.FAITH,
    });
  }

  // 6. remembered deeds — these fade, and the player should be able to see the
  //    fading. Knowing a grudge has eleven years left is a different feeling
  //    from knowing only that a man is angry.
  for (const m of a.memoriesOf?.[toId] || []) {
    const life = m.life || 25;
    const yrs = (S.day - m.day) / YEAR;
    const k = Math.max(0, 1 - yrs / life);
    const v = m.delta * k;
    if (Math.abs(v) < 0.5) continue;
    lines.push({
      label: m.text, value: v, kind: LINE.MEMORY, decaying: life < 900,
      yearsLeft: Math.max(0, life - yrs), life, full: m.delta, day: m.day,
    });
  }

  // The same deed remembered four times is one grudge, not four lines.
  const merged = [];
  const byLabel = new Map();
  for (const l of lines) {
    if (l.kind !== LINE.MEMORY) { merged.push(l); continue; }
    const hit = byLabel.get(l.label);
    if (!hit) { byLabel.set(l.label, l); l.count = 1; merged.push(l); continue; }
    hit.value += l.value;
    hit.full = (hit.full || 0) + (l.full || 0);
    hit.yearsLeft = Math.max(hit.yearsLeft || 0, l.yearsLeft || 0);
    hit.life = Math.max(hit.life || 25, l.life || 25);
    hit.count = (hit.count || 1) + 1;
  }
  lines = merged;
  lines.sort((x, y) => Math.abs(y.value) - Math.abs(x.value));

  // 7. the ceiling — if it bit, say so instead of silently swallowing 40 points
  const raw = lines.reduce((s, l) => s + l.value, 0);
  if (raw > 100) lines.push({ label: 'Bundan fazlasını sevemez', value: 100 - raw, kind: LINE.CLAMP });
  if (raw < -100) lines.push({ label: 'Bundan fazla nefret edemez', value: -100 - raw, kind: LINE.CLAMP });
  return lines;
}

/** The same integer sim/characters.js#opinion() returns, built from the lines. */
export function opinionOf(fromId, toId) {
  if (fromId === toId) return 100;
  const lines = opinionBreakdown(fromId, toId);
  return Math.round(Math.max(-100, Math.min(100, lines.reduce((s, l) => s + l.value, 0))));
}

/** Development guard: the breakdown must never disagree with the real number. */
export function verifyOpinion(fromId, toId, realOpinionFn) {
  const mine = opinionOf(fromId, toId);
  const theirs = realOpinionFn(fromId, toId);
  return { ok: mine === theirs, mine, theirs, fromId, toId };
}

/** The single line that explains a man best — used for whispers and tooltips. */
export function topGrievance(fromId, toId) {
  const lines = opinionBreakdown(fromId, toId).filter((l) => l.value < 0 && l.kind !== LINE.CLAMP);
  return lines[0] || null;
}
export function topFavour(fromId, toId) {
  const lines = opinionBreakdown(fromId, toId).filter((l) => l.value > 0 && l.kind !== LINE.CLAMP);
  return lines[0] || null;
}

/** What is left of the grudges once time has done its work. */
export function opinionInYears(fromId, toId, years) {
  let sum = 0;
  for (const l of opinionBreakdown(fromId, toId)) {
    if (l.kind === LINE.CLAMP) continue;
    if (l.kind !== LINE.MEMORY) { sum += l.value; continue; }
    const left = Math.max(0, (l.yearsLeft || 0) - years);
    sum += (l.full || 0) * (left / (l.life || 25));
  }
  return Math.round(Math.max(-100, Math.min(100, sum)));
}

// ---------------------------------------------------------------------------
// Discontent: how ready this person is to stop complaining and start organising.
// Opinion alone is not enough — a Kanaatkâr man who dislikes you still sits
// down, and a Hırslı man who merely tolerates you is already counting swords.
// ---------------------------------------------------------------------------
export function discontent(charId, liegeId) {
  const c = ch(charId);
  if (!c || c.deathDay != null || charId === liegeId) return 0;
  const o = opinionOf(charId, liegeId);
  let d = Math.max(0, (-o - 10) / 80);
  const loyal = traitAi(c, 'loyalty');       // content +0.25, ambitious −0.20
  d += Math.max(0, -loyal) * 1.4;
  d += Math.max(0, traitAi(c, 'claim')) * 0.7;
  d += Math.max(0, traitAi(c, 'scheme')) * 0.25;
  d -= Math.max(0, loyal) * 1.6;
  d -= Math.max(0, traitAi(c, 'forgive')) * 0.35;
  if (c.imprisonedBy) d *= 0.2;
  return Math.max(0, Math.min(1, d));
}

/**
 * The same reason, but shaped to sit inside a sentence. A modifier label like
 * "Şüpheci ↔ Mutaassıp" is fine in a ledger and reads like a debug string in
 * prose, so prose asks for this instead.
 */
export function grievanceSentence(fromId, toId) {
  const lines = opinionBreakdown(fromId, toId).filter((l) => l.value < 0 && l.kind !== LINE.CLAMP);
  const mem = lines.find((l) => l.kind === LINE.MEMORY);
  if (mem) return mem.label.replace(/\.$/, '');
  const l = lines[0];
  if (!l) return 'ona borçlu olmadığın hiçbir şey yok — ve bu da bir sebep';
  if (l.kind === LINE.FAITH) return 'aynı Tanrı\'ya aynı şekilde inanmıyorsunuz';
  if (l.kind === LINE.CULTURE) return 'onun evinde senin dilin konuşulmuyor';
  if (l.kind === LINE.BRAND) return 'taşıdığın damgayı herkes biliyor';
  if (l.kind === LINE.BASE) return 'aranızda kapanmamış eski bir hesap var';
  return 'huyunuz tutmuyor, hiç tutmadı';
}

/** A one-line reason this person would ride against his liege. Never generic. */
export function discontentReason(charId, liegeId) {
  const g = topGrievance(charId, liegeId);
  if (g) return g.label;
  const c = ch(charId);
  if (traitAi(c, 'loyalty') < 0) return 'Sadece daha fazlasını istiyor';
  return 'Sebebini kimse bilmiyor';
}

const tn = (t) => TRAITS[t]?.name || t;
const cul = (k) => CULTURE_LABEL[k] || k;
const fth = (k) => FAITH_LABEL[k] || k;

export { CULTURE_LABEL, FAITH_LABEL };
