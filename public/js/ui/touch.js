// On-screen controls for phones and tablets: a floating joystick on the left,
// drag anywhere else to look, and buttons for jump, sneak, break and place.

const STICK_RADIUS = 52;

// Simple line icons (emoji fonts differ a lot between phones).
const ICONS = {
  break: '<path d="M4 20l9-9"/><path d="M6 7c4-4 9-4 13 0-3-1-6-1-8 1M17 18c4-4 4-9 0-13 1 3 1 6-1 8"/>',
  place: '<path d="M12 5v14M5 12h14"/>',
  jump: '<path d="M12 19V6M6 11l6-6 6 6"/><path d="M6 20h12"/>',
  sneak: '<path d="M12 5v13M6 13l6 6 6-6"/>',
  inventory: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a3 3 0 0 1 6 0v2M4 12h16"/>',
  view: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
};

function btn(cls, icon, title) {
  const b = document.createElement('button');
  b.className = 'tc-btn ' + cls;
  b.type = 'button';
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
  b.title = title;
  b.setAttribute('aria-label', title);
  return b;
}

export class TouchControls {
  // actions: { inventory(), view(), pause(), fullscreen(), selectSlot(i) }
  constructor(input, actions) {
    this.input = input;
    this.actions = actions;
    this.root = document.createElement('div');
    this.root.id = 'touch-ui';
    this.root.hidden = true;

    this.look = document.createElement('div');
    this.look.className = 'tc-look';
    this.stickZone = document.createElement('div');
    this.stickZone.className = 'tc-stick-zone';
    this.stick = document.createElement('div');
    this.stick.className = 'tc-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'tc-knob';
    this.stick.appendChild(this.knob);
    this.stickZone.appendChild(this.stick);

    const right = document.createElement('div');
    right.className = 'tc-right';
    this.btnBreak = btn('tc-break', 'break', 'Break / attack');
    this.btnPlace = btn('tc-place', 'place', 'Place / use / eat');
    this.btnJump = btn('tc-jump', 'jump', 'Jump (double-tap to fly)');
    this.btnSneak = btn('tc-sneak', 'sneak', 'Sneak / fly down');
    right.append(this.btnBreak, this.btnPlace, this.btnSneak, this.btnJump);

    const top = document.createElement('div');
    top.className = 'tc-top';
    const bInv = btn('tc-small', 'inventory', 'Inventory');
    const bView = btn('tc-small', 'view', 'Change view');
    const bFull = btn('tc-small', 'fullscreen', 'Fullscreen');
    const bPause = btn('tc-small', 'pause', 'Pause');
    top.append(bInv, bView, bFull, bPause);

    this.root.append(this.look, this.stickZone, right, top);
    document.body.appendChild(this.root);

    this._pointers = new Map();
    this._bindLook();
    this._bindStick();
    this._hold(this.btnBreak, () => { input.buttons.add(0); input.clicked.add(0); }, () => input.buttons.delete(0));
    this._hold(this.btnPlace, () => { input.buttons.add(2); input.clicked.add(2); }, () => input.buttons.delete(2));
    this._hold(this.btnJump, () => { input.keys.add('Space'); input.pressed.add('Space'); }, () => input.keys.delete('Space'));
    this._tap(this.btnSneak, () => {
      if (input.keys.has('ShiftLeft')) input.keys.delete('ShiftLeft'); else input.keys.add('ShiftLeft');
      this.btnSneak.classList.toggle('on', input.keys.has('ShiftLeft'));
    });
    this._tap(bInv, () => actions.inventory());
    this._tap(bView, () => actions.view());
    this._tap(bFull, () => actions.fullscreen());
    this._tap(bPause, () => actions.pause());

    this._onHotbar = (e) => {
      const slot = e.target.closest('#hotbar .slot');
      if (!slot || this.root.hidden) return;
      e.preventDefault();
      actions.selectSlot(Number(slot.dataset.index));
    };
    document.getElementById('hotbar').addEventListener('pointerdown', this._onHotbar);
  }

  show(v) {
    this.root.hidden = !v;
    document.body.classList.toggle('touch-playing', v);
    if (!v) {
      this._resetStick();
      this.btnSneak.classList.remove('on');
    }
  }

  _tap(el, fn) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
  }

  _hold(el, down, up) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('on');
      down();
    });
    const release = (e) => { el.classList.remove('on'); up(); e.preventDefault?.(); };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  _bindLook() {
    const el = this.look;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    el.addEventListener('pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      this.input.mouseDX += (e.clientX - p.x) * 2.4;
      this.input.mouseDY += (e.clientY - p.y) * 2.4;
      p.x = e.clientX; p.y = e.clientY;
    });
    const end = (e) => this._pointers.delete(e.pointerId);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  _bindStick() {
    const zone = this.stickZone;
    let active = null;
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      zone.setPointerCapture?.(e.pointerId);
      const r = zone.getBoundingClientRect();
      active = { id: e.pointerId, cx: e.clientX, cy: e.clientY };
      this.stick.style.left = (e.clientX - r.left) + 'px';
      this.stick.style.top = (e.clientY - r.top) + 'px';
      this.stick.classList.add('on');
      this._moveKnob(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (!active || e.pointerId !== active.id) return;
      let dx = e.clientX - active.cx, dy = e.clientY - active.cy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
      this._moveKnob(dx, dy);
      this.input.moveX = dx / STICK_RADIUS;
      this.input.moveZ = -dy / STICK_RADIUS;
      // Pushing the stick all the way forward sprints.
      this.input.sprintToggle = this.input.moveZ > 0.92;
    });
    const end = (e) => {
      if (!active || e.pointerId !== active.id) return;
      active = null;
      this._resetStick();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  _moveKnob(dx, dy) {
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  _resetStick() {
    this.input.moveX = 0;
    this.input.moveZ = 0;
    this.input.sprintToggle = false;
    this.stick.classList.remove('on');
    this.stick.style.left = '';
    this.stick.style.top = '';
    this._moveKnob(0, 0);
  }

  dispose() {
    document.getElementById('hotbar')?.removeEventListener('pointerdown', this._onHotbar);
    document.body.classList.remove('touch-playing');
    this.root.remove();
  }
}
