// 3D portraits. One shared offscreen WebGL renderer sculpts a parametric head and
// blits it into any 2D canvas you hand it, so a court of eighty faces costs one
// GL context instead of eighty.
//
// A face has to carry age, blood and mood, because the game asks you to spend
// people — and you cannot spend what you cannot picture.
//
// Everything here is procedural: no textures, no downloads. Readability at 52px
// is the design constraint, so the heavy lifting is done by (a) silhouette —
// hair, beard, headgear — and (b) baked vertex-colour shading in the eye
// sockets, under the brow, along the nasolabial fold. Fine geometry that only
// survives at 300px is a waste of a frame.

import * as THREE from '../../vendor/three.module.js';
import { hashStr, mulberry32 } from '../core/rng.js';

const SIZE = 320;
// Cached blits are stored smaller than they are rendered: the UI never shows a
// portrait above ~96px, and a court of eighty full-size canvases is 80MB of
// texture memory sitting behind a 3D map.
const CACHE_SIZE = 224;
const CACHE_MAX = 130;
let rr = null, sc = null, cam = null, rig = null, L = null;

function ensure() {
  if (rr) return;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  rr = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
  rr.setPixelRatio(1);
  rr.setSize(SIZE, SIZE, false);
  rr.outputColorSpace = THREE.SRGBColorSpace;
  rr.toneMapping = THREE.ACESFilmicToneMapping;
  rr.toneMappingExposure = 1.10;

  sc = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(30, 1, 0.4, 20);
  cam.position.set(0, 0, 3.14);
  cam.lookAt(0, 0, 0);

  // Candle from the upper left, cold window behind the right shoulder, and
  // almost nothing else — half the face is supposed to be gone.
  L = {};
  L.key = new THREE.DirectionalLight(0xffd2a2, 3.9); L.key.position.set(-2.15, 1.85, 2.35); sc.add(L.key);
  L.fill = new THREE.DirectionalLight(0x9e8f80, 0.52); L.fill.position.set(2.4, 0.1, 2.4); sc.add(L.fill);
  L.rim = new THREE.DirectionalLight(0x9dbdff, 2.3); L.rim.position.set(2.9, 1.2, -1.7); sc.add(L.rim);
  L.amb = new THREE.HemisphereLight(0x6a5540, 0x241a12, 1.35); sc.add(L.amb);
  L.bounce = new THREE.DirectionalLight(0x8a5230, 0.65); L.bounce.position.set(-0.5, -2.2, 1.4); sc.add(L.bounce);
  L.eye = new THREE.PointLight(0xfff0d0, 0.6, 7); L.eye.position.set(-0.7, 0.5, 2.4); sc.add(L.eye);

  rig = new THREE.Group(); sc.add(rig);
}

// Materials are pooled and reused. Creating (and disposing) a MeshStandardMaterial
// per portrait evicts three.js's compiled program and forces a full PBR shader
// recompile on the next face — which on SwiftShader costs ~300ms each. One
// instance per slot, mutated in place, keeps a portrait at a few milliseconds.
const MATS = new Map();
function M(key, fixed, live) {
  let m = MATS.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial(fixed); MATS.set(key, m); }
  if (live) {
    if (live.color !== undefined) m.color.set(live.color);
    if (live.roughness !== undefined) m.roughness = live.roughness;
    if (live.metalness !== undefined) m.metalness = live.metalness;
    if (live.emissive !== undefined) m.emissive.set(live.emissive);
  }
  return m;
}
function MB(key, color) {
  let m = MATS.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); MATS.set(key, m); }
  else m.color.set(color);
  return m;
}

// ---------------------------------------------------------------- palettes
const SKIN = [
  0xfadcc0, 0xf3d2b6, 0xead9c0 & 0xffffff, 0xecc6a4, 0xe0b491, 0xd6a880, 0xcb9d76,
  0xc9946a, 0xbc8a63, 0xb07e57, 0xad7a52, 0x9c6b48, 0x8a5c3e, 0x7a5138,
  0x744c34, 0x684434, 0x5b3c2e,
];
const HAIR = [
  0x0e0a08, 0x140f0c, 0x1c1310, 0x241914, 0x2a1a12, 0x33200f, 0x3a2416,
  0x4d301b, 0x63401f, 0x7a542c, 0x8c6634, 0x94703c, 0xa9803f, 0xb08e4e,
  0xc9ab68, 0x6a5b4a, 0x8f7d63, 0x9a3c1c,
];
const EYE = [0x2e2116, 0x3b2a1a, 0x4a3320, 0x5c4526, 0x6b5a3a, 0x2f4a52, 0x3f5a4a,
  0x4a6470, 0x59606a, 0x7a6a4a, 0x35402e];

// Culture drives cloth, headgear and how hair is worn. A Turkish bey and a
// Greek aristocrat must not wear the same collar.
const CULT = {
  turkish:  { cloth: [0x6e2c26, 0x2e3c62, 0x74551d, 0x40352a, 0x5a3320], trim: 0xc9a34e,
              capM: ['kalpak', 'turban', 'kalpak', 'none', 'sharp'], capF: ['scarf', 'scarf', 'veil'],
              fur: 0x4b3b2c, beardy: 0.72, longM: 0.34 },
  greek:    { cloth: [0x3b2f66, 0x6a1f38, 0x22384a, 0x4a4436, 0x2a2a34], trim: 0xd8b25a,
              capM: ['none', 'pillbox', 'none', 'pillbox', 'none'], capF: ['veil', 'wimple', 'veil'],
              fur: 0x59493a, beardy: 0.66, longM: 0.10 },
  armenian: { cloth: [0x5c2420, 0x38402e, 0x6a4a20, 0x3a2c30, 0x4a3a2a], trim: 0xb08a3a,
              capM: ['cone', 'turban', 'cone', 'none', 'cone'], capF: ['scarf', 'veil', 'scarf'],
              fur: 0x4a3c30, beardy: 0.80, longM: 0.16 },
  kurdish:  { cloth: [0x4a3a20, 0x2d4030, 0x6a3a2a, 0x3a3428, 0x55401c], trim: 0x9a7a3a,
              capM: ['turban', 'wrap', 'turban', 'kalpak', 'none'], capF: ['scarf', 'scarf', 'scarf'],
              fur: 0x453729, beardy: 0.84, longM: 0.12 },
  bulgar:   { cloth: [0x38402e, 0x4b3a2c, 0x2a3844, 0x574434, 0x3a3a3a], trim: 0x8a7a5a,
              capM: ['kalpak', 'none', 'fur', 'kalpak', 'none'], capF: ['scarf', 'veil', 'scarf'],
              fur: 0x6a5a48, beardy: 0.70, longM: 0.40 },
};
const cultOf = (c) => CULT[c?.culture] || CULT.turkish;

