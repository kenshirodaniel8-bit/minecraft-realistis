// Procedural animation for monster rigs (see monsterRenderer.js).
//
// One function animates any species: it restores each pivot to its rest pose
// and layers breathing, blinking, a movement style (hop, waddle, fly, swim,
// roll...), attack telegraphs, reactions and personality "quirks" on top.
// Called from a single central update loop (no per-monster timers).
//
// anim state per monster instance (st):
//   pose: 'idle' | 'move' | 'flee' | 'windup' | 'strike' | 'stunned' | 'defeated'
//         | 'sleep' | 'carried' | 'dropped' | 'celebrate' | 'quirk' | 'recover'
//   speed, attackKind, windupMs, poseT (seconds in this pose), hurtT, quirk (name)

import * as THREE from 'three';

const TAU = Math.PI * 2;

function saveRest(o) {
  if (!o.userData.rest) {
    o.userData.rest = { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() };
  }
}

function restore(o) {
  const r = o.userData.rest;
  if (!r) return;
  o.position.copy(r.p);
  o.rotation.copy(r.r);
  o.scale.copy(r.s);
}

function prepare(rig) {
  if (rig.prepared) return;
  rig.prepared = true;
  const list = [rig.bodyPivot, rig.body, rig.head, rig.mouth, rig.jaw, rig.crest, rig.shell, rig.spout, rig.flames, rig.halo, rig.tailFlame, rig.coin];
  for (const e of rig.eyes) list.push(e.inner, e.group);
  for (const e of rig.ears) list.push(e.pivot);
  for (const s of rig.tail) list.push(s);
  for (const l of rig.legs) list.push(l.pivot);
  for (const a of rig.arms) list.push(a.pivot);
  for (const w of rig.wings) list.push(w.pivot);
  for (const a of rig.antennae) list.push(a);
  for (const s of rig.spin) list.push(s.obj);
  rig.animNodes = list.filter(Boolean);
  for (const o of rig.animNodes) saveRest(o);
  rig.seed = Math.random() * 100;
  rig.blinkAt = 1 + Math.random() * 3;
}

// ------------------------------------------------------------------ fx bits

let FX = null;
function fxGeo() {
  if (FX) return FX;
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.45 : 1;
    const a = (i / 10) * TAU + Math.PI / 2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const heart = new THREE.Shape();
  heart.moveTo(0, -0.9);
  heart.bezierCurveTo(-1.2, 0, -0.9, 1, 0, 0.45);
  heart.bezierCurveTo(0.9, 1, 1.2, 0, 0, -0.9);
  FX = {
    star: new THREE.ExtrudeGeometry(star, { depth: 0.25, bevelEnabled: false }),
    heart: new THREE.ExtrudeGeometry(heart, { depth: 0.25, bevelEnabled: false }),
    starMat: new THREE.MeshBasicMaterial({ color: 0xffe14a }),
    heartMat: new THREE.MeshBasicMaterial({ color: 0xff5a9a }),
    zMat: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    zGeo: (() => {
      const s = new THREE.Shape();
      s.moveTo(-0.5, 0.5); s.lineTo(0.5, 0.5); s.lineTo(0.5, 0.3); s.lineTo(-0.15, -0.3);
      s.lineTo(0.5, -0.3); s.lineTo(0.5, -0.5); s.lineTo(-0.5, -0.5); s.lineTo(-0.5, -0.3);
      s.lineTo(0.15, 0.3); s.lineTo(-0.5, 0.3); s.closePath();
      return new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
    })(),
  };
  return FX;
}

function decor(rig, kind) {
  rig.decor = rig.decor || {};
  if (rig.decor[kind]) return rig.decor[kind];
  const f = fxGeo();
  const g = new THREE.Group();
  if (kind === 'stars') {
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(f.star, f.starMat);
      m.scale.setScalar(0.18);
      g.add(m);
    }
  } else if (kind === 'hearts') {
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(f.heart, f.heartMat);
      m.scale.setScalar(0.2);
      g.add(m);
    }
  } else if (kind === 'zzz') {
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(f.zGeo, f.zMat);
      m.scale.setScalar(0.2 + k * 0.07);
      g.add(m);
    }
  } else if (kind === 'sweat') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x8fd8ff }));
    m.scale.set(1, 1.5, 1);
    g.add(m);
  }
  g.visible = false;
  rig.root.add(g);
  rig.decor[kind] = g;
  return g;
}

