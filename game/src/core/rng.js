// Deterministic RNG. Every random draw in the game flows through here so that a
// seed + a day number reproduces the same world exactly. No Math.random anywhere
// in sim code — that is what makes the "no save-scum" promise honest.

export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A named, reproducible stream. Two calls with the same key give the same value. */
export function streamed(seed, key) {
  return mulberry32((seed ^ hashStr(String(key))) >>> 0);
}

export class Rng {
  constructor(seed) { this.seed = seed >>> 0; this._f = mulberry32(this.seed); this.draws = 0; }
  next() { this.draws++; return this._f(); }
  float(a = 0, b = 1) { return a + this.next() * (b - a); }
  int(a, b) { return Math.floor(this.float(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** Weighted pick. items: [{w, ...}] */
  weighted(items, wf = (i) => i.w) {
    let total = 0; for (const it of items) total += Math.max(0, wf(it));
    if (total <= 0) return items[0];
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, wf(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  /** Gaussian-ish, for stat generation. */
  normal(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  serialize() { return { seed: this.seed, draws: this.draws }; }
  static restore(o) { const r = new Rng(o.seed); for (let i = 0; i < o.draws; i++) r.next(); return r; }
}
