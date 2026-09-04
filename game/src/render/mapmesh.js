// The map itself: one heightfield mesh whose fragment shader looks up which
// province each pixel belongs to, so recolouring 87 counties is a 512-pixel
// texture write rather than 87 mesh rebuilds.
//
// Zoomed in you see land. Zoomed out the land turns to parchment and the
// borders turn to ink — that shift is most of what makes a strategy map feel
// like a *map* rather than a terrain demo.

import * as THREE from '../../vendor/three.module.js';
import { R, setDaylight, setSkyParchment } from './scene.js';

export const M = {
  mesh: null, ownerTex: null, paletteTex: null, mat: null, meta: null,
  scaleXZ: 7, yScale: 44,
  idField: null,          // supersampled province raster, see buildIdField()
};

const BIOME_COLOR = {
  plains:    [0.25, 0.32, 0.13],
  steppe:    [0.36, 0.32, 0.15],
  forest:    [0.11, 0.20, 0.10],
  hills:     [0.25, 0.25, 0.14],
  mountains: [0.27, 0.26, 0.24],
  drylands:  [0.40, 0.31, 0.17],
  desert:    [0.53, 0.45, 0.26],
  sea:       [0.02, 0.05, 0.09],
};
const BIOME_KEYS = ['plains','steppe','forest','hills','mountains','drylands','desert','sea'];
const TERR_IDX = { plains:0, steppe:1, forest:2, hills:3, mountains:4, drylands:5, desert:6, sea:7 };

// How much finer the province raster is than the map grid. The map is only
// 260x150 cells wide; a border read straight off that grid is a staircase with
// 7-world-unit steps. We resample it once at build time — with a wobble, so
// frontiers meander like real ones — and let the shader interpolate the rest.
const UP = 3;

// ---------------------------------------------------------------- noise (CPU)
function h2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  const t = a + (b - a) * fx;
  return t + (c + (d - c) * fx - t) * fy;
}

/**
 * Resample the province grid UP times finer.
 *  -2 = sea, -1 = land nobody holds, >=0 = province index.
 * Land is decided by the height the mesh actually draws, so the political fill
 * ends exactly at the coastline rather than a texel early or late.
 */
function buildIdField(map) {
  const { W, H, height, owner, provinces } = map;
  const HW = W * UP, HH = H * UP;
  const id = new Int16Array(HW * HH);
  const yh = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) yh[i] = Math.max(-0.06, height[i]);
  const waterH = -0.5 / M.yScale;
  const hAt = (x, y) => yh[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];

  const acc = new Float32Array(provinces.length);
  const touched = new Int32Array(16);

  for (let hy = 0; hy < HH; hy++) {
    const gy = (hy + 0.5) / UP - 0.5;
    const y0 = Math.floor(gy), fy = gy - y0;
    for (let hx = 0; hx < HW; hx++) {
      const gx = (hx + 0.5) / UP - 0.5;
      const x0 = Math.floor(gx), fx = gx - x0;

      const hA = hAt(x0, y0), hB = hAt(x0 + 1, y0), hC = hAt(x0, y0 + 1), hD = hAt(x0 + 1, y0 + 1);
      const t0 = hA + (hB - hA) * fx;
      const hv = t0 + (hC + (hD - hC) * fx - t0) * fy;
      if (hv <= waterH) { id[hy * HW + hx] = -2; continue; }

      const wx = gx + (vnoise(gx * 2.1 + 3.3, gy * 2.1 + 7.7) - 0.5) * 0.95
                    + (vnoise(gx * 5.7 + 21.1, gy * 5.7 + 13.9) - 0.5) * 0.42;
      const wy = gy + (vnoise(gx * 2.1 + 41.5, gy * 2.1 + 29.3) - 0.5) * 0.95
                    + (vnoise(gx * 5.7 + 61.7, gy * 5.7 + 3.1) - 0.5) * 0.42;
      const bx = Math.round(wx), by = Math.round(wy);

      let n = 0, best = -1, bestW = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = by + dy; if (yy < 0 || yy >= H) continue;
        let ky = 1 - Math.abs(yy - wy) / 1.6; if (ky <= 0) continue; ky *= ky;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = bx + dx; if (xx < 0 || xx >= W) continue;
          const o = owner[yy * W + xx]; if (o < 0) continue;
          let kx = 1 - Math.abs(xx - wx) / 1.6; if (kx <= 0) continue; kx *= kx;
          if (acc[o] === 0) touched[n++] = o;
          acc[o] += kx * ky;
          if (acc[o] > bestW) { bestW = acc[o]; best = o; }
        }
      }
      for (let k = 0; k < n; k++) acc[touched[k]] = 0;
      id[hy * HW + hx] = best < 0 ? -1 : best;
    }
  }
  return { id, HW, HH, UP };
}

