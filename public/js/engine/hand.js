// First-person view model: the player's arm (with their skin) or the held block.

import * as THREE from 'three';
import { BLOCKS } from './blocks.js';
import { U } from './materials.js';
import { FirstPersonArm } from './skin.js';

const ITEM_VERT = /* glsl */`
attribute vec3 aTex;
attribute vec3 aTint;
varying vec3 vTex;
varying vec3 vTint;
varying vec3 vN;
void main() {
  vTex = aTex;
  vTint = aTint;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ITEM_FRAG = /* glsl */`
uniform highp sampler2DArray uAlbedoArr;
uniform vec3 uAmbient;
uniform vec3 uSun;
uniform float uTorch;
uniform float uCutout;
varying vec3 vTex;
varying vec3 vTint;
varying vec3 vN;
void main() {
  vec4 t = texture(uAlbedoArr, vTex);
  if (uCutout > 0.5 && t.a < 0.5) discard;
  vec3 tint = uCutout > 0.5 ? vTint : mix(vec3(1.0), vTint, t.a);
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float ndl = max(dot(n, normalize(vec3(-0.35, 0.8, 0.5))), 0.0);
  vec3 light = uAmbient * (0.55 + 0.45 * max(n.y, 0.0)) + uSun * ndl + vec3(1.0, 0.62, 0.3) * uTorch;
  gl_FragColor = vec4(t.rgb * tint * light, 1.0);
}
`;

function srgbToLinear(c) { return Math.pow(c, 2.2); }

function tintFor(block) {
  let t = [1, 1, 1];
  if (block.tint === 'grass') t = [0.48, 0.72, 0.30];
  else if (block.tint === 'foliage') t = [0.40, 0.64, 0.24];
  else if (Array.isArray(block.tint)) t = block.tint;
  return t.map(srgbToLinear);
}

function cubeGeometry(block) {
  const pos = [], nor = [], tex = [], tint = [], idx = [];
  const t = tintFor(block);
  const faces = [
    { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], layer: block.tex.side },
    { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], layer: block.tex.side },
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], layer: block.tex.top },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], layer: block.tex.bottom },
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], layer: block.tex.side },
    { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], layer: block.tex.side },
  ];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const f of faces) {
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(f.c[i][0] - 0.5, f.c[i][1] - 0.5, f.c[i][2] - 0.5);
      nor.push(...f.n);
      tex.push(uvs[i][0], uvs[i][1], f.layer);
      tint.push(...t);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aTex', new THREE.Float32BufferAttribute(tex, 3));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 3));
  g.setIndex(idx);
  return g;
}

function flatGeometry(block) {
  const t = tintFor(block);
  const layer = block.tex.side;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('aTex', new THREE.Float32BufferAttribute([0, 0, layer, 1, 0, layer, 1, 1, layer, 0, 1, layer], 3));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute([...t, ...t, ...t, ...t], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export class HandView {
  constructor(handScene, skinCanvas, slim) {
    this.scene = handScene;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.arm = new FirstPersonArm(skinCanvas, slim);
    this.root.add(this.arm.group);
    this.uniforms = {
      uAlbedoArr: U.uAlbedoArr,
      uAmbient: { value: new THREE.Color(1, 1, 1) },
      uSun: { value: new THREE.Color(1, 1, 1) },
      uTorch: { value: 0 },
      uCutout: { value: 0 },
    };
    this.itemMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: ITEM_VERT, fragmentShader: ITEM_FRAG, side: THREE.DoubleSide });
    this.item = null;
    this.itemId = -1;
    this.swing = 0; // 0..1 progress, 0 = idle
    this.swinging = false;
    this.equip = 0; // 0..1 lowered amount
    this.bobPhase = 0;
    this.visible = true;
    this.lastTime = 0;
  }

  setSkin(canvas, slim) { this.arm.setSkin(canvas, slim); }

  dispose() {
    this.scene.remove(this.root);
    if (this.item) this.item.geometry.dispose();
    this.itemMat.dispose();
    this.arm.dispose();
  }

  setItem(id) {
    if (id === this.itemId) return;
    this.itemId = id;
    this.equip = 1;
    if (this.item) {
      this.root.remove(this.item);
      this.item.geometry.dispose();
      this.item = null;
    }
    const b = BLOCKS[id];
    if (!b || !b.tex || id === 0) return;
    const flat = b.render === 'cross' || b.render === 'torch';
    this.emissive = b.emit > 0;
    this.uniforms.uCutout.value = (b.render === 'cutout' || flat) ? 1 : 0;
    this.item = new THREE.Mesh(flat ? flatGeometry(b) : cubeGeometry(b), this.itemMat);
    this.item.userData.flat = flat;
    this.root.add(this.item);
  }

  startSwing() {
    if (this.swing === 0 || this.swing > 0.6) this.swing = 0.0001;
    this.swinging = true;
  }

  // light: { sky, block } at the player's eyes; env: { ambient: Color, sun: Color }
  update(dt, state) {
    this.root.visible = this.visible && !state.thirdPerson;
    if (!this.root.visible) return;

    if (this.swing > 0) {
      this.swing += dt * 3.6;
      if (this.swing >= 1) this.swing = 0;
    }
    this.equip = Math.max(0, this.equip - dt * 5);

    const speed = state.onGround ? Math.min(state.speed, 6) : 0;
    this.bobPhase += dt * speed * 1.9;
    const bobAmt = state.bobbing ? Math.min(1, speed / 4) : 0;
    const bx = Math.sin(this.bobPhase) * 0.018 * bobAmt;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.022 * bobAmt;

    const s = this.swing;
    const sw = Math.sin(s * Math.PI);
    const sw2 = Math.sin(Math.sqrt(s) * Math.PI);
    const drop = this.equip * 0.4;

    const amb = state.ambient, sun = state.sun;
    this.uniforms.uAmbient.value.copy(amb);
    this.uniforms.uSun.value.copy(sun);
    this.uniforms.uTorch.value = state.torch;
    if (this.item && this.emissive) {
      // Light sources (torch, glowstone) glow in the hand.
      this.uniforms.uAmbient.value.setRGB(1.4, 1.25, 1.0);
      this.uniforms.uTorch.value = 0.6;
    }

    if (this.item) {
      this.arm.group.visible = false;
      const it = this.item;
      if (it.userData.flat) {
        it.scale.setScalar(0.42);
        it.position.set(0.36 + bx - sw2 * 0.12, -0.3 + by - drop + sw * 0.05, -0.6 - sw * 0.1);
        it.rotation.set(-sw * 0.6, -0.35 - sw2 * 0.3, 0.1);
      } else {
        it.scale.setScalar(0.24);
        it.position.set(0.47 + bx - sw2 * 0.16, -0.4 + by - drop + sw * 0.06 - sw2 * 0.04, -0.78 - sw * 0.12);
        it.rotation.set(0.14 - sw * 0.9, 0.78 - sw2 * 0.35, -0.06 + sw * 0.25);
      }
    } else {
      this.arm.group.visible = true;
      const g = this.arm.group;
      g.position.set(0.42 + bx - sw2 * 0.18, -0.3 + by - drop + sw * 0.08, -0.38 - sw * 0.12);
      g.rotation.set(-1.95 + sw * 0.9 - sw2 * 0.1, 0.08 + sw2 * 0.35, 0.55 - sw * 0.35, 'YXZ');
    }
  }
}
