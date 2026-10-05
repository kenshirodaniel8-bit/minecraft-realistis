// Keyboard / mouse input with pointer lock. WASD and the arrow keys both move.

export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sneak: ['ShiftLeft', 'ShiftRight'],
  sprint: ['KeyR'],
};

export class Input {
  constructor(element) {
    this.el = element;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since last frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = new Set();
    this.clicked = new Set(); // buttons pressed since last frame
    this.locked = false;
    this.enabled = true;
    this.onLockChange = null;
    this.onKeyDown = null;
    this.lastForwardTap = 0;
    this.sprintToggle = false;
    this._lastLockRequest = 0;

    this._onKeyDown = (e) => {
      if (this._isTyping(e)) return;
      if (this.onKeyDown && this.onKeyDown(e) === true) { e.preventDefault(); return; }
      if (!this.enabled) return;
      // Stop the page from scrolling / browser shortcuts while playing.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F5', 'F3', 'F1', 'Tab', 'Slash'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) {
        this.pressed.add(e.code);
        if (BINDINGS.forward.includes(e.code)) {
          const now = performance.now();
          if (now - this.lastForwardTap < 280) this.sprintToggle = true;
          this.lastForwardTap = now;
        }
      }
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      if (BINDINGS.forward.includes(e.code) && !this.isDown('forward')) this.sprintToggle = false;
    };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      // Ignore absurd spikes some browsers emit when pointer lock engages.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.clicked.add(e.button);
      e.preventDefault();
    };
    this._onMouseUp = (e) => { this.buttons.delete(e.button); };
    this._onWheel = (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    };
    this._onContext = (e) => e.preventDefault();
    this._onLockChange = () => {
      const locked = document.pointerLockElement === this.el;
      this.locked = locked;
      if (!locked) this.releaseAll();
      if (this.onLockChange) this.onLockChange(locked);
    };
    this._onBlur = () => this.releaseAll();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('wheel', this._onWheel, { passive: false });
    this.el.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
    window.addEventListener('blur', this._onBlur);
  }

  _isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  isDown(action) {
    const codes = BINDINGS[action];
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  wasPressed(code) { return this.pressed.has(code); }

  requestLock() {
    if (this.locked) return;
    // A focused overlay button would otherwise react to Space/Enter while playing.
    const a = document.activeElement;
    if (a && a !== document.body && a !== this.el && a.tagName === 'BUTTON') a.blur();
    const now = performance.now();
    if (now - this._lastLockRequest < 300) return;
    this._lastLockRequest = now;
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: false });
      if (p && typeof p.catch === 'function') p.catch(() => { /* user gesture / cooldown: ignore */ });
    } catch (err) {
      // Older browsers throw synchronously when the request is not allowed.
    }
  }

  exitLock() {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  releaseAll() {
    this.keys.clear();
    this.buttons.clear();
    this.sprintToggle = false;
  }

  endFrame() {
    this.pressed.clear();
    this.clicked.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('wheel', this._onWheel);
    this.el.removeEventListener('contextmenu', this._onContext);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    window.removeEventListener('blur', this._onBlur);
  }
}
