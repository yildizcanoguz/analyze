// P08 — SUCCESSION AND DEATH.
// ---------------------------------------------------------------------------
// The one moment the game takes the crown off your head and hands it to someone
// else. Everything here exists to make that moment cost something:
//
//   * the law is a choice, and every law hurts a different person;
//   * changing it is paid for now and delivered in eight years, so a decision
//     made today is settled by a man who does not exist yet;
//   * the heir is always known, always named, and usually not the one you want;
//   * inheriting is a loss — vassals swore to your father, not to you.
//
// No ui/ or render/ imports. No Math.random. Preview functions are pure: the
// UI polls them every day, so they must never draw from `rng`.

import { S, ch, ti, rng, alive, newId } from '../core/state.js';
import { emit } from '../core/bus.js';
import { pause } from '../core/clock.js';
import { YEAR, fmtDate } from '../core/date.js';
import { fullName, age, livingChildren, remember, opinion, skills, SKILLS, SKILL_LABEL } from './characters.js';
import { grantTitle, primaryTitle, titleName, styleOf, TIER, recomputeVassalage, vassalsOf, directCountiesOf } from './realm.js';

// ---------------------------------------------------------------- the laws
export const LAWS = {
  partition: {
    id: 'partition', name: 'Bölüşme', kicker: 'her evlada bir pay',
    line: 'Toprağın bütün çocukların arasında paylaşılır.',
    pain: 'Kazandığın her kontluk ülkeni bir parça daha böler. Ölümünde geriye tek bir ülke kalmaz.',
    cost: 220, years: 4,
  },
  primogeniture: {
    id: 'primogeniture', name: 'Birinci Evlat', kicker: 'en büyüğü her şeyi alır',
    line: 'En büyük oğlun her şeyi alır. Diğerleri hiçbir şey.',
    pain: 'Mirastan çıkan her çocuk seni ve kardeşini ömrü boyunca hatırlar; toprağında hak iddia eder.',
    cost: 380, years: 8,
  },
  seniority: {
    id: 'seniority', name: 'Ekberiyet', kicker: 'hanedanın en yaşlısı',
    line: 'Hanedanın yaşayan en yaşlı erkeği tahta geçer — oğlun değil.',
    pain: 'Ülkeyi yaşlı adamlar devralır ve çabuk ölür. Her ölüm yeni bir devir, her devir yeni bir yabancı.',
    cost: 300, years: 5,
  },
  elective: {
    id: 'elective', name: 'Seçim', kicker: 'vassalların oy verir',
    line: 'Vassalların ve hanedanın oyu tahtı belirler.',
    pain: 'Sevilmeyen bir varisin geçmez. Yeterince beğenilmezsen taç senin kanından çıkar.',
    cost: 340, years: 6,
  },
};
export const LAW_ORDER = ['partition', 'primogeniture', 'seniority', 'elective'];

/** What a ruler was handed on their first day — so the eulogy can compare. */
function seedOf(c) {
  return {
    day: S.day, titles: (c?.titles || []).length,
    gold: Math.round(c?.gold || 0), prestige: Math.round(c?.prestige || 0),
    stats: { ...(S.stats || {}) },
  };
}

function suc() {
  if (!S.succession) {
    S.succession = {
      law: 'partition',        // 1066: the realm is not yet a thing that stays whole
      pendingLaw: null,        // {law, sealedDay, doneDay, prestige}
      lawHistory: [],
      dynastyId: ch(S.playerId)?.dynastyId || null,
      reignStart: S.day,
      reignSeed: seedOf(ch(S.playerId)),
      reigns: [],              // finished reigns, for the epilogue
      plans: {},               // deadId -> resolved split
      last: null,              // the succession the UI is currently staging
      generation: 1,
      ended: null,             // {reason, day, ...} when the line is over
    };
  }
  if (!S.succession.dynastyId) S.succession.dynastyId = ch(S.playerId)?.dynastyId || null;
  return S.succession;
}

export function currentLaw() { return LAWS[suc().law] ? suc().law : 'partition'; }
export function lawInfo(id = currentLaw()) { return LAWS[id]; }
export function pendingLaw() { return suc().pendingLaw; }
export function reignStart() { return suc().reignStart; }
export function reignSeed() { return suc().reignSeed || { titles: 0, gold: 0, prestige: 0 }; }
export function generation() { return suc().generation; }
export function dynastyEnded() { return suc().ended; }
export function lastSuccession() { return suc().last; }

