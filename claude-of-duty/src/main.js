// CLAUDE OF DUTY — bootstrap, input, game state machine and the main loop.
// An original browser FPS: Three.js is the only dependency; every asset
// (textures, meshes, animation, audio) is synthesized at runtime.

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { buildTextureLibrary } from "./textures.js";
import { buildWorld } from "./world.js";
import { AudioSys } from "./audio.js";
import { Effects } from "./effects.js";
import { HUD } from "./hud.js";
import { Player } from "./player.js";
import { WeaponSystem } from "./weapons.js";
import { EnemyManager } from "./enemies.js";

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
document.getElementById("app").appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  CONFIG.render.fov,
  window.innerWidth / window.innerHeight,
  CONFIG.render.near,
  CONFIG.render.far
);
camera.rotation.order = "YXZ";
scene.add(camera); // so viewmodel children of the camera render

// ---------- Game context ----------
const G = {
  scene,
  camera,
  renderer,
  tex: buildTextureLibrary(),
  audio: new AudioSys(),
  hud: new HUD(),
  effects: null,
  world: null,
  player: null,
  weapons: null,
  enemies: null,
  state: "menu", // menu | playing | paused | over
  score: 0,
  kills: 0,
  headshots: 0,
  wave: 1,
  gameOver: null,
  onEnemyKilled: null,
};

G.world = buildWorld(scene, G.tex);
G.effects = new Effects(scene, G.tex);
G.player = new Player(G);
G.weapons = new WeaponSystem(G);
G.enemies = new EnemyManager(G);
G.weapons.current.model.visible = false; // hidden until combat starts

// ---------- Wave orchestration ----------
let waveState = "combat"; // combat | intermission
let intermissionT = 0;
let lastCountdown = -1;

function beginWave(n) {
  G.wave = n;
  waveState = "combat";
  G.hud.setWave(n);
  G.hud.announce(`WAVE ${n}`, "HOSTILES INBOUND");
  G.audio.waveStart();
  G.enemies.startWave(n);
}

function onWaveCleared() {
  waveState = "intermission";
  intermissionT = CONFIG.waves.intermission;
  lastCountdown = -1;
  G.score += 250;
  G.hud.setScore(G.score);
  G.weapons.refillReserves();
  G.hud.announce(`WAVE ${G.wave} CLEARED`, "+250 BONUS — RESERVES REFILLED", 3);
}

G.onEnemyKilled = (enemy, headshot) => {
  G.kills++;
  const pts = CONFIG.enemy.scoreKill + (headshot ? CONFIG.enemy.scoreHeadshot : 0);
  G.score += pts;
  if (headshot) G.headshots++;
  G.hud.setScore(G.score);
  G.hud.addKill(`<b>YOU</b> ${headshot ? "⌖" : "⟶"} ${enemy.name} &nbsp;+${pts}`);
};

// ---------- Game over ----------
function loadBest() {
  try { return parseInt(localStorage.getItem("cod_best") || "0", 10) || 0; } catch { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem("cod_best", String(v)); } catch { /* private mode */ }
}

G.gameOver = () => {
  if (G.state !== "playing") return;
  G.state = "over";
  G.weapons.triggerUp();
  G.weapons.setADS(false);
  G.weapons.current.model.visible = false;
  G.hud.show(false);
  G.audio.gameOver();

  const best = Math.max(loadBest(), G.score);
  saveBest(best);
  const acc = Math.round(G.weapons.accuracy() * 100);
  G.hud.setFinalStats(
    `<div class="big">${G.score}</div>SCORE<br>` +
    `WAVE ${G.wave} &nbsp;//&nbsp; ${G.kills} KILLS &nbsp;//&nbsp; ` +
    `${G.headshots} HEADSHOTS &nbsp;//&nbsp; ${acc}% ACC<br>` +
    `BEST: ${best}`
  );
  G.hud.showScreen("gameover");
  if (document.pointerLockElement) document.exitPointerLock();
};

// ---------- Input ----------
const input = { forward: false, back: false, left: false, right: false, sprint: false, crouch: false, jump: false };

function clearInput() {
  for (const k of Object.keys(input)) input[k] = false;
}

const KEYMAP = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  ShiftLeft: "sprint", ShiftRight: "sprint",
  KeyC: "crouch", ControlLeft: "crouch",
};

