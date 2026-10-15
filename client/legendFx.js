// The Legend Master's effects: its 10 sword moves (one after the other) and
// its master power on Z, in the colours and style of the chosen power.

import { LEGEND_POWERS } from '#shared/costumes.js';
import { LEGEND_MOVE_DUR } from './humanoid.js';

export const AURA_OF = { fire: 'ember', ice: 'snow', lightning: 'thunder', shadow: 'shadow', light: 'holy', cosmic: 'cosmic' };

function palette(element) {
  return (LEGEND_POWERS[element] || LEGEND_POWERS.fire).fx;
}

// One sword move. pos/yaw: where the player stands and faces; the effect
// comes at the moment the blade hits in that move's animation.
export function legendSwingFx(fx, element, move, pos, yaw, onSlam) {
  const cols = palette(element);
  const hit = (k) => LEGEND_MOVE_DUR[move] * k;
  const { x, y, z } = pos;
  const ahead = (d) => ({ x: x + Math.sin(yaw) * d, z: z + Math.cos(yaw) * d });
  const sparks = (px, py, pz, n = 16) => fx.elementBurst(element, px, py, pz, n, cols, 6);
  switch (move) {
    case 0:
      fx.later(hit(0.28), () => fx.slashArc(x, y, z, yaw, { radius: 4.8, arc: 170, roll: 0.15, dir: 1, colors: cols }));
      break;
    case 1:
      fx.later(hit(0.28), () => fx.slashArc(x, y, z, yaw, { radius: 4.8, arc: 170, roll: -0.15, dir: -1, colors: cols }));
      break;
    case 2:
      fx.later(hit(0.32), () => {
        fx.slashArc(x, y, z, yaw, { radius: 4.6, arc: 150, roll: Math.PI / 2, dir: -1, height: 2.2, fwd: 0.4, colors: cols });
        const a = ahead(4);
        fx.later(0.08, () => {
          fx.ringBlast(a.x, y, a.z, 3.5, cols);
          sparks(a.x, y + 0.5, a.z, 24);
        });
      });
      break;
    case 3:
      fx.later(hit(0.3), () => {
        fx.slashArc(x, y, z, yaw, { radius: 4.6, arc: 170, roll: Math.PI / 2, dir: 1, height: 2.6, colors: cols });
        const a = ahead(2.5);
        for (let i = 0; i < 4; i++) fx.later(i * 0.05, () => sparks(a.x, y + 1 + i * 1.5, a.z, 10));
      });
      break;
    case 4:
      fx.later(hit(0.15), () => fx.slashArc(x, y, z, yaw + Math.PI, { radius: 5.2, arc: 359, roll: 0, dir: -1, height: 2.3, dur: 0.45, colors: cols, sparks: 40 }));
      break;
    case 5:
      fx.later(hit(0.4), () => fx.beam(x, y, z, yaw, 10, cols));
      break;
    case 6:
      fx.later(hit(0.12), () => fx.slashArc(x, y, z, yaw, { radius: 4.6, arc: 150, roll: 0.85, dir: 1, colors: cols }));
      fx.later(hit(0.55), () => {
        fx.slashArc(x, y, z, yaw, { radius: 4.6, arc: 150, roll: -0.85, dir: -1, colors: cols });
        const a = ahead(3.5);
        sparks(a.x, y + 2.2, a.z, 24);
      });
      break;
    case 7:
      fx.later(hit(0.58), () => {
        const a = ahead(2.5);
        fx.ringBlast(a.x, y, a.z, 7, cols);
        fx.sphereBlast(a.x, y, a.z, 4, cols[0], 0.5);
        sparks(a.x, y + 0.5, a.z, 40);
        fx.burst(a.x, y + 0.3, a.z, 20, { color: [0x8a7a6a, 0xc9a27a], speed: 7, up: 1.4, life: 0.8, size: 0.35, grav: 14 });
        onSlam?.(0.7);
      });
      break;
    case 8:
      fx.later(hit(0.1), () => fx.slashArc(x, y, z, yaw, { radius: 5, arc: 359, roll: 0, dir: 1, height: 1.6, dur: 0.4, colors: cols }));
      fx.later(hit(0.5), () => fx.slashArc(x, y, z, yaw + 1, { radius: 6, arc: 359, roll: 0.1, dir: 1, height: 3.6, dur: 0.45, colors: cols, sparks: 40 }));
      fx.later(hit(0.2), () => fx.spiral(x, y, z, 5, cols, 30));
      break;
    default: {
      // Legend Break: power gathers on the blade, then a giant crescent flies out
      fx.later(0, () => fx.spiral(x, y, z, 3, cols, 30));
      fx.later(hit(0.45), () => {
        fx.slashArc(x, y, z, yaw, { radius: 6, arc: 160, roll: Math.PI / 2, dir: -1, height: 3, width: 0.4, colors: cols, sparks: 40 });
        fx.slashWave(x, y, z, yaw, 14, 70, cols[0]);
        const a = ahead(6);
        fx.pillar(a.x, y, a.z, cols[0], 18, 1.6, 0.6);
        fx.ringBlast(a.x, y, a.z, 6, cols);
        onSlam?.(1);
      });
    }
  }
}

