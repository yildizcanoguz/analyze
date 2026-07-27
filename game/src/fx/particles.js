// ---------------------------------------------------------------------------
// fx/particles.js — GPU-instanced particle engine.  Owner: `fx`.
//
// Design
//  * ONE draw call for every particle in the game. All blend modes live in the
//    same pass: output is premultiplied (blend One / OneMinusSrcAlpha) and the
//    per-particle `add` term scales the destination alpha to zero, which turns
//    that particle additive. Additive and alpha-blended particles therefore
//    interleave correctly in a single depth-sorted stream.
//  * Simulation is 100% analytic in the vertex shader (position, velocity with
//    exponential drag, gravity, curl-ish turbulence, size/rotation/colour
//    curves, flipbook frame + inter-frame blend). The CPU never touches a
//    particle after it is spawned.
//  * Storage is one interleaved Float32Array (stride 36). Compaction and
//    back-to-front sorting are done with typed-array block copies and an
//    allocation-free 11-bit radix sort, so the steady-state update loop
//    allocates nothing.
//  * Soft particles: the fragment shader fades against a scene depth texture so
//    smoke does not cut a hard line into the floor.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

export const STRIDE = 36;

// offsets into the interleaved record
const O_P = 0;    // pos.xyz, birth
const O_V = 4;    // vel.xyz, life
const O_S = 8;    // size0, size1, len0, len1
const O_R = 12;   // rot0, rotVel, drag, gravityScale
const O_T = 16;   // tile0, tileCount, fps, seed
const O_X = 20;   // softness, brightness, fadeIn, align
const O_Y = 24;   // turbAmp, turbFreq, additive, sizeCurve
const O_C0 = 28;  // start colour rgba
const O_C1 = 32;  // end colour rgba

const VERT = /* glsl */`
precision highp float;

attribute vec4 aP;
attribute vec4 aV;
attribute vec4 aS;
attribute vec4 aR;
attribute vec4 aT;
attribute vec4 aX;
attribute vec4 aY;
attribute vec4 aC0;
attribute vec4 aC1;

uniform float uTime;
uniform vec3  uGravity;
uniform vec2  uGrid;       // atlas cols, rows
uniform float uInset;      // uv inset inside each tile (mip bleed guard)
uniform float uSizeScale;

varying vec2  vUv;
varying vec2  vUv2;
varying float vBlend;
varying vec4  vColor;
varying float vAdd;
varying float vSoft;
varying float vDist;

vec3 srgbToLin(vec3 c) {
  return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878);
}

void main() {
  float t = uTime - aP.w;
  float life = max(aV.w, 1e-4);
  float u = t / life;
  if (t < 0.0 || u >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // clipped
    vUv = vec2(0.0); vUv2 = vec2(0.0); vBlend = 0.0;
    vColor = vec4(0.0); vAdd = 0.0; vSoft = 0.0; vDist = 0.0;
    return;
  }

  float align = aX.w;
  float k = aR.z;
  vec3 g = uGravity * aR.w;
  vec3 p = aP.xyz;
  vec3 vel = aV.xyz;

  if (align < 1.5) {
    if (k > 0.01) {
      float e = (1.0 - exp(-k * t)) / k;
      p += aV.xyz * e + g * (t - e) / k;
      vel = aV.xyz * exp(-k * t) + g * e;
    } else {
      p += aV.xyz * t + 0.5 * g * t * t;
      vel = aV.xyz + g * t;
    }
    if (aY.x > 0.0) {
      float f = aY.y;
      float s = aT.w;
      p += aY.x * u * vec3(
        sin(p.y * f + t * 1.71 + s),
        sin(p.z * f + t * 1.27 + s * 2.13),
        sin(p.x * f + t * 1.09 + s * 3.71));
    }
  }

  // size / length curves
  float su = 1.0 - pow(1.0 - u, max(aY.w, 0.05));
  float sz = mix(aS.x, aS.y, su) * uSizeScale;
  float ln = mix(aS.z, aS.w, su) * uSizeScale;

  vec2 c = position.xy;                        // quad corner in -0.5..0.5
  vec4 mv;

  if (align >= 1.5) {
    // world-plane aligned (shockwave rings, ripples, ground scorch flashes):
    // aV is the plane normal, there is no motion.
    vec3 n = normalize(aV.xyz + vec3(0.0, 1e-5, 0.0));
    vec3 t1 = normalize(cross(abs(n.y) < 0.985 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n));
    vec3 t2 = cross(n, t1);
    float a = aR.x + aR.y * t;
    float ca = cos(a), sa = sin(a);
    vec2 rc = vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca) * (sz * 2.0);
    mv = modelViewMatrix * vec4(p + t1 * rc.x + t2 * rc.y, 1.0);
  } else {
    mv = modelViewMatrix * vec4(p, 1.0);
    vec2 off;
    if (align >= 0.5) {
      // velocity aligned: local +X runs along the direction of travel
      vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
      vec2 d = vv.xy;
      float dl = length(d);
      vec2 ax = dl > 1e-4 ? d / dl : vec2(1.0, 0.0);
      vec2 ay = vec2(-ax.y, ax.x);
      off = ax * (c.x * max(sz, ln) * 2.0) + ay * (c.y * sz * 2.0);
    } else {
      float a = aR.x + aR.y * t;
      float ca = cos(a), sa = sin(a);
      off = vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca) * (sz * 2.0);
    }
    mv.xy += off;
  }

  gl_Position = projectionMatrix * mv;
  vDist = -mv.z;

  // ---- flipbook ----
  float frames = max(aT.y, 1.0);
  float fpos = aT.z > 0.0 ? t * aT.z : u * frames;
  float f0 = floor(fpos);
  vBlend = frames > 1.5 ? fract(fpos) : 0.0;
  float i0 = aT.x + mod(f0, frames);
  float i1 = aT.x + mod(f0 + 1.0, frames);
  vec2 ts = 1.0 / uGrid;
  vec2 quv = mix(vec2(uInset), vec2(1.0 - uInset), uv);
  vUv  = (vec2(mod(i0, uGrid.x), floor(i0 / uGrid.x)) + quv) * ts;
  vUv2 = (vec2(mod(i1, uGrid.x), floor(i1 / uGrid.x)) + quv) * ts;

  // ---- colour ----
  vec4 col = mix(aC0, aC1, u);
  float a = col.a * smoothstep(0.0, max(aX.z, 1e-4), u);
  vColor = vec4(srgbToLin(col.rgb) * aX.y, a);
  vAdd = aY.z;
  vSoft = aX.x;
}
`;