window.addEventListener("keydown", (e) => {
  if (G.state !== "playing") return;
  const flag = KEYMAP[e.code];
  if (flag) { input[flag] = true; e.preventDefault(); return; }
  if (e.code === "Space") { if (!e.repeat) input.jump = true; e.preventDefault(); }
  else if (e.code === "KeyR") G.weapons.reload();
  else if (e.code === "Digit1") G.weapons.switchTo(0);
  else if (e.code === "Digit2") G.weapons.switchTo(1);
  else if (e.code === "Digit3") G.weapons.switchTo(2);
});

window.addEventListener("keyup", (e) => {
  const flag = KEYMAP[e.code];
  if (flag) input[flag] = false;
  if (e.code === "Space") input.jump = false;
});

window.addEventListener("mousemove", (e) => {
  if (G.state === "playing" && document.pointerLockElement === renderer.domElement) {
    G.player.onMouseMove(e.movementX, e.movementY);
  }
});

window.addEventListener("mousedown", (e) => {
  if (G.state !== "playing" || document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) G.weapons.triggerDown();
  else if (e.button === 2) G.weapons.setADS(true);
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 0) G.weapons.triggerUp();
  else if (e.button === 2) G.weapons.setADS(false);
});

window.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("wheel", (e) => {
  if (G.state === "playing" && document.pointerLockElement === renderer.domElement) {
    G.weapons.cycle(e.deltaY > 0 ? 1 : -1);
  }
});

// ---------- Pointer lock / pause ----------
function requestLock() {
  const p = renderer.domElement.requestPointerLock();
  // Some browsers return a promise; a rejection (e.g. headless) must not kill the game.
  if (p && p.catch) p.catch(() => {});
}

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && G.state === "playing") {
    G.state = "paused";
    clearInput();
    G.weapons.triggerUp();
    G.weapons.setADS(false);
    G.hud.showScreen("pause");
  } else if (locked && G.state === "paused") {
    G.state = "playing";
    G.hud.showScreen(null);
  }
});
document.addEventListener("pointerlockerror", () => { /* keep running unlocked */ });

// ---------- Screens ----------
function startCombat() {
  G.audio.ensure();
  G.state = "playing";
  G.hud.showScreen(null);
  G.hud.show(true);
  G.weapons.current.model.visible = true;
  G.hud.setHealth(G.player.health, CONFIG.player.maxHealth);
  G.hud.setScore(G.score);
  requestLock();
  beginWave(G.wave);
}

function resetGame() {
  G.enemies.clear();
  G.effects.clear();
  G.player.reset();
  G.weapons.reset();
  G.hud.resetCombat();
  G.score = 0;
  G.kills = 0;
  G.headshots = 0;
  G.wave = 1;
  waveState = "combat";
}

document.getElementById("btn-play").addEventListener("click", () => {
  resetGame();
  startCombat();
});
document.getElementById("btn-restart").addEventListener("click", () => {
  resetGame();
  startCombat();
});
document.getElementById("btn-resume").addEventListener("click", requestLock);
document.getElementById("screen-pause").addEventListener("click", requestLock);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
let orbitT = 0;
const playerEye = new THREE.Vector3();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());

  if (G.state === "playing") {
    G.player.update(dt, input);
    G.player.updateCamera();
    playerEye.copy(camera.position);

    G.weapons.update(dt);
    G.enemies.update(dt, playerEye);
    G.hud.setHostiles(G.enemies.remaining());

    if (G.state === "playing") { // may have died during enemy update
      if (waveState === "combat" && !G.enemies.waveActive()) {
        onWaveCleared();
      } else if (waveState === "intermission") {
        intermissionT -= dt;
        const sec = Math.ceil(intermissionT);
        if (sec !== lastCountdown && sec > 0 && intermissionT < CONFIG.waves.intermission - 2.5) {
          lastCountdown = sec;
          G.hud.announce(`WAVE ${G.wave + 1}`, `INBOUND IN ${sec}`, 1.1);
        }
        if (intermissionT <= 0) beginWave(G.wave + 1);
      }
    }

    G.effects.update(dt);
    G.effects.applyShake(camera, dt);
    G.hud.update(dt);
  } else if (G.state === "paused") {
    // frozen simulation; keep drawing the last frame
  } else {
    // menu / game over: slow orbit over the arena
    orbitT += dt;
    const r = 36;
    camera.position.set(Math.cos(orbitT * 0.07) * r, 15, Math.sin(orbitT * 0.07) * r);
    camera.lookAt(0, 2.5, 0);
    G.effects.update(dt);
  }

  renderer.render(scene, camera);
}

tick();

// Debug / test hook (used by the automated smoke test).
window.__game = G;
if (new URLSearchParams(location.search).has("autotest")) {
  document.getElementById("btn-play").click();
}
