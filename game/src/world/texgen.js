// texgen.js — procedural PBR texture generation toolkit (GPU, fragment-shader based).
// Owned by: materials.
//
// Everything here renders full-screen quads into WebGLRenderTargets with a shared GLSL
// library of tileable noise + compositing operators, then derives normal / AO / curvature
// from the generated heightfield. No per-pixel JS loops, no downloaded assets.
//
// The GLSL library is exported so materials.js (and only materials.js) can build recipes
// on top of it.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// GLSL: hashing
// ---------------------------------------------------------------------------
export const GLSL_HASH = /* glsl */`
#ifndef OS_TAU
#define OS_TAU 6.283185307179586
#endif

float hash11(float p){
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash23(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
float hash31(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
`;

// ---------------------------------------------------------------------------
// GLSL: noise primitives. Every lattice-based primitive takes an explicit integer
// period so it wraps exactly -> the resulting textures tile seamlessly.
// ---------------------------------------------------------------------------
export const GLSL_NOISE = /* glsl */`
// ---- tileable value noise -------------------------------------------------
float vnoise(vec2 p, vec2 per, float sd){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 P = max(per, vec2(1.0));
  float a = hash21(mod(i,               P) + sd);
  float b = hash21(mod(i + vec2(1,0),   P) + sd);
  float c = hash21(mod(i + vec2(0,1),   P) + sd);
  float d = hash21(mod(i + vec2(1,1),   P) + sd);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// ---- tileable gradient (perlin) noise, returns 0..1 -----------------------
vec2 osGrad(vec2 i, vec2 P, float sd){
  float h = hash21(mod(i, P) + sd) * OS_TAU;
  return vec2(cos(h), sin(h));
}
float pnoise(vec2 p, vec2 per, float sd){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 P = max(per, vec2(1.0));
  float a = dot(osGrad(i,             P, sd), f);
  float b = dot(osGrad(i + vec2(1,0), P, sd), f - vec2(1,0));
  float c = dot(osGrad(i + vec2(0,1), P, sd), f - vec2(0,1));
  float d = dot(osGrad(i + vec2(1,1), P, sd), f - vec2(1,1));
  float n = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  return clamp(n * 0.7071 + 0.5, 0.0, 1.0);
}

// ---- simplex noise (Ashima), 2D / 3D / 4D --------------------------------
vec3 osMod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 osMod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
float osMod289(float x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec2 osMod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 osPermute(vec3 x){ return osMod289(((x*34.0)+1.0)*x); }
vec4 osPermute(vec4 x){ return osMod289(((x*34.0)+1.0)*x); }
float osPermute(float x){ return osMod289(((x*34.0)+1.0)*x); }
vec4 osTaylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float osTaylorInvSqrt(float r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise2(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = osMod289(i);
  vec3 p = osPermute(osPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float snoise3(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = osMod289(i);
  vec4 p = osPermute(osPermute(osPermute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = osTaylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

vec4 osGrad4(float j, vec4 ip){
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
  return p;
}
float snoise4(vec4 v){
  const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  const float F4 = 0.309016994374947451;
  vec4 i  = floor(v + dot(v, vec4(F4)));
  vec4 x0 = v - i + dot(i, C.xxxx);
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;
  i = osMod289(i);
  float j0 = osPermute(osPermute(osPermute(osPermute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = osPermute(osPermute(osPermute(osPermute(
              i.w + vec4(i1.w, i2.w, i3.w, 1.0))
            + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
            + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
            + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
  vec4 ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0);
  vec4 p0 = osGrad4(j0,   ip);
  vec4 p1 = osGrad4(j1.x, ip);
  vec4 p2 = osGrad4(j1.y, ip);
  vec4 p3 = osGrad4(j1.z, ip);
  vec4 p4 = osGrad4(j1.w, ip);
  vec4 norm = osTaylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= osTaylorInvSqrt(dot(p4,p4));
  vec3 m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)), 0.0);
  m0 = m0 * m0; m1 = m1 * m1;
  return 49.0 * (dot(m0*m0, vec3(dot(p0,x0), dot(p1,x1), dot(p2,x2)))
               + dot(m1*m1, vec2(dot(p3,x3), dot(p4,x4))));
}

// Exactly tileable simplex: evaluate 4D simplex on the torus that uv wraps around.
float snoiseTile(vec2 uv, float freq, float sd){
  float r = max(freq, 1.0) / OS_TAU;
  vec4 p = vec4(cos(uv.x * OS_TAU) * r, sin(uv.x * OS_TAU) * r,
                cos(uv.y * OS_TAU) * r, sin(uv.y * OS_TAU) * r);
  return snoise4(p + sd) * 0.5 + 0.5;
}

// ---- fBm / ridged / domain warp (all built on the tileable primitives) ----
float fbm(vec2 p, vec2 per, int oct, float gain, float sd){
  float a = 0.5, s = 0.0, n = 0.0;
  vec2 pp = p, prd = per;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * pnoise(pp, prd, sd + float(i) * 19.0);
    n += a; a *= gain; pp *= 2.0; prd *= 2.0;
  }
  return s / max(n, 1e-5);
}
float fbmValue(vec2 p, vec2 per, int oct, float gain, float sd){
  float a = 0.5, s = 0.0, n = 0.0;
  vec2 pp = p, prd = per;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * vnoise(pp, prd, sd + float(i) * 23.0);
    n += a; a *= gain; pp *= 2.0; prd *= 2.0;
  }
  return s / max(n, 1e-5);
}
float ridged(vec2 p, vec2 per, int oct, float gain, float sd){
  float a = 0.5, s = 0.0, n = 0.0;
  vec2 pp = p, prd = per;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    float v = 1.0 - abs(pnoise(pp, prd, sd + float(i) * 31.0) * 2.0 - 1.0);
    s += a * v * v; n += a; a *= gain; pp *= 2.0; prd *= 2.0;
  }
  return s / max(n, 1e-5);
}
// Period-preserving domain warp (warp field shares the period, so tiling survives).
vec2 domainWarp(vec2 p, vec2 per, float amt, float sd){
  float wx = pnoise(p, per, sd + 3.0) * 2.0 - 1.0;
  float wy = pnoise(p, per, sd + 91.0) * 2.0 - 1.0;
  return p + vec2(wx, wy) * amt;
}
vec2 domainWarp2(vec2 p, vec2 per, float amt, float sd){
  vec2 q = domainWarp(p, per, amt, sd);
  return domainWarp(q, per * 2.0, amt * 0.45, sd + 57.0);
}

// ---- tileable Worley / cellular: returns (F1, F2, cellRandom) -------------
vec3 worley(vec2 p, vec2 per, float sd){
  vec2 i = floor(p), f = fract(p);
  vec2 P = max(per, vec2(1.0));
  float f1 = 9.0, f2 = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++){
    for (int x = -1; x <= 1; x++){
      vec2 g = vec2(float(x), float(y));
      vec2 c = mod(i + g, P);
      vec2 o = hash22(c + sd);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1){ f2 = f1; f1 = d; id = hash21(c + sd + 41.7); }
      else if (d < f2){ f2 = d; }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
// F2-F1 crack / grain-boundary field.
float worleyCracks(vec2 p, vec2 per, float sd, float width){
  vec3 w = worley(p, per, sd);
  return 1.0 - smoothstep(0.0, max(width, 1e-4), w.y - w.x);
}
// Aggregate: rounded stones packed together, height in 0..1.
float worleyStones(vec2 p, vec2 per, float sd, float round){
  vec3 w = worley(p, per, sd);
  return pow(clamp(1.0 - w.x * 1.6, 0.0, 1.0), max(round, 0.05));
}
`;

