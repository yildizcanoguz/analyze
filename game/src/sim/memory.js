// ===========================================================================
// P04 — YANKI & HAFIZA
// ---------------------------------------------------------------------------
// The ledger of things the world will not let you forget.
//
// A strategy game becomes a tragedy at exactly the moment a decision stops
// being a transaction and becomes a debt. That is this file's whole job:
//
//   1. WITNESS   — watch the bus and write down what actually happened, with
//                  names, dates, places and the option you chose.
//   2. RIPEN     — a memory does not fade here. It matures. A secret held for
//                  ten years is worth more to a blackmailer than a fresh one,
//                  and costs more to bury.
//   3. RECALL    — pull an old sin back up, weighted by how heavy it was, how
//                  old it is, and how recently the world last threw it at you,
//                  so the same wound is not reopened every winter.
//   4. ECHO      — turn that memory into a decision the player must answer,
//                  with the original date and the original name in the text.
//   5. SHOW      — hand the UI a pure, plain-JSON view of what is remembered.
//
// sim never imports ui/render. Everything leaves here as bus events, state, or
// return values.
// ===========================================================================

import { S, rng, newId, ch, ti, pv, alive, livingChars } from '../core/state.js';
import { on, emit } from '../core/bus.js';
import { YEAR, fmtDate, yearOf, seasonOf, ageAt } from '../core/date.js';
import { offer, STAKE } from './decision.js';
import {
  fullName, age, opinion, remember, kill, relation, isKin,
  livingChildren, childrenOf, skill, skills, makeCharacter, causeLabel, dread,
} from './characters.js';
import {
  primaryTitle, styleOf, titleName, directCountiesOf, countiesOf,
  grantTitle, vassalsOf, realmLevy, levyOf, incomeOf, TIER,
} from './realm.js';
import { ECHOES, ANNIVERSARY_LINES, GRUDGE_LINES, SECRET_WHISPERS, SECRET_LABEL, TR } from '../content/echoes.js';

// --- tuning ----------------------------------------------------------------
const ECHO_EVERY = 10;          // days between considering an echo at all
const ECHO_GAP = 420;           // days the world stays quiet between echoes
const ANNIV_GAP = 400;          // days between two anniversary murmurs
const MILESTONES = [3, 5, 10, 15, 20, 25, 30, 40];
const SECRET_TICK = 30;         // days between secret maturation rolls

/** Only these come back to haunt a date. A good day is not an anniversary. */
// note: 'kin' only means kin was *at stake*; losing them is 'grief'.
const DARK = ['blood', 'grief', 'denied_relief', 'humiliation', 'oath', 'scandal',
  'land_given', 'dungeon', 'blood_debt', 'betrayal', 'gave_relief', 'seized',
  'repression', 'twice', 'hostage', 'silenced', 'confession'];

/** How fast a kind of secret rots outward. Blood is loud; debt is quiet. */
const SECRET_GRAVITY = { murder: 1.35, kinslay: 1.6, poison: 1.4, oath: 0.9, bastard: 0.8, lie: 0.7, theft: 0.6 };

// ===========================================================================
// 0. Bookkeeping that lives on S (plain JSON, saves and loads with the world)
// ===========================================================================
function ledger() {
  if (!S.echoLog) S.echoLog = { lastAny: -99999, lastAnniv: -99999, lastSecret: -99999, byId: {}, fired: [], count: 0 };
  return S.echoLog;
}

/** Give an old or foreign memory row every field the rest of this file expects. */
function norm(m) {
  if (!m) return m;
  if (!Array.isArray(m.tags)) m.tags = [];
  if (!Array.isArray(m.echoes)) m.echoes = [];
  if (!Array.isArray(m.anniv)) m.anniv = [];
  if (m.recalls == null) m.recalls = 0;
  if (m.actorId === undefined) m.actorId = S.playerId;
  return m;
}
function allMemories() { return S.memories.map(norm); }

// ===========================================================================
// 1. WITNESS — the bus tells us what happened; we write it down properly
// ===========================================================================

// Keyword fingerprints. Option keys can be renamed by the writing piece; the
// prose is more stable than the code, so we read both.
const KEYWORDS = [
  ['granary', /ambar/],
  ['famine', /kıtlık|açlık|tohumluk/],
  ['physician', /hekim/],
  ['physician_dismissed', /hekimi (sen )?gönder/],
  ['poison', /şişe|zehir/],
  ['court', /divan/],
  ['humiliation', /küçük düş|herkesin önünde ez/],
  ['dungeon', /zindan|zincir/],
  ['fever', /ateş|hasta/],
  ['betrayal', /ihanet|yemin/],
  ['grain', /buğday/],
];

