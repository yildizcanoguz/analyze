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
import { fullName, age, remember, opinion, relation, livingChildren, isKin } from './characters.js';

export const STAKE = {
  GOLD: 'gold', PRESTIGE: 'prestige', PIETY: 'piety',
  LIFE: 'life',           // someone can die
  KIN: 'kin',             // that someone shares your blood
  OATH: 'oath',           // you are breaking a sworn word
  TITLE: 'title',         // land changes hands
  REPUTATION: 'reputation',
  SECRET: 'secret',       // exposure risk
  SOUL: 'soul',           // damnation, excommunication
  // --- things that leave you the moment you commit, and have a name ---
  REGARD: 'regard',       // a named person thinks less of you, starting now
  FAVOR: 'favor',         // an iyilik you were holding over someone, spent
  TOLD: 'told',           // one more living person now knows what you did
};

/** Stakes that cannot be walked back once the die is cast. */
const IRREVERSIBLE = new Set([STAKE.LIFE, STAKE.KIN, STAKE.OATH, STAKE.TITLE, STAKE.SOUL]);

// --- presentation tier -------------------------------------------------------
// Weight is not a number the player ever sees; it is how hard the game stops.
// A decision that costs four coins must not get the same rectangle as one that
// costs a child, so the tier is decided here — in the sim — and the UI obeys.
export const TIER = { CARD: 'card', SHEET: 'sheet', RITE: 'rite' };

export function tierOf(d) {
  const w = d.weight ?? weighDecision(d);
  if (w >= 0.50) return TIER.RITE;
  if (w >= 0.20) return TIER.SHEET;
  return TIER.CARD;
}

/**
 * How long the player must physically hold the button down. The heavier the
 * thing, the longer your own hand has to stay on it.
 */
export function holdMillis(d, opt) {
  const w = Math.max(d?.weight ?? 0, weighDecision({ stakes: opt?.stakes, odds: opt?.odds, targetId: d?.targetId }));
  return Math.round(900 + w * 2600);
}

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
  // A certain outcome (odds === null) carries none of it.
  if (d.odds != null) w += (1 - Math.abs(d.odds - 0.5) * 2) * 0.16;
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

// ===========================================================================
// THE PRICE, PAID BEFORE YOU KNOW ANYTHING
// ---------------------------------------------------------------------------
// Gold is the least interesting thing a decision can cost. Blood, a broken word
// and a secret are all carried out by somebody, and that somebody is in the room
// when you decide. What they saw is spent immediately — before the dice, before
// the wait, before you have any right to feel clever about it.
//
// The surcharge is computed at offer() time and printed on the button. A hidden
// price is a cheat; a named one is a decision.
// ===========================================================================

const ROLE_TR = { chancellor:'Müşavirin', marshal:'Seraskerin', steward:'Defterdarın', spymaster:'Casusbaşın', chaplain:'Kadın' };

function courtOfPlayer() {
  return Object.values(S.chars).filter((c) => c.deathDay == null && c.courtOf === S.playerId && c.id !== S.playerId);
}
function councilMember(role) {
  const id = S.council?.[role];
  return id && alive(id) ? ch(id) : null;
}
/** Title the player would use for this person: "Casusbaşın", "kardeşin", "Kâhyan". */
export function addressOf(c) {
  if (!c) return 'biri';
  for (const [k, id] of Object.entries(S.council || {})) if (id === c.id) return ROLE_TR[k] || 'divan üyen';
  const r = relation(S.playerId, c.id);
  if (r === 'kardeş') return 'kardeşin';
  if (r === 'evlat') return 'çocuğun';
  if (r === 'ebeveyn') return 'anan baban';
  if (r === 'eş') return 'eşin';
  if (r === 'efendi') return 'efendin';
  if (r === 'vassal') return 'vassalın';
  if (c.courtOf === S.playerId) return 'sarayından biri';
  return 'biri';
}

function witnessFor(d, kinds) {
  const prefer = [];
  if (kinds.has(STAKE.SECRET) || kinds.has(STAKE.LIFE) || kinds.has(STAKE.KIN)) prefer.push('spymaster');
  if (kinds.has(STAKE.SOUL)) prefer.push('chaplain');
  if (kinds.has(STAKE.OATH)) prefer.push('chancellor');
  if (kinds.has(STAKE.TITLE)) prefer.push('steward');
  for (const role of prefer) { const c = councilMember(role); if (c) return c; }
  const friend = S.flags?.friendId && alive(S.flags.friendId) ? ch(S.flags.friendId) : null;
  if (friend) return friend;
  const court = courtOfPlayer();
  return court.length ? rng.pick(court) : null;
}