// ---------------------------------------------------------------- expression
// Traits are the game's moral vocabulary; the face is where the player reads
// them without opening a panel.
function moodOf(c, age) {
  const T = new Set(c.traits || []);
  const m = { brow: 0, browIn: 0, open: 1, gaze: 0, smile: 0, chin: 0, turn: 0, asym: 0, clench: 0, pallor: 0, hollow: 0 };
  const add = (o) => { for (const k in o) m[k] += o[k]; };
  if (T.has('wrathful'))   add({ browIn: 1.0, open: -0.20, smile: -0.55, clench: 0.8, chin: -0.05 });
  if (T.has('vengeful'))   add({ browIn: 0.6, smile: -0.35, gaze: 0.18, clench: 0.35 });
  if (T.has('arbitrary'))  add({ browIn: 0.35, smile: -0.20, chin: 0.20 });
  if (T.has('craven'))     add({ brow: 0.75, browIn: -0.85, open: 0.24, gaze: 0.60, smile: -0.30, chin: -0.28, turn: 0.30 });
  if (T.has('shy'))        add({ brow: 0.20, open: -0.06, gaze: 0.38, chin: -0.22, turn: 0.26 });
  if (T.has('paranoid'))   add({ open: -0.10, gaze: 0.45, browIn: 0.25, turn: 0.12 });
  if (T.has('deceitful'))  add({ asym: 0.75, smile: 0.30, open: -0.12, gaze: 0.22 });
  if (T.has('arrogant'))   add({ chin: 0.55, open: -0.16, smile: -0.10, brow: -0.10 });
  if (T.has('ambitious'))  add({ chin: 0.22, browIn: 0.15 });
  if (T.has('humble'))     add({ chin: -0.30, brow: 0.10, smile: 0.12 });
  if (T.has('content'))    add({ smile: 0.50, open: -0.06 });
  if (T.has('calm'))       add({ smile: 0.16, open: -0.05 });
  if (T.has('gregarious')) add({ smile: 0.70, open: 0.05 });
  if (T.has('generous'))   add({ smile: 0.35 });
  if (T.has('greedy'))     add({ smile: -0.10, open: -0.08, gaze: 0.15 });
  if (T.has('brave'))      add({ chin: 0.20, browIn: 0.22 });
  if (T.has('zealous'))    add({ brow: 0.30, open: 0.12, chin: 0.15 });
  if (T.has('cynical'))    add({ asym: 0.45, brow: -0.18, smile: -0.15 });
  if (T.has('humbled'))    add({ chin: -0.48, brow: 0.32, browIn: -0.50, smile: -0.50, turn: 0.15 });
  if (T.has('victorious')) add({ chin: 0.32, smile: 0.35, browIn: 0.15 });
  if (T.has('patient'))    add({ open: -0.12 });
  if (T.has('impatient'))  add({ browIn: 0.30, open: 0.06 });
  if (T.has('lustful'))    add({ smile: 0.25, open: -0.14, asym: 0.30 });
  if (T.has('chaste'))     add({ smile: -0.05, open: -0.05 });
  if (T.has('honest'))     add({ gaze: -0.20, chin: 0.08 });
  if (T.has('trusting'))   add({ brow: 0.12, smile: 0.18 });
  if (T.has('poet'))       add({ brow: 0.12, asym: 0.22 });
  if (T.has('schemer'))    add({ gaze: 0.30, open: -0.10, asym: 0.25 });
  if (T.has('slow'))       add({ open: -0.08, smile: 0.10, chin: -0.10 });
  if (T.has('genius') || T.has('intelligent')) add({ brow: 0.10, open: 0.05 });
  if (T.has('ill'))        add({ open: -0.24, brow: 0.20, browIn: -0.30, smile: -0.30, pallor: 0.55, hollow: 0.4 });
  if (T.has('pox'))        add({ open: -0.20, smile: -0.25, pallor: 0.70, hollow: 0.35 });
  if (T.has('wounded'))    add({ open: -0.22, browIn: 0.35, smile: -0.35, pallor: 0.45, hollow: 0.3 });
  if (T.has('frail'))      add({ open: -0.10, pallor: 0.28, hollow: 0.45 });
  if (T.has('excommunicated')) add({ smile: -0.25, brow: 0.15, pallor: 0.15 });
  if (T.has('kinslayer'))  add({ gaze: 0.20, browIn: 0.30, smile: -0.20 });
  if (T.has('pregnant'))   add({ smile: 0.15 });
  // The old do not hold their eyes as wide as the young.
  m.open -= Math.max(0, (age - 45) / 100);
  if (age < 14) { m.open += 0.10; m.smile += 0.15; m.chin -= 0.08; }
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  m.brow = cl(m.brow, -0.6, 1.0); m.browIn = cl(m.browIn, -1, 1.2);
  m.open = cl(m.open, 0.45, 1.35); m.gaze = cl(m.gaze, -0.4, 0.85);
  m.smile = cl(m.smile, -0.9, 1.0); m.chin = cl(m.chin, -0.6, 0.7);
  m.turn = cl(m.turn, 0, 0.5); m.asym = cl(m.asym, 0, 1);
  m.clench = cl(m.clench, 0, 1); m.pallor = cl(m.pallor, 0, 1); m.hollow = cl(m.hollow, 0, 1);
  return m;
}

// ---------------------------------------------------------------- parameters
function faceParams(c) {
  const base = (c.faceSeed ?? hashStr(String(c.id || 'x'))) >>> 0;
  const r = mulberry32(base ^ 0x9e3779b9);
  const rr2 = mulberry32((base * 3 + 17) >>> 0);
  const age = Math.max(0, c._ageCache ?? 30);
  const male = c.sex !== 'f';
  const dead = c.deathDay != null;
  const T = new Set(c.traits || []);
  const cu = cultOf(c);
  const m = moodOf(c, age);

  // Age curves. The face is round until ~20, hardens to ~45, then sags.
  const young = 1 - Math.min(1, Math.max(0, (age - 5) / 17));           // 1 at 5, 0 at 22
  const old = Math.min(1, Math.max(0, (age - 38) / 34));                // 0 at 38, 1 at 72
  const grey = Math.min(1, Math.max(0, (age - 32) / 36));

  // Skin tone: a wide but culture-weighted band, so a court is not one colour.
  const skinBias = { turkish: 0.26, greek: 0.14, armenian: 0.22, kurdish: 0.38, bulgar: 0.04 }[c.culture] ?? 0.24;
  let si = Math.floor((r() * 0.86 + skinBias * 0.60) * SKIN.length);
  si = Math.max(0, Math.min(SKIN.length - 1, si));
  const hairBias = { greek: 0.04, bulgar: 0.34, armenian: 0.04, turkish: 0.14, kurdish: 0.06 }[c.culture] ?? 0.12;
  let hi = Math.floor((Math.pow(r(), 1.35) * 0.92 + hairBias * 0.55) * HAIR.length);
  hi = Math.max(0, Math.min(HAIR.length - 1, hi));
  // Hair the same value as the skin makes a head look shaved from across the
  // room. Force them apart before anything else is decided.
  const lum = (h) => (((h >> 16) & 255) * 0.299 + ((h >> 8) & 255) * 0.587 + (h & 255) * 0.114) / 255;
  if (hi < 15 && Math.abs(lum(SKIN[si]) - lum(HAIR[hi])) < 0.24) {
    hi = lum(HAIR[hi]) <= lum(SKIN[si]) ? Math.max(0, hi - 5) : Math.min(14, hi + 5);
  }

  const beauty = T.has('beautiful') ? 1 : 0;
  const fem = male ? 0 : 1;
  const p = {
    r, age, male, dead, T, cu, m, young, old, grey, beauty,
    skin: SKIN[si], hair: HAIR[hi], eyeCol: EYE[Math.floor(r() * EYE.length)],
    skinLum: lum(SKIN[si]),

    // --- skull proportions. This is where two people stop looking alike. ---
    W: 0.372 * (0.85 + r() * 0.32) * (male ? 1.04 : 0.97),
    H: 0.552 * (0.91 + r() * 0.19),
    D: 0.482 * (0.88 + r() * 0.26),
    craniumW: r(),                 // 0 narrow skull, 1 broad
    occiput: 0.2 + r() * 0.9,      // how far the back of the head runs
    faceLong: (r() - 0.5) * 1.35,  // long face vs short
    skew: (r() - 0.5) * 1.0,       // nobody's face is symmetric
    forehead: (r() - 0.45) * (male ? 1.1 : 0.7),   // + = upright, - = sloped back
    jawWide: r() * (male ? 1 : 0.66),
    jawAngle: (0.35 + r() * 0.65) * (male ? 1.18 : 0.60),
    chinFwd: (0.25 + r() * 0.95) * (male ? 1 : 0.82),
    chinCleft: r() < 0.22 ? 0.6 + r() * 0.5 : 0,
    cheekbone: (0.30 + r() * 1.0) * (male ? 1 : 1.14),
    browRidge: (0.35 + r() * 0.85) * (male ? 1.25 : 0.55),
    temple: r(),

    // --- eyes ---
    eyeX: 0.378 + r() * 0.135,
    eyeY: -0.005 + (r() - 0.5) * 0.05,
    eyeR: (0.058 + r() * 0.013) * (male ? 1 : 1.07),
    eyeTilt: (r() - 0.45) * 0.30,      // + = outer corner up
    socket: 0.45 + r() * 0.75,
    lidHeavy: r(),

    // --- nose: the single strongest identity cue in a small portrait ---
    noseLen: (0.60 + r() * 0.66) * (male ? 1.04 : 0.84),
    noseW: (0.66 + r() * 0.80) * (male ? 1 : 0.86),
    noseHook: (r() - 0.42) * 1.75,     // + = aquiline, - = snub
    noseTipDown: (r() - 0.4) * 0.9,
    bridgeW: 0.7 + r() * 0.7,

    // --- mouth ---
    mouthW: (0.72 + r() * 0.60) * (male ? 1.04 : 0.94),
    lipUpper: (0.55 + r() * 0.85) * (male ? 0.92 : 1.30),
    lipLower: (0.70 + r() * 0.80) * (male ? 0.92 : 1.32),
    mouthY: -0.545 + (r() - 0.5) * 0.105,

    // --- hair / beard ---
    hairStyle: Math.floor(r() * 6),
    hairline: 0.46 + r() * 0.16,
    hairVol: 0.55 + r() * 0.9,
    part: (r() - 0.5) * 0.9,
    longHair: r(),
    beardStyle: 0,
    beardLen: 0,
    baldness: r(),
    browThick: (0.55 + r() * 0.8) * (male ? 1.25 : 0.68),
    browHigh: (r() - 0.5) * 0.05 + fem * 0.026,
    browArch: r(),
    earSize: 0.8 + r() * 0.5,

    // --- dress ---
    cloth: cu.cloth[Math.floor(rr2() * cu.cloth.length)],
    cap: 'none',
    capCol: 0,
    rank: Math.max(0, Math.min(4, c._rank ?? 0)),
    rr2,
  };

  // A child is not a small adult: the cranium runs ahead of the face.
  if (p.young > 0) {
    const y0 = p.young;
    p.eyeY -= y0 * 0.055;
    p.eyeR *= 1 + y0 * 0.13;
    p.eyeX *= 1 - y0 * 0.03;
    p.noseLen *= 1 - y0 * 0.42;
    p.noseW *= 1 - y0 * 0.10;
    p.noseHook *= 1 - y0 * 0.7;
    p.chinFwd *= 1 - y0 * 0.45;
    p.jawAngle *= 1 - y0 * 0.55;
    p.jawWide *= 1 - y0 * 0.35;
    p.browThick *= 1 - y0 * 0.42;
    p.browRidge *= 1 - y0 * 0.75;
    p.H *= 1 - y0 * 0.05;
    p.mouthY += y0 * 0.030;
    p.hairline -= y0 * 0.05;
    p.socket *= 1 - y0 * 0.35;
  }

  // Beards: a Kurdish elder and a young Greek courtier cannot share a chin.
  if (male && age >= 15) {
    const want = cu.beardy * (0.35 + Math.min(0.85, (age - 13) / 26)) + (T.has('zealous') ? 0.2 : 0) - (T.has('lustful') ? 0.1 : 0);
    const q = r();
    if (age < 18) p.beardStyle = q < 0.45 ? 1 : 0;
    else if (q > want) p.beardStyle = q > want + 0.22 ? 0 : 1;             // shaven / stubble
    else if (q < want * 0.30) p.beardStyle = 2;                            // moustache
    else if (q < want * 0.62) p.beardStyle = 3;                            // short beard
    else p.beardStyle = age > 46 && r() < 0.55 ? 5 : 4;                    // full / long
    p.beardLen = [0, 0, 0.10, 0.30, 0.52, 0.86][p.beardStyle];
  }

  // Headgear. Rank and faith are supposed to be legible at 52 pixels.
  const list = male ? cu.capM : cu.capF;
  p.cap = list[Math.floor(rr2() * list.length)];
  if (male) {
    if (c.faith === 'sunni' && rr2() < 0.42) p.cap = 'turban';
    if (age < 15) p.cap = rr2() < 0.5 ? 'none' : p.cap;
    if (p.rank >= 2 && T.has('victorious') && rr2() < 0.40) p.cap = 'helmet';
  } else {
    if (age < 13) p.cap = rr2() < 0.6 ? 'none' : 'scarf';
    if (p.rank >= 3 && rr2() < 0.5) p.cap = 'veil';
  }
  const capPal = [0xbcb298, 0x9e937a, 0x3a4a3a, 0x5a2a28, 0x2c3450, 0x6a5a3a, 0x7d2c2c, 0x2a2a2c,
    0x4a3a2a, 0x7a6c4c, 0x33404a, 0x6a3d2a, 0x54402e, 0x2f3a2c];
  p.capCol = capPal[Math.floor(rr2() * capPal.length)];
  if (p.cap === 'turban' && c.faith === 'sunni' && rr2() < 0.3) p.capCol = 0x2f5a3c;   // green: a hajj
  // A hat the same value as the face turns a head bald from across the room.
  {
    const sl = lum(SKIN[si]);
    const cl = lum(p.capCol);
    if (Math.abs(cl - sl) < 0.20) {
      const target = sl > 0.46 ? sl - 0.27 : sl + 0.27;
      const f = Math.max(0.30, Math.min(2.4, target / Math.max(0.05, cl)));
      const cc = new THREE.Color(p.capCol).multiplyScalar(f);
      p.capCol = cc.getHex();
    }
  }
  if (p.dead) { p.m.open = 0.02; p.m.smile = -0.10; p.m.gaze = 0; p.m.brow = 0; p.m.browIn = 0; p.m.chin = -0.12; }
  return p;
}

