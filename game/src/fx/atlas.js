// ---------------------------------------------------------------------------
// fx/atlas.js — procedural sprite + decal atlases.  Owner: `fx`.
//
// Nothing here is downloaded: every texel is computed from noise + analytic
// shapes at init time and uploaded as a DataTexture.
//
// PARTICLE ATLAS  (8 cols x 4 rows)
//   tiles 0..15  smoke flipbook (a real 16-frame evolving simulation-ish puff,
//                lit with a marched self-shadow term so it has internal form)
//   tile 16..31  dust, spark streak, glow, flame, chip, splinter, shard, leaf,
//                blood droplet, blood mist, shockwave ring, ripple, ember,
//                water droplet, star flare, soft radial
//   RGB = a straight *linear colour multiplier* (so the shader stays one path)
//   A   = coverage / density
//
// DECAL ATLAS  (4 cols x 4 rows)
//   R = darkening amount   (multiply pass)
//   G = lit-detail amount  (crushed rim / torn metal lip / bright crack)
//   B = height             (4-tap derivative -> tangent normal in the lit pass)
//   A = coverage
// ---------------------------------------------------------------------------

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// noise
// ---------------------------------------------------------------------------

const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 0x9e3779b9 >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function fadeC(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function smoothstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

function h3(x, y, z) {
  return PERM[(PERM[(PERM[x & 255] + y) & 255] + z) & 255] * (1 / 255);
}

function vnoise3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const fx = fadeC(x - X), fy = fadeC(y - Y), fz = fadeC(z - Z);
  const c000 = h3(X, Y, Z), c100 = h3(X + 1, Y, Z);
  const c010 = h3(X, Y + 1, Z), c110 = h3(X + 1, Y + 1, Z);
  const c001 = h3(X, Y, Z + 1), c101 = h3(X + 1, Y, Z + 1);
  const c011 = h3(X, Y + 1, Z + 1), c111 = h3(X + 1, Y + 1, Z + 1);
  return lerp(
    lerp(lerp(c000, c100, fx), lerp(c010, c110, fx), fy),
    lerp(lerp(c001, c101, fx), lerp(c011, c111, fx), fy), fz);
}

function fbm3(x, y, z, oct) {
  let a = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * vnoise3(x, y, z);
    norm += a;
    a *= 0.5; x *= 2.02; y *= 2.02; z *= 1.93;
  }
  return sum / norm;
}

function vnoise2(x, y) { return vnoise3(x, y, 0.5); }
function fbm2(x, y, oct) { return fbm3(x, y, 0.5, oct); }

// ---------------------------------------------------------------------------
// tile plotting helpers
// ---------------------------------------------------------------------------

class Tile {
  constructor(data, atlasW, size, col, row) {
    this.d = data; this.W = atlasW; this.T = size;
    this.ox = col * size; this.oy = row * size;
  }
  // x,y in tile pixels; rgba in 0..1
  set(x, y, r, g, b, a) {
    const i = ((this.oy + y) * this.W + (this.ox + x)) * 4;
    const d = this.d;
    d[i] = r < 0 ? 0 : r > 1 ? 255 : (r * 255) | 0;
    d[i + 1] = g < 0 ? 0 : g > 1 ? 255 : (g * 255) | 0;
    d[i + 2] = b < 0 ? 0 : b > 1 ? 255 : (b * 255) | 0;
    d[i + 3] = a < 0 ? 0 : a > 1 ? 255 : (a * 255) | 0;
  }
  add(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.T || y >= this.T) return;
    const i = ((this.oy + y) * this.W + (this.ox + x)) * 4;
    const d = this.d;
    d[i] = Math.min(255, d[i] + r * 255);
    d[i + 1] = Math.min(255, d[i + 1] + g * 255);
    d[i + 2] = Math.min(255, d[i + 2] + b * 255);
    d[i + 3] = Math.min(255, d[i + 3] + a * 255);
  }
  clear() {
    for (let y = 0; y < this.T; y++) {
      const row = ((this.oy + y) * this.W + this.ox) * 4;
      this.d.fill(0, row, row + this.T * 4);
    }
  }
}