function tagsOfDecision(d) {
  const t = new Set(['decision']);
  if (d.kind) t.add('kind:' + d.kind);
  if (d.chosen) t.add('chose:' + d.chosen);
  for (const s of d.stakes || []) if (s?.kind) t.add('stake:' + s.kind);
  if (d.outcome?.beat) t.add('beat:' + String(d.outcome.beat).replace(/\s+/g, '_'));
  t.add(d.outcome?.success ? 'success' : 'failure');
  if (d.irreversible) t.add('irreversible');
  for (const c of d.paid || []) if (c?.kind === STAKE.GOLD && c.value > 0) t.add('paid_gold');

  // The most semantic text in the game is the label the player actually pressed.
  const opt = (d.options || []).find((o) => o.key === d.chosen);
  const hay = [d.title, d.framing, d.body, opt?.label, opt?.detail, d.outcome?.text, d.outcome?.title]
    .filter(Boolean).join(' ').toLowerCase();
  for (const [tag, re] of KEYWORDS) if (re.test(hay)) t.add(tag);

  // composites — what the deed *means*, not which button was pressed
  if (t.has('famine') || t.has('granary')) {
    if (t.has('chose:hold') || /kapalı tut/.test(hay)) t.add('denied_relief');
    if (t.has('chose:open') || /ambarları aç/.test(hay)) t.add('gave_relief');
  }
  if (t.has('chose:humiliate') || /küçük düş|herkesin önünde ez/.test(hay)) t.add('humiliation');
  if (t.has('chose:imprison') || /zindan|zincire vur/.test(hay)) t.add('dungeon');
  if (t.has('humiliation')) t.add('grudge');
  if (t.has('stake:oath')) t.add('oath');
  if (t.has('stake:kin')) t.add('kin');
  if (t.has('stake:secret')) t.add('secret');
  return [...t];
}

/**
 * Where on the map did this happen? Decisions carry a scene index; when the map
 * metadata is not around, fall back to the place the prose itself names —
 * an echo that cannot point at a province is only half a memory.
 */
function provinceOfDecision(d) {
  const idx = d.scene?.provinceIdx;
  const meta = idx == null ? null : S.mapMeta?.provinces?.[idx];
  if (meta?.id) return meta.id;
  const hay = `${d.title || ''} ${d.framing || ''}`;
  if (!hay.trim()) return null;
  let best = null;
  for (const prov of Object.values(S.provinces)) {
    if (prov.name && hay.includes(prov.name) && (!best || prov.name.length > best.name.length)) best = prov;
  }
  return best?.id || null;
}
export function provinceIdxOf(provinceId) {
  const i = (S.mapMeta?.provinces || []).findIndex((p) => p.id === provinceId);
  return i < 0 ? null : i;
}
export function sceneOf(charId) {
  const t = directCountiesOf(charId)[0];
  return t ? { provinceIdx: provinceIdxOf(t.provinceId) } : null;
}

/**
 * Write a line into the world's ledger by hand. Echoes use this so their own
 * consequences can be echoed again later — the ledger must be able to grow
 * out of itself, otherwise the game only remembers its first sin.
 */
export function imprint(o) {
  const m = norm({
    id: newId('m'),
    day: o.day ?? S.day,
    decisionId: o.decisionId || null,
    kind: o.kind || 'deed',
    title: o.title || '',
    text: o.text || o.title || '',
    success: o.success ?? true,
    weight: o.weight ?? 0.4,
    irreversible: !!o.irreversible,
    actorId: o.actorId ?? S.playerId,
    targetId: o.targetId || null,
    victimId: o.victimId || null,
    provinceId: o.provinceId || null,
    titleId: o.titleId || null,
    recalls: 0,
    tags: Array.from(new Set(o.tags || [])),
  });
  S.memories.push(m);
  return m;
}

let armed = false;
const deathQueue = [];

on('world:ready', () => { armed = true; ledger(); });

