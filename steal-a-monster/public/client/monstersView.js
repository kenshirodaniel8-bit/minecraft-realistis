// Wild monsters on the client: built from server snapshots, smoothly
// interpolated, animated by animationSystem, with name/level labels, health
// bars, blob shadows, hit flashes and attack telegraphs.

import * as THREE from 'three';
import { SPECIES, RARITIES } from '#shared/monsters.js';
import { buildMonster, setRigMaterial, setRigDetail, FLASH_MAT } from './monsterRenderer.js';
import { animateMonster } from './animationSystem.js';
import { InterpBuffer } from './net.js';
import { makeLabel, disposeLabel } from './labels.js';

const POSES = ['idle', 'move', 'move', 'windup', 'strike', 'flee', 'stunned', 'defeated', 'sleep', 'recover', 'move', 'quirk'];
export const MSTATE = { idle: 0, wander: 1, chase: 2, windup: 3, strike: 4, flee: 5, stunned: 6, defeated: 7, sleep: 8, recover: 9, return: 10, quirk: 11 };

let shadowTex = null;
export function blobShadow() {
  if (!shadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

let whiteTex = null;
function barSprite(color, w, h) {
  if (!whiteTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 4, 4);
    whiteTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: whiteTex, color, depthTest: false, transparent: true }));
  s.scale.set(w, h, 1);
  s.renderOrder = 6;
  return s;
}

export class HealthBar {
  constructor(width = 2.4) {
    this.group = new THREE.Group();
    this.w = width;
    this.bg = barSprite(0x241640, width + 0.16, 0.38);
    this.fill = barSprite(0x5fd35a, width, 0.24);
    this.fill.center.set(0, 0.5);
    this.fill.position.x = -width / 2;
    this.group.add(this.bg, this.fill);
    this.value = 1;
  }

  set(pct) {
    this.value = Math.max(0, Math.min(1, pct));
    this.fill.scale.x = Math.max(0.001, this.w * this.value);
    this.fill.material.color.setHex(this.value > 0.5 ? 0x5fd35a : this.value > 0.25 ? 0xffc23a : 0xff4a5e);
  }

  dispose() {
    this.bg.material.dispose();
    this.fill.material.dispose();
  }
}

