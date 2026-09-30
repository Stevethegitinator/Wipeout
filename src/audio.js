// WebAudio synthesis: engine drone, sound effects and a procedurally
// generated electronic soundtrack (original patterns seeded per circuit).

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.55;
    this.sfxVol = 0.8;
    this.engines = new Map();
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain(); this.music.gain.value = this.musicVol * 0.5; this.music.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.master);
    const len = ctx.sampleRate * 1;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(music * 0.5, this.ctx.currentTime, 0.05);
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
  }

  noise(dur, filterType, f0, f1, gain, t = 0) {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime + t;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = filterType; flt.Q.value = 1.2;
    flt.frequency.setValueAtTime(f0, now); flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(flt).connect(g).connect(this.sfx);
    src.start(now); src.stop(now + dur + 0.05);
  }

  tone(type, f0, f1, dur, gain, t = 0, dest = this.sfx) {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime + t;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g).connect(dest); o.start(now); o.stop(now + dur + 0.05);
  }

  play(name, vol = 1) {
    if (!this.ctx) return;
    const v = vol;
    switch (name) {
      case 'menu': this.tone('square', 880, 880, 0.06, 0.12 * v); break;
      case 'select': this.tone('square', 660, 1320, 0.12, 0.15 * v); break;
      case 'back': this.tone('square', 660, 330, 0.12, 0.12 * v); break;
      case 'beep': this.tone('square', 440, 440, 0.25, 0.25 * v); break;
      case 'go': this.tone('square', 880, 880, 0.6, 0.25 * v); break;
      case 'wall': this.noise(0.25, 'lowpass', 1800, 200, 0.5 * v); this.tone('sawtooth', 120, 60, 0.2, 0.2 * v); break;
      case 'scrape': this.noise(0.1, 'bandpass', 3000, 2500, 0.12 * v); break;
      case 'land': this.noise(0.2, 'lowpass', 600, 80, 0.5 * v); break;
      case 'speedpad': this.noise(0.5, 'bandpass', 400, 4000, 0.35 * v); this.tone('sawtooth', 200, 800, 0.4, 0.1 * v); break;
      case 'pickup': [0, 4, 7, 12].forEach((n, i) => this.tone('square', mtof(72 + n), mtof(72 + n), 0.08, 0.12 * v, i * 0.05)); break;
      case 'rocket': this.noise(0.4, 'bandpass', 2000, 300, 0.4 * v); break;
      case 'missile': this.noise(0.6, 'bandpass', 800, 3000, 0.35 * v); this.tone('sawtooth', 300, 900, 0.5, 0.08 * v); break;
      case 'mine': this.tone('triangle', 200, 100, 0.2, 0.3 * v); break;
      case 'shock': this.tone('sine', 1200, 60, 0.8, 0.4 * v); this.noise(0.8, 'lowpass', 3000, 100, 0.3 * v); break;
      case 'bolt': this.tone('sawtooth', 1600, 200, 0.4, 0.2 * v); this.tone('square', 1700, 220, 0.4, 0.1 * v); break;
      case 'shield': this.tone('sine', 300, 1200, 0.5, 0.25 * v); break;
      case 'turbo': this.noise(1.2, 'bandpass', 300, 6000, 0.45 * v); break;
      case 'explode': this.noise(0.9, 'lowpass', 2500, 60, 0.8 * v); this.tone('sine', 120, 30, 0.6, 0.5 * v); break;
      case 'lap': [0, 7, 12].forEach((n, i) => this.tone('square', mtof(76 + n), mtof(76 + n), 0.12, 0.12 * v, i * 0.09)); break;
      case 'finish': [0, 4, 7, 12, 16].forEach((n, i) => this.tone('square', mtof(72 + n), mtof(72 + n), 0.2, 0.14 * v, i * 0.1)); break;
      case 'warn': this.tone('square', 1000, 1000, 0.08, 0.1 * v); break;
    }
  }

  // Continuous engine drone for one ship; call every frame.
  engine(id, speed, thrust, vol) {
    const ctx = this.ctx; if (!ctx) return;
    let e = this.engines.get(id);
    if (!e) {
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'square';
      const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1500;
      const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.Q.value = 4;
      const g = ctx.createGain(); g.gain.value = 0;
      const ng = ctx.createGain(); ng.gain.value = 0;
      o1.connect(flt); o2.connect(flt); flt.connect(g).connect(this.sfx);
      n.connect(nf).connect(ng).connect(this.sfx);
      o1.start(); o2.start(); n.start();
      e = { o1, o2, flt, g, ng, n };
      this.engines.set(id, e);
    }
    const t = ctx.currentTime;
    const f = 45 + speed * 0.75;
    e.o1.frequency.setTargetAtTime(f, t, 0.05);
    e.o2.frequency.setTargetAtTime(f * 0.501, t, 0.05);
    e.flt.frequency.setTargetAtTime(300 + thrust * 900 + speed * 8, t, 0.08);
    e.g.gain.setTargetAtTime(vol * (0.05 + thrust * 0.06), t, 0.08);
    e.ng.gain.setTargetAtTime(vol * Math.min(0.08, speed / 3000), t, 0.1);
  }

  stopEngines() {
    for (const e of this.engines.values()) {
      try { e.o1.stop(); e.o2.stop(); e.n.stop(); } catch { /* already stopped */ }
      e.g.disconnect(); e.ng.disconnect();
    }
    this.engines.clear();
  }

  // ---- Music -------------------------------------------------------------
  startMusic(cfg) {
    if (!this.ctx) return;
    this.stopMusic();
    const rng = rngFrom(cfg.seed);
    const scale = [0, 3, 5, 7, 10, 12, 15];
    const pat = (len, density) => Array.from({ length: len }, () => (rng() < density ? Math.floor(rng() * scale.length) : -1));
    const song = {
      bpm: cfg.bpm, root: cfg.root,
      bass: pat(16, 0.6).map((x, i) => (i % 4 === 0 ? 0 : x)),
      arp: pat(16, 0.8),
      chords: [0, rng() < 0.5 ? 5 : 3, rng() < 0.5 ? 7 : 8, rng() < 0.5 ? 3 : 10],
      hat: Array.from({ length: 16 }, (_, i) => (i % 2 === 1 ? 1 : rng() < 0.3 ? 0.5 : 0)),
      snare: Array.from({ length: 16 }, (_, i) => (i === 4 || i === 12 ? 1 : rng() < 0.08 ? 0.5 : 0)),
      scale,
    };
    this.song = song;
    this.step = 0;
    this.bar = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  schedule() {
    const ctx = this.ctx, s = this.song;
    const stepDur = 60 / s.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      const t = this.nextTime, i = this.step % 16;
      const section = Math.floor(this.bar / 8) % 4; // intro, build, full, break
      const chord = s.chords[Math.floor(this.bar / 2) % 4];
      const dest = this.music;
      // kick
      if (i % 4 === 0 && section !== 3) this.drum(t, 'kick');
      if (s.snare[i] && section >= 1) this.drum(t, 'snare', s.snare[i]);
      if (s.hat[i]) this.drum(t, 'hat', s.hat[i]);
      // bass
      if (s.bass[i] >= 0) {
        const n = s.root - 12 + chord + s.scale[s.bass[i]] % 12;
        this.synth(t, n, stepDur * 0.9, 'sawtooth', 0.16, 500 + 300 * Math.sin(this.bar * 0.7), dest);
      }
      // arpeggio
      if (section >= 2 && s.arp[i] >= 0) {
        const n = s.root + 12 + chord + s.scale[s.arp[i]];
        this.synth(t, n, stepDur * 0.6, 'square', 0.05, 2200, dest);
      }
      // pad
      if (i === 0 && this.bar % 2 === 0) {
        for (const off of [0, 3, 7]) this.synth(t, s.root + chord + off, stepDur * 30, 'triangle', 0.035, 1200, dest, 0.4);
      }
      this.nextTime += stepDur;
      this.step++;
      if (this.step % 16 === 0) this.bar++;
    }
  }

  synth(t, note, dur, type, gain, cutoff, dest, attack = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = mtof(note);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  drum(t, kind, vel = 1) {
    const ctx = this.ctx;
    if (kind === 'kick') {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.35);
    } else {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = kind === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'hat' ? 7000 : 1800;
      const g = ctx.createGain();
      const dur = kind === 'hat' ? 0.05 : 0.18;
      g.gain.setValueAtTime((kind === 'hat' ? 0.18 : 0.45) * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f).connect(g).connect(this.music); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    }
  }
}
