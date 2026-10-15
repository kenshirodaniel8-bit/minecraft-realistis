// Visual effects: pooled blocky particles (one InstancedMesh), floating
// damage numbers (DOM), attack telegraphs on the ground, and projectiles.
// Everything is capped so effects can never pile up.

import * as THREE from 'three';

const MAX_PARTICLES = 700;
const MAX_NUMBERS = 40;

const AURA_COLORS = {
  leaf: [0x7ad85a, 0xa8ef7a], spark: [0xfff27a, 0xffffff], ember: [0xff8a2a, 0xffd23a], glitter: [0xffffff, 0xffc2f4],
  snow: [0xffffff, 0xd8f6ff], bubble: [0xbff1ff, 0xffffff], dust: [0xc9a27a, 0xe8d0b0], glow: [0xfff27a, 0x7affd8],
  shadow: [0x9a6bff, 0x3a2a6a], petal: [0xff9fd8, 0xffe27a], star: [0xfff7a8, 0xb48cff], rune: [0x5fe3c0, 0xbffff0],
  pixel: [0xff3df2, 0x3dfff2], coin: [0xffd23a, 0xfff27a],
  holy: [0xfff6c0, 0xffffff, 0xffd23a], thunder: [0xfff27a, 0xffffff, 0x8fb8ff], cosmic: [0xff7ae0, 0x7affd8, 0xfff27a],
};

