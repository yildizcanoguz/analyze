// Bootstrap. Wires sim, render and UI together and owns the frame loop.
import * as THREE from '../vendor/three.module.js';
import { S, ch, setSeed } from './core/state.js';
import { on, emit } from './core/bus.js';
import { advance, resume, pause } from './core/clock.js';
import { generateWorld, loadMap, MAP } from './sim/world.js';
import { tickDay } from './sim/tick.js';
import { assumeHeir } from './sim/succession.js';
import { fullName, age } from './sim/characters.js';
import { initScene, renderFrame, onFrame, R } from './render/scene.js';
import { buildMap, tickMap, provinceAtWorld, setHover, worldOfProvince, M } from './render/mapmesh.js';
import { initCamera, tickCamera, Cam, flyTo } from './render/camera.js';
import { applyMapMode } from './render/mapmodes.js';
import { setSeason } from './render/mapmesh.js';
import { seasonOf, fromDay } from './core/date.js';
import { initShell, showProvince, hideProvince, showChar, refreshTop } from './ui/shell.js';
import { initDecisionUI, renderPending, whisper } from './ui/decision.js';
import { initReveal } from './ui/reveal.js';
import { initAudio, resumeAudio, SFX, heart } from './audio/audio.js';

const boot = document.getElementById('boot');
const bootmsg = boot.querySelector('.bootmsg');

async function start() {
  bootmsg.textContent = 'Dünya kuruluyor…';
  const seed = Number(new URLSearchParams(location.search).get('seed') || 1066);
  const map = await loadMap();
  S.mapMeta = map;
  window.__S = S;   // read-only handle for the inspection harness
  await generateWorld(seed);

  bootmsg.textContent = 'Sahne hazırlanıyor…';
  initScene(document.getElementById('stage'));
  buildMap(map);
  initCamera(document.getElementById('stage'));
  applyMapMode('realm');

  // start looking at the player's own land
  const p = ch(S.playerId);
  const own = Object.values(S.titles).find((t) => t.holderId === S.playerId && t.provinceId);
  if (own) {
    const idx = map.provinces.findIndex((x) => x.id === own.provinceId);
    const w = worldOfProvince(idx);
    if (w) { Cam.target.set(w.x, 0, w.z); Cam.dist = 1900; }
    setTimeout(() => flyTo(w, { dist: 480, pitch: 0.52, dur: 3.4 }), 500);
  }

  initAudio();
  initShell();
  initDecisionUI();
  initReveal();
  wirePicking();
  wireDeath();

  onFrame((dt) => { tickCamera(dt); tickMap(dt); });
  requestAnimationFrame(loop);

  bootmsg.textContent = '';
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 1000);
  // The world does not start moving until the player says so. The first click
  // is the first decision.
  pause('manual');
  whisper(`${fullName(p)} — ${age(p)} yaşında, ${Object.values(S.titles).filter((t) => t.holderId === S.playerId).length} unvan sahibi.`, 'ambiguous');
  whisper('Başlamak için boşluk tuşuna bas.', 'ambiguous');
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(120, now - last); last = now;
  advance(dt, tickDay);
  // seasons drive the snow line
  const { m } = fromDay(S.day);
  const winter = Math.max(0, Math.cos((m - 1) / 12 * Math.PI * 2));
  setSeason(winter);
  renderFrame();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- picking
function wirePicking() {
  const canvas = document.getElementById('stage');
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let downX = 0, downY = 0;

  const pick = (e) => {
    ndc.x = (e.clientX / innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / innerHeight) * 2 + 1;
    ray.setFromCamera(ndc, R.camera);
    // hit the terrain mesh if we can, else the ground plane
    const inter = ray.intersectObject(M.mesh, false);
    if (inter.length) return provinceAtWorld(inter[0].point.x, inter[0].point.z);
    if (ray.ray.intersectPlane(plane, hit)) return provinceAtWorld(hit.x, hit.z);
    return -1;
  };
  canvas.addEventListener('pointermove', (e) => { setHover(pick(e)); });
  canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
  canvas.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;   // that was a drag
    resumeAudio();
    const idx = pick(e);
    if (idx >= 0) { SFX.click(); showProvince(idx); } else hideProvince();
  });
}

// ---------------------------------------------------------------- your death
function wireDeath() {
  on('player:died', ({ deadId, heirId }) => {
    pause('death');
    const dead = ch(deadId), heir = ch(heirId);
    SFX.knell();
    const r = document.getElementById('revealRoot');
    r.classList.add('breathing');
    document.body.classList.add('staged');
    r.innerHTML = `<div class="reveal">
      <div class="beat">bir ömür bitti</div>
      <h1 class="bad">${fullName(dead)} Öldü</h1>
      <p>${age(dead)} yıl yaşadı. Geriye ${Object.values(S.titles).filter((t) => t.holderId === deadId).length} unvan, ${S.memories.length} karar ve bir isim bıraktı.</p>
      <p>Şimdi taht <b>${fullName(heir)}</b>'in. ${age(heir)} yaşında. Senin verdiğin kararların faturasını o ödeyecek.</p>
      <button class="ok">devral</button></div>`;
    r.querySelector('.ok').onclick = () => {
      r.innerHTML = ''; r.classList.remove('breathing');
      document.body.classList.remove('staged');
      assumeHeir();
      refreshTop();
      resume();
    };
  });
}

start().catch((e) => { console.error(e); bootmsg.textContent = 'Hata: ' + e.message; });
