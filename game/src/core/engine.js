// Engine: renderer, context, system registry, frame loop. Owned by integration.
import * as THREE from 'three';
import EventBus from './events.js';
import Input from './input.js';

// Load order matters — see CONTRACT.md. Missing modules are tolerated so the game
// still boots while systems are built in parallel.
const MANIFEST = [
  ['quality',    '../core/quality.js'],
  ['materials',  '../world/materials.js'],
  ['sky',        '../world/sky.js'],
  ['level',      '../world/level.js'],
  ['physics',    '../core/physics.js'],
  ['fx',         '../fx/fx.js'],
  ['audio',      '../audio/audio.js'],
  ['player',     '../player/controller.js'],
  ['weapons',    '../weapons/weapons.js'],
  ['ballistics', '../combat/ballistics.js'],
  ['damage',     '../combat/damage.js'],
  ['ai',         '../ai/ai.js'],
  ['gamemode',   '../game/gamemode.js'],
  ['ui',         '../ui/hud.js'],
  ['postfx',     '../core/postfx.js'],
];

function makeRNG(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export default class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.missing = [];
    this.failed = [];
  }

  async boot(onProgress = () => {}) {
    const canvas = this.canvas;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,          // handled by post AA
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
      depth: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = true;
    renderer.info.autoReset = false;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.06, 600);
    camera.rotation.order = 'YXZ';
    camera.position.set(0, 1.7, 0);

    const viewScene = new THREE.Scene();
    const viewCamera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.004, 12);
    viewCamera.rotation.order = 'YXZ';

    const ctx = {
      THREE,
      renderer,
      scene,
      camera,
      viewScene,
      viewCamera,
      canvas,
      events: new EventBus(),
      input: new Input(canvas),
      systems: new Map(),
      settings: {
        quality: detectQuality(),
        fov: 90,
        viewmodelFov: 62,
        sensitivity: 0.0022,
        adsSensitivity: 0.72,
        invertY: false,
        masterVolume: 0.8,
        motionBlur: true,
        filmGrain: true,
        chromaticAberration: true,
        crosshair: true,
        showFps: false,
      },
      rng: makeRNG,
      random: makeRNG(0x9e3779b9),
      dt: 0,
      time: 0,
      frame: 0,
      state: 'playing',
      paused: false,
      // Systems that need a render target composite hook set this.
      renderOverride: null,
    };
    this.ctx = ctx;
    ctx.engine = this;

    // ---- load systems -------------------------------------------------
    const loaded = [];
    for (let i = 0; i < MANIFEST.length; i++) {
      const [id, path] = MANIFEST[i];
      onProgress(i / MANIFEST.length, id);
      let mod = null;
      try {
        mod = await import(/* @vite-ignore */ path);
      } catch (err) {
        if (/Failed to fetch|not found|404|Cannot find|Error resolving/i.test(err.message)) {
          this.missing.push(id);
          continue;
        }
        console.error(`[engine] module "${id}" failed to load:`, err);
        this.failed.push({ id, err });
        continue;
      }
      const Cls = mod?.default;
      if (typeof Cls !== 'function') { this.missing.push(id); continue; }
      try {
        const sys = new Cls(ctx);
        const key = Cls.id || id;
        ctx.systems.set(key, sys);
        ctx[key] = sys;
        loaded.push([key, sys]);
      } catch (err) {
        console.error(`[engine] system "${id}" constructor threw:`, err);
        this.failed.push({ id, err });
      }
    }

    for (let i = 0; i < loaded.length; i++) {
      const [key, sys] = loaded[i];
      onProgress(i / loaded.length, key);
      if (typeof sys.init === 'function') {
        try {
          await sys.init();
        } catch (err) {
          console.error(`[engine] system "${key}" init() threw:`, err);
          this.failed.push({ id: key, err });
        }
      }
    }

    this._updaters = loaded.filter(([, s]) => typeof s.update === 'function');
    this._lateUpdaters = loaded.filter(([, s]) => typeof s.lateUpdate === 'function');
    this._resizers = loaded.filter(([, s]) => typeof s.resize === 'function');

    // Fallback content so an empty build still shows something coherent.
    if (!ctx.level) this._fallbackScene();

    camera.fov = ctx.settings.fov;
    camera.updateProjectionMatrix();
    viewCamera.fov = ctx.settings.viewmodelFov;
    viewCamera.updateProjectionMatrix();

    addEventListener('resize', () => this.resize());
    this.resize();

    this._clock = new THREE.Clock();
    this._acc = 0;
    return ctx;
  }

  _fallbackScene() {
    const { scene } = this.ctx;
    scene.background = new THREE.Color(0x0d1218);
    scene.fog = new THREE.FogExp2(0x0d1218, 0.02);
    const grid = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.9 }),
    );
    grid.rotation.x = -Math.PI / 2;
    grid.receiveShadow = true;
    scene.add(grid);
    const key = new THREE.DirectionalLight(0xfff0dd, 3);
    key.position.set(20, 30, 10);
    key.castShadow = true;
    scene.add(key, new THREE.HemisphereLight(0x88aaff, 0x2a2118, 0.6));
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const { renderer, camera, viewCamera } = this.ctx;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    viewCamera.aspect = w / h;
    viewCamera.updateProjectionMatrix();
    for (const [, s] of this._resizers || []) {
      try { s.resize(w, h); } catch (e) { console.error(e); }
    }
  }

  start() {
    const ctx = this.ctx;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const raw = this._clock.getDelta();
      const dt = Math.min(raw, 0.1);
      ctx.dt = dt;
      ctx.time += dt;
      ctx.frame++;

      ctx.input.beginFrame();

      if (!ctx.paused) {
        for (const [key, s] of this._updaters) {
          try { s.update(dt, ctx.time); }
          catch (e) { console.error(`[engine] ${key}.update:`, e); }
        }
        for (const [key, s] of this._lateUpdaters) {
          try { s.lateUpdate(dt, ctx.time); }
          catch (e) { console.error(`[engine] ${key}.lateUpdate:`, e); }
        }
      }

      ctx.renderer.info.reset();
      this.render();

      ctx.input.endFrame();
      if (ctx.frame === 2) window.__ready = true;
    };
    this._raf = requestAnimationFrame(loop);
  }

  render() {
    const ctx = this.ctx;
    if (ctx.renderOverride) { ctx.renderOverride(); return; }
    const r = ctx.renderer;
    r.autoClear = true;
    r.render(ctx.scene, ctx.camera);
    if (ctx.viewScene.children.length) {
      r.autoClear = false;
      r.clearDepth();
      r.render(ctx.viewScene, ctx.viewCamera);
      r.autoClear = true;
    }
  }

  stop() { cancelAnimationFrame(this._raf); }
}

function detectQuality() {
  const p = new URLSearchParams(location.search);
  const q = p.get('quality');
  if (q && ['low', 'medium', 'high', 'ultra'].includes(q)) return q;
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 4;
  if (mem >= 8 && cores >= 8) return 'high';
  if (mem >= 4 && cores >= 4) return 'medium';
  return 'low';
}
