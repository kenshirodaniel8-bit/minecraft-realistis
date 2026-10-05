// Creatures: pigs and cows wander the grasslands (food), zombies come out at
// night and in dark caves. Uses the player physics for movement/collisions.

import * as THREE from 'three';
import { PlayerPhysics } from './player.js';
import { PlayerModel, createDefaultSkinCanvas } from './skin.js';
import { createEntityMaterial, U } from './materials.js';
import { B, IS_SOLID } from './blocks.js';
import { I } from './items.js';
import { WORLD_HEIGHT } from './constants.js';

export const MOB_TYPES = {
  zombie: { hostile: true, health: 20, width: 0.6, height: 1.9, speed: 0.72, damage: 3, drops: [] },
  pig: { hostile: false, health: 10, width: 0.85, height: 0.9, speed: 0.38, fleeSpeed: 0.9, drops: [[I.RAW_MEAT, 1, 3]] },
  cow: { hostile: false, health: 10, width: 0.9, height: 1.35, speed: 0.36, fleeSpeed: 0.85, drops: [[I.RAW_MEAT, 1, 3]] },
};

const MAX_PASSIVE = 8;
const MAX_HOSTILE = 6;
const DESPAWN_DIST = 80;

let zombieSkin = null;

// ------------------------------------------------------------------ models

function noiseTexture(base, opts = {}) {
  const S = 16;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    let col = base;
    if (opts.spots) {
      const x = i % S, y = (i / S) | 0;
      for (const [sx, sy, r, sc] of opts.spots) if ((x - sx) ** 2 + (y - sy) ** 2 < r * r) col = sc;
    }
    const f = 0.88 + Math.random() * 0.2;
    img.data[i * 4] = Math.min(255, col[0] * f);
    img.data[i * 4 + 1] = Math.min(255, col[1] * f);
    img.data[i * 4 + 2] = Math.min(255, col[2] * f);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (opts.face) opts.face(ctx);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class AnimalModel {
  constructor(kind) {
    this.group = new THREE.Group();
    this.materials = [];
    this.textures = [];
    this.legs = [];
    const mat = (tex) => {
      const m = createEntityMaterial({ map: tex });
      this.materials.push(m);
      this.textures.push(tex);
      return m;
    };
    const box = (w, h, d, material, x, y, z, parent = this.group) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const leg = (w, h, material, x, z) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, h, z);
      box(w, h, w, material, 0, -h / 2, 0, pivot);
      this.group.add(pivot);
      this.legs.push(pivot);
    };
    const eyes = (ctx) => {
      ctx.fillStyle = '#fff'; ctx.fillRect(2, 5, 3, 2); ctx.fillRect(11, 5, 3, 2);
      ctx.fillStyle = '#111'; ctx.fillRect(3, 5, 2, 2); ctx.fillRect(11, 5, 2, 2);
    };

    if (kind === 'pig') {
      const pink = [236, 158, 160];
      const body = mat(noiseTexture(pink));
      const faceMat = mat(noiseTexture(pink, { face: eyes }));
      const snoutMat = mat(noiseTexture([226, 128, 140], {
        face: (ctx) => { ctx.fillStyle = '#6a3038'; ctx.fillRect(3, 6, 3, 4); ctx.fillRect(10, 6, 3, 4); },
      }));
      box(0.6, 0.5, 0.9, body, 0, 0.55, 0);
      this.head = new THREE.Group();
      this.head.position.set(0, 0.68, 0.45);
      box(0.5, 0.5, 0.5, [body, body, body, body, faceMat, body], 0, 0, 0.2, this.head);
      box(0.26, 0.18, 0.08, snoutMat, 0, -0.08, 0.48, this.head);
      this.group.add(this.head);
      for (const [x, z] of [[-0.17, 0.3], [0.17, 0.3], [-0.17, -0.3], [0.17, -0.3]]) leg(0.2, 0.32, body, x, z);
    } else {
      const brown = [84, 58, 42];
      const white = [236, 232, 226];
      const body = mat(noiseTexture(brown, { spots: [[4, 4, 3.5, white], [12, 10, 4, white], [6, 13, 2.5, white]] }));
      const plain = mat(noiseTexture(brown));
      const faceMat = mat(noiseTexture(brown, { face: eyes, spots: [[8, 3, 2.5, white]] }));
      const muzzle = mat(noiseTexture([212, 196, 186], {
        face: (ctx) => { ctx.fillStyle = '#3a2a24'; ctx.fillRect(3, 6, 3, 3); ctx.fillRect(10, 6, 3, 3); },
      }));
      const horn = mat(noiseTexture([226, 220, 200]));
      box(0.75, 0.65, 1.1, body, 0, 0.88, 0);
      this.head = new THREE.Group();
      this.head.position.set(0, 1.12, 0.55);
      box(0.5, 0.5, 0.4, [plain, plain, plain, plain, faceMat, plain], 0, 0, 0.2, this.head);
      box(0.32, 0.2, 0.08, muzzle, 0, -0.12, 0.43, this.head);
      box(0.07, 0.16, 0.07, horn, -0.29, 0.28, 0.18, this.head);
      box(0.07, 0.16, 0.07, horn, 0.29, 0.28, 0.18, this.head);
      this.group.add(this.head);
      for (const [x, z] of [[-0.22, 0.4], [0.22, 0.4], [-0.22, -0.4], [0.22, -0.4]]) leg(0.22, 0.55, plain, x, z);
    }
    this.phase = 0;
  }

  animate(speed, dt, headPitch) {
    this.phase += dt * speed * 4;
    const a = Math.sin(this.phase) * Math.min(1, speed / 2) * 0.7;
    this.legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3) ? a : -a; });
    if (this.head) this.head.rotation.x = headPitch || 0;
  }

  setLight(sky, block) {
    for (const m of this.materials) {
      m.userData.lightUniforms.uEntitySky.value = sky / 15;
      m.userData.lightUniforms.uEntityBlock.value = block / 15;
    }
  }

  setTint(r, g, b) { for (const m of this.materials) m.color.setRGB(r, g, b); }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}