// bilinear sample of a square Float32Array field
function sampleField(f, R, u, v) {
  let x = u * (R - 1), y = v * (R - 1);
  if (x < 0) x = 0; else if (x > R - 1) x = R - 1;
  if (y < 0) y = 0; else if (y > R - 1) y = R - 1;
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 + 1 < R ? x0 + 1 : x0, y1 = y0 + 1 < R ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  const a = f[y0 * R + x0], b = f[y0 * R + x1];
  const c = f[y1 * R + x0], d = f[y1 * R + x1];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

// ---------------------------------------------------------------------------
// particle atlas
// ---------------------------------------------------------------------------

export const PCOLS = 8;
export const PROWS = 4;

export const TILE = {
  SMOKE: 0, SMOKE_FRAMES: 16,
  DUST: 16, SPARK: 17, GLOW: 18, FLAME: 19,
  CHIP: 20, SPLINTER: 21, SHARD: 22, LEAF: 23,
  DROPLET: 24, MIST: 25, RING: 26, RIPPLE: 27,
  EMBER: 28, WATER: 29, FLARE: 30, SOFT: 31,
};

// smoke self-shadow tints (linear multipliers)
const SM_SHADOW = [0.185, 0.205, 0.265];
const SM_LIGHT = [1.0, 0.965, 0.905];

function bakeSmokeFrame(tile, T, frame, frames) {
  const R = Math.max(48, T >> 1);          // density solved at half res
  const D = new Float32Array(R * R);
  const L = new Float32Array(R * R);
  const time = frame / frames;
  const grow = 0.30 + 0.44 * time;
  const seedZ = 13.7 + time * 1.35;

  for (let y = 0; y < R; y++) {
    const ny = (y + 0.5) / R * 2 - 1;
    for (let x = 0; x < R; x++) {
      const nx = (x + 0.5) / R * 2 - 1;
      // two-channel domain warp, animated through the flipbook
      const w1 = fbm3(nx * 1.75 + 2.1, ny * 1.75, seedZ, 3) - 0.5;
      const w2 = fbm3(nx * 1.75, ny * 1.75 + 4.4, seedZ + 9.0, 3) - 0.5;
      const amp = 0.55 + 0.75 * time;
      const wx = nx + w1 * amp, wy = ny + w2 * amp;
      const n = fbm3(wx * 2.35 + 7.0, wy * 2.35, seedZ * 0.8 + 21.0, 4);
      const r = Math.sqrt(wx * wx + wy * wy);
      let d = (1 - smoothstep(grow * 0.35, grow * 2.15, r)) * (0.30 + 1.25 * n);
      d -= time * 0.30;
      d = clamp01(d * 1.45);
      D[y * R + x] = d * d * (3 - 2 * d);
    }
  }

  // marched self-shadowing: light arrives from the upper-left of the sprite
  const lx = -0.62, ly = -0.78, step = R * 0.055;
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      let acc = 0;
      for (let s = 1; s <= 6; s++) {
        const sx = x + lx * step * s, sy = y + ly * step * s;
        if (sx < 0 || sy < 0 || sx >= R || sy >= R) break;
        acc += D[(sy | 0) * R + (sx | 0)];
      }
      const shadow = Math.exp(-acc * 0.46);
      const d = D[y * R + x];
      // translucent rim scatter where the puff thins out
      L[y * R + x] = clamp01(0.10 + 0.80 * shadow + 0.34 * (1 - d) * shadow);
    }
  }

  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < T; x++) {
      const u = (x + 0.5) * inv;
      let a = sampleField(D, R, u, v);
      const lum = sampleField(L, R, u, v);
      // full-res erosion so the silhouette keeps bite at close range
      const hi = fbm3(u * 17.0, v * 17.0, frame * 0.9 + 3.0, 2);
      a *= 0.70 + 0.55 * hi;
      // never touch the tile border (mip bleed + hard cuts)
      const dx = Math.abs(u * 2 - 1), dy = Math.abs(v * 2 - 1);
      a *= 1 - smoothstep(0.80, 0.99, Math.max(dx, dy));
      a = clamp01(a);
      const r = lerp(SM_SHADOW[0], SM_LIGHT[0], lum);
      const g = lerp(SM_SHADOW[1], SM_LIGHT[1], lum);
      const b = lerp(SM_SHADOW[2], SM_LIGHT[2], lum);
      tile.set(x, y, r, g, b, a);
    }
  }
}

function bakeDust(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const w = (fbm2(nx * 2.4 + 11, ny * 2.4, 3) - 0.5) * 0.55;
      const r = Math.sqrt(nx * nx + ny * ny) + w;
      const n = fbm2(nx * 3.1 + 40, ny * 3.1 + 7, 4);
      let a = (1 - smoothstep(0.10, 0.92, r)) * (0.45 + 1.0 * n);
      a *= 1 - smoothstep(0.82, 1.0, Math.max(Math.abs(nx), Math.abs(ny)));
      a = clamp01(a * 1.15);
      const lum = clamp01(0.34 + 0.72 * (1 - smoothstep(0.0, 0.9, r)) * (0.4 + 0.8 * n));
      tile.set(x, y,
        lerp(0.30, 1.0, lum), lerp(0.31, 0.97, lum), lerp(0.36, 0.90, lum), a);
    }
  }
}

function bakeSpark(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const head = clamp01((nx + 1) * 0.5);          // 0 tail, 1 head
      const th = 0.020 + 0.130 * head * head;
      const q = ny / th;
      let a = Math.exp(-q * q * 1.6) * Math.pow(head, 1.35);
      // bright round head
      const hd = Math.sqrt((nx - 0.80) * (nx - 0.80) * 0.9 + ny * ny);
      a += Math.exp(-hd * hd * 55.0) * 0.95;
      // slight flicker along the streak so it isn't a clean gradient
      a *= 0.72 + 0.42 * fbm2(nx * 6.0 + 3, ny * 24.0, 2);
      a *= 1 - smoothstep(0.86, 1.0, Math.max(Math.abs(nx), Math.abs(ny)));
      a = clamp01(a);
      const core = clamp01(Math.exp(-q * q * 5.0) * (0.35 + 0.9 * head));
      tile.set(x, y, 1.0, lerp(0.62, 1.0, core), lerp(0.16, 0.95, core * core), a);
    }
  }
}