/** Your house has a law. Everyone else inherits the old way. */
function lawFor(c) {
  const s = suc();
  return c && s.dynastyId && c.dynastyId === s.dynastyId ? currentLaw() : 'primogeniture';
}

// ---------------------------------------------------------------- heir order

function bornOrder(a, b) {
  if ((a.sex === 'm') !== (b.sex === 'm')) return a.sex === 'm' ? -1 : 1;
  if (a.birthDay !== b.birthDay) return a.birthDay - b.birthDay;
  return a.id < b.id ? -1 : 1;
}
function livingKids(c) { return livingChildren(c).sort(bornOrder); }
/** Struck from the line by their own father. The list is kept forever. */
export function isDisinherited(id) { return !!suc().struck?.[id]; }
export function struckDay(id) { return suc().struck?.[id]?.day ?? null; }
function keep(x) { return x && !isDisinherited(x.id); }
function orderedKids(c) { return livingKids(c).filter(keep); }

function allSiblingsOf(c) {
  return Object.values(S.chars).filter((x) => x.deathDay == null && x.id !== c.id &&
    ((c.fatherId && x.fatherId === c.fatherId) || (c.motherId && x.motherId === c.motherId)));
}
function siblingsOf(c) { return allSiblingsOf(c).filter(keep); }
function dynastyOf(c) {
  if (!c.dynastyId) return [];
  return Object.values(S.chars).filter((x) => x.deathDay == null && x.dynastyId === c.dynastyId && x.id !== c.id && keep(x));
}
function fallbackOrder(c) {
  const sibs = siblingsOf(c).sort(bornOrder);
  if (sibs.length) return sibs;
  return dynastyOf(c).sort((a, b) => a.birthDay - b.birthDay || (a.id < b.id ? -1 : 1));
}

/** Adults of the house, oldest first. The law that gives the crown to an uncle. */
function seniorityOrder(c) {
  const pool = dynastyOf(c).filter((x) => age(x) >= 16);
  pool.sort((a, b) => a.birthDay - b.birthDay || (a.id < b.id ? -1 : 1));
  if (pool.length) return pool;
  return orderedKids(c).length ? orderedKids(c) : fallbackOrder(c);
}

// --- elective ---------------------------------------------------------------
/** Who may be voted for: grown blood, plus the vassals strong enough to want it. */
export function electiveCandidates(c) {
  const seen = new Set();
  const out = [];
  const push = (x, minAge) => {
    if (!x || x.deathDay != null || x.id === c.id || seen.has(x.id) || age(x) < minAge) return;
    seen.add(x.id); out.push(x);
  };
  for (const k of orderedKids(c)) push(k, 0);        // your children stand even at nine
  for (const d of dynastyOf(c)) push(d, 16);
  for (const v of vassalsOf(c.id)) push(v, 16);
  return out;
}
/** Who votes: the men who hold your land and the men who share your name. */
export function electiveVoters(c) {
  const seen = new Set();
  const out = [];
  for (const v of vassalsOf(c.id)) { if (age(v) >= 16 && !seen.has(v.id)) { seen.add(v.id); out.push(v); } }
  for (const d of dynastyOf(c)) { if (age(d) >= 16 && !seen.has(d.id)) { seen.add(d.id); out.push(d); } }
  return out;
}
function voteWeight(voter, cand, ruler) {
  let w = opinion(voter.id, cand.id);
  if (voter.id === cand.id) w += 45;                       // everyone likes themselves
  if (cand.dynastyId === ruler.dynastyId) w += 12;         // the house has some pull
  if (voter.dynastyId === cand.dynastyId) w += 18;
  const sk = skills(cand);
  w += (sk.martial + sk.stewardship) * 0.8;
  w += Math.min(30, (cand.prestige || 0) / 40);
  if (age(cand) < 16) w -= 60;
  if (age(cand) > 58) w -= 12;
  return w;
}
/** Deterministic tally. Called by the UI every day — must not touch rng. */
export function electiveTally(charId) {
  const c = ch(charId);
  if (!c) return [];
  const cands = electiveCandidates(c);
  if (!cands.length) return [];
  const voters = electiveVoters(c);
  const tally = new Map(cands.map((x) => [x.id, { id: x.id, char: x, votes: 0, voters: [] }]));
  for (const v of voters) {
    let best = null, bestW = -1e9;
    for (const cd of cands) {
      const w = voteWeight(v, cd, c);
      if (w > bestW || (w === bestW && best && cd.id < best.id)) { best = cd; bestW = w; }
    }
    if (best) { const t = tally.get(best.id); t.votes++; t.voters.push(v.id); }
  }
  const rows = [...tally.values()];
  rows.sort((a, b) => b.votes - a.votes ||
    (b.char.prestige || 0) - (a.char.prestige || 0) ||
    a.char.birthDay - b.char.birthDay || (a.id < b.id ? -1 : 1));
  return rows;
}
function electiveOrder(c) {
  const rows = electiveTally(c.id).filter((r) => r.votes > 0 || true);
  const out = rows.map((r) => r.char);
  return out.length ? out : (orderedKids(c).length ? orderedKids(c) : fallbackOrder(c));
}

