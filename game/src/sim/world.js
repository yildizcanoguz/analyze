// Bootstraps a world from map.json: provinces, dynasties, holders, a court around
// the player, and the liege chain that binds them.

import { S, rng, newId, setSeed, ch, ti, pv } from '../core/state.js';
import { makeCharacter, fullName, bear, remember } from './characters.js';
import { makeTitle, grantTitle, TIER, recomputeVassalage, primaryTitle } from './realm.js';
import { NAMES } from '../content/names.js';
import { YEAR } from '../core/date.js';
import { emit } from '../core/bus.js';

export let MAP = null;

export async function loadMap() {
  if (MAP) return MAP;
  const res = await fetch(new URL('../content/map.json', import.meta.url));
  MAP = await res.json();
  return MAP;
}

function dynastyFor(culture) {
  const pool = NAMES[culture]?.dyn || NAMES.turkish.dyn;
  const id = newId('dy');
  const d = { id, name: rng.pick(pool), culture, prestige: rng.int(0, 400), founded: S.day, members: [] };
  S.dynasties[id] = d;
  return d;
}

export async function generateWorld(seed = 1066) {
  setSeed(seed);
  const map = await loadMap();

  // provinces
  for (const p of map.provinces) {
    S.provinces[p.id] = {
      id: p.id, name: p.name, terrain: p.terrain, coastal: p.coastal,
      cx: p.cx, cy: p.cy, development: p.development, supply: p.supply,
      defense: p.defense, taxMult: p.taxMult, holdings: p.holdings,
      culture: p.culture, faith: p.faith, neighbors: p.neighbors,
      buildings: [], controlled: 1, unrest: 0, occupiedBy: null,
    };
  }

  // titles: counties -> duchies -> kingdoms -> empire
  for (const p of map.provinces) makeTitle({ id: `t_${p.id}`, name: p.name, tier: TIER.county, provinceId: p.id });
  for (const d of map.duchies) {
    makeTitle({ id: `t_${d.id}`, name: d.name, tier: TIER.duchy, dejureVassals: d.counties.map((c) => `t_${c}`) });
    for (const c of d.counties) ti(`t_${c}`).dejureLiege = `t_${d.id}`;
  }
  for (const k of map.kingdoms) {
    makeTitle({ id: `t_${k.id}`, name: k.name, tier: TIER.kingdom, dejureVassals: k.duchies.map((d) => `t_${d}`) });
    for (const d of k.duchies) ti(`t_${d}`).dejureLiege = `t_${k.id}`;
  }
  for (const e of map.empires) {
    makeTitle({ id: `t_${e.id}`, name: e.name, tier: TIER.empire, dejureVassals: e.kingdoms.map((k) => `t_${k}`) });
    for (const k of e.kingdoms) ti(`t_${k}`).dejureLiege = `t_${e.id}`;
  }

  // --- populate: one count per county, dukes over clusters, kings over those ---
  const counts = [];
  for (const p of map.provinces) {
    const dyn = dynastyFor(p.culture);
    const c = makeCharacter({ culture: p.culture, faith: p.faith, sex: rng.chance(0.88) ? 'm' : 'f', dynastyId: dyn.id, birthDay: -rng.int(20, 58) * YEAR });
    dyn.members.push(c.id);
    c.gold = rng.int(10, 90);
    c.prestige = rng.int(0, 500);
    c.piety = rng.int(0, 300);
    grantTitle(`t_${p.id}`, c.id, 'inherit');
    counts.push(c);
    giveFamily(c);
  }
  for (const d of map.duchies) {
    if (rng.chance(0.30)) continue;                     // some duchies stay unclaimed — a target
    const inside = d.counties.map((cid) => ti(`t_${cid}`)).filter(Boolean);
    const holder = rng.pick(inside).holderId;
    grantTitle(`t_${d.id}`, holder, 'inherit');
  }
  for (const k of map.kingdoms) {
    const dukes = k.duchies.map((dd) => ti(`t_${dd}`)).filter((t) => t.holderId);
    if (!dukes.length || rng.chance(0.34)) continue;
    grantTitle(`t_${k.id}`, rng.pick(dukes).holderId, 'inherit');
  }
  recomputeVassalage();

  // --- the player: a middling count with a duchy claim and a dangerous family ---
  const candidates = counts.filter((c) => c.culture === 'turkish' && !c.liegeId === false);
  const you = pickPlayer(candidates.length ? candidates : counts);
  S.playerId = you.id;
  you.gold = 120; you.prestige = 250; you.piety = 100;
  buildCourt(you);
  seedGrudges();

  S.chronicle.push({ day: S.day, kind: 'start', text: `${fullName(you)} — hikâye burada başlıyor.`, tone: 'neutral' });
  emit('world:ready');
  return S;
}