function bakeGlow(tile, T, power, warm) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      let a = Math.pow(clamp01(1 - r), power);
      a = clamp01(a);
      const core = Math.pow(clamp01(1 - r), power * 2.6);
      tile.set(x, y, 1.0,
        lerp(warm ? 0.55 : 0.95, 1.0, core),
        lerp(warm ? 0.18 : 0.92, 1.0, core * core), a);
    }
  }
}

function bakeFlame(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      // teardrop: wide at the base (y=+1 in tile space), tapering upward
      const t = clamp01((ny + 1) * 0.5);
      const w = 0.30 + 0.62 * Math.pow(t, 0.85) * (1 - 0.35 * t);
      const warp = (fbm2(nx * 3.0 + 2, ny * 4.0 - t * 3.0, 3) - 0.5) * 0.55 * (1 - t * 0.4);
      const q = (nx + warp) / w;
      let a = clamp01(1 - q * q) * (1 - smoothstep(0.55, 1.0, t));
      const turb = fbm2(nx * 5.5 + 21, ny * 5.5 - 6.0, 4);
      a *= 0.42 + 1.15 * turb;
      a *= 1 - smoothstep(0.84, 1.0, Math.max(Math.abs(nx), Math.abs(ny)));
      a = clamp01(a * 1.25);
      // temperature: hot white-yellow core near the base, cooling out
      const heat = clamp01((1 - Math.abs(q) * 0.9) * (1 - t * 1.05) * (0.6 + 0.8 * turb));
      const r = 1.0;
      const g = lerp(0.24, 1.0, Math.pow(heat, 0.75));
      const b = lerp(0.035, 0.86, Math.pow(heat, 2.6));
      tile.set(x, y, r, g, b, a);
    }
  }
}

// irregular convex-ish chip / shard silhouette
function bakeChip(tile, T, sides, jag, seed, glint, tint) {
  const inv = 1 / T;
  const rad = new Float32Array(sides);
  for (let i = 0; i < sides; i++) {
    rad[i] = 0.42 + jag * vnoise2(i * 1.37 + seed, seed * 2.1);
  }
  const lx = -0.55, ly = -0.62;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const ang = Math.atan2(ny, nx);
      const fi = (ang + Math.PI) / (Math.PI * 2) * sides;
      const i0 = Math.floor(fi) % sides, i1 = (i0 + 1) % sides;
      const f = fi - Math.floor(fi);
      const rr = lerp(rad[i0], rad[i1], f * f * (3 - 2 * f));
      const r = Math.sqrt(nx * nx + ny * ny);
      let a = 1 - smoothstep(rr - 0.035, rr + 0.02, r);
      a *= 1 - smoothstep(0.90, 1.0, Math.max(Math.abs(nx), Math.abs(ny)));
      // faceted shading so the chip reads as a solid, not a blob
      const facet = fbm2(nx * 3.4 + seed * 3, ny * 3.4, 2);
      let sh = clamp01(0.30 + 0.75 * (facet * 0.6 + 0.4 * (0.5 - (nx * lx + ny * ly) * 0.5)));
      if (glint) {
        const g = Math.exp(-Math.pow((nx * 0.7 + ny * 0.7 - 0.18) * 5.0, 2));
        sh = clamp01(sh + g * 1.1);
      }
      tile.set(x, y, tint[0] * sh, tint[1] * sh, tint[2] * sh, clamp01(a));
    }
  }
}

function bakeSplinter(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const head = clamp01((nx + 1) * 0.5);
      const w = 0.035 + 0.20 * Math.pow(head, 1.6);
      const bend = Math.sin(nx * 2.1) * 0.06;
      let a = 1 - smoothstep(w * 0.75, w, Math.abs(ny - bend));
      a *= 1 - smoothstep(0.86, 1.0, Math.abs(nx));
      const grain = 0.55 + 0.6 * fbm2(nx * 9.0, ny * 26.0 + 5, 2);
      const sh = clamp01(grain * (0.55 + 0.55 * (1 - Math.abs(ny - bend) / (w + 1e-4))));
      tile.set(x, y, 0.72 * sh, 0.55 * sh, 0.34 * sh, clamp01(a));
    }
  }
}

