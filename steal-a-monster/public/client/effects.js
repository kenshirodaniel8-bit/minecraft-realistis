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
};

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
  }

  // ------------------------------------------------------------ costume powers

  addShape(mesh, dur, step) {
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.shapes.push({ mesh, t: 0, dur, step });
    if (this.shapes.length > 24) this.dropShape(0);
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

  // jagged lightning between points (Thunder Hero)
  lightning(points, color) {
    if (points.length < 2) return;
    const pos = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const steps = 7;
      let prev = a;
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const j = k === steps ? 0 : 0.9;
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