// -- a decision finished: fatten the row decision.js just wrote --------------
on('decision:resolved', (d) => {
  if (!armed || !d) return;
  const m = norm(S.memories.find((x) => x.decisionId === d.id));
  if (!m) return;
  m.tags = Array.from(new Set([...(m.tags || []), ...tagsOfDecision(d)]));
  m.actorId = S.playerId;
  m.provinceId = m.provinceId || provinceOfDecision(d);
  m.chosen = d.chosen || null;
  m.beat = d.outcome?.beat || null;
  if (d.outcome?.title) m.headline = d.outcome.title;
  // a cell has a date; remember it the moment the door shuts
  if (m.tags.includes('dungeon') && d.targetId && ch(d.targetId) && ch(d.targetId).imprisonedBy === S.playerId) {
    ch(d.targetId).imprisonedDay ??= S.day;
  }
  // A death that happened inside this decision belongs to this row.
  for (let i = deathQueue.length - 1; i >= 0; i--) {
    const q = deathQueue[i];
    if (q.day !== S.day) continue;
    if (q.killerId === S.playerId || q.id === d.targetId) {
      m.victimId = m.victimId || q.id;
      m.tags.push(q.killerId === S.playerId ? 'blood' : 'death');
      if (q.kinOfPlayer) m.tags.push('kin', 'grief');
      if (q.childOfPlayer) m.tags.push('child_lost');
      m.tags = Array.from(new Set(m.tags));
      deathQueue.splice(i, 1);
    }
  }
});

// -- somebody died: the ledger cares who, and by whose hand ------------------
on('char:died', ({ id, cause, killerId }) => {
  if (!armed) return;
  const c = ch(id);
  if (!c) return;
  const p = S.playerId;
  const childOfPlayer = c.fatherId === p || c.motherId === p;
  const kinOfPlayer = childOfPlayer || isKin(p, id);
  if (killerId !== p && !kinOfPlayer) return;   // the world is full of deaths; only some are yours
  deathQueue.push({ id, cause, killerId, day: S.day, childOfPlayer, kinOfPlayer, name: fullName(c), age: age(c) });
});

// -- land left your hands: that is permanent, so it is remembered ------------
const NOT_A_CHOICE = new Set(['inherit', 'escheat']);   // succession is not a gift
on('title:granted', ({ titleId, charId, prev, reason }) => {
  if (!armed) return;
  if (prev !== S.playerId || charId === S.playerId) return;
  if (NOT_A_CHOICE.has(reason)) return;
  const t = ti(titleId), taker = ch(charId);
  if (!t || !taker) return;
  imprint({
    kind: 'land', title: `${titleName(t)} el değiştirdi`,
    text: `${titleName(t)}'yi ${fullName(taker)}'e verdin.`,
    weight: 0.5, irreversible: true,
    targetId: charId, titleId, provinceId: t.provinceId || null,
    tags: ['land_given', 'irreversible', 'grudge_seed', reason ? 'reason:' + reason : 'reason:grant'],
  });
});

// ===========================================================================
// 2. RIPEN — memories mature; secrets rot outward
// ===========================================================================

export function yearsSince(day) { return Math.max(0, (S.day - day) / YEAR); }
export function wholeYearsSince(day) { return Math.floor(yearsSince(day)); }

const SEASON_TR = { winter: 'kışında', spring: 'baharında', summer: 'yazında', autumn: 'güzünde' };
/** "1071 kışında" — how people actually date an old wound. */
export function whenPhrase(day) { return `${yearOf(day)} ${SEASON_TR[seasonOf(day)]}`; }
/** "14 Ocak 1071" — how a clerk dates it. */
export function exactPhrase(day) { return fmtDate(day); }
export function agoPhrase(day) {
  const y = wholeYearsSince(day);
  if (y <= 0) {
    const mo = Math.max(1, Math.round((S.day - day) / 30));
    return `${mo} ay önce`;
  }
  return `${y} yıl önce`;
}
/** Whose hand was it — yours, or the one before you? The ledger outlives you. */
export function actorPhrase(m) {
  if (!m?.actorId || m.actorId === S.playerId) return 'sen';
  const a = ch(m.actorId);
  if (!a) return 'selefin';
  const r = relation(S.playerId, m.actorId);
  if (r === 'ebeveyn') return `baban ${fullName(a)}`;
  return `selefin ${fullName(a)}`;
}