function bakeLeaf(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const t = clamp01((nx + 1) * 0.5);
      const w = 0.62 * Math.sin(Math.PI * Math.pow(t, 0.85));
      let a = 1 - smoothstep(w * 0.82, w, Math.abs(ny));
      a *= 1 - smoothstep(0.88, 1.0, Math.abs(nx));
      const vein = Math.exp(-Math.pow(ny * 26.0, 2)) * 0.5
        + Math.exp(-Math.pow((Math.abs(ny) - w * 0.45) * 22.0, 2)) * 0.25;
      const sh = clamp01(0.45 + 0.55 * fbm2(nx * 5, ny * 5 + 3, 2) - vein * 0.35);
      tile.set(x, y, 0.50 * sh, 0.56 * sh, 0.26 * sh, clamp01(a));
    }
  }
}

function bakeDroplet(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      // teardrop: round head at -x, tail toward +x
      const t = clamp01((nx + 1) * 0.5);
      const w = 0.52 * Math.pow(1 - t, 0.55) * (0.55 + 0.75 * (1 - t));
      let a = 1 - smoothstep(w * 0.80, w, Math.abs(ny));
      a *= 1 - smoothstep(0.90, 1.0, Math.abs(nx));
      const spec = Math.exp(-(Math.pow((nx + 0.45) * 5.0, 2) + Math.pow((ny + 0.22) * 5.0, 2)));
      const sh = clamp01(0.34 + 0.5 * (1 - Math.abs(ny) / (w + 1e-4)) + spec * 1.2);
      tile.set(x, y, sh, sh * 0.62, sh * 0.55, clamp01(a));
    }
  }
}

function bakeMist(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      // fine speckle: a lot of tiny droplets rather than a smooth cloud
      const sp = vnoise2(nx * 26.0 + 3, ny * 26.0);
      const sp2 = vnoise2(nx * 52.0 + 17, ny * 52.0 + 9);
      let a = clamp01((sp - 0.52) * 5.2) * 0.8 + clamp01((sp2 - 0.62) * 6.0) * 0.5;
      a *= 1 - smoothstep(0.15, 1.0, r);
      const sh = clamp01(0.5 + 0.7 * sp);
      tile.set(x, y, sh, sh * 0.42, sh * 0.38, clamp01(a));
    }
  }
}

function bakeRing(tile, T, thickness, streaks) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      const ang = Math.atan2(ny, nx);
      let rr = 0.80;
      if (streaks) rr += 0.045 * (vnoise2(Math.cos(ang) * 3 + 5, Math.sin(ang) * 3) - 0.5) * 2;
      const d = Math.abs(r - rr);
      let a = Math.exp(-Math.pow(d / thickness, 2) * 2.2);
      if (streaks) {
        const rad = vnoise2(Math.cos(ang) * 9 + 2, Math.sin(ang) * 9 + 4);
        a *= 0.55 + 0.95 * rad;
        a += Math.exp(-Math.pow((r - rr * 0.62) / (thickness * 2.4), 2)) * 0.16 * rad;
      }
      a *= 1 - smoothstep(0.94, 1.0, r);
      const inner = clamp01(1 - smoothstep(rr - thickness, rr, r));
      const sh = clamp01(0.55 + 0.65 * Math.exp(-Math.pow(d / (thickness * 0.5), 2)));
      tile.set(x, y, sh, sh * lerp(1.0, 0.92, inner), sh * lerp(1.0, 0.86, inner), clamp01(a));
    }
  }
}

function bakeWater(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      let a = 1 - smoothstep(0.42, 0.62, r);
      const spec = Math.exp(-(Math.pow((nx + 0.22) * 4.4, 2) + Math.pow((ny + 0.25) * 4.4, 2)));
      const rim = Math.exp(-Math.pow((r - 0.52) * 9.0, 2));
      const sh = clamp01(0.24 + spec * 1.3 + rim * 0.65);
      a = clamp01(a * (0.35 + 0.9 * (spec + rim)) + a * 0.28);
      tile.set(x, y, sh * 0.86, sh * 0.94, sh, clamp01(a));
    }
  }
}

function bakeFlare(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny) + 1e-5;
      const halo = Math.pow(clamp01(1 - r), 2.6);
      const ax = Math.abs(nx), ay = Math.abs(ny);
      const spikeH = Math.exp(-Math.pow(ny * 16.0, 2)) * Math.pow(clamp01(1 - ax), 2.0);
      const spikeV = Math.exp(-Math.pow(nx * 16.0, 2)) * Math.pow(clamp01(1 - ay), 2.0);
      const dg = Math.exp(-Math.pow((nx - ny) * 22.0, 2)) * Math.pow(clamp01(1 - r), 2.4);
      const dg2 = Math.exp(-Math.pow((nx + ny) * 22.0, 2)) * Math.pow(clamp01(1 - r), 2.4);
      let a = clamp01(halo * 0.85 + (spikeH + spikeV) * 0.55 + (dg + dg2) * 0.22);
      const core = Math.pow(clamp01(1 - r), 7.0);
      tile.set(x, y, 1.0, lerp(0.80, 1.0, core), lerp(0.52, 1.0, core * core), a);
    }
  }
}