// ---------------------------------------------------------------- sculpting
const g2 = (d, s) => Math.exp(-(d * d) / (s * s));

/** The sculpted skull surface for a unit-sphere direction. Hair, beard and
 *  headgear ride on this same surface, so nothing ever floats. */
function sculpt(x, y, z, p, out) {
  const fz = Math.max(0, z);
  const ax = Math.abs(x);
  const sgn = x < 0 ? -1 : 1;
  // feature band shifted for long/short faces
  const fy = y + p.faceLong * 0.07 * (1 - y * y);

  let W = p.W, H = p.H, D = p.D;
  // cranium breadth above the eyes, and a flatter crown than a sphere gives
  const up = Math.max(0, fy);
  W *= 1 + up * up * (p.craniumW - 0.5) * 0.32 + up * 0.10;
  H *= 1 - Math.pow(up, 6) * 0.10;
  // the old face shrinks and the flesh slides off it
  W *= 1 - p.old * 0.045; H *= 1 - p.old * 0.020;
  // baby heads are big-cranium, small-jaw
  W *= 1 + up * up * p.young * 0.10;

  // jaw taper
  const dn = Math.max(0, -fy);
  const jt = Math.pow(dn, 1.35);
  W *= 1 - jt * (0.44 - p.jawWide * 0.36 + p.young * 0.06);
  D *= 1 - jt * (0.15 - p.jawWide * 0.05);
  // occiput
  if (z < 0) D *= 1 + (-z) * p.occiput * 0.10;

  let ox = x * W, oy = fy * H, oz = z * D;

  // brow ridge
  const brow = g2(fy - 0.205, 0.14) * g2(ax, 0.62) * fz * fz;
  oz += brow * p.browRidge * 0.052 * (1 - p.young * 0.7);
  // forehead slope
  if (fy > 0.30) oz += (fy - 0.30) * p.forehead * 0.055 * fz;

  // eye sockets — the darkest, most important hollow on the face
  const sd = (p.socket * 0.062 + p.old * 0.034 + p.m.hollow * 0.022) * (p.male ? 1.18 : 0.88);
  const dx = (ax - p.eyeX) / 0.215, dy = (fy - p.eyeY - 0.02) / 0.145;
  const sock = Math.exp(-(dx * dx + dy * dy) * 1.05) * fz;
  oz -= sock * sd;

  // nose: bridge, tip, wings
  const t = Math.min(1, Math.max(0, (0.245 - fy) / 0.545));
  let prof = t * t * (3 - 2 * t);
  prof *= 1 - Math.max(0, (fy + 0.300) * -14);                      // dies below the base
  prof = Math.max(0, prof + p.noseHook * Math.sin(Math.PI * t) * 0.30);
  const bw = 0.040 + 0.055 * p.bridgeW * (0.35 + prof * 0.75);
  const bridge = g2(x, bw) * Math.max(0, fz);
  oz += bridge * prof * p.noseLen * 0.086;
  // a distinct ball at the tip: without it the nose is a flat ramp
  const tipM = g2(x, 0.100) * g2(fy + 0.268, 0.070) * fz;
  oz += tipM * (0.026 + p.noseLen * 0.016);
  oy -= bridge * prof * prof * p.noseTipDown * 0.030;
  const wing = g2(ax - 0.145 * p.noseW, 0.075) * g2(fy + 0.298, 0.075) * fz;
  oz += wing * 0.055 * p.noseW; ox += sgn * wing * 0.030 * p.noseW;
  // nostril shadow line under the tip
  const sub = g2(fy + 0.352, 0.045) * g2(x, 0.16) * fz;
  oz -= sub * 0.020;

  // cheekbone and the hollow under it
  const cb = g2(ax - 0.545, 0.235) * g2(fy - 0.010, 0.22) * fz;
  ox += sgn * cb * p.cheekbone * 0.042; oz += cb * p.cheekbone * 0.048;
  const hol = g2(ax - 0.435, 0.20) * g2(fy + 0.330, 0.19) * fz;
  const holA = p.old * 0.95 + p.m.hollow * 0.6 + (1 - p.young) * 0.1;
  ox -= sgn * hol * holA * 0.038; oz -= hol * holA * 0.048;
  // young faces carry fat where old faces carry shadow
  const chub = g2(ax - 0.40, 0.28) * g2(fy + 0.270, 0.26) * fz;
  ox += sgn * chub * p.young * 0.035; oz += chub * p.young * 0.030;

  // masseter / clenched jaw
  const gon = g2(ax - 0.615, 0.185) * g2(fy + 0.520, 0.20);
  ox += sgn * gon * (p.jawAngle * 0.030 + p.m.clench * 0.028);
  // jowls
  const jw = g2(ax - 0.430, 0.22) * g2(fy + 0.650, 0.19) * fz;
  ox += sgn * jw * p.old * 0.050; oz += jw * p.old * 0.032; oy -= jw * p.old * 0.034;

  // mouth platform, then chin
  const muz = g2(x, 0.34) * g2(fy - p.mouthY, 0.20) * fz;
  oz += muz * 0.022;
  const chin = g2(x, 0.24) * g2(fy + 0.845, 0.155) * fz;
  oz += chin * p.chinFwd * 0.058;
  if (p.chinCleft) oz -= g2(x, 0.055) * g2(fy + 0.845, 0.11) * fz * p.chinCleft * 0.022;

  // temples sink; the old lose them first
  const tp = g2(ax - 0.720, 0.20) * g2(fy - 0.330, 0.22);
  ox -= sgn * tp * (p.temple * 0.020 + p.old * 0.060);

  oy += x * p.skew * 0.014;                   // a hair of asymmetry, felt not seen
  out.set(ox, oy, oz);
  return { sock, brow, bridge: bridge * prof, hol, cb, chin, gon, jw, wing, t };
}