/**
 * How hard this memory pulls right now.
 * Weight is the floor. Age is not decay — it is ripening: the first decade
 * makes a deed stranger and heavier, then it settles into something permanent.
 * Being dragged up recently is what quiets a memory, not time.
 */
export function memoryPull(m, day = S.day) {
  norm(m);
  const yrs = Math.max(0, (day - m.day) / YEAR);
  const base = Math.max(0.05, m.weight || 0.3);
  const ripeness = yrs < 1 ? 0.30 + yrs * 0.70 : 1 + Math.min(1.0, Math.log(1 + yrs) * 0.45);
  const fatigue = 1 / (1 + (m.recalls || 0) * 0.85);
  const rest = m.lastRecallDay == null ? 1 : Math.min(1, (day - m.lastRecallDay) / (3 * YEAR));
  const irr = m.irreversible ? 1.55 : 1;
  const blood = m.tags.includes('blood') || m.tags.includes('kin') ? 1.45 : 1;
  return Math.max(0.001, base * ripeness * fatigue * (0.25 + 0.75 * rest) * irr * blood);
}

/** Read-only query over the ledger. */
export function recall(pred = () => true) { return allMemories().filter(pred); }
/** Every memory carrying all of these tags. */
export function deeds(...tags) {
  return allMemories().filter((m) => tags.every((t) => m.tags.includes(t)));
}

/**
 * Pull one memory back up, weighted. The same wound does not reopen every
 * winter: each recall makes the next one less likely, and a memory needs
 * roughly three years of quiet to regain its full pull.
 */
export function recallMemory(pred = () => true, opts = {}) {
  const hits = recall(typeof pred === 'function' ? pred : () => true)
    .filter((m) => !opts.minYears || yearsSince(m.day) >= opts.minYears)
    .filter((m) => !opts.exclude || !opts.exclude.includes(m.id));
  if (!hits.length) return null;
  const m = rng.weighted(hits, (x) => memoryPull(x));
  if (!m) return null;
  m.recalls++;
  m.lastRecallDay = S.day;
  return m;
}
/** Peek without spending the memory's freshness — for UI and for echo search. */
export function heaviestMemory(pred = () => true) {
  const hits = recall(pred);
  if (!hits.length) return null;
  return hits.reduce((a, b) => (memoryPull(b) > memoryPull(a) ? b : a));
}

// --- secrets ---------------------------------------------------------------
function prepSecret(s) {
  if (s.exposure == null) s.exposure = 0;
  if (!Array.isArray(s.knownBy)) s.knownBy = [];
  if (s.buried == null) s.buried = false;
  if (!s.id) s.id = newId('sec');
  return s;
}
export function secretsOf(charId = S.playerId) { return (ch(charId)?.secrets || []).map(prepSecret); }
export function secretAge(s) { return yearsSince(s.day); }

/**
 * The core promise of this piece: a secret does not get safer with time.
 * Every year it leaks a little further, and every person who already knows
 * doubles the leak. Ten years of silence is not ten years of safety — it is
 * ten years of interest accruing.
 */
export function secretPressure(s) {
  const yrs = secretAge(s);
  const g = SECRET_GRAVITY[s.kind] ?? 1;
  return g * (0.08 + yrs * 0.05 + Math.pow(yrs, 1.4) * 0.004) * (1 + s.knownBy.length * 0.6);
}
/**
 * What silence costs today. Waiting makes it dearer, never cheaper — a secret
 * held twenty years costs roughly twice what it would have cost at ten.
 */
export function secretPrice(s) {
  const yrs = secretAge(s);
  const g = SECRET_GRAVITY[s.kind] ?? 1;
  return Math.round((30 + yrs * 11 + Math.pow(yrs, 1.5) * 1.6) * g * (1 + (s.paidTimes || 0) * 0.6));
}
export function secretLabel(s) { return SECRET_LABEL[s.kind] || 'bir sır'; }

