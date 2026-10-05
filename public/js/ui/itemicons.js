// Procedural 32x32 pixel-art icons for non-block items (tools, food, materials).
// Drawn with vector shapes, then snapped to hard pixels and outlined.

import { ITEMS, TOOL_MATERIALS } from '../engine/items.js';

const N = 32;
const STICK = { base: [138, 98, 54], light: [176, 132, 76], dark: [98, 68, 36] };

function rgb(c, a = 1) { return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
function mul(c, f) { return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)]; }

function stroke(ctx, pts, width, color, cap = 'round') {
  ctx.strokeStyle = rgb(color);
  ctx.lineWidth = width;
  ctx.lineCap = cap;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 3) ctx.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
  else for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function fill(ctx, pts, color) {
  ctx.fillStyle = rgb(color);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
}

function ellipse(ctx, x, y, rx, ry, rot, color) {
  ctx.fillStyle = rgb(color);
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

function handle(ctx, x0, y0, x1, y1) {
  stroke(ctx, [[x0, y0], [x1, y1]], 3.6, STICK.base);
  stroke(ctx, [[x0 - 0.8, y0 - 0.8], [x1 - 0.8, y1 - 0.8]], 1.2, STICK.light);
}

const DRAW = {
  stick(ctx) { handle(ctx, 8, 25, 24, 9); },
  coal(ctx) {
    fill(ctx, [[7, 17], [11, 9], [19, 7], [25, 12], [26, 20], [20, 26], [11, 25]], [34, 34, 38]);
    fill(ctx, [[11, 11], [18, 9], [17, 15], [12, 16]], [78, 78, 84]);
    fill(ctx, [[19, 17], [24, 15], [23, 21]], [62, 62, 68]);
  },
  iron_ingot(ctx) { ingot(ctx, [214, 214, 220]); },
  gold_ingot(ctx) { ingot(ctx, [250, 210, 60]); },
  diamond(ctx) {
    const c = [96, 232, 222];
    fill(ctx, [[16, 4], [26, 12], [16, 28], [6, 12]], c);
    fill(ctx, [[16, 4], [21, 12], [16, 28], [11, 12]], mul(c, 1.15));
    fill(ctx, [[6, 12], [26, 12], [21, 9], [11, 9]], [210, 255, 252]);
    fill(ctx, [[16, 28], [21, 12], [26, 12]], mul(c, 0.7));
  },
  apple(ctx) {
    ellipse(ctx, 16, 19, 9.5, 8.5, 0, [196, 32, 36]);
    ellipse(ctx, 12.5, 16, 3, 2.2, -0.6, [248, 120, 110]);
    stroke(ctx, [[16, 11], [17.5, 5]], 2, [96, 64, 30]);
    ellipse(ctx, 21, 7, 4, 2, -0.5, [70, 150, 50]);
  },
  raw_meat(ctx) { meat(ctx, [214, 84, 88], [244, 200, 196]); },
  cooked_meat(ctx) { meat(ctx, [150, 86, 40], [196, 140, 90]); },
};

function ingot(ctx, c) {
  fill(ctx, [[5, 20], [11, 13], [27, 13], [22, 20]], mul(c, 1.12));
  fill(ctx, [[5, 20], [22, 20], [22, 25], [5, 25]], mul(c, 0.86));
  fill(ctx, [[22, 20], [27, 13], [27, 18], [22, 25]], mul(c, 0.68));
  stroke(ctx, [[9, 16.5], [20, 16.5]], 1, mul(c, 1.3));
}

function meat(ctx, c, fat) {
  ellipse(ctx, 15, 17, 10, 7.5, -0.6, c);
  stroke(ctx, [[8, 22], [20, 10]], 1.6, fat);
  ellipse(ctx, 25, 7, 3.2, 2.6, 0, [236, 228, 214]);
  stroke(ctx, [[21, 11], [24, 8]], 2.6, [236, 228, 214]);
}

function tool(ctx, type, material) {
  const m = TOOL_MATERIALS[material];
  const c = m.color, light = mul(c, 1.25), dark = mul(c, 0.7);
  switch (type) {
    case 'pickaxe':
      handle(ctx, 6, 27, 20, 13);
      stroke(ctx, [[9, 6], [24, 6], [27, 22]], 4.2, c);
      stroke(ctx, [[9.5, 5], [23.5, 5], [26, 20]], 1.3, light);
      break;
    case 'axe':
      handle(ctx, 6, 27, 21, 12);
      fill(ctx, [[15, 11], [20, 5], [27, 8], [29, 15], [24, 21], [19, 16]], c);
      fill(ctx, [[20, 5], [27, 8], [24, 10], [19, 8]], light);
      fill(ctx, [[29, 15], [24, 21], [23, 17]], dark);
      break;
    case 'shovel':
      handle(ctx, 6, 27, 18, 15);
      fill(ctx, [[16, 13], [22, 5], [27, 5], [28, 10], [20, 18]], c);
      fill(ctx, [[22, 5], [27, 5], [25, 8]], light);
      break;
    case 'sword':
    default:
      stroke(ctx, [[10, 22], [26, 6]], 4, c, 'butt');
      fill(ctx, [[26, 6], [28, 4], [27.5, 7.5]], c);
      stroke(ctx, [[11, 20], [26.5, 4.5]], 1.2, light);
      stroke(ctx, [[6, 19], [13, 26]], 3, [70, 52, 30]);
      stroke(ctx, [[4, 28], [9, 23]], 3, STICK.base);
      break;
  }
}

// Snap the anti-aliased drawing to hard pixels and add a dark outline.
function pixelize(src) {
  const ctx = src.getContext('2d');
  const img = ctx.getImageData(0, 0, N, N);
  const d = img.data;
  const solid = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    if (d[i * 4 + 3] >= 110) { solid[i] = 1; d[i * 4 + 3] = 255; } else d[i * 4 + 3] = 0;
  }
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (solid[i]) continue;
      let n = -1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < N && yy < N && solid[yy * N + xx]) { n = yy * N + xx; break; }
      }
      if (n >= 0) {
        out[i * 4] = d[n * 4] * 0.35; out[i * 4 + 1] = d[n * 4 + 1] * 0.35; out[i * 4 + 2] = d[n * 4 + 2] * 0.35; out[i * 4 + 3] = 235;
      }
    }
  }
  ctx.putImageData(new ImageData(out, N, N), 0, 0);
  return src;
}

export function drawItemIcon(item) {
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const ctx = c.getContext('2d');
  if (item.tool) tool(ctx, item.tool.type, item.tool.material);
  else if (DRAW[item.key]) DRAW[item.key](ctx);
  pixelize(c);
  // Upscale with hard pixels.
  const big = document.createElement('canvas');
  big.width = 64; big.height = 64;
  const b = big.getContext('2d');
  b.imageSmoothingEnabled = false;
  b.drawImage(c, 0, 0, 64, 64);
  return big;
}

// Returns { icons: {id: dataURL}, canvases: {id: canvas} }.
export function buildItemIcons() {
  const icons = {};
  const canvases = {};
  for (const it of ITEMS) {
    const c = drawItemIcon(it);
    canvases[it.id] = c;
    icons[it.id] = c.toDataURL();
  }
  return { icons, canvases };
}
