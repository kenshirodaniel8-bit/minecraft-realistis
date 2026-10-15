// Base guards and their helicopters (server/services/guards.js), drawn from
// the 'g' list of every snapshot: uniformed guards with swords (better
// uniforms and swords at higher levels) and armed helicopters circling the
// towers from level 7.

import * as THREE from 'three';
import { Humanoid, ANIM } from './humanoid.js';
import { GUARD_LOOKS, guardLevel } from '#shared/guards.js';
import { InterpBuffer } from './net.js';
import { HealthBar, blobShadow } from './monstersView.js';

const GS = { idle: 0, walk: 1, chase: 2, windup: 3, strike: 4, down: 7, fly: 8 };

function std(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.5, metalness: o.metal ?? 0.2, emissive: o.emissive ?? 0, transparent: !!o.opacity, opacity: o.opacity ?? 1 });
}

function buildHeli(level) {
  const g = new THREE.Group();
  const body = level >= 10 ? 0xf3c234 : level >= 9 ? 0x1a1c24 : 0x3a4a3a;
  const trim = level >= 10 ? 0xffffff : 0xd8384a;
  const m = std(body, { metal: 0.5, rough: 0.35 });
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 3.6, 6, 12), m);
  hull.rotation.x = Math.PI / 2;
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1.45, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0x8fd8ff, { metal: 0.1, rough: 0.05, opacity: 0.75 }));
  glass.rotation.x = Math.PI / 2;
  glass.position.set(0, 0.25, 2.3);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 5.2), m);
  tail.position.set(0, 0.5, -4.6);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 1.1), std(trim));
  fin.position.set(0, 1.2, -7);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.3, 1.2), std(trim));
  stripe.position.set(0, 0.2, 0.3);
  const rotor = new THREE.Group();
  rotor.position.y = 2.1;
  for (const r of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(11, 0.08, 0.5), std(0x22262c));
    blade.rotation.y = r;
    rotor.add(blade);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 10), std(0x22262c));
  hub.position.y = 1.8;
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 0.25), std(0x22262c));
  tailRotor.position.set(0.35, 1.0, -7);
  for (const s of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 5), std(0x22262c));
    skid.position.set(s * 1.3, -2.0, 0);
    g.add(skid);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), std(0x22262c));
    leg.position.set(s * 1.2, -1.6, 0.8);
    g.add(leg);
  }
  // the gun under the nose
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.8, 8), std(0x111111, { metal: 0.8 }));
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, -1.3, 2.8);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3a3a }));
  light.position.set(0, -0.6, -7.2);
  g.add(hull, glass, tail, fin, stripe, rotor, hub, tailRotor, gun, light);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  g.userData = { rotor, tailRotor, light, gun };
  return g;
}

