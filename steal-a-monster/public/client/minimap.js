// Minimap (rotates with the camera) and the full world map panel.

import { REGIONS, REGION_BY_ID, RING, regionIdAt, regionCenter, regionLockReason } from '#shared/regions.js';
import { SPECIES_BY_ID, RARITIES } from '#shared/monsters.js';

const WORLD_EXTENT = RING.edge + 40;
const IMG = 640;

function hex(c) {
  return '#' + c.toString(16).padStart(6, '0');
}

export class MapRenderer {
  constructor(world) {
    this.world = world;
    this.image = this.renderTerrain(-WORLD_EXTENT, -WORLD_EXTENT, WORLD_EXTENT * 2, IMG);
    this.islands = REGIONS.filter((r) => r.shape.kind === 'island').map((r) => {
      const m = r.shape.r + 30;
      return { region: r, x0: r.shape.cx - m, z0: r.shape.cz - m, size: m * 2, img: this.renderTerrain(r.shape.cx - m, r.shape.cz - m, m * 2, 220) };
    });
  }

  renderTerrain(x0, z0, size, px) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(px, px);
    const cache = {};
    for (const r of REGIONS) {
      const lo = r.colors.low;
      cache[r.id] = [(lo >> 16) & 255, (lo >> 8) & 255, lo & 255];
    }
    for (let j = 0; j < px; j++) {
      for (let i = 0; i < px; i++) {
        const x = x0 + ((i + 0.5) / px) * size;
        const z = z0 + ((j + 0.5) / px) * size;
        const h = this.world.groundHeight(x, z);
        const id = regionIdAt(x, z);
        let rgb;
        if (h < -0.3) {
          const d = Math.min(1, -h / 10);
          rgb = [60 - d * 30, 160 - d * 50, 230 - d * 40];
        } else if (id) {
          const base = cache[id];
          const shade = 0.82 + Math.min(0.3, h / 60);
          rgb = [base[0] * shade, base[1] * shade, base[2] * shade];
        } else rgb = [40, 90, 150];
        const k = (j * px + i) * 4;
        img.data[k] = rgb[0];
        img.data[k + 1] = rgb[1];
        img.data[k + 2] = rgb[2];
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // roads and plaza
    const toPx = (v) => ((v - x0) / size) * px;
    ctx.strokeStyle = 'rgba(240, 220, 170, 0.8)';
    ctx.lineWidth = Math.max(1, (6 / size) * px);
    if (x0 < 0 && x0 + size > 0) {
      ctx.beginPath();
      ctx.moveTo(toPx(-RING.edge), toPx(0));
      ctx.lineTo(toPx(RING.edge), toPx(0));
      ctx.moveTo(toPx(0), toPx(-RING.edge));
      ctx.lineTo(toPx(0), toPx(RING.edge));
      ctx.stroke();
      for (const r of [72, 128]) {
        ctx.beginPath();
        ctx.arc(toPx(0), toPx(0), (r / size) * px, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#e8e0cc';
      ctx.beginPath();
      ctx.arc(toPx(0), toPx(0), (38 / size) * px, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  }

  // ------------------------------------------------------------ minimap

  drawMini(canvas, s) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const R = W / 2;
    const range = 130;
    const scale = R / range;
    const me = s.me;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#2a6aa8';
    ctx.fillRect(0, 0, W, W);
    ctx.translate(R, R);
    // rotate so the camera's forward is up
    ctx.rotate(s.camYaw);
    ctx.scale(scale, scale);
    ctx.translate(-me.x, -me.z);
    const unitsPerPx = (WORLD_EXTENT * 2) / IMG;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.image, -WORLD_EXTENT, -WORLD_EXTENT, IMG * unitsPerPx, IMG * unitsPerPx);
    for (const isl of this.islands) ctx.drawImage(isl.img, isl.x0, isl.z0, isl.size, isl.size);
    // locked regions are shaded
    this.shadeLocked(ctx, s);
    // bases
    for (const b of this.world.bases) {
      const st = s.bases[b.index];
      ctx.save();
      ctx.translate(b.x, b.z);
      ctx.rotate(Math.atan2(b.tu.z, b.tu.x));
      ctx.fillStyle = st ? hex(st.colorHex ?? 0x3a7ae0) : 'rgba(255,255,255,.35)';
      ctx.strokeStyle = b.index === s.myBase ? '#ffe14a' : '#241640';
      ctx.lineWidth = b.index === s.myBase ? 4 : 2;
      ctx.fillRect(-13, -13, 26, 26);
      ctx.strokeRect(-13, -13, 26, 26);
      ctx.restore();
    }
    // lucky blocks
    for (const b of s.lucky) {
      ctx.fillStyle = '#ffd93a';
      ctx.strokeStyle = '#5a3a00';
      ctx.lineWidth = 2;
      ctx.fillRect(b.x - 4, b.z - 4, 8, 8);
      ctx.strokeRect(b.x - 4, b.z - 4, 8, 8);
    }
    // monsters
    for (const m of s.monsters) {
      ctx.fillStyle = m.aggro ? '#ff4a5e' : m.rare ? '#c46bff' : '#ffffff';
      ctx.beginPath();
      ctx.arc(m.x, m.z, m.rare ? 3.2 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // radar and clues
    for (const r of s.radar) {
      ctx.fillStyle = RARITIES[SPECIES_BY_ID[r.sp]?.rarity]?.color || '#c46bff';
      ctx.beginPath();
      ctx.arc(r.x, r.z, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const c of s.clues) {
      ctx.strokeStyle = '#ff5aa5';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.z, 7 + Math.sin(s.t * 5) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    // other players
    for (const p of s.players) {
      ctx.fillStyle = p.carrying ? '#ff4a5e' : '#3fa6ff';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.z, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    // me (always centered, pointing in my facing direction relative to the camera)
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(-(me.yaw - s.camYaw - Math.PI));
    ctx.fillStyle = '#ffe14a';
    ctx.strokeStyle = '#241640';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // objective arrow on the rim
    if (s.objective) {
      const dx = s.objective.x - me.x;
      const dz = s.objective.z - me.z;
      const d = Math.hypot(dx, dz);
      const a = Math.atan2(dz, dx);
      ctx.save();
      ctx.translate(R, R);
      ctx.rotate(s.camYaw);
      const r = Math.min(R - 10, d * scale);
      ctx.translate(Math.cos(a) * r, Math.sin(a) * r);
      ctx.rotate(-s.camYaw);
      ctx.fillStyle = '#ff5aa5';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  shadeLocked(ctx, s) {
    for (const r of REGIONS) {
      const reason = regionLockReason(r, s.progress, s.active);
      if (!reason) continue;
      ctx.fillStyle = 'rgba(20, 10, 40, 0.5)';
      const sh = r.shape;
      ctx.beginPath();
      if (sh.kind === 'sector') {
        let a1 = sh.a1 < sh.a0 ? sh.a1 + 360 : sh.a1;
        ctx.arc(0, 0, sh.r2, (sh.a0 * Math.PI) / 180, (a1 * Math.PI) / 180);
        ctx.arc(0, 0, sh.r1, (a1 * Math.PI) / 180, (sh.a0 * Math.PI) / 180, true);
      } else if (sh.kind === 'ring') {
        ctx.arc(0, 0, sh.r2, 0, Math.PI * 2);
        ctx.arc(0, 0, sh.r1, Math.PI * 2, 0, true);
      } else if (sh.kind === 'island') {
        ctx.arc(sh.cx, sh.cz, sh.r, 0, Math.PI * 2);
      }
      ctx.closePath();
      ctx.fill('evenodd');
    }
  }

  // ------------------------------------------------------------ full map

  drawFull(canvas, s) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    // canvas pixels per CSS pixel, so text keeps its size however big the map
    // is shown; the label size itself follows the map's on-screen size
    const cssW = canvas.clientWidth || W;
    const ui = W / cssW;
    const fontPx = Math.max(8.5, Math.min(12, cssW / 52));
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#1e4a7a';
    ctx.fillRect(0, 0, W, W);
    ctx.save();
    // the continent in the middle, the islands as round insets around it
    // (in the direction where they really are)
    const k = (W * 0.66) / (WORLD_EXTENT * 2);
    ctx.translate(W / 2, W / 2);
    ctx.scale(k, k);
    ctx.beginPath();
    ctx.arc(0, 0, RING.edge + 6, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.image, -WORLD_EXTENT, -WORLD_EXTENT, WORLD_EXTENT * 2, WORLD_EXTENT * 2);
    this.shadeLocked(ctx, s);
    ctx.restore();
    const insets = this.islands.map((isl) => {
      const sh = isl.region.shape;
      const a = Math.atan2(sh.cz, sh.cx);
      const sz = W * 0.13;
      return { isl, sz, cx: W / 2 + Math.cos(a) * W * 0.42, cy: W / 2 + Math.sin(a) * W * 0.42 };
    });
    for (const n of insets) {
      const { isl, sz, cx, cy } = n;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, sz / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(isl.img, cx - sz / 2, cy - sz / 2, sz, sz);
      const reason = regionLockReason(isl.region, s.progress, s.active);
      if (reason) {
        ctx.fillStyle = 'rgba(20,10,40,.6)';
        ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz);
      }
      ctx.restore();
      ctx.lineWidth = 3 * ui;
      ctx.strokeStyle = '#241640';
      ctx.beginPath();
      ctx.arc(cx, cy, sz / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `800 ${Math.round(fontPx * 0.95 * ui)}px "Trebuchet MS", system-ui`;
      ctx.textAlign = 'center';
      const name = isl.region.name.replace(/ (Island|Isle)$/, '');
      const lock = !reason ? '' : s.active.has(isl.region.id) ? `🔒 Lv ${isl.region.unlock?.level}` : `🔒 ${s.minPop?.[isl.region.id] ?? isl.region.minPopulation}+ players`;
      const lines = lock ? [name, lock] : [name];
      // labels under the island, except at the bottom edge of the map
      const above = cy > W * 0.75;
      lines.forEach((t, i) => {
        const y = above ? cy - sz / 2 - (6 + (lines.length - 1 - i) * 13) * ui : cy + sz / 2 + (12 + i * 13) * ui;
        const half = ctx.measureText(t).width / 2 + 4 * ui;
        const x = Math.min(W - half, Math.max(half, cx));
        ctx.lineWidth = 3 * ui;
        ctx.strokeStyle = '#241640';
        ctx.fillStyle = i === 0 ? '#fff' : '#ffb0c0';
        ctx.strokeText(t, x, y);
        ctx.fillText(t, x, y);
      });
    }
    // a world point on an island -> its inset on screen
    const onInset = (x, z) => {
      for (const n of insets) {
        const sh = n.isl.region.shape;
        const m = sh.r + 30;
        const dx = x - sh.cx;
        const dz = z - sh.cz;
        if (dx * dx + dz * dz < m * m) return { x: n.cx + (dx / m) * (n.sz / 2), y: n.cy + (dz / m) * (n.sz / 2) };
      }
      return null;
    };
    const dot = (x, z, r, fill, stroke) => {
      const p = onInset(x, z);
      if (!p && Math.max(Math.abs(x), Math.abs(z)) > WORLD_EXTENT) return;
      const sx = p ? p.x : W / 2 + x * k;
      const sy = p ? p.y : W / 2 + z * k;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(sx, sy, r * ui, 0, Math.PI * 2);
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2 * ui;
        ctx.stroke();
      }
    };
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.scale(k, k);
    // bases
    for (const b of this.world.bases) {
      const st = s.bases[b.index];
      ctx.fillStyle = st ? hex(st.colorHex ?? 0x3a7ae0) : 'rgba(255,255,255,.3)';
      ctx.fillRect(b.x - 12, b.z - 12, 24, 24);
      if (b.index === s.myBase) {
        ctx.strokeStyle = '#ffe14a';
        ctx.lineWidth = 6;
        ctx.strokeRect(b.x - 14, b.z - 14, 28, 28);
      }
    }
    ctx.restore();
    // discovered spots, clues, players (on the continent or on an island inset)
    for (const sp of this.world.spots) {
      if (!s.discoveredSpots[sp.id] && sp.hidden) continue;
      dot(sp.x, sp.z, 3.2, s.discoveredSpots[sp.id] ? '#ffe14a' : 'rgba(255,255,255,.6)');
    }
    for (const c of s.clues) dot(c.x, c.z, 6, 'rgba(255,90,165,.35)', '#ff5aa5');
    for (const p of s.players) dot(p.x, p.z, 4, '#3fa6ff');
    dot(s.me.x, s.me.z, 5.5, '#ffe14a', '#241640');
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.scale(k, k);
    // labels (two lines: name + lock)
    ctx.textAlign = 'center';
    for (const r of REGIONS) {
      if (r.shape.kind === 'island') continue;
      let c = regionCenter(r);
      // (upper left: the island insets sit in the lower corners)
      if (r.shape.kind === 'ring') c = { x: Math.cos(2.36) * 535, z: Math.sin(2.36) * 535 };
      if (r.id === 'plains') c = { x: 0, z: -118 };
      // regions centred on the horizontal axis: stagger inner/outer labels
      if (r.shape.kind === 'sector' && Math.abs(c.z) < 60) c = { x: c.x, z: c.z + (r.shape.r1 === RING.hub ? 60 : -60) };
      const reason = regionLockReason(r, s.progress, s.active);
      const lines = [r.name];
      if (reason && r.id !== 'plains') lines.push(`🔒 Lv ${r.unlock.level}${r.unlock.swordTier ? ` · T${r.unlock.swordTier} sword` : ''}`);
      const fp = fontPx * 0.85;
      ctx.font = `800 ${Math.round((fp * ui) / k)}px "Trebuchet MS", system-ui`;
      ctx.lineWidth = (4 * ui) / k;
      ctx.strokeStyle = '#241640';
      lines.forEach((t, i) => {
        const y = c.z + (i - (lines.length - 1) / 2) * ((fp * 1.25 * ui) / k);
        ctx.fillStyle = i === 0 ? '#ffffff' : '#ffb0c0';
        ctx.strokeText(t, c.x, y);
        ctx.fillText(t, c.x, y);
      });
    }
    ctx.restore();
  }
}

export { REGION_BY_ID };