/**
 * Ordered heirs under the law that governs this person. Index 0 takes the
 * primary title; under partition the rest take a share of the land.
 */
export function heirsOf(charId) {
  const c = ch(charId);
  if (!c) return [];
  const law = lawFor(c);
  if (law === 'elective') return electiveOrder(c);
  if (law === 'seniority') return seniorityOrder(c);
  const kids = orderedKids(c);
  if (kids.length) return kids;
  return fallbackOrder(c);
}

export function heirOf(charId) { return heirsOf(charId)[0] || null; }

// ---------------------------------------------------------------- the split

/**
 * How this person's land would be divided if they died today, under `law`.
 * Pure. The UI shows this years before the funeral, which is the whole point.
 * @returns {{law, shares:[{id, titleIds}], map:{titleId:heirId}, fragments}}
 */
export function splitUnder(charId, law) {
  const c = ch(charId);
  const out = { law, shares: [], map: {}, fragments: 0 };
  if (!c) return out;
  const titles = (c.titles || []).map(ti).filter(Boolean).sort((a, b) => b.tier - a.tier || (a.id < b.id ? -1 : 1));
  let order;
  if (law === 'elective') order = electiveOrder(c);
  else if (law === 'seniority') order = seniorityOrder(c);
  else { const k = orderedKids(c); order = k.length ? k : fallbackOrder(c); }
  if (!order.length || !titles.length) return out;

  const give = (heirId, t) => {
    out.map[t.id] = heirId;
    let sh = out.shares.find((x) => x.id === heirId);
    if (!sh) { sh = { id: heirId, titleIds: [] }; out.shares.push(sh); }
    sh.titleIds.push(t.id);
  };

  const kids = orderedKids(c);
  if (law === 'partition' && kids.length > 1) {
    // The eldest keeps the crown and the best half; the others carve the rest.
    const counties = titles.filter((t) => t.tier === TIER.county);
    const higher = titles.filter((t) => t.tier > TIER.county);
    for (const t of higher) give(kids[0].id, t);
    const heads = kids.slice(0, Math.max(2, Math.min(kids.length, counties.length)));
    const eldestKeeps = Math.max(1, Math.ceil(counties.length / heads.length));
    let i = 0;
    for (const t of counties) {
      if (i < eldestKeeps) give(kids[0].id, t);
      else give(heads[1 + ((i - eldestKeeps) % Math.max(1, heads.length - 1))].id, t);
      i++;
    }
  } else {
    for (const t of titles) give(order[0].id, t);
  }
  out.fragments = out.shares.length;
  return out;
}

/** The split that is actually coming, under the law in force. */
export function successionPreview(charId) {
  const c = ch(charId);
  if (!c) return null;
  const law = lawFor(c);
  const split = splitUnder(charId, law);
  const order = heirsOf(charId);
  const counties = directCountiesOf(charId).length;
  return {
    law,
    heirs: order,
    heir: order[0] || null,
    shares: split.shares,
    map: split.map,
    fragments: split.fragments,
    counties,
    /** True when partition is armed but has nothing yet to tear apart. */
    dormant: law === 'partition' && orderedKids(c).length > 1 && counties < 2,
  };
}

/** Everyone in line who ends up with nothing. They do not forget it. */
export function disinheritedOf(charId, split) {
  const c = ch(charId);
  if (!c) return [];
  const got = new Set((split || splitUnder(charId, lawFor(c))).shares.map((s) => s.id));
  const pool = [];
  for (const k of livingKids(c)) pool.push(k);
  for (const s of allSiblingsOf(c)) if (age(s) >= 12) pool.push(s);
  const seen = new Set();
  return pool.filter((x) => !got.has(x.id) && !seen.has(x.id) && (seen.add(x.id), true));
}

// ---------------------------------------------------------------- law change