/**
 * Build the particle atlas.
 * @param {number} T tile size in px
 * @returns {{texture:THREE.DataTexture, cols:number, rows:number}}
 */
export function buildParticleAtlas(T) {
  const W = PCOLS * T, H = PROWS * T;
  const data = new Uint8Array(W * H * 4);
  const at = (i) => new Tile(data, W, T, i % PCOLS, (i / PCOLS) | 0);

  for (let f = 0; f < TILE.SMOKE_FRAMES; f++) bakeSmokeFrame(at(TILE.SMOKE + f), T, f, TILE.SMOKE_FRAMES);

  bakeDust(at(TILE.DUST), T);
  bakeSpark(at(TILE.SPARK), T);
  bakeGlow(at(TILE.GLOW), T, 2.2, true);
  bakeFlame(at(TILE.FLAME), T);
  bakeChip(at(TILE.CHIP), T, 7, 0.20, 3.1, false, [0.72, 0.70, 0.66]);
  bakeSplinter(at(TILE.SPLINTER), T);
  bakeChip(at(TILE.SHARD), T, 5, 0.34, 9.7, true, [0.80, 0.90, 0.95]);
  bakeLeaf(at(TILE.LEAF), T);
  bakeDroplet(at(TILE.DROPLET), T);
  bakeMist(at(TILE.MIST), T);
  bakeRing(at(TILE.RING), T, 0.115, true);
  bakeRing(at(TILE.RIPPLE), T, 0.055, false);
  bakeGlow(at(TILE.EMBER), T, 4.5, true);
  bakeWater(at(TILE.WATER), T);
  bakeFlare(at(TILE.FLARE), T);
  bakeGlow(at(TILE.SOFT), T, 1.5, false);

  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { texture: tex, cols: PCOLS, rows: PROWS, size: T };
}

// ---------------------------------------------------------------------------
// decal atlas
// ---------------------------------------------------------------------------

export const DCOLS = 4;
export const DROWS = 4;

export const DECAL = {
  CONCRETE_A: 0, CONCRETE_B: 1, METAL_A: 2, METAL_B: 3,
  WOOD: 4, GLASS: 5, DIRT: 6, PLASTER: 7,
  BRICK: 8, BLOOD_A: 9, BLOOD_SPRAY: 10, BLOOD_POOL: 11,
  SCORCH: 12, SCORCH_SMALL: 13, SCUFF: 14, WET: 15,
};

// radial crack field: n cracks from the centre with tapering width
function crackMask(nx, ny, count, seed, len, wobble, width) {
  const r = Math.sqrt(nx * nx + ny * ny);
  if (r < 1e-4) return 1;
  let best = 0;
  const ang = Math.atan2(ny, nx);
  for (let i = 0; i < count; i++) {
    const a0 = (i / count) * Math.PI * 2 + (vnoise2(i * 3.1 + seed, seed) - 0.5) * 1.9;
    const L = len * (0.45 + 0.75 * vnoise2(i * 7.3 + seed * 2, seed + 4));
    if (r > L) continue;
    // wobble the crack path with angle-dependent noise
    const wob = (vnoise2(r * wobble + i * 5.0 + seed, i * 2.0) - 0.5) * 0.55 * (r / L);
    let da = ang - a0 - wob;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const w = (width / Math.max(r, 0.05)) * (1 - r / L);
    const m = 1 - smoothstep(w * 0.4, w, Math.abs(da));
    if (m > best) best = m;
  }
  return best;
}

function bakeBulletDecal(tile, T, o) {
  const inv = 1 / T;
  const {
    holeR = 0.14, craterR = 0.30, dustR = 0.72, cracks = 7, seed = 1,
    crackLen = 0.85, rimLight = 0.85, dustDark = 0.34, jag = 0.055,
    petal = 0, ringDark = 0.55, grainF = 8.0,
  } = o;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const ang = Math.atan2(ny, nx);
      let r = Math.sqrt(nx * nx + ny * ny);
      // irregular edge on every ring
      const wob = (vnoise2(Math.cos(ang) * 4 + seed, Math.sin(ang) * 4 + seed * 2) - 0.5) * 2;
      const wob2 = (vnoise2(Math.cos(ang) * 11 + seed * 3, Math.sin(ang) * 11) - 0.5) * 2;
      const hR = holeR * (1 + wob * jag * 2.4 + wob2 * jag);
      const cR = craterR * (1 + wob * jag * 2.0);
      const dR = dustR * (1 + wob * 0.13 + wob2 * 0.06);

      const grain = fbm2(nx * grainF + seed * 5, ny * grainF, 3);

      // hole: fully dark
      const hole = 1 - smoothstep(hR * 0.72, hR, r);
      // crushed crater ring: darker with a lit inner lip
      const crater = (1 - smoothstep(cR * 0.72, cR, r)) * (1 - hole);
      // powder / dust halo
      const dust = (1 - smoothstep(dR * 0.30, dR, r)) * (0.35 + 0.9 * grain);

      const ck = cracks > 0 ? crackMask(nx, ny, cracks, seed, crackLen, 9.0, 0.030) : 0;

      let cov = clamp01(hole + crater * 0.98 + dust * 0.62 + ck * 0.85);
      let dark = clamp01(hole * 1.0 + crater * ringDark * (0.6 + 0.7 * grain)
        + dust * dustDark * (0.4 + 0.9 * grain) + ck * 0.72);
      // lit rim just outside the hole (crushed aggregate / torn metal)
      const lip = Math.exp(-Math.pow((r - hR * 1.20) / (hR * 0.55), 2));
      let hi = clamp01(lip * rimLight * (0.55 + 0.8 * grain) * (1 - hole));
      if (petal > 0) {
        const pet = Math.pow(Math.abs(Math.cos((ang + seed) * petal * 0.5)), 3.0);
        hi = clamp01(hi + pet * Math.exp(-Math.pow((r - hR * 1.5) / (hR * 0.9), 2)) * rimLight * 0.9);
        cov = clamp01(cov + pet * Math.exp(-Math.pow((r - hR * 1.5) / (hR * 0.9), 2)) * 0.6);
      }
      // height: hole is deep, lip is raised
      const h = clamp01(0.5 - hole * 0.5 - crater * 0.18 + lip * 0.42 - ck * 0.30 + (grain - 0.5) * 0.10);

      cov *= 1 - smoothstep(0.86, 1.0, Math.max(Math.abs(nx), Math.abs(ny)));
      tile.set(x, y, dark, hi, h, clamp01(cov));
    }
  }
}

