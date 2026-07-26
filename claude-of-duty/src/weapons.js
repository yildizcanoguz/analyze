// Weapon systems: three procedurally-modelled guns, hitscan ballistics with
// spread/recoil/falloff, ADS zoom, reloads and muzzle flashes.

import * as THREE from "three";
import { CONFIG } from "./config.js";

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _muzzleWorld = new THREE.Vector3();
const _n = new THREE.Vector3();

const GUNMETAL = 0x2b2e33;
const POLYMER = 0x1c1e22;
const TAN = 0x6b5f47;

function mat(color, rough = 0.55, metal = 0.6) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function box(parent, w, h, d, x, y, z, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function cyl(parent, r1, r2, len, x, y, z, material, rotX = Math.PI / 2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 10), material);
  m.rotation.x = rotX;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Gun local space: -Z is downrange (matches the camera).
function buildRifleModel() {
  const g = new THREE.Group();
  const steel = mat(GUNMETAL);
  const poly = mat(POLYMER, 0.75, 0.2);
  const tan = mat(TAN, 0.8, 0.1);
  box(g, 0.055, 0.085, 0.42, 0, 0, -0.02, steel);            // receiver
  box(g, 0.05, 0.06, 0.3, 0, -0.005, -0.36, tan);            // handguard
  cyl(g, 0.016, 0.016, 0.34, 0, 0.008, -0.62, steel);        // barrel
  box(g, 0.03, 0.05, 0.07, 0, -0.09, 0.09, poly);            // grip
  const magazine = box(g, 0.04, 0.16, 0.09, 0, -0.12, -0.09, poly);
  magazine.rotation.x = 0.22;
  box(g, 0.045, 0.07, 0.22, 0, -0.01, 0.25, poly);           // stock
  box(g, 0.012, 0.035, 0.012, 0, 0.062, -0.5, steel);        // front post
  box(g, 0.03, 0.035, 0.06, 0, 0.062, 0.05, steel);          // rear sight block
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.008, -0.8);
  g.add(muzzle);
  return { model: g, muzzle };
}

function buildPistolModel() {
  const g = new THREE.Group();
  const steel = mat(0x35393f);
  const poly = mat(POLYMER, 0.75, 0.2);
  box(g, 0.045, 0.06, 0.24, 0, 0.02, -0.06, steel);          // slide
  cyl(g, 0.012, 0.012, 0.06, 0, 0.02, -0.2, steel);          // barrel tip
  const grip = box(g, 0.04, 0.11, 0.06, 0, -0.055, 0.03, poly);
  grip.rotation.x = 0.18;
  box(g, 0.01, 0.02, 0.01, 0, 0.062, -0.16, steel);          // front sight
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.24);
  g.add(muzzle);
  return { model: g, muzzle };
}

function buildShotgunModel() {
  const g = new THREE.Group();
  const steel = mat(0x26292d);
  const wood = mat(0x4a3626, 0.7, 0.05);
  box(g, 0.06, 0.09, 0.34, 0, 0, 0.02, steel);               // receiver
  cyl(g, 0.02, 0.02, 0.5, 0, 0.02, -0.42, steel);            // barrel
  cyl(g, 0.016, 0.016, 0.42, 0, -0.025, -0.38, steel);       // tube mag
  box(g, 0.05, 0.05, 0.16, 0, -0.025, -0.44, wood);          // pump
  box(g, 0.05, 0.08, 0.26, 0, -0.02, 0.28, wood);            // stock
  box(g, 0.012, 0.03, 0.012, 0, 0.07, -0.64, steel);         // bead
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.68);
  g.add(muzzle);
  return { model: g, muzzle };
}

const WEAPON_DEFS = [
  {
    id: "vandal", name: "CF-5 VANDAL", kind: "rifle", auto: true,
    rpm: 720, damage: 24, mag: 30, reserve: 150, reloadTime: 1.7,
    spread: 0.010, moveSpread: 0.02, heatPerShot: 0.0035, heatMax: 0.018,
    recoil: 0.012, pellets: 1,
    falloff: { start: 30, end: 85, min: 0.6 },
    adsFov: CONFIG.render.adsFov, tracer: 0xffd98a,
    build: buildRifleModel,
    hip: [0.26, -0.225, -0.46], ads: [0, -0.148, -0.34],
  },
  {
    id: "scribe", name: "P-9 SCRIBE", kind: "pistol", auto: false,
    rpm: 400, damage: 32, mag: 12, reserve: 72, reloadTime: 1.25,
    spread: 0.008, moveSpread: 0.014, heatPerShot: 0.004, heatMax: 0.014,
    recoil: 0.016, pellets: 1,
    falloff: { start: 18, end: 50, min: 0.5 },
    adsFov: 62, tracer: 0xaad4ff,
    build: buildPistolModel,
    hip: [0.24, -0.21, -0.42], ads: [0, -0.155, -0.32],
  },
  {
    id: "breacher", name: "M77 BREACHER", kind: "shotgun", auto: false,
    rpm: 72, damage: 12, mag: 6, reserve: 36, reloadTime: 2.3,
    spread: 0.042, moveSpread: 0.012, heatPerShot: 0, heatMax: 0,
    recoil: 0.05, pellets: 8,
    falloff: { start: 8, end: 26, min: 0.15 },
    adsFov: 66, tracer: 0xffb37a,
    build: buildShotgunModel,
    hip: [0.25, -0.23, -0.5], ads: [0, -0.16, -0.4],
  },
];

