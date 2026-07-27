// materials.js — the procedural PBR material library. Owned by: materials.
//
//   ctx.materials.get(name, opts?)     -> THREE.Material  (cached, surface-tagged)
//   ctx.materials.texture(name, opts?) -> { map, normalMap, roughnessMap, aoMap, ... }
//   ctx.materials.names                -> string[]
//   ctx.materials.env                  -> PMREM environment texture
//
// Every material is generated on the GPU in three passes (see texgen.js):
//   1. recipe pass  -> albedo(sRGB) + height, plus rough/metal/dirt/wear masks
//   2. derive pass  -> tangent-space normal (Sobel) + ambient occlusion (cone taps)
//   3. combine pass -> curvature edge wear, cavity dirt, gravity streaks,
//                      micro roughness break-up, wetness -> final albedo + ORM
//
// At draw time the standard material shader is patched with: a world-space macro
// variation layer (anti-tiling), a distance-faded detail normal (close-up micro
// structure) and an optional triplanar projection. UV repeat is a uniform, so a
// single texture set serves every surface size at a constant 512 px/m.

import * as THREE from 'three';
import { TexGen, GLSL_LIB } from './texgen.js';

// Texel density, fixed across the whole game (ARTDIRECTION.md).
const PX_PER_METRE = 512;

const BASE_SIZE = { low: 512, medium: 1024, high: 1024, ultra: 2048 };
const TIER_SCALE = { hero: 1, mid: 0.5, small: 0.25 };

const K = {
  CONCRETE: 0, BRICK: 1, GRANULAR: 2, METAL: 3, WOOD: 4, FABRIC: 5,
  TILE: 6, GLASS: 7, RUBBER: 8, FOLIAGE: 9, POLYMER: 10, SKIN: 11, WATER: 12,
};

