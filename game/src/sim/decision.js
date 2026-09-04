// ===========================================================================
// THE TENSION SPINE
// ---------------------------------------------------------------------------
// A decision is not a button. It is: a named stake, a price paid before you know
// anything, a wait you cannot cancel, signals that arrive while you wait and tell
// you nothing for certain, a reveal that is staged rather than printed, and a
// memory the world keeps afterwards.
//
// Everything that can make the player's stomach drop is modelled here so it can
// be tuned in one place.
// ===========================================================================

import { S, rng, newId, ch, alive } from '../core/state.js';
import { emit } from '../core/bus.js';
import { pause } from '../core/clock.js';
import { fmtDate } from '../core/date.js';

export const STAKE = {
  GOLD: 'gold', PRESTIGE: 'prestige', PIETY: 'piety',
  LIFE: 'life',           // someone can die
  KIN: 'kin',             // that someone shares your blood
  OATH: 'oath',           // you are breaking a sworn word
  TITLE: 'title',         // land changes hands
  REPUTATION: 'reputation',
  SECRET: 'secret',       // exposure risk
  SOUL: 'soul',           // damnation, excommunication
};

/** Stakes that cannot be walked back once the die is cast. */
const IRREVERSIBLE = new Set([STAKE.LIFE, STAKE.KIN, STAKE.OATH, STAKE.TITLE, STAKE.SOUL]);

// --- weight -----------------------------------------------------------------
// 0 = a shrug. 1 = you will remember where you were sitting.
// Weight drives *presentation*: how hard the game stops, how slow the reveal is,
// how much of the screen the moment takes.
export function weighDecision(d) {
  let w = 0.05;
  const p = ch(S.playerId);
  for (const st of d.stakes || []) {
    switch (st.kind) {
      case STAKE.KIN:  w += 0.34; break;
      case STAKE.LIFE: w += 0.26; break;
      case STAKE.SOUL: w += 0.22; break;
      case STAKE.OATH: w += 0.20; break;
      case STAKE.TITLE: w += 0.18; break;
      case STAKE.SECRET: w += 0.14; break;
      case STAKE.REPUTATION: w += 0.10; break;
      case STAKE.GOLD: w += p ? Math.min(0.18, (st.value || 0) / Math.max(60, p.gold + 1) * 0.22) : 0.04; break;
      case STAKE.PRESTIGE: case STAKE.PIETY: w += 0.06; break;
      default: w += 0.03;
    }
  }
  // A coin flip is worse than a long shot. Uncertainty itself is the pressure.
  const o = d.odds ?? 0.5;
  w += (1 - Math.abs(o - 0.5) * 2) * 0.16;
  // The longer you have to live with it unresolved, the heavier it sits.
  const wait = Math.max(0, (d.resolveDay ?? S.day) - S.day);
  w += Math.min(0.12, wait / 900);
  // Aimed at someone you actually know.
  if (d.targetId && d.targetId === S.playerId) w += 0.10;
  return Math.max(0, Math.min(1, w));
}

export function isIrreversible(d) {
  return (d.stakes || []).some((s) => IRREVERSIBLE.has(s.kind) || s.irreversible);
}

/** Human phrase for what you are about to spend, in the second person. */
export function stakeLine(st) {
  switch (st.kind) {
    case STAKE.GOLD: return `${st.value} altın — geri gelmez`;
    case STAKE.PRESTIGE: return `${st.value} itibar`;
    case STAKE.PIETY: return `${st.value} dindarlık`;
    case STAKE.LIFE: return `${st.who || 'bir insanın'} hayatı`;
    case STAKE.KIN: return `${st.who || 'kendi kanın'} — kendi kanın`;
    case STAKE.OATH: return `verdiğin söz`;
    case STAKE.TITLE: return `${st.who || 'bir toprak'}`;
    case STAKE.SECRET: return `sırrın açığa çıkabilir`;
    case STAKE.SOUL: return `ruhun`;
    default: return st.label || '';
  }
}

// --- lifecycle --------------------------------------------------------------

/**
 * Put a decision in front of the player. Does not resolve anything.
 * @param {object} spec {kind,title,framing,targetId,options,scene}
 */
export function offer(spec) {
  const d = {
    id: newId('d'),
    createdDay: S.day,
    state: 'open',
    kind: spec.kind || 'event',
    title: spec.title,
    framing: spec.framing || '',
    body: spec.body || '',
    targetId: spec.targetId || null,
    scene: spec.scene || null,       // hint for the camera / backdrop
    options: (spec.options || []).map((o, i) => ({
      key: o.key || `o${i}`,
      label: o.label,
      detail: o.detail || '',
      cost: o.cost || [],            // paid immediately on commit
      stakes: o.stakes || [],
      odds: o.odds ?? null,          // null = certain
      waitDays: o.waitDays ?? 0,
      tone: o.tone || 'neutral',
      disabled: o.disabled || false,
      disabledWhy: o.disabledWhy || '',
      onCommit: o.onCommit || null,
      onResolve: o.onResolve || null,
      tells: o.tells || null,
    })),
    weight: 0,
    onExpire: spec.onExpire || null,
    expiresDay: spec.expiresDay ?? null,
  };
  d.weight = Math.max(...d.options.map((o) => weighDecision({ stakes: o.stakes, odds: o.odds, resolveDay: S.day + o.waitDays, targetId: d.targetId })), 0.05);
  S.decisions.push(d);
  // Anything heavy stops the world. You do not get to skim past this.
  if (d.weight > 0.34) pause('decision');
  emit('decision:offered', d);
  return d;
}