// ---------------------------------------------------------------------------
// GLSL: compositing / masking operators
// ---------------------------------------------------------------------------
export const GLSL_OPS = /* glsl */`
float blendOverlay(float b, float s){ return b < 0.5 ? (2.0*b*s) : (1.0 - 2.0*(1.0-b)*(1.0-s)); }
vec3  blendOverlay(vec3 b, vec3 s){ return vec3(blendOverlay(b.r,s.r), blendOverlay(b.g,s.g), blendOverlay(b.b,s.b)); }
float blendScreen(float b, float s){ return 1.0 - (1.0-b)*(1.0-s); }
vec3  blendScreen(vec3 b, vec3 s){ return 1.0 - (1.0-b)*(1.0-s); }
float blendMultiply(float b, float s){ return b*s; }
float blendSoftLight(float b, float s){
  return (s < 0.5) ? (2.0*b*s + b*b*(1.0-2.0*s))
                   : (sqrt(b)*(2.0*s-1.0) + 2.0*b*(1.0-s));
}
float contrastOp(float x, float c){ return clamp((x - 0.5) * c + 0.5, 0.0, 1.0); }
vec3  contrastOp(vec3 x, float c){ return clamp((x - 0.5) * c + 0.5, 0.0, 1.0); }
float levels(float x, float inLo, float inHi, float gamma, float outLo, float outHi){
  float t = clamp((x - inLo) / max(inHi - inLo, 1e-5), 0.0, 1.0);
  t = pow(t, max(gamma, 1e-4));
  return mix(outLo, outHi, t);
}
float biasOp(float x, float b){ return x / max(((1.0/max(b,1e-4)) - 2.0) * (1.0 - x) + 1.0, 1e-5); }
float gainOp(float x, float g){
  return (x < 0.5) ? biasOp(x*2.0, g)*0.5 : 1.0 - biasOp(2.0 - x*2.0, g)*0.5;
}
vec3 ramp3(float t, vec3 a, vec3 b, vec3 c){
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(a, b, t*2.0) : mix(b, c, (t-0.5)*2.0);
}
vec3 ramp4(float t, vec3 a, vec3 b, vec3 c, vec3 d){
  t = clamp(t, 0.0, 1.0) * 3.0;
  if (t < 1.0) return mix(a, b, t);
  if (t < 2.0) return mix(b, c, t - 1.0);
  return mix(c, d, t - 2.0);
}
float sstep(float a, float b, float x){ return smoothstep(a, b, x); }

// ---- gravity-driven vertical streaking ------------------------------------
// Runs of dirt/rust wash starting at a random height and fading downward.
// Wraps in both axes (uses fract on the vertical run).
float dripStreaks(vec2 uv, float cols, float sd, float lengthScale){
  vec2 w = uv;
  w.x += (vnoise(vec2(uv.x * cols, uv.y * 3.0), vec2(cols, 3.0), sd + 5.0) - 0.5) * (0.6 / cols);
  float x = w.x * cols;
  float i = floor(x), f = fract(x);
  vec2 c = vec2(mod(i, cols), 0.0);
  float wid = 0.10 + 0.75 * hash21(c + sd + 1.0);
  float lane = smoothstep(wid, wid * 0.15, abs(f - 0.5) * 2.0);
  float y0 = hash21(c + sd + 2.0);
  float len = lengthScale * (0.25 + 0.85 * hash21(c + sd + 3.0));
  float d = fract(w.y - y0);
  float run = smoothstep(len, len * 0.05, d) * smoothstep(0.0, 0.02, d);
  float amp = 0.25 + 0.75 * hash21(c + sd + 4.0);
  float grain = 0.6 + 0.4 * vnoise(vec2(w.x * cols * 3.0, w.y * cols * 0.35),
                                   vec2(cols * 3.0, max(1.0, floor(cols * 0.35))), sd + 7.0);
  return clamp(lane * run * amp * grain, 0.0, 1.0);
}

// ---- directional streaking (generic anisotropic wash) ---------------------
float streakNoise(vec2 uv, float fx, float fy, int oct, float sd){
  vec2 F = vec2(max(1.0, floor(fx)), max(1.0, floor(fy)));
  return fbm(uv * F, F, oct, 0.55, sd);
}

// ---- scratch / scuff line generator ---------------------------------------
// One jittered line segment per cell, 3x3 neighbourhood, tileable.
float scratchLines(vec2 uv, float cells, float sd, float thin, float coverage, float dirBias){
  vec2 p = uv * cells;
  vec2 i = floor(p), f = fract(p);
  vec2 P = vec2(cells);
  float m = 0.0;
  for (int y = -1; y <= 1; y++){
    for (int x = -1; x <= 1; x++){
      vec2 g = vec2(float(x), float(y));
      vec2 c = mod(i + g, P);
      vec3 h = hash23(c + sd);
      if (h.z > coverage) continue;
      vec2 a = hash22(c + sd + 11.0);
      float ang = mix(h.x * OS_TAU, dirBias, step(0.001, abs(dirBias)) * 0.75);
      float len = 0.35 + 1.9 * h.y;
      vec2 b = a + vec2(cos(ang), sin(ang)) * len;
      vec2 pa = f - g - a, ba = b - a;
      float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
      float d = length(pa - ba * t);
      float w = thin * (0.35 + 1.3 * hash21(c + sd + 23.0));
      float taper = 1.0 - abs(t - 0.5) * 1.4;
      m = max(m, smoothstep(w, 0.0, d) * clamp(taper, 0.0, 1.0) * (0.35 + 0.65 * h.x));
    }
  }
  return m;
}

// ---- decal splattering (irregular blobs) ----------------------------------
float splatter(vec2 uv, float cells, float sd, float radius, float coverage){
  vec2 p = uv * cells;
  vec2 i = floor(p), f = fract(p);
  vec2 P = vec2(cells);
  float m = 0.0;
  for (int y = -1; y <= 1; y++){
    for (int x = -1; x <= 1; x++){
      vec2 g = vec2(float(x), float(y));
      vec2 c = mod(i + g, P);
      if (hash21(c + sd + 3.7) > coverage) continue;
      vec2 o = hash22(c + sd);
      vec2 d = f - g - o;
      float r = radius * (0.35 + 0.95 * hash21(c + sd + 9.1));
      float ang = atan(d.y, d.x);
      r *= 0.72 + 0.5 * vnoise(vec2(cos(ang), sin(ang)) * 2.5 + c * 3.0, vec2(64.0), sd + 17.0);
      m = max(m, smoothstep(r, r * 0.25, length(d)));
    }
  }
  return clamp(m, 0.0, 1.0);
}

// ---- dirt accumulation drivers --------------------------------------------
float cavityDirt(float ao, float power){ return pow(clamp(1.0 - ao, 0.0, 1.0), max(power, 0.05)); }
float edgeWear(float curvature, float bias){ return smoothstep(bias, 1.0, clamp(curvature, 0.0, 1.0)); }

// ---- colour space ----------------------------------------------------------
vec3 srgbToLinear(vec3 c){
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 linearToSrgb(vec3 c){
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
}
`;

