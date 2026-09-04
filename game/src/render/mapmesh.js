// The map itself: one heightfield mesh whose fragment shader looks up which
// province each pixel belongs to, so recolouring 87 counties is a 512-pixel
// texture write rather than 87 mesh rebuilds.
//
// Zoomed in you see land. Zoomed out the land turns to parchment and the
// borders turn to ink — that shift is most of what makes a strategy map feel
// like a *map* rather than a terrain demo.

import * as THREE from '../../vendor/three.module.js';
import { R } from './scene.js';

export const M = { mesh: null, ownerTex: null, paletteTex: null, mat: null, meta: null, scaleXZ: 7, yScale: 44 };

const BIOME_COLOR = {
  plains:    [0.42, 0.50, 0.26],
  steppe:    [0.55, 0.51, 0.30],
  forest:    [0.20, 0.33, 0.19],
  hills:     [0.40, 0.40, 0.27],
  mountains: [0.44, 0.42, 0.40],
  drylands:  [0.60, 0.49, 0.31],
  desert:    [0.76, 0.67, 0.44],
  sea:       [0.05, 0.12, 0.20],
};

export function buildMap(map) {
  M.meta = map;
  const { W, H, height, owner } = map;
  const sx = M.scaleXZ;

  const geo = new THREE.PlaneGeometry((W - 1) * sx, (H - 1) * sx, W - 1, H - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const biome = new Float32Array(pos.count);
  const terrIdx = { plains:0, steppe:1, forest:2, hills:3, mountains:4, drylands:5, desert:6, sea:7 };
  for (let i = 0; i < pos.count; i++) {
    const x = i % W, y = (i / W) | 0;
    const h = height[y * W + x];
    pos.setY(i, Math.max(-0.06, h) * M.yScale);
    const o = owner[y * W + x];
    biome[i] = o >= 0 ? (terrIdx[map.provinces[o].terrain] ?? 0) : 7;
  }
  geo.setAttribute('aBiome', new THREE.BufferAttribute(biome, 1));
  geo.computeVertexNormals();

  // province-id texture
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = owner[i];
    const id = o < 0 ? 0 : o + 1;
    data[i * 4 + 0] = id & 255;
    data[i * 4 + 1] = (id >> 8) & 255;
    data[i * 4 + 2] = o < 0 ? 0 : 255;
    data[i * 4 + 3] = 255;
  }
  const ownerTex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  ownerTex.magFilter = ownerTex.minFilter = THREE.NearestFilter;
  ownerTex.needsUpdate = true;
  M.ownerTex = ownerTex;

  const PAL = 512;
  const pdata = new Uint8Array(PAL * 4).fill(255);
  const paletteTex = new THREE.DataTexture(pdata, PAL, 1, THREE.RGBAFormat);
  paletteTex.magFilter = paletteTex.minFilter = THREE.NearestFilter;
  paletteTex.needsUpdate = true;
  M.paletteTex = paletteTex;

  const bcols = [];
  for (const k of ['plains','steppe','forest','hills','mountains','drylands','desert','sea']) bcols.push(new THREE.Vector3(...BIOME_COLOR[k]));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uOwner: { value: ownerTex },
      uPalette: { value: paletteTex },
      uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
      uGrid: { value: new THREE.Vector2(W, H) },
      uSize: { value: new THREE.Vector2((W - 1) * sx, (H - 1) * sx) },
      uBiome: { value: bcols },
      uSunDir: { value: new THREE.Vector3(-0.5, 0.7, 0.4).normalize() },
      uSunColor: { value: new THREE.Color(0xffe9c9) },
      uAmbient: { value: new THREE.Color(0x7a8fae) },
      uParchment: { value: 0.0 },        // 0 = terrain, 1 = political parchment
      uHover: { value: -1 },
      uSelected: { value: -1 },
      uTime: { value: 0 },
      uBorderInk: { value: new THREE.Color(0x21160c) },
      uSeason: { value: 0.0 },           // 0 summer .. 1 winter (snow line)
      uYScale: { value: M.yScale },
      uFogColor: { value: new THREE.Color(0x0f1a26) },
      uFogDensity: { value: 0.0016 },
    },
    vertexShader: /* glsl */`
      attribute float aBiome;
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld; varying float vBiome; varying float vH;
      void main(){
        vUv = uv; vBiome = aBiome; vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz; vH = position.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D uOwner, uPalette;
      uniform vec2 uTexel, uGrid;
      uniform vec3 uBiome[8];
      uniform vec3 uSunDir, uSunColor, uAmbient, uBorderInk, uFogColor;
      uniform float uParchment, uTime, uSeason, uYScale, uFogDensity;
      uniform float uHover, uSelected;
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld; varying float vBiome; varying float vH;

      float pid(vec2 uv){ vec4 t = texture2D(uOwner, uv); return t.b < 0.5 ? -1.0 : floor(t.r*255.0+0.5) + floor(t.g*255.0+0.5)*256.0 - 1.0; }
      vec4 palAt(float id){ return texture2D(uPalette, vec2((id+0.5)/512.0, 0.5)); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5;} return s; }

      void main(){
        float id = pid(vUv);
        // --- border detection on the id texture -----------------------------
        float b = 0.0;
        for (int i=0;i<4;i++){
          vec2 o = i==0?vec2(uTexel.x,0.0): i==1?vec2(-uTexel.x,0.0): i==2?vec2(0.0,uTexel.y):vec2(0.0,-uTexel.y);
          float n = pid(vUv+o);
          if (n != id) b = 1.0;
        }
        // diagonal neighbours too, so corners don't leave gaps
        for (int i=0;i<4;i++){
          vec2 o = i==0?vec2(uTexel.x,uTexel.y): i==1?vec2(-uTexel.x,uTexel.y): i==2?vec2(uTexel.x,-uTexel.y):vec2(-uTexel.x,-uTexel.y);
          if (pid(vUv+o) != id) b = max(b, 0.55);
        }

        // --- terrain colour --------------------------------------------------
        int bi = int(vBiome + 0.5);
        vec3 base = uBiome[0];
        for (int k=0;k<8;k++) if (k==bi) base = uBiome[k];
        float g = fbm(vUv*vec2(uGrid.x,uGrid.y)*0.55);
        base *= 0.82 + g*0.40;
        // rock exposure on steep slopes
        float slope = 1.0 - clamp(vNormal.y, 0.0, 1.0);
        base = mix(base, vec3(0.36,0.34,0.32), smoothstep(0.25,0.65,slope));
        // snow
        float snowLine = mix(0.72, 0.34, uSeason) * uYScale;
        float snow = smoothstep(snowLine, snowLine+18.0, vH) * (1.0 - smoothstep(0.5,0.85,slope));
        base = mix(base, vec3(0.93,0.95,0.99), snow);

        // --- political colour -------------------------------------------------
        vec4 pc = id < 0.0 ? vec4(0.0) : palAt(id);
        vec3 polit = pc.rgb;

        // parchment look for the zoomed-out political map
        float paper = fbm(vUv*vec2(uGrid.x,uGrid.y)*0.30)*0.5 + fbm(vUv*vec2(uGrid.x,uGrid.y)*1.7)*0.25;
        vec3 parch = mix(vec3(0.86,0.78,0.62), vec3(0.74,0.65,0.49), paper);
        parch = mix(parch, polit, 0.55*pc.a);
        parch *= 0.92 + 0.16*fbm(vUv*vec2(uGrid.x,uGrid.y)*4.0);

        vec3 terr = mix(base, mix(base, polit, 0.34*pc.a), 1.0);
        vec3 col = mix(terr, parch, uParchment);

        // --- lighting ---------------------------------------------------------
        vec3 N = normalize(vNormal);
        float ndl = max(dot(N, normalize(uSunDir)), 0.0);
        float wrap = ndl*0.62 + 0.44;
        vec3 lit = col * (uSunColor * wrap + uAmbient*0.85);
        // parchment is lit flatly: it is a document, not a landscape
        col = mix(lit, col * (0.90 + 0.14*ndl), uParchment);

        // --- ink borders -------------------------------------------------------
        float inkW = b;
        col = mix(col, uBorderInk, inkW * mix(0.30, 0.72, uParchment));

        // --- hover / selection -------------------------------------------------
        if (uHover >= 0.0 && abs(id - uHover) < 0.5)   col += vec3(0.10,0.10,0.07);
        if (uSelected >= 0.0 && abs(id - uSelected) < 0.5) {
          col = mix(col, vec3(1.0,0.86,0.52), 0.20 + 0.10*sin(uTime*3.0));
          if (b > 0.5) col = mix(col, vec3(1.0,0.90,0.60), 0.85);
        }

        // --- coast darkening ----------------------------------------------------
        col *= 1.0 - smoothstep(2.0, 0.0, vH) * 0.25;

        float depth = length(vWorld - cameraPosition);
        float fogF = 1.0 - exp(-uFogDensity*uFogDensity*depth*depth);
        col = mix(col, uFogColor, clamp(fogF,0.0,1.0) * (1.0 - uParchment*0.65));

        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  M.mat = mat;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  R.layers.terrain.add(mesh);
  M.mesh = mesh;

  buildWater(map);
  return M;
}

function buildWater(map) {
  const { W, H } = map, sx = M.scaleXZ;
  const geo = new THREE.PlaneGeometry((W - 1) * sx * 1.6, (H - 1) * sx * 1.6, 96, 96);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x12304a) },
      uShallow: { value: new THREE.Color(0x246a86) },
      uSun: { value: new THREE.Vector3(-0.5, 0.7, 0.4).normalize() },
      uParchment: { value: 0 },
      uPaper: { value: new THREE.Color(0xa8b8c4) },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vW; uniform float uTime;
      void main(){ vUv=uv; vec3 p=position;
        p.y += sin(p.x*0.02+uTime*0.7)*0.9 + cos(p.z*0.027-uTime*0.5)*0.8;
        vec4 wp=modelMatrix*vec4(p,1.0); vW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `precision highp float; varying vec2 vUv; varying vec3 vW;
      uniform vec3 uDeep,uShallow,uSun,uPaper; uniform float uTime,uParchment;
      float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      void main(){
        vec2 uv=vW.xz*0.012;
        float w = n(uv+uTime*0.05)*0.5 + n(uv*2.3-uTime*0.07)*0.3 + n(uv*5.1+uTime*0.11)*0.2;
        vec3 col = mix(uDeep, uShallow, smoothstep(0.35,0.75,w));
        float spec = pow(max(0.0,w-0.62),2.0)*3.2;
        col += vec3(0.85,0.92,1.0)*spec*0.5;
        // parchment sea: hatched lines, like an old chart
        float hatch = smoothstep(0.45,0.55, fract((vW.x+vW.z)*0.035 + n(uv*3.0)*0.6));
        vec3 paper = mix(uPaper*1.06, uPaper*0.86, hatch*0.55);
        col = mix(col, paper, uParchment);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.5;
  mesh.name = 'water';
  R.layers.water.add(mesh);
  M.water = mat;
}