/** Secrets ripen on their own schedule, whether you look at them or not. */
function ripenSecrets(day) {
  const L = ledger();
  if (day - L.lastSecret < SECRET_TICK) return;
  L.lastSecret = day;
  const p = ch(S.playerId);
  if (!p) return;
  for (const s of secretsOf(S.playerId)) {
    if (s.buried) continue;
    const pressure = secretPressure(s);
    s.exposure = Math.min(1, s.exposure + pressure * 0.05);
    // Someone new works it out. Not the world — one named person.
    if (rng.chance(pressure * 0.020)) {
      const cand = livingChars().filter((c) => c.id !== S.playerId && !s.knownBy.includes(c.id) &&
        (c.courtOf === S.playerId || c.liegeId === S.playerId || opinion(c.id, S.playerId) < -20));
      if (cand.length) {
        const who = rng.weighted(cand, (c) => Math.max(1, 40 - opinion(c.id, S.playerId)) + skill(c, 'intrigue'));
        s.knownBy.push(who.id);
        (who.knownSecrets ||= []).push(s.id);
        (who.hooks ||= []).push({ onId: S.playerId, kind: s.knownBy.length > 1 ? 'weak' : 'strong', secretId: s.id });
        const line = pick(SECRET_WHISPERS)(fullName(who), secretLabel(s), wholeYearsSince(s.day));
        murmur(line, 'bad', { kind: 'secret', secretId: s.id, charId: who.id });
      }
    }
  }
}

// ===========================================================================
// 3. The world says it out loud — anniversaries and murmurs
// ===========================================================================

function pick(arr) { return arr[Math.floor(rng.next() * arr.length)] ?? arr[0]; }

/** One channel out of this file: chronicle row + a bus event the UI can whisper. */
export function murmur(text, tone = 'ambiguous', extra = {}) {
  if (!text) return;
  S.chronicle.push({ day: S.day, kind: 'echo', text, tone, ...extra });
  emit('memory:echo', { day: S.day, text, tone, ...extra });
}

/** A row nobody could name is not a memory; it is a stray write. */
function hasSubstance(m) {
  return !!((m.headline && m.headline.trim()) || (m.title && m.title.trim()) || (m.text && m.text.trim()));
}
/** Would a person still flinch at this date? Good days do not get anniversaries. */
function isDark(m) {
  if (!hasSubstance(m)) return false;
  if (!m.tags.some((t) => DARK.includes(t))) return false;
  return m.irreversible || m.success === false || (m.weight || 0) >= 0.5;
}

/**
 * The quiet half of this piece. Big echoes are rare by design; this is what
 * makes the world feel like it is keeping count in between them. It is rare
 * too — roughly once a year, always about something that actually cost you.
 */
function anniversaries(day) {
  const L = ledger();
  if (day - L.lastAnniv < ANNIV_GAP) return;
  const due = [];
  for (const m of allMemories()) {
    if (!isDark(m)) continue;
    const yrs = Math.round((day - m.day) / YEAR);
    if (yrs <= 0 || !MILESTONES.includes(yrs)) continue;
    if (Math.abs(day - (m.day + yrs * YEAR)) > 4) continue;
    if (m.anniv.includes(yrs)) continue;
    due.push({ m, yrs });
  }
  if (!due.length) return;
  // the heaviest debt gets the day
  const { m, yrs } = due.reduce((a, b) => (memoryPull(b.m) > memoryPull(a.m) ? b : a));
  m.anniv.push(yrs);
  L.lastAnniv = day;

  // The wronged do not merely remember; the vengeful renew. A grudge that gets
  // told again on its anniversary starts its decay over.
  const holder = m.targetId && alive(m.targetId) ? ch(m.targetId) : null;
  if (holder && holder.traits?.includes('vengeful') && holder.memoriesOf?.[S.playerId]?.length) {
    const list = holder.memoriesOf[S.playerId];
    const g = list[list.length - 1];
    g.day = Math.min(day, g.day + Math.round(yrs * YEAR * 0.5));
    murmur(pick(GRUDGE_LINES)(fullName(holder), yrs, g.text), 'bad', { memoryId: m.id, years: yrs, charId: holder.id });
    return;
  }
  const p = ch(S.playerId);
  if (p && (m.tags.includes('grief') || m.tags.includes('blood'))) p.stress += 4;
  murmur(annivLine(m, yrs), m.tags.includes('gave_relief') ? 'good' : 'bad', { memoryId: m.id, years: yrs });
}

