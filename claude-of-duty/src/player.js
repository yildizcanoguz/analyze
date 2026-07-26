// First-person controller: pointer-lock look, acceleration-based movement,
// sprint/jump/crouch, cylinder-vs-AABB collision, health regen and recoil.

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { resolveCircle, clampToArena } from "./physics.js";

export class Player {
  constructor(G) {
    this.G = G;
    this.pos = new THREE.Vector3(0, 0, 6);   // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.eyeH = CONFIG.player.eyeHeight;
    this.onGround = true;
    this.crouching = false;
    this.isSprinting = false;
    this.health = CONFIG.player.maxHealth;
    this.lastDamageAt = -100;
    this.time = 0;
    this.stepAcc = 0;
    this.sensitivity = 0.0023;
    this.dead = false;
  }

  reset() {
    this.pos.set(0, 0, 6);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.health = CONFIG.player.maxHealth;
    this.lastDamageAt = -100;
    this.dead = false;
    this.crouching = false;
    this.onGround = true;
    this.G.hud.setHealth(this.health, CONFIG.player.maxHealth);
  }

  onMouseMove(dx, dy) {
    this.yaw -= dx * this.sensitivity;
    this.pitch -= dy * this.sensitivity;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  addRecoil(pitchKick, yawKick) {
    this.recoilPitch = Math.min(0.14, this.recoilPitch + pitchKick);
    this.recoilYaw += yawKick;
  }

  get horizontalSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  update(dt, input) {
    const P = CONFIG.player;
    const G = this.G;
    this.time += dt;

    // --- look: recoil recovery ---
    this.recoilPitch *= Math.exp(-9 * dt);
    this.recoilYaw *= Math.exp(-9 * dt);

    // --- crouch ---
    this.crouching = !!input.crouch && this.onGround;
    const targetEye = this.crouching ? P.crouchEyeHeight : P.eyeHeight;
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * 12);

    // --- wish direction in world space ---
    const f = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const s = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    let wishX = -sinY * f + cosY * s;
    let wishZ = -cosY * f - sinY * s;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0.001) { wishX /= wishLen; wishZ /= wishLen; }

    this.isSprinting = !!input.sprint && f > 0 && !this.crouching && this.G.weapons.adsK < 0.5;
    let speed = P.walkSpeed;
    if (this.isSprinting) speed *= P.sprintMult;
    if (this.crouching) speed *= P.crouchMult;
    if (this.G.weapons.adsK > 0.5) speed *= 0.62;

    const targetVX = wishX * speed * (wishLen > 0.001 ? 1 : 0);
    const targetVZ = wishZ * speed * (wishLen > 0.001 ? 1 : 0);
    const control = this.onGround ? 1 : P.airControl;
    const blend = 1 - Math.exp(-10 * control * dt);
    this.vel.x += (targetVX - this.vel.x) * blend;
    this.vel.z += (targetVZ - this.vel.z) * blend;

    // --- jump & gravity ---
    if (input.jump && this.onGround) {
      this.vel.y = P.jumpVel;
      this.onGround = false;
      input.jump = false;
      G.audio.jump();
    }
    this.vel.y -= P.gravity * dt;

    const fallSpeed = -this.vel.y;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vel.y = 0;
      if (!this.onGround && fallSpeed > 6) G.audio.land();
      this.onGround = true;
    }

    // --- collision ---
    resolveCircle(G.world.colliders, this.pos, P.radius, this.pos.y);
    clampToArena(this.pos, G.world.arenaHalf, P.radius + 0.7);

    // --- footsteps ---
    if (this.onGround) {
      this.stepAcc += this.horizontalSpeed * dt;
      const stride = this.isSprinting ? 2.6 : 2.1;
      if (this.stepAcc > stride && this.horizontalSpeed > 1.5) {
        this.stepAcc = 0;
        G.audio.footstep(this.isSprinting);
      }
    }

    // --- health regen ---
    if (!this.dead && this.health < P.maxHealth && this.time - this.lastDamageAt > P.regenDelay) {
      this.health = Math.min(P.maxHealth, this.health + P.regenRate * dt);
      G.hud.setHealth(this.health, P.maxHealth);
    }
  }

  updateCamera() {
    const cam = this.G.camera;
    cam.position.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z);
    cam.rotation.order = "YXZ";
    cam.rotation.y = this.yaw + this.recoilYaw;
    cam.rotation.x = this.pitch + this.recoilPitch;
    cam.rotation.z = 0;
  }

  takeDamage(dmg, fromPos) {
    if (this.dead) return;
    this.health -= dmg;
    this.lastDamageAt = this.time;
    const G = this.G;
    G.hud.setHealth(this.health, CONFIG.player.maxHealth);
    G.hud.damageFlash();
    G.effects.shake(0.03);
    G.audio.playerHurt();

    if (fromPos) {
      // signed angle between facing and the attacker, for the HUD arrow
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      let dx = fromPos.x - this.pos.x, dz = fromPos.z - this.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const cross = fx * dz - fz * dx;
      const dot = fx * dx + fz * dz;
      G.hud.damageFrom(Math.atan2(cross, dot));
    }

    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      G.gameOver();
    }
  }
}
