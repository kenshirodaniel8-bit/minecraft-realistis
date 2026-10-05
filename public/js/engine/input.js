// Keyboard / mouse / touch input. WASD and the arrow keys both move.
//
// Two ways to capture the game:
//  - 'lock' mode: classic pointer lock (mouse moves the camera).
//  - 'free' mode: used on touch screens and where pointer lock is blocked
//    (e.g. inside an embedded page). Drag to look, click to break, right
//    click to place. Touch screens get on-screen controls (see ui/touch.js).

export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sneak: ['ShiftLeft', 'ShiftRight'],
  sprint: ['KeyR'],
};

const DRAG_THRESHOLD = 6;

export function isTouchDevice() {
  try {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
  } catch (e) {
    return false;
  }
}

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
    this.captured = false;
    this.enabled = true;
    this.onLockChange = null;
    this.onKeyDown = null;
    this.onModeChange = null;
    this.lastForwardTap = 0;
    this.sprintToggle = false;
    this.moveX = 0; // analog stick (touch)
    this.moveZ = 0;
    this._lastLockRequest = 0;
    this._lastExit = -1e9;
    this._requestId = 0;
    this._failedRequest = -1;
    this.touch = isTouchDevice();
    this.mode = this.touch || !('requestPointerLock' in element) ? 'free' : 'lock';
    this._drag = null;

    this._onKeyDown = (e) => {
      if (this._isTyping(e)) return;
      if (this.onKeyDown && this.onKeyDown(e) === true) { e.preventDefault(); return; }
      if (!this.enabled) return;
      if (this.mode === 'free' && this.captured && e.code === 'Escape') { this.exitLock(); return; }
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
      if (this.mode === 'lock') {
        if (!this.captured) return;
        // Ignore absurd spikes some browsers emit when pointer lock engages.
        if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        return;
      }
      // Free mode: dragging looks around.
      const d = this._drag;
      if (!d || !this.captured) return;
      const dx = e.clientX - d.lastX, dy = e.clientY - d.lastY;
      d.lastX = e.clientX; d.lastY = e.clientY;
      if (!d.dragging && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD) {
        d.dragging = true;
        this.buttons.delete(d.button); // a drag is a look, not a break/place
      }
      if (d.dragging) {
        this.mouseDX += dx * 1.6;
        this.mouseDY += dy * 1.6;
      }
    };
    this._onMouseDown = (e) => {
      if (this.mode === 'lock') {
        if (!this.captured) return;
        this.buttons.add(e.button);
        this.clicked.add(e.button);
        e.preventDefault();
        return;
      }
      if (!this.captured || e.target !== this.el) return;
      this._drag = { button: e.button, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, dragging: false };
      this.buttons.add(e.button);
      e.preventDefault();
    };
    this._onMouseUp = (e) => {
      const d = this._drag;
      if (this.mode === 'free' && d && d.button === e.button) {
        // A short click without dragging counts as a click.
        if (!d.dragging) this.clicked.add(e.button);
        this._drag = null;
      }
      this.buttons.delete(e.button);
    };
    this._onWheel = (e) => {
      if (!this.captured) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    };
    this._onContext = (e) => e.preventDefault();
    this._onLockChange = () => {
      if (this.mode !== 'lock') return;
      const locked = document.pointerLockElement === this.el;
      if (!locked) this._lastExit = performance.now();
      this._setCaptured(locked);
    };
    this._onLockError = () => this._lockFailed();
    this._onBlur = () => this.releaseAll();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('wheel', this._onWheel, { passive: false });
    this.el.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockError);
    window.addEventListener('blur', this._onBlur);
  }

  // Kept for code that asks "is the game capturing input?"
  get locked() { return this.captured; }

  _setCaptured(v) {
    if (this.captured === v) return;
    this.captured = v;
    if (!v) this.releaseAll();
    if (this.onLockChange) this.onLockChange(v);
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

  _lockFailed() {
    if (this.mode !== 'lock' || this._failedRequest === this._requestId || !this._requestActivated) return;
    this._failedRequest = this._requestId;
    // Browsers refuse a new lock for ~1s after the player pressed Esc; that is
    // temporary. Any other failure means pointer lock is blocked here (embedded
    // page, browser policy), so switch to drag-to-look.
    if (performance.now() - this._lastExit < 2000) return;
    this.mode = 'free';
    if (this.onModeChange) this.onModeChange(this.mode);
    this._setCaptured(true);
  }

  requestLock() {
    // A focused overlay button would otherwise react to Space/Enter while playing.
    const a = document.activeElement;
    if (a && a !== document.body && a !== this.el && a.tagName === 'BUTTON') a.blur();
    if (this.mode === 'free') { this._setCaptured(true); return; }
    if (this.captured) return;
    const now = performance.now();
    if (now - this._lastLockRequest < 300) return;
    this._lastLockRequest = now;
    const id = ++this._requestId;
    // Requests without a click/keypress (e.g. after Esc) are allowed to fail.
    const ua = navigator.userActivation;
    this._requestActivated = ua ? ua.isActive : true;
    // Some browsers ignore blocked requests silently: treat "nothing happened" as a failure.
    setTimeout(() => {
      if (this._requestId === id && !this.captured && this.mode === 'lock' && document.hasFocus()) this._lockFailed();
    }, 1500);
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: false });
      if (p && typeof p.catch === 'function') {
        p.catch((err) => {
          const name = err && err.name;
          // Cool-down / gesture errors are temporary; security/support errors are not.
          if (name === 'NotSupportedError' || name === 'SecurityError' || name === 'WrongDocumentError') this._lockFailed();
        });
      }
    } catch (err) {
      this._lockFailed();
    }
  }

  exitLock() {
    if (this.mode === 'lock') {
      if (document.pointerLockElement === this.el) document.exitPointerLock();
    } else {
      this._setCaptured(false);
    }
  }

  releaseAll() {
    this.keys.clear();
    this.buttons.clear();
    this.sprintToggle = false;
    this.moveX = 0;
    this.moveZ = 0;
    this._drag = null;
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
    document.removeEventListener('pointerlockerror', this._onLockError);
    window.removeEventListener('blur', this._onBlur);
  }
}
