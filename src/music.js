// Procedural soundtrack: a step sequencer driving synthesised drums, bass,
// pads, arpeggios and leads, arranged into intro / build / drop / break
// sections. Each circuit has its own style and seed, so every track is
// different but repeatable. All material is generated here; no samples.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Song form in bars. Layers present in each section.
const FORM = [
  { name: 'intro', bars: 8, kick: 0, snare: 0, hats: 1, bass: 0, pad: 1, arp: 1, lead: 0, filter: 0.25 },
  { name: 'build', bars: 8, kick: 1, snare: 1, hats: 1, bass: 1, pad: 1, arp: 1, lead: 0, filter: 0.5, riser: true },
  { name: 'drop', bars: 16, kick: 1, snare: 1, hats: 2, bass: 1, pad: 1, arp: 1, lead: 0, filter: 1, crash: true },
  { name: 'break', bars: 8, kick: 0, snare: 0, hats: 0, bass: 0, pad: 1, arp: 1, lead: 1, filter: 0.35, riser: true },
  { name: 'drop2', bars: 16, kick: 1, snare: 1, hats: 2, bass: 1, pad: 1, arp: 1, lead: 1, filter: 1, crash: true },
  { name: 'outro', bars: 8, kick: 1, snare: 1, hats: 1, bass: 1, pad: 1, arp: 0, lead: 0, filter: 0.6 },
];
const MENU_FORM = [
  { name: 'a', bars: 8, kick: 1, snare: 0, hats: 1, bass: 1, pad: 1, arp: 1, lead: 0, filter: 0.45 },
  { name: 'b', bars: 8, kick: 1, snare: 1, hats: 1, bass: 1, pad: 1, arp: 1, lead: 1, filter: 0.6 },
];

// Drum patterns: 16 steps per bar; values are velocities.
const STYLES = {
  breaks: {
    kick: [1, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0.25, 0, 0, 0, 0, 1, 0, 0, 0.3],
    hat: [0.8, 0, 0.5, 0, 0.8, 0, 0.5, 0, 0.8, 0, 0.5, 0, 0.8, 0, 0.5, 0.4],
    open: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    bass: 'sub', lead: 'saw', arp: 'pluck', clap: false,
  },
  dnb: {
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.2],
    hat: [0.7, 0.3, 0.6, 0.3, 0.7, 0.3, 0.6, 0.4, 0.7, 0.3, 0.6, 0.3, 0.7, 0.3, 0.6, 0.5],
    open: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: 'reese', lead: 'square', arp: 'stab', clap: false,
  },
  acid: {
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 0, 0.6, 0, 0, 0, 0.6, 0, 0, 0, 0.6, 0, 0, 0, 0.6, 0.3],
    open: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    bass: 'acid', lead: 'saw', arp: 'pluck', clap: true,
  },
  dark: {
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    hat: [0.3, 0.3, 0.7, 0.3, 0.3, 0.3, 0.7, 0.3, 0.3, 0.3, 0.7, 0.3, 0.3, 0.3, 0.7, 0.4],
    open: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bass: 'rolling', lead: 'square', arp: 'stab', clap: true,
  },
  menu: {
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0.4, 0, 0.5, 0, 0.4, 0, 0.5, 0, 0.4, 0, 0.5, 0, 0.4, 0, 0.5, 0.2],
    open: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    bass: 'sub', lead: 'square', arp: 'pluck', clap: false,
  },
};

const PROGRESSIONS = [[0, 8, 3, 10], [0, 5, 8, 7], [0, 10, 8, 7], [0, 3, 8, 10], [0, 8, 5, 7]];
const SCALE = [0, 2, 3, 5, 7, 8, 10];
const MAJOR_DEGREES = new Set([3, 8, 10]);

