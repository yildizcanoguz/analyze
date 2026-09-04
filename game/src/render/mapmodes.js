// Map modes. Each one is a different question you can ask the land.
import { setPalette, M } from './mapmesh.js';
import { S, ch, ti, pv } from '../core/state.js';
import { topLiege, realmOf, primaryTitle } from '../sim/realm.js';
import { opinion } from '../sim/characters.js';
import { hashStr } from '../core/rng.js';

// Realm colours come from a curated wheel rather than a hash of the id: a hash
// happily hands two neighbouring realms the same muddy olive, and a political
// map you cannot read politically is not a political map.
//
// Hues walk the golden angle so successive realms land far apart on the wheel,
// and lightness alternates in three bands so even a hue collision separates by
// value. Saturation stays high enough to survive being blended with terrain.
const cache = new Map();
let issued = 0;
const GOLDEN = 0.61803398875;
const LIGHT_BANDS = [0.38, 0.52, 0.64];
const SAT_BANDS = [0.62, 0.54, 0.58];

function colorForKey(key, sat = null, light = null) {
  if (cache.has(key)) return cache.get(key);
  const n = issued++;
  // start the walk from the key so a given realm keeps its colour across reloads
  const h = ((hashStr(String(key)) % 1000) / 1000 * 0.15 + n * GOLDEN) % 1;
  const band = n % 3;
  const c = hsl(h, sat ?? SAT_BANDS[band], light ?? LIGHT_BANDS[band]);
  cache.set(key, c);
  return c;
}
export function resetPalette() { cache.clear(); issued = 0; }

const CULTURE_COL = { turkish:{r:.62,g:.34,b:.20,a:1}, greek:{r:.36,g:.30,b:.58,a:1}, armenian:{r:.72,g:.55,b:.20,a:1}, kurdish:{r:.30,g:.48,b:.34,a:1}, bulgar:{r:.55,g:.24,b:.32,a:1} };
const FAITH_COL   = { sunni:{r:.20,g:.48,b:.36,a:1}, orthodox:{r:.30,g:.34,b:.62,a:1}, miaphysite:{r:.62,g:.42,b:.22,a:1}, catholic:{r:.66,g:.62,b:.32,a:1} };
const TERRAIN_COL = { plains:{r:.45,g:.55,b:.28,a:1}, steppe:{r:.62,g:.58,b:.32,a:1}, forest:{r:.20,g:.36,b:.20,a:1}, hills:{r:.44,g:.42,b:.28,a:1}, mountains:{r:.48,g:.46,b:.44,a:1}, drylands:{r:.66,g:.53,b:.32,a:1}, desert:{r:.82,g:.72,b:.46,a:1} };

export const MODES = {
  realm: { label:'Devletler', key:'1', color(p) {
      const t = ti(`t_${p.id}`);
      if (!t?.holderId) return { r:.30,g:.29,b:.27,a:.85 };   // nobody's land
      const top = topLiege(t.holderId);
      // Your own realm is the one colour on the map that is not up for debate.
      if (top === topLiege(S.playerId)) return { r: .95, g: .72, b: .26, a: 1 };
      // Your liege's realm sits next to yours and must not be confused with it.
      const me = ch(S.playerId);
      if (me?.liegeId && top === topLiege(me.liegeId)) return { r: .60, g: .26, b: .24, a: 1 };
      return colorForKey(top);
    } },
  vassal: { label:'Tebaa', key:'2', color(p) {
      const t = ti(`t_${p.id}`);
      if (!t?.holderId) return { r:.4,g:.4,b:.4,a:.4 };
      return colorForKey(t.holderId, 0.40, 0.48);
    } },
  culture: { label:'Kültür', key:'3', color(p) { return CULTURE_COL[p.culture] || { r:.5,g:.5,b:.5,a:1 }; } },
  faith: { label:'İnanç', key:'4', color(p) { return FAITH_COL[p.faith] || { r:.5,g:.5,b:.5,a:1 }; } },
  terrain: { label:'Arazi', key:'5', color(p) { return TERRAIN_COL[p.terrain] || { r:.5,g:.5,b:.5,a:1 }; } },
  development: { label:'Kalkınma', key:'6', color(p) {
      const t = Math.min(1, (p.development || 0) / 18);
      return { r: 0.18 + t * 0.72, g: 0.14 + t * 0.60, b: 0.22 - t * 0.10, a: 1 };
    } },
  opinion: { label:'Sadakat', key:'7', color(p) {
      const t = ti(`t_${p.id}`);
      if (!t?.holderId) return { r:.4,g:.4,b:.4,a:.4 };
      const o = opinion(t.holderId, S.playerId);
      const n = (o + 100) / 200;
      return { r: 0.85 - n * 0.65, g: 0.16 + n * 0.66, b: 0.20, a: 1 };
    } },
};

export function applyMapMode(mode) {
  const m = MODES[mode] || MODES.realm;
  const provState = S.provinces;
  setPalette((mp) => {
    const p = provState[mp.id] || mp;
    // occupied land bleeds through in every mode — war should be visible always
    const c = m.color(p);
    if (p.occupiedBy) return { r: c.r * 0.45 + 0.42, g: c.g * 0.35, b: c.b * 0.35, a: 1 };
    return c;
  });
  S.ui.mapMode = mode;
}
