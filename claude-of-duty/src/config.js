// Central tuning constants for Claude of Duty.

export const CONFIG = {
  arena: {
    size: 130,          // playable square, centered on origin
    wallHeight: 7,
  },
  player: {
    eyeHeight: 1.68,
    crouchEyeHeight: 1.05,
    radius: 0.42,
    walkSpeed: 5.2,
    sprintMult: 1.55,
    crouchMult: 0.55,
    accel: 42,
    friction: 11,
    airControl: 0.25,
    jumpVel: 6.4,
    gravity: 18.5,
    maxHealth: 100,
    regenDelay: 4.0,    // seconds after last damage before regen starts
    regenRate: 22,      // hp per second
  },
  waves: {
    baseEnemies: 4,
    perWave: 2,
    maxAlive: 9,
    spawnInterval: 0.85,
    intermission: 5.0,  // seconds between waves
  },
  enemy: {
    baseHealth: 100,
    healthPerWave: 8,
    baseDamage: 7,
    damagePerWave: 0.7,
    speedMin: 2.3,
    speedMax: 3.4,
    attackRangeMin: 9,
    attackRangeMax: 17,
    baseAccuracy: 0.30,
    scoreKill: 100,
    scoreHeadshot: 50,
  },
  render: {
    fov: 75,
    adsFov: 52,
    near: 0.05,
    far: 420,
  },
};
