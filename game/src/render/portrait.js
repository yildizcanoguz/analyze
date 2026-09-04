// 3D portraits. One shared offscreen WebGL renderer draws a parametric head and
// blits it into any 2D canvas you hand it, so a court of eighty faces costs one
// GL context instead of eighty.
//
// A face has to carry age, blood and mood, because the game asks you to spend
// people — and you cannot spend what you cannot picture.

import * as THREE from '../../vendor/three.module.js';
import { hashStr, mulberry32 } from '../core/rng.js';

let rr = null, sc = null, cam = null, rig = null;
const SIZE = 320;

function ensure() {
  if (rr) return;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  rr = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
  rr.setPixelRatio(1);
  rr.setSize(SIZE, SIZE, false);
  rr.outputColorSpace = THREE.SRGBColorSpace;
  rr.toneMapping = THREE.ACESFilmicToneMapping;
  rr.toneMappingExposure = 1.15;

  sc = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  cam.position.set(0, 0.06, 3.15);
  cam.lookAt(0, 0.02, 0);

  // candlelight from the left, cold window light from behind-right
  const key = new THREE.DirectionalLight(0xffd9a0, 3.0); key.position.set(-2.2, 1.6, 2.4); sc.add(key);
  const rim = new THREE.DirectionalLight(0x8fb6ff, 1.5); rim.position.set(2.6, 1.1, -1.8); sc.add(rim);
  const fill = new THREE.AmbientLight(0x4a3a2a, 1.1); sc.add(fill);
  const bounce = new THREE.DirectionalLight(0x6a4a30, 0.55); bounce.position.set(0, -2, 1); sc.add(bounce);

  rig = new THREE.Group(); sc.add(rig);
}

const SKIN = [0xf0cdae, 0xe4b892, 0xd8a077, 0xc08a5e, 0xa06d46, 0x82563a, 0x63412c];
const HAIR = [0x1a1310, 0x2b1d14, 0x4a2f1c, 0x6b4423, 0x8a6a3a, 0xb09050, 0x746154, 0xd8d2c4];

function faceParams(c) {
  const seed = (c.faceSeed ?? hashStr(c.id || 'x')) >>> 0;
  const r = mulberry32(seed);
  const age = c._ageCache ?? 30;
  return {
    r,
    skin: SKIN[Math.floor(r() * SKIN.length)],
    hair: HAIR[Math.floor(r() * HAIR.length)],
    jaw: 0.82 + r() * 0.42,
    cheek: 0.78 + r() * 0.44,
    brow: 0.6 + r() * 0.8,
    nose: 0.7 + r() * 0.7,
    noseW: 0.75 + r() * 0.5,
    eyeSize: 0.85 + r() * 0.3,
    eyeSpace: 0.9 + r() * 0.24,
    lip: 0.7 + r() * 0.6,
    headW: 0.9 + r() * 0.2,
    hairStyle: Math.floor(r() * 4),
    beard: r(),
    age,
  };
}

