// Player skins: Minecraft-format (64x64 / legacy 64x32 / HD) skin loading,
// a procedurally painted default skin, and a skinned player model.

import * as THREE from 'three';
import { createEntityMaterial } from './materials.js';

export const MAX_SKIN_BYTES = 400 * 1024;

// ---------------------------------------------------------------------------
// Default skins (original artwork painted in code).

const PRESETS = {
  explorer: {
    skin: [198, 142, 104], hair: [102, 66, 38], eyes: [60, 110, 70], shirt: [46, 128, 96], shirt2: [34, 98, 74],
    pants: [44, 62, 120], boots: [86, 58, 36], belt: [58, 40, 24],
  },
  ranger: {
    skin: [236, 196, 160], hair: [216, 170, 72], eyes: [60, 90, 170], shirt: [168, 64, 44], shirt2: [128, 44, 30],
    pants: [70, 64, 52], boots: [52, 40, 30], belt: [32, 26, 20],
  },
  scout: {
    skin: [142, 96, 66], hair: [24, 20, 18], eyes: [70, 50, 30], shirt: [232, 196, 64], shirt2: [196, 156, 40],
    pants: [36, 36, 44], boots: [30, 30, 34], belt: [120, 80, 40],
  },
};

PRESETS.zombie = {
  skin: [92, 140, 78], hair: [64, 104, 56], eyes: [12, 12, 12], sclera: [34, 46, 30], shirt: [40, 106, 116], shirt2: [30, 84, 92],
  pants: [70, 60, 134], boots: [54, 46, 104], belt: [58, 50, 112],
};

export const DEFAULT_SKIN_NAMES = ['explorer', 'ranger', 'scout'];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function faceRects(u, v, w, h, d) {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + d + w + d, v + d, w, h],
  };
}