const SCRATCH = new THREE.Vector3();

/** A shell that rides the skull: hair, beard, veil. `mask` returns an outward
 *  offset; anything <= 0 is tucked inside the skull and simply never seen. */
function shell(p, wseg, hseg, mask, mat) {
  const g = new THREE.SphereGeometry(1, wseg, hseg);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3(), o = SCRATCH;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const mo = mask(v.x, v.y, v.z);
    const off = typeof mo === 'number' ? mo : mo.off;
    const shade = typeof mo === 'number' ? 1 : mo.shade;
    sculpt(v.x, v.y, v.z, p, o);
    if (off > 0) { o.x += v.x * off; o.y += v.y * off; o.z += v.z * off; }
    else { o.multiplyScalar(0.86); }
    pos.setXYZ(i, o.x, o.y, o.z);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// ---------------------------------------------------------------- the head
function buildSkull(p) {
  const g = new THREE.SphereGeometry(1, 56, 40);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3(), o = new THREE.Vector3();
  const base = new THREE.Color(p.skin);
  if (p.old) base.lerp(new THREE.Color(0xd8c6b4), p.old * 0.16);
  if (p.m.pallor) base.lerp(new THREE.Color(0xa8ab97), p.m.pallor * 0.54);
  if (p.dead) base.lerp(new THREE.Color(0x9aa0a0), 0.55);
  const beardMask = beardMaskFn(p);
  const spot = mulberry32((p.age * 7919 + 13) >>> 0);
  const pox = p.T.has('pox');

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const f = sculpt(v.x, v.y, v.z, p, o);
    pos.setXYZ(i, o.x, o.y, o.z);

    // Baked shading. This is what makes the face read at thumbnail size.
    let s = 1;
    s -= f.sock * 0.46;                                   // eye socket
    s -= f.brow * 0.12;                                   // under the ridge is dark
    s -= f.hol * (0.16 + p.old * 0.24 + p.m.hollow * 0.18);
    s += f.cb * 0.10;                                     // cheekbone catches light
    s += f.chin * 0.06;
    s -= f.wing * 0.20;
    const ax = Math.abs(v.x), fy = v.y;
    // the nose is modelled with light, not polygons: a groove down each side,
    // two nostril marks, and a lit ridge — a bare ramp reads as a mask
    const noseSide = g2(ax - 0.115 * p.noseW - 0.045, 0.055) * g2(fy + 0.215, 0.145) * Math.max(0, v.z);
    s -= noseSide * 0.26;
    const nostril = g2(ax - 0.085 * p.noseW, 0.042) * g2(fy + 0.325, 0.040) * Math.max(0, v.z);
    s -= nostril * 0.42;
    s += f.bridge * 0.14;
    s -= g2(fy + 0.355, 0.034) * g2(v.x, 0.095) * Math.max(0, v.z) * 0.26;  // under the tip
    // nasolabial fold: the line that says thirty-five, not eighteen
    const fold = g2(ax - 0.255 - 0.05 * f.t, 0.075) * g2(fy + 0.430, 0.150) * Math.max(0, v.z);
    s -= fold * (0.10 + p.old * 0.30) * (1 - p.young * 0.8);
    // under the lower lip and beneath the jaw
    s -= g2(v.x, 0.28) * g2(fy + 0.665, 0.075) * Math.max(0, v.z) * 0.22;
    s -= Math.max(0, -v.y - 0.55) * 0.55;                 // under-jaw shadow
    s -= g2(ax - 0.72, 0.20) * g2(fy - 0.33, 0.24) * (0.06 + p.old * 0.14);
    // crow's feet, and the marionette lines from the mouth corners down
    s -= g2(ax - 0.50, 0.11) * g2(fy - 0.02, 0.10) * Math.max(0, v.z) * p.old * 0.30;
    s -= g2(ax - 0.20, 0.055) * g2(fy + 0.700, 0.13) * Math.max(0, v.z) * p.old * 0.26;
    s -= g2(ax - 0.62, 0.14) * g2(fy + 0.560, 0.16) * Math.max(0, v.z) * p.old * 0.18;
    // forehead lines
    if (p.old > 0.15) s -= Math.max(0, Math.sin((fy - 0.30) * 46)) * g2(fy - 0.40, 0.13) * g2(ax, 0.55) * Math.max(0, v.z) * p.old * 0.13;

    const c2 = base.clone();
    // warmth where blood sits: cheeks, nose, ears, lips
    const blush = g2(ax - 0.44, 0.24) * g2(fy + 0.16, 0.22) * Math.max(0, v.z);
    const tip = f.bridge * Math.max(0, f.t - 0.55) * 2;
    c2.offsetHSL(0, (blush * 0.10 + tip * 0.10) * (1 - p.m.pallor * 0.8), -blush * 0.012);
    // beard shadow: half the reason a man reads as a man
    if (p.male && p.beardStyle >= 1) {
      const bm = beardMask(v.x, v.y, v.z);
      if (bm > 0) c2.lerp(new THREE.Color(p.hair), Math.min(0.55, bm * (p.beardStyle === 1 ? 0.34 : 0.5)));
    }
    if (pox) {
      const n = spot();
      if (n > 0.80 && Math.max(0, v.z) > 0.25) s -= 0.30;
    }
    if (p.old > 0.4 && spot() > 0.985) s -= 0.14;         // liver spots

    s = Math.max(0.32, Math.min(1.18, s));
    col[i * 3] = c2.r * s; col[i * 3 + 1] = c2.g * s; col[i * 3 + 2] = c2.b * s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = M('skin', { vertexColors: true, metalness: 0 },
    { roughness: 0.62 + p.old * 0.18 - p.beauty * 0.10 });
  return new THREE.Mesh(g, mat);
}

// ---------------------------------------------------------------- eyes
// The eye is an almond opening bounded by two lid arcs, not a ball with lids
// laid over it: at 52 pixels what you actually see is a pale slit, a dark iris
// and a dark line above it, and that reading must survive every parameter.
function buildEyes(p, parent) {
  const o = new THREE.Vector3();
  const openU = Math.max(0, Math.min(1.30, p.m.open - p.lidHeavy * 0.12 - p.old * 0.22));
  const closed = p.dead || openU < 0.16;
  const white = M('eyeW', { metalness: 0 }, { color: p.dead ? 0x86837b : 0xb5aa97, roughness: 0.34 });
  const irisM = M('iris', { metalness: 0 }, { color: p.eyeCol, roughness: 0.52 });
  const pupM = M('pupil', { metalness: 0 }, { color: 0x080606, roughness: 0.2 });
  const lidCol = new THREE.Color(p.skin).multiplyScalar(0.90);
  if (p.dead) lidCol.lerp(new THREE.Color(0x9aa0a0), 0.55);
  const lidM = M('lid', { metalness: 0 }, { color: lidCol, roughness: 0.66 });
  const lashM = M('lash', { metalness: 0 }, { color: 0x110d09, roughness: 0.9 });
  const lowM = M('lidLow', { metalness: 0 }, { color: new THREE.Color(p.skin).multiplyScalar(0.55), roughness: 0.8 });
  const R = p.eyeR;
  const hh = R * (0.20 + 0.44 * Math.min(1.30, openU));       // half-height of the opening

  for (const s of [-1, 1]) {
    sculpt(s * p.eyeX, p.eyeY + 0.02, 0.86, p, o);
    const g = new THREE.Group();
    g.position.set(o.x, o.y, o.z + 0.006);
    g.rotation.y = -s * 0.22;                                  // the eye wraps the skull
    g.rotation.z = s * p.eyeTilt;

    if (!closed) {
      const sc = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), white);
      sc.scale.set(R * 1.44, hh, R * 0.34);
      g.add(sc);
      const gx = (s * p.m.gaze * 0.34 - p.m.gaze * 0.12) * R * 0.62;
      const irR = Math.min(R * 0.74, hh * 1.12);
      const ir = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), irisM);
      ir.scale.set(irR, irR, R * 0.20);
      ir.position.set(gx, -R * 0.02, R * 0.20);
      g.add(ir);
      const pu = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), pupM);
      pu.scale.set(irR * 0.44, irR * 0.44, R * 0.14);
      pu.position.set(gx, -R * 0.02, R * 0.27);
      g.add(pu);
      const gl = new THREE.Mesh(new THREE.SphereGeometry(irR * 0.17, 8, 6), MB('glint', 0xe8dcc4));
      gl.position.set(gx - irR * 0.44, irR * 0.44, R * 0.30);
      g.add(gl);
    } else {
      const lid = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), lidM);
      lid.scale.set(R * 1.44, Math.max(hh, R * 0.30), R * 0.32);
      g.add(lid);
    }
    // upper lid edge: the single darkest mark on the face, and the one that
    // makes a thumbnail read as a person looking back at you
    const lash = new THREE.Mesh(new THREE.TorusGeometry(R * 1.42, R * 0.085, 6, 16, Math.PI), lashM);
    lash.scale.set(1, Math.max(0.24, (hh * 1.08) / (R * 1.42)), 0.40);
    lash.position.set(0, 0, R * 0.16);
    lash.rotation.x = -0.10;
    g.add(lash);
    const low = new THREE.Mesh(new THREE.TorusGeometry(R * 1.34, R * 0.050, 6, 16, Math.PI), lowM);
    low.scale.set(1, Math.max(0.20, (hh * 0.82) / (R * 1.34)), 0.38);
    low.position.set(0, 0, R * 0.14);
    low.rotation.set(0.10, 0, Math.PI);
    g.add(low);
    parent.add(g);
  }
}