function bakeGlassDecal(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      const ang = Math.atan2(ny, nx);
      // radial fractures
      const rad = crackMask(nx, ny, 13, 5.0, 0.98, 6.0, 0.020);
      // concentric fractures joining the radials
      let con = 0;
      for (let i = 1; i <= 4; i++) {
        const rr = 0.16 * i + 0.05 * (vnoise2(Math.cos(ang) * 5 + i, Math.sin(ang) * 5) - 0.5);
        const seg = vnoise2(Math.cos(ang) * 7 + i * 3, Math.sin(ang) * 7 + i);
        if (seg < 0.36) continue;
        con = Math.max(con, Math.exp(-Math.pow((r - rr) / 0.016, 2)) * (r < 0.95 ? 1 : 0));
      }
      const web = clamp01(Math.max(rad, con * 0.9));
      const hole = 1 - smoothstep(0.05, 0.10, r);
      const crush = (1 - smoothstep(0.06, 0.20, r)) * 0.9;
      const cov = clamp01(web * 0.95 + hole + crush * 0.8);
      const dark = clamp01(hole * 0.95 + web * 0.30 + crush * 0.45);
      const hi = clamp01(web * 0.95 * (1 - hole) + crush * 0.5);
      const h = clamp01(0.5 + web * 0.30 - hole * 0.5);
      const edge = 1 - smoothstep(0.88, 1.0, Math.max(Math.abs(nx), Math.abs(ny)));
      tile.set(x, y, dark, hi, h, clamp01(cov * edge));
    }
  }
}

function bakeWoodDecal(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      const ang = Math.atan2(ny, nx);
      // grain runs along x -> tears elongate horizontally
      const rx = nx * 0.72, ry = ny * 1.45;
      const re = Math.sqrt(rx * rx + ry * ry);
      const wob = (vnoise2(Math.cos(ang) * 6 + 2, Math.sin(ang) * 6) - 0.5) * 2;
      const hole = 1 - smoothstep(0.10 + wob * 0.03, 0.17 + wob * 0.03, re);
      const splinter = crackMask(rx, ry, 9, 2.7, 0.85, 14.0, 0.045);
      const tear = (1 - smoothstep(0.16, 0.44 + wob * 0.08, re)) * (0.4 + 0.8 * fbm2(nx * 14 + 3, ny * 30, 3));
      const cov = clamp01(hole + splinter * 0.85 + tear * 0.75);
      const dark = clamp01(hole * 0.98 + splinter * 0.62 + tear * 0.45);
      const hi = clamp01(splinter * 0.55 * (1 - hole)
        + Math.exp(-Math.pow((re - 0.20) / 0.10, 2)) * 0.55 * (1 - hole));
      const h = clamp01(0.5 - hole * 0.5 + splinter * 0.22 - tear * 0.1);
      const edge = 1 - smoothstep(0.86, 1.0, Math.max(Math.abs(nx), Math.abs(ny)));
      tile.set(x, y, dark, hi, h, clamp01(cov * edge));
    }
  }
}

