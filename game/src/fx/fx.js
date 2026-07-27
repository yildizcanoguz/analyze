// ---------------------------------------------------------------------------
// fx/fx.js — particle & effects system for OVERSTRIKE.  Owner: `fx`.
//
// CONTRACT API (ctx.fx)
//   impact(point, normal, surface, opts?)
//   decal(point, normal, surface, opts?)
//   tracer(from, to, opts?)
//   muzzleFlash(matrixOrObject, opts?)
//   shell(pos, dir, opts?)
//   blood(point, normal, opts?)
//   explosion(point, opts?)
//   smoke(point, opts?)
//   screenShake(amount, duration)
//
// SCREEN SHAKE OUTPUT (the player camera consumes these; fx never moves the camera)
//   ctx.fx.shakeOffset    THREE.Vector3  camera-LOCAL translation in metres
//   ctx.fx.shakeRotation  THREE.Vector3  radians, x = pitch, y = yaw, z = roll
//   ctx.fx.shakeAmount    number         0..1 current summed magnitude
//   ctx.fx.getShake(outVec3, outVec3)    convenience copy
//
// Everything is pooled with hard caps derived from ctx.settings.quality, and the
// steady-state update loop allocates nothing.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import ParticleSystem from './particles.js';
import DecalSystem from './decals.js';
import ShellSystem from './shells.js';
import LightPool from './lights.js';
import { buildParticleAtlas, buildDecalAtlas, TILE, DECAL } from './atlas.js';

const TIERS = {
  low: {
    particles: 520, decals: 48, decalVerts: 4200, shells: 8, lights: 1,
    soft: false, atlasP: 64, atlasD: 64, density: 0.42, depthScale: 0.5,
  },
  medium: {
    particles: 1400, decals: 96, decalVerts: 9000, shells: 16, lights: 2,
    soft: true, atlasP: 128, atlasD: 128, density: 0.70, depthScale: 0.5,
  },
  high: {
    particles: 2600, decals: 160, decalVerts: 15000, shells: 24, lights: 2,
    soft: true, atlasP: 256, atlasD: 256, density: 1.0, depthScale: 0.5,
  },
  ultra: {
    particles: 4200, decals: 240, decalVerts: 21000, shells: 32, lights: 3,
    soft: true, atlasP: 256, atlasD: 256, density: 1.35, depthScale: 0.7,
  },
};

// task queue opcodes (numeric so the scheduler never allocates)
const T_DECAL = 1, T_SPARK_BOUNCE = 2, T_SMOKE = 3, T_BLOOD_DECAL = 4, T_DEBRIS_DUST = 5;

export default class FX {
  static id = 'fx';

  constructor(ctx) {
    this.ctx = ctx;
    const q = (ctx.settings && ctx.settings.quality) || 'high';
    this.quality = q;
    this.tier = TIERS[q] || TIERS.high;
    this.density = this.tier.density;

    this.enabled = true;
    this.rnd = ctx.rng ? ctx.rng(0x5eed1337) : Math.random;

    // ---- screen shake output (read by player/camera.js) ----
    this.shakeOffset = new THREE.Vector3();
    this.shakeRotation = new THREE.Vector3();
    this.shakeAmount = 0;
    this._channels = [];
    for (let i = 0; i < 6; i++) {
      this._channels.push({ amp: 0, dur: 0, t: 0, freq: 22, seed: 0, rot: 1 });
    }

    // ---- scratch vectors (no per-call allocation) ----
    this._v0 = new THREE.Vector3();
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._sn = new THREE.Vector3();     // surface normal (never clobbered by _basis)
    this._spray = new THREE.Vector3();  // debris cone axis
    this._dopt = {                       // reusable decal option bag
      tile: 0, size: 0.2, tint: 0xffffff, opacity: 1, rotation: 0,
      life: 40, depth: undefined, tangent: undefined, minDot: undefined,
    };
    this._m4 = new THREE.Matrix4();
    this._m4b = new THREE.Matrix4();
    this._dbSize = new THREE.Vector2();

    // ---- scheduler ----
    this._tasks = [];
    for (let i = 0; i < 160; i++) {
      this._tasks.push({
        active: false, t: 0, op: 0,
        x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0,
        a: 0, b: 0, c: 0, e: 0, s: '',
      });
    }
    this._emitters = [];
    for (let i = 0; i < 8; i++) this._emitters.push({ active: false, t: 0, dur: 0, acc: 0, rate: 0, x: 0, y: 0, z: 0, size: 1, r: 0.2, g: 0.2, b: 0.22, up: 1 });

    this._lastExplosion = { x: 0, y: 0, z: 0, t: -10 };
    this._time = 0;
    this.stats = { particles: 0, decals: 0, shells: 0, depthPasses: 0 };
  }

  // =========================================================================
  // lifecycle
  // =========================================================================

  async init() {
    const ctx = this.ctx;
    const t0 = performance.now();

    this.pAtlas = buildParticleAtlas(this.tier.atlasP);
    this.dAtlas = buildDecalAtlas(this.tier.atlasD);

    this.particles = new ParticleSystem(ctx.scene, this.pAtlas, {
      capacity: this.tier.particles,
    });
    this.decals = new DecalSystem(ctx, ctx.scene, this.dAtlas, {
      budget: this.tier.decals,
      vertices: this.tier.decalVerts,
    });
    this.shells = new ShellSystem(ctx, ctx.scene, { capacity: this.tier.shells });
    this.lights = new LightPool(ctx.scene, this.tier.lights, { distance: 12 });

    // soft-particle depth source
    this._depthRT = null;
    this._extDepth = null;
    if (this.tier.soft) this._makeDepthTarget();
    this._depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this._depthMat.name = 'fx.depthPrepass';

    ctx.events.on('explosion', this._onExplosionEvent = (p) => {
      if (!p || !p.point) return;
      const L = this._lastExplosion;
      const dx = p.point.x - L.x, dy = p.point.y - L.y, dz = p.point.z - L.z;
      if (this._time - L.t < 0.08 && dx * dx + dy * dy + dz * dz < 0.25) return;
      this.explosion(p.point, { radius: p.radius || 5, source: p.source, silent: true });
    });

    console.log(`[fx] ${this.quality}: ${this.tier.particles} particles / `
      + `${this.tier.decals} decals / ${this.tier.shells} shells, atlas `
      + `${this.pAtlas.cols * this.pAtlas.size}x${this.pAtlas.rows * this.pAtlas.size} `
      + `in ${Math.round(performance.now() - t0)}ms`);
  }