export class WeaponSystem {
  constructor(G) {
    this.G = G;
    this.slots = WEAPON_DEFS.map((def) => {
      const { model, muzzle } = def.build();
      model.visible = false;
      model.traverse((o) => { o.frustumCulled = false; });
      G.camera.add(model);

      // muzzle flash sprite
      const flashMat = new THREE.SpriteMaterial({
        map: G.tex.muzzle, blending: THREE.AdditiveBlending,
        depthWrite: false, depthTest: false, opacity: 0.95,
      });
      const flash = new THREE.Sprite(flashMat);
      flash.scale.setScalar(0.16);
      flash.position.copy(muzzle.position);
      flash.visible = false;
      model.add(flash);

      return { def, model, muzzle, flash, mag: def.mag, reserve: def.reserve };
    });

    this.index = 0;
    this.triggerHeld = false;
    this.semiQueued = false;
    this.ads = false;
    this.adsK = 0;
    this.fireT = 0;
    this.reloadT = 0;
    this.switchT = 0;
    this.heat = 0;
    this.kick = 0;
    this.bobT = 0;
    this.flashT = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;

    this.slots[0].model.visible = true;
    this.syncHud();
  }

  get current() { return this.slots[this.index]; }

  syncHud() {
    const s = this.current;
    this.G.hud.setAmmo(s.mag, s.reserve, s.def.name);
    this.G.hud.setSlots(this.slots.map((w) => w.def.name.split(" ").pop()), this.index);
  }

  switchTo(i) {
    if (i === this.index || i < 0 || i >= this.slots.length) return;
    if (this.reloadT > 0) { this.reloadT = 0; this.G.hud.showReload(false); }
    this.current.model.visible = false;
    this.index = i;
    this.current.model.visible = true;
    this.switchT = 0.28;
    this.heat = 0;
    this.G.audio.weaponSwitch();
    this.syncHud();
  }

  cycle(dirn) {
    this.switchTo((this.index + dirn + this.slots.length) % this.slots.length);
  }

  reload() {
    const s = this.current;
    if (this.reloadT > 0 || this.switchT > 0) return;
    if (s.mag >= s.def.mag || s.reserve <= 0) return;
    this.reloadT = s.def.reloadTime;
    this.G.audio.reload(s.def.kind);
    this.G.hud.showReload(true);
  }

  refillReserves() {
    for (const s of this.slots) s.reserve = s.def.reserve;
    this.syncHud();
  }

  triggerDown() {
    this.triggerHeld = true;
    this.semiQueued = true;
  }

  triggerUp() {
    this.triggerHeld = false;
  }

  accuracy() {
    return this.shotsFired ? this.shotsHit / this.shotsFired : 0;
  }

  currentSpread() {
    const G = this.G;
    const def = this.current.def;
    let spread = def.spread + this.heat;
    const speed = G.player.horizontalSpeed;
    spread += def.moveSpread * Math.min(1, speed / 7);
    if (!G.player.onGround) spread += 0.02;
    if (G.player.crouching) spread *= 0.7;
    spread *= 1 - this.adsK * 0.65;
    return spread;
  }

  tryFire() {
    const G = this.G;
    const s = this.current;
    if (this.fireT > 0 || this.reloadT > 0 || this.switchT > 0) return;
    if (s.mag <= 0) {
      this.fireT = 0.25;
      G.audio.dryFire();
      if (s.reserve > 0) this.reload();
      return;
    }

    this.fireT = 60 / s.def.rpm;
    s.mag--;
    this.heat = Math.min(s.def.heatMax, this.heat + s.def.heatPerShot);
    this.kick = Math.min(0.09, this.kick + 0.035 + s.def.recoil * 0.8);
    this.flashT = 0.05;
    s.flash.visible = true;
    s.flash.material.rotation = Math.random() * Math.PI * 2;
    s.flash.scale.setScalar(0.13 + Math.random() * 0.08);

    G.audio.gunshot(s.def.kind);
    G.player.addRecoil(
      s.def.recoil * (1 - this.adsK * 0.3) * (0.8 + Math.random() * 0.4),
      (Math.random() - 0.5) * s.def.recoil * 0.5
    );

    s.muzzle.getWorldPosition(_muzzleWorld);
    G.effects.flashLight(_muzzleWorld, { intensity: 30, distance: 15, life: 0.05 });

    const spread = this.currentSpread();
    const targets = G.enemies.getTargets();
    const objects = targets.concat(G.world.solids);

    for (let p = 0; p < s.def.pellets; p++) {
      this.firePellet(objects, spread, s.def, _muzzleWorld);
    }
    this.syncHud();
    if (s.mag === 0 && s.reserve > 0) this.reload();
  }

