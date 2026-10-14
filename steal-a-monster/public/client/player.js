// Local player movement and physics (client-side prediction). The server
// validates every position this produces (speed, regions, base lasers).

import { CONFIG } from '#shared/config.js';
import { WATER_Y } from '#shared/world.js';
import { ANIM } from './humanoid.js';

const P = CONFIG.player;

export class LocalPlayer {
  constructor(world) {
    this.world = world;
    this.pos = { x: 0, y: 5, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.grounded = false;
    this.swimming = false;
    this.anim = ANIM.idle;
    this.speed = 0;
    this.knockTime = 0;
    this.dodgeTime = 0;
    this.dodgeDir = { x: 0, z: 1 };
    this.onIce = false;
  }

  teleport(x, y, z, yaw) {
    this.pos.x = x;
    this.pos.y = y;
    this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    if (yaw !== undefined) this.yaw = yaw;
  }

  knock(vx, vz, up) {
    this.vel.x += vx * 1.8;
    this.vel.z += vz * 1.8;
    this.vel.y = Math.max(this.vel.y, up * 1.6);
    this.grounded = false;
    this.knockTime = 0.45;
  }

  startDodge() {
    const f = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    this.dodgeDir = f;
    this.dodgeTime = P.dodgeMs / 1000;
  }

  // move: {x, z} in camera space; camFwd: camera forward on the ground plane.
  // opts: { sprint, jump, speedMult, frozen, slipping, canEnter(x, z) -> bool|string,
  //         resolveDynamic(pos), faceYaw }
  update(dt, move, camFwd, opts) {
    const right = { x: -camFwd.z, z: camFwd.x };
    let dx = right.x * move.x + camFwd.x * move.z;
    let dz = right.z * move.x + camFwd.z * move.z;
    const mag = Math.hypot(dx, dz);
    const ground = this.world.groundHeight(this.pos.x, this.pos.z);
    this.swimming = ground < WATER_Y - 1.4 && this.pos.y < WATER_Y - 0.6;
    let speed = (opts.sprint ? P.sprintSpeed : P.walkSpeed) * (opts.speedMult || 1);
    if (this.swimming) speed *= P.swimSpeedFactor;
    if (opts.frozen) speed = 0;
    let tx = mag > 0.01 ? (dx / Math.max(1, mag)) * speed : 0;
    let tz = mag > 0.01 ? (dz / Math.max(1, mag)) * speed : 0;
    if (opts.slipping) {
      tx = this.vel.x;
      tz = this.vel.z;
    }
    // acceleration (less control in the air, while knocked back or on ice)
    let accel = this.grounded || this.swimming ? 14 : 5;
    if (this.knockTime > 0) accel = 1.2;
    if (this.onIce) accel = 2.2;
    const k = Math.min(1, accel * dt);
    if (this.dodgeTime > 0) {
      const v = (P.dodgeDistance / (P.dodgeMs / 1000)) * 0.95;
      this.vel.x = this.dodgeDir.x * v;
      this.vel.z = this.dodgeDir.z * v;
      this.dodgeTime -= dt;
    } else if (!opts.frozen) {
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
    } else {
      this.vel.x *= 0.5;
      this.vel.z *= 0.5;
    }
    this.knockTime = Math.max(0, this.knockTime - dt);
    // facing
    if (opts.faceYaw !== undefined && opts.faceYaw !== null) {
      this.turnTo(opts.faceYaw, dt * 16);
    } else if (mag > 0.05 && !opts.frozen && this.dodgeTime <= 0) {
      this.turnTo(Math.atan2(dx, dz), dt * 12);
    }
    // vertical
    if (this.swimming) {
      const target = WATER_Y - 1.75;
      this.vel.y += (target - this.pos.y) * 10 * dt;
      this.vel.y *= 1 - Math.min(1, dt * 4);
      if (opts.jump) this.vel.y = Math.max(this.vel.y, 6);
    } else {
      this.vel.y -= P.gravity * dt;
      if (opts.jump && this.grounded && !opts.frozen) {
        this.vel.y = P.jumpVelocity;
        this.grounded = false;
      }
    }
    // horizontal move with region/edge blocking (slide along blocked axis)
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    let blocked = null;
    const tryPos = (x, z) => {
      const r = opts.canEnter ? opts.canEnter(x, z) : true;
      if (r !== true) {
        blocked = r;
        return false;
      }
      return true;
    };
    if (tryPos(nx, nz)) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else if (tryPos(nx, this.pos.z)) {
      this.pos.x = nx;
      this.vel.z = 0;
    } else if (tryPos(this.pos.x, nz)) {
      this.pos.z = nz;
      this.vel.x = 0;
    } else {
      this.vel.x = this.vel.z = 0;
    }
    this.pos.y += this.vel.y * dt;
    // props and structures
    this.world.colliders.resolve(this.pos, P.radius, P.height);
    if (opts.resolveDynamic) opts.resolveDynamic(this.pos);
    // ground
    const g = this.world.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= g) {
      this.pos.y = g;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    } else {
      this.grounded = this.pos.y - g < 0.05 && this.vel.y <= 0;
    }
    // stick to slopes when walking downhill
    if (!this.swimming && this.vel.y <= 0 && this.pos.y - g < 0.9 && this.pos.y - g > 0 && this.knockTime <= 0) {
      this.pos.y = g;
      this.grounded = true;
    }
    const lake = this.world.spots.find((s) => s.id === 'frost_lake');
    this.onIce = !!lake && this.grounded && (this.pos.x - lake.x) ** 2 + (this.pos.z - lake.z) ** 2 < lake.r * lake.r;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.dodgeTime > 0) this.anim = ANIM.dodge;
    else if (this.swimming) this.anim = ANIM.swim;
    else if (!this.grounded && this.pos.y - g > 0.6) this.anim = ANIM.air;
    else if (this.speed > P.walkSpeed * 1.1) this.anim = ANIM.run;
    else if (this.speed > 1) this.anim = ANIM.walk;
    else this.anim = ANIM.idle;
    return blocked;
  }

  turnTo(target, rate) {
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, rate);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }
}
