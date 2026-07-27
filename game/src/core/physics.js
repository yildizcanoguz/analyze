// physics.js — collision & rigid body system for OVERSTRIKE.  Owner: `physics`.
//
// Contents
//   1. scratch math (point/segment/triangle closest-point, ray tests)
//   2. binned-SAH BVH builder (used for both the triangle BVH and the chunk BVH)
//   3. static geometry chunks (baked world-space triangle soup + adjacency flags)
//   4. Physics system: raycast / sphereCast / capsuleMove / statics / bodies / entities
//
// CONVENTIONS (binding — other systems rely on these)
//   capsuleMove(pos, halfHeight, radius, delta)
//     `pos`        FEET position (matches ctx.player.position)
//     `halfHeight` HALF the capsule's TOTAL height, so a 1.8 m player passes 0.9.
//                  The capsule centre is pos + (0, halfHeight, 0); its inner segment
//                  runs from pos.y+radius to pos.y+2*halfHeight-radius.
//     `delta`      world-space translation to attempt this frame.
//     returns { pos:Vector3(feet), grounded, normal:Vector3, hitSurface,
//               ceiling, blocked, stepped, groundObject, groundEntity }
//   Hitboxes  { name, bone|object3D, radius, height, mult, offset?, axis?, anchor? }
//     `height` is the capsule's TOTAL length along `axis` (default local +Y),
//     `anchor` is 'center' (default) | 'base' | 'top'.
//
// Everything is deterministic: bodies advance on a fixed internal timestep and are
// interpolated for rendering.
//
// CONTRACT API
//   raycast(origin, dir, maxDist, opts?)  opts: { entities:true, statics:true,
//        ignore:Object3D|[]|Set|fn, ignoreEntity, cull:false, includeDead:false }
//   sphereCast(origin, dir, radius, maxDist, opts?)
//   capsuleMove(pos, halfHeight, radius, delta, opts?)  opts: { stepHeight:0.4,
//        slopeLimit:46 (degrees), snap:true, snapDistance, allowClimb:false }
//   addStatic(o) / removeStatic(o) / addBody(opts) / overlapSphere(pos, r)
//   registerEntity(e) / unregisterEntity(e) / debugDraw(on)
//
// EXTENSIONS (safe to use, not in the contract)
//   refreshStatic(o)            re-bake a static that moved (doors, destructibles)
//   overlapBodies(pos, r)       dynamic bodies in a sphere
//   penetrationDepth(pos,hh,r)  how deep a capsule is inside geometry (0 = clear)
//   capsuleFits(pos,hh,r)       crouch/stand clearance test
//   addConstraint / removeConstraint / ragdoll(parts, opts)
//   setGravity(x,y,z) · stepFixed(h) · syncEntities(force) · stats · debugState()
//   Bodies expose: applyImpulse(v, point?), applyForce(f, dt), wake(), remove(),
//   position, quaternion, velocity, angularVelocity, sleeping, groundSurface.
//   Physics listens for the `explosion` event and throws nearby bodies itself.
//   Tag geometry with `mesh.userData.collision = false` to exclude it.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const SKIN = 0.006;          // target separation kept between capsule and geometry
const CONTACT_EPS = 1e-4;
const DEG = Math.PI / 180;
const DEFAULT_SLOPE_COS = Math.cos(46 * DEG);   // ~0.6947
const STEP_HEIGHT = 0.4;
const BIG = 1e30;

// closest-feature codes returned by the triangle routines
const F_VA = 0, F_VB = 1, F_VC = 2, F_EAB = 3, F_EBC = 4, F_ECA = 5, F_FACE = 6;

const DEFAULT_SURFACE = 'concrete';
const DEFAULT_PENETRATION = 0.25;

// ---------------------------------------------------------------------------
// 1. scratch math
// ---------------------------------------------------------------------------

// closest point on a triangle to a point. writes PT.{x,y,z,f}
const PT = { x: 0, y: 0, z: 0, f: F_FACE };
function closestPtPointTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { PT.x = ax; PT.y = ay; PT.z = az; PT.f = F_VA; return; }

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { PT.x = bx; PT.y = by; PT.z = bz; PT.f = F_VB; return; }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    PT.x = ax + abx * v; PT.y = ay + aby * v; PT.z = az + abz * v; PT.f = F_EAB; return;
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { PT.x = cx; PT.y = cy; PT.z = cz; PT.f = F_VC; return; }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    PT.x = ax + acx * w; PT.y = ay + acy * w; PT.z = az + acz * w; PT.f = F_ECA; return;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    PT.x = bx + (cx - bx) * w; PT.y = by + (cy - by) * w; PT.z = bz + (cz - bz) * w;
    PT.f = F_EBC; return;
  }

  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  PT.x = ax + abx * v + acx * w;
  PT.y = ay + aby * v + acy * w;
  PT.z = az + abz * v + acz * w;
  PT.f = F_FACE;
}

// closest points between two segments. writes SS.{s,t,ax..,bx..}
const SS = { s: 0, t: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 };
function closestPtSegSeg(p1x, p1y, p1z, q1x, q1y, q1z, p2x, p2y, p2z, q2x, q2y, q2z) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  const E = 1e-14;
  if (a <= E && e <= E) { s = 0; t = 0; }
  else if (a <= E) { s = 0; t = f / e; t = t < 0 ? 0 : t > 1 ? 1 : t; }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= E) { t = 0; s = -c / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      if (denom > 1e-18) { s = (b * f - c * e) / denom; s = s < 0 ? 0 : s > 1 ? 1 : s; }
      else s = 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = -c / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
      else if (t > 1) { t = 1; s = (b - c) / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
    }
  }
  SS.s = s; SS.t = t;
  SS.ax = p1x + d1x * s; SS.ay = p1y + d1y * s; SS.az = p1z + d1z * s;
  SS.bx = p2x + d2x * t; SS.by = p2y + d2y * t; SS.bz = p2z + d2z * t;
}

// closest point pair between a segment and a triangle.
// writes CP.{sx,sy,sz} (on segment) CP.{tx,ty,tz} (on triangle) CP.d2, CP.f
const CP = { sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, d2: 0, f: F_FACE };
function segTriClosest(p0x, p0y, p0z, p1x, p1y, p1z,
  ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz) {
  // through the face?
  const s0 = (p0x - ax) * nx + (p0y - ay) * ny + (p0z - az) * nz;
  const s1 = (p1x - ax) * nx + (p1y - ay) * ny + (p1z - az) * nz;
  if ((s0 > 0) !== (s1 > 0)) {
    const u = s0 / (s0 - s1);
    const ix = p0x + (p1x - p0x) * u, iy = p0y + (p1y - p0y) * u, iz = p0z + (p1z - p0z) * u;
    closestPtPointTri(ix, iy, iz, ax, ay, az, bx, by, bz, cx, cy, cz);
    if (PT.f === F_FACE) {
      CP.sx = ix; CP.sy = iy; CP.sz = iz;
      CP.tx = ix; CP.ty = iy; CP.tz = iz;
      CP.d2 = 0; CP.f = F_FACE; return 0;
    }
  }

  let best = BIG;
  // endpoints against the face
  closestPtPointTri(p0x, p0y, p0z, ax, ay, az, bx, by, bz, cx, cy, cz);
  let ddx = p0x - PT.x, ddy = p0y - PT.y, ddz = p0z - PT.z;
  let d2 = ddx * ddx + ddy * ddy + ddz * ddz;
  if (d2 < best) {
    best = d2; CP.sx = p0x; CP.sy = p0y; CP.sz = p0z;
    CP.tx = PT.x; CP.ty = PT.y; CP.tz = PT.z; CP.f = PT.f;
  }
  closestPtPointTri(p1x, p1y, p1z, ax, ay, az, bx, by, bz, cx, cy, cz);
  ddx = p1x - PT.x; ddy = p1y - PT.y; ddz = p1z - PT.z;
  d2 = ddx * ddx + ddy * ddy + ddz * ddz;
  if (d2 < best) {
    best = d2; CP.sx = p1x; CP.sy = p1y; CP.sz = p1z;
    CP.tx = PT.x; CP.ty = PT.y; CP.tz = PT.z; CP.f = PT.f;
  }

  // segment against the three edges
  for (let e = 0; e < 3; e++) {
    let ex0, ey0, ez0, ex1, ey1, ez1;
    if (e === 0) { ex0 = ax; ey0 = ay; ez0 = az; ex1 = bx; ey1 = by; ez1 = bz; }
    else if (e === 1) { ex0 = bx; ey0 = by; ez0 = bz; ex1 = cx; ey1 = cy; ez1 = cz; }
    else { ex0 = cx; ey0 = cy; ez0 = cz; ex1 = ax; ey1 = ay; ez1 = az; }
    closestPtSegSeg(p0x, p0y, p0z, p1x, p1y, p1z, ex0, ey0, ez0, ex1, ey1, ez1);
    ddx = SS.ax - SS.bx; ddy = SS.ay - SS.by; ddz = SS.az - SS.bz;
    d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 < best) {
      best = d2;
      CP.sx = SS.ax; CP.sy = SS.ay; CP.sz = SS.az;
      CP.tx = SS.bx; CP.ty = SS.by; CP.tz = SS.bz;
      CP.f = SS.t < 1e-5 ? e : SS.t > 1 - 1e-5 ? (e + 1) % 3 : 3 + e;
    }
  }
  CP.d2 = best;
  return best;
}

// ray vs capsule (segment a..b, radius r). returns t or -1; writes RC.{nx,ny,nz}
const RC = { nx: 0, ny: 0, nz: 0 };
function rayCapsule(ox, oy, oz, dx, dy, dz, maxT, ax, ay, az, bx, by, bz, r) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const oax = ox - ax, oay = oy - ay, oaz = oz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;

  if (baba > 1e-12) {
    const A = baba - bard * bard;
    const B = baba * rdoa - baoa * bard;
    const C = baba * oaoa - baoa * baoa - r * r * baba;
    if (Math.abs(A) > 1e-12) {
      const h = B * B - A * C;
      if (h >= 0) {
        const sh = Math.sqrt(h);
        for (let k = 0; k < 2; k++) {
          const t = (k === 0 ? (-B - sh) : (-B + sh)) / A;
          if (t < 0 || t > maxT) continue;
          const y = baoa + t * bard;
          if (y > 0 && y < baba) {
            const inv = 1 / r, s = y / baba;
            RC.nx = (oax + t * dx - bax * s) * inv;
            RC.ny = (oay + t * dy - bay * s) * inv;
            RC.nz = (oaz + t * dz - baz * s) * inv;
            return t;
          }
        }
      }
    }
  }
  // caps
  let bestT = -1;
  for (let k = 0; k < 2; k++) {
    const px = k === 0 ? ax : bx, py = k === 0 ? ay : by, pz = k === 0 ? az : bz;
    const ocx = ox - px, ocy = oy - py, ocz = oz - pz;
    const B = dx * ocx + dy * ocy + dz * ocz;
    const C = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    const h = B * B - C;
    if (h < 0) continue;
    const sh = Math.sqrt(h);
    let t = -B - sh;
    if (t < 0) t = -B + sh;
    if (t < 0 || t > maxT) continue;
    if (bestT < 0 || t < bestT) {
      bestT = t;
      const inv = 1 / r;
      RC.nx = (ocx + t * dx) * inv; RC.ny = (ocy + t * dy) * inv; RC.nz = (ocz + t * dz) * inv;
    }
  }
  return bestT;
}

// ---------------------------------------------------------------------------
// 2. BVH  (binned SAH, flat typed arrays, iterative build)
// ---------------------------------------------------------------------------

const NBINS = 12;
const _binMin = new Float64Array(NBINS * 3);
const _binMax = new Float64Array(NBINS * 3);
const _binCnt = new Int32Array(NBINS);
const _accL = new Float64Array(NBINS);
const _accR = new Float64Array(NBINS);
const _cntL = new Int32Array(NBINS);
const _cntR = new Int32Array(NBINS);

function surfaceArea(mnx, mny, mnz, mxx, mxy, mxz) {
  const dx = mxx - mnx, dy = mxy - mny, dz = mxz - mnz;
  if (dx < 0 || dy < 0 || dz < 0) return 0;
  return 2 * (dx * dy + dy * dz + dz * dx);
}

/**
 * Build a BVH over `count` primitives described by flat arrays.
 * pmin/pmax: Float32Array(3*count), cent: Float32Array(3*count)
 * Returns { bounds:Float32Array(6*n), left:Int32Array(n), start, count, order, nodes }
 */