  firePellet(objects, spread, def, muzzlePos) {
    const G = this.G;
    this.shotsFired++;

    G.camera.getWorldDirection(_dir);
    _dir.x += (Math.random() - 0.5) * 2 * spread;
    _dir.y += (Math.random() - 0.5) * 2 * spread;
    _dir.z += (Math.random() - 0.5) * 2 * spread;
    _dir.normalize();

    _ray.set(G.camera.position, _dir);
    _ray.far = 250;
    const hits = _ray.intersectObjects(objects, false);
    const hit = hits.length ? hits[0] : null;

    const end = hit
      ? hit.point.clone()
      : G.camera.position.clone().addScaledVector(_dir, 160);
    G.effects.tracer(muzzlePos, end, def.tracer);

    if (!hit) return;
    const dist = hit.distance;
    const ud = hit.object.userData;

    if (ud && ud.enemy) {
      this.shotsHit++;
      const f = def.falloff;
      const t = Math.max(0, Math.min(1, (dist - f.start) / (f.end - f.start)));
      const dmg = def.damage * (1 - t * (1 - f.min));
      const isHead = ud.part === "head";
      const res = ud.enemy.takeHit(dmg, isHead, hit.point);
      G.hud.hitmarker(isHead && res.died);
      G.audio.hitmarker(isHead && res.died);
    } else {
      if (hit.face) {
        _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      } else {
        _n.set(0, 1, 0);
      }
      G.effects.sparks(hit.point, _n);
      G.effects.bulletHole(hit.point, _n);
      G.audio.impact(dist);
    }
  }

  setADS(on) {
    this.ads = on;
  }

  update(dt) {
    const G = this.G;
    const s = this.current;

    this.fireT -= dt;
    this.heat = Math.max(0, this.heat - dt * 0.02);
    this.kick = Math.max(0, this.kick - dt * 0.45);
    if (this.switchT > 0) this.switchT -= dt;

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) s.flash.visible = false;
    }

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = s.def.mag - s.mag;
        const take = Math.min(need, s.reserve);
        s.mag += take;
        s.reserve -= take;
        this.G.hud.showReload(false);
        this.syncHud();
      }
    }

    // fire input
    if (s.def.auto) {
      if (this.triggerHeld) this.tryFire();
    } else if (this.semiQueued) {
      this.semiQueued = false;
      this.tryFire();
    }

    // ADS blend + FOV
    const adsTarget = this.ads && this.reloadT <= 0 && this.switchT <= 0 ? 1 : 0;
    this.adsK += (adsTarget - this.adsK) * Math.min(1, dt * 11);
    const targetFov = CONFIG.render.fov + (s.def.adsFov - CONFIG.render.fov) * this.adsK;
    if (Math.abs(G.camera.fov - targetFov) > 0.01) {
      G.camera.fov = targetFov;
      G.camera.updateProjectionMatrix();
    }

    // viewmodel placement: hip <-> ads, bob, kick, switch dip
    const speed = G.player.horizontalSpeed;
    const moveK = Math.min(1, speed / 5) * (G.player.onGround ? 1 : 0.25);
    this.bobT += dt * (3.5 + speed * 1.1);
    const bobX = Math.cos(this.bobT) * 0.006 * moveK * (1 - this.adsK * 0.9);
    const bobY = Math.abs(Math.sin(this.bobT)) * 0.008 * moveK * (1 - this.adsK * 0.9);

    const hip = s.def.hip, ads = s.def.ads;
    const dip = this.switchT > 0 ? Math.min(1, this.switchT / 0.28) * 0.18 : 0;
    const reloadDip = this.reloadT > 0
      ? Math.sin(Math.min(1, 1 - this.reloadT / s.def.reloadTime) * Math.PI) * 0.09
      : 0;

    s.model.position.set(
      hip[0] + (ads[0] - hip[0]) * this.adsK + bobX,
      hip[1] + (ads[1] - hip[1]) * this.adsK + bobY - dip - reloadDip,
      hip[2] + (ads[2] - hip[2]) * this.adsK + this.kick * 0.7
    );
    s.model.rotation.set(
      this.kick * 1.6 + reloadDip * 2.2,
      0,
      bobX * 1.5,
    );

    // crosshair feedback
    G.hud.setSpread(this.currentSpread() * 1400 + 6);
    G.hud.setCrosshairVisible(this.adsK < 0.6);
  }

  reset() {
    for (const s of this.slots) {
      s.mag = s.def.mag;
      s.reserve = s.def.reserve;
    }
    this.heat = 0;
    this.kick = 0;
    this.reloadT = 0;
    this.switchT = 0;
    this.fireT = 0;
    this.triggerHeld = false;
    this.semiQueued = false;
    this.ads = false;
    this.adsK = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.G.hud.showReload(false);
    this.current.model.visible = false;
    this.index = 0;
    this.current.model.visible = true;
    this.syncHud();
  }
}
