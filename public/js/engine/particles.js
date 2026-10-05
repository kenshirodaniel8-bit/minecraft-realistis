// Block-break debris and splash particles using a single instanced mesh.

import * as THREE from 'three';
import { IS_SOLID } from './blocks.js';
import { createEntityMaterial } from './materials.js';

export class Particles {
  constructor(scene, max = 700) {
    this.max = max;
    this.material = createEntityMaterial({ roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
    this.items = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  // color: [r,g,b] in sRGB 0..1
  burst(x, y, z, color, count = 22, opts = {}) {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= this.max) this.items.shift();
      const shade = 0.75 + Math.random() * 0.35;
      this.items.push({
        x: x + 0.15 + Math.random() * 0.7,
        y: y + 0.15 + Math.random() * 0.7,
        z: z + 0.15 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * (opts.spread ?? 4),
        vy: Math.random() * (opts.up ?? 4) + 1,
        vz: (Math.random() - 0.5) * (opts.spread ?? 4),
        rx: Math.random() * 6, ry: Math.random() * 6,
        size: (opts.size ?? 0.09) * (0.6 + Math.random() * 0.8),
        life: (opts.life ?? 0.9) * (0.6 + Math.random() * 0.6),
        age: 0,
        gravity: opts.gravity ?? 18,
        r: color[0] * shade, g: color[1] * shade, b: color[2] * shade,
      });
    }
  }

  update(dt, world, light) {
    const items = this.items;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy -= p.gravity * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      const id = world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      if (id > 0 && IS_SOLID[id]) {
        if (p.vy < 0 && world.getBlock(Math.floor(p.x), Math.floor(ny), Math.floor(p.z)) > 0) {
          p.vy = 0; p.vx *= 0.6; p.vz *= 0.6;
        } else {
          p.vx *= -0.3; p.vz *= -0.3;
        }
      } else {
        p.x = nx; p.y = ny; p.z = nz;
      }
      items[n++] = p;
    }
    items.length = n;

    const count = Math.min(n, this.max);
    for (let i = 0; i < count; i++) {
      const p = items[i];
      const fade = 1 - Math.max(0, (p.age - p.life * 0.6) / (p.life * 0.4));
      this._s.setScalar(p.size * fade);
      this._e.set(p.rx, p.ry, 0);
      this._q.setFromEuler(this._e);
      this._p.set(p.x, p.y, p.z);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      this._c.setRGB(p.r, p.g, p.b, THREE.SRGBColorSpace);
      this.mesh.setColorAt(i, this._c);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (light) {
      this.material.userData.lightUniforms.uEntitySky.value = light.sky / 15;
      this.material.userData.lightUniforms.uEntityBlock.value = light.block / 15;
    }
  }

  clear() { this.items.length = 0; this.mesh.count = 0; }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
