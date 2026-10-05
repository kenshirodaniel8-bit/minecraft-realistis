// Procedural 64x64 "realistic default" textures with height-derived normal
// maps and roughness. Pure JS so it can run inside a worker.
//
// Output data is in GL orientation (row 0 = bottom of the texture, v = 0).

import { TileNoise, mulberry32, hashInt } from './noise.js';
import { TEXTURE_NAMES } from './blocks.js';

export const TEX_SIZE = 64;
const S = TEX_SIZE;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function c255(v) { return clamp(Math.round(v), 0, 255); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function mixc(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function shade(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }

class Canvas {
  constructor(seed) {
    this.rgba = new Float32Array(S * S * 4);
    this.h = new Float32Array(S * S);
    this.r = new Float32Array(S * S).fill(0.85);
    this.n = new TileNoise(seed);
    this.rand = mulberry32(seed * 7919 + 13);
    this.normalStrength = 2.0;
    for (let i = 0; i < S * S; i++) this.rgba[i * 4 + 3] = 255;
  }
  set(x, y, c, a = 255) {
    x = ((x % S) + S) % S; y = ((y % S) + S) % S;
    const i = (y * S + x) * 4;
    this.rgba[i] = c[0]; this.rgba[i + 1] = c[1]; this.rgba[i + 2] = c[2]; this.rgba[i + 3] = a;
  }
  get(x, y) {
    x = ((x % S) + S) % S; y = ((y % S) + S) % S;
    const i = (y * S + x) * 4;
    return [this.rgba[i], this.rgba[i + 1], this.rgba[i + 2], this.rgba[i + 3]];
  }
  alpha(x, y, a) {
    x = ((x % S) + S) % S; y = ((y % S) + S) % S;
    this.rgba[(y * S + x) * 4 + 3] = a;
  }
  getA(x, y) {
    x = ((x % S) + S) % S; y = ((y % S) + S) % S;
    return this.rgba[(y * S + x) * 4 + 3];
  }
  H(x, y, v) { x = ((x % S) + S) % S; y = ((y % S) + S) % S; this.h[y * S + x] = v; }
  getH(x, y) { x = ((x % S) + S) % S; y = ((y % S) + S) % S; return this.h[y * S + x]; }
  R(x, y, v) { x = ((x % S) + S) % S; y = ((y % S) + S) % S; this.r[y * S + x] = v; }
  each(fn) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) fn(x, y, x / S, y / S);
  }
  fbm(u, v, f = 4, o = 4, g = 0.5) { return this.n.fbm(u, v, f, o, g); }
  vor(u, v, cells) { return this.n.voronoi(u, v, cells); }
  clear() { for (let i = 0; i < S * S; i++) { this.rgba[i * 4 + 3] = 0; } }
  // Small soft-edged dab used for pebbles, ore crystals, etc.
  blob(cx, cy, rad, col, hAdd = 0.3, alpha = 255) {
    const r2 = rad * rad;
    for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++) {
      for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const k = 1 - d2 / r2;
        const lit = 0.85 + 0.3 * clamp((-dx - dy) / (rad * 1.4), -1, 1);
        this.set(x, y, shade(col, lit), alpha);
        this.H(x, y, Math.max(this.getH(x, y), hAdd * Math.sqrt(k) + 0.5));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Base material painters

function stone(T, base, o = {}) {
  const var1 = o.variation ?? 22;
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 4, 5, 0.55);
    const n2 = T.fbm(u + 0.37, v + 0.71, 16, 3, 0.5);
    const crack = Math.abs(T.fbm(u * 1.0 + 0.11, v * 1.0 + 0.53, 3, 4, 0.55));
    let c = shade(base, 1 + n * var1 / 100 + n2 * 0.06);
    let h = 0.5 + n * 0.3 + n2 * 0.15;
    if (crack < 0.035 && o.cracks !== false) {
      const k = 1 - crack / 0.035;
      c = shade(c, 1 - 0.35 * k);
      h -= 0.35 * k;
    }
    const speck = T.rand();
    if (speck < 0.04) c = shade(c, 0.82);
    else if (speck > 0.965) c = shade(c, 1.12);
    T.set(x, y, c);
    T.H(x, y, h);
    T.R(x, y, o.rough ?? 0.82);
  });
  T.normalStrength = o.normal ?? 2.4;
}

function speckledStone(T, base, specks, o = {}) {
  stone(T, base, { variation: 14, cracks: false, ...o });
  for (const [col, count, size] of specks) {
    for (let i = 0; i < count; i++) {
      const x = T.rand() * S, y = T.rand() * S;
      T.blob(x, y, 0.6 + T.rand() * size, shade(col, 0.9 + T.rand() * 0.2), 0.1);
    }
  }
}

function dirt(T, o = {}) {
  const base = o.base || [118, 84, 58];
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 4, 5, 0.6);
    const n2 = T.fbm(u + 0.5, v + 0.2, 16, 2);
    const c = shade(base, 1 + n * 0.22 + n2 * 0.1);
    T.set(x, y, c);
    T.H(x, y, 0.5 + n * 0.3 + n2 * 0.2);
    T.R(x, y, 0.95);
  });
  // Pebbles and organic bits
  for (let i = 0; i < (o.pebbles ?? 45); i++) {
    const x = T.rand() * S, y = T.rand() * S;
    const r = T.rand();
    const col = r < 0.4 ? [150, 122, 95] : r < 0.75 ? [88, 60, 40] : [128, 118, 105];
    T.blob(x, y, 0.7 + T.rand() * 1.6, shade(col, 0.85 + T.rand() * 0.3), 0.35);
  }
  T.normalStrength = 2.6;
}

function sandLike(T, base, o = {}) {
  T.each((x, y, u, v) => {
    const ripple = Math.sin((v * 6 + T.fbm(u, v, 2, 3) * 1.2) * Math.PI * 2) * (o.ripple ?? 0.04);
    const n = T.fbm(u, v, 8, 3, 0.5);
    const grain = (T.rand() - 0.5) * (o.grain ?? 0.16);
    const c = shade(base, 1 + n * 0.08 + grain + ripple);
    T.set(x, y, c);
    T.H(x, y, 0.5 + ripple * 3 + grain * 0.6 + n * 0.1);
    T.R(x, y, 0.97);
  });
  T.normalStrength = o.normal ?? 1.6;
}

