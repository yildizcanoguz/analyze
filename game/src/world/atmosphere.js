// ---------------------------------------------------------------------------
// atmosphere.js — volumetric light shafts (god rays) + suspended dust.
// Owner: `sky`.  Instantiated and driven by sky.js, registered as ctx.atmosphere.
//
// ===========================================================================
// POSTFX CONTRACT  (src/core/postfx.js — this is the whole surface you need)
// ===========================================================================
//
//   ctx.atmosphere.setManaged(true)
//     Call this ONCE in postfx.init(). It removes atmosphere's standalone
//     self-compositing quad and its private depth prepass, because you are
//     going to drive it. If you never call it, atmosphere renders and
//     composites itself (correct, just ~1 extra depth-only scene pass).
//
//   ctx.atmosphere.render(renderer, camera, depthTexture, opts?) -> THREE.Texture|null
//     Renders the volumetric in-scattering buffer for THIS frame.
//       renderer     : THREE.WebGLRenderer
//       camera       : the world camera the frame was rendered with
//       depthTexture : THREE.DepthTexture of the current frame (full res,
//                      non-linear perspective depth). Pass null to let
//                      atmosphere run its own quarter-res depth prepass.
//       opts         : { width, height } full-res frame size (default: canvas)
//     Returns an RGBA16F texture at `ctx.atmosphere.scale` x resolution:
//       .rgb = pre-exposed ADDITIVE in-scattered light (linear HDR)
//       .a   = linear ray length at that pixel (used by the upsample)
//     Returns null only when ctx.atmosphere.enabled === false.
//     Insert the result in the chain BEFORE bloom, exactly as ARTDIRECTION.md
//     specifies (`... -> SSR -> volumetrics -> bloom -> ...`).
//
//   ctx.atmosphere.composite(renderer, target, lightTexture, depthTexture)
//     Convenience: additively blends `lightTexture` onto `target`
//     (a WebGLRenderTarget, or null for the canvas) with a depth-aware
//     bilateral upsample. Does not clear. Blending is ADDITIVE.
//     If you prefer to fold the add into your own shader, just sample the
//     texture yourself — it is plain additive light.
//
//   ctx.atmosphere.setShadowCascades([{ map, matrix, far }, ...])
//     Optional. If the level uses CSM, hand the cascades over (max 4);
//     `matrix` is three's `light.shadow.matrix`, `far` is the view-space
//     depth at which that cascade ends. Without this, atmosphere reads
//     ctx.sky.sun.shadow directly.
//
//   ctx.atmosphere.enabled  (bool)   ctx.atmosphere.scale (0.25..1)
//   ctx.atmosphere.intensity (float) ctx.atmosphere.lightBuffer (Texture|null)
//
// ===========================================================================

import * as THREE from 'three';

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const VOL_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;

uniform sampler2D tDepth;
uniform sampler2D tHistory;
uniform mat4  uInvProj;
uniform mat4  uCamToWorld;
uniform mat4  uPrevViewProj;
uniform vec3  uCamPos;
uniform vec3  uSunDir;         // toward the sun
uniform vec3  uSunColor;       // sun radiance (linear, pre-exposed)
uniform vec3  uAmbient;        // sky ambient for the medium
uniform vec2  uResolution;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform float uFrame;
uniform float uMaxDist;
uniform float uHazeDensity;
uniform float uHazeHeight;
uniform float uGroundDensity;
uniform float uGroundHeight;
uniform float uGroundY;
uniform float uPhaseG;
uniform float uIntensity;
uniform float uHistoryBlend;
uniform float uDustAmount;
uniform int   uSteps;

#if VOL_CASCADES > 0
  #ifdef VOL_SHADOW_COMPARE
    uniform sampler2DShadow uShadow0;
    #if VOL_CASCADES > 1
      uniform sampler2DShadow uShadow1;
    #endif
    #if VOL_CASCADES > 2
      uniform sampler2DShadow uShadow2;
    #endif
    #if VOL_CASCADES > 3
      uniform sampler2DShadow uShadow3;
    #endif
  #else
    uniform sampler2D uShadow0;
    #if VOL_CASCADES > 1
      uniform sampler2D uShadow1;
    #endif
    #if VOL_CASCADES > 2
      uniform sampler2D uShadow2;
    #endif
    #if VOL_CASCADES > 3
      uniform sampler2D uShadow3;
    #endif
  #endif
  uniform mat4  uShadowMat[VOL_CASCADES];
  uniform float uCascadeFar[VOL_CASCADES];