export function buildMap(map) {
  M.meta = map;
  const { W, H, height, owner } = map;
  const sx = M.scaleXZ;

  const geo = new THREE.PlaneGeometry((W - 1) * sx, (H - 1) * sx, W - 1, H - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const biome = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = i % W, y = (i / W) | 0;
    const h = height[y * W + x];
    pos.setY(i, Math.max(-0.06, h) * M.yScale);
    const o = owner[y * W + x];
    if (o >= 0) biome[i] = TERR_IDX[map.provinces[o].terrain] ?? 0;
    // Land outside every realm still has to look like land, not like seabed.
    else if (h > -0.0114) biome[i] = h > 0.55 ? 4 : h > 0.30 ? 3 : 1;
    else biome[i] = 7;
  }
  geo.setAttribute('aBiome', new THREE.BufferAttribute(biome, 1));
  geo.computeVertexNormals();

  // --- province-id texture, supersampled ------------------------------------
  const field = buildIdField(map);
  M.idField = field;
  const { id: fid, HW, HH } = field;
  const data = new Uint8Array(HW * HH * 4);
  for (let i = 0; i < HW * HH; i++) {
    const o = fid[i];
    const n = o < 0 ? 0 : o + 1;
    data[i * 4 + 0] = n & 255;
    data[i * 4 + 1] = (n >> 8) & 255;
    data[i * 4 + 2] = o === -2 ? 0 : o === -1 ? 140 : 255;
    data[i * 4 + 3] = 255;
  }
  const ownerTex = new THREE.DataTexture(data, HW, HH, THREE.RGBAFormat);
  ownerTex.magFilter = ownerTex.minFilter = THREE.NearestFilter;
  ownerTex.needsUpdate = true;
  M.ownerTex = ownerTex;

  const PAL = 512;
  const pdata = new Uint8Array(PAL * 4).fill(255);
  const paletteTex = new THREE.DataTexture(pdata, PAL, 1, THREE.RGBAFormat);
  paletteTex.magFilter = paletteTex.minFilter = THREE.NearestFilter;
  paletteTex.needsUpdate = true;
  M.paletteTex = paletteTex;

  const bcols = BIOME_KEYS.map((k) => new THREE.Vector3(...BIOME_COLOR[k]));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uOwner: { value: ownerTex },
      uPalette: { value: paletteTex },
      uIdTexel: { value: new THREE.Vector2(1 / HW, 1 / HH) },
      // vUv -> id-texel coordinates. The mesh's v runs south-to-north while the
      // raster runs north-to-south; the flip lives here, once.
      uIdSpan: { value: new THREE.Vector2((W - 1) * UP, (H - 1) * UP) },
      uIdBias: { value: (UP - 1) * 0.5 },
      uCell: { value: new THREE.Vector2(W, H) },
      uSize: { value: new THREE.Vector2((W - 1) * sx, (H - 1) * sx) },
      uBiome: { value: bcols },
      uSunDir: { value: new THREE.Vector3(-0.52, 0.74, 0.42).normalize() },
      uSunColor: { value: new THREE.Color(0xfff0d2) },
      uSkyColor: { value: new THREE.Color(0x9fbcdd) },
      uGroundColor: { value: new THREE.Color(0x6d5c3f) },
      uParchment: { value: 0.0 },        // 0 = terrain, 1 = political parchment
      uHover: { value: -1 },
      uSelected: { value: -1 },
      uTime: { value: 0 },
      uBorderInk: { value: new THREE.Color(0x21160c) },
      uSeason: { value: 0.0 },           // 0 summer .. 1 winter (snow line)
      uYScale: { value: M.yScale },
      uFogColor: { value: new THREE.Color(0x6d87a2) },
      uFogDensity: { value: 0.00026 },
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
      uniform vec2 uIdTexel, uIdSpan, uCell;
      uniform float uIdBias;
      uniform vec3 uBiome[8];
      uniform vec3 uSunDir, uSunColor, uSkyColor, uGroundColor, uBorderInk, uFogColor;
      uniform float uParchment, uTime, uSeason, uYScale, uFogDensity;
      uniform float uHover, uSelected;
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld; varying float vBiome; varying float vH;

      float pid(vec2 uv){
        vec4 t = texture2D(uOwner, uv);
        if (t.b < 0.25) return -2.0;                       // sea
        if (t.b < 0.75) return -1.0;                       // land nobody holds
        return floor(t.r*255.0+0.5) + floor(t.g*255.0+0.5)*256.0 - 1.0;
      }
      vec4 palAt(float id){ return texture2D(uPalette, vec2((id+0.5)/512.0, 0.5)); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5;} return s; }

      // Bilinear arg-max over the province raster. Each of the four surrounding
      // texels votes with its bilinear weight; the province with most votes owns
      // the pixel, so the frontier is a straight line halfway between texels
      // instead of a staircase. How far the winner leads doubles as a distance
      // to the border — which is what lets us draw ink one pixel wide.
      void idField(out float id, out float edge, out float rival){
        vec2 g = vec2(vUv.x, 1.0 - vUv.y) * uIdSpan + uIdBias;
        vec2 i0 = floor(g), f = g - i0;
        vec2 b0 = (i0 + 0.5) * uIdTexel;
        float a = pid(b0);
        float b = pid(b0 + vec2(uIdTexel.x, 0.0));
        float c = pid(b0 + vec2(0.0, uIdTexel.y));
        float e = pid(b0 + uIdTexel);
        float wa = (1.0-f.x)*(1.0-f.y), wb = f.x*(1.0-f.y), wc = (1.0-f.x)*f.y, we = f.x*f.y;
        float sa = wa + (b==a?wb:0.0) + (c==a?wc:0.0) + (e==a?we:0.0);
        float sb = wb + (a==b?wa:0.0) + (c==b?wc:0.0) + (e==b?we:0.0);
        float sc = wc + (a==c?wa:0.0) + (b==c?wb:0.0) + (e==c?we:0.0);
        float se = we + (a==e?wa:0.0) + (b==e?wb:0.0) + (c==e?wc:0.0);
        float bi = a, bw = sa;
        if (sb > bw) { bi = b; bw = sb; }
        if (sc > bw) { bi = c; bw = sc; }
        if (se > bw) { bi = e; bw = se; }
        float rw = 0.0, ri = bi;
        if (a != bi && sa > rw) { rw = sa; ri = a; }
        if (b != bi && sb > rw) { rw = sb; ri = b; }
        if (c != bi && sc > rw) { rw = sc; ri = c; }
        if (e != bi && se > rw) { rw = se; ri = e; }
        id = bi; edge = bw - rw; rival = ri;
      }

      void main(){
        float id, edge, rival;
        idField(id, edge, rival);

        // --- ink border: constant width on screen, antialiased by derivative --
        float grad = max(fwidth(edge), 1e-5);
        float wpx = mix(1.10, 1.70, uParchment);
        float t0 = min(wpx*grad, 0.30);
        float t1 = min((wpx+1.2)*grad, 0.58);
        float b = 1.0 - smoothstep(t0, t1, edge);
        // a frontier with the sea is a coastline, not a treaty line
        float coast = (id < -1.5 || rival < -1.5) ? 1.0 : 0.0;
        b *= mix(1.0, 0.34, coast);

        // --- terrain colour --------------------------------------------------
        int bi = int(vBiome + 0.5);
        vec3 base = uBiome[0];
        for (int k=0;k<8;k++) if (k==bi) base = uBiome[k];
        float g = fbm(vUv*uCell*0.55);
        base *= 0.82 + g*0.40;
        // rock exposure on steep slopes
        float slope = 1.0 - clamp(vNormal.y, 0.0, 1.0);
        base = mix(base, vec3(0.22,0.20,0.185), smoothstep(0.25,0.65,slope));
        // snow
        float snowLine = mix(1.24, 0.66, uSeason) * uYScale;
        float snow = smoothstep(snowLine, snowLine+9.0, vH) * (1.0 - smoothstep(0.5,0.85,slope));
        base = mix(base, vec3(0.68,0.72,0.80), snow);

        // --- political colour -------------------------------------------------
        vec4 pc = id < 0.0 ? vec4(0.0) : palAt(id);
        vec3 polit = pc.rgb;

        // parchment look for the zoomed-out political map
        float paper = fbm(vUv*uCell*0.30)*0.5 + fbm(vUv*uCell*1.7)*0.25;
        vec3 parch = mix(vec3(0.58,0.50,0.36), vec3(0.44,0.36,0.25), paper);
        parch = mix(parch, polit, 0.55*pc.a);
        parch *= 0.92 + 0.16*fbm(vUv*uCell*4.0);

        vec3 terr = mix(base, polit*0.55, 0.34*pc.a);
        vec3 col = mix(terr, parch, uParchment);

        // --- lighting ---------------------------------------------------------
        // A warm key, a cool sky fill and a little bounce off the ground. The
        // wrapped term keeps north-facing slopes readable instead of black.
        vec3 N = normalize(vNormal);
        vec3 L = normalize(uSunDir);
        float ndl = dot(N, L);
        float key = clamp(ndl, 0.0, 1.0);
        float soft = clamp(ndl*0.5 + 0.5, 0.0, 1.0);
        vec3 lightSum = uSunColor * (key*0.42 + soft*0.20)
                      + uSkyColor * (0.26 + 0.20*N.y)
                      + uGroundColor * 0.10;
        vec3 lit = col * lightSum;
        // parchment is lit flatly: it is a document, not a landscape
        col = mix(lit, col * (0.95 + 0.10*ndl), uParchment);

        // --- ink borders -------------------------------------------------------
        col = mix(col, uBorderInk, b * mix(0.55, 0.85, uParchment));

        // --- hover / selection -------------------------------------------------
        if (uHover >= 0.0 && abs(id - uHover) < 0.5)   col += vec3(0.10,0.10,0.07);
        if (uSelected >= 0.0 && abs(id - uSelected) < 0.5) {
          col = mix(col, vec3(1.0,0.86,0.52), 0.20 + 0.10*sin(uTime*3.0));
          if (b > 0.35) col = mix(col, vec3(1.0,0.90,0.60), 0.85);
        }

        // --- coast darkening ----------------------------------------------------
        col *= 1.0 - smoothstep(2.0, 0.0, vH) * 0.10;

        float depth = length(vWorld - cameraPosition);
        float fogF = 1.0 - exp(-uFogDensity*uFogDensity*depth*depth);
        col = mix(col, uFogColor, min(fogF, 0.58) * (1.0 - uParchment*0.85));

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
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
      uDeep: { value: new THREE.Color(0x0d2136) },
      uShallow: { value: new THREE.Color(0x1c5c78) },
      uSun: { value: new THREE.Vector3(-0.5, 0.7, 0.4).normalize() },
      uParchment: { value: 0 },
      uPaper: { value: new THREE.Color(0x71818c) },
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
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
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
export function setParchment(t) {
  if (!M.mat) return;
  M.mat.uniforms.uParchment.value = t;
  M.water.uniforms.uParchment.value = t;
  setSkyParchment(t);
}
let _season = -1;
export function setSeason(t) {
  if (!M.mat) return;
  M.mat.uniforms.uSeason.value = t;
  if (Math.abs(t - _season) < 0.004) return;      // only relight when it moves
  _season = t;
  const dir = setDaylight(t);
  M.mat.uniforms.uSunDir.value.copy(dir);
  M.mat.uniforms.uSunColor.value.copy(R.sun.color).multiplyScalar(R.sun.intensity / 2.4);
  M.mat.uniforms.uSkyColor.value.copy(R.hemi.color);
  M.mat.uniforms.uGroundColor.value.copy(R.hemi.groundColor);
  M.water.uniforms.uSun.value.copy(dir);
}
export function tickMap(dt) {
  if (!M.mat) return;
  M.mat.uniforms.uTime.value += dt;
  M.water.uniforms.uTime.value += dt;
}
/** World position -> province index (-1 = sea). Reads the same raster the
 *  shader paints from, so what you click is what is highlighted. */
export function provinceAtWorld(x, z) {
  const { W, H } = M.meta, sx = M.scaleXZ, f = M.idField;
  const gx = x / sx + (W - 1) / 2, gy = z / sx + (H - 1) / 2;
  if (!f) {
    const ix = Math.round(gx), iy = Math.round(gy);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return -1;
    return M.meta.owner[iy * W + ix];
  }
  const hx = Math.floor((gx + 0.5) * f.UP), hy = Math.floor((gy + 0.5) * f.UP);
  if (hx < 0 || hy < 0 || hx >= f.HW || hy >= f.HH) return -1;
  const v = f.id[hy * f.HW + hx];
  return v < 0 ? -1 : v;
}
export function worldOfProvince(i) {
  const p = M.meta.provinces[i]; if (!p) return null;
  const { W, H } = M.meta, sx = M.scaleXZ;
  const x = (p.cx - (W - 1) / 2) * sx, z = (p.cy - (H - 1) / 2) * sx;
  const h = M.meta.height[Math.round(p.cy) * W + Math.round(p.cx)] || 0;
  return new THREE.Vector3(x, Math.max(0, h) * M.yScale, z);
}
