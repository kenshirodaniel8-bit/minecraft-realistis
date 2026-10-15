// Player avatars (yours and everyone else's): the blocky humanoid with sword
// and hat, name label, carried (stolen) monster, companion monster following
// behind, and status visuals (frozen, shield, net, knocked out).

import * as THREE from 'three';
import { SPECIES } from '#shared/monsters.js';
import { SWORDS } from '#shared/weapons.js';
import { COSMETICS } from '#shared/lucky.js';
import { Humanoid, ANIM } from './humanoid.js';
import { buildMonster } from './monsterRenderer.js';
import { animateMonster } from './animationSystem.js';
import { makeLabel, disposeLabel } from './labels.js';
import { blobShadow, HealthBar } from './monstersView.js';
import { InterpBuffer } from './net.js';

export const FX = { frozen: 1, rooted: 2, slowed: 4, shield: 8, speed: 16, dodge: 32, protected: 64, burning: 128, stunned: 256, slipping: 512, radar: 1024, dead: 2048 };

const DEFAULT_COLORS = [0x3a7ae0, 0xe84a5f, 0x3fbf5a, 0xffb02a, 0x9a5ae0, 0x2ac8c8, 0xff7ab8, 0x5a5a6a];

export class PlayerAvatar {
  constructor(scene, world, info, isLocal = false) {
    this.scene = scene;
    this.world = world;
    this.isLocal = isLocal;
    this.info = { ...info };
    this.buf = new InterpBuffer();
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.yaw = 0;
    this.anim = 0;
    this.hpPct = 100;
    this.effects = 0;
    this.carryIdx = -1;
    this.tmp = {};
    this.group = new THREE.Group();
    scene.add(this.group);
    this.shadow = blobShadow();
    this.shadow.scale.setScalar(3.2);
    scene.add(this.shadow);
    this.bar = new HealthBar(2.6);
    this.bar.group.visible = false;
    scene.add(this.bar.group);
    this.buildBody();
    this.makeLabel();
    this.fxMeshes = {};
  }

  color() {
    return Number.isInteger(this.info.color) ? this.info.color : DEFAULT_COLORS[(this.info.pn || 0) % DEFAULT_COLORS.length];
  }

  buildBody() {
    if (this.h) this.group.remove(this.h.root);
    this.h = new Humanoid(this.color());
    this.group.add(this.h.root);
    this.builtColor = this.color();
    this.h.setSword(this.info.sword || 'wooden');
    this.h.setHat(this.info.cosmetic || null);
    this.h.setCostume(this.info.costume || null);
    this.h.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
  }

  makeLabel() {
    if (this.label) {
      this.group.remove(this.label);
      disposeLabel(this.label);
    }
    if (this.isLocal) return;
    this.label = makeLabel(`${this.info.admin ? '👑 ' : ''}${this.info.name}  Lv ${this.info.level || 1}`, { scale: 0.018, color: this.info.admin ? '#ffe27a' : '#ffffff', font: '800 40px "Trebuchet MS", system-ui, sans-serif' });
    this.label.position.y = 6.4;
    this.group.add(this.label);
    this.labelKey = `${this.info.name}|${this.info.level}|${!!this.info.admin}`;
  }

  setInfo(info) {
    Object.assign(this.info, info);
    if (this.color() !== this.builtColor) this.buildBody();
    this.h.setSword(this.info.sword || 'wooden');
    this.h.setHat(this.info.cosmetic || null);
    this.h.setCostume(this.info.costume || null);
    if (`${this.info.name}|${this.info.level}|${!!this.info.admin}` !== this.labelKey) this.makeLabel();
  }

  // values from a snapshot row
  applySnapshot(t, row) {
    const [, x, y, z, yaw, anim, hp, swordIdx, carry, fx, , level, cosmetic] = row;
    this.buf.push(t, x, y, z, yaw);
    this.anim = anim;
    this.hpPct = hp;
    this.effects = fx;
    this.setCarry(carry);
    const sword = SWORDS[swordIdx]?.id || 'wooden';
    const hat = cosmetic >= 0 ? COSMETICS[cosmetic]?.id : null;
    if (sword !== this.info.sword || hat !== (this.info.cosmetic || null) || level !== this.info.level) {
      this.setInfo({ sword, cosmetic: hat, level });
    }
  }

  setCarry(idx) {
    if (idx === this.carryIdx) return;
    this.carryIdx = idx;
    if (this.carryRig) {
      this.h.carryAnchor.remove(this.carryRig.root);
      this.carryRig = null;
    }
    if (idx >= 0 && SPECIES[idx]) {
      this.carryRig = buildMonster(SPECIES[idx].id);
      const s = Math.min(1, 2.6 / (this.carryRig.height * SPECIES[idx].size)) * SPECIES[idx].size;
      this.carryRig.root.scale.setScalar(s);
      this.carryRig.st = { pose: 'carried', poseT: 0 };
      this.h.carryAnchor.add(this.carryRig.root);
    }
  }