class ZombieModel {
  constructor() {
    if (!zombieSkin) zombieSkin = createDefaultSkinCanvas('zombie');
    this.model = new PlayerModel(zombieSkin, false);
    this.group = this.model.group;
  }
  animate(speed, dt, attack) {
    this.model.animate({ speed, dt, pitch: 0, headYaw: 0, swinging: 0 });
    const p = this.model.parts;
    // Arms stretched forward, swinging down when attacking.
    const reach = -Math.PI / 2 + Math.sin(attack * Math.PI) * 0.6;
    p.rightArm.rotation.set(reach + Math.sin(performance.now() / 300) * 0.05, 0, 0.05);
    p.leftArm.rotation.set(reach - Math.sin(performance.now() / 300) * 0.05, 0, -0.05);
  }
  setLight(sky, block) { this.model.setLight(sky, block); }
  setTint(r, g, b) {
    this.model.baseMat.color.setRGB(r, g, b);
    this.model.overlayMat.color.setRGB(r, g, b);
  }
  dispose() { this.model.dispose(); }
}

// ------------------------------------------------------------------ mob

export class Mob {
  constructor(type, x, y, z, world) {
    this.type = type;
    this.def = MOB_TYPES[type];
    this.health = this.def.health;
    const ph = new PlayerPhysics(world);
    ph.width = this.def.width;
    ph.height = this.def.height;
    ph.canFly = false;
    ph.autoJump = true;
    ph.speedScale = this.def.speed;
    ph.x = x; ph.y = y; ph.z = z;
    ph.yaw = Math.random() * Math.PI * 2;
    this.physics = ph;
    this.model = type === 'zombie' ? new ZombieModel() : new AnimalModel(type);
    this.group = this.model.group;
    this.hurtTime = 0;
    this.invulnerable = 0;
    this.attackCooldown = 0;
    this.attackAnim = 0;
    this.fleeTime = 0;
    this.wanderTime = 0;
    this.walking = false;
    this.burnTimer = 0;
    this.soundTimer = 3 + Math.random() * 8;
    this.dead = false;
    this.bodyYaw = ph.yaw;
  }