function gravel(T) {
  T.each((x, y, u, v) => {
    const [f1, f2, id] = T.vor(u, v, 11);
    const edge = f2 - f1;
    const tone = 0.62 + ((id >>> 3) & 255) / 255 * 0.55;
    const hueR = ((id >>> 11) & 3);
    let col = hueR === 0 ? [140, 128, 118] : hueR === 1 ? [118, 116, 114] : hueR === 2 ? [150, 140, 128] : [102, 98, 95];
    col = shade(col, tone);
    const gap = smooth(0.0, 0.12, edge);
    const n = T.fbm(u, v, 16, 2) * 0.08;
    T.set(x, y, shade(col, (0.45 + 0.55 * gap) * (1 + n)));
    T.H(x, y, 0.2 + 0.6 * gap * (1 - f1 * 0.8));
    T.R(x, y, 0.9);
  });
  T.normalStrength = 3.2;
}

function cobble(T, o = {}) {
  T.each((x, y, u, v) => {
    const [f1, f2, id] = T.vor(u, v, 5);
    const edge = f2 - f1;
    const tone = 0.78 + ((id >>> 5) & 255) / 255 * 0.42;
    const n = T.fbm(u, v, 8, 4, 0.55);
    let col = shade([128, 126, 122], tone * (1 + n * 0.18));
    const mortar = smooth(0.02, 0.14, edge);
    col = mixc([62, 60, 58], col, mortar);
    const dome = (1 - clamp(f1 * 1.3, 0, 1));
    T.set(x, y, shade(col, 0.85 + 0.25 * dome));
    T.H(x, y, mortar * (0.45 + 0.45 * dome) + n * 0.08);
    T.R(x, y, 0.85);
    if (o.mossy) {
      const m = T.fbm(u + 0.3, v + 0.9, 3, 4, 0.6);
      const amt = smooth(0.0, 0.25, m + (1 - mortar) * 0.25 - (v < 0.3 ? 0 : 0.05));
      if (amt > 0.05) {
        const mc = shade([78, 112, 42], 0.8 + T.fbm(u, v, 16, 2) * 0.4 + T.rand() * 0.15);
        T.set(x, y, mixc(T.get(x, y), mc, amt));
        T.H(x, y, T.getH(x, y) + amt * 0.15);
      }
    }
  });
  T.normalStrength = 3.0;
}

function planks(T, base) {
  const boards = 4;
  const bh = S / boards;
  for (let b = 0; b < boards; b++) {
    const off = Math.floor(T.rand() * S);
    const tone = 0.88 + T.rand() * 0.22;
    const seam = Math.floor(T.rand() * S);
    for (let y = b * bh; y < (b + 1) * bh; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x + off) / S, v = y / S;
        const grain = T.fbm(u * 1, v * 8, 2, 4, 0.5);
        const fine = Math.sin((v * 40 + grain * 6) * Math.PI) * 0.06;
        let c = shade(base, tone * (1 + grain * 0.18 + fine));
        let h = 0.6 + grain * 0.1;
        const ly = y - b * bh;
        if (ly === 0) { c = shade(c, 0.55); h = 0.2; }
        else if (ly === 1) { c = shade(c, 1.08); }
        else if (ly === bh - 1) { c = shade(c, 0.78); h = 0.4; }
        if (Math.abs(x - seam) < 1 && (b % 2 === 0)) { c = shade(c, 0.6); h = 0.25; }
        // Knot
        T.set(x, y, c);
        T.H(x, y, h);
        T.R(x, y, 0.72);
      }
    }
    if (T.rand() < 0.6) {
      const kx = T.rand() * S, ky = b * bh + 3 + T.rand() * (bh - 6);
      for (let y = Math.floor(ky - 3); y <= ky + 3; y++) for (let x = Math.floor(kx - 4); x <= kx + 4; x++) {
        const d = Math.hypot((x - kx) / 1.6, y - ky);
        if (d < 2.6) T.set(x, y, shade(T.get(x, y), 0.75 + 0.1 * Math.sin(d * 4)));
      }
    }
  }
  T.normalStrength = 2.2;
}

function bark(T, base, o = {}) {
  T.each((x, y, u, v) => {
    const warp = T.fbm(u, v, 2, 3) * 0.15;
    const ridges = T.fbm(u * 1 + warp, v * 0.25, 8, 4, 0.55);
    const r = Math.abs(ridges);
    let groove = smooth(0.0, 0.22, r);
    const n = T.fbm(u, v, 16, 2) * 0.1;
    let c = shade(base, (0.55 + 0.55 * groove) * (1 + n));
    let h = 0.25 + 0.65 * groove + n;
    if (o.moss) {
      const m = T.fbm(u + 0.4, v + 0.2, 4, 3);
      if (m > 0.15) c = mixc(c, [70, 92, 40], smooth(0.15, 0.4, m) * 0.6);
    }
    T.set(x, y, c);
    T.H(x, y, h);
    T.R(x, y, 0.9);
  });
  T.normalStrength = 3.4;
}

function birchBark(T) {
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 4, 4);
    const c = shade([222, 218, 206], 0.93 + n * 0.1 + T.rand() * 0.03);
    T.set(x, y, c);
    T.H(x, y, 0.6 + n * 0.1);
    T.R(x, y, 0.75);
  });
  // Dark horizontal lenticels / scars
  for (let i = 0; i < 22; i++) {
    const cx = T.rand() * S, cy = T.rand() * S;
    const w = 2 + T.rand() * 9, hgt = 0.6 + T.rand() * 1.6;
    const dark = T.rand() < 0.35 ? [30, 28, 26] : [70, 66, 60];
    for (let y = Math.floor(cy - hgt); y <= cy + hgt; y++) {
      for (let x = Math.floor(cx - w); x <= cx + w; x++) {
        const k = 1 - Math.abs(x - cx) / w;
        if (T.rand() < k + 0.2) {
          T.set(x, y, shade(dark, 0.9 + T.rand() * 0.3));
          T.H(x, y, 0.3);
        }
      }
    }
  }
  T.normalStrength = 2.0;
}

