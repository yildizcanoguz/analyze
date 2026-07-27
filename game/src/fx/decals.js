// ---------------------------------------------------------------------------
// fx/decals.js — projected decals that conform to geometry.  Owner: `fx`.
//
// A decal is a box projector. We pull the triangles under the impact point out
// of the physics BVH (world-space, already baked), clip each one against the
// six projector planes (Sutherland–Hodgman) and emit the clipped polygons into
// a single pooled buffer. The result wraps around corners, follows stairs and
// curved props, and never floats.
//
// Two draw calls total for every decal in the world:
//   1. MULTIPLY pass  — the hole/crack/soot/blood darkening. Multiplicative
//      blending means a decal in shadow stays in shadow: it modulates whatever
//      the surface already rendered, so it is automatically lighting-correct.
//   2. LIT pass       — the crushed concrete rim, torn metal lip, bright glass
//      fracture and wet blood sheen. Premultiplied-over, shaded with a tangent
//      normal recovered from the atlas height channel so it catches the sun.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { DECAL } from './atlas.js';

const STRIDE = 17;   // pos3 nrm3 tan3 uv2 col4 par2
const O_POS = 0, O_NRM = 3, O_TAN = 6, O_UV = 9, O_COL = 11, O_PAR = 15;

const MAX_POLY = 24;
const QUAD = [-1, -1, 1, -1, 1, 1, -1, 1];
const QUAD_IDX = [0, 1, 2, 0, 2, 3];

