// Monster gallery: every species side by side, animated. Useful for checking
// the models and as a showcase. Query params: ?pose=move&only=draklet&cols=6
import * as THREE from 'three';
import { SPECIES, RARITIES } from '#shared/monsters.js';
import { buildMonster } from './monsterRenderer.js';
import { animateMonster } from './animationSystem.js';
import { makeLabel } from './labels.js';

const params = new URLSearchParams(location.search);
const only = params.get('only');
const list = only ? SPECIES.filter((s) => only.split(',').includes(s.id)) : SPECIES;
const cols = Number(params.get('cols')) || Math.min(8, Math.ceil(Math.sqrt(list.length * 1.6)));
let pose = params.get('pose') || 'idle';

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9e3ff);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8ab070, 1.4));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.set(-20, 40, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x8fd65a, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const spacing = only && list.length <= 3 ? 6 : 5.2;
const rows = Math.ceil(list.length / cols);
const items = list.map((sp, i) => {
  const rig = buildMonster(sp.id, { shadows: true });
  const c = i % cols;
  const r = Math.floor(i / cols);
  const x = (c - (cols - 1) / 2) * spacing;
  const z = (r - (rows - 1) / 2) * spacing * 1.15;
  rig.root.position.set(x, 0, z);
  const fit = Math.min(1, 3.4 / (rig.height * sp.size));
  rig.root.scale.setScalar(sp.size * fit);
  scene.add(rig.root);
  const label = makeLabel(`${sp.name}\n${RARITIES[sp.rarity].name}`, { scale: 0.0085, colors: ['#ffffff', RARITIES[sp.rarity].color] });
  label.position.set(x, 0.15, z + 1.9);
  label.material.depthTest = false;
  scene.add(label);
  return { rig, st: { pose, poseT: 0, speed: 6, attackKind: sp.attacks[0].kind, windupMs: 900, quirk: sp.personality.idles[0], quirkDur: 3 } };
});

const camera = new THREE.PerspectiveCamera(only ? 30 : 34, 1, 0.1, 500);
function frame() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const span = Math.max(cols * spacing, (rows * spacing * 1.15) * camera.aspect * 0.9);
  const dist = (span / 2) / Math.tan((camera.fov * Math.PI) / 360) / camera.aspect + 4;
  camera.position.set(0, dist * 0.42, dist * 0.92);
  camera.lookAt(0, 0.8, 0.6);
  camera.updateProjectionMatrix();
}
frame();
addEventListener('resize', frame);

for (const b of document.querySelectorAll('[data-pose]')) {
  b.classList.toggle('on', b.dataset.pose === pose);
  b.onclick = () => {
    pose = b.dataset.pose;
    for (const o of document.querySelectorAll('[data-pose]')) o.classList.toggle('on', o === b);
    for (const it of items) { it.st.pose = pose; it.st.poseT = 0; }
  };
}
for (const it of items) it.st.pose = pose;

let last = performance.now();
let t = Number(params.get('t')) || 0;
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  for (const it of items) {
    if (it.st.pose === 'quirk' && it.st.poseT > 3) {
      const q = it.rig.species.personality.idles;
      it.st.quirk = q[(q.indexOf(it.st.quirk) + 1) % q.length];
      it.st.poseT = 0;
    }
    if (it.st.pose === 'windup' && it.st.poseT > 1.2) { it.st.pose = 'strike'; it.st.poseT = 0; }
    else if (it.st.pose === 'strike' && it.st.poseT > 0.6 && pose === 'windup') { it.st.pose = 'windup'; it.st.poseT = 0; }
    animateMonster(it.rig, it.st, dt, t);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
window.__galleryReady = true;