export class Music {
  constructor(ctx, out, noiseBuf) {
    this.ctx = ctx;
    this.noiseBuf = noiseBuf;
    // Buses: drums straight through; bass and pads ducked by the kick.
    this.out = ctx.createGain(); this.out.gain.value = 0.8; this.out.connect(out);
    this.drums = ctx.createGain(); this.drums.connect(this.out);
    this.duck = ctx.createGain(); this.duck.connect(this.out);
    // Effects: tempo delay and a generated plate-style reverb.
    this.delay = ctx.createDelay(1.5);
    this.delayFb = ctx.createGain(); this.delayFb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3500;
    this.delay.connect(dlp).connect(this.delayFb).connect(this.delay);
    this.delaySend = ctx.createGain(); this.delaySend.gain.value = 1;
    this.delaySend.connect(this.delay);
    const dout = ctx.createGain(); dout.gain.value = 0.5; dlp.connect(dout).connect(this.out);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 2.6, 2.2);
    this.reverbSend = ctx.createGain();
    const rout = ctx.createGain(); rout.gain.value = 0.55;
    this.reverbSend.connect(this.reverb).connect(rout).connect(this.out);
    // Master filter for builds and breakdowns.
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 20000; this.filter.Q.value = 0.7;
    this.duck.disconnect(); this.duck.connect(this.filter); this.filter.connect(this.out);
    this.playing = false;
  }

  start(cfg, when = this.ctx.currentTime + 0.1, startBar = 0) {
    const rng = rngFrom(cfg.seed);
    const style = STYLES[cfg.style] || STYLES.breaks;
    this.style = style;
    this.form = cfg.style === 'menu' ? MENU_FORM : FORM;
    this.totalBars = this.form.reduce((s, f) => s + f.bars, 0);
    this.bpm = cfg.bpm;
    this.root = cfg.root;
    this.stepDur = 60 / cfg.bpm / 4;
    this.delay.delayTime.value = this.stepDur * 3;
    this.prog = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)];
    // Arp: a 16-step path through chord tones; lead: a 2-bar motif.
    this.arp = Array.from({ length: 16 }, (_, i) => (rng() < (i % 4 === 0 ? 0.95 : 0.65) ? Math.floor(rng() * 6) : -1));
    this.lead = Array.from({ length: 32 }, (_, i) => {
      const on = i % 4 === 0 ? rng() < 0.85 : rng() < 0.35;
      return on ? { deg: Math.floor(rng() * 7), len: 1 + Math.floor(rng() * 3) } : null;
    });
    this.acid = Array.from({ length: 16 }, () => ({
      note: rng() < 0.75 ? [0, 0, 0, 12, 3, 7, 10, -2][Math.floor(rng() * 8)] : null,
      accent: rng() < 0.3, slide: rng() < 0.2,
    }));
    this.rolling = [0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1].map((v, i) => (v && rng() < 0.85 ? (i % 4 === 2 ? 12 : 0) : null));
    this.bassLine = Array.from({ length: 16 }, (_, i) => (style.kick[i] || (i % 4 === 3 && rng() < 0.4) ? 1 : 0));
    this.step = startBar * 16;
    this.nextTime = when;
    this.playing = true;
  }

  stop() { this.playing = false; }

  section(bar) {
    let b = bar % this.totalBars;
    for (const f of this.form) { if (b < f.bars) return { f, barIn: b }; b -= f.bars; }
    return { f: this.form[0], barIn: 0 };
  }

  // Schedule every step that starts before `until` (seconds, context time).
  schedule(until) {
    if (!this.playing) return;
    while (this.nextTime < until) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step++;
    }
  }

  playStep(step, t) {
    const st = this.style;
    const i = step % 16, bar = Math.floor(step / 16);
    const { f, barIn } = this.section(bar);
    const chordRoot = this.root + this.prog[Math.floor(bar / 2) % 4];
    const major = MAJOR_DEGREES.has(this.prog[Math.floor(bar / 2) % 4]);
    const chord = [0, major ? 4 : 3, 7, 12, major ? 16 : 15, 19];
    const lastBar = barIn === f.bars - 1;
    const fillBar = lastBar && f.kick;

    if (i === 0) {
      // master filter opens across builds, stays open on drops
      const target = 300 + Math.pow(f.filter, 2) * 19000;
      this.filter.frequency.setTargetAtTime(f.riser ? 300 + (barIn / f.bars) * 6000 : target, t, f.riser ? 1.5 : 0.3);
      if (barIn === 0 && f.crash) this.crash(t);
      if (f.riser && barIn === f.bars - 2) this.riser(t, this.stepDur * 32);
    }

    // drums
    if (f.kick && st.kick[i] && !(fillBar && i >= 12)) this.kick(t, st.kick[i]);
    if (f.snare && st.snare[i]) this.snare(t, st.snare[i]);
    if (fillBar && i >= 12) this.snare(t, 0.5 + (i - 12) * 0.15); // snare roll into the next section
    if (f.snare && st.clap && st.snare[i] >= 1) this.clap(t);
    if (f.hats && st.hat[i]) this.hat(t, st.hat[i] * (f.hats > 1 ? 1 : 0.7), false);
    if (f.hats > 1 && st.open[i]) this.hat(t, 0.6, true);

    // bass
    if (f.bass) {
      const b = chordRoot - 24;
      if (st.bass === 'sub' && this.bassLine[i]) this.sub(t, b + (i === 10 ? 7 : 0), this.stepDur * 2.5);
      else if (st.bass === 'reese' && (i === 0 || i === 8)) this.reese(t, b + (i === 8 && bar % 2 ? 3 : 0), this.stepDur * 8);
      else if (st.bass === 'acid') {
        const a = this.acid[i];
        if (a.note !== null) this.acidNote(t, b + 12 + a.note, a.accent, a.slide, barIn / f.bars);
      } else if (st.bass === 'rolling' && this.rolling[i] !== null) this.sub(t, b + this.rolling[i], this.stepDur * 0.9, true);
    }

    // pads: new chord every two bars
    if (f.pad && i === 0 && bar % 2 === 0) this.pad(t, chordRoot, chord.slice(0, 3), this.stepDur * 32);
    // arpeggio / stabs
    if (f.arp && this.arp[i] >= 0) {
      const n = chordRoot + 12 + chord[this.arp[i]];
      if (st.arp === 'stab') { if (i % 4 === 2 || i === 0) this.stab(t, chordRoot, chord); }
      else this.pluck(t, n, 0.5 + (i % 4 === 0 ? 0.3 : 0));
    }
    // lead melody
    if (f.lead) {
      const l = this.lead[(bar % 2) * 16 + i];
      if (l) {
        const deg = SCALE[l.deg];
        this.leadNote(t, this.root + 24 + deg, this.stepDur * l.len * 1.8, st.lead);
      }
    }
  }

  // ---- instruments ------------------------------------------------------
  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  sidechain(t) {
    const g = this.duck.gain;
    g.setValueAtTime(0.25, t);
    g.linearRampToValueAtTime(1, t + this.stepDur * 2.2);
  }

  kick(t, vel) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = c.createGain(); this.env(g, t, 0.002, 1.1 * vel, 0.42);
    const sh = c.createWaveShaper(); sh.curve = SOFT_CLIP;
    o.connect(sh).connect(g).connect(this.drums); o.start(t); o.stop(t + 0.5);
    this.noiseHit(t, 'highpass', 3000, 0.012, 0.35 * vel, this.drums); // beater click
    this.sidechain(t);
  }

  snare(t, vel) {
    const c = this.ctx;
    this.noiseHit(t, 'bandpass', 1900, 0.2, 0.55 * vel, this.drums, 0.9, this.reverbSend, 0.3);
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(170, t + 0.08);
    const g = c.createGain(); this.env(g, t, 0.001, 0.45 * vel, 0.1);
    o.connect(g).connect(this.drums); o.start(t); o.stop(t + 0.15);
  }

  clap(t) {
    for (let k = 0; k < 3; k++) this.noiseHit(t + k * 0.011, 'bandpass', 1300, 0.03, 0.35, this.drums, 1.4);
    this.noiseHit(t + 0.033, 'bandpass', 1300, 0.22, 0.3, this.drums, 1.4, this.reverbSend, 0.4);
  }

  hat(t, vel, open) {
    this.noiseHit(t, 'highpass', open ? 7000 : 8500, open ? 0.32 : 0.045, (open ? 0.22 : 0.2) * vel, this.drums);
  }

  crash(t) {
    this.noiseHit(t, 'highpass', 4500, 1.8, 0.28, this.drums, 0.7, this.reverbSend, 0.3);
  }

  riser(t, dur) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    src.connect(f).connect(g).connect(this.out); g.connect(this.reverbSend);
    src.start(t); src.stop(t + dur + 0.1);
  }

  noiseHit(t, type, freq, dur, peak, dest, q = 1, send = null, sendAmt = 0) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); this.env(g, t, 0.001, peak, dur);
    src.connect(f).connect(g).connect(dest);
    if (send) { const s = c.createGain(); s.gain.value = sendAmt; g.connect(s).connect(send); }
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  sub(t, note, dur, punchy = false) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(note);
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = mtof(note + 12);
    const g2 = c.createGain(); g2.gain.value = punchy ? 0.4 : 0.15;
    const g = c.createGain(); this.env(g, t, 0.005, 0.55, dur);
    o.connect(g); o2.connect(g2).connect(g); g.connect(this.duck);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  reese(t, note, dur) {
    const c = this.ctx;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(260, t); f.frequency.linearRampToValueAtTime(900, t + dur * 0.5); f.frequency.linearRampToValueAtTime(320, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.03);
    g.gain.setValueAtTime(0.32, t + dur * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const det of [-14, 14]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(note + 12); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
    const s = c.createOscillator(); s.type = 'sine'; s.frequency.value = mtof(note);
    const sg = c.createGain(); sg.gain.value = 1.4; s.connect(sg).connect(g); s.start(t); s.stop(t + dur + 0.05);
    f.connect(g).connect(this.duck);
  }

  acidNote(t, note, accent, slide, sweep) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(mtof(note - (slide ? 2 : 0)), t);
    if (slide) o.frequency.exponentialRampToValueAtTime(mtof(note), t + 0.06);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 14;
    const base = 250 + sweep * 1400;
    f.frequency.setValueAtTime(base + (accent ? 3200 : 1600), t);
    f.frequency.exponentialRampToValueAtTime(base, t + (accent ? 0.22 : 0.12));
    const sh = c.createWaveShaper(); sh.curve = SOFT_CLIP;
    const g = c.createGain(); this.env(g, t, 0.003, accent ? 0.32 : 0.2, this.stepDur * (slide ? 1.6 : 0.9));
    o.connect(f).connect(sh).connect(g).connect(this.duck);
    const ds = c.createGain(); ds.gain.value = 0.15; g.connect(ds).connect(this.delaySend);
    o.start(t); o.stop(t + this.stepDur * 2);
  }

  pad(t, root, chord, dur) {
    const c = this.ctx;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400; f.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.8);
    g.gain.setValueAtTime(0.09, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    for (const n of chord) for (const det of [-9, 0, 9]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(root + n); o.detune.value = det + (Math.random() - 0.5) * 4;
      o.connect(f); o.start(t); o.stop(t + dur + 0.7);
    }
    f.connect(g).connect(this.duck);
    const rs = c.createGain(); rs.gain.value = 0.6; g.connect(rs).connect(this.reverbSend);
  }

  pluck(t, note, vel) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = mtof(note);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(4500, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.16);
    const g = c.createGain(); this.env(g, t, 0.002, 0.07 * vel * 2, 0.2);
    o.connect(f).connect(g).connect(this.duck);
    const ds = c.createGain(); ds.gain.value = 0.5; g.connect(ds).connect(this.delaySend);
    o.start(t); o.stop(t + 0.3);
  }

  stab(t, root, chord) {
    const c = this.ctx;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    const g = c.createGain(); this.env(g, t, 0.003, 0.08, 0.22);
    for (const n of chord.slice(0, 3)) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(root + 12 + n);
      o.connect(f); o.start(t); o.stop(t + 0.3);
    }
    f.connect(g).connect(this.duck);
    const ds = c.createGain(); ds.gain.value = 0.6; g.connect(ds).connect(this.delaySend);
    const rs = c.createGain(); rs.gain.value = 0.3; g.connect(rs).connect(this.reverbSend);
  }

  leadNote(t, note, dur, type) {
    const c = this.ctx;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(1800, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.075, t + 0.02);
    g.gain.setValueAtTime(0.075, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const vib = c.createOscillator(); vib.frequency.value = 5.5;
    const vg = c.createGain(); vg.gain.value = 9; vib.connect(vg);
    for (const det of [-7, 7]) {
      const o = c.createOscillator(); o.type = type === 'square' ? 'square' : 'sawtooth';
      o.frequency.value = mtof(note); o.detune.value = det;
      vg.connect(o.detune);
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
    vib.start(t); vib.stop(t + dur + 0.05);
    f.connect(g).connect(this.duck);
    const ds = c.createGain(); ds.gain.value = 0.45; g.connect(ds).connect(this.delaySend);
    const rs = c.createGain(); rs.gain.value = 0.5; g.connect(rs).connect(this.reverbSend);
  }
}

const SOFT_CLIP = (() => {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
  return curve;
})();

// Stereo impulse response: decaying noise with a darker tail.
export function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += ((Math.random() * 2 - 1) - lp) * (0.9 - t * 0.7);
      d[i] = lp * Math.pow(1 - t, decay) * (i < ctx.sampleRate * 0.01 ? i / (ctx.sampleRate * 0.01) : 1);
    }
  }
  return buf;
}