const FRAG = /* glsl */`
precision highp float;

uniform sampler2D uMap;
uniform sampler2D uDepth;
uniform vec2 uInvRes;
uniform vec2 uNearFar;
uniform float uSoftEnable;

varying vec2  vUv;
varying vec2  vUv2;
varying float vBlend;
varying vec4  vColor;
varying float vAdd;
varying float vSoft;
varying float vDist;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (vBlend > 0.0) tex = mix(tex, texture2D(uMap, vUv2), vBlend);

  float a = tex.a * vColor.a;
  if (a <= 0.002) discard;

  if (uSoftEnable > 0.5 && vSoft > 0.0) {
    float d = texture2D(uDepth, gl_FragCoord.xy * uInvRes).x;
    float n = uNearFar.x, f = uNearFar.y;
    // non-linear depth -> view distance
    float sceneDist = (2.0 * n * f) / (f + n - (d * 2.0 - 1.0) * (f - n));
    a *= clamp((sceneDist - vDist) / vSoft, 0.0, 1.0);
  }
  // never let a sprite clip through the near plane
  a *= smoothstep(uNearFar.x, uNearFar.x + 0.35, vDist);
  if (a <= 0.002) discard;

  gl_FragColor = vec4(vColor.rgb * tex.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
  gl_FragColor.a *= (1.0 - vAdd);
}
`;

// scratch descriptor reused by every emitter — zero allocation at spawn time
function makeDesc() {
  return {
    px: 0, py: 0, pz: 0,
    vx: 0, vy: 0, vz: 0,
    life: 1,
    size0: 0.1, size1: 0.1, len0: 0, len1: 0,
    rot: 0, rotVel: 0, drag: 0, grav: 0,
    tile: 31, frames: 1, fps: 0, seed: 0,
    soft: 0, bright: 1, fadeIn: 0.05, align: 0,
    turb: 0, turbFreq: 2.5, add: 0, curve: 1,
    r0: 1, g0: 1, b0: 1, a0: 1,
    r1: 1, g1: 1, b1: 1, a1: 0,
    delay: 0,
  };
}