function logTop(T, wood, barkCol) {
  T.each((x, y, u, v) => {
    const dx = u - 0.5, dy = v - 0.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    const n = T.fbm(u, v, 4, 3) * 0.03;
    const ring = Math.sin((d + n) * 2 * Math.PI * 9) * 0.5 + 0.5;
    let c = shade(wood, 0.82 + 0.22 * ring + T.rand() * 0.04);
    let h = 0.5 + ring * 0.08;
    const edge = Math.max(Math.abs(dx), Math.abs(dy));
    if (edge > 0.43) {
      const bn = T.fbm(u, v, 16, 2);
      c = shade(barkCol, 0.8 + bn * 0.3);
      h = 0.7 + bn * 0.2;
    } else if (edge > 0.41) {
      c = shade(c, 0.7);
    }
    if (d < 0.03) c = shade(c, 0.75);
    T.set(x, y, c);
    T.H(x, y, h);
    T.R(x, y, 0.8);
  });
  T.normalStrength = 1.5;
}

// Grayscale foliage; the mesher tints it per biome.
function leaves(T, o = {}) {
  T.clear();
  const count = o.count ?? 190;
  const bright = o.bright ?? 1;
  for (let i = 0; i < count; i++) {
    const cx = T.rand() * S, cy = T.rand() * S;
    const ang = T.rand() * Math.PI;
    const len = (o.needle ? 3.5 : 2.6) + T.rand() * (o.needle ? 3 : 2.2);
    const wid = o.needle ? 0.7 : 1.3 + T.rand() * 0.8;
    const tone = (145 + T.rand() * 105) * bright;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let y = Math.floor(cy - len - 1); y <= cy + len + 1; y++) {
      for (let x = Math.floor(cx - len - 1); x <= cx + len + 1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const a = dx * ca + dy * sa, b = -dx * sa + dy * ca;
        const k = (a * a) / (len * len) + (b * b) / (wid * wid);
        if (k > 1) continue;
        const vein = Math.abs(b) < 0.35 ? 0.85 : 1;
        const lit = 0.8 + 0.35 * (a / len) * 0.5 + 0.2 * (1 - k);
        const t = tone * lit * vein;
        T.set(x, y, [t * 0.97, t, t * 0.9], 255);
        T.H(x, y, 0.4 + 0.5 * (1 - k));
        T.R(x, y, 0.6);
      }
    }
  }
  // Fill in dark inner foliage so the block is not too see-through.
  T.each((x, y, u, v) => {
    if (T.getA(x, y) === 0) {
      const n = T.fbm(u, v, 8, 3);
      if (n > (o.holes ?? -0.12)) {
        const t = (92 + n * 55) * bright;
        T.set(x, y, [t, t * 1.05, t * 0.9], 255);
        T.H(x, y, 0.2);
      }
    }
  });
  T.normalStrength = 2.0;
}

function ore(T, colors, o = {}) {
  stone(T, [124, 124, 121]);
  const clusters = o.clusters ?? 6;
  for (let c = 0; c < clusters; c++) {
    const cx = 6 + T.rand() * (S - 12), cy = 6 + T.rand() * (S - 12);
    const n = 3 + Math.floor(T.rand() * 4);
    for (let i = 0; i < n; i++) {
      const x = cx + (T.rand() - 0.5) * 9, y = cy + (T.rand() - 0.5) * 9;
      const col = colors[Math.floor(T.rand() * colors.length)];
      T.blob(x, y, 1.4 + T.rand() * 1.8, col, 0.45);
      if (o.glint) {
        T.set(Math.floor(x - 0.5), Math.floor(y - 0.5), [255, 255, 255]);
      }
      for (let yy = Math.floor(y - 3); yy <= y + 3; yy++) for (let xx = Math.floor(x - 3); xx <= x + 3; xx++) {
        if (Math.hypot(xx - x, yy - y) < 2.6) T.R(xx, yy, o.rough ?? 0.45);
      }
    }
  }
}

function wool(T, base) {
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 8, 4, 0.6);
    const fiber = Math.sin((u * 24 + v * 24 + n * 3) * Math.PI) * 0.05 + Math.sin((u * 24 - v * 24 + n * 3) * Math.PI) * 0.05;
    const c = shade(base, 1 + n * 0.12 + fiber + (T.rand() - 0.5) * 0.05);
    T.set(x, y, c);
    T.H(x, y, 0.5 + fiber * 2 + n * 0.2);
    T.R(x, y, 1);
  });
  T.normalStrength = 2.4;
}

function bricks(T) {
  const rows = 4, bh = S / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (S / 4);
    for (let y = r * bh; y < (r + 1) * bh; y++) {
      for (let x = 0; x < S; x++) {
        const bx = Math.floor(((x + offset) % S) / (S / 2));
        const lx = ((x + offset) % (S / 2));
        const ly = y - r * bh;
        const id = hashInt(bx, r, 991);
        const tone = 0.82 + (id & 255) / 255 * 0.3;
        const n = T.fbm(x / S, y / S, 8, 4);
        let c = shade([152, 72, 54], tone * (1 + n * 0.2));
        let h = 0.65 + n * 0.15;
        const mortar = ly < 2 || lx < 2;
        if (mortar) {
          c = shade([178, 172, 160], 0.9 + n * 0.2);
          h = 0.2;
        }
        T.set(x, y, c);
        T.H(x, y, h);
        T.R(x, y, mortar ? 0.95 : 0.85);
      }
    }
  }
  T.normalStrength = 3.0;
}

