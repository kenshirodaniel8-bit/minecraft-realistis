// Turns a species "model recipe" (shared/monsters.js) into a rigged 3D model.
//
// Everything is built from a small set of shared, cached geometries (spheres,
// rounded boxes, cones, lathes...) scaled into shape, with cached
// materials, so dozens of monsters stay cheap while still looking different.
// The returned rig exposes named pivots (head, eyes, mouth, ears, tail
// segments, legs, wings...) that client/animationSystem.js animates.
//
// Works without a DOM (except the 'cube' body checker texture), so tests can
// build every species in Node.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SPECIES_BY_ID } from '#shared/monsters.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ geometry cache

function lathe(taper, segments = 28, wobble = 0) {
  const pts = [];
  const n = 20;
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    const r = Math.sqrt(Math.max(0, 1 - t * t)) * (1 - taper * t) * (1 + wobble * Math.sin(t * 9));
    pts.push(new THREE.Vector2(Math.max(0.0001, r), t));
  }
  return new THREE.LatheGeometry(pts, segments);
}

function dropGeo() {
  // teardrop: round bottom, pointed top (flames, leaves, petals)
  const pts = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0 bottom -> 1 top
    const a = t * Math.PI;
    const r = Math.sin(a) * (1 - t * 0.85) * 0.95 + 0.0001;
    pts.push(new THREE.Vector2(r, -Math.cos(a) * 0.5 + t * 0.5));
  }
  return new THREE.LatheGeometry(pts, 14);
}

function ghostGeo() {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a), Math.cos(a)));
  }
  pts.push(new THREE.Vector2(1.0, -0.4));
  pts.push(new THREE.Vector2(0.94, -0.62));
  pts.push(new THREE.Vector2(0.0001, -0.62));
  return new THREE.LatheGeometry(pts.reverse(), 28);
}

function batWingShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.2, 0.55);
  s.lineTo(0.55, 0.8);
  s.lineTo(1.0, 0.75);
  s.quadraticCurveTo(0.85, 0.45, 0.95, 0.2);
  s.quadraticCurveTo(0.72, 0.28, 0.62, 0.05);
  s.quadraticCurveTo(0.45, 0.18, 0.32, -0.08);
  s.quadraticCurveTo(0.18, 0.05, 0, 0);
  return new THREE.ShapeGeometry(s, 6);
}

function starShape() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.45 : 1;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }).translate(0, 0, -0.15);
}

let G = null;
function geos() {
  if (G) return G;
  G = {
    sphere: new THREE.SphereGeometry(1, 32, 24),
    sphereLo: new THREE.SphereGeometry(1, 14, 10),
    hemi: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    cone: new THREE.ConeGeometry(1, 1, 16).translate(0, 0.5, 0),
    cone4: new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
    cone3: new THREE.ConeGeometry(1, 1, 3).translate(0, 0.5, 0),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 16).translate(0, 0.5, 0),
    cylC: new THREE.CylinderGeometry(1, 1, 1, 16),
    rbox: new RoundedBoxGeometry(1, 1, 1, 4, 0.2),
    rboxSoft: new RoundedBoxGeometry(1, 1, 1, 5, 0.42),
    box: new THREE.BoxGeometry(1, 1, 1),
    arc: new THREE.TorusGeometry(1, 0.2, 8, 24, Math.PI),
    torus: new THREE.TorusGeometry(1, 0.14, 8, 32),
    octa: new THREE.OctahedronGeometry(1, 0),
    ico: new THREE.IcosahedronGeometry(1, 1),
    egg: lathe(0.12),
    pear: lathe(0.24),
    ghost: ghostGeo(),
    drop: dropGeo(),
    wing: batWingShape(),
    star: starShape(),
    capsule: new THREE.CapsuleGeometry(0.5, 1, 6, 14),
    disc: new THREE.CircleGeometry(1, 24),
  };
  return G;
}

// ------------------------------------------------------------------ materials

const matCache = new Map();
function mat(color, o = {}) {
  const key = `${color}|${o.emissive ?? ''}|${o.ei ?? ''}|${o.rough ?? ''}|${o.opacity ?? ''}|${o.side ?? ''}|${o.metal ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.5,
      metalness: o.metal ?? 0,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.ei ?? 1,
      transparent: (o.opacity ?? 1) < 1,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
      depthWrite: (o.opacity ?? 1) >= 0.6,
    });
    matCache.set(key, m);
  }
  return m;
}

export const FLASH_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff6a6a, emissiveIntensity: 1.2, roughness: 0.6 });
export const FROZEN_MAT = new THREE.MeshStandardMaterial({ color: 0xbff1ff, emissive: 0x4a9fd8, emissiveIntensity: 0.5, roughness: 0.2 });

// ------------------------------------------------------------------ helpers

function mesh(geo, material, scale, pos, rot) {
  // small spheres don't need many polygons
  if (geo === G.sphere && scale) {
    const s = typeof scale === 'number' ? scale : Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]));
    if (s < 0.3) geo = G.sphereLo;
  }
  const m = new THREE.Mesh(geo, material);
  if (scale) {
    if (typeof scale === 'number') m.scale.setScalar(scale);
    else m.scale.set(scale[0], scale[1], scale[2]);
  }
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  return m;
}

function pivot(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// Shapes with an analytic surface so face features sit exactly on them.
// p: superellipse exponent (2 = ellipsoid, 4 = rounded box), taper: egg/pear.
function shapeOf(kind, size, center) {
  const p = kind === 'roundbox' ? 4 : kind === 'cube' ? 8 : kind === 'gem' ? 1.15 : 2;
  const taper = kind === 'egg' ? 0.12 : kind === 'pear' ? 0.24 : 0;
  return { kind, p, taper, c: center.clone(), r: V(size[0] / 2, size[1] / 2, size[2] / 2) };
}

// Point on the front (+z) of a shape at normalized coordinates nx, ny in -1..1.
function surf(sh, nx, ny, inset = 0) {
  const { p } = sh;
  const ax = Math.min(0.999, Math.abs(nx));
  const ay = Math.min(0.999, Math.abs(ny));
  let rem;
  if (sh.kind === 'ghost' && ny < 0) rem = 1 - Math.pow(ax, 2);
  else rem = 1 - Math.pow(ax, p) - Math.pow(ay, p);
  const nz = rem > 0 ? Math.pow(rem, 1 / p) : 0;
  const k = 1 - sh.taper * ny;
  const pos = V(nx * sh.r.x * k, ny * sh.r.y, nz * sh.r.z * k).add(sh.c);
  const n = V(
    (Math.sign(nx) * Math.pow(ax, p - 1)) / sh.r.x,
    sh.kind === 'ghost' && ny < 0 ? 0 : (Math.sign(ny) * Math.pow(ay, p - 1)) / sh.r.y,
    Math.pow(Math.max(nz, 0.0001), p - 1) / sh.r.z,
  ).normalize();
  if (inset) pos.addScaledVector(n, -inset);
  return { pos, n };
}

// Point on top of a shape (for ears, horns, crests). nx, nz in -1..1.
function top(sh, nx, nz = 0) {
  const ax = Math.min(0.999, Math.abs(nx));
  const az = Math.min(0.999, Math.abs(nz));
  const rem = 1 - Math.pow(ax, sh.p) - Math.pow(az, sh.p);
  const ny = rem > 0 ? Math.pow(rem, 1 / sh.p) : 0;
  const k = 1 - sh.taper * ny;
  return V(nx * sh.r.x * k, ny * sh.r.y, nz * sh.r.z * k).add(sh.c);
}

function orient(obj, normal) {
  obj.quaternion.setFromUnitVectors(V(0, 0, 1), normal);
}

function hex(v) {
  return typeof v === 'number' ? v : 0xff00ff;
}

// ------------------------------------------------------------------ builder

// Every species is built once into an optimised template (static meshes
// merged per pivot and material); each monster is a cheap clone that shares
// geometry and materials with the template.
const TEMPLATES = new Map();
const SINGLE_KEYS = ['root', 'bodyPivot', 'body', 'head', 'mouth', 'mouthOpen', 'jaw', 'upperTeeth', 'crest', 'shell', 'spout', 'flames', 'halo', 'tailFlame', 'coin', 'snout', 'lantern', 'waveArm'];

export function buildMonster(speciesId, opts = {}) {
  let t = TEMPLATES.get(speciesId);
  if (!t) {
    t = buildRawMonster(speciesId, opts);
    optimizeTemplate(t);
    TEMPLATES.set(speciesId, t);
  }
  return cloneRig(t);
}

function rigObjects(rig) {
  const list = [];
  for (const k of SINGLE_KEYS) if (rig[k]) list.push(rig[k]);
  for (const e of rig.eyes) list.push(e.group, e.inner);
  list.push(...rig.eyeX, ...rig.tail, ...rig.antennae);
  for (const x of [...rig.ears, ...rig.legs, ...rig.arms, ...rig.wings]) list.push(x.pivot);
  for (const x of rig.spin) list.push(x.obj);
  return list;
}

function flipWinding(g) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name];
    const n = a.itemSize;
    for (let i = 0; i < a.count; i += 3) {
      for (let k = 0; k < n; k++) {
        const t = a.array[(i + 1) * n + k];
        a.array[(i + 1) * n + k] = a.array[(i + 2) * n + k];
        a.array[(i + 2) * n + k] = t;
      }
    }
  }
}

function mergeMeshes(list) {
  const hasUv = list.every((m) => m.geometry.attributes.uv);
  const geos = list.map((m) => {
    m.updateMatrix();
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(k === 'uv' && hasUv)) g.deleteAttribute(k);
    g.applyMatrix4(m.matrix);
    if (m.matrix.determinant() < 0) flipWinding(g);
    return g;
  });
  const merged = mergeGeometries(geos, false);
  const out = new THREE.Mesh(merged, list[0].material);
  out.castShadow = list[0].castShadow;
  out.userData.detail = !!list[0].userData.detail;
  return out;
}

function optimizeTemplate(rig) {
  const keep = new Set(rigObjects(rig));
  // flag tiny parts as "detail" (hidden on far-away monsters)
  rig.root.traverse((o) => {
    if (o.isMesh) {
      const sc = Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y), Math.abs(o.scale.z));
      o.userData.detail = sc < 0.13;
    }
  });
  const parents = [];
  rig.root.traverse((o) => parents.push(o));
  for (const parent of parents) {
    const groups = new Map();
    for (const c of parent.children) {
      if (!c.isMesh || keep.has(c) || c.children.length) continue;
      const key = `${c.material.uuid}|${c.userData.detail ? 1 : 0}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const merged = mergeMeshes(list);
      for (const m of list) parent.remove(m);
      parent.add(merged);
    }
  }
  let n = 0;
  rig.root.traverse((o) => { o.name = `n${n++}`; });
  rig.meshCount = 0;
  rig.root.traverse((o) => { if (o.isMesh) rig.meshCount++; });
}

function cloneRig(t) {
  const root = t.root.clone(true);
  const byName = new Map();
  root.traverse((o) => byName.set(o.name, o));
  const get = (o) => (o ? byName.get(o.name) : o);
  const rig = { ...t, root };
  for (const k of SINGLE_KEYS) rig[k] = get(t[k]);
  rig.eyes = t.eyes.map((e) => ({ ...e, group: get(e.group), inner: get(e.inner) }));
  rig.eyeX = t.eyeX.map(get);
  rig.tail = t.tail.map(get);
  rig.antennae = t.antennae.map(get);
  rig.ears = t.ears.map((e) => ({ ...e, pivot: get(e.pivot) }));
  rig.legs = t.legs.map((e) => ({ ...e, pivot: get(e.pivot) }));
  rig.arms = t.arms.map((e) => ({ ...e, pivot: get(e.pivot) }));
  rig.wings = t.wings.map((e) => ({ ...e, pivot: get(e.pivot) }));
  rig.spin = t.spin.map((e) => ({ ...e, obj: get(e.obj) }));
  rig.meshes = [];
  rig.detailMeshes = [];
  root.traverse((o) => {
    if (o.isMesh) {
      o.userData.baseMat = o.material;
      rig.meshes.push(o);
      if (o.userData.detail) rig.detailMeshes.push(o);
    }
  });
  rig.bbox = t.bbox.clone();
  rig.prepared = false;
  rig.animNodes = null;
  rig.decor = null;
  return rig;
}