function annivLine(m, yrs) {
  const who = m.victimId && ch(m.victimId) ? fullName(ch(m.victimId))
    : (m.targetId && ch(m.targetId) ? fullName(ch(m.targetId)) : null);
  const place = m.provinceId && pv(m.provinceId) ? pv(m.provinceId).name : null;
  const ctx = {
    yrs, when: whenPhrase(m.day), exact: exactPhrase(m.day),
    title: m.headline || m.title || (m.text || '').split('\n')[0],
    who, whoAcc: who ? TR.acc(who) : null, whoGen: who ? TR.gen(who) : null, whoDat: who ? TR.dat(who) : null,
    place, placeLoc: place ? TR.loc(place) : null, placeAbl: place ? TR.abl(place) : null,
    doer: actorPhrase(m),
  };
  const bag = ANNIVERSARY_LINES
    .filter((l) => !l.needs || l.needs.every((t) => m.tags.includes(t)))
    .filter((l) => !l.wants || l.wants.every((k) => ctx[k]));
  const chosen = bag.length ? rng.weighted(bag, (l) => (l.needs ? 4 : 1)) : ANNIVERSARY_LINES[ANNIVERSARY_LINES.length - 1];
  return chosen.line(ctx);
}

// ===========================================================================
// 4. ECHO — the ledger becomes a decision
// ===========================================================================

let firingEcho = null;

/** The api handed to content/echoes.js. Content never imports sim directly. */
const API = {
  // world
  S, rng, ch, ti, pv, alive, livingChars,
  player: () => ch(S.playerId),
  // people
  fullName, age, ageAt, opinion, remember, kill, relation, isKin,
  livingChildren, childrenOf, skill, skills, makeCharacter, causeLabel, dread,
  // realm
  primaryTitle, styleOf, titleName, directCountiesOf, countiesOf,
  grantTitle, vassalsOf, realmLevy, levyOf, incomeOf, TIER,
  // time and phrasing
  YEAR, fmtDate, yearOf, seasonOf,
  whenPhrase, exactPhrase, agoPhrase, actorPhrase, yearsSince, wholeYearsSince,
  // the ledger itself
  deeds, recall, recallMemory, heaviestMemory, memoryPull, imprint, murmur,
  secretsOf, secretAge, secretPressure, secretPrice, secretLabel,
  provinceIdxOf, sceneOf, STAKE, TR,
  /** offer() wrapped so every echo decision is filed back against its memory. */
  offer(spec) {
    const d = offer(spec);
    if (d && firingEcho) {
      const L = ledger();
      L.fired.push({ day: S.day, echo: firingEcho.echoId, decisionId: d.id, memoryId: firingEcho.memoryId || null });
      if (L.fired.length > 60) L.fired.splice(0, L.fired.length - 60);
      const src = firingEcho.memory;
      if (src) { norm(src); if (!src.echoes.includes(firingEcho.echoId)) src.echoes.push(firingEcho.echoId); }
    }
    return d;
  },
};

function considerEchoes(day) {
  // Invariant: one open decision at a time. An echo waits its turn — and it
  // also waits out a heavy wait, because two weights at once is half of each.
  if (S.decisions.some((d) => d.state === 'open')) return;
  if (S.decisions.some((d) => d.state === 'pending' && d.weight > 0.55)) return;
  const L = ledger();
  if (day - L.lastAny < ECHO_GAP) return;

  const pool = [];
  for (const e of ECHOES) {
    const last = L.byId[e.id] ?? -99999;
    if (day - last < (e.cooldown ?? 14 * YEAR)) continue;
    let ctx = null;
    try { ctx = e.find(API, day); } catch (err) { console.error('[echo:find]', e.id, err); }
    if (!ctx) continue;
    const src = ctx.memory || null;
    if (src && Array.isArray(src.echoes) && src.echoes.includes(e.id)) continue;  // one memory, one echo of a kind
    // A debt the world has already collected on twice is less interesting than
    // one it has never touched. Variety is what keeps a memory system from
    // becoming a single recurring bill.
    const used = (L.fired || []).filter((f) => f.echo === e.id).length;
    pool.push({
      e, ctx,
      w: (e.weightHint ?? 0.6) * 10 * (src ? Math.min(3, memoryPull(src)) : 1) / (1 + used * 0.8),
    });
  }
  if (!pool.length) return;
  const p = rng.weighted(pool);
  if (!rng.chance(p.e.chance ?? 0.6)) return;

  L.byId[p.e.id] = day;
  L.lastAny = day;
  L.count++;
  if (p.ctx.memory) { norm(p.ctx.memory); p.ctx.memory.recalls++; p.ctx.memory.lastRecallDay = day; }
  firingEcho = { echoId: p.e.id, memory: p.ctx.memory || null, memoryId: p.ctx.memory?.id || null };
  try { p.e.fire(p.ctx, API, day); }
  catch (err) { console.error('[echo:fire]', p.e.id, err); }
  finally { firingEcho = null; }
}