const WITNESS_LINE = {
  [STAKE.KIN]: 'Kendi kanına kıydığını gördü.',
  [STAKE.LIFE]: 'Emri senin ağzından duydu.',
  [STAKE.OATH]: 'Sözünden döndüğüne şahit oldu.',
  [STAKE.SOUL]: 'Bunu Tanrı’nın da duyduğunu düşünüyor.',
  [STAKE.SECRET]: 'Artık senin hakkında bilmemesi gereken bir şey biliyor.',
  [STAKE.TITLE]: 'Toprağını dağıtışını izledi.',
};

/**
 * Everything this option takes from you the second you commit — the writer's
 * declared cost plus what the world charges on top of it, with names.
 * Pure: returns plain JSON, mutates nothing.
 */
export function plannedCost(d, o) {
  return [...(o.cost || []), ...(o.pays || [])];
}

function surcharge(d, o) {
  const kinds = new Set((o.stakes || []).map((s) => s.kind));
  const out = [];
  const p = ch(S.playerId);
  if (!p) return out;

  // 1. Somebody has to watch you do it.
  const heavy = [STAKE.KIN, STAKE.LIFE, STAKE.OATH, STAKE.SOUL, STAKE.SECRET, STAKE.TITLE].filter((k) => kinds.has(k));
  if (heavy.length) {
    const w = witnessFor(d, kinds);
    if (w && w.id !== d.targetId) {
      const sev = (kinds.has(STAKE.KIN) ? 26 : kinds.has(STAKE.LIFE) ? 20 : kinds.has(STAKE.OATH) ? 18 : 12);
      // An honest man is harder on you; a schemer shrugs.
      const mod = w.traits?.includes('honest') ? 1.4 : w.traits?.includes('deceitful') ? 0.6 : 1;
      out.push({
        kind: STAKE.REGARD, whoId: w.id, who: fullName(w), address: addressOf(w),
        value: Math.round(sev * mod),
        why: WITNESS_LINE[heavy[0]] || 'Ne yaptığını gördü.',
        life: kinds.has(STAKE.KIN) ? 60 : 30,
      });
    }
  }

  // 2. A secret is not a thing you keep. It is a thing one more person carries.
  if (kinds.has(STAKE.SECRET)) {
    const acc = councilMember('spymaster') || witnessFor(d, kinds);
    if (acc) out.push({ kind: STAKE.TOLD, whoId: acc.id, who: fullName(acc), address: addressOf(acc), value: 1 });
  }

  // 3. An iyilik you were holding over somebody buys silence — once.
  if ((kinds.has(STAKE.SECRET) || d.kind === 'scheme') && p.hooks?.length) {
    const h = p.hooks[0];
    const on = ch(h.onId);
    if (on) out.push({ kind: STAKE.FAVOR, whoId: on.id, who: fullName(on), address: addressOf(on), value: 1 });
  }
  return out.slice(0, 2);
}

/** Turkish phrase for one line of the bill. */
export function costPhrase(c) {
  switch (c.kind) {
    case STAKE.GOLD: return `${c.value} altın`;
    case STAKE.PRESTIGE: return `${c.value} itibar`;
    case STAKE.PIETY: return `${c.value} dindarlık`;
    case STAKE.REGARD: return `${c.who} — gözünde ${c.value} düşersin`;
    case STAKE.FAVOR: return `${c.who} üzerindeki iyiliğin`;
    case STAKE.TOLD: return `${c.who} bunu öğrenir`;
    default: return stakeLine(c);
  }
}