function stoneBricks(T) {
  stone(T, [124, 124, 121], { cracks: false, variation: 14 });
  const rows = 2, bh = S / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (S / 2);
    for (let y = r * bh; y < (r + 1) * bh; y++) {
      for (let x = 0; x < S; x++) {
        const lx = (x + offset) % (S / 1);
        const ly = y - r * bh;
        const atEdge = ly < 2 || lx % S < 2;
        const bevel = ly === 2 || lx % S === 2 ? 1.12 : (ly === bh - 1 || lx % S === S - 1) ? 0.8 : 1;
        if (atEdge) {
          T.set(x, y, shade([70, 70, 68], 0.9 + T.rand() * 0.15));
          T.H(x, y, 0.15);
        } else {
          T.set(x, y, shade(T.get(x, y), bevel));
        }
      }
    }
  }
  // A couple of cracks.
  for (let k = 0; k < 2; k++) {
    let x = T.rand() * S, y = T.rand() * S;
    for (let i = 0; i < 18; i++) {
      T.set(Math.floor(x), Math.floor(y), [72, 72, 70]);
      T.H(Math.floor(x), Math.floor(y), 0.2);
      x += (T.rand() - 0.5) * 2; y += T.rand() * 1.5;
    }
  }
  T.normalStrength = 2.8;
}

function grassBladesTop(T) {
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 4, 4, 0.6);
    const t = 172 + n * 38;
    T.set(x, y, [t * 0.95, t, t * 0.9]);
    T.H(x, y, 0.4 + n * 0.2);
    T.R(x, y, 0.75);
  });
  for (let i = 0; i < 520; i++) {
    const x0 = T.rand() * S, y0 = T.rand() * S;
    const ang = T.rand() * Math.PI * 2;
    const len = 2 + T.rand() * 4;
    const tone = 140 + T.rand() * 110;
    for (let s = 0; s < len; s += 0.5) {
      const x = Math.floor(x0 + Math.cos(ang) * s), y = Math.floor(y0 + Math.sin(ang) * s);
      const t = tone * (0.85 + 0.3 * (s / len));
      T.set(x, y, [t * 0.95, t, t * 0.88]);
      T.H(x, y, 0.5 + 0.4 * (s / len));
    }
  }
  T.normalStrength = 2.6;
}

// Grass fringe on top of a dirt side texture. Alpha = tint mask.
function grassSide(T, opts = {}) {
  dirt(T, { pebbles: 30 });
  for (let x = 0; x < S; x++) {
    const depth = 9 + Math.floor(Math.abs(T.fbm(x / S, 0.3, 4, 3)) * 18 + T.rand() * 4);
    const drip = T.rand() < 0.18 ? Math.floor(T.rand() * 9) : 0;
    const total = depth + drip;
    for (let y = 0; y < total; y++) {
      if (opts.snow) {
        const t = 236 + T.rand() * 18 - y * 0.3;
        T.set(x, y, [t - 6, t - 2, t + 4], 255);
        T.H(x, y, 0.75 - y / total * 0.2);
        T.R(x, y, 0.7);
      } else {
        const n = T.fbm(x / S, y / S, 8, 3);
        const t = (170 + n * 45 + T.rand() * 35) * (y > total - 3 ? 0.78 : 1);
        T.set(x, y, [t * 0.95, t, t * 0.88], 255);
        T.H(x, y, 0.75 + n * 0.2);
        T.R(x, y, 0.75);
      }
    }
    for (let y = total; y < S; y++) {
      const c = T.get(x, y);
      T.set(x, y, [c[0], c[1], c[2]], opts.snow ? 255 : 0);
    }
  }
  T.normalStrength = 2.6;
}

function podzolSide(T) {
  dirt(T, { pebbles: 30 });
  for (let x = 0; x < S; x++) {
    const depth = 6 + Math.floor(Math.abs(T.fbm(x / S, 0.6, 4, 3)) * 12 + T.rand() * 3);
    for (let y = 0; y < depth; y++) {
      const t = 0.8 + T.rand() * 0.35;
      T.set(x, y, shade([96, 64, 32], t));
      T.H(x, y, 0.7);
    }
  }
}

function podzolTop(T) {
  dirt(T, { base: [92, 62, 34], pebbles: 10 });
  for (let i = 0; i < 260; i++) {
    const x0 = T.rand() * S, y0 = T.rand() * S, ang = T.rand() * Math.PI;
    const col = T.rand() < 0.5 ? [120, 80, 40] : (T.rand() < 0.5 ? [70, 48, 24] : [110, 96, 50]);
    for (let s = 0; s < 4; s += 0.5) {
      T.set(Math.floor(x0 + Math.cos(ang) * s), Math.floor(y0 + Math.sin(ang) * s), shade(col, 0.85 + T.rand() * 0.3));
      T.H(Math.floor(x0 + Math.cos(ang) * s), Math.floor(y0 + Math.sin(ang) * s), 0.75);
    }
  }
}

function moss(T) {
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 8, 4, 0.6);
    const t = 0.75 + n * 0.3 + (T.rand() - 0.5) * 0.25;
    T.set(x, y, shade([82, 118, 40], t));
    T.H(x, y, 0.5 + n * 0.3 + (T.rand() - 0.5) * 0.2);
    T.R(x, y, 1);
  });
  T.normalStrength = 3;
}

function plantBlades(T, o = {}) {
  T.clear();
  const blades = o.blades ?? 26;
  for (let i = 0; i < blades; i++) {
    const baseX = 4 + T.rand() * (S - 8);
    const height = S * (0.45 + T.rand() * 0.5);
    const lean = (T.rand() - 0.5) * 0.5;
    const width = 1.2 + T.rand() * 1.6;
    const tone = 140 + T.rand() * 100;
    for (let s = 0; s < height; s++) {
      const t = s / height;
      const y = S - 1 - s;
      const cx = baseX + lean * s + Math.sin(t * 3) * lean * 4;
      const w = width * (1 - t * 0.85);
      for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w); x++) {
        if (x < 0 || x >= S) continue;
        if (Math.abs(x + 0.5 - cx) > w) continue;
        const shadeF = 0.7 + t * 0.5;
        const c = tone * shadeF;
        T.set(x, y, [c * 0.95, c, c * 0.86], 255);
      }
    }
  }
  T.normalStrength = 0;
}