export class MonstersView {
  constructor(scene, world, effects, audio) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.map = new Map();
    this.tmp = {};
    this.frame = 0;
  }

  get(id) {
    return this.map.get(id);
  }

  // Near monsters use the detailed rig; far ones a low-poly copy (built on
  // first need). Hysteresis keeps them from flickering at the boundary.
  applyLod(v, dist) {
    const lo = v.rig.lod === 'lo' ? dist > 34 : dist > 42;
    if (lo === (v.rig.lod === 'lo')) {
      if (!lo) setRigDetail(v.rig, dist < 24);
      return;
    }
    const from = v.rig;
    let to = lo ? v.rigLo : v.rigHi;
    if (!to) {
      to = buildMonster(v.species.id, { lod: 'lo' });
      v.rigLo = to;
    }
    to.root.position.copy(from.root.position);
    to.root.rotation.copy(from.root.rotation);
    to.root.scale.copy(from.root.scale);
    to.root.visible = from.root.visible;
    setRigMaterial(from, null);
    this.scene.remove(from.root);
    this.scene.add(to.root);
    v.rig = to;
    if (v.flashT > 0) setRigMaterial(to, FLASH_MAT);
  }

  create(id, idx) {
    const species = SPECIES[idx];
    const rig = buildMonster(species.id);
    this.scene.add(rig.root);
    const rarity = RARITIES[species.rarity];
    const v = {
      id, species, rig,
      rigHi: rig,
      rigLo: null,
      st: { pose: 'idle', poseT: 0, speed: 0 },
      buf: new InterpBuffer(),
      pos: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      yaw: 0,
      state: 0,
      hp: 100,
      level: 1,
      flags: 0,
      label: null,
      labelLevel: -1,
      bar: new HealthBar(Math.max(2.2, rig.width * species.size * 0.9)),
      shadow: blobShadow(),
      flashT: 0,
      lastSeen: 0,
      gone: null,
      showBarUntil: 0,
      rarity,
    };
    v.bar.group.visible = false;
    this.scene.add(v.bar.group);
    v.shadow.scale.setScalar(rig.width * species.size * 0.9);
    this.scene.add(v.shadow);
    this.map.set(id, v);
    return v;
  }

  updateLabel(v) {
    if (v.labelLevel === v.level) return;
    if (v.label) {
      this.scene.remove(v.label);
      disposeLabel(v.label);
    }
    const sp = v.species;
    v.label = makeLabel(`${sp.name}  Lv ${v.level}`, { scale: 0.016, colors: [v.rarity.color], font: '800 38px "Trebuchet MS", system-ui, sans-serif' });
    this.scene.add(v.label);
    v.labelLevel = v.level;
  }

  applySnapshot(t, list) {
    for (const e of list) {
      const [id, idx, x, y, z, yaw, state, hp, level, flags, quirk] = e;
      let v = this.map.get(id);
      if (!v) {
        v = this.create(id, idx);
        v.pos.set(x, y, z);
        v.prev.set(x, y, z);
        v.yaw = yaw;
      }
      if (v.gone) continue;
      v.buf.push(t, x, y, z, yaw);
      if (state !== v.state) {
        if (state === MSTATE.defeated) this.audio.play('defeat', { pitch: v.species.personality.cry });
        // noticing an enemy: a quick intimidating face before the chase
        const calm = [MSTATE.idle, MSTATE.wander, MSTATE.sleep, MSTATE.quirk].includes(v.state);
        if (state === MSTATE.chase && calm) {
          v.forcePose = 'quirk';
          v.forceQuirk = 'intimidate';
          v.forceUntil = performance.now() + 750;
          this.audio.play('cry', { pitch: v.species.personality.cry * 0.85, minGap: 300 });
        }
        v.state = state;
        v.st.poseT = 0;
      }
      if (hp < v.hp) v.showBarUntil = performance.now() + 6000;
      v.hp = hp;
      v.level = level;
      v.flags = flags;
      v.quirk = quirk;
      v.lastSeen = t;
    }
  }

  // ---------------------------------------------------------------- events

  onAttack(d) {
    const v = this.map.get(d.id);
    if (!v) return;
    const a = v.species.attacks[d.i];
    v.st.attackKind = d.kind;
    v.st.windupMs = d.windupMs;
    v.st.poseT = 0;
    v.forcePose = 'windup';
    v.forceUntil = performance.now() + d.windupMs;
    const s = v.species.size;
    const gy = this.world.groundHeight(v.pos.x, v.pos.z);
    const yaw = Math.atan2(d.tx - v.pos.x, d.tz - v.pos.z);
    if (d.kind === 'slam') this.effects.telegraph('slam', v.pos.x, gy, v.pos.z, 0, a.radius + 0.5, d.windupMs);
    else if (d.kind === 'breath') this.effects.telegraph('breath', v.pos.x, gy, v.pos.z, yaw, a.range + s, d.windupMs, (a.arc * Math.PI) / 180);
    else if (d.kind === 'lunge') this.effects.telegraph('lunge', v.pos.x, gy, v.pos.z, yaw, a.range + 2, d.windupMs);
    this.audio.play('cry', { pitch: v.species.personality.cry * 1.2, minGap: 200 });
  }

  onStrike(d) {
    const v = this.map.get(d.id);
    if (!v) return;
    const a = v.species.attacks[d.i];
    v.forcePose = 'strike';
    v.st.poseT = 0;
    v.forceUntil = performance.now() + 380;
    v.st.attackKind = a.kind;
    const color = new THREE.Color(a.color || '#ffffff').getHex();
    const p = v.pos;
    const h = v.rig.height * v.species.size;
    if (a.kind === 'slam') {
      this.effects.burst(p.x, p.y + 0.3, p.z, 30, { color: [color, 0xffffff], speed: a.radius * 2.2, up: 0.25, life: 0.6 });
      this.audio.play('slam');
    } else if (a.kind === 'breath') {
      for (let i = 0; i < 26; i++) {
        const ang = v.yaw + (Math.random() - 0.5) * ((a.arc * Math.PI) / 180);
        const sp = a.range * (1.5 + Math.random());
        this.effects.spawn(p.x + Math.sin(v.yaw) * 1.2, p.y + h * 0.55, p.z + Math.cos(v.yaw) * 1.2, { vx: Math.sin(ang) * sp, vz: Math.cos(ang) * sp, vy: 0.5, color: [color, 0xffffff], life: 0.55, grav: 0, size: 0.35 });
      }
    } else if (a.kind === 'melee') {
      this.effects.burst(p.x + Math.sin(v.yaw) * 1.5, p.y + h * 0.4, p.z + Math.cos(v.yaw) * 1.5, 8, { color: [color, 0xffffff], speed: 4, life: 0.35 });
    }
  }

  onHit(h, mine) {
    const v = this.map.get(h.id);
    if (!v) return;
    v.flashT = 0.09;
    v.st.hurtT = 0;
    v.showBarUntil = performance.now() + 6000;
    v.hp = h.hp;
    const top = v.pos.clone();
    top.y += v.rig.height * v.species.size + 0.4;
    const cls = h.burn ? 'player' : h.crit ? 'crit' : '';
    this.effects.number(h.crit ? `${h.dmg}!` : `${h.dmg}`, top, cls);
    this.effects.hitSpark(v.pos.x, v.pos.y + v.rig.height * v.species.size * 0.5, v.pos.z, h.crit);
    if (mine) this.audio.play(h.crit ? 'crit' : 'hit', { pitch: 1 + Math.random() * 0.2 });
    if (Math.random() < 0.35) this.audio.play('cry', { pitch: v.species.personality.cry, minGap: 250 });
  }

  onDefeated(d) {
    const v = this.map.get(d.id);
    if (!v) return;
    v.state = MSTATE.defeated;
    v.st.poseT = 0;
    v.hp = 0;
    this.effects.burst(v.pos.x, v.pos.y + 1, v.pos.z, 20, { color: [0xffe14a, 0xffffff], speed: 6, life: 0.8 });
  }

  onRecover(d) {
    const v = this.map.get(d.id);
    if (v) {
      v.state = MSTATE.recover;
      v.st.poseT = 0;
    }
  }

  onGone(d) {
    const v = this.map.get(d.id);
    if (!v) return;
    if (d.reason === 'recruited') {
      v.gone = { t: 0, dur: 1.8, kind: 'recruited' };
      v.st.pose = 'celebrate';
      v.st.poseT = 0;
      this.effects.confetti(v.pos.x, v.pos.y + 1.5, v.pos.z, 50);
    } else {
      v.gone = { t: 0, dur: 0.5, kind: d.reason };
      this.effects.burst(v.pos.x, v.pos.y + 1, v.pos.z, 16, { color: [0xffffff, 0xd8d8ff], speed: 3, up: 0.8, life: 0.6 });
    }
  }

  remove(v) {
    this.map.delete(v.id);
    this.scene.remove(v.rig.root, v.shadow, v.bar.group);
    if (v.label) {
      this.scene.remove(v.label);
      disposeLabel(v.label);
    }
    v.bar.dispose();
    v.shadow.geometry.dispose();
    v.shadow.material.dispose();
  }

  clear() {
    for (const v of [...this.map.values()]) this.remove(v);
  }

  // ---------------------------------------------------------------- frame

  update(dt, renderT, time, camPos, me) {
    this.frame++;
    const nowMs = performance.now();
    for (const v of [...this.map.values()]) {
      if (!v.gone && renderT - v.lastSeen > 1500) {
        this.remove(v);
        continue;
      }
      if (v.gone) {
        v.gone.t += dt;
        const k = v.gone.t / v.gone.dur;
        if (v.gone.kind === 'recruited') {
          v.rig.root.scale.setScalar(v.species.size * Math.max(0.01, 1 - Math.max(0, k - 0.6) * 2.5));
          v.rig.root.position.y += dt * (k > 0.6 ? 6 : 0);
          if (Math.random() < 0.4) this.effects.spawn(v.pos.x, v.pos.y + 1, v.pos.z, { color: [0xff9fd8, 0xffe14a], speed: 3 });
        } else {
          v.rig.root.scale.setScalar(v.species.size * Math.max(0.01, 1 - k));
        }
        animateMonster(v.rig, v.st, dt, time);
        if (k >= 1) this.remove(v);
        continue;
      }
      v.prev.copy(v.pos);
      if (v.buf.sample(renderT, this.tmp)) {
        v.pos.set(this.tmp.x, this.tmp.y, this.tmp.z);
        v.yaw = this.tmp.yaw;
      }
      const moved = Math.hypot(v.pos.x - v.prev.x, v.pos.z - v.prev.z) / Math.max(dt, 1e-3);
      v.st.speed = v.st.speed * 0.8 + moved * 0.2;
      const dist = camPos.distanceTo(v.pos);
      this.applyLod(v, dist);
      const root = v.rig.root;
      root.position.copy(v.pos);
      root.rotation.y = v.yaw;
      // pose from server state, refined by actual motion
      let pose = POSES[v.state] || 'idle';
      if (v.forcePose && nowMs < v.forceUntil && v.state !== MSTATE.defeated && v.state !== MSTATE.stunned) pose = v.forcePose;
      else if (pose === 'windup' && v.st.pose !== 'windup') pose = 'windup';
      if ((pose === 'move' || pose === 'recover') && v.st.speed < 0.4) pose = 'idle';
      if (pose === 'idle' && v.st.speed > 0.8) pose = 'move';
      if (pose === 'strike' && (v.flags & 64)) v.st.dashing = true;
      else v.st.dashing = false;
      if (pose === 'quirk') {
        const idles = v.species.personality.idles;
        v.st.quirk = v.forcePose === 'quirk' && nowMs < v.forceUntil ? v.forceQuirk : idles[(v.quirk || 0) % idles.length];
        v.st.quirkDur = v.forcePose === 'quirk' && nowMs < v.forceUntil ? 0.75 : 3.5;
      }
      if (pose !== v.st.pose) {
        v.st.pose = pose;
        v.st.poseT = 0;
      }
      if (v.st.hurtT !== undefined) v.st.hurtT += dt;
      // animate (cheaper when far away)
      if (dist < 90 || (this.frame + v.id) % 3 === 0) animateMonster(v.rig, v.st, dist < 90 ? dt : dt * 3, time);
      root.visible = dist < 170;
      // hit flash
      if (v.flashT > 0) {
        v.flashT -= dt;
        setRigMaterial(v.rig, FLASH_MAT);
        if (v.flashT <= 0) setRigMaterial(v.rig, null);
      }
      // shadow
      const gy = Math.max(this.world.groundHeight(v.pos.x, v.pos.z), 0);
      v.shadow.position.set(v.pos.x, gy + 0.06, v.pos.z);
      v.shadow.visible = root.visible;
      // label & bar
      const h = v.rig.height * v.species.size;
      const near = dist < 45;
      const aggro = (v.flags & 32) !== 0;
      if (near || aggro) this.updateLabel(v);
      if (v.label) {
        v.label.visible = near || aggro || (v.flags & 4) !== 0;
        v.label.position.set(v.pos.x, v.pos.y + h + 1.15, v.pos.z);
      }
      const showBar = v.state !== MSTATE.defeated && (nowMs < v.showBarUntil || aggro || (near && v.hp < 100));
      v.bar.group.visible = showBar;
      if (showBar) {
        v.bar.set(v.hp / 100);
        v.bar.group.position.set(v.pos.x, v.pos.y + h + 0.55, v.pos.z);
      }
      // aura particles
      const aura = v.species.model.aura;
      if (aura && dist < 60 && Math.random() < dt * 2.5) this.effects.aura(aura.kind, v.pos.x, v.pos.y + h * 0.6, v.pos.z, aura.color);
      if (v.rig.sparking && Math.random() < dt * 12) this.effects.aura('spark', v.pos.x, v.pos.y + h * 0.7, v.pos.z);
      if (v.rig.blowing && Math.random() < dt * 4) this.effects.aura('bubble', v.pos.x + Math.sin(v.yaw), v.pos.y + h * 0.6, v.pos.z + Math.cos(v.yaw));
      if (v.rig.spouting && Math.random() < dt * 14) this.effects.spawn(v.pos.x, v.pos.y + h, v.pos.z, { color: [0x9fd8ff, 0xffffff], speed: 1.5, vy: 7, grav: 12, life: 0.8 });
      if (v.rig.puffing && Math.random() < dt * 20) this.effects.spawn(v.pos.x + Math.sin(v.yaw) * 1.4, v.pos.y + h * 0.5, v.pos.z + Math.cos(v.yaw) * 1.4, { color: [0x9a9a9a, 0xffa23a], speed: 1, vy: 1.5, grav: -1, life: 0.8 });
      if (v.rig.digging && Math.random() < dt * 10) this.effects.aura('dust', v.pos.x, v.pos.y + 0.2, v.pos.z);
    }
  }

  // closest living monster in front of a position (for auto-aim)
  nearestTarget(pos, yaw, range, arc) {
    let best = null;
    let bd = Infinity;
    for (const v of this.map.values()) {
      if (v.gone || v.state === MSTATE.defeated || v.state === MSTATE.recover) continue;
      const dx = v.pos.x - pos.x;
      const dz = v.pos.z - pos.z;
      const d = Math.hypot(dx, dz) - v.rig.width * v.species.size * 0.35;
      if (d > range) continue;
      let diff = Math.atan2(dx, dz) - yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > arc) continue;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }
}
