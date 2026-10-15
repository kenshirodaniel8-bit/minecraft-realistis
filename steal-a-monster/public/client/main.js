// STEAL A MONSTER — browser client entry point.
//
// Builds the 3D world from the shared layout, connects to the server,
// predicts local movement, renders everything the server sends, and turns
// input into requests. The server decides every outcome.

import * as THREE from 'three';
import { DECOR_BY_ID } from '#shared/decor.js';
import { CONFIG } from '#shared/config.js';
import { buildWorld, isInsideBase, PLAZA } from '#shared/world.js';
import { REGION_BY_ID, regionIdAt, regionLockReason } from '#shared/regions.js';
import { SPECIES, SPECIES_BY_ID, RARITIES } from '#shared/monsters.js';
import { SWORD_BY_ID } from '#shared/weapons.js';
import { ITEMS, ITEM_BY_ID } from '#shared/items.js';
import { randomId } from '#shared/rng.js';
import { SceneView } from './scene.js';
import { WorldRenderer } from './worldRenderer.js';
import { Input, TouchControls } from './input.js';
import { ThirdPersonCamera } from './camera.js';
import { LocalPlayer } from './player.js';
import { Net } from './net.js';
import { LocalNet } from './localNet.js';
import { Audio } from './audio.js';
import { Effects } from './effects.js';
import { MonstersView, MSTATE } from './monstersView.js';
import { PlayerAvatar, FX } from './playersView.js';
import { BasesView } from './basesView.js';
import { WorldItems } from './worldItems.js';
import { MonsterPreview } from './preview.js';
import { MapRenderer } from './minimap.js';
import { UI, TUTORIAL, fmt } from './ui.js';

const $ = (id) => document.getElementById(id);
const INTERP_DELAY = 120;
const SWATCHES = [0x3a7ae0, 0xe84a5f, 0x3fbf5a, 0xffb02a, 0x9a5ae0, 0x2ac8c8, 0xff7ab8, 0x5a5a6a, 0xffffff, 0x8a5a32];
const TIPS = [
  'Defeating a monster is not enough — you have to pay its recruitment fee!',
  'Lock your base with the red LOCK button, or rivals can walk in and steal your monsters.',
  'Hit a thief with a Boing Glove to make them drop your monster.',
  'Hidden monsters live in caves and secret clearings. Some only come out at night!',
  'LUCKY LUCKY turns the sky gold and fills the world with Lucky Blocks.',
  'Watch for red circles on the ground: dodge with Q!',
  'More players online = a bigger world. Portals in the plaza lead to the expansion islands.',
];

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch { /* storage may be blocked */ }
}

