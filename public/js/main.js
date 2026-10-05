// Entry point: boot, menus, world management, skin editor and multiplayer join.

import * as THREE from 'three';
import { Renderer } from './engine/renderer.js';
import { createPool } from './engine/workerpool.js';
import { createTextureArrays } from './engine/materials.js';
import { buildBlockIcons } from './ui/icons.js';
import { buildItemIcons } from './ui/itemicons.js';
import { I } from './engine/items.js';
import { Hud } from './ui/hud.js';
import { SoundSystem } from './engine/audio.js';
import { Game } from './engine/game.js';
import {
  listWorlds, loadWorld, saveWorld, deleteWorld, isPersistent,
  loadSettings, saveSettings, loadProfile, saveProfile,
} from './engine/storage.js';
import {
  loadSkinFile, skinCanvasFromDataUrl, createDefaultSkinCanvas, DEFAULT_SKIN_NAMES, PlayerModel,
} from './engine/skin.js';
import { NetworkClient, normalizeServerUrl } from './engine/network.js';
import { normalizeSeed } from './engine/noise.js';

const DEMO_SEED = 77;

const $ = (id) => document.getElementById(id);

// 'server' when the page comes from `npm start`; static builds set a meta tag
// ('static' = any web host, 'embedded' = a sandboxed page that can't open sockets).
const BUILD = document.querySelector('meta[name="realistis-build"]')?.content || 'server';

const S = {
  renderer: null,
  pool: null,
  tex: null,
  icons: null,
  hud: null,
  sound: null,
  settings: null,
  profile: null,
  skinCanvas: null,
  game: null,
  demo: null,
  screen: null,
  overGame: false, // menu screen shown on top of a running game (from pause)
  selectedWorld: null,
  modeFilter: null, // 'survival' | 'creative' | null (all worlds)
  itemCanvases: {},
  busy: false,
};

// ------------------------------------------------------------------ boot

function bootStatus(text, p) {
  $('boot-text').textContent = text;
  $('boot-bar').style.width = Math.round(p * 100) + '%';
}

function fatal(err) {
  console.error(err);
  $('boot').hidden = true;
  $('fatal').hidden = false;
  $('fatal-text').textContent = err && err.message ? err.message : String(err);
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch (e) {
    return false;
  }
}

async function boot() {
  try {
    if (!hasWebGL2()) throw new Error('Your browser or graphics card does not support WebGL 2, which Realistis needs. Try the latest Chrome, Edge or Firefox.');
    if (location.protocol === 'file:') throw new Error('Please run the game through a web server: open a terminal in the project folder and run "npm install" then "npm start", then visit http://localhost:3000');

    S.settings = loadSettings();
    S.profile = loadProfile();
    bootStatus('Starting renderer…', 0.1);
    S.renderer = new Renderer($('game'), S.settings);
    window.addEventListener('resize', () => S.renderer.resize());
    $('game').addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      fatal(new Error('The graphics driver reset (WebGL context lost). Please reload the page; try a lower graphics quality if it happens again.'));
    });

    const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    S.pool = await createPool(new URL('./engine/worker.js', import.meta.url), workers);

    bootStatus('Painting realistic textures…', 0.3);
    S.tex = await S.pool.run('textures');
    createTextureArrays(S.tex, S.renderer.renderer);
    bootStatus('Preparing blocks…', 0.6);
    S.icons = buildBlockIcons(S.tex);
    const items = buildItemIcons();
    Object.assign(S.icons, items.icons);
    S.itemCanvases = items.canvases;
    S.hud = new Hud(S.icons);
    S.hud.foodIcon = S.icons[I.COOKED_MEAT];
    S.hud.onAction = onHudAction;
    S.sound = new SoundSystem();
    S.sound.setVolume(S.settings.volume);
    S.skinCanvas = await currentSkinCanvas();

    setupMenus();
    bootStatus('Generating world…', 0.8);
    await startDemo();
    // Keep the loading screen until the menu background has some terrain (max ~8s).
    const t0 = performance.now();
    while (S.demo && !S.demo.ready && performance.now() - t0 < 8000) {
      await new Promise((r) => setTimeout(r, 100));
      bootStatus('Generating world…', 0.8 + 0.2 * Math.min(1, (performance.now() - t0) / 8000));
    }
    $('boot').hidden = true;
    showScreen('main');
  } catch (err) {
    fatal(err);
  }
}