function pickPlayer(pool) {
  // Someone with something to lose and someone to fear: a brother, a strong liege.
  const scored = pool.map((c) => {
    const t = primaryTitle(c);
    let s = 0;
    if (t?.tier === TIER.county) s += 3;
    if (c.liegeId) s += 4;                     // having a liege means having a leash
    if (c.childrenIds.length) s += 2;
    s += rng.float(0, 3);
    return { c, s };
  }).sort((a, b) => b.s - a.s);
  return scored[0].c;
}

function giveFamily(c) {
  if (c.deathDay != null) return;
  const a = Math.abs(c.birthDay) / YEAR;
  if (a < 20) return;
  if (rng.chance(0.82)) {
    const sp = makeCharacter({ culture: c.culture, faith: c.faith, sex: c.sex === 'm' ? 'f' : 'm', birthDay: c.birthDay + rng.int(-6, 8) * YEAR });
    c.spouseId = sp.id; sp.spouseId = c.id; sp.liegeId = c.id; sp.courtOf = c.id;
    const n = rng.int(0, 4);
    for (let i = 0; i < n; i++) {
      const m = c.sex === 'f' ? c : sp, f = c.sex === 'm' ? c : sp;
      const kid = bear(m.id, f.id);
      if (kid) { kid.birthDay = c.birthDay + rng.int(20, Math.max(21, a - 1)) * YEAR; kid.courtOf = c.id; }
    }
  }
  if (rng.chance(0.55)) {
    const sib = makeCharacter({ culture: c.culture, faith: c.faith, dynastyId: c.dynastyId, sex: rng.chance(0.6) ? 'm' : 'f', birthDay: c.birthDay + rng.int(-10, 10) * YEAR, fatherId: c.fatherId, motherId: c.motherId });
    sib.courtOf = c.id; sib.liegeId = c.id;
    sib.isSibling = c.id;
  }
}

function buildCourt(you) {
  const roles = [
    { k: 'chancellor', skill: 'diplomacy' }, { k: 'marshal', skill: 'martial' },
    { k: 'steward', skill: 'stewardship' }, { k: 'spymaster', skill: 'intrigue' },
    { k: 'chaplain', skill: 'learning' },
  ];
  S.council = {};
  for (const r of roles) {
    const c = makeCharacter({ culture: rng.chance(0.7) ? you.culture : 'greek', skillMean: 8 });
    c.courtOf = you.id; c.liegeId = you.id;
    c.base[r.skill] += rng.int(3, 8);
    S.council[r.k] = c.id;
  }
  // a courtier who already hates you, and one who owes you
  const rival = makeCharacter({ culture: you.culture, skillMean: 9, traits: ['ambitious', 'deceitful'] });
  rival.courtOf = you.id; rival.liegeId = you.id;
  remember(rival.id, you.id, 'Hakkı olan makamı sana verdiler.', -35, 40);
  S.flags.rivalId = rival.id;
  const friend = makeCharacter({ culture: you.culture, skillMean: 7, traits: ['honest'] });
  friend.courtOf = you.id; friend.liegeId = you.id;
  remember(friend.id, you.id, 'Bir kış onu sofrana aldın.', +40, 60);
  S.flags.friendId = friend.id;
}

function seedGrudges() {
  // Give the world a memory before the player's first turn: old feuds make the
  // first decision land in an already-tense room.
  const ids = Object.keys(S.chars);
  for (let i = 0; i < ids.length / 6; i++) {
    const a = rng.pick(ids), b = rng.pick(ids);
    if (a === b) continue;
    const kind = rng.weighted([
      { w: 3, t: ['Baban onun babasını astırdı.', -45, 60] },
      { w: 4, t: ['Sınır köyünü yaktı.', -30, 30] },
      { w: 3, t: ['Kızını istedi, reddedildi.', -25, 35] },
      { w: 2, t: ['Bir kuşatmada yanında durdu.', +35, 40] },
      { w: 2, t: ['Fidyesini o ödedi.', +50, 50] },
    ]).t;
    remember(a, b, kind[0], kind[1], kind[2]);
  }
}
