// Procedural sound effects + ambience with the Web Audio API (no audio files).

const PROFILES = {
  stone: { type: 'bandpass', freq: 900, q: 1.2, dur: 0.16, gain: 0.55, click: 2400 },
  wood: { type: 'bandpass', freq: 420, q: 3.5, dur: 0.2, gain: 0.6, click: 900 },
  grass: { type: 'highpass', freq: 1800, q: 0.6, dur: 0.18, gain: 0.35 },
  gravel: { type: 'lowpass', freq: 1400, q: 0.8, dur: 0.2, gain: 0.5 },
  sand: { type: 'lowpass', freq: 2200, q: 0.5, dur: 0.22, gain: 0.35 },
  snow: { type: 'lowpass', freq: 1100, q: 0.4, dur: 0.18, gain: 0.32 },
  cloth: { type: 'lowpass', freq: 600, q: 0.5, dur: 0.16, gain: 0.4 },
  glass: { type: 'highpass', freq: 3000, q: 2, dur: 0.3, gain: 0.45, ping: true },
  water: { type: 'lowpass', freq: 800, q: 1, dur: 0.4, gain: 0.5 },
};

export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.noise = null;
    this.ambienceTimer = 0;
    this.wind = null;
  }

  // Must be called from a user gesture.
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 1;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this._startWind();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch (e) {
      this.ctx = null;
    }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random() * 0.5;
    return src;
  }

  play(kind, opts = {}) {
    if (!this.ctx || this.volume <= 0) return;
    const p = PROFILES[kind] || PROFILES.stone;
    const t = this.ctx.currentTime;
    const vol = (opts.volume ?? 1) * p.gain;
    const dur = p.dur * (opts.duration ?? 1);
    const pitch = opts.pitch ?? (0.85 + Math.random() * 0.3);

    const src = this._noiseSource();
    const filter = this.ctx.createBiquadFilter();
    filter.type = p.type;
    filter.frequency.value = p.freq * pitch;
    filter.Q.value = p.q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);

    if (p.click) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(p.click * pitch, t);
      o.frequency.exponentialRampToValueAtTime(p.click * 0.4 * pitch, t + 0.05);
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(vol * 0.25, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(og).connect(this.master);
      o.start(t);
      o.stop(t + 0.08);
    }
    if (p.ping) {
      for (let i = 0; i < 3; i++) {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = (2400 + Math.random() * 2600) * pitch;
        const og = this.ctx.createGain();
        const st = t + i * 0.03;
        og.gain.setValueAtTime(vol * 0.15, st);
        og.gain.exponentialRampToValueAtTime(0.0001, st + 0.25);
        o.connect(og).connect(this.master);
        o.start(st);
        o.stop(st + 0.3);
      }
    }
  }

  step(kind) { this.play(kind, { volume: 0.32, duration: 0.6 }); }

  splash() { this.play('water', { volume: 0.9, duration: 1.2, pitch: 0.7 }); }

  hurt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }

  _tone(type, f0, f1, dur, vol, filterFreq) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o.connect(g);
    if (filterFreq) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      g.connect(f);
      node = f;
    }
    node.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Creature voices. hurt = the creature was hit.
  mob(type, volume = 1, hurt = false) {
    if (!this.ctx || this.volume <= 0) return;
    const v = Math.max(0, Math.min(1, volume));
    const p = 0.9 + Math.random() * 0.2;
    if (type === 'zombie') {
      this._tone('sawtooth', (hurt ? 180 : 110) * p, (hurt ? 90 : 70) * p, hurt ? 0.35 : 0.9, 0.12 * v, 500);
    } else if (type === 'pig') {
      this._tone('square', 520 * p, (hurt ? 900 : 380) * p, hurt ? 0.25 : 0.18, 0.05 * v, 1800);
      if (!hurt) setTimeout(() => this.ctx && this._tone('square', 480 * p, 360 * p, 0.14, 0.04 * v, 1600), 160);
    } else if (type === 'cow') {
      this._tone('sawtooth', (hurt ? 220 : 150) * p, (hurt ? 130 : 105) * p, hurt ? 0.4 : 1.1, 0.1 * v, 700);
    }
  }

  eat() { this.play('gravel', { volume: 0.45, duration: 0.5, pitch: 1.4 }); }

  pop() {
    if (!this.ctx) return;
    this._tone('sine', 700, 1200, 0.08, 0.06);
  }

  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 660;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  }

  _startWind() {
    const src = this._noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    f.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.wind = { src, f, g };
  }

  _bird() {
    const t = this.ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const st = t + i * (0.09 + Math.random() * 0.06);
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.25), st);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), st + 0.06);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.035, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.08);
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = Math.random() * 2 - 1; o.connect(g).connect(pan).connect(this.master); } else o.connect(g).connect(this.master);
      o.start(st);
      o.stop(st + 0.1);
    }
  }

  _cricket() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const st = t + i * 0.07;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 4300 + Math.random() * 300;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.012, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.045);
      o.connect(g).connect(this.master);
      o.start(st);
      o.stop(st + 0.06);
    }
  }

  // env: { day (0..1), skyLight (0..15), height, underwater }
  updateAmbience(dt, env) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.wind) {
      const exposure = env.skyLight / 15;
      const target = (0.05 + Math.min(1, Math.max(0, (env.height - 60) / 60)) * 0.12) * exposure * (env.underwater ? 0.2 : 1);
      this.wind.g.gain.value += (target - this.wind.g.gain.value) * Math.min(1, dt * 2);
      this.wind.f.frequency.value = env.underwater ? 200 : 320 + Math.sin(performance.now() / 3000) * 120;
    }
    this.ambienceTimer -= dt;
    if (this.ambienceTimer <= 0) {
      this.ambienceTimer = 2.5 + Math.random() * 6;
      if (env.underwater || env.skyLight < 10) return;
      if (env.day > 0.5) this._bird();
      else if (env.day < 0.2) this._cricket();
    }
  }
}
