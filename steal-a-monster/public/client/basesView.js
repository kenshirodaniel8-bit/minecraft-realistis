// Player bases: monster pads, the monsters standing on them, the security
// laser gate, the Money collector, lock pad, upgrade terminal and the owner's
// sign. Driven by 'base' messages from the server.

import * as THREE from 'three';
import { SPECIES_BY_ID } from '#shared/monsters.js';
import { CONFIG } from '#shared/config.js';
import { buildMonster } from './monsterRenderer.js';
import { animateMonster, QUIRK_NAMES } from './animationSystem.js';
import { makeLabel, disposeLabel } from './labels.js';
import { boxCollider } from '#shared/collision.js';

const PALETTE = [0x3a7ae0, 0xe84a5f, 0x3fbf5a, 0xffb02a, 0x9a5ae0, 0x2ac8c8, 0xff7ab8, 0x5a5a6a];

function std(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...o });
}

export class BasesView {
  constructor(scene, world, effects, audio) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.views = world.bases.map((b) => this.buildBase(b));
    this.states = new Array(world.bases.length).fill(null);
    this.myIndex = -1;
  }

  buildBase(b) {
    const g = new THREE.Group();
    this.scene.add(g);
    const view = { base: b, group: g, pads: [], monsters: new Map(), lasers: [], state: null };
    const padGeo = new THREE.CylinderGeometry(1.7, 1.9, 0.5, 24);
    b.slots.forEach((s, i) => {
      const pad = new THREE.Mesh(padGeo, std(0xbfc6d8));
      pad.position.set(s.x, b.y + 0.25, s.z);
      pad.receiveShadow = true;
      g.add(pad);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.12, 6, 28), std(0xffffff, { emissive: 0x000000 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(s.x, b.y + 0.52, s.z);
      g.add(ring);
      view.pads.push({ pad, ring, slot: i, label: null, labelKey: '' });
    });
    // collector
    const col = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.4, 28), std(0xffd23a, { metalness: 0.4, roughness: 0.3, emissive: 0x3a2a00 }));
    col.position.set(b.collector.x, b.y + 0.2, b.collector.z);
    g.add(col);
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.25, 24), std(0xffe14a, { metalness: 0.6, roughness: 0.25, emissive: 0x4a3a00 }));
    coin.rotation.x = Math.PI / 2;
    coin.position.set(b.collector.x, b.y + 2.2, b.collector.z);
    g.add(coin);
    view.coin = coin;
    // lock pad (big red button)
    const lockBase = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.4, 20), std(0x3a3a4a));
    lockBase.position.set(b.lockPad.x, b.y + 0.2, b.lockPad.z);
    const lockBtn = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.4, 20), std(0xff3a4a, { emissive: 0x4a0000 }));
    lockBtn.position.set(b.lockPad.x, b.y + 0.55, b.lockPad.z);
    g.add(lockBase, lockBtn);
    view.lockBtn = lockBtn;
    const lockLabel = makeLabel('🔒 LOCK', { scale: 0.016, bg: '#d8384a', color: '#ffffff' });
    lockLabel.position.set(b.lockPad.x, b.y + 2.3, b.lockPad.z);
    g.add(lockLabel);
    // terminal
    const term = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 1.0), std(0x4a5a7a));
    term.position.set(b.terminal.x, b.y + 1.3, b.terminal.z);
    term.rotation.y = b.yaw;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.0), new THREE.MeshBasicMaterial({ color: 0x5affd8 }));
    screen.position.set(b.terminal.x + Math.sin(b.yaw) * 0.51, b.y + 1.9, b.terminal.z + Math.cos(b.yaw) * 0.51);
    screen.rotation.y = b.yaw;
    g.add(term, screen);
    const termLabel = makeLabel('⬆ UPGRADES', { scale: 0.016, bg: '#3a4a7a', color: '#ffffff' });
    termLabel.position.set(b.terminal.x, b.y + 3.6, b.terminal.z);
    g.add(termLabel);
    // laser gate (3 beams across the door)
    const doorHalf = CONFIG.bases.doorWidth / 2;
    const laserMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.85 });
    for (let k = 0; k < 4; k++) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, doorHalf * 2 + 0.6, 6), laserMat);
      beam.position.set(b.door.x, b.y + 0.9 + k * 1.6, b.door.z);
      beam.rotation.z = Math.PI / 2;
      beam.rotation.y = Math.atan2(-b.tu.z, b.tu.x);
      beam.visible = false;
      g.add(beam);
      view.lasers.push(beam);
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(doorHalf * 2 + 0.5, 6.6), new THREE.MeshBasicMaterial({ color: 0xff3a4a, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    glow.position.set(b.door.x, b.y + 3.3, b.door.z);
    glow.rotation.y = b.yaw;
    glow.visible = false;
    g.add(glow);
    view.laserGlow = glow;
    // dynamic collider used by the local player's physics when lasers are on
    view.gateCollider = boxCollider(b.door.x, b.door.z, doorHalf + 0.4, 0.6, Math.atan2(b.tu.z, b.tu.x), b.y - 2, b.y + 10);
    view.gateCollider.br = doorHalf + 1;
    // banner flag
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 6), std(0xd8d8e0));
    const flagPos = b.toWorld(b.half - 1.5, b.half + 0.5);
    pole.position.set(flagPos.x, b.y + 4.5, flagPos.z);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), std(0xcccccc, { side: THREE.DoubleSide }));
    flag.position.set(flagPos.x + b.tu.x * 1.3, b.y + 8, flagPos.z + b.tu.z * 1.3);
    flag.rotation.y = b.yaw + Math.PI / 2;
    g.add(pole, flag);
    view.flag = flag;
    this.setSign(view, `Plot ${b.index + 1}\nFREE`, '#ffffff', '#5a5a6a');
    return view;
  }

  setSign(view, text, color, bg) {
    if (view.sign) {
      view.group.remove(view.sign);
      disposeLabel(view.sign);
    }
    const b = view.base;
    view.sign = makeLabel(text, { scale: 0.018, color, bg, border: '#ffffff' });
    const p = b.toWorld(0, b.half + 0.5);
    view.sign.position.set(p.x, b.y + 10, p.z);
    view.group.add(view.sign);
  }

  colorOf(st) {
    return Number.isInteger(st.color) ? st.color : PALETTE[(st.pn || 0) % PALETTE.length];
  }

  apply(st) {
    const view = this.views[st.index];
    if (!view) return;
    const prev = view.state;
    view.state = st.empty ? null : st;
    this.states[st.index] = view.state;
    if (st.empty) {
      this.setSign(view, `Plot ${st.index + 1}\nFREE`, '#ffffff', '#5a5a6a');
      view.flag.material.color.setHex(0xcccccc);
      for (const [id, m] of view.monsters) this.removeMonster(view, id, m);
      view.pads.forEach((p) => this.padStyle(p, false, null));
      this.setLasers(view, false);
      return;
    }
    const color = this.colorOf(st);
    const hex = '#' + color.toString(16).padStart(6, '0');
    if (!prev || prev.name !== st.name || prev.color !== st.color || prev.level !== st.level) {
      this.setSign(view, `${st.name}'s Base\nLv ${st.level}`, '#ffffff', hex);
    }
    view.flag.material.color.setHex(color);
    view.pads.forEach((p, i) => this.padStyle(p, i < st.slots, color));
    // monsters on pads
    const wanted = new Map(st.monsters.filter((m) => !m.away).map((m) => [m.id, m]));
    for (const [id, m] of view.monsters) {
      const w = wanted.get(id);
      if (!w || w.slot !== m.slot) this.removeMonster(view, id, m, !w);
    }
    for (const m of wanted.values()) {
      if (!view.monsters.has(m.id)) this.addMonster(view, m);
    }
    for (const p of view.pads) {
      const m = st.monsters.find((x) => x.slot === p.slot);
      const key = m ? `${m.species}|${m.level}|${m.away}` : '';
      if (key !== p.labelKey) {
        if (p.label) {
          view.group.remove(p.label);
          disposeLabel(p.label);
          p.label = null;
        }
        if (m) {
          const sp = SPECIES_BY_ID[m.species];
          p.label = makeLabel(m.away ? `${sp.name}\n⚠ BEING STOLEN!` : `${sp.name} Lv ${m.level}\n$${m.income}/s`, { scale: 0.013, colors: ['#ffffff', m.away ? '#ff6a7a' : '#7ef06a'] });
          const s = view.base.slots[p.slot];
          p.label.position.set(s.x, view.base.y + 4.6, s.z);
          view.group.add(p.label);
        }
        p.labelKey = key;
      }
    }
    this.setLasers(view, st.lockedUntil > 0);
    if (prev && !(prev.lockedUntil > 0) && st.lockedUntil > 0) this.audio.play('laser');
    this.setStored(view, st.stored);
  }

  padStyle(p, unlocked, color) {
    p.pad.material.color.setHex(unlocked ? 0xf3f1ea : 0x8a8f9a);
    p.ring.material.color.setHex(unlocked && color ? color : 0x6a6f7a);
    p.ring.material.emissive.setHex(unlocked && color ? new THREE.Color(color).multiplyScalar(0.3).getHex() : 0);
  }

  setLasers(view, on) {
    for (const l of view.lasers) l.visible = on;
    view.laserGlow.visible = on;
    view.locked = on;
  }

  setStored(view, amount) {
    if (view.storedAmount === amount) return;
    view.storedAmount = amount;
    if (view.storedLabel) {
      view.group.remove(view.storedLabel);
      disposeLabel(view.storedLabel);
    }
    const b = view.base;
    view.storedLabel = makeLabel(`$${Math.floor(amount).toLocaleString()}`, { scale: 0.022, color: '#7ef06a', font: '900 46px "Trebuchet MS", system-ui, sans-serif' });
    view.storedLabel.position.set(b.collector.x, b.y + 3.8, b.collector.z);
    view.group.add(view.storedLabel);
  }

  setStoredAll(list) {
    for (const [i, amount] of list) if (this.views[i] && this.views[i].state) this.setStored(this.views[i], amount);
  }

  addMonster(view, m) {
    const sp = SPECIES_BY_ID[m.species];
    if (!sp) return;
    const rig = buildMonster(sp.id);
    const s = Math.min(sp.size, 3.3 / rig.height);
    rig.root.scale.setScalar(s);
    const slot = view.base.slots[m.slot];
    rig.root.position.set(slot.x, view.base.y + 0.5, slot.z);
    rig.root.rotation.y = view.base.yaw;
    rig.baseYaw = view.base.yaw;
    rig.st = { pose: 'celebrate', poseT: 0 };
    rig.nextQuirk = 2 + Math.random() * 6;
    this.scene.add(rig.root);
    view.monsters.set(m.id, { rig, slot: m.slot, species: sp });
    this.effects.burst(slot.x, view.base.y + 1.5, slot.z, 14, { color: [0xffe14a, 0xffffff, 0xff9fd8], speed: 4 });
  }

  removeMonster(view, id, m, poof = true) {
    this.scene.remove(m.rig.root);
    view.monsters.delete(id);
    if (poof) {
      const p = m.rig.root.position;
      this.effects.burst(p.x, p.y + 1, p.z, 10, { color: [0xffffff, 0xd8d8ff], speed: 3 });
    }
  }

  // colliders for the local player (closed laser gates of other bases)
  resolveGates(pos, myIndex) {
    for (const view of this.views) {
      if (!view.locked || view.base.index === myIndex) continue;
      const c = view.gateCollider;
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      if (dx * dx + dz * dz > 100) continue;
      const lu = dx * c.ax + dz * c.az;
      const lv = -dx * c.az + dz * c.ax;
      const r = 0.9;
      if (Math.abs(lu) < c.hw + r && Math.abs(lv) < c.hd + r) {
        // push out along the door normal
        const push = (c.hd + r - Math.abs(lv)) * (Math.sign(lv) || 1);
        pos.x += -c.az * push;
        pos.z += c.ax * push;
      }
    }
  }

  update(dt, t, players) {
    for (const view of this.views) {
      if (!view.state) continue;
      view.coin.rotation.z = t * 2;
      view.coin.position.y = view.base.y + 2.2 + Math.sin(t * 2) * 0.2;
      if (view.locked) {
        for (const l of view.lasers) l.material.opacity = 0.65 + Math.sin(t * 20) * 0.25;
        view.lockBtn.material.emissive.setHex(0x00aa44);
        view.lockBtn.material.color.setHex(0x3fd85a);
      } else {
        view.lockBtn.material.emissive.setHex(0x4a0000);
        view.lockBtn.material.color.setHex(0xff3a4a);
        view.lockBtn.position.y = view.base.y + 0.55 + Math.max(0, Math.sin(t * 4)) * 0.08;
      }
      for (const m of view.monsters.values()) {
        const rig = m.rig;
        const st = rig.st;
        st.poseT += 0;
        // look at the closest player nearby, with personality idles in between
        let look = null;
        let bestD = 15;
        for (const p of players) {
          const d = Math.hypot(p.x - rig.root.position.x, p.z - rig.root.position.z);
          if (d < bestD) {
            bestD = d;
            look = p;
          }
        }
        rig.nextQuirk -= dt;
        if (st.pose === 'celebrate' && st.poseT > 1.6) {
          st.pose = 'idle';
          st.poseT = 0;
        } else if (st.pose === 'quirk' && st.poseT > 3.5) {
          st.pose = 'idle';
          st.poseT = 0;
        } else if (st.pose === 'idle' && rig.nextQuirk < 0) {
          const idles = m.species.personality.idles;
          st.pose = 'quirk';
          st.quirk = Math.random() < 0.75 ? idles[Math.floor(Math.random() * idles.length)] : QUIRK_NAMES[Math.floor(Math.random() * QUIRK_NAMES.length)];
          st.quirkDur = 3.5;
          st.poseT = 0;
          rig.nextQuirk = 5 + Math.random() * 8;
        }
        if (look && st.pose === 'idle') {
          const want = Math.atan2(look.x - rig.root.position.x, look.z - rig.root.position.z);
          let d = want - rig.root.rotation.y;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          rig.root.rotation.y += d * Math.min(1, dt * 3);
        } else {
          let d = rig.baseYaw - rig.root.rotation.y;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          rig.root.rotation.y += d * Math.min(1, dt * 1.5);
        }
        animateMonster(rig, st, dt, t);
        if (rig.sparking && Math.random() < dt * 10) this.effects.aura('spark', rig.root.position.x, rig.root.position.y + 2, rig.root.position.z);
        if (rig.blowing && Math.random() < dt * 3) this.effects.aura('bubble', rig.root.position.x, rig.root.position.y + 2, rig.root.position.z);
      }
    }
  }

  // placed monster nearest to a position (for stealing prompts)
  nearestPlaced(pos, maxD, exceptIndex) {
    let best = null;
    let bd = maxD;
    for (const view of this.views) {
      if (!view.state || view.base.index === exceptIndex) continue;
      for (const [id, m] of view.monsters) {
        const s = view.base.slots[m.slot];
        const d = Math.hypot(pos.x - s.x, pos.z - s.z);
        if (d < bd) {
          bd = d;
          best = { id, view, m, slot: s };
        }
      }
    }
    return best;
  }
}
