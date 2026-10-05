// Renderer: Three.js setup, sun/moon/sky, shadows that follow the camera,
// clouds and the post-processing chain (god rays, bloom, tone mapping, FXAA).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
  U, createTerrainMaterial, createTerrainDepthMaterial, createWaterMaterial,
  createSkyMaterial, createCloudMaterial,
} from './materials.js';

export const QUALITY_PRESETS = {
  low: { pixelRatio: 0.75, shadows: 0, shadowDist: 0, bloom: false, rays: false, fxaa: false, clouds: true },
  medium: { pixelRatio: 1, shadows: 1024, shadowDist: 44, bloom: true, rays: false, fxaa: true, clouds: true },
  high: { pixelRatio: 1.25, shadows: 2048, shadowDist: 72, bloom: true, rays: true, fxaa: true, clouds: true },
  ultra: { pixelRatio: 2, shadows: 4096, shadowDist: 100, bloom: true, rays: true, fxaa: true, clouds: true },
};

class AtmospherePass extends Pass {
  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
        uRays: { value: 0 },
        uRayColor: { value: new THREE.Color(1, 0.9, 0.7) },
        uAspect: { value: 1 },
        uUnderwater: { value: 0 },
        uTime: { value: 0 },
        uDamage: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 uSunPos;
        uniform float uRays;
        uniform vec3 uRayColor;
        uniform float uAspect;
        uniform float uUnderwater;
        uniform float uTime;
        uniform float uDamage;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          if (uUnderwater > 0.5) {
            uv += vec2(sin(uv.y * 24.0 + uTime * 2.0), cos(uv.x * 21.0 + uTime * 1.7)) * 0.0022;
          }
          vec4 base = texture2D(tDiffuse, uv);
          vec3 col = base.rgb;
          if (uRays > 0.001) {
            const int N = 40;
            vec2 delta = (uv - uSunPos) / float(N) * 0.85;
            vec2 c = uv;
            float illum = 0.0;
            float decay = 1.0;
            for (int i = 0; i < N; i++) {
              c -= delta;
              if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) break;
              float sky = step(0.99999, texture2D(tDepth, c).r);
              vec2 dd = (c - uSunPos) * vec2(uAspect, 1.0);
              illum += sky * exp(-dot(dd, dd) * 5.0) * decay;
              decay *= 0.96;
            }
            col += uRayColor * (illum / float(N)) * uRays;
          }
          if (uUnderwater > 0.5) col = mix(col, col * vec3(0.35, 0.72, 0.95), 0.55);
          vec2 q = vUv - 0.5;
          col *= 1.0 - dot(q, q) * 0.38;
          if (uDamage > 0.0) col = mix(col, col * vec3(1.6, 0.35, 0.3), uDamage * (0.3 + dot(q, q) * 1.6));
          gl_FragColor = vec4(col, base.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

export class Renderer {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;
    r.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Hand / held item overlay scene.
    this.handScene = new THREE.Scene();
    this.handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.handScene.add(this.handCamera);
    this.handAmbient = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.handSun = new THREE.DirectionalLight(0xffffff, 1);
    this.handSun.position.set(0.4, 1, 0.6);
    this.handScene.add(this.handAmbient, this.handSun);

    // Lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 1.6;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x9cc4ff, 0x5a4a32, 1.0);
    this.scene.add(this.hemi);

    // Materials
    this.materials = {
      solid: createTerrainMaterial('solid'),
      cutout: createTerrainMaterial('cutout'),
      water: createWaterMaterial(),
      depth: {
        solid: createTerrainDepthMaterial('solid'),
        cutout: createTerrainDepthMaterial('cutout'),
      },
    };

    // Sky dome + clouds
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), createSkyMaterial());
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.cloudMat = createCloudMaterial();
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200, 1, 1), this.cloudMat);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.renderOrder = 5;
    this.clouds.frustumCulled = false;
    this.scene.add(this.clouds);

    // Post-processing
    this.composer = null;
    this.timeOfDay = 0.1;
    this.settings = Object.assign({}, settings);
    this._tmpV = new THREE.Vector3();
    this._sunScreen = new THREE.Vector3();
    // Scratch objects reused every frame (avoids garbage-collection stutter).
    this._t = {
      sunColor: new THREE.Color(), moonColor: new THREE.Color(0.6, 0.7, 1.0),
      skyTop: new THREE.Color(), nightTop: new THREE.Color(0.05, 0.07, 0.14), duskTop: new THREE.Color(0.9, 0.55, 0.4),
      moonDir: new THREE.Vector3(), up: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(),
      snapped: new THREE.Vector3(), camDir: new THREE.Vector3(),
    };
    this.applySettings(settings);
    this.resize();
  }

  applySettings(settings) {
    this.settings = Object.assign({}, this.settings, settings);
    const q = QUALITY_PRESETS[this.settings.quality] || QUALITY_PRESETS.high;
    this.preset = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, q.pixelRatio));
    const shadowsOn = q.shadows > 0;
    if (this.renderer.shadowMap.enabled !== shadowsOn) {
      this.renderer.shadowMap.enabled = shadowsOn;
      this._forceMaterialUpdate();
    }
    this.sun.castShadow = shadowsOn;
    if (shadowsOn) {
      const s = this.sun.shadow;
      if (s.mapSize.width !== q.shadows) {
        s.mapSize.set(q.shadows, q.shadows);
        if (s.map) { s.map.dispose(); s.map = null; }
      }
      const d = q.shadowDist;
      s.camera.left = -d; s.camera.right = d; s.camera.top = d; s.camera.bottom = -d;
      s.camera.near = 1; s.camera.far = 600;
      s.camera.updateProjectionMatrix();
    }
    this.clouds.visible = q.clouds;
    this.camera.fov = this.settings.fov || 75;
    this.camera.updateProjectionMatrix();
    this._buildComposer();
  }

  _forceMaterialUpdate() {
    for (const m of [this.materials.solid, this.materials.cutout, this.materials.water]) m.needsUpdate = true;
    this.scene.traverse((o) => {
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => { m.needsUpdate = true; });
        else o.material.needsUpdate = true;
      }
    });
  }

  _buildComposer() {
    if (this.composer) {
      this.composer.renderTarget1.depthTexture?.dispose();
      this.composer.renderTarget2.depthTexture?.dispose();
      this.composer.dispose();
      for (const p of this._passes || []) p.dispose?.();
    }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, size.x), h = Math.max(1, size.y);
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
    rt.depthTexture = new THREE.DepthTexture(w, h);
    rt.texture.name = 'scene';
    const composer = new EffectComposer(this.renderer, rt);
    const q = this.preset;

    const renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(renderPass);

    this.atmosphere = new AtmospherePass();
    composer.addPass(this.atmosphere);

    const handPass = new RenderPass(this.handScene, this.handCamera);
    handPass.clear = false;
    handPass.clearDepth = true;
    composer.addPass(handPass);

    this.bloom = null;
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.22, 0.45, 1.05);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
    if (q.fxaa) composer.addPass(new FXAAPass());
    this._passes = composer.passes.slice();
    this.composer = composer;
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCamera.aspect = w / h;
    this.handCamera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.width = w; this.height = h;
  }

  // timeOfDay in [0,1): 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight.
  updateEnvironment(timeOfDay, time, opts = {}) {
    this.timeOfDay = timeOfDay;
    const a = timeOfDay * Math.PI * 2;
    const sunDir = this._tmpV.set(Math.cos(a), Math.sin(a), 0.32).normalize();
    U.uSunDir.value.copy(sunDir);
    U.uTime.value = time;
    const elev = sunDir.y;
    const day = smoothstep(-0.12, 0.2, elev);
    const sunset = 1 - smoothstep(0.0, 0.32, Math.abs(elev + 0.03));
    const rain = opts.rain || 0;
    U.uDay.value = day;
    U.uSunset.value = sunset;
    U.uRain.value = rain;

    // Sun / moon light.
    const warm = smoothstep(-0.02, 0.4, elev);
    const T = this._t;
    const sunColor = T.sunColor.setRGB(1.0, 0.5 + 0.45 * warm, 0.22 + 0.68 * warm);
    const sunInt = 3.2 * smoothstep(-0.03, 0.12, elev) * (1 - rain * 0.75);
    const moonDir = T.moonDir.copy(sunDir).negate();
    const moonInt = 0.32 * smoothstep(-0.03, 0.15, moonDir.y) * (1 - rain * 0.7);
    const useSun = elev > -0.02;
    const lightDir = useSun ? sunDir : moonDir;
    this.sun.color.copy(useSun ? sunColor : T.moonColor);
    this.sun.intensity = useSun ? sunInt : moonInt;
    U.uSunColor.value.copy(sunColor);
    U.uSunIntensity.value = sunInt;

    // Ambient sky light.
    const skyTop = T.skyTop.setRGB(0.32, 0.5, 0.85).lerp(T.nightTop, 1 - day);
    skyTop.lerp(T.duskTop, sunset * 0.35);
    this.hemi.color.copy(skyTop);
    this.hemi.groundColor.setRGB(0.28, 0.24, 0.18).multiplyScalar(0.25 + 0.75 * day);
    this.hemi.intensity = (0.1 + 1.05 * day) * (1 - rain * 0.3);

    // Shadow camera follows the player, snapped to texels to avoid shimmering.
    const center = opts.center || this.camera.position;
    if (this.sun.castShadow) {
      const s = this.sun.shadow;
      const d = this.preset.shadowDist;
      const texel = (2 * d) / s.mapSize.width;
      const z = lightDir;
      const up = Math.abs(z.y) > 0.99 ? T.up.set(1, 0, 0) : T.up.set(0, 1, 0);
      const x = T.x.crossVectors(up, z).normalize();
      const y = T.y.crossVectors(z, x).normalize();
      const cx = center.dot(x), cy = center.dot(y);
      const snapped = T.snapped.copy(center)
        .addScaledVector(x, Math.round(cx / texel) * texel - cx)
        .addScaledVector(y, Math.round(cy / texel) * texel - cy);
      this.sun.target.position.copy(snapped);
      this.sun.position.copy(snapped).addScaledVector(lightDir, 300);
    } else {
      this.sun.target.position.copy(center);
      this.sun.position.copy(center).addScaledVector(lightDir, 300);
    }
    this.sun.target.updateMatrixWorld();

    // Hand overlay lighting mirrors the world light at the player.
    const lightAtPlayer = opts.playerLight || { sky: 15, block: 0 };
    const skyF = (lightAtPlayer.sky / 15) ** 2;
    const blockF = (lightAtPlayer.block / 15) ** 3;
    this.handAmbient.color.copy(skyTop);
    this.handAmbient.groundColor.copy(this.hemi.groundColor);
    this.handAmbient.intensity = this.hemi.intensity * (0.03 + 0.97 * skyF) + blockF * 1.2;
    this.handSun.color.copy(this.sun.color);
    this.handSun.intensity = this.sun.intensity * 0.8 * smoothstep(0.45, 0.9, lightAtPlayer.sky / 15);

    // Sky + clouds follow the camera.
    this.sky.position.copy(this.camera.position);
    this.clouds.position.set(this.camera.position.x, 178, this.camera.position.z);

    // God rays: strongest at low sun angles.
    if (this.atmosphere) {
      const au = this.atmosphere.material.uniforms;
      au.uTime.value = time;
      au.uUnderwater.value = opts.underwater ? 1 : 0;
      au.uDamage.value = opts.damage || 0;
      au.uAspect.value = this.width / this.height;
      let rays = 0;
      if (this.preset.rays && useSun && !opts.underwater) {
        const camDir = T.camDir;
        this.camera.getWorldDirection(camDir);
        const facing = camDir.dot(sunDir);
        if (facing > 0) {
          const sp = this._sunScreen.copy(this.camera.position).addScaledVector(sunDir, 400).project(this.camera);
          au.uSunPos.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
          rays = smoothstep(0.0, 0.5, facing) * (0.55 + 0.75 * (1 - warm * 0.6)) * smoothstep(-0.02, 0.08, elev) * (1 - rain);
        }
      }
      au.uRays.value = rays;
      au.uRayColor.value.copy(sunColor);
    }
    U.uUnderwater.value = opts.underwater ? 1 : 0;
  }

  setFogDistance(renderDistanceChunks) {
    const far = renderDistanceChunks * 16;
    U.uFogFar.value = far * 0.98;
    U.uFogNear.value = far * 0.6;
    U.uHaze.value = 0.55 / Math.max(far * 2.2, 64);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer?.dispose();
    this.renderer.dispose();
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
