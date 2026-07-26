// Procedural arena: a night-time urban combat yard ringed by buildings.
// Geometry is boxes and cylinders; everything solid registers an AABB
// collider and a raycast target. Nothing here is loaded from disk.

import * as THREE from "three";
import { CONFIG } from "./config.js";
import { makeCollider } from "./physics.js";
import { mulberry32 } from "./textures.js";

export function buildWorld(scene, tex) {
  const rng = mulberry32(20260726);
  const half = CONFIG.arena.size / 2;
  const colliders = [];
  const solids = [];

  // ---------- Atmosphere ----------
  scene.background = new THREE.Color(0x0a0e16);
  scene.fog = new THREE.FogExp2(0x0a0e16, 0.0105);

  const hemi = new THREE.HemisphereLight(0x35496b, 0x1c1814, 0.75);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xbecce8, 1.7);
  moon.position.set(48, 70, 26);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -80;
  moon.shadow.camera.right = 80;
  moon.shadow.camera.top = 80;
  moon.shadow.camera.bottom = -80;
  moon.shadow.camera.near = 10;
  moon.shadow.camera.far = 200;
  moon.shadow.bias = -0.0006;
  scene.add(moon);

  // Stars
  {
    const starCount = 420;
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = rng() * Math.PI * 2;
      const el = rng() * Math.PI * 0.42 + 0.08;
      const r = 320;
      pos[i * 3] = Math.cos(a) * Math.cos(el) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      size: 1.6, sizeAttenuation: false, color: 0xcfd8ea,
      transparent: true, opacity: 0.8, fog: false, depthWrite: false,
    });
    scene.add(new THREE.Points(g, m));
  }

  // ---------- Ground ----------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.arena.size + 14, CONFIG.arena.size + 14),
    new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.94, metalness: 0.02 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  solids.push(ground);

  // ---------- Perimeter walls ----------
  const wallMat = new THREE.MeshStandardMaterial({ map: tex.brick, roughness: 0.9 });
  const wh = CONFIG.arena.wallHeight;
  const wallDefs = [
    { x: 0, z: -half, w: CONFIG.arena.size + 2, d: 1.2 },
    { x: 0, z: half, w: CONFIG.arena.size + 2, d: 1.2 },
    { x: -half, z: 0, w: 1.2, d: CONFIG.arena.size + 2 },
    { x: half, z: 0, w: 1.2, d: CONFIG.arena.size + 2 },
  ];
  for (const wd of wallDefs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wd.w, wh, wd.d), wallMat);
    wall.position.set(wd.x, wh / 2, wd.z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
    solids.push(wall);
    colliders.push(makeCollider(wd.x, wd.z, wd.w / 2, wd.d / 2, wh));
  }

  // ---------- Ring of buildings inside the walls ----------
  const buildingDefs = [
    { x: -46, z: -46, w: 16, d: 14 }, { x: 0, z: -50, w: 20, d: 12 },
    { x: 46, z: -46, w: 14, d: 16 }, { x: -50, z: 0, w: 12, d: 20 },
    { x: 50, z: 2, w: 12, d: 18 }, { x: -46, z: 46, w: 15, d: 14 },
    { x: 4, z: 50, w: 22, d: 12 }, { x: 46, z: 46, w: 14, d: 15 },
  ];
  for (const b of buildingDefs) {
    const h = 13 + rng() * 14;
    const floors = Math.max(3, Math.round(h / 3.2));
    const cols = Math.max(3, Math.round(Math.max(b.w, b.d) / 3.4));
    const win = tex.windows(floors, cols);
    const sideMat = new THREE.MeshStandardMaterial({
      map: win.map, emissiveMap: win.emissive, emissive: 0xffffff,
      emissiveIntensity: 1.1, roughness: 0.85,
    });
    const topMat = new THREE.MeshStandardMaterial({ map: tex.concreteDark, roughness: 0.95 });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.w, h, b.d),
      [sideMat, sideMat, topMat, topMat, sideMat, sideMat]
    );
    mesh.position.set(b.x, h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    solids.push(mesh);
    colliders.push(makeCollider(b.x, b.z, b.w / 2, b.d / 2, h));
  }

  // ---------- Distant skyline (visual only, outside the walls) ----------
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rng() * 0.2;
    const r = 105 + rng() * 55;
    const w = 10 + rng() * 16;
    const h = 26 + rng() * 60;
    const floors = Math.round(h / 3.4);
    const win = tex.windows(Math.min(floors, 18), 5);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x11141a, emissiveMap: win.emissive, emissive: 0xffffff,
      emissiveIntensity: 0.75, roughness: 1,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    mesh.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
    scene.add(mesh);
  }

  // ---------- Cover: crates, barriers, containers, bunkers ----------
  const crateMat = new THREE.MeshStandardMaterial({ map: tex.crate, roughness: 0.85 });
  const barrierMat = new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.95 });
  const containerTints = [0x8a4a3a, 0x3a5a6a, 0x5a6a3a, 0x6a5a2a];

  const placed = []; // {x, z, r}
  const occupied = (x, z, r) => {
    if (Math.hypot(x, z) < 7) return true; // keep the player spawn clear
    for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < p.r + r + 2.2) return true;
    return false;
  };

  const addBox = (mesh, cx, cz, hx, hz, top) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    solids.push(mesh);
    colliders.push(makeCollider(cx, cz, hx, hz, top));
  };

  let attempts = 0;
  let placedCount = 0;
  while (placedCount < 24 && attempts < 300) {
    attempts++;
    const a = rng() * Math.PI * 2;
    const r = 9 + rng() * 30;
    const x = Math.round(Math.cos(a) * r);
    const z = Math.round(Math.sin(a) * r);
    const kind = rng();

    if (kind < 0.38) {
      // crate cluster (1-3 crates, sometimes stacked)
      if (occupied(x, z, 2.4)) continue;
      const s = 2.1;
      const n = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const ox = x + (i === 0 ? 0 : (rng() < 0.5 ? s + 0.15 : -(s + 0.15)));
        const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
        crate.position.set(ox, s / 2, z);
        crate.rotation.y = 0;
        addBox(crate, ox, z, s / 2, s / 2, s);
        if (rng() < 0.4) {
          const top = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
          top.position.set(ox, s * 1.5, z);
          top.castShadow = true; top.receiveShadow = true;
          scene.add(top);
          solids.push(top);
          const idx = colliders.length - 1;
          colliders[idx] = makeCollider(ox, z, s / 2, s / 2, s * 2);
        }
      }
      placed.push({ x, z, r: 3.2 });
    } else if (kind < 0.68) {
      // low concrete barrier
      if (occupied(x, z, 2)) continue;
      const along = rng() < 0.5;
      const w = along ? 3.4 : 0.9;
      const d = along ? 0.9 : 3.4;
      const h = 1.25;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), barrierMat);
      bar.position.set(x, h / 2, z);
      addBox(bar, x, z, w / 2, d / 2, h);
      placed.push({ x, z, r: 2.2 });
    } else if (kind < 0.9) {
      // shipping container
      if (occupied(x, z, 4)) continue;
      const along = rng() < 0.5;
      const w = along ? 6.1 : 2.5;
      const d = along ? 2.5 : 6.1;
      const h = 2.65;
      const mat = new THREE.MeshStandardMaterial({
        map: tex.metal, color: containerTints[Math.floor(rng() * containerTints.length)],
        roughness: 0.7, metalness: 0.35,
      });
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      box.position.set(x, h / 2, z);
      addBox(box, x, z, w / 2, d / 2, h);
      placed.push({ x, z, r: 4 });
    } else {
      // squat bunker
      if (occupied(x, z, 4.5)) continue;
      const w = 5, d = 5, h = 3.1;
      const bunker = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), barrierMat);
      bunker.position.set(x, h / 2, z);
      addBox(bunker, x, z, w / 2, d / 2, h);
      placed.push({ x, z, r: 4.6 });
    }
    placedCount++;
  }

  // ---------- Floodlight poles ----------
  const polePositions = [[22, 18], [-26, 6], [4, -28], [-12, 30]];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x332a18, emissive: 0xffc37a, emissiveIntensity: 2.4,
  });
  for (const [px, pz] of polePositions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 6.4, 8), poleMat);
    pole.position.set(px, 3.2, pz);
    pole.castShadow = true;
    scene.add(pole);
    solids.push(pole);
    colliders.push(makeCollider(px, pz, 0.3, 0.3, 6.4));

    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.55), lampMat);
    lamp.position.set(px, 6.35, pz);
    scene.add(lamp);

    const light = new THREE.PointLight(0xffc37a, 55, 34, 2);
    light.position.set(px, 6.1, pz);
    scene.add(light);
  }

  // ---------- Enemy spawn points along the edges ----------
  const s = half - 8;
  const spawnPoints = [
    new THREE.Vector3(-s, 0, -s * 0.3), new THREE.Vector3(s, 0, -s * 0.4),
    new THREE.Vector3(-s * 0.3, 0, -s), new THREE.Vector3(s * 0.4, 0, s),
    new THREE.Vector3(-s, 0, s * 0.5), new THREE.Vector3(s, 0, s * 0.55),
    new THREE.Vector3(s * 0.7, 0, -s), new THREE.Vector3(-s * 0.6, 0, s),
    new THREE.Vector3(24, 0, -34), new THREE.Vector3(-30, 0, 26),
  ];

  return { colliders, solids, spawnPoints, arenaHalf: half };
}
