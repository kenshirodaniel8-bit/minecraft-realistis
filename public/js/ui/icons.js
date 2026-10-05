// Isometric inventory icons rendered from the procedural texture data.

import { BLOCKS } from '../engine/blocks.js';

const ICON = 64;
const DEFAULT_GRASS = [0.48, 0.72, 0.30];
const DEFAULT_FOLIAGE = [0.40, 0.64, 0.24];

function layerCanvas(tex, layer, tint, tintByAlpha) {
  const S = tex.size;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const base = layer * S * S * 4;
  for (let y = 0; y < S; y++) {
    const sy = S - 1 - y; // texture data is stored bottom-up
    for (let x = 0; x < S; x++) {
      const si = base + (sy * S + x) * 4;
      const di = (y * S + x) * 4;
      let r = tex.albedo[si], g = tex.albedo[si + 1], b = tex.albedo[si + 2];
      const a = tex.albedo[si + 3];
      if (tint) {
        const m = tintByAlpha ? a / 255 : 1;
        r *= 1 + (tint[0] - 1) * m; g *= 1 + (tint[1] - 1) * m; b *= 1 + (tint[2] - 1) * m;
      }
      img.data[di] = r; img.data[di + 1] = g; img.data[di + 2] = b;
      img.data[di + 3] = tintByAlpha ? 255 : a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function shadeCanvas(src, f) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(0,0,0,${1 - f})`;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

export function buildBlockIcons(tex) {
  const icons = {};
  for (const b of BLOCKS) {
    if (!b || b.id === 0 || !b.tex) continue;
    const c = document.createElement('canvas');
    c.width = ICON; c.height = ICON;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    let tint = null;
    if (b.tint === 'grass') tint = DEFAULT_GRASS;
    else if (b.tint === 'foliage') tint = DEFAULT_FOLIAGE;
    else if (Array.isArray(b.tint)) tint = b.tint;

    if (b.render === 'cross' || b.render === 'torch') {
      const t = layerCanvas(tex, b.tex.side, tint, false);
      ctx.drawImage(t, 4, 4, ICON - 8, ICON - 8);
    } else if (b.render === 'water') {
      const t = layerCanvas(tex, b.tex.side, null, false);
      ctx.globalAlpha = 0.9;
      drawCube(ctx, t, t, t);
    } else {
      const cut = b.render === 'cutout';
      const isGrass = b.tint === 'grass';
      const top = layerCanvas(tex, b.tex.top, tint, false);
      const side = layerCanvas(tex, b.tex.side, tint, isGrass && !cut);
      if (cut && b.key === 'glass') ctx.globalAlpha = 1;
      drawCube(ctx, top, shadeCanvas(side, 0.78), shadeCanvas(side, 0.6));
    }
    icons[b.id] = c.toDataURL();
  }
  return icons;
}

function drawCube(ctx, top, left, right) {
  const s = ICON;
  const S = top.width;
  const cx = s / 2;
  const h = s * 0.25; // half height of the top rhombus
  const w = s * 0.43; // half width
  // Top face
  ctx.save();
  ctx.setTransform(w / S, h / S, -w / S, h / S, cx, s * 0.04);
  ctx.drawImage(top, 0, 0);
  ctx.restore();
  // Left face
  ctx.save();
  ctx.setTransform(w / S, h / S, 0, (s * 0.44) / S, cx - w, s * 0.04 + h);
  ctx.drawImage(left, 0, 0);
  ctx.restore();
  // Right face
  ctx.save();
  ctx.setTransform(w / S, -h / S, 0, (s * 0.44) / S, cx, s * 0.04 + 2 * h);
  ctx.drawImage(right, 0, 0);
  ctx.restore();
}