function buildBVH(count, pmin, pmax, cent, maxLeaf = 8) {
  const order = new Int32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  const cap = Math.max(2, count * 2);
  const bounds = new Float32Array(6 * cap);
  const left = new Int32Array(cap).fill(-1);
  const start = new Int32Array(cap);
  const cnt = new Int32Array(cap);
  let nodes = 1;
  start[0] = 0; cnt[0] = count;

  const fitNode = (n) => {
    let mnx = BIG, mny = BIG, mnz = BIG, mxx = -BIG, mxy = -BIG, mxz = -BIG;
    const s = start[n], c = cnt[n];
    for (let i = s; i < s + c; i++) {
      const p = order[i] * 3;
      if (pmin[p] < mnx) mnx = pmin[p];
      if (pmin[p + 1] < mny) mny = pmin[p + 1];
      if (pmin[p + 2] < mnz) mnz = pmin[p + 2];
      if (pmax[p] > mxx) mxx = pmax[p];
      if (pmax[p + 1] > mxy) mxy = pmax[p + 1];
      if (pmax[p + 2] > mxz) mxz = pmax[p + 2];
    }
    const b = n * 6;
    bounds[b] = mnx; bounds[b + 1] = mny; bounds[b + 2] = mnz;
    bounds[b + 3] = mxx; bounds[b + 4] = mxy; bounds[b + 5] = mxz;
  };

  if (count === 0) {
    bounds.set([BIG, BIG, BIG, -BIG, -BIG, -BIG], 0);
    return { bounds, left, start, count: cnt, order, nodes: 1 };
  }
  fitNode(0);

  const stack = [0];
  while (stack.length) {
    const n = stack.pop();
    const s = start[n], c = cnt[n];
    if (c <= maxLeaf) continue;

    // centroid bounds
    let cmnx = BIG, cmny = BIG, cmnz = BIG, cmxx = -BIG, cmxy = -BIG, cmxz = -BIG;
    for (let i = s; i < s + c; i++) {
      const p = order[i] * 3;
      const x = cent[p], y = cent[p + 1], z = cent[p + 2];
      if (x < cmnx) cmnx = x; if (x > cmxx) cmxx = x;
      if (y < cmny) cmny = y; if (y > cmxy) cmxy = y;
      if (z < cmnz) cmnz = z; if (z > cmxz) cmxz = z;
    }
    const ext = [cmxx - cmnx, cmxy - cmny, cmxz - cmnz];
    const cmn = [cmnx, cmny, cmnz];
    if (ext[0] <= 1e-9 && ext[1] <= 1e-9 && ext[2] <= 1e-9) continue; // degenerate → leaf

    const nb = n * 6;
    const parentArea = surfaceArea(bounds[nb], bounds[nb + 1], bounds[nb + 2],
      bounds[nb + 3], bounds[nb + 4], bounds[nb + 5]) || 1e-9;

    let bestAxis = -1, bestSplit = -1, bestCost = c * parentArea;

    for (let axis = 0; axis < 3; axis++) {
      if (ext[axis] <= 1e-9) continue;
      const k = (NBINS * (1 - 1e-6)) / ext[axis];
      for (let i = 0; i < NBINS; i++) {
        _binCnt[i] = 0;
        _binMin[i * 3] = _binMin[i * 3 + 1] = _binMin[i * 3 + 2] = BIG;
        _binMax[i * 3] = _binMax[i * 3 + 1] = _binMax[i * 3 + 2] = -BIG;
      }
      for (let i = s; i < s + c; i++) {
        const pi = order[i] * 3;
        let bi = ((cent[pi + axis] - cmn[axis]) * k) | 0;
        if (bi < 0) bi = 0; else if (bi >= NBINS) bi = NBINS - 1;
        _binCnt[bi]++;
        const b3 = bi * 3;
        if (pmin[pi] < _binMin[b3]) _binMin[b3] = pmin[pi];
        if (pmin[pi + 1] < _binMin[b3 + 1]) _binMin[b3 + 1] = pmin[pi + 1];
        if (pmin[pi + 2] < _binMin[b3 + 2]) _binMin[b3 + 2] = pmin[pi + 2];
        if (pmax[pi] > _binMax[b3]) _binMax[b3] = pmax[pi];
        if (pmax[pi + 1] > _binMax[b3 + 1]) _binMax[b3 + 1] = pmax[pi + 1];
        if (pmax[pi + 2] > _binMax[b3 + 2]) _binMax[b3 + 2] = pmax[pi + 2];
      }
      // sweep left
      let mnx = BIG, mny = BIG, mnz = BIG, mxx = -BIG, mxy = -BIG, mxz = -BIG, run = 0;
      for (let i = 0; i < NBINS - 1; i++) {
        const b3 = i * 3;
        if (_binCnt[i]) {
          if (_binMin[b3] < mnx) mnx = _binMin[b3];
          if (_binMin[b3 + 1] < mny) mny = _binMin[b3 + 1];
          if (_binMin[b3 + 2] < mnz) mnz = _binMin[b3 + 2];
          if (_binMax[b3] > mxx) mxx = _binMax[b3];
          if (_binMax[b3 + 1] > mxy) mxy = _binMax[b3 + 1];
          if (_binMax[b3 + 2] > mxz) mxz = _binMax[b3 + 2];
          run += _binCnt[i];
        }
        _accL[i] = run ? surfaceArea(mnx, mny, mnz, mxx, mxy, mxz) : 0;
        _cntL[i] = run;
      }
      // sweep right
      mnx = mny = mnz = BIG; mxx = mxy = mxz = -BIG; run = 0;
      for (let i = NBINS - 1; i > 0; i--) {
        const b3 = i * 3;
        if (_binCnt[i]) {
          if (_binMin[b3] < mnx) mnx = _binMin[b3];
          if (_binMin[b3 + 1] < mny) mny = _binMin[b3 + 1];
          if (_binMin[b3 + 2] < mnz) mnz = _binMin[b3 + 2];
          if (_binMax[b3] > mxx) mxx = _binMax[b3];
          if (_binMax[b3 + 1] > mxy) mxy = _binMax[b3 + 1];
          if (_binMax[b3 + 2] > mxz) mxz = _binMax[b3 + 2];
          run += _binCnt[i];
        }
        _accR[i - 1] = run ? surfaceArea(mnx, mny, mnz, mxx, mxy, mxz) : 0;
        _cntR[i - 1] = run;
      }
      for (let i = 0; i < NBINS - 1; i++) {
        if (!_cntL[i] || !_cntR[i]) continue;
        const cost = _accL[i] * _cntL[i] + _accR[i] * _cntR[i];
        if (cost < bestCost) { bestCost = cost; bestAxis = axis; bestSplit = i; }
      }
    }

    let mid = -1;
    if (bestAxis >= 0) {
      const k = (NBINS * (1 - 1e-6)) / ext[bestAxis];
      let i = s, j = s + c - 1;
      while (i <= j) {
        const pi = order[i] * 3;
        let bi = ((cent[pi + bestAxis] - cmn[bestAxis]) * k) | 0;
        if (bi < 0) bi = 0; else if (bi >= NBINS) bi = NBINS - 1;
        if (bi <= bestSplit) i++;
        else { const tmp = order[i]; order[i] = order[j]; order[j] = tmp; j--; }
      }
      mid = i;
    }
    if (mid <= s || mid >= s + c) {
      // fall back to a median split on the widest axis
      let axis = 0;
      if (ext[1] > ext[axis]) axis = 1;
      if (ext[2] > ext[axis]) axis = 2;
      const sub = Array.from(order.subarray(s, s + c));
      sub.sort((a, b) => cent[a * 3 + axis] - cent[b * 3 + axis]);
      order.set(sub, s);
      mid = s + (c >> 1);
      if (c <= maxLeaf * 2) continue;  // small and unsplittable — leave as leaf
    }

    const l = nodes++, r = nodes++;
    start[l] = s; cnt[l] = mid - s;
    start[r] = mid; cnt[r] = s + c - mid;
    left[n] = l; cnt[n] = 0;
    fitNode(l); fitNode(r);
    stack.push(l, r);
  }

  return { bounds, left, start, count: cnt, order, nodes };
}

// growable index list
class IdxList {
  constructor(n = 256) { this.a = new Int32Array(n); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) {
      const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b;
    }
    this.a[this.n++] = v;
  }
  clear() { this.n = 0; }
}

const _stack = new Int32Array(256);

// ---------------------------------------------------------------------------
// 3. static chunk — a baked, immutable triangle soup with its own BVH
// ---------------------------------------------------------------------------

const _m4 = new THREE.Matrix4();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _vd = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _qd = new THREE.Quaternion();

class Chunk {
  constructor(root) {
    this.root = root;
    this.pos = null;     // Float32Array 9*n : a,b,c
    this.nrm = null;     // Float32Array 3*n : unit face normal
    this.grp = null;     // Uint16Array n    : index into this.groups
    this.edge = null;    // Uint8Array n     : bit i set → edge i is internal
    this.groups = [];    // { mesh, material, surface, penetration }
    this.tris = 0;
    this.bvh = null;
    this.min = new THREE.Vector3(BIG, BIG, BIG);
    this.max = new THREE.Vector3(-BIG, -BIG, -BIG);
  }

