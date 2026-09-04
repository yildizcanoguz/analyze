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
import { initDecisionUI } from './ui/decision.js';
import { initWait, renderPending, whisper } from './ui/wait.js';
import { initSchemeUI } from './ui/schemes.js';
import { initCourtUI } from './ui/court.js';
import { initSuccessionUI } from './ui/succession.js';
import { initRealmUI } from './ui/realm.js';
import { initWarUI } from './ui/war.js';
import { initHoldingUI } from './ui/holding.js';
import { initTooltips } from './ui/tooltip.js';
import { initIntro } from './ui/intro.js';
import { initProps, tickProps } from './render/props.js';
import { initLabels, tickLabels } from './render/labels.js';
import { initArmies, tickArmies } from './render/armies.js';
import { initMusic } from './audio/music.js';
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
  // Test affordance: run the simulation forward without waiting on wall clock.
  // Critics need to reach year 1080 without sitting through it.
  window.__advance = (days = 365) => {
    for (let i = 0; i < days; i++) {
      if (S.decisions.some((d) => d.state === 'open') || S.pendingPlayer) break;
      S.day++; tickDay(S.day);
    }
    refreshTop(); return S.day;
  };
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
  initWait();
  initReveal();
  initTooltips();
  initSchemeUI(); initCourtUI(); initSuccessionUI(); initRealmUI(); initWarUI(); initHoldingUI();
  initProps(map); initLabels(map); initArmies();
  initMusic();
  initIntro();
  wirePicking();
  wireDeath();

  onFrame((dt) => { tickCamera(dt); tickMap(dt); tickProps(dt); tickLabels(dt); tickArmies(dt); });
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
function overlayBusy() {
  return !!document.querySelector('#decisionRoot .dec') || !!document.querySelector('#revealRoot .reveal, #revealRoot .breath');
}
function whenClear(fn) {
  if (!overlayBusy()) return fn();
  const t = setInterval(() => { if (!overlayBusy()) { clearInterval(t); fn(); } }, 250);
}

function wireDeath() {
  on('player:died', (payload) => { pause('death'); whenClear(() => showDeath(payload)); });
}
function showDeath({ deadId, heirId }) {
  {
    pause('death');
    const dead = ch(deadId), heir = ch(heirId);
    SFX.knell();
    const r = document.getElementById('revealRoot');
    r.classList.add('breathing');
    document.body.classList.add('staged');
    r.innerHTML = `<div class="reveal">
      <div class="beat">bir ömür bitti</div>
      <h1 class="bad">${fullName(dead)} Öldü</h1>
      <p>${age(dead)} yıl yaşadı. Geriye ${S.memories.length} karar, ${S.stats.irreversible} geri dönüşü olmayan hamle ve bir isim bıraktı.</p>
      ${S.memories.length ? `<p style="font-size:14px;color:#9a8a6a">Son olarak: ${S.memories[S.memories.length - 1].text}</p>` : ''}
      <p>Şimdi taht <b>${fullName(heir)}</b>'in. ${age(heir)} yaşında. Senin verdiğin kararların faturasını o ödeyecek.</p>
      <button class="ok">devral</button></div>`;
    r.querySelector('.ok').onclick = () => {
      r.innerHTML = ''; r.classList.remove('breathing');
      document.body.classList.remove('staged');
      assumeHeir();
      refreshTop();
      resume();
    };
  }
}

start().catch((e) => { console.error(e); bootmsg.textContent = 'Hata: ' + e.message; });