function showDecor(rig, kind, on, t) {
  const d = on || rig.decor?.[kind] ? decor(rig, kind) : null;
  if (!d) return;
  d.visible = on;
  if (!on) return;
  const top = rig.headTop + 0.55;
  d.children.forEach((m, k) => {
    if (kind === 'stars') {
      const a = t * 3 + (k / 3) * TAU;
      m.position.set(Math.cos(a) * 0.55, top, Math.sin(a) * 0.55);
      m.rotation.y = t * 4;
    } else if (kind === 'hearts') {
      const p = (t * 0.8 + k / 3) % 1;
      m.position.set((k - 1) * 0.45, top + p * 1.2, 0.2);
      m.scale.setScalar(0.12 + 0.12 * Math.sin(p * Math.PI));
    } else if (kind === 'zzz') {
      const p = (t * 0.45 + k / 3) % 1;
      m.position.set(0.3 + p * 0.5, top + p * 1.1, 0.1);
      m.material.opacity = 1 - p;
    } else if (kind === 'sweat') {
      const p = (t * 1.5) % 1;
      m.position.set(0.55, rig.headTop - 0.1 - p * 0.3, 0.35);
    }
  });
}

// ------------------------------------------------------------------ quirks

const QUIRKS = {
  chomp(rig, k, t) {
    if (rig.jaw) rig.jaw.position.y -= Math.abs(Math.sin(t * 14)) * 0.12;
    if (rig.mouth) rig.mouth.scale.y *= 1 + Math.abs(Math.sin(t * 14)) * 0.25;
    rig.bodyPivot.position.y += Math.abs(Math.sin(t * 7)) * 0.08;
  },
  bounce(rig, k, t) {
    const h = Math.abs(Math.sin(t * 7));
    rig.bodyPivot.position.y += h * 0.45;
    rig.bodyPivot.scale.y *= 1 + (h - 0.5) * 0.12;
  },
  lookaround(rig, k, t) {
    rig.head.rotation.y += Math.sin(t * 1.6) * 0.55;
    rig.head.rotation.x += Math.sin(t * 0.9) * 0.08;
  },
  sleepy(rig, k, t) {
    for (const e of rig.eyes) e.inner.scale.y *= 0.35 + 0.3 * Math.max(0, Math.sin(t * 0.8));
    rig.head.rotation.x += 0.2 + Math.sin(t * 1.4) * 0.12;
    rig.bodyPivot.rotation.z += Math.sin(t * 1.4) * 0.06;
  },
  sniff(rig, k, t) {
    rig.head.rotation.x += 0.3 + Math.sin(t * 16) * 0.05;
    rig.bodyPivot.rotation.x += 0.12;
  },
  sparks(rig, k, t) {
    rig.bodyPivot.position.x += Math.sin(t * 40) * 0.03;
    for (const e of rig.ears) e.pivot.rotation.z += Math.sin(t * 30) * 0.1;
    rig.sparking = true;
  },
  tailchase(rig, k, t) {
    rig.bodyPivot.rotation.y += t * 7;
    rig.bodyPivot.position.y += Math.abs(Math.sin(t * 14)) * 0.08;
    for (const s of rig.tail) s.rotation.y += Math.sin(t * 20) * 0.3;
  },
  puff(rig, k, t) {
    const p = (t * 0.7) % 1;
    rig.head.scale.multiplyScalar(1 + Math.sin(Math.min(1, p * 2) * Math.PI) * 0.08);
    rig.puffing = p > 0.45 && p < 0.6;
  },
  preen(rig, k, t) {
    rig.head.rotation.z += Math.sin(t * 2) * 0.35;
    rig.head.rotation.x += 0.15;
    for (const w of rig.wings) w.pivot.rotation.z += w.side * (0.3 + Math.sin(t * 6) * 0.15);
  },
  wave(rig, k, t) {
    const arm = rig.waveArm || rig.arms.find((a) => a.side === 1)?.pivot;
    if (arm) {
      arm.rotation.z += 2.4;
      arm.rotation.x += Math.sin(t * 9) * 0.4;
    }
    rig.head.rotation.z += Math.sin(t * 3) * 0.1;
  },
  spin(rig, k, t) {
    rig.bodyPivot.rotation.y += t * 5;
  },
  curl(rig, k, t) {
    const c = Math.min(1, Math.sin(Math.min(1, k * 1.4) * Math.PI) * 1.4);
    rig.bodyPivot.scale.multiplyScalar(1 - c * 0.12);
    rig.head.position.y -= c * 0.3;
    rig.head.position.z -= c * 0.25;
    for (const l of rig.legs) l.pivot.scale.multiplyScalar(1 - c * 0.9);
  },
  yawn(rig, k, t) {
    const y = Math.sin(Math.min(1, k * 1.3) * Math.PI);
    rig.head.rotation.x -= y * 0.35;
    if (rig.mouth) rig.mouth.scale.y *= 1 + y * 1.4;
    if (rig.mouthOpen) rig.mouthOpen.visible = y > 0.3;
    if (rig.jaw) rig.jaw.position.y -= y * 0.15;
    for (const e of rig.eyes) e.inner.scale.y *= 1 - y * 0.8;
  },
  intimidate(rig, k, t) {
    rig.bodyPivot.scale.multiplyScalar(1.08);
    rig.bodyPivot.rotation.x -= 0.15;
    if (rig.mouthOpen) rig.mouthOpen.visible = true;
    if (rig.jaw) rig.jaw.position.y -= 0.1;
    for (const e of rig.eyes) e.inner.scale.y *= 0.65;
    rig.bodyPivot.position.x += Math.sin(t * 25) * 0.02;
  },
  hover(rig, k, t) {
    rig.bodyPivot.position.y += Math.sin(t * 2.5) * 0.18;
  },
  flap(rig, k, t) {
    for (const a of rig.arms) a.pivot.rotation.z += a.side * (0.6 + Math.sin(t * 16) * 0.5);
    rig.bodyPivot.position.y += Math.abs(Math.sin(t * 8)) * 0.15;
  },
  howl(rig, k, t) {
    const h = Math.sin(Math.min(1, k * 1.2) * Math.PI);
    rig.head.rotation.x -= h * 0.7;
    if (rig.mouthOpen) rig.mouthOpen.visible = h > 0.4;
    if (rig.mouth) rig.mouth.scale.y *= 1 + h;
  },
  bubble(rig, k, t) {
    rig.blowing = true;
    rig.head.rotation.x -= 0.1;
  },
  hide(rig, k, t) {
    const h = Math.sin(Math.min(1, k * 1.2) * Math.PI);
    rig.body.position.y -= h * 0.25;
    for (const e of rig.eyes) e.group.position.y -= h * 0.4;
    for (const a of rig.arms) a.pivot.scale.multiplyScalar(1 - h * 0.8);
  },
  spout(rig, k, t) {
    rig.spouting = true;
    rig.bodyPivot.position.y += Math.abs(Math.sin(t * 4)) * 0.1;
  },
  headtilt(rig, k, t) {
    rig.head.rotation.z += Math.sin(t * 1.2) > 0 ? 0.35 : -0.35;
  },
  hang(rig, k, t) {
    rig.bodyPivot.rotation.z += Math.PI * Math.min(1, k * 3) * (k < 0.85 ? 1 : (1 - k) / 0.15);
    rig.bodyPivot.position.y += 0.8;
  },
  shy(rig, k, t) {
    rig.bodyPivot.rotation.y += Math.PI * 0.8 * Math.sin(Math.min(1, k * 1.2) * Math.PI);
    for (const a of rig.arms) a.pivot.rotation.x -= 1.4;
    rig.bodyPivot.scale.multiplyScalar(0.94);
  },
  stretch(rig, k, t) {
    const s = Math.sin(Math.min(1, k * 1.2) * Math.PI);
    rig.bodyPivot.rotation.x += s * 0.3;
    rig.head.rotation.x -= s * 0.4;
    for (const l of rig.legs) if (l.front > 0) l.pivot.rotation.x -= s * 0.7;
    if (rig.mouth) rig.mouth.scale.y *= 1 + s * 0.8;
  },
  regal(rig, k, t) {
    rig.head.rotation.x -= 0.18;
    rig.head.rotation.y += Math.sin(t * 0.6) * 0.25;
    for (const e of rig.eyes) e.inner.scale.y *= 0.75;
  },
  stomp(rig, k, t) {
    const s = Math.abs(Math.sin(t * 5));
    rig.bodyPivot.position.y += s * 0.15;
    rig.bodyPivot.rotation.z += Math.sin(t * 5) * 0.08;
    for (const l of rig.legs) l.pivot.rotation.x += Math.sin(t * 5 + l.side) * 0.4;
  },
  flower(rig, k, t) {
    rig.head.rotation.x += 0.35;
    rig.head.rotation.y += Math.sin(t * 2) * 0.3;
  },
  dig(rig, k, t) {
    rig.bodyPivot.rotation.x += 0.3;
    for (const a of rig.arms) a.pivot.rotation.x += Math.sin(t * 18 + a.side) * 0.7;
    for (const l of rig.legs) if (l.front >= 0) l.pivot.rotation.x += Math.sin(t * 18 + l.side) * 0.7;
    rig.digging = true;
  },
  roar(rig, k, t) {
    const r = Math.sin(Math.min(1, k * 1.3) * Math.PI);
    rig.head.rotation.x -= r * 0.4;
    if (rig.mouthOpen) rig.mouthOpen.visible = r > 0.3;
    if (rig.mouth) rig.mouth.scale.y *= 1 + r * 1.2;
    if (rig.flames) rig.flames.scale.multiplyScalar(1 + r * 0.4);
  },
  coil(rig, k, t) {
    rig.tail.forEach((s, i) => {
      s.rotation.y += Math.sin(t * 2 + i) * 0.5 + 0.3;
    });
  },
  glitch(rig, k, t) {
    if (Math.sin(t * 13) > 0.85) {
      rig.bodyPivot.position.x += (Math.random() - 0.5) * 0.6;
      rig.bodyPivot.scale.y *= 0.6 + Math.random() * 0.8;
    }
    rig.bodyPivot.rotation.z += Math.sin(t * 3) > 0.9 ? Math.PI : 0;
  },
};