  _makeDepthTarget() {
    const ctx = this.ctx;
    ctx.renderer.getDrawingBufferSize(this._dbSize);
    const s = this.tier.depthScale;
    const w = Math.max(64, Math.floor(this._dbSize.x * s));
    const h = Math.max(64, Math.floor(this._dbSize.y * s));
    if (this._depthRT) this._depthRT.dispose();
    const depth = new THREE.DepthTexture(w, h);
    depth.type = THREE.UnsignedIntType;
    depth.format = THREE.DepthFormat;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    this._depthRT = new THREE.WebGLRenderTarget(w, h, {
      depthTexture: depth,
      depthBuffer: true,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
  }

  resize() {
    if (this.tier.soft) this._makeDepthTarget();
  }

  update(dt, time) {
    this._time = time;
    const ctx = this.ctx;

    this._runTasks(time);
    this._runEmitters(dt, time);
    this._updateShake(dt);

    this.particles.update(dt, time, ctx.camera);
    this.decals.update(dt, time);
    this.shells.update(dt);
    this.lights.update(dt);

    this.stats.particles = this.particles.count;
    this.stats.decals = this.decals.decals.length;
    this.stats.shells = this.shells.shells.length;
  }

  lateUpdate() {
    // soft particles need scene depth; prefer a depth texture postfx already made
    const ctx = this.ctx;
    const p = this.particles;
    if (!this.tier.soft || p.softCount === 0) {
      p.setDepth(null, 1, 1, ctx.camera.near, ctx.camera.far);
      return;
    }
    const ext = this._findExternalDepth();
    ctx.renderer.getDrawingBufferSize(this._dbSize);
    if (ext) {
      p.setDepth(ext, this._dbSize.x, this._dbSize.y, ctx.camera.near, ctx.camera.far);
      return;
    }
    this._renderDepth();
    p.setDepth(this._depthRT.depthTexture, this._dbSize.x, this._dbSize.y,
      ctx.camera.near, ctx.camera.far);
  }

  _findExternalDepth() {
    const pf = this.ctx.postfx;
    if (!pf) return null;
    const cand = pf.depthTexture || pf.sceneDepth
      || (pf.depthRT && pf.depthRT.depthTexture)
      || (pf.renderTarget && pf.renderTarget.depthTexture);
    return cand && cand.isTexture ? cand : null;
  }

  _renderDepth() {
    const { renderer, scene, camera } = this.ctx;
    const rt = this._depthRT;
    if (!rt) return;
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const hidden = this._hideFx(true);
    scene.overrideMaterial = this._depthMat;
    renderer.setRenderTarget(rt);
    renderer.clear(false, true, false);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    this._hideFx(false, hidden);
    this.stats.depthPasses++;
  }

  _hideFx(hide, prev) {
    const list = [this.particles.mesh, this.decals.meshMul, this.decals.meshLit];
    if (hide) {
      const state = this._visState || (this._visState = []);
      for (let i = 0; i < list.length; i++) { state[i] = list[i].visible; list[i].visible = false; }
      return state;
    }
    for (let i = 0; i < list.length; i++) list[i].visible = prev[i];
    return prev;
  }

  dispose() {
    this.ctx.events.off('explosion', this._onExplosionEvent);
    this.particles.dispose();
    this.decals.dispose();
    this.shells.dispose();
    this.lights.dispose();
    this._depthRT?.dispose();
    this.pAtlas.texture.dispose();
    this.dAtlas.texture.dispose();
  }

  // =========================================================================
  // helpers
  // =========================================================================

  _basis(normal) {
    const n = this._n.set(normal.x, normal.y, normal.z);
    if (n.lengthSq() < 1e-8) n.set(0, 1, 0); else n.normalize();
    const t = this._t;
    t.set(0, 1, 0);
    if (Math.abs(n.y) > 0.94) t.set(1, 0, 0);
    t.cross(n).normalize();
    this._b.copy(n).cross(t).normalize();
    return n;
  }

  /** random direction inside a cone of half-angle `spread` (radians) around n/t/b */
  _cone(spread, out) {
    const r = this.rnd, n = this._n, t = this._t, b = this._b;
    const cosT = Math.cos(spread);
    const c = cosT + (1 - cosT) * r();
    const s = Math.sqrt(Math.max(0, 1 - c * c));
    const a = r() * Math.PI * 2;
    out.set(
      n.x * c + (t.x * Math.cos(a) + b.x * Math.sin(a)) * s,
      n.y * c + (t.y * Math.cos(a) + b.y * Math.sin(a)) * s,
      n.z * c + (t.z * Math.cos(a) + b.z * Math.sin(a)) * s,
    );
    return out;
  }

  /** random direction in a cone around an arbitrary axis (uses the current basis) */
  _coneAround(axis, spread, out) {
    this._basis(axis);
    return this._cone(spread, out);
  }

  _rr(a, b) { return a + (b - a) * this.rnd(); }
  _n1() { return this.rnd() * 2 - 1; }

  _schedule(op, t, x, y, z, nx, ny, nz, a, b, c, e, s) {
    const tasks = this._tasks;
    for (let i = 0; i < tasks.length; i++) {
      const k = tasks[i];
      if (k.active) continue;
      k.active = true; k.t = t; k.op = op;
      k.x = x; k.y = y; k.z = z;
      k.nx = nx; k.ny = ny; k.nz = nz;
      k.a = a; k.b = b; k.c = c; k.e = e; k.s = s || '';
      return k;
    }
    return null;
  }

  _runTasks(time) {
    const tasks = this._tasks;
    const v0 = this._v0, v1 = this._v1;
    for (let i = 0; i < tasks.length; i++) {
      const k = tasks[i];
      if (!k.active || time < k.t) continue;
      k.active = false;
      switch (k.op) {
        case T_DECAL:
          v0.set(k.x, k.y, k.z); v1.set(k.nx, k.ny, k.nz);
          this.decal(v0, v1, k.s, { size: k.a, tile: k.b >= 0 ? k.b : undefined, opacity: k.c, life: k.e });
          break;
        case T_SPARK_BOUNCE:
          v0.set(k.x, k.y, k.z); v1.set(k.nx, k.ny, k.nz);
          this._sparkBurst(v0, v1, k.a | 0, k.b, k.c);
          break;
        case T_SMOKE:
          v0.set(k.x, k.y, k.z);
          this._smokePuff(v0, k.a, k.b, k.c, k.e);
          break;
        case T_BLOOD_DECAL:
          v0.set(k.x, k.y, k.z); v1.set(k.nx, k.ny, k.nz);
          this.decals.add(v0, v1, {
            tile: k.b | 0, size: k.a, tint: 0x6e1410, opacity: k.c,
            rotation: this.rnd() * 6.283, life: k.e,
          });
          break;
        case T_DEBRIS_DUST:
          v0.set(k.x, k.y, k.z);
          this._smokePuff(v0, k.a, k.b, k.c, k.e);
          break;
        default: break;
      }
    }
  }

  _runEmitters(dt, time) {
    for (let i = 0; i < this._emitters.length; i++) {
      const e = this._emitters[i];
      if (!e.active) continue;
      e.t += dt;
      if (e.t >= e.dur) { e.active = false; continue; }
      e.acc += dt * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        const d = this.particles.begin();
        d.px = e.x + this._n1() * e.size * 0.4;
        d.py = e.y + this.rnd() * e.size * 0.3;
        d.pz = e.z + this._n1() * e.size * 0.4;
        d.vx = this._n1() * 0.35; d.vy = e.up * this._rr(0.5, 1.4); d.vz = this._n1() * 0.35;
        d.life = this._rr(2.5, 5.0);
        d.size0 = e.size * 0.5; d.size1 = e.size * this._rr(2.4, 3.6);
        d.drag = 0.55; d.grav = -0.02;
        d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
        d.rot = this.rnd() * 6.283; d.rotVel = this._n1() * 0.4;
        d.soft = 0.8; d.bright = 1; d.fadeIn = 0.16; d.curve = 1.7;
        d.turb = 0.28; d.turbFreq = 0.9; d.seed = this.rnd() * 30;
        d.r0 = e.r; d.g0 = e.g; d.b0 = e.b; d.a0 = 0.42;
        d.r1 = e.r * 1.15; d.g1 = e.g * 1.15; d.b1 = e.b * 1.15; d.a1 = 0;
        this.particles.emit();
      }
    }
  }

  // =========================================================================
  // SCREEN SHAKE
  // =========================================================================

  /**
   * screenShake(amount, duration, opts)
   * amount ~ 0..1 (1 = a grenade at your feet). Channels sum, so a landing, a
   * burst of fire and an explosion can all be live at once.
   * opts: { channel:0..5, freq, rot }
   */
  screenShake(amount, duration = 0.35, opts) {
    if (!(amount > 0)) return;
    const ch = this._channels;
    let idx = opts && opts.channel != null ? Math.min(5, opts.channel | 0) : -1;
    if (idx < 0) {
      // pick the channel with the least energy left
      let best = 0, bestE = Infinity;
      for (let i = 0; i < ch.length; i++) {
        const e = ch[i].dur > 0 ? ch[i].amp * (1 - ch[i].t / ch[i].dur) : -1;
        if (e < bestE) { bestE = e; best = i; }
      }
      idx = best;
    }
    const c = ch[idx];
    c.amp = Math.max(c.dur > 0 ? c.amp * (1 - c.t / c.dur) : 0, 0) + amount;
    c.amp = Math.min(c.amp, 2.2);
    c.dur = duration;
    c.t = 0;
    c.freq = (opts && opts.freq) || (16 + this.rnd() * 12);
    c.rot = (opts && opts.rot != null) ? opts.rot : 1;
    c.seed = this.rnd() * 100;
    this.ctx.events.emit('fx:shake', { amount, duration });
  }

  _updateShake(dt) {
    let ox = 0, oy = 0, oz = 0, rx = 0, ry = 0, rz = 0, total = 0;
    const ch = this._channels;
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      if (c.dur <= 0) continue;
      c.t += dt;
      if (c.t >= c.dur) { c.dur = 0; c.amp = 0; continue; }
      const u = c.t / c.dur;
      const env = (1 - u) * (1 - u);
      const a = c.amp * env;
      const p = c.t * c.freq + c.seed;
      // three decorrelated oscillators, decaying
      const s1 = Math.sin(p) * Math.sin(p * 0.41 + 1.3);
      const s2 = Math.sin(p * 1.13 + 2.1) * Math.sin(p * 0.37 + 0.7);
      const s3 = Math.sin(p * 0.87 + 4.4) * Math.sin(p * 0.53 + 2.9);
      ox += s1 * a * 0.055;
      oy += s2 * a * 0.055;
      oz += s3 * a * 0.022;
      rx += s2 * a * 0.020 * c.rot;
      ry += s3 * a * 0.020 * c.rot;
      rz += s1 * a * 0.032 * c.rot;
      total += a;
    }
    this.shakeOffset.set(ox, oy, oz);
    this.shakeRotation.set(rx, ry, rz);
    this.shakeAmount = Math.min(1, total);
  }

  getShake(outOffset, outRotation) {
    if (outOffset) outOffset.copy(this.shakeOffset);
    if (outRotation) outRotation.copy(this.shakeRotation);
    return this.shakeAmount;
  }

  // =========================================================================
  // DECALS
  // =========================================================================

  /**
   * decal(point, normal, surface, opts)
   * opts: { size, tile, tint, opacity, rotation, life, tangent, kind:'blood'|'scorch' }
   */
  decal(point, normal, surface = 'concrete', opts) {
    if (!this.enabled) return null;
    const info = this.decals.surfaceInfo(surface);
    const o = opts || EMPTY;
    let tile = o.tile;
    if (tile == null) {
      if (o.kind === 'blood') tile = DECAL.BLOOD_A;
      else if (o.kind === 'scorch') tile = DECAL.SCORCH;
      else tile = info.tiles[(this.rnd() * info.tiles.length) | 0];
    }
    const a = this._dopt;
    a.tile = tile;
    a.size = o.size != null ? o.size : info.size * this._rr(0.82, 1.24);
    a.tint = o.tint != null ? o.tint : info.tint;
    a.opacity = (o.opacity != null ? o.opacity : 1) * info.dark;
    a.rotation = o.rotation != null ? o.rotation : this.rnd() * 6.283;
    a.life = o.life != null ? o.life : 45;
    a.depth = o.depth;
    a.tangent = o.tangent;
    a.minDot = o.minDot;
    return this.decals.add(point, normal, a);
  }

  // =========================================================================
  // IMPACTS
  // =========================================================================

  /**
   * impact(point, normal, surface, opts)
   * opts: { incoming:Vec3, scale:number, weapon, decal:boolean }
   */
  impact(point, normal, surface = 'concrete', opts) {
    if (!this.enabled) return;
    const o = opts || EMPTY;
    const scale = o.scale != null ? o.scale : 1;
    const n = this._sn.set(normal.x, normal.y, normal.z);
    if (n.lengthSq() < 1e-8) n.set(0, 1, 0); else n.normalize();
    // spray axis: reflect the incoming ray about the surface normal, then blend
    // back toward the normal — real debris cones sit between the two.
    const d = this._spray;
    if (o.incoming) {
      const dot = o.incoming.x * n.x + o.incoming.y * n.y + o.incoming.z * n.z;
      d.set(o.incoming.x - 2 * dot * n.x, o.incoming.y - 2 * dot * n.y, o.incoming.z - 2 * dot * n.z);
      if (d.lengthSq() < 1e-6) d.copy(n); else d.normalize();
      d.lerp(n, 0.45).normalize();
    } else {
      d.copy(n);
    }
    this._basis(d);   // spray cone is built around the reflected axis

    switch (surface) {
      case 'metal': this._impactMetal(point, n, scale); break;
      case 'wood': this._impactWood(point, n, scale); break;
      case 'glass': this._impactGlass(point, n, scale); break;
      case 'dirt': case 'sand': case 'gravel': this._impactDirt(point, n, scale, surface); break;
      case 'water': this._impactWater(point, n, scale); break;
      case 'flesh': this.blood(point, n, { incoming: o.incoming, scale }); return;
      case 'foliage': this._impactFoliage(point, n, scale); break;
      case 'fabric': case 'rubber': this._impactSoft(point, n, scale, surface); break;
      default: this._impactConcrete(point, n, scale, surface); break;
    }

    if (o.decal !== false) this.decal(point, normal, surface, IMPACT_DECAL);
  }