/** What it costs to move to `toLaw`, and exactly whose face falls when you do. */
export function lawQuote(toLaw) {
  const p = ch(S.playerId);
  const L = LAWS[toLaw];
  if (!p || !L) return null;
  const from = currentLaw();
  const before = splitUnder(p.id, from);
  const after = splitUnder(p.id, toLaw);
  const cnt = (sp, id) => sp.shares.find((s) => s.id === id)?.titleIds.length || 0;
  const ids = new Set([...before.shares.map((s) => s.id), ...after.shares.map((s) => s.id),
    ...heirsOf(p.id).slice(0, 6).map((x) => x.id)]);
  const losers = [], gainers = [];
  for (const id of ids) {
    const c = ch(id);
    if (!c || c.deathDay != null) continue;
    const d = cnt(after, id) - cnt(before, id);
    if (d < 0) losers.push({ id, name: fullName(c), age: age(c), lost: -d });
    else if (d > 0) gainers.push({ id, name: fullName(c), age: age(c), gained: d });
  }
  // Vassals dislike laws that concentrate land; they like laws that give them a say.
  const vassals = vassalsOf(p.id).length;
  let vassalMood = 0;
  if (toLaw === 'elective') vassalMood = +1;
  if (toLaw === 'primogeniture') vassalMood = -1;
  const prestige = Math.round(L.cost + losers.length * 70 + (vassalMood < 0 ? vassals * 25 : 0));
  return {
    law: toLaw, from,
    prestige,
    days: Math.round(L.years * YEAR),
    years: L.years,
    losers, gainers, vassalMood,
    affordable: (p.prestige || 0) >= prestige,
    same: toLaw === from,
    blocked: !!suc().pendingLaw,
  };
}

/**
 * Seal an edict. The prestige goes now; the law arrives in years. If you die
 * first, the wax was for nothing — that is the price of thinking long.
 */
export function proposeLaw(toLaw) {
  const s = suc();
  const p = ch(S.playerId);
  const q = lawQuote(toLaw);
  if (!p || !q || q.same || q.blocked || !q.affordable) return null;
  p.prestige -= q.prestige;
  s.pendingLaw = { law: toLaw, sealedDay: S.day, doneDay: S.day + q.days, prestige: q.prestige, by: p.id };
  // Everyone who loses land hears about it the same week.
  for (const l of q.losers) remember(l.id, p.id, `${LAWS[toLaw].name} kanununu mühürledin; payını sildin.`, -28, 999);
  if (q.vassalMood < 0) for (const v of vassalsOf(p.id)) remember(v.id, p.id, 'Verasete tek başına karar verdin.', -10, 20);
  if (q.vassalMood > 0) for (const v of vassalsOf(p.id)) remember(v.id, p.id, 'Tahtta söz hakkı verdin.', +14, 20);
  S.chronicle.push({
    day: S.day, kind: 'law', tone: 'neutral',
    text: `${LAWS[toLaw].name} fermanı mühürlendi. ${q.years} yıl sonra yürürlüğe girecek — o gün geldiğinde tahtta kim olacak, bilmiyorsun.`,
  });
  S.memories.push({
    id: newId('m'), day: S.day, kind: 'law', title: `${LAWS[toLaw].name} fermanı`,
    weight: 0.5, irreversible: true, success: true, recalls: 0,
    text: `${LAWS[toLaw].name} kanununu ${q.prestige} itibara mühürledin.`,
  });
  emit('succession:law', { law: toLaw, state: 'sealed', doneDay: s.pendingLaw.doneDay });
  return s.pendingLaw;
}

/** Called daily by the UI (and by tick, once the coordinator wires it). */
export function tickSuccession(day = S.day) {
  const s = suc();
  if (s.pendingLaw && day >= s.pendingLaw.doneDay) {
    const l = s.pendingLaw;
    s.law = l.law;
    s.pendingLaw = null;
    s.lawHistory.push({ day, law: l.law });
    S.chronicle.push({
      day, kind: 'law', tone: 'neutral',
      text: `Veraset kanunu bugün değişti: ${LAWS[l.law].name}. Mühür ${Math.max(1, Math.round((day - l.sealedDay) / YEAR))} yıl önce basılmıştı.`,
    });
    emit('succession:law', { law: l.law, state: 'active' });
  }
}

// ------------------------------------------------------- striking a name out