// Z: the master power. d: the server's power event; c: the costume with its
// power (costumeWithPower); targets get hit in the second stage.
export function legendPowerFx(fx, d, c, mine) {
  const el = c.element || 'fire';
  const cols = palette(el);
  const pw = c.power;
  const { x, y, z, yaw } = d;
  const R = pw.radius || pw.range || 12;
  // stage 1: charging up
  fx.spiral(x, y, z, 4, cols, 50);
  fx.ringBlast(x, y, z, 3, cols);
  fx.sphereBlast(x, y + 3, z, 3.2, cols[0], 0.35, true);
  // stage 2: the release
  const RELEASE = 0.38;
  fx.later(RELEASE, () => {
    if (mine) fx.flash(cols[0], 0.55);
    fx.sphereBlast(x, y + 2, z, R * 0.6, cols[0], 0.6);
    switch (el) {
      case 'fire':
        fx.ringBlast(x, y, z, R, cols);
        fx.later(0.15, () => fx.ringBlast(x, y, z, R * 0.7, cols));
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          fx.later(0.05 + i * 0.04, () => fx.pillar(x + Math.cos(a) * R * 0.65, y, z + Math.sin(a) * R * 0.65, cols[i % 2], 9, 0.9, 0.9));
        }
        fx.elementBurst('fire', x, y + 1, z, 80, cols, 9);
        break;
      case 'ice':
        fx.ringBlast(x, y, z, R, cols);
        fx.iceSpikes(x, y, z, R * 0.45, 10);
        fx.later(0.18, () => fx.iceSpikes(x, y, z, R * 0.85, 16));
        fx.elementBurst('ice', x, y + 3, z, 70, cols, 9);
        break;
      case 'lightning': {
        const pts = [{ x, y: y + 12, z }, ...d.targets.map((t) => ({ x: t.x, y: t.y + 1.5, z: t.z }))];
        fx.lightning(pts, cols[0], 1.4, 9);
        d.targets.forEach((t, i) => fx.later(i * 0.07, () => fx.skyBolt(t.x, t.y, t.z, cols[0])));
        for (let i = 0; i < 5; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 4 + Math.random() * R * 0.8;
          fx.later(0.1 + i * 0.09, () => fx.skyBolt(x + Math.cos(a) * r, y, z + Math.sin(a) * r, cols[i % 2 ? 2 : 0]));
        }
        fx.skyBolt(x, y, z, 0xffffff);
        break;
      }
      case 'shadow':
        fx.slashWave(x, y, z, yaw, pw.range || 18, pw.arc || 180, cols[1]);
        fx.later(0.1, () => fx.slashWave(x, y + 1, z, yaw, (pw.range || 18) * 0.8, pw.arc || 180, cols[0]));
        fx.sphereBlast(x, y + 2, z, 5, 0x14081e, 0.8, true);
        fx.elementBurst('shadow', x, y + 2, z, 60, cols, 6);
        break;
      case 'light':
        fx.pillar(x, y, z, cols[1], 40, 2.2, 1.0);
        fx.ringBlast(x, y, z, R, cols);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          fx.later(0.1 + i * 0.05, () => fx.pillar(x + Math.cos(a) * R * 0.7, y, z + Math.sin(a) * R * 0.7, cols[1], 18, 0.8, 0.8));
        }
        fx.elementBurst('light', x, y + 1, z, 60, cols, 7);
        break;
      default: // cosmic
        fx.nova(x, z, R, y);
        fx.later(0.15, () => fx.nova(x, z, R * 0.6, y + 1));
        fx.ringBlast(x, y, z, R, cols);
        fx.sphereBlast(x, y + 2, z, R * 0.4, cols[1], 0.9);
        fx.spiral(x, y, z, R * 0.5, cols, 60);
        fx.elementBurst('cosmic', x, y + 2, z, 70, cols, 8);
    }
    for (const t of d.targets) fx.later(0.1, () => fx.elementBurst(el, t.x, t.y + 1.5, t.z, 18, cols, 7));
  });
  return RELEASE;
}