/** Someone else's system may put a man in your cells; the ledger dates it anyway. */
function notePrisoners(day) {
  for (const c of Object.values(S.chars)) {
    if (c.imprisonedBy === S.playerId && c.deathDay == null && c.imprisonedDay == null) c.imprisonedDay = day;
  }
}

/**
 * Deaths that no decision claimed still belong in the ledger — a child who
 * simply died of a fever is the heaviest row a house ever writes.
 */
function drainDeaths(day) {
  while (deathQueue.length) {
    const q = deathQueue.shift();
    if (day - q.day > 2) continue;                       // stale; a decision took it
    if (S.memories.some((m) => m.victimId === q.id)) continue;
    const tags = ['death'];
    if (q.killerId === S.playerId) tags.push('blood');
    if (q.kinOfPlayer) tags.push('kin', 'grief');
    if (q.childOfPlayer) tags.push('child_lost');
    imprint({
      day: q.day, kind: q.childOfPlayer ? 'grief' : 'death',
      title: `${q.name} öldü`,
      text: `${q.name} ${exactPhrase(q.day)} günü öldü — ${causeLabel(q.cause)}. ${q.age < 1 ? 'Daha kundaktaydı.' : `${q.age} yaşındaydı.`}`,
      weight: q.childOfPlayer ? 0.8 : q.killerId === S.playerId ? 0.75 : 0.5,
      irreversible: true, success: false,
      victimId: q.id, targetId: q.id, tags,
    });
  }
}

/** Called every day by sim/tick.js. Cheap on most of them. */
export function tickEchoes(day) {
  if (!armed || !S.playerId) return;
  drainDeaths(day);
  if (day % 30 === 0) notePrisoners(day);
  ripenSecrets(day);
  anniversaries(day);
  if (day % ECHO_EVERY !== 0) return;
  considerEchoes(day);
}

// ===========================================================================
// 5. SHOW — pure views for the UI. No DOM, no mutation, plain JSON out.
// ===========================================================================

/** A hanging is never "good news", whatever the outcome flag says. */
function toneOf(m) {
  if (m.tags.some((t) => ['blood', 'grief', 'scandal', 'humiliation', 'denied_relief', 'betrayal'].includes(t))) return 'bad';
  if (m.success === false) return 'bad';
  if (m.irreversible || m.tags.some((t) => ['stake:life', 'stake:kin', 'stake:soul', 'stake:oath'].includes(t))) return 'ambiguous';
  return m.success === true ? 'good' : 'ambiguous';
}

/**
 * What is remembered about someone.
 * For the player: the ledger of their own deeds, heaviest debt first — that is
 * what the world will actually reach for. Pass {order:'recent'} for a timeline.
 * For anyone else: what they hold against you, plus what the world records
 * about them.
 * Returns [{id, day, when, exact, ago, text, tone, weight, pull, delta,
 *           irreversible, kind, source}] — safe to render directly.
 */
