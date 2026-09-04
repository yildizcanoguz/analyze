// Three.js stage: camera rig, sun, sky, post. Everything visual hangs off this.
import * as THREE from '../../vendor/three.module.js';
import { emit, on } from '../core/bus.js';

export const R = {
  renderer: null, scene: null, camera: null, canvas: null,
  sun: null, hemi: null, sky: null, clock: null, size: { w: 1, h: 1 },
  layers: {},                 // named groups so modules never fight over the graph
};

// Daylight presets. Summer sun stands high and white; winter light comes in
// almost sideways, thin and blue, and the shadows it throws are long.
const SUMMER = {
  sun: 0xfff0d2, sky: 0x9fbcdd, ground: 0x6d5c3f,
  top: 0x1d4c7a, horizon: 0x9d8c6b, deep: 0x101b28,
  dir: new THREE.Vector3(-0.52, 0.74, 0.42).normalize(), power: 1.0,
};
const WINTER = {
  sun: 0xffd9b4, sky: 0xa8bed8, ground: 0x59544c,
  top: 0x23445f, horizon: 0x8b8175, deep: 0x101822,
  dir: new THREE.Vector3(-0.62, 0.36, 0.60).normalize(), power: 0.78,
};

export function initScene(canvas) {
  R.canvas = canvas;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  R.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = null;                 // the sky dome below paints the frame
  scene.fog = new THREE.FogExp2(0x6f8598, 0.0006);
  R.scene = scene;

  const camera = new THREE.PerspectiveCamera(42, 1, 1, 9000);
  camera.position.set(0, 420, 420);
  R.camera = camera;

  // --- sky --------------------------------------------------------------
  // Without this the map is a lit slab floating in a black void: you can see
  // exactly where the world stops. A gradient dome gives the edge somewhere
  // to go.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(SUMMER.top) },
      uHorizon: { value: new THREE.Color(SUMMER.horizon) },
      uDeep: { value: new THREE.Color(SUMMER.deep) },
      uParchment: { value: 0 },
      uPaper: { value: new THREE.Color(0x8d7f66) },
    },
    vertexShader: /* glsl */`
      varying vec3 vP;
      void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      precision mediump float;
      varying vec3 vP;
      uniform vec3 uTop, uHorizon, uDeep, uPaper;
      uniform float uParchment;
      void main(){
        float h = normalize(vP).y;
        vec3 c = h > 0.0
          ? mix(uHorizon, uTop, pow(clamp(h,0.0,1.0), 0.52))
          : mix(uHorizon, uDeep, pow(clamp(-h,0.0,1.0), 0.40));
        // pulled back from the world, the frame around the document goes dark
        // and leathery, like the desk the map is lying on
        c = mix(c, uPaper * (0.30 + 0.16*clamp(h,0.0,1.0)), uParchment);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 24, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  sky.name = 'sky';
  scene.add(sky);
  R.sky = skyMat;

  const sun = new THREE.DirectionalLight(SUMMER.sun, 2.4);
  sun.position.set(-380, 520, 300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 700;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 2200; sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);
  R.sun = sun;

  const hemi = new THREE.HemisphereLight(SUMMER.sky, SUMMER.ground, 1.15);
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

const _a = new THREE.Color(), _b = new THREE.Color();
function lerpHex(a, b, t) { _a.setHex(a); _b.setHex(b); return _a.lerp(_b, t); }

/**
 * Move the whole stage between summer and winter light. `t` is 0 in high
 * summer and 1 at midwinter. Returns the sun direction so the map shader can
 * light itself from the same place the shadows fall from.
 */
export function setDaylight(t) {
  const k = Math.max(0, Math.min(1, t));
  if (!R.sun) return SUMMER.dir;
  R.sun.color.copy(lerpHex(SUMMER.sun, WINTER.sun, k));
  R.sun.intensity = 2.4 * (SUMMER.power + (WINTER.power - SUMMER.power) * k);
  R.hemi.color.copy(lerpHex(SUMMER.sky, WINTER.sky, k));
  R.hemi.groundColor.copy(lerpHex(SUMMER.ground, WINTER.ground, k));
  R.hemi.intensity = 1.15 - 0.18 * k;
  R.sky.uniforms.uTop.value.copy(lerpHex(SUMMER.top, WINTER.top, k));
  R.sky.uniforms.uHorizon.value.copy(lerpHex(SUMMER.horizon, WINTER.horizon, k));
  R.sky.uniforms.uDeep.value.copy(lerpHex(SUMMER.deep, WINTER.deep, k));
  R.scene.fog.color.copy(lerpHex(0x6f8598, 0x7c848c, k));
  const dir = SUMMER.dir.clone().lerp(WINTER.dir, k).normalize();
  R.sunDir = dir;
  return dir;
}
/** How far out the camera has pulled, 0..1 — the sky follows the paper. */
export function setSkyParchment(t) { if (R.sky) R.sky.uniforms.uParchment.value = t; }

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
