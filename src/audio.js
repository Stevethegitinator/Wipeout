// WebAudio sound engine: layered jet engines with stereo position and
// Doppler, synthesised weapon and impact effects, a rail-grind voice, reverb,
// and the procedural soundtrack (see music.js). Everything is generated here.
import { Music, makeImpulse } from './music.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Per-team engine character: base pitch and how much turbine whine vs. roar.
const ENGINE_VOICE = {
  kestrel: { pitch: 1.15, whine: 1.0, roar: 0.8 },
  nova: { pitch: 0.95, whine: 0.7, roar: 1.1 },
  halcyon: { pitch: 1.3, whine: 1.2, roar: 0.6 },
  orion: { pitch: 0.8, whine: 0.6, roar: 1.3 },
};

export const MENU_MUSIC = { seed: 7, bpm: 112, root: 45, style: 'menu' };

export class Audio {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.55;
    this.sfxVol = 0.8;
    this.engines = new Map();
    this.listener = { pos: { x: 0, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
  }

  // `offline` lets tests render into an OfflineAudioContext.
  init(offline = null) {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !offline) this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC && !offline) return;
    const ctx = this.ctx = offline || new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVol * 0.6; this.musicBus.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.master);
    this.engineBus = ctx.createGain(); this.engineBus.gain.value = 0.9; this.engineBus.connect(this.sfx);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Effects reverb for explosions and impacts.
    this.verb = ctx.createConvolver();
    this.verb.buffer = makeImpulse(ctx, 1.8, 2.5);
    this.verbSend = ctx.createGain(); this.verbSend.gain.value = 0.5;
    this.verbSend.connect(this.verb).connect(this.sfx);
    this.distCurve = (() => {
      const n = 1024, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 4); }
      return c;
    })();
    this.music = new Music(ctx, this.musicBus, this.noiseBuf);
    if (this.pendingMusic) { const m = this.pendingMusic; this.pendingMusic = null; this.startMusic(m); }
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(music * 0.6, this.ctx.currentTime, 0.05);
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
  }

  // Camera position, right vector and velocity, for panning and Doppler.
  setListener(pos, right, vel) {
    this.listener.pos = pos; this.listener.right = right; this.listener.vel = vel;
  }

  // Stereo position of a world point relative to the listener: [-1, 1].
  panFor(pos) {
    if (!pos) return 0;
    const l = this.listener;
    const dx = pos.x - l.pos.x, dy = pos.y - l.pos.y, dz = pos.z - l.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    return Math.max(-1, Math.min(1, (dx * l.right.x + dy * l.right.y + dz * l.right.z) / d)) * Math.min(1, d / 6);
  }

  // ---- building blocks ----------------------------------------------------
  out(pan = 0, verb = 0) {
    const c = this.ctx;
    const g = c.createGain();
    const p = c.createStereoPanner(); p.pan.value = pan;
    g.connect(p).connect(this.sfx);
    if (verb) { const s = c.createGain(); s.gain.value = verb; g.connect(s).connect(this.verbSend); }
    return g;
  }

  noise(dest, t, dur, type, f0, f1, gain, q = 1, attack = 0.002) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  tone(dest, t, type, f0, f1, dur, gain, attack = 0.002) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  // Frequency-modulated zap: carrier swept with a fast modulator.
  fm(dest, t, f0, f1, ratio, index, dur, gain) {
    const c = this.ctx;
    const car = c.createOscillator(); car.type = 'sine';
    const mod = c.createOscillator(); mod.type = 'sine';
    const mg = c.createGain();
    car.frequency.setValueAtTime(f0, t); car.frequency.exponentialRampToValueAtTime(f1, t + dur);
    mod.frequency.setValueAtTime(f0 * ratio, t); mod.frequency.exponentialRampToValueAtTime(f1 * ratio, t + dur);
    mg.gain.setValueAtTime(f0 * index, t); mg.gain.exponentialRampToValueAtTime(Math.max(1, f1 * index * 0.3), t + dur);
    mod.connect(mg).connect(car.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g).connect(dest);
    car.start(t); mod.start(t); car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
  }

  // Struck metal: inharmonic partials with individual decays.
  clang(dest, t, base, gain, decay = 0.8) {
    for (const [r, a, dk] of [[1, 1, 1], [2.76, 0.6, 0.7], [5.4, 0.4, 0.5], [8.93, 0.25, 0.35], [13.3, 0.15, 0.25]]) {
      this.tone(dest, t, 'sine', base * r, base * r * 0.995, decay * dk, gain * a);
    }
  }

  // ---- one-shot effects ---------------------------------------------------
  play(name, vol = 1, pos = null) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, v = vol;
    const pan = this.panFor(pos);
    const o = (verb = 0) => this.out(pan, verb);
    switch (name) {
      // menus and race cues
      case 'menu': this.tone(o(), t, 'triangle', 1320, 1300, 0.05, 0.12 * v); this.tone(o(), t, 'sine', 2640, 2600, 0.03, 0.05 * v); break;
      case 'select': [0, 7, 12].forEach((n, i) => this.tone(o(0.2), t + i * 0.04, 'triangle', mtof(79 + n), mtof(79 + n), 0.14, 0.12 * v)); break;
      case 'back': [12, 5, 0].forEach((n, i) => this.tone(o(0.2), t + i * 0.04, 'triangle', mtof(74 + n), mtof(74 + n), 0.12, 0.1 * v)); break;
      case 'beep': this.tone(o(0.3), t, 'square', 880, 880, 0.3, 0.14 * v); this.tone(o(), t, 'sine', 440, 440, 0.3, 0.2 * v); break;
      case 'go': this.tone(o(0.3), t, 'square', 1760, 1760, 0.7, 0.14 * v); this.tone(o(), t, 'sine', 880, 880, 0.8, 0.2 * v); break;
      case 'lap': [0, 4, 7, 12].forEach((n, i) => this.tone(o(0.3), t + i * 0.07, 'triangle', mtof(76 + n), mtof(76 + n), 0.25, 0.14 * v)); break;
      case 'finish': [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(o(0.4), t + i * 0.08, 'triangle', mtof(72 + n), mtof(72 + n), 0.5, 0.13 * v)); break;
      case 'warn': this.tone(o(), t, 'square', 1000, 1000, 0.08, 0.08 * v); break;
      case 'pickup': {
        const d = o(0.3);
        [0, 7, 12, 19].forEach((n, i) => this.tone(d, t + i * 0.045, 'triangle', mtof(76 + n), mtof(76 + n), 0.18, 0.13 * v));
        this.noise(d, t, 0.25, 'highpass', 6000, 9000, 0.05 * v);
        break;
      }
      case 'speedpad': {
        const d = o(0.25);
        this.noise(d, t, 0.7, 'bandpass', 300, 5000, 0.45 * v, 1.2, 0.05);
        this.tone(d, t, 'sawtooth', 120, 600, 0.5, 0.08 * v, 0.03);
        this.fm(d, t, 400, 1600, 1.5, 2, 0.35, 0.08 * v);
        break;
      }
      // impacts
      case 'wall': {
        const d = o(0.35);
        this.noise(d, t, 0.35, 'lowpass', 2500, 150, 0.7 * v);
        this.clang(d, t, 310 + Math.random() * 60, 0.22 * v, 0.9);
        this.tone(d, t, 'sine', 90, 40, 0.25, 0.5 * v);
        break;
      }
      case 'land': {
        const d = o(0.2);
        this.tone(d, t, 'sine', 70, 35, 0.3, 0.7 * v);
        this.noise(d, t, 0.25, 'lowpass', 900, 100, 0.5 * v);
        this.clang(d, t, 180, 0.08 * v, 0.4);
        break;
      }
      case 'explode': {
        const d = o(0.7);
        const sh = c.createWaveShaper(); sh.curve = this.distCurve; sh.connect(d);
        this.noise(sh, t, 1.4, 'lowpass', 3500, 60, 0.9 * v, 0.7);
        this.tone(d, t, 'sine', 110, 28, 0.9, 0.9 * v);
        // debris crackle
        for (let k = 0; k < 10; k++) this.noise(d, t + 0.05 + Math.random() * 0.6, 0.05, 'highpass', 3000 + Math.random() * 3000, 2000, 0.12 * v);
        break;
      }
      case 'shieldblock': this.fm(o(0.4), t, 900, 600, 2.01, 3, 0.4, 0.15 * v); break;
      // weapons
      case 'rocket': {
        const d = o(0.3);
        this.noise(d, t, 0.06, 'highpass', 2000, 2000, 0.5 * v);
        for (let k = 0; k < 3; k++) {
          this.noise(d, t + k * 0.03, 0.9, 'bandpass', 2500, 400, 0.35 * v, 1.5, 0.01);
          this.tone(d, t + k * 0.03, 'sawtooth', 180, 60, 0.4, 0.06 * v);
        }
        break;
      }
      case 'missile': {
        const d = o(0.3);
        this.tone(d, t, 'sine', 120, 45, 0.25, 0.5 * v);
        this.noise(d, t, 1.4, 'bandpass', 600, 4500, 0.35 * v, 2, 0.08);
        this.tone(d, t + 0.05, 'sawtooth', 300, 1200, 1.2, 0.06 * v, 0.1);
        this.fm(d, t + 0.05, 1500, 2600, 1.01, 0.8, 1.2, 0.03 * v);
        break;
      }
      case 'mine': {
        const d = o(0.25);
        this.clang(d, t, 520, 0.12 * v, 0.35);
        this.tone(d, t, 'sine', 160, 80, 0.15, 0.4 * v);
        this.tone(d, t + 0.08, 'square', 1800, 1800, 0.04, 0.05 * v);
        break;
      }
      case 'shock': {
        const d = o(0.8);
        this.tone(d, t, 'sine', 160, 25, 1.2, 0.9 * v);
        this.noise(d, t, 1.3, 'lowpass', 6000, 80, 0.5 * v, 0.8);
        this.fm(d, t, 1200, 90, 0.5, 6, 0.9, 0.12 * v);
        break;
      }
      case 'bolt': {
        const d = o(0.4);
        for (let k = 0; k < 6; k++) {
          const tt = t + k * 0.045 + Math.random() * 0.02;
          this.fm(d, tt, 2400 + Math.random() * 1500, 300, 3.7, 4, 0.12, 0.09 * v);
          this.noise(d, tt, 0.04, 'highpass', 5000, 5000, 0.2 * v);
        }
        this.tone(d, t, 'sawtooth', 60, 50, 0.4, 0.1 * v);
        break;
      }
      case 'cannon': {
        const d = o(0.1);
        this.noise(d, t, 0.07, 'bandpass', 2200, 700, 0.6 * v, 1.2);
        this.tone(d, t, 'square', 260, 70, 0.06, 0.12 * v);
        this.tone(d, t, 'sine', 120, 50, 0.08, 0.3 * v);
        break;
      }
      case 'plasma': {
        const d = o(0.5);
        this.tone(d, t, 'sawtooth', 80, 640, 0.25, 0.15 * v, 0.2); // charge
        const sh = c.createWaveShaper(); sh.curve = this.distCurve; sh.connect(d);
        this.tone(sh, t + 0.22, 'sawtooth', 220, 55, 0.7, 0.2 * v);
        this.fm(d, t + 0.22, 800, 120, 1.5, 5, 0.6, 0.12 * v);
        this.noise(d, t + 0.22, 0.6, 'bandpass', 1500, 300, 0.3 * v, 2);
        break;
      }
      case 'emp': {
        const d = o(0.8);
        this.fm(d, t, 3000, 60, 0.25, 8, 1.1, 0.25 * v);
        this.tone(d, t, 'sine', 140, 30, 1.0, 0.7 * v);
        for (let k = 0; k < 14; k++) this.noise(d, t + Math.random() * 0.9, 0.03, 'highpass', 6000, 6000, 0.15 * v);
        break;
      }
      case 'well': {
        const d = o(0.6);
        const og = this.tone(d, t, 'sine', 55, 40, 2.2, 0.35 * v, 0.2);
        const lfo = c.createOscillator(); lfo.frequency.value = 7;
        const lg = c.createGain(); lg.gain.value = 12; lfo.connect(lg).connect(og.frequency); lfo.start(t); lfo.stop(t + 2.3);
        this.fm(d, t, 300, 90, 0.5, 3, 1.5, 0.08 * v);
        break;
      }
      case 'shield': {
        const d = o(0.6);
        [0, 4, 7, 11].forEach((n, i) => this.tone(d, t + i * 0.03, 'sine', mtof(72 + n), mtof(84 + n), 0.9, 0.06 * v, 0.05));
        this.noise(d, t, 0.8, 'highpass', 4000, 9000, 0.08 * v, 1, 0.1);
        break;
      }
      case 'turbo': {
        const d = o(0.4);
        this.noise(d, t, 1.6, 'bandpass', 200, 7000, 0.6 * v, 1.5, 0.05);
        this.tone(d, t, 'sawtooth', 70, 300, 1.2, 0.12 * v, 0.05);
        this.tone(d, t, 'sine', 50, 50, 0.4, 0.5 * v);
        break;
      }
      case 'scrape': break; // replaced by the continuous grind voice
    }
  }

  // ---- continuous engine voice per craft ----------------------------------
  // id, team id, speed, thrust 0..1, boost flag, volume, world pos and velocity.
  engine(id, teamId, speed, thrust, boost, vol, pos, vel) {
    const ctx = this.ctx; if (!ctx) return;
    let e = this.engines.get(id);
    if (!e) e = this.makeEngine(id, ENGINE_VOICE[teamId] || ENGINE_VOICE.kestrel);
    const t = ctx.currentTime;
    // Doppler from relative radial velocity (scaled so it's audible but not silly).
    let dop = 1;
    if (pos && vel && vol < 1) {
      const l = this.listener;
      const dx = pos.x - l.pos.x, dy = pos.y - l.pos.y, dz = pos.z - l.pos.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const vr = ((vel.x - l.vel.x) * dx + (vel.y - l.vel.y) * dy + (vel.z - l.vel.z) * dz) / d;
      dop = Math.max(0.7, Math.min(1.35, 1 / (1 + vr / 600)));
    }
    const v = e.voice, p = v.pitch * dop;
    const s = Math.min(1.6, speed / 120);
    e.whineA.frequency.setTargetAtTime((380 + s * 1200) * p, t, 0.08);
    e.whineB.frequency.setTargetAtTime((380 + s * 1200) * p * 2.02, t, 0.08);
    e.core.frequency.setTargetAtTime((38 + s * 60 + thrust * 10) * p, t, 0.06);
    e.core2.frequency.setTargetAtTime((38 + s * 60 + thrust * 10) * p * 1.498, t, 0.06);
    e.coreF.frequency.setTargetAtTime(180 + thrust * 900 + s * 600, t, 0.1);
    e.roarF.frequency.setTargetAtTime((300 + s * 1400 + thrust * 600) * dop, t, 0.1);
    e.whineG.gain.setTargetAtTime(vol * v.whine * (0.012 + s * 0.03), t, 0.08);
    e.coreG.gain.setTargetAtTime(vol * (0.06 + thrust * 0.08), t, 0.08);
    e.roarG.gain.setTargetAtTime(vol * v.roar * (0.02 + thrust * 0.06 + s * 0.05), t, 0.1);
    e.burnG.gain.setTargetAtTime(boost ? vol * 0.22 : 0, t, boost ? 0.03 : 0.15);
    e.pan.pan.setTargetAtTime(vol < 1 ? this.panFor(pos) : 0, t, 0.05);
  }

  makeEngine(id, voice) {
    const c = this.ctx;
    const pan = c.createStereoPanner();
    pan.connect(this.engineBus);
    // turbine whine
    const whineA = c.createOscillator(); whineA.type = 'sine';
    const whineB = c.createOscillator(); whineB.type = 'triangle';
    const whineG = c.createGain(); whineG.gain.value = 0;
    whineA.connect(whineG); whineB.connect(whineG); whineG.connect(pan);
    // combustion core: detuned saws into a resonant lowpass, softly driven
    const core = c.createOscillator(); core.type = 'sawtooth';
    const core2 = c.createOscillator(); core2.type = 'sawtooth';
    const coreF = c.createBiquadFilter(); coreF.type = 'lowpass'; coreF.Q.value = 5;
    const coreSh = c.createWaveShaper(); coreSh.curve = this.distCurve;
    const coreG = c.createGain(); coreG.gain.value = 0;
    core.connect(coreF); core2.connect(coreF); coreF.connect(coreSh).connect(coreG).connect(pan);
    // air roar
    const roar = c.createBufferSource(); roar.buffer = this.noiseBuf; roar.loop = true;
    const roarF = c.createBiquadFilter(); roarF.type = 'bandpass'; roarF.Q.value = 0.7;
    const roarG = c.createGain(); roarG.gain.value = 0;
    roar.connect(roarF).connect(roarG).connect(pan);
    // afterburner crackle: noise chopped by a fast random square
    const burn = c.createBufferSource(); burn.buffer = this.noiseBuf; burn.loop = true; burn.playbackRate.value = 0.7;
    const burnF = c.createBiquadFilter(); burnF.type = 'lowpass'; burnF.frequency.value = 2200;
    const chop = c.createGain(); chop.gain.value = 0.5;
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 31;
    const lfoG = c.createGain(); lfoG.gain.value = 0.5; lfo.connect(lfoG).connect(chop.gain);
    const burnG = c.createGain(); burnG.gain.value = 0;
    burn.connect(burnF).connect(chop).connect(burnG).connect(pan);
    for (const n of [whineA, whineB, core, core2, roar, burn, lfo]) n.start();
    const e = { voice, pan, whineA, whineB, whineG, core, core2, coreF, coreG, roar, roarF, roarG, burn, burnG, lfo, nodes: [whineA, whineB, core, core2, roar, burn, lfo] };
    this.engines.set(id, e);
    return e;
  }

  stopEngines() {
    for (const e of this.engines.values()) {
      for (const n of e.nodes) { try { n.stop(); } catch { /* already stopped */ } }
      e.pan.disconnect();
    }
    this.engines.clear();
    if (this.grindNode) this.grindNode.g.gain.value = 0;
  }

  // ---- rail grind ------------------------------------------------------------
  // Metal-on-metal: noise through ringing resonators, distorted, with spark crackle.
  grind(level, speed = 0) {
    const ctx = this.ctx; if (!ctx) return;
    if (!this.grindNode) {
      const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const sum = ctx.createGain();
      const res = [1700, 2950, 4600, 7100].map((f, i) => {
        const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = 18 - i * 3;
        const g = ctx.createGain(); g.gain.value = [1, 0.8, 0.6, 0.4][i];
        n.connect(b).connect(g).connect(sum);
        return b;
      });
      const body = ctx.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 900;
      const bodyG = ctx.createGain(); bodyG.gain.value = 0.35;
      n.connect(body).connect(bodyG).connect(sum);
      const sh = ctx.createWaveShaper(); sh.curve = this.distCurve;
      const crackle = ctx.createGain(); crackle.gain.value = 1;
      const g = ctx.createGain(); g.gain.value = 0;
      sum.connect(sh).connect(crackle).connect(g).connect(this.sfx);
      const send = ctx.createGain(); send.gain.value = 0.25; g.connect(send).connect(this.verbSend);
      n.start();
      this.grindNode = { n, res, g, crackle, was: 0 };
    }
    const gn = this.grindNode, t = ctx.currentTime;
    if (level > 0 && gn.was === 0) this.clang(this.out(0, 0.3), t, 420 + Math.random() * 80, 0.15 * level, 0.6); // first contact
    gn.was = level;
    gn.g.gain.setTargetAtTime(level * 0.16, t, level > 0 ? 0.015 : 0.06);
    const s = Math.min(1.5, speed / 120);
    gn.res.forEach((b, i) => b.frequency.setTargetAtTime([1700, 2950, 4600, 7100][i] * (0.8 + s * 0.35) * (1 + (Math.random() - 0.5) * 0.04), t, 0.03));
    gn.crackle.gain.setValueAtTime(0.55 + Math.random() * 0.9, t); // sparks: random amplitude flutter
  }

  // ---- music ---------------------------------------------------------------
  startMusic(cfg) {
    if (!this.ctx) { this.pendingMusic = cfg; return; }
    if (this.currentMusic === cfg && this.music.playing) return;
    this.stopMusic();
    this.currentMusic = cfg;
    // brief fade so tracks don't cut in harshly
    const g = this.musicBus.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(this.musicVol * 0.6, t + 1.2);
    this.music.start(cfg, t + 0.15);
    this.musicTimer = setInterval(() => this.music.schedule(this.ctx.currentTime + 0.2), 30);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.music) this.music.stop();
    this.currentMusic = null;
  }
}