async function currentSkinCanvas() {
  if (S.profile.skin) return skinCanvasFromDataUrl(S.profile.skin);
  return createDefaultSkinCanvas(S.profile.preset);
}

// ------------------------------------------------------------------ games

async function startDemo() {
  if (S.demo || S.game) return;
  const demo = new Game({
    renderer: S.renderer, pool: S.pool, hud: S.hud, sound: S.sound, settings: S.settings, profile: S.profile,
    skinCanvas: S.skinCanvas, slim: S.profile.slim, texData: S.tex, mode: 'demo', seed: DEMO_SEED,
  });
  S.demo = demo;
  try {
    await demo.init();
    if (S.demo === demo) demo.start();
  } catch (e) {
    console.error('Menu background failed', e);
  }
}

function stopDemo() {
  if (S.demo) {
    S.demo.dispose();
    S.demo = null;
  }
}

async function startGame(extra) {
  stopDemo();
  hideMenu();
  S.sound.unlock();
  const game = new Game(Object.assign({
    renderer: S.renderer, pool: S.pool, hud: S.hud, sound: S.sound, settings: S.settings, profile: S.profile,
    skinCanvas: S.skinCanvas, slim: S.profile.slim, texData: S.tex, itemCanvases: S.itemCanvases,
    onExit: (reason) => onGameExit(reason, extra.mode),
    onAutoTune: (changes) => {
      Object.assign(S.settings, changes);
      saveSettings(S.settings);
    },
  }, extra));
  S.game = game;
  try {
    await game.init();
    game.start();
  } catch (e) {
    console.error(e);
    game.dispose();
    S.game = null;
    showScreen(extra.mode === 'multi' ? 'multi' : 'single');
    setStatus(extra.mode === 'multi' ? 'mp-status' : null, 'Could not start: ' + e.message, 'err');
    startDemo();
  }
}

function onGameExit(reason, mode) {
  S.game = null;
  S.overGame = false;
  if (mode === 'multi') {
    showScreen('multi');
    if (reason) setStatus('mp-status', reason, 'err');
  } else {
    showScreen(mode === 'single' ? 'single' : 'main');
  }
  startDemo();
}

function onHudAction(act) {
  const g = S.game;
  if (!g) return;
  switch (act) {
    case 'resume': S.sound.unlock(); g.resume(); break;
    case 'settings': S.hud.showPause(false); S.overGame = true; showScreen('settings'); break;
    case 'controls': S.hud.showPause(false); S.overGame = true; showScreen('controls'); break;
    case 'quit': g.exit(); break;
    case 'respawn': g.respawn(); break;
    default: break;
  }
}

// ------------------------------------------------------------------ menus