// ---------------------------------------------------------------- brows
function buildBrows(p, parent) {
  const col = new THREE.Color(p.hair).lerp(new THREE.Color(p.skin), 0.16)
    .lerp(new THREE.Color(0x9e988c), p.grey * 0.62);
  // A brow the value of the skin is no brow at all, and a face with no brows
  // has no expression left in it.
  const bl = col.r * 0.299 + col.g * 0.587 + col.b * 0.114;
  if (bl > p.skinLum - 0.14) col.multiplyScalar(Math.max(0.42, (p.skinLum - 0.16) / Math.max(0.05, bl)));
  const mat = M('brow', { metalness: 0 }, { color: col, roughness: 0.94 });
  const o = new THREE.Vector3();
  for (const s of [-1, 1]) {
    const pts = [];
    const asym = s < 0 ? 1 : 1 - p.m.asym * 0.45;
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;                              // 0 inner, 1 outer
      const bx = s * (0.19 + u * 0.50);
      const inner = (1 - u);
      const by = p.eyeY + 0.190 + p.browHigh
        + p.m.brow * 0.038 * asym
        - p.m.browIn * 0.055 * inner * inner * asym
        + p.m.browIn * 0.012 * u
        + p.eyeTilt * u * 0.10
        + p.browArch * 0.035 * Math.sin(u * Math.PI) - p.old * 0.012;
      sculpt(bx, by, 0.9, p, o);
      pts.push(new THREE.Vector3(o.x * 0.995, o.y, o.z + 0.012));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const thick = 0.0158 * p.browThick * (1 + p.old * (p.male ? 0.75 : 0.15));
    const g = new THREE.TubeGeometry(curve, 12, thick, 6, false);
    // taper the outer end
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    const mesh = new THREE.Mesh(g, mat);
    mesh.scale.y = 0.85;
    parent.add(mesh);
  }
}

// ---------------------------------------------------------------- mouth
function buildMouth(p, parent) {
  const lipC = new THREE.Color(p.skin).multiplyScalar(0.76).lerp(new THREE.Color(0x7d4038), 0.40 - p.old * 0.10 + (p.male ? 0 : 0.12));
  if (p.m.pallor) lipC.lerp(new THREE.Color(0x9a8a86), p.m.pallor * 0.5);
  if (p.dead) lipC.lerp(new THREE.Color(0x8a8078), 0.55);
  const lipM = M('lip', { metalness: 0 }, { color: lipC, roughness: 0.50 });
  const lineM = M('lipLine', { metalness: 0 }, { color: new THREE.Color(lipC).multiplyScalar(0.09), roughness: 0.85 });
  const o = new THREE.Vector3();
  const halfW = 0.104 * p.mouthW;
  const cy = p.mouthY;

  const sample = (u, dy) => {                     // u in [-1,1] across the mouth
    const curve = -Math.pow(u, 2) * 0.011;
    const smile = p.m.smile * 0.062 * Math.pow(Math.abs(u), 1.5) * (u > 0 ? 1 : 1 - p.m.asym * 0.7);
    sculpt(u * halfW / p.W * 0.98, cy + curve + smile + dy, 0.92, p, o);
    return new THREE.Vector3(o.x, o.y, o.z + 0.006);
  };
  const mk = (dy, thick, sy, dz, mat) => {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const v = sample(-1 + i / 4, dy);
      v.z += dz;
      pts.push(v);
    }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, thick, 7, false);
    const m = new THREE.Mesh(g, mat || lipM);
    m.scale.y = sy;
    return m;
  };
  const thin = 1 - p.old * 0.55;
  // Offsets are derived from the tube radii, never fixed: with thin lips or a
  // wide mouth a constant gap leaves three separate red stripes.
  const tU = Math.max(0.0105, 0.0190 * p.lipUpper * thin);
  const tL = Math.max(0.0120, 0.0225 * p.lipLower * thin);
  parent.add(mk(tU * 0.72, tU, 0.80, 0));
  parent.add(mk(-tL * 0.76, tL, 0.92, 0.002));
  // the seam: the strongest single dark mark below the eyes
  parent.add(mk(-0.0016, 0.0098, 0.40, 0.0128, lineM));
}

// ---------------------------------------------------------------- ears
function buildEars(p, parent) {
  const c = new THREE.Color(p.skin).multiplyScalar(0.92);
  const mat = M('ear', { metalness: 0 }, { color: c, roughness: 0.7 });
  const o = new THREE.Vector3();
  for (const s of [-1, 1]) {
    sculpt(s * 0.96, -0.02, -0.05, p, o);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.082 * p.earSize, 12, 10), mat);
    e.position.set(o.x * 0.98, o.y, o.z + 0.02);
    e.scale.set(0.32, 1.25, 0.85);
    e.rotation.z = s * 0.16;
    parent.add(e);
  }
}

// ---------------------------------------------------------------- hair
// Six silhouettes per sex, because at a glance the outline is the whole face.
const HSTYLE_M = [
  { hl: 0.54, drop: 0.06, vol: 0.55, wave: 0.20, fall: 0, knot: 0 },   // cropped
  { hl: 0.45, drop: 0.30, vol: 0.95, wave: 0.35, fall: 0, knot: 0 },   // bowl
  { hl: 0.55, drop: 0.04, vol: 0.50, wave: 0.10, fall: 0, knot: 0 },   // high hairline
  { hl: 0.46, drop: 0.52, vol: 1.05, wave: 0.55, fall: 1, knot: 0 },   // long, loose
  { hl: 0.58, drop: -0.30, vol: 0.60, wave: 0.10, fall: 0, knot: 1 },  // shaved, top-knot
  { hl: 0.48, drop: 0.20, vol: 1.55, wave: 1.00, fall: 0, knot: 0 },   // thick curls
];
const HSTYLE_F = [
  { hl: 0.44, drop: 0.48, vol: 0.95, wave: 0.35, fall: 1, braid: 0 },
  { hl: 0.47, drop: 0.30, vol: 1.05, wave: 0.25, fall: 0, braid: 1 },
  { hl: 0.42, drop: 0.62, vol: 1.15, wave: 0.60, fall: 1, braid: 0 },
  { hl: 0.52, drop: 0.26, vol: 0.80, wave: 0.20, fall: 0, braid: 0 },
  { hl: 0.44, drop: 0.36, vol: 1.50, wave: 0.95, fall: 0, braid: 0 },
  { hl: 0.46, drop: 0.42, vol: 0.90, wave: 0.30, fall: 1, braid: 1 },
];
const hstyle = (p) => (p.male ? HSTYLE_M : HSTYLE_F)[p.hairStyle % 6];

function hairMaskFn(p) {
  const H = hstyle(p);
  const recede = p.male ? Math.min(1, p.old * (0.4 + p.baldness * 1.5)) : 0;
  const crownBald = p.male && p.baldness > 0.62 ? Math.min(1, (p.old - 0.15) * 1.6 * (p.baldness - 0.5) * 3) : 0;
  return (x, y, z) => {
    const ax = Math.abs(x);
    // the hairline dips in the middle and climbs at the temples
    let hl = H.hl + p.hairline * 0.10 + recede * 0.34
      - 0.055 * Math.cos(ax * 3.0) + (p.male ? 0 : -0.02);
    // Nobody goes bald without a reason: a hairline this high is only allowed
    // once age and baldness have earned it.
    hl = Math.min(hl, 0.54 + recede * 0.34);
    if (z < -0.10) hl = -0.55 - H.drop * 0.9;                    // the back is always covered
    let m = Math.max(0, Math.min(1, (y - hl) / 0.055));
    if (H.knot) {
      // shaved sides, but a broad band across the crown stays visible head-on
      m *= Math.max(0, Math.min(1, (ax < 0.52 ? 1 : 0) + (y - 0.66) * 4));
      m = Math.max(m, Math.max(0, Math.min(1, (y - 0.58) / 0.10)) * Math.max(0, Math.min(1, (0.55 - ax) / 0.2)));
    }
    // side hair only behind the cheek plane; over a cheek it reads as warpaint
    const back = Math.max(0, Math.min(1, (0.22 - z) / 0.26));
    const side = Math.max(0, Math.min(1, (ax - 0.60) / 0.20)) * back
      * Math.max(0, Math.min(1, (y + H.drop) / 0.30));
    m = Math.max(m, side);
    if (crownBald) m *= 1 - crownBald * Math.max(0, Math.min(1, (y - 0.42) / 0.30));
    if (m <= 0.02) return -1;
    const vol = (0.020 + p.hairVol * 0.030) * H.vol * (1 - p.old * 0.40);
    const partLine = g2(x - p.part * 0.35, 0.06) * Math.max(0, y - 0.55) * (H.vol < 1.2 ? 1 : 0.2);
    const wave = 0.009 * H.wave * Math.sin(ax * 13 + y * 8 + p.part * 4);
    const off = m * vol - partLine * 0.028 + wave;
    const shade = 0.52 + 0.48 * Math.max(0, y * 0.7 + z * 0.5) + wave * 14;
    return { off: Math.max(0.007, off), shade: Math.max(0.38, Math.min(1.02, shade)) };
  };
}

