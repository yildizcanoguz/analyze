// Hostile infantry: procedurally-built humanoids with a small state machine
// (advance -> flank -> attack), raycast line-of-sight checks, burst fire,
// walk cycles and death animations — all animated in code.

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { resolveCircle, clampToArena } from "./physics.js";
import { mulberry32 } from "./textures.js";

const CALLSIGNS = ["VIPER", "JACKAL", "REAPER", "GHOST", "HAVOC", "RAZOR", "TALON", "HYENA", "COBRA", "DINGO", "SABLE", "MANTIS"];

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ray = new THREE.Raycaster();

let enemySeq = 0;

class Enemy {
  constructor(G, spawnPos, wave) {
    this.G = G;
    this.id = ++enemySeq;
    this.name = `${CALLSIGNS[this.id % CALLSIGNS.length]}-${(this.id % 89) + 10}`;
    this.rng = mulberry32((this.id * 7919 + wave * 104729) >>> 0);

    const E = CONFIG.enemy;
    this.health = E.baseHealth + E.healthPerWave * (wave - 1);
    this.speed = E.speedMin + this.rng() * (E.speedMax - E.speedMin);
    this.attackRange = E.attackRangeMin + this.rng() * (E.attackRangeMax - E.attackRangeMin);
    this.damage = E.baseDamage + E.damagePerWave * (wave - 1);
    this.accuracy = E.baseAccuracy + Math.min(0.15, wave * 0.012);
    this.radius = 0.42;

    this.state = "chase";
    this.dead = false;
    this.deathT = 0;
    this.animT = this.rng() * 10;
    this.flashT = 0;
    this.losT = this.rng() * 0.2;
    this.hasLOS = false;
    this.strafeT = 0;
    this.strafeSign = 1;
    this.aimK = 0;
    this.burstLeft = 0;
    this.shotT = 0;
    this.cooldown = 0.6 + this.rng() * 1.2;

    this.buildBody();
    this.group.position.copy(spawnPos);
    G.scene.add(this.group);
  }

  buildBody() {
    const tex = this.G.tex;
    const camo = this.rng() < 0.5 ? tex.camoA : tex.camoB;
    const cloth = new THREE.MeshStandardMaterial({ map: camo, roughness: 0.92 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.8 });
    const gear = new THREE.MeshStandardMaterial({ color: 0x23251f, roughness: 0.85 });
    this.materials = [cloth, skin, gear];

    this.group = new THREE.Group();
    this.hittables = [];

    const mesh = (geo, mat, part, x, y, z, parent = this.group) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      if (part) {
        m.userData = { enemy: this, part };
        this.hittables.push(m);
      }
      parent.add(m);
      return m;
    };

    // torso + vest
    this.torso = mesh(new THREE.BoxGeometry(0.62, 0.78, 0.36), cloth, "body", 0, 1.16, 0);
    mesh(new THREE.BoxGeometry(0.66, 0.5, 0.42), gear, "body", 0, 1.22, 0);