const DEFAULTS = makeDesc();

export default class ParticleSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {{texture:THREE.DataTexture, cols:number, rows:number}} atlas
   * @param {{capacity:number, soft:boolean, sizeScale:number}} opts
   */
  constructor(scene, atlas, opts = {}) {
    this.capacity = opts.capacity || 1500;
    this.scene = scene;
    this.count = 0;
    this.softCount = 0;
    this._time = 0;
    this._dirty = true;
    this._sortAcc = 0;
    this._recycle = 0;

    this.data = new Float32Array(this.capacity * STRIDE);
    this._scratch = new Float32Array(this.capacity * STRIDE);
    this._dist = new Float32Array(this.capacity);
    this._keys = new Uint32Array(this.capacity);
    this._keysB = new Uint32Array(this.capacity);
    this._idx = new Uint32Array(this.capacity);
    this._idxB = new Uint32Array(this.capacity);
    this._hist = new Uint32Array(2048);

    this.desc = makeDesc();

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);

    const buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    this.buffer = buf;
    const add = (name, off) =>
      geo.setAttribute(name, new THREE.InterleavedBufferAttribute(buf, 4, off, false));
    add('aP', O_P); add('aV', O_V); add('aS', O_S); add('aR', O_R);
    add('aT', O_T); add('aX', O_X); add('aY', O_Y);
    add('aC0', O_C0); add('aC1', O_C1);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = geo;

    this._white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this._white.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: atlas.texture },
        uDepth: { value: this._white },
        uTime: { value: 0 },
        uGravity: { value: new THREE.Vector3(0, -9.81, 0) },
        uGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
        uInset: { value: 0.006 },
        uSizeScale: { value: opts.sizeScale || 1 },
        uInvRes: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
        uNearFar: { value: new THREE.Vector2(0.06, 600) },
        uSoftEnable: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.name = 'fx.particles';
    this.mesh.userData.collision = false;
    this.mesh.userData.noDepthPrepass = true;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  /** Reset the shared descriptor and hand it back for filling. */
  begin() {
    const d = this.desc;
    for (const k in DEFAULTS) d[k] = DEFAULTS[k];
    return d;
  }

  /** Commit the descriptor as one particle. Returns false if the pool is full. */
  emit() {
    const d = this.desc;
    let i;
    if (this.count < this.capacity) {
      i = this.count++;
    } else {
      // pool full: recycle round-robin (O(1) — a burst must never go quadratic)
      i = this._recycle++;
      if (this._recycle >= this.capacity) this._recycle = 0;
    }
    const a = this.data, o = i * STRIDE;
    a[o + O_P] = d.px; a[o + O_P + 1] = d.py; a[o + O_P + 2] = d.pz;
    a[o + O_P + 3] = this._time + d.delay;
    a[o + O_V] = d.vx; a[o + O_V + 1] = d.vy; a[o + O_V + 2] = d.vz;
    a[o + O_V + 3] = d.life;
    a[o + O_S] = d.size0; a[o + O_S + 1] = d.size1;
    a[o + O_S + 2] = d.len0; a[o + O_S + 3] = d.len1;
    a[o + O_R] = d.rot; a[o + O_R + 1] = d.rotVel;
    a[o + O_R + 2] = d.drag; a[o + O_R + 3] = d.grav;
    a[o + O_T] = d.tile; a[o + O_T + 1] = d.frames;
    a[o + O_T + 2] = d.fps; a[o + O_T + 3] = d.seed;
    a[o + O_X] = d.soft; a[o + O_X + 1] = d.bright;
    a[o + O_X + 2] = d.fadeIn; a[o + O_X + 3] = d.align;
    a[o + O_Y] = d.turb; a[o + O_Y + 1] = d.turbFreq;
    a[o + O_Y + 2] = d.add; a[o + O_Y + 3] = d.curve;
    a[o + O_C0] = d.r0; a[o + O_C0 + 1] = d.g0; a[o + O_C0 + 2] = d.b0; a[o + O_C0 + 3] = d.a0;
    a[o + O_C1] = d.r1; a[o + O_C1 + 1] = d.g1; a[o + O_C1 + 2] = d.b1; a[o + O_C1 + 3] = d.a1;
    this._dirty = true;
    return true;
  }

  /** Cheap "is there room" test so bursts can degrade instead of thrashing. */
  free() { return this.capacity - this.count; }

  clear() {
    this.count = 0;
    this.geometry.instanceCount = 0;
    this._dirty = true;
  }

  update(dt, time, camera) {
    this._time = time;
    this.material.uniforms.uTime.value = time;

    // ---- retire dead particles (swap-remove, no allocation) ----
    const a = this.data;
    let n = this.count;
    let soft = 0;
    for (let i = 0; i < n;) {
      const o = i * STRIDE;
      if (time - a[o + O_P + 3] >= a[o + O_V + 3]) {
        n--;
        if (i !== n) {
          const src = n * STRIDE;
          for (let k = 0; k < STRIDE; k++) a[o + k] = a[src + k];
        }
        this._dirty = true;
        continue;
      }
      if (a[o + O_X] > 0) soft++;
      i++;
    }
    this.count = n;
    this.softCount = soft;

    if (n === 0) {
      this.geometry.instanceCount = 0;
      return;
    }

    // ---- back-to-front sort so alpha smoke composites correctly ----
    this._sortAcc += dt;
    if (this._dirty || this._sortAcc > 0.045) {
      this._sortAcc = 0;
      this._sort(camera);
      this.geometry.instanceCount = n;
      this.buffer.needsUpdate = true;
      if (this.buffer.addUpdateRange) {
        this.buffer.clearUpdateRanges();
        this.buffer.addUpdateRange(0, n * STRIDE);
      }
      this._dirty = false;
    }
  }

  // 22-bit radix sort (two 11-bit passes) on quantised camera distance.
  _sort(camera) {
    const n = this.count;
    if (n < 2 || !camera) return;
    const a = this.data, keys = this._keys, idx = this._idx, dist = this._dist;
    const e = camera.matrixWorldInverse.elements;
    // view-space -z of the spawn point == distance along the view axis
    const m20 = e[2], m21 = e[6], m22 = e[10], m23 = e[14];
    let maxD = 1e-3;
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      const z = -(m20 * a[o] + m21 * a[o + 1] + m22 * a[o + 2] + m23);
      const d = z > 0 ? z : 0;
      dist[i] = d;
      if (d > maxD) maxD = d;
    }
    const q = 4194303 / maxD;   // 22-bit range
    for (let i = 0; i < n; i++) {
      // far -> near: larger distance must sort first
      keys[i] = 4194303 - ((dist[i] * q) | 0);
      idx[i] = i;
    }

    const hist = this._hist;
    let kA = keys, kB = this._keysB, iA = idx, iB = this._idxB;
    for (let pass = 0; pass < 2; pass++) {
      const shift = pass * 11;
      hist.fill(0, 0, 2048);
      for (let i = 0; i < n; i++) hist[(kA[i] >>> shift) & 2047]++;
      let sum = 0;
      for (let b = 0; b < 2048; b++) { const c = hist[b]; hist[b] = sum; sum += c; }
      for (let i = 0; i < n; i++) {
        const b = (kA[i] >>> shift) & 2047;
        const j = hist[b]++;
        kB[j] = kA[i]; iB[j] = iA[i];
      }
      const tk = kA; kA = kB; kB = tk;
      const ti = iA; iA = iB; iB = ti;
    }

    // permute records into scratch, then blit back
    const s = this._scratch;
    for (let i = 0; i < n; i++) {
      const src = iA[i] * STRIDE, dst = i * STRIDE;
      for (let k = 0; k < STRIDE; k++) s[dst + k] = a[src + k];
    }
    a.set(s.subarray(0, n * STRIDE));
  }

  setDepth(tex, width, height, near, far) {
    const u = this.material.uniforms;
    if (tex) {
      u.uDepth.value = tex;
      u.uSoftEnable.value = 1;
      u.uInvRes.value.set(1 / width, 1 / height);
    } else {
      u.uDepth.value = this._white;
      u.uSoftEnable.value = 0;
    }
    u.uNearFar.value.set(near, far);
  }

  setGravity(x, y, z) { this.material.uniforms.uGravity.value.set(x, y, z); }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this._white.dispose();
  }
}
