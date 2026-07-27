// ---------------------------------------------------------------------------
// fx/lights.js — pooled transient point lights.  Owner: `fx`.
//
// The pool is allocated once at init and NEVER grows or shrinks: adding or
// removing a light from a three.js scene invalidates every material program in
// it, which would stutter on every shot. Unused lights sit at intensity 0.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

export default class LightPool {
  constructor(scene, count, opts = {}) {
    this.scene = scene;
    this.lights = [];
    this.slots = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, opts.distance || 14, 2);
      l.castShadow = false;
      l.visible = true;
      l.name = `fx.light${i}`;
      l.userData.collision = false;
      scene.add(l);
      this.lights.push(l);
      this.slots.push({ t: 0, dur: 0, peak: 0, priority: -1, curve: 1 });
    }
  }

  /**
   * flash(pos, color, intensity, duration, opts)
   * opts: { distance, decay:'expo'|'linear', priority }
   */
  flash(pos, color, intensity, duration, opts = {}) {
    if (!this.lights.length) return null;
    // pick a free slot, else the weakest currently-running one
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const remaining = s.dur > 0 ? (1 - s.t / s.dur) * s.peak : -1;
      if (remaining < bestScore) { bestScore = remaining; best = i; }
    }
    if (best < 0) return null;
    const pr = opts.priority || 0;
    if (bestScore > 0 && this.slots[best].priority > pr && this.slots[best].t < this.slots[best].dur) {
      return null;
    }
    const l = this.lights[best], s = this.slots[best];
    l.position.set(pos.x, pos.y, pos.z);
    l.color.set(color);
    l.distance = opts.distance || 14;
    l.intensity = intensity;
    s.t = 0; s.dur = duration; s.peak = intensity; s.priority = pr;
    s.curve = opts.curve != null ? opts.curve : 2.2;
    return l;
  }

  update(dt) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.dur <= 0) continue;
      s.t += dt;
      if (s.t >= s.dur) {
        s.dur = 0; s.peak = 0; s.priority = -1;
        this.lights[i].intensity = 0;
      } else {
        const u = s.t / s.dur;
        this.lights[i].intensity = s.peak * Math.pow(1 - u, s.curve);
      }
    }
  }

  clear() {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i].dur = 0; this.slots[i].peak = 0;
      this.lights[i].intensity = 0;
    }
  }

  dispose() {
    for (const l of this.lights) this.scene.remove(l);
    this.lights.length = 0;
  }
}