function buildHair(p, parent) {
  const H = hstyle(p);
  const col = new THREE.Color(p.hair).lerp(new THREE.Color(0x8e877d), p.grey * 0.92);
  if (p.dead) col.lerp(new THREE.Color(0x7e7e7a), 0.4);
  const mat = M('hair', { vertexColors: true, metalness: 0 }, { color: col, roughness: 0.93 });
  const totalBald = p.male && p.baldness > 0.86 && p.old > 0.7;
  const covered = p.cap === 'veil' || p.cap === 'wimple';
  if (!totalBald) parent.add(shell(p, 40, 30, hairMaskFn(p), mat));

  if (H.knot && !totalBald) {
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), mat);
    knot.position.set(0, p.H * 0.98, -0.06);
    knot.geometry.setAttribute('color', constColor(knot.geometry, 0.95));
    parent.add(knot);
  }
  // hair that falls sits behind the shoulders, not beside the cheeks
  if (H.fall && !covered) {
    const len = 0.34 + p.longHair * 0.42;
    const fall = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, len, 5, 14), mat);
    fall.position.set(0, -0.46 - len * 0.26, -0.30);
    fall.scale.set(1.10, 1, 0.55);
    fall.geometry.setAttribute('color', constColor(fall.geometry, 0.72));
    parent.add(fall);
  }
  if (H.braid && !covered) {
    for (const s of [-1, 1]) {
      const br = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.34 + p.longHair * 0.26, 4, 8), mat);
      br.position.set(s * 0.33, -0.50 - p.longHair * 0.10, -0.14);
      br.rotation.z = s * 0.14;
      br.geometry.setAttribute('color', constColor(br.geometry, 0.92));
      parent.add(br);
    }
  }
}

function constColor(g, v) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  a.fill(v);
  return new THREE.BufferAttribute(a, 3);
}

// ---------------------------------------------------------------- beard
function beardMaskFn(p) {
  const st = p.beardStyle;
  return (x, y, z) => {
    if (!p.male || st === 0) return 0;
    const ax = Math.abs(x);
    const front = Math.max(0, z);
    if (front < 0.05 && y > -0.5) return 0;
    // moustache
    const mou = g2(ax, 0.24) * g2(y - (p.mouthY + 0.075), 0.055) * front;
    if (st === 2) return mou * 1.2;
    // jaw line + chin
    let m = Math.max(0, Math.min(1, (-(y) - 0.24) / 0.16));
    m *= Math.max(0, Math.min(1, (front + 0.35) / 0.5));
    const side = Math.max(0, Math.min(1, (ax - 0.30) / 0.25));
    m = Math.max(m * 0.9, side * Math.max(0, Math.min(1, (0.16 - y) / 0.3)) * 0.85);
    m = Math.max(m, mou);
    if (st === 1) m *= 0.85;                    // stubble: colour only
    return Math.max(0, Math.min(1, m));
  };
}

function buildBeard(p, parent) {
  if (!p.male || p.beardStyle < 2) return;
  const col = new THREE.Color(p.hair).lerp(new THREE.Color(0x8a8378), p.grey * 0.90);
  if (p.dead) col.lerp(new THREE.Color(0x767672), 0.4);
  const mat = M('beard', { vertexColors: true, metalness: 0 }, { color: col, roughness: 0.96 });
  const mask = beardMaskFn(p);
  const len = p.beardLen;
  parent.add(shell(p, 34, 26, (x, y, z) => {
    const m = mask(x, y, z);
    if (m <= 0.08) return -1;
    // long beards hang: push the under-chin band down and out
    const hang = Math.max(0, -y - 0.55) * len * 0.55;
    const off = 0.012 + m * (0.020 + len * 0.030) + hang;
    // a strand pattern keeps a grey beard from reading as one pale blob
    const strand = 0.10 * Math.sin(x * 26 + y * 11);
    const shade = 0.44 + 0.48 * Math.max(0, y + 0.6) + 0.20 * Math.max(0, z) + strand;
    return { off: off + strand * 0.010, shade: Math.max(0.32, Math.min(0.98, shade)) };
  }, mat));
  if (len > 0.6) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.30 + len * 0.34, 12), mat);
    tail.position.set(0, -0.66 - len * 0.16, 0.20);
    tail.rotation.x = -0.18;
    tail.scale.set(1, 1, 0.72);
    tail.geometry.setAttribute('color', constColor(tail.geometry, 0.72));
    parent.add(tail);
  }
}

// ---------------------------------------------------------------- headgear
function buildCap(p, parent) {
  const cap = p.cap;
  const c = new THREE.Color(p.capCol);
  const trim = new THREE.Color(p.cu.trim);
  const cloth = M('capCloth', { metalness: 0 }, { color: c, roughness: 0.88 });
  // Fully metallic surfaces render as black mirrors without an environment map,
  // so metal here is half-metal with a warm emissive floor: it reads as gold.
  const gold = M('capGold', { metalness: 0 }, { color: trim, roughness: 0.30, metalness: 0.45, emissive: 0x241a08 });
  const furM = M('fur', { flatShading: true, metalness: 0 }, { color: p.cu.fur, roughness: 0.98 });

  if (cap === 'turban' || cap === 'wrap') {
    const core = new THREE.Mesh(new THREE.SphereGeometry(p.W * 1.02, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.60), cloth);
    core.scale.set(1, p.H / p.W * 0.70, p.D / p.W * 0.98);
    core.position.y = p.H * 0.30;
    parent.add(core);
    const n = cap === 'turban' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(p.W * (1.06 - t * 0.15), p.W * 0.125, 8, 22), cloth);
      ring.position.set(0, p.H * (0.44 + t * 0.30), 0);
      ring.rotation.set(Math.PI / 2, 0, (i % 2 ? 1 : -1) * 0.09 + p.part * 0.07);
      ring.scale.set(1, 1, 0.88);
      parent.add(ring);
    }
    if (cap === 'wrap') {
      const tailM = new THREE.Mesh(new THREE.CapsuleGeometry(p.W * 0.12, 0.30, 4, 8), cloth);
      tailM.position.set(p.W * 0.96, -0.10, -0.14);
      tailM.rotation.z = 0.32;
      parent.add(tailM);
    }
    if (p.rank >= 2) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(p.W * 1.08, p.W * 0.045, 6, 24), gold);
      band.position.y = p.H * 0.46; band.rotation.x = Math.PI / 2; band.scale.set(1, 1, 0.88);
      parent.add(band);
    }
  } else if (cap === 'kalpak' || cap === 'fur') {
    const h = 0.24 + p.rr2() * 0.13;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(p.W * 1.00, p.W * 1.09, h, 18, 1), cap === 'fur' ? furM : cloth);
    body.position.y = p.H * 0.60 + h * 0.34;
    body.scale.z = 0.94;
    parent.add(body);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(p.W * 1.06, p.W * 0.13, 8, 20), furM);
    brim.position.y = p.H * 0.58; brim.rotation.x = Math.PI / 2; brim.scale.set(1, 1, 0.92);
    parent.add(brim);
  } else if (cap === 'cone') {
    const h = 0.30;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(p.W * 0.40, p.W * 1.03, h, 16, 1), cloth);
    cone.position.y = p.H * 0.62 + h * 0.36; cone.scale.z = 0.94;
    parent.add(cone);
    const band = new THREE.Mesh(new THREE.TorusGeometry(p.W * 1.03, p.W * 0.075, 8, 20), gold);
    band.position.y = p.H * 0.61; band.rotation.x = Math.PI / 2; band.scale.set(1, 1, 0.94);
    parent.add(band);
  } else if (cap === 'pillbox' || cap === 'sharp') {
    const h = cap === 'sharp' ? 0.26 : 0.17;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(p.W * (cap === 'sharp' ? 0.70 : 0.94), p.W * 1.00, h, 16, 1), cloth);
    body.position.y = p.H * 0.62 + h * 0.38; body.scale.z = 0.94;
    parent.add(body);
    const band = new THREE.Mesh(new THREE.TorusGeometry(p.W * 0.99, p.W * 0.070, 6, 20), gold);
    band.position.y = p.H * 0.62; band.rotation.x = Math.PI / 2; band.scale.set(1, 1, 0.94);
    parent.add(band);
  } else if (cap === 'helmet') {
    const steel = M('steel', { metalness: 0 }, { color: 0x8d949c, roughness: 0.42, metalness: 0.40, emissive: 0x0d1014 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(p.W * 1.06, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), steel);
    dome.scale.set(1, p.H / p.W * 0.80, p.D / p.W * 1.00);
    dome.position.y = p.H * 0.30;
    parent.add(dome);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(p.W * 0.14, 0.16, 10), steel);
    spike.position.y = p.H * 0.80; parent.add(spike);
    const nasal = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.22, 0.030), steel);
    nasal.position.set(0, 0.03, p.D * 1.00); parent.add(nasal);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(p.W * 1.07, p.W * 0.055, 6, 22), steel);
    rim.position.y = p.H * 0.30; rim.rotation.x = Math.PI / 2; rim.scale.set(1, 1, p.D / p.W * 0.98);
    parent.add(rim);
  } else if (cap === 'veil' || cap === 'wimple' || cap === 'scarf') {
    const vm = M('veil', { side: THREE.DoubleSide, vertexColors: true, metalness: 0 }, { color: c, roughness: 0.90 });
    const tight = cap === 'scarf';
    parent.add(shell(p, 34, 26, (x, y, z) => {
      const ax = Math.abs(x);
      let hl = tight ? 0.60 : 0.54;
      if (z < 0) hl = -1.2;
      const back = Math.max(0, Math.min(1, (0.34 - z) / 0.28));
      const side = Math.max(0, Math.min(1, (ax - 0.64) / 0.18)) * back;
      let m = Math.max(0, Math.min(1, (y - hl) / 0.05));
      m = Math.max(m, side * Math.max(0, Math.min(1, (0.26 - y) / 0.4)) * (cap === 'wimple' ? 1 : 0.9));
      if (cap === 'wimple') m = Math.max(m, Math.max(0, Math.min(1, (-y - 0.62) / 0.2)) * Math.max(0, Math.min(1, (0.4 - ax) / 0.4)) * Math.max(0, Math.min(1, (0.5 - z) / 0.4)));
      if (m <= 0.03) return -1;
      const shade = 0.58 + 0.40 * Math.max(0, y * 0.6 + z * 0.6);
      return { off: 0.026 + m * 0.030, shade: Math.max(0.44, Math.min(1.0, shade)) };
    }, vm));
    // the drape over the shoulders
    const drape = new THREE.Mesh(new THREE.CylinderGeometry(p.W * 1.06, p.W * 1.80, 0.50, 20, 1, true),
      M('drape', { side: THREE.DoubleSide, metalness: 0 }, { color: c.clone().multiplyScalar(0.82), roughness: 0.9 }));
    drape.position.set(0, -0.68, -0.12);
    drape.scale.z = 0.80;
    parent.add(drape);
    if (p.rank >= 3) {
      const circ = new THREE.Mesh(new THREE.TorusGeometry(p.W * 1.12, 0.022, 6, 24), gold);
      circ.position.y = p.H * 0.56; circ.rotation.x = Math.PI / 2; circ.scale.set(1, 1, 0.92);
      parent.add(circ);
    }
  }
}

