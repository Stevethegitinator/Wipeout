// Audio: a physically modelled engine (AudioWorklet), turbo, transmission,
// tyres and surfaces, stones, wind, impacts, crowds, weather, the co-driver
// over the helmet intercom, and menu music.
import { clamp } from './util.js';

// ---- Engine worklet ----------------------------------------------------------
// Each cylinder firing launches an exhaust pressure pulse; pulses run through
// a pair of pipe resonators (feedback combs with damping) and a load-dependent
// muffler. An intake roar is shaped by the same firing rhythm. Lifting off at
// high revs makes the exhaust pop and crackle; anti-lag bangs arrive as events.
const WORKLET = `
class Engine extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rpm = 900; this.load = 0; this.tRpm = 900; this.tLoad = 0; this.cut = 0; this.boost = 0;
    this.phase = 0; this.lastFire = 0; this.pulses = [];
    this.cyl = [1.0, 0.86, 0.95, 0.8];
    this.d1 = new Float32Array(4096); this.d2 = new Float32Array(4096); this.i1 = 0; this.i2 = 0;
    this.lp1 = 0; this.lp2 = 0; this.muf = 0; this.muf2 = 0; this.hp = 0; this.hpx = 0;
    this.intake = 0; this.inLp = 0; this.inBp1 = 0; this.inBp2 = 0;
    this.crackle = 0; this.bangs = [];
    this.voice = 0; // 0 turbo four, 1 NA high-revving four
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.rpm !== undefined) { this.tRpm = d.rpm; this.tLoad = d.load; this.cut = d.cut; this.boost = d.boost; this.crackleRate = d.crackle || 0; }
      if (d.voice !== undefined) this.voice = d.voice;
      if (d.bang) this.bangs.push({ t: 0, a: d.bang });
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const sr = sampleRate, dt = 1 / sr;
    const na = this.voice === 1;
    // Pipe lengths (samples): primary runner and the long system to the tailpipe.
    const L1 = Math.floor(sr * (na ? 0.0042 : 0.0058)), L2 = Math.floor(sr * (na ? 0.0105 : 0.0138));
    for (let n = 0; n < out.length; n++) {
      this.rpm += (this.tRpm - this.rpm) * 0.0016;
      this.load += (this.tLoad - this.load) * 0.004;
      const rps = this.rpm / 60;
      this.phase += rps * dt * 2; // two firings per revolution (4-cyl, 4-stroke)
      if (this.phase >= 1) {
        this.phase -= 1;
        const c = (this.lastFire = (this.lastFire + 1) % 4);
        const misfire = this.cut > 0.5 && Math.random() < 0.85;
        if (!misfire) {
          const a = (0.22 + 0.78 * this.load) * this.cyl[c] * (0.93 + Math.random() * 0.14);
          const width = Math.max(0.00045, 0.16 / (rps * 2 + 20));
          this.pulses.push({ t: 0, a, w: width, nz: 0.1 + this.load * 0.22 });
        }
        // Overrun: unburnt fuel popping in a hot exhaust.
        if (this.load < 0.1 && this.rpm > 3200 && Math.random() < this.crackleRate * 0.2) this.pulses.push({ t: 0, a: 0.25 + Math.random() * 0.5, w: 0.0014, nz: 1.4, pop: 1 });
      }
      // Sum the active pulses.
      let x = 0;
      for (let k = this.pulses.length - 1; k >= 0; k--) {
        const p = this.pulses[k];
        const u = p.t / p.w;
        const env = u * Math.exp(1 - u);
        x += p.a * env * (1 + (Math.random() * 2 - 1) * p.nz);
        p.t += dt;
        if (p.t > p.w * 9) this.pulses.splice(k, 1);
      }
      for (let k = this.bangs.length - 1; k >= 0; k--) {
        const b = this.bangs[k];
        const env = Math.exp(-b.t * 38) * (b.t < 0.002 ? b.t / 0.002 : 1);
        x += b.a * env * (Math.random() * 2 - 1) * 3.5 + b.a * env * Math.sin(b.t * 2 * Math.PI * 70) * 2.5;
        b.t += dt;
        if (b.t > 0.2) this.bangs.splice(k, 1);
      }
      // Pipe resonances: damped feedback combs.
      const r1 = this.d1[(this.i1 - L1 + 4096) & 4095], r2 = this.d2[(this.i2 - L2 + 4096) & 4095];
      this.lp1 += (r1 - this.lp1) * 0.45; this.lp2 += (r2 - this.lp2) * 0.3;
      const y1 = x + this.lp1 * -0.42;
      const y2 = y1 * 0.7 + this.lp2 * 0.48;
      this.d1[this.i1] = y1; this.i1 = (this.i1 + 1) & 4095;
      this.d2[this.i2] = y2; this.i2 = (this.i2 + 1) & 4095;
      // Muffler: darker off-throttle, brighter and louder under load.
      const fc = (na ? 1400 : 900) + this.load * (na ? 4200 : 3000) + this.rpm * 0.12;
      const g = 1 - Math.exp(-2 * Math.PI * fc / sr);
      this.muf += (y2 - this.muf) * g; this.muf2 += (this.muf - this.muf2) * g;
      let ex = this.muf2 * 1.4 + (y2 - this.muf2) * (0.08 + this.load * 0.12);
      // Intake roar: noise through a resonant band, pulsed by the induction strokes.
      const nz = Math.random() * 2 - 1;
      const f0 = (na ? 1100 : 700) + this.rpm * (na ? 0.18 : 0.12);
      const w0 = 2 * Math.PI * f0 / sr, q = 3.2;
      const alpha = Math.sin(w0) / (2 * q);
      const hpIn = nz - this.inLp; this.inLp += hpIn * 0.02;
      this.inBp1 += alpha * (hpIn - this.inBp1) - 0.0; // cheap band: two one-poles
      this.inBp2 += alpha * (this.inBp1 - this.inBp2);
      const pulse = 0.5 + 0.5 * Math.cos(this.phase * 2 * Math.PI);
      const intake = (this.inBp1 - this.inBp2) * (0.15 + 0.85 * pulse) * this.load * (0.4 + this.rpm / 9000) * (na ? 3.8 : 2.4);
      let s = ex * 0.9 + intake;
      // DC block and soft saturation.
      const hpY = s - this.hpx + 0.995 * this.hp; this.hpx = s; this.hp = hpY;
      s = Math.tanh(hpY * (0.9 + this.load * 0.35)) * 0.62;
      out[n] = s;
    }
    for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
    return true;
  }
}
registerProcessor('rally-engine', Engine);
`;

