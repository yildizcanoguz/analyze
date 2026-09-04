// A grand-strategy camera: drag to pan, wheel to zoom, and the tilt flattens as
// you rise so the world turns into a document. Also does the cinematic pushes
// that stage a heavy moment.
import * as THREE from '../../vendor/three.module.js';
import { R } from './scene.js';
import { setParchment, M } from './mapmesh.js';
import { emit } from '../core/bus.js';

export const Cam = {
  target: new THREE.Vector3(0, 0, 0),
  dist: 900, minDist: 60, maxDist: 2400,
  pitch: 0.62,          // radians from horizontal plane
  yaw: 0,
  _vel: new THREE.Vector3(), _dvel: 0,
  locked: false,
  _anim: null,
};

let dragging = false, lastX = 0, lastY = 0, rotating = false;

export function initCamera(dom) {
  dom.addEventListener('pointerdown', (e) => {
    if (Cam.locked) return;
    dragging = true; rotating = e.button === 2 || e.shiftKey;
    lastX = e.clientX; lastY = e.clientY;
    dom.setPointerCapture?.(e.pointerId);
  });
  dom.addEventListener('pointerup', (e) => { dragging = false; dom.releasePointerCapture?.(e.pointerId); });
  dom.addEventListener('pointerleave', () => { dragging = false; });
  dom.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.addEventListener('pointermove', (e) => {
    if (!dragging || Cam.locked) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (rotating) { Cam.yaw -= dx * 0.004; Cam.pitch = clamp(Cam.pitch + dy * 0.003, 0.22, 1.45); }
    else {
      const s = Cam.dist * 0.0022;
      const fwd = new THREE.Vector3(Math.sin(Cam.yaw), 0, Math.cos(Cam.yaw));
      const right = new THREE.Vector3(Math.cos(Cam.yaw), 0, -Math.sin(Cam.yaw));
      Cam._vel.addScaledVector(right, -dx * s).addScaledVector(fwd, -dy * s);
    }
  });
  dom.addEventListener('wheel', (e) => {
    if (Cam.locked) return;
    e.preventDefault();
    Cam._dvel += Math.sign(e.deltaY) * Cam.dist * 0.16;
  }, { passive: false });

  addEventListener('keydown', (e) => {
    if (Cam.locked) return;
    const s = Cam.dist * 0.06;
    if (e.key === 'ArrowLeft'  || e.key === 'a') Cam._vel.x -= s;
    if (e.key === 'ArrowRight' || e.key === 'd') Cam._vel.x += s;
    if (e.key === 'ArrowUp'    || e.key === 'w') Cam._vel.z -= s;
    if (e.key === 'ArrowDown'  || e.key === 's') Cam._vel.z += s;
  });
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function tickCamera(dt) {
  if (Cam._anim) {
    const a = Cam._anim;
    a.t = Math.min(1, a.t + dt / a.dur);
    const e = a.ease(a.t);
    Cam.target.lerpVectors(a.from, a.to, e);
    Cam.dist = a.d0 + (a.d1 - a.d0) * e;
    Cam.pitch = a.p0 + (a.p1 - a.p0) * e;
    if (a.t >= 1) { const cb = a.done; Cam._anim = null; cb?.(); }
  } else {
    Cam.target.add(Cam._vel);
    Cam._vel.multiplyScalar(Math.pow(0.0016, dt));
    Cam.dist = clamp(Cam.dist + Cam._dvel * Math.min(1, dt * 9), Cam.minDist, Cam.maxDist);
    Cam._dvel *= Math.pow(0.0009, dt);
  }
  // clamp to map bounds
  if (M.meta) {
    const hw = (M.meta.W - 1) * M.scaleXZ * 0.55, hh = (M.meta.H - 1) * M.scaleXZ * 0.55;
    Cam.target.x = clamp(Cam.target.x, -hw, hw);
    Cam.target.z = clamp(Cam.target.z, -hh, hh);
  }
  // tilt flattens with altitude
  const zn = (Cam.dist - Cam.minDist) / (Cam.maxDist - Cam.minDist);
  const autoPitch = 0.44 + zn * 0.72;
  Cam.pitch += (autoPitch - Cam.pitch) * Math.min(1, dt * 2.2);

  const cp = Math.cos(Cam.pitch), sp = Math.sin(Cam.pitch);
  R.camera.position.set(
    Cam.target.x + Math.sin(Cam.yaw) * cp * Cam.dist,
    Cam.target.y + sp * Cam.dist,
    Cam.target.z + Math.cos(Cam.yaw) * cp * Cam.dist,
  );
  R.camera.lookAt(Cam.target);
  R.sun.position.set(Cam.target.x - 380, 620, Cam.target.z + 300);
  R.sun.target.position.copy(Cam.target);
  R.sun.target.updateMatrixWorld();

  // parchment blend: land below ~430, document above ~820
  setParchment(clamp((Cam.dist - 620) / 620, 0, 1));
  R.scene.fog.density = 0.0011 * (1 - clamp((Cam.dist - 620) / 620, 0, 1) * 0.85);
}

const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** Cinematic push toward a point. Used to stage a heavy moment. */
export function flyTo(pos, { dist = 200, pitch = 0.5, dur = 1.4, lock = false, ease = easeInOut } = {}) {
  return new Promise((res) => {
    Cam._anim = {
      t: 0, dur, ease,
      from: Cam.target.clone(), to: new THREE.Vector3(pos.x, 0, pos.z),
      d0: Cam.dist, d1: dist, p0: Cam.pitch, p1: pitch,
      done: () => { if (!lock) Cam.locked = false; res(); },
    };
    if (lock) Cam.locked = true;
  });
}
export function unlock() { Cam.locked = false; }
export function shake(amount = 1, dur = 0.5) { emit('camera:shake', { amount, dur }); }
export function zoomLevel() { return (Cam.dist - Cam.minDist) / (Cam.maxDist - Cam.minDist); }
