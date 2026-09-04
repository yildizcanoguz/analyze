// The world. One mutable object, owned here, read everywhere, written only
// through sim modules. Kept plain-JSON-serializable so save/load is trivial and
// so the "no undo" rule has exactly one enforcement point.

import { Rng } from './rng.js';

export const S = {
  version: 3,
  seed: 0,
  day: 0,
  speed: 2,            // 0 paused, 1..5
  paused: true,
  playerId: null,

  chars: {},           // id -> Character
  dynasties: {},       // id -> Dynasty
  titles: {},          // id -> Title
  provinces: {},       // id -> Province

  schemes: [],         // active intrigue
  wars: [],
  councilTasks: [],
  factions: [],

  decisions: [],       // queued/committed decisions awaiting resolution  (tension spine)
  inbox: [],           // resolved outcomes waiting to be shown
  memories: [],        // durable consequence ledger — the world remembers
  chronicle: [],       // player-facing history log

  ui: { mapMode: 'realm', selected: null, focus: null },
  flags: {},
  stats: { decisionsMade: 0, irreversible: 0, kin_lost: 0, oaths_broken: 0 },
};

export let rng = new Rng(1);

let nextId = 1;
export function newId(prefix = 'c') { return `${prefix}${nextId++}`; }
export function idCursor() { return nextId; }
export function setIdCursor(n) { nextId = n; }

export function setSeed(seed) { S.seed = seed >>> 0; rng = new Rng(S.seed); }
export function setRng(r) { rng = r; }

// ---- accessors ------------------------------------------------------------
export const ch = (id) => S.chars[id];
export const ti = (id) => S.titles[id];
export const pv = (id) => S.provinces[id];
export const dy = (id) => S.dynasties[id];
export const player = () => S.chars[S.playerId];
export const alive = (id) => { const c = S.chars[id]; return !!c && c.deathDay == null; };
export function livingChars() { return Object.values(S.chars).filter((c) => c.deathDay == null); }

export function serialize() {
  return JSON.stringify({ s: S, rng: rng.serialize(), idc: nextId });
}
export function deserialize(json) {
  const o = JSON.parse(json);
  Object.keys(S).forEach((k) => delete S[k]);
  Object.assign(S, o.s);
  rng = Rng.restore(o.rng);
  nextId = o.idc;
}