  // --- concrete / plaster / brick / tile ---------------------------------
  _impactConcrete(p, n, scale, surface) {
    const P = this.particles, r = this.rnd;
    const den = this.density * scale;
    const tint = surface === 'brick' ? [0.62, 0.42, 0.33]
      : surface === 'plaster' ? [0.80, 0.78, 0.73]
        : [0.66, 0.63, 0.59];

    // 1. the muzzle-side flash of pulverised stone
    let d = P.begin();
    d.px = p.x + n.x * 0.02; d.py = p.y + n.y * 0.02; d.pz = p.z + n.z * 0.02;
    d.life = 0.055; d.size0 = 0.055 * scale; d.size1 = 0.13 * scale;
    d.tile = TILE.GLOW; d.add = 1; d.bright = 2.4; d.fadeIn = 0.02;
    d.r0 = 1; d.g0 = 0.90; d.b0 = 0.70; d.a0 = 0.85; d.a1 = 0;
    P.emit();

    // 2. dust puff — the readable part of the hit
    const puffs = Math.max(2, Math.round(5 * den));
    for (let i = 0; i < puffs; i++) {
      this._cone(1.05, this._v1);
      d = P.begin();
      d.px = p.x + n.x * 0.03 + this._n1() * 0.02;
      d.py = p.y + n.y * 0.03 + this._n1() * 0.02;
      d.pz = p.z + n.z * 0.03 + this._n1() * 0.02;
      const sp = this._rr(1.1, 3.0);
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 0.35; d.vz = this._v1.z * sp;
      d.life = this._rr(0.55, 1.15);
      d.size0 = this._rr(0.035, 0.07) * scale;
      d.size1 = this._rr(0.22, 0.40) * scale;
      d.drag = 4.2; d.grav = 0.08;
      d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 2.4;
      d.soft = 0.35; d.fadeIn = 0.05; d.curve = 2.2; d.seed = r() * 30;
      d.r0 = tint[0] * 1.08; d.g0 = tint[1] * 1.08; d.b0 = tint[2] * 1.08; d.a0 = 0.60;
      d.r1 = tint[0]; d.g1 = tint[1]; d.b1 = tint[2] * 1.05; d.a1 = 0;
      P.emit();
    }

    // 3. stone chips
    const chips = Math.max(2, Math.round(7 * den));
    for (let i = 0; i < chips; i++) {
      this._cone(0.95, this._v1);
      d = P.begin();
      d.px = p.x + n.x * 0.01; d.py = p.y + n.y * 0.01; d.pz = p.z + n.z * 0.01;
      const sp = this._rr(2.6, 7.5);
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 0.6; d.vz = this._v1.z * sp;
      d.life = this._rr(0.55, 1.25);
      d.size0 = this._rr(0.006, 0.016) * scale; d.size1 = d.size0;
      d.drag = 0.45; d.grav = 1;
      d.tile = TILE.CHIP;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 16;
      d.fadeIn = 0.01;
      d.r0 = tint[0]; d.g0 = tint[1]; d.b0 = tint[2]; d.a0 = 1;
      d.r1 = tint[0] * 0.8; d.g1 = tint[1] * 0.8; d.b1 = tint[2] * 0.8; d.a1 = 1;
      P.emit();
    }

    // 4. the small persistent cloud that hangs after the puff clears
    const lingers = Math.max(1, Math.round(2 * den));
    for (let i = 0; i < lingers; i++) {
      d = P.begin();
      d.px = p.x + n.x * 0.10 + this._n1() * 0.05;
      d.py = p.y + n.y * 0.10 + this._n1() * 0.05;
      d.pz = p.z + n.z * 0.10 + this._n1() * 0.05;
      d.vx = n.x * 0.25 + this._n1() * 0.12;
      d.vy = n.y * 0.25 + 0.30;
      d.vz = n.z * 0.25 + this._n1() * 0.12;
      d.life = this._rr(2.2, 3.8);
      d.size0 = this._rr(0.10, 0.16) * scale;
      d.size1 = this._rr(0.5, 0.85) * scale;
      d.drag = 1.4; d.grav = -0.03;
      d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 0.55;
      d.soft = 0.7; d.fadeIn = 0.22; d.curve = 1.5; d.seed = r() * 30;
      d.turb = 0.10; d.turbFreq = 1.6;
      d.r0 = tint[0] * 1.05; d.g0 = tint[1] * 1.05; d.b0 = tint[2] * 1.08; d.a0 = 0.16;
      d.r1 = tint[0]; d.g1 = tint[1]; d.b1 = tint[2] * 1.1; d.a1 = 0;
      P.emit();
    }
  }

  // --- metal --------------------------------------------------------------
  _impactMetal(p, n, scale) {
    const P = this.particles, r = this.rnd;
    const den = this.density * scale;

    // hot flash + lingering glow at the strike point
    let d = P.begin();
    d.px = p.x + n.x * 0.015; d.py = p.y + n.y * 0.015; d.pz = p.z + n.z * 0.015;
    d.life = 0.07; d.size0 = 0.10 * scale; d.size1 = 0.19 * scale;
    d.tile = TILE.FLARE; d.add = 1; d.bright = 7.0; d.fadeIn = 0.015;
    d.rot = r() * 6.283;
    d.r0 = 1; d.g0 = 0.92; d.b0 = 0.72; d.a0 = 1; d.a1 = 0;
    P.emit();

    d = P.begin();
    d.px = p.x + n.x * 0.012; d.py = p.y + n.y * 0.012; d.pz = p.z + n.z * 0.012;
    d.life = 0.55; d.size0 = 0.035 * scale; d.size1 = 0.012 * scale;
    d.tile = TILE.GLOW; d.add = 1; d.bright = 3.0; d.fadeIn = 0.02; d.curve = 0.6;
    d.r0 = 1; d.g0 = 0.55; d.b0 = 0.16; d.a0 = 0.9;
    d.r1 = 1; d.g1 = 0.20; d.b1 = 0.03; d.a1 = 0;
    P.emit();

    this._sparkBurst(p, n, Math.round(16 * den), scale, 1, this._spray);

    // a wisp of grey smoke off the hot metal
    for (let i = 0; i < Math.max(1, Math.round(2 * den)); i++) {
      d = P.begin();
      d.px = p.x + n.x * 0.05; d.py = p.y + n.y * 0.05; d.pz = p.z + n.z * 0.05;
      d.vx = n.x * 0.5 + this._n1() * 0.2;
      d.vy = n.y * 0.5 + 0.55; d.vz = n.z * 0.5 + this._n1() * 0.2;
      d.life = this._rr(0.7, 1.4);
      d.size0 = 0.04 * scale; d.size1 = this._rr(0.22, 0.4) * scale;
      d.drag = 2.6; d.grav = -0.06;
      d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 1.2;
      d.soft = 0.4; d.fadeIn = 0.12; d.seed = r() * 30;
      d.r0 = 0.42; d.g0 = 0.41; d.b0 = 0.42; d.a0 = 0.30;
      d.r1 = 0.5; d.g1 = 0.49; d.b1 = 0.52; d.a1 = 0;
      P.emit();
    }
  }

  // sparks that fly, cool from white-hot to deep red, and bounce once
  _sparkBurst(p, n, count, scale, gen, axis) {
    const P = this.particles, r = this.rnd;
    this._basis(axis || n);
    const bounces = gen > 0 ? Math.min(3, Math.round(count * 0.25)) : 0;
    for (let i = 0; i < count; i++) {
      this._cone(gen > 0 ? 1.25 : 1.45, this._v1);
      const sp = this._rr(4.0, 13.0) * (gen > 0 ? 1 : 0.45);
      const life = this._rr(0.28, 0.85) * (gen > 0 ? 1 : 0.6);
      const d = P.begin();
      d.px = p.x + n.x * 0.01; d.py = p.y + n.y * 0.01; d.pz = p.z + n.z * 0.01;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 0.5; d.vz = this._v1.z * sp;
      d.life = life;
      d.size0 = this._rr(0.006, 0.011) * scale; d.size1 = d.size0 * 0.35;
      d.len0 = this._rr(0.07, 0.20) * scale; d.len1 = 0.012;
      d.drag = 0.9; d.grav = 1.0;
      d.tile = TILE.SPARK; d.align = 1; d.add = 1;
      d.bright = this._rr(5.0, 9.0); d.fadeIn = 0.006; d.curve = 1.0;
      // hot -> cool ramp
      d.r0 = 1; d.g0 = 0.86; d.b0 = 0.52; d.a0 = 1;
      d.r1 = 1; d.g1 = 0.22; d.b1 = 0.03; d.a1 = 0;
      P.emit();

      // one real bounce: solve the parabola back to the surface plane
      if (i < bounces) {
        const vn = this._v1.x * n.x + this._v1.y * n.y + this._v1.z * n.z;
        const v0 = vn * sp;
        const tHit = Math.min(life * 0.75, (2 * v0) / 9.81);
        if (tHit > 0.05) {
          const bx = p.x + this._v1.x * sp * tHit;
          const by = p.y + this._v1.y * sp * tHit - 4.9 * tHit * tHit;
          const bz = p.z + this._v1.z * sp * tHit;
          this._schedule(T_SPARK_BOUNCE, this._time + tHit, bx, by, bz,
            n.x, n.y, n.z, 3, scale * 0.6, 0, 0, '');
        }
      }
    }
  }