export function createDefaultSkinCanvas(name = 'explorer') {
  const p = PRESETS[name] || PRESETS.explorer;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  const rand = rng(name.length * 977 + 13);
  const px = (x, y, col, f = 1) => {
    const n = 0.92 + rand() * 0.14;
    ctx.fillStyle = `rgb(${Math.min(255, col[0] * f * n) | 0},${Math.min(255, col[1] * f * n) | 0},${Math.min(255, col[2] * f * n) | 0})`;
    ctx.fillRect(x, y, 1, 1);
  };
  const fill = (rect, fn) => {
    const [x0, y0, w, h] = rect;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = fn(x, y, w, h);
      if (r) px(x0 + x, y0 + y, r[0], r[1] ?? 1);
    }
  };

  // Head
  const head = faceRects(0, 0, 8, 8, 8);
  fill(head.top, () => [p.hair, 1]);
  fill(head.bottom, () => [p.skin, 0.85]);
  fill(head.back, (x, y) => (y < 7 ? [p.hair, y > 5 ? 0.85 : 1] : [p.skin, 0.8]));
  const side = (x, y, w, h, mirror) => {
    const fromFront = mirror ? x : (w - 1 - x);
    if (y < 2 || (y < 6 && fromFront > 3) || (y < 4 && fromFront > 1)) return [p.hair, 1];
    if (y === 4 && fromFront === 1) return [p.skin, 0.8];
    return [p.skin, 0.95];
  };
  fill(head.right, (x, y, w, h) => side(x, y, w, h, false));
  fill(head.left, (x, y, w, h) => side(x, y, w, h, true));
  fill(head.front, (x, y) => {
    if (y < 2) return [p.hair, 1];
    if (y === 2 && (x === 0 || x === 7 || x === 3)) return [p.hair, 0.9];
    if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return [p.hair, 0.75]; // brows
    if (y === 4) {
      if (x === 1 || x === 6) return [p.sclera || [245, 245, 245], 1];
      if (x === 2 || x === 5) return [p.eyes, 1];
    }
    if (y === 5 && (x === 3 || x === 4)) return [p.skin, 0.82]; // nose shadow
    if (y === 6 && x >= 3 && x <= 4) return [[150, 80, 70], 1];
    if (y === 6 && (x === 2 || x === 5)) return [p.skin, 0.9];
    return [p.skin, 1];
  });

  // Body
  const body = faceRects(16, 16, 8, 12, 4);
  const torso = (x, y, w) => {
    if (y >= 10) return y === 10 ? [p.belt, 1] : [p.pants, 1];
    if (y === 0 && w === 8 && x >= 2 && x <= 5) return [p.skin, 0.9];
    return [y < 2 ? p.shirt2 : p.shirt, 1 - y * 0.012];
  };
  fill(body.front, (x, y, w) => {
    const t = torso(x, y, w);
    if (y >= 1 && y < 10 && (x === 3 || x === 4) && y % 3 === 1) return [p.shirt2, 0.8];
    if (y === 10 && (x === 3 || x === 4)) return [[200, 180, 80], 1];
    return t;
  });
  fill(body.back, (x, y, w) => torso(x, y, w));
  fill(body.right, (x, y, w) => torso(x, y, w));
  fill(body.left, (x, y, w) => torso(x, y, w));
  fill(body.top, () => [p.shirt, 1.05]);
  fill(body.bottom, () => [p.pants, 0.8]);

  // Arms
  const arm = (u, v) => {
    const r = faceRects(u, v, 4, 12, 4);
    const fn = (x, y) => (y < 4 ? [p.shirt, 1] : y < 5 ? [p.shirt2, 1] : [p.skin, y > 10 ? 0.9 : 1]);
    fill(r.front, fn); fill(r.back, fn); fill(r.left, fn); fill(r.right, fn);
    fill(r.top, () => [p.shirt, 1.05]);
    fill(r.bottom, () => [p.skin, 0.85]);
  };
  arm(40, 16);
  arm(32, 48);

  // Legs
  const leg = (u, v, flip) => {
    const r = faceRects(u, v, 4, 12, 4);
    const fn = (x, y) => (y >= 10 ? [p.boots, y === 11 ? 0.8 : 1] : y === 9 ? [p.boots, 0.9] : [p.pants, (flip ? x : 3 - x) === 0 ? 0.88 : 1]);
    fill(r.front, fn); fill(r.back, fn); fill(r.left, fn); fill(r.right, fn);
    fill(r.top, () => [p.pants, 1]);
    fill(r.bottom, () => [p.boots, 0.7]);
  };
  leg(0, 16, false);
  leg(16, 48, true);
  return c;
}

// ---------------------------------------------------------------------------
// Loading user skins

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image file.'));
    img.src = src;
  });
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read file.'));
    r.readAsDataURL(file);
  });
}

function copyMirrored(ctx, sx, sy, w, h, dx, dy, k) {
  ctx.save();
  ctx.translate((dx + w) * k, dy * k);
  ctx.scale(-1, 1);
  ctx.drawImage(ctx.canvas, sx * k, sy * k, w * k, h * k, 0, 0, w * k, h * k);
  ctx.restore();
}