function showScreen(name) {
  for (const s of document.querySelectorAll('#menu .screen')) s.hidden = true;
  const el = $('screen-' + name);
  if (!el) return;
  $('menu').hidden = false;
  $('menu').classList.toggle('over-game', S.overGame);
  el.hidden = false;
  S.screen = name;
  if (name === 'single') refreshWorldList();
  if (name === 'settings') loadSettingsUI();
  if (name === 'multi') {
    $('mp-name').value = S.profile.name;
    $('mp-server').value = S.profile.server || '';
    if (BUILD === 'embedded') {
      setStatus('mp-status', 'Multiplayer needs the full game: download it, run "npm start" and open the address it prints. Singleplayer works right here.', 'err');
      $('btn-connect').disabled = true;
    } else if (BUILD === 'static') {
      $('mp-server').placeholder = 'Server address (required), e.g. 192.168.1.20:3000';
    }
  }
  if (name === 'skin') openSkinScreen(); else closeSkinScreen();
  if (name === 'create') {
    const mode = S.modeFilter || 'survival';
    $('new-world-mode').value = mode;
    $('new-world-name').value = mode === 'survival' ? 'Survival World' : 'Creative World';
    $('new-world-seed').value = '';
    $('new-world-peaceful').checked = false;
    $('peaceful-row').hidden = mode !== 'survival';
    setTimeout(() => $('new-world-name').select(), 0);
  }
  if (name === 'multi') {
    const m = S.profile.mpMode === 'creative' ? 'creative' : 'survival';
    for (const r of document.querySelectorAll('input[name="mp-mode"]')) r.checked = r.value === m;
  }
}

function hideMenu() {
  // Drop focus from the clicked menu button so Space/Enter can't press it again in-game.
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  $('menu').hidden = true;
  closeSkinScreen();
  S.screen = null;
}

// Return from a menu shown on top of the paused game.
function backFromOverlayScreen() {
  if (S.overGame && S.game) {
    S.overGame = false;
    hideMenu();
    S.hud.showPause(true, { multiplayer: S.game.mode === 'multi' });
    return true;
  }
  return false;
}

function setStatus(id, text, cls = '') {
  if (!id) return;
  const e = $(id);
  e.textContent = text || '';
  e.className = 'status ' + cls;
}

function setupMenus() {
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      S.sound.unlock();
      S.sound.click();
      if (go.dataset.filter !== undefined) S.modeFilter = go.dataset.filter || null;
      showScreen(go.dataset.go);
    }
  });
  // Clicking the game canvas while unlocked captures the mouse again.
  $('game').addEventListener('click', () => {
    const g = S.game;
    if (g && g.ready && !g.paused && !g.dead && !S.hud.isInventoryOpen() && !S.hud.isChatOpen()) {
      S.sound.unlock();
      g.input.requestLock();
    }
  });

  // 1. Survival / 2. Creative on the title screen
  for (const card of document.querySelectorAll('.mode-card')) {
    card.addEventListener('click', () => {
      S.sound.unlock();
      S.sound.click();
      chooseMode(card.dataset.mode);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (S.screen !== 'main' || $('menu').hidden || S.game) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.code === 'Digit1' || e.code === 'Numpad1') { S.sound.unlock(); chooseMode('survival'); }
    if (e.code === 'Digit2' || e.code === 'Numpad2') { S.sound.unlock(); chooseMode('creative'); }
  });
  $('btn-create-cancel').addEventListener('click', () => showScreen('single'));
  $('new-world-mode').addEventListener('change', () => {
    $('peaceful-row').hidden = $('new-world-mode').value !== 'survival';
  });

  // Singleplayer
  $('btn-play-world').addEventListener('click', () => { if (S.selectedWorld) playWorld(S.selectedWorld); });
  $('btn-delete-world').addEventListener('click', async () => {
    const id = S.selectedWorld;
    if (!id) return;
    const worlds = await listWorlds();
    const w = worlds.find((x) => x.id === id);
    if (!confirm(`Delete "${w ? w.name : 'this world'}" forever?`)) return;
    await deleteWorld(id);
    S.selectedWorld = null;
    refreshWorldList();
  });
  $('btn-create-world').addEventListener('click', () => createWorld());
  for (const id of ['new-world-name', 'new-world-seed']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') createWorld(); });
  }

  // Multiplayer
  $('btn-connect').addEventListener('click', connectMultiplayer);
  $('mp-server').addEventListener('keydown', (e) => { if (e.key === 'Enter') connectMultiplayer(); });

  // Skin
  const presets = $('skin-presets');
  for (const name of DEFAULT_SKIN_NAMES) {
    const b = document.createElement('button');
    b.textContent = name[0].toUpperCase() + name.slice(1);
    b.dataset.preset = name;
    b.addEventListener('click', () => {
      S.profile.skin = null;
      S.profile.preset = name;
      S.profile.slim = false;
      $('skin-slim').checked = false;
      applySkinChange();
      setStatus('skin-status', 'Default skin selected.', 'ok');
    });
    presets.appendChild(b);
  }
  $('skin-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { dataUrl, slim } = await loadSkinFile(file);
      S.profile.skin = dataUrl;
      S.profile.slim = slim;
      $('skin-slim').checked = slim;
      await applySkinChange();
      setStatus('skin-status', `Skin loaded${slim ? ' (slim arms detected)' : ''}!`, 'ok');
    } catch (err) {
      setStatus('skin-status', err.message, 'err');
    }
  });
  $('skin-slim').addEventListener('change', () => {
    S.profile.slim = $('skin-slim').checked;
    applySkinChange();
  });
  $('btn-skin-save').addEventListener('click', () => {
    const name = sanitizeName($('profile-name').value);
    if (!name) { setStatus('skin-status', 'Please enter a name (letters, numbers, _ or -).', 'err'); return; }
    S.profile.name = name;
    saveProfile(S.profile);
    showScreen('main');
  });

  // Settings
  bindSettings();
  $('btn-settings-done').addEventListener('click', () => { if (!backFromOverlayScreen()) showScreen('main'); });
  $('btn-controls-done').addEventListener('click', () => { if (!backFromOverlayScreen()) showScreen('main'); });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('menu').hidden) return;
    if (S.screen === 'main') return;
    if (backFromOverlayScreen()) return;
    showScreen(S.screen === 'create' ? 'single' : 'main');
  });
}