  statusMesh(kind) {
    if (this.fxMeshes[kind]) return this.fxMeshes[kind];
    let m;
    if (kind === 'ice') {
      m = new THREE.Mesh(new THREE.BoxGeometry(3, 5.4, 2.4), new THREE.MeshStandardMaterial({ color: 0xbff1ff, transparent: true, opacity: 0.55, roughness: 0.1 }));
      m.position.y = 2.6;
    } else if (kind === 'shield') {
      m = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 14), new THREE.MeshStandardMaterial({ color: 0x8fb8ff, transparent: true, opacity: 0.25, emissive: 0x3a6aff, emissiveIntensity: 0.4, depthWrite: false }));
      m.position.y = 2.4;
    } else if (kind === 'net') {
      m = new THREE.Mesh(new THREE.SphereGeometry(2.8, 8, 6), new THREE.MeshBasicMaterial({ color: 0xc8a26a, wireframe: true }));
      m.position.y = 2.2;
    } else if (kind === 'goo') {
      m = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0x9be04a, transparent: true, opacity: 0.7 }));
      m.position.y = 0.4;
    }
    m.visible = false;
    this.group.add(m);
    this.fxMeshes[kind] = m;
    return m;
  }

  setStatus(kind, on) {
    if (!on && !this.fxMeshes[kind]) return;
    this.statusMesh(kind).visible = on;
  }

  // For the local player: drive from local physics instead of snapshots.
  setLocal(pos, yaw, anim) {
    this.pos.set(pos.x, pos.y, pos.z);
    this.yaw = yaw;
    this.anim = anim;
  }

  update(dt, t, renderT, effects, others = []) {
    this.prevPos.copy(this.pos);
    if (!this.isLocal && this.buf.sample(renderT, this.tmp)) {
      this.pos.set(this.tmp.x, this.tmp.y, this.tmp.z);
      this.yaw = this.tmp.yaw;
    }
    const speed = Math.hypot(this.pos.x - this.prevPos.x, this.pos.z - this.prevPos.z) / Math.max(dt, 1e-3);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    const fx = this.effects;
    const dead = (fx & FX.dead) !== 0;
    const frozen = (fx & FX.frozen) !== 0;
    this.h.setDown(dead);
    if (!frozen) this.h.update(dt, dead ? ANIM.idle : this.anim, speed, this.carryIdx >= 0, t);
    if (this.anim === ANIM.dodge && this.h.dodge === 0 && !this.dodgeShown) {
      this.h.startDodge();
      this.dodgeShown = true;
    }
    if (this.anim !== ANIM.dodge) this.dodgeShown = false;
    this.setStatus('ice', frozen);
    this.setStatus('shield', (fx & FX.shield) !== 0);
    this.setStatus('net', (fx & FX.rooted) !== 0);
    if (this.fxMeshes.shield?.visible) this.fxMeshes.shield.rotation.y += dt;
    // protected after respawn: blink
    this.h.root.visible = !((fx & FX.protected) && Math.floor(t * 8) % 2 === 0);
    if ((fx & FX.speed) && effects && Math.random() < dt * 30) effects.spawn(this.pos.x, this.pos.y + 0.5, this.pos.z, { color: [0xffd23a, 0xffffff], speed: 0.5, vy: 0.5, grav: 0, life: 0.4 });
    if ((fx & FX.burning) && effects && Math.random() < dt * 20) effects.aura('ember', this.pos.x, this.pos.y + 2, this.pos.z);
    if ((fx & FX.stunned) && effects && Math.random() < dt * 10) effects.spawn(this.pos.x, this.pos.y + 5.2, this.pos.z, { color: 0xffe14a, speed: 2, vy: 0.3, grav: 0, life: 0.5 });
    const gy = Math.max(this.world.surfaceHeight(this.pos.x, this.pos.z, this.pos.y + 0.5), 0);
    this.shadow.position.set(this.pos.x, gy + 0.05, this.pos.z);
    // remote health bar
    if (!this.isLocal) {
      this.bar.group.visible = this.hpPct < 100 && !dead;
      if (this.bar.group.visible) {
        this.bar.set(this.hpPct / 100);
        this.bar.group.position.set(this.pos.x, this.pos.y + 5.9, this.pos.z);
      }
    }
    // carried monster struggles above the head
    if (this.carryRig) {
      this.carryRig.st.poseT += dt;
      animateMonster(this.carryRig, this.carryRig.st, dt, t);
      if (effects && Math.random() < dt * 3) effects.spawn(this.pos.x, this.pos.y + 6.5, this.pos.z, { color: [0x8fd8ff], speed: 2, life: 0.5 });
    }
  }

  swing(combo) {
    this.h.startSwing(combo);
  }

  // someone teleported: snap there (no sliding across the map) and play
  // their costume's arrival animation
  arrive(x, y, z) {
    this.buf.items.length = 0;
    this.pos.set(x, y, z);
    this.h.startTeleport();
  }

  // a capture started: point at it (the new companion stays hidden until
  // the orb lands, see MonstersView.holdAllies)
  catchMonster() {
    this.h.startCatch();
  }

  cheer() {
    this.h.startCheer();
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.group, this.shadow, this.bar.group);
    if (this.label) disposeLabel(this.label);
    this.bar.dispose();
  }
}