// Converts any accepted skin image into a square canvas in modern layout.
export function normalizeSkinImage(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const legacy = w === h * 2;
  if (!(w === h || legacy) || w % 64 !== 0 || w < 64 || w > 512) {
    throw new Error(`Skins must be 64x64 or 64x32 pixels (HD: 128, 256 or 512). This image is ${w}x${h}.`);
  }
  const k = w / 64;
  const c = document.createElement('canvas');
  c.width = w; c.height = w;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, w);
  ctx.drawImage(img, 0, 0);
  if (legacy) {
    // Old skins only have one arm and one leg: mirror them to the left side.
    copyMirrored(ctx, 4, 16, 4, 4, 20, 48, k);
    copyMirrored(ctx, 8, 16, 4, 4, 24, 48, k);
    copyMirrored(ctx, 0, 20, 4, 12, 24, 52, k);
    copyMirrored(ctx, 4, 20, 4, 12, 20, 52, k);
    copyMirrored(ctx, 8, 20, 4, 12, 16, 52, k);
    copyMirrored(ctx, 12, 20, 4, 12, 28, 52, k);
    copyMirrored(ctx, 44, 16, 4, 4, 36, 48, k);
    copyMirrored(ctx, 48, 16, 4, 4, 40, 48, k);
    copyMirrored(ctx, 40, 20, 4, 12, 40, 52, k);
    copyMirrored(ctx, 44, 20, 4, 12, 36, 52, k);
    copyMirrored(ctx, 48, 20, 4, 12, 32, 52, k);
    copyMirrored(ctx, 52, 20, 4, 12, 44, 52, k);
    // Many legacy skins fill the hat layer with an opaque colour; hide it then.
    const hat = ctx.getImageData(32 * k, 0, 32 * k, 16 * k).data;
    let opaque = true;
    for (let i = 3; i < hat.length; i += 4) if (hat[i] < 255) { opaque = false; break; }
    if (opaque) ctx.clearRect(32 * k, 0, 32 * k, 16 * k);
  }
  return c;
}

export function detectSlim(canvas) {
  const k = canvas.width / 64;
  const ctx = canvas.getContext('2d');
  const d = ctx.getImageData(54 * k, 20 * k, 2 * k, 12 * k).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
  return true;
}

// Validates an uploaded file and returns { dataUrl, slim }.
export async function loadSkinFile(file) {
  if (!file) throw new Error('No file selected.');
  if (file.size > MAX_SKIN_BYTES) throw new Error('That file is too large (max 400 KB).');
  if (file.type && !/^image\/(png|x-png)$/.test(file.type)) throw new Error('Please choose a PNG skin file.');
  const src = await readFileAsDataURL(file);
  const img = await loadImage(src);
  const canvas = normalizeSkinImage(img);
  const slim = detectSlim(canvas);
  return { dataUrl: canvas.toDataURL('image/png'), slim };
}

// Loads a stored/remote skin data URL into a canvas. Falls back to a default.
export async function skinCanvasFromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    return createDefaultSkinCanvas('explorer');
  }
  try {
    const img = await loadImage(dataUrl);
    return normalizeSkinImage(img);
  } catch (e) {
    return createDefaultSkinCanvas('explorer');
  }
}

export function skinTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// Model