export class GuardsView {
  constructor(scene, world, effects, audio) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.map = new Map();
    this.tmp = {};
    this.tracers = [];
  }

  create(id, kind, level, baseIndex) {
    const v = { id, kind, level, baseIndex, buf: new InterpBuffer(), pos: new THREE.Vector3(), yaw: 0, state: 0, hp: 100, lastSeen: 0, flashT: 0 };
    if (kind === 0) {
      const L = guardLevel(level);
      const look = GUARD_LOOKS[L.look];
      v.h = new Humanoid(look.colors.jacket, { skin: [0xffd27a, 0xe8b07a, 0xc8865a, 0x8a5a3a][id % 4] });
      v.h.setOutfit(look);
      v.h.setSword(L.sword);
      v.h.root.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      v.root = v.h.root;
      v.bar = new HealthBar(2.4);
      v.bar.group.visible = false;
      this.scene.add(v.bar.group);
      v.shadow = blobShadow();
      v.shadow.scale.setScalar(3);
      this.scene.add(v.shadow);
    } else {
      v.root = buildHeli(level);
    }
    this.scene.add(v.root);
    this.map.set(id, v);
    return v;
  }

  applySnapshot(t, rows = []) {
    for (const r of rows) {
      const [id, baseIndex, kind, x, y, z, yaw, state, hp, level] = r;
      let v = this.map.get(id);
      if (v && v.level !== level) {
        this.remove(v);
        v = null;
      }
      if (!v) {
        v = this.create(id, kind, level, baseIndex);
        v.pos.set(x, y, z);
        v.yaw = yaw;
      }
      v.buf.push(t, x, y, z, yaw);
      if (v.state !== state && state === GS.down) this.knockOut(v);
      if (v.state === GS.down && state !== GS.down) v.h?.setDown(false);
      v.state = state;
      if (hp < v.hp) v.showBarUntil = performance.now() + 5000;
      v.hp = hp;
      v.lastSeen = t;
    }
  }

  knockOut(v) {
    if (!v.h) return;
    this.effects.burst(v.pos.x, v.pos.y + 2, v.pos.z, 16, { color: [0xffe14a, 0xffffff], speed: 5, life: 0.6 });
    this.audio.play('defeat', { pitch: 0.7 });
  }

  // ---------------------------------------------------------------- events

  onAttack(d) {
    const v = this.map.get(d.id);
    if (v?.h) v.h.startSwing(Math.random() < 0.3);
  }

  onStrike(d) {
    const v = this.map.get(d.id);
    if (!v) return;
    this.effects.burst(v.pos.x + Math.sin(v.yaw) * 1.6, v.pos.y + 2.4, v.pos.z + Math.cos(v.yaw) * 1.6, 8, { color: [0xffffff, 0xd8dde6], speed: 4, life: 0.3 });
    this.audio.play('swing', { minGap: 60 });
  }

  onDown(d) {
    const v = this.map.get(d.id);
    if (v && v.state !== GS.down) {
      v.state = GS.down;
      this.knockOut(v);
    }
  }

  onUp(d) {
    const v = this.map.get(d.id);
    if (!v) return;
    v.state = GS.idle;
    v.h?.setDown(false);
    this.effects.burst(v.pos.x, v.pos.y + 2, v.pos.z, 12, { color: [0x5ab8ff, 0xffffff], speed: 4 });
  }

  onGone(d) {
    const v = this.map.get(d.id);
    if (v) this.remove(v);
  }

  // a helicopter shot: muzzle flash, a tracer and the impact
  onShot(d) {
    const v = this.map.get(d.id);
    if (v) v.recoil = 1;
    this.effects.burst(d.x, d.y - 1.4, d.z, 6, { color: [0xffe14a, 0xff8a2a], speed: 3, life: 0.2 });
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(d.x, d.y - 1.3, d.z), new THREE.Vector3(d.tx, d.ty, d.tz)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 1, toneMapped: false }));
    this.scene.add(line);
    this.tracers.push({ line, t: 0 });
    if (d.hit) this.effects.burst(d.tx, d.ty, d.tz, 12, { color: [0xff8a2a, 0xffe14a, 0xffffff], speed: 6, life: 0.4 });
    else this.effects.burst(d.tx + (Math.random() - 0.5) * 3, d.ty - 2, d.tz + (Math.random() - 0.5) * 3, 8, { color: [0xc9a27a, 0xffffff], speed: 3, life: 0.4 });
    this.audio.play('projectile', { minGap: 80, pitch: 1.6 });
  }

  onHit(h) {
    const v = this.map.get(h.id);
    if (!v) return;
    v.flashT = 0.1;
    v.hp = h.hp;
    v.showBarUntil = performance.now() + 5000;
    this.effects.number(h.crit ? `${h.dmg}!` : `${h.dmg}`, new THREE.Vector3(v.pos.x, v.pos.y + 5.6, v.pos.z), h.crit ? 'crit' : '');
    this.effects.hitSpark(v.pos.x, v.pos.y + 2.4, v.pos.z, h.crit);
  }

  remove(v) {
    this.map.delete(v.id);
    this.scene.remove(v.root);
    if (v.bar) {
      this.scene.remove(v.bar.group);
      v.bar.dispose();
    }
    if (v.shadow) this.scene.remove(v.shadow);
  }

  clear() {
    for (const v of [...this.map.values()]) this.remove(v);
  }

  // ---------------------------------------------------------------- frame

  update(dt, renderT, time, camPos) {
    const nowMs = performance.now();
    for (const v of [...this.map.values()]) {
      if (renderT - v.lastSeen > 1500) {
        this.remove(v);
        continue;
      }
      const prev = v.pos.clone();
      if (v.buf.sample(renderT, this.tmp)) {
        v.pos.set(this.tmp.x, this.tmp.y, this.tmp.z);
        v.yaw = this.tmp.yaw;
      }
      const speed = Math.hypot(v.pos.x - prev.x, v.pos.z - prev.z) / Math.max(dt, 1e-3);
      const far = camPos.distanceTo(v.pos) > 190;
      v.root.visible = !far;
      if (far) continue;
      v.root.position.copy(v.pos);
      v.root.rotation.y = v.yaw;
      if (v.kind === 1) {
        const u = v.root.userData;
        u.rotor.rotation.y += dt * 28;
        u.tailRotor.rotation.x += dt * 40;
        v.root.rotation.z = Math.sin(time * 1.3 + v.id) * 0.06;
        v.root.rotation.x = 0.08 + (v.recoil || 0) * 0.08;
        v.recoil = Math.max(0, (v.recoil || 0) - dt * 5);
        u.light.visible = Math.sin(time * 6 + v.id) > 0;
        continue;
      }
      const down = v.state === GS.down;
      v.h.setDown(down);
      const anim = down ? ANIM.idle : speed > 9 ? ANIM.run : speed > 0.6 ? ANIM.walk : ANIM.idle;
      v.h.update(dt, anim, speed, false, time);
      if (v.flashT > 0) v.flashT -= dt;
      v.shadow.position.set(v.pos.x, Math.max(v.pos.y, 0) + 0.06, v.pos.z);
      const showBar = !down && nowMs < (v.showBarUntil || 0);
      v.bar.group.visible = showBar;
      if (showBar) {
        v.bar.set(v.hp / 100);
        v.bar.group.position.set(v.pos.x, v.pos.y + 5.6, v.pos.z);
      }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      tr.line.material.opacity = Math.max(0, 1 - tr.t / 0.18);
      if (tr.t > 0.18) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        tr.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }
}
