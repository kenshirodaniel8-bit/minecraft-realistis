// Player physics: AABB vs voxel collision, walking, sprinting, sneaking (with
// edge protection), swimming, creative flight, auto-jump and fall damage.
// Pure JS (no Three.js) so it can be unit tested in Node.

import { IS_SOLID, RENDER, B } from './blocks.js';
import { WORLD_HEIGHT } from './constants.js';

const EPS = 1e-4;
const GRAVITY = 30;
const JUMP_VELOCITY = 8.7;
const TERMINAL = 60;

export const SPEEDS = {
  walk: 4.32,
  sprint: 5.6,
  sneak: 1.4,
  swim: 2.6,
  fly: 10.8,
  flySprint: 21.6,
};

export class PlayerPhysics {
  constructor(world) {
    this.world = world;
    this.x = 0; this.y = 80; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.width = 0.6;
    this.height = 1.8;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.flying = false;
    this.sneaking = false;
    this.sprinting = false;
    this.canFly = true;
    this.autoJump = true;
    this.fallDistance = 0;
    this.collidedH = false;
    this.lastJumpTap = -1;
    this.onLand = null; // callback(fallDistance)
    this.walkDist = 0;
  }

  get eyeHeight() { return this.sneaking && !this.flying ? 1.32 : 1.62; }

  isSolidAt(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    if (id < 0) return true; // unloaded chunks are walls
    return IS_SOLID[id] === 1;
  }

  // Does the player's box at (x, y, z) overlap any solid block?
  collides(x, y, z) {
    const hw = this.width / 2;
    const x0 = Math.floor(x - hw + EPS), x1 = Math.floor(x + hw - EPS);
    const y0 = Math.floor(y + EPS), y1 = Math.floor(y + this.height - EPS);
    const z0 = Math.floor(z - hw + EPS), z1 = Math.floor(z + hw - EPS);
    for (let by = y0; by <= y1; by++) {
      if (by >= WORLD_HEIGHT) continue;
      for (let bz = z0; bz <= z1; bz++) {
        for (let bx = x0; bx <= x1; bx++) {
          if (this.isSolidAt(bx, by, bz)) return true;
        }
      }
    }
    return false;
  }

  // Moves along one axis, stopping at the first solid block. Returns true on collision.
  moveAxis(axis, delta) {
    if (delta === 0) return false;
    const hw = this.width / 2;
    let collided = false;
    if (axis === 1) {
      const ny = this.y + delta;
      const x0 = Math.floor(this.x - hw + EPS), x1 = Math.floor(this.x + hw - EPS);
      const z0 = Math.floor(this.z - hw + EPS), z1 = Math.floor(this.z + hw - EPS);
      if (delta < 0) {
        const by = Math.floor(ny);
        if (by < Math.floor(this.y + EPS)) {
          for (let bz = z0; bz <= z1 && !collided; bz++) for (let bx = x0; bx <= x1; bx++) {
            if (this.isSolidAt(bx, by, bz)) { collided = true; break; }
          }
        }
        this.y = collided ? by + 1 : ny;
      } else {
        const by = Math.floor(ny + this.height);
        if (by > Math.floor(this.y + this.height - EPS) && by < WORLD_HEIGHT) {
          for (let bz = z0; bz <= z1 && !collided; bz++) for (let bx = x0; bx <= x1; bx++) {
            if (this.isSolidAt(bx, by, bz)) { collided = true; break; }
          }
        }
        this.y = collided ? by - this.height - EPS : ny;
      }
      return collided;
    }

    const isX = axis === 0;
    const pos = isX ? this.x : this.z;
    const np = pos + delta;
    const y0 = Math.floor(this.y + EPS), y1 = Math.min(WORLD_HEIGHT - 1, Math.floor(this.y + this.height - EPS));
    const o0 = Math.floor((isX ? this.z : this.x) - hw + EPS), o1 = Math.floor((isX ? this.z : this.x) + hw - EPS);
    let edgeBlock;
    if (delta > 0) {
      edgeBlock = Math.floor(np + hw);
      if (edgeBlock > Math.floor(pos + hw - EPS)) {
        for (let by = y0; by <= y1 && !collided; by++) for (let o = o0; o <= o1; o++) {
          const solid = isX ? this.isSolidAt(edgeBlock, by, o) : this.isSolidAt(o, by, edgeBlock);
          if (solid) { collided = true; break; }
        }
      }
      const result = collided ? edgeBlock - hw - EPS : np;
      if (isX) this.x = result; else this.z = result;
    } else {
      edgeBlock = Math.floor(np - hw);
      if (edgeBlock < Math.floor(pos - hw + EPS)) {
        for (let by = y0; by <= y1 && !collided; by++) for (let o = o0; o <= o1; o++) {
          const solid = isX ? this.isSolidAt(edgeBlock, by, o) : this.isSolidAt(o, by, edgeBlock);
          if (solid) { collided = true; break; }
        }
      }
      const result = collided ? edgeBlock + 1 + hw + EPS : np;
      if (isX) this.x = result; else this.z = result;
    }
    return collided;
  }