/** What it costs to take a living child out of your own line. */
export function disinheritQuote(targetId) {
  const p = ch(S.playerId), t = ch(targetId);
  if (!p || !t || t.deathDay != null) return null;
  const rel = t.fatherId === p.id || t.motherId === p.id ? 'evlat'
    : (p.fatherId && t.fatherId === p.fatherId) || (p.motherId && t.motherId === p.motherId) ? 'kardeş' : null;
  const split = splitUnder(p.id, currentLaw());
  const share = split.shares.find((x) => x.id === targetId)?.titleIds.length || 0;
  const inLine = heirsOf(p.id).slice(0, 6).some((h) => h.id === targetId);
  const kin = Object.values(S.chars).filter((c) => c.deathDay == null && c.dynastyId === p.dynastyId && c.id !== p.id && c.id !== targetId);
  return {
    targetId, name: fullName(t), age: age(t), rel, share,
    prestige: Math.round(140 + share * 90 + (rel === 'evlat' ? 60 : 0)),
    already: isDisinherited(targetId),
    eligible: !!rel && !isDisinherited(targetId) && (share > 0 || inLine),
    kinCount: kin.length,
    witnesses: kin.slice(0, 4).map((c) => ({ id: c.id, name: fullName(c), age: age(c) })),
  };
}

/**
 * Strike a name out of your own line. Paid now, in prestige and in blood: the
 * child keeps the date, presses a claim, and every relative you have watches
 * you do it. There is no way back — the list is never cleaned.
 */
export function disinherit(targetId) {
  const q = disinheritQuote(targetId);
  const p = ch(S.playerId), t = ch(targetId);
  if (!q || !q.eligible || (p.prestige || 0) < q.prestige) return null;
  const s = suc();
  s.struck ||= {};
  p.prestige -= q.prestige;
  s.struck[targetId] = { day: S.day, by: p.id, name: fullName(t) };
  remember(targetId, p.id, 'Kendi baban adını mirastan sildi. Bunu ölene kadar taşıyacak.', -55, 999);
  const seat = primaryTitle(p);
  if (seat && !seat.claims.some((x) => x.charId === targetId)) seat.claims.push({ charId: targetId, kind: 'disinherited', day: S.day });
  for (const w of q.witnesses) remember(w.id, p.id, `${fullName(t)}'i mirastan çıkardın. Sıra kimde, kimse bilmiyor.`, -18, 40);
  S.stats.irreversible = (S.stats.irreversible || 0) + 1;
  S.chronicle.push({
    day: S.day, kind: 'succession', tone: 'bad',
    text: `${fullName(t)} mirastan çıkarıldı. ${age(t)} yaşında ve artık hiçbir şeyi yok.`,
  });
  S.memories.push({
    id: newId('m'), day: S.day, kind: 'succession', title: 'Mirastan çıkarma',
    targetId, weight: 0.55, irreversible: true, success: true, recalls: 0,
    text: `${fullName(t)}'i kendi elinle mirastan çıkardın.`,
  });
  emit('succession:struck', { targetId, by: p.id });
  return s.struck[targetId];
}

// ---------------------------------------------------------------- succession

function planFor(dead) {
  const s = suc();
  const plans = s.plans;
  if (plans[dead.id]) return plans[dead.id];
  const law = lawFor(dead);
  const split = splitUnder(dead.id, law);
  const order = heirsOf(dead.id);
  // Titles start moving on the very next line, so photograph the man first:
  // the screen has to say what he was, not what is left of him.
  const held = (dead.titles || []).map(ti).filter(Boolean).sort((a, b) => b.tier - a.tier);
  const plan = {
    deadId: dead.id, day: S.day, law,
    style: styleOf(dead),
    heldTitleIds: held.map((t) => t.id),
    seatName: held[0]?.name || null,
    seatLabel: held[0] ? titleName(held[0]) : null,
    map: split.map,
    shares: split.shares,
    primary: order[0]?.id || null,
    fragments: split.fragments,
    disinherited: disinheritedOf(dead.id, split).map((x) => x.id),
    applied: false,
  };
  plans[dead.id] = plan;
  const keys = Object.keys(plans);
  if (keys.length > 10) delete plans[keys[0]];
  return plan;
}

/**
 * A title changes hands because its holder is in the ground. Called once per
 * title by the world tick; the split is computed once and obeyed by all of them.
 */