function buildCrown(p, parent) {
  if (p.rank < 3) return;
  const isKing = p.rank >= 4;
  const gold = M('crownGold', { metalness: 0 },
    { color: isKing ? 0xf0cd76 : 0xd4ac57, roughness: 0.26, metalness: 0.45, emissive: 0x33240c });
  const gem = M('gem', { metalness: 0 }, { color: p.cu === CULT.greek ? 0xa33a68 : 0x3a68a3, roughness: 0.2, metalness: 0.2, emissive: 0x0a0a14 });
  const lift = p.cap === 'none' ? 0 : (p.cap === 'turban' || p.cap === 'wrap' ? 0.16 : 0.10);
  const y0 = p.H * 0.66 + lift;
  const rad = p.W * (p.cap === 'none' ? 1.06 : 1.16);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.02, isKing ? 0.115 : 0.075, 20, 1, true), gold);
  band.position.y = y0; band.scale.z = 0.92;
  parent.add(band);
  const n = isKing ? 8 : 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    if (Math.sin(a) < -0.55) continue;                     // skip the ones behind
    const pt = new THREE.Mesh(new THREE.ConeGeometry(0.032, isKing ? 0.16 : 0.10, 6), gold);
    pt.position.set(Math.cos(a) * rad, y0 + (isKing ? 0.12 : 0.08), Math.sin(a) * rad * 0.92);
    parent.add(pt);
    if (isKing && i % 2 === 0) {
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), gem);
      g.position.set(Math.cos(a) * rad, y0 + 0.01, Math.sin(a) * rad * 0.92 + 0.02);
      parent.add(g);
    }
  }
  // Byzantine pendilia: two hanging strings of pearls beside the face
  if (isKing && p.cu === CULT.greek) {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const pr = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), gold);
        pr.position.set(s * rad * 0.96, y0 - 0.09 - i * 0.075, p.D * 0.28);
        parent.add(pr);
      }
    }
  }
}

// ---------------------------------------------------------------- body
function buildBody(p, parent) {
  const cloth = new THREE.Color(p.cloth);
  if (p.dead) cloth.lerp(new THREE.Color(0x4a4a48), 0.5);
  const mat = M('cloth', { side: THREE.DoubleSide, metalness: 0 }, { color: cloth, roughness: 0.90 });
  const neckC = new THREE.Color(p.skin).multiplyScalar(0.78);
  if (p.dead) neckC.lerp(new THREE.Color(0x9aa0a0), 0.55);
  const skinM = M('neck', { metalness: 0 }, { color: neckC, roughness: 0.72 });

  // neck first, so the collar can bite into it
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.215 + (p.male ? 0.030 : 0), 0.30, 0.54, 14, 1), skinM);
  neck.position.set(0, -0.62, -0.03);
  parent.add(neck);

  // shoulders: a wide flattened dome reads better than a cone
  const sh = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.60), mat);
  sh.scale.set(1.20 * (p.male ? 1.08 : 0.92), 0.58, 0.62);
  sh.position.set(0, -1.14, -0.02);
  parent.add(sh);
  // the opening of the robe: a dark V so the chest is not one flat field
  const vee = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.34, 3, 1),
    M('vee', { metalness: 0 }, { color: cloth.clone().multiplyScalar(0.42), roughness: 0.95 }));
  vee.position.set(0, -0.88, 0.30);
  vee.rotation.set(-0.30, Math.PI, Math.PI);
  vee.scale.set(1, 1, 0.4);
  parent.add(vee);

  const trimC = new THREE.Color(p.cu.trim);
  const rank = p.rank;
  if (rank >= 2) {
    // fur or gold-embroidered collar — status you can read at 52 pixels
    const useFur = p.cu === CULT.bulgar || p.cu === CULT.turkish || rank >= 4;
    const cm = useFur
      ? M('furC', { flatShading: true, metalness: 0 }, { color: p.cu.fur, roughness: 0.98 })
      : M('trimC', { metalness: 0 }, { color: trimC, roughness: 0.32, metalness: 0.42, emissive: 0x201708 });
    const col = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.085 + rank * 0.012, 8, 24), cm);
    col.position.set(0, -0.82, -0.01);
    col.rotation.x = Math.PI / 2;
    col.scale.set(1.20, 1, 0.62);
    parent.add(col);
    if (!useFur) {
      const inner = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.030, 6, 24), M('collarIn', { metalness: 0 }, { color: 0x241b14, roughness: 0.85 }));
      inner.position.set(0, -0.77, 0.03); inner.rotation.x = Math.PI / 2; inner.scale.set(1.20, 1, 0.62);
      parent.add(inner);
    }
  } else {
    const col = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.058, 6, 20),
      M('collarPlain', { metalness: 0 }, { color: cloth.clone().multiplyScalar(0.70), roughness: 0.94 }));
    col.position.set(0, -0.80, -0.01); col.rotation.x = Math.PI / 2; col.scale.set(1.20, 1, 0.62);
    parent.add(col);
  }
  // Every culture wears its collar differently; at 52 pixels this and the hat
  // are the only things carrying "who are these people".
  const cu = p.cu;
  if (cu === CULT.turkish || cu === CULT.kurdish) {
    // a crossed wrap: one panel laid over the other
    for (const sd of [-1, 1]) {
      const lap = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.46, 0.05),
        M('lapel', { metalness: 0 }, { color: cloth.clone().multiplyScalar(sd < 0 ? 1.22 : 0.66), roughness: 0.92 }));
      lap.position.set(sd * 0.20, -0.98, 0.30);
      lap.rotation.set(-0.34, 0, sd * 0.42);
      parent.add(lap);
    }
  } else if (cu === CULT.greek) {
    // the maniakis: a broad jewelled yoke across both shoulders
    const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.075, 8, 26),
      M('yoke', { metalness: 0 }, { color: trimC, roughness: 0.34, metalness: 0.42, emissive: 0x241a08 }));
    yoke.position.set(0, -0.94, 0.02);
    yoke.rotation.x = Math.PI / 2;
    yoke.scale.set(1.10, 1, 0.52);
    parent.add(yoke);
    for (let i = -2; i <= 2; i++) {
      const st = new THREE.Mesh(new THREE.SphereGeometry(0.030, 8, 6),
        M('yokeGem', { metalness: 0 }, { color: i % 2 ? 0xa33a68 : 0x3a68a3, roughness: 0.25, emissive: 0x0c0c16 }));
      st.position.set(i * 0.22, -0.92, 0.32 - Math.abs(i) * 0.05);
      parent.add(st);
    }
  } else if (cu === CULT.armenian) {
    // a high embroidered band, buttoned to the throat
    const hi = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.34, 0.20, 16, 1, true),
      M('highC', { side: THREE.DoubleSide, metalness: 0 }, { color: trimC.clone().multiplyScalar(0.9), roughness: 0.7 }));
    hi.position.set(0, -0.74, 0.00); hi.scale.z = 0.8;
    parent.add(hi);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6),
        M('button', { metalness: 0 }, { color: 0x2a2018, roughness: 0.7 }));
      b.position.set(0, -0.90 - i * 0.10, 0.30);
      parent.add(b);
    }
  } else {
    // steppe and Balkan: a heavy fur mantle over the shoulders
    const mant = new THREE.Mesh(new THREE.TorusGeometry(0.60, 0.135, 7, 22),
      M('mantle', { flatShading: true, metalness: 0 }, { color: cu.fur, roughness: 0.98 }));
    mant.position.set(0, -0.98, -0.02);
    mant.rotation.x = Math.PI / 2;
    mant.scale.set(1.06, 1, 0.55);
    parent.add(mant);
  }

  // a clasp at the throat for anyone who matters
  if (rank >= 1) {
    const cl = new THREE.Mesh(new THREE.SphereGeometry(0.052 + rank * 0.010, 10, 8),
      M('clasp', { metalness: 0 }, { color: rank >= 3 ? 0xe8c778 : trimC, roughness: 0.28, metalness: 0.45, emissive: 0x241a08 }));
    cl.position.set(0, -0.84, 0.34);
    cl.scale.set(1, 1, 0.5);
    parent.add(cl);
  }
  // an embroidered band down the chest for the higher cultures' dress
  if (rank >= 3) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.02),
      M('chestBand', { metalness: 0 }, { color: trimC, roughness: 0.32, metalness: 0.40, emissive: 0x201708 }));
    band.position.set(0, -1.00, 0.34);
    band.rotation.x = -0.28;
    parent.add(band);
  }
}