function setTextOnce(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

class App {
  constructor() {
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    this.settings = Object.assign({ quality: this.isTouch ? 'medium' : 'high', volume: 0.6, sensitivity: 1, invertY: false, touch: 'auto', name: '', color: SWATCHES[0] }, loadJSON('sam_settings', {}));
    let token = null;
    try {
      token = localStorage.getItem('sam_token');
      if (!token) {
        token = randomId('t', 30);
        localStorage.setItem('sam_token', token);
      }
    } catch {
      token = randomId('t', 30);
    }
    this.token = token;
    this.canvas = $('game');
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume);
    // SOLO: the web build (scripts/build-web.mjs, e.g. on GitHub Pages) runs
    // the game server inside this page; otherwise connect to the real server
    this.solo = window.SAM_SOLO === true;
    this.net = this.solo ? new LocalNet() : new Net();
    this.actions = this.makeActions();
    this.ready = false;
    this.joined = false;
    this.kicked = false;
    this.profile = null;
    this.baseStates = new Array(12).fill(null);
    this.players = new Map();
    this.events = [];
    this.worldState = null;
    this.radar = { list: [], until: 0 };
    this.clues = [];
    this.lastMoveSent = 0;
    this.nextSwingAt = 0;
    this.attackFaceUntil = 0;
    this.attackYaw = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.myFx = 0;
    this.myCarry = -1;
    this.region = 'plains';
    this.lastBlockedToast = 0;
    this.steal = null;
    this.t = 0;
    this.bindTitle();
  }

  saveSetting(k, v) {
    this.settings[k] = v;
    saveJSON('sam_settings', this.settings);
    if (k === 'volume') this.audio.setVolume(v);
    if (k === 'sensitivity') this.input.sensitivity = v;
    if (k === 'invertY' && this.cam) this.cam.invertY = v;
    if (k === 'touch') this.applyTouch();
    if (k === 'quality' && this.sceneView) {
      this.sceneView.setQuality(v);
      if (this.monsters) this.monsters.setQuality(this.sceneView.quality);
    }
  }

  // ---------------------------------------------------------------- title

  bindTitle() {
    const nameInput = $('name-input');
    nameInput.value = this.settings.name || '';
    const sw = $('color-swatches');
    sw.innerHTML = '';
    for (const c of SWATCHES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = '#' + c.toString(16).padStart(6, '0');
      b.setAttribute('aria-label', 'Outfit color');
      if (c === this.settings.color) b.classList.add('on');
      b.onclick = () => {
        for (const o of sw.children) o.classList.remove('on');
        b.classList.add('on');
        this.saveSetting('color', c);
      };
      sw.appendChild(b);
    }
    $('controls-btn').onclick = () => {
      $('title-status').innerHTML = 'WASD move · Drag mouse or ← → to turn the camera · Click attack · Q dodge · E interact · R recruit · H home · L lasers · 1–8 gadgets';
    };
    const go = () => this.play();
    $('play-btn').onclick = go;
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    if (this.solo) {
      $('title-status').textContent = '🟢 Single-player · runs in your browser · progress is saved on this device';
      return;
    }
    fetch('/health').then((r) => r.json()).then((h) => {
      $('title-status').textContent = `🟢 Server online · ${h.players} player${h.players === 1 ? '' : 's'} playing`;
    }).catch(() => {
      $('title-status').textContent = '🔴 Cannot reach the game server. Start it with "npm start".';
    });
  }

  async play() {
    if (this.starting) return;
    this.starting = true;
    this.audio.unlock();
    const name = ($('name-input').value || '').replace(/[^A-Za-z0-9_ -]/g, '').trim().slice(0, 16) || `Player${Math.floor(Math.random() * 900 + 100)}`;
    this.saveSetting('name', name);
    $('play-btn').disabled = true;
    this.ui = this.ui || new UI(this);
    this.ui.setLoading('Connecting…', 0.05, TIPS[Math.floor(Math.random() * TIPS.length)]);
    try {
      if (!this.net.socket) {
        this.bindNet();
        await this.net.connect();
      }
      const res = await this.net.hello(this.token, name, this.settings.color);
      if (!res || !res.ok) throw new Error(res?.message || 'Could not join the server.');
      this.ui.setLoading('Building the world…', 0.2);
      await new Promise((r) => setTimeout(r, 30));
      if (!this.world) this.buildScene();
      this.ui.setLoading('Waking up the monsters…', 0.9);
      await new Promise((r) => setTimeout(r, 30));
      this.applyWelcome(res);
      this.joined = true;
      this.ready = true;
      this.ui.hideLoading();
      $('title').hidden = true;
      this.ui.show();
      if (res.isNew) {
        this.ui.regionBanner('Welcome to STEAL A MONSTER!', 'You start with 1,000 Money. Follow the quest on the left!');
      } else {
        this.ui.regionBanner(`Welcome back, ${res.profile.name}!`, 'Your monsters missed you.');
      }
      this.applyTouch();
      this.canvas.focus();
      if (!this.loopStarted) {
        this.loopStarted = true;
        this.last = performance.now();
        requestAnimationFrame((t) => this.frame(t));
        setInterval(() => this.net.syncClock(), 5000);
      }
    } catch (e) {
      console.error(e);
      this.ui.hideLoading();
      $('title-status').textContent = `⚠ ${e.message}`;
      $('play-btn').disabled = false;
    } finally {
      this.starting = false;
    }
  }

  applyTouch() {
    const on = this.settings.touch === 'on' || (this.settings.touch === 'auto' && this.isTouch);
    document.body.classList.toggle('touch', on);
    if (on && !this.touch) this.touch = new TouchControls(this.input, $('touch-ui'));
    if (this.touch) this.touch.show(on);
  }

  buildScene() {
    const t0 = performance.now();
    this.world = buildWorld();
    this.sceneView = new SceneView(this.canvas, this.settings.quality);
    const scene = this.sceneView.scene;
    this.worldView = new WorldRenderer(scene, this.world);
    this.worldView.build();
    this.effects = new Effects(scene, this.sceneView.camera);
    this.monsters = new MonstersView(scene, this.world, this.effects, this.audio);
    this.monsters.setQuality(this.sceneView.quality);
    this.basesView = new BasesView(scene, this.world, this.effects, this.audio);
    this.items = new WorldItems(scene, this.world, this.effects, this.audio);
    this.preview = new MonsterPreview();
    this.mapRenderer = new MapRenderer(this.world);
    this.cam = new ThirdPersonCamera(this.sceneView.camera, this.world);
    this.cam.invertY = this.settings.invertY;
    this.player = new LocalPlayer(this.world);
    this.vaultColliders = this.world.colliders.all.filter((c) => c.door);
    console.log(`world built in ${Math.round(performance.now() - t0)} ms`);
  }

  // ---------------------------------------------------------------- welcome & state

  applyWelcome(w) {
    this.pn = w.pn;
    this.myBase = w.baseIndex;
    this.profile = w.profile;
    this.maxHp = w.profile.maxHp;
    this.hp = this.maxHp;
    this.teleportSeq = w.teleportSeq;
    this.dayEpoch = w.dayEpoch;
    this.dayLength = w.dayLength;
    this.events = w.event;
    this.worldState = w.world;
    this.activeRegions = new Set(w.world.active);
    this.player.teleport(w.pos.x, w.pos.y, w.pos.z, w.pos.yaw);
    this.viewBase();
    this.basesView.setMine(this.myBase);
    // reset dynamic things (also used after a reconnect)
    for (const p of this.players.values()) p.dispose();
    this.players.clear();
    this.monsters.clear();
    this.items.clear();
    if (this.me) this.me.dispose();
    this.me = new PlayerAvatar(this.sceneView.scene, this.world, { pn: w.pn, name: w.profile.name, color: w.profile.color, sword: w.profile.sword, cosmetic: w.profile.cosmetics.equipped, level: w.profile.level }, true);
    for (const info of w.players) if (info.pn !== w.pn) this.addPlayer(info);
    for (let i = 0; i < this.baseStates.length; i++) {
      this.baseStates[i] = null;
      this.basesView.apply({ index: i, empty: true });
    }
    for (const b of w.bases) this.onBase(b);
    for (const b of w.lucky) this.items.addBlock(b);
    for (const d of w.dropped) this.items.addDropped(d);
    for (const g of w.traps) this.items.addGround(g);
    this.onPuzzle(w.puzzle);
    this.onWorld(w.world);
  }

  addPlayer(info) {
    if (this.players.has(info.pn)) {
      this.players.get(info.pn).setInfo(info);
      return;
    }
    this.players.set(info.pn, new PlayerAvatar(this.sceneView.scene, this.world, info, false));
  }

  serverNow() {
    return this.net.serverNow();
  }

  progress() {
    const p = this.profile;
    return { level: p.level, swordTier: Math.max(...p.swords.map((id) => SWORD_BY_ID[id]?.tier || 1)) };
  }

  state() {
    const pos = this.player?.pos || { x: 0, z: 0 };
    let nearShop = null;
    if (this.world) {
      for (const sh of this.world.shops) if (Math.hypot(pos.x - sh.x, pos.z - sh.z) < CONFIG.economy.shopRange) nearShop = sh.kind;
    }
    const myBase = this.baseStates[this.myBase];
    const awayIds = new Set((myBase?.monsters || []).filter((m) => m.away).map((m) => m.id));
    const b = this.world?.bases[this.myBase];
    return {
      profile: this.profile,
      hp: this.hp,
      maxHp: this.maxHp,
      serverNow: this.serverNow(),
      bases: this.baseStates,
      myBase: this.myBase,
      region: this.region,
      isNight: this.isNight(),
      fx: this.myFx,
      carrying: this.myCarry >= 0,
      dead: (this.myFx & FX.dead) !== 0,
      nearShop,
      atBase: b ? isInsideBase(b, pos.x, pos.z, 1) : false,
      awayIds,
      events: this.events,
      worldState: this.worldState,
    };
  }

  dayT() {
    if (!this.dayLength) return 0.2;
    const ms = (((this.serverNow() - this.dayEpoch) % this.dayLength) + this.dayLength) % this.dayLength;
    return ms / this.dayLength;
  }

  isNight() {
    const t = this.dayT();
    return t >= 0.68 && t < 0.97;
  }

  // ---------------------------------------------------------------- server events

  bindNet() {
    const n = this.net;
    n.on('snap', (d) => this.onSnap(d));
    n.on('profile', (p) => this.onProfile(p));
    n.on('teleport', (d) => {
      this.teleportSeq = d.seq;
      this.player.teleport(d.x, d.y, d.z, d.yaw);
      if (d.reason === 'home' || d.reason === 'respawn') this.viewBase();
      else if (d.yaw !== undefined) this.cam.yaw = d.yaw + Math.PI;
      if (d.reason === 'home' || d.reason === 'portal' || d.reason === 'respawn') {
        this.audio.play('teleport');
        this.effects.burst(d.x, d.y + 2, d.z, 30, { color: [0x7af0ff, 0xffffff], speed: 6 });
      }
      if (d.message) this.blockedToast(d.message);
    });
    n.on('playerJoined', (info) => {
      this.addPlayer(info);
      this.ui.chat(null, `${info.name} joined the game`);
    });
    n.on('playerLeft', (d) => {
      const p = this.players.get(d.pn);
      if (p) {
        this.ui.chat(null, `${p.info.name} left the game`);
        p.dispose();
        this.players.delete(d.pn);
      }
    });
    n.on('playerInfo', (info) => {
      if (info.pn === this.pn) this.me?.setInfo(info);
      else this.addPlayer(info);
    });
    n.on('base', (b) => this.onBase(b));
    n.on('baseStored', (list) => this.basesView?.setStoredAll(list));
    n.on('swing', (d) => {
      this.players.get(d.pn)?.swing(d.combo);
      this.audio.play('swing', { minGap: 80 });
    });
    n.on('hits', (d) => {
      for (const h of d.hits) this.monsters.onHit(h, d.pn === this.pn);
      if (d.pn === this.pn && d.hits.some((h) => h.crit)) this.cam.addShake(0.4);
    });
    n.on('mAttack', (d) => this.monsters.onAttack(d));
    n.on('mStrike', (d) => this.monsters.onStrike(d));
    n.on('mDefeated', (d) => this.monsters.onDefeated(d));
    n.on('mRecover', (d) => this.monsters.onRecover(d));
    n.on('mGone', (d) => {
      this.monsters.onGone(d);
      if (d.reason === 'recruited' && d.by === this.pn) this.audio.play('recruit');
    });
    n.on('proj', (d) => {
      this.effects.projectile(d, this.serverNow());
      this.audio.play('projectile', { minGap: 120 });
    });
    n.on('projEnd', (d) => this.effects.endProjectile(d.id, d.hit));
    n.on('hurt', (d) => {
      this.hp = d.hp;
      this.maxHp = d.maxHp;
      this.effects.number(`-${d.dmg}`, new THREE.Vector3(this.player.pos.x, this.player.pos.y + 5.5, this.player.pos.z), 'player');
      this.cam.addShake(Math.min(1.2, 0.3 + d.dmg / 40));
      this.audio.play('hurt', { minGap: 120 });
      this.flashScreen();
    });
    n.on('knock', (d) => {
      this.player.knock(d.x, d.z, d.up);
      if (d.by) this.audio.play('bonk');
    });
    n.on('dodged', () => this.effects.number('DODGE!', new THREE.Vector3(this.player.pos.x, this.player.pos.y + 5, this.player.pos.z), 'dodge'));
    n.on('playerDown', (d) => {
      if (d.pn === this.pn) {
        this.hp = 0;
        this.audio.play('defeat', { pitch: 0.6 });
      }
    });
    n.on('playerUp', (d) => {
      if (d.pn === this.pn) this.hp = this.maxHp;
    });
    n.on('recruitOffer', (o) => {
      this.ui.addOffer(o);
      this.audio.play('discover', { minGap: 200 });
    });
    n.on('offerGone', (d) => {
      this.ui.removeOffer(d.monsterId);
      if (d.by) this.ui.toast(`${d.by} recruited it first!`, 'warn');
      else if (d.expired) this.ui.toast('The monster recovered and ran away.', 'warn');
    });
    n.on('reward', (d) => {
      const m = this.monsters.get(d.monsterId);
      const p = m ? m.pos.clone() : new THREE.Vector3(this.player.pos.x, this.player.pos.y + 3, this.player.pos.z);
      p.y += 3;
      this.effects.number(`+${d.xp} XP  +$${d.money}${d.gems ? `  +${d.gems}💎` : ''}`, p, 'money');
      if (d.gems) this.ui.toast(`💎 +${d.gems} Monster Gem${d.gems > 1 ? 's' : ''}!`, 'good');
    });
    n.on('levelUp', (d) => {
      this.ui.regionBanner(`LEVEL ${d.level}!`, 'You are stronger. New regions and swords may be unlocked!');
      this.audio.play('levelup');
      this.effects.confetti(this.player.pos.x, this.player.pos.y + 4, this.player.pos.z, 60);
    });
    n.on('discovery', (d) => {
      if (d.kind === 'region') this.ui.regionBanner(`Discovered: ${d.name}`, REGION_BY_ID[d.id]?.blurb);
      else this.ui.regionBanner(`${d.hidden ? '🔍 Secret found' : '📍 Discovered'}: ${d.name}`, d.reward ? `+${d.reward} Money` : '');
      this.audio.play('discover');
    });
    n.on('toast', (d) => this.ui.toast(d.text, d.kind));
    n.on('announce', (d) => this.ui.announce(d.text, d.kind));
    n.on('chat', (d) => {
      const p = this.players.get(d.pn);
      const c = p ? p.color() : this.profile?.color;
      this.ui.chat(d.name, d.text, '#' + ((c ?? 0xffe14a)).toString(16).padStart(6, '0'));
    });
    n.on('theft', (d) => {
      this.lastTheft = d;
      const msg = {
        grab: `⚠ ${d.thief} is grabbing your ${d.name}! Lock your base!`,
        carry: `🚨 ${d.thief} STOLE your ${d.name}! Stop them before they reach their base!`,
        stolen: `💔 ${d.thief} got away with your ${d.name}…`,
        dropped: `${d.thief} dropped your ${d.name}! Touch it to send it home!`,
        saved: `✅ Your ${d.name} is back home!`,
        safe: `✅ ${d.thief} let go — your ${d.name} is safe.`,
      }[d.stage];
      const ongoing = d.stage === 'grab' || d.stage === 'carry';
      this.ui.theftAlert(msg, ongoing ? 60000 : d.stage === 'saved' || d.stage === 'safe' ? 3000 : 7000);
      if (ongoing) this.audio.play('alarm', { minGap: 2000 });
    });
    n.on('theftInterrupted', (d) => {
      const p = d.pn === this.pn ? this.me : this.players.get(d.pn);
      if (p) this.effects.burst(p.pos.x, p.pos.y + 5, p.pos.z, 20, { color: [0xffe14a, 0xffffff], speed: 6 });
    });
    n.on('dropped', (d) => this.items.addDropped(d));
    n.on('droppedGone', (d) => this.items.removeDropped(d.ownedId, d.home));
    n.on('ground', (g) => this.items.addGround(g));
    n.on('groundGone', (d) => this.items.removeGround(d.id));
    n.on('itemUsed', (d) => this.onItemUsed(d));
    n.on('status', (d) => {
      const text = { frozen: '🧊 You are frozen!', netted: '🥅 Tangled in a net!', trapped: '🕸️ Stuck in a Sticky Trap!', slipping: '🫧 Whoa, slippery!', shield: '🛡️ Bubble Shield up!', speed_boost: '⚡ ZOOM!', detector: '📡 Radar on — rare monsters show on your map' }[d.kind];
      if (text) this.ui.toast(text, ['shield', 'speed_boost', 'detector'].includes(d.kind) ? 'good' : 'bad');
      if (d.kind === 'frozen') this.audio.play('freeze');
    });
    n.on('blocked', () => this.ui.toast('🛡️ Your shield blocked a gadget!', 'good'));
    n.on('collected', (d) => {
      this.audio.play('coin');
      this.effects.coins(this.player.pos.x, this.player.pos.y + 1, this.player.pos.z, 20);
      this.effects.number(`+$${fmt(d.amount)}`, new THREE.Vector3(this.player.pos.x, this.player.pos.y + 5, this.player.pos.z), 'money');
    });
    n.on('luckySpawn', (b) => this.items?.addBlock(b));
    n.on('luckyGone', (d) => this.items?.removeBlock(d.id));
    n.on('luckyOpened', (d) => {
      this.items.removeBlock(d.id, true);
      if (d.pn === this.pn) {
        this.audio.play('lucky');
        this.ui.toast(`${d.kind === 'geode' ? '💎' : '🍀'} ${d.reward.label}`, 'good');
      }
    });
    n.on('event', (ev) => {
      const was = this.events?.find((e) => e.phase === 'active');
      this.events = ev;
      const now = ev.find((e) => e.phase === 'active');
      if (now && !was) {
        this.audio.play('event');
        this.ui.regionBanner('🍀 LUCKY LUCKY! 🍀', 'Lucky Blocks everywhere! Rare monsters are out!');
      }
    });
    n.on('world', (w) => this.onWorld(w));
    n.on('puzzle', (p) => this.onPuzzle(p));
    n.on('time', (d) => { this.dayEpoch = d.dayEpoch; });
    n.on('radar', (d) => { this.radar = d; });
    n.on('clue', (d) => {
      this.clues.push({ ...d, until: performance.now() + 120000 });
      if (this.clues.length > 5) this.clues.shift();
    });
    n.on('milestone', (d) => {
      const extra = [d.gems ? `+${d.gems} 💎` : '', d.decor ? `a ${DECOR_BY_ID[d.decor].name} for your base` : ''].filter(Boolean).join(' · ');
      this.ui.regionBanner(`🏆 ${d.title}!`, `${d.count} different monsters collected · +${fmt(d.reward)} Money${extra ? ` · ${extra}` : ''}`);
      this.audio.play('levelup');
    });
    n.on('kicked', (d) => {
      this.kicked = true;
      $('disc-title').textContent = 'Disconnected';
      $('disc-text').textContent = d.reason;
      $('disconnected').hidden = false;
    });
    n.on('disconnect', () => {
      if (!this.joined || this.kicked) return;
      $('disc-title').textContent = 'Connection lost';
      $('disc-text').textContent = 'Trying to reconnect…';
      $('disconnected').hidden = false;
    });
    n.on('connect', async () => {
      if (!this.joined || this.kicked) return;
      const res = await this.net.hello(this.token, this.settings.name, this.settings.color);
      if (res && res.ok) {
        this.applyWelcome(res);
        $('disconnected').hidden = true;
        this.ui.toast('Reconnected!', 'good');
      } else {
        $('disc-text').textContent = res?.message || 'Could not rejoin.';
      }
    });
  }

  onSnap(d) {
    if (!this.ready) return;
    for (const row of d.p) {
      const pn = row[0];
      if (pn === this.pn) {
        this.myFx = row[9];
        this.hp = Math.round((row[6] / 100) * this.maxHp);
        this.me.effects = row[9];
        this.me.hpPct = row[6];
        this.me.setCarry(row[8]);
        this.me.setFollower(row[10]);
        this.myCarry = row[8];
        continue;
      }
      const p = this.players.get(pn);
      if (p) p.applySnapshot(d.t, row);
    }
    this.monsters.applySnapshot(d.t, d.m);
  }

  onProfile(p) {
    const old = this.profile;
    this.profile = p;
    this.maxHp = p.maxHp;
    if (old && p.money > old.money && p.money - old.money >= 1) this.audio.play('coin', { minGap: 150 });
    if (old && p.tutorial.step > old.tutorial.step && !p.tutorial.done) {
      const step = TUTORIAL[p.tutorial.step];
      if (step) this.ui.toast(`✅ Next: ${step.title}`, 'good');
    }
    if (this.me && old && (old.sword !== p.sword || old.cosmetics.equipped !== p.cosmetics.equipped || old.level !== p.level)) {
      this.me.setInfo({ sword: p.sword, cosmetic: p.cosmetics.equipped, level: p.level });
    }
    this.ui?.refresh();
  }

  onBase(b) {
    this.baseStates[b.index] = b.empty ? null : { ...b, colorHex: Number.isInteger(b.color) ? b.color : [0x3a7ae0, 0xe84a5f, 0x3fbf5a, 0xffb02a, 0x9a5ae0, 0x2ac8c8, 0xff7ab8, 0x5a5a6a][(b.pn || 0) % 8] };
    this.basesView?.apply(b);
    if (b.index === this.myBase) this.ui?.refresh();
  }

  onWorld(w) {
    this.worldState = w;
    this.activeRegions = new Set(w.active);
    this.worldView?.setPortalStates(this.activeRegions, w.minPop);
  }

  onPuzzle(p) {
    this.puzzle = p;
    const open = p.openUntil > this.serverNow();
    for (const c of this.vaultColliders || []) c.enabled = !open;
    this.worldView?.setPuzzleState(p, this.serverNow());
  }

  onItemUsed(d) {
    const src = d.pn === this.pn ? this.me : this.players.get(d.pn);
    if (!src) return;
    const item = ITEM_BY_ID[d.item];
    const color = new THREE.Color(item.color).getHex();
    const tgt = d.target === this.pn ? this.me : d.target !== null ? this.players.get(d.target) : null;
    if (src !== this.me) src.swing(false);
    if (tgt) {
      const a = src.pos;
      const b = tgt.pos;
      for (let i = 0; i <= 10; i++) {
        const k = i / 10;
        this.effects.spawn(a.x + (b.x - a.x) * k, a.y + 3 + (b.y - a.y) * k, a.z + (b.z - a.z) * k, { color: [color, 0xffffff], speed: 1, life: 0.4, grav: 0 });
      }
      this.effects.burst(b.x, b.y + 3, b.z, 18, { color: [color, 0xffffff], speed: 7 });
      this.audio.play(d.item === 'freeze' ? 'freeze' : 'bonk');
    } else if (item.target === 'self') {
      this.effects.burst(src.pos.x, src.pos.y + 2.5, src.pos.z, 20, { color: [color, 0xffffff], speed: 4, up: 1 });
    } else if (item.target === 'player') {
      this.effects.burst(src.pos.x + Math.sin(d.yaw) * 3, src.pos.y + 3, src.pos.z + Math.cos(d.yaw) * 3, 10, { color: [color], speed: 4 });
      this.audio.play('swing');
    }
  }

  flashScreen() {
    document.body.animate([{ boxShadow: 'inset 0 0 0 0 rgba(255,0,40,0)' }, { boxShadow: 'inset 0 0 120px 20px rgba(255,0,40,.55)' }, { boxShadow: 'inset 0 0 0 0 rgba(255,0,40,0)' }], { duration: 350 });
  }

  // Which base tower (and floor) the player is inside, for the camera.
  indoorView() {
    const p = this.player.pos;
    const B = CONFIG.bases;
    for (const b of this.world.bases) {
      if (!isInsideBase(b, p.x, p.z, 0.4)) continue;
      const f = Math.max(0, Math.min(B.floors - 1, Math.floor((p.y - b.y + 0.5) / B.floorHeight)));
      return { base: b, floorY: b.y + f * B.floorHeight, floorHeight: B.floorHeight };
    }
    return null;
  }

  // On-screen 🏠 pointer to your base with the distance (hidden when close).
  // Off-screen (or behind the camera) it sticks to the screen edge and the
  // arrow points the way.
  updateBaseMarker(hide) {
    const el = this.baseMarkerEl || (this.baseMarkerEl = $('base-marker'));
    const b = this.world.bases[this.myBase];
    const p = this.player.pos;
    const dist = b ? Math.hypot(b.x - p.x, b.z - p.z) : 0;
    if (!b || hide || dist < 32) {
      el.hidden = true;
      return;
    }
    const v = (this.tmpMarker || (this.tmpMarker = new THREE.Vector3())).set(b.x, b.y + 10, b.z).project(this.sceneView.camera);
    let x = v.x;
    let y = v.y;
    const behind = v.z > 1;
    if (behind) {
      x = -x;
      y = -y;
    }
    // keep inside the screen, and above the hotbar at the bottom
    const ex = 0.86;
    const top = 0.8;
    const bottom = -0.66;
    const off = behind || Math.abs(x) > ex || y > top || y < bottom;
    if (off) {
      const k = Math.min(ex / Math.max(Math.abs(x), 1e-6), (y >= 0 ? top : -bottom) / Math.max(Math.abs(y), 1e-6));
      x *= k;
      y *= k;
    }
    el.hidden = false;
    el.style.transform = `translate(${((x + 1) / 2) * innerWidth}px, ${((1 - y) / 2) * innerHeight}px) translate(-50%, -50%)`;
    const arrow = el.firstElementChild;
    arrow.hidden = !off;
    if (off) arrow.style.transform = `rotate(${Math.atan2(-y, x)}rad)`;
    setTextOnce(el.lastElementChild, `🏠 ${Math.round(dist)} m`);
  }

  // Camera looking into your base from the door, so you see your pads and
  // monsters (and your character's face) when you arrive.
  viewBase() {
    const b = this.world.bases[this.myBase];
    if (!b) return;
    this.cam.yaw = b.yaw;
    this.cam.pitch = 0.5;
    this.cam.distance = Math.max(this.cam.distance, 18);
    if (this.input) this.input.lastManualLook = performance.now() + 1500; // let it sink in
  }

  blockedToast(text) {
    const now = performance.now();
    if (now - this.lastBlockedToast < 2500) return;
    this.lastBlockedToast = now;
    this.ui.toast(`🚫 ${text}`, 'bad');
    this.audio.play('error');
  }

  // ---------------------------------------------------------------- actions (requests to the server)

  makeActions() {
    const app = this;
    const req = async (type, payload, okText) => {
      const res = await app.net.request(type, payload);
      if (!res.ok) {
        if (res.message && res.error !== 'rate_limited' && res.error !== 'cooldown') app.ui.toast(res.message, 'bad');
        else if (res.error === 'cooldown' && res.message) app.ui.toast(res.message, 'warn');
        if (res.error !== 'cooldown') app.audio.play('error');
      } else if (okText) {
        app.ui.toast(typeof okText === 'function' ? okText(res) : okText, 'good');
      }
      return res;
    };
    return {
      recruit: async (monsterId) => {
        const res = await req('recruit', { monsterId });
        if (res.ok) {
          app.ui.removeOffer(monsterId);
          const sp = SPECIES_BY_ID[res.owned.species];
          app.ui.regionBanner(`${sp.name} joined you! 💖`, `Paid $${fmt(res.price)}. Press H to bring it to your base.`);
        }
      },
      decline: (monsterId) => {
        app.ui.removeOffer(monsterId);
        app.net.request('decline', { monsterId });
      },
      buySword: (swordId) => req('buySword', { swordId }, () => `⚔ You bought the ${SWORD_BY_ID[swordId].name}!`),
      equipSword: (swordId) => req('equipSword', { swordId }),
      buyItem: (itemId, qty = 1) => req('buyItem', { itemId, qty }, `Bought ${ITEM_BY_ID[itemId].name}${qty > 1 ? ` x${qty}` : ''}!`),
      buyUpgrade: (kind) => req('buyUpgrade', { kind }, kind === 'slots' ? '🟢 More monster pads!' : '🔒 Stronger lasers!'),
      buyDecor: (decorId) => req('buyDecor', { decorId }, (r) => `${DECOR_BY_ID[decorId].icon} ${DECOR_BY_ID[decorId].name} ${r.spot >= 0 ? 'placed in your base!' : 'bought (all spots are full)'}`),
      placeDecor: (spot, decorId) => req('placeDecor', { spot, decorId }),
      place: (ownedId, slot) => req('place', { ownedId, slot }),
      unplace: (ownedId) => req('unplace', { ownedId }),
      follow: (ownedId, follow) => req('follow', { ownedId, follow }),
      release: (ownedId) => req('release', { ownedId, confirm: true }, 'Released back into the wild. Bye bye!').then(() => app.ui.close()),
      home: async () => {
        const res = await req('home');
        if (res.ok) app.steal = null;
      },
      lock: () => req('lock', {}, '🔒 Security lasers ON!'),
      useItem: (itemId) => app.useItem(itemId),
      equipCosmetic: (id) => req('equipCosmetic', { id }),
      chat: (text) => app.net.request('chat', { text }).then((r) => { if (!r.ok && r.message) app.ui.toast(r.message, 'bad'); }),
      skipTutorial: () => req('tutorial', { skip: true }),
    };
  }

  useItem(itemId) {
    const item = ITEM_BY_ID[itemId];
    if (!this.profile.items[itemId]) {
      this.ui.toast(`You don't have a ${item.name}. Buy one at the Gadget Shop!`, 'warn');
      return;
    }
    let yaw = this.player.yaw;
    if (item.target === 'player') {
      // aim at the closest rival in front of the camera
      const fwd = this.cam.forward();
      const camYaw = Math.atan2(fwd.x, fwd.z);
      let best = null;
      let bd = item.range + 1;
      for (const p of this.players.values()) {
        const dx = p.pos.x - this.player.pos.x;
        const dz = p.pos.z - this.player.pos.z;
        const d = Math.hypot(dx, dz);
        let diff = Math.atan2(dx, dz) - camYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (d < bd && Math.abs(diff) < 1.2) {
          bd = d;
          best = p;
        }
      }
      yaw = best ? Math.atan2(best.pos.x - this.player.pos.x, best.pos.z - this.player.pos.z) : camYaw;
      this.attackYaw = yaw;
      this.attackFaceUntil = performance.now() + 300;
      this.me.swing(false);
    }
    this.net.request('useItem', { itemId, yaw }).then((res) => {
      if (!res.ok) {
        if (res.message) this.ui.toast(res.message, 'warn');
        return;
      }
      if (res.miss) this.ui.toast('Missed! Get closer and face your target.', 'warn');
      else if (res.blocked) this.ui.toast('Blocked by a shield!', 'warn');
      else if (res.hit) this.ui.toast(`${item.icon} Hit!`, 'good');
    });
  }

  // ---------------------------------------------------------------- movement rules (mirror the server)

  canEnter(x, z) {
    const id = regionIdAt(x, z);
    if (!id) return 'That is the edge of the world.';
    if (id !== this.region) {
      const reason = regionLockReason(REGION_BY_ID[id], this.progress(), this.activeRegions);
      if (reason) return reason;
    }
    const cur = this.player.pos;
    for (const b of this.world.bases) {
      if (b.index === this.myBase) continue;
      const st = this.baseStates[b.index];
      if (!st || !(st.lockedUntil > this.serverNow())) continue;
      if (isInsideBase(b, x, z) && !isInsideBase(b, cur.x, cur.z)) return 'Security lasers are on!';
    }
    if (this.puzzle && !(this.puzzle.openUntil > this.serverNow())) {
      const c = this.world.puzzle.center;
      const inside = (px, pz) => Math.abs(px - c.x) < 10.4 && Math.abs(pz - c.z) < 10.4;
      if (inside(x, z) && !inside(cur.x, cur.z)) return 'The vault door is sealed. Solve the plate puzzle!';
    }
    return true;
  }

  // ---------------------------------------------------------------- attack & interact

  doAttack() {
    const sword = SWORD_BY_ID[this.profile.sword];
    const now = performance.now();
    if (now < this.nextSwingAt) return;
    if (this.myFx & (FX.frozen | FX.stunned | FX.dead | FX.slipping)) return;
    this.nextSwingAt = now + sword.cooldownMs;
    const fwd = this.cam.forward();
    const camYaw = Math.atan2(fwd.x, fwd.z);
    const pos = this.player.pos;
    let target = this.monsters.nearestTarget(pos, camYaw, sword.range + 3.5, 1.35) || this.monsters.nearestTarget(pos, this.player.yaw, sword.range + 1.5, Math.PI);
    let yaw;
    if (target) yaw = Math.atan2(target.pos.x - pos.x, target.pos.z - pos.z);
    else {
      const block = this.items.nearestBlock(pos, 5);
      yaw = block ? Math.atan2(block.data.x - pos.x, block.data.z - pos.z) : this.input.mouseLook ? camYaw : this.player.yaw;
    }
    this.attackYaw = yaw;
    this.attackFaceUntil = now + 350;
    this.player.yaw = yaw;
    this.comboCount = now - (this.lastSwing || 0) < CONFIG.combat.comboWindowMs ? (this.comboCount || 0) + 1 : 1;
    this.lastSwing = now;
    this.me.swing(this.comboCount % 3 === 0);
    this.audio.play('swing');
    this.net.send('attack', { yaw });
  }

  // what pressing E (or R) would do right now
  findInteraction() {
    const pos = this.player.pos;
    const p = this.profile;
    // recruitable monster
    const offerId = this.ui.firstOfferId();
    if (offerId) {
      const m = this.monsters.get(offerId);
      if (m && m.state === MSTATE.defeated && m.pos.distanceTo(new THREE.Vector3(pos.x, m.pos.y, pos.z)) < CONFIG.recruitment.maxDistance) {
        const o = this.ui.offerEls.get(offerId).offer;
        return { kind: 'recruit', key: 'R', text: `Recruit ${m.species.name} for $${fmt(o.price)}`, id: offerId };
      }
    }
    const dropped = this.items.nearestDropped(pos, 4);
    if (dropped) {
      const mine = this.baseStates[this.myBase]?.monsters.some((m) => m.id === dropped.data.ownedId);
      return { kind: 'dropped', key: 'E', text: mine ? `Rescue your ${SPECIES_BY_ID[dropped.data.species].name}` : `Grab ${SPECIES_BY_ID[dropped.data.species].name}`, id: dropped.data.ownedId };
    }
    const block = this.items.nearestBlock(pos, CONFIG.lucky.claimRange - 0.5);
    if (block) return { kind: 'lucky', key: 'E', text: block.geode ? 'Crack open the Gem Geode!' : 'Open the Lucky Block!', id: block.data.id };
    // stealing from a rival base
    for (const b of this.world.bases) {
      if (b.index === this.myBase || !isInsideBase(b, pos.x, pos.z)) continue;
      const st = this.baseStates[b.index];
      if (!st) continue;
      if (st.lockedUntil > this.serverNow()) return null;
      const near = this.basesView.nearestPlaced(pos, CONFIG.stealing.maxDistance - 0.5, this.myBase);
      if (near && near.view.base.index === b.index) {
        if (this.myCarry >= 0) return { kind: 'info', key: '!', text: 'You are already carrying a monster — run to your base!' };
        return { kind: 'steal', key: 'E', text: `Hold to steal ${near.m.species.name}!`, id: near.id };
      }
    }
    for (const sh of this.world.shops) {
      if (Math.hypot(pos.x - sh.x, pos.z - sh.z) < 9) return { kind: 'shop', key: 'E', text: sh.name, panel: sh.kind === 'swords' ? 'swords' : sh.kind === 'items' ? 'items' : 'board' };
    }
    const myB = this.world.bases[this.myBase];
    if (myB && Math.hypot(pos.x - myB.terminal.x, pos.z - myB.terminal.z) < 3.5) return { kind: 'shop', key: 'E', text: 'Base upgrades', panel: 'base' };
    if (myB && isInsideBase(myB, pos.x, pos.z) && p.monsters.some((m) => m.slot === null)) {
      return { kind: 'info', key: 'C', text: 'Open your monsters to place them on pads' };
    }
    return null;
  }

  handleInteraction(dt) {
    const it = this.ui.isOpen() ? null : this.findInteraction();
    const now = performance.now();
    // stealing is a timed hold
    if (this.steal) {
      const s = this.steal;
      const held = this.input.down.has('interact');
      const still = it && it.kind === 'steal' && it.id === s.ownedId;
      if (!held || !still) {
        this.net.send('stealCancel', {});
        this.steal = null;
      } else {
        const k = Math.min(1, (now - s.start) / s.holdMs);
        this.ui.prompt('E', `Stealing… keep holding!`, k);
        if (k >= 1 && !s.confirming) {
          s.confirming = true;
          this.net.request('stealConfirm', { ownedId: s.ownedId }).then((res) => {
            this.steal = null;
            if (res.ok) {
              this.ui.toast('🐾 Got it! Run back to YOUR base before someone stops you!', 'good');
              this.audio.play('grab');
            } else if (res.message) this.ui.toast(res.message, 'bad');
          });
        }
        return;
      }
    }
    if (!it) {
      this.ui.hidePrompt();
    } else {
      this.ui.prompt(it.key, it.text);
    }
    const pressedE = this.input.consumePress('interact');
    const pressedR = this.input.consumePress('recruit');
    if (pressedR) {
      // R always means "recruit the monster on my newest card"
      const offerId = it?.kind === 'recruit' ? it.id : this.ui.firstOfferId();
      if (offerId) this.actions.recruit(offerId);
      else this.ui.toast('Defeat a wild monster first, then press R to pay its fee.', 'warn');
    }
    if (!it) return;
    if (it.kind === 'recruit') {
      if (pressedE) this.actions.recruit(it.id);
      return;
    }
    if (!pressedE) return;
    switch (it.kind) {
      case 'dropped':
        this.net.request('grabDropped', { ownedId: it.id }).then((r) => {
          if (!r.ok && r.message) this.ui.toast(r.message, 'warn');
          else if (r.ok && !r.rescued) this.audio.play('grab');
        });
        break;
      case 'lucky':
        this.net.request('claimLucky', { blockId: it.id }).then((r) => {
          if (!r.ok && r.message) this.ui.toast(r.message, 'warn');
        });
        break;
      case 'steal':
        this.net.request('stealBegin', { ownedId: it.id }).then((r) => {
          if (r.ok) {
            this.steal = { ownedId: it.id, start: performance.now(), holdMs: r.holdMs };
            this.audio.play('grab');
          } else if (r.message) this.ui.toast(r.message, 'bad');
        });
        break;
      case 'shop':
        this.ui.open(it.panel);
        break;
      case 'info':
        if (it.key === 'C') this.ui.open('collection');
        break;
      default:
        break;
    }
  }

  objective() {
    const p = this.profile;
    if (!p || p.tutorial.done) return null;
    const step = TUTORIAL[p.tutorial.step]?.key;
    const b = this.world.bases[this.myBase];
    if (step === 'explore') return { x: 70, z: -40 };
    if (step === 'defeat' || step === 'recruit') {
      let best = null;
      let bd = 200;
      for (const m of this.monsters.map.values()) {
        const d = Math.hypot(m.pos.x - this.player.pos.x, m.pos.z - this.player.pos.z);
        if (d < bd && m.state !== MSTATE.recover) {
          bd = d;
          best = m.pos;
        }
      }
      return best;
    }
    if (step === 'place') return b;
    if (step === 'collect') return b.collector;
    if (step === 'lock') return b.lockPad;
    if (step === 'sword') return this.world.shops.find((s) => s.kind === 'swords');
    return null;
  }

  drawFullMap(canvas) {
    const s = this.mapState();
    this.mapRenderer.drawFull(canvas, s);
  }

  mapState() {
    const now = performance.now();
    this.clues = this.clues.filter((c) => c.until > now);
    return {
      me: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw },
      camYaw: this.cam.yaw,
      bases: this.baseStates,
      myBase: this.myBase,
      lucky: [...this.items.blocks.values()].map((b) => b.data),
      monsters: [...this.monsters.map.values()].filter((m) => !m.gone).map((m) => ({ x: m.pos.x, z: m.pos.z, aggro: (m.flags & 32) !== 0, rare: RARITIES[m.species.rarity].order >= 2 })),
      players: [...this.players.values()].map((p) => ({ x: p.pos.x, z: p.pos.z, carrying: p.carryIdx >= 0 })),
      radar: this.radar.until > this.serverNow() ? this.radar.list : [],
      clues: this.clues,
      progress: this.progress(),
      active: this.activeRegions,
      minPop: this.worldState?.minPop,
      discoveredSpots: this.profile.discoveries.spots,
      objective: this.objective(),
      t: this.t,
    };
  }

  // ---------------------------------------------------------------- frame

  frame(nowMs) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.25, (nowMs - this.last) / 1000);
    this.last = nowMs;
    this.t += dt;
    if (!this.ready) return;
    const t0 = performance.now();
    const input = this.input;
    const serverNow = this.serverNow();
    const renderT = serverNow - INTERP_DELAY;
    const panelOpen = this.ui.isOpen();

    // keys that open things
    if (input.consumePress('menu')) {
      if (panelOpen) this.ui.close();
      else this.ui.open('settings');
    }
    if (input.consumePress('debug')) this.showDebug = !this.showDebug;
    if (!input.typing) {
      if (input.consumePress('chat')) this.ui.openChat();
      if (input.consumePress('collection')) this.ui.toggle('collection');
      if (input.consumePress('map')) this.ui.toggle('map');
      if (input.consumePress('mouselook')) input.toggleMouseLook();
    }
    document.body.classList.toggle('mouselook', input.mouseLook);
    const active = !panelOpen && !input.typing;
    if (active) {
      if (input.consumePress('home')) this.actions.home();
      if (input.consumePress('lock')) this.actions.lock();
      ITEMS.forEach((it, i) => {
        if (input.consumePress(`item${i + 1}`)) this.useItem(it.id);
      });
    }

    // camera input
    const look = active ? input.consumeLook() : (input.consumeLook(), { x: 0, y: 0 });
    const zoom = active ? input.consumeZoom() : 0;

    // local movement
    const fx = this.myFx;
    const dead = (fx & FX.dead) !== 0;
    const p = this.profile;
    let speedMult = 1 + (p.perks?.speed || 0);
    if (fx & FX.slowed) speedMult *= 0.6;
    if (fx & FX.speed) speedMult *= ITEM_BY_ID.speed_boost.speedMultiplier;
    if (this.myCarry >= 0) speedMult *= CONFIG.player.carrySpeedFactor;
    const frozen = dead || (fx & (FX.frozen | FX.rooted)) !== 0;
    const move = active ? input.axis() : { x: 0, z: 0 };
    const fwd = this.cam.forward();
    const camYaw = Math.atan2(fwd.x, fwd.z);
    const faceYaw = performance.now() < this.attackFaceUntil ? this.attackYaw : input.mouseLook ? camYaw : null;
    const wasGrounded = this.player.grounded;
    const jump = active && input.down.has('jump');
    // physics in small sub-steps so slow devices still move correctly
    const moveOpts = {
      sprint: input.down.has('sprint'),
      jump,
      speedMult,
      frozen,
      slipping: (fx & FX.slipping) !== 0,
      canEnter: (x, z) => this.canEnter(x, z),
      resolveDynamic: (pos) => this.basesView.resolveGates(pos, this.myBase),
      faceYaw,
    };
    let blocked = null;
    const steps = Math.ceil(dt / 0.034);
    for (let i = 0; i < steps; i++) blocked = this.player.update(dt / steps, move, fwd, moveOpts) || blocked;
    if (blocked) this.blockedToast(blocked);
    if (wasGrounded && !this.player.grounded && jump && this.player.vel.y > 5) this.audio.play('jump');
    if (active && input.consumePress('dodge') && !frozen) {
      this.net.request('dodge').then((r) => {
        if (r.ok) {
          this.player.startDodge();
          this.me.h.startDodge();
          this.audio.play('dodge');
        }
      });
    }
    if (active && (input.down.has('attack') || input.consumePress('attack')) && !dead) this.doAttack();
    if (active) this.handleInteraction(dt);
    else this.ui.hidePrompt();

    // region change
    const region = regionIdAt(this.player.pos.x, this.player.pos.z);
    if (region && region !== this.region) {
      this.region = region;
      const r = REGION_BY_ID[region];
      this.ui.regionBanner(r.name, r.blurb);
    }

    // send our position ~15 times a second
    const now = performance.now();
    if (now - this.lastMoveSent > 66) {
      this.lastMoveSent = now;
      const pp = this.player.pos;
      this.net.send('move', { x: Math.round(pp.x * 100) / 100, y: Math.round(pp.y * 100) / 100, z: Math.round(pp.z * 100) / 100, yaw: Math.round(this.player.yaw * 1000) / 1000, a: this.player.anim, tp: this.teleportSeq });
    }

    // views
    this.me.setLocal(this.player.pos, this.player.yaw, this.player.anim);
    const everyone = [this.me, ...this.players.values()];
    for (const pl of everyone) pl.update(dt, this.t, renderT, this.effects, everyone.filter((o) => o !== pl).map((o) => o.pos));
    const camPos = this.sceneView.camera.position;
    this.monsters.update(dt, renderT, this.t, camPos, this.player.pos);
    const near = [{ x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z }, ...[...this.players.values()].map((pl) => pl.pos)];
    this.basesView.update(dt, this.t, near, camPos);
    this.items.update(dt, this.t);
    this.effects.update(dt, serverNow);
    this.worldView.update(dt, this.t, camPos);
    if (this.preview) this.preview.update(dt);

    // ← → turn the camera; walking forward slowly swings it behind you
    // (unless you turned it yourself in the last moment)
    if (active) {
      const turn = (input.down.has('camRight') ? 1 : 0) - (input.down.has('camLeft') ? 1 : 0);
      if (turn) {
        this.cam.yaw -= turn * 2.0 * dt;
        input.lastManualLook = performance.now();
      }
      if (!input.mouseLook && move.z > 0.2 && !dead && performance.now() - input.lastManualLook > 1500) {
        let d = this.player.yaw + Math.PI - this.cam.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.cam.yaw += d * Math.min(1, dt * 1.3);
      }
    }
    this.cam.update(dt, this.player.pos, look, zoom, this.indoorView());
    this.updateBaseMarker(panelOpen);
    const lucky = this.events?.some((e) => e.phase === 'active');
    this.sceneView.update(dt, this.t, this.dayT(), this.player.pos, this.region, lucky);
    if (lucky && Math.random() < dt * 6) this.effects.confetti(this.player.pos.x + (Math.random() - 0.5) * 40, this.player.pos.y + 25, this.player.pos.z + (Math.random() - 0.5) * 40, 3);

    // HUD at ~10 Hz
    this.hudT = (this.hudT || 0) + dt;
    if (this.hudT > 0.1) {
      this.hudT = 0;
      const st = this.state();
      this.ui.updateHUD(st);
      this.ui.updateEvent(this.events, serverNow);
      this.worldView.updateBarriers(this.progress(), this.activeRegions);
      this.mapRenderer.drawMini($('minimap'), this.mapState());
      if (this.ui.panelName === 'map') this.drawFullMap($('map-canvas'));
      if (this.puzzle) this.worldView.setPuzzleState(this.puzzle, serverNow);
      const open = this.puzzle && this.puzzle.openUntil > serverNow;
      for (const c of this.vaultColliders) c.enabled = !open;
      this.updateDebug(serverNow);
    }
    const t1 = performance.now();
    // skipRender: automated tests turn drawing off while bots walk long
    // routes on software-rendered browsers (game logic still runs)
    if (!this.skipRender) this.sceneView.render();
    const t2 = performance.now();
    this.jsMs = (this.jsMs || 0) * 0.95 + (t1 - t0) * 0.05;
    this.renderMs = (this.renderMs || 0) * 0.95 + (t2 - t1) * 0.05;
    this.frames = (this.frames || 0) + 1;
    input.endFrame();
  }

  // F3: performance and state overlay
  updateDebug(serverNow) {
    const el = $('debug');
    const now = performance.now();
    if (!this.fpsAt) this.fpsAt = now;
    if (now - this.fpsAt >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt));
      this.frames = 0;
      this.fpsAt = now;
    }
    this.stats = {
      fps: this.fps || 0,
      calls: this.sceneView.renderer.info.render.calls,
      triangles: this.sceneView.renderer.info.render.triangles,
      monsters: this.monsters.map.size,
      players: this.players.size + 1,
      particles: this.effects.mesh.count,
      rtt: Math.round(this.net.rtt),
      jsMs: Math.round(this.jsMs * 10) / 10,
      renderMs: Math.round(this.renderMs * 10) / 10,
    };
    el.hidden = !this.showDebug;
    if (!this.showDebug) return;
    const p = this.player.pos;
    el.textContent = `FPS ${this.stats.fps}  logic ${this.stats.jsMs} ms  render ${this.stats.renderMs} ms  draw calls ${this.stats.calls}  triangles ${this.stats.triangles.toLocaleString()}\n`
      + `monsters ${this.stats.monsters}  players ${this.stats.players}  particles ${this.stats.particles}  ping ${this.stats.rtt} ms\n`
      + `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}  region ${this.region}  day ${(this.dayT() * 24).toFixed(1)}h  quality ${this.settings.quality}`;
    void serverNow;
  }
}

window.addEventListener('error', (e) => console.error('client error', e.message));
const app = new App();
window.__app = app;