export function succeed(title) {
  const dead = ch(title.holderId);
  if (!dead) return;
  const plan = planFor(dead);
  const toId = plan.map[title.id] || plan.primary;

  if (!toId || !alive(toId)) {
    // the line ends here; the land falls upward, or to no one at all
    const dl = title.dejureLiege ? ti(title.dejureLiege) : null;
    if (dl?.holderId && alive(dl.holderId)) grantTitle(title.id, dl.holderId, 'escheat');
    else title.holderId = null;
    emit('title:extinct', { titleId: title.id });
    if (dead.id === S.playerId && !S.playerSuccessionHandled) {
      S.playerSuccessionHandled = true;
      endOfLine(dead, 'no-heir');
    }
    return;
  }

  grantTitle(title.id, toId, 'inherit');

  if (!plan.applied) {
    plan.applied = true;
    settleInheritance(dead, plan);
  }

  if (dead.id === S.playerId && !S.playerSuccessionHandled) {
    S.playerSuccessionHandled = true;
    const heir = ch(plan.primary);
    const s = suc();
    // Elected away: the vassals put someone else's blood on the chair.
    if (s.dynastyId && heir.dynastyId !== s.dynastyId) { endOfLine(dead, 'elected-away', heir); return; }
    s.last = {
      deadId: dead.id, heirId: heir.id, law: plan.law, day: S.day,
      reignFrom: s.reignStart, reignTo: S.day,
      fragments: plan.fragments, shares: plan.shares,
      disinherited: plan.disinherited,
      style: plan.style, seatName: plan.seatName, seatLabel: plan.seatLabel,
      heldTitleIds: plan.heldTitleIds,
      seed: s.reignSeed || seedOf(dead),
      // an edict still in the post when its author died
      doomedLaw: s.pendingLaw ? { law: s.pendingLaw.law, prestige: s.pendingLaw.prestige,
        left: Math.max(0, s.pendingLaw.doneDay - S.day) } : null,
      dynastyLeft: Object.values(S.chars).filter((c) => c.deathDay == null && c.dynastyId === dead.dynastyId).length,
      kidsLeft: livingChildren(dead).length,
    };
    S.pendingPlayer = heir.id;
    pause('death');
    emit('player:died', { deadId: dead.id, heirId: heir.id });
  }
}

/** Grudges, claims and the funeral bill. Runs once per death, for anyone. */
function settleInheritance(dead, plan) {
  const primary = ch(plan.primary);
  const mine = suc().dynastyId && dead.dynastyId === suc().dynastyId;

  // Brothers and sons who got nothing keep the date in their heads forever, and
  // press a claim on the seat they were passed over for.
  const seat = (dead.titles || []).map(ti).filter(Boolean).sort((a, b) => b.tier - a.tier)[0]
    || (primary?.titles || []).map(ti).filter(Boolean).sort((a, b) => b.tier - a.tier)[0];
  for (const id of plan.disinherited) {
    const c = ch(id);
    if (!c || c.deathDay != null || !primary || id === primary.id) continue;
    remember(id, primary.id, `${fullName(dead)} öldü, pay sana kaldı. Ona hiçbir şey.`, -34, 999);
    if (mine) remember(id, primary.id, 'Mirastan çıkarıldı. Bunu unutmayacak.', -12, 999);
    if (seat && !seat.claims.some((x) => x.charId === id)) {
      seat.claims.push({ charId: id, kind: 'inheritance', day: S.day });
    }
  }
  if (!mine) applyHandover(dead.id, plan.primary);   // AI realms settle instantly
}

// ---------------------------------------------------------------- the handover

const HANDOVER_LIFE = 10;   // years for "I never swore to you" to wear off

/**
 * What inheriting actually costs, itemised by name. `apply=false` only reads.
 * This is the screen's spine: you watch the numbers you built get smaller.
 */