#endif

float hg(float c, float g){
  float g2 = g * g;
  float d = 1.0 + g2 - 2.0 * g * c;
  return (1.0 - g2) / (12.566370614 * d * sqrt(max(d, 1e-4)));
}

// Interleaved gradient noise — the practical stand-in for a blue-noise mask
// (Jimenez). Rotated per frame on the golden ratio so the temporal filter
// converges instead of pulsing.
float ign(vec2 p, float f){
  p += 5.588238 * fract(f * 0.6180339887);
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
                 mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                 mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}

#if VOL_CASCADES > 0
float sampleShadowMap(int idx, vec4 c){
  vec3 s = c.xyz / c.w;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return -1.0;
  #ifdef VOL_SHADOW_COMPARE
    if (idx == 0) return texture2D(uShadow0, s);
    #if VOL_CASCADES > 1
      if (idx == 1) return texture2D(uShadow1, s);
    #endif
    #if VOL_CASCADES > 2
      if (idx == 2) return texture2D(uShadow2, s);
    #endif
    #if VOL_CASCADES > 3
      if (idx == 3) return texture2D(uShadow3, s);
    #endif
  #else
    float d = 1.0;
    if (idx == 0) d = texture2D(uShadow0, s.xy).x;
    #if VOL_CASCADES > 1
      else if (idx == 1) d = texture2D(uShadow1, s.xy).x;
    #endif
    #if VOL_CASCADES > 2
      else if (idx == 2) d = texture2D(uShadow2, s.xy).x;
    #endif
    #if VOL_CASCADES > 3
      else if (idx == 3) d = texture2D(uShadow3, s.xy).x;
    #endif
    return step(s.z - 0.0012, d);
  #endif
  return -1.0;
}

float sunVisibility(vec3 wp, float viewZ){
  vec4 wpos = vec4(wp, 1.0);
  for (int i = 0; i < VOL_CASCADES; i++) {
    if (viewZ > uCascadeFar[i]) continue;
    float v = sampleShadowMap(i, uShadowMat[i] * wpos);
    if (v >= 0.0) return v;
  }
  return 1.0;
}
#else
float sunVisibility(vec3 wp, float viewZ){ return 1.0; }
#endif

float mediumDensity(vec3 wp){
  float h = wp.y - uGroundY;
  float d = uHazeDensity * exp(-clamp(h / uHazeHeight, -4.0, 30.0))
          + uGroundDensity * exp(-clamp(h / uGroundHeight, -3.0, 30.0));
  // Suspended particulate: slow drifting clumps, so shafts are not uniform.
  vec3 q = wp * 0.075 + vec3(uTime * 0.035, uTime * 0.012, uTime * -0.028);
  float clump = noise3(q) * 0.62 + noise3(q * 2.9) * 0.28 + 0.10;
  return d * mix(1.0, clump * 1.85, uDustAmount);
}

