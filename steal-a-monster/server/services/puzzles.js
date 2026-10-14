// The Ancient Ruins puzzle: step on the three pressure plates in the right
// order (the order is carved on the temple: Moon, Star, Sun) within the time
// window to open the vault. While it is open the guardian Titanub can appear
// inside. The vault interior is a sealed zone the server refuses to let
// anyone walk into while the door is closed.

export class Puzzles {
  constructor(game) {
    this.game = game;
    this.def = game.world.puzzle;
    this.progress = [];
    this.lastStepAt = 0;
    this.openUntil = 0;
  }

  isOpen() {
    return this.openUntil > this.game.now();
  }

  state() {
    return { progress: [...this.progress], openUntil: this.openUntil, order: this.def.order };
  }

  insideVault(x, z) {
    const c = this.def.center;
    return Math.abs(x - c.x) < 10.4 && Math.abs(z - c.z) < 10.4;
  }

  mayMove(s, nx, nz) {
    if (this.isOpen()) return true;
    return !(this.insideVault(nx, nz) && !this.insideVault(s.pos.x, s.pos.z));
  }

  checkPlates(s) {
    const r = this.def.plateRadius;
    let on = null;
    for (const p of this.def.plates) {
      if ((s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2 < r * r && Math.abs(s.pos.y - p.y) < 3) on = p;
    }
    if (!on) {
      s.onPlate = null;
      return;
    }
    if (s.onPlate === on.id) return;
    s.onPlate = on.id;
    this.step(on.id, s);
  }

  step(id, s) {
    const game = this.game;
    if (this.isOpen()) return;
    const expected = this.def.order[this.progress.length];
    if (id === expected) {
      this.progress.push(id);
      this.lastStepAt = game.now();
      if (this.progress.length === this.def.order.length) {
        this.openUntil = game.now() + this.def.openMs;
        this.progress = [];
        game.broadcast('announce', { text: `${s.profile.name} opened the Temple vault! The Guardian stirs...`, kind: 'world' });
      }
    } else if (this.progress[this.progress.length - 1] !== id) {
      this.progress = [];
      game.toast(s, 'The plates go dark. Wrong order! (Hint: look at the temple carvings)', 'warn');
    }
    game.broadcast('puzzle', this.state());
  }

  tick(dt, now) {
    if (this.progress.length && now - this.lastStepAt > this.def.windowMs) {
      this.progress = [];
      this.game.broadcast('puzzle', this.state());
    }
    if (this.openUntil && now > this.openUntil) {
      this.openUntil = 0;
      this.game.broadcast('puzzle', this.state());
    }
  }
}