    // head + helmet + glowing visor (so hostiles read at night)
    this.head = mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), skin, "head", 0, 1.74, 0);
    mesh(new THREE.BoxGeometry(0.36, 0.15, 0.36), cloth, "head", 0, 1.9, 0);
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x220a0a, emissive: 0xff3a2a, emissiveIntensity: 1.6, roughness: 0.4,
    });
    this.materials.push(visorMat);
    mesh(new THREE.BoxGeometry(0.26, 0.06, 0.05), visorMat, "head", 0, 1.78, 0.15);

    // legs (pivot groups at the hip so they can swing)
    this.legL = new THREE.Group(); this.legL.position.set(-0.16, 0.76, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.16, 0.76, 0);
    mesh(new THREE.BoxGeometry(0.22, 0.74, 0.26), cloth, "body", 0, -0.38, 0, this.legL);
    mesh(new THREE.BoxGeometry(0.22, 0.74, 0.26), cloth, "body", 0, -0.38, 0, this.legR);
    this.group.add(this.legL, this.legR);

    // arms (pivot at shoulder)
    this.armL = new THREE.Group(); this.armL.position.set(-0.4, 1.46, 0);
    this.armR = new THREE.Group(); this.armR.position.set(0.4, 1.46, 0);
    mesh(new THREE.BoxGeometry(0.17, 0.6, 0.19), cloth, "body", 0, -0.26, 0, this.armL);
    mesh(new THREE.BoxGeometry(0.17, 0.6, 0.19), cloth, "body", 0, -0.26, 0, this.armR);
    this.group.add(this.armL, this.armR);

    // rifle in the right hand, pointing along +Z (enemy forward)
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.62), gear);
    gun.position.set(-0.06, -0.5, 0.22);
    gun.castShadow = true;
    this.armR.add(gun);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0, 0.34);
    gun.add(this.muzzle);
  }

  eyePos(out) {
    return out.set(this.group.position.x, this.group.position.y + 1.74, this.group.position.z);
  }

  checkLOS(playerEye) {
    this.eyePos(_v1);
    _v2.copy(playerEye).sub(_v1);
    const dist = _v2.length();
    _ray.set(_v1, _v2.normalize());
    _ray.far = Math.max(0.1, dist - 0.6);
    const hits = _ray.intersectObjects(this.G.world.solids, false);
    return hits.length === 0;
  }

  update(dt, playerEye) {
    const G = this.G;

    if (this.dead) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.38);
      this.group.rotation.x = -k * (Math.PI / 2) * 0.96;
      if (this.deathT > 1.4) this.group.position.y -= dt * 0.7;
      return this.deathT < 2.6;
    }

    // hit flash decay
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt * 5);
      const k = this.flashT;
      for (const m of this.materials) m.emissive.setRGB(k, k * 0.85, k * 0.7);
    }

    const pos = this.group.position;
    const dx = playerEye.x - pos.x;
    const dz = playerEye.z - pos.z;
    const dist = Math.hypot(dx, dz);

    // face the player
    this.group.rotation.y = Math.atan2(dx, dz);

    // throttled line-of-sight probe
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.14 + this.rng() * 0.1;
      this.hasLOS = this.checkLOS(playerEye);
    }

    const attacking = dist <= this.attackRange && this.hasLOS;
    this.state = attacking ? "attack" : "chase";
    this.aimK += ((attacking ? 1 : 0) - this.aimK) * Math.min(1, dt * 8);

    let moveX = 0, moveZ = 0;
    if (!attacking) {
      // advance, sidestepping when the direct route is blocked
      let dirX = dx / (dist || 1);
      let dirZ = dz / (dist || 1);
      if (this.strafeT > 0) {
        this.strafeT -= dt;
        const px = -dirZ * this.strafeSign;
        const pz = dirX * this.strafeSign;
        dirX = dirX * 0.35 + px * 0.65;
        dirZ = dirZ * 0.35 + pz * 0.65;
      }
      moveX = dirX * this.speed * dt;
      moveZ = dirZ * this.speed * dt;
      const beforeX = pos.x, beforeZ = pos.z;
      pos.x += moveX;
      pos.z += moveZ;
      const blocked = resolveCircle(G.world.colliders, pos, this.radius, 0);
      clampToArena(pos, G.world.arenaHalf, 1.2);
      const movedSq = (pos.x - beforeX) ** 2 + (pos.z - beforeZ) ** 2;
      const wantSq = moveX * moveX + moveZ * moveZ;
      if (blocked && this.strafeT <= 0 && movedSq < wantSq * 0.2) {
        this.strafeT = 0.5 + this.rng() * 0.8;
        this.strafeSign = this.rng() < 0.5 ? -1 : 1;
      }
      this.animT += dt * this.speed * 2.7;
    } else {
      this.animT += dt * 1.4; // idle sway while shooting
      this.updateFire(dt, playerEye, dist);
    }

    // walk cycle
    const swing = Math.sin(this.animT) * (attacking ? 0.06 : 0.55);
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.7;
    // right arm raises the rifle when attacking
    this.armR.rotation.x = (swing * 0.7) * (1 - this.aimK) + (-Math.PI / 2 + 0.12) * this.aimK;

    return true;
  }

  updateFire(dt, playerEye, dist) {
    const G = this.G;
    this.shotT -= dt;
    if (this.burstLeft > 0) {
      if (this.shotT <= 0) {
        this.burstLeft--;
        this.shotT = 0.085 + this.rng() * 0.05;
        this.fireOne(playerEye, dist);
      }
    } else {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.burstLeft = 3 + Math.floor(this.rng() * 3);
        this.cooldown = 1.0 + this.rng() * 1.4;
      }
    }
  }

  fireOne(playerEye, dist) {
    const G = this.G;
    this.muzzle.getWorldPosition(_v1);
    G.audio.gunshot("enemy", dist);
    G.effects.flashLight(_v1, { intensity: 14, distance: 9, life: 0.05 });

    const player = G.player;
    let acc = this.accuracy * Math.max(0.35, Math.min(1.5, 1.55 - dist / 26));
    if (player.isSprinting || !player.onGround) acc *= 0.65;
    if (player.crouching) acc *= 0.8;
    const hit = this.rng() < Math.max(0.06, Math.min(0.6, acc));

    if (hit) {
      _v2.copy(playerEye);
      _v2.x += (this.rng() - 0.5) * 0.3;
      _v2.y += (this.rng() - 0.5) * 0.3;
      _v2.z += (this.rng() - 0.5) * 0.3;
      G.effects.tracer(_v1, _v2, 0xff9a5a);
      player.takeDamage(this.damage, this.group.position);
    } else {
      // A near miss: shoot at a point offset from the player, then find
      // where that ray lands so the impact reads as real.
      const target = _v2.copy(playerEye);
      target.x += (this.rng() - 0.5) * 3.2;
      target.y += (this.rng() - 0.4) * 2.2;
      target.z += (this.rng() - 0.5) * 3.2;
      const dir = target.sub(_v1).normalize();
      _ray.set(_v1, dir);
      _ray.far = 120;
      const hits = _ray.intersectObjects(G.world.solids, false);
      const end = hits.length
        ? hits[0].point
        : target.copy(_v1).addScaledVector(dir, 60);
      G.effects.tracer(_v1, end, 0xff9a5a);
      if (hits.length) {
        const n = hits[0].face
          ? hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld)
          : new THREE.Vector3(0, 1, 0);
        G.effects.sparks(hits[0].point, n);
        G.audio.impact(hits[0].point.distanceTo(playerEye));
      }
    }
  }

  takeHit(dmg, isHead, hitPoint) {
    if (this.dead) return { died: false, headshot: false };
    this.health -= dmg * (isHead ? 2 : 1);
    this.flashT = 1;
    this.G.effects.bloodPuff(hitPoint);
    if (this.health <= 0) {
      this.die(isHead);
      return { died: true, headshot: isHead };
    }
    return { died: false, headshot: isHead };
  }

  die(byHeadshot) {
    this.dead = true;
    this.state = "dead";
    const G = this.G;
    const dist = this.group.position.distanceTo(G.camera.position);
    G.audio.enemyDie(dist);
    // stop being a raycast target
    for (const m of this.hittables) m.userData = {};
    this.hittables.length = 0;
    G.onEnemyKilled(this, byHeadshot);
  }

  dispose() {
    this.G.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}