  // --- wood ---------------------------------------------------------------
  _impactWood(p, n, scale) {
    const P = this.particles, r = this.rnd;
    const den = this.density * scale;

    for (let i = 0; i < Math.max(3, Math.round(9 * den)); i++) {
      this._cone(1.0, this._v1);
      const sp = this._rr(2.5, 7.0);
      const d = P.begin();
      d.px = p.x + n.x * 0.01; d.py = p.y + n.y * 0.01; d.pz = p.z + n.z * 0.01;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 0.4; d.vz = this._v1.z * sp;
      d.life = this._rr(0.6, 1.4);
      d.size0 = this._rr(0.004, 0.009) * scale; d.size1 = d.size0;
      d.len0 = this._rr(0.02, 0.055) * scale; d.len1 = d.len0;
      d.drag = 1.4; d.grav = 1;
      d.tile = TILE.SPLINTER; d.align = 1;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 10; d.fadeIn = 0.01;
      d.r0 = 0.74; d.g0 = 0.56; d.b0 = 0.34; d.a0 = 1;
      d.r1 = 0.60; d.g1 = 0.44; d.b1 = 0.26; d.a1 = 1;
      P.emit();
    }
    for (let i = 0; i < Math.max(1, Math.round(3 * den)); i++) {
      this._cone(1.1, this._v1);
      const d = P.begin();
      d.px = p.x + n.x * 0.03; d.py = p.y + n.y * 0.03; d.pz = p.z + n.z * 0.03;
      const sp = this._rr(0.8, 2.2);
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 0.3; d.vz = this._v1.z * sp;
      d.life = this._rr(0.5, 1.0);
      d.size0 = 0.03 * scale; d.size1 = this._rr(0.16, 0.3) * scale;
      d.drag = 4.5; d.grav = 0.1;
      d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 2;
      d.soft = 0.3; d.fadeIn = 0.05; d.seed = r() * 30;
      d.r0 = 0.72; d.g0 = 0.60; d.b0 = 0.44; d.a0 = 0.45;
      d.r1 = 0.66; d.g1 = 0.56; d.b1 = 0.42; d.a1 = 0;
      P.emit();
    }
  }

  // --- glass --------------------------------------------------------------
  _impactGlass(p, n, scale) {
    const P = this.particles, r = this.rnd;
    const den = this.density * scale;

    for (let i = 0; i < Math.max(4, Math.round(14 * den)); i++) {
      this._cone(1.15, this._v1);
      const sp = this._rr(2.0, 8.0);
      const d = P.begin();
      d.px = p.x + n.x * 0.01; d.py = p.y + n.y * 0.01; d.pz = p.z + n.z * 0.01;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 0.3; d.vz = this._v1.z * sp;
      d.life = this._rr(0.8, 1.9);
      d.size0 = this._rr(0.005, 0.017) * scale; d.size1 = d.size0;
      d.drag = 0.30; d.grav = 1;
      d.tile = TILE.SHARD;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 22;
      d.bright = 1.9; d.fadeIn = 0.01;
      d.r0 = 0.82; d.g0 = 0.92; d.b0 = 0.98; d.a0 = 1;
      d.r1 = 0.78; d.g1 = 0.88; d.b1 = 0.95; d.a1 = 0.85;
      P.emit();
    }
    // glinting sparkles — a shard catching the sun for one frame
    for (let i = 0; i < Math.max(3, Math.round(8 * den)); i++) {
      this._cone(1.2, this._v1);
      const sp = this._rr(1.5, 6.0);
      const d = P.begin();
      d.px = p.x + n.x * 0.02; d.py = p.y + n.y * 0.02; d.pz = p.z + n.z * 0.02;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp; d.vz = this._v1.z * sp;
      d.life = this._rr(0.25, 0.8);
      d.size0 = this._rr(0.012, 0.03) * scale; d.size1 = d.size0 * 0.4;
      d.drag = 0.35; d.grav = 1;
      d.tile = TILE.FLARE; d.add = 1; d.bright = 4.0; d.fadeIn = 0.02;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 6;
      d.r0 = 0.90; d.g0 = 0.97; d.b0 = 1.0; d.a0 = 0.9; d.a1 = 0;
      P.emit();
    }
    // fine glass powder
    for (let i = 0; i < Math.max(1, Math.round(3 * den)); i++) {
      const d = P.begin();
      d.px = p.x + n.x * 0.03; d.py = p.y + n.y * 0.03; d.pz = p.z + n.z * 0.03;
      d.vx = n.x * 1.1 + this._n1() * 0.4; d.vy = n.y * 1.1 + this._n1() * 0.4;
      d.vz = n.z * 1.1 + this._n1() * 0.4;
      d.life = this._rr(0.4, 0.9);
      d.size0 = 0.03 * scale; d.size1 = this._rr(0.14, 0.26) * scale;
      d.drag = 4.0;
      d.tile = TILE.MIST; d.rot = r() * 6.283; d.soft = 0.3; d.fadeIn = 0.04;
      d.bright = 1.4;
      d.r0 = 0.85; d.g0 = 0.92; d.b0 = 0.98; d.a0 = 0.42;
      d.r1 = 0.85; d.g1 = 0.92; d.b1 = 0.98; d.a1 = 0;
      P.emit();
    }
  }

  // --- dirt / sand / gravel ----------------------------------------------
  _impactDirt(p, n, scale, surface) {
    const P = this.particles, r = this.rnd;
    const den = this.density * scale;
    const tint = surface === 'sand' ? [0.78, 0.68, 0.53]
      : surface === 'gravel' ? [0.52, 0.49, 0.44] : [0.46, 0.38, 0.29];

    // heavy, low, wide puff that stays near the ground
    for (let i = 0; i < Math.max(3, Math.round(8 * den)); i++) {
      this._cone(1.25, this._v1);
      const d = P.begin();
      d.px = p.x + n.x * 0.02 + this._n1() * 0.04;
      d.py = p.y + n.y * 0.02;
      d.pz = p.z + n.z * 0.02 + this._n1() * 0.04;
      const sp = this._rr(1.0, 3.4);
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp * 0.55 + 0.25; d.vz = this._v1.z * sp;
      d.life = this._rr(0.9, 1.9);
      d.size0 = this._rr(0.05, 0.10) * scale;
      d.size1 = this._rr(0.30, 0.62) * scale;
      d.drag = 3.2; d.grav = 0.22;
      d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 1.6;
      d.soft = 0.5; d.fadeIn = 0.06; d.curve = 2.0; d.seed = r() * 30;
      d.turb = 0.07; d.turbFreq = 2.2;
      d.r0 = tint[0] * 1.1; d.g0 = tint[1] * 1.1; d.b0 = tint[2] * 1.1; d.a0 = 0.66;
      d.r1 = tint[0]; d.g1 = tint[1]; d.b1 = tint[2] * 1.08; d.a1 = 0;
      P.emit();
    }
    // clods
    for (let i = 0; i < Math.max(2, Math.round(7 * den)); i++) {
      this._cone(0.85, this._v1);
      const sp = this._rr(2.0, 6.0);
      const d = P.begin();
      d.px = p.x; d.py = p.y; d.pz = p.z;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 1.2; d.vz = this._v1.z * sp;
      d.life = this._rr(0.6, 1.3);
      d.size0 = this._rr(0.008, 0.022) * scale; d.size1 = d.size0;
      d.drag = 0.6; d.grav = 1;
      d.tile = TILE.CHIP; d.rot = r() * 6.283; d.rotVel = this._n1() * 12;
      d.fadeIn = 0.01;
      d.r0 = tint[0] * 0.85; d.g0 = tint[1] * 0.85; d.b0 = tint[2] * 0.85; d.a0 = 1;
      d.r1 = tint[0] * 0.8; d.g1 = tint[1] * 0.8; d.b1 = tint[2] * 0.8; d.a1 = 1;
      P.emit();
    }
  }

  // --- water --------------------------------------------------------------
  _impactWater(p, n, scale) {
    const P = this.particles, r = this.rnd;
    const den = this.density * scale;

    // crown: elongated water columns thrown straight up around the entry
    for (let i = 0; i < Math.max(5, Math.round(11 * den)); i++) {
      const a = (i / Math.max(1, Math.round(11 * den))) * 6.283 + r() * 0.5;
      const rad = this._rr(0.02, 0.07) * scale;
      this._basis(n);
      const d = P.begin();
      d.px = p.x + Math.cos(a) * rad * this._t.x + Math.sin(a) * rad * this._b.x;
      d.py = p.y + Math.cos(a) * rad * this._t.y + Math.sin(a) * rad * this._b.y;
      d.pz = p.z + Math.cos(a) * rad * this._t.z + Math.sin(a) * rad * this._b.z;
      const out = this._rr(0.7, 2.0), up = this._rr(2.4, 4.6);
      d.vx = n.x * up + (this._t.x * Math.cos(a) + this._b.x * Math.sin(a)) * out;
      d.vy = n.y * up + (this._t.y * Math.cos(a) + this._b.y * Math.sin(a)) * out;
      d.vz = n.z * up + (this._t.z * Math.cos(a) + this._b.z * Math.sin(a)) * out;
      d.life = this._rr(0.45, 0.85);
      d.size0 = this._rr(0.014, 0.03) * scale; d.size1 = d.size0 * 0.5;
      d.len0 = this._rr(0.05, 0.13) * scale; d.len1 = 0.02;
      d.drag = 0.35; d.grav = 1; d.align = 1;
      d.tile = TILE.WATER; d.bright = 1.6; d.fadeIn = 0.02;
      d.r0 = 0.80; d.g0 = 0.90; d.b0 = 0.95; d.a0 = 0.95;
      d.r1 = 0.80; d.g1 = 0.90; d.b1 = 0.95; d.a1 = 0;
      P.emit();
    }
    // droplets
    for (let i = 0; i < Math.max(4, Math.round(12 * den)); i++) {
      this._basis(n);
      this._cone(0.75, this._v1);
      const sp = this._rr(1.5, 4.5);
      const d = P.begin();
      d.px = p.x; d.py = p.y; d.pz = p.z;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 1.0; d.vz = this._v1.z * sp;
      d.life = this._rr(0.5, 1.1);
      d.size0 = this._rr(0.005, 0.012) * scale; d.size1 = d.size0;
      d.drag = 0.3; d.grav = 1; d.align = 1;
      d.len0 = d.size0 * 2.4; d.len1 = d.size0 * 1.2;
      d.tile = TILE.WATER; d.bright = 1.5; d.fadeIn = 0.01;
      d.r0 = 0.85; d.g0 = 0.93; d.b0 = 0.98; d.a0 = 0.9; d.a1 = 0.2;
      P.emit();
    }
    // mist
    for (let i = 0; i < Math.max(2, Math.round(4 * den)); i++) {
      const d = P.begin();
      d.px = p.x + this._n1() * 0.05; d.py = p.y + 0.03; d.pz = p.z + this._n1() * 0.05;
      d.vx = this._n1() * 0.5; d.vy = this._rr(0.4, 1.1); d.vz = this._n1() * 0.5;
      d.life = this._rr(0.5, 1.0);
      d.size0 = 0.05 * scale; d.size1 = this._rr(0.20, 0.36) * scale;
      d.drag = 3.0; d.grav = 0.1;
      d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
      d.rot = r() * 6.283; d.soft = 0.35; d.fadeIn = 0.06; d.seed = r() * 30;
      d.bright = 1.15;
      d.r0 = 0.86; d.g0 = 0.92; d.b0 = 0.96; d.a0 = 0.30;
      d.r1 = 0.86; d.g1 = 0.92; d.b1 = 0.96; d.a1 = 0;
      P.emit();
    }
    // expanding ripple lying flat on the surface
    for (let i = 0; i < 2; i++) {
      const d = P.begin();
      d.px = p.x; d.py = p.y + 0.004; d.pz = p.z;
      d.vx = n.x; d.vy = n.y; d.vz = n.z;   // plane normal for align=2
      d.align = 2;
      d.life = this._rr(0.8, 1.4) + i * 0.25;
      d.size0 = 0.04 * scale; d.size1 = this._rr(0.4, 0.75) * scale * (1 + i * 0.5);
      d.tile = TILE.RIPPLE; d.bright = 1.5; d.fadeIn = 0.05; d.curve = 2.4;
      d.rot = r() * 6.283;
      d.r0 = 0.85; d.g0 = 0.93; d.b0 = 0.98; d.a0 = 0.55; d.a1 = 0;
      P.emit();
    }
  }