function fern(T) {
  T.clear();
  const fronds = 7;
  for (let f = 0; f < fronds; f++) {
    const baseX = S / 2 + (T.rand() - 0.5) * 10;
    const ang = -Math.PI / 2 + (f - (fronds - 1) / 2) * 0.28 + (T.rand() - 0.5) * 0.15;
    const len = S * (0.6 + T.rand() * 0.35);
    let x = baseX, y = S - 1;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let s = 0; s < len; s += 0.7) {
      const t = s / len;
      const px = x + dx * s + (ang > -Math.PI / 2 ? 1 : -1) * t * t * 6;
      const py = y + dy * s + t * t * 10;
      const tone = 150 + T.rand() * 50;
      T.set(Math.floor(px), Math.floor(py), [tone * 0.8, tone * 0.85, tone * 0.7], 255);
      if (s % 2.1 < 0.7) {
        const leafLen = (1 - t) * 6 + 1.5;
        for (const side of [-1, 1]) {
          for (let k = 0; k < leafLen; k += 0.5) {
            const lx = px + side * k * 0.9 * -dy + dx * k * 0.3;
            const ly = py + side * k * 0.9 * dx + dy * k * 0.3 + k * 0.25;
            const t2 = (130 + T.rand() * 90);
            T.set(Math.floor(lx), Math.floor(ly), [t2 * 0.93, t2, t2 * 0.86], 255);
          }
        }
      }
    }
  }
  T.normalStrength = 0;
}

function flower(T, petal, center, o = {}) {
  T.clear();
  // Stem + leaves
  const stemX = S / 2;
  const headY = o.headY ?? 18;
  for (let y = headY; y < S; y++) {
    const x = Math.floor(stemX + Math.sin(y / 9) * 1.2);
    T.set(x, y, shade([58, 118, 38], 0.85 + T.rand() * 0.2));
    T.set(x + 1, y, shade([48, 100, 30], 0.85 + T.rand() * 0.2));
  }
  for (const [ly, dir] of [[S - 16, 1], [S - 26, -1]]) {
    for (let k = 0; k < 11; k++) {
      const x = stemX + dir * k, y = ly - Math.sin(k / 11 * Math.PI) * 4;
      for (let w = -1; w <= 1; w++) T.set(Math.floor(x), Math.floor(y + w * (1 - k / 11)), shade([62, 128, 40], 0.8 + T.rand() * 0.25));
    }
  }
  const petals = o.petals ?? 6;
  const pr = o.radius ?? 9;
  for (let p = 0; p < petals; p++) {
    const a = (p / petals) * Math.PI * 2 + T.rand() * 0.3;
    const cx = stemX + Math.cos(a) * pr * 0.55, cy = headY + Math.sin(a) * pr * 0.45;
    for (let y = Math.floor(cy - pr * 0.6); y <= cy + pr * 0.6; y++) {
      for (let x = Math.floor(cx - pr * 0.6); x <= cx + pr * 0.6; x++) {
        const d = Math.hypot(x - cx, (y - cy) * 1.2) / (pr * 0.55);
        if (d < 1) T.set(x, y, shade(petal, 0.75 + 0.35 * (1 - d) + (T.rand() - 0.5) * 0.12));
      }
    }
  }
  for (let y = headY - 3; y <= headY + 3; y++) for (let x = stemX - 3; x <= stemX + 3; x++) {
    if (Math.hypot(x - stemX, y - headY) < 3) T.set(x, y, shade(center, 0.8 + T.rand() * 0.3));
  }
  T.normalStrength = 0;
}

function deadBush(T) {
  T.clear();
  const branch = (x, y, ang, len, w) => {
    for (let s = 0; s < len; s += 0.5) {
      const px = x + Math.cos(ang) * s, py = y + Math.sin(ang) * s;
      for (let k = 0; k < w; k++) T.set(Math.floor(px + k), Math.floor(py), shade([124, 86, 46], 0.8 + T.rand() * 0.3));
    }
    if (len > 6) {
      const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
      branch(ex, ey, ang - 0.5 - T.rand() * 0.3, len * 0.6, Math.max(1, w - 1));
      branch(ex, ey, ang + 0.5 + T.rand() * 0.3, len * 0.6, Math.max(1, w - 1));
    }
  };
  branch(S / 2, S - 1, -Math.PI / 2, 22, 3);
  branch(S / 2, S - 1, -Math.PI / 2 - 0.7, 18, 2);
  branch(S / 2, S - 1, -Math.PI / 2 + 0.7, 18, 2);
  T.normalStrength = 0;
}

function vines(T) {
  T.clear();
  for (let s = 0; s < 6; s++) {
    let x = 4 + T.rand() * (S - 8);
    for (let y = 0; y < S; y++) {
      x += (T.rand() - 0.5) * 1.2;
      const t = 90 + T.rand() * 60;
      T.set(Math.floor(x), y, [t * 0.9, t, t * 0.8], 255);
      if (T.rand() < 0.3) {
        const side = T.rand() < 0.5 ? -1 : 1;
        for (let k = 1; k < 4 + T.rand() * 3; k++) {
          for (let w = 0; w < 2; w++) {
            const tt = 130 + T.rand() * 100;
            T.set(Math.floor(x + side * k), y + w - Math.floor(k / 3), [tt * 0.93, tt, tt * 0.85], 255);
          }
        }
      }
    }
  }
  T.normalStrength = 0;
}

function glass(T) {
  T.clear();
  T.each((x, y) => {
    const border = x < 3 || y < 3 || x > S - 4 || y > S - 4;
    if (border) {
      const t = 205 + T.rand() * 25;
      T.set(x, y, [t * 0.92, t, t], 255);
      T.H(x, y, x < 1 || y < 1 || x > S - 2 || y > S - 2 ? 0.3 : 0.8);
    }
    T.R(x, y, 0.05);
  });
  // Diagonal glint streaks
  for (const [off, len] of [[12, 10], [20, 6], [44, 8]]) {
    for (let k = 0; k < len; k++) {
      T.set(off + k, 8 + k, [235, 250, 255], 255);
      T.set(off + k + 1, 8 + k, [215, 235, 245], 255);
    }
  }
  T.normalStrength = 1;
}

