// Text sprites drawn on canvases (names, signs, prices).

import * as THREE from 'three';

export function makeLabel(text, opts = {}) {
  const font = opts.font || '800 44px "Trebuchet MS", "Arial Rounded MT Bold", system-ui, sans-serif';
  const pad = opts.pad ?? 18;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  const lines = String(text).split('\n');
  const lineH = opts.lineHeight || 52;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
  const h = lineH * lines.length + pad;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    roundRect(ctx, 2, 2, w - 4, h - 4, Math.min(24, h / 2 - 2));
    ctx.fill();
    if (opts.border) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = opts.border;
      ctx.stroke();
    }
  }
  lines.forEach((line, i) => {
    const y = pad / 2 + lineH * (i + 0.5);
    if (opts.stroke !== false) {
      ctx.lineWidth = opts.strokeWidth || 8;
      ctx.strokeStyle = opts.strokeColor || 'rgba(0,0,0,0.75)';
      ctx.lineJoin = 'round';
      ctx.strokeText(line, w / 2, y);
    }
    ctx.fillStyle = (opts.colors && opts.colors[i]) || opts.color || '#ffffff';
    ctx.fillText(line, w / 2, y);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: opts.depthTest ?? true, fog: opts.fog ?? false });
  const sprite = new THREE.Sprite(mat);
  const scale = opts.scale || 0.03;
  sprite.scale.set(w * scale, h * scale, 1);
  sprite.renderOrder = opts.renderOrder ?? 5;
  sprite.userData.labelText = text;
  sprite.userData.baseScale = sprite.scale.clone();
  sprite.onBeforeRender = capOnScreenSize;
  return sprite;
}

// A label closer to the camera than CAP_DIST shrinks in proportion, so it never
// looks bigger on screen than it does from CAP_DIST away (no giant names when a
// monster walks right up to the camera).
const CAP_DIST = 18;
const tmpPos = new THREE.Vector3();
function capOnScreenSize(renderer, scene, camera) {
  const d = camera.position.distanceTo(tmpPos.setFromMatrixPosition(this.matrixWorld));
  const k = Math.min(1, Math.max(0.2, d / CAP_DIST));
  const b = this.userData.baseScale;
  if (Math.abs(this.scale.x - b.x * k) > 1e-4) {
    this.scale.set(b.x * k, b.y * k, 1);
    this.updateMatrixWorld();
  }
}

export function disposeLabel(sprite) {
  if (!sprite) return;
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A soft additive glow (instead of a real light: adding or removing lights
// makes three.js recompile every lit material and slows down all shading).
const glowTextures = new Map();
export function glowSprite(color, size = 3, opacity = 0.7) {
  if (!glowTextures.has('g')) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTextures.set('g', new THREE.CanvasTexture(c));
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTextures.get('g'), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1);
  s.renderOrder = 4;
  return s;
}