// Hide tiny parts (eye sparkles, teeth, claws) on far-away monsters.
export function setRigDetail(rig, on) {
  if (rig.detailOn === on) return;
  rig.detailOn = on;
  for (const m of rig.detailMeshes) m.visible = on;
}

function buildRawMonster(speciesId, opts = {}) {
  const species = SPECIES_BY_ID[speciesId];
  if (!species) throw new Error(`unknown species ${speciesId}`);
  const recipe = species.model;
  const g = geos();
  const col = (k, fallback = 'body') => {
    if (typeof k === 'number') return k;
    return hex(recipe.colors[k] ?? recipe.colors[fallback]);
  };
  const M = (k, o) => mat(col(k), o);
  const rig = {
    species, speciesId,
    root: new THREE.Group(),
    eyes: [], eyeX: [], ears: [], tail: [], legs: [], arms: [], wings: [], antennae: [], spin: [], glow: [], fx: {},
    meshes: [],
  };
  const root = rig.root;
  const bodyPivot = pivot(root);
  rig.bodyPivot = bodyPivot;
  const parts = new Set();

  // ---------------------------------------------------------------- body
  const B = recipe.body;
  const bodyGroup = pivot(bodyPivot, 0, B.y, B.z || 0);
  rig.body = bodyGroup;
  const bodyShape = shapeOf(B.shape, B.size, V(0, 0, 0));
  const bodyColor = B.color || 'body';
  const translucent = B.translucent ? { opacity: 0.88, rough: 0.3 } : {};
  const bodyMat = M(bodyColor, { rough: 0.48, ...translucent });
  const [bw, bh, bd] = B.size;
  switch (B.shape) {
    case 'roundbox':
      bodyGroup.add(mesh(B.round > 0.35 ? g.rboxSoft : g.rbox, bodyMat, [bw, bh, bd]));
      break;
    case 'egg':
      bodyGroup.add(mesh(g.egg, bodyMat, [bw / 2, bh / 2, bd / 2]));
      break;
    case 'pear':
      bodyGroup.add(mesh(g.pear, bodyMat, [bw / 2, bh / 2, bd / 2]));
      break;
    case 'bean': {
      const cap = mesh(g.capsule, bodyMat, [bw, bh, bd / 1.6], null, [Math.PI / 2, 0, 0]);
      bodyGroup.add(cap);
      bodyShape.p = 2;
      break;
    }
    case 'ghost': {
      bodyGroup.add(mesh(g.ghost, bodyMat, [bw / 2, bh / 2, bd / 2], [0, bh * 0.3, 0]));
      bodyShape.c.y = bh * 0.3;
      bodyShape.r.y = bh / 2;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        bodyGroup.add(mesh(g.sphereLo, bodyMat, [bw * 0.17, bh * 0.14, bw * 0.17], [Math.cos(a) * bw * 0.4, bh * 0.3 - bh * 0.32, Math.sin(a) * bd * 0.4]));
      }
      rig.fx.ghost = true;
      break;
    }
    case 'gem': {
      const gm = mesh(g.octa, M(bodyColor, { emissive: col('glow', 'body'), ei: 0.25, rough: 0.15 }), [bw / 2, bh / 2, bd / 2]);
      bodyGroup.add(gm);
      rig.spin.push({ obj: gm, axis: 'y', speed: 0.6 });
      break;
    }
    case 'cloud': {
      bodyGroup.add(mesh(g.sphere, bodyMat, [bw / 2, bh / 2, bd / 2]));
      const puffs = [[0.45, 0.25, 0.05, 0.42], [-0.45, 0.25, 0.05, 0.42], [0.25, 0.45, -0.2, 0.4], [-0.25, 0.48, -0.15, 0.38], [0.0, 0.1, -0.45, 0.45], [0.5, -0.1, -0.2, 0.36], [-0.5, -0.1, -0.2, 0.36]];
      for (const [x, y, z, r] of puffs) bodyGroup.add(mesh(g.sphereLo, bodyMat, [r * bw * 0.6, r * bh * 0.6, r * bd * 0.6], [x * bw * 0.5, y * bh * 0.5, z * bd * 0.5]));
      break;
    }
    case 'cube': {
      let m2 = bodyMat;
      if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const ctx = c.getContext('2d');
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#ff3df2' : '#1a1a1a';
          ctx.fillRect(x * 8, y * 8, 8, 8);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.magFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        m2 = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, emissive: 0x220022 });
      }
      bodyGroup.add(mesh(g.box, m2, [bw, bh, bd]));
      break;
    }
    case 'serpent': {
      // a chain of segments trailing behind the head, animated as a wave
      const segs = B.segments || 6;
      let parent = bodyGroup;
      const len = bd / segs;
      for (let i = 0; i < segs; i++) {
        const seg = pivot(parent, 0, 0, i === 0 ? 0.6 : -len);
        const s = 1 - i * 0.09;
        seg.add(mesh(g.sphere, bodyMat, [bw * 0.62 * s, bh * 0.62 * s, len * 0.75]));
        if (recipe.colors.belly) seg.add(mesh(g.sphereLo, M('belly'), [bw * 0.5 * s, bh * 0.4 * s, len * 0.6], [0, -bh * 0.18 * s, 0]));
        if (i % 2 === 0) {
          const fin = mesh(g.drop, M('accent2', { side: THREE.DoubleSide }), [0.05, 0.6 * s, 0.4 * s], [0, bh * 0.35 * s, 0], [-0.6, 0, 0]);
          seg.add(fin);
        }
        rig.tail.push(seg);
        parent = seg;
      }
      rig.serpent = true;
      break;
    }
    default:
      bodyGroup.add(mesh(g.sphere, bodyMat, [bw / 2, bh / 2, bd / 2]));
  }
  if (B.bicolor) {
    const under = mesh(g.sphere, M(B.bicolor), [bw * 0.49, bh * 0.4, bd * 0.48], [0, -bh * 0.13, 0]);
    bodyGroup.add(under);
  }
  if (B.stripes) {
    for (const k of [-0.42, 0.08]) {
      const rr = Math.sqrt(1 - k * k) * 1.01;
      const t = mesh(g.torus, M(B.stripes), [bw * 0.5 * rr, bd * 0.5 * rr, 0.75], [0, k * bh * 0.5, 0], [Math.PI / 2, 0, 0]);
      bodyGroup.add(t);
    }
  }
  parts.add(`body:${B.shape}`);

  // belly patch
  if (recipe.belly) {
    const b = recipe.belly;
    const p = surf(bodyShape, 0, (b.y - B.y) / (bh / 2), 0.02);
    const patch = mesh(g.sphere, M(b.color || 'belly', { rough: 0.55 }), [b.size[0] / 2, b.size[1] / 2, 0.16]);
    patch.position.copy(p.pos);
    orient(patch, p.n);
    bodyGroup.add(patch);
    if (b.stripes) {
      for (let k = 0; k < 3; k++) {
        const sp = surf(bodyShape, 0, (b.y - B.y) / (bh / 2) + (k - 1) * 0.2, -0.01);
        const st = mesh(g.box, M('accent'), [b.size[0] * 0.7, 0.035, 0.05]);
        st.position.copy(sp.pos);
        orient(st, sp.n);
        bodyGroup.add(st);
      }
    }
    if (b.chevrons) {
      for (let k = 0; k < 3; k++) {
        for (const s of [-1, 1]) {
          const sp = surf(bodyShape, s * 0.12, (b.y - B.y) / (bh / 2) - 0.1 + k * 0.18, -0.01);
          const ch = mesh(g.box, M('accent'), [0.18, 0.04, 0.05], null);
          ch.position.copy(sp.pos);
          orient(ch, sp.n);
          ch.rotateZ(s * 0.5);
          bodyGroup.add(ch);
        }
      }
    }
  }

  // ---------------------------------------------------------------- head
  let headShape;
  let head;
  if (recipe.head) {
    const H = recipe.head;
    head = pivot(bodyPivot, H.pos[0], H.pos[1], H.pos[2]);
    const hmat = M(H.color || 'body', { rough: 0.48, ...translucent });
    if (H.shape === 'roundbox') head.add(mesh(H.round > 0.35 ? g.rboxSoft : g.rbox, hmat, H.size));
    else head.add(mesh(g.sphere, hmat, [H.size[0] / 2, H.size[1] / 2, H.size[2] / 2]));
    headShape = shapeOf(H.shape === 'roundbox' ? 'roundbox' : 'ellipsoid', H.size, V(0, 0, 0));
    parts.add(`head:${H.shape}`);
  } else {
    head = bodyGroup;
    headShape = bodyShape;
  }
  rig.head = head;
  rig.headIsBody = !recipe.head;
  const faceHost = head;
  const hs = headShape;

  // ---------------------------------------------------------------- face
  const F = recipe.face || {};
  const ny = (y) => y / hs.r.y; // face offsets are in units from the head centre

  if (F.mask) {
    const mk = F.mask;
    const p = surf(hs, 0, ny(mk.low ? -0.2 : -0.05), 0.03);
    const m = mesh(g.sphere, M(mk.color, { rough: 0.55 }), [hs.r.x * mk.size[0] * 0.85, hs.r.y * mk.size[1] * 0.85, 0.09]);
    m.position.copy(p.pos);
    orient(m, p.n);
    faceHost.add(m);
    if (mk.heart) {
      for (const s of [-1, 1]) {
        const p2 = surf(hs, s * 0.2, ny(0.35), 0.03);
        const m2 = mesh(g.sphere, M(mk.color), [hs.r.x * 0.36, hs.r.y * 0.3, 0.09]);
        m2.position.copy(p2.pos);
        orient(m2, p2.n);
        faceHost.add(m2);
      }
    }
    parts.add('mask');
  }

  if (F.disc) {
    for (const s of [-1, 1]) {
      const p = surf(hs, (s * F.disc.gap) / hs.r.x, ny(F.disc.y), 0.02);
      const d = mesh(g.sphere, M(F.disc.color, { emissive: col(F.disc.color), ei: 0.35 }), [F.disc.size, F.disc.size, 0.12]);
      d.position.copy(p.pos);
      orient(d, p.n);
      faceHost.add(d);
    }
    parts.add('disc');
  }

  if (F.snout) {
    const sn = F.snout;
    const p = surf(hs, 0, ny(sn.y), sn.size[2] * 0.25);
    const s = mesh(g.sphere, M(sn.color || 'body', { rough: 0.5 }), [sn.size[0] / 2, sn.size[1] / 2, sn.size[2] / 2]);
    s.position.copy(p.pos);
    if (sn.long) s.position.z += sn.size[2] * 0.25;
    faceHost.add(s);
    const tipZ = s.position.z + sn.size[2] / 2;
    if (sn.nose) {
      const nose = mesh(g.sphere, mat(sn.nose, { rough: 0.25 }), sn.bigNose ? [0.17, 0.13, 0.12] : [0.09, 0.065, 0.06], [0, s.position.y + sn.size[1] * 0.18, tipZ - 0.03]);
      faceHost.add(nose);
    }
    if (sn.nostrils) {
      for (const k of [-1, 1]) faceHost.add(mesh(g.sphereLo, mat(0x2a1410), [0.04, 0.03, 0.03], [k * sn.size[0] * 0.18, s.position.y + sn.size[1] * 0.15, tipZ - 0.02]));
    }
    rig.snout = s;
    parts.add(sn.long ? 'snout:long' : 'snout');
  }

  // eyes
  if (F.eyes) {
    const E = F.eyes;
    for (const side of [-1, 1]) {
      const p = surf(hs, (side * E.gap) / hs.r.x, ny(E.y), F.mask || F.disc ? -0.05 : 0);
      const eye = new THREE.Group();
      eye.position.copy(p.pos);
      orient(eye, p.n);
      faceHost.add(eye);
      const s = E.size;
      const inner = new THREE.Group(); // blink scales this
      eye.add(inner);
      const dark = mat(E.style === 'glow' ? 0x000000 : 0x14121c, { rough: 0.08 });
      const shine = mat(0xffffff, { emissive: 0xffffff, ei: 0.6, rough: 0.1 });
      const iris = mat(E.color || 0x2a2040, { rough: 0.1 });
      switch (E.style) {
        case 'gloss-white':
        case 'fierce-white':
        case 'cat':
        case 'liner': {
          inner.add(mesh(g.sphere, mat(0xffffff, { rough: 0.2 }), [s * 1.05, s * 1.2, s * 0.45]));
          inner.add(mesh(g.sphere, iris, [s * 0.74, s * 0.9, s * 0.4], [0, -s * 0.06, s * 0.12]));
          if (E.style === 'cat') inner.add(mesh(g.sphere, dark, [s * 0.16, s * 0.72, s * 0.3], [0, -s * 0.06, s * 0.3]));
          else inner.add(mesh(g.sphere, dark, [s * 0.44, s * 0.55, s * 0.3], [0, -s * 0.08, s * 0.3]));
          inner.add(mesh(g.sphere, shine, s * 0.2, [-side * s * 0.22, s * 0.25, s * 0.42]));
          inner.add(mesh(g.sphere, shine, s * 0.09, [side * s * 0.25, -s * 0.3, s * 0.4]));
          if (E.style === 'liner') {
            const wing = mesh(g.box, mat(0x14121c), [s * 0.9, s * 0.12, s * 0.1], [side * s * 0.75, s * 0.55, s * 0.2], [0, 0, side * 0.45]);
            eye.add(wing);
          }
          break;
        }
        case 'glow':
          inner.add(mesh(g.sphere, mat(E.color || 0x7affd8, { emissive: E.color || 0x7affd8, ei: 1.6 }), [s * 0.8, s * 1.0, s * 0.35]));
          rig.glow.push(inner.children[0].material);
          break;
        case 'pixel':
          inner.add(mesh(g.box, mat(0x000000), [s * 1.2, s * 1.2, s * 0.3]));
          inner.add(mesh(g.box, mat(E.color || 0x3dfff2, { emissive: E.color || 0x3dfff2 }), [s * 0.4, s * 0.4, s * 0.32], [-s * 0.25, s * 0.25, 0.02]));
          break;
        case 'happy': {
          const a = mesh(g.arc, mat(0x14121c), [s * 0.7, s * 0.7, s * 0.7], [0, -s * 0.2, s * 0.05]);
          inner.add(a);
          break;
        }
        case 'stalk': {
          const stalk = mesh(g.cyl, M('body'), [s * 0.22, s * 2.6, s * 0.22], [0, -s * 2.4, -s * 0.6]);
          eye.add(stalk);
          inner.add(mesh(g.sphere, mat(0xffffff, { rough: 0.2 }), [s * 1.0, s * 1.0, s * 0.9]));
          inner.add(mesh(g.sphere, dark, [s * 0.6, s * 0.7, s * 0.5], [0, 0, s * 0.5]));
          inner.add(mesh(g.sphere, shine, s * 0.18, [-side * s * 0.15, s * 0.22, s * 0.85]));
          break;
        }
        default: {
          // 'gloss', 'lashes', 'sleepy', 'fierce', 'sparkle'
          inner.add(mesh(g.sphere, dark, [s, s * 1.18, s * 0.5]));
          if (E.color && E.style !== 'fierce') inner.add(mesh(g.sphere, iris, [s * 0.86, s * 1.0, s * 0.3], [0, -s * 0.2, s * 0.24]));
          inner.add(mesh(g.sphere, shine, s * 0.3, [-side * s * 0.3, s * 0.38, s * 0.38]));
          inner.add(mesh(g.sphere, shine, s * 0.13, [side * s * 0.32, -s * 0.38, s * 0.4]));
          if (E.style === 'sparkle') {
            const st = mesh(g.star, shine, s * 0.22, [side * s * 0.05, -s * 0.05, s * 0.5]);
            inner.add(st);
          }
          if (E.style === 'lashes') {
            for (let k = 0; k < 3; k++) {
              const l = mesh(g.cone, mat(0x14121c), [s * 0.07, s * 0.35, s * 0.07], [side * s * (0.55 + k * 0.18), s * (0.85 - k * 0.2), 0], [0, 0, side * (-0.6 - k * 0.45)]);
              eye.add(l);
            }
          }
        }
      }
      if (E.style === 'fierce' || E.style === 'fierce-white') {
        const brow = mesh(g.box, M('dark', 'accent'), [s * 1.2, s * 0.22, s * 0.25], [side * s * 0.1, s * 1.15, s * 0.1], [0, 0, side * 0.42]);
        eye.add(brow);
      }
      if (E.style === 'sleepy') {
        const lid = mesh(g.hemi, M(F.lidColor || bodyColor), [s * 1.08, s * 1.2, s * 0.56], [0, 0, 0.0], [0.15, 0, 0]);
        eye.add(lid);
      }
      if (E.bumps) {
        const bump = mesh(g.sphere, M('body'), [s * 1.25, s * 1.25, s * 0.8], [0, -s * 0.15, -s * 0.35]);
        eye.add(bump);
      }
      if (E.patch) {
        const patch = mesh(g.sphere, M(E.patch), [s * 1.1, s * 1.5, s * 0.3], [side * s * 0.15, -s * 0.55, -s * 0.12]);
        eye.add(patch);
      }
      if (E.pop) inner.scale.z = 1.6;
      // defeated "x" eyes (hidden until needed)
      const x = new THREE.Group();
      x.visible = false;
      for (const r of [0.78, -0.78]) x.add(mesh(g.box, mat(0x14121c), [s * 1.4, s * 0.24, s * 0.2], [0, 0, s * 0.3], [0, 0, r]));
      eye.add(x);
      rig.eyes.push({ group: eye, inner, side, size: s });
      rig.eyeX.push(x);
    }
    if (F.brows) {
      for (const side of [-1, 1]) {
        const p = surf(hs, (side * F.eyes.gap * 0.9) / hs.r.x, ny(F.eyes.y + F.eyes.size * 1.5), -0.01);
        const b = mesh(g.sphere, M(F.brows.color), [F.eyes.size * 0.45, F.eyes.size * 0.25, 0.06]);
        b.position.copy(p.pos);
        orient(b, p.n);
        faceHost.add(b);
      }
    }
    parts.add(`eyes:${F.eyes.style}`);
  }

  // mouth
  if (F.mouth) {
    const Mo = F.mouth;
    const s = Mo.size;
    const mouth = new THREE.Group();
    const p = surf(hs, 0, ny(Mo.y), 0);
    mouth.position.copy(p.pos);
    orient(mouth, p.n);
    if (rig.snout && Mo.style !== 'chomp' && Mo.style !== 'croc') {
      // sit just under the snout
      mouth.position.z = Math.max(mouth.position.z, rig.snout.position.z + recipe.face.snout.size[2] * 0.35);
      mouth.position.y = Math.min(mouth.position.y, rig.snout.position.y - recipe.face.snout.size[1] * 0.25);
    }
    faceHost.add(mouth);
    const line = mat(0x2a1420, { rough: 0.4 });
    const inside = mat(col(Mo.color, 'mouth') === 0xff00ff ? 0x6e1a2e : col(Mo.color === undefined ? 'mouth' : Mo.color, 'dark'), { rough: 0.5 });
    const tooth = mat(col('tooth', 'belly') === 0xff00ff ? 0xffffff : recipe.colors.tooth ?? 0xffffff, Mo.glowTeeth ? { emissive: recipe.colors.tooth ?? 0xffffff, ei: 0.6 } : { rough: 0.3 });
    const open = new THREE.Group(); // shown when attacking
    open.visible = false;
    mouth.add(open);
    switch (Mo.style) {
      case 'chomp': {
        // the big toothy grin
        const cavity = mesh(g.sphere, mat(recipe.colors.mouth ?? 0x6e1a2e, { rough: 0.6 }), [s * 0.95, s * 0.52, s * 0.4], [0, 0, -s * 0.18]);
        mouth.add(cavity);
        const tongue = mesh(g.sphere, mat(0xff7a9a), [s * 0.45, s * 0.16, s * 0.3], [0, -s * 0.28, -s * 0.02]);
        mouth.add(tongue);
        const upper = new THREE.Group();
        const lower = new THREE.Group();
        mouth.add(upper, lower);
        const n = 7;
        for (let k = 0; k < n; k++) {
          const t = (k / (n - 1)) * 2 - 1;
          const x = t * s * 0.78;
          const yy = Math.sqrt(1 - t * t * 0.8) * s * 0.4;
          const tu = mesh(g.cone, tooth, [s * 0.1, s * 0.26, s * 0.1], [x, yy, s * 0.05], [Math.PI, 0, 0]);
          upper.add(tu);
          if (k > 0 && k < n - 1) {
            const tl = mesh(g.cone, tooth, [s * 0.09, s * 0.22, s * 0.09], [x * 0.9, -yy * 0.95, s * 0.05]);
            lower.add(tl);
          }
        }
        rig.jaw = lower;
        rig.upperTeeth = upper;
        parts.add('mouth:chomp');
        break;
      }
      case 'croc': {
        const sn = rig.snout;
        const smile = mesh(g.arc, line, [s * 0.75, s * 0.25, s * 0.4], [0, 0, 0], [0, 0, Math.PI]);
        mouth.add(smile);
        if (sn) {
          for (const side of [-1, 1]) {
            for (let k = 0; k < 4; k++) {
              const t = mesh(g.cone, tooth, [0.05, 0.13, 0.05], [side * recipe.face.snout.size[0] * 0.42, sn.position.y - mouth.position.y - 0.12, -0.05 - k * 0.14], [Math.PI, 0, 0]);
              mouth.add(t);
            }
          }
        }
        open.add(mesh(g.sphere, inside, [s * 0.6, s * 0.3, s * 0.2], [0, -s * 0.2, 0]));
        parts.add('mouth:croc');
        break;
      }
      case 'beak': {
        const c = mat(col(Mo.color, 'accent'), { rough: 0.35 });
        const upperB = mesh(g.cone, c, [s * 0.55, s * 1.1, s * 0.45], [0, 0, 0], [Math.PI / 2, 0, 0]);
        mouth.add(upperB);
        const lowerB = mesh(g.cone, c, [s * 0.4, s * 0.7, s * 0.3], [0, -s * 0.22, -s * 0.05], [Math.PI / 2 + 0.25, 0, 0]);
        mouth.add(lowerB);
        rig.jaw = lowerB;
        parts.add('mouth:beak');
        break;
      }
      case 'o': {
        const c = Mo.color ? col(Mo.color) : 0x6e1a2e;
        mouth.add(mesh(g.sphere, mat(c, { rough: 0.4 }), [s * 0.8, s, s * 0.35]));
        parts.add('mouth:o');
        break;
      }
      case 'cat': {
        for (const side of [-1, 1]) {
          const a = mesh(g.arc, mat(col(Mo.color, 'dark') === 0xff00ff ? 0x2a1420 : col(Mo.color, 'dark')), [s * 0.5, s * 0.5, s * 0.5], [side * s * 0.48, 0, 0], [0, 0, Math.PI]);
          mouth.add(a);
        }
        open.add(mesh(g.sphere, mat(0x6e1a2e), [s * 0.6, s * 0.7, s * 0.3], [0, -s * 0.5, 0]));
        parts.add('mouth:cat');
        break;
      }
      case 'pixel': {
        const b = mat(0x000000);
        mouth.add(mesh(g.box, b, [s * 1.2, s * 0.22, s * 0.2], [0, -s * 0.15, 0]));
        mouth.add(mesh(g.box, b, [s * 0.22, s * 0.22, s * 0.2], [-s * 0.7, s * 0.05, 0]));
        mouth.add(mesh(g.box, b, [s * 0.22, s * 0.22, s * 0.2], [s * 0.7, s * 0.05, 0]));
        parts.add('mouth:pixel');
        break;
      }
      default: {
        // smile, grin, fangs, tongue
        const w = Mo.style === 'grin' ? 1.2 : 1;
        const smile = mesh(g.arc, line, [s * w, s * 0.8, s * 0.6], [0, s * 0.3, 0], [0, 0, Math.PI]);
        mouth.add(smile);
        if (Mo.style === 'grin' || Mo.style === 'tongue') {
          mouth.add(mesh(g.hemi, mat(0x6e1a2e), [s * w * 0.9, s * 0.7, s * 0.3], [0, s * 0.25, -s * 0.05], [Math.PI, 0, 0]));
          mouth.add(mesh(g.sphere, mat(0xff7a9a), [s * 0.5, s * 0.22, s * 0.3], [0, -s * 0.2, s * 0.05]));
        }
        if (Mo.style === 'tongue') mouth.add(mesh(g.capsule, mat(0xff7a9a), [s * 0.5, s * 0.5, s * 0.3], [s * 0.2, -s * 0.55, s * 0.15]));
        if (Mo.style === 'fangs') {
          for (const side of [-1, 1]) mouth.add(mesh(g.cone, tooth, [s * 0.16, s * 0.42, s * 0.14], [side * s * 0.55, s * 0.0, s * 0.05], [Math.PI, 0, 0]));
        }
        open.add(mesh(g.sphere, mat(0x6e1a2e), [s * 0.7, s * 0.6, s * 0.3], [0, -s * 0.1, 0]));
        parts.add(`mouth:${Mo.style}`);
      }
    }
    rig.mouth = mouth;
    rig.mouthOpen = open;
  }

  if (F.cheeks) {
    const C = F.cheeks;
    for (const side of [-1, 1]) {
      const p = surf(hs, (side * C.gap) / hs.r.x, ny(C.y), 0.01);
      const c = mesh(g.sphere, mat(col(C.color, 'cheek'), { opacity: 0.75, rough: 0.6 }), [C.size, C.size * 0.62, 0.05]);
      c.position.copy(p.pos);
      orient(c, p.n);
      faceHost.add(c);
    }
    parts.add('cheeks');
  }

  if (F.mark) {
    const mk = F.mark;
    const p = surf(hs, 0, ny(mk.y), -0.01);
    const grp = new THREE.Group();
    grp.position.copy(p.pos);
    orient(grp, p.n);
    faceHost.add(grp);
    const mm = mat(col(mk.color), mk.glow ? { emissive: col(mk.color), ei: 0.9 } : { rough: 0.4 });
    const s = mk.size;
    switch (mk.kind) {
      case 'bolt':
        grp.add(mesh(g.box, mm, [s * 0.35, s * 0.8, 0.06], [-s * 0.1, s * 0.25, 0], [0, 0, -0.5]));
        grp.add(mesh(g.box, mm, [s * 0.35, s * 0.8, 0.06], [s * 0.1, -s * 0.25, 0], [0, 0, -0.5]));
        grp.add(mesh(g.box, mm, [s * 0.5, s * 0.22, 0.06], [0, 0, 0]));
        break;
      case 'diamond':
      case 'gem':
        grp.add(mesh(g.octa, mk.kind === 'gem' ? mat(col(mk.color), { emissive: col(mk.color), ei: 0.5, rough: 0.1 }) : mm, [s * 0.6, s * 0.9, s * 0.3]));
        break;
      case 'star':
        grp.add(mesh(g.star, mm, s * 0.8));
        break;
      case 'crescent': {
        const c = mesh(g.arc, mm, [s, s, s * 0.6], [0, 0, 0], [0, 0, 0.6]);
        grp.add(c);
        break;
      }
      case 'rune':
        grp.add(mesh(g.torus, mm, [s, s, s]));
        grp.add(mesh(g.box, mm, [s * 0.15, s * 1.6, 0.05]));
        break;
      case 'dots':
        for (const side of [-1, 1]) grp.add(mesh(g.sphere, mm, [s, s * 0.7, 0.05], [side * s * 3.2, -s * 1.5, 0]));
        break;
      case 'clover':
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
          grp.add(mesh(g.sphere, mm, [s * 0.5, s * 0.5, 0.05], [Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.45, 0]));
        }
        break;
      case 'freckles':
        for (const side of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            const fp = surf(hs, side * (0.42 + (k % 2) * 0.1), ny(mk.y) - 0.62 - k * 0.07, -0.005);
            const f = mesh(g.sphere, mm, [s, s, 0.03]);
            f.position.copy(fp.pos);
            orient(f, fp.n);
            faceHost.add(f);
          }
        }
        break;
      default:
        break;
    }
    if (mk.glow) rig.glow.push(mm);
    parts.add(`mark:${mk.kind}`);
  }

  // ---------------------------------------------------------------- ears
  if (recipe.ears) {
    const E = recipe.ears;
    for (const side of [-1, 1]) {
      const base = top(hs, side * E.gap * 0.95, 0);
      const pv = pivot(faceHost, base.x, base.y + (E.y || 0) - E.size[1] * 0.1, base.z);
      pv.rotation.z = -side * E.tilt;
      const emat = M(E.color || 'body', { rough: 0.5 });
      const inner = E.inner ? M(E.inner, { rough: 0.55 }) : null;
      const [w, h, d] = E.size;
      switch (E.style) {
        case 'bunny':
          pv.add(mesh(g.sphere, emat, [w / 2, h / 2, d], [0, h / 2, 0]));
          if (inner) pv.add(mesh(g.sphere, inner, [w * 0.3, h * 0.42, d * 0.6], [0, h / 2, d * 0.45]));
          pv.rotation.x = -0.12;
          break;
        case 'round':
          pv.add(mesh(g.sphere, emat, [w / 2, h / 2, d], [0, h * 0.35, 0]));
          if (inner) pv.add(mesh(g.sphere, inner, [w * 0.3, h * 0.3, d * 0.6], [0, h * 0.35, d * 0.45]));
          break;
        case 'floppy':
          pv.add(mesh(g.sphere, emat, [w / 2, h / 2, d], [side * w * 0.3, -h * 0.2, 0], [0, 0, side * 0.6]));
          break;
        case 'leaf':
        case 'petal':
          pv.add(mesh(g.drop, emat, [w, h, d], [0, 0, 0]));
          if (inner) pv.add(mesh(g.drop, inner, [w * 0.6, h * 0.75, d * 1.2], [0, h * 0.05, d * 0.2]));
          pv.add(mesh(g.box, M('accent2', 'dark'), [0.03, h * 0.7, d * 1.2], [0, h * 0.35, 0]));
          break;
        case 'fin':
          pv.add(mesh(g.drop, emat, [d * 0.6, h, w], [0, 0, -w * 0.2], [-0.5, 0, 0]));
          break;
        case 'tuft':
          for (let k = 0; k < 3; k++) pv.add(mesh(g.cone, emat, [w * 0.25, h * (1 - k * 0.2), d], [(k - 1) * w * 0.22 * side, 0, 0], [0, 0, (k - 1) * 0.25]));
          break;
        default: {
          // pointy, fennec, lynx, bat
          const big = E.style === 'fennec' || E.style === 'bat';
          pv.add(mesh(g.cone4, emat, [w / 2, h, d], [0, 0, 0]));
          if (inner) pv.add(mesh(g.cone4, inner, [w * 0.32, h * 0.78, d * 0.5], [0, h * 0.05, d * 0.32]));
          if (E.tip) pv.add(mesh(g.cone4, M(E.tip), [w * 0.165, h * 0.31, d * 1.05], [0, h * 0.69, 0]));
          if (E.style === 'lynx') pv.add(mesh(g.cone, M(E.tip || 'accent'), [w * 0.06, h * 0.45, w * 0.06], [0, h * 0.95, 0], [0, 0, side * -0.2]));
          if (big) pv.rotation.z = -side * E.tilt * 1.1;
        }
      }
      rig.ears.push({ pivot: pv, side, base: pv.rotation.clone() });
    }
    parts.add(`ears:${E.style}`);
  }

  // ---------------------------------------------------------------- horns
  if (recipe.horns) {
    const Hn = recipe.horns;
    const hm = M(Hn.color, { rough: 0.35 });
    const s = Hn.size;
    const cmat = mat(col(Hn.color), { emissive: col(Hn.color), ei: 0.35, rough: 0.12 });
    switch (Hn.style) {
      case 'unicorn': {
        const p = surf(hs, 0, 0.62, -0.05);
        const h = mesh(g.cone, hm, [s * 0.18, s, s * 0.18], [p.pos.x, p.pos.y, p.pos.z], [0.35, 0, 0]);
        faceHost.add(h);
        for (let k = 0; k < 3; k++) faceHost.add(mesh(g.torus, hm, [s * 0.16 * (1 - k * 0.25), s * 0.16 * (1 - k * 0.25), 0.6], [p.pos.x, p.pos.y + s * (0.15 + k * 0.22), p.pos.z + s * (0.05 + k * 0.08)], [Math.PI / 2 - 0.35, 0, 0]));
        break;
      }
      case 'crystal': {
        const sn = rig.snout;
        const y = sn ? sn.position.y + 0.2 : 0.2;
        const z = sn ? sn.position.z + 0.1 : hs.r.z;
        faceHost.add(mesh(g.octa, cmat, [s * 0.28, s * 0.75, s * 0.28], [0, y + s * 0.5, z], [0.4, 0, 0]));
        faceHost.add(mesh(g.octa, cmat, [s * 0.15, s * 0.35, s * 0.15], [0, y + s * 0.65, z - 0.45], [0.2, 0, 0]));
        rig.glow.push(cmat);
        break;
      }
      case 'beetle': {
        const p = surf(hs, 0, 0.55, 0);
        const h = mesh(g.cone, hm, [s * 0.2, s, s * 0.2], [p.pos.x, p.pos.y, p.pos.z], [0.7, 0, 0]);
        faceHost.add(h);
        faceHost.add(mesh(g.sphere, hm, [s * 0.16, s * 0.1, s * 0.16], [p.pos.x, p.pos.y + s * 0.78, p.pos.z + s * 0.66]));
        break;
      }
      case 'antler':
        for (const side of [-1, 1]) {
          const b = top(hs, side * 0.35, -0.1);
          const a = pivot(faceHost, b.x, b.y - 0.05, b.z);
          a.rotation.z = -side * 0.35;
          a.add(mesh(g.cylC, cmat, [0.06, s, 0.06], [0, s / 2, 0]));
          a.add(mesh(g.cylC, cmat, [0.05, s * 0.5, 0.05], [side * s * 0.15, s * 0.6, 0], [0, 0, -side * 0.8]));
          a.add(mesh(g.cylC, cmat, [0.05, s * 0.45, 0.05], [-side * s * 0.1, s * 0.85, 0.05], [0.3, 0, side * 0.6]));
          a.add(mesh(g.octa, cmat, [0.1, 0.18, 0.1], [0, s, 0]));
        }
        rig.glow.push(cmat);
        break;
      case 'crystal2':
        for (const side of [-1, 1]) {
          const b = top(hs, side * Hn.gap / hs.r.x, -0.2);
          faceHost.add(mesh(g.octa, cmat, [s * 0.18, s * 0.6, s * 0.18], [b.x, b.y + s * 0.3, b.z], [-0.5, 0, -side * 0.3]));
        }
        rig.glow.push(cmat);
        break;
      default: {
        // nub, curve
        const count = Hn.count || 2;
        for (let pair = 0; pair < count / 2; pair++) {
          for (const side of [-1, 1]) {
            const b = top(hs, (side * (Hn.gap || 0.3) * (1 + pair * 0.45)) / hs.r.x, -0.1 - pair * 0.35);
            const h = mesh(g.cone, hm, [s * 0.22 * (1 - pair * 0.3), s * (1 - pair * 0.3), s * 0.22 * (1 - pair * 0.3)], [b.x, b.y - 0.05, b.z]);
            h.rotation.set(Hn.style === 'curve' ? (Hn.tilt ?? -0.5) : 0, 0, -side * 0.25);
            faceHost.add(h);
          }
        }
      }
    }
    parts.add(`horns:${Hn.style}`);
  }

  // ---------------------------------------------------------------- crest
  if (recipe.crest) {
    const C = recipe.crest;
    const s = C.size;
    const at = top(hs, 0, C.style === 'finback' ? -0.2 : 0);
    const crest = pivot(faceHost, at.x, at.y - 0.05, at.z);
    const cm = M(C.color, { rough: 0.45 });
    const tip = C.tip !== undefined ? mat(col(C.tip)) : cm;
    switch (C.style) {
      case 'sprout':
      case 'antenna': {
        const stem = pivot(crest);
        stem.add(mesh(g.cyl, cm, [0.05 * s, 0.7 * s, 0.05 * s], [0, 0, 0], [0.25, 0, 0]));
        const glowTip = C.style === 'antenna' ? mat(col(C.tip), { emissive: col(C.tip), ei: 1.2 }) : tip;
        stem.add(mesh(g.sphere, glowTip, [0.17 * s, 0.2 * s, 0.17 * s], [0, 0.72 * s, 0.17 * s]));
        if (C.style === 'sprout') {
          stem.add(mesh(g.drop, cm, [0.18 * s, 0.32 * s, 0.05], [0.12 * s, 0.3 * s, 0.06], [0, 0, -1.0]));
          stem.add(mesh(g.drop, cm, [0.16 * s, 0.28 * s, 0.05], [-0.12 * s, 0.42 * s, 0.1], [0, 0, 1.0]));
        } else rig.glow.push(glowTip);
        rig.antennae.push(stem);
        break;
      }
      case 'leaf':
        crest.add(mesh(g.drop, cm, [0.35 * s, 0.7 * s, 0.08], [0, 0.05, 0], [-0.4, 0, 0.3]));
        crest.add(mesh(g.cyl, M('accent2', 'accent'), [0.03, 0.2 * s, 0.03], [0, -0.05, 0]));
        break;
      case 'leafcap':
        crest.add(mesh(g.sphere, cm, [0.75 * s, 0.14 * s, 0.7 * s], [0, 0.02, 0], [-0.2, 0, 0]));
        crest.add(mesh(g.drop, cm, [0.25 * s, 0.5 * s, 0.06], [0.1, 0.12, -0.1], [-0.5, 0, -0.4]));
        crest.add(mesh(g.cyl, M('accent2', 'accent'), [0.03, 0.22 * s, 0.03], [0, 0.05, 0]));
        break;
      case 'flame': {
        const fm = mat(col(C.color), { emissive: col(C.color), ei: 0.8 });
        const fm2 = mat(col(C.tip), { emissive: col(C.tip), ei: 1.0 });
        crest.add(mesh(g.drop, fm, [0.32 * s, 0.85 * s, 0.32 * s], [0, 0.1, 0]));
        crest.add(mesh(g.drop, fm2, [0.2 * s, 0.6 * s, 0.2 * s], [0.12, 0.05, 0.08], [0, 0, -0.4]));
        crest.add(mesh(g.drop, fm, [0.22 * s, 0.6 * s, 0.22 * s], [-0.14, 0.04, 0.02], [0, 0, 0.45]));
        rig.glow.push(fm, fm2);
        rig.flames = crest;
        break;
      }
      case 'cloud':
        for (let k = 0; k < 6; k++) {
          const z = 0.25 - k * 0.22;
          crest.add(mesh(g.sphereLo, cm, [0.24 * s, 0.22 * s, 0.24 * s], [(k % 2 ? 0.08 : -0.06), 0.05 - k * k * 0.025, z]));
        }
        break;
      case 'flower':
        crest.add(mesh(g.sphere, tip, [0.14 * s, 0.1 * s, 0.14 * s], [0, 0.12 * s, 0]));
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          crest.add(mesh(g.sphere, cm, [0.17 * s, 0.07 * s, 0.11 * s], [Math.cos(a) * 0.2 * s, 0.1 * s, Math.sin(a) * 0.2 * s], [0, -a, 0]));
        }
        rig.flower = crest;
        break;
      case 'icecrown': {
        const im = mat(col(C.color), { emissive: col(C.color), ei: 0.4, rough: 0.1 });
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          crest.add(mesh(g.octa, im, [0.07 * s, (k === 0 ? 0.28 : 0.2) * s, 0.07 * s], [Math.cos(a) * 0.16 * s, 0.1 * s, Math.sin(a) * 0.16 * s + 0.08]));
        }
        break;
      }
      case 'nemes': {
        const stripe = M(C.color);
        const gold = M(C.tip);
        crest.position.y -= hs.r.y * 0.15;
        crest.add(mesh(g.sphere, gold, [hs.r.x * 1.04, hs.r.y * 0.62, hs.r.z * 1.02], [0, 0.0, -0.02]));
        for (const side of [-1, 1]) {
          const flap = pivot(crest, side * hs.r.x * 0.92, -hs.r.y * 0.35, -0.05);
          for (let k = 0; k < 4; k++) flap.add(mesh(g.box, k % 2 ? gold : stripe, [0.16 * s, 0.16 * s, 0.42 * s], [0, -k * 0.16 * s, 0]));
          flap.rotation.z = side * 0.12;
        }
        crest.add(mesh(g.torus, gold, [hs.r.x * 0.98, hs.r.z * 0.98, 1.4], [0, -0.05, 0], [Math.PI / 2, 0, 0]));
        break;
      }
      case 'finback':
        crest.add(mesh(g.drop, cm, [0.08, 0.6 * s, 0.6 * s], [0, 0, -0.1], [-0.7, 0, 0]));
        break;
      case 'moss':
        for (let k = 0; k < 5; k++) crest.add(mesh(g.sphereLo, cm, [0.25 * s, 0.1 * s, 0.25 * s], [((k * 37) % 5 - 2) * 0.12, 0.02, ((k * 13) % 3 - 1) * 0.15]));
        crest.add(mesh(g.sphere, mat(col(C.tip)), [0.08, 0.08, 0.08], [0.1, 0.12, 0.05]));
        break;
      case 'crown': {
        const cr = M(C.color);
        crest.add(mesh(g.cylC, cr, [hs.r.x * 0.55, 0.22 * s, hs.r.z * 0.55], [0, 0.05, 0]));
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          crest.add(mesh(g.cone4, cr, [0.12 * s, 0.32 * s, 0.12 * s], [Math.cos(a) * hs.r.x * 0.5, 0.14, Math.sin(a) * hs.r.z * 0.5]));
        }
        const gm = mat(col(C.tip), { emissive: col(C.tip), ei: 1.2 });
        crest.add(mesh(g.octa, gm, [0.1, 0.14, 0.06], [0, 0.08, hs.r.z * 0.56]));
        rig.glow.push(gm);
        break;
      }
      case 'bolt': {
        const bm = mat(col(C.color), { emissive: col(C.color), ei: 0.7 });
        crest.add(mesh(g.box, bm, [0.12 * s, 0.5 * s, 0.1], [-0.05, 0.25 * s, 0], [0, 0, -0.5]));
        crest.add(mesh(g.box, bm, [0.12 * s, 0.5 * s, 0.1], [0.08, 0.55 * s, 0], [0, 0, -0.5]));
        crest.add(mesh(g.box, bm, [0.28 * s, 0.1 * s, 0.1], [0.02, 0.4 * s, 0], [0, 0, 0]));
        rig.glow.push(bm);
        break;
      }
      default:
        crest.add(mesh(g.cone, cm, [0.15 * s, 0.4 * s, 0.15 * s]));
    }
    rig.crest = crest;
    parts.add(`crest:${C.style}`);
  }

  if (recipe.antennae) {
    const A = recipe.antennae;
    for (const side of [-1, 1]) {
      const b = top(hs, (side * A.gap) / hs.r.x, 0.15);
      const pv = pivot(faceHost, b.x, b.y - 0.03, b.z);
      pv.rotation.z = -side * 0.35;
      pv.rotation.x = 0.2;
      const am = M(A.color);
      if (A.style === 'feather') {
        pv.add(mesh(g.cyl, am, [0.025, A.size, 0.025]));
        pv.add(mesh(g.drop, am, [0.16 * A.size, 0.45 * A.size, 0.04], [side * 0.06, A.size * 0.6, 0], [0, 0, -side * 0.3]));
      } else {
        pv.add(mesh(g.cyl, am, [0.03, A.size, 0.03]));
        pv.add(mesh(g.sphere, M(A.tip || A.color), [0.08, 0.08, 0.08], [0, A.size, 0]));
      }
      rig.antennae.push(pv);
    }
    parts.add(`antennae:${A.style}`);
  }

  // ---------------------------------------------------------------- back
  if (recipe.back) {
    const Bk = recipe.back;
    const bm = M(Bk.color, { rough: 0.45 });
    const bm2 = Bk.color2 ? M(Bk.color2, { rough: 0.45 }) : bm;
    const n = Bk.count || 3;
    const R = bodyShape.r;
    const onBody = (theta, phi) => V(
      Math.sin(phi) * Math.sin(theta) * R.x,
      Math.cos(phi) * R.y,
      Math.sin(phi) * Math.cos(theta) * R.z,
    );
    switch (Bk.style) {
      case 'spikes':
      case 'scutes':
        for (let k = 0; k < n; k++) {
          const phi = 0.15 + (k / Math.max(1, n - 1)) * 1.1;
          const p = onBody(Math.PI, phi);
          const sz = Bk.style === 'scutes' ? 0.13 : 0.17 * (1 - Math.abs(k - n / 2) / n);
          if (Bk.style === 'scutes') {
            for (const side of [-1, 1]) bodyGroup.add(mesh(g.sphere, bm, [sz * 1.3, sz, sz * 1.2], [p.x + side * 0.16, p.y, p.z]));
          } else {
            const c = mesh(g.cone, bm, [sz, sz * 2.2, sz], [p.x, p.y - 0.04, p.z], [-phi, 0, 0]);
            bodyGroup.add(c);
          }
        }
        break;
      case 'stripes':
        for (let k = 0; k < n; k++) {
          const phi = 0.35 + k * 0.38;
          const p = onBody(Math.PI, phi);
          bodyGroup.add(mesh(g.sphere, bm, [R.x * 0.75, 0.05, 0.14], [p.x, p.y, p.z], [-phi + Math.PI / 2, 0, 0]));
        }
        break;
      case 'armor':
        for (let k = 0; k < n; k++) {
          const z = (k / (n - 1) - 0.5) * R.z * 1.4;
          const band = mesh(g.sphere, k % 2 ? bm2 : bm, [R.x * 1.04, R.y * 1.02, R.z * 0.3], [0, 0.04, z]);
          bodyGroup.add(band);
          bodyGroup.add(mesh(g.drop, bm2, [0.12, 0.25, 0.06], [0, R.y * 1.02, z], [0, 0, 0]));
        }
        break;
      case 'fur':
        for (let k = 0; k < n * 4; k++) {
          const th = (k * 2.4) % (Math.PI * 2);
          const phi = 0.4 + ((k * 0.37) % 1.0);
          const p = onBody(th, phi);
          bodyGroup.add(mesh(g.sphereLo, bm, [0.16, 0.16, 0.16], [p.x * 0.95, p.y * 0.95, p.z * 0.95]));
        }
        break;
      case 'elytra':
        for (const side of [-1, 1]) {
          const half = mesh(g.sphere, M(Bk.color, { rough: 0.15, metal: 0.25 }), [R.x * 0.56, R.y * 1.08, R.z * 1.04], [side * R.x * 0.46, 0.05, -0.02]);
          bodyGroup.add(half);
          for (let k = 0; k < 2; k++) bodyGroup.add(mesh(g.sphere, mat(col(Bk.color2), { emissive: col(Bk.color2), ei: 0.3, rough: 0.1 }), [0.11, 0.08, 0.11], [side * R.x * 0.48, R.y * (0.85 - k * 0.15), -0.15 - k * 0.4]));
        }
        bodyGroup.add(mesh(g.box, mat(0x0a1428), [0.03, R.y * 0.6, R.z * 1.6], [0, R.y * 0.75, -0.05]));
        break;
      case 'crystals': {
        const cm = mat(col(Bk.color), { emissive: col(Bk.color), ei: 0.35, rough: 0.1 });
        const cm2 = mat(col(Bk.color2), { emissive: col(Bk.color2), ei: 0.35, rough: 0.1 });
        for (let k = 0; k < n; k++) {
          const phi = 0.2 + (k / n) * 1.0;
          const p = onBody(Math.PI + (k % 2 ? 0.4 : -0.4), phi);
          bodyGroup.add(mesh(g.octa, k % 2 ? cm2 : cm, [0.12, 0.32, 0.12], [p.x, p.y + 0.05, p.z], [-0.3, 0, (k % 2 ? 1 : -1) * 0.4]));
        }
        rig.glow.push(cm, cm2);
        break;
      }
      case 'quills':
        for (let k = 0; k < n; k++) {
          const th = Math.PI + ((k % 7) - 3) * 0.3;
          const phi = 0.15 + Math.floor(k / 7) * 0.32;
          const p = onBody(th, phi);
          const n2 = V(p.x / R.x ** 2, p.y / R.y ** 2, p.z / R.z ** 2).normalize();
          const q = mesh(g.cone, bm, [0.08, 0.42, 0.08]);
          q.position.copy(p);
          q.quaternion.setFromUnitVectors(V(0, 1, 0), n2);
          bodyGroup.add(q);
          const tp = mesh(g.cone, bm2, [0.05, 0.16, 0.05]);
          tp.position.copy(p).addScaledVector(n2, 0.3);
          tp.quaternion.copy(q.quaternion);
          bodyGroup.add(tp);
        }
        break;
      case 'runes':
      case 'cracks': {
        const gm = mat(col(Bk.color), { emissive: col(Bk.color), ei: 1.1 });
        for (let k = 0; k < n * 2; k++) {
          const th = (k * 1.9) % (Math.PI * 2);
          const phi = 0.5 + ((k * 0.61) % 1.1);
          const p = onBody(th, phi);
          const r = mesh(g.box, gm, [0.04, Bk.style === 'runes' ? 0.3 : 0.22, 0.04], [p.x * 1.0, p.y, p.z * 1.0], [0, th, (k % 3 - 1) * 0.6]);
          bodyGroup.add(r);
        }
        rig.glow.push(gm);
        break;
      }
      case 'ribs':
        for (let k = 0; k < n; k++) {
          const th = (k / n) * Math.PI * 2 + 0.3;
          const p = onBody(th, Math.PI / 2);
          const rib = mesh(g.sphere, bm, [0.07, R.y * 0.85, 0.07], [p.x * 0.98, 0, p.z * 0.98]);
          bodyGroup.add(rib);
        }
        break;
      case 'spots':
      case 'stars': {
        const sm = Bk.style === 'stars' ? mat(col(Bk.color), { emissive: col(Bk.color), ei: 0.9 }) : bm;
        for (let k = 0; k < n; k++) {
          const th = Math.PI + ((k * 1.3) % 2.2) - 1.1;
          const phi = 0.35 + ((k * 0.47) % 0.9);
          const p = onBody(th, phi);
          const n2 = V(p.x / R.x ** 2, p.y / R.y ** 2, p.z / R.z ** 2).normalize();
          const d = mesh(Bk.style === 'stars' ? g.star : g.sphere, sm, Bk.style === 'stars' ? 0.07 : [0.1, 0.1, 0.03]);
          d.position.copy(p);
          orient(d, n2);
          bodyGroup.add(d);
        }
        if (Bk.style === 'stars') rig.glow.push(sm);
        break;
      }
      default:
        break;
    }
    parts.add(`back:${Bk.style}`);
  }

  if (recipe.spines) {
    const sm = M(recipe.spines.color);
    const R = bodyShape.r;
    for (let k = 0; k < recipe.spines.count; k++) {
      const th = k * 2.39996;
      const yy = ((k * 0.618) % 1) * 1.6 - 0.8;
      const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      const p = V(Math.sin(th) * R.x * rr * 1.02, yy * R.y, Math.cos(th) * R.z * rr * 1.02);
      if (p.z > R.z * 0.55 && Math.abs(yy) < 0.5) continue; // keep the face clear
      const n2 = V(p.x / R.x ** 2, p.y / R.y ** 2, p.z / R.z ** 2).normalize();
      const sp = mesh(g.cone, sm, [0.035, 0.16, 0.035]);
      sp.position.copy(p);
      sp.quaternion.setFromUnitVectors(V(0, 1, 0), n2);
      bodyGroup.add(sp);
    }
    parts.add('spines');
  }

  if (recipe.shell) {
    const S = recipe.shell;
    const shell = pivot(bodyGroup, 0, bodyShape.r.y * 0.45, -bodyShape.r.z * 0.45);
    for (let k = 0; k < 5; k++) {
      const r = S.size * 0.5 * (1 - k * 0.17);
      const ring = mesh(g.sphere, M(k % 2 ? S.color2 : S.color, { rough: 0.35 }), [r, r * 0.55, r], [0, k * S.size * 0.15, -k * 0.04]);
      shell.add(ring);
    }
    shell.add(mesh(g.cone, M(S.color), [S.size * 0.12, S.size * 0.3, S.size * 0.12], [0, S.size * 0.72, -0.2], [-0.4, 0, 0]));
    shell.rotation.x = -0.35;
    rig.shell = shell;
    parts.add('shell:spiral');
  }

  // ---------------------------------------------------------------- wings
  if (recipe.wings) {
    const W = recipe.wings;
    const s = W.size;
    for (const side of [-1, 1]) {
      const pv = pivot(bodyPivot, side * bodyShape.r.x * 0.55, W.y, (W.z || 0) - bodyShape.r.z * 0.3);
      const wm = M(W.color, { side: THREE.DoubleSide, rough: 0.5 });
      switch (W.style) {
        case 'bat': {
          const wmesh = mesh(g.wing, wm, [s * 1.3 * side, s * 1.1, 1], [0, -s * 0.1, 0], [0, -side * 0.25, 0]);
          pv.add(wmesh);
          pv.add(mesh(g.cyl, M(W.color2 || W.color), [0.04, s * 1.1, 0.04], [side * 0.05, -0.05, 0], [0, 0, -side * 1.15]));
          break;
        }
        case 'moth':
          pv.add(mesh(g.sphere, wm, [s * 0.65, s * 0.5, 0.04], [side * s * 0.55, s * 0.25, 0], [0, 0, -side * 0.35]));
          pv.add(mesh(g.sphere, wm, [s * 0.42, s * 0.36, 0.04], [side * s * 0.4, -s * 0.28, 0.01], [0, 0, side * 0.4]));
          for (const [dx, dy, r] of [[0.6, 0.3, 0.16], [0.42, -0.28, 0.11]]) {
            const gm = mat(col(W.color2), { emissive: col(W.color2), ei: 1.2 });
            pv.add(mesh(g.sphere, gm, [s * r, s * r, 0.05], [side * s * dx, s * dy, 0.03]));
            rig.glow.push(gm);
          }
          break;
        case 'feather':
          pv.add(mesh(g.sphere, wm, [0.14, s * 0.55, s * 0.38], [side * 0.08, -s * 0.15, 0], [0, 0, side * 0.15]));
          for (let k = 0; k < 3; k++) pv.add(mesh(g.drop, M(W.color2 || W.color), [0.08, s * 0.3, s * 0.12], [side * 0.1, -s * (0.55 + k * 0.05), -s * (0.15 - k * 0.12)], [Math.PI, 0, 0]));
          break;
        case 'bug':
          pv.add(mesh(g.sphere, mat(col(W.color), { opacity: 0.55, rough: 0.1, side: THREE.DoubleSide }), [s * 0.5, s * 0.32, 0.03], [side * s * 0.45, s * 0.2, 0], [0, 0, -side * 0.5]));
          pv.add(mesh(g.sphere, mat(col(W.color), { opacity: 0.55, rough: 0.1, side: THREE.DoubleSide }), [s * 0.32, s * 0.2, 0.03], [side * s * 0.32, -s * 0.05, 0.02], [0, 0, side * 0.2]));
          break;
        case 'stub':
          pv.add(mesh(g.sphere, wm, [0.12, s * 0.45, s * 0.35], [side * 0.08, -s * 0.1, 0], [0, 0, side * 0.35]));
          break;
        case 'fins':
          pv.position.x = side * bodyShape.r.x * 0.9;
          pv.position.z = 0.1;
          pv.add(mesh(g.drop, wm, [0.06, s * 0.7, s * 0.45], [side * 0.08, -s * 0.15, 0], [Math.PI / 2 + 0.5, 0, -side * 1.1]));
          break;
        case 'aurora': {
          const am1 = mat(col(W.color), { emissive: col(W.color), ei: 0.35, opacity: 0.85, side: THREE.DoubleSide });
          const am2 = mat(col(W.color2), { emissive: col(W.color2), ei: 0.35, opacity: 0.85, side: THREE.DoubleSide });
          pv.add(mesh(g.drop, am1, [0.05, s * 1.2, s * 0.7], [side * s * 0.4, s * 0.1, 0], [Math.PI / 2, 0, -side * 1.3]));
          pv.add(mesh(g.drop, am2, [0.05, s * 0.8, s * 0.5], [side * s * 0.3, -s * 0.1, -0.2], [Math.PI / 2, 0, -side * 1.6]));
          rig.glow.push(am1, am2);
          break;
        }
        default:
          break;
      }
      rig.wings.push({ pivot: pv, side, style: W.style });
    }
    parts.add(`wings:${W.style}`);
  }

  // ---------------------------------------------------------------- tail
  if (recipe.tail && !rig.serpent) {
    const T = recipe.tail;
    const s = T.size;
    const base = V(0, B.y + (T.y || -bh * 0.1), -bodyShape.r.z * 0.85);
    const tailRoot = pivot(bodyPivot, base.x, base.y, base.z);
    const tm = M(T.color, { rough: 0.5 });
    const tm2 = T.color2 ? M(T.color2, { rough: 0.5 }) : tm;
    const chain = (n, segLen, radius, curl, matFn, taper = 0.8) => {
      let parent = tailRoot;
      for (let i = 0; i < n; i++) {
        const seg = pivot(parent, 0, 0, i === 0 ? 0 : -segLen);
        seg.rotation.x = curl;
        const r = radius * Math.pow(taper, i);
        seg.add(mesh(g.sphere, matFn(i), [r, r, segLen * 0.7], [0, 0, -segLen * 0.5]));
        rig.tail.push(seg);
        parent = seg;
      }
      return parent;
    };
    switch (T.style) {
      case 'ball':
        tailRoot.add(mesh(g.sphere, tm, [s * 0.5, s * 0.5, s * 0.5], [0, 0.05, -s * 0.2]));
        rig.tail.push(tailRoot);
        break;
      case 'stub':
        tailRoot.add(mesh(g.cone, tm, [s * 0.35, s, s * 0.35], [0, 0, 0], [-Math.PI / 2 - 0.4, 0, 0]));
        rig.tail.push(tailRoot);
        break;
      case 'stinger':
        tailRoot.add(mesh(g.cone, tm, [s * 0.3, s, s * 0.3], [0, 0, 0], [-Math.PI / 2, 0, 0]));
        rig.tail.push(tailRoot);
        break;
      case 'fluffy':
      case 'blossom': {
        const pv = pivot(tailRoot);
        pv.rotation.x = -0.9;
        pv.add(mesh(g.sphere, tm, [s * 0.32, s * 0.32, s * 0.62], [0, 0, -s * 0.55]));
        const tipMat = T.flame ? mat(col(T.color2), { emissive: col(T.color2), ei: 0.9 }) : tm2;
        if (T.style === 'blossom') {
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            pv.add(mesh(g.sphere, tm2, [s * 0.16, s * 0.16, s * 0.08], [Math.cos(a) * s * 0.14, Math.sin(a) * s * 0.14, -s * 1.1]));
          }
          pv.add(mesh(g.sphere, mat(0xffe27a), s * 0.08, [0, 0, -s * 1.14]));
        } else {
          pv.add(mesh(g.sphere, tipMat, [s * 0.24, s * 0.24, s * 0.3], [0, 0, -s * 1.05]));
          if (T.flame) {
            pv.add(mesh(g.drop, tipMat, [s * 0.22, s * 0.6, s * 0.22], [0, s * 0.2, -s * 1.12], [-0.6, 0, 0]));
            rig.glow.push(tipMat);
          }
        }
        rig.tail.push(pv);
        break;
      }
      case 'cloud': {
        const pv = pivot(tailRoot);
        pv.rotation.x = -0.6;
        for (let k = 0; k < 4; k++) pv.add(mesh(g.sphereLo, k % 2 ? tm2 : tm, [s * 0.24, s * 0.24, s * 0.24], [0, -k * s * 0.12, -s * (0.2 + k * 0.22)]));
        rig.tail.push(pv);
        break;
      }
      case 'curl':
        chain(T.segments || 5, s * 0.28, s * 0.13, -0.5, (i) => (i === (T.segments || 5) - 1 ? tm2 : tm), 0.88);
        break;
      case 'ringed':
        chain(T.segments || 5, s * 0.3, s * 0.2, -0.35, (i) => (i % 2 ? tm2 : tm), 0.92);
        break;
      case 'vine': {
        const end = chain(T.segments || 6, s * 0.26, s * 0.07, -0.55, () => tm, 0.95);
        end.add(mesh(g.drop, tm2, [s * 0.22, s * 0.4, 0.05], [0, 0.05, -s * 0.3], [Math.PI / 2, 0, 0]));
        break;
      }
      case 'croc':
        chain(T.segments || 4, s * 0.38, s * 0.3, -0.05, (i) => (i % 2 ? tm : tm), 0.72);
        break;
      case 'flame':
      case 'lantern':
      case 'tuft':
      case 'bolt': {
        const n = T.segments || 4;
        const end = chain(n, s * 0.3, T.style === 'lantern' || T.style === 'tuft' ? s * 0.06 : s * 0.14, T.style === 'lantern' ? -0.45 : -0.25, () => tm, T.style === 'flame' ? 0.82 : 0.95);
        if (T.style === 'flame') {
          const fm = mat(col(T.color2), { emissive: col(T.color2), ei: 1.1 });
          const flame = mesh(g.drop, fm, [s * 0.22, s * 0.5, s * 0.22], [0, s * 0.12, -s * 0.3], [-0.2, 0, 0]);
          end.add(flame);
          rig.glow.push(fm);
          rig.tailFlame = flame;
        } else if (T.style === 'lantern') {
          const lm = mat(col(T.color2), { emissive: col(T.color2), ei: 1.6 });
          end.add(mesh(g.sphere, lm, s * 0.2, [0, -0.05, -s * 0.3]));
          end.add(mesh(g.cyl, M('accent'), [s * 0.08, s * 0.1, s * 0.08], [0, s * 0.14, -s * 0.3]));
          rig.glow.push(lm);
        } else if (T.style === 'tuft') {
          end.add(mesh(g.sphere, tm2, s * 0.17, [0, 0, -s * 0.32]));
        } else {
          // bolt: zigzag
          end.add(mesh(g.box, tm2, [s * 0.1, s * 0.4, s * 0.06], [0, s * 0.15, -s * 0.2], [0.5, 0, 0.6]));
          end.add(mesh(g.box, tm, [s * 0.12, s * 0.45, s * 0.06], [0, s * 0.35, -s * 0.05], [-0.4, 0, -0.6]));
        }
        break;
      }
      case 'fish':
      case 'whale': {
        const pv = pivot(tailRoot);
        pv.add(mesh(g.cone, tm, [s * 0.25, s * 0.5, s * 0.25], [0, 0, 0], [-Math.PI / 2, 0, 0]));
        const fin = T.style === 'whale' ? [s * 0.8, 0.06, s * 0.35] : [0.06, s * 0.7, s * 0.4];
        for (const side of [-1, 1]) {
          const f = mesh(g.drop, tm2, fin, T.style === 'whale' ? [side * s * 0.35, 0, -s * 0.55] : [0, side * s * 0.28, -s * 0.55], T.style === 'whale' ? [Math.PI / 2, 0, side * 0.9] : [side * 0.9 + Math.PI / 2, 0, 0]);
          pv.add(f);
        }
        rig.tail.push(pv);
        break;
      }
      case 'multi': {
        for (let k = 0; k < (T.count || 3); k++) {
          const pv = pivot(tailRoot);
          pv.rotation.set(-0.9 - (k === 1 ? 0.25 : 0), (k - 1) * 0.55, 0);
          pv.add(mesh(g.sphere, tm, [s * 0.26, s * 0.26, s * 0.6], [0, 0, -s * 0.55]));
          const tipm = mat(col(T.color2), { emissive: col(T.color2), ei: 0.5 });
          pv.add(mesh(g.sphere, tipm, [s * 0.2, s * 0.2, s * 0.26], [0, 0, -s * 1.02]));
          pv.add(mesh(g.star, mat(0xfff7a8, { emissive: 0xfff7a8, ei: 1.4 }), s * 0.12, [0, 0, -s * 1.25]));
          rig.tail.push(pv);
        }
        break;
      }
      case 'comet': {
        const pv = pivot(tailRoot);
        const cm = mat(col(T.color), { emissive: col(T.color), ei: 1.2, opacity: 0.85 });
        pv.add(mesh(g.cone, cm, [s * 0.25, s * 1.2, s * 0.25], [0, 0, -s * 0.0], [-Math.PI / 2 - 0.4, 0, 0]));
        pv.add(mesh(g.star, cm, s * 0.2, [0, 0.05, 0.02]));
        rig.glow.push(cm);
        rig.tail.push(pv);
        break;
      }
      default:
        tailRoot.add(mesh(g.sphere, tm, s * 0.3));
        rig.tail.push(tailRoot);
    }
    parts.add(`tail:${T.style}`);
  }

  // ---------------------------------------------------------------- legs
  const L = recipe.legs || { count: 0 };
  if (L.count > 0) {
    const lm = M(L.color || 'body', { rough: 0.5 });
    const tipm = L.tip ? M(L.tip, { rough: 0.5 }) : lm;
    const [lw, lh] = L.size;
    const hipY = Math.max(lh, 0.12) + 0.02;
    const positions = [];
    if (L.count === 2) positions.push([-1, 0], [1, 0]);
    else if (L.count === 4) positions.push([-1, 1], [1, 1], [-1, -1], [1, -1]);
    else if (L.count === 6) positions.push([-1, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]);
    for (const [sx, sz] of positions) {
      const x = sx * L.gapX;
      const z = sz * (L.gapZ || 0) + (L.count === 2 ? 0.08 : 0);
      if (L.style === 'tentacle') {
        const a = Math.atan2(sz === 0 ? 0.0001 : sz, sx) + (sz === 0 ? 0 : 0);
        const ang = (positions.indexOf(positions.find((p) => p[0] === sx && p[1] === sz)) / positions.length) * Math.PI * 2;
        let parent = pivot(bodyPivot, Math.cos(ang) * L.gapX, B.y - bh * 0.32, Math.sin(ang) * L.gapX);
        parent.rotation.y = -ang + Math.PI / 2;
        const legPivot = parent;
        for (let k = 0; k < 4; k++) {
          const seg = pivot(parent, 0, -lh * 0.22, k === 0 ? 0 : lh * 0.05);
          seg.rotation.x = 0.35;
          seg.add(mesh(g.sphere, k === 3 ? tipm : lm, [lw * (1 - k * 0.18), lh * 0.16, lw * (1 - k * 0.18)]));
          parent = seg;
        }
        rig.legs.push({ pivot: legPivot, side: sx, front: sz, tentacle: true });
        void a;
        continue;
      }
      const pv = pivot(bodyPivot, x, hipY, z);
      switch (L.style) {
        case 'insect': {
          pv.position.y = B.y - bh * 0.1;
          pv.position.x = sx * bodyShape.r.x * 0.75;
          const up = mesh(g.cyl, lm, [lw, lh * 0.55, lw], [0, 0, 0], [0, 0, -sx * 1.2]);
          pv.add(up);
          const lo = mesh(g.cyl, lm, [lw * 0.8, lh * 0.75, lw * 0.8], [sx * lh * 0.5, lh * 0.2, 0], [Math.PI, 0, sx * 0.25]);
          pv.add(lo);
          break;
        }
        case 'hoof':
          pv.position.y = lh + 0.05;
          pv.add(mesh(g.capsule, lm, [lw * 2, lh * 0.9, lw * 2], [0, -lh * 0.45, 0]));
          pv.add(mesh(g.cylC, tipm, [lw * 1.05, lh * 0.18, lw * 1.05], [0, -lh * 0.95, 0]));
          break;
        case 'talon':
          pv.position.y = lh + 0.05;
          pv.add(mesh(g.cyl, lm, [lw * 0.5, lh, lw * 0.5], [0, -lh, 0]));
          for (const a of [-0.5, 0, 0.5]) pv.add(mesh(g.capsule, lm, [lw * 0.6, lw * 2.2, lw * 0.6], [Math.sin(a) * lw * 1.2, -lh + 0.03, Math.cos(a) * lw * 1.3], [Math.PI / 2, a, 0]));
          break;
        case 'webbed':
          pv.position.y = 0.12;
          pv.add(mesh(g.sphere, lm, [lw, 0.08, lw * 1.25], [0, -0.06, lw * 0.5]));
          break;
        case 'block':
          pv.position.y = lh + 0.02;
          pv.add(mesh(g.rbox, lm, [lw * 1.6, lh * 1.1, lw * 1.6], [0, -lh * 0.5, 0]));
          if (L.tip) pv.add(mesh(g.rbox, tipm, [lw * 1.65, lh * 0.25, lw * 1.65], [0, -lh * 0.95, 0]));
          break;
        default: {
          // stub, paw, claw
          pv.position.y = lh + 0.02;
          pv.add(mesh(g.capsule, lm, [lw * 2, lh * 1.0, lw * 2], [0, -lh * 0.5, 0]));
          pv.add(mesh(g.sphere, tipm, [lw * 1.12, lw * 0.75, lw * 1.3], [0, -lh * 0.92, lw * 0.2]));
          if (L.style === 'claw') {
            for (const a of [-0.35, 0, 0.35]) pv.add(mesh(g.cone, M(L.tip || 'belly'), [0.04, 0.12, 0.04], [Math.sin(a) * lw * 0.8, -lh * 0.95, lw * 1.2], [Math.PI / 2, 0, 0]));
          }
        }
      }
      rig.legs.push({ pivot: pv, side: sx, front: sz });
    }
    parts.add(`legs:${L.count}:${L.style}`);
  }

  // ---------------------------------------------------------------- arms
  if (recipe.arms) {
    const A = recipe.arms;
    const am = M(A.color || 'body', { rough: 0.5 });
    const tip = A.tip ? M(A.tip) : am;
    const s = A.size;
    for (const side of [-1, 1]) {
      const pv = pivot(bodyPivot, side * A.gap, A.y, 0.12);
      switch (A.style) {
        case 'leaf':
          pv.add(mesh(g.drop, am, [s * 0.5, s, 0.07], [side * s * 0.25, -s * 0.35, 0], [0, 0, side * 2.2]));
          break;
        case 'long':
          pv.add(mesh(g.capsule, am, [s * 0.32, s * 1.4, s * 0.32], [0, -s * 0.6, 0]));
          pv.add(mesh(g.sphere, tip, [s * 0.22, s * 0.22, s * 0.22], [0, -s * 1.25, 0]));
          pv.rotation.z = side * 0.3;
          break;
        case 'big':
          pv.add(mesh(g.capsule, am, [s * 0.7, s * 1.3, s * 0.7], [0, -s * 0.55, 0]));
          pv.add(mesh(g.sphere, tip, [s * 0.38, s * 0.3, s * 0.38], [0, -s * 1.15, 0.05]));
          pv.rotation.z = side * 0.25;
          break;
        case 'flipper':
          pv.add(mesh(g.sphere, am, [0.1, s * 0.6, s * 0.3], [side * 0.05, -s * 0.45, 0], [0, 0, side * 0.35]));
          break;
        case 'pincer': {
          pv.add(mesh(g.cyl, am, [0.08, s * 0.6, 0.08], [0, 0, 0], [Math.PI / 2 - 0.4, 0, side * 0.6]));
          const claw = pivot(pv, side * s * 0.35, s * 0.22, s * 0.45);
          claw.add(mesh(g.sphere, am, [s * 0.38, s * 0.28, s * 0.42]));
          claw.add(mesh(g.cone, am, [s * 0.13, s * 0.42, s * 0.1], [side * s * 0.12, s * 0.12, s * 0.32], [Math.PI / 2 - 0.3, 0, 0]));
          claw.add(mesh(g.cone, am, [s * 0.12, s * 0.38, s * 0.1], [side * s * 0.12, -s * 0.1, s * 0.3], [Math.PI / 2 + 0.3, 0, 0]));
          break;
        }
        case 'cactus':
          pv.add(mesh(g.capsule, am, [s * 0.5, s * 0.5, s * 0.5], [side * s * 0.25, 0, 0], [0, 0, Math.PI / 2]));
          pv.add(mesh(g.capsule, am, [s * 0.45, s * 0.7, s * 0.45], [side * s * 0.55, s * 0.3, 0]));
          break;
        case 'block':
          pv.add(mesh(g.rbox, am, [s * 0.8, s * 1.4, s * 0.8], [side * s * 0.1, -s * 0.55, 0]));
          if (A.tip) pv.add(mesh(g.box, mat(col(A.tip), { emissive: col(A.tip), ei: 0.8 }), [s * 0.82, s * 0.12, s * 0.82], [side * s * 0.1, -s * 0.9, 0]));
          break;
        case 'digger':
          pv.add(mesh(g.sphere, am, [s * 0.4, s * 0.25, s * 0.45], [side * s * 0.15, -s * 0.2, s * 0.25]));
          for (let k = -1; k <= 1; k++) pv.add(mesh(g.cone, tip, [0.05, 0.22, 0.05], [side * s * 0.15 + k * 0.1, -s * 0.25, s * 0.6], [Math.PI / 2, 0, 0]));
          break;
        case 'wave':
          pv.add(mesh(g.capsule, am, [s * 0.5, s * 0.6, s * 0.5], [0, -s * 0.3, 0]));
          pv.add(mesh(g.sphere, am, [s * 0.32, s * 0.3, s * 0.32], [0, -s * 0.72, 0]));
          if (side === 1) rig.waveArm = pv;
          break;
        case 'paw':
          pv.add(mesh(g.capsule, am, [s * 0.55, s * 0.7, s * 0.55], [0, -s * 0.35, 0]));
          break;
        default:
          pv.add(mesh(g.sphere, am, [s, s * 0.85, s], [side * s * 0.3, -s * 0.2, 0]));
      }
      rig.arms.push({ pivot: pv, side, base: pv.rotation.clone() });
    }
    parts.add(`arms:${A.style}`);
  }

  // ---------------------------------------------------------------- extras
  for (const X of recipe.extras || []) {
    switch (X.kind) {
      case 'collar': {
        const cy = X.y ?? B.y + bh * 0.42;
        const c = mesh(g.torus, M(X.color), [bw * 0.38, bd * 0.38, 1.4], [0, cy, 0.04], [Math.PI / 2 - 0.15, 0, 0]);
        bodyPivot.add(c);
        if (X.coin) {
          const coin = mesh(g.cylC, mat(0xffd23a, { metal: 0.5, rough: 0.3, emissive: 0x3a2a00 }), [0.17, 0.05, 0.17], [0, cy - 0.15, bd * 0.42 + 0.05], [Math.PI / 2, 0, 0]);
          bodyPivot.add(coin);
          rig.coin = coin;
        } else if (X.gem) {
          bodyPivot.add(mesh(g.octa, mat(col(X.gem), { emissive: col(X.gem), ei: 0.5, rough: 0.1 }), [0.09, 0.12, 0.06], [0, cy - 0.12, bd * 0.42 + 0.03]));
        }
        break;
      }
      case 'medallion': {
        const p = surf(bodyShape, 0, 0.35, -0.02);
        const m = mesh(g.cylC, mat(col(X.color), { metal: 0.6, rough: 0.3 }), [0.2, 0.06, 0.2], [p.pos.x, p.pos.y + B.y, p.pos.z + 0.04], [Math.PI / 2, 0, 0]);
        bodyPivot.add(m);
        bodyPivot.add(mesh(g.octa, mat(col(X.gem), { emissive: col(X.gem), ei: 0.6 }), [0.07, 0.09, 0.05], [p.pos.x, p.pos.y + B.y, p.pos.z + 0.09]));
        break;
      }
      case 'spout': {
        const sp = pivot(bodyGroup, 0, bodyShape.r.y * 0.95, -0.1);
        const wm = mat(col(X.color), { opacity: 0.7, emissive: col(X.color), ei: 0.3 });
        sp.add(mesh(g.cyl, wm, [0.1, 0.6, 0.1]));
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2;
          sp.add(mesh(g.sphere, wm, 0.12, [Math.cos(a) * 0.22, 0.65, Math.sin(a) * 0.22]));
        }
        rig.spout = sp;
        break;
      }
      case 'satellites': {
        const orbit = pivot(bodyGroup);
        const sm = mat(col(X.color), { emissive: col(X.color), ei: 0.5, rough: 0.1 });
        for (let k = 0; k < (X.count || 3); k++) {
          const a = (k / (X.count || 3)) * Math.PI * 2;
          orbit.add(mesh(g.octa, sm, [0.12, 0.2, 0.12], [Math.cos(a) * bw * 0.85, Math.sin(a * 2) * 0.2, Math.sin(a) * bw * 0.85]));
        }
        rig.spin.push({ obj: orbit, axis: 'y', speed: 1.4 });
        break;
      }
      case 'lantern': {
        const arm = rig.arms.find((a) => a.side === 1)?.pivot || bodyPivot;
        const ln = pivot(arm, 0.15, -0.35, 0.25);
        ln.add(mesh(g.cyl, mat(0x3a3a4a), [0.02, 0.25, 0.02]));
        ln.add(mesh(g.rbox, mat(0x3a3a4a), [0.26, 0.05, 0.26], [0, 0.0, 0]));
        const lm = mat(col(X.color), { emissive: col(X.color), ei: 1.6, opacity: 0.9 });
        ln.add(mesh(g.sphere, lm, [0.13, 0.16, 0.13], [0, -0.16, 0]));
        rig.glow.push(lm);
        rig.lantern = ln;
        break;
      }
      case 'mane': {
        const ring = pivot(head);
        const fm = mat(col(X.color), { emissive: col(X.color), ei: 0.7 });
        const fm2 = mat(col(X.color2), { emissive: col(X.color2), ei: 0.9 });
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const r = Math.max(hs.r.x, hs.r.y) * 0.98;
          const f = mesh(g.drop, k % 2 ? fm : fm2, [0.22, 0.5, 0.22], [Math.cos(a) * r, Math.sin(a) * r, -0.15]);
          f.rotation.z = a - Math.PI / 2;
          ring.add(f);
        }
        rig.glow.push(fm, fm2);
        rig.flames = ring;
        break;
      }
      case 'halo': {
        const hm = mat(col(X.color), { emissive: col(X.color), ei: 1.4 });
        const h = mesh(g.torus, hm, [0.4, 0.4, 0.7], [0, hs.r.y + 0.45, -0.05], [Math.PI / 2, 0, 0]);
        head.add(h);
        rig.glow.push(hm);
        rig.halo = h;
        break;
      }
      case 'whiskers': {
        const wm = mat(col(X.color), { emissive: col(X.color), ei: 0.8 });
        const sn = rig.snout;
        for (const side of [-1, 1]) {
          const w = pivot(faceHost, side * 0.3, sn ? sn.position.y : 0, sn ? sn.position.z : hs.r.z);
          w.add(mesh(g.cyl, wm, [0.02, 0.9, 0.02], [0, 0, 0], [0, 0, -side * 1.3]));
          rig.antennae.push(w);
        }
        break;
      }
      case 'honeypot': {
        const arm = rig.arms.find((a) => a.side === 1)?.pivot || bodyPivot;
        const pot = pivot(arm, 0.05, -0.25, 0.2);
        pot.add(mesh(g.sphere, mat(0xc87a3a), [0.18, 0.16, 0.18]));
        pot.add(mesh(g.sphere, mat(col(X.color), { emissive: col(X.color), ei: 0.3 }), [0.13, 0.06, 0.13], [0, 0.12, 0]));
        break;
      }
      case 'pixels': {
        const orbit = pivot(bodyGroup);
        const pm = mat(col(X.color), { emissive: col(X.color), ei: 0.8 });
        for (let k = 0; k < (X.count || 6); k++) {
          const a = (k / (X.count || 6)) * Math.PI * 2;
          orbit.add(mesh(g.box, pm, 0.14, [Math.cos(a) * bw * 0.9, Math.sin(a * 3) * 0.4, Math.sin(a) * bw * 0.9]));
        }
        rig.spin.push({ obj: orbit, axis: 'y', speed: 2.2 });
        rig.glitch = true;
        break;
      }
      default:
        break;
    }
    parts.add(`extra:${X.kind}`);
  }

  // ---------------------------------------------------------------- finish
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = !!opts.shadows;
      rig.meshes.push(o);
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  rig.height = box.max.y;
  rig.width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  rig.bbox = box;
  rig.parts = [...parts].sort();
  rig.rawMeshCount = rig.meshes.length;
  rig.headTop = (recipe.head ? recipe.head.pos[1] + recipe.head.size[1] / 2 : B.y + bh / 2);
  root.scale.setScalar(species.size);
  rig.scale = species.size;
  return rig;
}

// Swap every mesh to a flash/frozen material (or back with null).
export function setRigMaterial(rig, material) {
  for (const m of rig.meshes) m.material = material || m.userData.baseMat;
}

// A compact description used by tests to prove silhouettes differ.
export function rigSignature(rig) {
  const s = rig.bbox.getSize(new THREE.Vector3());
  return {
    parts: rig.parts,
    meshes: rig.rawMeshCount ?? rig.meshes.length,
    size: [s.x, s.y, s.z].map((v) => Math.round(v * 10) / 10),
  };
}