  // --- foliage ------------------------------------------------------------
  _impactFoliage(p, n, scale) {
    const P = this.particles, r = this.rnd;
    const den = this.density * scale;
    for (let i = 0; i < Math.max(3, Math.round(9 * den)); i++) {
      this._cone(1.35, this._v1);
      const sp = this._rr(1.2, 4.0);
      const d = P.begin();
      d.px = p.x; d.py = p.y; d.pz = p.z;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 0.3; d.vz = this._v1.z * sp;
      d.life = this._rr(1.0, 2.2);
      d.size0 = this._rr(0.012, 0.030) * scale; d.size1 = d.size0;
      d.drag = 2.2; d.grav = 0.35;
      d.tile = TILE.LEAF;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 8;
      d.turb = 0.25; d.turbFreq = 4.0; d.seed = r() * 30; d.fadeIn = 0.02;
      d.r0 = 0.52; d.g0 = 0.55; d.b0 = 0.28; d.a0 = 1;
      d.r1 = 0.46; d.g1 = 0.48; d.b1 = 0.24; d.a1 = 0.6;
      P.emit();
    }
    for (let i = 0; i < Math.max(1, Math.round(2 * den)); i++) {
      const d = P.begin();
      d.px = p.x; d.py = p.y; d.pz = p.z;
      d.vx = n.x * 0.6; d.vy = n.y * 0.6 + 0.2; d.vz = n.z * 0.6;
      d.life = this._rr(0.5, 1.0);
      d.size0 = 0.04 * scale; d.size1 = 0.20 * scale;
      d.drag = 4; d.tile = TILE.DUST; d.rot = r() * 6.283;
      d.soft = 0.3; d.fadeIn = 0.06;
      d.r0 = 0.48; d.g0 = 0.50; d.b0 = 0.30; d.a0 = 0.35;
      d.r1 = 0.48; d.g1 = 0.50; d.b1 = 0.30; d.a1 = 0;
      P.emit();
    }
  }

  // --- fabric / rubber ----------------------------------------------------
  _impactSoft(p, n, scale, surface) {
    const P = this.particles, r = this.rnd;
    const den = this.density * scale;
    const tint = surface === 'rubber' ? [0.20, 0.20, 0.21] : [0.55, 0.48, 0.40];
    for (let i = 0; i < Math.max(2, Math.round(4 * den)); i++) {
      this._cone(1.1, this._v1);
      const d = P.begin();
      d.px = p.x + n.x * 0.02; d.py = p.y + n.y * 0.02; d.pz = p.z + n.z * 0.02;
      const sp = this._rr(0.7, 2.2);
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 0.3; d.vz = this._v1.z * sp;
      d.life = this._rr(0.4, 0.9);
      d.size0 = 0.03 * scale; d.size1 = this._rr(0.14, 0.28) * scale;
      d.drag = 5.0; d.grav = 0.1;
      d.tile = TILE.DUST; d.rot = r() * 6.283; d.rotVel = this._n1() * 2;
      d.soft = 0.3; d.fadeIn = 0.05;
      d.r0 = tint[0] * 1.2; d.g0 = tint[1] * 1.2; d.b0 = tint[2] * 1.2; d.a0 = 0.45;
      d.r1 = tint[0]; d.g1 = tint[1]; d.b1 = tint[2]; d.a1 = 0;
      P.emit();
    }
  }

  // =========================================================================
  // TRACER
  // =========================================================================

  /**
   * tracer(from, to, opts)
   * opts: { speed (m/s, default 780), color, brightness, width, length,
   *         vapour:boolean, first:boolean }
   */
  tracer(from, to, opts) {
    if (!this.enabled) return;
    const o = opts || EMPTY;
    const P = this.particles, r = this.rnd;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.2) return;
    const inv = 1 / dist;
    const ux = dx * inv, uy = dy * inv, uz = dz * inv;
    const speed = o.speed || 780;
    const life = Math.min(dist / speed, 2.0);
    const w = o.width || 0.020;
    const len = o.length || 1.15;
    const bright = o.brightness != null ? o.brightness : 5.5;
    const col = o.color || TRACER_COL;

    // hot outer streak
    let d = P.begin();
    d.px = from.x; d.py = from.y; d.pz = from.z;
    d.vx = ux * speed; d.vy = uy * speed; d.vz = uz * speed;
    d.life = life;
    d.size0 = w; d.size1 = w * 0.72;
    d.len0 = len; d.len1 = len * 0.55;
    d.align = 1; d.add = 1; d.tile = TILE.SPARK;
    d.bright = bright; d.fadeIn = 0.001; d.grav = 0.02;
    d.r0 = col[0]; d.g0 = col[1]; d.b0 = col[2]; d.a0 = 1;
    d.r1 = col[0]; d.g1 = col[1] * 0.65; d.b1 = col[2] * 0.4; d.a1 = 0.15;
    P.emit();

    // white-hot core
    d = P.begin();
    d.px = from.x; d.py = from.y; d.pz = from.z;
    d.vx = ux * speed; d.vy = uy * speed; d.vz = uz * speed;
    d.life = life;
    d.size0 = w * 0.44; d.size1 = w * 0.3;
    d.len0 = len * 0.5; d.len1 = len * 0.3;
    d.align = 1; d.add = 1; d.tile = TILE.SPARK;
    d.bright = bright * 2.4; d.fadeIn = 0.001; d.grav = 0.02;
    d.r0 = 1; d.g0 = 0.96; d.b0 = 0.86; d.a0 = 1;
    d.r1 = 1; d.g1 = 0.80; d.b1 = 0.50; d.a1 = 0.1;
    P.emit();