export function handoverPreview(deadId, heirId, apply = false) {
  const dead = ch(deadId), heir = ch(heirId);
  const out = { vassals: [], allies: [], feuds: [], prestige: null, gold: null, skills: [], fragments: 0 };
  if (!dead || !heir) return out;

  // 1. Vassals swore to your father. To you they swore nothing.
  for (const v of vassalsOf(heirId)) {
    if (v.id === heirId) continue;
    const before = opinion(v.id, deadId);
    let pen = -18;
    let why = 'Babana yemin etmişti, sana değil.';
    if (age(heir) < 16) { pen -= 15; why = 'Bir çocuğa diz çökmeyi hakaret sayıyor.'; }
    else if ((skills(heir).diplomacy || 0) < 5) { pen -= 5; why = 'Seni tanımıyor ve konuşman onu ısıtmadı.'; }
    if (v.culture !== heir.culture) pen -= 6;
    const after = Math.max(-100, Math.min(100, opinion(v.id, heirId) + pen));
    out.vassals.push({ id: v.id, name: fullName(v), age: age(v), before, after, delta: after - before, why });
    if (apply) remember(v.id, heirId, why, pen, HANDOVER_LIFE);
  }

  // 1b. Your father's liege did not choose you either.
  const liege = heir.liegeId ? ch(heir.liegeId) : null;
  if (liege && liege.deathDay == null) {
    const before = opinion(liege.id, deadId);
    let pen = -14;
    let why = 'Babanı tanıyordu. Seni divanda ilk kez görecek.';
    if (age(heir) < 16) { pen -= 12; why = 'Bir çocuğun yeminini yemin saymıyor.'; }
    const after = Math.max(-100, Math.min(100, opinion(liege.id, heir.id) + pen));
    out.liege = { id: liege.id, name: fullName(liege), age: age(liege), before, after, delta: after - before, why };
    if (apply) remember(liege.id, heir.id, why, pen, HANDOVER_LIFE);
  }

  // 2. Friendships were his, not yours. Feuds were his, and now they are yours.
  if (suc().dynastyId && dead.dynastyId === suc().dynastyId) {
    for (const c of Object.values(S.chars)) {
      if (c.deathDay != null || c.id === heirId) continue;
      const ms = c.memoriesOf?.[deadId];
      if (!ms || !ms.length) continue;
      let bond = 0, feud = 0, feudText = '';
      for (const m of ms) {
        const yrs = (S.day - m.day) / YEAR;
        const live = m.delta * Math.max(0, 1 - yrs / (m.life || 25));
        if (live > 0) bond += live;
        else if ((m.life || 25) >= 100) { feud += live; if (!feudText) feudText = m.text; }
      }
      if (bond >= 22) out.allies.push({ id: c.id, name: fullName(c), age: age(c), bond: Math.round(bond) });
      if (feud <= -18) {
        const carry = Math.round(feud * 0.6);
        out.feuds.push({ id: c.id, name: fullName(c), age: age(c), carry, text: feudText || 'Babanla bir hesabı vardı.' });
        if (apply) remember(c.id, heirId, `Babanla bir hesabı kapanmadı: ${feudText || 'eski bir kan'}`, carry, 999);
      }
    }
  }

  // 3. Money buries the dead; prestige belongs to the man who earned it.
  const goldIn = Math.round((dead.gold || 0) * 0.5);
  out.gold = { before: Math.round(dead.gold || 0), after: Math.round((heir.gold || 0) + goldIn), inherited: goldIn };
  const prestIn = Math.round((dead.prestige || 0) * 0.25);
  out.prestige = { before: Math.round(dead.prestige || 0), after: Math.round((heir.prestige || 0) + prestIn), inherited: prestIn };
  if (apply) {
    heir.gold = (heir.gold || 0) + goldIn;
    heir.prestige = (heir.prestige || 0) + prestIn;
    heir.stress = 0;
  }

  // 4. Different hands, different skills.
  const ds = skills(dead), hs = skills(heir);
  for (const k of SKILLS) out.skills.push({ key: k, label: SKILL_LABEL[k], dead: ds[k], heir: hs[k], delta: hs[k] - ds[k] });

  const plan = suc().plans?.[deadId];
  out.fragments = plan?.fragments || 1;
  return out;
}

function applyHandover(deadId, heirId) {
  const s = suc();
  s.appliedFor ||= {};
  if (s.appliedFor[deadId + '>' + heirId]) return;
  s.appliedFor[deadId + '>' + heirId] = true;
  handoverPreview(deadId, heirId, true);
  const keys = Object.keys(s.appliedFor);
  if (keys.length > 30) delete s.appliedFor[keys[0]];
}

/**
 * Hand the game to the heir. The UI calls this once the player has sat with it.
 * Everything the crown costs is charged here, at the moment of the bow.
 */
