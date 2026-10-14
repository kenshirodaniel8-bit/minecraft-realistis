// Keyboard, mouse and touch input mapped to game actions.
//
// Desktop: WASD move, mouse (right-drag or mouse-look) camera, left click
// attack, Space jump, Shift sprint, Q dodge, E interact, R recruit, H home,
// L lasers, 1-8 gadgets, C collection, M map, T chat, V mouse-look, Esc menu.
// Touch: left joystick, drag right side to look, on-screen buttons.

const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyQ: 'dodge',
  KeyE: 'interact',
  KeyR: 'recruit',
  KeyH: 'home',
  KeyL: 'lock',
  KeyC: 'collection', Tab: 'collection',
  KeyM: 'map',
  KeyT: 'chat', Enter: 'chat', Slash: 'chat',
  KeyV: 'mouselook',
  KeyF: 'attack',
  F3: 'debug',
  Escape: 'menu',
  Digit1: 'item1', Digit2: 'item2', Digit3: 'item3', Digit4: 'item4',
  Digit5: 'item5', Digit6: 'item6', Digit7: 'item7', Digit8: 'item8',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.look = { x: 0, y: 0 };
    this.zoom = 0;
    this.stick = { x: 0, y: 0, active: false };
    this.mouseLook = false;
    this.dragging = false;
    this.enabled = true;
    this.typing = false;
    this.sensitivity = 1;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.listeners = [];

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom += Math.sign(e.deltaY);
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.mouseLook = document.pointerLockElement === canvas;
      this.emit('mouselook', this.mouseLook);
    });
  }

  on(fn) {
    this.listeners.push(fn);
  }

  emit(action, value) {
    for (const fn of this.listeners) fn(action, value);
  }

  onKey(e, isDown) {
    if (this.typing) {
      if (isDown && e.code === 'Escape') this.emit('chatcancel');
      return;
    }
    const a = KEYMAP[e.code];
    if (!a) return;
    if (['Tab', 'Space', 'Slash', 'F3', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (isDown) {
      if (!this.down.has(a)) {
        this.pressed.add(a);
        this.emit(a, true);
      }
      this.down.add(a);
    } else {
      this.down.delete(a);
      this.emit(a, false);
    }
  }

  onMouseDown(e) {
    if (!this.enabled) return;
    if (e.button === 0) {
      if (!this.down.has('attack')) this.pressed.add('attack');
      this.down.add('attack');
    } else if (e.button === 2) {
      this.dragging = true;
    }
  }

  onMouseUp(e) {
    if (e.button === 0) this.down.delete('attack');
    if (e.button === 2) this.dragging = false;
  }

  onMouseMove(e) {
    if (this.mouseLook || this.dragging) {
      this.look.x += e.movementX * this.sensitivity;
      this.look.y += e.movementY * this.sensitivity;
    }
  }

  toggleMouseLook() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    else this.canvas.requestPointerLock?.();
  }

  // movement axis in camera space: x = right, z = forward
  axis() {
    let x = 0;
    let z = 0;
    if (this.down.has('forward')) z += 1;
    if (this.down.has('back')) z -= 1;
    if (this.down.has('right')) x += 1;
    if (this.down.has('left')) x -= 1;
    if (this.stick.active) {
      x += this.stick.x;
      z += this.stick.y;
    }
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z };
  }

  consumePress(a) {
    if (this.pressed.has(a)) {
      this.pressed.delete(a);
      return true;
    }
    return false;
  }

  consumeLook() {
    const l = { ...this.look };
    this.look.x = this.look.y = 0;
    return l;
  }

  consumeZoom() {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }

  // used by the on-screen touch buttons
  setVirtual(action, isDown) {
    if (isDown) {
      if (!this.down.has(action)) {
        this.pressed.add(action);
        this.emit(action, true);
      }
      this.down.add(action);
    } else {
      this.down.delete(action);
      this.emit(action, false);
    }
  }

  endFrame() {
    this.pressed.clear();
  }
}

// On-screen controls for phones and tablets.
export class TouchControls {
  constructor(input, root) {
    this.input = input;
    this.root = root;
    root.innerHTML = `
      <div class="tc-look"></div>
      <div class="tc-stick-zone"><div class="tc-stick"><div class="tc-knob"></div></div></div>
      <div class="tc-buttons">
        <button class="tc-btn tc-attack" data-a="attack" aria-label="Attack">⚔️</button>
        <button class="tc-btn tc-jump" data-a="jump" aria-label="Jump">⤒</button>
        <button class="tc-btn tc-dodge" data-a="dodge" aria-label="Dodge">💨</button>
        <button class="tc-btn tc-interact" data-a="interact" aria-label="Interact">E</button>
      </div>
      <div class="tc-top">
        <button class="tc-small" data-a="home" aria-label="Return to base">🏠</button>
        <button class="tc-small" data-a="lock" aria-label="Security lasers">🔒</button>
      </div>`;
    const stickZone = root.querySelector('.tc-stick-zone');
    const stick = root.querySelector('.tc-stick');
    const knob = root.querySelector('.tc-knob');
    const look = root.querySelector('.tc-look');
    let stickId = null;
    let origin = null;
    const R = 50;
    stickZone.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      stickZone.setPointerCapture(e.pointerId);
      origin = { x: e.clientX, y: e.clientY };
      stick.style.left = `${e.clientX - stickZone.getBoundingClientRect().left - 60}px`;
      stick.style.top = `${e.clientY - stickZone.getBoundingClientRect().top - 60}px`;
      stick.classList.add('on');
      input.stick.active = true;
    });
    stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - origin.x;
      let dy = e.clientY - origin.y;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.stick.x = dx / R;
      input.stick.y = -dy / R;
      if (d > R * 0.95) input.down.add('sprint');
      else input.down.delete('sprint');
    });
    const endStick = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      knob.style.transform = '';
      stick.classList.remove('on');
      input.stick.active = false;
      input.stick.x = input.stick.y = 0;
      input.down.delete('sprint');
    };
    stickZone.addEventListener('pointerup', endStick);
    stickZone.addEventListener('pointercancel', endStick);
    let lookId = null;
    let last = null;
    look.addEventListener('pointerdown', (e) => {
      lookId = e.pointerId;
      look.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      input.look.x += (e.clientX - last.x) * 1.6;
      input.look.y += (e.clientY - last.y) * 1.6;
      last = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e) => {
      if (e.pointerId === lookId) lookId = null;
    };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);
    for (const b of root.querySelectorAll('[data-a]')) {
      const a = b.dataset.a;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        input.setVirtual(a, true);
      });
      const up = () => {
        b.classList.remove('down');
        input.setVirtual(a, false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }
  }

  show(on) {
    this.root.hidden = !on;
  }
}
