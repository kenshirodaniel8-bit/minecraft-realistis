// Procedural 3D models for base decorations (shared/decor.js).
// Each model is built once from shared geometries and materials, then cloned.
// The front of every model faces +z; basesView turns it to face into the base.

import * as THREE from 'three';

const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 16, 12),
  hemi: new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  cone: new THREE.ConeGeometry(1, 1, 12),
  torus: new THREE.TorusGeometry(1, 0.35, 10, 24),
  octa: new THREE.OctahedronGeometry(1, 0),
  cup: new THREE.CylinderGeometry(1, 0.55, 1, 16, 1, true),
};

const matCache = new Map();
function mat(color, o = {}) {
  const key = `${color}|${o.emissive || 0}|${o.ei ?? ''}|${o.metal || 0}|${o.rough ?? 0.6}|${o.side || 0}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color,
      emissive: o.emissive || 0,
      emissiveIntensity: o.emissive ? (o.ei ?? 0.8) : 0,
      metalness: o.metal || 0,
      roughness: o.rough ?? 0.6,
      side: o.side || THREE.FrontSide,
    }));
  }
  return matCache.get(key);
}

function part(g, geometry, material, [x, y, z], [sx, sy, sz], rot) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = true;
  g.add(m);
  return m;
}

const BUILDERS = {
  flower_bed(g) {
    part(g, geo.box, mat(0x8a5a3a), [0, 0.2, 0], [2.4, 0.4, 1.3]);
    part(g, geo.box, mat(0x5a3a22), [0, 0.42, 0], [2.2, 0.06, 1.1]);
    const colors = [0xff5a8a, 0xffd23a, 0xa86bff, 0xff8a3a, 0x5ac8ff, 0xff7ad8];
    colors.forEach((c, i) => {
      const x = -0.85 + (i % 3) * 0.85;
      const z = i < 3 ? -0.25 : 0.25;
      part(g, geo.cyl, mat(0x3fae44), [x, 0.75, z], [0.05, 0.6, 0.05]);
      part(g, geo.sphere, mat(c), [x, 1.1, z], [0.22, 0.16, 0.22]);
      part(g, geo.sphere, mat(0xfff3a0), [x, 1.14, z + 0.12], [0.08, 0.08, 0.05]);
    });
  },
  snack_bowl(g) {
    const bowl = part(g, geo.hemi, mat(0x5ac8ff, { rough: 0.3, side: THREE.DoubleSide }), [0, 0.75, 0], [0.9, 0.6, 0.9]);
    bowl.rotation.x = Math.PI;
    part(g, geo.cyl, mat(0x3a9ad8), [0, 0.1, 0], [0.5, 0.2, 0.5]);
    [[0, 0.75, 0, 0xff7a3a], [0.3, 0.72, 0.2, 0xffd23a], [-0.3, 0.72, 0.15, 0xff5a8a], [0.1, 0.8, -0.3, 0x8fd46b], [-0.15, 0.85, -0.05, 0xc46bff]].forEach(([x, y, z, c]) => {
      part(g, geo.sphere, mat(c), [x, y, z], [0.2, 0.2, 0.2]);
    });
  },
  lantern(g) {
    part(g, geo.cyl, mat(0x5a3a22), [0, 1.3, 0], [0.08, 2.6, 0.08]);
    part(g, geo.box, mat(0x5a3a22), [0, 2.55, 0.35], [0.1, 0.1, 0.8]);
    part(g, geo.cyl, mat(0x3a2a1a), [0, 2.4, 0.7], [0.02, 0.3, 0.02]);
    part(g, geo.sphere, mat(0xff4a3a, { emissive: 0xff5a2a }), [0, 1.95, 0.7], [0.42, 0.52, 0.42]);
    part(g, geo.cyl, mat(0xffc23a, { metal: 0.6, rough: 0.3 }), [0, 2.45, 0.7], [0.22, 0.08, 0.22]);
    part(g, geo.cyl, mat(0xffc23a, { metal: 0.6, rough: 0.3 }), [0, 1.45, 0.7], [0.22, 0.08, 0.22]);
  },
  monster_bed(g) {
    part(g, geo.torus, mat(0xff8fc8, { rough: 0.9 }), [0, 0.35, 0], [1.0, 1.0, 0.9], [Math.PI / 2, 0, 0]);
    part(g, geo.cyl, mat(0xfff0f6, { rough: 0.95 }), [0, 0.2, 0], [0.95, 0.25, 0.95]);
    part(g, geo.sphere, mat(0xfff0f6, { rough: 0.95 }), [0.3, 0.45, -0.3], [0.35, 0.18, 0.25]);
  },
  mushroom_lamp(g) {
    part(g, geo.cyl, mat(0xf3ead6), [0, 0.8, 0], [0.28, 1.6, 0.28]);
    part(g, geo.hemi, mat(0x9a5aff, { emissive: 0x7a3aff }), [0, 1.55, 0], [1.1, 0.8, 1.1]);
    [[0.5, 1.95, 0.4], [-0.45, 1.9, 0.45], [0, 2.25, -0.1], [0.2, 1.85, -0.75], [-0.6, 1.8, -0.35]].forEach((p) => {
      part(g, geo.sphere, mat(0xfff3ff, { emissive: 0xffd8ff }), p, [0.16, 0.08, 0.16]);
    });
  },
  fountain(g) {
    part(g, geo.cyl, mat(0xcfd8e8, { rough: 0.5 }), [0, 0.3, 0], [1.25, 0.6, 1.25]);
    part(g, geo.cyl, mat(0x3fb4ff, { emissive: 0x1a6aaa, rough: 0.05 }), [0, 0.56, 0], [1.08, 0.06, 1.08]);
    part(g, geo.cyl, mat(0xcfd8e8, { rough: 0.5 }), [0, 1.0, 0], [0.22, 1.0, 0.22]);
    part(g, geo.cyl, mat(0xcfd8e8, { rough: 0.5 }), [0, 1.5, 0], [0.6, 0.15, 0.6]);
    part(g, geo.sphere, mat(0x8fe0ff, { emissive: 0x3a9ad8, rough: 0.05 }), [0, 1.75, 0], [0.22, 0.3, 0.22]);
    [[0.6, 0.8, 0.3], [-0.5, 0.9, -0.4], [0.2, 1.1, -0.6]].forEach((p) => {
      part(g, geo.sphere, mat(0xd8f4ff, { emissive: 0x6ac8ff, rough: 0.05 }), p, [0.12, 0.12, 0.12]);
    });
  },
  crystal_cluster(g) {
    part(g, geo.sphere, mat(0x6a5a5a, { rough: 0.95 }), [0, 0.15, 0], [0.9, 0.35, 0.8]);
    [[0, 1.0, 0, 0.35, 1.0, 0, 0xc46bff], [0.45, 0.7, 0.2, 0.25, 0.7, -0.35, 0x6af0ff], [-0.45, 0.65, 0.15, 0.25, 0.6, 0.4, 0xff6af0], [0.1, 0.6, -0.45, 0.22, 0.55, 0.3, 0x8f9aff]].forEach(([x, y, z, w, h, tilt, c]) => {
      part(g, geo.octa, mat(c, { emissive: c, rough: 0.1 }), [x, y, z], [w, h, w], [tilt, 0, -tilt * 0.6]);
    });
  },
  gold_statue(g) {
    // low metalness: there is no environment map, so very metallic looks dark
    const gold = mat(0xffc23a, { metal: 0.3, rough: 0.3, emissive: 0x5a3a00 });
    part(g, geo.box, mat(0xd8d2c0, { rough: 0.8 }), [0, 0.35, 0], [1.5, 0.7, 1.5]);
    part(g, geo.sphere, gold, [0, 1.35, 0], [0.62, 0.6, 0.55]);   // body
    part(g, geo.sphere, gold, [0, 2.15, 0.12], [0.55, 0.5, 0.5]);   // head
    part(g, geo.sphere, gold, [0, 2.0, 0.55], [0.26, 0.2, 0.2]);    // snout
    part(g, geo.cone, gold, [0.25, 2.65, 0], [0.1, 0.3, 0.1], [0, 0, -0.3]);
    part(g, geo.cone, gold, [-0.25, 2.65, 0], [0.1, 0.3, 0.1], [0, 0, 0.3]);
    part(g, geo.cone, gold, [0.6, 1.6, -0.2], [0.35, 0.7, 0.08], [0.3, 0, -1.0]); // wings
    part(g, geo.cone, gold, [-0.6, 1.6, -0.2], [0.35, 0.7, 0.08], [0.3, 0, 1.0]);
    part(g, geo.sphere, mat(0x2a1a10), [0.2, 2.22, 0.55], [0.09, 0.11, 0.05]);    // eyes
    part(g, geo.sphere, mat(0x2a1a10), [-0.2, 2.22, 0.55], [0.09, 0.11, 0.05]);
  },
  trophy(g, color) {
    const metal = mat(color, { metal: 0.35, rough: 0.25, emissive: new THREE.Color(color).multiplyScalar(0.25).getHex() });
    part(g, geo.box, mat(0x3a2a4a, { rough: 0.7 }), [0, 0.25, 0], [0.9, 0.5, 0.9]);
    part(g, geo.cyl, metal, [0, 0.75, 0], [0.12, 0.5, 0.12]);
    part(g, geo.cyl, metal, [0, 1.0, 0], [0.32, 0.08, 0.32]);
    part(g, geo.cup, metal, [0, 1.5, 0], [0.55, 0.9, 0.55]);
    part(g, geo.torus, metal, [0.6, 1.55, 0], [0.22, 0.25, 0.22]);
    part(g, geo.torus, metal, [-0.6, 1.55, 0], [0.22, 0.25, 0.22]);
    part(g, geo.sphere, mat(0xff5a8a, { emissive: 0xaa2a4a }), [0, 2.1, 0], [0.12, 0.12, 0.12]);
  },
  trophy_bronze(g) { BUILDERS.trophy(g, 0xc97a3a); },
  trophy_silver(g) { BUILDERS.trophy(g, 0xdfe6ee); },
  trophy_gold(g) { BUILDERS.trophy(g, 0xffc23a); },
};

const templates = new Map();

export function buildDecor(id) {
  if (!BUILDERS[id] || id === 'trophy') return null;
  if (!templates.has(id)) {
    const g = new THREE.Group();
    BUILDERS[id](g);
    templates.set(id, g);
  }
  return templates.get(id).clone(true);
}
