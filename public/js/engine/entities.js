// Other players in multiplayer: skinned models, name tags and smooth
// interpolation between network snapshots.

import { PlayerModel, createNameTag, skinCanvasFromDataUrl, createDefaultSkinCanvas } from './skin.js';
import { BLOCKS } from './blocks.js';

const INTERP_DELAY = 0.12; // seconds behind the newest snapshot

export const FLAG_SNEAK = 1;
export const FLAG_FLY = 2;
export const FLAG_SWING = 4;

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class RemotePlayer {
  constructor(scene, info) {
    this.id = info.id;
    this.name = info.name;
    this.scene = scene;
    this.model = new PlayerModel(createDefaultSkinCanvas('explorer'), !!info.slim);
    this.group = this.model.group;
    this.nameTag = createNameTag(this.name);
    this.nameTag.position.set(0, 2.15, 0);
    this.group.add(this.nameTag);
    scene.add(this.group);
    this.snapshots = [];
    this.x = info.x || 0; this.y = info.y || 0; this.z = info.z || 0;
    this.yaw = info.yaw || 0; this.pitch = info.pitch || 0;
    this.bodyYaw = this.yaw;
    this.flags = 0;
    this.swing = 0;
    this.lastSwingFlag = false;
    this.held = 0;
    this.prevX = this.x; this.prevZ = this.z;
    this.disposed = false;
    this.group.position.set(this.x, this.y, this.z);
    if (info.skin) this.setSkin(info.skin, !!info.slim);
  }

  async setSkin(dataUrl, slim) {
    const canvas = await skinCanvasFromDataUrl(dataUrl);
    if (this.disposed) return;
    this.model.setSkin(canvas, !!slim);
  }

  push(time, s) {
    this.snapshots.push({ time, x: s[0], y: s[1], z: s[2], yaw: s[3], pitch: s[4], flags: s[5] | 0, held: s[6] | 0 });
    if (this.snapshots.length > 30) this.snapshots.shift();
  }

  update(dt, now, world) {
    const renderTime = now - INTERP_DELAY;
    const snaps = this.snapshots;
    if (snaps.length) {
      // Drop snapshots we have fully passed (keep one before renderTime).
      while (snaps.length >= 2 && snaps[1].time <= renderTime) snaps.shift();
      let s0 = snaps[0], s1 = snaps[1] || snaps[0];
      let t = 1;
      if (s1 !== s0 && s1.time > s0.time) t = Math.min(1, Math.max(0, (renderTime - s0.time) / (s1.time - s0.time)));
      this.x = s0.x + (s1.x - s0.x) * t;
      this.y = s0.y + (s1.y - s0.y) * t;
      this.z = s0.z + (s1.z - s0.z) * t;
      this.yaw = lerpAngle(s0.yaw, s1.yaw, t);
      this.pitch = s0.pitch + (s1.pitch - s0.pitch) * t;
      this.flags = s1.flags;
      this.held = s1.held;
    }
    const swingFlag = (this.flags & FLAG_SWING) !== 0;
    if (swingFlag && !this.lastSwingFlag && this.swing === 0) this.swing = 0.0001;
    this.lastSwingFlag = swingFlag;
    if (this.swing > 0) { this.swing += dt * 3.6; if (this.swing >= 1) this.swing = 0; }

    const speed = dt > 0 ? Math.hypot(this.x - this.prevX, this.z - this.prevZ) / dt : 0;
    this.prevX = this.x; this.prevZ = this.z;

    // Body turns towards the head (like Minecraft).
    let diff = this.yaw - this.bodyYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxDiff = speed > 0.5 ? 0.3 : 0.8;
    if (diff > maxDiff) this.bodyYaw = this.yaw - maxDiff;
    else if (diff < -maxDiff) this.bodyYaw = this.yaw + maxDiff;
    if (speed > 0.5) this.bodyYaw = lerpAngle(this.bodyYaw, this.yaw, Math.min(1, dt * 6));
    let headYaw = this.yaw - this.bodyYaw;
    while (headYaw > Math.PI) headYaw -= Math.PI * 2;
    while (headYaw < -Math.PI) headYaw += Math.PI * 2;

    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.bodyYaw + Math.PI;
    this.model.animate({
      speed, dt, pitch: this.pitch, headYaw,
      sneaking: (this.flags & FLAG_SNEAK) !== 0, swinging: this.swing, flying: (this.flags & FLAG_FLY) !== 0,
    });
    this.nameTag.position.y = (this.flags & FLAG_SNEAK) ? 1.95 : 2.15;
    if (world) {
      const l = world.getLight(Math.floor(this.x), Math.floor(this.y + 1.2), Math.floor(this.z));
      this.model.setLight(l.sky, l.block);
    }
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.group);
    this.model.dispose();
    this.nameTag.material.map.dispose();
    this.nameTag.material.dispose();
  }
}

export function heldName(id) {
  return BLOCKS[id] ? BLOCKS[id].name : '';
}

