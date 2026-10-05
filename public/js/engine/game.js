// The game session: ties together world streaming, the player, rendering,
// interaction, survival/creative rules, chat commands, saving and multiplayer.

import * as THREE from 'three';
import { World } from './world.js';
import { PlayerPhysics } from './player.js';
import { Input } from './input.js';
import { HandView } from './hand.js';
import { Particles } from './particles.js';
import { PlayerModel } from './skin.js';
import { RemotePlayer, FLAG_SNEAK, FLAG_FLY, FLAG_SWING } from './entities.js';
import { B, BLOCKS, IS_SOLID, CREATIVE_ORDER, RECIPES, isValidBlockId } from './blocks.js';
import { WORLD_HEIGHT, DAY_LENGTH_SECONDS, MAX_REACH, CHUNK_SIZE } from './constants.js';
import { TerrainGenerator, BIOME_NAMES } from './terrain.js';
import { U } from './materials.js';
import { saveWorld } from './storage.js';

const PHYSICS_DT = 1 / 60;
const MAX_HEALTH = 20;
const MAX_AIR = 15;
const STACK = 64;
const SUPPORT_BLOCKS = new Set([B.GRASS, B.DIRT, B.PODZOL, B.MOSS_BLOCK, B.SNOW_GRASS]);

const DEFAULT_HOTBAR = ['grass', 'dirt', 'stone', 'cobblestone', 'oak_planks', 'oak_log', 'glass', 'torch', 'oak_leaves'];

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