function sanitizeName(v) {
  return String(v || '').replace(/[^A-Za-z0-9_\- ]/g, '').trim().slice(0, 16);
}

// ------------------------------------------------------------------ worlds

// Title screen choice: jump straight into a world of that mode.
async function chooseMode(mode) {
  if (S.busy) return;
  S.modeFilter = mode;
  const worlds = (await listWorlds()).filter((w) => (w.mode === 'survival' ? 'survival' : 'creative') === mode);
  if (worlds.length === 0) {
    // First time: make a world right away.
    await createWorld({ mode, name: mode === 'survival' ? 'Survival World' : 'Creative World', seed: '' });
  } else {
    showScreen('single');
  }
}

async function refreshWorldList() {
  const list = $('world-list');
  const filter = S.modeFilter;
  const worlds = (await listWorlds()).filter((w) => !filter || (w.mode === 'survival' ? 'survival' : 'creative') === filter);
  $('worlds-title').textContent = filter === 'survival' ? 'Survival Worlds' : filter === 'creative' ? 'Creative Worlds' : 'Select World';
  $('btn-new-world').textContent = filter === 'survival' ? 'New Survival World' : filter === 'creative' ? 'New Creative World' : 'Create New World';
  list.textContent = '';
  $('storage-warning').hidden = isPersistent();
  if (!worlds.some((w) => w.id === S.selectedWorld)) S.selectedWorld = worlds[0] ? worlds[0].id : null;
  if (worlds.length === 0) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = 'No worlds yet – create one!';
    list.appendChild(d);
  }
  for (const w of worlds) {
    const d = document.createElement('div');
    d.className = 'world-item' + (w.id === S.selectedWorld ? ' selected' : '');
    const n = document.createElement('div');
    n.className = 'name';
    n.textContent = w.name;
    const m = document.createElement('div');
    m.className = 'meta';
    const when = w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : 'never';
    m.textContent = `${w.mode === 'survival' ? 'Survival' : 'Creative'}${w.peaceful ? ' (peaceful)' : ''} · Seed ${w.seed} · Last played ${when}`;
    d.append(n, m);
    d.addEventListener('click', () => { S.selectedWorld = w.id; refreshWorldList(); });
    d.addEventListener('dblclick', () => playWorld(w.id));
    list.appendChild(d);
  }
  $('btn-play-world').disabled = !S.selectedWorld;
  $('btn-delete-world').disabled = !S.selectedWorld;
}