function torch(T) {
  T.clear();
  for (let y = 0; y < S; y++) {
    for (let x = 28; x < 36; x++) {
      // In image space, the stick occupies rows 24..63 (bottom 10/16), flame rows 24..31.
      if (y < 24) continue;
      if (y < 32) {
        const t = (y - 24) / 8;
        const c = mixc([255, 250, 200], [255, 150, 30], t * 0.8 + T.rand() * 0.2);
        T.set(x, y, c, 255);
      } else {
        const t = 0.75 + T.rand() * 0.3 + (x === 28 || x === 35 ? -0.2 : 0);
        T.set(x, y, shade([118, 84, 44], t), 255);
      }
    }
  }
  T.normalStrength = 0;
}

function glowstone(T) {
  T.each((x, y, u, v) => {
    const [f1, f2, id] = T.vor(u, v, 7);
    const edge = f2 - f1;
    const tone = 0.7 + ((id >>> 4) & 255) / 255 * 0.4;
    const core = 1 - clamp(f1 * 1.6, 0, 1);
    const c = mixc([170, 110, 50], [255, 236, 170], core * tone);
    const gap = smooth(0, 0.1, edge);
    T.set(x, y, shade(c, 0.55 + 0.45 * gap));
    T.H(x, y, 0.3 + 0.6 * gap * core);
    T.R(x, y, 0.5);
  });
  T.normalStrength = 2.5;
}

function bookshelf(T) {
  planks(T, [166, 128, 80]);
  const shelves = [[6, 30], [36, 60]];
  for (const [y0, y1] of shelves) {
    let x = 4;
    while (x < S - 4) {
      const w = 3 + Math.floor(T.rand() * 4);
      const top = y0 + Math.floor(T.rand() * 6);
      const palette = [[120, 30, 30], [40, 60, 120], [40, 90, 40], [130, 100, 40], [80, 40, 90], [150, 120, 90]];
      const col = palette[Math.floor(T.rand() * palette.length)];
      for (let y = top; y < y1; y++) for (let xx = x; xx < Math.min(x + w, S - 4); xx++) {
        const edge = xx === x || xx === x + w - 1;
        const band = (y - top) === 3 || (y1 - y) === 4;
        T.set(xx, y, shade(col, (edge ? 0.7 : 1) * (band ? 1.3 : 1) * (0.9 + T.rand() * 0.15)));
        T.H(xx, y, edge ? 0.45 : 0.55);
      }
      x += w;
    }
    for (let x2 = 0; x2 < S; x2++) for (let y = y0 - 2; y < y0; y++) T.set(x2, y, shade([90, 66, 40], 0.8));
  }
}

function cactusSide(T) {
  T.each((x, y, u, v) => {
    const ridge = Math.cos(u * Math.PI * 2 * 4) * 0.5 + 0.5;
    const n = T.fbm(u, v, 8, 3) * 0.12;
    const c = shade([72, 132, 48], 0.7 + 0.4 * ridge + n);
    T.set(x, y, c);
    T.H(x, y, 0.3 + 0.5 * ridge);
    T.R(x, y, 0.55);
  });
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(T.rand() * 4) * 16 + 8 + (T.rand() < 0.5 ? -1 : 0), y = Math.floor(T.rand() * S);
    T.set(x, y, [235, 230, 200]);
    T.set(x + 1, y, [40, 40, 30]);
  }
  T.normalStrength = 2.5;
}

function cactusTop(T) {
  T.each((x, y, u, v) => {
    const dx = u - 0.5, dy = v - 0.5;
    const a = Math.atan2(dy, dx);
    const d = Math.hypot(dx, dy);
    const ridge = Math.cos(a * 8) * 0.5 + 0.5;
    let c = shade([88, 148, 58], 0.75 + 0.3 * ridge * smooth(0.05, 0.4, d));
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 0.44) c = shade(c, 0.7);
    T.set(x, y, c);
    T.H(x, y, 0.4 + ridge * 0.3);
  });
}

function bedrock(T) {
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 4, 5, 0.65);
    const [f1] = T.vor(u, v, 6);
    const t = clamp(0.5 + n * 0.9 - f1 * 0.3, 0.05, 1);
    T.set(x, y, shade([150, 150, 150], t));
    T.H(x, y, t);
    T.R(x, y, 0.9);
  });
  T.normalStrength = 4;
}

function obsidian(T) {
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 4, 5, 0.6);
    const [f1, f2] = T.vor(u, v, 5);
    const e = smooth(0, 0.08, f2 - f1);
    let c = mixc([14, 10, 22], [52, 32, 78], clamp(n * 0.8 + 0.3, 0, 1));
    c = shade(c, 0.7 + 0.3 * e);
    T.set(x, y, c);
    T.H(x, y, 0.5 + 0.3 * e);
    T.R(x, y, 0.18 + (1 - e) * 0.4);
  });
  T.normalStrength = 2;
}

function snow(T) {
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 4, 4);
    const t = 1 + n * 0.05 + (T.rand() - 0.5) * 0.04;
    T.set(x, y, shade([238, 243, 250], t));
    T.H(x, y, 0.5 + n * 0.3);
    T.R(x, y, T.rand() < 0.02 ? 0.2 : 0.75);
  });
  T.normalStrength = 1.2;
}

function ice(T) {
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 4, 4);
    const crack = Math.abs(T.fbm(u + 0.2, v + 0.6, 3, 4));
    let c = shade([156, 196, 242], 0.92 + n * 0.1);
    if (crack < 0.03) c = shade(c, 1.25);
    T.set(x, y, c);
    T.H(x, y, 0.5 + (crack < 0.03 ? -0.2 : 0));
    T.R(x, y, 0.08);
  });
  T.normalStrength = 1.2;
}