    // supersonic vapour trail: thin condensation puffs left along the path
    if (o.vapour !== false && speed > 420 && this.density > 0.5) {
      const n = Math.min(7, Math.max(2, Math.round(dist / 7)));
      for (let i = 1; i <= n; i++) {
        const f = i / (n + 1);
        const t = (dist * f) / speed;
        d = P.begin();
        d.px = from.x + dx * f; d.py = from.y + dy * f; d.pz = from.z + dz * f;
        d.vx = this._n1() * 0.25 - ux * 0.6;
        d.vy = this._n1() * 0.25 - uy * 0.6 + 0.15;
        d.vz = this._n1() * 0.25 - uz * 0.6;
        d.delay = t;
        d.life = this._rr(0.30, 0.70);
        d.size0 = 0.020; d.size1 = this._rr(0.10, 0.20);
        d.drag = 2.4; d.grav = -0.02;
        d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
        d.rot = r() * 6.283; d.rotVel = this._n1() * 1.5;
        d.soft = 0.3; d.fadeIn = 0.15; d.seed = r() * 30; d.bright = 1.1;
        d.r0 = 0.72; d.g0 = 0.74; d.b0 = 0.78; d.a0 = 0.11;
        d.r1 = 0.72; d.g1 = 0.74; d.b1 = 0.78; d.a1 = 0;
        P.emit();
      }
    }
  }

  // =========================================================================
  // MUZZLE FLASH
  // =========================================================================

  /**
   * muzzleFlash(matrixOrObject, opts)
   * Accepts a THREE.Object3D, a THREE.Matrix4, or { position, direction }.
   * Objects that live in ctx.viewScene get their flash mirrored into the world
   * at the equivalent world-space muzzle position.
   * opts: { scale, dir:Vec3, color, light:boolean, smoke:boolean, sparks:boolean }
   */
  muzzleFlash(matrixOrObject, opts) {
    if (!this.enabled) return;
    const o = opts || EMPTY;
    if (!this._resolveMuzzle(matrixOrObject, o)) return;

    const P = this.particles, r = this.rnd;
    const p = this._v0;          // world position
    const dir = this._v1;        // world forward
    const scale = (o.scale != null ? o.scale : 1);
    const den = this.density;
    const seed = r();

    this._basis(dir);
    const up = this._t, side = this._b;

    // --- 1. core star flare: the single saturated element in the frame ---
    let d = P.begin();
    d.px = p.x + dir.x * 0.02; d.py = p.y + dir.y * 0.02; d.pz = p.z + dir.z * 0.02;
    d.life = this._rr(0.030, 0.046);
    d.size0 = this._rr(0.10, 0.16) * scale;
    d.size1 = d.size0 * this._rr(1.2, 1.7);
    d.tile = TILE.FLARE; d.add = 1; d.bright = this._rr(10, 16);
    d.fadeIn = 0.004; d.rot = r() * 6.283; d.rotVel = this._n1() * 6;
    d.r0 = 1; d.g0 = 0.94; d.b0 = 0.76; d.a0 = 1; d.a1 = 0;
    P.emit();

    // --- 2. multi-lobed flame, randomised per shot ---
    const lobes = 3 + ((seed * 4) | 0);
    for (let i = 0; i < lobes; i++) {
      const ang = r() * 6.283;
      const spread = this._rr(0.05, 0.42);
      const lx = dir.x + (up.x * Math.cos(ang) + side.x * Math.sin(ang)) * spread;
      const ly = dir.y + (up.y * Math.cos(ang) + side.y * Math.sin(ang)) * spread;
      const lz = dir.z + (up.z * Math.cos(ang) + side.z * Math.sin(ang)) * spread;
      const l = 1 / Math.hypot(lx, ly, lz);
      d = P.begin();
      d.px = p.x + dir.x * 0.03; d.py = p.y + dir.y * 0.03; d.pz = p.z + dir.z * 0.03;
      d.vx = lx * l * 3.0; d.vy = ly * l * 3.0; d.vz = lz * l * 3.0;
      d.delay = i === 0 ? 0 : r() * 0.008;
      d.life = this._rr(0.026, 0.055);
      d.size0 = this._rr(0.035, 0.075) * scale;
      d.size1 = d.size0 * this._rr(1.3, 2.2);
      d.len0 = this._rr(0.10, 0.34) * scale * (i === 0 ? 1.5 : 1);
      d.len1 = d.len0 * 1.35;
      d.align = 1; d.add = 1; d.tile = TILE.FLAME;
      d.bright = this._rr(6, 12); d.fadeIn = 0.003; d.curve = 0.8;
      d.drag = 6;
      d.r0 = 1; d.g0 = this._rr(0.82, 0.96); d.b0 = this._rr(0.55, 0.78); d.a0 = 1;
      d.r1 = 1; d.g1 = 0.48; d.b1 = 0.14; d.a1 = 0;
      P.emit();
    }

    // --- 3. soft bloom ball right at the crown ---
    d = P.begin();
    d.px = p.x + dir.x * 0.05; d.py = p.y + dir.y * 0.05; d.pz = p.z + dir.z * 0.05;
    d.life = this._rr(0.05, 0.075);
    d.size0 = this._rr(0.11, 0.17) * scale; d.size1 = d.size0 * 1.5;
    d.tile = TILE.GLOW; d.add = 1; d.bright = this._rr(3.5, 5.5); d.fadeIn = 0.006;
    d.r0 = 1; d.g0 = 0.74; d.b0 = 0.40; d.a0 = 0.95; d.a1 = 0;
    P.emit();

    // --- 4. unburnt powder sparks ---
    if (o.sparks !== false) {
      const n = Math.max(3, Math.round(9 * den));
      for (let i = 0; i < n; i++) {
        this._basis(dir);
        this._cone(0.55, this._v2);
        const sp = this._rr(6, 17);
        d = P.begin();
        d.px = p.x + dir.x * 0.04; d.py = p.y + dir.y * 0.04; d.pz = p.z + dir.z * 0.04;
        d.vx = this._v2.x * sp; d.vy = this._v2.y * sp; d.vz = this._v2.z * sp;
        d.life = this._rr(0.08, 0.30);
        d.size0 = this._rr(0.005, 0.010); d.size1 = d.size0 * 0.3;
        d.len0 = this._rr(0.06, 0.16); d.len1 = 0.01;
        d.align = 1; d.add = 1; d.tile = TILE.SPARK;
        d.bright = this._rr(4, 8); d.drag = 2.2; d.grav = 1; d.fadeIn = 0.004;
        d.r0 = 1; d.g0 = 0.84; d.b0 = 0.50; d.a0 = 1;
        d.r1 = 1; d.g1 = 0.26; d.b1 = 0.05; d.a1 = 0;
        P.emit();
      }
    }

    // --- 5. smoke wisp pushed out of the bore ---
    if (o.smoke !== false) {
      const n = Math.max(1, Math.round(2.5 * den));
      for (let i = 0; i < n; i++) {
        d = P.begin();
        d.px = p.x + dir.x * (0.06 + r() * 0.10);
        d.py = p.y + dir.y * (0.06 + r() * 0.10);
        d.pz = p.z + dir.z * (0.06 + r() * 0.10);
        d.vx = dir.x * this._rr(0.8, 2.2) + this._n1() * 0.25;
        d.vy = dir.y * this._rr(0.8, 2.2) + this._n1() * 0.25 + 0.35;
        d.vz = dir.z * this._rr(0.8, 2.2) + this._n1() * 0.25;
        d.delay = r() * 0.02;
        d.life = this._rr(0.7, 1.5);
        d.size0 = this._rr(0.025, 0.05) * scale;
        d.size1 = this._rr(0.20, 0.42) * scale;
        d.drag = 2.6; d.grav = -0.05;
        d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
        d.rot = r() * 6.283; d.rotVel = this._n1() * 1.1;
        d.soft = 0.4; d.fadeIn = 0.12; d.curve = 1.6; d.seed = r() * 30;
        d.turb = 0.10; d.turbFreq = 3.0;
        d.r0 = 0.56; d.g0 = 0.55; d.b0 = 0.55; d.a0 = 0.26;
        d.r1 = 0.62; d.g1 = 0.62; d.b1 = 0.64; d.a1 = 0;
        P.emit();
      }
    }

    // --- 6. the light that actually lifts the geometry around the shooter ---
    if (o.light !== false) {
      this.lights.flash(
        this._v2.set(p.x + dir.x * 0.15, p.y + dir.y * 0.15, p.z + dir.z * 0.15),
        o.color || 0xffcf94,
        this._rr(48, 72) * scale,
        0.042,
        { distance: 11 * scale, priority: 1, curve: 1.6 },
      );
    }
  }

  _resolveMuzzle(m, o) {
    const ctx = this.ctx;
    const p = this._v0, dir = this._v1;
    let inView = false;
    let mat = null;

    if (!m) return false;
    if (m.isObject3D) {
      m.updateWorldMatrix(true, false);
      mat = m.matrixWorld;
      let root = m;
      while (root.parent) root = root.parent;
      inView = root === ctx.viewScene;
    } else if (m.isMatrix4) {
      mat = m;
    } else if (m.position) {
      p.set(m.position.x, m.position.y, m.position.z);
      const dd = o.dir || m.direction;
      if (dd) dir.set(dd.x, dd.y, dd.z).normalize();
      else ctx.camera.getWorldDirection(dir);
      return true;
    } else if (m.x != null) {
      p.set(m.x, m.y, m.z);
      if (o.dir) dir.set(o.dir.x, o.dir.y, o.dir.z).normalize();
      else ctx.camera.getWorldDirection(dir);
      return true;
    } else return false;

    const e = mat.elements;
    p.set(e[12], e[13], e[14]);
    // three's convention: an object's forward is -Z
    dir.set(-e[8], -e[9], -e[10]);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1); else dir.normalize();

    if (inView) {
      // viewmodel space -> world: camera * inverse(viewCamera)
      this._m4.copy(ctx.camera.matrixWorld);
      this._m4b.copy(ctx.viewCamera.matrixWorld).invert();
      this._m4.multiply(this._m4b);
      p.applyMatrix4(this._m4);
      dir.transformDirection(this._m4);
    }
    if (o.dir) dir.set(o.dir.x, o.dir.y, o.dir.z).normalize();
    return true;
  }

  // =========================================================================
  // SHELL
  // =========================================================================

  /** shell(pos, dir, opts) — opts: { kind, speed, spin, life } */
  shell(pos, dir, opts) {
    if (!this.enabled) return null;
    const d = this._v1;
    if (dir) d.set(dir.x, dir.y, dir.z);
    else d.set(1, 0.35, 0);
    if (d.lengthSq() < 1e-8) d.set(1, 0.35, 0);
    d.normalize();
    return this.shells.eject(pos, d, opts || EMPTY);
  }

  // =========================================================================
  // BLOOD
  // =========================================================================

  /**
   * blood(point, normal, opts)
   * opts: { incoming:Vec3, scale, headshot:boolean, decals:boolean }
   */
  blood(point, normal, opts) {
    if (!this.enabled) return;
    const o = opts || EMPTY;
    const P = this.particles, r = this.rnd;
    const scale = (o.scale != null ? o.scale : 1) * (o.headshot ? 1.6 : 1);
    const den = this.density * scale;
    const n = this._basis(normal);

    // spray follows the bullet through the target
    const axis = this._d;
    if (o.incoming) axis.set(o.incoming.x, o.incoming.y, o.incoming.z).normalize();
    else axis.copy(n).multiplyScalar(-1);

    // 1. exit spray (velocity-aligned droplets)
    this._basis(axis);
    const nSpray = Math.max(5, Math.round(16 * den));
    for (let i = 0; i < nSpray; i++) {
      this._cone(0.75, this._v1);
      const sp = this._rr(2.5, 9.0);
      const d = P.begin();
      d.px = point.x - axis.x * 0.02; d.py = point.y - axis.y * 0.02; d.pz = point.z - axis.z * 0.02;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 0.5; d.vz = this._v1.z * sp;
      d.life = this._rr(0.35, 0.95);
      d.size0 = this._rr(0.006, 0.018) * scale; d.size1 = d.size0 * 0.8;
      d.len0 = this._rr(0.03, 0.11); d.len1 = 0.015;
      d.align = 1; d.drag = 0.9; d.grav = 1;
      d.tile = TILE.DROPLET; d.fadeIn = 0.01;
      d.r0 = 0.62; d.g0 = 0.075; d.b0 = 0.055; d.a0 = 1;
      d.r1 = 0.36; d.g1 = 0.045; d.b1 = 0.035; d.a1 = 0.7;
      P.emit();
    }

    // 2. back-spatter toward the shooter
    this._basis(this._v2.copy(axis).multiplyScalar(-1));
    for (let i = 0; i < Math.max(2, Math.round(5 * den)); i++) {
      this._cone(0.9, this._v1);
      const sp = this._rr(1.2, 4.0);
      const d = P.begin();
      d.px = point.x; d.py = point.y; d.pz = point.z;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp + 0.4; d.vz = this._v1.z * sp;
      d.life = this._rr(0.3, 0.7);
      d.size0 = this._rr(0.004, 0.011) * scale; d.size1 = d.size0;
      d.len0 = 0.035; d.len1 = 0.012; d.align = 1;
      d.drag = 1.2; d.grav = 1; d.tile = TILE.DROPLET; d.fadeIn = 0.01;
      d.r0 = 0.58; d.g0 = 0.07; d.b0 = 0.05; d.a0 = 1;
      d.r1 = 0.34; d.g1 = 0.04; d.b1 = 0.03; d.a1 = 0.6;
      P.emit();
    }

    // 3. the mist puff — reads instantly as a hit
    for (let i = 0; i < Math.max(2, Math.round(5 * den)); i++) {
      const d = P.begin();
      d.px = point.x + this._n1() * 0.03;
      d.py = point.y + this._n1() * 0.03;
      d.pz = point.z + this._n1() * 0.03;
      d.vx = -axis.x * this._rr(0.5, 1.8) + this._n1() * 0.4;
      d.vy = -axis.y * this._rr(0.5, 1.8) + this._n1() * 0.4;
      d.vz = -axis.z * this._rr(0.5, 1.8) + this._n1() * 0.4;
      d.life = this._rr(0.30, 0.62);
      d.size0 = this._rr(0.03, 0.06) * scale;
      d.size1 = this._rr(0.16, 0.32) * scale;
      d.drag = 5.5; d.grav = 0.35;
      d.tile = TILE.MIST; d.rot = r() * 6.283; d.rotVel = this._n1() * 3;
      d.soft = 0.25; d.fadeIn = 0.03; d.bright = 0.9;
      d.r0 = 0.66; d.g0 = 0.10; d.b0 = 0.07; d.a0 = 0.62;
      d.r1 = 0.40; d.g1 = 0.06; d.b1 = 0.05; d.a1 = 0;
      P.emit();
    }

    if (o.decals === false) return;
    const phys = this.ctx.physics;
    if (!phys || !phys.raycast) return;

    // 4. droplets that arc away and land as decals
    this._basis(axis);
    const nDrops = Math.max(2, Math.round(4 * den));
    for (let i = 0; i < nDrops; i++) {
      this._cone(1.15, this._v1);
      this._v1.y -= 0.55;                     // bias downward so they hit the floor
      this._v1.normalize();
      const hit = phys.raycast(point, this._v1, 3.2, { entities: false });
      if (!hit) continue;
      const sp = this._rr(4.5, 8.0);
      const flight = hit.distance / sp;
      const d = P.begin();
      d.px = point.x; d.py = point.y; d.pz = point.z;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp; d.vz = this._v1.z * sp;
      d.life = flight;
      d.size0 = this._rr(0.006, 0.013); d.size1 = d.size0;
      d.len0 = 0.05; d.len1 = 0.05; d.align = 1;
      d.tile = TILE.DROPLET; d.fadeIn = 0.01;
      d.r0 = 0.58; d.g0 = 0.07; d.b0 = 0.05; d.a0 = 1;
      d.r1 = 0.50; d.g1 = 0.06; d.b1 = 0.04; d.a1 = 1;
      P.emit();
      this._schedule(T_BLOOD_DECAL, this._time + flight,
        hit.point.x, hit.point.y, hit.point.z,
        hit.normal.x, hit.normal.y, hit.normal.z,
        this._rr(0.05, 0.13), DECAL.BLOOD_A, this._rr(0.55, 0.95), 30, '');
    }

    // 5. wall splatter behind the target
    const wall = phys.raycast(point, axis, 3.5, { entities: false });
    if (wall) {
      const fall = 1 - wall.distance / 3.5;
      this.decals.add(wall.point, wall.normal, {
        tile: DECAL.BLOOD_SPRAY,
        size: this._rr(0.35, 0.65) * scale * (0.5 + fall),
        tint: 0x6e1410,
        opacity: 0.55 + fall * 0.45,
        rotation: r() * 6.283,
        tangent: axis,
        life: 40,
      });
      if (o.headshot) {
        this.decals.add(wall.point, wall.normal, {
          tile: DECAL.BLOOD_A,
          size: this._rr(0.25, 0.45) * scale,
          tint: 0x6e1410, opacity: 0.8, rotation: r() * 6.283, life: 40,
        });
      }
    }
  }

  // =========================================================================
  // EXPLOSION
  // =========================================================================

  /**
   * explosion(point, opts)
   * opts: { radius (default 5), scale, up:Vec3, shake:boolean, silent:boolean }
   */
  explosion(point, opts) {
    if (!this.enabled) return;
    const o = opts || EMPTY;
    const P = this.particles, r = this.rnd;
    const R = o.radius || 5;
    const s = o.scale != null ? o.scale : Math.max(0.5, R / 5);
    const den = this.density;
    const p = this._v0.set(point.x, point.y, point.z);
    this._lastExplosion.x = p.x; this._lastExplosion.y = p.y;
    this._lastExplosion.z = p.z; this._lastExplosion.t = this._time;

    // ---- ground contact (for the crater, the dirt plume and the flat ring) ----
    const phys = this.ctx.physics;
    let groundY = p.y - 0.02, groundN = this._v2.set(0, 1, 0), grounded = false;
    if (phys && phys.raycast) {
      const down = this._d.set(0, -1, 0);
      const hit = phys.raycast(p, down, R * 1.2, { entities: false });
      if (hit) {
        groundY = hit.point.y; groundN.copy(hit.normal); grounded = true;
        if (hit.distance < R * 0.6) {
          this.decals.add(hit.point, hit.normal, {
            tile: DECAL.SCORCH, size: R * this._rr(0.75, 1.05),
            tint: 0x1a1614, opacity: 0.92, rotation: r() * 6.283, life: 180,
            depth: R * 0.5, minDot: 0.05,
          });
        }
      }
    }

    // ---- 1. the flash (two frames, blows the highlights) ----
    let d = P.begin();
    d.px = p.x; d.py = p.y; d.pz = p.z;
    d.life = 0.062;
    d.size0 = R * 0.10; d.size1 = R * 0.34;
    d.tile = TILE.FLARE; d.add = 1; d.bright = 18; d.fadeIn = 0.004;
    d.rot = r() * 6.283;
    d.r0 = 1; d.g0 = 0.96; d.b0 = 0.83; d.a0 = 1; d.a1 = 0;
    P.emit();

    d = P.begin();
    d.px = p.x; d.py = p.y; d.pz = p.z;
    d.life = 0.13;
    d.size0 = R * 0.16; d.size1 = R * 0.46;
    d.tile = TILE.GLOW; d.add = 1; d.bright = 7.5; d.fadeIn = 0.006; d.curve = 1.4;
    d.r0 = 1; d.g0 = 0.76; d.b0 = 0.38; d.a0 = 1; d.a1 = 0;
    P.emit();

    // ---- 2. fireball core: hot, additive, rolling flipbook detail ----
    const nFire = Math.max(7, Math.round(18 * den));
    for (let i = 0; i < nFire; i++) {
      this._basis(UP);
      this._cone(3.14159, this._v1);
      const sp = this._rr(3.0, 9.0) * s;
      d = P.begin();
      d.px = p.x + this._v1.x * 0.09 * R; d.py = p.y + this._v1.y * 0.09 * R;
      d.pz = p.z + this._v1.z * 0.09 * R;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp * 0.75 + 1.3 * s; d.vz = this._v1.z * sp;
      d.delay = r() * 0.035;
      d.life = this._rr(0.26, 0.55);
      d.size0 = R * this._rr(0.07, 0.13);
      d.size1 = R * this._rr(0.22, 0.38);
      d.drag = 5.5; d.grav = -0.35;
      d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES; d.fps = this._rr(22, 34);
      d.rot = r() * 6.283; d.rotVel = this._n1() * 2.2;
      d.add = 1; d.bright = this._rr(2.2, 4.6); d.fadeIn = 0.02; d.curve = 1.5;
      d.turb = 0.30 * s; d.turbFreq = 1.4; d.seed = r() * 30;
      d.r0 = 1; d.g0 = 0.74; d.b0 = 0.34; d.a0 = 0.90;
      d.r1 = 0.88; d.g1 = 0.17; d.b1 = 0.035; d.a1 = 0;
      P.emit();
    }

    // ---- 2b. the sooty shell that rolls over the core a beat later. This is
    // what turns a white blob into a fireball with form. ----
    const nShell = Math.max(6, Math.round(14 * den));
    for (let i = 0; i < nShell; i++) {
      this._basis(UP);
      this._cone(3.14159, this._v1);
      const sp = this._rr(2.2, 7.0) * s;
      d = P.begin();
      d.px = p.x + this._v1.x * 0.12 * R; d.py = p.y + this._v1.y * 0.10 * R;
      d.pz = p.z + this._v1.z * 0.12 * R;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp * 0.8 + 1.8 * s; d.vz = this._v1.z * sp;
      d.delay = 0.035 + r() * 0.10;
      d.life = this._rr(0.9, 2.0);
      d.size0 = R * this._rr(0.10, 0.17);
      d.size1 = R * this._rr(0.34, 0.58);
      d.drag = 2.4; d.grav = -0.12;
      d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES; d.fps = this._rr(9, 15);
      d.rot = r() * 6.283; d.rotVel = this._n1() * 1.4;
      d.soft = 0.9; d.fadeIn = 0.07; d.curve = 1.5; d.seed = r() * 30;
      d.turb = 0.30 * s; d.turbFreq = 1.1;
      d.r0 = 0.30; d.g0 = 0.19; d.b0 = 0.12; d.a0 = 0.85;
      d.r1 = 0.34; d.g1 = 0.32; d.b1 = 0.32; d.a1 = 0;
      P.emit();
    }

    // flame licks tearing off the top of the ball
    for (let i = 0; i < Math.max(4, Math.round(9 * den)); i++) {
      this._basis(UP);
      this._cone(1.1, this._v1);
      const sp = this._rr(5, 14) * s;
      d = P.begin();
      d.px = p.x; d.py = p.y + R * 0.05; d.pz = p.z;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp; d.vz = this._v1.z * sp;
      d.delay = r() * 0.05;
      d.life = this._rr(0.20, 0.45);
      d.size0 = R * this._rr(0.05, 0.10);
      d.size1 = R * this._rr(0.14, 0.26);
      d.len0 = R * this._rr(0.15, 0.35); d.len1 = R * 0.06;
      d.align = 1; d.add = 1; d.tile = TILE.FLAME;
      d.drag = 3.0; d.grav = -0.5;
      d.bright = this._rr(5, 10); d.fadeIn = 0.02;
      d.r0 = 1; d.g0 = 0.86; d.b0 = 0.52; d.a0 = 1;
      d.r1 = 1; d.g1 = 0.30; d.b1 = 0.06; d.a1 = 0;
      P.emit();
    }

    // ---- 3. shockwave: a flat ground ring + a camera-facing compression ring ----
    if (grounded) {
      d = P.begin();
      d.px = p.x; d.py = groundY + 0.03; d.pz = p.z;
      d.vx = groundN.x; d.vy = groundN.y; d.vz = groundN.z;
      d.align = 2;
      d.life = 0.40;
      d.size0 = R * 0.10; d.size1 = R * 0.80;
      d.tile = TILE.RING; d.add = 1; d.bright = 1.7; d.fadeIn = 0.02; d.curve = 2.6;
      d.rot = r() * 6.283;
      d.r0 = 1; d.g0 = 0.88; d.b0 = 0.66; d.a0 = 0.75; d.a1 = 0;
      P.emit();

      // dust ring skidding outward along the ground
      const nRing = Math.max(6, Math.round(14 * den));
      for (let i = 0; i < nRing; i++) {
        const a = (i / nRing) * 6.283 + r() * 0.4;
        const ca = Math.cos(a), sa = Math.sin(a);
        const sp = this._rr(6, 13) * s;
        d = P.begin();
        d.px = p.x + ca * R * 0.15; d.py = groundY + 0.08 * s; d.pz = p.z + sa * R * 0.15;
        d.vx = ca * sp; d.vy = this._rr(0.3, 1.4); d.vz = sa * sp;
        d.delay = r() * 0.04;
        d.life = this._rr(1.4, 2.8);
        d.size0 = R * 0.10; d.size1 = R * this._rr(0.35, 0.60);
        d.drag = 2.6; d.grav = 0.08;
        d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
        d.rot = r() * 6.283; d.rotVel = this._n1() * 1.1;
        d.soft = 0.9; d.fadeIn = 0.08; d.curve = 1.8; d.seed = r() * 30;
        d.turb = 0.2; d.turbFreq = 1.1;
        d.r0 = 0.42; d.g0 = 0.36; d.b0 = 0.30; d.a0 = 0.55;
        d.r1 = 0.52; d.g1 = 0.48; d.b1 = 0.44; d.a1 = 0;
        P.emit();
      }
    }

    // camera-facing compression ring (stands in for refractive distortion)
    d = P.begin();
    d.px = p.x; d.py = p.y; d.pz = p.z;
    d.life = 0.26;
    d.size0 = R * 0.12; d.size1 = R * 0.70;
    d.tile = TILE.RIPPLE; d.add = 1; d.bright = 0.85; d.fadeIn = 0.015; d.curve = 2.8;
    d.r0 = 0.95; d.g0 = 0.90; d.b0 = 0.82; d.a0 = 0.40; d.a1 = 0;
    P.emit();

    // ---- 4. debris ejecta + embers ----
    const nDeb = Math.max(8, Math.round(26 * den));
    for (let i = 0; i < nDeb; i++) {
      this._basis(UP);
      this._cone(1.25, this._v1);
      const sp = this._rr(7, 22) * s;
      d = P.begin();
      d.px = p.x + this._n1() * R * 0.1;
      d.py = (grounded ? groundY + 0.05 : p.y);
      d.pz = p.z + this._n1() * R * 0.1;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp; d.vz = this._v1.z * sp;
      d.life = this._rr(1.1, 2.6);
      d.size0 = this._rr(0.012, 0.045) * s; d.size1 = d.size0;
      d.drag = 0.22; d.grav = 1;
      d.tile = TILE.CHIP; d.rot = r() * 6.283; d.rotVel = this._n1() * 14;
      d.fadeIn = 0.01;
      d.r0 = 0.40; d.g0 = 0.35; d.b0 = 0.30; d.a0 = 1;
      d.r1 = 0.34; d.g1 = 0.30; d.b1 = 0.26; d.a1 = 1;
      P.emit();
    }
    const nEmb = Math.max(5, Math.round(16 * den));
    for (let i = 0; i < nEmb; i++) {
      this._basis(UP);
      this._cone(1.5, this._v1);
      const sp = this._rr(5, 18) * s;
      d = P.begin();
      d.px = p.x; d.py = p.y; d.pz = p.z;
      d.vx = this._v1.x * sp; d.vy = this._v1.y * sp; d.vz = this._v1.z * sp;
      d.life = this._rr(0.7, 2.0);
      d.size0 = this._rr(0.008, 0.020); d.size1 = d.size0 * 0.4;
      d.len0 = this._rr(0.08, 0.28); d.len1 = 0.02;
      d.align = 1; d.add = 1; d.tile = TILE.SPARK;
      d.drag = 0.7; d.grav = 0.85;
      d.bright = this._rr(4, 9); d.fadeIn = 0.01;
      d.turb = 0.3; d.turbFreq = 3.0; d.seed = r() * 30;
      d.r0 = 1; d.g0 = 0.82; d.b0 = 0.42; d.a0 = 1;
      d.r1 = 1; d.g1 = 0.20; d.b1 = 0.03; d.a1 = 0;
      P.emit();
    }

    // ---- 5. lingering smoke column ----
    const nSmoke = Math.max(6, Math.round(14 * den));
    for (let i = 0; i < nSmoke; i++) {
      const f = i / nSmoke;
      d = P.begin();
      d.px = p.x + this._n1() * R * 0.22;
      d.py = p.y + f * R * 0.35;
      d.pz = p.z + this._n1() * R * 0.22;
      d.vx = this._n1() * 0.9; d.vy = this._rr(1.4, 3.6) * s; d.vz = this._n1() * 0.9;
      d.delay = 0.10 + f * this._rr(0.4, 0.9);
      d.life = this._rr(3.0, 6.0);
      d.size0 = R * this._rr(0.16, 0.26);
      d.size1 = R * this._rr(0.55, 0.95);
      d.drag = 0.85; d.grav = -0.05;
      d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 0.5;
      d.soft = 1.1; d.fadeIn = 0.14; d.curve = 1.4; d.seed = r() * 30;
      d.turb = 0.34; d.turbFreq = 0.75;
      d.r0 = 0.16; d.g0 = 0.145; d.b0 = 0.14; d.a0 = 0.62;
      d.r1 = 0.40; d.g1 = 0.39; d.b1 = 0.40; d.a1 = 0;
      P.emit();
    }

    // ---- 6. light + shake ----
    this.lights.flash(p, 0xffc078, 900 * s * s, 0.13,
      { distance: R * 7, priority: 5, curve: 1.5 });

    if (o.shake !== false) {
      const cam = this.ctx.camera;
      const dx = p.x - cam.position.x, dy = p.y - cam.position.y, dz = p.z - cam.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const amt = Math.min(1.6, (R * 1.6) / Math.max(2.5, dist));
      this.screenShake(amt, 0.55 + R * 0.03, { freq: 15 + this.rnd() * 8 });
    }
  }

  // =========================================================================
  // SMOKE
  // =========================================================================

  /**
   * smoke(point, opts)
   * opts: { count, size, life, rise, color:[r,g,b] (sRGB 0..1), opacity,
   *         duration (>0 turns it into a continuous emitter), rate }
   */
  smoke(point, opts) {
    if (!this.enabled) return;
    const o = opts || EMPTY;
    if (o.duration > 0) {
      for (const e of this._emitters) {
        if (e.active) continue;
        e.active = true; e.t = 0; e.dur = o.duration;
        e.rate = o.rate || 14 * this.density;
        e.acc = 0;
        e.x = point.x; e.y = point.y; e.z = point.z;
        e.size = o.size || 0.55;
        const c = o.color || [0.30, 0.30, 0.32];
        e.r = c[0]; e.g = c[1]; e.b = c[2];
        e.up = o.rise != null ? o.rise : 1;
        return e;
      }
      return null;
    }
    const n = Math.max(1, Math.round((o.count || 8) * this.density));
    this._smokePuff(point, o.size || 0.4, o.life || 3.0,
      o.opacity != null ? o.opacity : 0.42, n, o.color, o.rise);
  }

  _smokePuff(p, size, life, opacity, count, color, rise) {
    const P = this.particles, r = this.rnd;
    const c = color || SMOKE_COL;
    const up = rise != null ? rise : 1;
    const n = Math.max(1, count | 0);
    for (let i = 0; i < n; i++) {
      const d = P.begin();
      d.px = p.x + this._n1() * size * 0.45;
      d.py = p.y + this.rnd() * size * 0.35;
      d.pz = p.z + this._n1() * size * 0.45;
      d.vx = this._n1() * 0.45; d.vy = this._rr(0.3, 1.2) * up; d.vz = this._n1() * 0.45;
      d.life = life * this._rr(0.7, 1.3);
      d.size0 = size * this._rr(0.4, 0.7);
      d.size1 = size * this._rr(1.8, 3.0);
      d.drag = 0.85; d.grav = -0.03;
      d.tile = TILE.SMOKE; d.frames = TILE.SMOKE_FRAMES;
      d.rot = r() * 6.283; d.rotVel = this._n1() * 0.45;
      d.soft = 0.9; d.fadeIn = 0.16; d.curve = 1.6; d.seed = r() * 30;
      d.turb = 0.24; d.turbFreq = 0.9;
      d.r0 = c[0]; d.g0 = c[1]; d.b0 = c[2]; d.a0 = opacity;
      d.r1 = c[0] * 1.35; d.g1 = c[1] * 1.35; d.b1 = c[2] * 1.35; d.a1 = 0;
      P.emit();
    }
  }

  // =========================================================================
  // misc
  // =========================================================================

  clear() {
    this.particles.clear();
    this.decals.clear();
    this.shells.clear();
    this.lights.clear();
    for (const t of this._tasks) t.active = false;
    for (const e of this._emitters) e.active = false;
    for (const c of this._channels) { c.dur = 0; c.amp = 0; }
    this.shakeOffset.set(0, 0, 0);
    this.shakeRotation.set(0, 0, 0);
    this.shakeAmount = 0;
  }
}

const EMPTY = Object.freeze({});
const IMPACT_DECAL = Object.freeze({ minDot: 0.1 });
const UP = Object.freeze({ x: 0, y: 1, z: 0 });
const TRACER_COL = [1.0, 0.72, 0.34];
const SMOKE_COL = [0.30, 0.30, 0.32];