void main(){
  vec2 uv = vUv;

  // --- reconstruct the view ray ------------------------------------------
  vec4 clip = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec4 vpos = uInvProj * clip;
  vpos /= vpos.w;
  vec3 vdir = normalize(vpos.xyz);
  vec3 wdir = normalize(mat3(uCamToWorld) * vdir);
  float cosF = max(-vdir.z, 1e-4);

  float rawD = texture2D(tDepth, uv).x;
  float rayLen;
  if (rawD >= 0.9999995) {
    rayLen = uMaxDist;
  } else {
    float zn = rawD * 2.0 - 1.0;
    float viewZ = (2.0 * uNear * uFar) / (uFar + uNear - zn * (uFar - uNear));
    rayLen = min(viewZ / cosF, uMaxDist);
  }

#ifdef VOL_CHEAP
  // ---- 'low' tier: analytic radial shafts from the sun, depth-masked -----
  vec3 acc = vec3(0.0);
  {
    vec4 sp = uPrevViewProj * vec4(uCamPos + uSunDir * 5000.0, 1.0);
    vec2 sun2 = sp.xy / sp.w * 0.5 + 0.5;
    float behind = step(0.0, sp.w);
    vec2 delta = (sun2 - uv) / 16.0;
    vec2 p = uv;
    float w = 1.0;
    float occ = 0.0;
    for (int i = 0; i < 16; i++) {
      p += delta;
      float d = texture2D(tDepth, clamp(p, vec2(0.0), vec2(1.0))).x;
      occ += (d >= 0.9999995 ? 1.0 : 0.0) * w;
      w *= 0.94;
    }
    occ /= 11.0;
    float fall = 1.0 - smoothstep(0.0, 0.85, length(sun2 - uv));
    float ph = hg(dot(wdir, uSunDir), uPhaseG) * 4.0;
    acc = uSunColor * occ * fall * behind * (0.10 + 0.55 * ph)
        + uAmbient * 0.05 * (1.0 - exp(-rayLen * uHazeDensity));
  }
  gl_FragColor = vec4(acc * uIntensity, rayLen);
  return;
#else

  // --- raymarch -----------------------------------------------------------
  int N = uSteps;
  float jitter = ign(gl_FragCoord.xy, uFrame);
  float dt = rayLen / float(N);
  float phase = hg(dot(wdir, uSunDir), uPhaseG);
  float back = hg(dot(wdir, uSunDir), -0.18);
  float sigS = 0.62, sigE = 0.72;

  vec3 acc = vec3(0.0);
  float T = 1.0;

  for (int i = 0; i < 96; i++) {
    if (i >= N) break;
    float t = (float(i) + jitter) * dt;
    vec3 wp = uCamPos + wdir * t;
    float dens = mediumDensity(wp);
    if (dens > 1e-6) {
      float vis = sunVisibility(wp, t * cosF);
      vec3 lum = uSunColor * vis * (phase + back * 0.20) + uAmbient * 0.16;
      float se = dens * sigE;
      float Tstep = exp(-se * dt);
      acc += T * lum * (dens * sigS) * (1.0 - Tstep) / max(se, 1e-7);
      T *= Tstep;
      if (T < 0.02) break;
    }
  }
  acc *= uIntensity;

  // --- temporal reprojection ---------------------------------------------
  if (uHistoryBlend > 0.001) {
    vec3 wpEnd = uCamPos + wdir * rayLen;
    vec4 pp = uPrevViewProj * vec4(wpEnd, 1.0);
    if (pp.w > 0.0) {
      vec2 puv = pp.xy / pp.w * 0.5 + 0.5;
      if (puv.x > 0.001 && puv.x < 0.999 && puv.y > 0.001 && puv.y < 0.999) {
        vec4 hist = texture2D(tHistory, puv);
        float dz = abs(hist.a - rayLen) / max(rayLen, 1.0);
        float w = uHistoryBlend * (1.0 - smoothstep(0.015, 0.09, dz));
        acc = mix(acc, hist.rgb, w);
      }
    }
  }

  gl_FragColor = vec4(acc, rayLen);
#endif
}
`;

const COMPOSITE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tLight;
uniform sampler2D tDepth;
uniform vec2  uTexel;      // 1 / lowres size
uniform float uNear;
uniform float uFar;
uniform float uMaxDist;
uniform float uHasDepth;

float linearRay(float rawD){
  if (rawD >= 0.9999995) return uMaxDist;
  float zn = rawD * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - zn * (uFar - uNear));
}

void main(){
  vec3 outc;
  if (uHasDepth < 0.5) {
    outc = texture2D(tLight, vUv).rgb;
  } else {
    float ref = linearRay(texture2D(tDepth, vUv).x);
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    vec2 offs[4];
    offs[0] = vec2(-0.5, -0.5); offs[1] = vec2(0.5, -0.5);
    offs[2] = vec2(-0.5, 0.5);  offs[3] = vec2(0.5, 0.5);
    for (int i = 0; i < 4; i++) {
      vec2 uv = vUv + offs[i] * uTexel;
      vec4 s = texture2D(tLight, uv);
      float w = 1.0 / (1.0 + abs(s.a - ref) * 0.6);
      sum += s.rgb * w;
      wsum += w;
    }
    outc = sum / max(wsum, 1e-4);
  }
  gl_FragColor = vec4(outc, 1.0);
#ifdef ATMOS_LDR
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#endif
}
`;

