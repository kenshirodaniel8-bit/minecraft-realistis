// The capture animation after a recruit is paid for (purely visual; the
// server has already moved the monster into the player's collection):
//   1. a glowing ring rises around the monster inside a beam of light while
//      the monster spins and shrinks (monstersView animates the monster),
//   2. it turns into a glowing orb that flies in an arc to the player,
//   3. the orb pops on the player: sparkles, "CAUGHT!", a cheer, and the
//      monster hops out next to them as a follower (playersView).

import * as THREE from 'three';
import { glowSprite } from './labels.js';

export const CAPTURE_SHRINK = 0.9; // seconds the monster spins and shrinks
const SHRINK = CAPTURE_SHRINK;
const FLIGHT = 0.6;   // seconds the orb flies

const ringGeo = new THREE.TorusGeometry(1, 0.09, 8, 40);
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
const orbGeo = new THREE.SphereGeometry(0.42, 16, 12);

export class CaptureFx {
  constructor(scene, effects, audio) {
    this.scene = scene;
    this.effects = effects;
    this.audio = audio;
    this.list = [];
  }

  // from: monster position (feet), height: monster height, color: rarity
  // colour, target(): where the catcher is now (a Vector3 at the feet)
  start({ from, height, color, target, name, mine, onLand }) {
    const c = new THREE.Color(color);
    const ringMat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, depthWrite: false });
    const beamMat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const orbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: c, emissiveIntensity: 1.4, roughness: 0.2 });
    const r = Math.max(1.4, height * 0.75);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(r);
    ring.position.copy(from);
    const ring2 = ring.clone();
    ring2.material = ringMat;
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.scale.set(r * 0.9, 14, r * 0.9);
    beam.position.set(from.x, from.y + 7, from.z);
    const orb = new THREE.Group();
    orb.add(new THREE.Mesh(orbGeo, orbMat));
    const halo = glowSprite(color, 3.2, 0.9);
    orb.add(halo);
    orb.visible = false;
    this.scene.add(ring, ring2, beam, orb);
    this.list.push({ t: 0, from: from.clone(), height, r, ring, ring2, beam, orb, ringMat, beamMat, orbMat, color: c.getHex(), target, name, mine, onLand, landed: false });
    if (this.audio) this.audio.play('capture');
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      const k = Math.min(1, f.t / SHRINK);
      // rings rise up the monster and pulse; the beam fades in, then out
      const ease = 1 - (1 - k) ** 2;
      f.ring.position.y = f.from.y + 0.2 + ease * f.height * 0.9;
      f.ring2.position.y = f.from.y + 0.2 + ease * f.height * 0.35;
      f.ring.rotation.z += dt * 4;
      f.ring.scale.setScalar(f.r * (1 - 0.45 * ease));
      f.ring2.scale.setScalar(f.r * (1.1 - 0.3 * ease));
      f.ringMat.opacity = f.t < SHRINK ? 0.9 : Math.max(0, 0.9 - (f.t - SHRINK) * 3);
      f.beamMat.opacity = f.t < SHRINK ? 0.28 * Math.min(1, f.t * 4) : Math.max(0, 0.28 - (f.t - SHRINK) * 0.8);
      if (f.t < SHRINK && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        this.effects.spawn(f.from.x + Math.cos(a) * f.r, f.from.y + Math.random() * f.height, f.from.z + Math.sin(a) * f.r, {
          vx: -Math.cos(a) * 2, vz: -Math.sin(a) * 2, vy: 2, life: 0.5, size: 0.16, grav: 0, color: [f.color, 0xffffff],
        });
      }
      // the orb
      if (f.t >= SHRINK && !f.landed) {
        const q = Math.min(1, (f.t - SHRINK) / FLIGHT);
        const start = new THREE.Vector3(f.from.x, f.from.y + f.height * 0.6, f.from.z);
        const to = f.target ? f.target() : null;
        if (!to) {
          f.landed = true;
        } else {
          const end = new THREE.Vector3(to.x, to.y + 3, to.z);
          const dist = start.distanceTo(end);
          // an arc: up and over, a bit higher for longer throws
          const p = start.clone().lerp(end, q);
          p.y += Math.sin(q * Math.PI) * (2.5 + dist * 0.25);
          f.orb.position.copy(p);
          f.orb.visible = true;
          f.orb.scale.setScalar(1 + Math.sin(f.t * 30) * 0.08);
          if (Math.random() < 0.8) this.effects.spawn(p.x, p.y, p.z, { speed: 0.6, up: 0.2, life: 0.4, size: 0.18, grav: 0, color: [f.color, 0xffffff] });
          if (q >= 1) {
            f.landed = true;
            f.orb.visible = false;
            this.effects.burst(end.x, end.y, end.z, 26, { color: [f.color, 0xffffff, 0xff9fd8, 0xffe14a], speed: 7, up: 1, life: 0.9, size: 0.24, grav: 6 });
            this.effects.number(f.mine ? `CAUGHT ${f.name}!` : 'CAUGHT!', new THREE.Vector3(end.x, end.y + 3.2, end.z), 'crit');
            if (this.audio && f.mine) this.audio.play('caught');
            if (f.onLand) f.onLand();
          }
        }
      }
      if (f.landed && f.t > SHRINK + FLIGHT + 0.5) {
        this.scene.remove(f.ring, f.ring2, f.beam, f.orb);
        f.ringMat.dispose();
        f.beamMat.dispose();
        f.orbMat.dispose();
        f.orb.children[1]?.material?.dispose();
        this.list.splice(i, 1);
      }
    }
  }
}