export class EnemyManager {
  constructor(G) {
    this.G = G;
    this.enemies = [];
    this.spawnQueue = 0;
    this.spawnT = 0;
    this.wave = 0;
  }

  startWave(n) {
    this.wave = n;
    this.spawnQueue = CONFIG.waves.baseEnemies + CONFIG.waves.perWave * (n - 1);
    this.spawnT = 0.3;
    this.total = this.spawnQueue;
  }

  aliveCount() {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  remaining() {
    return this.aliveCount() + this.spawnQueue;
  }

  waveActive() {
    return this.remaining() > 0;
  }

  pickSpawn() {
    const G = this.G;
    const pts = G.world.spawnPoints;
    const playerPos = G.camera.position;
    const viable = pts.filter((p) => p.distanceTo(playerPos) > 24);
    const pool = viable.length ? viable : pts;
    const p = pool[Math.floor(Math.random() * pool.length)];
    return new THREE.Vector3(p.x + (Math.random() - 0.5) * 4, 0, p.z + (Math.random() - 0.5) * 4);
  }

  update(dt, playerEye) {
    // staggered spawning
    if (this.spawnQueue > 0 && this.aliveCount() < CONFIG.waves.maxAlive) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = CONFIG.waves.spawnInterval;
        this.spawnQueue--;
        this.enemies.push(new Enemy(this.G, this.pickSpawn(), this.wave));
      }
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const keep = this.enemies[i].update(dt, playerEye);
      if (!keep) {
        this.enemies[i].dispose();
        this.enemies.splice(i, 1);
      }
    }

    // gentle separation so enemies don't stack
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (b.dead) continue;
        const dx = b.group.position.x - a.group.position.x;
        const dz = b.group.position.z - a.group.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 1.15) {
          const push = ((1.15 - d) / d) * 0.5;
          a.group.position.x -= dx * push;
          a.group.position.z -= dz * push;
          b.group.position.x += dx * push;
          b.group.position.z += dz * push;
        }
      }
    }
  }

  getTargets() {
    const out = [];
    for (const e of this.enemies) {
      if (!e.dead) out.push(...e.hittables);
    }
    return out;
  }

  clear() {
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    this.spawnQueue = 0;
  }
}
