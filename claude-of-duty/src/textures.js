// Procedural texture factory. Every surface in the game is painted here,
// at runtime, on 2D canvases — the project ships zero image files.

import * as THREE from "three";

function makeCanvas(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")];
}

function toTexture(canvas, { srgb = true, repeat = [1, 1] } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Deterministic PRNG so the world looks the same every run.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseFill(ctx, size, base, spread, rng, alpha = 1) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * spread;
    d[i] = Math.max(0, Math.min(255, d[i] + n * base[0] * alpha));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * base[1] * alpha));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * base[2] * alpha));
  }
  ctx.putImageData(img, 0, 0);
}

export function makeAsphaltTexture(rng) {
  const size = 512;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = "#2a2c2e";
  ctx.fillRect(0, 0, size, size);
  noiseFill(ctx, size, [1, 1, 1], 46, rng);
  // cracks
  ctx.strokeStyle = "rgba(12,13,14,0.55)";
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    let x = rng() * size, y = rng() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rng() - 0.5) * 90; y += (rng() - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // patches and stains
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(${16 + rng() * 20 | 0},${16 + rng() * 20 | 0},${18 + rng() * 20 | 0},${0.10 + rng() * 0.16})`;
    const r = 12 + rng() * 60;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, { repeat: [18, 18] });
}

export function makeConcreteTexture(rng, tint = "#8f8b82") {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, size, size);
  noiseFill(ctx, size, [1, 1, 1], 34, rng);
  // panel seams
  ctx.strokeStyle = "rgba(40,38,34,0.45)";
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, (size / 4) * i); ctx.lineTo(size, (size / 4) * i); ctx.stroke();
  }
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = `rgba(60,56,50,${0.05 + rng() * 0.12})`;
    ctx.fillRect(rng() * size, rng() * size, 6 + rng() * 40, 3 + rng() * 20);
  }
  return toTexture(c, { repeat: [2, 2] });
}

export function makeBrickTexture(rng) {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = "#4d4844";
  ctx.fillRect(0, 0, size, size);
  const bw = 42, bh = 18;
  for (let row = 0; row * bh < size + bh; row++) {
    const offset = row % 2 === 0 ? 0 : bw / 2;
    for (let col = -1; col * bw < size + bw; col++) {
      const shade = 92 + rng() * 46;
      ctx.fillStyle = `rgb(${shade | 0},${(shade * 0.62) | 0},${(shade * 0.5) | 0})`;
      ctx.fillRect(col * bw + offset + 1.5, row * bh + 1.5, bw - 3, bh - 3);
    }
  }
  noiseFill(ctx, size, [1, 1, 1], 26, rng);
  return toTexture(c, { repeat: [3, 2] });
}

export function makeMetalTexture(rng) {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#5e6468");
  grad.addColorStop(0.5, "#494e52");
  grad.addColorStop(1, "#565c60");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  noiseFill(ctx, size, [1, 1, 1], 18, rng);
  // rivets along panel edges
  ctx.fillStyle = "rgba(28,30,32,0.85)";
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      ctx.beginPath();
      ctx.arc(20 + i * 72, 20 + j * 72, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = "rgba(30,32,34,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, size - 12, size - 12);
  // scratches
  ctx.strokeStyle = "rgba(180,186,190,0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    const x = rng() * size, y = rng() * size;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 70, y + (rng() - 0.5) * 70);
    ctx.stroke();
  }
  return toTexture(c);
}

export function makeCrateTexture(rng) {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = "#57634a";
  ctx.fillRect(0, 0, size, size);
  noiseFill(ctx, size, [1, 1, 1], 30, rng);
  ctx.strokeStyle = "rgba(24,28,20,0.8)";
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, size - 10, size - 10);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(size, size);
  ctx.moveTo(size, 0); ctx.lineTo(0, size);
  ctx.lineWidth = 7;
  ctx.stroke();
  // stencil marking
  ctx.fillStyle = "rgba(220,210,170,0.5)";
  ctx.font = "bold 26px monospace";
  ctx.fillText("MUNITIONS", 42, 132);
  ctx.font = "bold 16px monospace";
  ctx.fillText("CF-05 // LOT 7", 66, 158);
  return toTexture(c);
}

// Building side: dark facade with a grid of windows, some of them lit.
export function makeWindowTexture(rng, floors, cols) {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = "#23262b";
  ctx.fillRect(0, 0, size, size);
  noiseFill(ctx, size, [1, 1, 1], 16, rng);
  const cw = size / cols, ch = size / floors;
  for (let f = 0; f < floors; f++) {
    for (let col = 0; col < cols; col++) {
      const lit = rng() < 0.28;
      const warm = rng() < 0.7;
      ctx.fillStyle = lit
        ? (warm ? `rgba(255,${185 + rng() * 40 | 0},110,0.95)` : "rgba(160,210,255,0.9)")
        : "rgba(12,14,18,0.95)";
      ctx.fillRect(col * cw + cw * 0.2, f * ch + ch * 0.22, cw * 0.6, ch * 0.5);
    }
  }
  return toTexture(c);
}

// Emissive-only companion for the window texture (same layout, black except lit windows).
export function makeWindowEmissive(rng, floors, cols) {
  const size = 256;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  const cw = size / cols, ch = size / floors;
  for (let f = 0; f < floors; f++) {
    for (let col = 0; col < cols; col++) {
      if (rng() < 0.28) {
        const warm = rng() < 0.7;
        ctx.fillStyle = warm ? "#ffb46e" : "#a0d2ff";
        ctx.fillRect(col * cw + cw * 0.2, f * ch + ch * 0.22, cw * 0.6, ch * 0.5);
      }
    }
  }
  return toTexture(c);
}

export function makeMuzzleFlashTexture() {
  const size = 128;
  const [c, ctx] = makeCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,230,1)");
  g.addColorStop(0.25, "rgba(255,210,120,0.9)");
  g.addColorStop(0.6, "rgba(255,140,40,0.35)");
  g.addColorStop(1, "rgba(255,120,20,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // star spikes
  ctx.strokeStyle = "rgba(255,230,170,0.8)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2);
    ctx.lineTo(size / 2 + Math.cos(a) * size * 0.48, size / 2 + Math.sin(a) * size * 0.48);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeParticleTexture() {
  const size = 64;
  const [c, ctx] = makeCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

// Camouflage cloth for enemy uniforms.
export function makeCamoTexture(rng, palette) {
  const size = 128;
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, size, size);
  for (let layer = 1; layer < palette.length; layer++) {
    ctx.fillStyle = palette[layer];
    for (let i = 0; i < 22; i++) {
      ctx.beginPath();
      const x = rng() * size, y = rng() * size;
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        ctx.lineTo(x + (rng() - 0.5) * 44, y + (rng() - 0.5) * 44);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  return toTexture(c);
}

export function buildTextureLibrary() {
  const rng = mulberry32(1337);
  return {
    asphalt: makeAsphaltTexture(rng),
    concrete: makeConcreteTexture(rng),
    concreteDark: makeConcreteTexture(rng, "#6b675f"),
    brick: makeBrickTexture(rng),
    metal: makeMetalTexture(rng),
    crate: makeCrateTexture(rng),
    muzzle: makeMuzzleFlashTexture(),
    particle: makeParticleTexture(),
    camoA: makeCamoTexture(rng, ["#4a4f3d", "#33382b", "#5d6350", "#22261d"]),
    camoB: makeCamoTexture(rng, ["#4d4a44", "#35332f", "#605c53", "#242320"]),
    windows: (floors, cols) => {
      const r = mulberry32((floors * 31 + cols * 7 + 5) >>> 0);
      const r2 = mulberry32((floors * 31 + cols * 7 + 5) >>> 0);
      return { map: makeWindowTexture(r, floors, cols), emissive: makeWindowEmissive(r2, floors, cols) };
    },
  };
}