  build(opts = {}) {
    const root = this.root;
    root.updateWorldMatrix(true, true);

    const meshes = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData && (o.userData.collision === false || o.userData.noCollide)) return;
      if (o.isSkinnedMesh) return;               // characters use hitboxes, not the BVH
      const g = o.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      meshes.push(o);
    });

    // count triangles first
    let total = 0;
    for (const m of meshes) {
      const g = m.geometry;
      const n = g.index ? g.index.count : g.attributes.position.count;
      const inst = m.isInstancedMesh ? m.count : 1;
      total += Math.floor(n / 3) * inst;
    }
    const limit = opts.maxTris || 400000;
    if (total > limit) total = limit;

    const pos = new Float32Array(total * 9);
    const nrm = new Float32Array(total * 3);
    const grp = new Uint16Array(total);
    let t = 0;

    const pushTri = (ax, ay, az, bx, by, bz, cx, cy, cz, gi) => {
      if (t >= total) return;
      // face normal + degenerate rejection
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-12) return;
      nx /= l; ny /= l; nz /= l;
      const o = t * 9;
      pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az;
      pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz;
      pos[o + 6] = cx; pos[o + 7] = cy; pos[o + 8] = cz;
      nrm[t * 3] = nx; nrm[t * 3 + 1] = ny; nrm[t * 3 + 2] = nz;
      grp[t] = gi;
      t++;
    };

    for (const mesh of meshes) {
      const geo = mesh.geometry;
      const pa = geo.attributes.position;
      const index = geo.index;
      const triCount = Math.floor((index ? index.count : pa.count) / 3);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const geoGroups = (geo.groups && geo.groups.length && mats.length > 1) ? geo.groups : null;

      // group table for this mesh's materials
      const gidx = mats.map((mat) => {
        const ud = (mat && mat.userData) || {};
        const gi = this.groups.length;
        this.groups.push({
          mesh,
          material: mat || null,
          surface: ud.surface || DEFAULT_SURFACE,
          penetration: ud.penetration != null ? ud.penetration : DEFAULT_PENETRATION,
        });
        return Math.min(gi, 65535);
      });
      const matForTri = (ti) => {
        if (!geoGroups) return gidx[0];
        const i0 = ti * 3;
        for (let g = 0; g < geoGroups.length; g++) {
          const gg = geoGroups[g];
          if (i0 >= gg.start && i0 < gg.start + gg.count) {
            return gidx[Math.min(gg.materialIndex || 0, gidx.length - 1)];
          }
        }
        return gidx[0];
      };

      const instCount = mesh.isInstancedMesh ? mesh.count : 1;
      for (let inst = 0; inst < instCount; inst++) {
        if (mesh.isInstancedMesh) {
          mesh.getMatrixAt(inst, _m4);
          _m4.premultiply(mesh.matrixWorld);
        } else {
          _m4.copy(mesh.matrixWorld);
        }
        const e = _m4.elements;
        for (let i = 0; i < triCount; i++) {
          const i0 = index ? index.getX(i * 3) : i * 3;
          const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
          const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;
          const ax0 = pa.getX(i0), ay0 = pa.getY(i0), az0 = pa.getZ(i0);
          const bx0 = pa.getX(i1), by0 = pa.getY(i1), bz0 = pa.getZ(i1);
          const cx0 = pa.getX(i2), cy0 = pa.getY(i2), cz0 = pa.getZ(i2);
          pushTri(
            e[0] * ax0 + e[4] * ay0 + e[8] * az0 + e[12],
            e[1] * ax0 + e[5] * ay0 + e[9] * az0 + e[13],
            e[2] * ax0 + e[6] * ay0 + e[10] * az0 + e[14],
            e[0] * bx0 + e[4] * by0 + e[8] * bz0 + e[12],
            e[1] * bx0 + e[5] * by0 + e[9] * bz0 + e[13],
            e[2] * bx0 + e[6] * by0 + e[10] * bz0 + e[14],
            e[0] * cx0 + e[4] * cy0 + e[8] * cz0 + e[12],
            e[1] * cx0 + e[5] * cy0 + e[9] * cz0 + e[13],
            e[2] * cx0 + e[6] * cy0 + e[10] * cz0 + e[14],
            matForTri(i),
          );
        }
      }
    }

    this.tris = t;
    this.pos = pos.subarray(0, t * 9);
    this.nrm = nrm.subarray(0, t * 3);
    this.grp = grp.subarray(0, t);
    this.edge = new Uint8Array(t);

    // primitive bounds for the BVH
    const pmin = new Float32Array(t * 3);
    const pmax = new Float32Array(t * 3);
    const cent = new Float32Array(t * 3);
    let mnx = BIG, mny = BIG, mnz = BIG, mxx = -BIG, mxy = -BIG, mxz = -BIG;
    for (let i = 0; i < t; i++) {
      const o = i * 9, p = i * 3;
      const x0 = Math.min(this.pos[o], this.pos[o + 3], this.pos[o + 6]);
      const y0 = Math.min(this.pos[o + 1], this.pos[o + 4], this.pos[o + 7]);
      const z0 = Math.min(this.pos[o + 2], this.pos[o + 5], this.pos[o + 8]);
      const x1 = Math.max(this.pos[o], this.pos[o + 3], this.pos[o + 6]);
      const y1 = Math.max(this.pos[o + 1], this.pos[o + 4], this.pos[o + 7]);
      const z1 = Math.max(this.pos[o + 2], this.pos[o + 5], this.pos[o + 8]);
      pmin[p] = x0; pmin[p + 1] = y0; pmin[p + 2] = z0;
      pmax[p] = x1; pmax[p + 1] = y1; pmax[p + 2] = z1;
      cent[p] = (x0 + x1) * 0.5; cent[p + 1] = (y0 + y1) * 0.5; cent[p + 2] = (z0 + z1) * 0.5;
      if (x0 < mnx) mnx = x0; if (y0 < mny) mny = y0; if (z0 < mnz) mnz = z0;
      if (x1 > mxx) mxx = x1; if (y1 > mxy) mxy = y1; if (z1 > mxz) mxz = z1;
    }
    this.min.set(mnx, mny, mnz);
    this.max.set(mxx, mxy, mxz);
    this.bvh = buildBVH(t, pmin, pmax, cent, opts.maxLeaf || 8);

    if (t && t <= (opts.maxAdjacency || 250000)) this._buildAdjacency();
    return this;
  }

  // mark edges that are internal (coplanar or concave) so contact normals can be
  // snapped to the face normal — this is what stops the capsule catching on the
  // seam between two coplanar floor triangles.
  _buildAdjacency() {
    const t = this.tris, P = this.pos, N = this.nrm;
    const vid = new Map();
    const ids = new Int32Array(t * 3);
    let next = 0;
    const q = 1000; // 1 mm weld grid
    for (let i = 0; i < t * 3; i++) {
      const o = i * 3;
      const key = `${Math.round(P[o] * q)},${Math.round(P[o + 1] * q)},${Math.round(P[o + 2] * q)}`;
      let id = vid.get(key);
      if (id === undefined) { id = next++; vid.set(key, id); }
      ids[i] = id;
    }
    const K = 4194304;
    const edges = new Map();  // key → tri*4 + edgeIdx
    for (let i = 0; i < t; i++) {
      for (let e = 0; e < 3; e++) {
        const a = ids[i * 3 + e], b = ids[i * 3 + (e + 1) % 3];
        const key = a < b ? a * K + b : b * K + a;
        const other = edges.get(key);
        if (other === undefined) { edges.set(key, i * 4 + e); continue; }
        const oi = other >> 2, oe = other & 3;
        // opposite vertex of the neighbour triangle
        const ov = (oe + 2) % 3;
        const op = oi * 9 + ov * 3;
        const ea = i * 9 + e * 3;
        const dx = P[op] - P[ea], dy = P[op + 1] - P[ea + 1], dz = P[op + 2] - P[ea + 2];
        const n1x = N[i * 3], n1y = N[i * 3 + 1], n1z = N[i * 3 + 2];
        const n2x = N[oi * 3], n2y = N[oi * 3 + 1], n2z = N[oi * 3 + 2];
        const dot = n1x * n2x + n1y * n2y + n1z * n2z;
        const concave = (n1x * dx + n1y * dy + n1z * dz) > 1e-5;
        if (dot > 0.9995 || concave) {
          this.edge[i] |= (1 << e);
          this.edge[oi] |= (1 << oe);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Physics system
// ---------------------------------------------------------------------------

const QUALITY = {
  low:    { hz: 90,  maxBodies: 48,  solverIters: 3, leaf: 12, bvhDepth: 5 },
  medium: { hz: 120, maxBodies: 96,  solverIters: 4, leaf: 10, bvhDepth: 6 },
  high:   { hz: 120, maxBodies: 192, solverIters: 6, leaf: 8,  bvhDepth: 7 },
  ultra:  { hz: 120, maxBodies: 320, solverIters: 8, leaf: 8,  bvhDepth: 8 },
};

// nx/ny/nz = contact normal (drives sliding), fnx/fny/fnz = oriented FACE normal of
// the triangle (drives walkability — a capsule resting on the lip of a step must
// still count as standing on the step's floor).
const HIT = {
  t: 0, nx: 0, ny: 0, nz: 0, fnx: 0, fny: 0, fnz: 0, px: 0, py: 0, pz: 0,
  chunk: null, tri: -1, surface: DEFAULT_SURFACE, penetration: DEFAULT_PENETRATION,
};
const NRM = { x: 0, y: 1, z: 0 };
const DP = { x: 0, y: 0, z: 0, pushed: 0, gx: 0, gy: 0, gz: 0, gTri: -1, gChunk: null };
const SL = { x: 0, y: 0, z: 0, ceiling: false, blocked: false, surface: null, hits: 0 };

export default class Physics {
  static id = 'physics';

  constructor(ctx) {
    this.ctx = ctx;
    const q = (ctx && ctx.settings && ctx.settings.quality) || 'high';
    this.tier = QUALITY[q] || QUALITY.high;

    this.chunks = [];
    this._chunkByRoot = new Map();
    this._top = null;
    this._topDirty = true;

    this.entities = [];
    this._entById = new Map();
    this._entFrame = -1;
    this._cellSize = 4;
    this._hash = new Map();

    this.bodies = [];
    this.constraints = [];
    this.gravity = new THREE.Vector3(0, -18.0, 0);
    this._acc = 0;
    this._step = 1 / this.tier.hz;
    this._bodyId = 1;

    this._cand = new IdxList(2048);
    this._bodyContacts = [];
    this._chunkCand = [];
    this._debug = null;
    this._preferUp = false;
    this._autoScans = 0;
    this._scanTick = 0;
    this._debugCapsules = [];
    this.stats = { rays: 0, sweeps: 0, bodies: 0, tris: 0, chunks: 0, buildMs: 0 };

    this._onExplosion = (p) => this._explosionImpulse(p);
    if (ctx && ctx.events) ctx.events.on('explosion', this._onExplosion);
  }

  async init() {
    // Level geometry is built before physics exists as a *system*, but our
    // constructor has already run, so level.init() may have called addStatic().
    // If nothing registered, adopt whatever the level put in the scene.
    if (!this.chunks.length) this.rebuildFromScene();
    if (this.ctx && this.ctx.events) {
      this.ctx.events.on('level:ready', () => { if (!this.chunks.length) this.rebuildFromScene(); });
    }
  }

  // ---- static geometry ----------------------------------------------------

  addStatic(object3D) {
    if (!object3D) return null;
    if (this._chunkByRoot.has(object3D)) this.removeStatic(object3D);
    const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
    const chunk = new Chunk(object3D).build({ maxLeaf: this.tier.leaf });
    this.stats.buildMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    if (!chunk.tris) return null;
    this.chunks.push(chunk);
    this._chunkByRoot.set(object3D, chunk);
    this._topDirty = true;
    this.stats.tris += chunk.tris;
    this.stats.chunks = this.chunks.length;
    if (this._debug) this._rebuildDebugStatic();
    return chunk;
  }

  removeStatic(object3D) {
    const chunk = this._chunkByRoot.get(object3D);
    if (!chunk) return false;
    const i = this.chunks.indexOf(chunk);
    if (i >= 0) this.chunks.splice(i, 1);
    this._chunkByRoot.delete(object3D);
    this.stats.tris -= chunk.tris;
    this.stats.chunks = this.chunks.length;
    this._topDirty = true;
    if (this._debug) this._rebuildDebugStatic();
    return true;
  }

  /** Re-bake a static that has moved (doors, destructibles). */
  refreshStatic(object3D) {
    this.removeStatic(object3D);
    return this.addStatic(object3D);
  }

  /** Adopt collidable meshes already in ctx.scene (used when no level registered any). */
  rebuildFromScene() {
    const ctx = this.ctx;
    if (!ctx || !ctx.scene) return;
    const lvl = ctx.level;
    const candidates = [];
    if (lvl) {
      for (const k of ['collision', 'collider', 'root', 'group', 'geometry3D']) {
        if (lvl[k] && lvl[k].isObject3D) { candidates.push(lvl[k]); break; }
      }
    }
    if (!candidates.length) {
      for (const child of ctx.scene.children) {
        if (!child.isObject3D) continue;
        const ud = child.userData || {};
        if (ud.collision === false || ud.noCollide) continue;
        if (child.isLight || child.isCamera) continue;
        const n = (child.name || '').toLowerCase();
        if (n.includes('sky') || n.includes('particle') || n.includes('debug')) continue;
        candidates.push(child);
      }
    }
    for (const c of candidates) {
      if (this._chunkByRoot.has(c)) continue;
      this.addStatic(c);
    }
  }

  _buildTop() {
    const n = this.chunks.length;
    const pmin = new Float32Array(n * 3), pmax = new Float32Array(n * 3), cent = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = this.chunks[i], p = i * 3;
      pmin[p] = c.min.x; pmin[p + 1] = c.min.y; pmin[p + 2] = c.min.z;
      pmax[p] = c.max.x; pmax[p + 1] = c.max.y; pmax[p + 2] = c.max.z;
      cent[p] = (c.min.x + c.max.x) * 0.5;
      cent[p + 1] = (c.min.y + c.max.y) * 0.5;
      cent[p + 2] = (c.min.z + c.max.z) * 0.5;
    }
    this._top = buildBVH(n, pmin, pmax, cent, 4);
    this._topDirty = false;
  }

  // ---- BVH traversal ------------------------------------------------------

  // Collect chunks whose (expanded) bounds are hit by the thick ray.
  _topThickRay(ox, oy, oz, dx, dy, dz, maxDist, ex, ey, ez, out) {
    out.length = 0;
    const n = this.chunks.length;
    if (!n) return out;
    if (this._topDirty || !this._top) this._buildTop();
    const T = this._top;
    if (!T.nodes) return out;
    const idx = 1 / (dx || 1e-20), idy = 1 / (dy || 1e-20), idz = 1 / (dz || 1e-20);
    let sp = 0; _stack[sp++] = 0;
    while (sp) {
      const ni = _stack[--sp];
      const b = ni * 6;
      if (!slabHit(T.bounds[b] - ex, T.bounds[b + 1] - ey, T.bounds[b + 2] - ez,
        T.bounds[b + 3] + ex, T.bounds[b + 4] + ey, T.bounds[b + 5] + ez,
        ox, oy, oz, idx, idy, idz, maxDist)) continue;
      const l = T.left[ni];
      if (l < 0) {
        const s = T.start[ni], c = T.count[ni];
        for (let i = s; i < s + c; i++) out.push(this.chunks[T.order[i]]);
      } else { _stack[sp++] = l; _stack[sp++] = l + 1; }
    }
    return out;
  }

  _topBox(mnx, mny, mnz, mxx, mxy, mxz, out) {
    out.length = 0;
    const n = this.chunks.length;
    if (!n) return out;
    if (this._topDirty || !this._top) this._buildTop();
    const T = this._top;
    let sp = 0; _stack[sp++] = 0;
    while (sp) {
      const ni = _stack[--sp];
      const b = ni * 6;
      if (T.bounds[b] > mxx || T.bounds[b + 3] < mnx ||
        T.bounds[b + 1] > mxy || T.bounds[b + 4] < mny ||
        T.bounds[b + 2] > mxz || T.bounds[b + 5] < mnz) continue;
      const l = T.left[ni];
      if (l < 0) {
        const s = T.start[ni], c = T.count[ni];
        for (let i = s; i < s + c; i++) out.push(this.chunks[T.order[i]]);
      } else { _stack[sp++] = l; _stack[sp++] = l + 1; }
    }
    return out;
  }

  // Collect triangle indices of `chunk` whose bounds (expanded by e) meet the ray.
  _chunkThickRay(chunk, ox, oy, oz, dx, dy, dz, maxDist, ex, ey, ez, list) {
    const B = chunk.bvh;
    if (!B || !chunk.tris) return;
    const idx = 1 / (dx || 1e-20), idy = 1 / (dy || 1e-20), idz = 1 / (dz || 1e-20);
    let sp = 0; _stack[sp++] = 0;
    while (sp) {
      const ni = _stack[--sp];
      const b = ni * 6;
      if (!slabHit(B.bounds[b] - ex, B.bounds[b + 1] - ey, B.bounds[b + 2] - ez,
        B.bounds[b + 3] + ex, B.bounds[b + 4] + ey, B.bounds[b + 5] + ez,
        ox, oy, oz, idx, idy, idz, maxDist)) continue;
      const l = B.left[ni];
      if (l < 0) {
        const s = B.start[ni], c = B.count[ni];
        for (let i = s; i < s + c; i++) list.push(B.order[i]);
      } else { _stack[sp++] = l; _stack[sp++] = l + 1; }
    }
  }

  _chunkBox(chunk, mnx, mny, mnz, mxx, mxy, mxz, list) {
    const B = chunk.bvh;
    if (!B || !chunk.tris) return;
    let sp = 0; _stack[sp++] = 0;
    while (sp) {
      const ni = _stack[--sp];
      const b = ni * 6;
      if (B.bounds[b] > mxx || B.bounds[b + 3] < mnx ||
        B.bounds[b + 1] > mxy || B.bounds[b + 4] < mny ||
        B.bounds[b + 2] > mxz || B.bounds[b + 5] < mnz) continue;
      const l = B.left[ni];
      if (l < 0) {
        const s = B.start[ni], c = B.count[ni];
        for (let i = s; i < s + c; i++) list.push(B.order[i]);
      } else { _stack[sp++] = l; _stack[sp++] = l + 1; }
    }
  }

  // ---- raycast ------------------------------------------------------------

  /**
   * raycast(origin, dir, maxDist, opts)
   * opts: { entities:true, statics:true, ignore:Object3D|[]|fn, ignoreEntity, cull:false }
   */
  raycast(origin, dir, maxDist = 1000, opts) {
    this.stats.rays++;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < 1e-12) return null;
    if (Math.abs(dl - 1) > 1e-6) { dx /= dl; dy /= dl; dz /= dl; }

    const o = opts || null;
    let best = maxDist;
    let hitChunk = null, hitTri = -1, hnx = 0, hny = 0, hnz = 0;

    if (!o || o.statics !== false) {
      const ignore = o && o.ignore ? o.ignore : null;
      const cull = !!(o && o.cull);
      const chunks = this._topThickRay(ox, oy, oz, dx, dy, dz, best, 0, 0, 0, this._chunkCand);
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        if (ignore && ignoreMatch(ignore, chunk.root)) continue;
        const list = this._cand; list.clear();
        this._chunkThickRay(chunk, ox, oy, oz, dx, dy, dz, best, 0, 0, 0, list);
        const P = chunk.pos, arr = list.a;
        for (let k = 0; k < list.n; k++) {
          const ti = arr[k], p = ti * 9;
          const ax = P[p], ay = P[p + 1], az = P[p + 2];
          const e1x = P[p + 3] - ax, e1y = P[p + 4] - ay, e1z = P[p + 5] - az;
          const e2x = P[p + 6] - ax, e2y = P[p + 7] - ay, e2z = P[p + 8] - az;
          const qx = dy * e2z - dz * e2y, qy = dz * e2x - dx * e2z, qz = dx * e2y - dy * e2x;
          const det = e1x * qx + e1y * qy + e1z * qz;
          if (det > -1e-12 && det < 1e-12) continue;
          if (cull && det < 0) continue;
          const inv = 1 / det;
          const tvx = ox - ax, tvy = oy - ay, tvz = oz - az;
          const u = (tvx * qx + tvy * qy + tvz * qz) * inv;
          if (u < 0 || u > 1) continue;
          const rx = tvy * e1z - tvz * e1y, ry = tvz * e1x - tvx * e1z, rz = tvx * e1y - tvy * e1x;
          const v = (dx * rx + dy * ry + dz * rz) * inv;
          if (v < 0 || u + v > 1) continue;
          const t = (e2x * rx + e2y * ry + e2z * rz) * inv;
          if (t < 1e-5 || t >= best) continue;
          if (ignore) {
            const g = chunk.groups[chunk.grp[ti]];
            if (g && ignoreMatch(ignore, g.mesh)) continue;
          }
          best = t; hitChunk = chunk; hitTri = ti;
        }
      }
    }

    // entity hitboxes
    let entHit = null;
    if (!o || o.entities !== false) {
      entHit = this._raycastEntities(ox, oy, oz, dx, dy, dz, best, o);
      if (entHit) best = entHit.distance;
    }

    if (entHit) return entHit;
    if (hitTri < 0) return null;

    const g = hitChunk.groups[hitChunk.grp[hitTri]] || null;
    hnx = hitChunk.nrm[hitTri * 3]; hny = hitChunk.nrm[hitTri * 3 + 1]; hnz = hitChunk.nrm[hitTri * 3 + 2];
    if (hnx * dx + hny * dy + hnz * dz > 0) { hnx = -hnx; hny = -hny; hnz = -hnz; }
    return {
      point: new THREE.Vector3(ox + dx * best, oy + dy * best, oz + dz * best),
      normal: new THREE.Vector3(hnx, hny, hnz),
      distance: best,
      surface: g ? g.surface : DEFAULT_SURFACE,
      penetration: g ? g.penetration : DEFAULT_PENETRATION,
      object: g ? g.mesh : hitChunk.root,
      material: g ? g.material : null,
      entity: null,
      part: null,
      mult: 1,
    };
  }

  /** sphereCast — same return shape as raycast. */
  sphereCast(origin, dir, radius = 0.1, maxDist = 100, opts) {
    let dx = dir.x, dy = dir.y, dz = dir.z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < 1e-12) return null;
    dx /= dl; dy /= dl; dz /= dl;
    const t = this._sweepCapsule(origin.x, origin.y, origin.z, 0, radius,
      dx * maxDist, dy * maxDist, dz * maxDist, 1, opts && opts.ignore);
    let best = t < 0 ? -1 : t * maxDist;
    let statHit = t >= 0 ? {
      point: new THREE.Vector3(HIT.px, HIT.py, HIT.pz),
      normal: new THREE.Vector3(HIT.nx, HIT.ny, HIT.nz),
      distance: best,
      surface: HIT.surface,
      penetration: HIT.penetration,
      object: HIT.chunk && HIT.chunk.groups[HIT.chunk.grp[HIT.tri]]
        ? HIT.chunk.groups[HIT.chunk.grp[HIT.tri]].mesh : (HIT.chunk ? HIT.chunk.root : null),
      entity: null, part: null, mult: 1,
    } : null;

    if (!opts || opts.entities !== false) {
      const lim = best < 0 ? maxDist : best;
      const eh = this._raycastEntities(origin.x, origin.y, origin.z, dx, dy, dz, lim, opts, radius);
      if (eh) return eh;
    }
    return statHit;
  }

  // ---- swept capsule ------------------------------------------------------

  // Sweep a vertical capsule (centre cx,cy,cz; half-segment hs; radius r) along
  // (mx,my,mz). Returns fraction in [0,tmax] or -1. Fills HIT.
  _sweepCapsule(cx, cy, cz, hs, r, mx, my, mz, tmax = 1, ignore = null) {
    this.stats.sweeps++;
    const len = Math.sqrt(mx * mx + my * my + mz * mz);
    if (len < 1e-12) return -1;
    const ex = r + 1e-3, ey = r + hs + 1e-3, ez = r + 1e-3;
    const dx = mx / len, dy = my / len, dz = mz / len;
    const chunks = this._topThickRay(cx, cy, cz, dx, dy, dz, len * tmax, ex, ey, ez, this._chunkCand);
    let best = tmax, found = false;
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      if (ignore && ignoreMatch(ignore, chunk.root)) continue;
      const list = this._cand; list.clear();
      this._chunkThickRay(chunk, cx, cy, cz, dx, dy, dz, len * best, ex, ey, ez, list);
      const P = chunk.pos, N = chunk.nrm, arr = list.a;
      // A capsule landing on the lip of a step touches the step's top face and its
      // front face at the very same instant. For ground queries we must keep the
      // most upward-facing of those, otherwise "am I standing on it" is a coin toss.
      const tie = this._preferUp ? 2e-4 : 0;
      for (let k = 0; k < list.n; k++) {
        const ti = arr[k], p = ti * 9, n3 = ti * 3;
        const t = sweepTri(cx, cy, cz, hs, r, mx, my, mz, best + tie,
          P[p], P[p + 1], P[p + 2], P[p + 3], P[p + 4], P[p + 5], P[p + 6], P[p + 7], P[p + 8],
          N[n3], N[n3 + 1], N[n3 + 2]);
        if (t < 0) continue;
        // CP holds the closest feature at time t
        let fx = N[n3], fy = N[n3 + 1], fz = N[n3 + 2];
        if (fx * (CP.sx - CP.tx) + fy * (CP.sy - CP.ty) + fz * (CP.sz - CP.tz) < 0) {
          fx = -fx; fy = -fy; fz = -fz;
        }
        if (found && tie && t > best - tie && fy <= HIT.fny) continue;
        contactNormal(chunk, ti);
        if (t < best) best = t;
        found = true;
        HIT.t = t; HIT.nx = NRM.x; HIT.ny = NRM.y; HIT.nz = NRM.z;
        HIT.fnx = fx; HIT.fny = fy; HIT.fnz = fz;
        HIT.px = CP.tx; HIT.py = CP.ty; HIT.pz = CP.tz;
        HIT.chunk = chunk; HIT.tri = ti;
        const g = chunk.groups[chunk.grp[ti]];
        HIT.surface = g ? g.surface : DEFAULT_SURFACE;
        HIT.penetration = g ? g.penetration : DEFAULT_PENETRATION;
        if (best <= 0 && !tie) return 0;
      }
    }
    return found ? best : -1;
  }

  // ---- entities -----------------------------------------------------------

  /** entity: { id, object3D, hitboxes[], health, team, alive } */
  registerEntity(entity) {
    if (!entity || this._entById.has(entity)) return entity;
    const boxes = [];
    const src = entity.hitboxes && entity.hitboxes.length ? entity.hitboxes : null;
    if (src) {
      for (const hb of src) {
        const obj = hb.bone || hb.object3D || hb.object || entity.object3D;
        if (!obj) continue;
        boxes.push({
          name: hb.name || 'chest',
          obj,
          radius: hb.radius != null ? hb.radius : 0.16,
          height: hb.height != null ? hb.height : (hb.radius != null ? hb.radius * 2 : 0.32),
          mult: hb.mult != null ? hb.mult : 1,
          offset: hb.offset ? new THREE.Vector3(hb.offset.x, hb.offset.y, hb.offset.z) : null,
          axis: hb.axis ? new THREE.Vector3(hb.axis.x, hb.axis.y, hb.axis.z).normalize()
            : new THREE.Vector3(0, 1, 0),
          anchor: hb.anchor || 'center',
          surface: hb.surface || 'flesh',
          penetration: hb.penetration != null ? hb.penetration : 0.55,
          src: hb,
          p0: new THREE.Vector3(), p1: new THREE.Vector3(),
        });
      }
    }
    if (!boxes.length && entity.object3D) {
      boxes.push({
        name: 'chest', obj: entity.object3D, radius: 0.34, height: 1.8, mult: 1,
        offset: null, axis: new THREE.Vector3(0, 1, 0), anchor: 'base',
        surface: 'flesh', penetration: 0.55, src: null,
        p0: new THREE.Vector3(), p1: new THREE.Vector3(),
      });
    }
    entity._phys = {
      boxes,
      center: new THREE.Vector3(),
      radius: 1,
      cells: [],
      frame: -1,
    };
    this.entities.push(entity);
    this._entById.set(entity, entity._phys);
    this._entFrame = -1;
    return entity;
  }

  unregisterEntity(entity) {
    if (!entity) return false;
    const i = this.entities.indexOf(entity);
    if (i >= 0) this.entities.splice(i, 1);
    this._entById.delete(entity);
    if (entity._phys) this._removeFromHash(entity);
    entity._phys = null;
    return i >= 0;
  }

  _hashKey(ix, iy, iz) { return `${ix},${iy},${iz}`; }

  _removeFromHash(entity) {
    const ph = entity._phys;
    if (!ph) return;
    for (const k of ph.cells) {
      const bucket = this._hash.get(k);
      if (!bucket) continue;
      const i = bucket.indexOf(entity);
      if (i >= 0) bucket.splice(i, 1);
      if (!bucket.length) this._hash.delete(k);
    }
    ph.cells.length = 0;
  }

  /** Refresh hitbox world transforms + the spatial hash (once per frame, lazily). */
  syncEntities(force = false) {
    const frame = (this.ctx && this.ctx.frame) || 0;
    if (!force && this._entFrame === frame) return;
    this._entFrame = frame;
    const cs = this._cellSize;
    for (const e of this.entities) {
      const ph = e._phys;
      if (!ph) continue;
      let mnx = BIG, mny = BIG, mnz = BIG, mxx = -BIG, mxy = -BIG, mxz = -BIG;
      for (const hb of ph.boxes) {
        const obj = hb.obj;
        if (!obj) continue;
        const m = obj.matrixWorld.elements;
        let ox = m[12], oy = m[13], oz = m[14];
        // axis in world space
        const a = hb.axis;
        let axw = m[0] * a.x + m[4] * a.y + m[8] * a.z;
        let ayw = m[1] * a.x + m[5] * a.y + m[9] * a.z;
        let azw = m[2] * a.x + m[6] * a.y + m[10] * a.z;
        const al = Math.sqrt(axw * axw + ayw * ayw + azw * azw) || 1;
        axw /= al; ayw /= al; azw /= al;
        if (hb.offset) {
          const f = hb.offset;
          ox += m[0] * f.x + m[4] * f.y + m[8] * f.z;
          oy += m[1] * f.x + m[5] * f.y + m[9] * f.z;
          oz += m[2] * f.x + m[6] * f.y + m[10] * f.z;
        }
        const half = Math.max(0, hb.height * 0.5 - hb.radius);
        let ccx = ox, ccy = oy, ccz = oz;
        if (hb.anchor === 'base') { ccx += axw * hb.height * 0.5; ccy += ayw * hb.height * 0.5; ccz += azw * hb.height * 0.5; }
        else if (hb.anchor === 'top') { ccx -= axw * hb.height * 0.5; ccy -= ayw * hb.height * 0.5; ccz -= azw * hb.height * 0.5; }
        hb.p0.set(ccx - axw * half, ccy - ayw * half, ccz - azw * half);
        hb.p1.set(ccx + axw * half, ccy + ayw * half, ccz + azw * half);
        const r = hb.radius;
        mnx = Math.min(mnx, hb.p0.x - r, hb.p1.x - r);
        mny = Math.min(mny, hb.p0.y - r, hb.p1.y - r);
        mnz = Math.min(mnz, hb.p0.z - r, hb.p1.z - r);
        mxx = Math.max(mxx, hb.p0.x + r, hb.p1.x + r);
        mxy = Math.max(mxy, hb.p0.y + r, hb.p1.y + r);
        mxz = Math.max(mxz, hb.p0.z + r, hb.p1.z + r);
      }
      if (mnx > mxx) { mnx = mny = mnz = mxx = mxy = mxz = 0; }
      ph.center.set((mnx + mxx) * 0.5, (mny + mxy) * 0.5, (mnz + mxz) * 0.5);
      ph.radius = 0.5 * Math.sqrt((mxx - mnx) ** 2 + (mxy - mny) ** 2 + (mxz - mnz) ** 2) + 1e-3;

      // rehash
      this._removeFromHash(e);
      const i0 = Math.floor(mnx / cs), i1 = Math.floor(mxx / cs);
      const j0 = Math.floor(mny / cs), j1 = Math.floor(mxy / cs);
      const k0 = Math.floor(mnz / cs), k1 = Math.floor(mxz / cs);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          for (let k = k0; k <= k1; k++) {
            const key = this._hashKey(i, j, k);
            let bucket = this._hash.get(key);
            if (!bucket) this._hash.set(key, (bucket = []));
            bucket.push(e);
            ph.cells.push(key);
          }
        }
      }
    }
  }

  /** overlapSphere(pos, r) -> entity[] */
  overlapSphere(pos, r) {
    this.syncEntities();
    const out = [];
    if (!this.entities.length) return out;
    const cs = this._cellSize;
    const i0 = Math.floor((pos.x - r) / cs), i1 = Math.floor((pos.x + r) / cs);
    const j0 = Math.floor((pos.y - r) / cs), j1 = Math.floor((pos.y + r) / cs);
    const k0 = Math.floor((pos.z - r) / cs), k1 = Math.floor((pos.z + r) / cs);
    const seen = new Set();
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (let k = k0; k <= k1; k++) {
          const bucket = this._hash.get(this._hashKey(i, j, k));
          if (!bucket) continue;
          for (const e of bucket) {
            if (seen.has(e)) continue;
            seen.add(e);
            const ph = e._phys;
            if (!ph) continue;
            const dx = ph.center.x - pos.x, dy = ph.center.y - pos.y, dz = ph.center.z - pos.z;
            const rr = r + ph.radius;
            if (dx * dx + dy * dy + dz * dz <= rr * rr) out.push(e);
          }
        }
      }
    }
    return out;
  }

  /** Extension: dynamic bodies inside a sphere (used by explosions). */
  overlapBodies(pos, r) {
    const out = [];
    const r2 = r * r;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      const dx = b.position.x - pos.x, dy = b.position.y - pos.y, dz = b.position.z - pos.z;
      if (dx * dx + dy * dy + dz * dz <= r2) out.push(b);
    }
    return out;
  }

  _raycastEntities(ox, oy, oz, dx, dy, dz, maxDist, opts, extraRadius = 0) {
    if (!this.entities.length) return null;
    this.syncEntities();
    const ignore = opts && opts.ignoreEntity;
    let best = maxDist, hitEnt = null, hitBox = null, hnx = 0, hny = 0, hnz = 0;
    for (const e of this.entities) {
      if (e.alive === false && !(opts && opts.includeDead)) continue;
      if (ignore && (ignore === e || (Array.isArray(ignore) && ignore.includes(e)))) continue;
      const ph = e._phys;
      if (!ph) continue;
      // reject with the entity bounding sphere
      const cx = ph.center.x - ox, cy = ph.center.y - oy, cz = ph.center.z - oz;
      const proj = cx * dx + cy * dy + cz * dz;
      const rr = ph.radius + extraRadius;
      if (proj < -rr || proj > best + rr) continue;
      const d2 = cx * cx + cy * cy + cz * cz - proj * proj;
      if (d2 > rr * rr) continue;
      for (const hb of ph.boxes) {
        const t = rayCapsule(ox, oy, oz, dx, dy, dz, best,
          hb.p0.x, hb.p0.y, hb.p0.z, hb.p1.x, hb.p1.y, hb.p1.z, hb.radius + extraRadius);
        if (t < 0 || t >= best) continue;
        best = t; hitEnt = e; hitBox = hb; hnx = RC.nx; hny = RC.ny; hnz = RC.nz;
      }
    }
    if (!hitEnt) return null;
    return {
      point: new THREE.Vector3(ox + dx * best, oy + dy * best, oz + dz * best),
      normal: new THREE.Vector3(hnx, hny, hnz),
      distance: best,
      surface: hitBox.surface,
      penetration: hitBox.penetration,
      object: hitEnt.object3D || null,
      material: null,
      entity: hitEnt,
      part: hitBox.name,
      mult: hitBox.mult,
      hitbox: hitBox.src || null,
    };
  }

  // ---- de-penetration -----------------------------------------------------

  // Push a capsule out of anything it overlaps. Writes DP.{x,y,z,pushed} and the
  // deepest upward-facing contact in DP.g*.
  _depenetrate(cx, cy, cz, hs, r, iters = 4) {
    DP.x = cx; DP.y = cy; DP.z = cz; DP.pushed = 0; DP.deep = 0;
    DP.gy = -2; DP.gTri = -1; DP.gChunk = null;
    if (!this.chunks.length) return DP;
    const target = r + SKIN;
    for (let it = 0; it < iters; it++) {
      const m = target + 0.02;
      const chunks = this._topBox(DP.x - r - m, DP.y - hs - r - m, DP.z - r - m,
        DP.x + r + m, DP.y + hs + r + m, DP.z + r + m, this._chunkCand);
      let moved = false;
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const list = this._cand; list.clear();
        this._chunkBox(chunk, DP.x - r - m, DP.y - hs - r - m, DP.z - r - m,
          DP.x + r + m, DP.y + hs + r + m, DP.z + r + m, list);
        const P = chunk.pos, N = chunk.nrm, arr = list.a;
        for (let k = 0; k < list.n; k++) {
          const ti = arr[k], p = ti * 9, n3 = ti * 3;
          segTriClosest(DP.x, DP.y - hs, DP.z, DP.x, DP.y + hs, DP.z,
            P[p], P[p + 1], P[p + 2], P[p + 3], P[p + 4], P[p + 5], P[p + 6], P[p + 7], P[p + 8],
            N[n3], N[n3 + 1], N[n3 + 2]);
          const d = Math.sqrt(CP.d2);
          if (it === 0 && r - d > DP.deep) DP.deep = r - d;
          const pen = target - d;
          if (pen <= 1e-5) continue;
          contactNormal(chunk, ti);
          if (DP.pushed + pen > 0.75) continue;   // never teleport out of deep geometry
          DP.x += NRM.x * pen; DP.y += NRM.y * pen; DP.z += NRM.z * pen;
          DP.pushed += pen;
          moved = true;
          if (NRM.y > DP.gy) { DP.gy = NRM.y; DP.gx = NRM.x; DP.gz = NRM.z; DP.gTri = ti; DP.gChunk = chunk; }
        }
      }
      if (!moved) break;
    }
    return DP;
  }

  // Continuous collide-and-slide. Writes SL.
  _collideSlide(cx, cy, cz, hs, r, dx, dy, dz, slopeCos, allowClimb) {
    SL.x = cx; SL.y = cy; SL.z = cz;
    SL.ceiling = false; SL.blocked = false; SL.surface = null; SL.hits = 0;
    const total = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (total < 1e-9) return SL;
    const nsub = Math.min(16, Math.max(1, Math.ceil(total / Math.max(0.05, r * 4))));
    for (let s = 0; s < nsub; s++) {
      let mx = dx / nsub, my = dy / nsub, mz = dz / nsub;
      for (let it = 0; it < 5; it++) {
        const len = Math.sqrt(mx * mx + my * my + mz * mz);
        if (len < 1e-7) break;
        const t = this._sweepCapsule(SL.x, SL.y, SL.z, hs, r, mx, my, mz, 1);
        if (t < 0) { SL.x += mx; SL.y += my; SL.z += mz; break; }
        const nx = HIT.nx, ny = HIT.ny, nz = HIT.nz;
        // Sliding decisions use the CONTACT normal: brushing the convex lip of a
        // step is a wall contact even though the triangle it belongs to is floor.
        // (Ground *probes* use the face normal instead — see _probeDown.)
        const walkable = ny >= slopeCos;
        // Advance to the touch point, then back off along the CONTACT NORMAL.
        // Backing off along the motion instead leaves a grazing contact barely
        // separated, and the de-penetration pass then nudges the capsule along the
        // normal every frame — which is how a capsule slowly climbs a wall edge.
        SL.x += mx * t + nx * SKIN;
        SL.y += my * t + ny * SKIN;
        SL.z += mz * t + nz * SKIN;
        const adv = t;
        SL.hits++;
        SL.surface = HIT.surface;
        if (ny < -0.4) SL.ceiling = true;
        if (!walkable) SL.blocked = true;
        let rx = mx * (1 - adv), ry = my * (1 - adv), rz = mz * (1 - adv);
        const dp = rx * nx + ry * ny + rz * nz;
        rx -= nx * dp; ry -= ny * dp; rz -= nz * dp;
        // never let a too-steep face act as a ramp
        if (!allowClimb && !walkable && ny > -0.1 && dy <= 1e-4 && ry > 0) ry = 0;
        mx = rx; my = ry; mz = rz;
      }
    }
    return SL;
  }

  // Sweep straight down; returns { hit, t, ny, ... } via HIT. Returns distance or -1.
  _probeDown(cx, cy, cz, hs, r, dist) {
    this._preferUp = true;
    const t = this._sweepCapsule(cx, cy, cz, hs, r, 0, -dist, 0, 1);
    this._preferUp = false;
    return t < 0 ? -1 : t * dist;
  }

  /**
   * capsuleMove(pos, halfHeight, radius, delta, opts?)
   * See the conventions block at the top of this file.
   */
  capsuleMove(pos, halfHeight, radius, delta, opts) {
    const o = opts || {};
    const r = Math.max(0.02, radius || 0.34);
    const hh = Math.max(halfHeight || 0.9, r + 1e-4);
    const hs = hh - r;
    const slopeCos = o.slopeLimit != null ? Math.cos(o.slopeLimit * DEG) : DEFAULT_SLOPE_COS;
    const stepH = o.stepHeight != null ? o.stepHeight : STEP_HEIGHT;
    const dx = delta.x || 0, dy = delta.y || 0, dz = delta.z || 0;

    // 1. start clean
    this._depenetrate(pos.x, pos.y + hh, pos.z, hs, r, 4);
    const sx = DP.x, sy = DP.y, sz = DP.z;

    // was the capsule standing on walkable ground before the move?
    let startGround = false;
    let startGroundY = -BIG;
    if (this.chunks.length) {
      const d = this._probeDown(sx, sy, sz, hs, r, SKIN * 2 + 0.06);
      startGround = d >= 0 && HIT.fny >= slopeCos;
      if (startGround) startGroundY = HIT.py;
    }

    // 2. collide & slide
    this._collideSlide(sx, sy, sz, hs, r, dx, dy, dz, slopeCos, !!o.allowClimb);
    let px = SL.x, py = SL.y, pz = SL.z;
    let ceiling = SL.ceiling;
    let blocked = SL.blocked;
    let lastSurface = SL.surface;
    let stepped = false;

    // 3. step up over small obstacles
    if (blocked && stepH > 0.01 && startGround && dy <= 0.02 && (dx !== 0 || dz !== 0)) {
      const baseProg = (px - sx) * (px - sx) + (pz - sz) * (pz - sz);
      const tUp = this._sweepCapsule(sx, sy, sz, hs, r, 0, stepH, 0, 1);
      const up = tUp < 0 ? stepH : Math.max(0, tUp * stepH - SKIN);
      if (up > 0.02) {
        // allowClimb stays false: with it on, the raised capsule can ride up the
        // convex top edge of a too-tall obstacle and scale it 0.4 m per frame.
        this._collideSlide(sx, sy + up, sz, hs, r, dx, 0, dz, slopeCos, false);
        const ux = SL.x, uy = SL.y, uz = SL.z;
        const upProg = (ux - sx) * (ux - sx) + (uz - sz) * (uz - sz);
        if (upProg > baseProg + 1e-4) {
          const drop = up + 0.03;
          this._preferUp = true;
          const tDn = this._sweepCapsule(ux, uy, uz, hs, r, 0, -drop, 0, 1);
          this._preferUp = false;
          // The rise is measured surface-to-surface: you may step onto ground at
          // most stepHeight above the ground you are standing on. Measuring against
          // the capsule instead lets it scale any wall 0.4 m per frame by leaning
          // on the lip and stepping again from there.
          if (tDn >= 0 && HIT.fny >= slopeCos && HIT.py <= startGroundY + stepH + 1e-3) {
            const fy = uy - Math.max(0, tDn * drop - SKIN);
            if (fy >= sy - 1e-3 && fy <= sy + stepH + 1e-3) {
              px = ux; py = fy; pz = uz;
              stepped = true; blocked = false;
              lastSurface = HIT.surface;
            }
          }
        }
      }
    }

    // 4. stick to the ground over crests and stairs going down
    let grounded = false;
    if (this.chunks.length) {
      const d = this._probeDown(px, py, pz, hs, r, SKIN * 2 + 0.06);
      grounded = d >= 0 && HIT.fny >= slopeCos;
      if (!grounded && startGround && dy <= 1e-3 && o.snap !== false) {
        const snap = o.snapDistance != null ? o.snapDistance : Math.max(stepH, 0.3);
        this._preferUp = true;
        const t2 = this._sweepCapsule(px, py, pz, hs, r, 0, -snap, 0, 1);
        this._preferUp = false;
        if (t2 >= 0 && HIT.fny >= slopeCos) {
          py -= Math.max(0, t2 * snap - SKIN);
          grounded = true;
          lastSurface = HIT.surface;
        }
      }
    }

    // 5. final safety pass
    this._depenetrate(px, py, pz, hs, r, 3);
    px = DP.x; py = DP.y; pz = DP.z;

    // 6. authoritative ground read
    let gnx = 0, gny = 1, gnz = 0, gSurface = null, gObject = null;
    if (this.chunks.length) {
      const d = this._probeDown(px, py, pz, hs, r, SKIN * 2 + 0.06);
      if (d >= 0 && HIT.fny >= slopeCos) {
        grounded = true;
        gnx = HIT.fnx; gny = HIT.fny; gnz = HIT.fnz;
        gSurface = HIT.surface;
        const g = HIT.chunk && HIT.chunk.groups[HIT.chunk.grp[HIT.tri]];
        gObject = g ? g.mesh : (HIT.chunk ? HIT.chunk.root : null);
      } else if (d >= 0 && HIT.fny > 0.02) {
        // touching a too-steep face: report the slope so the controller can slide
        gnx = HIT.fnx; gny = HIT.fny; gnz = HIT.fnz;
        grounded = false;
      } else {
        grounded = false;
      }
    }

    if (this._debug) {
      this._debugCapsules.length = 0;
      this._debugCapsules.push({ x: px, y: py, z: pz, hs, r });
    }

    return {
      pos: new THREE.Vector3(px, py - hh, pz),
      grounded,
      normal: new THREE.Vector3(gnx, gny, gnz),
      hitSurface: grounded ? (gSurface || lastSurface) : lastSurface,
      ceiling,
      blocked,
      stepped,
      groundObject: gObject,
      groundEntity: null,
    };
  }

  // ---- rigid bodies -------------------------------------------------------

  /**
   * addBody(opts) -> body
   * opts: { shape:'sphere'|'box'|'capsule', radius, halfExtents:{x,y,z}, height,
   *         position, quaternion, velocity, angularVelocity, mass, restitution,
   *         friction, linearDamping, angularDamping, gravityScale, object3D,
   *         ttl, sleep:true, ccd:true, kinematic:false, onCollide(info), userData }
   */
  addBody(opts = {}) {
    const shape = opts.shape || 'box';
    const radius = opts.radius != null ? opts.radius : 0.1;
    const he = opts.halfExtents
      ? new THREE.Vector3(opts.halfExtents.x, opts.halfExtents.y, opts.halfExtents.z)
      : new THREE.Vector3(radius, radius, radius);
    const height = opts.height != null ? opts.height : radius * 4;
    const mass = opts.kinematic ? 0 : Math.max(1e-4, opts.mass != null ? opts.mass : 1);
    const invMass = opts.kinematic ? 0 : 1 / mass;

    // local contact points + their radius
    let pts, ptR;
    if (shape === 'sphere') {
      pts = new Float32Array([0, 0, 0]); ptR = radius;
    } else if (shape === 'capsule') {
      const h = Math.max(0, height * 0.5 - radius);
      pts = new Float32Array([0, -h, 0, 0, h, 0]); ptR = radius;
    } else {
      // A box is modelled as eight inset spheres (a rounded box). The inset must be
      // large enough that a corner never travels more than its own radius per
      // substep, otherwise a corner can end up deep inside solid geometry where the
      // nearest-triangle test can no longer see it.
      const m = Math.min(0.09, Math.max(0.02, Math.min(he.x, he.y, he.z) * 0.45));
      const ex = Math.max(1e-3, he.x - m), ey = Math.max(1e-3, he.y - m), ez = Math.max(1e-3, he.z - m);
      pts = new Float32Array(24);
      let i = 0;
      for (let sx = -1; sx <= 1; sx += 2)
        for (let sy = -1; sy <= 1; sy += 2)
          for (let sz = -1; sz <= 1; sz += 2) { pts[i++] = ex * sx; pts[i++] = ey * sy; pts[i++] = ez * sz; }
      ptR = m;
    }

    // diagonal inertia (local)
    const inv = new THREE.Vector3();
    if (invMass > 0) {
      if (shape === 'sphere') {
        const I = 0.4 * mass * radius * radius;
        inv.set(1 / I, 1 / I, 1 / I);
      } else if (shape === 'capsule') {
        const Ixz = mass * (3 * radius * radius + height * height) / 12;
        const Iy = 0.5 * mass * radius * radius;
        inv.set(1 / Ixz, 1 / Iy, 1 / Ixz);
      } else {
        const x = he.x * 2, y = he.y * 2, z = he.z * 2;
        inv.set(
          1 / (mass * (y * y + z * z) / 12),
          1 / (mass * (x * x + z * z) / 12),
          1 / (mass * (x * x + y * y) / 12),
        );
      }
    }

    const body = {
      id: this._bodyId++,
      shape, radius, halfExtents: he, height,
      mass, invMass, invInertia: inv,
      position: new THREE.Vector3().copy(opts.position || { x: 0, y: 0, z: 0 }),
      quaternion: opts.quaternion ? new THREE.Quaternion().copy(opts.quaternion) : new THREE.Quaternion(),
      velocity: new THREE.Vector3().copy(opts.velocity || { x: 0, y: 0, z: 0 }),
      angularVelocity: new THREE.Vector3().copy(opts.angularVelocity || { x: 0, y: 0, z: 0 }),
      restitution: opts.restitution != null ? opts.restitution : 0.22,
      friction: opts.friction != null ? opts.friction : 0.65,
      linearDamping: opts.linearDamping != null ? opts.linearDamping : 0.06,
      angularDamping: opts.angularDamping != null ? opts.angularDamping : 0.16,
      gravityScale: opts.gravityScale != null ? opts.gravityScale : 1,
      kinematic: !!opts.kinematic,
      ccd: opts.ccd !== false,
      allowSleep: opts.sleep !== false,
      sleeping: false,
      sleepTimer: 0,
      contacts: 0,
      groundSurface: null,
      ttl: opts.ttl != null ? opts.ttl : 0,
      age: 0,
      alive: true,
      constrained: false,
      object3D: opts.object3D || null,
      onCollide: opts.onCollide || null,
      userData: opts.userData || null,
      _pts: pts, _ptR: ptR,
      _prevPos: new THREE.Vector3(),
      _prevQuat: new THREE.Quaternion(),
      _hitCd: 0,
      applyImpulse: (imp, point) => this._applyImpulse(body, imp, point),
      applyForce: (f, dt) => this._applyImpulse(body, { x: f.x * dt, y: f.y * dt, z: f.z * dt }),
      wake: () => { body.sleeping = false; body.sleepTimer = 0; },
      remove: () => this.removeBody(body),
    };
    body._prevPos.copy(body.position);
    body._prevQuat.copy(body.quaternion);

    this.bodies.push(body);
    // budget: retire the oldest non-persistent bodies
    const cap = this.tier.maxBodies;
    if (this.bodies.length > cap) {
      let over = this.bodies.length - cap;
      for (let i = 0; i < this.bodies.length && over > 0; i++) {
        const b = this.bodies[i];
        if (b === body || b.persistent || b.constrained) continue;
        b.alive = false; over--;
      }
      this.bodies = this.bodies.filter((b) => b.alive);
    }
    this.stats.bodies = this.bodies.length;
    return body;
  }

  removeBody(body) {
    if (!body) return false;
    body.alive = false;
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    this.constraints = this.constraints.filter((c) => c.a !== body && c.b !== body);
    this.stats.bodies = this.bodies.length;
    return i >= 0;
  }

  _applyImpulse(body, imp, point) {
    if (!body || body.invMass === 0) return;
    body.sleeping = false; body.sleepTimer = 0;
    body.velocity.x += imp.x * body.invMass;
    body.velocity.y += imp.y * body.invMass;
    body.velocity.z += imp.z * body.invMass;
    if (point) {
      const rx = point.x - body.position.x, ry = point.y - body.position.y, rz = point.z - body.position.z;
      const tx = ry * imp.z - rz * imp.y, ty = rz * imp.x - rx * imp.z, tz = rx * imp.y - ry * imp.x;
      this._addAngular(body, tx, ty, tz);
    }
  }

  // convert a world-space angular impulse using the local diagonal inertia
  _addAngular(body, tx, ty, tz) {
    const q = body.quaternion;
    _qi.copy(q).invert();
    _va.set(tx, ty, tz).applyQuaternion(_qi);
    _va.x *= body.invInertia.x; _va.y *= body.invInertia.y; _va.z *= body.invInertia.z;
    _va.applyQuaternion(q);
    body.angularVelocity.add(_va);
  }

  _angularTerm(body, rx, ry, rz, nx, ny, nz) {
    // n · ((I^-1 (r × n)) × r)
    const cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx;
    const q = body.quaternion;
    _qi.copy(q).invert();
    _vb.set(cx, cy, cz).applyQuaternion(_qi);
    _vb.x *= body.invInertia.x; _vb.y *= body.invInertia.y; _vb.z *= body.invInertia.z;
    _vb.applyQuaternion(q);
    const ax = _vb.y * rz - _vb.z * ry, ay = _vb.z * rx - _vb.x * rz, az = _vb.x * ry - _vb.y * rx;
    return nx * ax + ny * ay + nz * az;
  }

  _integrate(body, h) {
    if (body.kinematic || body.invMass === 0) return;
    body.velocity.x += this.gravity.x * body.gravityScale * h;
    body.velocity.y += this.gravity.y * body.gravityScale * h;
    body.velocity.z += this.gravity.z * body.gravityScale * h;
    const ld = 1 / (1 + body.linearDamping * h);
    const ad = 1 / (1 + body.angularDamping * h);
    body.velocity.multiplyScalar(ld);
    body.angularVelocity.multiplyScalar(ad);

    const speed = body.velocity.length();
    let sub = 1;
    if (body.ccd) {
      sub = Math.min(8, Math.max(1, Math.ceil((speed * h) / (body._ptR * 0.7))));
    }
    const hs = h / sub;
    for (let s = 0; s < sub; s++) {
      body.position.x += body.velocity.x * hs;
      body.position.y += body.velocity.y * hs;
      body.position.z += body.velocity.z * hs;
      const w = body.angularVelocity;
      const wl = w.length();
      if (wl > 1e-6) {
        _qd.setFromAxisAngle(_va.set(w.x / wl, w.y / wl, w.z / wl), wl * hs);
        body.quaternion.premultiply(_qd).normalize();
      }
      this._resolveBody(body);
      this._restingDamp(body, hs);
    }
  }

  _resolveBody(body) {
    body.contacts = 0;
    if (!this.chunks.length) return;
    const P = body.position, q = body.quaternion, R = body._ptR;
    const npts = body._pts.length / 3;
    const margin = R + 0.03;
    const C = this._bodyContacts;
    let n = 0;

    // ---- gather: one (deepest) contact per sample point --------------------
    for (let i = 0; i < npts; i++) {
      _va.set(body._pts[i * 3], body._pts[i * 3 + 1], body._pts[i * 3 + 2]).applyQuaternion(q);
      const wx = P.x + _va.x, wy = P.y + _va.y, wz = P.z + _va.z;
      const chunks = this._topBox(wx - margin, wy - margin, wz - margin,
        wx + margin, wy + margin, wz + margin, this._chunkCand);
      let bd = -1, bnx = 0, bny = 0, bnz = 0, bChunk = null, bTri = -1;
      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const list = this._cand; list.clear();
        this._chunkBox(chunk, wx - margin, wy - margin, wz - margin,
          wx + margin, wy + margin, wz + margin, list);
        const TP = chunk.pos, arr = list.a;
        for (let k = 0; k < list.n; k++) {
          const ti = arr[k], p = ti * 9;
          closestPtPointTri(wx, wy, wz,
            TP[p], TP[p + 1], TP[p + 2], TP[p + 3], TP[p + 4], TP[p + 5],
            TP[p + 6], TP[p + 7], TP[p + 8]);
          let nx = wx - PT.x, ny = wy - PT.y, nz = wz - PT.z;
          const d = Math.sqrt(nx * nx + ny * ny + nz * nz);
          const fx = chunk.nrm[ti * 3], fy = chunk.nrm[ti * 3 + 1], fz = chunk.nrm[ti * 3 + 2];
          const sd = nx * fx + ny * fy + nz * fz;
          let depth;
          if (d < 1e-6 || sd < 0) {
            nx = fx; ny = fy; nz = fz;      // on or behind the face
            depth = R - sd;
            if (depth > R + 0.6) continue;  // hopelessly deep — leave it alone
          } else {
            if (d >= R) continue;
            nx /= d; ny /= d; nz /= d;
            depth = R - d;
          }
          if (depth > bd) { bd = depth; bnx = nx; bny = ny; bnz = nz; bChunk = chunk; bTri = ti; }
        }
      }
      if (bd < 0) continue;
      const c = C[n] || (C[n] = {});
      c.x = wx; c.y = wy; c.z = wz;
      c.nx = bnx; c.ny = bny; c.nz = bnz; c.depth = bd; c.chunk = bChunk; c.tri = bTri;
      n++;
    }
    body.contacts = n;
    if (!n || body.invMass === 0) return;

    // ---- positional: averaged, so a flat rest gets no phantom torque -------
    const SLOP = 0.0015;
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i < n; i++) {
      const c = C[i], d = c.depth - SLOP;
      if (d <= 0) continue;
      px += c.nx * d; py += c.ny * d; pz += c.nz * d;
    }
    const pk = 0.8 / n;
    P.x += px * pk; P.y += py * pk; P.z += pz * pk;

    // ---- velocity: Jacobi (all contacts see the same pre-solve velocity, each
    // impulse scaled by 1/n). Sequential solving leaves a resting crate rocking
    // forever because the corner impulses never balance.
    const inv = 1 / n;
    let maxJ = 0, hitC = null;
    for (let it = 0; it < 2; it++) {
      let lx = 0, ly = 0, lz = 0, tx = 0, ty = 0, tz = 0;
      for (let i = 0; i < n; i++) {
        const c = C[i];
        const rx = c.x - P.x, ry = c.y - P.y, rz = c.z - P.z;
        const w = body.angularVelocity;
        const vx = body.velocity.x + (w.y * rz - w.z * ry);
        const vy = body.velocity.y + (w.z * rx - w.x * rz);
        const vz = body.velocity.z + (w.x * ry - w.y * rx);
        const vn = vx * c.nx + vy * c.ny + vz * c.nz;
        if (vn >= 0) continue;
        const den = body.invMass + this._angularTerm(body, rx, ry, rz, c.nx, c.ny, c.nz);
        if (den <= 1e-9) continue;
        const e = -vn < 0.9 ? 0 : body.restitution;      // no micro-bouncing
        const jn = Math.max(0, -(1 + e) * vn / den) * inv;
        let ix = c.nx * jn, iy = c.ny * jn, iz = c.nz * jn;

        // friction, clamped by Coulomb
        const tvx = vx - c.nx * vn, tvy = vy - c.ny * vn, tvz = vz - c.nz * vn;
        const tl = Math.sqrt(tvx * tvx + tvy * tvy + tvz * tvz);
        if (tl > 1e-5) {
          const ux = -tvx / tl, uy = -tvy / tl, uz = -tvz / tl;
          const td = body.invMass + this._angularTerm(body, rx, ry, rz, ux, uy, uz);
          let jt = (tl * inv) / Math.max(td, 1e-9);
          const maxF = body.friction * jn;
          if (jt > maxF) jt = maxF;
          ix += ux * jt; iy += uy * jt; iz += uz * jt;
        }
        lx += ix; ly += iy; lz += iz;
        tx += ry * iz - rz * iy; ty += rz * ix - rx * iz; tz += rx * iy - ry * ix;
        if (it === 0 && jn > maxJ) { maxJ = jn; hitC = c; }
      }
      body.velocity.x += lx * body.invMass;
      body.velocity.y += ly * body.invMass;
      body.velocity.z += lz * body.invMass;
      this._addAngular(body, tx, ty, tz);
    }

    if (hitC) {
      const g = hitC.chunk.groups[hitC.chunk.grp[hitC.tri]];
      body.groundSurface = g ? g.surface : DEFAULT_SURFACE;
      if (body.onCollide && maxJ * n > 0.08 && body._hitCd <= 0) {
        body._hitCd = 0.05;
        body.onCollide({
          body,
          point: new THREE.Vector3(hitC.x, hitC.y, hitC.z),
          normal: new THREE.Vector3(hitC.nx, hitC.ny, hitC.nz),
          impulse: maxJ * n,
          speed: maxJ * n * body.invMass,
          surface: body.groundSurface,
          object: g ? g.mesh : hitC.chunk.root,
        });
      }
    }
  }

  // Debris resting on a surface must go quiet. Sequential per-corner impulses
  // leave a little rocking energy behind, so damp hard once a body is in
  // sustained contact and moving slowly — it settles within a few tenths.
  _restingDamp(body, h) {
    if (body.contacts < 2) return;
    if (body.velocity.lengthSq() > 0.36 || body.angularVelocity.lengthSq() > 9) return;
    const k = 1 / (1 + 9 * h);
    body.velocity.multiplyScalar(k);
    body.angularVelocity.multiplyScalar(k);
  }

  _applyImpulseAt(body, ix, iy, iz, rx, ry, rz) {
    body.velocity.x += ix * body.invMass;
    body.velocity.y += iy * body.invMass;
    body.velocity.z += iz * body.invMass;
    const tx = ry * iz - rz * iy, ty = rz * ix - rx * iz, tz = rx * iy - ry * ix;
    this._addAngular(body, tx, ty, tz);
  }

  // ---- constraints (position-based, for ragdolls) -------------------------

  /**
   * addConstraint({ type:'distance', a, b, rest?, anchorA?, anchorB?, stiffness? })
   * addConstraint({ type:'cone', a, b, axis?, limit?, stiffness? })   // limit in radians
   */
  addConstraint(opts = {}) {
    const c = {
      type: opts.type || 'distance',
      a: opts.a, b: opts.b,
      rest: opts.rest != null ? opts.rest
        : (opts.a && opts.b ? opts.a.position.distanceTo(opts.b.position) : 0.3),
      anchorA: opts.anchorA ? new THREE.Vector3().copy(opts.anchorA) : null,
      anchorB: opts.anchorB ? new THREE.Vector3().copy(opts.anchorB) : null,
      axis: opts.axis ? new THREE.Vector3().copy(opts.axis).normalize() : new THREE.Vector3(0, -1, 0),
      limit: opts.limit != null ? opts.limit : Math.PI / 4,
      stiffness: opts.stiffness != null ? opts.stiffness : 1,
      enabled: true,
    };
    if (c.a) c.a.constrained = true;
    if (c.b) c.b.constrained = true;
    this.constraints.push(c);
    return c;
  }

  removeConstraint(c) {
    const i = this.constraints.indexOf(c);
    if (i >= 0) this.constraints.splice(i, 1);
    return i >= 0;
  }

  _solveConstraints(h) {
    if (!this.constraints.length) return;
    const iters = this.tier.solverIters;
    // remember pre-solve positions so we can feed the correction back into velocity
    const touched = new Map();
    const remember = (b) => { if (b && !touched.has(b)) touched.set(b, b.position.clone()); };
    for (const c of this.constraints) { remember(c.a); remember(c.b); }

    for (let it = 0; it < iters; it++) {
      for (const c of this.constraints) {
        if (!c.enabled || !c.a || !c.b || !c.a.alive || !c.b.alive) continue;
        const a = c.a, b = c.b;
        const wa = a.invMass, wb = b.invMass;
        const wsum = wa + wb;
        if (wsum <= 0) continue;
        if (c.type === 'cone') {
          // keep b inside a cone around a's local axis
          _va.copy(c.axis).applyQuaternion(a.quaternion);
          _vb.copy(b.position).sub(a.position);
          const len = _vb.length();
          if (len < 1e-6) continue;
          _vb.multiplyScalar(1 / len);
          const cosA = Math.max(-1, Math.min(1, _va.dot(_vb)));
          const ang = Math.acos(cosA);
          if (ang <= c.limit) continue;
          // rotate _vb toward _va so the angle equals the limit
          _vc.copy(_va).cross(_vb);
          if (_vc.lengthSq() < 1e-12) continue;
          _vc.normalize();
          _vd.copy(_va).applyAxisAngle(_vc, c.limit).multiplyScalar(len).add(a.position);
          _vd.sub(b.position).multiplyScalar(c.stiffness);
          b.position.addScaledVector(_vd, wb / wsum);
          a.position.addScaledVector(_vd, -wa / wsum);
        } else {
          _va.copy(b.position).sub(a.position);
          const len = _va.length();
          if (len < 1e-9) continue;
          const diff = (len - c.rest) / len * c.stiffness;
          a.position.addScaledVector(_va, diff * (wa / wsum));
          b.position.addScaledVector(_va, -diff * (wb / wsum));
        }
      }
    }
    // velocity feedback so the chain keeps momentum without exploding
    const inv = 1 / Math.max(h, 1e-5);
    for (const [b, prev] of touched) {
      if (b.invMass === 0) continue;
      _va.copy(b.position).sub(prev).multiplyScalar(inv * 0.55);
      b.velocity.add(_va);
      if (b.velocity.lengthSq() > 3600) b.velocity.setLength(60);
      b.sleeping = false;
    }
    touched.clear();
  }

  /**
   * Extension: build a constrained chain of capsule bodies (ragdoll).
   * parts: [{ name, position, radius, height, mass, parent, limit }]
   */
  ragdoll(parts, opts = {}) {
    const made = [];
    const byName = new Map();
    for (const p of parts) {
      const b = this.addBody({
        shape: 'capsule',
        radius: p.radius != null ? p.radius : 0.08,
        height: p.height != null ? p.height : 0.3,
        mass: p.mass != null ? p.mass : 4,
        position: p.position,
        velocity: opts.velocity,
        restitution: 0.05,
        friction: 0.85,
        linearDamping: opts.linearDamping != null ? opts.linearDamping : 0.35,
        angularDamping: 0.5,
        object3D: p.object3D || null,
        sleep: true,
        userData: { part: p.name },
      });
      b.persistent = !!opts.persistent;
      made.push(b);
      byName.set(p.name, b);
    }
    for (const p of parts) {
      if (!p.parent) continue;
      const a = byName.get(p.parent), b = byName.get(p.name);
      if (!a || !b) continue;
      this.addConstraint({ type: 'distance', a, b });
      this.addConstraint({
        type: 'cone', a, b,
        axis: new THREE.Vector3().copy(b.position).sub(a.position).normalize()
          .applyQuaternion(_qi.copy(a.quaternion).invert()),
        limit: p.limit != null ? p.limit : 0.9,
      });
    }
    return made;
  }

  _explosionImpulse(p) {
    if (!p || !p.point) return;
    const R = p.radius || 6;
    const power = (p.damage || 100) * 0.9;
    for (const b of this.bodies) {
      if (!b.alive || b.invMass === 0) continue;
      _va.copy(b.position).sub(p.point);
      const d = _va.length();
      if (d > R) continue;
      const fall = 1 - d / R;
      _va.multiplyScalar(1 / Math.max(d, 1e-3));
      _va.y += 0.55;
      _va.normalize().multiplyScalar(power * fall * b.mass * 0.06);
      b.sleeping = false; b.sleepTimer = 0;
      b.velocity.add(_va.multiplyScalar(b.invMass));
      b.angularVelocity.x += (Math.random() - 0.5) * 12 * fall;
      b.angularVelocity.y += (Math.random() - 0.5) * 12 * fall;
      b.angularVelocity.z += (Math.random() - 0.5) * 12 * fall;
    }
  }

  // ---- frame --------------------------------------------------------------

  update(dt) {
    // The level may populate the scene after our init() (or the engine may install
    // its fallback scene). Keep looking for collidable geometry until we find some.
    if (!this.chunks.length && this._autoScans < 12) {
      if ((this._scanTick++ % 10) === 0) { this._autoScans++; this.rebuildFromScene(); }
    }
    const h = this._step;
    this._acc += Math.min(dt, 0.1);
    let n = 0;
    const maxSteps = 8;
    while (this._acc >= h && n < maxSteps) {
      this.stepFixed(h);
      this._acc -= h;
      n++;
    }
    if (n === maxSteps) this._acc = 0;
    const alpha = Math.max(0, Math.min(1, this._acc / h));
    this._syncBodyTransforms(alpha);
  }

  lateUpdate() {
    this.syncEntities();
    if (this._debug) this._updateDebug();
  }

  stepFixed(h) {
    const bodies = this.bodies;
    let dead = false;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.alive) { dead = true; continue; }
      b.age += h;
      if (b._hitCd > 0) b._hitCd -= h;
      if (b.ttl > 0 && b.age > b.ttl) { b.alive = false; dead = true; continue; }
      if (b.sleeping) continue;
      b._prevPos.copy(b.position);
      b._prevQuat.copy(b.quaternion);
      this._integrate(b, h);
    }
    this._solveConstraints(h);

    // sleep bookkeeping
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.alive || b.sleeping || !b.allowSleep || b.invMass === 0) continue;
      const v2 = b.velocity.lengthSq(), w2 = b.angularVelocity.lengthSq();
      if (v2 < 0.01 && w2 < 0.16 && b.contacts > 0) {
        b.sleepTimer += h;
        if (b.sleepTimer > 0.4) {
          b.sleeping = true;
          b.velocity.set(0, 0, 0);
          b.angularVelocity.set(0, 0, 0);
          b._prevPos.copy(b.position);
          b._prevQuat.copy(b.quaternion);
        }
      } else b.sleepTimer = 0;
    }
    if (dead) {
      this.bodies = bodies.filter((b) => b.alive);
      this.constraints = this.constraints.filter((c) =>
        (!c.a || c.a.alive) && (!c.b || c.b.alive));
      this.stats.bodies = this.bodies.length;
    }
  }

  _syncBodyTransforms(alpha) {
    for (const b of this.bodies) {
      if (!b.object3D) continue;
      if (b.sleeping) {
        b.object3D.position.copy(b.position);
        b.object3D.quaternion.copy(b.quaternion);
      } else {
        b.object3D.position.lerpVectors(b._prevPos, b.position, alpha);
        b.object3D.quaternion.copy(b._prevQuat).slerp(b.quaternion, alpha);
      }
    }
  }

  setGravity(x, y, z) { this.gravity.set(x, y, z); }

  /** Snapshot of the internal query scratch — for the dev bench / debugging. */
  debugState() {
    return {
      hit: { t: HIT.t, n: [HIT.nx, HIT.ny, HIT.nz], p: [HIT.px, HIT.py, HIT.pz], surface: HIT.surface, tri: HIT.tri },
      slide: { x: SL.x, y: SL.y, z: SL.z, ceiling: SL.ceiling, blocked: SL.blocked, hits: SL.hits },
      depen: { x: DP.x, y: DP.y, z: DP.z, pushed: DP.pushed, deep: DP.deep },
    };
  }

  /** How deep a capsule at `pos` (feet) is inside static geometry. 0 = clear. */
  penetrationDepth(pos, halfHeight, radius) {
    const r = Math.max(0.02, radius || 0.34);
    const hh = Math.max(halfHeight || 0.9, r + 1e-4);
    this._depenetrate(pos.x, pos.y + hh, pos.z, hh - r, r, 1);
    return DP.deep;
  }

  /** Cheap standing test used by crouch/uncrouch checks. */
  capsuleFits(pos, halfHeight, radius) {
    return this.penetrationDepth(pos, halfHeight, radius) <= 1e-4;
  }

  // ---- debug draw ---------------------------------------------------------

  /** debugDraw(enabled) — BVH nodes, the last player capsule, hitboxes and bodies. */
  debugDraw(enabled = true) {
    const scene = this.ctx && this.ctx.scene;
    if (!enabled) {
      if (this._debug) {
        if (this._debug.parent) this._debug.parent.remove(this._debug);
        this._debug.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        this._debug = null;
      }
      return false;
    }
    if (this._debug) return true;
    if (!scene) return false;

    const group = new THREE.Group();
    group.name = 'physicsDebug';
    group.userData.collision = false;
    group.frustumCulled = false;

    const mk = (count, color, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const m = new THREE.LineBasicMaterial({
        color, transparent: true, opacity, depthTest: true, depthWrite: false, fog: false,
      });
      const l = new THREE.LineSegments(g, m);
      l.frustumCulled = false;
      l.renderOrder = 9999;
      g.setDrawRange(0, 0);
      return l;
    };
    this._dbgStatic = mk(48000, 0x3f7a72, 0.22);   // BVH
    this._dbgDynamic = mk(24000, 0xd8ab4a, 0.85);  // capsule + bodies + hitboxes
    group.add(this._dbgStatic, this._dbgDynamic);
    scene.add(group);
    this._debug = group;
    this._rebuildDebugStatic();
    this._updateDebug();
    return true;
  }

  _rebuildDebugStatic() {
    const line = this._dbgStatic;
    if (!line) return;
    const arr = line.geometry.attributes.position.array;
    let n = 0;
    const maxDepth = this.tier.bvhDepth;
    const pushBox = (mnx, mny, mnz, mxx, mxy, mxz) => {
      if (n + 72 > arr.length) return false;
      const c = [
        [mnx, mny, mnz], [mxx, mny, mnz], [mxx, mny, mxz], [mnx, mny, mxz],
        [mnx, mxy, mnz], [mxx, mxy, mnz], [mxx, mxy, mxz], [mnx, mxy, mxz]];
      const E = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
      for (let i = 0; i < E.length; i++) {
        const p = c[E[i]];
        arr[n++] = p[0]; arr[n++] = p[1]; arr[n++] = p[2];
      }
      return true;
    };
    for (const chunk of this.chunks) {
      const B = chunk.bvh;
      if (!B) continue;
      const stack = [[0, 0]];
      while (stack.length) {
        const [ni, d] = stack.pop();
        const b = ni * 6;
        const leaf = B.left[ni] < 0;
        if (d >= maxDepth || leaf) {
          if (!pushBox(B.bounds[b], B.bounds[b + 1], B.bounds[b + 2],
            B.bounds[b + 3], B.bounds[b + 4], B.bounds[b + 5])) { stack.length = 0; break; }
          continue;
        }
        stack.push([B.left[ni], d + 1], [B.left[ni] + 1, d + 1]);
      }
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.setDrawRange(0, n / 3);
  }

  _updateDebug() {
    const line = this._dbgDynamic;
    if (!line) return;
    const arr = line.geometry.attributes.position.array;
    let n = 0;
    const seg = (x0, y0, z0, x1, y1, z1) => {
      if (n + 6 > arr.length) return;
      arr[n++] = x0; arr[n++] = y0; arr[n++] = z0;
      arr[n++] = x1; arr[n++] = y1; arr[n++] = z1;
    };
    const ring = (cx, cy, cz, r, ax) => {
      const S = 16;
      for (let i = 0; i < S; i++) {
        const a0 = (i / S) * Math.PI * 2, a1 = ((i + 1) / S) * Math.PI * 2;
        const c0 = Math.cos(a0) * r, s0 = Math.sin(a0) * r;
        const c1 = Math.cos(a1) * r, s1 = Math.sin(a1) * r;
        if (ax === 1) seg(cx + c0, cy, cz + s0, cx + c1, cy, cz + s1);
        else if (ax === 0) seg(cx, cy + c0, cz + s0, cx, cy + c1, cz + s1);
        else seg(cx + c0, cy + s0, cz, cx + c1, cy + s1, cz);
      }
    };
    const capsuleWire = (p0, p1, r) => {
      ring(p0.x, p0.y, p0.z, r, 1); ring(p1.x, p1.y, p1.z, r, 1);
      const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      // two perpendicular offsets
      let ux = 0, uy = 0, uz = 1;
      if (Math.abs(dz / l) > 0.9) { ux = 1; uy = 0; uz = 0; }
      let ax = uy * dz - uz * dy, ay = uz * dx - ux * dz, az = ux * dy - uy * dx;
      const al = Math.hypot(ax, ay, az) || 1;
      ax = ax / al * r; ay = ay / al * r; az = az / al * r;
      let bx = ay * dz - az * dy, by = az * dx - ax * dz, bz = ax * dy - ay * dx;
      const bl = Math.hypot(bx, by, bz) || 1;
      bx = bx / bl * r; by = by / bl * r; bz = bz / bl * r;
      seg(p0.x + ax, p0.y + ay, p0.z + az, p1.x + ax, p1.y + ay, p1.z + az);
      seg(p0.x - ax, p0.y - ay, p0.z - az, p1.x - ax, p1.y - ay, p1.z - az);
      seg(p0.x + bx, p0.y + by, p0.z + bz, p1.x + bx, p1.y + by, p1.z + bz);
      seg(p0.x - bx, p0.y - by, p0.z - bz, p1.x - bx, p1.y - by, p1.z - bz);
    };

    // last capsule query
    for (const c of this._debugCapsules) {
      _va.set(c.x, c.y - c.hs, c.z); _vb.set(c.x, c.y + c.hs, c.z);
      capsuleWire(_va, _vb, c.r);
      ring(c.x, c.y - c.hs - c.r, c.z, c.r * 0.55, 1);
    }
    // entity hitboxes
    for (const e of this.entities) {
      const ph = e._phys;
      if (!ph) continue;
      for (const hb of ph.boxes) capsuleWire(hb.p0, hb.p1, hb.radius);
    }
    // bodies
    for (const b of this.bodies) {
      if (!b.alive) continue;
      if (b.shape === 'box') {
        const h = b.halfExtents;
        const pts = [];
        for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) for (let sz = -1; sz <= 1; sz += 2) {
          _va.set(h.x * sx, h.y * sy, h.z * sz).applyQuaternion(b.quaternion).add(b.position);
          pts.push(_va.clone());
        }
        const E = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7];
        for (let i = 0; i < E.length; i += 2) {
          const a = pts[E[i]], c = pts[E[i + 1]];
          seg(a.x, a.y, a.z, c.x, c.y, c.z);
        }
      } else if (b.shape === 'capsule') {
        const half = Math.max(0, b.height * 0.5 - b.radius);
        _va.set(0, -half, 0).applyQuaternion(b.quaternion).add(b.position);
        _vb.set(0, half, 0).applyQuaternion(b.quaternion).add(b.position);
        capsuleWire(_va, _vb, b.radius);
      } else {
        ring(b.position.x, b.position.y, b.position.z, b.radius, 0);
        ring(b.position.x, b.position.y, b.position.z, b.radius, 1);
        ring(b.position.x, b.position.y, b.position.z, b.radius, 2);
      }
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.setDrawRange(0, n / 3);
  }

  dispose() {
    if (this.ctx && this.ctx.events) this.ctx.events.off('explosion', this._onExplosion);
    this.debugDraw(false);
    this.chunks.length = 0;
    this._chunkByRoot.clear();
    this.bodies.length = 0;
    this.constraints.length = 0;
    this.entities.length = 0;
    this._hash.clear();
  }
}

