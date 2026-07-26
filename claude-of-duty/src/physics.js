// Minimal collision layer: the world is a flat plane plus a list of
// axis-aligned boxes. Actors are vertical cylinders (circles in XZ).

export function makeCollider(cx, cz, halfX, halfZ, top = Infinity) {
  return { minX: cx - halfX, maxX: cx + halfX, minZ: cz - halfZ, maxZ: cz + halfZ, top };
}

// Push a circle at (pos.x, pos.z) out of every AABB it overlaps.
// `y` is the actor's feet height — colliders shorter than the actor's feet
// are stepped over. Returns true if any resolution happened.
export function resolveCircle(colliders, pos, radius, y = 0) {
  let touched = false;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (y > c.top - 0.01) continue;
    const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    let dx = pos.x - nx;
    let dz = pos.z - nz;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;
    touched = true;
    if (distSq > 1e-9) {
      const dist = Math.sqrt(distSq);
      const push = radius - dist;
      pos.x += (dx / dist) * push;
      pos.z += (dz / dist) * push;
    } else {
      // Center is inside the box: escape through the nearest face.
      const left = pos.x - c.minX, right = c.maxX - pos.x;
      const near = pos.z - c.minZ, far = c.maxZ - pos.z;
      const m = Math.min(left, right, near, far);
      if (m === left) pos.x = c.minX - radius;
      else if (m === right) pos.x = c.maxX + radius;
      else if (m === near) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
    }
  }
  return touched;
}

// Keep a point inside the arena square (with margin).
export function clampToArena(pos, halfSize, margin) {
  const lim = halfSize - margin;
  pos.x = Math.max(-lim, Math.min(lim, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
}