  get x() { return this.physics.x; }
  get y() { return this.physics.y; }
  get z() { return this.physics.z; }
}

// ------------------------------------------------------------------ manager

export class MobManager {
  // game must provide: world, scene, player, gameMode, dead, particles, sound,
  // damage(amount, source), addDrops(list), peaceful
  constructor(game) {
    this.game = game;
    this.mobs = [];
    this.spawnTimer = 2;
    this._ray = new THREE.Ray();
    this._box = new THREE.Box3();
    this._v = new THREE.Vector3();
  }

  get count() { return this.mobs.length; }

  spawn(type, x, y, z) {
    const m = new Mob(type, x, y, z, this.game.world);
    this.mobs.push(m);
    this.game.scene.add(m.group);
    return m;
  }

  remove(m) {
    const i = this.mobs.indexOf(m);
    if (i >= 0) this.mobs.splice(i, 1);
    this.game.scene.remove(m.group);
    m.model.dispose();
  }

  clear() { for (const m of this.mobs.slice()) this.remove(m); }

  // Remove hostile mobs near a point (used on respawn so you don't spawn into a crowd).
  clearHostileNear(x, z, r) {
    for (const m of this.mobs.slice()) {
      if (m.def.hostile && Math.hypot(m.x - x, m.z - z) < r) this.remove(m);
    }
  }

  // ---------------------------------------------------------------- spawning