  hasGroundBelow(x, z) {
    const hw = this.width / 2;
    const by = Math.floor(this.y - 0.05);
    const x0 = Math.floor(x - hw + EPS), x1 = Math.floor(x + hw - EPS);
    const z0 = Math.floor(z - hw + EPS), z1 = Math.floor(z + hw - EPS);
    for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) {
      if (this.isSolidAt(bx, by, bz)) return true;
    }
    return false;
  }

  updateLiquidState() {
    const hw = this.width / 2;
    let inWater = false;
    const y0 = Math.floor(this.y + 0.1), y1 = Math.floor(this.y + 0.9);
    for (let by = y0; by <= y1 && !inWater; by++) {
      for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) {
        const id = this.world.getBlock(Math.floor(this.x + ox * 0.9), by, Math.floor(this.z + oz * 0.9));
        if (id === B.WATER) { inWater = true; break; }
      }
    }
    this.inWater = inWater;
    const eyeY = this.y + this.eyeHeight;
    const eyeBlock = this.world.getBlock(Math.floor(this.x), Math.floor(eyeY), Math.floor(this.z));
    let headIn = eyeBlock === B.WATER;
    if (headIn) {
      // Water surfaces sit at 14/16 of a block when nothing is above.
      const above = this.world.getBlock(Math.floor(this.x), Math.floor(eyeY) + 1, Math.floor(this.z));
      if (above !== B.WATER && eyeY - Math.floor(eyeY) > 0.86) headIn = false;
    }
    this.headInWater = headIn;
  }

  // If the player ended up inside a block (spawned in terrain, a block placed
  // by someone else...) push them up to the nearest free spot.
  unstuck() {
    if (!this.collides(this.x, this.y, this.z)) return false;
    for (let i = 1; i < WORLD_HEIGHT; i++) {
      const ny = Math.floor(this.y) + i;
      if (ny + this.height >= WORLD_HEIGHT + 2) break;
      if (!this.collides(this.x, ny, this.z)) {
        this.y = ny;
        this.vy = 0;
        return true;
      }
    }
    return false;
  }

  // controls: { forward, back, left, right, jump, sneak, sprint, jumpPressed }
  step(dt, c) {
    // Toggle flight by double tapping jump.
    if (c.jumpPressed && this.canFly) {
      if (this.lastJumpTap >= 0 && c.time - this.lastJumpTap < 0.3) {
        this.flying = !this.flying;
        this.vy = 0;
        this.lastJumpTap = -1;
      } else {
        this.lastJumpTap = c.time;
      }
    }
    if (!this.canFly) this.flying = false;

    this.updateLiquidState();
    this.sneaking = !!c.sneak && !this.flying;

    // Wish direction from yaw (yaw = 0 looks towards -Z).
    let fx = 0, fz = 0;
    const f = (c.forward ? 1 : 0) - (c.back ? 1 : 0);
    const s = (c.right ? 1 : 0) - (c.left ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    fx = -sin * f + cos * s;
    fz = -cos * f - sin * s;
    const len = Math.hypot(fx, fz);
    if (len > 1e-6) { fx /= len; fz /= len; }
    const moving = len > 1e-6;

    this.sprinting = !!c.sprint && f > 0 && !this.sneaking && (!this.inWater || this.flying);
    if (this.collidedH && !this.flying) this.sprinting = this.sprinting && moving;

    let speed;
    if (this.flying) speed = this.sprinting ? SPEEDS.flySprint : SPEEDS.fly;
    else if (this.inWater) speed = SPEEDS.swim * (this.sprinting ? 1.3 : 1);
    else if (this.sneaking) speed = SPEEDS.sneak;
    else if (this.sprinting) speed = SPEEDS.sprint;
    else speed = SPEEDS.walk;

    const tx = fx * speed, tz = fz * speed;
    let accel;
    if (this.flying) accel = 9;
    else if (this.inWater) accel = 6;
    else if (this.onGround) accel = 14;
    else accel = 2.6;
    const k = Math.min(1, accel * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;

    // Vertical motion.
    if (this.flying) {
      const up = (c.jump ? 1 : 0) - (c.sneak ? 1 : 0);
      const target = up * 8;
      this.vy += (target - this.vy) * Math.min(1, (up ? 10 : 16) * dt);
    } else if (this.inWater) {
      this.vy -= 6 * dt;
      this.vy *= Math.pow(0.12, dt);
      if (c.jump) {
        this.vy = Math.max(this.vy, this.collidedH ? 5.2 : 3.6);
      }
      this.vy = Math.max(this.vy, -4);
    } else {
      if (c.jump && this.onGround) {
        this.vy = JUMP_VELOCITY;
        this.onGround = false;
      }
      this.vy -= GRAVITY * dt;
      if (this.vy < -TERMINAL) this.vy = -TERMINAL;
    }

    // Auto jump onto single block steps while walking.
    if (this.autoJump && this.onGround && !this.flying && !this.inWater && moving && !this.sneaking) {
      const probe = 0.45;
      const ax = this.x + fx * probe, az = this.z + fz * probe;
      const footY = Math.floor(this.y + EPS);
      if (this.isSolidAt(Math.floor(ax), footY, Math.floor(az)) &&
          !this.isSolidAt(Math.floor(ax), footY + 1, Math.floor(az)) &&
          !this.isSolidAt(Math.floor(ax), footY + 2, Math.floor(az)) &&
          !this.isSolidAt(Math.floor(this.x), footY + 2, Math.floor(this.z))) {
        this.vy = JUMP_VELOCITY;
        this.onGround = false;
      }
    }

    // Integrate with sub-steps so fast motion never tunnels through blocks.
    const dx = this.vx * dt, dy = this.vy * dt, dz = this.vz * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.35));
    let landed = false, hitHead = false, colX = false, colZ = false;
    const startY = this.y;
    for (let i = 0; i < steps; i++) {
      const sy = dy / steps;
      if (this.moveAxis(1, sy)) {
        if (sy < 0) landed = true; else hitHead = true;
      }
      const sx = dx / steps;
      const px = this.x;
      if (this.moveAxis(0, sx)) colX = true;
      if (this.sneaking && (this.onGround || landed) && !this.hasGroundBelow(this.x, this.z) && this.hasGroundBelow(px, this.z)) {
        this.x = px; this.vx = 0;
      }
      const sz = dz / steps;
      const pz = this.z;
      if (this.moveAxis(2, sz)) colZ = true;
      if (this.sneaking && (this.onGround || landed) && !this.hasGroundBelow(this.x, this.z) && this.hasGroundBelow(this.x, pz)) {
        this.z = pz; this.vz = 0;
      }
    }
    if (colX) this.vx = 0;
    if (colZ) this.vz = 0;
    this.collidedH = colX || colZ;

    if (hitHead && this.vy > 0) this.vy = 0;
    const wasOnGround = this.onGround;
    if (landed) {
      this.onGround = true;
      if (this.vy < 0) this.vy = 0;
      if (this.flying && c.sneak) this.flying = false;
    } else {
      // Still standing if there is ground right below us.
      this.onGround = this.vy <= 0 && this.hasGroundBelow(this.x, this.z) && Math.abs(this.y - Math.round(this.y)) < 0.01;
    }

    // Fall distance + landing.
    if (this.flying || this.inWater) {
      this.fallDistance = 0;
    } else if (this.y < startY) {
      this.fallDistance += startY - this.y;
    }
    if (this.onGround && !wasOnGround) {
      if (this.onLand) this.onLand(this.fallDistance);
      this.fallDistance = 0;
    } else if (this.onGround) {
      this.fallDistance = 0;
    }

    if (this.onGround && !this.flying) {
      this.walkDist += Math.hypot(this.vx, this.vz) * dt;
    }

    // Keep inside the world vertically.
    if (this.y < -64) {
      this.y = WORLD_HEIGHT + 10;
      this.vy = 0;
    }
    if (this.y > WORLD_HEIGHT + 64) { this.y = WORLD_HEIGHT + 64; this.vy = Math.min(this.vy, 0); }
  }
}