// ---------------------------------------------------------------------------
// Recipe pass — one uber-shader, one compile, driven entirely by uniforms.
// ---------------------------------------------------------------------------
const FRAG_RECIPE = GLSL_LIB + /* glsl */`
uniform int   uKind;
uniform float uSeed;
uniform float uTileM;       // tile size in metres
uniform vec4  uP0;
uniform vec4  uP1;
uniform vec3  uC0, uC1, uC2, uC3;
uniform vec2  uRough;
uniform float uMetal;

layout(location = 0) out vec4 oAH;   // rgb = albedo (sRGB encoded), a = height
layout(location = 1) out vec4 oMK;   // r = roughness, g = metalness, b = dirt, a = wear/alpha

#define FQ(x)  max(1.0, floor((x) * uTileM + 0.5))
#define FQE(x) max(2.0, 2.0 * floor((x) * uTileM * 0.5 + 0.5))
#define PI 3.141592653589793

struct Surf { vec3 alb; float h; float rgh; float mtl; float dirt; float wear; };

// ---------------------------------------------------------- concrete family
// uP0 = (aggregate, pitting, cracks, formBoardLines)
// uP1 = (staining, trowel, chipping, aggregateCellsPerMetre)
Surf kConcrete(vec2 uv){
  float sd = uSeed; Surf s;

  float fm = FQ(0.30);
  float macro = fbm(domainWarp(uv * fm, vec2(fm), 0.45, sd), vec2(fm), 4, 0.55, sd);
  float fb = FQ(1.15);
  float blotch = fbm(uv * fb, vec2(fb), 3, 0.5, sd + 21.0);

  float fa = FQ(uP1.w);
  vec3  wa = worley(uv * fa, vec2(fa), sd + 5.0);
  float agg = pow(clamp(1.0 - wa.x * 1.55, 0.0, 1.0), 0.55);
  float fp = FQ(uP1.w * 2.2);
  vec3  wp = worley(uv * fp, vec2(fp), sd + 71.0);
  // only ~1 cell in 5 holds a bubble, and its radius varies with the cell id
  float pitR = 0.10 + 0.30 * fract(wp.z * 7.31);
  float pits = smoothstep(pitR, pitR * 0.15, wp.x) * step(0.80, wp.z);

  float fc = FQ(3.1);
  float crack = worleyCracks(domainWarp(uv * fc, vec2(fc), 0.30, sd + 9.0), vec2(fc), sd + 33.0, 0.022)
              * smoothstep(0.60, 0.94, blotch);

  float fmi = FQ(95.0);
  float micro = fbmValue(uv * fmi, vec2(fmi), 3, 0.55, sd + 3.0);
  float fsa = FQ(34.0);
  float sandTooth = fbmValue(uv * fsa, vec2(fsa), 3, 0.5, sd + 27.0);

  float fl = FQ(1.0 / 0.62);
  float band = abs(fract(uv.y * fl + 0.5) - 0.5) * 2.0;
  float form = smoothstep(0.14, 0.0, band) * uP0.w;

  float ft = FQ(3.2);
  float trowel = (fbm(domainWarp(uv * ft, vec2(ft), 0.9, sd + 61.0), vec2(ft), 3, 0.5, sd + 61.0) - 0.5) * uP1.y;

  float chip = splatter(uv, FQ(3.4), sd + 13.0, 0.15, 0.10) * uP1.z;

  s.h = clamp(0.56
      + (macro - 0.5) * 0.040
      + (sandTooth - 0.5) * 0.045
      + (micro - 0.5) * 0.075
      + agg * 0.085 * uP0.x * (0.16 + 0.84 * chip)
      - pits * 0.19 * uP0.y
      - crack * 0.22 * uP0.z
      - form * 0.06
      + trowel * 0.15
      - chip * 0.10, 0.0, 1.0);

  vec3 base = mix(uC0 * 0.86, uC0 * 1.14, macro);
  base = mix(base, uC1, smoothstep(0.55, 0.98, blotch) * uP1.x * 0.8);
  base = mix(base, mix(uC2 * 0.74, uC2 * 1.18, wa.z),
             clamp(agg * uP0.x, 0.0, 1.0) * (0.10 + 0.55 * chip));
  base *= mix(1.0, 0.78, crack * 0.85);
  base *= mix(0.95, 1.05, micro) * mix(0.96, 1.04, sandTooth);
  base = mix(base, uC3, chip * 0.5);

  s.alb  = base;
  s.rgh  = mix(uRough.x, uRough.y, clamp(macro * 0.5 + micro * 0.5, 0.0, 1.0));
  s.mtl  = uMetal;
  s.dirt = clamp(dripStreaks(uv, FQ(2.2), sd + 44.0, 0.55) * 0.85
                 + smoothstep(0.62, 1.0, blotch) * 0.30, 0.0, 1.0);
  s.wear = clamp(agg * uP0.x * 0.35 + chip, 0.0, 1.0);
  return s;
}

// ------------------------------------------------------------------- brick
// uP0 = (bricksPerMetreX, coursesPerMetreY, jointMetres, colourVariation)
// uP1 = (chipping, sooting, -, -)
Surf kBrick(vec2 uv){
  float sd = uSeed; Surf s;
  float bx = FQ(uP0.x);
  float by = FQE(uP0.y);
  float row = floor(uv.y * by);
  float off = mod(row, 2.0) * 0.5;
  float xr = uv.x * bx + off;
  vec2 cell = vec2(mod(floor(xr), bx), mod(row, by));
  vec2 f = vec2(fract(xr), fract(uv.y * by));

  float jw = uP0.z / uTileM;                     // joint width in uv units
  float dx = min(f.x, 1.0 - f.x) / bx;
  float dy = min(f.y, 1.0 - f.y) / by;
  float dj = min(dx, dy);
  float brick = smoothstep(jw * 0.35, jw * 1.05, dj);

  vec3 r = hash23(cell + sd);
  float fmi = FQ(110.0);
  float micro = fbmValue(uv * fmi, vec2(fmi), 3, 0.5, sd + 3.0);
  float fpore = FQ(46.0);
  vec3 wpr = worley(uv * fpore, vec2(fpore), sd + 17.0);
  float pores = smoothstep(0.30, 0.0, wpr.x) * step(0.45, wpr.z);

  float fm = FQ(0.35);
  float macro = fbm(domainWarp(uv * fm, vec2(fm), 0.5, sd + 7.0), vec2(fm), 4, 0.55, sd + 7.0);

  float chip = clamp(splatter(uv, FQ(3.5), sd + 51.0, 0.20, 0.35) * uP1.x
                    * smoothstep(jw * 3.0, jw * 0.6, dj), 0.0, 1.0);

  float mortarTex = fbmValue(uv * FQ(190.0), vec2(FQ(190.0)), 2, 0.5, sd + 29.0);

  s.h = clamp(mix(0.30 + mortarTex * 0.10, 0.72 + (micro - 0.5) * 0.06 - pores * 0.22, brick)
              + (macro - 0.5) * 0.05 - chip * 0.16, 0.0, 1.0);

  vec3 clay = ramp3(clamp(r.x * uP0.w + (1.0 - uP0.w) * 0.5, 0.0, 1.0), uC0, uC1, uC2);
  clay *= mix(0.88, 1.12, r.y);
  clay *= mix(0.92, 1.08, micro);
  clay = mix(clay, uC2 * 0.6, pores * 0.5);
  clay = mix(clay, uC1 * 1.15, chip * 0.6);

  vec3 mortar = uC3 * mix(0.82, 1.14, mortarTex);

  s.alb  = mix(mortar, clay, brick);
  s.alb *= mix(1.0 - uP1.y * 0.45, 1.0, smoothstep(0.25, 0.75, macro));
  s.rgh  = mix(uRough.y, mix(uRough.x, uRough.y, micro), brick);
  s.mtl  = uMetal;
  s.dirt = clamp(dripStreaks(uv, FQ(2.0), sd + 63.0, 0.6) * 0.9
                 + (1.0 - brick) * 0.25 + smoothstep(0.6, 1.0, 1.0 - macro) * 0.3, 0.0, 1.0);
  s.wear = clamp(chip + brick * 0.25 * micro, 0.0, 1.0);
  return s;
}

// -------------------------------------------------- sand / dirt / gravel
// uP0 = (pebblesPerMetre, pebbleDepth, ripplesPerMetre, rippleAmount)
// uP1 = (grit, colourSpread, debris, -)
Surf kGranular(vec2 uv){
  float sd = uSeed; Surf s;
  float fp = FQ(uP0.x);
  vec3 w1 = worley(domainWarp(uv * fp, vec2(fp), 0.22, sd + 5.0), vec2(fp), sd + 5.0);
  float stones = pow(clamp(1.0 - w1.x * 1.5, 0.0, 1.0), 0.65);
  float fp2 = FQ(uP0.x * 2.8);
  float stones2 = worleyStones(uv * fp2, vec2(fp2), sd + 15.0, 0.7);

  float fr = max(1.0, FQ(uP0.z));
  float fry = max(1.0, floor(fr * 3.0));
  float ripple = fbm(uv * vec2(fr, fry), vec2(fr, fry), 3, 0.5, sd + 2.0);

  float fm = FQ(0.38);
  float macro = fbm(domainWarp(uv * fm, vec2(fm), 0.55, sd + 7.0), vec2(fm), 4, 0.55, sd + 7.0);
  float fmi = FQ(115.0);
  float grit = fbmValue(uv * fmi, vec2(fmi), 3, 0.5, sd + 9.0);
  float fdb = max(1.0, FQ(uP0.x * 0.4));
  float debris = splatter(uv, fdb, sd + 27.0, 0.24, 0.30) * uP1.z;

  s.h = clamp(0.44
      + (macro - 0.5) * 0.24
      + (ripple - 0.5) * uP0.w
      + stones * uP0.y
      + stones2 * uP0.y * 0.45
      + (grit - 0.5) * 0.06 * uP1.x
      + debris * 0.10, 0.0, 1.0);

  float t = clamp(macro * 0.65 + w1.z * uP1.y * 0.5 + (grit - 0.5) * 0.3, 0.0, 1.0);
  vec3 base = ramp3(t, uC0, uC1, uC2);
  base = mix(base, mix(uC3 * 0.72, uC3 * 1.25, w1.z), clamp(stones * 1.35 - 0.22, 0.0, 1.0) * 0.62);
  base *= mix(0.90, 1.10, grit);
  base *= mix(0.94, 1.06, ripple);

  s.alb  = base;
  s.rgh  = mix(uRough.x, uRough.y, clamp(grit * 0.6 + macro * 0.4, 0.0, 1.0));
  s.mtl  = uMetal;
  s.dirt = clamp(smoothstep(0.55, 1.0, 1.0 - macro) * 0.5 + stones * 0.15, 0.0, 1.0);
  s.wear = clamp(stones * 0.8 + debris, 0.0, 1.0);
  return s;
}

// ------------------------------------------------------------------- metal
// uP0 = (rust, paintChip, brushed, panelsPerMetre)
// uP1 = (scratchCoverage, dents, ribsPerMetre, -)
Surf kMetal(vec2 uv){
  float sd = uSeed; Surf s;

  float fd = FQ(1.2);
  float dent = fbm(domainWarp(uv * fd, vec2(fd), 0.4, sd), vec2(fd), 4, 0.55, sd);
  float fbx = FQ(300.0), fby = FQ(3.0);
  float brush = fbm(uv * vec2(fbx, fby), vec2(fbx, fby), 3, 0.62, sd + 11.0);

  float scr  = scratchLines(uv, FQ(5.0),  sd + 23.0, 0.010, uP1.x, 0.0);
  float scr2 = scratchLines(uv, FQ(13.0), sd + 29.0, 0.018, uP1.x * 0.6, 0.0);
  float scratch = clamp(max(scr, scr2 * 0.7), 0.0, 1.0);

  float frr = FQ(1.7);
  float rustField = fbm(domainWarp(uv * frr, vec2(frr), 0.85, sd + 31.0), vec2(frr), 5, 0.55, sd + 31.0);
  float frg = FQ(22.0);
  float rustGrain = worleyStones(uv * frg, vec2(frg), sd + 37.0, 0.5);
  float rust = clamp(smoothstep(0.46, 0.80, rustField) * uP0.x * (0.5 + 0.7 * rustGrain)
                     + scratch * uP0.x * 0.30, 0.0, 1.0);

  float chip = clamp(splatter(uv, FQ(4.5), sd + 47.0, 0.20, 0.32) * uP0.y
                     + scratch * uP0.y * 0.55, 0.0, 1.0);

  float seam = 0.0;
  if (uP0.w > 0.01){
    float fpn = FQ(uP0.w);
    vec2 pf = fract(uv * fpn + 0.5);
    float dpx = min(pf.x, 1.0 - pf.x) / fpn;
    float dpy = min(pf.y, 1.0 - pf.y) / fpn;
    seam = 1.0 - smoothstep(0.0, 0.008 / uTileM, min(dpx, dpy));
  }
  float rib = 0.0;
  if (uP1.z > 0.01){
    float fri = FQE(uP1.z);
    rib = pow(abs(sin(uv.y * fri * PI)), 2.2);
  }

  float fmi = FQ(120.0);
  float micro = fbmValue(uv * fmi, vec2(fmi), 3, 0.5, sd + 3.0);

  s.h = clamp(0.60
      + (dent - 0.5) * 0.10 * uP1.y
      + (brush - 0.5) * 0.016 * uP0.z
      + (micro - 0.5) * 0.02
      + rust * 0.085
      - scratch * 0.030
      - chip * 0.020
      - seam * 0.30
      + rib * 0.14, 0.0, 1.0);

  vec3 paint = uC0 * mix(0.90, 1.10, dent) * mix(0.95, 1.05, micro);
  paint = mix(paint, uC0 * 1.35, brush * uP0.z * 0.7);
  vec3 bare  = uC1 * mix(0.85, 1.20, brush);
  vec3 rusty = ramp3(clamp(rustGrain * 0.7 + rustField * 0.5, 0.0, 1.0), uC2 * 0.7, uC2, uC3);

  vec3 col = mix(paint, bare, chip);
  col = mix(col, rusty, rust);
  col = mix(col, col * 0.55, seam * 0.8);
  col = mix(col, bare * 1.25, scratch * (1.0 - rust) * 0.5);

  float mtl = mix(uMetal, 1.0, chip * 0.8);
  mtl = mix(mtl, 0.05, rust * 0.85);

  float rgh = mix(uRough.x, uRough.y, clamp(micro * 0.5 + dent * 0.5, 0.0, 1.0));
  rgh = mix(rgh, 0.92, rust * 0.9);
  rgh = mix(rgh, clamp(rgh - 0.18, 0.06, 1.0), brush * uP0.z);
  rgh = mix(rgh, 0.55, chip * 0.6);
  rgh = mix(rgh, clamp(rgh - 0.15, 0.05, 1.0), scratch * 0.5 * (1.0 - rust));

  s.alb  = col;
  s.rgh  = rgh;
  s.mtl  = mtl;
  s.dirt = clamp(dripStreaks(uv, FQ(3.0), sd + 41.0, 0.7) * (0.35 + 0.65 * uP0.x)
                 + seam * 0.4, 0.0, 1.0);
  s.wear = clamp(chip * 0.8 + scratch * 0.6 + rib * 0.3, 0.0, 1.0);
  return s;
}

// -------------------------------------------------------------------- wood
// uP0 = (planksPerMetre, ringsPerMetre, knots, jointMetres)
// uP1 = (weathering, fibre, -, plankLengthMetres)
Surf kWood(vec2 uv){
  float sd = uSeed; Surf s;
  float fpl = FQ(uP0.x);
  float py = uv.y * fpl;
  float prow = floor(py);
  float pf = fract(py);
  float ex = FQ(1.0 / max(uP1.w, 0.2));
  vec3 rr = hash23(vec2(mod(prow, fpl), 0.0) + sd);
  float xr = uv.x * ex + rr.x;
  float ecol = floor(xr);
  float ef = fract(xr);
  vec3 r = hash23(vec2(mod(ecol, ex), mod(prow, fpl)) + sd + 3.0);

  float jw = max(uP0.w, 2.0e-4) / uTileM;
  float dgy = min(pf, 1.0 - pf) / fpl;
  float dgx = min(ef, 1.0 - ef) / ex;
  float joint = 1.0 - smoothstep(jw * 0.3, jw * 1.2, min(dgy, dgx * 1.4));

  // grain: long rings running along the plank (x)
  float fgx = FQ(1.6);
  float fgw = max(1.0, floor(FQ(uP0.y) * 0.12));
  float wob = (fbm(uv * vec2(fgx, fgw), vec2(fgx, fgw), 3, 0.5, sd + prow * 11.0) - 0.5);
  float wob2 = (fbm(uv * vec2(fgx * 3.0, fgw * 2.0), vec2(fgx * 3.0, fgw * 2.0), 2, 0.5, sd + 5.0) - 0.5);
  float ringPos = (uv.y + r.y * 0.7) * FQ(uP0.y) + wob * 7.0 + wob2 * 2.2;
  float rings = pow(abs(fract(ringPos) - 0.5) * 2.0, 1.35);

  float ffx = FQ(4.0), ffy = FQ(210.0);
  float fibre = fbm(uv * vec2(ffx, ffy), vec2(ffx, ffy), 3, 0.55, sd + 17.0);

  float fk = FQ(1.6);
  vec3 wk = worley(uv * vec2(fk, fk * 2.0), vec2(fk, fk * 2.0), sd + 41.0);
  float knot = smoothstep(0.26, 0.03, wk.x) * step(0.72, wk.z) * uP0.z;

  float split = scratchLines(uv, FQ(3.0), sd + 55.0, 0.006, 0.30, 0.0) * uP1.y;

  s.h = clamp(0.62
      + (rings - 0.5) * 0.055
      + (fibre - 0.5) * 0.045 * uP1.y
      + (r.z - 0.5) * 0.05
      - joint * 0.42
      - knot * 0.10
      - split * 0.10, 0.0, 1.0);

  vec3 wood = ramp3(clamp(rings * 0.75 + fibre * 0.35, 0.0, 1.0), uC0, uC1, uC2);
  wood *= mix(0.84, 1.16, r.z);
  wood *= mix(0.93, 1.07, fibre);
  wood = mix(wood, uC3, knot * 0.8);
  wood = mix(wood, uC2 * 0.55, split * 0.5);
  float fm = FQ(0.5);
  float weather = fbm(uv * fm, vec2(fm), 3, 0.55, sd + 71.0);
  wood = mix(wood, mix(wood, vec3(dot(wood, vec3(0.32, 0.42, 0.26))) * 1.15, 0.7),
             smoothstep(0.35, 0.9, weather) * uP1.x);

  s.alb  = wood;
  s.rgh  = mix(uRough.x, uRough.y, clamp(fibre * 0.6 + rings * 0.4, 0.0, 1.0));
  s.mtl  = uMetal;
  s.dirt = clamp(joint * 0.7 + dripStreaks(uv, FQ(2.5), sd + 83.0, 0.5) * 0.5, 0.0, 1.0);
  s.wear = clamp(split * 0.8 + (1.0 - rings) * 0.25, 0.0, 1.0);
  return s;
}

// ------------------------------------------------------------------ fabric
// uP0 = (threadsPerMetre, fuzz, camo, ribsPerMetre)
// uP1 = (dirt, weaveDepth, stitchPerMetre, -)
Surf kFabric(vec2 uv){
  float sd = uSeed; Surf s;
  float fw = FQE(uP0.x);
  vec2 tp = uv * fw;
  vec2 ti = floor(tp), tf = fract(tp);
  float over = mod(ti.x + ti.y, 2.0);
  float warpT = pow(max(sin(tf.x * PI), 0.0), 0.65);
  float weftT = pow(max(sin(tf.y * PI), 0.0), 0.65);
  float weave = mix(weftT * 0.85 + 0.10, warpT * 0.85 + 0.10, over);

  float ffz = FQ(180.0);
  float fuzz = fbmValue(uv * ffz, vec2(ffz), 3, 0.5, sd + 5.0);
  float fm = FQ(0.45);
  float macro = fbm(domainWarp(uv * fm, vec2(fm), 0.5, sd + 13.0), vec2(fm), 4, 0.55, sd + 13.0);

  float rib = 0.0;
  if (uP0.w > 0.01){
    float fri = FQE(uP0.w);
    rib = pow(abs(sin(uv.y * fri * PI)), 1.6);
  }
  float stitch = 0.0;
  if (uP1.z > 0.01){
    float fs = FQE(uP1.z);
    float sx = abs(fract(uv.x * fs * 6.0) - 0.5) * 2.0;
    float sy = abs(fract(uv.y * fs) - 0.5) * 2.0;
    stitch = smoothstep(0.55, 1.0, 1.0 - sy) * smoothstep(0.3, 0.8, sx);
  }

  s.h = clamp(0.5 + (weave - 0.5) * uP1.y + (fuzz - 0.5) * 0.05
              + rib * 0.10 + stitch * 0.12 + (macro - 0.5) * 0.05, 0.0, 1.0);

  vec3 col;
  if (uP0.z > 0.01){
    // camouflage: warped multi-octave blobs quantised into the four palette tones
    float fcm = FQ(2.9);
    float c1 = fbm(domainWarp2(uv * fcm, vec2(fcm), 0.75, sd + 91.0), vec2(fcm), 4, 0.6, sd + 91.0);
    float fcm2 = FQ(6.4);
    float c2 = fbm(domainWarp(uv * fcm2, vec2(fcm2), 0.6, sd + 97.0), vec2(fcm2), 3, 0.55, sd + 97.0);
    float band = c1 * 0.7 + c2 * 0.3;
    col = uC0;
    col = mix(col, uC1, smoothstep(0.44, 0.50, band));
    col = mix(col, uC2, smoothstep(0.58, 0.63, band));
    col = mix(col, uC3, smoothstep(0.70, 0.75, c2));
  } else {
    col = ramp3(clamp(macro * 0.8 + fuzz * 0.3, 0.0, 1.0), uC0, uC1, uC2);
    col = mix(col, uC3, rib * 0.35 + stitch * 0.6);
  }
  col *= mix(0.80, 1.14, weave);
  col *= mix(0.93, 1.07, fuzz);

  s.alb  = col;
  s.rgh  = mix(uRough.x, uRough.y, clamp(fuzz * 0.55 + weave * 0.45, 0.0, 1.0));
  s.mtl  = uMetal;
  s.dirt = clamp(dripStreaks(uv, FQ(2.0), sd + 101.0, 0.5) * uP1.x
                 + smoothstep(0.6, 1.0, 1.0 - macro) * uP1.x * 0.6, 0.0, 1.0);
  s.wear = clamp((1.0 - weave) * 0.4 + fuzz * 0.3, 0.0, 1.0);
  return s;
}

// -------------------------------------------------------------------- tile
// uP0 = (tilesPerMetre, groutMetres, chipping, glaze)
// uP1 = (colourVariation, crazing, dirt, -)
Surf kTile(vec2 uv){
  float sd = uSeed; Surf s;
  float ft = FQ(uP0.x);
  vec2 tp = uv * ft;
  vec2 ti = floor(tp), tf = fract(tp);
  vec2 cell = mod(ti, vec2(ft));
  float gw = uP0.y / uTileM;
  float d = min(min(tf.x, 1.0 - tf.x), min(tf.y, 1.0 - tf.y)) / ft;
  float tile = smoothstep(gw * 0.3, gw * 1.1, d);

  vec3 r = hash23(cell + sd);
  float fmi = FQ(150.0);
  float micro = fbmValue(uv * fmi, vec2(fmi), 3, 0.5, sd + 3.0);
  float fgr = FQ(90.0);
  float groutTex = fbmValue(uv * fgr, vec2(fgr), 3, 0.5, sd + 19.0);
  float fcz = FQ(9.0);
  float craze = worleyCracks(uv * fcz, vec2(fcz), sd + 23.0, 0.03) * uP1.y * tile;
  float chip = splatter(uv, FQ(4.0), sd + 29.0, 0.14, 0.25) * uP0.z
             * smoothstep(gw * 3.5, gw * 0.5, d);
  float fm = FQ(0.4);
  float macro = fbm(uv * fm, vec2(fm), 3, 0.55, sd + 31.0);

  s.h = clamp(mix(0.24 + groutTex * 0.12, 0.78 + (r.z - 0.5) * 0.045 + (micro - 0.5) * 0.02, tile)
              - craze * 0.10 - chip * 0.30 + (macro - 0.5) * 0.03, 0.0, 1.0);

  vec3 face = ramp3(clamp(r.x * uP1.x + (1.0 - uP1.x) * 0.5, 0.0, 1.0), uC0, uC1, uC2);
  face *= mix(0.92, 1.08, r.y);
  face *= mix(0.96, 1.04, micro);
  face = mix(face, uC2 * 0.75, craze * 0.6);
  vec3 grout = uC3 * mix(0.80, 1.15, groutTex);

  s.alb  = mix(grout, face, tile);
  s.alb  = mix(s.alb, uC2 * 0.8, chip * 0.7);
  s.rgh  = mix(uRough.y, mix(uRough.x, uRough.x + 0.10, micro), tile * uP0.w);
  s.rgh  = mix(s.rgh, uRough.y, chip * 0.8);
  s.mtl  = uMetal;
  s.dirt = clamp((1.0 - tile) * 0.55 + dripStreaks(uv, FQ(3.0), sd + 43.0, 0.45) * uP1.z
                 + smoothstep(0.62, 1.0, 1.0 - macro) * 0.3, 0.0, 1.0);
  s.wear = clamp(chip + (1.0 - tile) * 0.2, 0.0, 1.0);
  return s;
}

// ------------------------------------------------------------------- glass
Surf kGlass(vec2 uv){
  float sd = uSeed; Surf s;
  float fm = FQ(0.6);
  float macro = fbm(domainWarp(uv * fm, vec2(fm), 0.5, sd), vec2(fm), 4, 0.55, sd);
  float smear = streakNoise(uv, FQ(2.0), FQ(26.0), 3, sd + 11.0);
  float dust = splatter(uv, FQ(14.0), sd + 17.0, 0.16, 0.35);
  float scratch = scratchLines(uv, FQ(6.0), sd + 23.0, 0.006, 0.25, 0.0);
  float grime = clamp(smoothstep(0.5, 0.95, macro) * 0.7 + smear * 0.4 + dust * 0.5, 0.0, 1.0);
  float fmi = FQ(140.0);
  float micro = fbmValue(uv * fmi, vec2(fmi), 2, 0.5, sd + 5.0);

  s.h    = clamp(0.5 + (macro - 0.5) * 0.02 + grime * 0.012 - scratch * 0.02, 0.0, 1.0);
  s.alb  = mix(uC0, uC1, grime * 0.8) * mix(0.97, 1.03, micro);
  s.rgh  = mix(uRough.x, uRough.y, clamp(grime * 0.9 + scratch * 0.5, 0.0, 1.0));
  s.mtl  = uMetal;
  s.dirt = clamp(dripStreaks(uv, FQ(3.5), sd + 31.0, 0.55) * 0.7 + grime * 0.4, 0.0, 1.0);
  s.wear = clamp(scratch, 0.0, 1.0);
  return s;
}

// ------------------------------------------------------------------ rubber
// uP0 = (treadPerMetre, -, -, -)
Surf kRubber(vec2 uv){
  float sd = uSeed; Surf s;
  float fp = FQ(70.0);
  float pebble = worleyStones(uv * fp, vec2(fp), sd + 5.0, 0.8);
  float fmi = FQ(180.0);
  float micro = fbmValue(uv * fmi, vec2(fmi), 3, 0.5, sd + 3.0);
  float fm = FQ(0.7);
  float macro = fbm(uv * fm, vec2(fm), 3, 0.55, sd + 9.0);
  float tread = 0.0;
  if (uP0.x > 0.01){
    float ft = FQE(uP0.x);
    float band = abs(fract(uv.y * ft + uv.x * 0.35) - 0.5) * 2.0;
    tread = smoothstep(0.35, 0.65, band);
  }
  float scuff = scratchLines(uv, FQ(5.0), sd + 21.0, 0.014, 0.30, 0.0);

  s.h    = clamp(0.5 + pebble * 0.07 + (micro - 0.5) * 0.04 + tread * 0.18
                 + (macro - 0.5) * 0.05 - scuff * 0.02, 0.0, 1.0);
  s.alb  = mix(uC0, uC1, pebble * 0.6) * mix(0.90, 1.10, macro) * mix(0.95, 1.05, micro);
  s.alb  = mix(s.alb, uC2, scuff * 0.45);
  s.rgh  = mix(uRough.x, uRough.y, clamp(micro * 0.6 + pebble * 0.4, 0.0, 1.0));
  s.mtl  = uMetal;
  s.dirt = clamp(smoothstep(0.6, 1.0, 1.0 - macro) * 0.5, 0.0, 1.0);
  s.wear = clamp(scuff * 0.8 + pebble * 0.3, 0.0, 1.0);
  return s;
}

// ----------------------------------------------------------------- foliage
// uP0 = (leavesPerMetre, leafAspect, -, -)
Surf kFoliage(vec2 uv){
  float sd = uSeed; Surf s;
  float fl = FQ(uP0.x);
  vec2 p = uv * fl;
  vec2 i = floor(p), f = fract(p);
  float best = -9.0, bid = 0.0, bmid = 0.0;
  for (int y = -1; y <= 1; y++){
    for (int x = -1; x <= 1; x++){
      vec2 g = vec2(float(x), float(y));
      vec2 c = mod(i + g, vec2(fl));
      vec3 r = hash23(c + sd);
      vec2 o = hash22(c + sd + 7.0);
      vec2 d = f - g - o;
      float a = r.x * PI * 2.0;
      vec2 rd = vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
      rd /= vec2(0.72, 0.72 * uP0.y);
      float taper = 1.0 - abs(rd.x) * 0.5;
      float sh = 1.0 - length(vec2(rd.x, rd.y / max(taper, 0.15)));
      if (sh > best){ best = sh; bid = r.y; bmid = abs(rd.y); }
    }
  }
  float alpha = smoothstep(0.0, 0.09, best);
  float fmi = FQ(120.0);
  float micro = fbmValue(uv * fmi, vec2(fmi), 3, 0.5, sd + 3.0);
  float vein = smoothstep(0.12, 0.0, bmid) * alpha;
  float dry = hash11(bid * 37.0 + sd);

  s.h    = clamp(0.5 + best * 0.10 + vein * 0.05 + (micro - 0.5) * 0.04, 0.0, 1.0);
  vec3 leaf = ramp3(clamp(dry * 0.8 + micro * 0.3, 0.0, 1.0), uC0, uC1, uC2);
  leaf = mix(leaf, uC3, vein * 0.5);
  leaf *= mix(0.85, 1.15, clamp(best, 0.0, 1.0));
  s.alb  = leaf;
  s.rgh  = mix(uRough.x, uRough.y, clamp(micro * 0.7 + dry * 0.3, 0.0, 1.0));
  s.mtl  = uMetal;
  s.dirt = clamp(smoothstep(0.6, 1.0, dry) * 0.3, 0.0, 1.0);
  s.wear = alpha;
  return s;
}

// ----------------------------------------------------------------- polymer
// uP0 = (mouldLinesPerMetre, -, -, -)
Surf kPolymer(vec2 uv){
  float sd = uSeed; Surf s;
  float fg = FQ(240.0);
  float grain = worleyStones(uv * fg, vec2(fg), sd + 5.0, 1.2);
  float fg2 = FQ(90.0);
  float grain2 = worleyStones(uv * fg2, vec2(fg2), sd + 9.0, 0.9);
  float fmi = FQ(150.0);
  float micro = fbmValue(uv * fmi, vec2(fmi), 3, 0.5, sd + 3.0);
  float fm = FQ(0.9);
  float macro = fbm(uv * fm, vec2(fm), 3, 0.55, sd + 13.0);
  float scuff = scratchLines(uv, FQ(7.0), sd + 21.0, 0.008, 0.22, 0.0);
  float mould = 0.0;
  if (uP0.x > 0.01){
    float d = abs(fract(uv.y * FQ(uP0.x)) - 0.5) * 2.0;
    mould = smoothstep(0.94, 1.0, d);
  }

  s.h    = clamp(0.55 + grain * 0.035 + grain2 * 0.030 + (micro - 0.5) * 0.02
                 + mould * 0.06 - scuff * 0.012, 0.0, 1.0);
  s.alb  = mix(uC0, uC1, clamp(grain * 0.5 + grain2 * 0.5, 0.0, 1.0) * 0.6)
           * mix(0.93, 1.07, macro) * mix(0.97, 1.03, micro);
  s.alb  = mix(s.alb, uC2, scuff * 0.5);
  s.rgh  = mix(uRough.x, uRough.y, clamp(grain2 * 0.5 + micro * 0.5, 0.0, 1.0));
  s.mtl  = uMetal;
  s.dirt = clamp(smoothstep(0.65, 1.0, 1.0 - macro) * 0.35, 0.0, 1.0);
  s.wear = clamp(scuff * 0.9 + grain2 * 0.25 + mould * 0.5, 0.0, 1.0);
  return s;
}

// -------------------------------------------------------------------- skin
Surf kSkin(vec2 uv){
  float sd = uSeed; Surf s;
  float fp = FQ(600.0);
  float pores = worleyStones(uv * fp, vec2(fp), sd + 5.0, 1.4);
  float fw = FQ(16.0);
  float wrinkle = ridged(domainWarp(uv * fw, vec2(fw), 0.5, sd + 11.0), vec2(fw), 3, 0.55, sd + 11.0);
  float fm = FQ(1.4);
  float mottle = fbm(domainWarp(uv * fm, vec2(fm), 0.6, sd + 17.0), vec2(fm), 4, 0.55, sd + 17.0);
  float fmi = FQ(160.0);
  float micro = fbmValue(uv * fmi, vec2(fmi), 3, 0.5, sd + 3.0);

  s.h    = clamp(0.5 - pores * 0.035 + (wrinkle - 0.5) * 0.05 + (micro - 0.5) * 0.02, 0.0, 1.0);
  vec3 col = ramp3(clamp(mottle * 0.9 + micro * 0.2, 0.0, 1.0), uC0, uC1, uC2);
  col = mix(col, uC3, smoothstep(0.62, 0.98, wrinkle) * 0.22);
  col *= mix(0.94, 1.06, micro);
  s.alb  = col;
  s.rgh  = mix(uRough.x, uRough.y, clamp(pores * 0.5 + micro * 0.5, 0.0, 1.0));
  s.mtl  = uMetal;
  s.dirt = clamp(smoothstep(0.7, 1.0, 1.0 - mottle) * 0.4, 0.0, 1.0);
  s.wear = clamp(pores * 0.5, 0.0, 1.0);
  return s;
}

// ------------------------------------------------------------------- water
Surf kWater(vec2 uv){
  float sd = uSeed; Surf s;
  float f1 = FQ(3.0), f2 = FQ(11.0), f3 = FQ(37.0);
  float a = fbm(domainWarp(uv * f1, vec2(f1), 0.35, sd), vec2(f1), 3, 0.55, sd);
  float b = fbm(uv * f2, vec2(f2), 3, 0.5, sd + 7.0);
  float c = fbmValue(uv * f3, vec2(f3), 2, 0.5, sd + 13.0);
  float h = a * 0.5 + b * 0.32 + c * 0.18;
  s.h    = clamp(0.5 + (h - 0.5) * 0.9, 0.0, 1.0);
  s.alb  = mix(uC0, uC1, h) * mix(0.94, 1.06, c);
  s.rgh  = mix(uRough.x, uRough.y, clamp(c * 0.6 + b * 0.4, 0.0, 1.0));
  s.mtl  = uMetal;
  s.dirt = 0.0;
  s.wear = 0.0;
  return s;
}

void main(){
  vec2 uv = vUv;
  Surf s;
  if      (uKind == 0)  s = kConcrete(uv);
  else if (uKind == 1)  s = kBrick(uv);
  else if (uKind == 2)  s = kGranular(uv);
  else if (uKind == 3)  s = kMetal(uv);
  else if (uKind == 4)  s = kWood(uv);
  else if (uKind == 5)  s = kFabric(uv);
  else if (uKind == 6)  s = kTile(uv);
  else if (uKind == 7)  s = kGlass(uv);
  else if (uKind == 8)  s = kRubber(uv);
  else if (uKind == 9)  s = kFoliage(uv);
  else if (uKind == 10) s = kPolymer(uv);
  else if (uKind == 11) s = kSkin(uv);
  else                  s = kWater(uv);

  oAH = vec4(linearToSrgb(clamp(s.alb, 0.0, 1.0)), s.h);
  oMK = vec4(clamp(s.rgh, 0.0, 1.0), clamp(s.mtl, 0.0, 1.0),
             clamp(s.dirt, 0.0, 1.0), clamp(s.wear, 0.0, 1.0));
}
`;

