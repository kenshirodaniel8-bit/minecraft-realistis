// Renderer, scene, lights, sky and the day/night cycle.

import * as THREE from 'three';
import { REGION_BY_ID } from '#shared/regions.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uStars;
uniform float uTime;
uniform float uRainbow;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.4));
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 3.0 + pow(sd, 12.0) * 0.25);
  if (uStars > 0.0 && h > 0.0) {
    vec3 g = floor(d * 220.0);
    float s = hash(g);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0);
    col += vec3(step(0.9965, s) * uStars * tw);
  }
  if (uRainbow > 0.0) {
    float a = atan(d.z, d.x);
    vec3 rb = 0.5 + 0.5 * cos(6.2831 * (a * 0.3 + uTime * 0.1 + vec3(0.0, 0.33, 0.67)));
    col = mix(col, col * 0.6 + rb * 0.6, uRainbow * smoothstep(-0.1, 0.5, h) * 0.55);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const C = (hex) => new THREE.Color(hex);

// Keyframes over the day (0 = sunrise). Colors for sky top/horizon and lights.
const DAY_KEYS = [
  { t: 0.0, top: C(0x6f8fd8), hor: C(0xffb98a), sun: C(0xffc79a), sunI: 1.2, hemi: 0.9, amb: C(0xc9b0ff) },
  { t: 0.08, top: C(0x3f9bff), hor: C(0xbfe6ff), sun: C(0xfff4e0), sunI: 2.6, hemi: 1.25, amb: C(0xffffff) },
  { t: 0.55, top: C(0x3f9bff), hor: C(0xc9ecff), sun: C(0xfff4e0), sunI: 2.6, hemi: 1.25, amb: C(0xffffff) },
  { t: 0.64, top: C(0x5a6fc8), hor: C(0xff9a6a), sun: C(0xffa070), sunI: 1.4, hemi: 0.9, amb: C(0xffc0a0) },
  { t: 0.7, top: C(0x1a2050), hor: C(0x3a3a7a), sun: C(0x8090ff), sunI: 0.45, hemi: 0.55, amb: C(0x8a90ff) },
  { t: 0.95, top: C(0x101838), hor: C(0x2a3060), sun: C(0x8090ff), sunI: 0.4, hemi: 0.5, amb: C(0x8a90ff) },
  { t: 1.0, top: C(0x6f8fd8), hor: C(0xffb98a), sun: C(0xffc79a), sunI: 1.2, hemi: 0.9, amb: C(0xc9b0ff) },
];

export const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 0, viewDist: 230, antialias: false },
  medium: { pixelRatio: 1.25, shadows: true, shadowSize: 1024, viewDist: 300, antialias: true },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, viewDist: 380, antialias: true },
};

