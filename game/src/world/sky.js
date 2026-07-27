// ---------------------------------------------------------------------------
// sky.js — physically based atmosphere, sun, clouds, aerial perspective.
// Owner: `sky`. See CONTRACT.md / ARTDIRECTION.md.
//
// Public API (registered as ctx.sky):
//
//   ctx.sky.sun            THREE.DirectionalLight  key light, #fff2d8 @ 3.4
//   ctx.sky.bounce         THREE.DirectionalLight  warm ground bounce fill
//   ctx.sky.sunDirection   Vector3  FROM the sun TOWARD the scene (normalised)
//   ctx.sky.sunPosition    Vector3  unit vector pointing AT the sun
//   ctx.sky.env            PMREM environment texture (aliases: .envMap .environment)
//   ctx.sky.skyLUT         DataTexture, equirect. rgb = Rayleigh pre-phase,
//                          a = Mie pre-phase. Multiply by the phase functions.
//   ctx.sky.uniforms       shared uniform block (see UNIFORM BLOCK below)
//   ctx.sky.glsl           { common, aerial, version } reusable GLSL sources
//   ctx.sky.fog            { density, groundDensity, groundHeight, hazeHeight }
//
//   ctx.sky.sample(dir, target?) -> THREE.Color   HDR sky radiance, CPU side
//   ctx.sky.setSun(elevationDeg, azimuthDeg)
//   ctx.sky.setPreset(name)      'midmorning'|'noon'|'golden'|'dusk'|'overcast'
//   ctx.sky.setTimeOfDay(hours)
//   ctx.sky.setClouds(opts)      { coverage, cirrus, wind, density }
//   ctx.sky.setFog(opts)         { density, groundDensity, groundHeight, hazeHeight }
//   ctx.sky.refresh()            force a rebuild of LUT + env + fog chunk
//
// The sky writes a *replacement* for three's built-in fog chunks so that every
// material in the build (whoever authored it) gets true aerial perspective:
// distant geometry converges on the sky radiance in that exact view direction,
// with a Mie forward-scattering lobe around the sun and a low street-level
// height-fog layer. Nothing has to opt in.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import Atmosphere from './atmosphere.js';

// ---------------------------------------------------------------------------
// ART DIRECTION — these values are binding.
// ---------------------------------------------------------------------------
const SUN_ELEVATION_DEG = 22;
const SUN_AZIMUTH_DEG = 118;
const SUN_COLOR_HEX = '#fff2d8';
const SUN_INTENSITY = 3.4;
const BOUNCE_COLOR_HEX = '#c9a882';
const BOUNCE_INTENSITY = 0.25;

const D2R = Math.PI / 180;

// ---------------------------------------------------------------------------
// Atmosphere constants (metres, per-metre scattering coefficients).
// ---------------------------------------------------------------------------
const RG = 6360000.0;              // planet radius
const RT = 6420000.0;              // top of atmosphere
const H_RAYLEIGH = 8000.0;
const H_MIE = 1200.0;
const BETA_R = [5.802e-6, 13.558e-6, 33.100e-6];
const BETA_O = [0.650e-6, 1.881e-6, 0.085e-6];   // ozone absorption
const MIE_SCA = 3.996e-6;
const MIE_EXT = 4.440e-6;
const MIE_G = 0.76;
const SUN_ANGULAR_RADIUS = 0.004675;             // rad (0.268 deg)
const GROUND_ALBEDO = [0.21, 0.185, 0.145];

// Calibration. We anchor on the ANTI-SOLAR horizon rather than the zenith:
// that is the part of a real sky that must stay a pale warm grey instead of
// clipping, and anchoring there lets the solar aureole blow out the way it
// does in a photograph. Fixed against the reference mid-morning sun, so dusk
// really is darker.
const HORIZON_TARGET = 1.02;
// Cheap isotropic stand-in for higher-order scattering. Without it a pure
// single-scattering sky has a horizon that is too dark and too saturated.
const MULTI_SCATTER = 2.35;

const CLOUD_BOTTOM = 1350.0;
const CLOUD_TOP = 3050.0;
const CIRRUS_ALT = 7600.0;

// ---------------------------------------------------------------------------
// Deterministic CPU noise helpers (used for the weather + cirrus textures).
// ---------------------------------------------------------------------------
function ihash(x, y, z, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) +
          Math.imul(z | 0, 2147483629) + Math.imul(seed | 0, 3266489917);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
const wrap = (v, p) => ((v % p) + p) % p;
const smoothf = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Tileable 2D value noise with integer period `p`.
function vnoise2(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smoothf(xf), v = smoothf(yf);
  const x0 = wrap(xi, p), x1 = wrap(xi + 1, p);
  const y0 = wrap(yi, p), y1 = wrap(yi + 1, p);
  const a = ihash(x0, y0, 0, seed), b = ihash(x1, y0, 0, seed);
  const c = ihash(x0, y1, 0, seed), d = ihash(x1, y1, 0, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm2(x, y, p, seed, oct, gain = 0.5, lac = 2) {
  let s = 0, amp = 1, norm = 0, f = 1, pp = p;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise2(x * f, y * f, pp, seed + i * 71);
    norm += amp;
    amp *= gain; f *= lac; pp = Math.max(1, Math.round(pp * lac));
  }
  return s / norm;
}

function ridged2(x, y, p, seed, oct) {
  let s = 0, amp = 1, norm = 0, f = 1, pp = p;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise2(x * f, y * f, pp, seed + i * 137) * 2 - 1);
    s += amp * n * n;
    norm += amp;
    amp *= 0.52; f *= 2.07; pp = Math.max(1, Math.round(pp * 2));
  }
  return s / norm;
}

// Tileable Worley (cellular) noise; returns 1 - F1 so blobs are bright.
function worley2(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  let best = 8;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = wrap(xi + i, p), cy = wrap(yi + j, p);
      const px = i + ihash(cx, cy, 11, seed);
      const py = j + ihash(cx, cy, 29, seed);
      const dx = px - xf, dy = py - yf;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return 1 - Math.min(1, Math.sqrt(best));
}

function worleyFbm(x, y, p, seed, oct) {
  let s = 0, amp = 1, norm = 0, f = 1, pp = p;
  for (let i = 0; i < oct; i++) {
    s += amp * worley2(x * f, y * f, pp, seed + i * 313);
    norm += amp;
    amp *= 0.5; f *= 2; pp = Math.max(1, Math.round(pp * 2));
  }
  return s / norm;
}

// ---------------------------------------------------------------------------
// CPU single-scattering atmosphere.  Produces the equirect LUT the GPU samples,
// the sun transmittance, and the analytic constants baked into the fog chunk.
// ---------------------------------------------------------------------------
class AtmosphereModel {
  constructor() {
    this.turbidity = 3.1;
    this.mieG = MIE_G;
    this.camAlt = 2.0;
    this.exposure = 1.0;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this._tTable = new Float32Array(3 * 96);
    this._tN = 96;
    this._tTop = 62000;
  }

  _betaMs() { return MIE_SCA * this.turbidity; }
  _betaMe() { return MIE_EXT * this.turbidity; }

  _density(h) {
    return [
      Math.exp(-h / H_RAYLEIGH),
      Math.exp(-h / H_MIE),
      Math.max(0, 1 - Math.abs(h - 25000) / 15000),
    ];
  }

