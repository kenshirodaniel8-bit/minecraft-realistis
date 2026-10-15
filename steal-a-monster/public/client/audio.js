// Sound effects synthesised with the Web Audio API (no audio files needed).
// Every sound is a named hook: play('coin'), play('hit', {pitch}). To use
// recorded sounds instead, register a buffer with setSample(name, url).

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.samples = new Map();
    this.last = new Map();
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  async setSample(name, url) {
    if (!this.ctx) return;
    const buf = await (await fetch(url)).arrayBuffer();
    this.samples.set(name, await this.ctx.decodeAudioData(buf));
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, attack = 0.005 } = {}) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.2, freq = 2000, q = 1, delay = 0, type = 'bandpass', sweep = 0 } = {}) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  play(name, opts = {}) {
    if (!this.ctx || this.volume <= 0) return;
    const now = performance.now();
    if (now - (this.last.get(name) || 0) < (opts.minGap ?? 40)) return;
    this.last.set(name, now);
    const sample = this.samples.get(name);
    if (sample) {
      const s = this.ctx.createBufferSource();
      s.buffer = sample;
      s.connect(this.master);
      s.start();
      return;
    }
    const p = opts.pitch || 1;
    switch (name) {
      case 'swing': this.noise(0.16, { vol: 0.18, freq: 900, sweep: 3, q: 2 }); break;
      case 'hit': this.tone(180 * p, 0.12, { type: 'square', vol: 0.12, slide: 0.5 }); this.noise(0.08, { vol: 0.2, freq: 1200 }); break;
      case 'crit': this.tone(520, 0.1, { type: 'square', vol: 0.12 }); this.tone(780, 0.15, { type: 'square', vol: 0.1, delay: 0.05 }); break;
      case 'cry': this.tone(520 * p, 0.18, { type: 'triangle', vol: 0.12, slide: 1.4 }); this.tone(700 * p, 0.12, { type: 'triangle', vol: 0.08, delay: 0.1, slide: 0.8 }); break;
      case 'defeat': this.tone(600 * p, 0.5, { type: 'triangle', vol: 0.14, slide: 0.35 }); break;
      case 'hurt': this.tone(140, 0.2, { type: 'sawtooth', vol: 0.12, slide: 0.6 }); break;
      case 'dodge': this.noise(0.22, { vol: 0.12, freq: 600, sweep: 4, q: 1.5 }); break;
      case 'jump': this.tone(300, 0.12, { type: 'sine', vol: 0.08, slide: 1.8 }); break;
      case 'coin': this.tone(988, 0.08, { type: 'square', vol: 0.08 }); this.tone(1319, 0.2, { type: 'square', vol: 0.08, delay: 0.07 }); break;
      case 'recruit': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.14, delay: i * 0.09 })); break;
      case 'capture': this.tone(260, 0.9, { type: 'sine', vol: 0.1, slide: 4 }); this.noise(0.8, { vol: 0.06, freq: 3000, sweep: 3, q: 3 }); break;
      case 'caught': this.tone(1047, 0.12, { type: 'square', vol: 0.08 }); [784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.12, delay: 0.08 + i * 0.07 })); break;
      case 'levelup': [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, { type: 'square', vol: 0.08, delay: i * 0.08 })); break;
      case 'lucky': [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.1, delay: i * 0.06 })); this.noise(0.4, { vol: 0.08, freq: 6000, delay: 0.1 }); break;
      case 'laser': this.tone(110, 0.5, { type: 'sawtooth', vol: 0.08, slide: 2 }); break;
      case 'alarm': for (let i = 0; i < 4; i++) { this.tone(880, 0.14, { type: 'square', vol: 0.09, delay: i * 0.3 }); this.tone(660, 0.14, { type: 'square', vol: 0.09, delay: i * 0.3 + 0.15 }); } break;
      case 'grab': this.tone(400, 0.15, { type: 'triangle', vol: 0.12, slide: 1.6 }); break;
      case 'bonk': this.tone(220, 0.08, { type: 'square', vol: 0.15, slide: 0.4 }); this.noise(0.1, { vol: 0.15, freq: 400 }); break;
      case 'freeze': this.noise(0.4, { vol: 0.1, freq: 5000, q: 4, sweep: 0.5 }); break;
      case 'teleport': this.tone(300, 0.4, { type: 'sine', vol: 0.12, slide: 4 }); break;
      case 'click': this.tone(700, 0.05, { type: 'square', vol: 0.05 }); break;
      case 'error': this.tone(200, 0.15, { type: 'square', vol: 0.08 }); this.tone(150, 0.2, { type: 'square', vol: 0.08, delay: 0.1 }); break;
      case 'event': [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, { type: 'square', vol: 0.09, delay: i * 0.12 })); break;
      case 'discover': [659, 880, 1175].forEach((f, i) => this.tone(f, 0.3, { type: 'sine', vol: 0.12, delay: i * 0.12 })); break;
      case 'projectile': this.tone(500 * p, 0.15, { type: 'sine', vol: 0.06, slide: 0.6 }); break;
      case 'slam': this.tone(80, 0.35, { type: 'sine', vol: 0.25, slide: 0.5 }); this.noise(0.3, { vol: 0.15, freq: 300 }); break;
      default: break;
    }
  }
}