// opts (optional): { mode, name, seed, peaceful } instead of the form values.
async function createWorld(opts) {
  if (S.busy) return;
  S.busy = true;
  try {
    const fromForm = !opts || opts instanceof Event;
    const o = fromForm ? {
      mode: $('new-world-mode').value,
      name: $('new-world-name').value,
      seed: $('new-world-seed').value,
      peaceful: $('new-world-peaceful').checked,
    } : opts;
    const mode = o.mode === 'survival' ? 'survival' : 'creative';
    const name = String(o.name || '').trim().slice(0, 32) || 'New World';
    const seed = normalizeSeed(o.seed);
    const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    const rec = {
      id, name, seed, mode, peaceful: mode === 'survival' && !!o.peaceful,
      created: Date.now(), lastPlayed: Date.now(), edits: {}, time: 0.04,
    };
    S.modeFilter = mode;
    await saveWorld(rec);
    S.selectedWorld = id;
    await playWorld(id);
  } finally {
    S.busy = false;
  }
}

async function playWorld(id) {
  const rec = await loadWorld(id);
  if (!rec) { refreshWorldList(); return; }
  await startGame({ mode: 'single', worldRecord: rec });
}

// ------------------------------------------------------------------ multiplayer

async function connectMultiplayer() {
  if (S.busy) return;
  const name = sanitizeName($('mp-name').value);
  if (!name) { setStatus('mp-status', 'Please enter a name (letters, numbers, _ or -).', 'err'); return; }
  if (BUILD === 'embedded') return;
  if (BUILD === 'static' && !$('mp-server').value.trim()) {
    setStatus('mp-status', 'This page has no game server behind it. Enter the address of a computer running "npm start".', 'err');
    return;
  }
  let url;
  try { url = normalizeServerUrl($('mp-server').value); } catch (e) { setStatus('mp-status', e.message, 'err'); return; }
  S.profile.name = name;
  S.profile.server = $('mp-server').value.trim();
  saveProfile(S.profile);
  S.busy = true;
  $('btn-connect').disabled = true;
  setStatus('mp-status', 'Connecting to ' + url + ' …');
  const net = new NetworkClient(url);
  try {
    const skin = S.profile.skin || S.skinCanvas.toDataURL('image/png');
    const picked = document.querySelector('input[name="mp-mode"]:checked');
    const gameMode = picked && picked.value === 'creative' ? 'creative' : 'survival';
    S.profile.mpMode = gameMode;
    saveProfile(S.profile);
    const welcome = await net.connect({ name, skin, slim: S.profile.slim });
    setStatus('mp-status', 'Connected!', 'ok');
    await startGame({ mode: 'multi', net, welcome, gameMode });
  } catch (e) {
    net.close();
    setStatus('mp-status', e.message, 'err');
  } finally {
    S.busy = false;
    $('btn-connect').disabled = false;
  }
}

// ------------------------------------------------------------------ skin screen

let preview = null;

class SkinPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 0.8, 0.1, 50);
    this.camera.position.set(0, 1.1, 4.6);
    this.camera.lookAt(0, 0.95, 0);
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x445533, 1.6));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    this.model = null;
    this.rotY = 0.5;
    this.dragging = false;
    this.running = false;
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.rotY += (e.clientX - this.lastX) * 0.012;
      this.lastX = e.clientX;
    });
    canvas.addEventListener('pointerup', () => { this.dragging = false; });
  }

  setSkin(skinCanvas, slim) {
    if (!this.model) {
      this.model = new PlayerModel(skinCanvas, slim, { castShadow: false });
      this.scene.add(this.model.group);
    } else {
      this.model.setSkin(skinCanvas, slim);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (t) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      if (!this.dragging) this.rotY += dt * 0.5;
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (w && h && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()))) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      if (this.model) {
        this.model.group.rotation.y = this.rotY;
        this.model.animate({ speed: 1.2, dt, pitch: Math.sin(t / 1400) * 0.15, headYaw: Math.sin(t / 1900) * 0.3 });
      }
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }
}