// ---------------------------------------------------------------------------
// Combine pass — curvature edge wear, cavity dirt, gravity streaks,
// micro roughness break-up, wetness. Outputs final albedo + packed ORM.
// ---------------------------------------------------------------------------
const FRAG_COMBINE = GLSL_LIB + /* glsl */`
uniform sampler2D uAH;
uniform sampler2D uMK;
uniform sampler2D uNA;
uniform vec2  uTexel;
uniform vec3  uDirtCol;
uniform vec3  uWearCol;
uniform vec4  uWearP;      // x = edge wear, y = cavity dirt, z = streak, w = curvature scale
uniform vec2  uRoughClamp;
uniform vec3  uMicro;      // x = frequency, y = amount, z = dirt roughness add
uniform float uAOAmount;
uniform float uWet;
uniform float uAlphaFromWear;
uniform float uMetalDirtDrop;

layout(location = 0) out vec4 oAlbedo;   // sRGB target: write linear, hardware encodes
layout(location = 1) out vec4 oORM;      // r = AO, g = roughness, b = metalness

void main(){
  vec2 uv = vUv;
  vec4 AH = texture(uAH, uv);
  vec4 MK = texture(uMK, uv);
  vec4 NA = texture(uNA, uv);

  vec3 alb = srgbToLinear(AH.rgb);
  float ao = NA.a;

  float hc = AH.a;
  float hl = texture(uAH, uv - vec2(uTexel.x, 0.0)).a;
  float hr = texture(uAH, uv + vec2(uTexel.x, 0.0)).a;
  float hd = texture(uAH, uv - vec2(0.0, uTexel.y)).a;
  float hu = texture(uAH, uv + vec2(0.0, uTexel.y)).a;
  float lap = (hl + hr + hd + hu) - 4.0 * hc;
  float convex  = clamp(-lap * uWearP.w, 0.0, 1.0);
  float concave = clamp( lap * uWearP.w, 0.0, 1.0);

  // --- abrasion on exposed edges / high points ---------------------------
  float wear = clamp((convex * 0.85 + smoothstep(0.60, 1.0, hc) * 0.28) * MK.a * uWearP.x, 0.0, 1.0);
  alb = mix(alb, uWearCol, wear * 0.68);

  // --- dirt: cavity accumulation + gravity-driven vertical streaking ------
  float cav = smoothstep(0.90, 0.32, ao);
  float dirt = clamp(cav * uWearP.y
                   + concave * 0.25 * uWearP.y
                   + MK.b * uWearP.z, 0.0, 1.0);
  dirt *= 1.0 - wear * 0.55;
  alb = mix(alb, uDirtCol, dirt * 0.62);

  // --- micro roughness break-up (roughness is never constant) -------------
  float micro = fbmValue(uv * vec2(uMicro.x), vec2(uMicro.x), 3, 0.5, 7.0);
  float rough = MK.r + (micro - 0.5) * uMicro.y + dirt * uMicro.z - wear * 0.05;

  // --- wetness: pools in cavities, darkens and polishes -------------------
  float wet = uWet * clamp(0.28 + concave * 0.8 + cav * 0.6, 0.0, 1.0);
  alb *= mix(1.0, 0.66, wet);
  rough = mix(rough, 0.09, wet * 0.85);

  rough = clamp(rough, uRoughClamp.x, uRoughClamp.y);
  float metal = clamp(MK.g - dirt * uMetalDirtDrop, 0.0, 1.0);

  oAlbedo = vec4(clamp(alb, 0.0, 1.0), mix(1.0, MK.a, uAlphaFromWear));
  oORM = vec4(mix(1.0, ao, uAOAmount), rough, metal, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Runtime shader injection: UV repeat, anti-tiling macro layer, detail normal,
// triplanar projection, wetness.
// ---------------------------------------------------------------------------
const OS_PARS = /* glsl */`
uniform vec4 uOsUv;       // xy = repeat, zw = offset
uniform vec4 uOsMacro;    // x = world frequency, y = albedo amount, z = roughness amount
uniform vec4 uOsDetail;   // x = uv scale, y = strength, z = fade far, w = fade near
uniform vec2 uOsTri;      // x = wetness 0..1 (live), y = metres per tile (triplanar)
uniform float uOsAo;
varying vec3 vOsWPos;
varying vec3 vOsWNrm;

