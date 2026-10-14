// All HTML user interface: HUD, prompts, recruit cards, shops, collection,
// Monsterdex, base management, map, settings, chat. Gameplay requests go
// through app.actions (which talk to the server); the UI never changes game
// state on its own.

import { SPECIES, SPECIES_BY_ID, RARITIES, ELEMENTS, PERKS, monsterStats, incomePerSecond, perkValue, recruitPrice, monsterPower } from '#shared/monsters.js';
import { SWORDS, SWORD_BY_ID, swordLockReason, swordDps } from '#shared/weapons.js';
import { ITEMS, ITEM_BY_ID } from '#shared/items.js';
import { REGION_BY_ID, REGIONS } from '#shared/regions.js';
import { COSMETICS, COSMETIC_BY_ID } from '#shared/lucky.js';
import { CONFIG } from '#shared/config.js';
import { DECOR, DECOR_BY_ID, placedCounts } from '#shared/decor.js';
import { SPOTS } from '#shared/world.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.floor(n).toLocaleString('en-US');
const setText = (el, t) => {
  if (el && el.textContent !== t) el.textContent = t;
};

export const TUTORIAL = [
  { key: 'explore', title: 'Explore!', text: 'This is your base! Walk out of it into Greenstarter Plains. Move with WASD, drag the mouse (or use ← →) to turn the camera.', touch: 'This is your base! Walk out of it into Greenstarter Plains. Move with the left stick, drag on the right to turn the camera.' },
  { key: 'defeat', title: 'Battle a monster', text: 'Find a wild monster and click to swing your sword until it is defeated. Watch out for red warning circles!', touch: 'Find a wild monster and tap ⚔ to swing your sword until it is defeated. Watch out for red warning circles!' },
  { key: 'recruit', title: 'Pay to recruit', text: 'Defeating is not enough — pay its fee! Press R or click Recruit on the card.', touch: 'Defeating is not enough — pay its fee! Tap Recruit on the card.' },
  { key: 'place', title: 'Bring it home', text: 'Press H to return to your base. Your new friend hops onto a free pad.', touch: 'Tap 🏠 at the top to return to your base. Your new friend hops onto a free pad.' },
  { key: 'collect', title: 'Collect income', text: 'Monsters on pads earn Money. Step on the gold $ pad in your base to collect it.' },
  { key: 'lock', title: 'Protect your base', text: 'Rivals can steal your monsters! Step on the red LOCK button (or press L) to switch on your lasers.', touch: 'Rivals can steal your monsters! Step on the red LOCK button (or tap 🔒) to switch on your lasers.' },
  { key: 'sword', title: 'Upgrade your sword', text: 'Buy a Stone Sword at the Sword Shop in the plaza. Stronger swords beat tougher monsters.' },
];