/** Write the current map-mode colours into the palette texture. */
export function setPalette(colorFn) {
  const { provinces } = M.meta;
  const d = M.paletteTex.image.data;
  for (let i = 0; i < provinces.length; i++) {
    const c = colorFn(provinces[i], i) || { r: 0.5, g: 0.5, b: 0.5, a: 0 };
    d[i * 4 + 0] = Math.round(Math.max(0, Math.min(1, c.r)) * 255);
    d[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, c.g)) * 255);
    d[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, c.b)) * 255);
    d[i * 4 + 3] = Math.round((c.a ?? 1) * 255);
  }
  M.paletteTex.needsUpdate = true;
}
export function setHover(i) { if (M.mat) M.mat.uniforms.uHover.value = i ?? -1; }
export function setSelected(i) { if (M.mat) M.mat.uniforms.uSelected.value = i ?? -1; }
export function setParchment(t) { if (M.mat) { M.mat.uniforms.uParchment.value = t; M.water.uniforms.uParchment.value = t; } }
export function setSeason(t) { if (M.mat) M.mat.uniforms.uSeason.value = t; }
export function tickMap(dt) {
  if (!M.mat) return;
  M.mat.uniforms.uTime.value += dt;
  M.water.uniforms.uTime.value += dt;
}
/** World position -> grid cell -> province index (-1 = sea). */
export function provinceAtWorld(x, z) {
  const { W, H, owner } = M.meta, sx = M.scaleXZ;
  const gx = Math.round(x / sx + (W - 1) / 2), gy = Math.round(z / sx + (H - 1) / 2);
  if (gx < 0 || gy < 0 || gx >= W || gy >= H) return -1;
  return owner[gy * W + gx];
}
export function worldOfProvince(i) {
  const p = M.meta.provinces[i]; if (!p) return null;
  const { W, H } = M.meta, sx = M.scaleXZ;
  const x = (p.cx - (W - 1) / 2) * sx, z = (p.cy - (H - 1) / 2) * sx;
  const h = M.meta.height[Math.round(p.cy) * W + Math.round(p.cx)] || 0;
  return new THREE.Vector3(x, Math.max(0, h) * M.yScale, z);
}