  _surface(x, z) {
    const w = this.game.world;
    for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
      const id = w.getBlock(x, y, z);
      if (id < 0) return -1;
      if (id === B.WATER) return -1;
      if (IS_SOLID[id]) return y;
    }
    return -1;
  }

  _standable(x, y, z) {
    const w = this.game.world;
    const g = w.getBlock(x, y, z), a = w.getBlock(x, y + 1, z), b = w.getBlock(x, y + 2, z);
    return g > 0 && IS_SOLID[g] && a >= 0 && b >= 0 && !IS_SOLID[a] && !IS_SOLID[b] && a !== B.WATER;
  }

  _trySpawnPassive(p) {
    const ang = Math.random() * Math.PI * 2, dist = 18 + Math.random() * 26;
    const x = Math.floor(p.x + Math.cos(ang) * dist), z = Math.floor(p.z + Math.sin(ang) * dist);
    const y = this._surface(x, z);
    if (y < 0 || this.game.world.getBlock(x, y, z) !== B.GRASS || !this._standable(x, y, z)) return;
    if (this.game.world.getLight(x, y + 1, z).sky < 15) return;
    const type = Math.random() < 0.5 ? 'pig' : 'cow';
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const gx = x + Math.floor(Math.random() * 5) - 2, gz = z + Math.floor(Math.random() * 5) - 2;
      const gy = this._surface(gx, gz);
      if (gy < 0 || this.game.world.getBlock(gx, gy, gz) !== B.GRASS || !this._standable(gx, gy, gz)) continue;
      this.spawn(type, gx + 0.5, gy + 1, gz + 0.5);
    }
  }

  _darkEnough(x, y, z) {
    const l = this.game.world.getLight(x, y, z);
    const effectiveSky = l.sky * Math.min(1, U.uDay.value * 1.3);
    return l.block < 7 && effectiveSky < 7;
  }

  _trySpawnHostile(p) {
    const ang = Math.random() * Math.PI * 2, dist = 16 + Math.random() * 22;
    const x = Math.floor(p.x + Math.cos(ang) * dist), z = Math.floor(p.z + Math.sin(ang) * dist);
    // Surface at night, or a dark cave pocket near the player's height.
    let y = this._surface(x, z);
    if (y < 0 || !this._standable(x, y, z) || !this._darkEnough(x, y + 1, z)) {
      y = -1;
      const base = Math.floor(p.y) + Math.floor(Math.random() * 18) - 12;
      for (let yy = base; yy < base + 8; yy++) {
        if (yy > 1 && yy < WORLD_HEIGHT - 3 && this._standable(x, yy, z) && this._darkEnough(x, yy + 1, z)) { y = yy; break; }
      }
    }
    if (y < 0) return;
    this.spawn('zombie', x + 0.5, y + 1, z + 0.5);
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    const g = this.game;
    const p = g.player;
    // Spawning / despawning about once per second.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1;
      let passive = 0, hostile = 0;
      for (const m of this.mobs.slice()) {
        if (Math.hypot(m.x - p.x, m.z - p.z) > DESPAWN_DIST || m.y < -20) { this.remove(m); continue; }
        if (m.def.hostile) hostile++; else passive++;
      }
      if (passive < MAX_PASSIVE && Math.random() < 0.4) this._trySpawnPassive(p);
      const hostileAllowed = g.gameMode === 'survival' && !g.peaceful;
      if (!hostileAllowed) {
        for (const m of this.mobs.slice()) if (m.def.hostile) this.remove(m);
      } else if (hostile < MAX_HOSTILE) {
        for (let i = 0; i < 2; i++) if (Math.random() < 0.6) this._trySpawnHostile(p);
      }
    }

    const steps = Math.max(1, Math.ceil(dt / (1 / 30)));
    const sdt = dt / steps;
    for (const m of this.mobs.slice()) {
      this._think(m, dt);
      for (let i = 0; i < steps; i++) m.physics.step(sdt, m.controls);
      this._afterStep(m, dt);
    }
  }

  _think(m, dt) {
    const g = this.game;
    const p = g.player;
    const ph = m.physics;
    const dx = p.x - ph.x, dz = p.z - ph.z, dy = p.y - ph.y;
    const dist = Math.hypot(dx, dz);
    m.attackCooldown = Math.max(0, m.attackCooldown - dt);
    m.invulnerable = Math.max(0, m.invulnerable - dt);
    m.attackAnim = Math.max(0, m.attackAnim - dt * 3);
    const c = { time: g.clock };
    const time = g.clock;

    if (m.def.hostile && g.gameMode === 'survival' && !g.dead && dist < 28 && Math.abs(dy) < 12) {
      // Chase the player.
      ph.yaw = Math.atan2(-dx, -dz);
      ph.speedScale = m.def.speed;
      c.forward = dist > 0.8;
      if (dist < 1.3 && Math.abs(dy) < 1.8 && m.attackCooldown <= 0) {
        m.attackCooldown = 1;
        m.attackAnim = 1;
        g.damage(m.def.damage, { x: ph.x, z: ph.z });
      }
    } else if (m.fleeTime > 0) {
      m.fleeTime -= dt;
      ph.yaw = Math.atan2(dx, dz);
      ph.speedScale = m.def.fleeSpeed || m.def.speed;
      c.forward = true;
    } else {
      // Wander: walk a bit, stand a bit.
      ph.speedScale = m.def.speed;
      m.wanderTime -= dt;
      if (m.wanderTime <= 0) {
        m.walking = Math.random() < 0.55;
        m.wanderTime = m.walking ? 1 + Math.random() * 3 : 2 + Math.random() * 5;
        if (m.walking) ph.yaw = Math.random() * Math.PI * 2;
      }
      c.forward = m.walking;
      if (m.walking && ph.collidedH) ph.yaw += Math.PI * (0.5 + Math.random());
    }

    // Don't walk off cliffs when not chasing.
    if (c.forward && !m.def.hostile && ph.onGround) {
      const ax = Math.floor(ph.x - Math.sin(ph.yaw) * 0.9), az = Math.floor(ph.z - Math.cos(ph.yaw) * 0.9);
      const fy = Math.floor(ph.y);
      let drop = 0;
      while (drop < 4 && !IS_SOLID[Math.max(0, g.world.getBlock(ax, fy - 1 - drop, az))]) drop++;
      if (drop >= 3) { ph.yaw += Math.PI; m.wanderTime = 0.5; }
    }
    if (ph.inWater) c.jump = true; // swim
    c.time = time;
    m.controls = c;
  }

  _afterStep(m, dt) {
    const g = this.game;
    const ph = m.physics;
    const light = g.world.getLight(Math.floor(ph.x), Math.floor(ph.y + 0.5), Math.floor(ph.z));
    m.model.setLight(light.sky, light.block);

    // Zombies burn in daylight.
    if (m.def.hostile) {
      const head = g.world.getLight(Math.floor(ph.x), Math.floor(ph.y + 1.6), Math.floor(ph.z));
      if (head.sky >= 13 && U.uDay.value > 0.6 && !ph.inWater) {
        m.burnTimer += dt;
        if (Math.random() < dt * 14) {
          g.particles.burst(Math.floor(ph.x), Math.floor(ph.y + 1), Math.floor(ph.z), [1, 0.55, 0.12], 2, { up: 2, spread: 0.6, size: 0.07, life: 0.5, gravity: -4 });
        }
        if (m.burnTimer >= 1) { m.burnTimer = 0; this.hurt(m, 2, null); }
      }
    }

    // Sounds
    m.soundTimer -= dt;
    if (m.soundTimer <= 0) {
      m.soundTimer = 6 + Math.random() * 12;
      const d = Math.hypot(ph.x - g.player.x, ph.z - g.player.z);
      if (d < 20 && g.sound) g.sound.mob(m.type, Math.max(0.1, 1 - d / 20));
    }

    // Hurt flash
    if (m.hurtTime > 0) {
      m.hurtTime -= dt;
      m.model.setTint(1, 0.45, 0.45);
      if (m.hurtTime <= 0) m.model.setTint(1, 1, 1);
    }

    // Visuals: body turns smoothly towards where it walks.
    let diff = ph.yaw - m.bodyYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    m.bodyYaw += diff * Math.min(1, dt * 8);
    m.group.position.set(ph.x, ph.y, ph.z);
    m.group.rotation.y = m.bodyYaw + Math.PI;
    const speed = Math.hypot(ph.vx, ph.vz);
    if (m.type === 'zombie') m.model.animate(speed, dt, m.attackAnim);
    else m.model.animate(speed, dt, Math.sin(g.clock * 0.7 + m.soundTimer) * 0.15);
  }

  // ---------------------------------------------------------------- combat

  // Nearest mob hit by a ray, or null. Returns { mob, dist }.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    this._ray.origin.set(ox, oy, oz);
    this._ray.direction.set(dx, dy, dz).normalize();
    let best = null;
    for (const m of this.mobs) {
      const hw = m.def.width / 2;
      this._box.min.set(m.x - hw, m.y, m.z - hw);
      this._box.max.set(m.x + hw, m.y + m.def.height, m.z + hw);
      const hit = this._ray.intersectBox(this._box, this._v);
      if (!hit) continue;
      const d = hit.distanceTo(this._ray.origin);
      if (d <= maxDist && (!best || d < best.dist)) best = { mob: m, dist: d };
    }
    return best;
  }

  // source: { x, z } of the attacker (for knockback), or null.
  hurt(m, amount, source) {
    if (m.dead || m.invulnerable > 0) return false;
    m.health -= amount;
    m.hurtTime = 0.35;
    m.invulnerable = 0.45;
    const g = this.game;
    if (source) {
      const kx = m.x - source.x, kz = m.z - source.z;
      const l = Math.hypot(kx, kz) || 1;
      m.physics.vx += (kx / l) * 7;
      m.physics.vz += (kz / l) * 7;
      if (m.physics.onGround) m.physics.vy = 5.5;
    }
    if (!m.def.hostile) m.fleeTime = 5;
    if (g.sound) g.sound.mob(m.type, 1, true);
    if (m.health <= 0) this._kill(m);
    return true;
  }

  _kill(m) {
    m.dead = true;
    const g = this.game;
    g.particles.burst(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z), [0.85, 0.85, 0.85], 20, { up: 3, spread: 3, size: 0.12, life: 0.8, gravity: 2 });
    const drops = [];
    for (const [id, min, max] of m.def.drops) {
      const n = min + Math.floor(Math.random() * (max - min + 1));
      if (n > 0) drops.push([id, n]);
    }
    if (drops.length) g.addDrops(drops);
    this.remove(m);
  }

  dispose() { this.clear(); }
}
