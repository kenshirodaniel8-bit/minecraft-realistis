// Blocky player avatars, procedural sword models and hats.

import * as THREE from 'three';
import { glowSprite } from './labels.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SWORD_BY_ID } from '#shared/weapons.js';
import { COSMETIC_BY_ID } from '#shared/lucky.js';
import { COSTUME_BY_ID, costumeWithPower } from '#shared/costumes.js';

export const ANIM = { idle: 0, walk: 1, run: 2, air: 3, swim: 4, dodge: 5 };

const mats = new Map();
function mat(color, opts = {}) {
  const key = `${color}|${opts.emissive || 0}|${opts.ei || 1}|${opts.rough ?? 0.6}|${opts.metal || 0}|${opts.opacity || 1}`;
  if (mats.has(key)) return mats.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, roughness: opts.rough ?? 0.6, metalness: opts.metal || 0,
    emissive: opts.emissive || 0, emissiveIntensity: opts.ei || 1,
    transparent: (opts.opacity || 1) < 1, opacity: opts.opacity || 1,
  });
  mats.set(key, m);
  return m;
}

const RBOX = new RoundedBoxGeometry(1, 1, 1, 3, 0.12);
const BOX = new THREE.BoxGeometry(1, 1, 1);

function part(geo, material, sx, sy, sz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

let faceTex = null;
function faceTexture() {
  if (faceTex) return faceTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.ellipse(42, 54, 9, 13, 0, 0, Math.PI * 2);
  ctx.ellipse(86, 54, 9, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(45, 49, 3.5, 0, Math.PI * 2);
  ctx.arc(89, 49, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(64, 74, 20, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();
  faceTex = new THREE.CanvasTexture(c);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  return faceTex;
}

// ------------------------------------------------------------------ swords

export function buildSword(id) {
  const def = SWORD_BY_ID[id] || SWORD_BY_ID.wooden;
  const c = def.colors;
  const L = def.length;
  const g = new THREE.Group();
  const glow = c.glow ? { emissive: c.glow, ei: 0.8 } : {};
  const bladeMat = mat(c.blade, { rough: def.tier >= 3 ? 0.25 : 0.7, metal: def.tier >= 3 && def.tier <= 4 ? 0.6 : 0.1, ...glow });
  const edgeMat = mat(c.edge, { rough: 0.2, metal: 0.3, ...(c.glow ? { emissive: c.glow, ei: 1.2 } : {}) });
  const grip = part(new THREE.CylinderGeometry(0.11, 0.11, 0.7, 8), mat(c.grip), 1, 1, 1, 0, 0, 0);
  const pommel = part(new THREE.SphereGeometry(0.16, 10, 8), mat(c.guard, { metal: 0.4, rough: 0.4 }), 1, 1, 1, 0, -0.42, 0);
  const guard = part(BOX, mat(c.guard, { metal: 0.4, rough: 0.4 }), def.tier >= 9 ? 1.1 : 0.85, 0.16, 0.26, 0, 0.38, 0);
  g.add(grip, pommel, guard);
  const w = 0.2 + def.tier * 0.012;
  if (id === 'crystal' || id === 'celestial') {
    for (let i = 0; i < 4; i++) {
      const s = 1 - i * 0.14;
      const shard = part(new THREE.OctahedronGeometry(1, 0), bladeMat, w * 1.3 * s, L * 0.16, 0.08, 0, 0.5 + L * 0.13 + i * L * 0.2, 0);
      g.add(shard);
    }
  } else if (id === 'candy') {
    // red and white stripes with a candy-cane hook at the top
    const n = 7;
    for (let i = 0; i < n; i++) g.add(part(BOX, i % 2 ? edgeMat : bladeMat, w * 1.5, (L / n) * 1.02, 0.16, 0, 0.45 + ((i + 0.5) * L) / n, 0));
    const hook = part(new THREE.TorusGeometry(0.3, w * 0.75, 6, 12, Math.PI), edgeMat, 1, 1, 1, -0.3, 0.45 + L, 0);
    g.add(hook);
  } else if (id === 'rainbow') {
    const cols = [0xff4a5a, 0xff9a2a, 0xffe23a, 0x5fd35a, 0x3fa6ff, 0xa86bff];
    cols.forEach((c, i) => g.add(part(BOX, mat(c, { emissive: c, ei: 0.35, rough: 0.3 }), w * 1.6, (L / cols.length) * 1.02, 0.1, 0, 0.45 + ((i + 0.5) * L) / cols.length, 0)));
    const tip = part(new THREE.ConeGeometry(w * 0.8, 0.45, 4), mat(0xffffff, { emissive: 0xffffff, ei: 0.6 }), 1, 1, 0.25, 0, 0.45 + L + 0.2, 0);
    tip.rotation.y = Math.PI / 4;
    g.add(tip);
  } else {
    const blade = part(BOX, id === 'bubble' ? mat(c.blade, { opacity: 0.7, rough: 0.1, emissive: c.glow, ei: 0.4 }) : bladeMat, w * 1.6, L, 0.08, 0, 0.45 + L / 2, 0);
    const edge = part(BOX, edgeMat, w * 0.5, L * 0.96, 0.1, 0, 0.45 + L / 2, 0);
    const tip = part(new THREE.ConeGeometry(w * 0.8, 0.45, 4), bladeMat, 1, 1, 0.2, 0, 0.45 + L + 0.2, 0);
    tip.rotation.y = Math.PI / 4;
    g.add(blade, edge, tip);
    if (id === 'flame' || id === 'dragon') {
      for (let i = 0; i < 4; i++) {
        const fin = part(new THREE.ConeGeometry(0.12, 0.45, 4), edgeMat, 1, 1, 0.4, (i % 2 ? 1 : -1) * w * 0.9, 0.7 + i * L * 0.22, 0);
        fin.rotation.z = (i % 2 ? -1 : 1) * 0.9;
        g.add(fin);
      }
    }
    if (id === 'bubble') {
      const bub = mat(0xe8fbff, { opacity: 0.55, rough: 0.05, emissive: 0x8fe8ff, ei: 0.5 });
      [[0.22, 0.25, 0.16], [-0.2, 0.45, 0.12], [0.18, 0.68, 0.1], [-0.16, 0.85, 0.14], [0.05, 1.05, 0.2]].forEach(([x, f, r]) => {
        g.add(part(new THREE.SphereGeometry(1, 10, 8), bub, r, r, r, x, 0.45 + L * f, 0.05));
      });
    }
    if (id === 'frost') {
      const ice = mat(0xe8ffff, { emissive: 0x9fe8ff, ei: 0.6, rough: 0.1 });
      for (let i = 0; i < 5; i++) {
        const side = i % 2 ? 1 : -1;
        const shard = part(new THREE.OctahedronGeometry(1, 0), ice, 0.12, 0.3, 0.08, side * w * 0.85, 0.75 + i * L * 0.17, 0);
        shard.rotation.z = side * -0.6;
        g.add(shard);
      }
    }
    if (id === 'lucky') {
      // a four-leaf clover on the guard
      const leaf = mat(0x3fae44, { rough: 0.5, emissive: 0x1a5a1a, ei: 0.4 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        g.add(part(new THREE.SphereGeometry(1, 10, 8), leaf, 0.15, 0.15, 0.06, Math.cos(a) * 0.15, 0.38 + Math.sin(a) * 0.15, 0.16));
      }
    }
    if (id === 'galaxy') {
      const star = mat(0xfff7d8, { emissive: 0xfff27a, ei: 1.4 });
      [[0.06, 0.15], [-0.07, 0.3], [0.05, 0.47], [-0.04, 0.62], [0.07, 0.78], [-0.05, 0.92]].forEach(([x, f], i) => {
        const st = part(new THREE.OctahedronGeometry(1, 0), star, 0.07 + (i % 2) * 0.03, 0.07 + (i % 2) * 0.03, 0.05, x, 0.45 + L * f, 0.06);
        g.add(st);
      });
      const ring = part(new THREE.TorusGeometry(0.42, 0.05, 6, 20), mat(c.guard, { emissive: c.guard, ei: 0.6 }), 1, 1, 1, 0, 0.38, 0);
      g.add(ring);
    }
    if (id === 'thunder') {
      const bolt = part(BOX, mat(0x3a3f8f, { emissive: 0x3a3f8f }), 0.1, L * 0.7, 0.11, 0, 0.45 + L * 0.45, 0);
      bolt.rotation.z = 0.12;
      g.add(bolt);
    }
  }
  if (id === 'celestial') {
    const star = part(new THREE.OctahedronGeometry(0.28, 0), mat(0xfff27a, { emissive: 0xfff27a, ei: 1.5 }), 1, 1, 0.5, 0, -0.42, 0);
    g.add(star);
  }
  if (c.glow) {
    const glow = glowSprite(c.glow, 2.2, 0.45);
    glow.position.y = 0.5 + L / 2;
    g.add(glow);
  }
  g.userData.length = L;
  return g;
}

// ------------------------------------------------------------------ hats

export function buildHat(id) {
  const def = COSMETIC_BY_ID[id];
  if (!def) return null;
  const g = new THREE.Group();
  const m = mat(def.color, { rough: 0.5 });
  switch (id) {
    case 'party_hat': {
      const cone = part(new THREE.ConeGeometry(0.45, 1.1, 14), m, 1, 1, 1, 0, 0.55, 0);
      const ball = part(new THREE.SphereGeometry(0.15, 8, 6), mat(0xffe14a), 1, 1, 1, 0, 1.12, 0);
      g.add(cone, ball);
      break;
    }
    case 'lucky_crown': {
      const band = part(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 16, 1, true), mat(0xffd23a, { metal: 0.6, rough: 0.3, emissive: 0x3a2a00 }), 1, 1, 1, 0, 0.18, 0);
      band.material.side = THREE.DoubleSide;
      g.add(band);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const spike = part(new THREE.ConeGeometry(0.12, 0.35, 4), band.material, 1, 1, 1, Math.cos(a) * 0.52, 0.5, Math.sin(a) * 0.52);
        g.add(spike);
      }
      g.add(part(new THREE.OctahedronGeometry(0.12), mat(0x4fd85a, { emissive: 0x2a8a2a }), 1, 1, 1, 0, 0.2, 0.56));
      break;
    }
    case 'flower_crown': {
      g.add(part(new THREE.TorusGeometry(0.55, 0.07, 6, 18), mat(0x4fae44), 1, 1, 1, 0, 0.1, 0));
      g.children[0].rotation.x = Math.PI / 2;
      const cols = [0xff7ab8, 0xffe14a, 0xffffff, 0xb48cff];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.add(part(new THREE.SphereGeometry(0.12, 8, 6), mat(cols[k % 4]), 1, 0.7, 1, Math.cos(a) * 0.55, 0.15, Math.sin(a) * 0.55));
      }
      break;
    }
    case 'monster_ears':
      for (const s of [-1, 1]) {
        const ear = part(new THREE.ConeGeometry(0.22, 0.6, 4), m, 1, 1, 0.45, s * 0.38, 0.3, 0);
        ear.rotation.z = -s * 0.3;
        g.add(ear);
      }
      break;
    case 'halo': {
      const t = part(new THREE.TorusGeometry(0.45, 0.06, 8, 24), mat(0xfff7a8, { emissive: 0xfff27a, ei: 1.5 }), 1, 1, 1, 0, 0.7, 0);
      t.rotation.x = Math.PI / 2;
      g.add(t);
      break;
    }
    case 'top_hat':
      g.add(part(new THREE.CylinderGeometry(0.7, 0.7, 0.08, 18), m, 1, 1, 1, 0, 0.04, 0));
      g.add(part(new THREE.CylinderGeometry(0.42, 0.42, 0.8, 18), m, 1, 1, 1, 0, 0.45, 0));
      g.add(part(new THREE.CylinderGeometry(0.43, 0.43, 0.12, 18), mat(0xd8384a), 1, 1, 1, 0, 0.15, 0));
      break;
    case 'propeller': {
      g.add(part(new THREE.SphereGeometry(0.58, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m, 1, 0.6, 1, 0, 0, 0));
      const prop = new THREE.Group();
      prop.position.y = 0.45;
      prop.add(part(BOX, mat(0xffe14a), 1.2, 0.04, 0.16), part(BOX, mat(0xff5a7a), 0.16, 0.04, 1.2));
      g.add(prop);
      g.userData.spin = prop;
      break;
    }
    case 'horns':
      for (const s of [-1, 1]) {
        const h = part(new THREE.ConeGeometry(0.14, 0.6, 8), m, 1, 1, 1, s * 0.35, 0.3, 0.05);
        h.rotation.z = -s * 0.5;
        g.add(h);
      }
      break;
    default:
      break;
  }
  return g;
}


// ------------------------------------------------------------------ costumes

// At night the Black Spy's bone lines and LEDs light up (main.js sets this).
let nightGlow = false;
export function setNightGlow(on) {
  nightGlow = !!on;
}

let logoTex = null;
function logoTexture() {
  if (logoTex) return logoTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  // a round badge with a little monster face and the game's initials
  ctx.fillStyle = '#5ff3ff';
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#101016';
  ctx.beginPath();
  ctx.arc(128, 128, 106, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5ff3ff';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(128 + s * 70, 70);
    ctx.lineTo(128 + s * 40, 40);
    ctx.lineTo(128 + s * 30, 84);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(128 + s * 34, 104, 13, 17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#5ff3ff';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(128, 124, 30, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  ctx.font = '900 46px "Trebuchet MS", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('S·A·M', 128, 208);
  logoTex = new THREE.CanvasTexture(c);
  logoTex.colorSpace = THREE.SRGBColorSpace;
  return logoTex;
}

let boltTex = null;
function boltTexture() {
  if (boltTex) return boltTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a3a8a';
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff27a';
  ctx.beginPath();
  ctx.moveTo(72, 10);
  ctx.lineTo(34, 70);
  ctx.lineTo(60, 70);
  ctx.lineTo(50, 118);
  ctx.lineTo(94, 52);
  ctx.lineTo(68, 52);
  ctx.closePath();
  ctx.fill();
  boltTex = new THREE.CanvasTexture(c);
  boltTex.colorSpace = THREE.SRGBColorSpace;
  return boltTex;
}

function decal(tex, w, h, glow = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
    map: tex, transparent: true, roughness: 0.5, emissive: glow ? 0xffffff : 0, emissiveMap: glow ? tex : null, emissiveIntensity: glow,
  }));
  return m;
}

const glowMats = new Map();
function glowMat(color) {
  if (!glowMats.has(color)) glowMats.set(color, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  return glowMats.get(color);
}

// Builds the costume pieces onto the avatar's limbs, so they move with it.
function dressUp(h, c) {
  const col = c.colors;
  const look = c.look;
  const parts = [];
  const glows = [];   // lines that only light up at night
  const leds = [];
  const add = (parent, mesh, list = parts) => {
    parent.add(mesh);
    list.push(mesh);
    if (list !== parts) parts.push(mesh);
    return mesh;
  };
  const jacket = mat(col.jacket, { rough: c.style === 'knight' ? 0.25 : 0.55, metal: c.style === 'knight' ? 0.5 : 0 });
  const pants = mat(col.pants, { rough: 0.7 });
  const shoes = mat(col.shoes, { rough: 0.4 });
  const gloves = mat(col.gloves, { rough: 0.5 });
  const trim = mat(col.trim, { rough: 0.5 });
  const hatMat = mat(col.hat, { rough: 0.5 });
  // jacket, sleeves, gloves, trousers, shoes
  add(h.torso, part(RBOX, jacket, 1.9, 1.88, 1.0, 0, 0.9, 0));
  add(h.torso, part(RBOX, trim, 1.92, 0.22, 1.02, 0, 0.12, 0)); // belt / hem
  for (const arm of h.arms) {
    add(arm, part(RBOX, jacket, 0.88, 1.15, 0.88, 0, -0.42, 0));
    add(arm, part(RBOX, gloves, 0.86, 0.62, 0.86, 0, -1.36, 0));
  }
  for (const leg of h.legs) {
    add(leg, part(RBOX, pants, 0.92, 1.5, 0.92, 0, -0.74, 0));
    add(leg, part(RBOX, shoes, 0.98, 0.44, 1.14, 0, -1.6, 0.09));
  }
  // the style's own pieces
  if (look.logo) {
    const front = add(h.torso, decal(logoTexture(), 0.62, 0.62, 0.25));
    front.position.set(0.44, 1.32, 0.506);
    const back = add(h.torso, decal(logoTexture(), 1.3, 1.3, 0.25));
    back.position.set(0, 1.0, -0.506);
    back.rotation.y = Math.PI;
    add(h.torso, part(RBOX, trim, 1.2, 0.2, 1.04, 0, 1.78, 0)); // collar
  }
  if (look.hat === 'fedora') {
    const hat = new THREE.Group();
    hat.position.y = 1.12;
    hat.add(part(new THREE.CylinderGeometry(0.92, 0.92, 0.07, 22), hatMat, 1, 1, 1, 0, 0.04, 0));
    hat.add(part(new THREE.CylinderGeometry(0.5, 0.6, 0.55, 18), hatMat, 1, 1, 1, 0, 0.32, 0));
    hat.add(part(new THREE.CylinderGeometry(0.61, 0.61, 0.13, 18), trim, 1, 1, 1, 0, 0.13, 0));
    hat.rotation.x = -0.08;
    add(h.head, hat);
  }
  if (look.glasses) {
    add(h.head, part(RBOX, mat(0x050507, { rough: 0.15, metal: 0.4 }), 1.02, 0.24, 0.08, 0, 0.7, 0.585));
    add(h.head, part(BOX, mat(0x5ff3ff, { emissive: 0x2a8a9a, ei: 0.6, rough: 0.1 }), 0.3, 0.04, 0.02, 0.22, 0.76, 0.63));
  }
  if (look.hat === 'headband') {
    add(h.head, part(RBOX, hatMat, 1.22, 0.2, 1.2, 0, 0.92, 0));
    for (const s of [-1, 1]) {
      const tail = add(h.head, part(BOX, hatMat, 0.14, 0.62, 0.06, s * 0.12, 0.62, -0.68));
      tail.rotation.z = s * 0.35;
      tail.userData.flap = s;
    }
  }
  if (look.mask) add(h.head, part(RBOX, mat(0x1a0c0e), 1.2, 0.46, 1.18, 0, 0.3, 0.01));
  if (look.scarf) {
    add(h.torso, part(RBOX, mat(col.glow, { emissive: 0xff4a10, ei: 0.4 }), 1.3, 0.3, 1.1, 0, 1.75, 0));
    const end = add(h.torso, part(BOX, mat(col.glow, { emissive: 0xff4a10, ei: 0.4 }), 0.35, 1.2, 0.08, 0.35, 1.2, -0.6));
    end.userData.flap = 1;
  }
  if (look.hat === 'helmet') {
    add(h.head, part(RBOX, mat(col.hat, { rough: 0.2, metal: 0.6 }), 1.32, 1.28, 1.3, 0, 0.6, 0));
    add(h.head, part(BOX, mat(0x0a1a2a), 0.95, 0.14, 0.06, 0, 0.7, 0.66));
    const plume = add(h.head, part(RBOX, mat(col.trim, { emissive: 0x1a4a8a, ei: 0.4 }), 0.2, 0.6, 1.2, 0, 1.45, -0.1));
    plume.rotation.x = 0.2;
  }
  if (look.armor) {
    add(h.torso, part(RBOX, mat(col.armor ?? 0xe8f6ff, { rough: 0.15, metal: 0.7 }), 1.7, 1.1, 1.08, 0, 1.15, 0));
    for (const arm of h.arms) add(arm, part(new THREE.SphereGeometry(0.62, 12, 8), mat(col.trim, { rough: 0.2, metal: 0.6 }), 1, 0.7, 1, 0, 0.05, 0));
  }
  if (look.hat === 'mask') add(h.head, part(RBOX, hatMat, 1.2, 0.26, 1.18, 0, 0.72, 0.01));
  // guard uniforms (shared/guards.js)
  if (look.hat === 'cap') {
    add(h.head, part(RBOX, hatMat, 1.22, 0.36, 1.22, 0, 1.12, 0));
    add(h.head, part(BOX, hatMat, 0.9, 0.06, 0.5, 0, 1.0, 0.72));
    add(h.head, part(BOX, mat(col.trim, { metal: 0.5, rough: 0.3 }), 0.22, 0.2, 0.04, 0, 1.15, 0.62));
  }
  if (look.badge) add(h.torso, part(BOX, mat(col.trim, { metal: 0.6, rough: 0.25, emissive: col.trim, ei: 0.15 }), 0.28, 0.32, 0.05, -0.45, 1.35, 0.52));
  if (look.vest) add(h.torso, part(RBOX, mat(look.vest, { rough: 0.8 }), 1.96, 1.3, 1.06, 0, 1.0, 0));
  if (look.visor) add(h.head, part(BOX, mat(look.visor, { emissive: look.visor, ei: 0.9, rough: 0.2 }), 1.0, 0.18, 0.06, 0, 0.7, 0.67));
  if (look.bolt) {
    const b = add(h.torso, decal(boltTexture(), 0.9, 0.9, 0.3));
    b.position.set(0, 1.1, 0.506);
  }
  if (look.cape) {
    const cape = new THREE.Group();
    cape.position.set(0, 1.75, -0.52);
    const legend = c.style === 'legend';
    cape.add(part(BOX, mat(typeof look.cape === 'number' ? look.cape : 0xd8384a, { rough: 0.8 }), legend ? 2.2 : 1.9, legend ? 3.4 : 2.7, 0.08, 0, legend ? -1.7 : -1.35, 0));
    if (legend) {
      // a glowing hem and the power's sign on the back
      const hem = part(BOX, glowMat(col.glow), 2.24, 0.14, 0.1, 0, -3.36, 0);
      hem.castShadow = false;
      cape.add(hem);
      const sign = part(new THREE.OctahedronGeometry(0.45), glowMat(col.glow), 1, 1.4, 0.2, 0, -1.4, -0.08);
      sign.castShadow = false;
      cape.add(sign);
    }
    cape.userData.cape = true;
    add(h.torso, cape);
  }
  if (look.hat === 'bunny') {
    add(h.head, part(RBOX, hatMat, 1.32, 1.3, 1.0, 0, 0.66, -0.2)); // the hood
    for (const s of [-1, 1]) {
      const ear = add(h.head, part(RBOX, hatMat, 0.3, 1.25, 0.18, s * 0.32, 1.75, -0.2));
      ear.rotation.z = -s * 0.15;
      ear.userData.ear = s;
      add(ear, part(RBOX, mat(0xffffff), 0.6, 0.8, 0.5, 0, 0.0, 0.3));
    }
  }
  if (look.pompom) add(h.torso, part(new THREE.SphereGeometry(0.32, 12, 10), mat(0xffffff, { rough: 0.9 }), 1, 1, 1, 0, 0.15, -0.55));

  // Legend Master: a crown, big pauldrons, a glowing gem, glowing lines that
  // are always on (in the colour of the chosen power) and orbs circling you
  const pulses = []; // glow materials that breathe
  const orbs = [];
  if (look.hat === 'crown') {
    const gold = mat(col.hat, { rough: 0.2, metal: 0.85, emissive: col.hat, ei: 0.15 });
    const crown = new THREE.Group();
    crown.position.y = 1.12;
    crown.add(part(new THREE.CylinderGeometry(0.66, 0.62, 0.32, 18, 1, true), gold, 1, 1, 1, 0, 0.12, 0));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const tall = i === 0 ? 0.75 : 0.45;
      const spike = part(new THREE.ConeGeometry(0.13, tall, 6), gold, 1, 1, 1, Math.sin(a) * 0.62, 0.28 + tall / 2, Math.cos(a) * 0.62);
      crown.add(spike);
      crown.add(part(new THREE.OctahedronGeometry(0.1), glowMat(col.glow), 1, 1.3, 1, Math.sin(a) * 0.66, 0.13, Math.cos(a) * 0.66));
    }
    add(h.head, crown);
  }
  if (c.style === 'legend') {
    const metal = mat(col.armor ?? col.trim, { rough: 0.18, metal: 0.8 });
    for (const [i, arm] of h.arms.entries()) {
      const s = i === 0 ? -1 : 1;
      const pad = add(arm, part(RBOX, metal, 1.15, 0.5, 1.15, s * 0.12, 0.25, 0));
      pad.rotation.z = s * -0.35;
      add(arm, part(new THREE.ConeGeometry(0.16, 0.6, 6), metal, 1, 1, 1, s * 0.35, 0.65, 0));
    }
    add(h.torso, part(RBOX, metal, 1.96, 0.28, 1.08, 0, 0.12, 0)); // belt
    for (const leg of h.legs) add(leg, part(RBOX, metal, 0.98, 0.5, 0.98, 0, -1.25, 0.02)); // greaves
    const gem = add(h.torso, part(new THREE.OctahedronGeometry(0.26), glowMat(col.glow), 1, 1.3, 0.6, 0, 1.25, 0.62));
    gem.castShadow = false;
    gem.userData.pulse = true;
  }
  if (look.glowLines) {
    const g = new THREE.MeshBasicMaterial({ color: col.glow, toneMapped: false, transparent: true, opacity: 1 });
    const line = (parent, w, hh, x, y, z) => {
      const m = add(parent, part(BOX, g, w, hh, 0.05, x, y, z));
      m.castShadow = false;
      return m;
    };
    line(h.torso, 0.1, 1.1, 0.42, 0.75, 0.56);
    line(h.torso, 0.1, 1.1, -0.42, 0.75, 0.56);
    line(h.torso, 1.5, 0.08, 0, 1.75, 0.55);
    for (const arm of h.arms) {
      line(arm, 0.1, 0.62, 0, -1.3, 0.45);
      line(arm, 0.62, 0.08, 0, -0.95, 0.45);
    }
    for (const leg of h.legs) {
      line(leg, 0.1, 0.9, 0, -0.62, 0.47);
      line(leg, 0.7, 0.08, 0, -1.55, 0.6);
    }
    pulses.push(g);
    // three glowing orbs circling the body
    for (let i = 0; i < 3; i++) {
      const orb = add(h.body, part(new THREE.IcosahedronGeometry(0.22, 1), glowMat(col.glow), 1, 1, 1, 0, 3, 0));
      orb.castShadow = false;
      orb.userData.orbit = i;
      orbs.push(orb);
    }
  }

  // Black Spy at night: glowing stickman lines along the bones + LEDs
  if (look.nightLines) {
    const g = glowMat(col.glow);
    const line = (parent, w, hh, x, y, z) => add(parent, part(BOX, g, w, hh, 0.04, x, y, z), glows);
    line(h.torso, 0.09, 1.55, 0, 0.92, 0.512);   // spine
    line(h.torso, 1.5, 0.09, 0, 1.62, 0.512);    // shoulders
    line(h.torso, 0.85, 0.09, 0, 0.2, 0.512);    // hips
    for (const arm of h.arms) {
      line(arm, 0.09, 0.85, 0, -0.42, 0.448);    // upper arm
      line(arm, 0.09, 0.62, 0, -1.25, 0.438);    // forearm
    }
    for (const leg of h.legs) {
      line(leg, 0.09, 0.75, 0, -0.42, 0.468);    // thigh
      line(leg, 0.09, 0.7, 0, -1.18, 0.468);     // shin
    }
    const ring = add(h.head, part(new THREE.TorusGeometry(0.5, 0.045, 6, 28), g, 1, 1, 1, 0, 0.58, 0.6), glows); // stickman head
    ring.castShadow = false;
    line(h.head, 0.09, 0.22, 0, -0.02, 0.5);     // neck
    for (const m of glows) m.castShadow = false;
  }
  if (look.leds) {
    const spots = [
      [h.torso, 0.8, 1.68, 0.52], [h.torso, -0.8, 1.68, 0.52], [h.torso, 0.6, 0.12, 0.53], [h.torso, -0.6, 0.12, 0.53],
      [h.torso, -0.45, 1.3, 0.52], [h.torso, 0, 1.8, -0.53], [h.arms[0], 0, -1.08, 0.45], [h.arms[1], 0, -1.08, 0.45],
      [h.legs[0], 0, -0.82, 0.48], [h.legs[1], 0, -0.82, 0.48], [h.legs[0], 0, -1.6, 0.67], [h.legs[1], 0, -1.6, 0.67],
    ];
    spots.forEach(([parent, x, y, z], i) => {
      const led = add(parent, part(new THREE.SphereGeometry(0.07, 8, 6), glowMat(col.led[i % col.led.length]), 1, 1, 1, x, y, z), leds);
      led.castShadow = false;
      led.userData.phase = i * 0.7;
    });
  }
  return { parts, glows, leds, pulses, orbs };
}

// ------------------------------------------------------------------ legend moves

// The Legend Master's 10 sword moves, one after the other (then again).
// p goes 0 -> 1 over the move; returns arm (lx, lz, rx, rz), torso (tx, ty)
// and body (by spin, y lift, z lunge, flip) poses.
export const LEGEND_MOVE_DUR = [0.3, 0.3, 0.38, 0.4, 0.4, 0.32, 0.46, 0.56, 0.52, 0.62];
export const LEGEND_MOVE_NAMES = ['Crescent Slash', 'Return Slash', 'Sky Splitter', 'Rising Dragon', 'Cyclone Cut', 'Piercing Light', 'Cross Strike', 'Meteor Drop', 'Whirlwind', 'Legend Break'];
const ease = (k) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
const ramp = (p, a, b) => Math.min(1, Math.max(0, (p - a) / (b - a)));

function legendMove(move, p) {
  switch (move) {
    case 0: { // Crescent Slash: wide from the right to the left
      const w = ramp(p, 0, 0.25);
      const k = ease(ramp(p, 0.25, 0.6));
      return { rx: -1.5 * w, rz: 1.3 * w - 2.4 * k, ty: 0.55 * w - 1.2 * k, lz: 0.6 };
    }
    case 1: { // Return Slash: backhand from the left to the right, with a hop
      const w = ramp(p, 0, 0.25);
      const k = ease(ramp(p, 0.25, 0.6));
      return { rx: -1.5 * w, rz: -1.1 * w + 2.6 * k, ty: -0.6 * w + 1.3 * k, y: Math.sin(p * Math.PI) * 0.4, lz: 0.5 };
    }
    case 2: { // Sky Splitter: two hands overhead, straight down
      const w = ramp(p, 0, 0.3);
      const k = ease(ramp(p, 0.3, 0.6));
      const x = -0.5 - 2.6 * w + 2.4 * k;
      return { rx: x, lx: x, rz: -0.25, lz: 0.25, tx: -0.2 * w + 0.5 * k, y: Math.sin(Math.min(1, p / 0.6) * Math.PI) * 0.7 };
    }
    case 3: { // Rising Dragon: from the ground up into the sky
      const w = ramp(p, 0, 0.25);
      const k = ease(ramp(p, 0.25, 0.65));
      return { rx: 0.6 * w - 3.7 * k, rz: -0.1, lx: 0.4, tx: 0.3 * w - 0.6 * k, y: k * 1.8 * (1 - ramp(p, 0.7, 1)) };
    }
    case 4: { // Cyclone Cut: a full spin with the blade out
      const k = ease(ramp(p, 0.1, 0.85));
      return { rx: -1.45, rz: 1.35, lx: -1.2, lz: -1.2, by: -k * Math.PI * 2 };
    }
    case 5: { // Piercing Light: pull back, then a lunging stab
      const w = ramp(p, 0, 0.35);
      const k = ease(ramp(p, 0.35, 0.55));
      const back = ramp(p, 0.75, 1);
      return { rx: 0.6 * w - 1.0 * k, rz: -0.08, lx: 0.5 * k, lz: 0.4, ty: 0.5 * w - 0.6 * k, tx: 0.3 * k, z: (1.6 * k) * (1 - back) - 0.3 * w * (1 - k) };
    }
    case 6: { // Cross Strike: two diagonal slashes, an X
      const k1 = ease(ramp(p, 0.05, 0.4));
      const k2 = ease(ramp(p, 0.5, 0.85));
      if (p < 0.45) return { rx: -2.8 + 2.4 * k1, rz: 1.1 - 2.0 * k1, ty: 0.4 - 0.9 * k1, lz: 0.5 };
      return { rx: -2.8 + 2.4 * k2, rz: -0.9 + 2.0 * k2, ty: -0.5 + 0.9 * k2, lz: 0.5 };
    }
    case 7: { // Meteor Drop: jump, front flip, smash the ground
      const up = ramp(p, 0, 0.55);
      const k = ease(ramp(p, 0.55, 0.7));
      const x = -3.0 + 2.6 * k;
      return { rx: x, lx: x, rz: -0.2, lz: 0.2, y: Math.sin(up * Math.PI * 0.5) * 3.2 * (1 - k) - 0.3 * k, flip: -ease(ramp(p, 0.1, 0.55)) * Math.PI * 2, tx: 0.45 * k };
    }
    case 8: { // Whirlwind: two spins rising up
      const k = ease(ramp(p, 0, 0.9));
      return { rx: -1.5, rz: 1.4, lx: -1.5, lz: -1.4, by: k * Math.PI * 4, y: Math.sin(p * Math.PI) * 1.6 };
    }
    default: { // Legend Break: gather the power overhead, then a huge chop
      const w = ramp(p, 0, 0.4);
      const k = ease(ramp(p, 0.4, 0.55));
      const x = -0.5 - 2.7 * w + 2.9 * k;
      return { rx: x, lx: x, rz: -0.15, lz: 0.15, y: 1.2 * w * (1 - k) - 0.45 * k, tx: -0.3 * w + 0.6 * k, by: 0 };
    }
  }
}

// ------------------------------------------------------------------ avatar

export class Humanoid {
  constructor(color = 0x3a7ae0, opts = {}) {
    this.root = new THREE.Group();
    const skin = mat(opts.skin || 0xffd27a, { rough: 0.55 });
    const shirt = mat(color, { rough: 0.7 });
    const pantsColor = new THREE.Color(color).multiplyScalar(0.45).getHex();
    const pants = mat(opts.pants || pantsColor, { rough: 0.8 });
    this.body = new THREE.Group();
    this.root.add(this.body);
    // legs
    this.legs = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.45, 1.8, 0);
      pivot.add(part(RBOX, pants, 0.86, 1.8, 0.86, 0, -0.9, 0));
      this.body.add(pivot);
      return pivot;
    });
    this.torso = new THREE.Group();
    this.torso.position.y = 1.8;
    this.body.add(this.torso);
    this.torso.add(part(RBOX, shirt, 1.8, 1.8, 0.92, 0, 0.9, 0));
    // arms
    this.arms = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 1.32, 1.62, 0);
      pivot.add(part(RBOX, shirt, 0.8, 0.6, 0.8, 0, -0.2, 0));
      pivot.add(part(RBOX, skin, 0.76, 1.3, 0.76, 0, -1.0, 0));
      this.torso.add(pivot);
      return pivot;
    });
    // head with a face
    this.head = new THREE.Group();
    this.head.position.y = 1.8;
    this.torso.add(this.head);
    const headMesh = part(RBOX, skin, 1.15, 1.12, 1.12, 0, 0.6, 0);
    this.head.add(headMesh);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: faceTexture(), transparent: true, roughness: 0.6 }));
    face.position.set(0, 0.6, 0.565);
    this.head.add(face);
    this.hatAnchor = new THREE.Group();
    this.hatAnchor.position.y = 1.16;
    this.head.add(this.hatAnchor);
    // hand anchor for the sword
    this.hand = new THREE.Group();
    this.hand.position.set(0, -1.6, 0);
    this.arms[1].add(this.hand);
    this.carryAnchor = new THREE.Group();
    this.carryAnchor.position.set(0, 5.7, 0);
    this.root.add(this.carryAnchor);
    this.swordId = null;
    this.hatId = null;
    this.swing = 0;
    this.swingDir = 1;
    this.walkPhase = 0;
    this.dodge = 0;
    this.color = color;
    this.fxGroup = new THREE.Group();
    this.root.add(this.fxGroup);
  }

  setSword(id) {
    if (id === this.swordId) return;
    this.swordId = id;
    this.hand.clear();
    if (!id) return;
    const s = buildSword(id);
    s.rotation.x = Math.PI / 2;
    s.position.set(0, 0, 0.1);
    this.hand.add(s);
    this.sword = s;
  }

  // A costume from the Costume Shop (null: your normal clothes). It brings
  // its own idle, attack, dodge and teleport animations (see update).
  // power: the chosen power of a Legend Master (its colours and effects)
  setCostume(id, power = null) {
    const key = `${id}|${power}`;
    if (key === (this.costumeKey ?? 'null|null')) return;
    this.costumeKey = key;
    this.costumeId = id;
    const c = COSTUME_BY_ID[id] || null;
    this.element = c?.choosePower ? costumeWithPower(c, power).element : null;
    this.setOutfit(c ? costumeWithPower(c, power) : null);
  }

  // any costume-like outfit { style, colors, look } (costumes, guard uniforms)
  setOutfit(c) {
    for (const m of this.dress?.parts || []) m.parent?.remove(m);
    this.dress = null;
    this.style = c ? c.style : null;
    this.hatAnchor.visible = !c; // the outfit's own headwear replaces the hat
    if (c) this.dress = dressUp(this, c);
  }

  // arriving after a teleport (H, portals...): the costume's entrance
  startTeleport() {
    this.tpT = 0;
  }

  // Z: the costume's master power
  startPower() {
    this.powerT = 0;
  }

  setHat(id) {
    if (id === this.hatId) return;
    this.hatId = id;
    this.hatAnchor.clear();
    const h = id ? buildHat(id) : null;
    if (h) this.hatAnchor.add(h);
    this.hat = h;
  }

  // move: which of the Legend Master's 10 sword moves (0..9)
  startSwing(combo = false, move = 0) {
    this.swing = 1;
    this.swingDir = combo ? -1 : this.swingDir * -1;
    this.move = move;
  }

  startDodge() {
    this.dodge = 1;
  }

  // capture: point at the monster, then cheer when the orb arrives
  startCatch() {
    this.catchT = 0;
  }

  startCheer() {
    this.cheerT = 0;
  }

  // anim: ANIM code. speed: horizontal speed. carrying: bool.
  update(dt, anim, speed, carrying, t) {
    const legs = this.legs;
    const arms = this.arms;
    const st = this.style; // costume animation style (null: normal clothes)
    let legSwing = 0;
    if (anim === ANIM.walk || anim === ANIM.run) {
      this.walkPhase += dt * (anim === ANIM.run ? 13 : 10) * Math.min(1.3, 0.4 + speed / 18);
      legSwing = Math.sin(this.walkPhase) * (anim === ANIM.run ? 0.95 : 0.7);
    } else {
      this.walkPhase *= 0.9;
    }
    const swimming = anim === ANIM.swim;
    const air = anim === ANIM.air;
    legs[0].rotation.x = air ? -0.5 : swimming ? Math.sin(t * 8) * 0.4 : legSwing;
    legs[1].rotation.x = air ? 0.3 : swimming ? -Math.sin(t * 8) * 0.4 : -legSwing;
    legs[0].rotation.z = 0;
    legs[1].rotation.z = 0;
    // body bob
    this.body.position.y = anim === ANIM.walk || anim === ANIM.run ? Math.abs(Math.sin(this.walkPhase)) * 0.12 : Math.sin(t * 2) * 0.02;
    this.body.rotation.y = 0;
    this.body.position.z = 0;
    let flipX = 0; // a front flip in a sword move
    this.torso.rotation.x = swimming ? 0.9 : anim === ANIM.run ? 0.12 : 0;
    this.head.rotation.x = 0;
    this.head.rotation.y *= 0.9;
    // arms
    let leftX = -legSwing * 0.8;
    let rightX = legSwing * 0.6 - 0.5;
    let leftZ = 0.08;
    let rightZ = -0.08;
    if (swimming) {
      leftX = -2.4 + Math.sin(t * 8) * 0.8;
      rightX = -2.4 - Math.sin(t * 8) * 0.8;
    }
    if (air) {
      leftX = -2.6;
      leftZ = 0.4;
    }
    if (st === 'legend' && anim === ANIM.run && !carrying) {
      // the hero run: leaning in, arms swept back
      leftX = rightX = 1.0 + legSwing * 0.1;
      leftZ = 0.3;
      rightZ = -0.3;
      this.torso.rotation.x = 0.35;
    }
    if (carrying) {
      leftX = rightX = -2.9;
      leftZ = 0.25;
      rightZ = -0.25;
    }
    // costume idle stance (standing still)
    const still = anim === ANIM.idle && speed < 0.6 && !carrying;
    if (st && still) {
      this.idleT = (this.idleT || 0) + dt;
      const k = Math.min(1, this.idleT / 0.4);
      switch (st) {
        case 'spy': // arms folded, looking around
          leftX = -1.35 * k;
          leftZ = 0.08 + 0.7 * k;
          rightX = -0.5 - 0.65 * k;
          rightZ = -0.08 - 0.72 * k;
          this.head.rotation.y = Math.sin(t * 0.9) * 0.55 * k;
          break;
        case 'ninja': // low stance, hands together
          this.body.position.y -= 0.32 * k;
          leftX = rightX = -1.45 * k;
          leftZ = 0.55 * k;
          rightZ = -0.55 * k;
          legs[0].rotation.z = -0.22 * k;
          legs[1].rotation.z = 0.22 * k;
          this.body.position.y += Math.sin(t * 3) * 0.04;
          break;
        case 'knight': // hand on the hip, sword ready
          leftX = 0.1;
          leftZ = -0.5 * k;
          rightX = -0.5 - 0.3 * k;
          this.torso.rotation.x = -0.06 * k + Math.sin(t * 1.5) * 0.02;
          break;
        case 'hero': // fists on the hips, chin up
          leftX = rightX = 0.2 * k;
          leftZ = -0.5 * k;
          rightZ = 0.5 * k;
          this.head.rotation.x = -0.15 * k;
          legs[0].rotation.z = -0.12 * k;
          legs[1].rotation.z = 0.12 * k;
          break;
        case 'guard': // at attention, sword ready
          leftX = 0.05;
          leftZ = 0.05;
          rightX = -0.55 * k;
          rightZ = -0.12;
          this.head.rotation.y = Math.sin(t * 0.6) * 0.35 * k;
          break;
        case 'legend': // floating, sword raised, the free hand glowing with power
          this.body.position.y += (0.35 + Math.sin(t * 2.2) * 0.15) * k;
          leftX = -0.35 * k;
          leftZ = 0.08 + 0.55 * k;
          rightX = -0.5 - 0.35 * k;
          rightZ = -0.08 + 0.55 * k;
          this.head.rotation.x = -0.12 * k;
          legs[0].rotation.x = 0.15 * k;
          legs[1].rotation.x = -0.25 * k;
          break;
        case 'bunny': // happy little hops
          this.body.position.y += Math.abs(Math.sin(t * 5)) * 0.35 * k;
          leftX = rightX = -0.6 * k + Math.sin(t * 10) * 0.15;
          leftZ = -0.35 * k;
          rightZ = 0.35 * k;
          break;
        default:
          break;
      }
    } else this.idleT = 0;
    if (this.catchT !== undefined && this.catchT < 0.75) {
      this.catchT += dt;
      const k = Math.min(1, this.catchT / 0.15);
      rightX = -0.5 - k * 1.1;
      rightZ = -0.08;
      leftX = -0.3 * k;
    }
    if (this.cheerT !== undefined && this.cheerT < 0.9) {
      this.cheerT += dt;
      const w = Math.sin(this.cheerT * 22) * 0.2;
      leftX = -2.9 + w;
      rightX = -2.9 - w;
      leftZ = 0.45;
      rightZ = -0.45;
      this.body.position.y += Math.abs(Math.sin(this.cheerT * Math.PI * 2)) * 0.6;
    }
    if (this.swing > 0) {
      const p = 1 - this.swing; // 0 -> 1
      let dur = 0.34;
      if (st === 'legend') {
        const r = legendMove(this.move || 0, p);
        leftX = r.lx ?? leftX;
        leftZ = r.lz ?? leftZ;
        rightX = r.rx ?? rightX;
        rightZ = r.rz ?? rightZ;
        this.torso.rotation.y = r.ty || 0;
        this.torso.rotation.x = r.tx ?? this.torso.rotation.x;
        this.body.rotation.y = r.by || 0;
        this.body.position.y += r.y || 0;
        this.body.position.z = r.z || 0;
        flipX = r.flip || 0;
        dur = LEGEND_MOVE_DUR[this.move || 0];
      } else if (st === 'spy') {
        // a spinning slash with the sword arm stretched out
        const k = Math.min(1, p / 0.2);
        rightX = -0.3;
        rightZ = 0.2 + 1.3 * k;
        leftZ = -0.9 * k;
        this.body.rotation.y = this.swingDir * Math.max(0, (p - 0.15) / 0.85) * Math.PI * 2;
        dur = 0.36;
      } else if (st === 'knight') {
        // a heavy chop from above
        rightX = p < 0.35 ? -0.5 - (p / 0.35) * 2.6 : -3.1 + ((p - 0.35) / 0.65) * 3.3;
        leftX = rightX * 0.6;
        rightZ = -0.08;
        this.torso.rotation.x = p < 0.35 ? -0.12 : 0.28;
        dur = 0.42;
      } else if (st === 'hero') {
        // an uppercut
        rightX = p < 0.3 ? 0.4 * (p / 0.3) : 0.4 - ((p - 0.3) / 0.7) * 3.4;
        this.body.position.y += Math.sin(p * Math.PI) * 0.6;
      } else if (st === 'bunny') {
        // a twirl
        this.body.rotation.y = p * Math.PI * 2;
        leftZ = -1.1;
        rightZ = 1.1;
        rightX = -0.4;
      } else {
        const wind = p < 0.25 ? p / 0.25 : 1;
        const slash = p < 0.25 ? 0 : Math.min(1, (p - 0.25) / 0.35);
        rightX = -0.5 - wind * 2.2 + slash * 2.7;
        rightZ = -0.08 + this.swingDir * (wind * 0.6 - slash * 1.1);
        this.torso.rotation.y = this.swingDir * (wind * 0.35 - slash * 0.6);
        if (st === 'ninja') {
          this.torso.rotation.x = 0.35 * Math.sin(p * Math.PI);
          dur = 0.24;
        }
      }
      this.swing = Math.max(0, this.swing - dt / dur);
    } else {
      this.torso.rotation.y *= 0.8;
    }
    // Z: master power
    const powerDur = st === 'legend' ? 1.1 : 0.75;
    if (this.powerT !== undefined && this.powerT < powerDur) {
      this.powerT += dt;
      const p = Math.min(1, this.powerT / powerDur);
      if (st === 'legend') {
        if (p < 0.3) {
          // charging: rise up, arms spread wide, power gathering
          const k = p / 0.3;
          this.body.position.y += k * 1.8;
          leftX = rightX = -0.4;
          leftZ = 0.08 + 1.3 * k;
          rightZ = -0.08 - 1.3 * k;
          this.head.rotation.x = -0.35 * k;
          this.torso.rotation.x = -0.25 * k;
          this.body.position.y += Math.sin(t * 60) * 0.04 * k; // trembling with power
        } else if (p < 0.42) {
          // both hands to the sky
          leftX = rightX = -3.0;
          leftZ = 0.25;
          rightZ = -0.25;
          this.body.position.y += 1.8 + ((p - 0.3) / 0.12) * 0.4;
          this.head.rotation.x = -0.4;
        } else {
          // smash it down
          const k = Math.min(1, (p - 0.42) / 0.1);
          const back = Math.max(0, (p - 0.75) / 0.25);
          leftX = rightX = -3.0 + k * 2.2;
          leftZ = 0.4;
          rightZ = -0.4;
          this.body.position.y += (2.2 * (1 - k) - 0.5 * k) * (1 - back);
          this.torso.rotation.x = 0.5 * k * (1 - back);
          legs[0].rotation.x = -0.9 * k * (1 - back);
          legs[1].rotation.x = 0.5 * k * (1 - back);
        }
      } else if (st === 'spy') {
        if (p < 0.35) {
          this.body.position.y -= 0.45 * (p / 0.35);
          leftX = rightX = 0.9;
          leftZ = -0.3;
          rightZ = 0.3;
        } else {
          const k = (p - 0.35) / 0.65;
          rightX = leftX = -1.5;
          rightZ = 1.3 - k * 2.4;
          leftZ = -1.3 + k * 2.4;
          this.body.rotation.y = k * Math.PI * 2;
          this.body.position.y += Math.sin(k * Math.PI) * 1.2;
        }
      } else if (st === 'ninja') {
        this.body.position.y += Math.sin(p * Math.PI) * 1.6;
        this.body.rotation.y = p * Math.PI * 4;
        leftZ = -1.4;
        rightZ = 1.4;
      } else if (st === 'knight') {
        rightX = leftX = p < 0.45 ? -3.1 * (p / 0.45) : -3.1 + ((p - 0.45) / 0.55) * 3.3;
        this.body.position.y += p < 0.45 ? (p / 0.45) * 0.8 : 0.8 - ((p - 0.45) / 0.55) * 0.8;
      } else if (st === 'hero') {
        leftX = rightX = -3.0;
        leftZ = 0.3;
        rightZ = -0.3;
        this.torso.rotation.x = -0.25;
        this.body.position.y += Math.sin(p * Math.PI) * 1.4;
      } else {
        leftX = rightX = -1.5;
        leftZ = 0.6;
        rightZ = -0.6;
        this.body.position.y += Math.abs(Math.sin(p * Math.PI * 2)) * 0.8;
      }
    }
    arms[0].rotation.x = leftX;
    arms[0].rotation.z = leftZ;
    arms[1].rotation.x = rightX;
    arms[1].rotation.z = rightZ;
    if (this.dodge > 0) {
      const p = 1 - this.dodge;
      let dur = 0.38;
      if (st === 'legend') {
        // a flash step: a low spinning dash
        this.body.rotation.z = p * Math.PI * 2;
        this.body.rotation.x = 0.6 * Math.sin(p * Math.PI);
        this.body.position.y += Math.sin(p * Math.PI) * 0.6;
        dur = 0.3;
      } else if (st === 'spy') {
        // backflip
        this.body.rotation.x = -p * Math.PI * 2;
        this.body.position.y += Math.sin(p * Math.PI) * 1.6;
      } else if (st === 'ninja') {
        // cartwheel to the side
        this.body.rotation.z = p * Math.PI * 2;
        this.body.position.y += Math.sin(p * Math.PI) * 1.0;
        dur = 0.32;
      } else if (st === 'knight') {
        // a low shield slide
        this.body.rotation.x = Math.sin(p * Math.PI) * 0.5;
        this.body.position.y -= Math.sin(p * Math.PI) * 0.3;
      } else if (st === 'bunny') {
        // two quick hops with a spin
        this.body.rotation.y = p * Math.PI * 2;
        this.body.position.y += Math.abs(Math.sin(p * Math.PI * 2)) * 1.4;
      } else {
        this.body.rotation.x = p * Math.PI * 2;
        this.body.position.y += Math.sin(p * Math.PI) * 1.2;
      }
      this.dodge = Math.max(0, this.dodge - dt / dur);
      if (this.dodge === 0) this.body.rotation.z = 0;
    } else {
      this.body.rotation.x = flipX;
    }
    // arriving after a teleport: grow out of a swirl
    if (st && this.tpT !== undefined && this.tpT < 0.6) {
      this.tpT += dt;
      const k = Math.min(1, this.tpT / 0.6);
      const e = 1 - (1 - k) ** 3;
      const sq = Math.sin(k * Math.PI) * 0.25;
      this.body.scale.set(Math.max(0.05, e - sq * 0.5), Math.max(0.05, e + sq), Math.max(0.05, e - sq * 0.5));
      this.body.rotation.y += (1 - e) * Math.PI * 4;
    } else this.body.scale.set(1, 1, 1);
    if (this.hat?.userData.spin) this.hat.userData.spin.rotation.y += dt * 18;
    // costume details: flapping scarves and capes, wiggling ears, night lights
    if (this.dress) {
      const move = Math.min(1, speed / 16);
      for (const m of this.dress.parts) {
        const u = m.userData;
        if (u.flap) m.rotation.x = 0.3 + move * 0.9 + Math.sin(t * 9 + u.flap) * 0.12 * (0.3 + move);
        else if (u.cape) m.rotation.x = 0.08 + move * 0.7 + Math.sin(t * 6) * 0.05 * (0.4 + move);
        else if (u.ear) m.rotation.x = Math.sin(t * 3 + u.ear) * 0.12 - move * 0.4;
        else if (u.pulse) m.scale.setScalar(1 + Math.sin(t * 5) * 0.15);
      }
      for (const g of this.dress.glows) g.visible = nightGlow;
      const surge = this.powerT !== undefined && this.powerT < 1.1 ? 1 : 0;
      for (const m of this.dress.pulses) m.opacity = 0.65 + 0.35 * Math.sin(t * 4) + surge * 0.3;
      this.dress.orbs.forEach((o, i) => {
        const a = t * (2.2 + surge * 6) + (i * Math.PI * 2) / 3;
        const r = 1.9 + Math.sin(t * 1.3 + i) * 0.2 + surge * 0.8;
        o.position.set(Math.sin(a) * r, 2.6 + Math.sin(t * 2 + i * 2) * 0.8, Math.cos(a) * r);
      });
      for (const l of this.dress.leds) l.visible = nightGlow && Math.sin(t * 5 + l.userData.phase) > -0.3;
    }
  }

  setDown(down) {
    this.body.rotation.z = down ? Math.PI / 2 : 0;
    this.body.position.x = down ? 1.8 : 0;
  }
}