float osHash(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float osVn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(osHash(i), osHash(i + vec2(1.0, 0.0)), f.x),
             mix(osHash(i + vec2(0.0, 1.0)), osHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float osMacroNoise(vec2 p){
  return osVn(p) * 0.58 + osVn(p * 2.37 + 11.3) * 0.28 + osVn(p * 5.71 + 3.1) * 0.14;
}
`;

const OS_SURFACE = /* glsl */`
vec3 osAlb; vec3 osNrm; float osR; float osM; float osAO; float osAlpha = 1.0;
{
  vec3 orm;
  #ifdef OS_TRIPLANAR
    vec3 wn = normalize(vOsWNrm);
    vec3 bw = pow(abs(wn), vec3(5.0));
    bw /= max(bw.x + bw.y + bw.z, 1e-4);
    vec3 tp = vOsWPos / max(uOsTri.y, 1e-3);
    vec2 uvX = vec2(tp.z * -sign(wn.x), tp.y);
    vec2 uvY = vec2(tp.x, tp.z * sign(wn.y));
    vec2 uvZ = vec2(tp.x * sign(wn.z), tp.y);
    osAlb = texture2D(map, uvX).rgb * bw.x + texture2D(map, uvY).rgb * bw.y + texture2D(map, uvZ).rgb * bw.z;
    orm   = texture2D(roughnessMap, uvX).rgb * bw.x + texture2D(roughnessMap, uvY).rgb * bw.y + texture2D(roughnessMap, uvZ).rgb * bw.z;
    vec3 nx = texture2D(normalMap, uvX).xyz * 2.0 - 1.0;
    vec3 ny = texture2D(normalMap, uvY).xyz * 2.0 - 1.0;
    vec3 nz = texture2D(normalMap, uvZ).xyz * 2.0 - 1.0;
    nx = vec3(nx.xy + wn.zy, abs(nx.z) * wn.x);
    ny = vec3(ny.xy + wn.xz, abs(ny.z) * wn.y);
    nz = vec3(nz.xy + wn.xy, abs(nz.z) * wn.z);
    osNrm = normalize(nx.zyx * bw.x + ny.xzy * bw.y + nz.xyz * bw.z);
  #else
    vec2 osUv = vMapUv * uOsUv.xy + uOsUv.zw;
    vec4 osMapTexel = texture2D(map, osUv);
    osAlb = osMapTexel.rgb;
    osAlpha = osMapTexel.a;
    orm = texture2D(roughnessMap, osUv).rgb;
    osNrm = texture2D(normalMap, osUv).xyz * 2.0 - 1.0;
    float osDist = length(vViewPosition);
    float osDf = uOsDetail.y * smoothstep(uOsDetail.z, uOsDetail.w, osDist);
    if (osDf > 0.002) {
      vec3 dn = texture2D(normalMap, osUv * uOsDetail.x).xyz * 2.0 - 1.0;
      osNrm = normalize(vec3(osNrm.xy + dn.xy * osDf, osNrm.z));
    }
  #endif
  osAO = orm.r; osR = orm.g; osM = orm.b;

  // --- anti-tiling ------------------------------------------------------
  // (a) the map re-sampled at a large non-harmonic scale, normalised by its own
  //     mean (the 1x1 mip), used as a multiply layer. Derived from the material
  //     itself so the break-up always reads as the same substance.
  #if !defined( OS_TRIPLANAR ) && !defined( OS_NO_MACROTEX )
  {
    vec3 osAvg = textureLod(map, vec2(0.5), 20.0).rgb;
    vec2 osLowUv = mat2(0.8018, -0.5976, 0.5976, 0.8018) * osUv * uOsMacro.w;
    vec3 osLow = texture2D(map, osLowUv).rgb;
    vec3 ratio = osLow / max(osAvg, vec3(0.0035));
    osAlb *= clamp(mix(vec3(1.0), ratio, uOsMacro.y * 1.5), vec3(0.60), vec3(1.60));
  }
  #endif
  // (b) a large-scale world-space noise so even flat-coloured surfaces vary
  vec2 mp = vec2(vOsWPos.x + vOsWPos.z * 0.71, vOsWPos.y * 0.83 + vOsWPos.z * 0.41) * uOsMacro.x;
  float mv = osMacroNoise(mp);
  osAlb *= mix(1.0 - uOsMacro.y * 0.7, 1.0 + uOsMacro.y * 0.7, mv);
  osR = clamp(osR + (mv - 0.5) * uOsMacro.z, 0.035, 1.0);

  if (uOsTri.x > 0.001) {
    float pw = smoothstep(0.34, 0.78, osMacroNoise(vOsWPos.xz * 0.42)) * uOsTri.x;
    osAlb *= mix(1.0, 0.48, pw);
    osR = mix(osR, 0.055, pw * 0.92);
    osNrm = normalize(mix(osNrm, vec3(0.0, 0.0, 1.0), pw * 0.65));
  }
}
diffuseColor.rgb *= osAlb;
diffuseColor.a *= osAlpha;
`;

const OS_NORMAL = /* glsl */`
#ifdef OS_TRIPLANAR
  normal = normalize((viewMatrix * vec4(osNrm, 0.0)).xyz);
  #ifdef DOUBLE_SIDED
    normal *= faceDirection;
  #endif
#else
  vec3 osMapN = osNrm;
  osMapN.xy *= normalScale;
  normal = normalize(tbn * osMapN);
#endif
`;

const OS_AO = /* glsl */`
{
  float ambientOcclusion = (osAO - 1.0) * uOsAo + 1.0;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
}
`;

const OS_VERT_PARS = /* glsl */`
varying vec3 vOsWPos;
varying vec3 vOsWNrm;
`;

const OS_VERT_BODY = /* glsl */`
#ifdef USE_INSTANCING
  vOsWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vOsWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vOsWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vOsWNrm = normalize(mat3(modelMatrix) * objectNormal);
#endif
`;

// ---------------------------------------------------------------------------
// Procedural sky used for the PMREM environment (ARTDIRECTION.md values).
// ---------------------------------------------------------------------------
const SUN_ELEVATION = 22 * Math.PI / 180;
const SUN_AZIMUTH = 118 * Math.PI / 180;

const ENV_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const ENV_FRAG = /* glsl */`
varying vec3 vDir;
uniform vec3 uSunDir, uSun, uZenith, uHorizon, uGround;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
  sky = mix(sky, uHorizon * 1.06, smoothstep(0.16, 0.0, abs(h)) * 0.55);
  vec3 col = (h < 0.0)
    ? mix(uHorizon * 0.72, uGround, clamp(-h * 2.6, 0.0, 1.0))
    : sky;
  float ca = max(dot(d, uSunDir), 0.0);
  col += uSun * pow(ca, 1400.0) * 70.0;
  col += uSun * pow(ca, 30.0) * 0.40;
  col += uSun * pow(ca, 5.0) * 0.10;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Material definitions.
//   tier    texture tier (hero = base size, mid = 1/2, small = 1/4)
//   p0/p1   recipe parameters (documented above each recipe)
//   cols    four palette colours (sRGB hex)
//   rough   [min, max] of the base roughness field
//   height  normal-map height scale, as a fraction of the tile width
//   ao      [radius (uv), strength]
//   wear    [edgeWear, cavityDirt, streak, curvatureScale]
//   micro   [sizeDivisor, roughnessAmount, dirtRoughnessAdd]
//   macro   [worldFrequency, albedoAmount, roughnessAmount]  (runtime anti-tiling)
//   detail  [uvScale, strength, fadeFar, fadeNear]           (runtime detail normal)
// ---------------------------------------------------------------------------
const DEFS = {
  concrete_wall: {
    tier: 'hero', kind: K.CONCRETE, surface: 'concrete', pen: 0.22, seed: 11,
    p0: [1.0, 0.70, 0.85, 0.65], p1: [0.60, 0.0, 0.55, 26],
    cols: ['#9b9791', '#6b6862', '#b2ada5', '#c0bab0'],
    rough: [0.68, 0.94], metal: 0, height: 0.036, ao: [0.028, 1.4],
    wear: [0.55, 0.52, 0.40, 26], dirtCol: '#565149', wearCol: '#b9b0a2',
    micro: [12, 0.14, 0.10], macro: [0.09, 0.13, 0.10], detail: [7.0, 0.55, 5.0, 0.5],
    normalScale: 1.0, aoAmount: 1.0,
  },
  concrete_floor: {
    tier: 'hero', kind: K.CONCRETE, surface: 'concrete', pen: 0.18, seed: 23,
    p0: [0.85, 0.70, 0.42, 0.0], p1: [0.8, 0.35, 0.40, 30],
    cols: ['#8f8d87', '#5d5b55', '#a7a39b', '#b3aea4'],
    rough: [0.62, 0.92], metal: 0, height: 0.030, ao: [0.028, 1.4],
    wear: [0.45, 0.58, 0.28, 26], dirtCol: '#4a453c', wearCol: '#a8a091',
    micro: [12, 0.14, 0.12], macro: [0.07, 0.14, 0.12], detail: [7.0, 0.5, 5.0, 0.5],
    normalScale: 0.9, aoAmount: 1.0,
  },
  plaster_wall: {
    tier: 'mid', kind: K.CONCRETE, surface: 'plaster', pen: 0.5, seed: 37,
    p0: [0.12, 0.22, 0.85, 0.0], p1: [0.55, 0.8, 0.45, 18],
    cols: ['#b9ae9c', '#8a7f6c', '#c8bda8', '#a3907a'],
    rough: [0.72, 0.96], metal: 0, height: 0.030, ao: [0.028, 1.4],
    wear: [0.7, 0.6, 0.5, 24], dirtCol: '#59503f', wearCol: '#a09277',
    micro: [12, 0.12, 0.10], macro: [0.11, 0.15, 0.09], detail: [6.0, 0.5, 4.5, 0.5],
    normalScale: 0.85, aoAmount: 1.0,
  },
  asphalt: {
    tier: 'hero', kind: K.CONCRETE, surface: 'concrete', pen: 0.15, seed: 51,
    p0: [0.75, 0.40, 0.55, 0.0], p1: [0.60, 0.0, 0.22, 46],
    cols: ['#3a3a3c', '#2a2a2c', '#4c4a48', '#5a564f'],
    rough: [0.55, 0.86], metal: 0, height: 0.020, ao: [0.024, 1.2],
    wear: [0.40, 0.45, 0.25, 26], dirtCol: '#232326', wearCol: '#57544d',
    micro: [12, 0.13, 0.08], macro: [0.06, 0.11, 0.12], detail: [7.0, 0.55, 5.0, 0.5],
    normalScale: 0.62, aoAmount: 1.0, wet: 0.18,
  },
  brick: {
    tier: 'hero', kind: K.BRICK, surface: 'brick', pen: 0.28, seed: 67,
    p0: [4.6, 13.4, 0.012, 0.9], p1: [0.6, 0.35, 0.0, 0.0],
    cols: ['#8c5b45', '#6e4a3a', '#8a7460', '#a9a293'],
    rough: [0.70, 0.95], metal: 0, height: 0.055, ao: [0.032, 1.6],
    wear: [0.5, 0.75, 0.45, 24], dirtCol: '#463c31', wearCol: '#a4795c',
    micro: [12, 0.13, 0.10], macro: [0.08, 0.12, 0.09], detail: [6.0, 0.5, 5.0, 0.5],
    normalScale: 1.0, aoAmount: 1.0,
  },
  sand: {
    tier: 'mid', kind: K.GRANULAR, surface: 'sand', pen: 0.72, seed: 83,
    p0: [90, 0.030, 3.0, 0.10], p1: [1.0, 0.35, 0.10, 0],
    cols: ['#c4b092', '#ac997c', '#d4c7ab', '#9d9078'],
    rough: [0.82, 1.0], metal: 0, height: 0.030, ao: [0.026, 1.4],
    wear: [0.2, 0.5, 0.1, 20], dirtCol: '#7d6a4e', wearCol: '#d8c9a8',
    micro: [12, 0.10, 0.06], macro: [0.10, 0.12, 0.07], detail: [6.0, 0.45, 4.0, 0.4],
    normalScale: 0.8, aoAmount: 1.0,
  },
  dirt: {
    tier: 'mid', kind: K.GRANULAR, surface: 'dirt', pen: 0.68, seed: 97,
    p0: [40, 0.055, 1.2, 0.06], p1: [1.0, 0.65, 0.45, 0],
    cols: ['#6d5c48', '#544636', '#82705a', '#8d8272'],
    rough: [0.82, 1.0], metal: 0, height: 0.048, ao: [0.030, 1.5],
    wear: [0.3, 0.55, 0.12, 22], dirtCol: '#3a2f24', wearCol: '#8b7c64',
    micro: [12, 0.12, 0.07], macro: [0.09, 0.15, 0.08], detail: [6.0, 0.5, 4.0, 0.4],
    normalScale: 1.0, aoAmount: 1.0,
  },
  gravel: {
    tier: 'mid', kind: K.GRANULAR, surface: 'gravel', pen: 0.6, seed: 109,
    p0: [20, 0.11, 0.8, 0.03], p1: [0.8, 0.95, 0.70, 0],
    cols: ['#7c766c', '#5b564e', '#96897a', '#a29a8c'],
    rough: [0.78, 1.0], metal: 0, height: 0.075, ao: [0.034, 1.7],
    wear: [0.45, 0.70, 0.18, 22], dirtCol: '#3d382f', wearCol: '#a09786',
    micro: [12, 0.13, 0.08], macro: [0.11, 0.13, 0.09], detail: [6.0, 0.5, 4.0, 0.4],
    normalScale: 1.0, aoAmount: 1.0,
  },
  rubble: {
    tier: 'mid', kind: K.GRANULAR, surface: 'gravel', pen: 0.55, seed: 113,
    p0: [14, 0.14, 0.6, 0.04], p1: [0.9, 0.9, 0.75, 0],
    cols: ['#8b857a', '#63594e', '#a49a8b', '#7d6455'],
    rough: [0.76, 1.0], metal: 0, height: 0.090, ao: [0.036, 1.8],
    wear: [0.55, 0.75, 0.22, 22], dirtCol: '#413a31', wearCol: '#b0a695',
    micro: [12, 0.13, 0.08], macro: [0.13, 0.14, 0.09], detail: [5.0, 0.5, 4.0, 0.4],
    normalScale: 1.0, aoAmount: 1.0, triplanar: true,
  },
  metal_painted: {
    tier: 'hero', kind: K.METAL, surface: 'metal', pen: 0.32, seed: 127,
    p0: [0.38, 0.80, 0.0, 0.55], p1: [0.34, 1.0, 0.0, 0],
    cols: ['#687575', '#9aa0a4', '#63381f', '#95502f'],
    rough: [0.42, 0.74], metal: 0.05, height: 0.026, ao: [0.026, 1.3],
    wear: [0.85, 0.5, 0.6, 24], dirtCol: '#3a3128', wearCol: '#9aa0a3',
    micro: [12, 0.12, 0.14], macro: [0.10, 0.10, 0.10], detail: [6.0, 0.5, 4.0, 0.4],
    normalScale: 0.85, aoAmount: 1.0, metalDirtDrop: 0.4,
  },
  metal_rusted: {
    tier: 'mid', kind: K.METAL, surface: 'metal', pen: 0.38, seed: 131,
    p0: [1.0, 0.85, 0.0, 0.4], p1: [0.35, 1.0, 0.0, 0],
    cols: ['#6b6560', '#8e8b86', '#6b4a38', '#9c5a2c'],
    rough: [0.55, 0.9], metal: 0.35, height: 0.040, ao: [0.030, 1.5],
    wear: [0.75, 0.6, 0.8, 24], dirtCol: '#4a2f1e', wearCol: '#a0968c',
    micro: [12, 0.14, 0.12], macro: [0.10, 0.13, 0.12], detail: [6.0, 0.55, 4.5, 0.4],
    normalScale: 1.0, aoAmount: 1.0, metalDirtDrop: 0.55,
  },
  metal_brushed: {
    tier: 'mid', kind: K.METAL, surface: 'metal', pen: 0.3, seed: 137,
    p0: [0.06, 0.0, 1.0, 0.0], p1: [0.18, 0.5, 0.0, 0],
    cols: ['#a8acaf', '#c2c6c9', '#6b5040', '#8a5a38'],
    rough: [0.26, 0.50], metal: 0.92, height: 0.014, ao: [0.020, 1.0],
    wear: [0.55, 0.35, 0.25, 22], dirtCol: '#3e3c38', wearCol: '#c3c7ca',
    micro: [12, 0.10, 0.10], macro: [0.09, 0.06, 0.07], detail: [6.0, 0.45, 3.5, 0.35],
    normalScale: 0.7, aoAmount: 0.9, metalDirtDrop: 0.25,
  },
  wood_plank: {
    tier: 'mid', kind: K.WOOD, surface: 'wood', pen: 0.66, seed: 149,
    p0: [5.5, 42, 0.9, 0.008], p1: [0.75, 0.8, 0.0, 1.8],
    cols: ['#8a6f4d', '#6a5337', '#a68e69', '#43301f'],
    rough: [0.62, 0.92], metal: 0, height: 0.038, ao: [0.030, 1.7],
    wear: [0.6, 0.75, 0.5, 24], dirtCol: '#382a1c', wearCol: '#9b8768',
    micro: [12, 0.13, 0.09], macro: [0.10, 0.13, 0.09], detail: [6.0, 0.5, 4.5, 0.45],
    normalScale: 0.95, aoAmount: 1.0,
  },
  wood_crate: {
    tier: 'mid', kind: K.WOOD, surface: 'wood', pen: 0.74, seed: 151,
    p0: [7.5, 30, 0.55, 0.006], p1: [0.5, 0.65, 0.0, 1.0],
    cols: ['#a08a5f', '#7d6444', '#b49b72', '#4a3722'],
    rough: [0.66, 0.94], metal: 0, height: 0.034, ao: [0.028, 1.6],
    wear: [0.7, 0.6, 0.4, 24], dirtCol: '#3d2f1f', wearCol: '#c0aa82',
    micro: [12, 0.13, 0.09], macro: [0.11, 0.12, 0.09], detail: [6.0, 0.5, 4.5, 0.45],
    normalScale: 0.9, aoAmount: 1.0,
  },
  glass: {
    tier: 'small', kind: K.GLASS, surface: 'glass', pen: 0.92, seed: 163,
    p0: [0, 0, 0, 0], p1: [0, 0, 0, 0],
    cols: ['#c8d2d4', '#9aa39c', '#ffffff', '#ffffff'],
    rough: [0.04, 0.42], metal: 0, height: 0.006, ao: [0.014, 0.6],
    wear: [0.2, 0.25, 0.45, 14], dirtCol: '#6a6b60', wearCol: '#dfe6e8',
    micro: [14, 0.06, 0.14], macro: [0.12, 0.05, 0.05], detail: [5.0, 0.3, 3.0, 0.3],
    normalScale: 0.35, aoAmount: 0.6,
    mat: {
      transparent: true, opacity: 0.24, side: THREE.DoubleSide,
      envMapIntensity: 1.7, depthWrite: false,
    },
  },
  tile: {
    tier: 'mid', kind: K.TILE, surface: 'tile', pen: 0.42, seed: 167,
    p0: [5.0, 0.006, 0.6, 1.0], p1: [0.8, 0.7, 0.7, 0],
    cols: ['#a8a99e', '#8e9086', '#c0bdb0', '#8d887c'],
    rough: [0.18, 0.85], metal: 0, height: 0.030, ao: [0.028, 1.5],
    wear: [0.55, 0.75, 0.5, 26], dirtCol: '#454036', wearCol: '#b7b3a6',
    micro: [12, 0.10, 0.16], macro: [0.10, 0.09, 0.10], detail: [6.0, 0.45, 4.0, 0.4],
    normalScale: 0.9, aoAmount: 1.0,
  },
  fabric_canvas: {
    tier: 'mid', kind: K.FABRIC, surface: 'fabric', pen: 0.84, seed: 173,
    p0: [110, 0.6, 0.0, 0.0], p1: [0.8, 0.22, 0.0, 0],
    cols: ['#a49b83', '#877e67', '#bab09a', '#6d675a'],
    rough: [0.78, 0.98], metal: 0, height: 0.028, ao: [0.026, 1.4],
    wear: [0.28, 0.6, 0.55, 22], dirtCol: '#4c4132', wearCol: '#b8ac93',
    micro: [12, 0.10, 0.08], macro: [0.12, 0.11, 0.07], detail: [5.0, 0.5, 3.5, 0.35],
    normalScale: 0.9, aoAmount: 1.0,
  },
  camo_fabric: {
    tier: 'mid', kind: K.FABRIC, surface: 'fabric', pen: 0.84, seed: 179,
    p0: [130, 0.5, 1.0, 0.0], p1: [0.55, 0.18, 0.0, 0],
    cols: ['#6e7146', '#4d5236', '#8a815c', '#3a3a2c'],
    rough: [0.74, 0.96], metal: 0, height: 0.022, ao: [0.024, 1.5],
    wear: [0.20, 0.6, 0.45, 22], dirtCol: '#3e3a2a', wearCol: '#7e7a60',
    micro: [12, 0.10, 0.08], macro: [0.13, 0.09, 0.07], detail: [5.0, 0.45, 3.0, 0.3],
    normalScale: 0.8, aoAmount: 1.0,
  },
  tac_nylon: {
    tier: 'mid', kind: K.FABRIC, surface: 'fabric', pen: 0.8, seed: 181,
    p0: [150, 0.35, 0.0, 22], p1: [0.45, 0.16, 6.0, 0],
    cols: ['#4a4a42', '#38382f', '#5c5c50', '#2c2c26'],
    rough: [0.62, 0.88], metal: 0, height: 0.020, ao: [0.022, 1.5],
    wear: [0.26, 0.5, 0.4, 22], dirtCol: '#26241e', wearCol: '#63635a',
    micro: [12, 0.10, 0.08], macro: [0.14, 0.08, 0.07], detail: [5.0, 0.45, 3.0, 0.3],
    normalScale: 0.8, aoAmount: 1.0,
  },
  sandbag: {
    tier: 'mid', kind: K.FABRIC, surface: 'fabric', pen: 0.5, seed: 191,
    p0: [80, 0.75, 0.0, 0.0], p1: [1.0, 0.30, 0.0, 0],
    cols: ['#9c8f6e', '#7b6f52', '#b0a281', '#5e5540'],
    rough: [0.82, 1.0], metal: 0, height: 0.034, ao: [0.030, 1.5],
    wear: [0.32, 0.65, 0.6, 22], dirtCol: '#463d2c', wearCol: '#b0a488',
    micro: [12, 0.11, 0.08], macro: [0.11, 0.13, 0.08], detail: [5.0, 0.5, 3.5, 0.35],
    normalScale: 1.0, aoAmount: 1.0,
  },
  rubber: {
    tier: 'small', kind: K.RUBBER, surface: 'rubber', pen: 0.55, seed: 193,
    p0: [0.0, 0, 0, 0], p1: [0, 0, 0, 0],
    cols: ['#2b2c2d', '#1e1f20', '#4a4a48', '#3a3a38'],
    rough: [0.55, 0.86], metal: 0, height: 0.022, ao: [0.024, 1.5],
    wear: [0.5, 0.5, 0.3, 22], dirtCol: '#242320', wearCol: '#55534e',
    micro: [12, 0.12, 0.10], macro: [0.14, 0.08, 0.09], detail: [5.0, 0.5, 3.0, 0.3],
    normalScale: 0.9, aoAmount: 1.0,
  },
  foliage: {
    tier: 'mid', kind: K.FOLIAGE, surface: 'foliage', pen: 0.95, seed: 197,
    p0: [7.0, 0.45, 0, 0], p1: [0, 0, 0, 0],
    cols: ['#6e7146', '#565a34', '#8b8a52', '#3f4327'],
    rough: [0.55, 0.85], metal: 0, height: 0.020, ao: [0.022, 1.2],
    wear: [0.0, 0.35, 0.1, 18], dirtCol: '#3c3a26', wearCol: '#7f8050',
    micro: [12, 0.10, 0.06], macro: [0.16, 0.14, 0.07], detail: [5.0, 0.4, 3.0, 0.3],
    normalScale: 0.8, aoAmount: 0.9, alphaFromWear: 1,
    mat: { side: THREE.DoubleSide, alphaTest: 0.42, envMapIntensity: 0.85 },
  },
  gun_metal: {
    tier: 'mid', kind: K.METAL, surface: 'metal', pen: 0.2, seed: 199,
    p0: [0.10, 0.30, 0.35, 0.0], p1: [0.42, 0.35, 0.0, 0],
    cols: ['#3b3d40', '#8f9296', '#5a4034', '#7a4a2c'],
    rough: [0.30, 0.58], metal: 0.85, height: 0.012, ao: [0.018, 1.1],
    wear: [1.0, 0.4, 0.2, 20], dirtCol: '#2a2724', wearCol: '#b4b8bc',
    micro: [12, 0.10, 0.08], macro: [0.22, 0.06, 0.07], detail: [5.0, 0.4, 2.0, 0.15],
    normalScale: 0.7, aoAmount: 1.0, metalDirtDrop: 0.2,
    mat: { envMapIntensity: 1.35 },
  },
  gun_polymer: {
    tier: 'small', kind: K.POLYMER, surface: 'rubber', pen: 0.45, seed: 211,
    p0: [0.0, 0, 0, 0], p1: [0, 0, 0, 0],
    cols: ['#2b2d2b', '#3a3c39', '#4c4e49', '#22231f'],
    rough: [0.42, 0.72], metal: 0, height: 0.010, ao: [0.016, 1.1],
    wear: [0.7, 0.45, 0.2, 20], dirtCol: '#1e1f1c', wearCol: '#5d5f59',
    micro: [12, 0.10, 0.08], macro: [0.26, 0.06, 0.07], detail: [5.0, 0.4, 2.0, 0.15],
    normalScale: 0.75, aoAmount: 1.0, mat: { envMapIntensity: 1.1 },
  },
  gun_wood: {
    tier: 'small', kind: K.WOOD, surface: 'wood', pen: 0.6, seed: 223,
    p0: [1.0, 90, 0.35, 0.0], p1: [0.15, 0.35, 0.0, 3.0],
    cols: ['#6b4a2e', '#4a3220', '#8a6440', '#2e2013'],
    rough: [0.28, 0.55], metal: 0, height: 0.012, ao: [0.016, 1.0],
    wear: [0.6, 0.4, 0.15, 20], dirtCol: '#2a1d12', wearCol: '#8f6c46',
    micro: [12, 0.09, 0.08], macro: [0.24, 0.07, 0.07], detail: [5.0, 0.4, 2.0, 0.15],
    normalScale: 0.7, aoAmount: 1.0, mat: { envMapIntensity: 1.2 },
  },
  skin: {
    tier: 'mid', kind: K.SKIN, surface: 'flesh', pen: 0.88, seed: 227,
    p0: [0, 0, 0, 0], p1: [0, 0, 0, 0],
    cols: ['#a08b7c', '#87766a', '#b0a08f', '#77655c'],
    rough: [0.42, 0.66], metal: 0, height: 0.010, ao: [0.018, 1.1],
    wear: [0.18, 0.30, 0.15, 18], dirtCol: '#54443a', wearCol: '#c2a68f',
    micro: [12, 0.08, 0.06], macro: [0.35, 0.06, 0.05], detail: [5.0, 0.45, 2.0, 0.2],
    normalScale: 0.6, aoAmount: 0.9,
  },
  water: {
    tier: 'small', kind: K.WATER, surface: 'water', pen: 0.9, seed: 229,
    p0: [0, 0, 0, 0], p1: [0, 0, 0, 0],
    cols: ['#2b3236', '#3c464b', '#ffffff', '#ffffff'],
    rough: [0.03, 0.12], metal: 0, height: 0.010, ao: [0.014, 0.6],
    wear: [0.0, 0.0, 0.0, 12], dirtCol: '#20262a', wearCol: '#39434a',
    micro: [16, 0.03, 0.0], macro: [0.10, 0.04, 0.03], detail: [4.0, 0.35, 6.0, 0.5],
    normalScale: 0.55, aoAmount: 0.5,
    mat: { transparent: true, opacity: 0.78, envMapIntensity: 1.7 },
    animate: [0.010, 0.004],
  },
};

const C = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const V3 = (c) => new THREE.Vector3(c.r, c.g, c.b);

// ---------------------------------------------------------------------------
export default class Materials {
  static id = 'materials';

  constructor(ctx) {
    this.ctx = ctx;
    this.names = Object.keys(DEFS);
    this.env = null;
    this.sun = {
      direction: new THREE.Vector3(
        Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
        Math.sin(SUN_ELEVATION),
        Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
      ).normalize(),
      color: new THREE.Color('#fff2d8'),
      intensity: 3.4,
    };
    this._sets = new Map();      // name -> { albedo, normal, orm, tileMeters, size, rts }
    this._cache = new Map();     // cache key -> THREE.Material
    this._standalone = new Map();
    this._animated = [];
    this._texgen = null;
    this._pmrem = null;
    this._envRT = null;
    this._adopted = false;
  }

  // -- lifecycle -------------------------------------------------------------
  async init() {
    const t0 = performance.now();
    const q = this.ctx.settings?.quality || 'high';
    const override = Number(new URLSearchParams(location.search).get('texsize'));
    this.baseSize = override > 0 ? override : (BASE_SIZE[q] ?? 1024);
    this.quality = q;

    this._texgen = new TexGen(this.ctx.renderer, { anisotropy: q === 'low' ? 4 : 16 });
    this._buildEnv();

    const scratch = new Map();   // size -> reusable intermediate target
    for (const name of this.names) this._generate(name, scratch);
    this._texgen.releaseTemp([...scratch.values()]);

    // Fallback environment so surfaces read correctly even before sky.js loads.
    if (!this.ctx.scene.environment) this.ctx.scene.environment = this.env;
    if (this.ctx.viewScene && !this.ctx.viewScene.environment) {
      this.ctx.viewScene.environment = this.env;
    }

    this.genMs = Math.round(performance.now() - t0);
    console.log(`[materials] ${this.names.length} sets @ base ${this.baseSize}px (${q}) `
      + `in ${this.genMs}ms`);
  }

  update(dt) {
    for (const a of this._animated) {
      a.os.uv.z = (a.os.uv.z + a.sx * dt) % 1;
      a.os.uv.w = (a.os.uv.w + a.sy * dt) % 1;
    }
    if (!this._adopted && this.ctx.frame > 2) {
      this._adopted = true;
      const skyEnv = this.ctx.sky?.envMap || this.ctx.sky?.environment;
      if (skyEnv && skyEnv.isTexture && skyEnv !== this.env) {
        this.env = skyEnv;
        if (this.ctx.viewScene) this.ctx.viewScene.environment = skyEnv;
      }
    }
  }

  dispose() {
    for (const m of this._cache.values()) m.dispose();
    this._cache.clear();
    for (const s of this._standalone.values()) {
      for (const t of Object.values(s)) if (t && t.isTexture) t.dispose();
    }
    this._standalone.clear();
    this._sets.clear();
    this._texgen?.dispose();
    this._envRT?.dispose();
    this._pmrem?.dispose();
  }

  // -- generation ------------------------------------------------------------
  _sizeFor(def) {
    const s = this.baseSize * (TIER_SCALE[def.tier] ?? 0.5);
    return Math.max(128, Math.min(2048, 1 << Math.round(Math.log2(s))));
  }

  _generate(name, scratch) {
    const def = DEFS[name];
    const tg = this._texgen;
    const size = this._sizeFor(def);
    const tileM = size / PX_PER_METRE;

    // pass 1 — recipe (intermediate target, reused per resolution)
    let inter = scratch.get(size);
    if (!inter) {
      inter = tg.createTarget(size, size, { count: 2, mips: false });
      scratch.set(size, inter);
    }
    const c = def.cols.map(C);
    tg.pass(FRAG_RECIPE, {
      uKind: def.kind,
      uSeed: def.seed,
      uTileM: tileM,
      uP0: new THREE.Vector4(...def.p0),
      uP1: new THREE.Vector4(...def.p1),
      uC0: V3(c[0]), uC1: V3(c[1]), uC2: V3(c[2]), uC3: V3(c[3]),
      uRough: new THREE.Vector2(def.rough[0], def.rough[1]),
      uMetal: def.metal ?? 0,
    }, inter);

    // pass 2 — normal + AO (this target is kept as the final normal map)
    const normalRT = tg.normalAO(inter.textures[0], size, size, {
      strength: def.height,
      aoRadius: def.ao[0],
      aoStrength: def.ao[1],
      mips: true,
    });

    // pass 3 — combine into the final albedo + ORM pair
    const finalRT = tg.createTarget(size, size, { count: 2, mips: true, srgb: [0] });
    tg.pass(FRAG_COMBINE, {
      uAH: inter.textures[0],
      uMK: inter.textures[1],
      uNA: normalRT.textures[0],
      uTexel: new THREE.Vector2(1 / size, 1 / size),
      uDirtCol: V3(C(def.dirtCol)),
      uWearCol: V3(C(def.wearCol)),
      uWearP: new THREE.Vector4(...def.wear),
      uRoughClamp: new THREE.Vector2(
        Math.max(0.035, def.rough[0] - 0.22), Math.min(1.0, def.rough[1] + 0.14)),
      uMicro: new THREE.Vector3(
        Math.max(8, Math.round(size / (def.micro[0] || 12))), def.micro[1], def.micro[2]),
      uAOAmount: def.aoAmount ?? 1.0,
      uWet: def.wet ?? 0.0,
      uAlphaFromWear: def.alphaFromWear ?? 0.0,
      uMetalDirtDrop: def.metalDirtDrop ?? 0.0,
    }, finalRT);

    const albedo = finalRT.textures[0];
    const orm = finalRT.textures[1];
    const normal = normalRT.textures[0];
    albedo.name = `${name}_albedo`;
    normal.name = `${name}_normal`;
    orm.name = `${name}_orm`;

    this._sets.set(name, {
      albedo, normal, orm, tileMeters: tileM, size, def,
      rts: [finalRT, normalRT],
    });
  }

  // -- environment -----------------------------------------------------------
  _buildEnv() {
    const pmrem = new THREE.PMREMGenerator(this.ctx.renderer);
    this._pmrem = pmrem;

    const scene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 40, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: ENV_VERT,
      fragmentShader: ENV_FRAG,
      uniforms: {
        uSunDir: { value: this.sun.direction.clone() },
        uSun: { value: vecOf('#fff2d8', 1.0) },
        uZenith: { value: vecOf('#7ba2d4', 1.05) },
        uHorizon: { value: vecOf('#e2dccb', 1.30) },
        uGround: { value: vecOf('#8a7a63', 0.38) },
      },
    });
    scene.add(new THREE.Mesh(geo, mat));

    const rt = pmrem.fromScene(scene, 0, 0.5, 120);
    this._envRT = rt;
    this.env = rt.texture;
    this.env.name = 'materials_env';

    geo.dispose();
    mat.dispose();
  }

  // -- public API ------------------------------------------------------------
  /**
   * Live wetness for a material returned by `get()` (0 = dry, 1 = soaked).
   * Safe to animate every frame — it drives a shader uniform, no recompile.
   */
  setWet(material, v) {
    const os = material?.userData?.os;
    if (os) os.tri.x = Math.max(0, Math.min(1, v));
    return material;
  }

  /** Tile size in metres for a material (texel density is a fixed 512 px/m). */
  tileMeters(name) { return this._sets.get(name)?.tileMeters ?? 1; }

  /** UV repeat that gives correct texel density for a surface of w x h metres. */
  repeatFor(name, w, h) {
    const t = this.tileMeters(name);
    return new THREE.Vector2(w / t, h / t);
  }

  /** Surface id + penetration for a material name (for physics/audio/fx tagging). */
  info(name) {
    const d = DEFS[name];
    return d ? { surface: d.surface, penetration: d.pen, tileMeters: this.tileMeters(name) } : null;
  }

  /**
   * Raw PBR map set.
   *
   * By default this returns the shared GPU textures (repeat is applied by
   * `get()` through a shader uniform, so these keep repeat = 1).
   *
   * Passing `size:[w,h]` (or `repeat`) instead returns independent, CPU-backed
   * copies that already carry the right `repeat` and can be dropped straight
   * into a vanilla THREE material — a one-off GPU readback per (name, repeat).
   * `standalone: false` forces the shared textures either way.
   *
   * ORM packing: aoMap = .r, roughnessMap = .g, metalnessMap = .b (the same
   * texture object, which is exactly how three samples those three slots).
   */
  texture(name, opts = {}) {
    const set = this._sets.get(name) || this._sets.get('concrete_wall');
    if (!set) return {};
    const rep = this._repeat(set, opts);
    const standalone = opts.standalone ?? !!(opts.size || opts.repeat);

    if (!standalone) {
      return {
        map: set.albedo,
        normalMap: set.normal,
        roughnessMap: set.orm,
        metalnessMap: set.orm,
        aoMap: set.orm,
        repeat: rep,
        tileMeters: set.tileMeters,
        size: set.size,
      };
    }

    const key = `${name}|${rep.x.toFixed(4)},${rep.y.toFixed(4)}`;
    let out = this._standalone.get(key);
    if (out) return out;
    const tg = this._texgen;
    const mk = (rt, index, colorSpace) => {
      const data = colorSpace === THREE.SRGBColorSpace
        ? tg.readbackSRGB(rt, index)
        : tg.readback(rt, index);
      const t = new THREE.DataTexture(data, set.size, set.size, THREE.RGBAFormat);
      t.colorSpace = colorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = tg.anisotropy;
      t.repeat.copy(rep);
      t.flipY = false;
      t.needsUpdate = true;
      return t;
    };
    const map = mk(set.rts[0], 0, THREE.SRGBColorSpace);
    const orm = mk(set.rts[0], 1, THREE.NoColorSpace);
    const normalMap = mk(set.rts[1], 0, THREE.NoColorSpace);
    out = {
      map, normalMap, roughnessMap: orm, metalnessMap: orm, aoMap: orm,
      repeat: rep, tileMeters: set.tileMeters, size: set.size,
    };
    this._standalone.set(key, out);
    return out;
  }

  /**
   * @param {string} name one of `ctx.materials.names`
   * @param {object} [opts]
   *   size:[w,h]      surface size in metres -> correct UV repeat at 512 px/m
   *   repeat:[x,y]    explicit repeat override
   *   scale:number    extra multiplier on the repeat
   *   triplanar:bool  world-space projection (terrain, rubble, debris)
   *   worldScale:num  metres per tile when triplanar
   *   wet:0..1        rain film / puddling
   *   color, emissive, emissiveIntensity, roughness, metalness, side,
   *   transparent, opacity, alphaTest, depthWrite, flatShading,
   *   envMapIntensity, detail:0..2, macro:0..2, aoIntensity
   * @returns {THREE.MeshStandardMaterial}
   */
  get(name, opts = {}) {
    const def = DEFS[name] || DEFS.concrete_wall;
    const set = this._sets.get(name) || this._sets.get('concrete_wall');
    if (!set) return new THREE.MeshStandardMaterial({ color: 0x8a8880, roughness: 0.9 });

    const rep = this._repeat(set, opts);
    const tri = !!(opts.triplanar ?? def.triplanar) && this.quality !== 'low';
    const key = [
      name, rep.x.toFixed(3), rep.y.toFixed(3), tri ? 1 : 0, opts.worldScale ?? '',
      opts.color ?? '', opts.wet ?? '', opts.roughness ?? '', opts.metalness ?? '',
      opts.side ?? '', opts.transparent ?? '', opts.opacity ?? '', opts.emissive ?? '',
      opts.emissiveIntensity ?? '', opts.alphaTest ?? '', opts.detail ?? '',
      opts.macro ?? '', opts.flatShading ?? '', opts.depthWrite ?? '',
      opts.envMapIntensity ?? '', opts.aoIntensity ?? '',
    ].join('|');
    const hit = this._cache.get(key);
    if (hit) return hit;

    const base = def.mat || {};
    const mat = new THREE.MeshStandardMaterial({
      map: set.albedo,
      normalMap: set.normal,
      roughnessMap: set.orm,
      roughness: 1.0,
      metalness: 1.0,
      color: opts.color !== undefined ? new THREE.Color(opts.color) : 0xffffff,
      normalScale: new THREE.Vector2(def.normalScale ?? 1, def.normalScale ?? 1),
      envMapIntensity: opts.envMapIntensity ?? base.envMapIntensity ?? 1.0,
      side: opts.side ?? base.side ?? THREE.FrontSide,
      transparent: opts.transparent ?? base.transparent ?? false,
      opacity: opts.opacity ?? base.opacity ?? 1.0,
      alphaTest: opts.alphaTest ?? base.alphaTest ?? 0.0,
      depthWrite: opts.depthWrite ?? base.depthWrite ?? true,
      flatShading: !!opts.flatShading,
      dithering: true,
    });
    mat.name = name;
    if (opts.roughness !== undefined) mat.roughness = opts.roughness;
    if (opts.metalness !== undefined) mat.metalness = opts.metalness;
    if (opts.emissive !== undefined) {
      mat.emissive = new THREE.Color(opts.emissive);
      mat.emissiveIntensity = opts.emissiveIntensity ?? 1.0;
    }

    const worldScale = opts.worldScale ?? set.tileMeters;
    const detail = def.detail || [6, 0.5, 4.5, 0.45];
    const macro = def.macro || [0.1, 0.12, 0.09];
    const detailMul = opts.detail ?? 1;
    const macroMul = opts.macro ?? 1;
    const lowQ = this.quality === 'low';

    mat.userData.surface = def.surface;
    mat.userData.penetration = def.pen;
    mat.userData.material = name;
    mat.userData.tileMeters = set.tileMeters;
    const os = {
      uv: new THREE.Vector4(rep.x, rep.y, 0, 0),
      macro: new THREE.Vector4(macro[0], macro[1] * macroMul, macro[2] * macroMul,
        macro[3] ?? 0.137),
      detail: new THREE.Vector4(detail[0], lowQ ? 0 : detail[1] * detailMul, detail[2], detail[3]),
      tri: new THREE.Vector2(opts.wet ?? 0, worldScale),
      ao: opts.aoIntensity ?? def.aoAmount ?? 1.0,
    };
    mat.userData.os = os;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uOsUv = { value: os.uv };
      shader.uniforms.uOsMacro = { value: os.macro };
      shader.uniforms.uOsDetail = { value: os.detail };
      shader.uniforms.uOsTri = { value: os.tri };
      shader.uniforms.uOsAo = { value: os.ao };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + OS_VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + OS_VERT_BODY);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + OS_PARS)
        .replace('#include <map_fragment>', OS_SURFACE)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * osR;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * osM;')
        .replace('#include <normal_fragment_maps>', OS_NORMAL)
        .replace('#include <aomap_fragment>', OS_AO);
    };
    mat.customProgramCacheKey = () => 'overstrike-surface-v1';
    const defs = {};
    if (tri) defs.OS_TRIPLANAR = '';
    if (lowQ) defs.OS_NO_MACROTEX = '';
    if (tri || lowQ) mat.defines = { ...(mat.defines || {}), ...defs };

    if (def.animate) this._animated.push({ os, sx: def.animate[0], sy: def.animate[1] });

    this._cache.set(key, mat);
    return mat;
  }

  _repeat(set, opts) {
    if (opts.repeat) return new THREE.Vector2(opts.repeat[0], opts.repeat[1]);
    const s = opts.scale ?? 1;
    if (opts.size) {
      return new THREE.Vector2(
        Math.max(0.02, (opts.size[0] / set.tileMeters) * s),
        Math.max(0.02, (opts.size[1] / set.tileMeters) * s),
      );
    }
    return new THREE.Vector2(s, s);
  }
}

function vecOf(hex, mul = 1) {
  const c = new THREE.Color(hex).convertSRGBToLinear();
  return new THREE.Vector3(c.r * mul, c.g * mul, c.b * mul);
}
