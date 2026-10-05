// DOM heads-up display: hotbar, health, air, chat, inventory and overlays.

import { itemName, getTool } from '../engine/items.js';
import { GROUPS, GROUP_NAMES, STATION_NAMES } from '../engine/survival.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Hud {
  constructor(icons) {
    this.icons = icons;
    this.root = $('hud');
    this.hotbar = $('hotbar');
    this.heldName = $('held-name');
    this.hearts = $('hearts');
    this.airEl = $('air');
    this.hungerEl = $('hunger');
    this.debug = $('debug');
    this.chatLog = $('chat-log');
    this.chatForm = $('chat-form');
    this.chatInput = $('chat-input');
    this.toastEl = $('toast');
    this.loading = $('loading');
    this.loadingBar = $('loading-bar');
    this.loadingText = $('loading-text');
    this.pause = $('pause');
    this.death = $('death');
    this.clickToPlay = $('click-to-play');
    this.inv = $('inventory');
    this.invPanel = $('inventory-panel');
    this.cursorEl = $('cursor-item');
    this.onAction = null;
    this.chatOpen = false;
    this.invOpen = false;
    this.invCallbacks = null;
    this.search = '';
    this.heldTimer = null;
    this.toastTimer = null;
    this._lastHotbarKey = '';
    this._lastHealth = -1;
    this._lastAir = -1;
    this._lastHunger = -1;
    this._debugText = null;

    this.hotbarSlots = [];
    for (let i = 0; i < 9; i++) {
      const s = el('div', 'slot');
      s.appendChild(el('img'));
      s.appendChild(el('span', 'count'));
      const dur = el('span', 'dur');
      dur.appendChild(el('i'));
      s.appendChild(dur);
      s.dataset.index = String(i);
      this.hotbar.appendChild(s);
      this.hotbarSlots.push(s);
    }

    // Overlay buttons
    for (const panel of [this.pause, this.death, this.clickToPlay]) {
      panel.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (btn && this.onAction) this.onAction(btn.dataset.act);
      });
    }
    this.clickToPlay.addEventListener('click', (e) => {
      if (!e.target.closest('[data-act]') && this.onAction) this.onAction('resume');
    });

    this.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.chatInput.value;
      const cb = this._chatSubmit;
      this.closeChat(true);
      if (cb) cb(text);
    });
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.closeChat(false); }
      e.stopPropagation();
    });

    this.inv.addEventListener('contextmenu', (e) => e.preventDefault());
    this.inv.addEventListener('mousedown', (e) => {
      if (e.target === this.inv && this.invCallbacks) this.invCallbacks.onClose();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.invOpen) return;
      this.cursorEl.style.transform = `translate(${e.clientX - 22}px, ${e.clientY - 22}px)`;
    });
  }

  show(v) { this.root.hidden = !v; if (!v) this.setClickToPlay(false); }
  setHidden(v) { this.root.classList.toggle('hud-hidden', v); }

  _icon(id) { return this.icons[id] || ''; }

  setHotbar(slots, selected, mode) {
    const key = slots.map((s) => (s ? s.id + ':' + s.count + ':' + (s.dmg || 0) : '-')).join(',') + '|' + selected + '|' + mode;
    if (key === this._lastHotbarKey) return;
    this._lastHotbarKey = key;
    for (let i = 0; i < 9; i++) {
      const s = slots[i];
      const d = this.hotbarSlots[i];
      d.classList.toggle('selected', i === selected);
      const img = d.children[0];
      const cnt = d.children[1];
      const dur = d.children[2];
      if (s) {
        const src = this._icon(s.id);
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.hidden = false;
        img.alt = itemName(s.id);
        cnt.textContent = mode === 'survival' && s.count > 1 ? String(s.count) : '';
      } else {
        img.hidden = true;
        img.removeAttribute('src');
        cnt.textContent = '';
      }
      this._setDurability(dur, s, mode);
    }
  }

  _setDurability(dur, s, mode) {
    const tool = s && getTool(s.id);
    if (!tool || mode !== 'survival' || !s.dmg) { dur.hidden = true; return; }
    const left = 1 - s.dmg / tool.durability;
    dur.hidden = false;
    const bar = dur.firstChild;
    bar.style.width = Math.round(left * 100) + '%';
    bar.style.background = `hsl(${Math.round(left * 120)}, 85%, 50%)`;
  }

  setHunger(food, max, visible) {
    this.hungerEl.hidden = !visible;
    if (!visible) { this._lastHunger = -1; return; }
    const key = Math.round(food);
    if (key === this._lastHunger) return;
    this._lastHunger = key;
    this.hungerEl.textContent = '';
    // Drawn right-to-left like Minecraft.
    for (let i = max / 2 - 1; i >= 0; i--) {
      const v = food - i * 2;
      const span = el('span', 'food ' + (v >= 2 ? 'is-full' : v >= 1 ? 'is-half' : 'is-empty'));
      span.style.backgroundImage = `url(${this.foodIcon || ''})`;
      this.hungerEl.appendChild(span);
    }
  }

  showHeldName(name) {
    this.heldName.textContent = name;
    this.heldName.classList.add('visible');
    clearTimeout(this.heldTimer);
    this.heldTimer = setTimeout(() => this.heldName.classList.remove('visible'), 1600);
  }

  setHealth(hp, max, visible) {
    this.hearts.hidden = !visible;
    if (!visible) return;
    const key = Math.round(hp);
    if (key === this._lastHealth) return;
    this._lastHealth = key;
    this.hearts.textContent = '';
    for (let i = 0; i < max / 2; i++) {
      const v = hp - i * 2;
      this.hearts.appendChild(el('span', 'heart ' + (v >= 2 ? 'is-full' : v >= 1 ? 'is-half' : 'is-empty')));
    }
  }

  setAir(air, max, visible) {
    this.airEl.hidden = !visible;
    if (!visible) { this._lastAir = -1; return; }
    const n = Math.ceil((air / max) * 10);
    if (n === this._lastAir) return;
    this._lastAir = n;
    this.airEl.textContent = '';
    for (let i = 0; i < 10; i++) this.airEl.appendChild(el('span', 'bubble' + (i < n ? '' : ' popped')));
  }

  setDebug(text) {
    if (text === this._debugText) return;
    this._debugText = text;
    this.debug.hidden = text == null;
    if (text != null) this.debug.textContent = text;
  }

  addChat(text, cls = '') {
    const line = el('div', 'chat-line ' + cls, text);
    this.chatLog.appendChild(line);
    while (this.chatLog.children.length > 100) this.chatLog.firstChild.remove();
    setTimeout(() => line.classList.add('old'), 10000);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  openChat(prefill, onSubmit, onClose) {
    this.chatOpen = true;
    this._chatSubmit = onSubmit;
    this._chatClose = onClose;
    this.chatForm.hidden = false;
    this.root.classList.add('chat-open');
    this.chatInput.value = prefill || '';
    // Focus after the current key event so the key itself is not typed.
    setTimeout(() => { this.chatInput.focus(); this.chatInput.setSelectionRange(this.chatInput.value.length, this.chatInput.value.length); }, 0);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  closeChat(submitted = false) {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.chatForm.hidden = true;
    this.root.classList.remove('chat-open');
    this.chatInput.blur();
    const cb = this._chatClose;
    this._chatSubmit = null;
    this._chatClose = null;
    if (cb) cb(submitted);
  }

  isChatOpen() { return this.chatOpen; }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastEl.hidden = true; }, 2500);
  }

  setLoading(visible, progress = 0, text) {
    this.loading.hidden = !visible;
    if (!visible) return;
    if (text) this.loadingText.textContent = text;
    this.loadingBar.style.width = Math.round(Math.max(0, Math.min(1, progress)) * 100) + '%';
  }

  showPause(visible, opts = {}) {
    this.pause.hidden = !visible;
    if (visible) {
      const q = this.pause.querySelector('[data-act="quit"]');
      if (q) q.textContent = opts.multiplayer ? 'Disconnect' : 'Save & Quit to Title';
    }
  }

  showDeath(visible) { this.death.hidden = !visible; }

  setClickToPlay(visible) {
    if (this.clickToPlay.hidden === !visible) return;
    this.clickToPlay.hidden = !visible;
  }

  // Explains the controls when the mouse can't be captured (touch screens,
  // embedded pages): drag to look instead of pointer lock.
  setFreeLook(free, touch) {
    const title = document.getElementById('ctp-title');
    const help = document.getElementById('ctp-help');
    if (!title || !help) return;
    this.touch = !!touch;
    if (touch) {
      title.textContent = 'Tap to play';
      help.textContent = 'Left thumb: move · Drag anywhere else: look · Right buttons: break, place / eat, jump, sneak';
    } else if (free) {
      title.textContent = 'Click to play';
      help.innerHTML = 'Move: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows · Look: drag with the mouse · Break: click · Place: right click · Pause: <kbd>Esc</kbd>';
    }
  }

  // ---------------------------------------------------------------- inventory

  openInventory(callbacks) {
    this.invOpen = true;
    this.invCallbacks = callbacks;
    this.inv.hidden = false;
  }

  closeInventory() {
    this.invOpen = false;
    this.invCallbacks = null;
    this.inv.hidden = true;
    this.cursorEl.hidden = true;
  }

  isInventoryOpen() { return this.invOpen; }

  _slotEl(slot, index, mode, selected) {
    const d = el('div', 'slot');
    if (index === selected) d.classList.add('selected');
    if (slot) {
      const img = el('img');
      img.src = this._icon(slot.id);
      img.alt = itemName(slot.id);
      d.title = itemName(slot.id);
      d.appendChild(img);
      if (mode === 'survival' && slot.count > 1) d.appendChild(el('span', 'count', String(slot.count)));
      const dur = el('span', 'dur');
      dur.appendChild(el('i'));
      d.appendChild(dur);
      this._setDurability(dur, slot, mode);
    }
    d.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.invCallbacks) this.invCallbacks.onSlot(index, e.button);
    });
    return d;
  }

  renderInventory(m) {
    if (!this.invOpen) return;
    const panel = this.invPanel;
    const focusSearch = document.activeElement && document.activeElement.classList.contains('inv-search');
    panel.textContent = '';
    const close = el('button', 'inv-close', '✕');
    close.type = 'button';
    close.title = 'Close (E)';
    close.setAttribute('aria-label', 'Close inventory');
    close.addEventListener('click', (e) => { e.preventDefault(); if (this.invCallbacks) this.invCallbacks.onClose(); });
    panel.appendChild(close);
    if (m.mode === 'creative') {
      panel.appendChild(el('h2', '', 'Creative Inventory'));
      const search = el('input', 'inv-search');
      search.placeholder = 'Search blocks…';
      search.value = this.search;
      search.addEventListener('input', () => { this.search = search.value; this._filterPalette(palette); });
      search.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape' && this.invCallbacks) this.invCallbacks.onClose();
      });
      panel.appendChild(search);
      const palette = el('div', 'inv-grid palette');
      for (const id of m.creativeBlocks) {
        const name = itemName(id);
        const d = el('div', 'slot');
        d.title = name;
        d.dataset.name = name.toLowerCase();
        const img = el('img');
        img.src = this._icon(id);
        img.alt = name;
        d.appendChild(img);
        d.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (this.invCallbacks) this.invCallbacks.onPick(id);
        });
        palette.appendChild(d);
      }
      panel.appendChild(palette);
      this._filterPalette(palette);
      panel.appendChild(el('div', 'inv-label', 'Hotbar — click a block above to put it in the selected slot, right-click a slot to clear it'));
      const hb = el('div', 'inv-grid hotbar-row');
      for (let i = 0; i < 9; i++) hb.appendChild(this._slotEl(m.slots[i], i, m.mode, m.selected));
      panel.appendChild(hb);
      if (focusSearch) setTimeout(() => search.focus(), 0);
    } else {
      const cols = el('div', 'inv-cols');
      const left = el('div', 'inv-left');
      left.appendChild(el('h2', '', 'Inventory'));
      const main = el('div', 'inv-grid main');
      for (let i = 9; i < 36; i++) main.appendChild(this._slotEl(m.slots[i], i, m.mode, -1));
      left.appendChild(main);
      const hb = el('div', 'inv-grid hotbar-row');
      for (let i = 0; i < 9; i++) hb.appendChild(this._slotEl(m.slots[i], i, m.mode, m.selected));
      left.appendChild(hb);
      left.appendChild(el('div', 'inv-label', this.touch ? 'Tap a slot to pick up or put down a stack' : 'Left click: move stack · Right click: split / place one'));
      cols.appendChild(left);

      const right = el('div', 'crafting');
      right.appendChild(el('h2', '', 'Crafting'));
      const st = m.stations || {};
      right.appendChild(el('div', 'inv-label', `Nearby: ${st.table ? '✔' : '✘'} Crafting Table   ${st.furnace ? '✔' : '✘'} Furnace`));
      let cat = null;
      for (const { index, r, ok } of m.recipes) {
        if (r.cat !== cat) {
          cat = r.cat;
          right.appendChild(el('div', 'recipe-cat', cat));
        }
        const row = el('button', 'recipe' + (ok ? '' : ' disabled'));
        row.disabled = !ok;
        for (const [id, n] of r.in) {
          const ing = el('span', 'ing');
          const iconId = typeof id === 'string' ? GROUPS[id][0] : id;
          const label = typeof id === 'string' ? GROUP_NAMES[id] : itemName(id);
          const img = el('img'); img.src = this._icon(iconId); img.alt = label;
          ing.appendChild(img);
          ing.appendChild(el('span', 'n', '×' + n));
          ing.title = label;
          row.appendChild(ing);
        }
        row.appendChild(el('span', 'arrow', '→'));
        const out = el('span', 'ing out');
        const oimg = el('img'); oimg.src = this._icon(r.out[0]); oimg.alt = itemName(r.out[0]);
        out.appendChild(oimg);
        out.appendChild(el('span', 'n', '×' + r.out[1]));
        out.title = itemName(r.out[0]);
        row.appendChild(out);
        if (r.station) {
          const need = el('span', 'station' + (st[r.station] ? ' ok' : ''), STATION_NAMES[r.station]);
          row.appendChild(need);
        }
        row.title = itemName(r.out[0]) + (r.station ? ` (needs a ${STATION_NAMES[r.station]} nearby)` : '');
        row.addEventListener('mousedown', (e) => { e.preventDefault(); if (ok && this.invCallbacks) this.invCallbacks.onCraft(index); });
        right.appendChild(row);
      }
      cols.appendChild(right);
      panel.appendChild(cols);
    }
    // Item held by the mouse cursor.
    if (m.cursor) {
      this.cursorEl.hidden = false;
      this.cursorEl.textContent = '';
      const img = el('img'); img.src = this._icon(m.cursor.id);
      this.cursorEl.appendChild(img);
      if (m.cursor.count > 1) this.cursorEl.appendChild(el('span', 'count', String(m.cursor.count)));
    } else {
      this.cursorEl.hidden = true;
    }
  }

  _filterPalette(palette) {
    const q = this.search.trim().toLowerCase();
    for (const d of palette.children) d.hidden = q !== '' && !d.dataset.name.includes(q);
  }
}