// ---------------------------------------------------------------- scars
function buildMarks(p, parent) {
  if (!(p.T.has('scarred') || p.T.has('wounded'))) return;
  const o = new THREE.Vector3();
  const mat = M('scar', { metalness: 0 }, { color: 0xa05a4a, roughness: 0.55 });
  const s = p.rr2() < 0.5 ? -1 : 1;
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const u = i / 4;
    sculpt(s * (0.20 + u * 0.42), 0.30 - u * 0.62, 0.9, p, o);
    pts.push(new THREE.Vector3(o.x, o.y, o.z + 0.010));
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.0105, 5, false);
  parent.add(new THREE.Mesh(g, mat));
  if (p.T.has('wounded')) {
    const patch = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8),
      M('patch', { metalness: 0 }, { color: 0xbdb29a, roughness: 0.97 }));
    sculpt(-s * 0.36, 0.06, 0.85, p, o);
    patch.position.set(o.x, o.y, o.z + 0.01);
    patch.scale.set(1.25, 0.60, 0.28);
    parent.add(patch);
  }
}

// ---------------------------------------------------------------- assembly
function buildHead(p) {
  const g = new THREE.Group();
  const head = new THREE.Group();
  head.add(buildSkull(p));
  buildEars(p, head);
  buildEyes(p, head);
  buildBrows(p, head);
  buildMouth(p, head);
  buildMarks(p, head);
  buildBeard(p, head);
  buildHair(p, head);
  buildCap(p, head);
  buildCrown(p, head);
  // chin up or down is posture, and posture is character
  head.rotation.x = -p.m.chin * 0.16 + (p.dead ? 0.10 : 0) + p.old * 0.045;
  head.rotation.z = (p.m.asym - 0.5) * 0.02 + p.skew * 0.028;
  g.add(head);
  buildBody(p, g);
  return g;
}

// ---------------------------------------------------------------- render
const cacheImg = new Map();

// Geometry only. Materials are pooled and must outlive the portrait, or the
// next face pays for a shader recompile.
function disposeTree(o) {
  o.traverse((n) => { if (n.geometry) n.geometry.dispose(); });
}

/** Render `c`'s portrait into a 2D canvas element. */
export function renderPortrait(c, canvas2d, opts = {}) {
  if (!c || !canvas2d) return;
  ensure();
  const ctx = canvas2d.getContext('2d');
  if (!ctx) return;
  const key = `${c.id}|${c.sex}|${c.culture}|${c.faith}|${c._ageCache | 0}|${(c.traits || []).join(',')}|` +
    `${c._rank || 0}|${c.deathDay != null ? 'd' : 'l'}|${opts.yaw ?? ''}`;
  const hit = cacheImg.get(key);
  if (hit) { blit(ctx, hit, canvas2d); return; }

  while (rig.children.length) { const ch0 = rig.children[0]; rig.remove(ch0); disposeTree(ch0); }
  const p = faceParams(c);
  rig.add(buildHead(p));

  // Framing: eyes a little above centre, shoulders cut by the bottom edge.
  const seedYaw = (((c.faceSeed ?? hashStr(String(c.id || 'x'))) % 1000) / 1000 - 0.5);
  rig.rotation.y = opts.yaw ?? (seedYaw * 0.44 - p.m.turn * 0.34);
  rig.rotation.x = 0;
  const tall = (p.cap === 'turban' || p.cap === 'wrap' || p.cap === 'cone' ? 0.10 : 0)
    + (p.cap === 'kalpak' || p.cap === 'fur' || p.cap === 'helmet' ? 0.06 : 0)
    + (p.rank >= 3 ? 0.05 : 0);
  rig.scale.setScalar(1 - tall);
  rig.position.set(0, 0.075 - tall * 0.10, 0);

  // Light is mood. A dead face loses the candle.
  if (p.dead) {
    L.key.intensity = 1.30; L.key.color.setHex(0xb9bcc4);
    L.fill.intensity = 0.30; L.rim.intensity = 1.9;
    L.amb.intensity = 1.05; L.amb.color.setHex(0x39414a); L.amb.groundColor.setHex(0x14181c);
    L.bounce.intensity = 0.18; L.eye.intensity = 0.0;
  } else {
    // dark skin drinks the candle; give it back what it takes
    const comp = 1 + Math.max(0, 0.52 - p.skinLum) * 1.25;
    L.key.intensity = (3.9 - p.rank * 0.05) * comp; L.key.color.setHex(0xffd2a2);
    L.fill.intensity = 0.52 * comp; L.rim.intensity = 2.1 + p.rank * 0.18;
    L.amb.intensity = 1.35 * comp; L.amb.color.setHex(0x6a5540); L.amb.groundColor.setHex(0x241a12);
    L.bounce.intensity = 0.55; L.eye.intensity = 0.45;
  }

  rr.setClearColor(0x000000, 0);
  rr.render(sc, cam);
  const img = document.createElement('canvas');
  img.width = img.height = CACHE_SIZE;
  const ic = img.getContext('2d');
  ic.imageSmoothingEnabled = true; ic.imageSmoothingQuality = 'high';
  ic.drawImage(rr.domElement, 0, 0, CACHE_SIZE, CACHE_SIZE);
  img._dead = p.dead;
  img._rank = p.rank;
  // evict the oldest third rather than everything, so a full court does not
  // re-render itself every time one new face arrives
  if (cacheImg.size >= CACHE_MAX) {
    let drop = Math.ceil(CACHE_MAX / 3);
    for (const k of cacheImg.keys()) { if (drop-- <= 0) break; cacheImg.delete(k); }
  }
  cacheImg.set(key, img);
  blit(ctx, img, canvas2d);
}

function blit(ctx, img, canvas2d) {
  const w = canvas2d.width, h = canvas2d.height;
  const dead = img._dead;
  ctx.clearRect(0, 0, w, h);
  // the room behind the head: candle glow on the left, cold stone on the right
  const g = ctx.createRadialGradient(w * 0.36, h * 0.34, w * 0.03, w * 0.5, h * 0.55, w * 0.82);
  if (dead) { g.addColorStop(0, '#2a2c30'); g.addColorStop(0.55, '#181a1e'); g.addColorStop(1, '#0a0b0d'); }
  else { g.addColorStop(0, '#523a22'); g.addColorStop(0.42, '#2a1e13'); g.addColorStop(1, '#0b0806'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  // corner vignette so the head sits in the frame instead of on it
  const v = ctx.createRadialGradient(w * 0.5, h * 0.48, w * 0.30, w * 0.5, h * 0.5, w * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, dead ? 'rgba(4,5,7,0.72)' : 'rgba(8,4,2,0.62)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
}

export function clearPortraitCache() { cacheImg.clear(); }