function buildHead(p, c) {
  const g = new THREE.Group();
  const male = c.sex === 'm';
  const old = Math.max(0, Math.min(1, (p.age - 34) / 42));

  // --- skull: sphere sculpted by the parameters -----------------------------
  const geo = new THREE.SphereGeometry(0.5, 40, 32);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const y = v.y / 0.5, x = v.x / 0.5, z = v.z / 0.5;
    let sx = 0.88 * p.headW, sy = 1.14, sz = 0.94;
    // jaw narrows below, per jaw param
    if (y < 0) { const t = -y; sx *= 1 - t * (0.42 - p.jaw * 0.22); sz *= 1 - t * 0.16; }
    // cheekbones
    if (y > -0.35 && y < 0.15 && z > 0) sz *= 1 + (p.cheek - 1) * 0.12 * (1 - Math.abs(y + 0.1) * 2);
    // brow ridge
    if (y > 0.05 && y < 0.35 && z > 0.4) sz *= 1 + p.brow * 0.055 * (male ? 1.4 : 0.7);
    // chin
    if (y < -0.72 && z > 0.1) { sz *= 1 + (male ? 0.10 : 0.04); sy *= 1 + p.jaw * 0.03; }
    // temples sink with age
    if (y > 0.3 && Math.abs(x) > 0.6) sx *= 1 - old * 0.05;
    v.set(v.x * sx, v.y * sy, v.z * sz);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const skin = new THREE.Color(p.skin);
  if (old > 0) skin.lerp(new THREE.Color(0xcfc0b0), old * 0.22);
  if (c.traits?.includes('ill') || c.traits?.includes('pox')) skin.lerp(new THREE.Color(0x9aa88f), 0.30);
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.72, metalness: 0.0, flatShading: false });
  const head = new THREE.Mesh(geo, skinMat);
  g.add(head);

  // --- nose -----------------------------------------------------------------
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.085 * p.noseW, 0.24 * p.nose, 10),
    skinMat);
  nose.position.set(0, -0.03, 0.44);
  nose.rotation.x = Math.PI * 0.52;
  g.add(nose);

  // --- eyes -----------------------------------------------------------------
  const eyeW = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.35 });
  const irisCol = [0x3a2a18, 0x5a4a2a, 0x3a5a6a, 0x4a6a4a, 0x6a6a7a][Math.floor(p.r() * 5)];
  const iris = new THREE.MeshStandardMaterial({ color: irisCol, roughness: 0.25, metalness: 0.1 });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.062 * p.eyeSize, 14, 12), eyeW);
    e.position.set(s * 0.155 * p.eyeSpace, 0.09, 0.40);
    e.scale.set(1, 0.72, 0.6);
    g.add(e);
    const ir = new THREE.Mesh(new THREE.SphereGeometry(0.032 * p.eyeSize, 12, 10), iris);
    ir.position.set(s * 0.155 * p.eyeSpace, 0.09, 0.445);
    ir.scale.set(1, 1, 0.5);
    g.add(ir);
    // lid
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.075 * p.eyeSize, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), skinMat);
    lid.position.set(s * 0.155 * p.eyeSpace, 0.098 - old * 0.012, 0.40);
    lid.scale.set(1, 0.5, 0.7);
    g.add(lid);
  }

  // --- brows ----------------------------------------------------------------
  const hairCol = new THREE.Color(p.hair).lerp(new THREE.Color(0xcfc9bd), old * 0.55);
  const hairMat = new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.92 });
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.028 * (male ? 1.4 : 1), 0.05), hairMat);
    b.position.set(s * 0.16 * p.eyeSpace, 0.175 + p.brow * 0.012, 0.42);
    b.rotation.z = s * (0.10 + (c.traits?.includes('wrathful') ? 0.16 : 0));
    g.add(b);
  }

  // --- mouth ----------------------------------------------------------------
  const mood = c.traits?.includes('wrathful') ? -1 : c.traits?.includes('content') ? 1 : c.traits?.includes('craven') ? -0.6 : 0;
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.085 * p.lip, 0.019, 8, 18, Math.PI), new THREE.MeshStandardMaterial({ color: 0x9a5a4a, roughness: 0.6 }));
  mouth.position.set(0, -0.20, 0.415);
  mouth.rotation.z = mood >= 0 ? Math.PI : 0;
  mouth.rotation.x = -0.15;
  mouth.scale.y = 0.6;
  g.add(mouth);

  // --- hair -----------------------------------------------------------------
  if (!(male && p.hairStyle === 3 && old > 0.5)) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.53, 28, 20, 0, Math.PI * 2, 0, Math.PI * (male ? 0.52 : 0.62)), hairMat);
    cap.scale.set(0.90 * p.headW, 1.14, 0.98);
    cap.position.y = 0.02;
    g.add(cap);
    if (!male || p.hairStyle === 1) {   // long hair falls behind
      const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.45, 6, 14), hairMat);
      back.position.set(0, -0.28, -0.20);
      back.scale.set(1.0, 1, 0.55);
      g.add(back);
    }
  }
  // --- beard ----------------------------------------------------------------
  if (male && p.beard > 0.28 && p.age > 17) {
    const bd = new THREE.Mesh(new THREE.SphereGeometry(0.47, 24, 18, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), hairMat);
    bd.scale.set(0.86 * p.headW, 1.05 + p.beard * 0.35, 0.95);
    bd.position.set(0, -0.03, 0.02);
    g.add(bd);
  }

  // --- shoulders and collar --------------------------------------------------
  const rank = c._rank ?? 1;
  const cloth = new THREE.Color([0x3a2a20, 0x4a2a2a, 0x2a3a4a, 0x5a4020, 0x3a3a2a][Math.floor(p.r() * 5)]);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.86, 0.75, 22, 1, true),
    new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.88, side: THREE.DoubleSide }));
  body.position.y = -1.05;
  g.add(body);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.075, 10, 26),
    new THREE.MeshStandardMaterial({ color: rank >= 3 ? 0xc9a34e : 0x6a5a3a, roughness: 0.42, metalness: rank >= 3 ? 0.7 : 0.25 }));
  collar.position.y = -0.72;
  collar.rotation.x = Math.PI / 2;
  collar.scale.set(1, 1, 0.55);
  g.add(collar);
  // crown for rulers
  if (rank >= 3) {
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.5, 0.15, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xd8b25a, roughness: 0.28, metalness: 0.85, side: THREE.DoubleSide }));
    crown.position.y = 0.54;
    g.add(crown);
  }
  // a scar is a story
  if (c.traits?.includes('scarred') || c.traits?.includes('wounded')) {
    const sc2 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.20, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x8a4a3a, roughness: 0.7 }));
    sc2.position.set(-0.19, 0.06, 0.40); sc2.rotation.z = 0.35;
    g.add(sc2);
  }
  return g;
}

const cacheImg = new Map();

/** Render `c`'s portrait into a 2D canvas element. */
export function renderPortrait(c, canvas2d, opts = {}) {
  if (!c || !canvas2d) return;
  ensure();
  const key = `${c.id}|${c._ageCache | 0}|${(c.traits || []).join(',')}|${c._rank || 0}|${opts.size || 0}`;
  const ctx = canvas2d.getContext('2d');
  if (cacheImg.has(key)) { blit(ctx, cacheImg.get(key), canvas2d); return; }

  while (rig.children.length) rig.remove(rig.children[0]);
  const p = faceParams(c);
  rig.add(buildHead(p, c));
  rig.rotation.y = opts.yaw ?? (((c.faceSeed ?? 0) % 100) / 100 - 0.5) * 0.42;
  rig.position.y = 0.30;
  rr.setClearColor(0x000000, 0);
  rr.render(sc, cam);
  const img = document.createElement('canvas');
  img.width = img.height = SIZE;
  img.getContext('2d').drawImage(rr.domElement, 0, 0);
  if (cacheImg.size > 220) cacheImg.clear();
  cacheImg.set(key, img);
  blit(ctx, img, canvas2d);
}

function blit(ctx, img, canvas2d) {
  const w = canvas2d.width, h = canvas2d.height;
  ctx.clearRect(0, 0, w, h);
  // candle-lit vignette behind the head
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, w * 0.05, w * 0.5, h * 0.5, w * 0.72);
  g.addColorStop(0, '#37281a'); g.addColorStop(1, '#100b07');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
}
export function clearPortraitCache() { cacheImg.clear(); }