export const QUIRK_NAMES = Object.keys(QUIRKS);

// ------------------------------------------------------------------ main

export function animateMonster(rig, st, dt, t) {
  prepare(rig);
  for (const o of rig.animNodes) restore(o);
  rig.sparking = rig.blowing = rig.spouting = rig.puffing = rig.digging = false;
  const sp = rig.species;
  const move = sp.ai.move;
  const time = t + rig.seed;
  st.poseT = (st.poseT || 0) + dt;
  const B = rig.bodyPivot;
  const H = rig.head;
  const pose = st.pose || 'idle';
  const flying = move === 'fly' || move === 'flutter' || move === 'serpent';
  const inMouthOpen = rig.mouthOpen;
  if (inMouthOpen) inMouthOpen.visible = false;
  for (const x of rig.eyeX) x.visible = false;
  for (const e of rig.eyes) e.inner.visible = true;

  // breathing
  const breath = Math.sin(time * (pose === 'sleep' ? 1.4 : 2.4));
  B.scale.y *= 1 + breath * 0.025;
  B.scale.x *= 1 - breath * 0.012;
  B.scale.z *= 1 - breath * 0.012;

  // blinking
  rig.blinkAt -= dt;
  let blink = 1;
  if (rig.blinkAt < 0) {
    blink = 0.08;
    if (rig.blinkAt < -0.12) rig.blinkAt = 2 + Math.random() * 3.5;
  }
  for (const e of rig.eyes) e.inner.scale.y *= blink;

  // ears twitch, tails wag, antennae bob
  const happy = pose === 'celebrate' || pose === 'move';
  rig.ears.forEach((e, i) => {
    e.pivot.rotation.z += Math.sin(time * 1.3 + i) * 0.05 + (Math.sin(time * 0.37 + i * 2) > 0.97 ? e.side * 0.25 : 0);
  });
  rig.tail.forEach((s, i) => {
    const wag = happy ? 0.35 : 0.18;
    s.rotation.y += Math.sin(time * (happy ? 9 : 3) - i * 0.6) * wag;
    if (rig.serpent) {
      s.rotation.y += Math.sin(time * 3 - i * 0.9) * 0.28;
      s.rotation.x += Math.sin(time * 2.2 - i * 0.7) * 0.1;
    }
  });
  rig.antennae.forEach((a, i) => {
    a.rotation.x += Math.sin(time * 3 + i) * 0.12;
    a.rotation.z += Math.sin(time * 2.3 + i * 1.7) * 0.08;
  });
  for (const s of rig.spin) s.obj.rotation[s.axis] += 0; // driven below
  rig.spinAngle = (rig.spinAngle || 0) + dt;
  for (const s of rig.spin) s.obj.rotation[s.axis] = rig.spinAngle * s.speed;
  if (rig.flames) rig.flames.scale.y *= 1 + Math.sin(time * 14) * 0.12;
  if (rig.tailFlame) rig.tailFlame.scale.y *= 1 + Math.sin(time * 16) * 0.18;
  if (rig.halo) rig.halo.position.y += Math.sin(time * 2) * 0.05;
  if (rig.coin) rig.coin.rotation.z = time * 3;
  for (const m of rig.glow) m.emissiveIntensity = (m.userData.baseEI ??= m.emissiveIntensity) * (0.85 + Math.sin(time * 3) * 0.2);

  // hover species float
  if (flying || move === 'float') {
    B.position.y += Math.sin(time * 2.6) * 0.14;
    for (const w of rig.wings) {
      const fast = w.style === 'bug' ? 40 : w.style === 'bat' || w.style === 'moth' ? 12 : 9;
      const amp = w.style === 'moth' ? 0.5 : 0.7;
      w.pivot.rotation.y += w.side * Math.sin(time * fast) * amp;
      w.pivot.rotation.z += w.side * Math.sin(time * fast) * amp * 0.6;
    }
  } else {
    for (const w of rig.wings) w.pivot.rotation.z += w.side * (Math.sin(time * 1.5) * 0.08 + 0.05);
  }

  // ------------------------------------------------------------- poses
  const speed = st.speed || 0;
  switch (pose) {
    case 'move':
    case 'flee':
    case 'recover':
      animateMove(rig, st, dt, time, speed * (pose === 'flee' ? 1.3 : 1));
      if (pose === 'flee') {
        for (const e of rig.eyes) e.inner.scale.multiplyScalar(1.15);
        showDecor(rig, 'sweat', true, time);
      }
      H.rotation.y += Math.sin(time * 1.1) * 0.08;
      break;
    case 'windup': {
      const w = Math.min(1, st.poseT / Math.max(0.15, (st.windupMs || 600) / 1000));
      const kind = st.attackKind;
      if (kind === 'slam') {
        B.position.y += w * 0.9;
        B.scale.y *= 1 + w * 0.12;
        for (const a of rig.arms) a.pivot.rotation.z += a.side * w * 2.2;
      } else if (kind === 'lunge') {
        B.scale.y *= 1 - w * 0.2;
        B.scale.x *= 1 + w * 0.1;
        B.rotation.y += Math.sin(time * 30) * 0.08 * w;
        B.rotation.x += w * 0.15;
      } else if (kind === 'breath' || kind === 'projectile') {
        B.scale.multiplyScalar(1 + w * 0.1);
        H.rotation.x -= w * 0.35;
        H.scale.multiplyScalar(1 + w * 0.08);
      } else {
        B.rotation.x -= w * 0.25;
      }
      if (rig.mouth) rig.mouth.scale.y *= 1 + w * 0.6;
      if (inMouthOpen) inMouthOpen.visible = w > 0.3;
      if (rig.jaw) rig.jaw.position.y -= w * 0.18;
      for (const e of rig.eyes) e.inner.scale.y *= 1 - w * 0.35;
      if (flying) animateMove(rig, st, dt, time, 0);
      break;
    }
    case 'strike': {
      const k = Math.min(1, st.poseT / 0.3);
      const out = Math.sin(k * Math.PI);
      B.position.z += out * 0.5;
      B.rotation.x += out * 0.25;
      if (rig.mouth) rig.mouth.scale.y *= 1 + (1 - k) * 0.8;
      if (inMouthOpen) inMouthOpen.visible = k < 0.5;
      if (rig.jaw) rig.jaw.position.y -= (1 - k) * 0.15;
      if (st.attackKind === 'slam') {
        B.position.y += (1 - k) * 0.4;
        B.scale.y *= 1 - out * 0.2;
      }
      if (st.dashing) animateMove(rig, st, dt, time, 20);
      break;
    }
    case 'stunned':
      B.rotation.z += Math.sin(time * 10) * 0.15;
      for (const e of rig.eyes) e.inner.rotation.z = time * 8;
      showDecor(rig, 'stars', true, time);
      break;
    case 'defeated': {
      const k = Math.min(1, st.poseT / 0.5);
      B.rotation.z += k * 1.45;
      B.position.y -= k * 0.15 * rig.width;
      B.position.x += k * 0.25;
      for (const e of rig.eyes) e.inner.visible = false;
      for (const x of rig.eyeX) x.visible = true;
      for (const l of rig.legs) l.pivot.rotation.x += Math.sin(time * 1.5) * 0.05;
      showDecor(rig, 'stars', true, time);
      break;
    }
    case 'sleep':
      for (const e of rig.eyes) e.inner.scale.y = 0.06;
      H.rotation.x += 0.25;
      B.position.y -= 0.06;
      if (flying) B.position.y -= 0.6;
      showDecor(rig, 'zzz', true, time);
      break;
    case 'carried':
      B.rotation.z += Math.sin(time * 14) * 0.3;
      B.rotation.x += Math.sin(time * 9) * 0.15;
      for (const l of rig.legs) l.pivot.rotation.x += Math.sin(time * 22 + l.side * 2) * 0.9;
      for (const a of rig.arms) a.pivot.rotation.z += a.side * (1.5 + Math.sin(time * 20) * 0.5);
      for (const e of rig.eyes) e.inner.scale.multiplyScalar(1.15);
      if (inMouthOpen) inMouthOpen.visible = true;
      if (rig.mouth) rig.mouth.scale.y *= 1.4;
      showDecor(rig, 'sweat', true, time);
      break;
    case 'dropped':
      B.rotation.y += time * 2.5;
      B.position.y += Math.abs(Math.sin(st.poseT * 9)) * Math.max(0, 0.8 - st.poseT * 0.6);
      for (const e of rig.eyes) e.inner.rotation.z = time * 6;
      showDecor(rig, 'stars', true, time);
      break;
    case 'celebrate':
      B.position.y += Math.abs(Math.sin(st.poseT * 8)) * 0.9;
      B.rotation.y += st.poseT * 6;
      for (const e of rig.eyes) e.inner.scale.y *= 0.45;
      for (const a of rig.arms) a.pivot.rotation.z += a.side * 2;
      showDecor(rig, 'hearts', true, time);
      break;
    case 'quirk': {
      const q = QUIRKS[st.quirk] || QUIRKS.lookaround;
      const dur = st.quirkDur || 3.5;
      q(rig, Math.min(1, st.poseT / dur), time);
      break;
    }
    default:
      // idle: slow look around
      H.rotation.y += Math.sin(time * 0.7) * 0.32;
      H.rotation.x += Math.sin(time * 0.43) * 0.06;
      if (st.lookAt !== undefined && st.lookAt !== null) H.rotation.y = st.lookAt;
  }
  if (pose !== 'stunned' && pose !== 'defeated' && pose !== 'dropped') showDecor(rig, 'stars', false, time);
  if (pose !== 'sleep') showDecor(rig, 'zzz', false, time);
  if (pose !== 'celebrate') showDecor(rig, 'hearts', false, time);
  if (pose !== 'carried' && pose !== 'flee') showDecor(rig, 'sweat', false, time);

  // hurt recoil overlay
  if (st.hurtT !== undefined && st.hurtT < 0.35) {
    const h = 1 - st.hurtT / 0.35;
    B.rotation.x -= h * 0.3;
    B.scale.multiplyScalar(1 - h * 0.08);
    for (const e of rig.eyes) e.inner.scale.y *= 1 - h * 0.6;
  }
  if (rig.glitch && Math.random() < 0.02) B.position.x += (Math.random() - 0.5) * 0.5;
}

