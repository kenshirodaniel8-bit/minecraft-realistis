// One shared off-screen renderer for every 2D monster preview: recruitment
// cards and the inspector turntable (live) and collection/codex icons
// (rendered once and cached as images). Avoids opening many WebGL contexts.

import * as THREE from 'three';
import { SPECIES_BY_ID } from '#shared/monsters.js';
import { buildMonster } from './monsterRenderer.js';
import { animateMonster } from './animationSystem.js';
import { buildSword, Humanoid, ANIM, setNightGlow } from './humanoid.js';

export class MonsterPreview {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a8e0, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 5);
    this.scene.add(key);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.views = new Set();
    this.icons = new Map();
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
  }

  frameRig(rig, aspect) {
    const h = rig.height;
    const w = Math.max(rig.width, h * 0.8);
    this.camera.aspect = aspect;
    const dist = (Math.max(h, w / aspect) * 0.62) / Math.tan((this.camera.fov * Math.PI) / 360) + w * 0.6;
    this.camera.position.set(0, h * 0.62, dist);
    this.camera.lookAt(0, h * 0.46, 0);
    this.camera.updateProjectionMatrix();
  }

  // live preview drawn into a 2D canvas every frame until detached
  attach(canvas, speciesId, opts = {}) {
    const rig = buildMonster(speciesId);
    rig.root.scale.setScalar(1);
    const view = { canvas, rig, st: { pose: opts.pose || 'idle', poseT: 0 }, yaw: opts.yaw ?? 0.5, spin: opts.spin ?? 0.6, drag: 0, t: Math.random() * 10 };
    if (opts.draggable) {
      let last = null;
      canvas.addEventListener('pointerdown', (e) => {
        last = e.clientX;
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (last === null) return;
        view.yaw += (e.clientX - last) * 0.012;
        last = e.clientX;
        view.drag = 2;
      });
      canvas.addEventListener('pointerup', () => { last = null; });
    }
    this.views.add(view);
    return view;
  }

  detach(view) {
    this.views.delete(view);
  }

  render(view, dt) {
    const c = view.canvas;
    if (!c.isConnected) {
      this.views.delete(view);
      return;
    }
    // hidden canvases (collapsed cards, closed tabs) are skipped
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w < 2 || h < 2) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    this.renderer.setSize(w, h, false);
    this.holder.clear();
    this.holder.add(view.rig.root);
    view.t += dt;
    if (view.drag > 0) view.drag -= dt;
    else view.yaw += dt * view.spin;
    view.rig.root.rotation.y = view.yaw;
    animateMonster(view.rig, view.st, dt, view.t);
    this.frameRig(view.rig, w / h);
    this.renderer.render(this.scene, this.camera);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.renderer.domElement, 0, 0, w, h);
  }

  update(dt) {
    for (const v of this.views) this.render(v, dt);
  }

  // sword icon (cached data URL)
  swordIcon(id, size = 96) {
    const key = `sword|${id}|${size}`;
    if (this.icons.has(key)) return this.icons.get(key);
    const sword = buildSword(id);
    const g = new THREE.Group();
    g.add(sword);
    sword.position.y = -(sword.userData.length + 0.5) / 2;
    g.rotation.z = -Math.PI / 4;
    g.rotation.y = 0.5;
    this.renderer.setSize(size, size, false);
    this.holder.clear();
    this.holder.add(g);
    const L = sword.userData.length + 1;
    this.camera.aspect = 1;
    this.camera.position.set(0, 0, (L * 0.62) / Math.tan((this.camera.fov * Math.PI) / 360));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.icons.set(key, url);
    return url;
  }

  // a player in a costume (cached data URL); night: dark, with the glow on
  costumeIcon(id, size = 160, night = false, power = null) {
    const key = `costume|${id}|${size}|${night}|${power}`;
    if (this.icons.has(key)) return this.icons.get(key);
    const h = new Humanoid(0x3a7ae0);
    h.setCostume(id, power);
    h.setSword(null);
    setNightGlow(night);
    h.update(0.5, ANIM.idle, 0, false, 1.2);
    h.update(0.5, ANIM.idle, 0, false, 1.4);
    h.root.rotation.y = 0.35;
    this.renderer.setSize(size, size, false);
    this.holder.clear();
    this.holder.add(h.root);
    if (night) {
      this.scene.background = new THREE.Color(0x0c0c24);
      this.renderer.toneMappingExposure = 0.35;
    }
    this.camera.aspect = 1;
    this.camera.position.set(0, 3.2, 13);
    this.camera.lookAt(0, 2.9, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    this.scene.background = null;
    this.renderer.toneMappingExposure = 1;
    setNightGlow(false);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.icons.set(key, url);
    return url;
  }

  // static icon (cached data URL)
  icon(speciesId, size = 128) {
    const key = `${speciesId}|${size}`;
    if (this.icons.has(key)) return this.icons.get(key);
    if (!SPECIES_BY_ID[speciesId]) return '';
    const rig = buildMonster(speciesId);
    rig.root.scale.setScalar(1);
    rig.root.rotation.y = 0.45;
    animateMonster(rig, { pose: 'idle', poseT: 0 }, 0, 1.3);
    this.renderer.setSize(size, size, false);
    this.holder.clear();
    this.holder.add(rig.root);
    this.frameRig(rig, 1);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.icons.set(key, url);
    return url;
  }
}
