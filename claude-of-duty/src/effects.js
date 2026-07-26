// Transient visuals: tracers, impact sparks, blood puffs, bullet holes,
// flash lights and camera shake. All meshes are generated primitives.

import * as THREE from "three";

const MAX_HOLES = 70;

export class Effects {
  constructor(scene, tex) {
    this.scene = scene;
    this.tex = tex;
    this.tracers = [];   // { line, mat, t, life }
    this.bursts = [];    // { points, mat, pos, vel, t, life, gravity }
    this.flashes = [];   // { light, t, life, peak }
    this.holes = [];
    this.shakeT = 0;
    this.shakeStrength = 0;

    this.holeMat = new THREE.MeshBasicMaterial({ color: 0x0c0c0c, transparent: true, opacity: 0.85 });
    this.holeGeo = new THREE.CircleGeometry(0.055, 8);
  }

  tracer(from, to, color = 0xffd98a, life = 0.055) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, mat, t: 0, life });
  }

  burst(pos, normal, { color = 0xffc37a, count = 10, speed = 3.2, gravity = 7, life = 0.42, size = 0.09 } = {}) {
    const positions = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      );
      dir.addScaledVector(normal, 1.4).normalize();
      vel.push(dir.multiplyScalar(speed * (0.35 + Math.random() * 0.9)));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size, map: this.tex.particle, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, mat, vel, t: 0, life, gravity });
  }

  bloodPuff(pos) {
    this.burst(pos, new THREE.Vector3(0, 1, 0), {
      color: 0xa01818, count: 14, speed: 2.4, gravity: 9, life: 0.5, size: 0.12,
    });
  }

  sparks(pos, normal) {
    this.burst(pos, normal, { color: 0xffd27a, count: 8, speed: 4, gravity: 8, life: 0.32, size: 0.07 });
    this.burst(pos, normal, { color: 0x9a9a9a, count: 5, speed: 1.6, gravity: 3, life: 0.5, size: 0.1 });
  }

  bulletHole(pos, normal) {
    const hole = new THREE.Mesh(this.holeGeo, this.holeMat);
    hole.position.copy(pos).addScaledVector(normal, 0.012);
    hole.lookAt(pos.clone().add(normal));
    this.scene.add(hole);
    this.holes.push(hole);
    if (this.holes.length > MAX_HOLES) {
      const old = this.holes.shift();
      this.scene.remove(old);
    }
  }

  flashLight(pos, { color = 0xffb060, intensity = 26, life = 0.06, distance = 14 } = {}) {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.copy(pos);
    this.scene.add(light);
    this.flashes.push({ light, t: 0, life, peak: intensity });
  }

  shake(strength) {
    this.shakeStrength = Math.min(0.09, this.shakeStrength + strength);
    this.shakeT = 0.25;
  }

  // Called by main after the camera is positioned for the frame.
  applyShake(camera, dt) {
    if (this.shakeT <= 0) return;
    this.shakeT -= dt;
    const k = Math.max(0, this.shakeT / 0.25) * this.shakeStrength;
    camera.position.x += (Math.random() - 0.5) * k;
    camera.position.y += (Math.random() - 0.5) * k;
    camera.rotation.z += (Math.random() - 0.5) * k * 0.6;
    if (this.shakeT <= 0) this.shakeStrength = 0;
  }

  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      tr.mat.opacity = Math.max(0, 0.9 * (1 - tr.t / tr.life));
      if (tr.t >= tr.life) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        tr.mat.dispose();
        this.tracers.splice(i, 1);
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      const attr = b.points.geometry.getAttribute("position");
      for (let j = 0; j < b.vel.length; j++) {
        b.vel[j].y -= b.gravity * dt;
        attr.array[j * 3] += b.vel[j].x * dt;
        attr.array[j * 3 + 1] += b.vel[j].y * dt;
        attr.array[j * 3 + 2] += b.vel[j].z * dt;
      }
      attr.needsUpdate = true;
      b.mat.opacity = Math.max(0, 1 - b.t / b.life);
      if (b.t >= b.life) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        b.mat.dispose();
        this.bursts.splice(i, 1);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      f.light.intensity = f.peak * Math.max(0, 1 - f.t / f.life);
      if (f.t >= f.life) {
        this.scene.remove(f.light);
        this.flashes.splice(i, 1);
      }
    }
  }

  clear() {
    for (const tr of this.tracers) { this.scene.remove(tr.line); tr.line.geometry.dispose(); tr.mat.dispose(); }
    for (const b of this.bursts) { this.scene.remove(b.points); b.points.geometry.dispose(); b.mat.dispose(); }
    for (const f of this.flashes) this.scene.remove(f.light);
    for (const h of this.holes) this.scene.remove(h);
    this.tracers = [];
    this.bursts = [];
    this.flashes = [];
    this.holes = [];
    this.shakeT = 0;
    this.shakeStrength = 0;
  }
}