function rarityStyle(sp) {
  const r = RARITIES[sp.rarity];
  return `background: linear-gradient(180deg, #fff, ${r.color}55);`;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.offerEls = new Map();
    this.panelName = null;
    this.toastCount = 0;
    this.lastRegion = null;
    $('panel-close').onclick = () => this.close();
    $('panel-wrap').addEventListener('pointerdown', (e) => {
      if (e.target.id === 'panel-wrap') this.close();
    });
    for (const b of document.querySelectorAll('#side-buttons [data-panel]')) {
      b.onclick = () => this.toggle(b.dataset.panel);
    }
    $('home-btn').onclick = () => app.actions.home();
    $('lock-btn').onclick = () => app.actions.lock();
    this.buildHotbar();
    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('chat-input').value.trim();
      if (v) app.actions.chat(v);
      this.closeChat();
    });
  }

  // ------------------------------------------------------------ HUD

  show() {
    $('hud').hidden = false;
  }

  buildHotbar() {
    const bar = $('hotbar');
    bar.innerHTML = '';
    const sword = document.createElement('div');
    sword.className = 'slot sword';
    sword.title = 'Your sword (click to attack)';
    sword.innerHTML = '<span class="n">⚔</span><span id="hb-sword">🗡️</span>';
    sword.onclick = () => this.open('swords');
    bar.appendChild(sword);
    this.slotEls = ITEMS.map((it, i) => {
      const el = document.createElement('div');
      el.className = 'slot empty';
      el.title = `${it.name} (${i + 1})`;
      el.innerHTML = `<span class="n">${i + 1}</span>${it.icon}<span class="c"></span><div class="cd"></div>`;
      el.onclick = () => this.app.actions.useItem(it.id);
      bar.appendChild(el);
      return el;
    });
  }

  updateHUD(s) {
    const p = s.profile;
    if (!p) return;
    setText($('pc-name'), p.name);
    setText($('pc-level'), String(p.level));
    $('xp-fill').style.width = `${p.xpNeed ? Math.min(100, (100 * p.xpInto) / p.xpNeed) : 100}%`;
    const hp = Math.max(0, Math.round(s.hp));
    $('hp-fill').style.width = `${Math.max(0, Math.min(100, (100 * hp) / s.maxHp))}%`;
    $('hp-fill').classList.toggle('low', hp / s.maxHp < 0.3);
    setText($('hp-text'), `${hp} / ${s.maxHp}`);
    const money = fmt(p.money);
    if ($('money-text').textContent !== money) {
      $('money-text').textContent = money;
      const m = $('money');
      m.classList.remove('bump');
      void m.offsetWidth;
      m.classList.add('bump');
    }
    const gemsEl = $('gems');
    gemsEl.hidden = !(p.gems > 0);
    setText($('gems-text'), fmt(p.gems || 0));
    const sword = SWORD_BY_ID[p.sword];
    setText($('sword-name'), sword.name);
    setText($('power-text'), fmt(swordDps(sword) * (1 + (p.perks?.damage || 0)) + p.level * 5));
    // hotbar
    ITEMS.forEach((it, i) => {
      const el = this.slotEls[i];
      const n = p.items[it.id] || 0;
      el.classList.toggle('empty', n <= 0);
      setText(el.querySelector('.c'), it.kind === 'tool' ? (n ? '✓' : '') : n ? `x${n}` : '');
      const ready = p.itemReadyAt?.[it.id] || 0;
      const left = ready - s.serverNow;
      el.querySelector('.cd').style.height = left > 0 ? `${Math.min(100, (100 * left) / it.cooldownMs)}%` : '0';
    });
    // quick buttons
    const homeLeft = (p.homeReadyAt || 0) - s.serverNow;
    setText($('home-cd'), homeLeft > 0 ? ` ${Math.ceil(homeLeft / 1000)}s` : ' Home');
    const base = s.bases[s.myBase];
    const lockLeft = base && base.lockedUntil ? base.lockedUntil - s.serverNow : 0;
    setText($('lock-state'), lockLeft > 0 ? ` ON ${Math.ceil(lockLeft / 1000)}s` : ' OFF');
    $('lock-btn').classList.toggle('on', lockLeft > 0);
    $('lock-btn').classList.toggle('locked', !(lockLeft > 0));
    // region label
    const region = REGION_BY_ID[s.region];
    if (region) setText($('region-label'), `${region.name}${s.isNight ? ' 🌙' : ' ☀'}`);
    // status effects
    const fx = [];
    const F = s.fx;
    if (F & 1) fx.push('🧊 Frozen');
    if (F & 2) fx.push('🕸️ Stuck');
    if (F & 4) fx.push('🐌 Slowed');
    if (F & 8) fx.push('🛡️ Shield');
    if (F & 16) fx.push('⚡ Speed');
    if (F & 128) fx.push('🔥 Burning');
    if (F & 256) fx.push('💫 Stunned');
    if (F & 1024) fx.push('📡 Radar');
    if (s.carrying) fx.push('🐾 Carrying!');
    const fxHtml = fx.map((f) => `<span>${f}</span>`).join('');
    if ($('status-fx').innerHTML !== fxHtml) $('status-fx').innerHTML = fxHtml;
    this.updateQuest(p);
    this.updateOffers(s.serverNow, p);
    $('dead').hidden = !s.dead;
  }

  updateQuest(p) {
    const q = $('quest');
    if (p.tutorial.done || this.questHidden) {
      q.hidden = true;
      return;
    }
    const step = TUTORIAL[p.tutorial.step];
    if (!step) {
      q.hidden = true;
      return;
    }
    const touch = document.body.classList.contains('touch');
    const key = `${p.tutorial.step}|${touch}`;
    if (q.dataset.key !== key) {
      q.dataset.key = key;
      q.innerHTML = `<h3>📜 ${step.title}</h3><div>${esc((touch && step.touch) || step.text)}</div>
        <div class="steps">${TUTORIAL.map((_, i) => `<i class="${i < p.tutorial.step ? 'done' : ''}"></i>`).join('')}</div>
        <button class="btn sm ghost" id="quest-skip">Skip tutorial</button>`;
      $('quest-skip').onclick = () => this.app.actions.skipTutorial();
    }
    q.hidden = false;
  }

  // ------------------------------------------------------------ messages

  toast(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 3700);
  }

  announce(text, kind = '') {
    const el = document.createElement('div');
    el.className = kind;
    el.textContent = text;
    const box = $('announce');
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => el.remove(), 5100);
  }

  regionBanner(title, sub) {
    const el = $('region-banner');
    el.hidden = false;
    el.innerHTML = `<b>${esc(title)}</b><i>${esc(sub || '')}</i>`;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => { el.hidden = true; }, 3600);
  }

  // holdMs: how long the alert stays up (a theft in progress stays until it
  // is resolved, with a long safety timeout)
  theftAlert(text, holdMs = 7000) {
    const el = $('theft-alert');
    clearTimeout(this.theftT);
    if (!text) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = text;
    this.theftT = setTimeout(() => { el.hidden = true; }, holdMs);
  }

  updateEvent(events, serverNow) {
    const el = $('event-banner');
    const e = events?.find((x) => x.phase === 'announce' || x.phase === 'active');
    if (!e) {
      const next = events?.[0];
      el.hidden = true;
      return next;
    }
    el.hidden = false;
    if (e.phase === 'announce') {
      el.classList.add('soon');
      setText(el, `🍀 ${e.name} starts in ${Math.max(0, Math.ceil((e.startsAt - serverNow) / 1000))}…`);
    } else {
      el.classList.remove('soon');
      const left = Math.max(0, Math.ceil((e.endsAt - serverNow) / 1000));
      setText(el, `🍀 ${e.name}! Open Lucky Blocks! ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
    }
    return e;
  }

  prompt(key, text, progress = null) {
    const el = $('prompt');
    el.hidden = false;
    setText($('prompt-key'), key);
    setText($('prompt-text'), text);
    el.classList.toggle('holding', progress !== null);
    if (progress !== null) $('prompt-progress').style.width = `${Math.round(progress * 100)}%`;
  }

  hidePrompt() {
    $('prompt').hidden = true;
  }

  chat(name, text, color = '#ffe14a') {
    const log = $('chat-log');
    const el = document.createElement('div');
    el.innerHTML = name ? `<b style="color:${color}">${esc(name)}:</b> ${esc(text)}` : `<i>${esc(text)}</i>`;
    log.appendChild(el);
    while (log.children.length > 8) log.firstChild.remove();
  }

  openChat() {
    $('chat-form').hidden = false;
    $('chat').classList.add('open');
    this.app.input.typing = true;
    setTimeout(() => $('chat-input').focus(), 0);
  }

  closeChat() {
    $('chat-input').value = '';
    $('chat-form').hidden = true;
    $('chat').classList.remove('open');
    this.app.input.typing = false;
    $('chat-input').blur();
    document.getElementById('game').focus();
  }

  // ------------------------------------------------------------ recruit offers

  addOffer(o) {
    this.removeOffer(o.monsterId);
    const sp = SPECIES_BY_ID[o.species];
    const r = RARITIES[sp.rarity];
    const el = document.createElement('div');
    el.className = 'offer';
    el.style.borderColor = r.color;
    const perk = PERKS[o.perk.kind];
    el.innerHTML = `
      <div class="rar" style="color:${r.color}">${r.name} · ${ELEMENTS[sp.element].icon} ${ELEMENTS[sp.element].name}</div>
      <h3>${esc(sp.name)} <small>Lv ${o.level}</small></h3>
      <canvas></canvas>
      <div class="stats"><span>❤ HP ${fmt(o.stats.hp)}</span><span>⚔ ATK ${o.stats.atk}</span><span>🛡 DEF ${o.stats.def}</span><span>💨 SPD ${o.stats.speed}</span></div>
      <div class="perk">💰 $${o.income}/s · ✨ ${esc(perk.name)}: ${esc(perk.text(o.perk.value))}</div>
      <div class="price"></div>
      ${o.requirement ? `<div class="req">🔐 ${esc(o.requirement)}</div>` : ''}
      <div class="note"></div>
      <div class="row"><button class="btn go rec">Recruit (R)</button><button class="btn ghost dec">Let go</button></div>
      <div class="timer"></div>`;
    $('offers').prepend(el);
    el.querySelector('.rec').onclick = () => this.app.actions.recruit(o.monsterId);
    el.querySelector('.dec').onclick = () => this.app.actions.decline(o.monsterId);
    const view = this.app.preview.attach(el.querySelector('canvas'), o.species, { pose: 'idle', spin: 0.8 });
    view.st.pose = 'quirk';
    view.st.quirk = sp.personality.idles[0];
    this.offerEls.set(o.monsterId, { el, offer: o, view, total: o.deadline - this.app.serverNow() });
    while (this.offerEls.size > 3) this.removeOffer(this.offerEls.keys().next().value);
    this.layoutOffers();
  }

  removeOffer(id) {
    const e = this.offerEls.get(id);
    if (!e) return;
    this.app.preview.detach(e.view);
    e.el.remove();
    this.offerEls.delete(id);
    this.layoutOffers();
  }

  // The newest offer (the one R recruits) is a full card on top; older ones
  // collapse to a compact row so several offers don't cover the screen.
  layoutOffers() {
    const newest = this.firstOfferId();
    for (const [id, e] of this.offerEls) {
      e.el.classList.toggle('mini', id !== newest);
      setText(e.el.querySelector('.rec'), id === newest ? 'Recruit (R)' : 'Recruit');
    }
  }

  updateOffers(serverNow, p) {
    for (const [id, e] of this.offerEls) {
      const o = e.offer;
      const left = o.deadline - serverNow;
      if (left <= -500) {
        this.removeOffer(id);
        continue;
      }
      e.el.querySelector('.timer').style.width = `${Math.max(0, (100 * left) / Math.max(1, e.total))}%`;
      const price = e.el.querySelector('.price');
      const disc = o.discount > 0 ? ` <s style="opacity:.5">$${fmt(o.basePrice)}</s>` : '';
      const html = `Fee: <span style="color:${p.money >= o.price ? '#2a8a2a' : '#c0303a'}">$${fmt(o.price)}</span>${disc}`;
      if (price.innerHTML !== html) price.innerHTML = html;
      let note = '';
      const btn = e.el.querySelector('.rec');
      if (o.requirementMissing) note = o.requirementMissing;
      else if (p.money < o.price) note = `You need $${fmt(o.price - p.money)} more. Collect income at your base!`;
      else if (p.monsters.length >= p.base.slots) note = 'Your base is full! Upgrade it or release a monster.';
      else if (o.priorityUntil && serverNow < o.priorityUntil) note = `The top fighter has first pick (${Math.ceil((o.priorityUntil - serverNow) / 1000)}s)`;
      setText(e.el.querySelector('.note'), note);
      btn.disabled = !!o.requirementMissing || p.money < o.price || p.monsters.length >= p.base.slots;
    }
  }

  firstOfferId() {
    return this.offerEls.size ? [...this.offerEls.keys()].pop() : null;
  }

  // ------------------------------------------------------------ panels

  isOpen() {
    return this.panelName !== null;
  }

  toggle(name, arg) {
    if (this.panelName === name) this.close();
    else this.open(name, arg);
  }

  open(name, arg) {
    this.panelName = name;
    this.panelArg = arg;
    $('panel-wrap').hidden = false;
    this.app.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.render();
    this.app.audio.play('click');
  }

  close() {
    this.panelName = null;
    $('panel-wrap').hidden = true;
    $('panel-body').innerHTML = '';
    this.app.input.enabled = true;
    document.getElementById('game').focus();
  }

  refresh() {
    // don't rebuild the panel under an open dropdown
    const focused = document.activeElement;
    if (focused && focused.tagName === 'SELECT' && $('panel-body').contains(focused)) return;
    if (this.panelName && !['map', 'settings', 'inspect', 'help'].includes(this.panelName)) this.render(true);
    if (this.panelName === 'inspect') this.renderInspectInfo();
  }

  render(keepScroll) {
    const body = $('panel-body');
    const scroll = body.scrollTop;
    const title = $('panel-title');
    const name = this.panelName;
    const s = this.app.state();
    if (!s.profile) return;
    if (name === 'collection') {
      title.textContent = '🐾 My Monsters';
      body.innerHTML = this.collectionHtml(s);
    } else if (name === 'codex') {
      title.textContent = '📖 Monsterdex';
      body.innerHTML = this.codexHtml(s);
    } else if (name === 'swords') {
      title.textContent = '⚔ Sword Shop';
      body.innerHTML = this.swordsHtml(s);
    } else if (name === 'items') {
      title.textContent = '🥊 Gadget Shop';
      body.innerHTML = this.itemsHtml(s);
    } else if (name === 'base') {
      title.textContent = '🏠 My Base';
      body.innerHTML = this.baseHtml(s);
    } else if (name === 'board') {
      title.textContent = '🍀 Lucky Board';
      body.innerHTML = this.boardHtml(s);
    } else if (name === 'map') {
      title.textContent = '🗺 World Map';
      body.innerHTML = '<canvas id="map-canvas" width="900" height="900"></canvas><p class="muted small" style="text-align:center">Yellow = you · Blue = other players · Squares = bases · Dots = discovered places · Dark = locked</p>';
      const mc = $('map-canvas');
      const px = Math.round(mc.clientWidth * Math.min(2, window.devicePixelRatio || 1));
      if (px > 0) mc.width = mc.height = px;
      this.app.drawFullMap(mc);
    } else if (name === 'settings') {
      title.textContent = '⚙ Settings';
      body.innerHTML = this.settingsHtml(s);
      this.bindSettings();
    } else if (name === 'help') {
      title.textContent = '⌨ Controls';
      body.innerHTML = helpHtml();
    } else if (name === 'inspect') {
      title.textContent = '🔍 Monster';
      this.renderInspect(s);
      return;
    }
    this.bind(body);
    if (keepScroll) body.scrollTop = scroll;
  }

  // delegate clicks on [data-act]
  bind(body) {
    for (const el of body.querySelectorAll('select[data-decor-spot]')) {
      el.onchange = () => this.app.actions.placeDecor(Number(el.dataset.decorSpot), el.value || null);
    }
    for (const el of body.querySelectorAll('[data-act]')) {
      el.onclick = (e) => {
        e.stopPropagation();
        const a = el.dataset;
        const acts = this.app.actions;
        switch (a.act) {
          case 'buySword': acts.buySword(a.id); break;
          case 'equipSword': acts.equipSword(a.id); break;
          case 'buyItem': acts.buyItem(a.id, Number(a.qty || 1)); break;
          case 'upgrade': acts.buyUpgrade(a.kind); break;
          case 'buyDecor': acts.buyDecor(a.id); break;
          case 'inspectOwned': this.open('inspect', { owned: a.id }); break;
          case 'inspectSpecies': this.open('inspect', { species: a.id }); break;
          case 'tab': this.tab = a.tab; this.render(); break;
          case 'hat': acts.equipCosmetic(a.id === 'none' ? null : a.id); break;
          case 'open': this.open(a.panel); break;
          default: break;
        }
      };
    }
  }

  collectionHtml(s) {
    const p = s.profile;
    const ms = [...p.monsters].sort((a, b) => (RARITIES[SPECIES_BY_ID[b.species].rarity].order - RARITIES[SPECIES_BY_ID[a.species].rarity].order) || b.level - a.level);
    const cards = ms.map((m) => {
      const sp = SPECIES_BY_ID[m.species];
      const r = RARITIES[sp.rarity];
      const status = s.awayIds.has(m.id) ? '⚠ Being stolen!' : m.slot !== null ? `On pad ${m.slot + 1}` : m.following ? 'Following you' : 'Not placed';
      return `<div class="card" data-act="inspectOwned" data-id="${esc(m.id)}">
        <div class="tag" style="background:${r.color}">${r.name}</div>
        <div class="icon" style="${rarityStyle(sp)}"><img alt="" src="${this.app.preview.icon(sp.id)}"></div>
        <h4>${esc(sp.name)} <small>Lv ${m.level}</small></h4>
        <div class="sub">$${incomePerSecond(sp, m.level)}/s · ${status}</div>
        ${m.origin === 'stolen' ? `<div class="sub">🦹 Stolen from ${esc(m.stolenFrom || '?')}</div>` : ''}
      </div>`;
    }).join('');
    return `<p><b>${p.monsters.length} / ${p.base.slots}</b> monsters · Income <b>$${p.income}/s</b> · <span class="muted">Recruit more in the wild, then bring them to your base.</span></p>
      <div class="grid">${cards || '<p class="muted">No monsters yet! Defeat a wild monster and pay its fee to recruit it.</p>'}</div>`;
  }

  codexHtml(s) {
    const p = s.profile;
    const seen = p.discoveries.species;
    const owned = new Set(p.monsters.map((m) => m.species));
    const n = Object.keys(seen).length;
    const cards = SPECIES.map((sp) => {
      const known = !!seen[sp.id] || owned.has(sp.id);
      const r = RARITIES[sp.rarity];
      const where = sp.spawn.spot ? `Hidden: ${SPOTS.find((x) => x.id === sp.spawn.spot)?.region ? REGION_BY_ID[SPOTS.find((x) => x.id === sp.spawn.spot).region].name : '?'}` : sp.spawn.event ? 'LUCKY LUCKY event' : REGION_BY_ID[sp.spawn.regions[0]].name;
      return `<div class="card ${known ? '' : 'unknown'}" ${known ? `data-act="inspectSpecies" data-id="${sp.id}"` : ''}>
        <div class="tag" style="background:${r.color}">${r.name}</div>
        <div class="icon" style="${known ? rarityStyle(sp) : 'background:#e8e0f5'}"><img alt="" src="${this.app.preview.icon(sp.id)}"></div>
        <h4>${known ? esc(sp.name) : '???'}</h4>
        <div class="sub">${known ? esc(sp.title) : `📍 ${esc(where)}`}${sp.spawn.time === 'night' ? ' 🌙' : sp.spawn.time === 'day' ? ' ☀' : ''}</div>
      </div>`;
    }).join('');
    return `<p>Discovered <b>${n} / ${SPECIES.length}</b> monsters. Defeat a monster to add it to your Monsterdex.</p><div class="grid">${cards}</div>`;
  }

  swordsHtml(s) {
    const p = s.profile;
    const near = s.nearShop === 'swords';
    const rows = SWORDS.map((w) => {
      const owned = p.swords.includes(w.id);
      const lock = swordLockReason(w, p);
      const equipped = p.sword === w.id;
      let btn;
      if (equipped) btn = '<button class="btn sm" disabled>Equipped</button>';
      else if (owned) btn = `<button class="btn sm blue" data-act="equipSword" data-id="${w.id}">Equip</button>`;
      else if (lock) btn = `<button class="btn sm" disabled>🔒 ${esc(lock)}</button>`;
      else btn = `<button class="btn sm go" data-act="buySword" data-id="${w.id}" ${p.money < w.price || (p.gems || 0) < (w.gems || 0) || !near ? 'disabled' : ''}>Buy $${fmt(w.price)}${w.gems ? ` + ${w.gems}💎` : ''}</button>`;
      const sp = w.special ? specialText(w.special) : '';
      return `<div class="row-item ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''}">
        <div class="icon" style="background:#${w.colors.blade.toString(16).padStart(6, '0')}33"><img alt="" style="width:60px;height:60px" src="${this.app.preview.swordIcon(w.id)}"></div>
        <div class="info"><h4>T${w.tier} · ${esc(w.name)}</h4><p>${esc(w.description)}</p>
          <div class="stats-row"><span>⚔ ${w.damage} dmg</span><span>⏱ ${(1000 / w.cooldownMs).toFixed(1)}/s</span><span>📏 ${w.range}</span><span>🎯 ${w.maxTargets} target${w.maxTargets > 1 ? 's' : ''}</span><span>DPS ${swordDps(w)}</span>${sp ? `<span>✨ ${sp}</span>` : ''}</div>
        </div>${btn}</div>`;
    }).join('');
    return `${near ? '' : '<p class="note">📍 You can look, but you buy at the Sword Shop in the central plaza.</p>'}${rows}`;
  }

  itemsHtml(s) {
    const p = s.profile;
    const near = s.nearShop === 'items';
    const rows = ITEMS.map((it, i) => {
      const n = p.items[it.id] || 0;
      const full = n >= it.maxStack;
      const btns = it.kind === 'tool'
        ? (n ? '<button class="btn sm" disabled>Owned ✓</button>' : `<button class="btn sm go" data-act="buyItem" data-id="${it.id}" ${p.money < it.price || !near ? 'disabled' : ''}>Buy $${fmt(it.price)}</button>`)
        : `<div style="display:flex;flex-direction:column;gap:4px"><button class="btn sm go" data-act="buyItem" data-id="${it.id}" data-qty="1" ${p.money < it.price || full || !near ? 'disabled' : ''}>Buy 1 · $${fmt(it.price)}</button><button class="btn sm go" data-act="buyItem" data-id="${it.id}" data-qty="5" ${p.money < it.price * 5 || n + 5 > it.maxStack || !near ? 'disabled' : ''}>Buy 5 · $${fmt(it.price * 5)}</button></div>`;
      const stats = [`⏱ ${it.cooldownMs / 1000}s cooldown`];
      if (it.range) stats.push(`📏 ${it.range} range`);
      if (it.durationMs) stats.push(`⌛ ${it.durationMs / 1000}s`);
      return `<div class="row-item ${n ? 'owned' : ''}">
        <div class="icon" style="background:${it.color}33">${it.icon}</div>
        <div class="info"><h4>[${i + 1}] ${esc(it.name)} ${it.kind === 'consumable' ? `<small>x${n}/${it.maxStack}</small>` : ''}</h4><p>${esc(it.description)}</p>
        <div class="stats-row">${stats.map((x) => `<span>${x}</span>`).join('')}</div></div>${btns}</div>`;
    }).join('');
    return `${near ? '' : '<p class="note">📍 Buy gadgets at the Gadget Shop in the central plaza.</p>'}<p class="muted small">Use gadgets with keys 1–8 (or tap the hotbar). They affect other players, not wild monsters — hit a thief carrying your monster to make them drop it!</p>${rows}`;
  }

  baseHtml(s) {
    const p = s.profile;
    const base = s.bases[s.myBase];
    const atBase = s.atBase;
    const slotsUp = CONFIG.bases.slotUpgrades.find((u) => u.slots > p.base.slots);
    const laserLvl = p.base.laserLevel;
    const laserPrice = CONFIG.security.laserUpgradePrices[laserLvl];
    const laserGems = CONFIG.security.laserUpgradeGems[laserLvl] || 0;
    const durations = CONFIG.security.lockDurationsSec;
    const lockLeft = base && base.lockedUntil ? Math.max(0, Math.ceil((base.lockedUntil - s.serverNow) / 1000)) : 0;
    const perks = Object.entries(p.perks || {}).filter(([, v]) => v > 0).map(([k, v]) => `<span>${esc(PERKS[k].name)}: ${esc(PERKS[k].text(v))}</span>`).join('');
    const pads = Array.from({ length: CONFIG.bases.maxSlots }, (_, i) => {
      const m = p.monsters.find((x) => x.slot === i);
      if (i >= p.base.slots) return '<div class="card locked"><div class="icon" style="background:#ddd">🔒</div><h4>Locked pad</h4><div class="sub">Upgrade to unlock</div></div>';
      if (!m) return `<div class="card"><div class="icon" style="background:#f1e9ff">➕</div><h4>Pad ${i + 1}</h4><div class="sub">Empty</div></div>`;
      const sp = SPECIES_BY_ID[m.species];
      return `<div class="card" data-act="inspectOwned" data-id="${esc(m.id)}"><div class="icon" style="${rarityStyle(sp)}"><img alt="" src="${this.app.preview.icon(sp.id)}"></div><h4>${esc(sp.name)}</h4><div class="sub">Pad ${i + 1} · $${incomePerSecond(sp, m.level)}/s</div></div>`;
    }).join('');
    return `
      <div class="kv"><b>Income</b><span>$${p.income}/s (collect it on the gold $ pad)</span>
        <b>Waiting to collect</b><span>$${fmt(p.storedIncome)}</span>
        <b>Monster pads</b><span>${p.base.slots} / ${CONFIG.bases.maxSlots}</span>
        <b>Lasers</b><span>${lockLeft ? `🟢 ON for ${lockLeft}s` : '🔴 OFF — your monsters can be stolen!'} (lasts ${durations[laserLvl]}s)</span></div>
      ${perks ? `<div class="stats-row" style="margin-bottom:10px">${perks}</div>` : ''}
      ${atBase ? '' : '<p class="note">📍 Upgrades are bought at your base terminal. Press H to go home.</p>'}
      <div class="row-item"><div class="icon" style="background:#e8ffe0">🟢</div><div class="info"><h4>More monster pads</h4><p>${slotsUp ? `${p.base.slots} → ${slotsUp.slots} pads (requires Level ${slotsUp.level})` : 'Fully upgraded!'}</p></div>
        ${slotsUp ? `<button class="btn sm go" data-act="upgrade" data-kind="slots" ${!atBase || p.money < slotsUp.price || (p.gems || 0) < (slotsUp.gems || 0) || p.level < slotsUp.level ? 'disabled' : ''}>$${fmt(slotsUp.price)}${slotsUp.gems ? ` + ${slotsUp.gems}💎` : ''}</button>` : ''}</div>
      <div class="row-item"><div class="icon" style="background:#ffe0e3">🔒</div><div class="info"><h4>Stronger lasers</h4><p>${laserPrice ? `Lasers last ${durations[laserLvl]}s → ${durations[laserLvl + 1]}s` : 'Fully upgraded!'}</p></div>
        ${laserPrice ? `<button class="btn sm go" data-act="upgrade" data-kind="laser" ${!atBase || p.money < laserPrice || (p.gems || 0) < laserGems ? 'disabled' : ''}>$${fmt(laserPrice)}${laserGems ? ` + ${laserGems}💎` : ''}</button>` : ''}</div>
      <h3>Pads</h3><div class="grid">${pads}</div>
      ${this.decorHtml(s)}`;
  }

  // Decorations: what is on each wall spot, and the catalog to buy from.
  decorHtml(s) {
    const p = s.profile;
    const atBase = s.atBase;
    const owned = p.decor?.owned || {};
    const placed = p.base.decor || [];
    const counts = placedCounts(placed);
    const ownedIds = DECOR.filter((d) => owned[d.id]);
    const spots = placed.map((id, i) => {
      const options = ['<option value="">— empty —</option>'].concat(ownedIds.map((d) => {
        const free = (owned[d.id] || 0) - (counts[d.id] || 0) + (id === d.id ? 1 : 0);
        return `<option value="${d.id}" ${id === d.id ? 'selected' : ''}>${d.icon} ${esc(d.name)}${free <= 0 ? ' (move here)' : ''}</option>`;
      })).join('');
      return `<label class="decor-spot"><span>${i % 2 ? 'Right' : 'Left'} wall ${Math.floor(i / 2) + 1}</span><select data-decor-spot="${i}" ${atBase ? '' : 'disabled'}>${options}</select></label>`;
    }).join('');
    const shop = DECOR.map((d) => {
      const n = owned[d.id] || 0;
      let btn;
      if (d.milestone) btn = `<button class="btn sm" disabled>${n ? 'Earned ✓' : '🏆 Milestone'}</button>`;
      else btn = `<button class="btn sm go" data-act="buyDecor" data-id="${d.id}" ${!atBase || p.money < d.price || (p.gems || 0) < d.gems ? 'disabled' : ''}>$${fmt(d.price)}${d.gems ? ` + ${d.gems}💎` : ''}</button>`;
      return `<div class="row-item ${n ? 'owned' : ''}"><div class="icon" style="background:#fff3d8">${d.icon}</div><div class="info"><h4>${esc(d.name)} ${n ? `<small>x${n}</small>` : ''}</h4><p>${esc(d.desc)}</p></div>${btn}</div>`;
    }).join('');
    return `<h3>Decorations</h3>
      <p class="muted small">Show off your base! Everyone who visits sees your decorations. ${atBase ? '' : '<b>Go to your base (H) to buy or move them.</b>'}</p>
      <div class="decor-spots">${spots}</div>
      ${shop}`;
  }

  boardHtml(s) {
    const e = s.events?.[0];
    let status = '';
    if (e) {
      if (e.phase === 'active') status = `🍀 <b>${e.name} is ON!</b> Ends in ${Math.ceil((e.endsAt - s.serverNow) / 1000)}s`;
      else if (e.phase === 'announce') status = `Starting in ${Math.ceil((e.startsAt - s.serverNow) / 1000)}s!`;
      else status = `Next ${e.name} in about ${Math.max(1, Math.ceil((e.nextAt - s.serverNow) / 60000))} min`;
    }
    const w = s.worldState;
    const islands = REGIONS.filter((r) => r.expansion).map((r) => `<span>${esc(r.name)}: ${w?.active?.includes(r.id) ? '🟢 open' : `🔒 needs ${w?.minPop?.[r.id] ?? r.minPopulation}+ players`}</span>`).join('');
    return `<div class="kv"><b>LUCKY LUCKY</b><span>${status}</span><b>Players online</b><span>${w?.population ?? 1}</span><b>Monster capacity</b><span>${w?.monsterCap ?? '-'}</span></div>
      <div class="stats-row">${islands}</div>
      <p>Lucky Blocks hide all over the world. Walk up and swing at one (or press E) to open it! Rewards: Money, XP, gadgets, new swords, hats, recruit coupons, and clues to rare monsters.</p>
      <p>During <b>LUCKY LUCKY</b> the sky turns gold, dozens of Lucky Blocks appear near players, rare monsters show up 3× more often and the lucky cat <b>Luckitty</b> roams the world.</p>
      <p>The world grows when more players are online: the portals next to this board open <b>Bloomveil Isle</b> and <b>Starfall Isle</b>.</p>`;
  }

  settingsHtml(s) {
    const st = this.app.settings;
    const p = s.profile;
    const hats = ['<button class="btn sm ' + (!p.cosmetics.equipped ? 'pink' : 'ghost') + '" data-act="hat" data-id="none">No hat</button>']
      .concat(p.cosmetics.owned.map((id) => `<button class="btn sm ${p.cosmetics.equipped === id ? 'pink' : 'ghost'}" data-act="hat" data-id="${id}">${esc(COSMETIC_BY_ID[id].name)}</button>`)).join(' ');
    return `<div class="settings-grid">
      <label for="set-quality">Graphics</label><select id="set-quality"><option value="low">Low (fast)</option><option value="medium">Medium</option><option value="high">High</option></select>
      <label for="set-volume">Volume</label><input id="set-volume" type="range" min="0" max="1" step="0.05" value="${st.volume}">
      <label for="set-sens">Mouse sensitivity</label><input id="set-sens" type="range" min="0.3" max="2.5" step="0.1" value="${st.sensitivity}">
      <label for="set-invert">Invert camera Y</label><input id="set-invert" type="checkbox" ${st.invertY ? 'checked' : ''}>
      <label for="set-touch">Touch controls</label><select id="set-touch"><option value="auto">Automatic</option><option value="on">Always on</option><option value="off">Off</option></select>
      <span>Hats</span><div>${hats}${p.cosmetics.owned.length ? '' : ' <span class="muted small">Find hats in Lucky Blocks!</span>'}</div>
    </div>
    <p class="muted small">Graphics changes apply after reloading the page. Your progress is saved on the server automatically.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm ghost" data-act="open" data-panel="help">⌨ Controls</button><a class="btn sm ghost" href="gallery.html" target="_blank" rel="noopener">🐾 Monster Gallery</a></div>`;
  }

  bindSettings() {
    const st = this.app.settings;
    $('set-quality').value = st.quality;
    $('set-touch').value = st.touch;
    $('set-quality').onchange = (e) => this.app.saveSetting('quality', e.target.value);
    $('set-volume').oninput = (e) => this.app.saveSetting('volume', Number(e.target.value));
    $('set-sens').oninput = (e) => this.app.saveSetting('sensitivity', Number(e.target.value));
    $('set-invert').onchange = (e) => this.app.saveSetting('invertY', e.target.checked);
    $('set-touch').onchange = (e) => this.app.saveSetting('touch', e.target.value);
  }

  // ------------------------------------------------------------ inspector

  renderInspect(s) {
    const body = $('panel-body');
    const arg = this.panelArg || {};
    const owned = arg.owned ? s.profile.monsters.find((m) => m.id === arg.owned) : null;
    const spId = owned ? owned.species : arg.species;
    const sp = SPECIES_BY_ID[spId];
    if (!sp) {
      this.close();
      return;
    }
    body.innerHTML = `<div class="inspect"><canvas id="inspect-canvas" aria-label="${esc(sp.name)} 3D model (drag to rotate)"></canvas><div id="inspect-info"></div></div>`;
    this.inspectView = this.app.preview.attach($('inspect-canvas'), sp.id, { draggable: true, spin: 0.5 });
    this.inspectQuirkAt = 0;
    this.renderInspectInfo();
  }

  renderInspectInfo() {
    const info = $('inspect-info');
    if (!info) return;
    const s = this.app.state();
    const arg = this.panelArg || {};
    const owned = arg.owned ? s.profile.monsters.find((m) => m.id === arg.owned) : null;
    if (arg.owned && !owned) {
      info.innerHTML = '<p>This monster is no longer yours.</p>';
      return;
    }
    const sp = SPECIES_BY_ID[owned ? owned.species : arg.species];
    const level = owned ? owned.level : sp.spawn.regions ? REGION_BY_ID[sp.spawn.regions[0]].levels[0] : 1;
    const st = monsterStats(sp, level);
    const r = RARITIES[sp.rarity];
    const el = ELEMENTS[sp.element];
    const perk = PERKS[sp.perk.kind];
    let acts = '';
    if (owned) {
      const away = s.awayIds.has(owned.id);
      const free = [];
      for (let i = 0; i < s.profile.base.slots; i++) if (!s.profile.monsters.some((m) => m.slot === i)) free.push(i);
      if (away) acts = '<p class="note">⚠ This monster is being stolen! Hit the thief with a gadget!</p>';
      else {
        if (owned.slot === null && free.length) acts += `<button class="btn sm go" id="ia-place" ${s.atBase ? '' : 'disabled title="Go to your base"'}>Place on pad ${free[0] + 1}</button>`;
        if (owned.slot !== null) acts += `<button class="btn sm ghost" id="ia-unplace" ${s.atBase ? '' : 'disabled title="Go to your base"'}>Pick up</button>`;
        acts += owned.following ? '<button class="btn sm ghost" id="ia-unfollow">Stop following</button>' : `<button class="btn sm blue" id="ia-follow" ${owned.slot !== null && !s.atBase ? 'disabled' : ''}>Follow me</button>`;
        acts += '<button class="btn sm red" id="ia-release">Release</button>';
      }
    }
    info.innerHTML = `
      <div class="rar" style="color:${r.color};font:900 13px var(--font)">${r.name.toUpperCase()} · ${el.icon} ${el.name} · ${esc(sp.category)}</div>
      <h2 style="margin:2px 0">${esc(sp.name)} ${owned ? `<small>Lv ${owned.level}</small>` : ''}</h2>
      <div class="muted" style="font-weight:800">${esc(sp.title)}</div>
      <p class="desc">${esc(sp.description)}</p>
      <div class="kv">
        <b>Health</b><span>${fmt(st.maxHp)}</span><b>Attack</b><span>${Math.round(st.atk)}</span><b>Defense</b><span>${Math.round(st.def)}</span><b>Speed</b><span>${st.speed}</span>
        <b>Power</b><span>${fmt(monsterPower(sp, level))}</span>
        <b>Moves</b><span>${sp.attacks.map((a) => esc(a.name)).join(', ')}</span>
        <b>Base income</b><span>$${incomePerSecond(sp, level)}/s</span>
        <b>Perk</b><span>${esc(perk.name)}: ${esc(perk.text(perkValue(sp, level)))}</span>
        <b>Recruit fee</b><span>$${fmt(recruitPrice(sp, level))}${owned ? '' : ` at Lv ${level}`}</span>
        ${sp.recruitReq && !owned ? `<b>Condition</b><span>🔐 ${esc(sp.recruitReq.text)}</span>` : ''}
        ${owned ? `<b>Origin</b><span>${owned.origin === 'stolen' ? `Stolen from ${esc(owned.stolenFrom || '?')}` : owned.origin === 'event' ? 'LUCKY LUCKY event' : 'Recruited'}</span>` : ''}
      </div>
      <div class="acts">${acts}</div>`;
    const a = this.app.actions;
    if (owned) {
      const free = [];
      for (let i = 0; i < s.profile.base.slots; i++) if (!s.profile.monsters.some((m) => m.slot === i)) free.push(i);
      $('ia-place')?.addEventListener('click', () => a.place(owned.id, free[0]));
      $('ia-unplace')?.addEventListener('click', () => a.unplace(owned.id));
      $('ia-follow')?.addEventListener('click', () => a.follow(owned.id, true));
      $('ia-unfollow')?.addEventListener('click', () => a.follow(owned.id, false));
      $('ia-release')?.addEventListener('click', () => {
        if (confirm(`Release ${sp.name} back into the wild? This cannot be undone.`)) a.release(owned.id);
      });
    }
  }

  // ------------------------------------------------------------ screens

  setLoading(text, pct, tip) {
    $('loading').hidden = false;
    if (text) $('loading-text').textContent = text;
    if (pct !== undefined) $('loading-bar').style.width = `${Math.round(pct * 100)}%`;
    if (tip) $('loading-tip').textContent = tip;
  }

  hideLoading() {
    $('loading').hidden = true;
  }
}

function specialText(sp) {
  switch (sp.kind) {
    case 'crit': return `+${Math.round(sp.chance * 100)}% crit`;
    case 'burn': return 'Burns';
    case 'chain': return 'Chain lightning';
    case 'lifesteal': return `${Math.round(sp.share * 100)}% lifesteal`;
    case 'cleave': return 'Knockback';
    case 'celestial': return 'Heal + crits';
    default: return '';
  }
}

export function helpHtml() {
  const rows = [
    ['W A S D / ↑ ↓', 'Move'], ['Drag the mouse (either button) / ← →', 'Turn the camera (or press V for mouse-look)'], ['Mouse wheel', 'Zoom'],
    ['Left click / F', 'Swing your sword (aims at the closest monster in front)'], ['Space', 'Jump / swim up'], ['Shift', 'Run'], ['Q', 'Dodge roll (dodges attacks)'],
    ['E', 'Interact: shops, Lucky Blocks, steal (hold), rescue'], ['R', 'Recruit the defeated monster (pay its fee)'],
    ['H', 'Teleport to your base (cooldown; not while carrying a stolen monster)'], ['L', 'Switch on your base lasers (at your base)'],
    ['1 – 8', 'Use gadgets'], ['C / Tab', 'Your monsters'], ['M', 'World map'], ['T / Enter', 'Chat'], ['Esc', 'Close panels / release mouse'],
  ];
  return `<table class="help-table">${rows.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join('')}</table>
    <p class="muted small">On phones and tablets: joystick on the left, drag on the right to look, buttons for attack, jump, dodge and interact. 🏠 and 🔒 are at the top.</p>`;
}

export { fmt, esc };