function animateMove(rig, st, dt, time, speed) {
  const sp = rig.species;
  const move = sp.ai.move;
  const B = rig.bodyPivot;
  st.phase = (st.phase || 0) + dt * Math.min(16, 3 + speed * 0.9);
  const ph = st.phase;
  const legSwing = (amp, offset = 0) => {
    for (const l of rig.legs) {
      if (l.tentacle) {
        l.pivot.rotation.x += Math.sin(ph + l.side) * 0.3;
        continue;
      }
      const diag = l.front === 0 ? l.side : l.side * (l.front > 0 ? 1 : -1);
      l.pivot.rotation.x += Math.sin(ph + offset + (diag > 0 ? 0 : Math.PI)) * amp;
    }
    for (const a of rig.arms) a.pivot.rotation.x += Math.sin(ph + (a.side > 0 ? Math.PI : 0)) * amp * 0.6;
  };
  switch (move) {
    case 'hop':
    case 'bounce': {
      const hop = Math.abs(Math.sin(ph * 0.55));
      B.position.y += hop * (move === 'hop' ? 0.65 : 0.35);
      B.scale.y *= 0.88 + hop * 0.2;
      B.scale.x *= 1.06 - hop * 0.08;
      for (const l of rig.legs) l.pivot.rotation.x += hop * 0.5 * (l.front >= 0 ? -1 : 1);
      for (const a of rig.arms) a.pivot.rotation.z += a.side * hop * 0.6;
      for (const e of rig.ears) e.pivot.rotation.x += (1 - hop) * 0.25;
      break;
    }
    case 'waddle':
      B.rotation.z += Math.sin(ph) * 0.16;
      B.position.y += Math.abs(Math.sin(ph)) * 0.08;
      legSwing(0.45);
      break;
    case 'roll':
      if (speed > 3) {
        B.position.y -= 0.15;
        rig.body.rotation.x += ph * 1.5;
        rig.head.position.y -= 0.3;
        rig.head.position.z -= 0.35;
        for (const l of rig.legs) l.pivot.scale.multiplyScalar(0.05);
        if (rig.head !== rig.body) rig.head.scale.multiplyScalar(0.6);
      } else legSwing(0.5);
      break;
    case 'fly':
    case 'flutter':
    case 'serpent':
      B.rotation.x += Math.min(0.35, speed * 0.03);
      for (const w of rig.wings) w.pivot.rotation.y += w.side * Math.sin(time * 20) * 0.4;
      if (move === 'flutter') B.position.y += Math.abs(Math.sin(ph * 0.5)) * 0.5;
      break;
    case 'swim':
    case 'float':
      B.rotation.y += Math.sin(ph) * 0.12;
      B.position.y += Math.abs(Math.sin(ph * 0.5)) * 0.25;
      for (const w of rig.wings) w.pivot.rotation.z += w.side * Math.sin(ph * 1.5) * 0.5;
      for (const s of rig.tail) s.rotation.y += Math.sin(ph * 1.5) * 0.45;
      legSwing(0.4);
      break;
    case 'stomp':
      B.position.y += Math.abs(Math.sin(ph)) * 0.12;
      B.rotation.z += Math.sin(ph) * 0.07;
      legSwing(0.55);
      break;
    case 'scuttle':
      B.position.y += Math.abs(Math.sin(ph * 2)) * 0.04;
      B.rotation.y += Math.sin(ph * 2) * 0.06;
      legSwing(0.7);
      break;
    case 'glitch':
      if (Math.sin(ph * 3) > 0.8) B.position.x += (Math.random() - 0.5) * 0.4;
      legSwing(0.6);
      break;
    case 'trot':
      B.position.y += Math.abs(Math.sin(ph)) * 0.16;
      B.rotation.x += Math.sin(ph * 2) * 0.04;
      legSwing(0.75);
      for (const e of rig.ears) e.pivot.rotation.x += Math.sin(ph * 2) * 0.12;
      break;
    default:
      // walk
      B.position.y += Math.abs(Math.sin(ph)) * 0.08;
      legSwing(0.6);
      for (const e of rig.ears) e.pivot.rotation.x += Math.sin(ph * 2) * 0.08;
  }
}