function bakeBlood(tile, T, mode) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      let cov = 0, h = 0.5;
      if (mode === 0) {
        // irregular splat + satellites
        const ang = Math.atan2(ny, nx);
        const wob = fbm2(Math.cos(ang) * 3.2 + 1, Math.sin(ang) * 3.2, 3);
        const rr = 0.34 + 0.30 * wob;
        const r = Math.sqrt(nx * nx + ny * ny);
        cov = 1 - smoothstep(rr * 0.86, rr, r);
        // tendrils
        cov = Math.max(cov, crackMask(nx, ny, 11, 8.2, 0.86, 5.0, 0.055) * (1 - smoothstep(0.3, 0.95, r)));
        // satellite droplets
        for (let i = 0; i < 14; i++) {
          const a = vnoise2(i * 2.7 + 3, 1.1) * Math.PI * 2;
          const d = 0.45 + 0.48 * vnoise2(i * 4.3, 7.7);
          const sx = Math.cos(a) * d, sy = Math.sin(a) * d;
          const sr = 0.022 + 0.055 * vnoise2(i * 9.1, 2.2);
          const dd = Math.sqrt((nx - sx) ** 2 + (ny - sy) ** 2);
          cov = Math.max(cov, 1 - smoothstep(sr * 0.7, sr, dd));
        }
      } else if (mode === 1) {
        // directional spray: dense at -x, streaks flying to +x
        const t = clamp01((nx + 1) * 0.5);
        const spread = 0.12 + 0.62 * t;
        const core = (1 - smoothstep(spread * 0.75, spread, Math.abs(ny)))
          * (1 - smoothstep(0.05, 0.55, t));
        cov = core;
        for (let i = 0; i < 26; i++) {
          const yy = (vnoise2(i * 3.3 + 5, 2.0) - 0.5) * 1.55;
          const xx = -0.85 + 1.85 * vnoise2(i * 5.1, 9.0);
          const tt = clamp01((xx + 1) * 0.5);
          const sr = 0.012 + 0.052 * (1 - tt) * vnoise2(i * 7.7, 4.0);
          const yyy = yy * (0.15 + 1.1 * tt);
          const dd = Math.sqrt(((nx - xx) * 0.55) ** 2 + (ny - yyy) ** 2);
          cov = Math.max(cov, 1 - smoothstep(sr * 0.6, sr, dd));
        }
      } else {
        // pool with gravity drips running to +y
        const r = Math.sqrt(nx * nx + (ny * 0.85) ** 2);
        const ang = Math.atan2(ny, nx);
        const rr = 0.40 + 0.20 * fbm2(Math.cos(ang) * 2.6, Math.sin(ang) * 2.6, 3);
        cov = 1 - smoothstep(rr * 0.9, rr, r);
        for (let i = 0; i < 7; i++) {
          const sx = -0.6 + 1.2 * vnoise2(i * 6.1 + 2, 3.3);
          const len = 0.35 + 0.55 * vnoise2(i * 2.9, 8.1);
          const w = 0.020 + 0.035 * vnoise2(i * 11.3, 1.7);
          if (ny > 0.1 && ny < 0.1 + len) {
            const dd = Math.abs(nx - sx - Math.sin(ny * 6 + i) * 0.02);
            const taper = 1 - (ny - 0.1) / len;
            cov = Math.max(cov, (1 - smoothstep(w * taper * 0.6, w * taper, dd)));
          }
        }
      }
      const grain = fbm2(nx * 12 + 4, ny * 12, 3);
      cov = clamp01(cov * (0.72 + 0.5 * grain));
      const dark = clamp01(0.55 + 0.42 * grain);
      const hi = clamp01(Math.pow(cov, 6.0) * 0.30);      // wet sheen at the thick centre
      h = clamp01(0.5 + cov * 0.12);
      const edge = 1 - smoothstep(0.88, 1.0, Math.max(Math.abs(nx), Math.abs(ny)));
      tile.set(x, y, dark, hi, h, clamp01(cov * edge));
    }
  }
}

function bakeScorch(tile, T, big) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      const ang = Math.atan2(ny, nx);
      // radial soot striations
      const streak = vnoise2(Math.cos(ang) * (big ? 8 : 5) + 3, Math.sin(ang) * (big ? 8 : 5));
      const rr = (big ? 0.86 : 0.78) * (0.72 + 0.55 * streak);
      const grain = fbm2(nx * 5.5 + 9, ny * 5.5, 4);
      let cov = (1 - smoothstep(rr * 0.20, rr, r)) * (0.55 + 0.85 * grain);
      // ejecta rays
      const rays = Math.pow(clamp01(streak * 1.4 - 0.35), 1.6)
        * (1 - smoothstep(rr * 0.6, rr * 1.45, r)) * 0.55;
      cov = clamp01(cov + rays);
      const dark = clamp01(0.55 + 0.45 * (1 - smoothstep(0.0, rr * 0.75, r)) + 0.22 * grain);
      const hi = clamp01(Math.max(0, grain - 0.62) * 0.5 * (1 - smoothstep(0.1, rr, r)));
      const h = clamp01(0.5 - (1 - smoothstep(0.0, rr * 0.5, r)) * 0.22 + (grain - 0.5) * 0.2);
      const edge = 1 - smoothstep(0.86, 1.0, Math.max(Math.abs(nx), Math.abs(ny)));
      tile.set(x, y, dark, hi, h, clamp01(cov * edge));
    }
  }
}