export class Audio {
  constructor() {
    this.ctx = null; this.ready = false; this.voiceClips = null; this.voiceQueue = []; this.speaking = 0;
    this.settings = { master: 0.9, engine: 1, codriver: 1, music: 0.6 };
  }

  async init() {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain(); this.master.gain.value = this.settings.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.carBus = ctx.createGain(); this.carBus.connect(this.sfx);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.settings.music * 0.5; this.musicBus.connect(this.master);
    // Reverb (outdoor slap from trees and banks).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.6, 2.8);
    const rv = ctx.createGain(); rv.gain.value = 0.22;
    this.reverb.connect(rv).connect(this.sfx);
    this.noiseBuf = this.makeNoise(2);
    this.brownBuf = this.makeNoise(2, true);
    this.tink = this.makeTink();
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      this.engineNode = new AudioWorkletNode(ctx, 'rally-engine', { outputChannelCount: [1] });
    } catch (e) {
      console.warn('AudioWorklet unavailable, using fallback engine', e);
      this.engineNode = null;
    }
    this.buildCarVoices();
    this.ready = true;
  }

  makeNoise(sec, brown = false) {
    const ctx = this.ctx, n = ctx.sampleRate * sec, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  impulse(sec, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * sec, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // A few early reflections then a diffuse tail.
        const early = (i === Math.floor(0.031 * ctx.sampleRate * (c + 1)) || i === Math.floor(0.077 * ctx.sampleRate)) ? 0.6 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.5 + early) * (t < 0.01 ? t / 0.01 : 1);
      }
    }
    return b;
  }
  makeTink() {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * 0.08), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    const f1 = 3100, f2 = 4700;
    for (let i = 0; i < n; i++) { const t = i / ctx.sampleRate; d[i] = (Math.sin(2 * Math.PI * f1 * t) * 0.6 + Math.sin(2 * Math.PI * f2 * t) * 0.4 + (Math.random() * 2 - 1) * 0.5 * Math.exp(-t * 300)) * Math.exp(-t * 60); }
    return b;
  }
  loopNoise(brown = false) { const s = this.ctx.createBufferSource(); s.buffer = brown ? this.brownBuf : this.noiseBuf; s.loop = true; s.start(); return s; }
  filter(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

  buildCarVoices() {
    const ctx = this.ctx;
    const V = (this.v = {});
    // Engine.
    V.engGain = this.gain(0);
    if (this.engineNode) {
      const hp = this.filter('highpass', 55, 0.7);
      const eq = this.filter('peaking', 180, 0.9); eq.gain.value = 3;
      const rasp = this.filter('peaking', 1500, 1.2); rasp.gain.value = 3;
      this.engineNode.connect(hp).connect(eq).connect(rasp).connect(V.engGain);
    } else {
      // Fallback: layered oscillators.
      V.fo = [ctx.createOscillator(), ctx.createOscillator()];
      V.fo[0].type = 'sawtooth'; V.fo[1].type = 'square';
      const lp = this.filter('lowpass', 1200, 2);
      V.fo.forEach((o) => { o.connect(lp); o.start(); });
      lp.connect(V.engGain);
      V.foLp = lp;
    }
    V.engGain.connect(this.carBus);
    V.engGain.connect(this.reverb);
    // Turbo whistle and hiss.
    V.turbo = ctx.createOscillator(); V.turbo.type = 'sine'; V.turbo.frequency.value = 2000;
    V.turboFm = ctx.createOscillator(); V.turboFm.frequency.value = 37; const fmG = this.gain(25); V.turboFm.connect(fmG).connect(V.turbo.frequency);
    V.turboG = this.gain(0); V.turbo.connect(V.turboG).connect(this.carBus);
    V.turbo.start(); V.turboFm.start();
    V.hiss = this.loopNoise(); V.hissF = this.filter('bandpass', 5200, 1.5); V.hissG = this.gain(0);
    V.hiss.connect(V.hissF).connect(V.hissG).connect(this.carBus);
    // Straight-cut gearbox whine.
    V.whine = ctx.createOscillator(); V.whine.type = 'sawtooth';
    V.whineF = this.filter('bandpass', 1000, 6); V.whineG = this.gain(0);
    V.whine.connect(V.whineF).connect(V.whineG).connect(this.carBus); V.whine.start();
    // Tyres on the surface: roll (low rumble), crunch (loose), squeal (tarmac).
    V.roll = this.loopNoise(true); V.rollF = this.filter('lowpass', 300, 0.7); V.rollG = this.gain(0);
    V.roll.connect(V.rollF).connect(V.rollG).connect(this.carBus);
    V.crunch = this.loopNoise(); V.crunchF = this.filter('bandpass', 1400, 0.8); V.crunchG = this.gain(0);
    V.crunchAM = this.gain(1);
    V.crunch.connect(V.crunchF).connect(V.crunchAM).connect(V.crunchG).connect(this.carBus);
    V.crunchLfo = ctx.createOscillator(); V.crunchLfo.frequency.value = 23; V.crunchLfo.type = 'square';
    const lfoG = this.gain(0.35); V.crunchLfo.connect(lfoG).connect(V.crunchAM.gain); V.crunchLfo.start();
    V.squeal = this.loopNoise(); V.squealF = this.filter('bandpass', 1050, 14); V.squealG = this.gain(0);
    V.squeal.connect(V.squealF).connect(V.squealG).connect(this.carBus);
    V.squealT = ctx.createOscillator(); V.squealT.frequency.value = 980; V.squealTG = this.gain(0);
    V.squealT.connect(V.squealTG).connect(this.carBus); V.squealT.start();
    // Wind.
    V.wind = this.loopNoise(); V.windF = this.filter('lowpass', 600, 0.6); V.windG = this.gain(0);
    V.wind.connect(V.windF).connect(V.windG).connect(this.sfx);
    // Water wash.
    V.water = this.loopNoise(); V.waterF = this.filter('bandpass', 900, 0.6); V.waterG = this.gain(0);
    V.water.connect(V.waterF).connect(V.waterG).connect(this.carBus);
    // Ambience: forest air, rain or snow wind.
    V.amb = this.loopNoise(true); V.ambF = this.filter('bandpass', 400, 0.4); V.ambG = this.gain(0);
    V.amb.connect(V.ambF).connect(V.ambG).connect(this.sfx);
    V.rain = this.loopNoise(); V.rainF = this.filter('highpass', 2500, 0.5); V.rainG = this.gain(0);
    V.rain.connect(V.rainF).connect(V.rainG).connect(this.sfx);
    // Crowd.
    V.crowd = this.loopNoise(); V.crowdF = this.filter('bandpass', 1100, 1.2); V.crowdG = this.gain(0);
    V.crowd.connect(V.crowdF).connect(V.crowdG).connect(this.sfx);
    this.stoneAcc = 0; this.birdT = 2;
  }

  setVoice(spec) {
    if (this.engineNode) this.engineNode.port.postMessage({ voice: spec.turbo ? 0 : 1 });
    this.turboAmt = spec.turbo ? 1 : 0;
  }

  // Called each frame with the car's state.
  updateCar(car, dt, opts = {}) {
    if (!this.ready) return;
    const V = this.v, t = this.ctx.currentTime;
    const set = (p, v, k = 0.05) => p.setTargetAtTime(v, t, k);
    const spec = car.spec;
    const rpm = car.rpm, load = car.load, speed = car.speed;
    const crackle = spec.turbo ? 0.35 : 0.18;
    const duck = this.speaking > 0 ? 0.68 : 1;
    if (this.engineNode) this.engineNode.port.postMessage({ rpm, load, cut: car.limiter > 0 || car.shiftTimer > 0 ? 1 : 0, boost: car.boost, crackle });
    else {
      V.fo[0].frequency.setTargetAtTime(rpm / 60 * 2, t, 0.02); V.fo[1].frequency.setTargetAtTime(rpm / 60, t, 0.02);
      V.foLp.frequency.setTargetAtTime(600 + load * 2000, t, 0.05);
    }
    const ext = opts.interior ? 0.85 : 1;
    set(V.engGain.gain, (0.42 + load * 0.4) * this.settings.engine * duck * ext, 0.03);
    // Turbo
    const b = car.boost * (this.turboAmt || 0);
    set(V.turbo.frequency, 1800 + b * 5200 + rpm * 0.2, 0.05);
    set(V.turboG.gain, b * b * 0.028 * duck, 0.05);
    set(V.hissG.gain, b * 0.05 * (0.4 + load) * duck, 0.05);
    // Gearbox whine follows road speed in each gear.
    const gearShaft = Math.abs(car.drivenOmega()) * Math.abs(car.ratio() || 1) / car.spec.final;
    set(V.whine.frequency, 60 + gearShaft * 3.1, 0.03);
    set(V.whineF.frequency, 200 + gearShaft * 6.2, 0.03);
    set(V.whineG.gain, Math.min(1, speed / 20) * (0.012 + load * 0.02) * duck, 0.05);
    // Surfaces
    let loose = 0, tarmac = 0, slipAvg = 0, water = 0, n = 0, snow = 0;
    for (const w of car.wheels) {
      if (!w.contact) continue;
      n++;
      const s = w.surface;
      if (s === 'tarmac') tarmac++; else if (s === 'water') water++; else { loose++; if (s.includes('snow') || s === 'ice') snow++; }
      slipAvg += Math.min(1, w.slip / 7);
    }
    slipAvg = n ? slipAvg / n : 0;
    const sp = Math.min(1, speed / 35);
    set(V.rollG.gain, n ? (0.06 + sp * 0.22) * (loose ? 1 : 0.6) : 0, 0.05);
    set(V.rollF.frequency, 160 + speed * 9, 0.1);
    set(V.crunchG.gain, n ? (loose / 4) * (0.02 + sp * 0.07 + slipAvg * 0.22) * (snow ? 0.6 : 1) : 0, 0.04);
    set(V.crunchF.frequency, snow ? 2400 : 1300 + slipAvg * 900, 0.1);
    V.crunchLfo.frequency.setTargetAtTime(12 + speed * 0.9, t, 0.1);
    const sq = tarmac / 4 * Math.max(0, slipAvg - 0.18) * 1.6;
    set(V.squealG.gain, Math.min(0.35, sq * 0.55), 0.04);
    set(V.squealTG.gain, Math.min(0.06, sq * 0.06), 0.04);
    set(V.squealT.frequency, 900 + slipAvg * 260 + Math.sin(t * 13) * 30, 0.03);
    set(V.windG.gain, Math.min(0.32, speed * speed * 0.00018), 0.1);
    set(V.windF.frequency, 300 + speed * 18, 0.1);
    set(V.waterG.gain, water ? Math.min(0.5, speed * 0.03) : 0, 0.04);
    // Stones rattling the underbody on gravel.
    if (loose && !snow && speed > 4) {
      this.stoneAcc += dt * speed * (0.12 + slipAvg * 0.5);
      while (this.stoneAcc > 1) { this.stoneAcc -= Math.random() * 2; this.one(this.tink, 0.02 + Math.random() * 0.05, 0.7 + Math.random() * 0.8, this.carBus); }
    }
    // Ambience.
    set(V.ambG.gain, opts.stage?.weather === 'snow' ? 0.05 : 0.025, 0.5);
    set(V.rainG.gain, opts.stage?.weather === 'rain' ? 0.07 : 0, 0.5);
    set(V.crowdG.gain, (opts.crowd || 0) * 0.22, 0.15);
    set(V.crowdF.frequency, 900 + (opts.crowd || 0) * 600 + Math.sin(t * 2.3) * 200, 0.1);
    // Birdsong in daylight forest stages.
    if (opts.stage && !opts.stage.night && opts.stage.weather !== 'rain' && opts.stage.surface !== 'snow') {
      this.birdT -= dt;
      if (this.birdT < 0) { this.birdT = 1.5 + Math.random() * 5; this.bird(); }
    }
  }

  silenceCar() {
    if (!this.ready) return;
    const V = this.v, t = this.ctx.currentTime;
    for (const g of [V.engGain, V.turboG, V.hissG, V.whineG, V.rollG, V.crunchG, V.squealG, V.squealTG, V.windG, V.waterG, V.crowdG, V.ambG, V.rainG]) g.gain.setTargetAtTime(0, t, 0.08);
  }

  one(buf, vol, rate = 1, dest = this.sfx) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = this.gain(vol); s.connect(g).connect(dest); s.start();
  }

  noiseBurst({ f = 1000, q = 1, type = 'bandpass', vol = 0.3, dur = 0.2, attack = 0.002, sweep = 0, dest = this.sfx, delay = 0, rev = false }) {
    if (!this.ready || vol <= 0.0005) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const fl = this.filter(type, f, q);
    if (sweep) fl.frequency.exponentialRampToValueAtTime(Math.max(40, f * sweep), t + dur);
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(dest);
    if (rev) g.connect(this.reverb);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone({ f = 440, type = 'sine', vol = 0.2, dur = 0.2, attack = 0.005, slide = 0, dest = this.sfx, delay = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  // ---- Event sounds ---------------------------------------------------------
  backfire(big) {
    if (!this.ready) return;
    if (this.engineNode) this.engineNode.port.postMessage({ bang: big ? 1.0 : 0.45 });
    else this.noiseBurst({ f: 300, q: 0.7, type: 'lowpass', vol: big ? 0.6 : 0.3, dur: 0.12, rev: true });
    if (big) this.noiseBurst({ f: 2500, q: 0.5, vol: 0.12, dur: 0.06 });
  }
  blowOff(amount) {
    // "Pssshh" then a chattering flutter.
    this.noiseBurst({ f: 3800, q: 1.2, vol: 0.16 * amount, dur: 0.38, attack: 0.01, sweep: 0.35, dest: this.carBus });
    for (let i = 0; i < 5; i++) this.noiseBurst({ f: 1400, q: 2, vol: 0.06 * amount * (1 - i / 5), dur: 0.035, delay: 0.05 + i * 0.045, dest: this.carBus });
  }
  shift() {
    this.noiseBurst({ f: 220, q: 1.5, vol: 0.12, dur: 0.06, dest: this.carBus });
    this.tone({ f: 95, vol: 0.12, dur: 0.07, dest: this.carBus });
  }
  impact(strength, kind) {
    const s = clamp(strength, 0.05, 1);
    this.noiseBurst({ f: 180, q: 0.6, type: 'lowpass', vol: 0.6 * s, dur: 0.25 + s * 0.3, rev: true });
    this.tone({ f: 70, vol: 0.5 * s, dur: 0.3, slide: 0.5 });
    // Metal crunch: a few resonant bands.
    for (const f of [620, 1240, 2300, 3700]) this.noiseBurst({ f: f * (0.85 + Math.random() * 0.3), q: 9, vol: 0.18 * s, dur: 0.18 + s * 0.4, rev: true });
    if (kind === 'tree') this.noiseBurst({ f: 900, q: 2, vol: 0.25 * s, dur: 0.5, delay: 0.03 });
    if (s > 0.55) for (let i = 0; i < 8; i++) this.tone({ f: 3000 + Math.random() * 4000, vol: 0.05, dur: 0.12, delay: 0.05 + Math.random() * 0.35 }); // glass
  }
  scrape(v) { this.noiseBurst({ f: 2600, q: 3, vol: Math.min(0.25, v * 0.05), dur: 0.15 }); }
  landing(strength) {
    this.tone({ f: 55, vol: 0.5 * strength, dur: 0.25, slide: 0.6, dest: this.carBus });
    this.noiseBurst({ f: 160, q: 0.8, type: 'lowpass', vol: 0.4 * strength, dur: 0.2 });
    this.noiseBurst({ f: 1600, q: 0.6, vol: 0.12 * strength, dur: 0.4, delay: 0.02 }); // gravel scatter
  }
  splash(v) { this.noiseBurst({ f: 1200, q: 0.4, vol: Math.min(0.6, v * 0.03), dur: 0.8, attack: 0.01 }); }
  beep(hi) { this.tone({ f: hi ? 1320 : 660, type: 'square', vol: 0.12, dur: hi ? 0.5 : 0.18 }); }
  ui(kind) {
    if (!this.ready) return;
    if (kind === 'move') this.tone({ f: 1500, type: 'triangle', vol: 0.04, dur: 0.05 });
    else if (kind === 'select') { this.tone({ f: 900, type: 'triangle', vol: 0.06, dur: 0.08 }); this.tone({ f: 1800, type: 'triangle', vol: 0.05, dur: 0.12, delay: 0.05 }); }
    else if (kind === 'back') this.tone({ f: 700, type: 'triangle', vol: 0.05, dur: 0.1, slide: 0.6 });
  }
  bird() {
    const f = 2600 + Math.random() * 2400, n = 2 + Math.floor(Math.random() * 5), d = 0.06 + Math.random() * 0.05;
    for (let i = 0; i < n; i++) this.tone({ f: f * (1 + (Math.random() - 0.5) * 0.2), vol: 0.008 + Math.random() * 0.01, dur: d, slide: 0.75 + Math.random() * 0.5, delay: i * (d + 0.03) });
  }
  cheer(v) {
    // A swell of voices plus a whistle or two.
    this.noiseBurst({ f: 900, q: 0.9, vol: 0.12 * v, dur: 1.8, attack: 0.3, rev: true });
    this.noiseBurst({ f: 1800, q: 2, vol: 0.06 * v, dur: 1.2, attack: 0.2 });
    if (Math.random() < 0.7) this.tone({ f: 2400, vol: 0.05 * v, dur: 0.5, slide: 1.4, delay: 0.2 });
  }

  // ---- Co-driver -------------------------------------------------------------
  async loadVoice(name) {
    if (!this.ctx) return;
    this.voiceName = name;
    const { default: clips } = await import(`../assets/voice/${name}.js`);
    const out = {};
    await Promise.all(Object.entries(clips).map(async ([k, b64]) => {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      try { out[k] = await this.ctx.decodeAudioData(bytes.buffer); } catch (e) { /* skip */ }
    }));
    this.voiceClips = out;
    if (!this.intercom) {
      // Helmet intercom: band-limited, a little gritty, tightly compressed.
      const ctx = this.ctx;
      const hp = this.filter('highpass', 300, 0.7), pk = this.filter('peaking', 2400, 1); pk.gain.value = 5;
      const lp = this.filter('lowpass', 4800, 0.7);
      const sh = ctx.createWaveShaper();
      const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
      sh.curve = curve;
      const cp = ctx.createDynamicsCompressor(); cp.threshold.value = -24; cp.ratio.value = 6; cp.attack.value = 0.002; cp.release.value = 0.1;
      this.intercom = this.gain(1.2);
      this.intercom.connect(hp).connect(pk).connect(sh).connect(lp).connect(cp).connect(this.master);
    }
    return out;
  }

  // Speak a list of words back-to-back; returns the scheduled duration.
  say(words, { priority = false, rate = 1 } = {}) {
    if (!this.ready || !this.voiceClips || this.settings.codriver <= 0) return 0;
    const ctx = this.ctx;
    let t = Math.max(ctx.currentTime + 0.02, priority ? ctx.currentTime + 0.02 : this.voiceEnd || 0);
    const start = t;
    for (const w of words) {
      const buf = this.voiceClips[w];
      if (!buf) continue;
      const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
      const g = this.gain(this.settings.codriver);
      s.connect(g).connect(this.intercom);
      s.start(t);
      t += buf.duration / rate - 0.06;
    }
    this.voiceEnd = t;
    const dur = t - start;
    this.speaking++;
    setTimeout(() => { this.speaking = Math.max(0, this.speaking - 1); }, (t - ctx.currentTime) * 1000);
    return dur;
  }
  voiceBusyFor() { return this.ctx ? Math.max(0, (this.voiceEnd || 0) - this.ctx.currentTime) : 0; }

  // ---- Menu music: a moody, driving synth groove -------------------------------
  startMusic() {
    if (!this.ready || this.music) return;
    const ctx = this.ctx;
    const bpm = 112, beat = 60 / bpm;
    const out = this.gain(0); out.connect(this.musicBus);
    out.gain.setTargetAtTime(1, ctx.currentTime, 1.2);
    const delay = ctx.createDelay(); delay.delayTime.value = beat * 0.75; const fb = this.gain(0.32); const dl = this.filter('lowpass', 2500);
    delay.connect(dl).connect(fb).connect(delay); dl.connect(out);
    const chords = [[45, 57, 60, 64], [41, 53, 57, 60], [48, 55, 60, 64], [43, 55, 59, 62]];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    let step = 0, next = ctx.currentTime + 0.1;
    const music = { stopped: false, out };
    const tick = () => {
      if (music.stopped) return;
      while (next < ctx.currentTime + 0.25) {
        const bar = Math.floor(step / 16), chord = chords[bar % 4], s = step % 16;
        // Kick, hats, clap.
        if (s % 4 === 0) { const o = ctx.createOscillator(); const g = this.gain(0); o.frequency.setValueAtTime(140, next); o.frequency.exponentialRampToValueAtTime(42, next + 0.12); g.gain.setValueAtTime(0.5, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.3); o.connect(g).connect(out); o.start(next); o.stop(next + 0.32); }
        if (s % 2 === 1) { const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; const f = this.filter('highpass', 8000); const g = this.gain(0); g.gain.setValueAtTime(s % 4 === 3 ? 0.06 : 0.03, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.05); src.connect(f).connect(g).connect(out); src.start(next, Math.random()); src.stop(next + 0.06); }
        if (s === 4 || s === 12) { const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; const f = this.filter('bandpass', 1600, 0.8); const g = this.gain(0); g.gain.setValueAtTime(0.16, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.18); src.connect(f).connect(g).connect(out); g.connect(delay); src.start(next, Math.random()); src.stop(next + 0.2); }
        // Bass: syncopated root.
        if ([0, 3, 6, 8, 10, 14].includes(s)) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(chord[0] - 12 + (s === 14 ? 12 : 0));
          const f = this.filter('lowpass', 300, 4); f.frequency.setValueAtTime(900, next); f.frequency.exponentialRampToValueAtTime(180, next + beat * 0.45);
          const g = this.gain(0); g.gain.setValueAtTime(0.18, next); g.gain.exponentialRampToValueAtTime(0.001, next + beat * 0.5);
          o.connect(f).connect(g).connect(out); o.start(next); o.stop(next + beat * 0.55);
        }
        // Pad on each bar, arpeggio pluck on 8ths.
        if (s === 0) for (const m of chord.slice(1)) for (const det of [-6, 6]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
          const f = this.filter('lowpass', 1100, 0.5); const g = this.gain(0);
          g.gain.setValueAtTime(0.0001, next); g.gain.linearRampToValueAtTime(0.025, next + beat * 1.5); g.gain.linearRampToValueAtTime(0.0001, next + beat * 4);
          o.connect(f).connect(g).connect(out); o.start(next); o.stop(next + beat * 4 + 0.05);
        }
        if (s % 2 === 0 && bar % 8 >= 2) {
          const m = chord[1 + ((s / 2) % 3)] + 12;
          const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m);
          const g = this.gain(0); g.gain.setValueAtTime(0.05, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.22);
          o.connect(g).connect(out); g.connect(delay); o.start(next); o.stop(next + 0.25);
        }
        step++; next += beat / 4;
      }
      music.timer = setTimeout(tick, 60);
    };
    tick();
    this.music = music;
  }
  stopMusic() {
    if (!this.music) return;
    const m = this.music; this.music = null; m.stopped = true; clearTimeout(m.timer);
    m.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    setTimeout(() => m.out.disconnect(), 2500);
  }
  setVolumes() {
    if (!this.ready) return;
    this.master.gain.value = this.settings.master;
    this.musicBus.gain.value = this.settings.music * 0.5;
  }
}