async function openSkinScreen() {
  $('profile-name').value = S.profile.name;
  $('skin-slim').checked = S.profile.slim;
  setStatus('skin-status', '');
  updatePresetButtons();
  try {
    if (!preview) preview = new SkinPreview($('skin-preview'));
    preview.setSkin(S.skinCanvas, S.profile.slim);
    preview.start();
  } catch (e) {
    setStatus('skin-status', 'Preview unavailable: ' + e.message, 'err');
  }
}

function closeSkinScreen() {
  if (preview) preview.stop();
}

function updatePresetButtons() {
  for (const b of $('skin-presets').children) {
    b.classList.toggle('active', !S.profile.skin && b.dataset.preset === S.profile.preset);
  }
}

async function applySkinChange() {
  S.skinCanvas = await currentSkinCanvas();
  saveProfile(S.profile);
  if (preview) preview.setSkin(S.skinCanvas, S.profile.slim);
  updatePresetButtons();
}

// ------------------------------------------------------------------ settings

function bindSettings() {
  const upd = (key, value) => {
    S.settings[key] = value;
    // A manual graphics choice switches the automatic tuning off.
    if (key === 'quality' || key === 'renderDistance') S.settings.autoTuned = true;
    saveSettings(S.settings);
    const target = S.game || S.demo;
    if (target) target.applySettings(S.settings);
    else S.renderer.applySettings(S.settings);
    S.sound.setVolume(S.settings.volume);
    loadSettingsUI();
  };
  $('set-quality').addEventListener('change', (e) => upd('quality', e.target.value));
  $('set-rd').addEventListener('input', (e) => upd('renderDistance', Number(e.target.value)));
  $('set-fov').addEventListener('input', (e) => upd('fov', Number(e.target.value)));
  $('set-sens').addEventListener('input', (e) => upd('sensitivity', Number(e.target.value)));
  $('set-vol').addEventListener('input', (e) => upd('volume', Number(e.target.value)));
  $('set-bob').addEventListener('change', (e) => upd('viewBobbing', e.target.checked));
  $('set-autojump').addEventListener('change', (e) => upd('autoJump', e.target.checked));
  $('set-leaves').addEventListener('change', (e) => upd('fancyLeaves', e.target.checked));
  $('set-invert').addEventListener('change', (e) => upd('invertY', e.target.checked));
  $('set-fps').addEventListener('change', (e) => upd('showFps', e.target.checked));
}

function loadSettingsUI() {
  const s = S.settings;
  $('set-quality').value = s.quality;
  $('set-rd').value = s.renderDistance; $('set-rd-v').textContent = s.renderDistance;
  $('set-fov').value = s.fov; $('set-fov-v').textContent = s.fov;
  $('set-sens').value = s.sensitivity; $('set-sens-v').textContent = s.sensitivity.toFixed(2);
  $('set-vol').value = s.volume; $('set-vol-v').textContent = Math.round(s.volume * 100) + '%';
  $('set-bob').checked = s.viewBobbing;
  $('set-autojump').checked = s.autoJump;
  $('set-leaves').checked = s.fancyLeaves;
  $('set-invert').checked = s.invertY;
  $('set-fps').checked = s.showFps;
}

// Handle for debugging from the browser console (and automated tests).
window.realistis = {
  get game() { return S.game; },
  get demo() { return S.demo; },
  get state() { return S; },
};

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection', e.reason);
});

boot();