export function memoryLines(charId, opts = {}) {
  const limit = opts.limit ?? 8;
  const order = opts.order || (charId === S.playerId ? 'heavy' : 'recent');
  const p = S.playerId;
  const out = [];
  if (!charId) return out;

  if (charId === p) {
    for (const m of allMemories()) {
      if (!hasSubstance(m)) continue;
      out.push({
        id: m.id, day: m.day, when: whenPhrase(m.day), exact: exactPhrase(m.day), ago: agoPhrase(m.day),
        text: m.headline || m.title || m.text || '—',
        detail: firstLine(m.text),
        tone: toneOf(m),
        weight: m.weight || 0, pull: Math.round(memoryPull(m) * 100) / 100,
        delta: null, irreversible: !!m.irreversible,
        kind: m.kind || 'deed', source: 'ledger',
        who: m.victimId && ch(m.victimId) ? fullName(ch(m.victimId)) : (m.targetId && ch(m.targetId) ? fullName(ch(m.targetId)) : null),
        place: m.provinceId && pv(m.provinceId) ? pv(m.provinceId).name : null,
        recalls: m.recalls || 0,
      });
    }
  } else {
    const c = ch(charId);
    for (const r of (c?.memoriesOf?.[p] || [])) {
      const yrs = yearsSince(r.day);
      const live = r.delta * Math.max(0, 1 - yrs / (r.life || 25));
      out.push({
        id: `${charId}:${r.day}`, day: r.day, when: whenPhrase(r.day), exact: exactPhrase(r.day), ago: agoPhrase(r.day),
        text: r.text, detail: null,
        tone: r.delta < 0 ? 'bad' : 'good',
        weight: Math.min(1, Math.abs(r.delta) / 60), delta: Math.round(live), raw: r.delta,
        irreversible: false, kind: 'grudge', source: 'personal', who: null, place: null,
        faded: Math.abs(live) < Math.abs(r.delta) * 0.4,
      });
    }
    for (const m of allMemories()) {
      if (m.targetId !== charId && m.victimId !== charId) continue;
      out.push({
        id: m.id, day: m.day, when: whenPhrase(m.day), exact: exactPhrase(m.day), ago: agoPhrase(m.day),
        text: m.headline || m.title || m.text || '—', detail: firstLine(m.text),
        tone: toneOf(m),
        weight: m.weight || 0, pull: Math.round(memoryPull(m) * 100) / 100,
        delta: null, irreversible: !!m.irreversible,
        kind: m.kind || 'deed', source: 'ledger',
        who: null, place: m.provinceId && pv(m.provinceId) ? pv(m.provinceId).name : null,
      });
    }
  }
  out.sort(order === 'heavy'
    ? (a, b) => (b.pull ?? b.weight ?? 0) - (a.pull ?? a.weight ?? 0) || b.day - a.day
    : (a, b) => b.day - a.day);
  return limit > 0 ? out.slice(0, limit) : out;
}
function firstLine(t) { return t ? String(t).split('\n')[0] : null; }

/** One-glance summary of what the world is holding over you. */
export function memorySummary(charId = S.playerId) {
  const all = allMemories();
  const secs = secretsOf(charId);
  const blood = all.filter((m) => m.tags.includes('blood'));
  const oldest = all.length ? all.reduce((a, b) => (a.day < b.day ? a : b)) : null;
  return {
    total: all.length,
    irreversible: all.filter((m) => m.irreversible).length,
    blood: blood.length,
    grief: all.filter((m) => m.tags.includes('grief')).length,
    secrets: secs.filter((s) => !s.buried).length,
    exposedSecrets: secs.filter((s) => s.knownBy.length > 0 && !s.buried).length,
    heaviestSecret: secs.length ? secs.reduce((a, b) => (secretPressure(b) > secretPressure(a) ? b : a)) : null,
    oldest: oldest ? { id: oldest.id, day: oldest.day, when: whenPhrase(oldest.day), text: oldest.headline || oldest.title } : null,
    echoesFired: ledger().count,
  };
}

/** What the player's own secrets look like from the inside. Pure. */
export function secretLines(charId = S.playerId) {
  return secretsOf(charId).filter((s) => !s.buried).map((s) => ({
    id: s.id, kind: s.kind, day: s.day, when: whenPhrase(s.day), ago: agoPhrase(s.day),
    label: secretLabel(s),
    victim: s.victimId && ch(s.victimId) ? fullName(ch(s.victimId)) : null,
    years: wholeYearsSince(s.day),
    pressure: Math.round(secretPressure(s) * 100) / 100,
    price: secretPrice(s),
    knownBy: s.knownBy.map((id) => ch(id)).filter(Boolean).map((c) => ({ id: c.id, name: fullName(c) })),
    tone: s.knownBy.length ? 'bad' : 'ambiguous',
  }));
}

/** Debug/inspection handle — the harness reads this to prove echoes fired. */
export function echoLog() { return ledger(); }

/**
 * The exact surface content/echoes.js is written against. Exported so tools can
 * exercise every echo without waiting for the world to produce its conditions.
 */
export function echoApi() { return API; }

/** Fire one echo by id if its conditions are met. Returns the decision or null. */
export function forceEcho(echoId, day = S.day) {
  const e = ECHOES.find((x) => x.id === echoId);
  if (!e) return null;
  const ctx = e.find(API, day);
  if (!ctx) return null;
  firingEcho = { echoId: e.id, memory: ctx.memory || null, memoryId: ctx.memory?.id || null };
  try { e.fire(ctx, API, day); } finally { firingEcho = null; }
  return S.decisions[S.decisions.length - 1] || null;
}