/** The player commits. The price is paid NOW, before anyone knows anything. */
export function commit(decisionId, optionKey) {
  const d = S.decisions.find((x) => x.id === decisionId);
  if (!d || d.state !== 'open') return null;
  const opt = d.options.find((o) => o.key === optionKey);
  if (!opt || opt.disabled) return null;

  const p = ch(S.playerId);
  const paid = [];
  for (const c of opt.cost) {
    if (c.kind === STAKE.GOLD) { p.gold -= c.value; paid.push({ ...c }); }
    else if (c.kind === STAKE.PRESTIGE) { p.prestige -= c.value; paid.push({ ...c }); }
    else if (c.kind === STAKE.PIETY) { p.piety -= c.value; paid.push({ ...c }); }
    else paid.push({ ...c });
  }

  d.state = opt.waitDays > 0 ? 'pending' : 'resolving';
  d.chosen = optionKey;
  d.committedDay = S.day;
  d.resolveDay = S.day + (opt.waitDays || 0);
  d.paid = paid;
  d.stakes = opt.stakes;
  d.shownOdds = opt.odds;
  d.irreversible = isIrreversible({ stakes: opt.stakes });
  d.weight = weighDecision({ stakes: opt.stakes, odds: opt.odds, resolveDay: d.resolveDay, targetId: d.targetId });
  d.tellsFired = [];
  // The true odds are rolled NOW and sealed. The wait is not a slot machine
  // spinning; it is a letter already written, riding toward you.
  d.sealedRoll = rng.next();
  d.trueOdds = opt.odds == null ? 1 : clamp01(opt.odds + (opt.hiddenMod || 0));
  d.willSucceed = opt.odds == null ? true : d.sealedRoll < d.trueOdds;

  S.stats.decisionsMade++;
  if (d.irreversible) S.stats.irreversible++;

  if (opt.onCommit) { try { opt.onCommit(d); } catch (e) { console.error(e); } }
  emit('decision:committed', d);

  if (d.state === 'resolving') resolve(d);
  return d;
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

/** Called every day: fires tells, drags the clock down as the date nears, resolves. */
export function tickDecisions(day) {
  for (const d of S.decisions) {
    if (d.state !== 'pending') continue;
    const span = Math.max(1, d.resolveDay - d.committedDay);
    const prog = (day - d.committedDay) / span;

    const tells = d.options.find((o) => o.key === d.chosen)?.tells;
    if (tells) {
      for (let i = 0; i < tells.length; i++) {
        const at = tells[i].at ?? (i + 1) / (tells.length + 1);
        if (prog >= at && !d.tellsFired.includes(i)) {
          d.tellsFired.push(i);
          const t = typeof tells[i].text === 'function' ? tells[i].text(d) : tells[i].text;
          const tone = tells[i].honest === false ? (rng.chance(0.5) ? 'good' : 'bad')
            : (d.willSucceed ? (tells[i].goodTone || 'good') : (tells[i].badTone || 'bad'));
          emit('decision:tell', { d, text: t, tone, prog });
          S.chronicle.push({ day, kind: 'tell', text: t, tone, decisionId: d.id });
        }
      }
    }

    // The last stretch drags. The game itself gets nervous.
    if (d.weight > 0.4 && prog >= 0.88 && S.speed > 2) emit('decision:closing', d);

    if (day >= d.resolveDay) resolve(d);
  }
  // sweep
  for (let i = S.decisions.length - 1; i >= 0; i--) {
    const d = S.decisions[i];
    if (d.state === 'done' && day - (d.resolveDay || 0) > 40) S.decisions.splice(i, 1);
    if (d.state === 'open' && d.expiresDay != null && day > d.expiresDay) {
      d.state = 'expired';
      if (d.onExpire) try { d.onExpire(d); } catch (e) { console.error(e); }
      emit('decision:expired', d);
      S.decisions.splice(i, 1);
    }
  }
}

export function resolve(d) {
  if (d.state === 'done') return;
  const opt = d.options.find((o) => o.key === d.chosen);
  d.state = 'done';
  let out = { success: d.willSucceed, title: '', text: '', effects: [] };
  if (opt?.onResolve) { try { out = { ...out, ...(opt.onResolve(d, d.willSucceed) || {}) }; } catch (e) { console.error(e); } }
  d.outcome = out;

  // The world remembers. This is what makes a choice cost something later.
  if (d.weight > 0.25 || d.irreversible) {
    S.memories.push({
      id: newId('m'), day: S.day, decisionId: d.id,
      kind: d.kind, title: d.title, success: out.success,
      targetId: d.targetId, weight: d.weight,
      text: out.text || d.title,
      irreversible: !!d.irreversible,
      recalls: 0,
    });
  }
  S.chronicle.push({ day: S.day, kind: 'outcome', text: out.text || d.title, tone: out.success ? 'good' : 'bad', weight: d.weight });

  if (d.weight > 0.30) pause('reveal');
  emit('decision:resolved', d);
}

/** Pull a memory back up so an old sin can bite. Used by AI and event triggers. */
export function recallMemory(pred) {
  const hits = S.memories.filter(pred);
  if (!hits.length) return null;
  const m = rng.weighted(hits, (x) => x.weight * 10 + 1);
  m.recalls++;
  return m;
}

export function openDecisions() { return S.decisions.filter((d) => d.state === 'open'); }
export function pendingDecisions() { return S.decisions.filter((d) => d.state === 'pending'); }
export function describeWait(d) {
  const left = Math.max(0, d.resolveDay - S.day);
  if (left <= 0) return 'şimdi';
  if (left < 30) return `${left} gün`;
  if (left < 365) return `${Math.round(left / 30)} ay`;
  return `${(left / 365).toFixed(1)} yıl`;
}
export { fmtDate };
