// Blocky player avatars, procedural sword models and hats.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SWORD_BY_ID } from '#shared/weapons.js';
import { COSMETIC_BY_ID } from '#shared/lucky.js';

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
  } else {
    const blade = part(BOX, bladeMat, w * 1.6, L, 0.08, 0, 0.45 + L / 2, 0);
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
    const light = new THREE.PointLight(c.glow, 3, 7, 2);
    light.position.y = 0.5 + L / 2;
    g.add(light);
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

  setHat(id) {
    if (id === this.hatId) return;
    this.hatId = id;
    this.hatAnchor.clear();
    const h = id ? buildHat(id) : null;
    if (h) this.hatAnchor.add(h);
    this.hat = h;
  }

  startSwing(combo = false) {
    this.swing = 1;
    this.swingDir = combo ? -1 : this.swingDir * -1;
  }

  startDodge() {
    this.dodge = 1;
  }

  // anim: ANIM code. speed: horizontal speed. carrying: bool.
  update(dt, anim, speed, carrying, t) {
    const legs = this.legs;
    const arms = this.arms;
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
    // body bob
    this.body.position.y = anim === ANIM.walk || anim === ANIM.run ? Math.abs(Math.sin(this.walkPhase)) * 0.12 : Math.sin(t * 2) * 0.02;
    this.torso.rotation.x = swimming ? 0.9 : anim === ANIM.run ? 0.12 : 0;
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
    if (carrying) {
      leftX = rightX = -2.9;
      leftZ = 0.25;
      rightZ = -0.25;
    }
    if (this.swing > 0) {
      const p = 1 - this.swing; // 0 -> 1
      const wind = p < 0.25 ? p / 0.25 : 1;
      const slash = p < 0.25 ? 0 : Math.min(1, (p - 0.25) / 0.35);
      rightX = -0.5 - wind * 2.2 + slash * 2.7;
      rightZ = -0.08 + this.swingDir * (wind * 0.6 - slash * 1.1);
      this.torso.rotation.y = this.swingDir * (wind * 0.35 - slash * 0.6);
      this.swing = Math.max(0, this.swing - dt / 0.34);
    } else {
      this.torso.rotation.y *= 0.8;
    }
    arms[0].rotation.x = leftX;
    arms[0].rotation.z = leftZ;
    arms[1].rotation.x = rightX;
    arms[1].rotation.z = rightZ;
    if (this.dodge > 0) {
      this.body.rotation.x = (1 - this.dodge) * Math.PI * 2;
      this.body.position.y += Math.sin((1 - this.dodge) * Math.PI) * 1.2;
      this.dodge = Math.max(0, this.dodge - dt / 0.38);
    } else {
      this.body.rotation.x = 0;
    }
    if (this.hat?.userData.spin) this.hat.userData.spin.rotation.y += dt * 18;
  }

  setDown(down) {
    this.body.rotation.z = down ? Math.PI / 2 : 0;
    this.body.position.x = down ? 1.8 : 0;
  }
}