export function assumeHeir() {
  if (!S.pendingPlayer) return null;
  const s = suc();
  const id = S.pendingPlayer;
  const deadId = s.last?.deadId || null;
  S.pendingPlayer = null;
  S.playerSuccessionHandled = false;

  if (deadId) {
    const dead = ch(deadId);
    s.reigns.push({
      charId: deadId, name: fullName(dead), from: s.reignStart, to: S.day,
      years: Math.max(0, Math.round((S.day - s.reignStart) / YEAR)),
      deathAge: dead ? age(dead) : null, cause: dead?.deathCause || 'natural',
    });
    applyHandover(deadId, id);
  }

  // An edict that was still travelling dies with the man who sealed it.
  if (s.pendingLaw) {
    S.chronicle.push({
      day: S.day, kind: 'law', tone: 'bad',
      text: `${LAWS[s.pendingLaw.law].name} fermanı mühürlendiği yerde kaldı. Ödediğin itibar toprağa gitti.`,
    });
    s.voidedLaw = { ...s.pendingLaw, voidedDay: S.day };
    s.pendingLaw = null;
  }

  S.playerId = id;
  s.reignStart = S.day;
  s.reignSeed = seedOf(ch(id));
  s.generation++;
  recomputeVassalage();
  const c = ch(id);
  S.chronicle.push({
    day: S.day, kind: 'succession', tone: 'neutral',
    text: `${fullName(c)} tahta çıktı. ${age(c)} yaşında, ${s.generation}. kuşak.`,
  });
  S.memories.push({
    id: newId('m'), day: S.day, kind: 'succession', title: 'Devir',
    targetId: deadId, weight: 0.62, irreversible: true, success: true, recalls: 0,
    text: `${fullName(ch(deadId))} öldü; taht ${fullName(c)}'e geçti.`,
  });
  emit('player:changed', id);
  return c;
}

// ---------------------------------------------------------------- the end

function endOfLine(dead, reason, usurper = null) {
  const s = suc();
  const endPlan = s.plans?.[dead.id];
  s.ended = {
    reason, day: S.day, deadId: dead.id,
    name: fullName(dead), age: age(dead),
    style: endPlan?.style || styleOf(dead),
    seatName: endPlan?.seatName || null,
    dynasty: S.dynasties[dead.dynastyId]?.name || '—',
    usurperId: usurper?.id || null,
    usurperName: usurper ? fullName(usurper) : null,
    reignYears: Math.max(0, Math.round((S.day - s.reignStart) / YEAR)),
    reigns: s.reigns.slice(),
    generation: s.generation,
  };
  S.pendingPlayer = null;
  S.gameOver = true;
  S.chronicle.push({
    day: S.day, kind: 'end', tone: 'bad',
    text: reason === 'elected-away'
      ? `${fullName(dead)} öldü ve taç ${usurper ? fullName(usurper) : 'bir yabancıya'} gitti. ${s.ended.dynasty} hanedanının hükmü bitti.`
      : `${fullName(dead)} geriye kimseyi bırakmadan öldü. ${s.ended.dynasty} hanedanı sona erdi.`,
  });
  pause('death');
  emit('dynasty:extinct', s.ended);
}

// ---------------------------------------------------------------- readouts

/** Everyone who has pressed a claim on something you hold, with a name. */
export function claimantsOn(charId) {
  const out = [];
  for (const t of (ch(charId)?.titles || []).map(ti).filter(Boolean)) {
    for (const cl of t.claims || []) {
      const c = ch(cl.charId);
      if (!c || c.deathDay != null || c.id === charId) continue;
      out.push({ id: c.id, name: fullName(c), age: age(c), titleId: t.id, titleName: titleName(t), kind: cl.kind, day: cl.day });
    }
  }
  return out;
}

/** One honest sentence about what happens the day you die. */
export function successionLine(charId = S.playerId) {
  const p = successionPreview(charId);
  if (!p) return '';
  if (!p.heir) return 'Ardında kimse yok. Öldüğün gün hanedanın da ölür.';
  const h = p.heir;
  if (p.law === 'partition') {
    if (p.fragments > 1) return `Ülken ${p.fragments} parçaya bölünür. En büyük pay ${fullName(h)}'in.`;
    const kids = livingChildren(ch(charId)).length;
    if (kids > 1) return 'İkinci kontluğu aldığın gün ülken çocuklarının arasında bölünür.';
    if (kids === 1) return `Tek varisin ${fullName(h)}. İkinci bir çocuk ülkeni ikiye böler.`;
    return `Çocuğun yok. Her şey ${fullName(h)}'e kalır — şimdilik.`;
  }
  if (p.law === 'elective') {
    const t = electiveTally(charId);
    const lead = t[0];
    if (lead && lead.char.dynastyId !== ch(charId)?.dynastyId) return `Oylar ${fullName(lead.char)}'de — senin kanından değil.`;
    return lead ? `Vassalların şimdilik ${fullName(lead.char)}'i istiyor (${lead.votes} oy).` : 'Oy verecek kimse yok.';
  }
  if (p.law === 'seniority') return `Tahtı ${fullName(h)} alır — hanedanın en yaşlısı, ${age(h)} yaşında.`;
  return `Her şey ${fullName(h)}'e kalır. Diğerlerine hiçbir şey.`;
}

export { fmtDate };