export class SceneView {
  constructor(canvas, quality = 'high') {
    this.quality = QUALITY[quality] ? quality : 'high';
    const q = QUALITY[this.quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 2000);
    this.scene.fog = new THREE.Fog(0xbfe6ff, 120, q.viewDist);

    this.hemi = new THREE.HemisphereLight(0xdff3ff, 0x7a9a5a, 1.2);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      const sc = this.sun.shadow.camera;
      sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 400;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.6;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x3f9bff) },
      uHorizon: { value: new THREE.Color(0xc9ecff) },
      uBottom: { value: new THREE.Color(0x9bc4e8) },
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
      uSunColor: { value: new THREE.Color(0xfff4e0) },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uRainbow: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.sky = sky;
    this.scene.add(sky);

    this.clouds = this.makeClouds();
    this.scene.add(this.clouds);

    this.fogColor = new THREE.Color(0xbfe6ff);
    this.targetFog = { color: new THREE.Color(0xbfe6ff), near: 120, far: q.viewDist };
    this.luckyMix = 0;
    this.nightness = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  makeClouds() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, fog: false });
    const box = new THREE.BoxGeometry(1, 1, 1);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(box, mat);
        m.scale.set(18 + rnd() * 26, 6 + rnd() * 6, 14 + rnd() * 18);
        m.position.set((k - n / 2) * 14 + rnd() * 8, rnd() * 4, rnd() * 10 - 5);
        c.add(m);
      }
      const a = rnd() * Math.PI * 2;
      const r = 100 + rnd() * 700;
      c.position.set(Math.cos(a) * r, 150 + rnd() * 60, Math.sin(a) * r);
      c.userData.speed = 1 + rnd() * 2;
      g.add(c);
    }
    return g;
  }

  setQuality(q) {
    this.quality = q;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // dayT: 0..1 (0 = sunrise). regionId tints the fog. lucky: LUCKY LUCKY active.
  update(dt, time, dayT, focus, regionId, lucky) {
    let a = DAY_KEYS[0];
    let b = DAY_KEYS[1];
    for (let i = 0; i < DAY_KEYS.length - 1; i++) {
      if (dayT >= DAY_KEYS[i].t && dayT <= DAY_KEYS[i + 1].t) {
        a = DAY_KEYS[i];
        b = DAY_KEYS[i + 1];
        break;
      }
    }
    const k = (dayT - a.t) / Math.max(1e-6, b.t - a.t);
    const top = a.top.clone().lerp(b.top, k);
    const hor = a.hor.clone().lerp(b.hor, k);
    const sunCol = a.sun.clone().lerp(b.sun, k);
    const sunI = a.sunI + (b.sunI - a.sunI) * k;
    const hemiI = a.hemi + (b.hemi - a.hemi) * k;
    this.nightness = Math.max(0, Math.min(1, (0.9 - sunI) / 0.5));

    this.luckyMix += ((lucky ? 1 : 0) - this.luckyMix) * Math.min(1, dt * 1.5);
    if (this.luckyMix > 0.01) {
      top.lerp(C(0xffb03a), this.luckyMix * 0.5);
      hor.lerp(C(0xfff0a0), this.luckyMix * 0.6);
    }
    this.skyUniforms.uTop.value.copy(top);
    this.skyUniforms.uHorizon.value.copy(hor);
    this.skyUniforms.uBottom.value.copy(hor).multiplyScalar(0.8);
    this.skyUniforms.uStars.value = this.nightness;
    this.skyUniforms.uTime.value = time;
    this.skyUniforms.uRainbow.value = this.luckyMix;

    // the sun travels across the sky; at night the "sun" light is the moon
    const ang = dayT * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.max(0.15, Math.sin(ang) * 0.9 + 0.1), 0.35).normalize();
    const lightDir = this.nightness > 0.5 ? new THREE.Vector3(-0.4, 0.8, 0.3).normalize() : sunDir;
    this.skyUniforms.uSunDir.value.copy(sunDir);
    this.skyUniforms.uSunColor.value.copy(sunCol).multiplyScalar(1 - this.nightness * 0.8);

    this.sun.color.copy(sunCol);
    this.sun.intensity = sunI;
    this.hemi.intensity = hemiI;
    this.hemi.color.copy(a.amb.clone().lerp(b.amb, k));
    if (focus) {
      this.sun.position.set(focus.x + lightDir.x * 150, focus.y + lightDir.y * 150, focus.z + lightDir.z * 150);
      this.sun.target.position.set(focus.x, focus.y, focus.z);
      this.sky.position.copy(this.camera.position);
    }

    // fog follows the region you are in, darker at night
    const region = regionId ? REGION_BY_ID[regionId] : null;
    const q = QUALITY[this.quality];
    if (region) {
      this.targetFog.color.setHex(region.fog.color);
      this.targetFog.near = region.fog.near;
      this.targetFog.far = Math.min(q.viewDist, region.fog.far + 40);
    }
    const nightFog = this.targetFog.color.clone().lerp(C(0x1a2040), this.nightness * 0.75);
    if (this.luckyMix > 0.01) nightFog.lerp(C(0xffe9a0), this.luckyMix * 0.4);
    this.scene.fog.color.lerp(nightFog, Math.min(1, dt * 1.5));
    this.scene.fog.near += (this.targetFog.near - this.scene.fog.near) * Math.min(1, dt);
    this.scene.fog.far += (this.targetFog.far - this.scene.fog.far) * Math.min(1, dt);
    this.renderer.setClearColor(this.scene.fog.color);

    for (const c of this.clouds.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 900) c.position.x = -900;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
