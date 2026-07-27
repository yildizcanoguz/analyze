// ---------------------------------------------------------------------------
// fx/shells.js — ejected brass, simulated by ctx.physics.  Owner: `fx`.
//
// Every casing is a real capsule rigid body (ctx.physics.addBody) so it tumbles,
// bounces off stairs and rolls to a stop. Rendering is one InstancedMesh, so the
// whole floor's worth of brass costs a single draw call. Landing fires the
// `shell_<surface>` audio event.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

const CASING = {
  rifle: { r: 0.0049, len: 0.045, mass: 0.012, color: 0xb8873d },
  pistol: { r: 0.0048, len: 0.019, mass: 0.006, color: 0xb8873d },
  shotgun: { r: 0.0093, len: 0.060, mass: 0.021, color: 0x7a2a24 },
};

export default class ShellSystem {
  constructor(ctx, scene, opts = {}) {
    this.ctx = ctx;
    this.scene = scene;
    this.capacity = opts.capacity || 24;
    this.shells = [];
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._zero = new THREE.Vector3(0, 0, 0);

    // tapered brass case: body + slight neck + rim
    const geo = new THREE.CylinderGeometry(0.0036, 0.0049, 0.045, 9, 3, false);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      // squeeze the neck, flare the extractor groove near the base
      const t = (y + 0.0225) / 0.045;
      let k = 1;
      if (t > 0.82) k = 0.80 + 0.20 * (1 - (t - 0.82) / 0.18);
      else if (t < 0.10) k = 1.06;
      else if (t < 0.18) k = 0.90;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    this.geometry = geo;

    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(CASING.rifle.color),
      metalness: 1.0,
      roughness: 0.26,
      envMapIntensity: 1.25,
    });
    if (ctx.materials?.env) this.material.envMap = ctx.materials.env;

    this.mesh = new THREE.InstancedMesh(geo, this.material, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'fx.shells';
    this.mesh.userData.collision = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /**
   * eject(pos, dir, opts)
   * dir  — ejection direction (right + slightly up + back is typical)
   * opts — { kind:'rifle'|'pistol'|'shotgun', speed, spin, life }
   */
  eject(pos, dir, opts = {}) {
    const phys = this.ctx.physics;
    const spec = CASING[opts.kind] || CASING.rifle;
    const rnd = Math.random;

    if (this.shells.length >= this.capacity) {
      const old = this.shells.shift();
      if (old.body) old.body.remove();
    }

    const speed = (opts.speed != null ? opts.speed : 2.6) * (0.78 + rnd() * 0.45);
    const vx = dir.x * speed + (rnd() - 0.5) * 0.55;
    const vy = dir.y * speed + 0.9 + rnd() * 0.7;
    const vz = dir.z * speed + (rnd() - 0.5) * 0.55;
    const spin = opts.spin != null ? opts.spin : 34;

    const rec = {
      pos: new THREE.Vector3(pos.x, pos.y, pos.z),
      quat: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28)),
      vel: new THREE.Vector3(vx, vy, vz),
      spin: new THREE.Vector3((rnd() - 0.5) * spin, (rnd() - 0.5) * spin * 0.4, (rnd() - 0.5) * spin),
      age: 0,
      life: opts.life != null ? opts.life : 12,
      body: null,
      scale: spec.len / 0.045,
      radial: spec.r / 0.0049,
      landed: false,
    };

    if (phys && phys.addBody) {
      rec.body = phys.addBody({
        shape: 'capsule',
        radius: spec.r,
        height: spec.len,
        mass: spec.mass,
        position: rec.pos,
        quaternion: rec.quat,
        velocity: rec.vel,
        angularVelocity: rec.spin,
        restitution: 0.34,
        friction: 0.44,
        linearDamping: 0.02,
        angularDamping: 0.06,
        ttl: rec.life,
        ccd: true,
        userData: { fxShell: true },
        onCollide: (info) => this._onLand(rec, info),
      });
    }
    this.shells.push(rec);
    return rec;
  }

  _onLand(rec, info) {
    if (rec.landed && info.impulse < 0.02) return;
    rec.landed = true;
    const audio = this.ctx.audio;
    if (!audio || !audio.play3d) return;
    const s = info.surface || 'concrete';
    const soft = s === 'dirt' || s === 'sand' || s === 'gravel' || s === 'foliage' || s === 'fabric';
    const vol = Math.min(1, 0.25 + info.impulse * 6);
    try {
      audio.play3d(soft ? 'shell_dirt' : 'shell_concrete', info.point,
        { volume: vol, pitch: 0.86 + Math.random() * 0.3 });
    } catch { /* audio not ready */ }
  }

  update(dt) {
    const list = this.shells;
    const m4 = this._m4, q = this._q, v = this._v, s = this._s;
    let n = 0;
    for (let i = 0; i < list.length;) {
      const r = list[i];
      r.age += dt;
      if (r.body && r.body.alive) {
        v.copy(r.body.position);
        q.copy(r.body.quaternion);
      } else if (r.body) {
        // physics retired it
        list.splice(i, 1);
        continue;
      } else {
        // no physics system: cheap ballistic fallback
        r.vel.y -= 18 * dt;
        r.pos.addScaledVector(r.vel, dt);
        if (r.pos.y < 0.01) { r.pos.y = 0.01; r.vel.y *= -0.35; r.vel.x *= 0.7; r.vel.z *= 0.7; }
        v.copy(r.pos);
        q.copy(r.quat);
      }
      if (r.age > r.life) {
        if (r.body) r.body.remove();
        list.splice(i, 1);
        continue;
      }
      const fade = r.age > r.life - 1 ? Math.max(0, r.life - r.age) : 1;
      s.set(r.radial * fade, r.scale * fade, r.radial * fade);
      m4.compose(v, q, s);
      this.mesh.setMatrixAt(n, m4);
      n++; i++;
    }
    this.mesh.count = n;
    if (n > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const r of this.shells) if (r.body) r.body.remove();
    this.shells.length = 0;
    this.mesh.count = 0;
  }

  dispose() {
    this.clear();
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