// how each Legend power's particles move (elementBurst)
const ELEMENT_MOTION = {
  fire: { grav: -3, up: 1.2, life: 0.8, size: 0.32 },
  ice: { grav: 10, up: 1.4, life: 0.8, size: 0.26 },
  lightning: { grav: 0, up: 0.4, life: 0.28, size: 0.18, speed: 2.2 },
  shadow: { grav: -0.8, up: 0.4, life: 1.1, size: 0.45, speed: 0.6 },
  light: { grav: -1.5, up: 1, life: 1.0, size: 0.22 },
  cosmic: { grav: 0, up: 0.5, life: 1.0, size: 0.24, speed: 1.3 },
};
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const ease = (k) => 1 - (1 - k) ** 3;

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.p = [];
    this.free = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.p.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.2, grav: 0, color: new THREE.Color(), spin: 0, rot: 0 });
      this.free.push(MAX_PARTICLES - 1 - i);
    }
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.numbers = [];
    this.numberRoot = document.body;
    this.telegraphs = [];
    this.projectiles = new Map();
    this.tmpV = new THREE.Vector3();
    this.shapes = []; // short-lived meshes: slash waves, blast rings, lightning
    this.timers = []; // staged effects (later)
  }

  // run fn after `sec` seconds (effects that come in stages)
  later(sec, fn) {
    if (sec <= 0) fn();
    else this.timers.push({ t: sec, fn });
  }

  // ------------------------------------------------------------ costume powers

  addShape(mesh, dur, step) {
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.shapes.push({ mesh, t: 0, dur, step });
    step(mesh, 0);
    if (this.shapes.length > 90) this.dropShape(0);
  }

  dropShape(i) {
    const s = this.shapes[i];
    this.scene.remove(s.mesh);
    s.mesh.geometry.dispose();
    s.mesh.material.dispose();
    this.shapes.splice(i, 1);
  }

  // a glowing crescent that flies forward (Black Spy's Master Power)
  slashWave(x, y, z, yaw, range, arcDeg, color) {
    const arc = (arcDeg * Math.PI) / 180;
    const geo = new THREE.RingGeometry(0.75, 1, 40, 1, Math.PI / 2 - arc / 2, arc);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const core = new THREE.Mesh(geo, mat);
    core.rotation.set(-Math.PI / 2, 0, -yaw);
    core.position.set(x, y + 2.2, z);
    this.addShape(core, 0.6, (m, k) => {
      const r = 1.5 + k * range;
      m.scale.set(r, r, 1);
      m.material.opacity = 0.95 * (1 - k * k);
    });
    // a second, dark inner edge for the spy look
    const geo2 = new THREE.RingGeometry(0.6, 0.78, 40, 1, Math.PI / 2 - arc / 2, arc);
    const dark = new THREE.Mesh(geo2, new THREE.MeshBasicMaterial({ color: 0x14141c, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    dark.rotation.copy(core.rotation);
    dark.position.copy(core.position);
    this.addShape(dark, 0.6, (m, k) => {
      const r = 1.5 + k * range;
      m.scale.set(r, r, 1);
      m.material.opacity = 0.8 * (1 - k);
    });
    for (let i = 0; i < 40; i++) {
      const a = yaw + (Math.random() - 0.5) * arc;
      const sp = range * (1.6 + Math.random() * 0.8);
      this.spawn(x, y + 1.6 + Math.random() * 1.4, z, { vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, vy: 0.4, grav: 0, life: 0.5, size: 0.22, color: [color, 0xffffff, 0x14141c] });
    }
  }

  // a flat ring that grows around you (fire, blizzard, sweet hug)
  ringBlast(x, y, z, radius, colors) {
    const geo = new THREE.RingGeometry(0.85, 1, 48);
    const mat = new THREE.MeshBasicMaterial({ color: colors[0], transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.4, z);
    this.addShape(m, 0.5, (mm, k) => {
      const r = 0.5 + k * radius;
      mm.scale.set(r, r, 1);
      mm.material.opacity = 0.9 * (1 - k);
    });
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = radius / 0.45;
      this.spawn(x, y + 0.8, z, { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 2 + Math.random() * 2, life: 0.55, size: 0.3, grav: 2, color: colors });
    }
  }

  // ------------------------------------------------------------ Legend Master

  // a glowing crescent left by a sword move. roll 0: flat (a sideways
  // slash), PI/2: upright (a chop). dir: which way it sweeps.
  slashArc(x, y, z, yaw, o = {}) {
    const radius = o.radius ?? 4.5;
    const arc = ((o.arc ?? 160) * Math.PI) / 180;
    const roll = o.roll ?? 0;
    const dir = o.dir ?? 1;
    const dur = o.dur ?? 0.34;
    const width = o.width ?? 0.3;
    const fwd = o.fwd ?? 0;
    const cols = o.colors || [0xffffff, 0xffffff];
    // basis: x = forward, y = across the slash plane, z = its normal
    const f = new THREE.Vector3(0, 0, 1);
    const side = new THREE.Vector3(Math.cos(roll), Math.sin(roll), 0);
    const nrm = new THREE.Vector3().crossVectors(f, side);
    const base = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, side, nrm));
    const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, yaw).multiply(base);
    const cx = x + Math.sin(yaw) * fwd;
    const cz = z + Math.cos(yaw) * fwd;
    const cy = y + (o.height ?? 2.4);
    const spin = new THREE.Quaternion();
    const layer = (inner, color, opacity, grow) => {
      const geo = new THREE.RingGeometry(inner, 1, Math.max(24, Math.round(arc * 12)), 1, -arc / 2, arc);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      m.position.set(cx, cy, cz);
      this.addShape(m, dur, (mm, k) => {
        // sweeps through, grows a little and fades
        spin.setFromAxisAngle(nrm, dir * (1 - ease(Math.min(1, k * 2.2))) * -arc * 0.6);
        mm.quaternion.copy(q).multiply(spin);
        const r = radius * (0.8 + grow * k);
        mm.scale.set(r, r, r);
        mm.material.opacity = opacity * (k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65);
      });
    };
    layer(1 - width, cols[0], 0.85, 0.45);
    layer(1 - width * 0.3, cols[1] ?? 0xffffff, 1, 0.4);
    // sparks thrown off the edge
    const n = o.sparks ?? 26;
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = (Math.random() - 0.5) * arc;
      p.set(Math.cos(a), Math.sin(a), 0).applyQuaternion(q).multiplyScalar(radius);
      const sp = 4 + Math.random() * 5;
      this.spawn(cx + p.x, cy + p.y, cz + p.z, { vx: (p.x / radius) * sp, vy: (p.y / radius) * sp + 1, vz: (p.z / radius) * sp, grav: 3, life: 0.45, size: 0.2, color: cols });
    }
  }

  // a column of light (from the sky or out of the ground)
  pillar(x, y, z, color, height = 26, radius = 1.4, dur = 0.8) {
    const geo = new THREE.CylinderGeometry(radius, radius * 1.15, height, 18, 1, true);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.position.set(x, y + height / 2, z);
    this.addShape(m, dur, (mm, k) => {
      const w = k < 0.15 ? 0.3 + (k / 0.15) * 0.9 : 1.2 - (k - 0.15) * 1.3;
      mm.scale.set(Math.max(0.02, w), 1, Math.max(0.02, w));
      mm.material.opacity = 0.6 * (1 - k * k);
    });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.35, radius * 0.35, height, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    core.position.copy(m.position);
    this.addShape(core, dur * 0.7, (mm, k) => {
      mm.material.opacity = 0.75 * (1 - k);
    });
    this.burst(x, y + 0.5, z, 14, { color: [color, 0xffffff], speed: 6, up: 1.2, life: 0.6, size: 0.25, grav: 6 });
  }

  // ice spikes bursting out of the ground in a ring
  iceSpikes(x, y, z, radius, n, color = 0x9fe8ff) {
    const geo = new THREE.ConeGeometry(0.7, 4.2, 5);
    geo.translate(0, 2.1, 0);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false });
    const m = new THREE.InstancedMesh(geo, mat, n);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const r = radius * (0.85 + Math.random() * 0.3);
      e.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6 + Math.cos(a) * 0.35);
      q.setFromEuler(e);
      const s = 0.7 + Math.random() * 0.7;
      m4.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, new THREE.Vector3(s, s * (0.8 + Math.random() * 0.8), s));
      m.setMatrixAt(i, m4);
      this.burst(x + Math.cos(a) * r, y + 0.5, z + Math.sin(a) * r, 3, { color: [0xffffff, color], speed: 4, up: 1.5, life: 0.6, size: 0.22, grav: 10 });
    }
    m.position.set(x, y - 0.2, z);
    this.addShape(m, 1.6, (mm, k) => {
      const g = k < 0.1 ? k / 0.1 : 1;
      mm.scale.set(1, Math.max(0.01, g * (k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1)), 1);
      mm.material.opacity = k > 0.7 ? 0.9 * (1 - (k - 0.7) / 0.3) : 0.9;
    });
  }

  // a sphere that bursts outwards (or collapses inwards)
  sphereBlast(x, y, z, radius, color, dur = 0.7, implode = false) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, blending: implode ? THREE.NormalBlending : THREE.AdditiveBlending, toneMapped: false }));
    m.position.set(x, y, z);
    this.addShape(m, dur, (mm, k) => {
      const e = ease(k);
      const r = implode ? radius * (1 - e) + 0.3 : 0.5 + radius * e;
      mm.scale.setScalar(Math.max(0.05, r));
      mm.material.opacity = implode ? 0.85 * Math.min(1, k * 4) : 0.7 * (1 - k);
    });
  }

  // a spear of light thrust forward
  beam(x, y, z, yaw, length, colors) {
    const dirV = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const geo = new THREE.ConeGeometry(0.55, length, 12, 1, true);
    geo.rotateX(Math.PI); // the point in front
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[0], transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dirV);
    m.position.set(x + dirV.x * (length / 2 + 0.8), y + 2.3, z + dirV.z * (length / 2 + 0.8));
    this.addShape(m, 0.35, (mm, k) => {
      mm.scale.set(1 - k * 0.7, 0.3 + ease(Math.min(1, k * 3)) * 0.7, 1 - k * 0.7);
      mm.material.opacity = 0.9 * (1 - k);
    });
    const tip = { x: x + dirV.x * (length + 0.8), y: y + 2.3, z: z + dirV.z * (length + 0.8) };
    this.later(0.08, () => this.burst(tip.x, tip.y, tip.z, 22, { color: [...colors, 0xffffff], speed: 8, life: 0.45, size: 0.24, grav: 2 }));
  }

  // lightning straight down from the sky
  skyBolt(x, y, z, color) {
    this.lightning([{ x: x + (Math.random() - 0.5) * 6, y: y + 38, z: z + (Math.random() - 0.5) * 6 }, { x, y: y + 0.3, z }], color, 3.2, 14);
    this.pillar(x, y, z, color, 30, 0.7, 0.4);
    this.burst(x, y + 0.5, z, 18, { color: [color, 0xffffff, 0x8fb8ff], speed: 9, up: 1.2, life: 0.4, size: 0.2, grav: 6 });
  }

  // the particles of a Legend power: embers rise, ice shards fall, sparks
  // flicker, darkness drifts, light floats up, stars swirl
  elementBurst(element, x, y, z, n, colors, speed = 6) {
    const mo = ELEMENT_MOTION[element] || ELEMENT_MOTION.fire;
    this.burst(x, y, z, n, { color: colors, speed: speed * (mo.speed ?? 1), up: mo.up, life: mo.life, size: mo.size, grav: mo.grav });
  }

  // a spiral of particles rising around a point (charging up)
  spiral(x, y, z, radius, colors, n = 40) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 6;
      const r = radius * (1 - i / n);
      this.later(i * 0.008, () => this.spawn(x + Math.cos(a) * r, y + (i / n) * 4, z + Math.sin(a) * r, { vx: -Math.cos(a) * 2, vz: -Math.sin(a) * 2, vy: 3, grav: 0, life: 0.6, size: 0.26, color: colors }));
    }
  }

  // the whole screen flashes (the strongest powers)
  flash(color = 0xffffff, strength = 0.6) {
    if (!this.flashEl) {
      this.flashEl = document.createElement('div');
      this.flashEl.className = 'screen-flash';
      document.body.appendChild(this.flashEl);
    }
    this.flashEl.style.background = `#${color.toString(16).padStart(6, '0')}`;
    this.flashT = 0;
    this.flashMax = strength;
    this.flashEl.style.opacity = String(strength);
  }

  // jagged lightning between points (Thunder Hero)
  lightning(points, color, jitter = 0.9, steps = 7) {
    if (points.length < 2) return;
    const pos = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      let prev = a;
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const j = k === steps ? 0 : jitter;
        const p = { x: a.x + (b.x - a.x) * t + (Math.random() - 0.5) * j, y: a.y + (b.y - a.y) * t + (Math.random() - 0.5) * j, z: a.z + (b.z - a.z) * t + (Math.random() - 0.5) * j };
        pos.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
      this.burst(b.x, b.y, b.z, 14, { color: [color, 0xffffff, 0x8fb8ff], speed: 7, life: 0.4, size: 0.2, grav: 4 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, toneMapped: false }));
    this.addShape(line, 0.35, (m, k) => {
      m.material.opacity = Math.random() < 0.3 ? 0.2 : 1 - k;
    });
  }

  spawn(x, y, z, o = {}) {
    if (!this.free.length) return;
    const i = this.free.pop();
    const p = this.p[i];
    p.alive = true;
    p.x = x; p.y = y; p.z = z;
    const sp = o.speed ?? 4;
    const a = Math.random() * Math.PI * 2;
    const up = o.up ?? 0.6;
    p.vx = (o.vx ?? Math.cos(a) * sp * Math.random());
    p.vz = (o.vz ?? Math.sin(a) * sp * Math.random());
    p.vy = o.vy ?? (up * sp * (0.5 + Math.random()));
    p.life = 0;
    p.max = o.life ?? 0.7 + Math.random() * 0.4;
    p.size = o.size ?? 0.18 + Math.random() * 0.12;
    p.grav = o.grav ?? 9;
    p.color.setHex(Array.isArray(o.color) ? o.color[Math.floor(Math.random() * o.color.length)] : o.color ?? 0xffffff);
    p.spin = (Math.random() - 0.5) * 10;
    p.rot = Math.random() * 6;
    p.shrink = o.shrink ?? true;
  }

  burst(x, y, z, n, o) {
    for (let i = 0; i < n; i++) this.spawn(x, y, z, o);
  }

  // Galaxy Sword star nova: a ring of stars racing outwards along the ground
  nova(x, z, r, y) {
    const n = 36;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = r / 0.45;
      this.spawn(x, y + 0.8, z, { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 1.5, life: 0.45, size: 0.3, grav: 0, color: [0xb48cff, 0xfff27a, 0xffffff] });
    }
    this.burst(x, y + 1.5, z, 16, { color: [0xfff27a, 0xb48cff], speed: 4, up: 2, life: 0.8, size: 0.25, grav: 3 });
  }

  hitSpark(x, y, z, crit) {
    this.burst(x, y, z, crit ? 16 : 9, { color: crit ? [0xffe14a, 0xffffff, 0xff8a2a] : [0xffffff, 0xffe9a0], speed: crit ? 9 : 6, life: 0.4, size: 0.2, grav: 6 });
  }

  aura(kind, x, y, z, color) {
    const cols = AURA_COLORS[kind] || [color || 0xffffff];
    const rise = kind === 'ember' || kind === 'glow' || kind === 'bubble' || kind === 'star' || kind === 'rune' || kind === 'spark' || kind === 'glitter' || kind === 'shadow' || kind === 'pixel';
    this.spawn(x + (Math.random() - 0.5) * 1.4, y, z + (Math.random() - 0.5) * 1.4, {
      color: cols, speed: 0.6, vy: rise ? 1 + Math.random() : -0.2, grav: rise ? -0.5 : kind === 'snow' || kind === 'leaf' || kind === 'petal' ? 0.6 : 2,
      life: 1.2 + Math.random(), size: kind === 'bubble' ? 0.18 : 0.12,
    });
  }

  confetti(x, y, z, n = 40) {
    this.burst(x, y, z, n, { color: [0xff5aa5, 0xffd93a, 0x5fd35a, 0x3fa6ff, 0xb48cff, 0xffffff], speed: 10, up: 1.2, life: 1.6, size: 0.22, grav: 7 });
  }

  coins(x, y, z, n = 12) {
    this.burst(x, y, z, n, { color: [0xffd23a, 0xffe97a], speed: 6, up: 1.4, life: 1.0, size: 0.25, grav: 14 });
  }

  // floating numbers / words at a world position
  number(text, pos, cls = '') {
    if (this.numbers.length >= MAX_NUMBERS) {
      const old = this.numbers.shift();
      old.el.remove();
    }
    const el = document.createElement('div');
    el.className = `dmg ${cls}`;
    el.textContent = text;
    this.numberRoot.appendChild(el);
    this.numbers.push({ el, pos: pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z), t: 0, jitter: (Math.random() - 0.5) * 30 });
  }

  // ground warning for a monster attack
  telegraph(kind, x, y, z, yaw, size, durMs, arc = 1, color = 0xff3a4a) {
    let geo;
    if (kind === 'slam') geo = new THREE.RingGeometry(size * 0.15, size, 40);
    else if (kind === 'breath') geo = new THREE.CircleGeometry(size, 24, -arc / 2, arc);
    else if (kind === 'lunge') geo = new THREE.PlaneGeometry(1.6, size);
    else return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    // local +x (breath) / +y (lunge) is turned to face the monster's yaw
    if (kind === 'breath') m.rotation.z = yaw - Math.PI / 2;
    if (kind === 'lunge') {
      m.rotation.z = yaw;
      x += Math.sin(yaw) * size / 2;
      z += Math.cos(yaw) * size / 2;
    }
    m.position.set(x, y + 0.15, z);
    m.renderOrder = 2;
    this.scene.add(m);
    this.telegraphs.push({ m, t: 0, dur: durMs / 1000 });
    if (this.telegraphs.length > 20) this.removeTelegraph(this.telegraphs.shift());
  }

  removeTelegraph(tg) {
    this.scene.remove(tg.m);
    tg.m.geometry.dispose();
    tg.m.material.dispose();
  }

  projectile(d, serverNow) {
    const color = new THREE.Color(d.color || '#ffffff');
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(0.35, d.r * 0.7), 1), new THREE.MeshBasicMaterial({ color }));
    m.position.set(d.x, d.y, d.z);
    this.scene.add(m);
    this.projectiles.set(d.id, { m, d, born: serverNow, color: color.getHex() });
    if (this.projectiles.size > 60) this.endProjectile(this.projectiles.keys().next().value);
  }

  endProjectile(id, hit) {
    const p = this.projectiles.get(id);
    if (!p) return;
    this.projectiles.delete(id);
    this.burst(p.m.position.x, p.m.position.y, p.m.position.z, hit ? 12 : 6, { color: p.color, speed: 5, life: 0.4 });
    this.scene.remove(p.m);
    p.m.geometry.dispose();
    p.m.material.dispose();
  }

  update(dt, serverNow) {
    // particles
    let n = 0;
    const s = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.p[i];
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        this.free.push(i);
        continue;
      }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - dt * 0.8;
      p.vz *= 1 - dt * 0.8;
      p.rot += p.spin * dt;
      const k = p.shrink ? 1 - p.life / p.max : 1;
      s.setScalar(Math.max(0.001, p.size * k));
      pos.set(p.x, p.y, p.z);
      this.q.setFromAxisAngle(this.tmpV.set(0.4, 1, 0.2).normalize(), p.rot);
      this.m4.compose(pos, this.q, s);
      this.mesh.setMatrixAt(n, this.m4);
      this.mesh.setColorAt(n, p.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // numbers
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const num = this.numbers[i];
      num.t += dt;
      if (num.t > 0.95) {
        num.el.remove();
        this.numbers.splice(i, 1);
        continue;
      }
      const v = this.tmpV.copy(num.pos).project(this.camera);
      if (v.z > 1) {
        num.el.style.display = 'none';
        continue;
      }
      num.el.style.display = '';
      num.el.style.left = `${(v.x * 0.5 + 0.5) * w + num.jitter}px`;
      num.el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
    }

    // staged effects
    if (this.timers.length) {
      const due = [];
      this.timers = this.timers.filter((tm) => {
        tm.t -= dt;
        if (tm.t <= 0) due.push(tm.fn);
        return tm.t > 0;
      });
      for (const fn of due) fn();
    }
    if (this.flashEl && this.flashT !== undefined) {
      this.flashT += dt;
      const o = Math.max(0, this.flashMax * (1 - this.flashT / 0.45));
      this.flashEl.style.opacity = String(o);
      if (o === 0) this.flashT = undefined;
    }

    // power shapes
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const sh = this.shapes[i];
      sh.t += dt;
      const k = Math.min(1, sh.t / sh.dur);
      sh.step(sh.mesh, k);
      if (k >= 1) this.dropShape(i);
    }

    // telegraphs
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const tg = this.telegraphs[i];
      tg.t += dt;
      const k = tg.t / tg.dur;
      tg.m.material.opacity = 0.2 + 0.35 * Math.min(1, k) + Math.sin(tg.t * 20) * 0.05;
      if (k >= 1.1) {
        this.removeTelegraph(tg);
        this.telegraphs.splice(i, 1);
      }
    }

    // projectiles move along their straight line
    for (const [id, p] of this.projectiles) {
      const age = (serverNow - p.born) / 1000;
      if (age * 1000 > p.d.life + 300) {
        this.endProjectile(id);
        continue;
      }
      p.m.position.set(p.d.x + p.d.vx * age, p.d.y + Math.sin(age * 10) * 0.1, p.d.z + p.d.vz * age);
      p.m.rotation.y += dt * 8;
      if (Math.random() < 0.5) this.spawn(p.m.position.x, p.m.position.y, p.m.position.z, { color: p.color, speed: 0.5, life: 0.35, size: 0.14, grav: 0 });
    }
  }
}
