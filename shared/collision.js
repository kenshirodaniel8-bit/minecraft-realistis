// 2D collision shapes on the ground plane (x/z) with a vertical extent.
//
//   circle: { kind: 'circle', x, z, r, y0, y1 }
//   box:    { kind: 'box', x, z, hw, hd, ax, az, y0, y1 }
//           (ax, az) is the unit axis of the half-width hw; the half-depth hd
//           runs along the perpendicular (-az, ax).

export class ColliderGrid {
  constructor(cellSize = 16) {
    this.cell = cellSize;
    this.cells = new Map();
    this.all = [];
  }

  key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }

  add(c) {
    if (c.kind === 'box') c.br = Math.sqrt(c.hw * c.hw + c.hd * c.hd);
    else c.br = c.r;
    if (c.y0 === undefined) c.y0 = -1e9;
    if (c.y1 === undefined) c.y1 = 1e9;
    if (c.enabled === undefined) c.enabled = true;
    this.all.push(c);
    const s = this.cell;
    const x0 = Math.floor((c.x - c.br) / s);
    const x1 = Math.floor((c.x + c.br) / s);
    const z0 = Math.floor((c.z - c.br) / s);
    const z1 = Math.floor((c.z + c.br) / s);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(c);
      }
    }
    return c;
  }

  // Calls fn(collider) for colliders whose cells overlap the circle (x, z, r).
  query(x, z, r, fn) {
    const s = this.cell;
    const x0 = Math.floor((x - r) / s);
    const x1 = Math.floor((x + r) / s);
    const z0 = Math.floor((z - r) / s);
    const z1 = Math.floor((z + r) / s);
    const seen = x0 === x1 && z0 === z1 ? null : new Set();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const c of list) {
          if (seen) {
            if (seen.has(c)) continue;
            seen.add(c);
          }
          fn(c);
        }
      }
    }
  }

  // Pushes a circle of radius r at pos {x, y, z} out of every collider it
  // overlaps. y is the bottom of the moving body, h its height.
  // Returns true if anything was hit.
  resolve(pos, r, h = 4) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.query(pos.x, pos.z, r + 1, (c) => {
        if (!c.enabled) return;
        if (pos.y + h < c.y0 || pos.y > c.y1) return;
        if (c.kind === 'circle') {
          const dx = pos.x - c.x;
          const dz = pos.z - c.z;
          const min = r + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min) {
            const d = Math.sqrt(d2) || 0.0001;
            const push = min - d;
            pos.x += (dx / d) * push;
            pos.z += (dz / d) * push;
            moved = hit = true;
          }
        } else {
          // into box space
          const dx = pos.x - c.x;
          const dz = pos.z - c.z;
          const lu = dx * c.ax + dz * c.az;
          const lv = -dx * c.az + dz * c.ax;
          const cu = Math.max(-c.hw, Math.min(c.hw, lu));
          const cv = Math.max(-c.hd, Math.min(c.hd, lv));
          let nu = lu - cu;
          let nv = lv - cv;
          const d2 = nu * nu + nv * nv;
          if (d2 < r * r) {
            let push;
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2);
              push = r - d;
              nu /= d;
              nv /= d;
            } else {
              // centre inside the box: leave through the closest face
              const pu = c.hw - Math.abs(lu);
              const pv = c.hd - Math.abs(lv);
              if (pu < pv) {
                nu = Math.sign(lu) || 1;
                nv = 0;
                push = pu + r;
              } else {
                nu = 0;
                nv = Math.sign(lv) || 1;
                push = pv + r;
              }
            }
            pos.x += (nu * c.ax - nv * c.az) * push;
            pos.z += (nu * c.az + nv * c.ax) * push;
            moved = hit = true;
          }
        }
      });
      if (!moved) break;
    }
    return hit;
  }

  // True if a circle of radius r moving in a straight line from (x0, z0) to
  // (x1, z1) runs into a collider that it was not already touching at the
  // start (so you can always step out of something). y0..y1 is the height
  // range of the moving body. Used by the server to check player moves.
  segmentBlocked(x0, z0, x1, z1, r, y0, y1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / 0.3));
    let blocked = false;
    this.query((x0 + x1) / 2, (z0 + z1) / 2, len / 2 + r + 0.5, (c) => {
      if (blocked || !c.enabled || y1 < c.y0 || y0 > c.y1) return;
      if (overlaps(c, x0, z0, r)) return;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (overlaps(c, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r)) {
          blocked = true;
          return;
        }
      }
    });
    return blocked;
  }
}

// Does a circle of radius r at (x, z) overlap collider c (ignoring height)?
function overlaps(c, x, z, r) {
  const dx = x - c.x;
  const dz = z - c.z;
  if (c.kind === 'circle') return dx * dx + dz * dz < (r + c.r) * (r + c.r);
  const lu = dx * c.ax + dz * c.az;
  const lv = -dx * c.az + dz * c.ax;
  const nu = lu - Math.max(-c.hw, Math.min(c.hw, lu));
  const nv = lv - Math.max(-c.hd, Math.min(c.hd, lv));
  return nu * nu + nv * nv < r * r;
}

export function boxCollider(x, z, hw, hd, angle, y0, y1, extra = {}) {
  return { kind: 'box', x, z, hw, hd, ax: Math.cos(angle), az: Math.sin(angle), y0, y1, ...extra };
}

export function circleCollider(x, z, r, y0, y1, extra = {}) {
  return { kind: 'circle', x, z, r, y0, y1, ...extra };
}