// ---------------------------------------------------------------------------
// Dust motes
// ---------------------------------------------------------------------------
const DUST_VERT = /* glsl */`
precision highp float;
attribute vec3 aSeed;
uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uAmbient;
uniform float uTime;
uniform float uCell;
uniform float uSize;        // mote radius in metres
uniform float uProjScale;   // pixels per metre at 1 m (framebuffer height based)
uniform float uGroundY;
uniform float uHeightFalloff;

#if DUST_CASCADES > 0
  #ifdef DUST_SHADOW_COMPARE
    uniform sampler2DShadow uShadow0;
  #else
    uniform sampler2D uShadow0;
  #endif
  uniform mat4 uShadowMat0;
#endif

varying vec3 vColor;
varying float vAlpha;

void main(){
  // Tile the mote cloud around the camera so it is always populated.
  vec3 p = position;
  vec3 rel = uCamPos - p;
  p += floor(rel / uCell + 0.5) * uCell;

  // slow brownian drift + a gentle updraft
  float t = uTime * (0.11 + aSeed.z * 0.18);
  p += vec3(sin(t * 1.7 + aSeed.x * 31.0), sin(t * 0.9 + aSeed.y * 17.0) * 0.55,
            cos(t * 1.3 + aSeed.z * 23.0)) * (0.16 + aSeed.x * 0.22);
  p.y += mod(uTime * (0.012 + aSeed.y * 0.03), 1.0);

  float vis = 1.0;
#if DUST_CASCADES > 0
  vec4 sc = uShadowMat0 * vec4(p, 1.0);
  vec3 s = sc.xyz / sc.w;
  if (s.x > 0.0 && s.x < 1.0 && s.y > 0.0 && s.y < 1.0 && s.z < 1.0) {
    #ifdef DUST_SHADOW_COMPARE
      vis = texture(uShadow0, s);
    #else
      vis = step(s.z - 0.0015, texture2D(uShadow0, s.xy).x);
    #endif
  }
#endif

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  gl_Position = projectionMatrix * mv;

  float ph = pow(max(dot(normalize(uSunDir), normalize(p - uCamPos)), 0.0), 4.0);
  float hFade = exp(-max(p.y - uGroundY, 0.0) / uHeightFalloff);
  float nearF = smoothstep(0.6, 2.2, dist);            // don't smear on the lens
  float farF  = 1.0 - smoothstep(14.0, 30.0, dist);

  vColor = uSunColor * vis * (0.10 + 0.90 * ph) + uAmbient * 0.22;
  // A mote is only visible when the sun actually reaches it — that is the
  // whole point: the shafts should be made of lit particulate.
  vAlpha = (0.045 + 0.955 * vis) * hFade * nearF * farF;

  float px = uSize * uProjScale / max(dist, 0.25);
  gl_PointSize = clamp(px * (0.8 + vis * 0.6), 0.7, 5.0);
  if (vAlpha < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const DUST_FRAG = /* glsl */`