  // Ray/sphere from a point at radius r on the +Y axis.
  _rayTop(y, dy, radius) {
    // |o + t d| = radius, o = (0, y, 0), |d| = 1
    const b = y * dy;
    const c = y * y - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    const t0 = -b - s, t1 = -b + s;
    if (t1 < 0) return -1;
    return t0 > 0 ? t0 : t1;
  }

  _hitsGround(y, dy) {
    const b = y * dy;
    const c = y * y - RG * RG;
    const disc = b * b - c;
    if (disc < 0) return false;
    const t0 = -b - Math.sqrt(disc);
    return t0 > 0;
  }

  // Optical depth from altitude h toward the sun, out of the atmosphere.
  _sunTransmittance(h, out) {
    const y = RG + h;
    const dy = this.sunDir.y;
    if (this._hitsGround(y, dy)) { out[0] = out[1] = out[2] = 0; return out; }
    const tMax = this._rayTop(y, dy, RT);
    if (tMax <= 0) { out[0] = out[1] = out[2] = 1; return out; }
    const N = 24;
    let odR = 0, odM = 0, odO = 0;
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      const t = tMax * u * u;
      const dt = tMax * (2 * u) / N;
      const yy = Math.sqrt(y * y + t * t + 2 * y * t * dy);
      const hh = Math.max(0, yy - RG);
      const d = this._density(hh);
      odR += d[0] * dt; odM += d[1] * dt; odO += d[2] * dt;
    }
    const bMe = this._betaMe();
    for (let c = 0; c < 3; c++) {
      out[c] = Math.exp(-(BETA_R[c] * odR + bMe * odM + BETA_O[c] * odO));
    }
    return out;
  }

  _buildTransmittanceTable() {
    const tmp = [0, 0, 0];
    for (let i = 0; i < this._tN; i++) {
      const u = i / (this._tN - 1);
      const h = this._tTop * u * u;
      this._sunTransmittance(h, tmp);
      this._tTable[i * 3] = tmp[0];
      this._tTable[i * 3 + 1] = tmp[1];
      this._tTable[i * 3 + 2] = tmp[2];
    }
  }

  _lookupT(h, out) {
    const u = Math.sqrt(Math.max(0, Math.min(1, h / this._tTop)));
    const f = u * (this._tN - 1);
    const i0 = Math.min(this._tN - 1, Math.floor(f));
    const i1 = Math.min(this._tN - 1, i0 + 1);
    const w = f - i0;
    for (let c = 0; c < 3; c++) {
      out[c] = this._tTable[i0 * 3 + c] * (1 - w) + this._tTable[i1 * 3 + c] * w;
    }
    return out;
  }

  /**
   * Single-scattering march for one view direction.
   * Returns [rR, rG, rB, mie, groundR, groundG, groundB] — Rayleigh and Mie
   * are *pre-phase*; ground is the (already phase-free) surface term seen
   * through the atmosphere.
   */
  march(dx, dy, dz, out) {
    const y0 = RG + this.camAlt;
    const hitsGround = this._hitsGround(y0, dy);
    let tMax = hitsGround ? this._rayTop(y0, dy, RG) : this._rayTop(y0, dy, RT);
    if (tMax <= 0) tMax = 1000;
    tMax = Math.min(tMax, 3.2e6);

    const N = 30;
    const bMs = this._betaMs(), bMe = this._betaMe();
    let odR = 0, odM = 0, odO = 0;
    const iR = this._iR || (this._iR = new Float64Array(3));
    const iM = this._iM || (this._iM = new Float64Array(3));
    iR[0] = iR[1] = iR[2] = 0;
    iM[0] = iM[1] = iM[2] = 0;
    const ts = [0, 0, 0];

    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      const t = tMax * u * u;
      const dt = tMax * (2 * u) / N;
      const yy = Math.sqrt(y0 * y0 + t * t + 2 * y0 * t * dy);
      const h = Math.max(0, yy - RG);
      const d = this._density(h);
      const dR = d[0] * dt, dM = d[1] * dt, dO = d[2] * dt;
      odR += dR; odM += dM; odO += dO;
      this._lookupT(h, ts);
      for (let c = 0; c < 3; c++) {
        const tv = Math.exp(-(BETA_R[c] * odR + bMe * odM + BETA_O[c] * odO));
        iR[c] += dR * tv * ts[c];
        iM[c] += dM * tv * ts[c];
      }
    }

    for (let c = 0; c < 3; c++) out[c] = BETA_R[c] * iR[c] * this.solar[c];
    // Mie is achromatic in its cross-section; the colour comes entirely from
    // transmittance, so store green and hand the chromatic ratio to the shader.
    out[3] = bMs * iM[1] * this.solar[1];
    this._mieRGB = this._mieRGB || [0, 0, 0];
    for (let c = 0; c < 3; c++) this._mieRGB[c] = bMs * iM[c] * this.solar[c];

    // Higher-order scattering, isotropic. Folded into the phase-free slot.
    const ms = MULTI_SCATTER * 0.0795774715;   // x 1/(4pi)
    for (let c = 0; c < 3; c++) {
      out[4 + c] = (BETA_R[c] * iR[c] + bMs * iM[c]) * this.solar[c] * ms;
    }

    if (hitsGround) {
      this._lookupT(0, ts);
      const ndl = Math.max(0, this.sunDir.y);
      for (let c = 0; c < 3; c++) {
        const tv = Math.exp(-(BETA_R[c] * odR + bMe * odM + BETA_O[c] * odO));
        // direct sun on the ground + a crude sky term
        const lit = GROUND_ALBEDO[c] / Math.PI *
          (this.solar[c] * ts[c] * ndl + this.solar[c] * 0.055);
        out[4 + c] += lit * tv;
      }
    }
    return out;
  }

  static phaseR(c) { return 0.05968310365 * (1 + c * c); }
  static phaseHG(c, g) {
    const g2 = g * g;
    const d = 1 + g2 - 2 * g * c;
    return (1 - g2) / (12.566370614 * d * Math.sqrt(Math.max(d, 1e-4)));
  }

  /** Recompute everything for the current sun direction / turbidity. */
  prepare(sunDir, turbidity) {
    this.sunDir.copy(sunDir).normalize();
    this.turbidity = turbidity;
    // Spectral solar irradiance, roughly flat with a slight blue bias.
    this.solar = [1.62, 1.72, 1.80];
    this._buildTransmittanceTable();

    // --- absolute calibration against the reference mid-morning zenith ------
    const savedDir = this.sunDir.clone();
    const savedTab = this._tTable.slice();
    const ref = new THREE.Vector3(
      Math.sin(SUN_AZIMUTH_DEG * D2R) * Math.cos(SUN_ELEVATION_DEG * D2R),
      Math.sin(SUN_ELEVATION_DEG * D2R),
      Math.cos(SUN_AZIMUTH_DEG * D2R) * Math.cos(SUN_ELEVATION_DEG * D2R),
    ).normalize();
    this.sunDir.copy(ref);
    this._buildTransmittanceTable();
    const o = new Float64Array(7);
    // anti-solar horizon, 1.5 degrees up
    const el = 1.5 * D2R;
    const ax = -ref.x, az2 = -ref.z;
    const alen = Math.hypot(ax, az2) || 1;
    const rx = ax / alen * Math.cos(el), rz = az2 / alen * Math.cos(el), ry = Math.sin(el);
    this.march(rx, ry, rz, o);
    const cg = rx * ref.x + ry * ref.y + rz * ref.z;
    const pr = AtmosphereModel.phaseR(cg);
    const pm = AtmosphereModel.phaseHG(cg, this.mieG);
    const zr = o[0] * pr + o[3] * pm + o[4];
    const zg = o[1] * pr + o[3] * pm + o[5];
    const zb = o[2] * pr + o[3] * pm + o[6];
    const lum = 0.2126 * zr + 0.7152 * zg + 0.0722 * zb;
    this.exposure = HORIZON_TARGET / Math.max(lum, 1e-9);

    this.sunDir.copy(savedDir);
    this._tTable.set(savedTab);

    // sun transmittance for the disc + cloud lighting
    const st = [0, 0, 0];
    this._lookupT(this.camAlt, st);
    this.sunTransmittance = st;
  }

  /** HDR radiance for a direction (post-phase, exposure applied). */
  radiance(dx, dy, dz, out) {
    const o = this._scratch || (this._scratch = new Float64Array(7));
    this.march(dx, dy, dz, o);
    const c = dx * this.sunDir.x + dy * this.sunDir.y + dz * this.sunDir.z;
    const pr = AtmosphereModel.phaseR(c);
    const pm = AtmosphereModel.phaseHG(c, this.mieG);
    out[0] = (o[0] * pr + o[3] * pm * this.mieTint[0] + o[4]) * this.exposure;
    out[1] = (o[1] * pr + o[3] * pm * this.mieTint[1] + o[5]) * this.exposure;
    out[2] = (o[2] * pr + o[3] * pm * this.mieTint[2] + o[6]) * this.exposure;
    return out;
  }
}

