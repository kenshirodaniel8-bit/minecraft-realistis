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
  return sprite;
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
