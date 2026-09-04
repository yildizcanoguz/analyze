// Three.js stage: camera rig, sun, sky, post. Everything visual hangs off this.
import * as THREE from '../../vendor/three.module.js';
import { emit, on } from '../core/bus.js';

export const R = {
  renderer: null, scene: null, camera: null, canvas: null,
  sun: null, hemi: null, clock: null, size: { w: 1, h: 1 },
  layers: {},                 // named groups so modules never fight over the graph
};

export function initScene(canvas) {
  R.canvas = canvas;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  R.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1420);
  scene.fog = new THREE.FogExp2(0x121d29, 0.0011);
  R.scene = scene;

  const camera = new THREE.PerspectiveCamera(42, 1, 1, 6000);
  camera.position.set(0, 420, 420);
  R.camera = camera;

  const sun = new THREE.DirectionalLight(0xffe9c9, 2.5);
  sun.position.set(-380, 520, 300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 700;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 2200; sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);
  R.sun = sun;

  const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x4a3f30, 1.05);
  scene.add(hemi);
  R.hemi = hemi;

  for (const n of ['terrain', 'water', 'borders', 'markers', 'units', 'fx', 'labels']) {
    const g = new THREE.Group(); g.name = n; scene.add(g); R.layers[n] = g;
  }

  R.clock = new THREE.Clock();
  resize();
  addEventListener('resize', resize);
  return R;
}

export function resize() {
  if (!R.renderer) return;
  const w = R.canvas.clientWidth || innerWidth, h = R.canvas.clientHeight || innerHeight;
  R.size = { w, h };
  R.renderer.setSize(w, h, false);
  R.camera.aspect = w / h;
  R.camera.updateProjectionMatrix();
  emit('render:resize', R.size);
}

const frameHooks = [];
export function onFrame(fn) { frameHooks.push(fn); return () => { const i = frameHooks.indexOf(fn); if (i >= 0) frameHooks.splice(i, 1); }; }

export function renderFrame() {
  const dt = R.clock.getDelta();
  for (const f of frameHooks) { try { f(dt); } catch (e) { console.error(e); } }
  R.renderer.render(R.scene, R.camera);
}
export { THREE };
