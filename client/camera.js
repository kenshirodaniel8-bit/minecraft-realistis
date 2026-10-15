// Third-person orbit camera that follows the player and avoids the ground.

import * as THREE from 'three';
import { WATER_Y } from '#shared/world.js';

export class ThirdPersonCamera {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = Math.PI;      // camera looks along -yaw direction toward the player
    this.pitch = 0.32;
    this.distance = 15;
    this.target = new THREE.Vector3();
    this.smoothed = new THREE.Vector3();
    this.shake = 0;
    this.invertY = false;
  }

  // yaw convention: the camera sits behind the player at angle `yaw`;
  // "forward" for movement is (sin(yaw+PI), cos(yaw+PI)).
  forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  addShake(amount) {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  // indoor: { base, floorY } while the player is inside a base tower: the
  // camera then stays inside the walls and under the ceiling of that floor.
  update(dt, focus, look, zoom, indoor = null) {
    this.yaw -= look.x * 0.0042;
    this.pitch += (this.invertY ? -1 : 1) * look.y * 0.0036;
    this.pitch = Math.max(-0.35, Math.min(1.35, this.pitch));
    this.distance = Math.max(6, Math.min(34, this.distance + zoom * 1.6));
    this.target.set(focus.x, focus.y + 3.6, focus.z);
    if (this.smoothed.lengthSq() === 0) this.smoothed.copy(this.target);
    this.smoothed.lerp(this.target, Math.min(1, dt * 14));
    const cp = Math.cos(this.pitch);
    let d = this.distance;
    const pos = new THREE.Vector3(
      this.smoothed.x + Math.sin(this.yaw) * cp * d,
      this.smoothed.y + Math.sin(this.pitch) * d,
      this.smoothed.z + Math.cos(this.yaw) * cp * d,
    );
    // keep the camera above the terrain (pull in if a hill is in the way)
    for (let i = 0; i < 6; i++) {
      const g = Math.max(this.world.groundHeight(pos.x, pos.z), WATER_Y - 0.5) + 1.2;
      if (pos.y >= g) break;
      d *= 0.8;
      pos.set(
        this.smoothed.x + Math.sin(this.yaw) * cp * d,
        this.smoothed.y + Math.sin(this.pitch) * d,
        this.smoothed.z + Math.cos(this.yaw) * cp * d,
      );
    }
    const g = Math.max(this.world.groundHeight(pos.x, pos.z), WATER_Y - 0.5) + 1.2;
    if (pos.y < g) pos.y = g;
    if (indoor) this.keepInside(pos, indoor);
    if (this.shake > 0) {
      pos.x += (Math.random() - 0.5) * this.shake * 0.5;
      pos.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(this.smoothed);
  }

  keepInside(pos, { base, floorY, floorHeight }) {
    const lim = base.half - 1.4;
    const dx = pos.x - base.x;
    const dz = pos.z - base.z;
    let u = dx * base.tu.x + dz * base.tu.z;
    let v = dx * base.tv.x + dz * base.tv.z;
    u = Math.max(-lim, Math.min(lim, u));
    v = Math.max(-lim, Math.min(lim, v));
    pos.x = base.x + base.tu.x * u + base.tv.x * v;
    pos.z = base.z + base.tu.z * u + base.tv.z * v;
    pos.y = Math.max(floorY + 1.2, Math.min(floorY + floorHeight - 0.9, pos.y));
  }
}