function water(T) {
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 4, 4);
    T.set(x, y, shade([48, 92, 170], 0.9 + n * 0.2), 200);
    T.H(x, y, 0.5);
    T.R(x, y, 0.05);
  });
}

function clay(T) {
  T.each((x, y, u, v) => {
    const n = T.fbm(u, v, 4, 4, 0.5);
    const c = shade([158, 164, 176], 1 + n * 0.08 + (T.rand() - 0.5) * 0.03);
    T.set(x, y, c);
    T.H(x, y, 0.5 + n * 0.15);
    T.R(x, y, 0.7);
  });
  T.normalStrength = 1.2;
}

function sandstoneSide(T) {
  T.each((x, y, u, v) => {
    const band = Math.sin((v * 7 + T.fbm(u, v, 2, 2) * 0.4) * Math.PI * 2) * 0.5 + 0.5;
    const n = T.fbm(u, v, 8, 3) * 0.06;
    let c = shade([216, 199, 148], 0.9 + band * 0.12 + n + (T.rand() - 0.5) * 0.06);
    let h = 0.4 + band * 0.3;
    if (y < 8) { c = shade([224, 210, 162], 1 + (T.rand() - 0.5) * 0.05); h = 0.75; }
    if (y === 8) { c = shade(c, 0.8); h = 0.2; }
    T.set(x, y, c);
    T.H(x, y, h);
    T.R(x, y, 0.92);
  });
  T.normalStrength = 2;
}

function craftingTableTop(T) {
  planks(T, [168, 130, 82]);
  // Dark frame + 3x3 work grid
  T.each((x, y) => {
    const edge = x < 4 || y < 4 || x > S - 5 || y > S - 5;
    const grid = (x > 6 && x < S - 7 && y > 6 && y < S - 7) && ((x - 7) % 17 < 2 || (y - 7) % 17 < 2);
    if (edge) { T.set(x, y, shade([104, 74, 44], 0.85 + T.rand() * 0.2)); T.H(x, y, 0.75); }
    else if (grid) { T.set(x, y, shade([70, 50, 30], 0.9 + T.rand() * 0.15)); T.H(x, y, 0.3); }
  });
}

function craftingTableSide(T) {
  planks(T, [150, 112, 70]);
  T.each((x, y) => {
    if (y < 10) { T.set(x, y, shade([110, 80, 48], 0.85 + T.rand() * 0.2)); T.H(x, y, 0.75); }
  });
  // A saw and a hammer hanging on the side.
  for (let i = 0; i < 22; i++) {
    for (let w = 0; w < 6; w++) T.set(10 + i, 20 + w + Math.floor(i / 6), shade([175, 180, 186], 0.85 + T.rand() * 0.2));
    if (i % 3 === 0) T.set(10 + i, 26 + Math.floor(i / 6), [80, 80, 86]);
  }
  for (let y = 18; y < 30; y++) for (let x = 32; x < 36; x++) T.set(x, y, shade([96, 64, 34], 0.9 + T.rand() * 0.2));
  for (let y = 16; y < 50; y++) for (let x = 44; x < 48; x++) T.set(x, y, shade([120, 84, 44], 0.9 + T.rand() * 0.2));
  for (let y = 14; y < 22; y++) for (let x = 38; x < 54; x++) T.set(x, y, shade([120, 122, 128], 0.85 + T.rand() * 0.2));
}

function furnaceFront(T) {
  stone(T, [118, 118, 116], { cracks: false, variation: 16 });
  T.each((x, y) => {
    const edge = x < 3 || y < 3 || x > S - 4 || y > S - 4;
    if (edge) { T.set(x, y, shade([92, 92, 90], 0.9 + T.rand() * 0.15)); T.H(x, y, 0.8); }
    // Fire opening
    if (x >= 16 && x < 48 && y >= 34 && y < 54) {
      const inner = x >= 19 && x < 45 && y >= 37 && y < 51;
      if (inner) {
        const t = (y - 37) / 14;
        const fire = T.rand() < 0.5 + t * 0.4;
        T.set(x, y, fire ? mixc([255, 200, 80], [200, 60, 10], T.rand() * (1 - t * 0.5)) : [24, 20, 18]);
        T.H(x, y, 0.1);
        T.R(x, y, 0.9);
      } else {
        T.set(x, y, shade([60, 60, 60], 0.9 + T.rand() * 0.1));
        T.H(x, y, 0.35);
      }
    }
    if (x >= 16 && x < 48 && y >= 14 && y < 18) { T.set(x, y, [40, 40, 40]); T.H(x, y, 0.2); }
  });
}

function furnaceTop(T) {
  stone(T, [112, 112, 110], { cracks: false, variation: 14 });
  T.each((x, y) => {
    if (x < 3 || y < 3 || x > S - 4 || y > S - 4) { T.set(x, y, shade([90, 90, 88], 0.9 + T.rand() * 0.15)); T.H(x, y, 0.8); }
  });
}