// ---------------------------------------------------------------------------
// Shared GLSL — phase functions + curvature-corrected shell maths.
// ---------------------------------------------------------------------------
const GLSL_COMMON = /* glsl */`
#define SKY_PI 3.141592653589793
#define SKY_RG 6360000.0

float skyPhaseR(float c){ return 0.05968310365 * (1.0 + c * c); }
float skyPhaseHG(float c, float g){
  float g2 = g * g;
  float d = 1.0 + g2 - 2.0 * g * c;
  return (1.0 - g2) / (12.566370614 * d * sqrt(max(d, 1e-4)));
}
// Altitude above sea level using the parabolic curvature approximation.
float skyAltitude(vec3 p, float camAlt){
  return camAlt + p.y + (p.x * p.x + p.z * p.z) / (2.0 * SKY_RG);
}
// Distance along a unit ray from the camera to the shell at height H
// (H measured relative to the camera altitude).
// Solves a*t^2 + b*t - H = 0 in the numerically stable form 2H/(b+sqrt(D)).
// The textbook (-b+sqrt(D))/2a form catastrophically cancels near the zenith,
// where `a` collapses to ~1e-10 in fp32.
float skyShellT(vec3 d, float H){
  float a = (1.0 - d.y * d.y) / (2.0 * SKY_RG);
  float b = d.y;
  float disc = b * b + 4.0 * a * H;
  if (disc < 0.0) return -1.0;
  float den = b + sqrt(disc);
  if (den <= 1e-9) return -1.0;
  return 2.0 * H / den;
}
vec2 skyEquirect(vec3 d){
  return vec2(atan(d.z, d.x) * 0.15915494 + 0.5,
              acos(clamp(d.y, -1.0, 1.0)) * 0.31830989);
}
float skyHash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

// ---------------------------------------------------------------------------
// Sky dome shader.
// ---------------------------------------------------------------------------
const DOME_VERT = /* glsl */`
varying vec3 vSkyDir;
void main(){
  vSkyDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DOME_FRAG = /* glsl */`
precision highp float;
varying vec3 vSkyDir;

uniform sampler2D uSkyLUT;
uniform sampler2D uWeather;
uniform sampler2D uCirrus;
uniform vec3  uSunDir;
uniform vec3  uMieTint;
uniform vec3  uSunDisc;
uniform vec3  uCloudSun;
uniform vec3  uCloudAmb;
uniform float uMieG;
uniform float uSunAngular;
uniform float uSunDiscOn;
uniform float uExposure;
uniform float uTime;
uniform float uCamAlt;
uniform float uPixAngle;   // radians of view angle per output pixel
uniform vec2  uWind;
uniform float uCoverage;
uniform float uCumulus;
uniform float uCirrusAmt;
uniform float uCloudDensity;
uniform float uCloudBottom;
uniform float uCloudTop;
uniform int   uSteps;
uniform int   uLightSteps;

${GLSL_COMMON}

vec3 skyBase(vec3 d){
  vec4 L = texture2D(uSkyLUT, skyEquirect(d));
  float c = clamp(dot(d, uSunDir), -1.0, 1.0);
  return max(L.rgb * skyPhaseR(c) + L.a * uMieTint * skyPhaseHG(c, uMieG), vec3(0.0));
}

float remap(float v, float a, float b, float c, float e){
  return c + (clamp(v, a, b) - a) / max(b - a, 1e-5) * (e - c);
}

// value noise, 3D, for cloud edge erosion
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0,0,0));
  float n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0));
  float n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1));
  float n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1));
  float n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
             mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}

// Screen-space footprint of a sample on a slab at distance `t`, expressed as
// a mip level. Hardware derivatives are unusable here: the dome is a mesh, so
// d(uv)/d(pixel) jumps at every triangle edge and the mip level snaps with it.
float slabLod(float t, float uvScale, float texSize, float dy){
  float foot = uvScale * t * uPixAngle / max(abs(dy), 0.02) * texSize;
  return clamp(log2(max(foot, 1.0)), 0.0, 9.0);
}

vec2 weatherUV(vec3 p, float scale, float rot, vec2 drift){
  vec2 q = p.xz * scale;
  float cs = cos(rot), sn = sin(rot);
  q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
  return q + drift;
}

float cloudDensity(vec3 p, float detail, float lod){
  float alt = skyAltitude(p, uCamAlt);
  float h01 = (alt - uCloudBottom) / (uCloudTop - uCloudBottom);
  if (h01 < 0.0 || h01 > 1.0) return 0.0;

  vec4 w0 = textureLod(uWeather, weatherUV(p, 3.1e-5, 0.0, uWind * 0.6), lod);
  vec4 w1 = textureLod(uWeather, weatherUV(p, 1.13e-5, 2.1, uWind * 0.31), max(lod - 1.4, 0.0));

  // Two decorrelated octaves of the weather map so the 256px tile never reads
  // as a tile, biased by the art-directable coverage.
  float cov = clamp(w0.r * 0.62 + w1.r * 0.62 - 0.34 + uCoverage, 0.0, 1.0);
  cov = cov * cov * (3.0 - 2.0 * cov);
  if (cov <= 0.004) return 0.0;

  float type = clamp(w0.g * 0.7 + w1.g * 0.3, 0.0, 1.0);
  float topH = mix(0.34, 1.0, type * (0.35 + 0.65 * cov));
  float profile = smoothstep(0.0, 0.14, h01) * smoothstep(topH, topH * 0.34, h01);
  if (profile <= 0.004) return 0.0;

  float billow = w0.b * 0.6 + w1.b * 0.4;
  float base = billow * profile;
  float d = smoothstep(1.0 - cov, 1.0 - cov * 0.30, base);
  if (d <= 0.002) return 0.0;

  if (detail > 0.5) {
    vec3 q = p * 0.0016 + vec3(uWind.x, 0.0, uWind.y) * 4.0;
    float er = noise3(q) * 0.60 + noise3(q * 3.3) * 0.30 + 0.10;
    // Erosion bites hardest at the cloud base and edges, which is what gives
    // cumulus their cauliflower silhouette instead of a smooth blob.
    d -= er * 0.42 * (1.0 - d) * (1.15 - h01 * 0.55);
  }
  return clamp(d, 0.0, 1.0) * uCloudDensity;
}

vec4 cumulusLayer(vec3 d, vec3 base){
  if (d.y < 0.006 || uCumulus <= 0.001) return vec4(0.0);
  float hb = uCloudBottom - uCamAlt;
  float ht = uCloudTop - uCamAlt;
  float t0 = skyShellT(d, hb);
  float t1 = skyShellT(d, ht);
  if (t0 < 0.0 || t1 <= t0) return vec4(0.0);
  t1 = min(t1, t0 + 26000.0);

  float cg = clamp(dot(d, uSunDir), -1.0, 1.0);
  float phase = mix(skyPhaseHG(cg, 0.78), skyPhaseHG(cg, -0.22), 0.28) * 5.0;

  int N = uSteps;
  float span = t1 - t0;
  // geometric step growth: fine near the camera, coarse at the horizon
  float g = 1.11;
  float gn = pow(g, float(N));
  float k = span * (g - 1.0) / (gn - 1.0);

  float lod = slabLod(t0, 3.1e-5, 256.0, d.y);
  float jitter = skyHash12(gl_FragCoord.xy + vec2(uTime * 13.7, uTime * 7.1));
  float T = 1.0;
  vec3 scat = vec3(0.0);
  float t = t0;
  float sigE = 0.055, sigS = 0.052;
  float lightStep = 190.0;

  for (int i = 0; i < 48; i++) {
    if (i >= N || T < 0.012) break;
    float dt = k * pow(g, float(i));
    vec3 p = d * (t + dt * jitter);
    float dens = cloudDensity(p, 1.0, lod);
    if (dens > 0.002) {
      float ltau = 0.0;
      for (int j = 0; j < 8; j++) {
        if (j >= uLightSteps) break;
        float ls = lightStep * (float(j) + 0.5) * (1.0 + float(j) * 0.6);
        ltau += cloudDensity(p + uSunDir * ls, 0.0, lod + 0.6) * lightStep * (1.0 + float(j) * 0.6);
      }
      float lt = exp(-ltau * sigE);
      float alt = skyAltitude(p, uCamAlt);
      float h01 = clamp((alt - uCloudBottom) / (uCloudTop - uCloudBottom), 0.0, 1.0);
      float powder = 1.0 - exp(-dens * 6.0);
      vec3 lum = uCloudSun * lt * phase * mix(0.35, 1.0, powder)
               + uCloudSun * lt * 0.28
               + uCloudAmb * mix(0.35, 1.0, h01);
      float ext = max(dens * sigE, 1e-5);
      float Tstep = exp(-ext * dt);
      scat += T * lum * (dens * sigS) * (1.0 - Tstep) / ext;
      T *= Tstep;
    }
    t += dt;
  }

  float alpha = clamp(1.0 - T, 0.0, 1.0);
  if (alpha < 0.002) return vec4(0.0);

  // aerial perspective on the clouds themselves
  float ap = 1.0 - exp(-t0 * 7.5e-6);
  scat = mix(scat, base * alpha, ap * 0.88);
  alpha *= (1.0 - ap * 0.45);
  alpha *= smoothstep(0.006, 0.045, d.y);
  return vec4(scat, alpha) * uCumulus;
}

vec4 cirrusLayer(vec3 d, vec3 base){
  if (d.y < 0.008 || uCirrusAmt <= 0.001) return vec4(0.0);
  float t = skyShellT(d, CIRRUS_H - uCamAlt);
  if (t < 0.0) return vec4(0.0);
  vec3 p = d * t;
  vec2 uv = p.xz * 1.05e-5 + uWind * 1.3;
  float lod = slabLod(t, 1.05e-5, 512.0, d.y);
  float a = textureLod(uCirrus, uv, lod).r;
  a *= 0.45 + 0.75 * textureLod(uCirrus, uv * 2.37 + vec2(0.31, 0.17), lod + 1.24).g;
  a = smoothstep(0.30, 0.86, a);
  if (a <= 0.002) return vec4(0.0);

  vec2 sunOff = normalize(uSunDir.xz + vec2(1e-4)) * 0.010;
  float occ = textureLod(uCirrus, uv + sunOff, lod).r;
  float lit = 1.0 - 0.42 * smoothstep(0.30, 0.85, occ);

  float cg = clamp(dot(d, uSunDir), -1.0, 1.0);
  float ph = skyPhaseHG(cg, 0.64) * 5.0;
  vec3 col = uCloudSun * (0.42 + 1.35 * ph) * lit + uCloudAmb * 0.85;

  float ap = 1.0 - exp(-t * 4.2e-6);
  col = mix(col, base, ap * 0.85);
  a *= (1.0 - ap * 0.55) * uCirrusAmt;
  a *= smoothstep(0.008, 0.055, d.y);
  return vec4(col * a, a);
}

void main(){
  vec3 d = normalize(vSkyDir);
  vec3 col = skyBase(d);

  // --- sun disc with limb darkening ---------------------------------------
  float ca = clamp(dot(d, uSunDir), -1.0, 1.0);
  float ang = acos(ca);
  float r = ang / uSunAngular;
  if (r < 1.02 && uSunDiscOn > 0.0) {
    float mu = sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0)));
    vec3 limb = 1.0 - vec3(0.42, 0.51, 0.61) * (1.0 - mu);
    float edge = 1.0 - smoothstep(0.93, 1.01, r);
    col += uSunDisc * limb * edge * uSunDiscOn;
  }

  vec3 base = col;

  vec4 ci = cirrusLayer(d, base);
  col = col * (1.0 - ci.a) + ci.rgb;

  vec4 cu = cumulusLayer(d, base);
  col = col * (1.0 - cu.a) + cu.rgb;

  col *= uExposure;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export default class Sky {
  static id = 'sky';

  constructor(ctx) {
    this.ctx = ctx;
    this.quality = ctx.settings?.quality || 'high';

    this.model = new AtmosphereModel();
    this.elevationDeg = SUN_ELEVATION_DEG;
    this.azimuthDeg = SUN_AZIMUTH_DEG;
    this.turbidity = 4.2;

    this.sunPosition = new THREE.Vector3();
    this.sunDirection = new THREE.Vector3();

    this.clouds = {
      coverage: 0.32,
      cumulus: 1.0,
      cirrus: 0.72,
      density: 1.0,
      windSpeed: 0.0026,
      windDir: new THREE.Vector2(0.86, 0.51).normalize(),
    };

    this.fog = {
      density: 0.00105,       // per metre, exponential haze
      hazeHeight: 1600.0,     // scale height of that haze
      groundDensity: 0.0021,  // street-level layer
      groundHeight: 5.5,
      groundY: 0.0,
      maxDistance: 9000.0,
    };

    this.env = null;
    this.envMap = null;
    this.environment = null;
    this.glsl = { common: GLSL_COMMON, aerial: '', version: 0 };

    this._envRT = null;
    this._pmrem = null;
    this._dirty = true;
    this._fogRev = 0;
    this._sunFollow = true;
    this._shadowRadius = 42;
  }

  // ------------------------------------------------------------------ init
  async init() {
    const q = this.quality;
    const lutW = q === 'low' ? 96 : q === 'medium' ? 128 : 192;
    const lutH = lutW >> 1;
    this._lutW = lutW; this._lutH = lutH;

    // --- LUT texture ------------------------------------------------------
    this._lutData = new Uint16Array(lutW * lutH * 4);
    this.skyLUT = new THREE.DataTexture(
      this._lutData, lutW, lutH, THREE.RGBAFormat, THREE.HalfFloatType);
    this.skyLUT.name = 'sky_lut';
    this.skyLUT.wrapS = THREE.RepeatWrapping;
    this.skyLUT.wrapT = THREE.ClampToEdgeWrapping;
    this.skyLUT.minFilter = THREE.LinearFilter;
    this.skyLUT.magFilter = THREE.LinearFilter;
    this.skyLUT.generateMipmaps = false;
    this.skyLUT.colorSpace = THREE.NoColorSpace;

    // --- procedural cloud textures ---------------------------------------
    this.weatherTex = this._makeWeatherTexture(q === 'low' ? 128 : 256);
    this.cirrusTex = this._makeCirrusTexture(q === 'low' ? 256 : 512);

    // --- lights -----------------------------------------------------------
    const sun = new THREE.DirectionalLight(new THREE.Color(SUN_COLOR_HEX), SUN_INTENSITY);
    sun.name = 'sun';
    sun.castShadow = true;
    const smap = q === 'low' ? 1024 : q === 'medium' ? 1536 : 2048;
    sun.shadow.mapSize.set(smap, smap);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 260;
    sun.shadow.camera.left = -this._shadowRadius;
    sun.shadow.camera.right = this._shadowRadius;
    sun.shadow.camera.top = this._shadowRadius;
    sun.shadow.camera.bottom = -this._shadowRadius;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = q === 'low' ? 1.0 : 1.7;
    sun.target.position.set(0, 0, 0);
    this.ctx.scene.add(sun, sun.target);
    this.sun = sun;

    const bounce = new THREE.DirectionalLight(new THREE.Color(BOUNCE_COLOR_HEX), BOUNCE_INTENSITY);
    bounce.name = 'ground_bounce';
    bounce.castShadow = false;
    this.ctx.scene.add(bounce, bounce.target);
    this.bounce = bounce;

    // --- dome -------------------------------------------------------------
    const segs = q === 'low' ? [64, 32] : q === 'medium' ? [96, 48] : [144, 72];
    this._domeGeo = new THREE.SphereGeometry(320, segs[0], segs[1]);
    this.uniforms = {
      uSkyLUT: { value: this.skyLUT },
      uWeather: { value: this.weatherTex },
      uCirrus: { value: this.cirrusTex },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMieTint: { value: new THREE.Vector3(1, 1, 1) },
      uSunDisc: { value: new THREE.Vector3(1, 1, 1) },
      uCloudSun: { value: new THREE.Vector3(1, 1, 1) },
      uCloudAmb: { value: new THREE.Vector3(0.2, 0.3, 0.45) },
      uMieG: { value: MIE_G },
      uSunAngular: { value: SUN_ANGULAR_RADIUS },
      uSunDiscOn: { value: 1.0 },
      uExposure: { value: 1.0 },
      uTime: { value: 0 },
      uCamAlt: { value: 2.0 },
      uPixAngle: { value: 0.0022 },
      uWind: { value: new THREE.Vector2() },
      uCoverage: { value: this.clouds.coverage },
      uCumulus: { value: this.clouds.cumulus },
      uCirrusAmt: { value: this.clouds.cirrus },
      uCloudDensity: { value: this.clouds.density },
      uCloudBottom: { value: CLOUD_BOTTOM },
      uCloudTop: { value: CLOUD_TOP },
      uSteps: { value: q === 'low' ? 0 : q === 'medium' ? 14 : q === 'high' ? 24 : 34 },
      uLightSteps: { value: q === 'medium' ? 3 : q === 'high' ? 4 : 6 },
    };

    this._domeMat = new THREE.ShaderMaterial({
      name: 'sky_dome',
      uniforms: this.uniforms,
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG.replace(/CIRRUS_H/g, CIRRUS_ALT.toFixed(1)),
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: true,
    });

    this.dome = new THREE.Mesh(this._domeGeo, this._domeMat);
    this.dome.name = 'sky_dome';
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.matrixAutoUpdate = true;
    this.dome.userData.sky = true;
    this.dome.userData.noDepth = true;   // volumetrics/depth prepasses skip this
    this.ctx.scene.add(this.dome);

    this._envScene = new THREE.Scene();
    this._envDome = new THREE.Mesh(this._domeGeo, this._domeMat);
    this._envDome.frustumCulled = false;
    this._envScene.add(this._envDome);

    // --- fog --------------------------------------------------------------
    this.ctx.scene.fog = new THREE.FogExp2(0xffffff, this.fog.density);

    // --- build ------------------------------------------------------------
    this._pmrem = new THREE.PMREMGenerator(this.ctx.renderer);
    this.refresh();

    // atmosphere.js is not in the engine manifest — sky owns and drives it.
    this.atmosphere = new Atmosphere(this.ctx, this);
    this.ctx.atmosphere = this.atmosphere;
    this.ctx.systems?.set?.('atmosphere', this.atmosphere);
    await this.atmosphere.init();

    console.log(`[sky] elev ${this.elevationDeg}° az ${this.azimuthDeg}° ` +
      `turbidity ${this.turbidity} LUT ${lutW}x${lutH} (${q})`);
  }

  resize(w, h) { this.atmosphere?.resize(w, h); }

  // -------------------------------------------------------------- rebuild
  /** Force a full rebuild of the LUT, environment and fog chunk. */
  refresh() {
    this._buildSun();
    this._buildLUT();
    this._installFogChunk();
    this._buildEnv();
    this._dirty = false;
  }

  _buildSun() {
    const el = this.elevationDeg * D2R, az = this.azimuthDeg * D2R;
    this.sunPosition.set(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el),
    ).normalize();
    this.sunDirection.copy(this.sunPosition).multiplyScalar(-1);

    const sun = this.sun;
    if (sun) {
      sun.position.copy(this.sunPosition).multiplyScalar(120);
      sun.target.position.set(0, 0, 0);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    }
    if (this.bounce) {
      // from below and slightly opposite the sun
      this.bounce.position.set(
        -this.sunPosition.x * 12, -22, -this.sunPosition.z * 12);
      this.bounce.target.position.set(0, 0, 0);
      this.bounce.target.updateMatrixWorld();
      this.bounce.updateMatrixWorld();
    }
    this.uniforms && this.uniforms.uSunDir.value.copy(this.sunPosition);
  }

  _buildLUT() {
    const m = this.model;
    m.mieG = MIE_G;
    m.mieTint = [1, 1, 1];
    m.prepare(this.sunPosition, this.turbidity);

    // Mie tint: the chromatic ratio of the real Mie integral, measured in the
    // aureole where it matters, normalised on green.
    const st = m.sunTransmittance;
    {
      const probe = new Float64Array(7);
      const up = new THREE.Vector3(0, 1, 0);
      const tang = new THREE.Vector3().crossVectors(this.sunPosition, up).normalize();
      const d = this.sunPosition.clone()
        .multiplyScalar(Math.cos(9 * D2R))
        .addScaledVector(tang, Math.sin(9 * D2R)).normalize();
      m.march(d.x, d.y, d.z, probe);
      const mg = Math.max(m._mieRGB[1], 1e-12);
      m.mieTint = [
        Math.min(2.0, m._mieRGB[0] / mg),
        1.0,
        Math.min(2.0, m._mieRGB[2] / mg),
      ];
    }

    const W = this._lutW, H = this._lutH;
    const data = this._lutData;
    const o = new Float64Array(7);
    const toHalf = THREE.DataUtils.toHalfFloat;
    const exp = m.exposure;

    for (let y = 0; y < H; y++) {
      const theta = (y + 0.5) / H * Math.PI;
      const st_ = Math.sin(theta), ct = Math.cos(theta);
      for (let x = 0; x < W; x++) {
        const phi = ((x + 0.5) / W - 0.5) * Math.PI * 2;
        const dx = Math.cos(phi) * st_;
        const dz = Math.sin(phi) * st_;
        const dy = ct;
        m.march(dx, dy, dz, o);
        const cg = dx * m.sunDir.x + dy * m.sunDir.y + dz * m.sunDir.z;
        const pr = AtmosphereModel.phaseR(cg);
        // fold the ground term into the Rayleigh slot so it survives the
        // phase multiplication exactly.
        const i = (y * W + x) * 4;
        data[i] = toHalf((o[0] + o[4] / pr) * exp);
        data[i + 1] = toHalf((o[1] + o[5] / pr) * exp);
        data[i + 2] = toHalf((o[2] + o[6] / pr) * exp);
        data[i + 3] = toHalf(o[3] * exp);
      }
    }
    this.skyLUT.needsUpdate = true;

    // --- sun disc radiance -------------------------------------------------
    // Photographic, not physical: a true 14 000x disc destroys the frame.
    const discBase = 210.0;
    const target = new THREE.Color(SUN_COLOR_HEX).convertSRGBToLinear();
    const tt = [st[0], st[1], st[2]];
    const tmax = Math.max(tt[0], tt[1], tt[2], 1e-5);
    const disc = [
      target.r * (tt[0] / tmax) * discBase,
      target.g * (tt[1] / tmax) * discBase,
      target.b * (tt[2] / tmax) * discBase,
    ];

    // --- cloud lighting ----------------------------------------------------
    const sunLit = [
      target.r * tt[0] * 3.6,
      target.g * tt[1] * 3.6,
      target.b * tt[2] * 3.6,
    ];
    const amb = this.sample(new THREE.Vector3(0, 1, 0));
    const ambDown = this.sample(new THREE.Vector3(0, 0.12, 0));

    if (this.uniforms) {
      const u = this.uniforms;
      u.uMieTint.value.set(m.mieTint[0], m.mieTint[1], m.mieTint[2]);
      u.uSunDisc.value.set(disc[0], disc[1], disc[2]);
      u.uCloudSun.value.set(sunLit[0], sunLit[1], sunLit[2]);
      u.uCloudAmb.value.set(
        (amb.r + ambDown.r) * 0.34,
        (amb.g + ambDown.g) * 0.34,
        (amb.b + ambDown.b) * 0.36);
      u.uMieG.value = m.mieG;
      u.uCamAlt.value = m.camAlt;
    }

    this._fitFogConstants();
  }

  /**
   * Least-squares fit of a 4-basis analytic model to the baked sky so the fog
   * chunk (which cannot sample the LUT) reproduces the same radiance field.
   */
  _fitFogConstants() {
    const m = this.model;
    const N = 620;
    const A = [];   // rows of [b0,b1,b2,b3]
    const Y = [[], [], []];
    const out = [0, 0, 0];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const yv = 1 - (i + 0.5) / N * 2;      // -1..1
      const rad = Math.sqrt(Math.max(0, 1 - yv * yv));
      const th = ga * i;
      const dx = Math.cos(th) * rad, dz = Math.sin(th) * rad, dy = yv;
      m.radiance(dx, dy, dz, out);
      const t = Math.pow(clamp01(dy), 0.55);
      const gUp = smoothstep(-0.18, 0.03, dy);
      const cg = dx * m.sunDir.x + dy * m.sunDir.y + dz * m.sunDir.z;
      const hg = AtmosphereModel.phaseHG(cg, m.mieG);
      // weight: emphasise the band we actually look through
      const w = dy > -0.15 ? 1.0 : 0.25;
      A.push([gUp * (1 - t) * w, gUp * t * w, (1 - gUp) * w, hg * w]);
      Y[0].push(out[0] * w); Y[1].push(out[1] * w); Y[2].push(out[2] * w);
    }

    const solve = (yv) => {
      const M = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
      for (let r = 0; r < A.length; r++) {
        const a = A[r];
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 4; j++) M[i][j] += a[i] * a[j];
          M[i][4] += a[i] * yv[r];
        }
      }
      for (let i = 0; i < 4; i++) M[i][i] += 1e-9;
      for (let c = 0; c < 4; c++) {
        let piv = c;
        for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        const tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
        const d = M[c][c] || 1e-12;
        for (let j = c; j < 5; j++) M[c][j] /= d;
        for (let r = 0; r < 4; r++) {
          if (r === c) continue;
          const f = M[r][c];
          if (f === 0) continue;
          for (let j = c; j < 5; j++) M[r][j] -= f * M[c][j];
        }
      }
      return [M[0][4], M[1][4], M[2][4], M[3][4]];
    };

    const s = [solve(Y[0]), solve(Y[1]), solve(Y[2])];
    const pick = (k) => [Math.max(0, s[0][k]), Math.max(0, s[1][k]), Math.max(0, s[2][k])];
    this._fogFit = {
      horizon: pick(0),
      zenith: pick(1),
      ground: pick(2),
      mie: pick(3),
    };
  }

  // ------------------------------------------------------------- fog chunk
  _installFogChunk() {
    const f = this._fogFit || {
      horizon: [0.5, 0.6, 0.75], zenith: [0.2, 0.3, 0.55],
      ground: [0.3, 0.3, 0.3], mie: [0.4, 0.4, 0.4],
    };
    const v3 = (a) => `vec3(${a[0].toFixed(6)}, ${a[1].toFixed(6)}, ${a[2].toFixed(6)})`;
    const sd = this.sunPosition;
    const g = this.fog;

    const aerial = /* glsl */`
#define SKY_FOG_G ${this.model.mieG.toFixed(4)}
const vec3 SKY_FOG_HORIZON = ${v3(f.horizon)};
const vec3 SKY_FOG_ZENITH  = ${v3(f.zenith)};
const vec3 SKY_FOG_GROUND  = ${v3(f.ground)};
const vec3 SKY_FOG_MIE     = ${v3(f.mie)};
const vec3 SKY_FOG_SUNDIR  = vec3(${sd.x.toFixed(6)}, ${sd.y.toFixed(6)}, ${sd.z.toFixed(6)});
const float SKY_FOG_HAZE_H   = ${g.hazeHeight.toFixed(2)};
const float SKY_FOG_GROUND_D = ${g.groundDensity.toFixed(6)};
const float SKY_FOG_GROUND_H = ${g.groundHeight.toFixed(3)};
const float SKY_FOG_GROUND_Y = ${g.groundY.toFixed(3)};
const float SKY_FOG_MAXDIST  = ${g.maxDistance.toFixed(1)};

// Analytic reconstruction of the baked sky radiance (least-squares fitted).
vec3 skyFogInscatter( vec3 d ) {
  float t = pow( clamp( d.y, 0.0, 1.0 ), 0.55 );
  float gu = smoothstep( -0.18, 0.03, d.y );
  vec3 c = mix( SKY_FOG_HORIZON, SKY_FOG_ZENITH, t ) * gu + SKY_FOG_GROUND * ( 1.0 - gu );
  float cg = clamp( dot( d, SKY_FOG_SUNDIR ), -1.0, 1.0 );
  float g2 = SKY_FOG_G * SKY_FOG_G;
  float dd = 1.0 + g2 - 2.0 * SKY_FOG_G * cg;
  c += SKY_FOG_MIE * ( ( 1.0 - g2 ) / ( 12.566370614 * dd * sqrt( max( dd, 1e-4 ) ) ) );
  return max( c, vec3( 0.0 ) );
}

// Optical depth of one exponential height layer, analytic.
float skyFogLayer( float y0, float dy, float dist, float dens, float H, float refY ) {
  float e = exp( -clamp( ( y0 - refY ) / H, -6.0, 32.0 ) );
  float dyH = clamp( dy * dist / H, -6.0, 32.0 );
  float k = abs( dyH ) < 1e-4 ? 1.0 : ( 1.0 - exp( -dyH ) ) / dyH;
  return dens * dist * e * k;
}

vec3 skyApplyAerial( vec3 color, vec3 dir, float dist, float camY ) {
  dist = min( dist, SKY_FOG_MAXDIST );
  #ifdef FOG_EXP2
    float hazeD = fogDensity;
  #else
    float hazeD = 1.0 / max( fogFar, 1.0 );
  #endif
  float tau = skyFogLayer( camY, dir.y, dist, hazeD, SKY_FOG_HAZE_H, 0.0 )
            + skyFogLayer( camY, dir.y, dist, SKY_FOG_GROUND_D, SKY_FOG_GROUND_H, SKY_FOG_GROUND_Y );
  float T = exp( -min( tau, 14.0 ) );
  vec3 ins = skyFogInscatter( dir ) * fogColor;
  return color * T + ins * ( 1.0 - T );
}
`;

    THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vSkyFogPos;
#endif`;

    THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  {
    mat3 skyVM = mat3( viewMatrix );
    vec3 skyP = mvPosition.xyz;
    vSkyFogPos = cameraPosition + vec3(
      dot( skyVM[ 0 ], skyP ), dot( skyVM[ 1 ], skyP ), dot( skyVM[ 2 ], skyP ) );
  }
#endif`;

    THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vSkyFogPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
${aerial}
#endif`;

    THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  {
    vec3 skyFogV = vSkyFogPos - cameraPosition;
    float skyFogDist = length( skyFogV );
    vec3 skyFogDir = skyFogDist > 1e-4 ? skyFogV / skyFogDist : vec3( 0.0, 1.0, 0.0 );
    gl_FragColor.rgb = skyApplyAerial( gl_FragColor.rgb, skyFogDir, skyFogDist, cameraPosition.y );
  }
#endif`;

    this.glsl.aerial = aerial;
    this.glsl.version = ++this._fogRev;

    if (this._fogRev > 1) this._forceFogRecompile();
  }

  /** Bump a define on every scene material so cached programs are rebuilt. */
  _forceFogRecompile() {
    const rev = this._fogRev;
    const touch = (mat) => {
      if (!mat || mat === this._domeMat) return;
      mat.defines = mat.defines || {};
      mat.defines.SKY_FOG_REV = rev;
      mat.needsUpdate = true;
    };
    this.ctx.scene.traverse((o) => {
      if (!o.material) return;
      if (Array.isArray(o.material)) o.material.forEach(touch);
      else touch(o.material);
    });
  }

  // ------------------------------------------------------------------- env
  _buildEnv() {
    const u = this.uniforms;
    const savedDisc = u.uSunDiscOn.value;
    const savedSteps = u.uSteps.value;
    const savedPix = u.uPixAngle.value;
    u.uSunDiscOn.value = 0.0;              // the DirectionalLight already is the sun
    u.uSteps.value = Math.min(savedSteps, 10);
    u.uPixAngle.value = 2 / 256;           // PMREM renders 256px cube faces at 90deg

    const rt = this._pmrem.fromScene(this._envScene, 0, 1, 1200);

    u.uSunDiscOn.value = savedDisc;
    u.uSteps.value = savedSteps;

    if (this._envRT) this._envRT.dispose();
    this._envRT = rt;
    this.env = rt.texture;
    this.env.name = 'sky_env';
    this.envMap = this.env;
    this.environment = this.env;

    this.ctx.scene.environment = this.env;
    this.ctx.scene.environmentIntensity = 1.0;
    if (this.ctx.viewScene) {
      this.ctx.viewScene.environment = this.env;
      this.ctx.viewScene.environmentIntensity = 1.0;
    }
    this.ctx.events?.emit('sky:env', { env: this.env });
  }

  // ----------------------------------------------------------- procedural
  _makeWeatherTexture(S) {
    const data = new Uint8Array(S * S * 4);
    const P = 8;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S * P, v = y / S * P;
        // domain warp so the cell structure doesn't read as a grid
        const wx = fbm2(u * 0.5 + 11.3, v * 0.5 + 4.7, P, 917, 3) - 0.5;
        const wy = fbm2(u * 0.5 - 3.1, v * 0.5 + 9.2, P, 431, 3) - 0.5;
        const uu = u + wx * 1.6, vv = v + wy * 1.6;

        // coverage: clustered, with big clear gaps
        const n = fbm2(uu, vv, P, 101, 5, 0.52);
        const cluster = fbm2(uu * 0.30, vv * 0.30, Math.max(1, P >> 1), 733, 2);
        // Spread to a full 0..1 range with real holes; clusters gate the field
        // so cumulus form in fleets rather than an even scatter.
        let cov = clamp01((n - 0.34) / 0.30) * clamp01((cluster - 0.30) / 0.34);
        cov = Math.pow(cov, 0.85);

        // cloud type — how tall the column gets
        const type = clamp01((fbm2(uu * 0.55 + 21.0, vv * 0.55 - 8.0, P, 577, 3) - 0.34) / 0.32);

        // billow: worley cauliflower
        let bil = worleyFbm(uu * 1.55, vv * 1.55, P * 2, 205, 3);
        bil = clamp01((bil - 0.22) / 0.55);

        // erosion field
        const er = clamp01(ridged2(uu * 2.4, vv * 2.4, P * 2, 353, 3));

        const i = (y * S + x) * 4;
        data[i] = (cov * 255) | 0;
        data[i + 1] = (type * 255) | 0;
        data[i + 2] = (bil * 255) | 0;
        data[i + 3] = (er * 255) | 0;
      }
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = 'sky_weather';
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  _makeCirrusTexture(S) {
    const data = new Uint8Array(S * S * 4);
    const P = 10;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S * P, v = y / S * P;
        // stretch heavily along +x so the streaks read as wind-combed cirrus
        const sx = u * 0.19, sy = v * 1.15;
        const wx = (fbm2(sx * 0.9 + 3.3, sy * 0.9 + 1.1, P, 61, 3) - 0.5) * 1.9;
        const wy = (fbm2(sx * 0.9 - 7.7, sy * 0.9 + 5.5, P, 137, 3) - 0.5) * 0.55;

        let a = ridged2(sx + wx, sy + wy, P, 811, 5);
        const mask = fbm2(u * 0.28 + 2.0, v * 0.28 - 1.0, Math.max(1, P >> 1), 991, 3);
        a = clamp01(a * 1.15 * smoothstep(0.34, 0.78, mask));

        // fine filaments
        let b = ridged2((sx + wx) * 3.4, (sy + wy) * 3.4, P * 2, 1223, 3);
        b = clamp01(b);

        const i = (y * S + x) * 4;
        data[i] = (a * 255) | 0;
        data[i + 1] = (b * 255) | 0;
        data[i + 2] = (clamp01(mask) * 255) | 0;
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = 'sky_cirrus';
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  // ------------------------------------------------------------ public API
  /** HDR sky radiance (linear, exposure applied) for a world direction. */
  sample(dir, target) {
    const out = this._sampleOut || (this._sampleOut = [0, 0, 0]);
    const d = dir;
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    this.model.radiance(d.x / len, d.y / len, d.z / len, out);
    const c = target || new THREE.Color();
    return c.setRGB(out[0], out[1], out[2], THREE.LinearSRGBColorSpace);
  }

  setSun(elevationDeg, azimuthDeg = this.azimuthDeg) {
    this.elevationDeg = elevationDeg;
    this.azimuthDeg = azimuthDeg;
    this.refresh();
    return this;
  }

  setTurbidity(t) { this.turbidity = t; this.refresh(); return this; }

  setClouds(opts = {}) {
    Object.assign(this.clouds, opts);
    const u = this.uniforms;
    if (u) {
      u.uCoverage.value = this.clouds.coverage;
      u.uCumulus.value = this.clouds.cumulus;
      u.uCirrusAmt.value = this.clouds.cirrus;
      u.uCloudDensity.value = this.clouds.density;
    }
    this._buildEnv();
    return this;
  }

  setFog(opts = {}) {
    Object.assign(this.fog, opts);
    if (this.ctx.scene.fog) this.ctx.scene.fog.density = this.fog.density;
    this._installFogChunk();
    return this;
  }

  /** Presets. 'midmorning' is the ARTDIRECTION reference and the default. */
  setPreset(name) {
    switch (name) {
      case 'noon':
        this.elevationDeg = 68; this.azimuthDeg = 150; this.turbidity = 2.6;
        this.clouds.coverage = 0.34; this.clouds.cirrus = 0.5;
        this.fog.density = 0.0011; break;
      case 'golden':
        this.elevationDeg = 7; this.azimuthDeg = 262; this.turbidity = 4.2;
        this.clouds.coverage = 0.46; this.clouds.cirrus = 0.85;
        this.fog.density = 0.0024; break;
      case 'dusk':
        this.elevationDeg = -2.5; this.azimuthDeg = 272; this.turbidity = 4.6;
        this.clouds.coverage = 0.44; this.clouds.cirrus = 0.9;
        this.fog.density = 0.0028; break;
      case 'overcast':
        this.elevationDeg = 30; this.azimuthDeg = 118; this.turbidity = 8.0;
        this.clouds.coverage = 0.88; this.clouds.cirrus = 0.25;
        this.fog.density = 0.0038; break;
      case 'midmorning':
      default:
        this.elevationDeg = SUN_ELEVATION_DEG; this.azimuthDeg = SUN_AZIMUTH_DEG;
        this.turbidity = 4.2;
        this.clouds.coverage = 0.32; this.clouds.cirrus = 0.72;
        this.fog.density = 0.00105; break;
    }
    if (this.ctx.scene.fog) this.ctx.scene.fog.density = this.fog.density;
    this.setClouds({});
    this.refresh();
    return this;
  }

  setTimeOfDay(hours) {
    // Simple analemma-free model: sun sweeps 118deg azimuth at 09:00.
    const h = ((hours % 24) + 24) % 24;
    const t = (h - 12) / 12 * Math.PI;              // -PI..PI, 0 = noon
    const elev = Math.asin(Math.cos(t) * 0.94) / D2R - 8;
    const az = 118 + (h - 9) * 15;
    return this.setSun(elev, az);
  }

  /** Level systems can turn off the automatic shadow-frustum follow. */
  set sunFollow(v) { this._sunFollow = !!v; }
  get sunFollow() { return this._sunFollow; }

  // ---------------------------------------------------------------- update
  update(dt, t) {
    const u = this.uniforms;
    if (!u) return;
    u.uTime.value = t;
    const w = this.clouds;
    u.uWind.value.set(
      w.windDir.x * w.windSpeed * t,
      w.windDir.y * w.windSpeed * t);

    const cam = this.ctx.camera;
    if (this.dome) this.dome.position.copy(cam.position);
    u.uCamAlt.value = Math.max(0.5, cam.position.y);
    const px = this.ctx.renderer?.domElement?.height || 900;
    u.uPixAngle.value = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5) / px;

    if (this._sunFollow && this.sun) {
      // Keep the shadow frustum around the viewer, snapped to shadow texels
      // so the shadow edges do not shimmer while walking.
      const r = this._shadowRadius;
      const texel = (r * 2) / this.sun.shadow.mapSize.x;
      const fwd = this._fwd || (this._fwd = new THREE.Vector3());
      cam.getWorldDirection(fwd);
      const cx = cam.position.x + fwd.x * r * 0.45;
      const cz = cam.position.z + fwd.z * r * 0.45;
      const sx = Math.round(cx / texel) * texel;
      const sz = Math.round(cz / texel) * texel;
      this.sun.target.position.set(sx, 0, sz);
      this.sun.position.set(
        sx + this.sunPosition.x * 120,
        this.sunPosition.y * 120,
        sz + this.sunPosition.z * 120);
      this.sun.target.updateMatrixWorld();
      this.sun.updateMatrixWorld();

      this.bounce.position.set(sx - this.sunPosition.x * 12, -22, sz - this.sunPosition.z * 12);
      this.bounce.target.position.set(sx, 0, sz);
      this.bounce.target.updateMatrixWorld();
      this.bounce.updateMatrixWorld();
    }

    if (this._dirty) this.refresh();
    this.atmosphere?.update(dt, t);
  }

  lateUpdate(dt, t) { this.atmosphere?.lateUpdate(dt, t); }

  dispose() {
    this.atmosphere?.dispose();
    this._domeGeo?.dispose();
    this._domeMat?.dispose();
    this.skyLUT?.dispose();
    this.weatherTex?.dispose();
    this.cirrusTex?.dispose();
    this._envRT?.dispose();
    this._pmrem?.dispose();
  }
}