// slab test — returns true if the ray (o, 1/d) meets the box within maxDist
function slabHit(mnx, mny, mnz, mxx, mxy, mxz, ox, oy, oz, idx, idy, idz, maxDist) {
  let t0 = (mnx - ox) * idx, t1 = (mxx - ox) * idx;
  let tmin = t0 < t1 ? t0 : t1, tmax = t0 < t1 ? t1 : t0;
  t0 = (mny - oy) * idy; t1 = (mxy - oy) * idy;
  const amin = t0 < t1 ? t0 : t1, amax = t0 < t1 ? t1 : t0;
  if (amin > tmin) tmin = amin;
  if (amax < tmax) tmax = amax;
  t0 = (mnz - oz) * idz; t1 = (mxz - oz) * idz;
  const bmin = t0 < t1 ? t0 : t1, bmax = t0 < t1 ? t1 : t0;
  if (bmin > tmin) tmin = bmin;
  if (bmax < tmax) tmax = bmax;
  return tmax >= (tmin > 0 ? tmin : 0) && tmin <= maxDist;
}

function ignoreMatch(ignore, obj) {
  if (!obj) return false;
  if (typeof ignore === 'function') return !!ignore(obj);
  if (Array.isArray(ignore)) {
    for (let i = 0; i < ignore.length; i++) if (isDescendant(obj, ignore[i])) return true;
    return false;
  }
  if (ignore instanceof Set) {
    for (const o of ignore) if (isDescendant(obj, o)) return true;
    return false;
  }
  return isDescendant(obj, ignore);
}
function isDescendant(obj, root) {
  let o = obj;
  while (o) { if (o === root) return true; o = o.parent; }
  return false;
}