const PAINTERS = {
  stone: (T) => stone(T, [124, 124, 121]),
  dirt: (T) => dirt(T),
  grass_top: (T) => grassBladesTop(T),
  grass_side: (T) => grassSide(T),
  grass_snow_side: (T) => grassSide(T, { snow: true }),
  cobblestone: (T) => cobble(T),
  mossy_cobblestone: (T) => cobble(T, { mossy: true }),
  oak_planks: (T) => planks(T, [168, 130, 82]),
  spruce_planks: (T) => planks(T, [112, 80, 50]),
  birch_planks: (T) => planks(T, [198, 180, 126]),
  jungle_planks: (T) => planks(T, [162, 114, 80]),
  bedrock: (T) => bedrock(T),
  sand: (T) => sandLike(T, [220, 205, 160]),
  gravel: (T) => gravel(T),
  clay: (T) => clay(T),
  oak_log: (T) => bark(T, [104, 80, 50]),
  oak_log_top: (T) => logTop(T, [176, 140, 88], [92, 72, 45]),
  birch_log: (T) => birchBark(T),
  birch_log_top: (T) => logTop(T, [206, 188, 132], [218, 214, 200]),
  spruce_log: (T) => bark(T, [64, 44, 28]),
  spruce_log_top: (T) => logTop(T, [128, 94, 58], [58, 40, 25]),
  jungle_log: (T) => bark(T, [96, 74, 40], { moss: true }),
  jungle_log_top: (T) => logTop(T, [172, 124, 84], [90, 70, 38]),
  oak_leaves: (T) => leaves(T),
  birch_leaves: (T) => leaves(T, { count: 170, bright: 1.1 }),
  spruce_leaves: (T) => leaves(T, { needle: true, count: 320, holes: -0.2 }),
  jungle_leaves: (T) => leaves(T, { count: 150, bright: 1.05, holes: -0.25 }),
  glass: (T) => glass(T),
  water: (T) => water(T),
  coal_ore: (T) => ore(T, [[32, 32, 34], [48, 46, 48], [20, 20, 22]], { rough: 0.6 }),
  iron_ore: (T) => ore(T, [[216, 172, 142], [190, 140, 110], [230, 196, 170]]),
  gold_ore: (T) => ore(T, [[252, 222, 70], [235, 180, 40], [255, 245, 150]], { rough: 0.3, glint: true }),
  diamond_ore: (T) => ore(T, [[100, 236, 226], [60, 200, 200], [190, 255, 250]], { rough: 0.15, glint: true }),
  sandstone_top: (T) => sandLike(T, [222, 207, 156], { ripple: 0.01, grain: 0.1, normal: 1.2 }),
  sandstone_side: (T) => sandstoneSide(T),
  sandstone_bottom: (T) => sandLike(T, [210, 195, 145], { ripple: 0.02, grain: 0.2, normal: 2 }),
  snow: (T) => snow(T),
  bricks: (T) => bricks(T),
  stone_bricks: (T) => stoneBricks(T),
  torch: (T) => torch(T),
  glowstone: (T) => glowstone(T),
  tall_grass: (T) => plantBlades(T),
  fern: (T) => fern(T),
  poppy: (T) => flower(T, [205, 34, 30], [40, 30, 20]),
  dandelion: (T) => flower(T, [250, 214, 40], [230, 160, 20], { petals: 9, radius: 8 }),
  cornflower: (T) => flower(T, [72, 104, 232], [30, 40, 120], { petals: 7 }),
  dead_bush: (T) => deadBush(T),
  vines: (T) => vines(T),
  cactus_side: (T) => cactusSide(T),
  cactus_top: (T) => cactusTop(T),
  wool_white: (T) => wool(T, [234, 234, 232]),
  wool_red: (T) => wool(T, [168, 40, 36]),
  wool_blue: (T) => wool(T, [52, 62, 162]),
  wool_green: (T) => wool(T, [86, 112, 30]),
  wool_yellow: (T) => wool(T, [246, 196, 42]),
  wool_black: (T) => wool(T, [28, 28, 32]),
  bookshelf: (T) => bookshelf(T),
  obsidian: (T) => obsidian(T),
  granite: (T) => speckledStone(T, [152, 106, 86], [[[196, 140, 120], 120, 1.2], [[90, 60, 50], 90, 0.9]]),
  diorite: (T) => speckledStone(T, [196, 196, 194], [[[120, 120, 122], 110, 1.0], [[240, 240, 240], 70, 1.2]]),
  andesite: (T) => speckledStone(T, [134, 134, 134], [[[110, 110, 112], 140, 0.9], [[160, 160, 158], 90, 0.8]]),
  podzol_top: (T) => podzolTop(T),
  podzol_side: (T) => podzolSide(T),
  moss_block: (T) => moss(T),
  ice: (T) => ice(T),
  crafting_table_top: (T) => craftingTableTop(T),
  crafting_table_side: (T) => craftingTableSide(T),
  furnace_front: (T) => furnaceFront(T),
  furnace_top: (T) => furnaceTop(T),
};

// ---------------------------------------------------------------------------

export function generateTextures(seed = 20240917) {
  const count = TEXTURE_NAMES.length;
  const px = S * S;
  const albedo = new Uint8Array(count * px * 4);
  const normal = new Uint8Array(count * px * 4);
  const avg = new Float32Array(count * 3);

  TEXTURE_NAMES.forEach((name, layer) => {
    const T = new Canvas((seed + layer * 1013) >>> 0);
    const painter = PAINTERS[name];
    if (!painter) throw new Error('No painter for texture ' + name);
    painter(T);

    const base = layer * px * 4;
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let y = 0; y < S; y++) {
      const gy = S - 1 - y; // flip to GL orientation
      for (let x = 0; x < S; x++) {
        const si = (y * S + x) * 4;
        const di = base + (gy * S + x) * 4;
        const a = T.rgba[si + 3];
        albedo[di] = c255(T.rgba[si]);
        albedo[di + 1] = c255(T.rgba[si + 1]);
        albedo[di + 2] = c255(T.rgba[si + 2]);
        albedo[di + 3] = c255(a);
        if (a > 127) { ar += T.rgba[si]; ag += T.rgba[si + 1]; ab += T.rgba[si + 2]; an++; }

        // Normal from height (image space: +y is down, so v = -y).
        const s = T.normalStrength;
        const hx = T.getH(x + 1, y) - T.getH(x - 1, y);
        const hy = T.getH(x, y + 1) - T.getH(x, y - 1);
        let nx = -hx * s, ny = hy * s, nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len; ny /= len; nz /= len;
        normal[di] = c255((nx * 0.5 + 0.5) * 255);
        normal[di + 1] = c255((ny * 0.5 + 0.5) * 255);
        normal[di + 2] = c255((nz * 0.5 + 0.5) * 255);
        normal[di + 3] = c255(T.r[y * S + x] * 255);
      }
    }
    if (an > 0) {
      avg[layer * 3] = ar / an / 255; avg[layer * 3 + 1] = ag / an / 255; avg[layer * 3 + 2] = ab / an / 255;
    }
  });

  return { size: S, count, albedo, normal, avg };
}