// Box with Minecraft skin UVs. Units are skin pixels; (ox,oy,oz) is the box min corner.
function skinBox(w, h, d, u, v, ox, oy, oz, inflate = 0) {
  const x0 = ox - inflate, x1 = ox + w + inflate;
  const y0 = oy - inflate, y1 = oy + h + inflate;
  const z0 = oz - inflate, z1 = oz + d + inflate;
  const pos = [], nor = [], uv = [], idx = [];
  const r = faceRects(u, v, w, h, d);
  const face = (rect, tl, tr, bl, br, n) => {
    const [rx, ry, rw, rh] = rect;
    const base = pos.length / 3;
    pos.push(...bl, ...br, ...tr, ...tl);
    for (let i = 0; i < 4; i++) nor.push(...n);
    const U0 = rx / 64, U1 = (rx + rw) / 64, V0 = 1 - (ry + rh) / 64, V1 = 1 - ry / 64;
    uv.push(U0, V0, U1, V0, U1, V1, U0, V1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  face(r.front, [x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [x1, y0, z1], [0, 0, 1]);
  face(r.back, [x1, y1, z0], [x0, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1]);
  face(r.right, [x0, y1, z0], [x0, y1, z1], [x0, y0, z0], [x0, y0, z1], [-1, 0, 0]);
  face(r.left, [x1, y1, z1], [x1, y1, z0], [x1, y0, z1], [x1, y0, z0], [1, 0, 0]);
  face(r.top, [x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0]);
  // Bottom: the top edge of the texture rect touches the front.
  face(r.bottom, [x0, y0, z1], [x1, y0, z1], [x0, y0, z0], [x1, y0, z0], [0, -1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export const MODEL_SCALE = 0.9375 / 16; // skin pixel -> blocks

export class PlayerModel {
  constructor(canvas, slim = false, opts = {}) {
    this.group = new THREE.Group();
    this.root = new THREE.Group();
    this.root.scale.setScalar(MODEL_SCALE);
    this.group.add(this.root);
    this.texture = skinTexture(canvas);
    this.baseMat = createEntityMaterial({ map: this.texture });
    this.overlayMat = createEntityMaterial({ map: this.texture, alphaTest: 0.5, side: THREE.DoubleSide });
    this.slim = slim;
    this.castShadow = opts.castShadow !== false;
    this.parts = {};
    this._build();
    this.walkPhase = 0;
    this.swing = 0;
  }

  _part(name, pivot, boxes) {
    const g = new THREE.Group();
    g.position.set(pivot[0], pivot[1], pivot[2]);
    for (const b of boxes) {
      const mesh = new THREE.Mesh(b.geo, b.overlay ? this.overlayMat : this.baseMat);
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    this.root.add(g);
    this.parts[name] = g;
    return g;
  }

  _build() {
    for (const k of Object.keys(this.parts)) {
      this.root.remove(this.parts[k]);
      this.parts[k].traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.parts = {};
    const aw = this.slim ? 3 : 4;
    // Head: pivot at the neck.
    this._part('head', [0, 24, 0], [
      { geo: skinBox(8, 8, 8, 0, 0, -4, 0, -4) },
      { geo: skinBox(8, 8, 8, 32, 0, -4, 0, -4, 0.5), overlay: true },
    ]);
    this._part('body', [0, 12, 0], [
      { geo: skinBox(8, 12, 4, 16, 16, -4, 0, -2) },
      { geo: skinBox(8, 12, 4, 16, 32, -4, 0, -2, 0.25), overlay: true },
    ]);
    // Character's right is -X when facing +Z.
    this._part('rightArm', [-4 - aw / 2, 22, 0], [
      { geo: skinBox(aw, 12, 4, 40, 16, -aw / 2, -10, -2) },
      { geo: skinBox(aw, 12, 4, 40, 32, -aw / 2, -10, -2, 0.25), overlay: true },
    ]);
    this._part('leftArm', [4 + aw / 2, 22, 0], [
      { geo: skinBox(aw, 12, 4, 32, 48, -aw / 2, -10, -2) },
      { geo: skinBox(aw, 12, 4, 48, 48, -aw / 2, -10, -2, 0.25), overlay: true },
    ]);
    this._part('rightLeg', [-2, 12, 0], [
      { geo: skinBox(4, 12, 4, 0, 16, -2, -12, -2) },
      { geo: skinBox(4, 12, 4, 0, 32, -2, -12, -2, 0.25), overlay: true },
    ]);
    this._part('leftLeg', [2, 12, 0], [
      { geo: skinBox(4, 12, 4, 16, 48, -2, -12, -2) },
      { geo: skinBox(4, 12, 4, 0, 48, -2, -12, -2, 0.25), overlay: true },
    ]);
  }

  setSkin(canvas, slim) {
    const old = this.texture;
    this.texture = skinTexture(canvas);
    this.baseMat.map = this.texture;
    this.overlayMat.map = this.texture;
    this.baseMat.needsUpdate = true;
    this.overlayMat.needsUpdate = true;
    old.dispose();
    if (slim !== this.slim) {
      this.slim = slim;
      this._build();
    }
  }

  setLight(sky, block) {
    for (const m of [this.baseMat, this.overlayMat]) {
      m.userData.lightUniforms.uEntitySky.value = sky / 15;
      m.userData.lightUniforms.uEntityBlock.value = block / 15;
    }
  }

  // state: { speed (blocks/s), dt, pitch, headYaw (relative), sneaking, swinging (0..1), flying }
  animate(state) {
    const p = this.parts;
    const speed = Math.min(state.speed || 0, 8);
    this.walkPhase += (state.dt || 0) * speed * 2.2;
    const amp = Math.min(1, speed / 4.3) * (state.flying ? 0.25 : 0.9);
    const s = Math.sin(this.walkPhase) * amp;
    p.rightLeg.rotation.x = s;
    p.leftLeg.rotation.x = -s;
    p.rightArm.rotation.x = -s * 0.85;
    p.leftArm.rotation.x = s * 0.85;
    p.rightArm.rotation.z = 0.05;
    p.leftArm.rotation.z = -0.05;
    p.head.rotation.x = -(state.pitch || 0);
    p.head.rotation.y = state.headYaw || 0;

    const sneak = state.sneaking ? 1 : 0;
    p.body.rotation.x = 0.45 * sneak;
    p.body.position.z = 0;
    p.head.position.set(0, 24 - sneak * 1.2, sneak * 4.2);
    p.rightArm.position.set(p.rightArm.position.x, 22 - sneak * 1.5, sneak * 4.2);
    p.leftArm.position.set(p.leftArm.position.x, 22 - sneak * 1.5, sneak * 4.2);
    p.rightLeg.position.z = -sneak * 0.5;
    p.leftLeg.position.z = -sneak * 0.5;
    if (sneak) {
      p.rightArm.rotation.x += 0.4;
      p.leftArm.rotation.x += 0.4;
    }

    // Arm swing (mining / placing).
    if (state.swinging > 0) {
      const t = state.swinging;
      const k = Math.sin(t * Math.PI);
      p.rightArm.rotation.x = -1.2 * k - 0.3 * Math.sin(t * Math.PI * 2);
      p.rightArm.rotation.y = -0.35 * k;
    } else {
      p.rightArm.rotation.y = 0;
    }
    // Idle breathing.
    const breathe = Math.sin(performance.now() / 900) * 0.03;
    p.rightArm.rotation.z += breathe;
    p.leftArm.rotation.z -= breathe;
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.baseMat.dispose();
    this.overlayMat.dispose();
    this.texture.dispose();
  }
}

// First-person arm (right arm only, shown at the bottom right of the screen).
export class FirstPersonArm {
  constructor(canvas, slim) {
    this.group = new THREE.Group();
    this.texture = skinTexture(canvas);
    this.baseMat = new THREE.MeshLambertMaterial({ map: this.texture });
    this.overlayMat = new THREE.MeshLambertMaterial({ map: this.texture, alphaTest: 0.5, side: THREE.DoubleSide });
    this.slim = slim;
    this.armGroup = new THREE.Group();
    this.group.add(this.armGroup);
    this._build();
  }

  _build() {
    this.armGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.armGroup.clear();
    const aw = this.slim ? 3 : 4;
    const base = new THREE.Mesh(skinBox(aw, 12, 4, 40, 16, -aw / 2, -12, -2), this.baseMat);
    const over = new THREE.Mesh(skinBox(aw, 12, 4, 40, 32, -aw / 2, -12, -2, 0.25), this.overlayMat);
    this.armGroup.add(base, over);
    this.armGroup.scale.setScalar(0.055);
  }

  setSkin(canvas, slim) {
    const old = this.texture;
    this.texture = skinTexture(canvas);
    this.baseMat.map = this.texture;
    this.overlayMat.map = this.texture;
    this.baseMat.needsUpdate = true;
    this.overlayMat.needsUpdate = true;
    old.dispose();
    if (slim !== this.slim) { this.slim = slim; this._build(); }
  }

  dispose() {
    this.armGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.baseMat.dispose();
    this.overlayMat.dispose();
    this.texture.dispose();
  }
}

// Name tag sprite.
export function createNameTag(name) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '600 28px system-ui, sans-serif';
  ctx.font = font;
  const text = String(name).slice(0, 24);
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = w; c.height = 44;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, w, 44);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, 23);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const h = 0.3;
  sprite.scale.set(h * (w / 44), h, 1);
  sprite.renderOrder = 10;
  return sprite;
}