const VERT = /* glsl */`
precision highp float;
attribute vec3 aTan;
attribute vec4 aColor;
attribute vec2 aPar;      // birth, life
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vNormal;
varying vec3 vTan;
void main() {
  float age = uTime - aPar.x;
  float fade = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(aPar.y - 0.9, aPar.y, age));
  vColor = vec4(aColor.rgb, aColor.a * fade);
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vTan = normalize(normalMatrix * aTan);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG_MUL = /* glsl */`
precision highp float;
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vNormal;
varying vec3 vTan;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float cov = t.a * vColor.a;
  if (cov <= 0.003) discard;
  vec3 tint = clamp(vColor.rgb * (1.0 - t.r), 0.0, 1.0);
  gl_FragColor = vec4(mix(vec3(1.0), tint, cov), 1.0);
}
`;

const FRAG_LIT = /* glsl */`
precision highp float;
uniform sampler2D uMap;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec2 uTexel;
uniform float uNormalScale;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vNormal;
varying vec3 vTan;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float cov = t.a * vColor.a * t.g;
  if (cov <= 0.004) discard;

  float hl = texture2D(uMap, vUv - vec2(uTexel.x, 0.0)).b;
  float hr = texture2D(uMap, vUv + vec2(uTexel.x, 0.0)).b;
  float hd = texture2D(uMap, vUv - vec2(0.0, uTexel.y)).b;
  float hu = texture2D(uMap, vUv + vec2(0.0, uTexel.y)).b;

  vec3 n = normalize(vNormal);
  vec3 tg = normalize(vTan - n * dot(n, vTan));
  vec3 bt = cross(n, tg);
  n = normalize(n + (tg * (hl - hr) + bt * (hd - hu)) * uNormalScale);

  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 lit = uSunColor * ndl + uAmbient;
  vec3 rgb = vColor.rgb * lit;

  gl_FragColor = vec4(rgb, cov);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
}
`;

// per-surface decal art + look
const SURFACE_DECAL = {
  concrete: { tiles: [DECAL.CONCRETE_A, DECAL.CONCRETE_B], size: 0.20, tint: 0x9a938a, dark: 1.0 },
  plaster: { tiles: [DECAL.PLASTER], size: 0.24, tint: 0xbdb6a8, dark: 0.85 },
  brick: { tiles: [DECAL.BRICK, DECAL.CONCRETE_A], size: 0.19, tint: 0x8a5f4a, dark: 1.0 },
  tile: { tiles: [DECAL.BRICK, DECAL.GLASS], size: 0.17, tint: 0xa8a49c, dark: 1.0 },
  metal: { tiles: [DECAL.METAL_A, DECAL.METAL_B], size: 0.13, tint: 0x9aa2a4, dark: 1.0 },
  wood: { tiles: [DECAL.WOOD], size: 0.19, tint: 0x8a6a44, dark: 1.0 },
  glass: { tiles: [DECAL.GLASS], size: 0.30, tint: 0xc8d6dc, dark: 0.75 },
  dirt: { tiles: [DECAL.DIRT], size: 0.26, tint: 0x6d5b45, dark: 0.9 },
  sand: { tiles: [DECAL.DIRT], size: 0.28, tint: 0xc6ad86, dark: 0.7 },
  gravel: { tiles: [DECAL.DIRT, DECAL.CONCRETE_B], size: 0.24, tint: 0x7d7469, dark: 0.9 },
  rubber: { tiles: [DECAL.SCUFF], size: 0.15, tint: 0x2a2a2c, dark: 1.0 },
  fabric: { tiles: [DECAL.SCUFF], size: 0.17, tint: 0x5a5044, dark: 0.9 },
  foliage: { tiles: [DECAL.SCUFF], size: 0.16, tint: 0x4d5230, dark: 0.8 },
  water: { tiles: [DECAL.WET], size: 0.34, tint: 0x39424a, dark: 0.6 },
  flesh: { tiles: [DECAL.BLOOD_A], size: 0.22, tint: 0x6e1410, dark: 1.0 },
};

export default class DecalSystem {
  constructor(ctx, scene, atlas, opts = {}) {
    this.ctx = ctx;
    this.scene = scene;
    this.atlas = atlas;
    this.budget = opts.budget || 128;
    this.capacity = opts.vertices || 12000;
    this.enabled = opts.enabled !== false;

    this.data = new Float32Array(this.capacity * STRIDE);
    this.head = 0;
    this.used = 0;
    this.decals = [];
    this._time = 0;

    // scratch (allocation-free clipping)
    this._polyA = new Float32Array(MAX_POLY * 3);
    this._polyB = new Float32Array(MAX_POLY * 3);
    this._maxTris = 192;
    this._keep = 10;                                   // max verts kept per clipped tri
    this._st = new Float32Array(this._maxTris * 12);   // gathered triangles + normal
    this._stN = 0;
    this._polyStore = new Float32Array(this._maxTris * this._keep * 3);
    this._polyCount = new Int32Array(this._maxTris);
    this._polyNrm = new Float32Array(this._maxTris * 3);
    this._chunks = [];
    this._tris = [];
    this._T = new THREE.Vector3();
    this._B = new THREE.Vector3();
    this._N = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._col = new THREE.Color();

    const geo = new THREE.BufferGeometry();
    const buf = new THREE.InterleavedBuffer(this.data, STRIDE);
    buf.setUsage(THREE.DynamicDrawUsage);
    this.buffer = buf;
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, O_POS));
    geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(buf, 3, O_NRM));
    geo.setAttribute('aTan', new THREE.InterleavedBufferAttribute(buf, 3, O_TAN));
    geo.setAttribute('uv', new THREE.InterleavedBufferAttribute(buf, 2, O_UV));
    geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(buf, 4, O_COL));
    geo.setAttribute('aPar', new THREE.InterleavedBufferAttribute(buf, 2, O_PAR));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = geo;

    const sun = ctx.materials?.sun;
    const sunDir = sun ? sun.direction.clone() : new THREE.Vector3(0.83, 0.37, -0.41).normalize();
    const sunCol = (sun ? sun.color.clone() : new THREE.Color('#fff2d8')).convertSRGBToLinear();
    const sunI = sun ? sun.intensity : 3.4;

    const common = {
      uMap: { value: atlas.texture },
      uTime: { value: 0 },
    };
    this.matMul = new THREE.ShaderMaterial({
      uniforms: { ...common },
      vertexShader: VERT,
      fragmentShader: FRAG_MUL,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
    });
    this.matLit = new THREE.ShaderMaterial({
      uniforms: {
        ...common,
        uSunDir: { value: sunDir },
        uSunColor: { value: new THREE.Vector3(sunCol.r, sunCol.g, sunCol.b).multiplyScalar(sunI * 0.30) },
        uAmbient: { value: new THREE.Vector3(0.16, 0.19, 0.26) },
        uTexel: { value: new THREE.Vector2(1 / (atlas.cols * atlas.size), 1 / (atlas.rows * atlas.size)) },
        uNormalScale: { value: 2.4 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG_LIT,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
    // the two passes share one uTime uniform object
    this.matLit.uniforms.uTime = this.matMul.uniforms.uTime;

    this.meshMul = new THREE.Mesh(geo, this.matMul);
    this.meshLit = new THREE.Mesh(geo, this.matLit);
    for (const m of [this.meshMul, this.meshLit]) {
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.userData.collision = false;
      m.userData.noDepthPrepass = true;
      m.name = 'fx.decals';
      scene.add(m);
    }
    this.meshMul.renderOrder = 4;
    this.meshLit.renderOrder = 5;
  }

  surfaceInfo(surface) { return SURFACE_DECAL[surface] || SURFACE_DECAL.concrete; }

  /**
   * add(point, normal, opts)
   * opts: { tile, size, rotation, tint(hex|Color), opacity, life, depth, tangent(Vector3) }
   */
  add(point, normal, opts = {}) {
    if (!this.enabled) return null;
    const size = opts.size || 0.2;
    const half = size * 0.5;
    const depth = opts.depth != null ? opts.depth : Math.max(0.06, size * 0.75);
    const hd = depth * 0.5;

    // projector frame
    const N = this._N.copy(normal);
    if (N.lengthSq() < 1e-8) N.set(0, 1, 0);
    N.normalize();
    const T = this._T;
    if (opts.tangent) {
      T.copy(opts.tangent);
      T.addScaledVector(N, -T.dot(N));
      if (T.lengthSq() < 1e-8) T.set(1, 0, 0);
      T.normalize();
    } else {
      T.set(0, 1, 0);
      if (Math.abs(N.y) > 0.94) T.set(1, 0, 0);
      T.cross(N).normalize();
    }
    const rot = opts.rotation != null ? opts.rotation : 0;
    if (rot !== 0) {
      const B0 = this._tmp.copy(N).cross(T);
      const c = Math.cos(rot), s = Math.sin(rot);
      T.set(T.x * c + B0.x * s, T.y * c + B0.y * s, T.z * c + B0.z * s).normalize();
    }
    const B = this._B.copy(N).cross(T).normalize();

    // ---- gather candidate triangles out of the physics BVH ----
    const tris = this._tris;
    const phys = this.ctx.physics;
    const rad = Math.sqrt(half * half * 2 + hd * hd);
    const mnx = point.x - rad, mny = point.y - rad, mnz = point.z - rad;
    const mxx = point.x + rad, mxy = point.y + rad, mxz = point.z + rad;

    const st = this._st;
    let stN = 0;
    if (phys && phys.chunks && phys.chunks.length && phys._topBox && phys._chunkBox) {
      const chunks = this._chunks;
      chunks.length = 0;
      try { phys._topBox(mnx, mny, mnz, mxx, mxy, mxz, chunks); }
      catch { chunks.length = 0; }
      const minDot = opts.minDot != null ? opts.minDot : 0.15;
      for (let ci = 0; ci < chunks.length && stN < this._maxTris; ci++) {
        const chunk = chunks[ci];
        tris.length = 0;
        try { phys._chunkBox(chunk, mnx, mny, mnz, mxx, mxy, mxz, tris); }
        catch { tris.length = 0; }
        const P = chunk.pos, NR = chunk.nrm;
        for (let k = 0; k < tris.length && stN < this._maxTris; k++) {
          const ti = tris[k], o = ti * 9, n3 = ti * 3;
          let fnx = NR[n3], fny = NR[n3 + 1], fnz = NR[n3 + 2];
          let d = fnx * N.x + fny * N.y + fnz * N.z;
          if (d < 0) { fnx = -fnx; fny = -fny; fnz = -fnz; d = -d; }
          if (d < minDot) continue;
          const b = stN * 12;
          for (let j = 0; j < 9; j++) st[b + j] = P[o + j];
          st[b + 9] = fnx; st[b + 10] = fny; st[b + 11] = fnz;
          stN++;
        }
      }
    }

    // ---- clip every candidate, stash the polygons, count the vertices ----
    const store = this._polyStore, pcount = this._polyCount, pnrm = this._polyNrm;
    let kept = 0, total = 0;
    for (let i = 0; i < stN; i++) {
      const cnt = this._clipTri(st, i * 12, T, B, N, point, half, hd);
      if (cnt < 3) continue;
      const c = Math.min(cnt, this._keep);
      const dst = kept * this._keep * 3;
      for (let k = 0; k < c * 3; k++) store[dst + k] = this._polyA[k];
      pcount[kept] = c;
      pnrm[kept * 3] = st[i * 12 + 9];
      pnrm[kept * 3 + 1] = st[i * 12 + 10];
      pnrm[kept * 3 + 2] = st[i * 12 + 11];
      total += (c - 2) * 3;
      kept++;
    }

    if (total > 0) {
      const base = this._alloc(total);
      if (base < 0) return null;
      this._w = base;
      this._setupWrite(opts, size);
      for (let p = 0; p < kept; p++) {
        const off = p * this._keep * 3, cnt = pcount[p];
        const nx = pnrm[p * 3], ny = pnrm[p * 3 + 1], nz = pnrm[p * 3 + 2];
        for (let i = 1; i + 1 < cnt; i++) {
          this._emit(store, off, 0, nx, ny, nz, T, B, N, point, half);
          this._emit(store, off, i, nx, ny, nz, T, B, N, point, half);
          this._emit(store, off, i + 1, nx, ny, nz, T, B, N, point, half);
        }
      }
      return this._finish(total, opts);
    }

    // ---- fallback: a single quad hugging the surface ----
    const base = this._alloc(6);
    if (base < 0) return null;
    this._w = base;
    this._setupWrite(opts, size);
    const q = this._polyA;
    const cs = QUAD;
    for (let i = 0; i < 4; i++) {
      q[i * 3] = cs[i * 2] * half; q[i * 3 + 1] = cs[i * 2 + 1] * half; q[i * 3 + 2] = 0;
    }
    for (let k = 0; k < 6; k++) {
      this._emit(q, 0, QUAD_IDX[k], N.x, N.y, N.z, T, B, N, point, half);
    }
    return this._finish(6, opts);
  }

  // ---- internals ---------------------------------------------------------

  _setupWrite(opts, size) {
    const tile = opts.tile != null ? opts.tile : DECAL.CONCRETE_A;
    const cols = this.atlas.cols, rows = this.atlas.rows;
    this._tu = (tile % cols) / cols;
    this._tv = Math.floor(tile / cols) / rows;
    this._ts = 1 / cols;
    this._tt = 1 / rows;
    const tint = opts.tint != null ? opts.tint : 0xffffff;
    const col = this._col;
    if (tint.isColor) col.copy(tint); else col.setHex(tint);
    this._cr = col.r; this._cg = col.g; this._cb = col.b;
    this._ca = opts.opacity != null ? opts.opacity : 1;
    this._birth = this._time;
    this._life = opts.life != null ? opts.life : 40;
    this._size = size;
  }

  // clip triangle at scratch[i..] against the projector box; result in _polyA
  _clipTri(s, i, T, B, N, P, half, hd) {
    const a = this._polyA, b = this._polyB;
    for (let v = 0; v < 3; v++) {
      const dx = s[i + v * 3] - P.x, dy = s[i + v * 3 + 1] - P.y, dz = s[i + v * 3 + 2] - P.z;
      a[v * 3] = dx * T.x + dy * T.y + dz * T.z;
      a[v * 3 + 1] = dx * B.x + dy * B.y + dz * B.z;
      a[v * 3 + 2] = dx * N.x + dy * N.y + dz * N.z;
    }
    let count = 3;
    const lim = [half, half, hd];
    let src = a, dst = b;
    for (let axis = 0; axis < 3; axis++) {
      for (let sign = -1; sign <= 1; sign += 2) {
        const L = lim[axis] * sign;
        let out = 0;
        for (let v = 0; v < count; v++) {
          const w = (v + 1) % count;
          const cv = src[v * 3 + axis] * sign, cw = src[w * 3 + axis] * sign;
          const inV = cv <= lim[axis], inW = cw <= lim[axis];
          if (inV) {
            if (out >= MAX_POLY) break;
            dst[out * 3] = src[v * 3]; dst[out * 3 + 1] = src[v * 3 + 1]; dst[out * 3 + 2] = src[v * 3 + 2];
            out++;
          }
          if (inV !== inW) {
            const t = (L - src[v * 3 + axis]) / (src[w * 3 + axis] - src[v * 3 + axis]);
            if (out >= MAX_POLY) break;
            dst[out * 3] = src[v * 3] + (src[w * 3] - src[v * 3]) * t;
            dst[out * 3 + 1] = src[v * 3 + 1] + (src[w * 3 + 1] - src[v * 3 + 1]) * t;
            dst[out * 3 + 2] = src[v * 3 + 2] + (src[w * 3 + 2] - src[v * 3 + 2]) * t;
            out++;
          }
        }
        count = out;
        const tmp = src; src = dst; dst = tmp;
        if (count < 3) return 0;
      }
    }
    if (src !== a) { for (let k = 0; k < count * 3; k++) a[k] = src[k]; }
    return count;
  }

  _emit(poly, off, vi, nx, ny, nz, T, B, N, P, half) {
    const i0 = off + vi * 3;
    const lx = poly[i0], ly = poly[i0 + 1], lz = poly[i0 + 2];
    const d = this.data;
    let o = this._w * STRIDE;
    const eps = 0.0045;
    d[o + O_POS] = P.x + T.x * lx + B.x * ly + N.x * lz + nx * eps;
    d[o + O_POS + 1] = P.y + T.y * lx + B.y * ly + N.y * lz + ny * eps;
    d[o + O_POS + 2] = P.z + T.z * lx + B.z * ly + N.z * lz + nz * eps;
    d[o + O_NRM] = nx; d[o + O_NRM + 1] = ny; d[o + O_NRM + 2] = nz;
    d[o + O_TAN] = T.x; d[o + O_TAN + 1] = T.y; d[o + O_TAN + 2] = T.z;
    d[o + O_UV] = this._tu + (lx / (half * 2) + 0.5) * this._ts;
    d[o + O_UV + 1] = this._tv + (ly / (half * 2) + 0.5) * this._tt;
    d[o + O_COL] = this._cr; d[o + O_COL + 1] = this._cg; d[o + O_COL + 2] = this._cb;
    d[o + O_COL + 3] = this._ca;
    d[o + O_PAR] = this._birth; d[o + O_PAR + 1] = this._life;
    this._w++;
  }

  _alloc(n) {
    if (n > this.capacity) return -1;
    if (this.head + n > this.capacity) this.head = 0;
    const base = this.head;
    // evict any decal whose range overlaps the region we are about to overwrite
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      if (d.start < base + n && d.start + d.count > base) {
        this.data.fill(0, d.start * STRIDE, (d.start + d.count) * STRIDE);
        this.decals.splice(i, 1);
      }
    }
    this.head += n;
    if (this.head > this.used) this.used = this.head;
    return base;
  }

  _finish(verts, opts) {
    const rec = {
      start: this._w - verts, count: verts,
      birth: this._birth, life: this._life,
      dying: false,
    };
    this.decals.push(rec);
    this.geometry.setDrawRange(0, this.used);
    this.buffer.needsUpdate = true;
    // budget: start fading the oldest survivors out instead of popping them
    const over = this.decals.length - this.budget;
    for (let i = 0; i < over; i++) {
      const d = this.decals[i];
      if (d.dying) continue;
      d.dying = true;
      const remain = 0.8;
      const newLife = (this._time - d.birth) + remain;
      d.life = newLife;
      const data = this.data;
      for (let v = d.start; v < d.start + d.count; v++) data[v * STRIDE + O_PAR + 1] = newLife;
    }
    return rec;
  }

  update(dt, time) {
    this._time = time;
    this.matMul.uniforms.uTime.value = time;
    let removed = false;
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      if (time - d.birth >= d.life) {
        this.data.fill(0, d.start * STRIDE, (d.start + d.count) * STRIDE);
        this.decals.splice(i, 1);
        removed = true;
      }
    }
    if (removed) this.buffer.needsUpdate = true;
  }

  clear() {
    this.data.fill(0);
    this.decals.length = 0;
    this.head = 0; this.used = 0;
    this.geometry.setDrawRange(0, 0);
    this.buffer.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.meshMul);
    this.scene.remove(this.meshLit);
    this.geometry.dispose();
    this.matMul.dispose();
    this.matLit.dispose();
  }
}