precision highp float;
varying vec3 vColor;
varying float vAlpha;
uniform float uIntensity;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c);
  if (r2 > 0.25) discard;
  float a = exp(-r2 * 14.0) * vAlpha * uIntensity;
  gl_FragColor = vec4(vColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------
export default class Atmosphere {
  static id = 'atmosphere';

  constructor(ctx, sky) {
    this.ctx = ctx;
    this.sky = sky;
    this.quality = ctx.settings?.quality || 'high';

    this.enabled = true;
    this.managed = false;
    this.intensity = 1.0;
    this.lightBuffer = null;

    const q = this.quality;
    this.cheap = q === 'low';
    this.scale = q === 'low' ? 0.25 : q === 'medium' ? 0.4 : 0.5;
    this.steps = q === 'low' ? 8 : q === 'medium' ? 20 : q === 'high' ? 36 : 56;
    this.historyBlend = q === 'low' || q === 'medium' ? 0.0 : 0.82;

    this.maxDistance = 140;
    this.phaseG = 0.72;
    this.dustAmount = 1.0;

    this._cascades = [];
    this._explicitCascades = null;
    this._prevViewProj = new THREE.Matrix4();
    this._viewProj = new THREE.Matrix4();
    this._rt = [null, null];
    this._rtIndex = 0;
    this._depthRT = null;
    this._size = new THREE.Vector2(1, 1);
    this._frame = 0;
    this._defKey = '';
  }

  // ------------------------------------------------------------------ init
  async init() {
    const q = this.quality;

    this._quadGeo = new THREE.BufferGeometry();
    this._quadGeo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this._quadGeo.setAttribute('uv', new THREE.BufferAttribute(
      new Float32Array([0, 0, 2, 0, 0, 2]), 2));

    this._volUniforms = {
      tDepth: { value: null },
      tHistory: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uCamToWorld: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Vector3(1, 0.95, 0.85) },
      uAmbient: { value: new THREE.Vector3(0.2, 0.3, 0.45) },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 600 },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uMaxDist: { value: this.maxDistance },
      uHazeDensity: { value: 0.0026 },
      uHazeHeight: { value: 34.0 },
      uGroundDensity: { value: 0.0068 },
      uGroundHeight: { value: 4.6 },
      uGroundY: { value: 0.0 },
      uPhaseG: { value: this.phaseG },
      uIntensity: { value: 1.0 },
      uHistoryBlend: { value: 0.0 },
      uDustAmount: { value: this.dustAmount },
      uSteps: { value: this.steps },
      uShadow0: { value: null },
      uShadow1: { value: null },
      uShadow2: { value: null },
      uShadow3: { value: null },
      uShadowMat: { value: [new THREE.Matrix4(), new THREE.Matrix4(),
                            new THREE.Matrix4(), new THREE.Matrix4()] },
      uCascadeFar: { value: [60, 120, 240, 480] },
    };

    this._volMat = new THREE.ShaderMaterial({
      name: 'atmos_volumetric',
      uniforms: this._volUniforms,
      vertexShader: FS_VERT,
      fragmentShader: VOL_FRAG,
      defines: { VOL_CASCADES: 0 },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    if (this.cheap) this._volMat.defines.VOL_CHEAP = 1;
    this._volQuad = new THREE.Mesh(this._quadGeo, this._volMat);
    this._volQuad.frustumCulled = false;
    this._volScene = new THREE.Scene();
    this._volScene.add(this._volQuad);
    this._volCam = new THREE.Camera();

    this._compUniforms = {
      tLight: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uNear: { value: 0.1 },
      uFar: { value: 600 },
      uMaxDist: { value: this.maxDistance },
      uHasDepth: { value: 1 },
    };
    this._compMat = new THREE.ShaderMaterial({
      name: 'atmos_composite',
      uniforms: this._compUniforms,
      vertexShader: FS_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this._compQuad = new THREE.Mesh(this._quadGeo, this._compMat);
    this._compQuad.frustumCulled = false;
    this._compScene = new THREE.Scene();
    this._compScene.add(this._compQuad);

    // Same composite, but tonemapped + sRGB-encoded because it lands straight
    // on the canvas rather than in an HDR post target.
    this._overlayMat = new THREE.ShaderMaterial({
      name: 'atmos_composite_ldr',
      uniforms: this._compUniforms,
      vertexShader: FS_VERT,
      fragmentShader: COMPOSITE_FRAG,
      defines: { ATMOS_LDR: 1 },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      toneMapped: true,
      fog: false,
    });

    // Standalone overlay: an additive fullscreen quad living in the world
    // scene so shafts still appear when nothing composes a post chain.
    this._overlay = new THREE.Mesh(this._quadGeo, this._overlayMat);
    this._overlay.frustumCulled = false;
    this._overlay.renderOrder = 9999;
    this._overlay.name = 'atmos_overlay';
    this._overlay.userData.noDepth = true;
    this._overlay.visible = false;
    this.ctx.scene.add(this._overlay);

    this._depthOverride = new THREE.MeshBasicMaterial({ colorWrite: false });

    this._buildDust();
    this.resize(
      this.ctx.renderer.domElement.width || 1600,
      this.ctx.renderer.domElement.height || 900);

    console.log(`[atmosphere] ${this.cheap ? 'analytic' : 'raymarched'} shafts, ` +
      `${this.steps} steps @ ${Math.round(this.scale * 100)}%, ` +
      `${this._dustCount} motes (${q})`);
  }

  // ------------------------------------------------------------------ dust
  _buildDust() {
    const q = this.quality;
    const n = q === 'low' ? 900 : q === 'medium' ? 2600 : q === 'high' ? 5200 : 9000;
    this._dustCount = n;
    const cell = 26.0;
    const rnd = this.ctx.rng ? this.ctx.rng(0x5eed) : Math.random;

    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * cell;
      // bias toward the lower half of the cell: dust hangs near the street
      pos[i * 3 + 1] = Math.pow(rnd(), 1.7) * cell - cell * 0.28;
      pos[i * 3 + 2] = (rnd() - 0.5) * cell;
      seed[i * 3] = rnd();
      seed[i * 3 + 1] = rnd();
      seed[i * 3 + 2] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this._dustUniforms = {
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Vector3(1, 0.95, 0.85) },
      uAmbient: { value: new THREE.Vector3(0.2, 0.3, 0.45) },
      uTime: { value: 0 },
      uCell: { value: cell },
      uSize: { value: 0.018 },
      uProjScale: { value: 500 },
      uGroundY: { value: 0 },
      uHeightFalloff: { value: 8.5 },
      uIntensity: { value: q === 'low' ? 0.16 : 0.24 },
      uShadow0: { value: null },
      uShadowMat0: { value: new THREE.Matrix4() },
    };

    this._dustMat = new THREE.ShaderMaterial({
      name: 'atmos_dust',
      uniforms: this._dustUniforms,
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      defines: { DUST_CASCADES: 0 },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: true,
      fog: false,
    });

    this.dust = new THREE.Points(geo, this._dustMat);
    this.dust.name = 'dust_motes';
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 5000;
    this.dust.userData.noDepth = true;
    this.ctx.scene.add(this.dust);
  }

  // -------------------------------------------------------------- targets
  resize(w, h) {
    w = Math.max(2, w | 0); h = Math.max(2, h | 0);
    this._size.set(w, h);
    const lw = Math.max(2, Math.round(w * this.scale));
    const lh = Math.max(2, Math.round(h * this.scale));
    if (this._rt[0] && this._rt[0].width === lw && this._rt[0].height === lh) return;

    for (let i = 0; i < 2; i++) {
      this._rt[i]?.dispose();
      this._rt[i] = new THREE.WebGLRenderTarget(lw, lh, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      this._rt[i].texture.name = `atmos_light_${i}`;
    }

    // Private depth prepass buffer (standalone mode only).
    this._depthRT?.dispose();
    const dw = Math.max(2, Math.round(w * 0.5)), dh = Math.max(2, Math.round(h * 0.5));
    this._depthRT = new THREE.WebGLRenderTarget(dw, dh, {
      depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this._depthRT.depthTexture = new THREE.DepthTexture(dw, dh, THREE.UnsignedIntType);
    this._depthRT.depthTexture.format = THREE.DepthFormat;
    this._depthRT.depthTexture.minFilter = THREE.NearestFilter;
    this._depthRT.depthTexture.magFilter = THREE.NearestFilter;
  }

  // ------------------------------------------------------------- cascades
  setShadowCascades(list) {
    this._explicitCascades = (list && list.length) ? list.slice(0, 4) : null;
    return this;
  }

  _gatherCascades() {
    if (this._explicitCascades) return this._explicitCascades;
    const csm = this.ctx.level?.csm;
    if (csm && Array.isArray(csm.lights) && csm.lights.length) {
      const out = [];
      const breaks = csm.breaksArray || csm.breaks || null;
      const far = csm.maxFar || 200;
      for (let i = 0; i < Math.min(4, csm.lights.length); i++) {
        const l = csm.lights[i];
        if (!l.shadow?.map) continue;
        const b = breaks && breaks[i] != null ? breaks[i] : (i + 1) / csm.lights.length;
        out.push({
          map: l.shadow.map.depthTexture || l.shadow.map.texture,
          matrix: l.shadow.matrix,
          far: (typeof b === 'number' && b <= 1.001) ? b * far : b,
        });
      }
      if (out.length) return out;
    }
    const sun = this.sky?.sun;
    if (sun?.castShadow && sun.shadow?.map) {
      const cam = sun.shadow.camera;
      const extent = Math.max(cam.right - cam.left, cam.top - cam.bottom);
      return [{
        map: sun.shadow.map.depthTexture || sun.shadow.map.texture,
        matrix: sun.shadow.matrix,
        far: Math.min(this.maxDistance, extent * 0.72),
      }];
    }
    return [];
  }

  _syncCascades() {
    const cs = this._gatherCascades();
    const n = Math.min(4, cs.length);
    const compare = n > 0 && cs[0].map && cs[0].map.compareFunction != null;
    const key = `${n}|${compare ? 1 : 0}`;
    if (key !== this._defKey) {
      this._defKey = key;
      this._volMat.defines.VOL_CASCADES = n;
      if (compare) this._volMat.defines.VOL_SHADOW_COMPARE = 1;
      else delete this._volMat.defines.VOL_SHADOW_COMPARE;
      this._volMat.needsUpdate = true;

      this._dustMat.defines.DUST_CASCADES = n > 0 ? 1 : 0;
      if (compare) this._dustMat.defines.DUST_SHADOW_COMPARE = 1;
      else delete this._dustMat.defines.DUST_SHADOW_COMPARE;
      this._dustMat.needsUpdate = true;
    }
    const u = this._volUniforms;
    for (let i = 0; i < n; i++) {
      u[`uShadow${i}`].value = cs[i].map;
      u.uShadowMat.value[i].copy(cs[i].matrix);
      u.uCascadeFar.value[i] = cs[i].far;
    }
    if (n > 0) {
      this._dustUniforms.uShadow0.value = cs[0].map;
      this._dustUniforms.uShadowMat0.value.copy(cs[0].matrix);
    }
    this._cascades = cs;
  }

  // ------------------------------------------------------------- lighting
  _syncLighting() {
    const sky = this.sky;
    if (!sky) return;
    const sd = sky.sunPosition;
    const col = sky.sun ? sky.sun.color : new THREE.Color(1, 1, 1);
    const inten = sky.sun ? sky.sun.intensity : 3.4;
    const lin = this._tmpCol || (this._tmpCol = new THREE.Color());
    lin.copy(col);
    const r = lin.r * inten, g = lin.g * inten, b = lin.b * inten;

    const ambC = sky.sample ? sky.sample(new THREE.Vector3(0, 0.65, 0)) : null;

    const vu = this._volUniforms, du = this._dustUniforms;
    vu.uSunDir.value.copy(sd);
    du.uSunDir.value.copy(sd);
    vu.uSunColor.value.set(r, g, b);
    du.uSunColor.value.set(r, g, b);
    if (ambC) {
      vu.uAmbient.value.set(ambC.r, ambC.g, ambC.b);
      du.uAmbient.value.set(ambC.r, ambC.g, ambC.b);
    }

    // Keep the medium consistent with the sky's fog model.
    const f = sky.fog;
    if (f) {
      vu.uHazeDensity.value = f.density * 1.55;
      vu.uHazeHeight.value = 42.0;
      vu.uGroundDensity.value = f.groundDensity * 1.5;
      vu.uGroundHeight.value = f.groundHeight * 1.35;
      vu.uGroundY.value = f.groundY;
      du.uGroundY.value = f.groundY;
    }
  }

  // -------------------------------------------------------------- postfx
  setManaged(on = true) {
    this.managed = !!on;
    if (this._overlay) this._overlay.visible = false;
    return this;
  }

  /** See the POSTFX CONTRACT block at the top of this file. */
  render(renderer, camera, depthTexture, opts = {}) {
    if (!this.enabled) return null;
    const w = opts.width || this._size.x;
    const h = opts.height || this._size.y;
    if (w !== this._size.x || h !== this._size.y) this.resize(w, h);

    let depth = depthTexture;
    let hasDepth = 1;
    if (!depth) {
      depth = this._renderPrivateDepth(renderer, camera);
      hasDepth = depth ? 1 : 0;
    }
    if (!depth) return null;

    this._syncCascades();
    this._syncLighting();

    const u = this._volUniforms;
    camera.updateMatrixWorld();
    u.tDepth.value = depth;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamToWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uResolution.value.set(w, h);
    u.uFrame.value = this._frame;
    u.uTime.value = this.ctx.time || 0;
    u.uMaxDist.value = this.maxDistance;
    u.uPhaseG.value = this.phaseG;
    u.uIntensity.value = this.intensity;
    u.uDustAmount.value = this.dustAmount;
    u.uSteps.value = this.steps;

    this._viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (this.cheap) {
      // the cheap path uses uPrevViewProj as "current" to project the sun
      u.uPrevViewProj.value.copy(this._viewProj);
      u.uHistoryBlend.value = 0;
    } else {
      u.uPrevViewProj.value.copy(this._frame === 0 ? this._viewProj : this._prevViewProj);
      u.uHistoryBlend.value = this._frame === 0 ? 0 : this.historyBlend;
    }

    const src = this._rt[this._rtIndex];
    const dst = this._rt[1 - this._rtIndex];
    u.tHistory.value = src.texture;

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(dst);
    renderer.render(this._volScene, this._volCam);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;

    this._rtIndex = 1 - this._rtIndex;
    this.lightBuffer = dst.texture;
    this._prevViewProj.copy(this._viewProj);
    this._frame++;

    // keep the composite material fed for whoever draws it
    this._compUniforms.tLight.value = dst.texture;
    this._compUniforms.tDepth.value = depth;
    this._compUniforms.uTexel.value.set(1 / dst.width, 1 / dst.height);
    this._compUniforms.uNear.value = camera.near;
    this._compUniforms.uFar.value = camera.far;
    this._compUniforms.uMaxDist.value = this.maxDistance;
    this._compUniforms.uHasDepth.value = hasDepth;

    return dst.texture;
  }

  /** Additive, depth-aware upsampled composite of the light buffer. */
  composite(renderer, target = null, lightTexture = null, depthTexture = null) {
    if (!this.lightBuffer) return;
    if (lightTexture) this._compUniforms.tLight.value = lightTexture;
    if (depthTexture) this._compUniforms.tDepth.value = depthTexture;
    const prev = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(this._compScene, this._volCam);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAuto;
  }

  // -------------------------------------------------------- private depth
  _renderPrivateDepth(renderer, camera) {
    const scene = this.ctx.scene;
    const hidden = [];
    const hide = (o) => { if (o && o.visible) { o.visible = false; hidden.push(o); } };
    hide(this.sky?.dome);
    hide(this.dust);
    hide(this._overlay);
    scene.traverse((o) => { if (o.userData && o.userData.noDepth) hide(o); });

    const prevOverride = scene.overrideMaterial;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevBg = scene.background;
    scene.overrideMaterial = this._depthOverride;
    scene.background = null;
    renderer.autoClear = true;
    renderer.setRenderTarget(this._depthRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;

    for (const o of hidden) o.visible = true;
    return this._depthRT.depthTexture;
  }

  // ---------------------------------------------------------------- frame
  update(dt, t) {
    const cam = this.ctx.camera;
    const du = this._dustUniforms;
    du.uTime.value = t;
    du.uCamPos.value.copy(cam.position);
    const h = this.ctx.renderer.domElement.height || 900;
    du.uProjScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5));
    if (this.dust) this.dust.position.set(0, 0, 0);
  }

  lateUpdate(dt, t) {
    if (this.managed || !this.enabled) return;
    // Nobody is driving us — do the whole thing ourselves.
    const renderer = this.ctx.renderer;
    const cam = this.ctx.camera;
    const w = renderer.domElement.width, h = renderer.domElement.height;
    if (w !== this._size.x || h !== this._size.y) this.resize(w, h);
    const tex = this.render(renderer, cam, null, { width: w, height: h });
    this._overlay.visible = !!tex;
  }

  dispose() {
    this._rt[0]?.dispose(); this._rt[1]?.dispose();
    this._depthRT?.dispose();
    this._volMat?.dispose();
    this._compMat?.dispose();
    this._dustMat?.dispose();
    this._quadGeo?.dispose();
    this.dust?.geometry?.dispose();
  }
}