function bakeScuff(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const r = Math.sqrt(nx * nx * 1.6 + ny * ny);
      const grain = fbm2(nx * 7 + 21, ny * 13, 4);
      let cov = (1 - smoothstep(0.25, 0.95, r)) * clamp01((grain - 0.36) * 2.6);
      cov = clamp01(cov * 1.2);
      const edge = 1 - smoothstep(0.86, 1.0, Math.max(Math.abs(nx), Math.abs(ny)));
      tile.set(x, y, clamp01(0.35 + 0.4 * grain), clamp01((grain - 0.7) * 1.6),
        clamp01(0.5 + (grain - 0.5) * 0.3), clamp01(cov * edge));
    }
  }
}

function bakeWet(tile, T) {
  const inv = 1 / T;
  for (let y = 0; y < T; y++) {
    const ny = (y + 0.5) * inv * 2 - 1;
    for (let x = 0; x < T; x++) {
      const nx = (x + 0.5) * inv * 2 - 1;
      const ang = Math.atan2(ny, nx);
      const rr = 0.62 + 0.22 * fbm2(Math.cos(ang) * 2.4, Math.sin(ang) * 2.4, 3);
      const r = Math.sqrt(nx * nx + ny * ny);
      const cov = clamp01((1 - smoothstep(rr * 0.82, rr, r)) * 0.9);
      const edge = 1 - smoothstep(0.88, 1.0, Math.max(Math.abs(nx), Math.abs(ny)));
      tile.set(x, y, 0.34, clamp01(0.28 + 0.3 * Math.pow(cov, 4)), 0.5, clamp01(cov * edge));
    }
  }
}

/** Build the decal atlas. */
export function buildDecalAtlas(T) {
  const W = DCOLS * T, H = DROWS * T;
  const data = new Uint8Array(W * H * 4);
  const at = (i) => new Tile(data, W, T, i % DCOLS, (i / DCOLS) | 0);

  bakeBulletDecal(at(DECAL.CONCRETE_A), T, {
    holeR: 0.15, craterR: 0.33, dustR: 0.80, cracks: 8, seed: 1.7,
    crackLen: 0.90, rimLight: 0.90, dustDark: 0.30, jag: 0.07, ringDark: 0.62, grainF: 9,
  });
  bakeBulletDecal(at(DECAL.CONCRETE_B), T, {
    holeR: 0.12, craterR: 0.40, dustR: 0.88, cracks: 6, seed: 5.3,
    crackLen: 0.98, rimLight: 0.80, dustDark: 0.26, jag: 0.09, ringDark: 0.55, grainF: 7,
  });
  bakeBulletDecal(at(DECAL.METAL_A), T, {
    holeR: 0.11, craterR: 0.17, dustR: 0.42, cracks: 0, seed: 2.9,
    rimLight: 1.0, dustDark: 0.42, jag: 0.05, petal: 7, ringDark: 0.75, grainF: 16,
  });
  bakeBulletDecal(at(DECAL.METAL_B), T, {
    holeR: 0.13, craterR: 0.20, dustR: 0.50, cracks: 3, crackLen: 0.5, seed: 8.1,
    rimLight: 0.95, dustDark: 0.38, jag: 0.08, petal: 5, ringDark: 0.70, grainF: 13,
  });
  bakeWoodDecal(at(DECAL.WOOD), T);
  bakeGlassDecal(at(DECAL.GLASS), T);
  bakeBulletDecal(at(DECAL.DIRT), T, {
    holeR: 0.17, craterR: 0.50, dustR: 0.95, cracks: 0, seed: 4.4,
    rimLight: 0.34, dustDark: 0.30, jag: 0.13, ringDark: 0.45, grainF: 5,
  });
  bakeBulletDecal(at(DECAL.PLASTER), T, {
    holeR: 0.13, craterR: 0.42, dustR: 0.86, cracks: 5, seed: 6.6,
    crackLen: 0.72, rimLight: 0.62, dustDark: 0.22, jag: 0.12, ringDark: 0.40, grainF: 6,
  });
  bakeBulletDecal(at(DECAL.BRICK), T, {
    holeR: 0.14, craterR: 0.36, dustR: 0.70, cracks: 4, seed: 3.3,
    crackLen: 0.62, rimLight: 0.95, dustDark: 0.34, jag: 0.16, ringDark: 0.60, grainF: 10,
  });
  bakeBlood(at(DECAL.BLOOD_A), T, 0);
  bakeBlood(at(DECAL.BLOOD_SPRAY), T, 1);
  bakeBlood(at(DECAL.BLOOD_POOL), T, 2);
  bakeScorch(at(DECAL.SCORCH), T, true);
  bakeScorch(at(DECAL.SCORCH_SMALL), T, false);
  bakeScuff(at(DECAL.SCUFF), T);
  bakeWet(at(DECAL.WET), T);

  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { texture: tex, cols: DCOLS, rows: DROWS, size: T };
}