/** Apply the bill. Nothing here is refundable and nothing here is a roll. */
function payAll(p, bill, d) {
  const paid = [];
  for (const c of bill) {
    const row = { ...c };
    if (c.kind === STAKE.GOLD) { row.before = Math.floor(p.gold); p.gold -= c.value; row.after = Math.floor(p.gold); }
    else if (c.kind === STAKE.PRESTIGE) { row.before = Math.floor(p.prestige); p.prestige -= c.value; row.after = Math.floor(p.prestige); }
    else if (c.kind === STAKE.PIETY) { row.before = Math.floor(p.piety); p.piety -= c.value; row.after = Math.floor(p.piety); }
    else if (c.kind === STAKE.REGARD && c.whoId && alive(c.whoId)) {
      row.before = opinion(c.whoId, p.id);
      remember(c.whoId, p.id, c.why || 'Ne yaptığını gördü.', -Math.abs(c.value), c.life || 30);
      row.after = opinion(c.whoId, p.id);
    } else if (c.kind === STAKE.FAVOR && p.hooks?.length) {
      const i = p.hooks.findIndex((h) => h.onId === c.whoId);
      if (i >= 0) p.hooks.splice(i, 1); else p.hooks.shift();
    } else if (c.kind === STAKE.TOLD && c.whoId && alive(c.whoId)) {
      const w = ch(c.whoId);
      (w.knownSecrets ||= []).push({ ownerId: p.id, kind: d?.kind || 'deed', decisionId: d?.id || null, day: S.day });
      // What he knows about you is a hook he now holds.
      (w.hooks ||= []).push({ onId: p.id, kind: 'weak', day: S.day });
    }
    row.line = costPhrase(c);
    paid.push(row);
  }
  return paid;
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
    case STAKE.REPUTATION: return st.label || `adın`;
    case STAKE.REGARD: return `${st.who || 'birinin'} gözünde ${st.value || ''} düşersin`;
    case STAKE.FAVOR: return `${st.who || 'birinin'} üzerindeki iyiliğin`;
    case STAKE.TOLD: return `${st.who || 'bir kişi'} bunu öğrenir`;
    default: return st.label || 'bir şey';
  }
}


// --- who exactly is on the table -------------------------------------------
/**
 * The named people this option puts at risk. Not "a vassal" — "41 yaşındaki
 * kardeşin Sökmen, iki çocuk babası". Returned as plain JSON so the gate can
 * print it and the sim never has to know what a gate is.
 */
export function lossOf(d, o) {
  const out = [];
  const seen = new Set();
  const push = (id, why) => {
    const c = id && ch(id);
    if (!c || seen.has(id) || c.deathDay != null) return;
    seen.add(id);
    const kids = livingChildren(c);
    out.push({
      id: c.id, name: fullName(c), short: c.name, age: age(c),
      address: addressOf(c), relation: relation(S.playerId, c.id),
      kin: isKin(S.playerId, c.id),
      opinion: c.id === S.playerId ? 100 : opinion(c.id, S.playerId),
      children: kids.slice(0, 4).map((k) => ({ name: k.name, age: age(k) })),
      childCount: kids.length,
      why,
    });
  };
  for (const st of o.stakes || []) {
    if (st.kind === STAKE.LIFE || st.kind === STAKE.KIN) push(st.whoId || d.targetId, st.kind);
  }
  if (!out.length && d.targetId) {
    const kinds = new Set((o.stakes || []).map((x) => x.kind));
    if (kinds.has(STAKE.TITLE) || kinds.has(STAKE.OATH) || kinds.has(STAKE.SECRET)) push(d.targetId, 'target');
  }
  return out;
}

/** One sentence about what happens to this person's household if it goes wrong. */
export function householdLine(l) {
  if (!l) return '';
  if (l.childCount === 0) return 'Arkasında kimse kalmaz.';
  const names = l.children.map((k) => `${k.name} (${k.age})`).join(', ');
  if (l.childCount === 1) return `Bir çocuğu var: ${names}.`;
  return `${l.childCount} çocuğu var: ${names}${l.childCount > l.children.length ? '…' : ''}.`;
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
      confirm: o.confirm || null,     // the writer's own line for the gate
      onCommit: o.onCommit || null,
      onResolve: o.onResolve || null,
      tells: o.tells || null,
      pays: [],                      // what the world charges on top, with names
      hiddenMod: o.hiddenMod ?? 0,   // what the shown odds do not tell you
    })),
    weight: 0,
    onExpire: spec.onExpire || null,
    expiresDay: spec.expiresDay ?? null,
  };
  // The bill is written before the button is drawn, so the button can show it.
  for (const o of d.options) o.pays = surcharge(d, o);
  d.weight = Math.max(...d.options.map((o) => weighDecision({ stakes: o.stakes, odds: o.odds, cost: plannedCost(d, o), resolveDay: S.day + o.waitDays, targetId: d.targetId })), 0.05);
  d.tier = tierOf(d);
  S.decisions.push(d);
  // Anything above a shrug stops the world. You do not get to skim past this.
  if (d.tier !== TIER.CARD) pause('decision');
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
  const paid = payAll(p, plannedCost(d, opt), d);

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
  if (paid.length) emit('decision:paid', { d, paid });
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