function makeCrackTextures() {
  const list = [];
  let seed = 1234;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lines = [];
  for (let i = 0; i < 10; i++) {
    for (let k = 0; k < 3; k++) {
      let x = 32 + (rand() - 0.5) * 20, y = 32 + (rand() - 0.5) * 20;
      const pts = [[x, y]];
      const ang = rand() * Math.PI * 2;
      for (let s = 0; s < 5; s++) {
        x += Math.cos(ang + (rand() - 0.5) * 1.5) * (4 + rand() * 6);
        y += Math.sin(ang + (rand() - 0.5) * 1.5) * (4 + rand() * 6);
        pts.push([x, y]);
      }
      lines.push(pts);
    }
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineCap = 'round';
    for (const pts of lines) {
      ctx.lineWidth = 1 + rand() * 1.5;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    list.push(t);
  }
  return list;
}

export class Game {
  constructor(opts) {
    this.opts = opts;
    this.r = opts.renderer;
    this.scene = this.r.scene;
    this.camera = this.r.camera;
    this.hud = opts.hud;
    this.sound = opts.sound;
    this.settings = Object.assign({}, opts.settings);
    this.profile = opts.profile;
    this.texData = opts.texData;
    this.mode = opts.mode; // 'single' | 'multi' | 'demo'
    this.demo = this.mode === 'demo';
    this.net = opts.net || null;
    this.record = opts.worldRecord || null;
    this.onExit = opts.onExit || (() => {});

    let seed;
    if (this.mode === 'multi') seed = opts.welcome.seed >>> 0;
    else if (this.demo) seed = opts.seed >>> 0;
    else seed = this.record.seed >>> 0;
    this.seed = seed;
    this.gen = new TerrainGenerator(seed); // used on the main thread only for cheap biome lookups

    this.world = new World({
      seed,
      scene: this.scene,
      materials: this.r.materials,
      pool: opts.pool,
      renderDistance: this.demo ? Math.min(this.settings.renderDistance, 7) : this.settings.renderDistance,
      fancyLeaves: this.settings.fancyLeaves,
    });
    this.r.setFogDistance(this.world.renderDistance);

    this.player = new PlayerPhysics(this.world);
    this.player.autoJump = this.settings.autoJump;
    this.player.onLand = (fall) => this._onLand(fall);
    this.prevPos = { x: 0, y: 0, z: 0 };
    this.gameMode = 'creative';
    this.health = MAX_HEALTH;
    this.air = MAX_AIR;
    this.dead = false;
    this.damageFlash = 0;
    this.regenTimer = 0;
    this.drownTimer = 0;

    // Inventory: 36 slots (0-8 hotbar). Each slot is null or { id, count }.
    this.slots = new Array(36).fill(null);
    this.selected = 0;
    this.cursor = null;

    this.dayTime = 0.04;
    this.clock = 0;
    this.running = false;
    this.paused = false;
    this.ready = false;
    this.disposed = false;
    this.thirdPerson = 0; // 0 first, 1 back, 2 front
    this.showDebug = false;
    this.hideHud = false;
    this.accum = 0;
    this.lastFrame = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.breaking = null; // { x, y, z, progress }
    this.actionCooldown = 0;
    this.placeCooldown = 0;
    this.lastStepDist = 0;
    this.wasInWater = false;
    this.spawn = { x: 0.5, y: 80, z: 0.5 };
    this.saveTimer = 0;
    this.moveTimer = 0;
    this.remote = new Map();
    this.fovCurrent = this.settings.fov;
    this.bob = 0;
    this.screenshotRequested = false;
    this.lastSentFlags = -1;
    this._center = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._ambient = new THREE.Color();
    this._sunCol = new THREE.Color();

    // Scene objects owned by the session.
    this.particles = new Particles(this.scene);
    const hl = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    hl.visible = false;
    hl.renderOrder = 3;
    this.highlight = hl;
    this.scene.add(hl);
    this.crackTextures = makeCrackTextures();
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshBasicMaterial({ map: this.crackTextures[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    this.crack.visible = false;
    this.crack.renderOrder = 4;
    this.scene.add(this.crack);

    // Local player model (seen in third person and as a shadow in first person).
    this.model = new PlayerModel(opts.skinCanvas, opts.slim);
    this.scene.add(this.model.group);
    this.hand = new HandView(this.r.handScene, opts.skinCanvas, opts.slim);
    this.hand.visible = !this.demo;

    if (!this.demo) {
      this.input = new Input(this.r.canvas);
      this.input.onLockChange = (locked) => this._onLockChange(locked);
      this.input.onKeyDown = (e) => this._onKeyDown(e);
    }

    this._onVisibility = () => { if (document.hidden && this.mode === 'single' && this.ready) this.save(); };
    document.addEventListener('visibilitychange', this._onVisibility);
    this._onBeforeUnload = (e) => {
      if (this.mode === 'single' && this.ready) this.save();
      if (!this.demo && this.ready) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', this._onBeforeUnload);
  }

  // ------------------------------------------------------------------ setup

  async init() {
    if (this.mode === 'single') {
      const rec = this.record;
      this.world.importEdits(rec.edits || {});
      this.gameMode = rec.mode === 'survival' ? 'survival' : 'creative';
      this.dayTime = typeof rec.time === 'number' ? rec.time : 0.04;
      if (rec.spawn) this.spawn = rec.spawn;
      else {
        this.spawn = await this.opts.pool.run('spawn', { seed: this.seed });
        rec.spawn = this.spawn;
      }
      const p = rec.player;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
        this._placePlayer(p.x, p.y, p.z, p.yaw || 0, p.pitch || 0);
        this.health = Math.max(1, Math.min(MAX_HEALTH, p.health ?? MAX_HEALTH));
        this.player.flying = !!p.flying && this.gameMode === 'creative';
        if (Array.isArray(p.slots)) this._loadSlots(p.slots);
        if (Number.isInteger(p.selected)) this.selected = Math.max(0, Math.min(8, p.selected));
      } else {
        this._placePlayer(this.spawn.x, this.spawn.y, this.spawn.z, 0, 0);
      }
      if (!this.slots.some((s) => s) && this.gameMode === 'creative') this._defaultHotbar();
    } else if (this.mode === 'multi') {
      const w = this.opts.welcome;
      this.selfId = w.id;
      if (Array.isArray(w.edits)) this.world.importFlatEdits(w.edits);
      this.dayTime = typeof w.time === 'number' ? w.time : 0.1;
      this.spawn = w.spawn || this.spawn;
      this.gameMode = w.gameMode === 'survival' ? 'survival' : 'creative';
      this._placePlayer(this.spawn.x, this.spawn.y, this.spawn.z, 0, 0);
      this._defaultHotbar();
      for (const p of w.players || []) this._addRemote(p);
      this._setupNetwork();
    } else {
      const sp = await this.opts.pool.run('spawn', { seed: this.seed });
      this.spawn = sp;
      this.dayTime = 0.06;
      this._placePlayer(sp.x, sp.y + 6, sp.z, 0.6, -0.08);
    }
    this._applyGameMode();
    this.applySettings(this.settings);
  }

  _placePlayer(x, y, z, yaw, pitch) {
    const p = this.player;
    p.x = x; p.y = y; p.z = z;
    p.vx = p.vy = p.vz = 0;
    p.yaw = yaw; p.pitch = pitch;
    this.prevPos = { x, y, z };
  }

  _defaultHotbar() {
    DEFAULT_HOTBAR.forEach((k, i) => {
      const b = BLOCKS.find((bb) => bb && bb.key === k);
      if (b) this.slots[i] = { id: b.id, count: 1 };
    });
  }

  _loadSlots(arr) {
    for (let i = 0; i < 36; i++) {
      const s = arr[i];
      if (s && isValidBlockId(s.id) && s.id !== 0 && Number.isInteger(s.count) && s.count > 0) {
        this.slots[i] = { id: s.id, count: Math.min(STACK, s.count) };
      } else this.slots[i] = null;
    }
  }

  _applyGameMode() {
    const creative = this.gameMode === 'creative';
    this.player.canFly = creative;
    if (!creative) this.player.flying = false;
    if (this.hud) {
      this.hud.setHealth(this.health, MAX_HEALTH, !creative && !this.demo);
      this._refreshHotbar();
    }
  }

  applySettings(s) {
    this.settings = Object.assign({}, this.settings, s);
    this.r.applySettings(this.settings);
    if (!this.demo) {
      this.world.setRenderDistance(this.settings.renderDistance);
      this.r.setFogDistance(this.world.renderDistance);
    }
    this.world.setFancyLeaves(this.settings.fancyLeaves);
    this.player.autoJump = this.settings.autoJump;
    this.sound?.setVolume(this.settings.volume);
    this.showFps = this.settings.showFps;
  }

  // ------------------------------------------------------------------ network

  _setupNetwork() {
    const net = this.net;
    this.world.onEdit = (x, y, z, id) => net.send({ t: 'set', x, y, z, id });
    net.on('join', (m) => {
      if (m.player.id === this.selfId) return;
      this._addRemote(m.player);
      this.hud.addChat(`${m.player.name} joined the game`, 'system');
    });
    net.on('leave', (m) => {
      const rp = this.remote.get(m.id);
      if (rp) {
        this.hud.addChat(`${rp.name} left the game`, 'system');
        rp.dispose();
        this.remote.delete(m.id);
      }
    });
    net.on('moves', (m) => {
      const now = performance.now() / 1000;
      for (const e of m.list || []) {
        const rp = this.remote.get(e[0]);
        if (rp) rp.push(now, e.slice(1));
      }
    });
    net.on('set', (m) => {
      if (!isValidBlockId(m.id)) return;
      const old = this.world.getBlock(m.x, m.y, m.z);
      if (this.world.setBlock(m.x, m.y, m.z, m.id, { local: false })) {
        if (m.id === B.AIR && old > 0) this._breakEffects(m.x, m.y, m.z, old, 0.6);
      }
    });
    net.on('chat', (m) => this.hud.addChat(m.from ? `<${m.from}> ${m.text}` : m.text, m.from ? '' : 'system'));
    net.on('skin', (m) => {
      const rp = this.remote.get(m.id);
      if (rp) rp.setSkin(m.skin, m.slim);
    });
    net.on('time', (m) => { if (typeof m.time === 'number') this.dayTime = m.time; });
    net.on('gamemode', (m) => {
      if (m.mode === 'creative' || m.mode === 'survival') {
        this.gameMode = m.mode;
        this._applyGameMode();
        this.hud.toast(`Game mode: ${m.mode}`);
      }
    });
    net.on('tp', (m) => {
      if ([m.x, m.y, m.z].every(Number.isFinite)) this._placePlayer(m.x, m.y, m.z, this.player.yaw, this.player.pitch);
    });
    net.onClose = (reason) => {
      if (this.disposed) return;
      this.exit(reason || 'Disconnected from server.');
    };
  }

  _addRemote(info) {
    if (!info || info.id === this.selfId || this.remote.has(info.id)) return;
    this.remote.set(info.id, new RemotePlayer(this.scene, info));
  }

  // ------------------------------------------------------------------ loop

  start() {
    this.running = true;
    this.lastFrame = performance.now();
    if (!this.demo) {
      this.hud.show(true);
      this.hud.setLoading(true, 0, 'Generating terrain…');
      this._refreshHotbar();
    }
    const loop = (t) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      try {
        this._frame(t);
      } catch (err) {
        console.error(err);
        this.running = false;
        cancelAnimationFrame(this.raf);
        this.exit('A rendering error occurred: ' + (err && err.message ? err.message : err));
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  _frame(t) {
    let dt = (t - this.lastFrame) / 1000;
    this.lastFrame = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25) dt = 0.25;
    this.clock += dt;

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsTime); this.fpsFrames = 0; this.fpsTime = 0; }

    const p = this.player;
    this.world.update(p.x, p.z);

    if (!this.ready) {
      const progress = this.world.readiness(p.x, p.z, 2);
      const below = this.world.isLoaded(Math.floor(p.x), Math.floor(p.z));
      if (!this.demo) this.hud.setLoading(true, progress, 'Generating terrain…');
      if (progress >= 1 && below) {
        this.ready = true;
        if (!this.demo) {
          p.unstuck();
          p.vx = p.vy = p.vz = 0;
          p.fallDistance = 0;
          this.prevPos = { x: p.x, y: p.y, z: p.z };
          this.hud.setLoading(false);
          if (this.mode === 'single') this.save();
        }
      }
    }

    // World time
    const timeScale = 1 / DAY_LENGTH_SECONDS;
    if (this.demo) this.dayTime = (this.dayTime + dt * timeScale * 0.5) % 1;
    else if (!this.paused || this.mode === 'multi') this.dayTime = (this.dayTime + dt * timeScale) % 1;

    if (this.demo) {
      p.yaw += dt * 0.04;
      this._updateCamera(1, dt);
    } else if (this.ready) {
      this._gameplay(dt);
    } else {
      this._updateCamera(1, dt);
    }

    // Environment / lighting
    const eye = this.camera.position;
    const el = this.world.getLight(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    const underwater = this._cameraUnderwater();
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
    this.r.updateEnvironment(this.dayTime, this.clock, {
      center: this._center.set(p.x, p.y, p.z),
      underwater,
      playerLight: el,
      damage: this.damageFlash,
    });

    // Entities
    const playerLight = this.world.getLight(Math.floor(p.x), Math.floor(p.y + 1.2), Math.floor(p.z));
    this.particles.update(dt, this.world, playerLight);
    const now = performance.now() / 1000;
    for (const rp of this.remote.values()) rp.update(dt, now, this.world);
    this._updateLocalModel(dt, playerLight);
    this._updateHand(dt, el);

    if (!this.demo && this.sound) {
      this.sound.updateAmbience(dt, { day: U.uDay.value, skyLight: el.sky, height: p.y, underwater });
    }

    this.r.render(this.world.waterMeshes());
    if (this.screenshotRequested) {
      this.screenshotRequested = false;
      this._saveScreenshot();
    }
    if (this.input) this.input.endFrame();
  }

  _gameplay(dt) {
    const p = this.player;
    const input = this.input;
    const active = input.locked && !this.paused && !this.dead && !this.hud.isChatOpen() && !this.hud.isInventoryOpen();

    // Mouse look
    if (active) {
      const sens = 0.0022 * this.settings.sensitivity;
      p.yaw -= input.mouseDX * sens;
      p.pitch -= input.mouseDY * sens * (this.settings.invertY ? -1 : 1);
      p.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p.pitch));
      // Hotbar scroll
      if (input.wheel) {
        this.selected = ((this.selected + input.wheel) % 9 + 9) % 9;
        this._refreshHotbar(true);
      }
    }

    // Nothing captured the mouse: offer "click to play".
    this.hud.setClickToPlay(!input.locked && !this.paused && !this.dead && !this.hud.isChatOpen() && !this.hud.isInventoryOpen());

    // Fixed-step physics (frozen while a singleplayer game is paused)
    const frozen = this.paused && this.mode === 'single';
    const controls = active ? {
      forward: input.isDown('forward'), back: input.isDown('back'),
      left: input.isDown('left'), right: input.isDown('right'),
      jump: input.isDown('jump'), sneak: input.isDown('sneak'),
      sprint: input.isDown('sprint') || input.sprintToggle,
      jumpPressed: input.wasPressed('Space'), time: this.clock,
    } : { time: this.clock };
    this.accum += dt;
    let steps = 0;
    if (frozen) this.accum = 0;
    while (this.accum >= PHYSICS_DT && steps < 16) {
      this.prevPos.x = p.x; this.prevPos.y = p.y; this.prevPos.z = p.z;
      if (!this.dead) p.step(PHYSICS_DT, controls);
      controls.jumpPressed = false;
      this.accum -= PHYSICS_DT;
      steps++;
    }
    if (steps >= 16) this.accum = 0;
    const alpha = this.accum / PHYSICS_DT;

    if (!frozen) this._survivalTick(dt);
    this._footsteps();
    this._updateCamera(alpha, dt);

    if (active) this._interact(dt);
    else this._stopBreaking();

    // Network position updates (15 Hz)
    if (this.net) {
      this.moveTimer -= dt;
      if (this.moveTimer <= 0) {
        this.moveTimer = 1 / 15;
        let flags = 0;
        if (p.sneaking) flags |= FLAG_SNEAK;
        if (p.flying) flags |= FLAG_FLY;
        if (this.hand.swing > 0) flags |= FLAG_SWING;
        const held = this.slots[this.selected]?.id || 0;
        this.net.send({ t: 'move', x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), f: flags, h: held });
      }
    }

    // Autosave
    if (this.mode === 'single') {
      this.saveTimer += dt;
      if (this.saveTimer > 30) { this.saveTimer = 0; this.save(); }
    }

    this._updateHud();
  }

  _cameraUnderwater() {
    const c = this.camera.position;
    const id = this.world.getBlock(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z));
    if (id !== B.WATER) return false;
    const above = this.world.getBlock(Math.floor(c.x), Math.floor(c.y) + 1, Math.floor(c.z));
    if (above !== B.WATER && c.y - Math.floor(c.y) > 0.86) return false;
    return true;
  }

  _updateCamera(alpha, dt) {
    const p = this.player;
    const ix = this.prevPos.x + (p.x - this.prevPos.x) * alpha;
    const iy = this.prevPos.y + (p.y - this.prevPos.y) * alpha;
    const iz = this.prevPos.z + (p.z - this.prevPos.z) * alpha;
    this.interp = { x: ix, y: iy, z: iz };
    let eyeY = iy + p.eyeHeight;
    // Smooth eye height changes when sneaking.
    this.eyeSmooth = this.eyeSmooth === undefined ? eyeY : this.eyeSmooth + (eyeY - this.eyeSmooth) * Math.min(1, dt * 14);
    if (Math.abs(this.eyeSmooth - eyeY) > 1) this.eyeSmooth = eyeY;
    eyeY = this.eyeSmooth;

    const cam = this.camera;
    cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');

    // View bobbing
    let bx = 0, by = 0;
    if (!this.demo && this.settings.viewBobbing && p.onGround && !p.flying && this.thirdPerson === 0) {
      const speed = Math.hypot(p.vx, p.vz);
      const amt = Math.min(1, speed / 5);
      this.bob += dt * speed * 1.9;
      bx = Math.cos(this.bob) * 0.035 * amt;
      by = -Math.abs(Math.sin(this.bob)) * 0.055 * amt;
    }
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const eye = this._eye.set(ix + rx * bx, eyeY + by, iz + rz * bx);

    if (this.thirdPerson === 0) {
      cam.position.copy(eye);
    } else {
      const dir = this._dir;
      cam.getWorldDirection(dir);
      if (this.thirdPerson === 2) {
        dir.negate();
        cam.rotation.set(-p.pitch, p.yaw + Math.PI, 0, 'YXZ');
      }
      // Pull the camera in when blocks are in the way.
      let dist = 4;
      const hit = this.world.raycast(eye.x, eye.y, eye.z, -dir.x, -dir.y, -dir.z, dist + 0.3);
      if (hit) dist = Math.max(0.3, hit.dist - 0.3);
      cam.position.copy(eye).addScaledVector(dir, -dist);
    }

    // Sprint FOV kick
    const targetFov = this.settings.fov * (p.sprinting ? (p.flying ? 1.15 : 1.1) : 1);
    this.fovCurrent += (targetFov - this.fovCurrent) * Math.min(1, dt * 8);
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  _updateLocalModel(dt, light) {
    const p = this.player;
    const m = this.model;
    const pos = this.interp || p;
    m.group.position.set(pos.x, pos.y, pos.z);
    // Body follows the view direction.
    if (this.bodyYaw === undefined) this.bodyYaw = p.yaw;
    let diff = p.yaw - this.bodyYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const moving = Math.hypot(p.vx, p.vz) > 0.3;
    if (moving) this.bodyYaw += diff * Math.min(1, dt * 8);
    else if (Math.abs(diff) > 0.8) this.bodyYaw = p.yaw - Math.sign(diff) * 0.8;
    m.group.rotation.y = this.bodyYaw + Math.PI;
    let headYaw = p.yaw - this.bodyYaw;
    while (headYaw > Math.PI) headYaw -= Math.PI * 2;
    while (headYaw < -Math.PI) headYaw += Math.PI * 2;
    m.animate({
      speed: Math.hypot(p.vx, p.vz) * (p.onGround || p.flying ? 1 : 0.3), dt, pitch: p.pitch, headYaw,
      sneaking: p.sneaking, swinging: this.hand.swing, flying: p.flying,
    });
    m.setLight(light.sky, light.block);
    // In first person only the shadow of the body is drawn.
    const shadowOnly = this.thirdPerson === 0 && !this.demo;
    for (const mat of [m.baseMat, m.overlayMat]) {
      if (mat.colorWrite === shadowOnly) {
        mat.colorWrite = !shadowOnly;
        mat.depthWrite = !shadowOnly;
      }
    }
    m.group.visible = !this.demo;
  }

  _updateHand(dt, light) {
    const p = this.player;
    const sky = (light.sky / 15) ** 2;
    const blk = (light.block / 15) ** 3;
    const hemi = this.r.hemi;
    const amb = this._ambient.copy(hemi.color).multiplyScalar(hemi.intensity * (0.04 + 0.96 * sky) * 0.38);
    const sun = this._sunCol.copy(this.r.sun.color).multiplyScalar(this.r.sun.intensity * 0.22 * smoothstep(0.45, 0.9, light.sky / 15));
    const held = this.slots[this.selected];
    this.hand.setItem(held ? held.id : 0);
    this.hand.update(dt, {
      thirdPerson: this.thirdPerson !== 0 || this.demo,
      onGround: p.onGround && !p.flying,
      speed: Math.hypot(p.vx, p.vz),
      bobbing: this.settings.viewBobbing,
      ambient: amb, sun, torch: blk * 1.2,
    });
  }

  // ------------------------------------------------------------------ survival

  _onLand(fall) {
    const p = this.player;
    if (fall > 1.2 && !p.inWater) {
      const below = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
      if (below > 0 && this.sound) this.sound.step(BLOCKS[below].sound);
    }
    if (this.gameMode !== 'survival' || p.inWater) return;
    const dmg = Math.ceil(fall - 3.2);
    if (dmg > 0) this.damage(dmg);
  }

  damage(amount) {
    if (this.gameMode !== 'survival' || this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.damageFlash = Math.min(1, this.damageFlash + 0.6);
    this.sound?.hurt();
    this.hud.setHealth(this.health, MAX_HEALTH, true);
    if (this.health <= 0) this._die();
  }

  _die() {
    this.dead = true;
    this._stopBreaking();
    this.input.exitLock();
    this.hud.showDeath(true);
  }

  respawn() {
    this.dead = false;
    this.health = MAX_HEALTH;
    this.air = MAX_AIR;
    this._placePlayer(this.spawn.x, this.spawn.y, this.spawn.z, 0, 0);
    this.player.unstuck();
    this.player.fallDistance = 0;
    this.hud.showDeath(false);
    this.hud.setHealth(this.health, MAX_HEALTH, this.gameMode === 'survival');
    this.input.requestLock();
  }

  _survivalTick(dt) {
    const p = this.player;
    const survival = this.gameMode === 'survival';
    // Air / drowning
    if (p.headInWater && survival) {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) {
        this.drownTimer += dt;
        if (this.drownTimer >= 1) { this.drownTimer = 0; this.damage(2); }
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 5);
      this.drownTimer = 0;
    }
    this.hud.setAir(this.air, MAX_AIR, survival && this.air < MAX_AIR - 0.01);
    if (survival && !this.dead && this.health < MAX_HEALTH) {
      this.regenTimer += dt;
      if (this.regenTimer > 4) { this.regenTimer = 0; this.health += 1; this.hud.setHealth(this.health, MAX_HEALTH, true); }
    }
    // Splash when entering water fast.
    if (p.inWater && !this.wasInWater && this.prevVy < -5) {
      this.sound?.splash();
      this.particles.burst(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), [0.6, 0.75, 0.95], 26, { up: 6, spread: 5, size: 0.06, life: 0.7 });
    }
    this.prevVy = p.vy;
    this.wasInWater = p.inWater;
  }

  _footsteps() {
    const p = this.player;
    if (!this.sound || !p.onGround || p.flying || p.sneaking) { this.lastStepDist = p.walkDist; return; }
    if (p.walkDist - this.lastStepDist > 1.8) {
      this.lastStepDist = p.walkDist;
      let below = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.1), Math.floor(p.z));
      if (below <= 0) return;
      this.sound.step(p.inWater ? 'water' : BLOCKS[below].sound);
    }
  }

  // ------------------------------------------------------------------ interaction

  _target() {
    const cam = this.camera;
    const p = this.player;
    const dir = this._dir.set(0, 0, -1).applyEuler(this._euler.set(p.pitch, p.yaw, 0, 'YXZ'));
    const eye = { x: this.interp.x, y: this.eyeSmooth, z: this.interp.z };
    const reach = this.gameMode === 'creative' ? MAX_REACH : 4.6;
    return this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, reach);
  }

  _interact(dt) {
    const input = this.input;
    const hit = this._target();
    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      const b = BLOCKS[hit.id];
      if (b.render === 'cross' || b.render === 'torch') this.highlight.scale.set(0.7, b.render === 'torch' ? 0.65 : 0.9, 0.7);
      else this.highlight.scale.set(1, 1, 1);
      if (b.render === 'torch') this.highlight.position.y = hit.y + 0.33;
      else if (b.render === 'cross') this.highlight.position.y = hit.y + 0.45;
    } else {
      this.highlight.visible = false;
    }

    this.actionCooldown = Math.max(0, this.actionCooldown - dt);
    this.placeCooldown = Math.max(0, this.placeCooldown - dt);

    // Pick block (middle click)
    if (input.clicked.has(1) && hit) this._pickBlock(hit.id);

    // Break
    // A click can start and end between two frames on slow machines, so count it too.
    const leftDown = input.buttons.has(0) || input.clicked.has(0);
    if (leftDown && hit) {
      if (this.gameMode === 'creative') {
        this._stopBreaking();
        if (input.clicked.has(0) || this.actionCooldown <= 0) {
          this.hand.startSwing();
          this._breakBlock(hit.x, hit.y, hit.z, hit.id);
          this.actionCooldown = 0.22;
        }
      } else {
        const b = BLOCKS[hit.id];
        if (!this.breaking || this.breaking.x !== hit.x || this.breaking.y !== hit.y || this.breaking.z !== hit.z) {
          this.breaking = { x: hit.x, y: hit.y, z: hit.z, progress: 0 };
        }
        if (this.hand.swing === 0) this.hand.startSwing();
        const time = b.hardness === Infinity ? Infinity : Math.max(0.05, b.hardness * 0.75);
        this.breaking.progress += dt / time;
        if (this.breaking.progress >= 1) {
          this._breakBlock(hit.x, hit.y, hit.z, hit.id);
          this._stopBreaking();
          this.actionCooldown = 0.15;
        } else {
          this.crack.visible = true;
          this.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
          const stage = Math.min(9, Math.floor(this.breaking.progress * 10));
          if (this.crack.material.map !== this.crackTextures[stage]) {
            this.crack.material.map = this.crackTextures[stage];
            this.crack.material.needsUpdate = true;
          }
          if (Math.random() < dt * 8) this._hitEffects(hit);
        }
      }
    } else {
      this._stopBreaking();
    }

    // Place
    const rightDown = input.buttons.has(2) || input.clicked.has(2);
    if (rightDown && hit && (input.clicked.has(2) || this.placeCooldown <= 0)) {
      if (this._placeBlock(hit)) {
        this.hand.startSwing();
      }
      this.placeCooldown = 0.22;
    }
  }

  _stopBreaking() {
    this.breaking = null;
    this.crack.visible = false;
  }

  _hitEffects(hit) {
    const b = BLOCKS[hit.id];
    this.particles.burst(hit.x, hit.y, hit.z, this._blockColor(hit.id), 3, { size: 0.06, up: 2, spread: 2, life: 0.5 });
    if (this.sound && Math.random() < 0.5) this.sound.play(b.sound, { volume: 0.35, duration: 0.5 });
  }

  _blockColor(id) {
    const b = BLOCKS[id];
    if (!b || !b.tex) return [0.5, 0.5, 0.5];
    const layer = b.tex.side;
    const a = this.texData.avg;
    let c = [a[layer * 3], a[layer * 3 + 1], a[layer * 3 + 2]];
    if (b.tint === 'grass' || b.tint === 'foliage') c = [c[0] * 0.5, c[1] * 0.72, c[2] * 0.3];
    else if (Array.isArray(b.tint)) c = [c[0] * b.tint[0], c[1] * b.tint[1], c[2] * b.tint[2]];
    if (id === B.GRASS) { const t = BLOCKS[B.DIRT].tex.side; c = [a[t * 3], a[t * 3 + 1], a[t * 3 + 2]]; }
    return c;
  }

  _breakEffects(x, y, z, id, vol = 1) {
    const b = BLOCKS[id];
    this.particles.burst(x, y, z, this._blockColor(id), b.render === 'cross' ? 10 : 24);
    if (this.sound) {
      const p = this.player;
      const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y, z + 0.5 - p.z);
      const v = vol * Math.max(0, 1 - d / 24);
      if (v > 0.02) this.sound.play(b.sound, { volume: v });
    }
  }

  _breakBlock(x, y, z, id) {
    const b = BLOCKS[id];
    if (this.gameMode === 'survival' && b.hardness === Infinity) return;
    if (!this.world.setBlock(x, y, z, B.AIR)) return;
    this._breakEffects(x, y, z, id);
    if (this.gameMode === 'survival' && b.drop) this.addItem(b.drop, 1);
  }

  _placeBlock(hit) {
    const slot = this.slots[this.selected];
    if (!slot) return false;
    const id = slot.id;
    const b = BLOCKS[id];
    if (!b || id === 0) return false;
    let x = hit.x, y = hit.y, z = hit.z;
    if (!BLOCKS[hit.id].replaceable || hit.id === id) { x += hit.nx; y += hit.ny; z += hit.nz; }
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const existing = this.world.getBlock(x, y, z);
    if (existing < 0) return false;
    if (existing !== 0 && !BLOCKS[existing].replaceable) return false;
    if (existing === id) return false;

    // Support requirements
    const below = this.world.getBlock(x, y - 1, z);
    if (b.render === 'cross' && id !== B.VINES) {
      if (id === B.DEAD_BUSH || id === B.CACTUS) { if (below !== B.SAND && below !== B.DIRT && below !== B.GRASS) return false; }
      else if (!SUPPORT_BLOCKS.has(below)) return false;
    }
    if (b.needsSupport && !(below > 0 && IS_SOLID[below])) return false;

    // Don't place solid blocks inside players.
    if (IS_SOLID[id]) {
      if (this._intersectsPlayer(x, y, z, this.player.x, this.player.y, this.player.z)) return false;
      for (const rp of this.remote.values()) {
        if (this._intersectsPlayer(x, y, z, rp.x, rp.y, rp.z)) return false;
      }
    }
    if (!this.world.setBlock(x, y, z, id)) return false;
    if (this.sound) this.sound.play(b.sound, { volume: 0.8, pitch: 0.8 });
    if (this.gameMode === 'survival') {
      slot.count--;
      if (slot.count <= 0) this.slots[this.selected] = null;
      this._refreshHotbar();
    }
    return true;
  }

  _intersectsPlayer(bx, by, bz, px, py, pz) {
    const hw = 0.3;
    return bx < px + hw && bx + 1 > px - hw && by < py + 1.8 && by + 1 > py && bz < pz + hw && bz + 1 > pz - hw;
  }

  _pickBlock(id) {
    if (id === B.WATER || !isValidBlockId(id)) return;
    const existing = this.slots.findIndex((s, i) => i < 9 && s && s.id === id);
    if (existing >= 0) { this.selected = existing; this._refreshHotbar(true); return; }
    if (this.gameMode !== 'creative') {
      const inv = this.slots.findIndex((s) => s && s.id === id);
      if (inv >= 9) {
        const tmp = this.slots[this.selected];
        this.slots[this.selected] = this.slots[inv];
        this.slots[inv] = tmp;
        this._refreshHotbar(true);
      }
      return;
    }
    this.slots[this.selected] = { id, count: 1 };
    this._refreshHotbar(true);
  }

  // ------------------------------------------------------------------ inventory

  addItem(id, count) {
    for (let i = 0; i < 36 && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < STACK) {
        const n = Math.min(count, STACK - s.count);
        s.count += n; count -= n;
      }
    }
    for (let i = 0; i < 36 && count > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(count, STACK);
        this.slots[i] = { id, count: n }; count -= n;
      }
    }
    this._refreshHotbar();
    if (this.hud.isInventoryOpen()) this._renderInventory();
    return count === 0;
  }

  countItem(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    if (this.cursor && this.cursor.id === id) n += this.cursor.count;
    return n;
  }

  removeItem(id, count) {
    for (let i = 35; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const n = Math.min(count, s.count);
        s.count -= n; count -= n;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
  }

  canCraft(r) { return r.in.every(([id, n]) => this.countItem(id) >= n); }

  craft(index) {
    const r = RECIPES[index];
    if (!r || this.gameMode !== 'survival' || !this.canCraft(r)) return;
    for (const [id, n] of r.in) this.removeItem(id, n);
    this.addItem(r.out[0], r.out[1]);
    this.sound?.click();
    this._renderInventory();
  }

  // button 0 = take/put whole stack, 2 = half / one
  inventoryClick(index, button) {
    if (index < 0 || index >= 36) return;
    if (this.gameMode === 'creative') {
      if (index < 9) { this.selected = index; this._refreshHotbar(true); }
      if (button === 2) this.slots[index] = null;
      this._renderInventory();
      return;
    }
    const s = this.slots[index];
    const c = this.cursor;
    if (!c) {
      if (!s) return;
      if (button === 2 && s.count > 1) {
        const half = Math.ceil(s.count / 2);
        this.cursor = { id: s.id, count: half };
        s.count -= half;
      } else {
        this.cursor = s;
        this.slots[index] = null;
      }
    } else if (!s) {
      if (button === 2) {
        this.slots[index] = { id: c.id, count: 1 };
        c.count--;
        if (c.count <= 0) this.cursor = null;
      } else {
        this.slots[index] = c;
        this.cursor = null;
      }
    } else if (s.id === c.id) {
      const n = button === 2 ? 1 : Math.min(c.count, STACK - s.count);
      s.count += n; c.count -= n;
      if (c.count <= 0) this.cursor = null;
    } else {
      this.slots[index] = c;
      this.cursor = s;
    }
    this._refreshHotbar();
    this._renderInventory();
  }

  creativePick(id) {
    if (!isValidBlockId(id) || id === 0) return;
    this.slots[this.selected] = { id, count: 1 };
    this.sound?.click();
    this._refreshHotbar(true);
    this._renderInventory();
  }

  _renderInventory() {
    this.hud.renderInventory({
      mode: this.gameMode,
      slots: this.slots,
      selected: this.selected,
      cursor: this.cursor,
      creativeBlocks: CREATIVE_ORDER,
      recipes: RECIPES.map((r, i) => ({ index: i, r, ok: this.canCraft(r) })),
    });
  }

  openInventory() {
    if (this.hud.isInventoryOpen()) return;
    this._stopBreaking();
    this.hud.openInventory({
      onSlot: (i, b) => this.inventoryClick(i, b),
      onPick: (id) => this.creativePick(id),
      onCraft: (i) => this.craft(i),
      onClose: () => this.closeInventory(),
    });
    this._renderInventory();
    this.input.exitLock();
  }

  closeInventory() {
    if (!this.hud.isInventoryOpen()) return;
    if (this.cursor) { this.addItem(this.cursor.id, this.cursor.count); this.cursor = null; }
    this.hud.closeInventory();
    this.input.requestLock();
  }

  _refreshHotbar(showName = false) {
    if (!this.hud || this.demo) return;
    this.hud.setHotbar(this.slots.slice(0, 9), this.selected, this.gameMode);
    if (showName) {
      const s = this.slots[this.selected];
      this.hud.showHeldName(s ? BLOCKS[s.id].name : '');
    }
  }

  // ------------------------------------------------------------------ keys / UI

  _onKeyDown(e) {
    if (this.demo || !this.ready) return false;
    const hud = this.hud;
    if (hud.isChatOpen()) return false;
    if (hud.isInventoryOpen()) {
      if (e.code === 'KeyE' || e.code === 'Escape') { this.closeInventory(); return true; }
      return false;
    }
    if (this.dead) return false;
    const code = e.code;
    if (code === 'KeyT' || code === 'Enter' || code === 'Slash') {
      if (!this.input.locked && !this.paused) return false;
      this.input.exitLock();
      this.chatOpenedFromGame = true;
      hud.openChat(code === 'Slash' ? '/' : '', (text) => this._onChat(text), () => this.input.requestLock());
      return true;
    }
    if (!this.input.locked) return false;
    if (code === 'KeyE') { this.openInventory(); return true; }
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= 9) { this.selected = n - 1; this._refreshHotbar(true); return true; }
    }
    if (code === 'F5' || code === 'KeyV') { this.thirdPerson = (this.thirdPerson + 1) % 3; return true; }
    if (code === 'F3') { this.showDebug = !this.showDebug; if (!this.showDebug) hud.setDebug(null); return true; }
    if (code === 'F1') { this.hideHud = !this.hideHud; hud.setHidden(this.hideHud); this.hand.visible = !this.hideHud; return true; }
    if (code === 'F2') { this.screenshotRequested = true; return true; }
    if (code === 'KeyQ' && this.gameMode === 'survival') {
      const s = this.slots[this.selected];
      if (s) { s.count--; if (s.count <= 0) this.slots[this.selected] = null; this._refreshHotbar(); }
      return true;
    }
    return false;
  }

  _onLockChange(locked) {
    if (this.demo || this.disposed) return;
    if (locked) {
      this.paused = false;
      this.hud.showPause(false);
      this.hud.setClickToPlay(false);
      this.sound?.unlock();
    } else if (this.ready && !this.dead && !this.hud.isInventoryOpen() && !this.hud.isChatOpen()) {
      this.paused = true;
      this.hud.showPause(true, { multiplayer: this.mode === 'multi' });
      if (this.mode === 'single') this.save();
    }
  }

  resume() {
    this.paused = false;
    this.hud.showPause(false);
    this.input.requestLock();
  }

  _onChat(text) {
    text = String(text || '').trim().slice(0, 200);
    if (!text) return;
    if (text.startsWith('/')) { this._command(text); return; }
    if (this.net) this.net.send({ t: 'chat', text });
    else this.hud.addChat(`<${this.profile.name}> ${text}`);
  }

  _command(text) {
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const hud = this.hud;
    const p = this.player;
    switch ((cmd || '').toLowerCase()) {
      case 'help':
        hud.addChat('Commands: /time set day|noon|sunset|night|midnight|<0-24000>, /gamemode creative|survival, /tp x y z, /spawn, /seed, /fly', 'system');
        break;
      case 'time': {
        if (args[0] !== 'set' || !args[1]) { hud.addChat('Usage: /time set day|noon|sunset|night|midnight|<0-24000>', 'system'); break; }
        const presets = { day: 0.04, morning: 0.04, noon: 0.25, sunset: 0.48, evening: 0.48, night: 0.58, midnight: 0.75, sunrise: 0.98 };
        let t = presets[args[1].toLowerCase()];
        if (t === undefined) {
          const n = Number(args[1]);
          if (!Number.isFinite(n)) { hud.addChat('Unknown time.', 'system'); break; }
          // Minecraft ticks: 0 = sunrise, 6000 = noon.
          t = (((n % 24000) + 24000) % 24000) / 24000;
        }
        if (this.net) this.net.send({ t: 'cmd', cmd: 'time', value: t });
        else { this.dayTime = t; hud.addChat('Time set.', 'system'); }
        break;
      }
      case 'gamemode': case 'gm': {
        const m = (args[0] || '').toLowerCase();
        const mode = m === 'creative' || m === 'c' || m === '1' ? 'creative' : m === 'survival' || m === 's' || m === '0' ? 'survival' : null;
        if (!mode) { hud.addChat('Usage: /gamemode creative|survival', 'system'); break; }
        this.gameMode = mode;
        if (mode === 'creative' && !this.slots.some((s, i) => i < 9 && s)) this._defaultHotbar();
        this._applyGameMode();
        hud.addChat(`Game mode set to ${mode}.`, 'system');
        break;
      }
      case 'tp': {
        const coords = args.slice(0, 3).map((a, i) => {
          const base = [p.x, p.y, p.z][i];
          if (a && a.startsWith('~')) return base + (Number(a.slice(1)) || 0);
          return Number(a);
        });
        if (coords.length < 3 || !coords.every(Number.isFinite)) { hud.addChat('Usage: /tp x y z', 'system'); break; }
        this._placePlayer(coords[0], Math.max(0, Math.min(WORLD_HEIGHT + 20, coords[1])), coords[2], p.yaw, p.pitch);
        hud.addChat(`Teleported to ${coords.map((c) => c.toFixed(1)).join(' ')}`, 'system');
        break;
      }
      case 'spawn':
        this._placePlayer(this.spawn.x, this.spawn.y, this.spawn.z, p.yaw, p.pitch);
        this.ready = false; // wait for chunks, then unstuck
        break;
      case 'seed':
        hud.addChat(`Seed: ${this.seed}`, 'system');
        break;
      case 'fly':
        if (this.gameMode === 'creative') { p.flying = !p.flying; hud.addChat(p.flying ? 'Flying on' : 'Flying off', 'system'); }
        else hud.addChat('Flying is only available in creative mode.', 'system');
        break;
      default:
        if (this.net) this.net.send({ t: 'chat', text });
        else hud.addChat(`Unknown command: /${cmd}. Type /help`, 'system');
    }
  }

  _updateHud() {
    if (this.showDebug) {
      const p = this.player;
      const col = this.gen.column(Math.floor(p.x), Math.floor(p.z));
      const l = this.world.getLight(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z));
      const yawDeg = ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360;
      const dirs = ['North (-Z)', 'East (+X)', 'South (+Z)', 'West (-X)'];
      const facing = dirs[Math.round(yawDeg / 90) % 4];
      const hours = Math.floor(((this.dayTime * 24) + 6) % 24);
      const mins = Math.floor(((this.dayTime * 24 * 60) + 360) % 60);
      let meshed = 0;
      for (const c of this.world.chunks.values()) if (c.meshedVersion >= 0) meshed++;
      this.hud.setDebug([
        `RealisCraft  ${this.fps} fps  (${this.settings.quality})`,
        `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
        `Chunk: ${Math.floor(p.x / CHUNK_SIZE)} ${Math.floor(p.z / CHUNK_SIZE)}   Facing: ${facing}`,
        `Biome: ${BIOME_NAMES[col.biome]}   Light: sky ${l.sky} block ${l.block}`,
        `Time: ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}   Mode: ${this.gameMode}${p.flying ? ' (flying)' : ''}`,
        `Chunks: ${meshed} rendered / ${this.world.chunks.size} loaded   Seed: ${this.seed}`,
        this.net ? `Players online: ${this.remote.size + 1}` : 'Singleplayer',
      ].join('\n'));
    } else if (this.showFps) {
      this.hud.setDebug(`${this.fps} fps`);
    } else {
      this.hud.setDebug(null);
    }
  }

  _saveScreenshot() {
    try {
      const url = this.r.canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `realiscraft-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      this.hud.toast('Screenshot saved');
    } catch (e) {
      this.hud.toast('Screenshot failed');
    }
  }

  // ------------------------------------------------------------------ save / exit

  save() {
    if (this.mode !== 'single' || !this.record || this.disposed) return Promise.resolve();
    const p = this.player;
    const rec = this.record;
    rec.edits = this.world.exportEdits();
    rec.time = this.dayTime;
    rec.mode = this.gameMode;
    rec.lastPlayed = Date.now();
    rec.player = {
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, flying: p.flying,
      health: this.health, selected: this.selected,
      slots: this.slots.map((s) => (s ? { id: s.id, count: s.count } : null)),
    };
    return saveWorld(rec);
  }

  async exit(reason) {
    if (this.disposed) return;
    if (this.mode === 'single') await this.save();
    this.dispose();
    this.onExit(reason);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    if (this.input) { this.input.exitLock(); this.input.dispose(); }
    if (this.net) { this.net.onClose = null; this.net.close(); }
    for (const rp of this.remote.values()) rp.dispose();
    this.remote.clear();
    this.world.dispose();
    this.particles.dispose();
    this.scene.remove(this.highlight, this.crack, this.model.group);
    this.highlight.geometry.dispose();
    this.highlight.material.dispose();
    this.crack.geometry.dispose();
    this.crack.material.dispose();
    for (const t of this.crackTextures) t.dispose();
    this.model.dispose();
    this.hand.dispose();
    if (this.hud && !this.demo) {
      this.hud.show(false);
      this.hud.setLoading(false);
      this.hud.showPause(false);
      this.hud.showDeath(false);
      this.hud.closeInventory();
      this.hud.closeChat();
      this.hud.setDebug(null);
    }
  }
}