// conservative advancement of a capsule against one triangle
function sweepTri(cx, cy, cz, hs, r, mx, my, mz, tmax,
  ax, ay, az, bx, by, bz, cx2, cy2, cz2, nx, ny, nz) {
  let t = 0;
  for (let it = 0; it < 24; it++) {
    const qx = cx + mx * t, qy = cy + my * t, qz = cz + mz * t;
    segTriClosest(qx, qy - hs, qz, qx, qy + hs, qz,
      ax, ay, az, bx, by, bz, cx2, cy2, cz2, nx, ny, nz);
    const d = Math.sqrt(CP.d2) - r;
    let ex = CP.sx - CP.tx, ey = CP.sy - CP.ty, ez = CP.sz - CP.tz;
    const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (el < 1e-9) return t;                      // dead centre — treat as contact
    ex /= el; ey /= el; ez /= el;
    const denom = -(mx * ex + my * ey + mz * ez);
    // Already touching: only a contact if the motion actually drives into it.
    // Without this the capsule freezes against the floor it is standing on.
    if (d <= CONTACT_EPS) return denom > 1e-7 ? t : -1;
    if (denom <= 1e-7) return -1;
    t += d / denom;
    if (t >= tmax) return -1;
  }
  return t;
}

// resolve the contact normal for the feature currently in CP, applying the
// internal-edge fix so coplanar seams never grab the capsule.
function contactNormal(chunk, ti) {
  const f = CP.f;
  const flags = chunk.edge[ti];
  let useFace = f === F_FACE;
  if (!useFace) {
    if (f >= 3) useFace = ((flags >> (f - 3)) & 1) !== 0;
    else {
      const e0 = (f + 2) % 3, e1 = f;
      useFace = (((flags >> e0) & 1) !== 0) && (((flags >> e1) & 1) !== 0);
    }
  }
  const dx = CP.sx - CP.tx, dy = CP.sy - CP.ty, dz = CP.sz - CP.tz;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (useFace || dl < 1e-7) {
    let nx = chunk.nrm[ti * 3], ny = chunk.nrm[ti * 3 + 1], nz = chunk.nrm[ti * 3 + 2];
    if (dl > 1e-7 && (nx * dx + ny * dy + nz * dz) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    NRM.x = nx; NRM.y = ny; NRM.z = nz;
  } else {
    NRM.x = dx / dl; NRM.y = dy / dl; NRM.z = dz / dl;
  }
}

export { buildBVH, Chunk, segTriClosest, closestPtPointTri, rayCapsule, CP, PT };