export const GLSL_LIB = GLSL_HASH + GLSL_NOISE + GLSL_OPS;

// ---------------------------------------------------------------------------
// Shared full-screen vertex shader (GLSL3, RawShaderMaterial).
// ---------------------------------------------------------------------------
const FS_VERT = /* glsl */`
precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG_PREFIX = /* glsl */`
precision highp float;
precision highp int;
in vec2 vUv;
`;

// ---------------------------------------------------------------------------
// Derived-map passes
// ---------------------------------------------------------------------------

// Height -> tangent-space normal (Sobel) + horizon-ish AO, packed as rgb=normal, a=AO.
const FRAG_NORMAL_AO = /* glsl */`
uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uHeightScale;   // height range as a fraction of the tile width
uniform float uAORadius;      // in uv units
uniform float uAOStrength;
layout(location = 0) out vec4 oNA;

float H(vec2 uv){ return texture(uHeight, uv).a; }

void main(){
  vec2 uv = vUv;
  vec2 t = uTexel;

  // Sobel (3x3) — smoother and less axis-biased than a 4-tap cross.
  float h00 = H(uv + vec2(-t.x, -t.y));
  float h10 = H(uv + vec2( 0.0, -t.y));
  float h20 = H(uv + vec2( t.x, -t.y));
  float h01 = H(uv + vec2(-t.x,  0.0));
  float h21 = H(uv + vec2( t.x,  0.0));
  float h02 = H(uv + vec2(-t.x,  t.y));
  float h12 = H(uv + vec2( 0.0,  t.y));
  float h22 = H(uv + vec2( t.x,  t.y));

  float gx = (h20 + 2.0*h21 + h22) - (h00 + 2.0*h01 + h02);
  float gy = (h02 + 2.0*h12 + h22) - (h00 + 2.0*h10 + h20);

  // slope = dH/du where u spans the tile; scale so the result is resolution aware
  float k = uHeightScale * 0.25 / max(t.x, 1e-6);
  vec3 n = normalize(vec3(-gx * k, -gy * k, 1.0));

  // Cheap cone/horizon AO: golden-angle spiral, occlusion from neighbours above us.
  float hc = H(uv);
  float occ = 0.0;
  const int TAPS = 12;
  for (int i = 0; i < TAPS; i++){
    float fi = float(i);
    float a = fi * 2.39996323;
    float r = (fi + 0.7) / float(TAPS);
    vec2 d = vec2(cos(a), sin(a)) * r * uAORadius;
    float hs = H(uv + d);
    occ += max(0.0, hs - hc) / max(r, 0.08);
  }
  occ = occ / float(TAPS);
  float ao = 1.0 - clamp(occ * uAOStrength, 0.0, 1.0);
  ao = mix(ao, ao * ao, 0.35);

  oNA = vec4(n * 0.5 + 0.5, ao);
}
`;

// ---------------------------------------------------------------------------
// TexGen
// ---------------------------------------------------------------------------
export class TexGen {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{anisotropy?:number}} [opts]
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    const maxAniso = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
    this.anisotropy = Math.min(opts.anisotropy ?? 16, Math.max(1, maxAniso));

    this._camera = new THREE.Camera();
    this._geo = new THREE.PlaneGeometry(2, 2);
    this._mesh = new THREE.Mesh(this._geo, null);
    this._mesh.frustumCulled = false;
    this._scene = new THREE.Scene();
    this._scene.add(this._mesh);

    this._matCache = new Map();   // fragment source -> RawShaderMaterial
    this._targets = [];
    this._readCanvas = null;
  }

  // -- material cache --------------------------------------------------------
  // One compiled program per distinct fragment source; uniform *values* are
  // rebound per invocation so a whole material library costs a single compile.
  material(fragment, uniforms) {
    let m = this._matCache.get(fragment);
    if (!m) {
      const u = {};
      for (const k in uniforms) u[k] = { value: uniforms[k] };
      m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: FS_VERT,
        fragmentShader: FRAG_PREFIX + fragment,
        uniforms: u,
        depthTest: false,
        depthWrite: false,
      });
      this._matCache.set(fragment, m);
      return m;
    }
    let changed = false;
    for (const k in uniforms) {
      const slot = m.uniforms[k];
      if (slot === undefined) { m.uniforms[k] = { value: uniforms[k] }; changed = true; }
      else slot.value = uniforms[k];
    }
    if (changed) m.needsUpdate = true;
    return m;
  }

  /**
   * Allocate a render target.
   * @param {number} w @param {number} h
   * @param {{count?:number, srgb?:number[], filter?:any, mips?:boolean, wrap?:any}} [o]
   */
  createTarget(w, h, o = {}) {
    const count = o.count ?? 1;
    const mips = o.mips ?? false;
    const rt = new THREE.WebGLRenderTarget(w, h, {
      count,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: o.wrap ?? THREE.RepeatWrapping,
      wrapT: o.wrap ?? THREE.RepeatWrapping,
      generateMipmaps: mips,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const srgb = o.srgb || [];
    for (let i = 0; i < rt.textures.length; i++) {
      const t = rt.textures[i];
      t.colorSpace = srgb.includes(i) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = o.wrap ?? THREE.RepeatWrapping;
      t.generateMipmaps = mips;
      t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = mips ? this.anisotropy : 1;
      t.needsUpdate = true;
    }
    this._targets.push(rt);
    return rt;
  }

  /** Render `fragment` into `target`. */
  pass(fragment, uniforms, target) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    this._mesh.material = this.material(fragment, uniforms);
    r.autoClear = true;
    r.setRenderTarget(target);
    r.render(this._scene, this._camera);
    r.setRenderTarget(prev);
    r.autoClear = prevAutoClear;
    return target;
  }

  /**
   * Height (stored in .a of `heightTex`) -> normal + AO.
   * @returns {THREE.WebGLRenderTarget} rgb = tangent normal, a = ambient occlusion
   */
  normalAO(heightTex, width, height, o = {}) {
    const rt = o.target || this.createTarget(width, height, { mips: o.mips ?? true });
    this.pass(FRAG_NORMAL_AO, {
      uHeight: heightTex,
      uTexel: new THREE.Vector2(1 / width, 1 / height),
      uHeightScale: o.strength ?? 0.05,
      uAORadius: o.aoRadius ?? 0.035,
      uAOStrength: o.aoStrength ?? 1.6,
    }, rt);
    return rt;
  }

  /** Read an 8-bit RGBA target back to the CPU (rarely needed — prefer GPU passes). */
  readback(target, index = 0) {
    const { width, height } = target;
    const buf = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, buf, 0, index);
    return buf;
  }

  /** Dispose intermediates (targets flagged temporary). */
  releaseTemp(list) {
    for (const rt of list) {
      const i = this._targets.indexOf(rt);
      if (i >= 0) this._targets.splice(i, 1);
      rt.dispose();
    }
  }

  dispose() {
    for (const rt of this._targets) rt.dispose();
    this._targets.length = 0;
    for (const m of this._matCache.values()) m.dispose();
    this._matCache.clear();
    this._geo.dispose();
  }
}

// ---------------------------------------------------------------------------
// CPU-side helpers — the same operator set, for 1D ramps / LUT baking / tools
// that genuinely need per-pixel JS (kept tiny on purpose).
// ---------------------------------------------------------------------------
export const CPU = {
  clamp: (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x),
  mix: (a, b, t) => a + (b - a) * t,
  smoothstep(a, b, x) { const t = CPU.clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); },
  multiply: (a, b) => a * b,
  screen: (a, b) => 1 - (1 - a) * (1 - b),
  overlay: (a, b) => (a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)),
  contrast: (x, c) => CPU.clamp((x - 0.5) * c + 0.5),
  levels(x, inLo, inHi, gamma, outLo, outHi) {
    const t = Math.pow(CPU.clamp((x - inLo) / Math.max(inHi - inLo, 1e-5)), gamma);
    return CPU.mix(outLo, outHi, t);
  },
  srgbToLinear: (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)),
  linearToSrgb: (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055),
  /** Build a 1D THREE.DataTexture gradient ramp from [{t, color:[r,g,b]}] stops. */
  rampTexture(stops, width = 256, colorSpace = THREE.SRGBColorSpace) {
    const data = new Uint8Array(width * 4);
    for (let i = 0; i < width; i++) {
      const t = i / (width - 1);
      let a = stops[0], b = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (t >= stops[s].t && t <= stops[s + 1].t) { a = stops[s]; b = stops[s + 1]; break; }
      }
      const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(255 * CPU.mix(a.color[c], b.color[c], k));
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, width, 1);
    tex.colorSpace = colorSpace;
    tex.needsUpdate = true;
    return tex;
  },
};

export default TexGen;
