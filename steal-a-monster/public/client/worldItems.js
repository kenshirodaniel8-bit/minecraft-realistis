// Lucky Blocks, dropped stolen monsters and ground gadgets (traps, gel).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LUCKY_KINDS } from '#shared/lucky.js';
import { SPECIES_BY_ID } from '#shared/monsters.js';
import { buildMonster } from './monsterRenderer.js';
import { animateMonster } from './animationSystem.js';
import { makeLabel, disposeLabel } from './labels.js';

const texCache = {};
function luckyTexture(kind) {
  if (texCache[kind]) return texCache[kind];
  const def = LUCKY_KINDS[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const a = '#' + def.color.toString(16).padStart(6, '0');
  const b = '#' + def.color2.toString(16).padStart(6, '0');
  const g = ctx.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, b);
  g.addColorStop(1, a);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 116, 116);
  ctx.font = '900 92px "Trebuchet MS", system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#5a3a00';
  ctx.strokeText('?', 64, 70);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache[kind] = tex;
  return tex;
}

const BLOCK_GEO = new RoundedBoxGeometry(2.2, 2.2, 2.2, 3, 0.25);

export class WorldItems {
  constructor(scene, world, effects, audio) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.blocks = new Map();
    this.dropped = new Map();
    this.ground = new Map();
  }

  // ------------------------------------------------------------ lucky blocks

  addBlock(b) {
    if (this.blocks.has(b.id)) return;
    const def = LUCKY_KINDS[b.kind] || LUCKY_KINDS.lucky;
    const mat = new THREE.MeshStandardMaterial({ map: luckyTexture(b.kind), emissive: def.color, emissiveIntensity: 0.25, roughness: 0.35, metalness: 0.2 });
    const m = new THREE.Mesh(BLOCK_GEO, mat);
    m.castShadow = true;
    const g = new THREE.Group();
    g.add(m);
    g.position.set(b.x, b.y + 1.8, b.z);
    const light = new THREE.PointLight(def.color, 8, 12, 2);
    light.position.y = 0.5;
    g.add(light);
    if (b.kind !== 'lucky') {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.08, 6, 30), new THREE.MeshBasicMaterial({ color: def.color2 }));
      halo.rotation.x = Math.PI / 2;
      g.add(halo);
      g.userData.halo = halo;
    }
    const label = makeLabel(def.name, { scale: 0.014, color: '#ffffff', fog: true });
    label.position.y = 2.4;
    g.add(label);
    this.scene.add(g);
    this.blocks.set(b.id, { data: b, group: g, mesh: m, label, seed: Math.random() * 10 });
  }

  removeBlock(id, opened) {
    const b = this.blocks.get(id);
    if (!b) return;
    this.blocks.delete(id);
    this.scene.remove(b.group);
    disposeLabel(b.label);
    b.mesh.material.dispose();
    if (opened) {
      const p = b.group.position;
      this.effects.confetti(p.x, p.y, p.z, 45);
      this.effects.coins(p.x, p.y, p.z, 14);
    }
  }

  nearestBlock(pos, maxD) {
    let best = null;
    let bd = maxD;
    for (const b of this.blocks.values()) {
      const d = Math.hypot(pos.x - b.data.x, pos.z - b.data.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ dropped monsters

  addDropped(d) {
    this.removeDropped(d.ownedId);
    const sp = SPECIES_BY_ID[d.species];
    if (!sp) return;
    const rig = buildMonster(sp.id);
    rig.root.scale.setScalar(Math.min(sp.size, 3 / rig.height));
    rig.root.position.set(d.x, d.y, d.z);
    rig.st = { pose: 'dropped', poseT: 0 };
    this.scene.add(rig.root);
    const label = makeLabel(`${sp.name}\nDropped!`, { scale: 0.014, colors: ['#ffffff', '#ffd93a'] });
    label.position.set(d.x, d.y + 4.2, d.z);
    this.scene.add(label);
    this.dropped.set(d.ownedId, { data: d, rig, label });
    this.effects.burst(d.x, d.y + 1, d.z, 14, { color: [0xffffff, 0xffe14a], speed: 4 });
  }

  removeDropped(id, home) {
    const d = this.dropped.get(id);
    if (!d) return;
    this.dropped.delete(id);
    this.scene.remove(d.rig.root, d.label);
    disposeLabel(d.label);
    if (home) this.effects.burst(d.data.x, d.data.y + 1, d.data.z, 20, { color: [0x8fd8ff, 0xffffff], speed: 5, up: 1.5 });
  }

  nearestDropped(pos, maxD) {
    let best = null;
    let bd = maxD;
    for (const d of this.dropped.values()) {
      const dist = Math.hypot(pos.x - d.data.x, pos.z - d.data.z);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ ground gadgets

  addGround(g) {
    this.removeGround(g.id);
    const isTrap = g.item === 'sticky_trap';
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(g.r, g.r * 1.1, 0.25, 20),
      new THREE.MeshStandardMaterial({ color: isTrap ? 0x9be04a : 0x5affc8, transparent: true, opacity: 0.75, roughness: 0.1, emissive: isTrap ? 0x2a4a10 : 0x104a3a }),
    );
    mesh.position.set(g.x, g.y + 0.15, g.z);
    this.scene.add(mesh);
    this.ground.set(g.id, { data: g, mesh });
  }

  removeGround(id) {
    const g = this.ground.get(id);
    if (!g) return;
    this.ground.delete(id);
    this.scene.remove(g.mesh);
    g.mesh.geometry.dispose();
    g.mesh.material.dispose();
  }

  clear() {
    for (const id of [...this.blocks.keys()]) this.removeBlock(id);
    for (const id of [...this.dropped.keys()]) this.removeDropped(id);
    for (const id of [...this.ground.keys()]) this.removeGround(id);
  }

  update(dt, t) {
    for (const b of this.blocks.values()) {
      const p = b.group.position;
      p.y = b.data.y + 1.8 + Math.sin(t * 2 + b.seed) * 0.3;
      b.mesh.rotation.y = t * 0.9 + b.seed;
      b.mesh.rotation.x = Math.sin(t * 0.7 + b.seed) * 0.15;
      if (b.group.userData.halo) b.group.userData.halo.rotation.z = t * 2;
      if (Math.random() < dt * 3) this.effects.spawn(p.x + (Math.random() - 0.5) * 2, p.y - 1, p.z + (Math.random() - 0.5) * 2, { color: [0xfff27a, 0xffffff], speed: 0.3, vy: 1.5, grav: -0.3, life: 1.2, size: 0.12 });
    }
    for (const d of this.dropped.values()) animateMonster(d.rig, d.rig.st, dt, t);
    for (const g of this.ground.values()) g.mesh.rotation.y += dt * 0.5;
  }
}
