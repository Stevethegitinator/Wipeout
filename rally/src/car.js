// Rally car physics: a rigid body on four raycast suspension struts with a
// combined-slip tyre model, a turbocharged engine with a sequential gearbox,
// limited-slip differentials, a hydraulic handbrake that unlocks the centre
// diff, body collisions with the ground (rollovers) and with trees and rocks,
// and mechanical damage.
//
// Car space: +Z forward, +Y up, +X left. Steering input +1 = turn right.
import * as THREE from '../../vendor/three.module.min.js';
import { SURFACES } from './stages.js';
import { clamp, lerp, smoothstep, rng } from './util.js';

export const DT = 1 / 240;
const G = 9.81;
const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), _n = V(), _r = V(), _f = V(), _l = V(), _up = V(), _fw = V(), _left = V();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m3 = new THREE.Matrix3();

function curve(rho, fall) {
  // Normalised tyre force vs normalised slip: rises to 1 at the peak and
  // decays toward `fall` when sliding.
  if (rho < 1) return Math.sin(rho * Math.PI / 2) * (1.05 - 0.05 * rho);
  return 1 - (1 - fall) * smoothstep(1, 3.2, rho);
}

export class Car {
  constructor(spec, road, opts = {}) {
    this.spec = spec;
    this.road = road;
    this.wet = !!road.stage.wet;
    const m = (this.mass = spec.mass + 160); // + crew and fuel
    const L = 4.3, W = 1.78, H = 1.25;
    // Inertia (body frame), a little under a solid box because mass is low and central.
    this.I = new THREE.Vector3((m / 12) * (H * H + L * L) * 0.85, (m / 12) * (W * W + L * L) * 0.85, (m / 12) * (W * W + H * H) * 0.9);
    this.invI = new THREE.Vector3(1 / this.I.x, 1 / this.I.y, 1 / this.I.z);
    this.pos = V(); this.vel = V(); this.ang = V(); this.quat = new THREE.Quaternion();
    this.wheelbase = spec.body === 'classic' || spec.body === 'hatch' ? 2.45 : 2.55;
    const wb = this.wheelbase, frontW = spec.drive === 'rwd' ? 0.52 : spec.drive === 'fwd' ? 0.6 : 0.55; // fraction of weight on front axle (centre of mass ahead of mid)
    const zf = wb * (1 - frontW), zr = -wb * frontW;
    const tw = 0.76;
    this.R = 0.315;
    this.wheels = [
      { mount: new THREE.Vector3(tw, 0.06, zf), front: true, left: true },
      { mount: new THREE.Vector3(-tw, 0.06, zf), front: true, left: false },
      { mount: new THREE.Vector3(tw, 0.06, zr), front: false, left: true },
      { mount: new THREE.Vector3(-tw, 0.06, zr), front: false, left: false },
    ].map((w) => Object.assign(w, {
      len: 0.25, prevLen: 0.25, omega: 0, angle: 0, load: 0, contact: false, slip: 0, slipLat: 0, slipLong: 0,
      surface: 'gravel', point: V(), normal: V(0, 1, 0), steer: 0, Fx: 0, Fy: 0, vLong: 0, vLat: 0, hit: 0, puncture: false,
    }));
    this.restLen = 0.34;
    this.k = 37000; this.cBump = 2500; this.cReb = 3900;
    this.arb = [15000, 11000];
    // Drivetrain
    this.gear = 1; this.rpm = spec.idle; this.throttle = 0; this.brake = 0; this.handbrake = 0; this.steer = 0; this.steerAngle = 0;
    this.clutch = 1; this.shiftTimer = 0; this.shiftCool = 0; this.boost = 0; this.limiter = 0; this.reverseHold = 0;
    this.autoGear = opts.autoGear !== false;
    this.assist = opts.assist ?? 0;
    this.rand = rng(opts.seed ?? 12345);
    this.engineInertia = 0.16;
    this.lsd = { front: 90, rear: 160, centre: 220 };
    // Body sample points for ground and obstacle contact (car space).
    const bx = 0.86, by0 = -0.18, by1 = 0.78, bz = 2.12;
    this.bodyPts = [];
    for (const z of [bz, bz * 0.45, -bz * 0.45, -bz]) for (const x of [bx, -bx]) this.bodyPts.push(new THREE.Vector3(x, by0, z));
    for (const z of [1.2, -1.0]) for (const x of [0.62, -0.62]) this.bodyPts.push(new THREE.Vector3(x, by1, z)); // roof corners
    this.bodyPts.push(new THREE.Vector3(0, by1 + 0.05, 0.1));
    this.sidePts = [];
    for (const z of [2.15, 1.3, 0, -1.3, -2.15]) for (const x of [0.9, -0.9]) this.sidePts.push(new THREE.Vector3(x, 0.2, z));
    this.sidePts.push(new THREE.Vector3(0, 0.2, 2.25), new THREE.Vector3(0, 0.2, -2.25));
    // State & telemetry
    this.damage = { engine: 0, gearbox: 0, suspension: 0, steering: 0, body: 0, radiator: 0 };
    this.events = []; // {type, ...} consumed by audio/fx each frame
    this.airTime = 0; this.onGround = false; this.upsideTime = 0; this.speed = 0; this.slipAngle = 0;
    this.s = 0; this.lastS = 0; this.u = 0; this.surfaceName = 'gravel';
    this.odometer = 0; this.dirt = 0; this.backfireCd = 0; this.liftTimer = 0;
    this.drift = 0; this.sideImpact = 0;
    this.q = {};
  }

  // Place the car on the road at distance s, pointing along it.
  place(s, lateral = 0) {
    const f = this.road.frameAt(s);
    const x = f.x + f.rx * lateral, z = f.z + f.rz * lateral;
    const y = this.road.height(x, z);
    this.pos.set(x, y + 0.53, z);
    this.quat.setFromAxisAngle(_a.set(0, 1, 0), f.h);
    this.vel.set(0, 0, 0); this.ang.set(0, 0, 0);
    for (const w of this.wheels) { w.omega = 0; w.len = w.prevLen = 0.25; }
    this.rpm = this.spec.idle; this.gear = 1; this.boost = 0; this.upsideTime = 0;
    this.s = this.lastS = s;
  }

  torqueAt(rpm) {
    const t = this.spec.torque, i = clamp(rpm / 1000, 0, t.length - 1.001);
    const k = Math.floor(i);
    return lerp(t[k], t[k + 1], i - k);
  }

  ratio(g = this.gear) { return g < 0 ? -3.6 * this.spec.final : g === 0 ? 0 : this.spec.gears[g - 1] * this.spec.final; }

  // input: { throttle 0..1, brake 0..1, steer -1..1, handbrake 0..1, shiftUp, shiftDown }
  update(input, dt) {
    this._acc = (this._acc || 0) + Math.min(dt, 0.05);
    while (this._acc >= DT) { this.step(input, DT); this._acc -= DT; }
    this.postFrame(dt);
  }

  step(input, dt) {
    const spec = this.spec, dmg = this.damage;
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    _fw.set(0, 0, 1).applyQuaternion(this.quat);
    _left.set(1, 0, 0).applyQuaternion(this.quat);
    const fwdSpeed = this.vel.dot(_fw);
    this.speed = this.vel.length();

    // ---- Driver inputs -------------------------------------------------
    let thr = input.throttle, brk = input.brake;
    // Brake to a stop, keep holding, and the gearbox drops into reverse.
    if (this.gear > 0 && fwdSpeed < 0.8 && brk > 0.5 && thr < 0.1) {
      this.reverseHold += dt;
      if (this.reverseHold > 0.35 && this.autoGear) { this.gear = -1; this.reverseHold = 0; }
    } else if (this.gear < 0 && fwdSpeed > -0.8 && thr > 0.5 && brk < 0.1) {
      this.reverseHold += dt;
      if (this.reverseHold > 0.15) { this.gear = 1; this.reverseHold = 0; }
    } else this.reverseHold = 0;
    if (this.gear < 0) { const t = thr; thr = brk; brk = t; }
    this.throttle = thr; this.brake = brk; this.handbrake = input.handbrake;

    // Steering: fast rack, lock narrows with speed but opens up for counter-steer in a slide.
    const vf = Math.max(0, fwdSpeed);
    const baseLock = lerp(0.58, 0.16, smoothstep(2, 38, vf));
    const slideRoom = Math.min(0.5, Math.abs(this.slipAngle) * 0.85);
    const maxLock = baseLock + slideRoom;
    const steerPull = dmg.steering * 0.06;
    // Drift assist: the front wheels drift toward the direction of travel
    // (auto counter-steer), fading out when the driver steers into the slide.
    let assistSteer = 0;
    if (this.assist > 0 && fwdSpeed > 4) {
      const into = Math.sign(input.steer) === Math.sign(this.slipAngle) ? 0 : 1; // player already counter-steering?
      assistSteer = -this.slipAngle * 0.55 * this.assist * (0.4 + 0.6 * into) * (1 - Math.abs(input.steer) * 0.5);
    }
    const target = clamp(input.steer, -1, 1) * maxLock + steerPull + assistSteer;
    const rate = 3.2 + (Math.abs(target) < Math.abs(this.steerAngle) ? 2.2 : 0);
    this.steerAngle += clamp(target - this.steerAngle, -rate * dt, rate * dt);

    // Gear changes
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) { this.gear = this.pendingGear; this.events.push({ type: 'shiftDone', gear: this.gear }); }
    } else if (this.gear > 0) {
      const ng = spec.gears.length;
      this.shiftCool -= dt;
      if (this.autoGear && this.shiftCool <= 0) {
        const toRpm = 60 / (2 * Math.PI * this.R);
        const wheelRpm = this.drivenOmega() * this.ratio() * 60 / (2 * Math.PI);
        // Down-shifts follow road speed so wheelspin doesn't make the box hunt.
        const groundRpm = Math.max(0, fwdSpeed) * this.ratio() * toRpm;
        const up = spec.redline - 250, down = spec.redline * 0.5;
        if (wheelRpm > up && groundRpm > up * 0.8 && this.gear < ng && this.clutch > 0.95) this.shift(this.gear + 1);
        else if (this.gear > 1) {
          const lower = Math.max(0, fwdSpeed) * this.ratio(this.gear - 1) * toRpm;
          if (groundRpm < down && lower < spec.redline - 1100) this.shift(this.gear - 1);
        }
      }
      if (input.shiftUp && this.gear < ng) this.shift(this.gear + 1);
      if (input.shiftDown && this.gear > 1) this.shift(this.gear - 1);
    }

    // ---- Engine ----------------------------------------------------------
    const ratio = this.shiftTimer > 0 ? 0 : this.ratio();
    const wheelRpm = Math.abs(this.drivenOmega() * ratio) * 60 / (2 * Math.PI);
    // Clutch slips from rest so the engine can rev up for a launch.
    const launchRpm = lerp(spec.idle * 1.2, spec.redline * 0.5, thr);
    let engineRpm;
    if (ratio === 0) {
      this.clutch = 0;
      this.rpm += ((spec.idle + thr * (spec.redline - spec.idle)) - this.rpm) * Math.min(1, dt * (thr > 0.1 ? 9 : 5));
      engineRpm = this.rpm;
    } else if (wheelRpm < launchRpm) {
      this.clutch = clamp(wheelRpm / launchRpm, 0.3, 1);
      const free = launchRpm;
      this.rpm += (free - this.rpm) * Math.min(1, dt * 10);
      engineRpm = this.rpm;
    } else { this.clutch = 1; this.rpm = wheelRpm; engineRpm = wheelRpm; }
    this.rpm = Math.max(this.rpm, spec.idle * 0.9);
    // Rev limiter: hard cut, bounces off the redline.
    if (this.rpm > spec.redline) this.limiter = 0.07;
    if (this.limiter > 0) this.limiter -= dt;
    const firing = this.limiter <= 0 && this.shiftTimer <= 0;
    // Turbo spools with load and rpm; lag is part of the character.
    if (spec.turbo) {
      const tgt = firing ? thr * smoothstep(2200, 4600, engineRpm) : 0;
      const k = tgt > this.boost ? 1.6 + 2.2 * this.boost : 4;
      const was = this.boost;
      this.boost += (tgt - this.boost) * Math.min(1, dt * k);
      if (was > 0.55 && tgt < 0.2 && !this._bov) { this.events.push({ type: 'bov', amount: was }); this._bov = true; }
      if (tgt > 0.4) this._bov = false;
    }
    const boostMul = spec.turbo ? 0.62 + 0.38 * this.boost + 0.08 * spec.turbo * this.boost : 1;
    const health = 1 - 0.35 * dmg.engine;
    let Teng = firing ? this.torqueAt(engineRpm) * thr * boostMul * health : 0;
    const Tbrake = (12 + engineRpm * 0.0075) * (1 - thr);
    Teng -= Tbrake;
    this.engineTorque = Teng;
    this.load = firing ? thr : 0;
    // Anti-lag / overrun bangs when lifting at high revs.
    if (thr < 0.15 && engineRpm > spec.redline * 0.55 && this.liftTimer < 0.9) {
      this.liftTimer += dt;
      this.backfireCd -= dt;
      if (this.backfireCd <= 0 && this.rand() < dt * (spec.turbo ? 14 : 7)) {
        this.events.push({ type: 'backfire', big: this.rand() < 0.3 });
        this.backfireCd = 0.06;
      }
    } else if (thr > 0.3) this.liftTimer = 0;
    if (!firing && this.limiter > 0 && this.rand() < dt * 20) this.events.push({ type: 'backfire', big: false });

    // Drive torque at the wheels.
    const effRatio = ratio * 0.9;
    const Tdrive = Teng * effRatio * (ratio !== 0 ? this.clutch : 0);
    const drv = spec.drive;
    let fShare = drv === 'fwd' ? 1 : drv === 'rwd' ? 0 : 1 - spec.split;
    const hbCut = input.handbrake > 0.3 && drv === 'awd';
    if (hbCut) fShare = 1; // hydraulic handbrake opens the centre clutch
    const T = [Tdrive * fShare / 2, Tdrive * fShare / 2, Tdrive * (1 - fShare) / 2, Tdrive * (1 - fShare) / 2];
    // Limited-slip: torque moves from the faster wheel to the slower one.
    const W = this.wheels;
    const lsdPair = (a, b, k) => {
      const d = (W[a].omega - W[b].omega) * k;
      T[a] -= d; T[b] += d;
    };
    if (fShare > 0) lsdPair(0, 1, this.lsd.front);
    if (fShare < 1) lsdPair(2, 3, this.lsd.rear);
    if (drv === 'awd' && !hbCut) {
      const d = ((W[0].omega + W[1].omega) - (W[2].omega + W[3].omega)) * 0.5 * this.lsd.centre;
      T[0] -= d / 2; T[1] -= d / 2; T[2] += d / 2; T[3] += d / 2;
    }
    const driven = [drv !== 'rwd', drv !== 'rwd', drv !== 'fwd', drv !== 'fwd'];
    const nDriven = drv === 'awd' ? 4 : 2;
    const reflected = ratio !== 0 && this.clutch > 0.99 ? this.engineInertia * ratio * ratio / nDriven : 0;

    // ---- Wheels ------------------------------------------------------------
    const force = _e.set(0, -G * this.mass, 0);
    const torque = _d.set(0, 0, 0);
    let grounded = 0;
    const road = this.road, q = this.q;
    const brakeF = 2100 * brk, brakeR = 1350 * brk, hb = 3200 * input.handbrake;
    // Pass 1: suspension.
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      const mount = _a.copy(w.mount).applyQuaternion(this.quat).add(this.pos);
      const px = mount.x - _up.x * 0.3, pz = mount.z - _up.z * 0.3;
      road.nearest(px, pz, 64, q);
      const gh = road.height(px, pz, q);
      road.normal(px, pz, w.normal);
      w.surface = road.surface(q);
      const denom = _up.dot(w.normal);
      let len = this.restLen + 0.08;
      w.contact = false;
      if (denom > 0.3) {
        // Distance from the mount to the ground plane through (px, gh, pz), less the tyre radius.
        const n = w.normal;
        const dp = (mount.x - px) * n.x + (mount.y - gh) * n.y + (mount.z - pz) * n.z;
        len = (dp - this.R) / denom;
        if (len < this.restLen) w.contact = true;
      }
      len = clamp(len, 0.02, this.restLen + 0.08);
      const lenVel = (len - w.prevLen) / dt;
      w.prevLen = len; w.len = len;
      w.comp = w.contact ? this.restLen - len : 0;
      if (!w.contact) { w.Fs = 0; continue; }
      grounded++;
      const damp = lenVel < 0 ? this.cBump : this.cReb;
      let Fs = this.k * w.comp - damp * lenVel;
      if (len < 0.07) Fs += 260000 * (0.07 - len); // bump stop
      Fs *= 1 - 0.25 * this.damage.suspension * (i % 2);
      w.Fs = Fs;
      w.point.copy(mount).addScaledVector(_up, -(len + this.R));
    }
    // Anti-roll bars: the more compressed side pushes up harder, the other side less.
    for (let ax = 0; ax < 2; ax++) {
      const a = ax * 2, b = a + 1;
      const diff = (W[a].comp - W[b].comp) * this.arb[ax];
      if (W[a].contact) W[a].Fs += diff;
      if (W[b].contact) W[b].Fs -= diff;
    }
    // Pass 2: tyres.
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      const Iw = 1.1 + (driven[i] ? reflected : 0);
      if (!w.contact) {
        w.load = 0; w.slip = 0; w.slipLat = 0; w.slipLong = 0; w.Fx = w.Fy = 0;
        // Free wheel: drive torque spins it up, brakes slow it.
        w.omega += (driven[i] ? T[i] : 0) / Iw * dt;
        const bt = (w.front ? brakeF : brakeR + hb) * dt / Iw;
        w.omega = Math.abs(w.omega) <= bt ? 0 : w.omega - Math.sign(w.omega) * bt;
        w.omega *= 1 - 0.3 * dt;
        continue;
      }
      const Fs = Math.max(0, w.Fs);
      const _n2 = w.normal;
      _r.subVectors(w.point, this.pos);
      // Contact velocity.
      const vc = _b.copy(this.ang).cross(_r).add(this.vel);
      // Tyre axes on the ground plane.
      const steer = w.front ? -this.steerAngle : 0;
      w.steer = steer;
      _f.copy(_fw);
      if (steer) _f.applyAxisAngle(_up, steer);
      _f.addScaledVector(_n2, -_f.dot(_n2)).normalize();
      _l.crossVectors(_n2, _f);
      const vLong = vc.dot(_f), vLat = vc.dot(_l);
      w.vLong = vLong; w.vLat = vLat;
      const sf = SURFACES[w.surface === 'gravel' && this.wet ? 'gravel_wet' : w.surface === 'tarmac' && this.wet ? 'tarmac_wet' : w.surface] || SURFACES.gravel;
      const load = Fs;
      w.load = load;
      const nominal = this.mass * G / 4;
      let mu = sf.mu * (1 - 0.08 * (Math.min(load / nominal, 2.5) - 1));
      if (w.puncture) mu *= 0.55;
      mu *= 1 - 0.15 * this.damage.suspension;
      // Slip.
      const sr = (w.omega * this.R - vLong) / Math.max(Math.abs(vLong), 3);
      const alpha = Math.atan2(vLat, Math.abs(vLong) + 0.6);
      const peakA = sf.peak * 0.85, peakS = sf.peak * 0.75;
      const sN = sr / peakS, aN = alpha / peakA;
      const rho = Math.hypot(sN, aN);
      let Fx = 0, Fy = 0;
      if (rho > 1e-5) {
        const F = mu * load * curve(rho, sf.fall);
        Fx = F * sN / rho;
        Fy = -F * aN / rho * 1.04;
      }
      // Stability: never apply more force than would reverse the slip this step.
      const mShare = this.mass / 4;
      const maxFy = Math.abs(vLat) * mShare / dt;
      if (Math.abs(Fy) > maxFy) Fy = Math.sign(Fy) * maxFy;
      const slipV = w.omega * this.R - vLong;
      const maxFx = 0.9 * Math.abs(slipV) / (dt * (this.R * this.R / Iw + 1 / mShare));
      if (Math.abs(Fx) > maxFx) Fx = Math.sign(Fx) * maxFx;
      // Rolling resistance and loose-surface drag (deep gravel / snow ploughing).
      const roll = sf.roll * load * Math.sign(vLong) * Math.min(1, Math.abs(vLong));
      w.Fx = Fx; w.Fy = Fy;
      w.slipLong = sr; w.slipLat = alpha;
      w.slip = Math.hypot(slipV, vLat);
      // Wheel spin dynamics.
      w.omega += ((driven[i] ? T[i] : 0) - Fx * this.R) / Iw * dt;
      const bt = (w.front ? brakeF : brakeR + hb) * dt / Iw;
      w.omega = Math.abs(w.omega) <= bt ? 0 : w.omega - Math.sign(w.omega) * bt;
      // Apply to body: suspension along the strut, tyre forces in the ground plane.
      const F = _c.copy(_up).multiplyScalar(Fs).addScaledVector(_f, Fx - roll).addScaledVector(_l, Fy);
      force.add(F);
      torque.add(_a.copy(_r).cross(F));
    }
    this.onGround = grounded > 0;
    // Aerodynamics.
    const v2 = this.speed * this.speed;
    if (this.speed > 0.1) force.addScaledVector(this.vel, -0.5 * 1.2 * 0.82 * this.speed);
    force.addScaledVector(_up, -0.5 * 1.2 * 0.45 * v2 * (grounded ? 1 : 0.3));
    // Water: heavy drag through a splash.
    if (W.some((w) => w.contact && w.surface === 'water')) force.addScaledVector(this.vel, -this.mass * 0.3);

    // Stability assist: past ~25 degrees of slide, damp any yaw that would make it worse.
    if (this.assist > 0 && grounded >= 3 && this.speed > 6) {
      const sa = this.slipAngle, yaw = this.ang.dot(_up);
      const excess = Math.max(0, Math.abs(sa) - 0.42);
      // Positive slip angle grows when the body yaws right (negative yaw rate about up).
      const worsening = Math.sign(sa) === -Math.sign(yaw) ? Math.abs(yaw) : 0;
      if (excess > 0 && worsening > 0) torque.addScaledVector(_up, Math.sign(sa) * Math.min(excess * 9000, 2600) * this.assist * Math.min(1, worsening * 2));
    }
    // Body vs ground (roofs, bumpers, rollovers).
    this.bodyGround(force, torque);
    // Integrate (semi-implicit Euler).
    this.vel.addScaledVector(force, dt / this.mass);
    // Torque to body frame, apply inverse inertia, back to world.
    const tl = _a.copy(torque).applyQuaternion(_q.copy(this.quat).invert());
    tl.x *= this.invI.x; tl.y *= this.invI.y; tl.z *= this.invI.z;
    tl.applyQuaternion(this.quat);
    this.ang.addScaledVector(tl, dt);
    // Air: tiny damping. Ground: a little yaw damping keeps it sane at low speed.
    this.ang.multiplyScalar(1 - (grounded ? 0.15 : 0.05) * dt);
    this.pos.addScaledVector(this.vel, dt);
    const w = this.ang.length();
    if (w > 1e-6) {
      _q.setFromAxisAngle(_a.copy(this.ang).divideScalar(w), w * dt);
      this.quat.premultiply(_q).normalize();
    }
    this.obstacles();
    for (const ww of W) ww.angle += ww.omega * dt;
  }

  drivenOmega() {
    const W = this.wheels, d = this.spec.drive;
    if (d === 'fwd') return (W[0].omega + W[1].omega) / 2;
    if (d === 'rwd') return (W[2].omega + W[3].omega) / 2;
    return (W[0].omega + W[1].omega + W[2].omega + W[3].omega) / 4;
  }

  shift(g) {
    if (this.shiftTimer > 0) return;
    this.pendingGear = g;
    this.shiftTimer = 0.085 + this.damage.gearbox * 0.25;
    this.shiftCool = 0.55;
    this.events.push({ type: 'shift', from: this.gear, to: g });
  }

  bodyGround(force, torque) {
    const road = this.road;
    let hit = 0;
    for (const p of this.bodyPts) {
      const wp = _a.copy(p).applyQuaternion(this.quat).add(this.pos);
      if (wp.y > this.pos.y + 0.2 && _up.y > 0.5) continue; // roof points only matter when tipped
      const gh = road.height(wp.x, wp.z);
      const depth = gh - wp.y;
      if (depth <= 0) continue;
      road.normal(wp.x, wp.z, _n);
      _r.subVectors(wp, this.pos);
      const vp = _b.copy(this.ang).cross(_r).add(this.vel);
      const vn = vp.dot(_n);
      const Fn = Math.max(0, 160000 * depth - 9000 * vn);
      const vt = _c.copy(vp).addScaledVector(_n, -vn);
      const vtl = vt.length();
      const F = _f.copy(_n).multiplyScalar(Fn);
      if (vtl > 0.01) F.addScaledVector(vt, -Math.min(0.7 * Fn, vtl * this.mass * 30) / vtl);
      force.add(F);
      torque.add(_r.clone().cross(F));
      hit = Math.max(hit, -vn);
    }
    if (hit > 3.5 && !this._scraping) {
      this.events.push({ type: 'impact', strength: Math.min(1, hit / 12), ground: true });
      this.addDamage(hit, 'body');
    }
    this._scraping = hit > 0.5;
  }

  obstacles() {
    const obs = this.road.obstacles;
    if (!obs) return;
    const list = obs.near(this.pos.x, this.pos.z);
    if (!list.length) return;
    for (const p of this.sidePts) {
      const wp = _a.copy(p).applyQuaternion(this.quat).add(this.pos);
      for (const o of list) {
        const dx = wp.x - o.x, dz = wp.z - o.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > o.r * o.r) continue;
        if (wp.y > o.y + o.h || wp.y < o.y - 1) continue;
        const d = Math.sqrt(d2) || 0.001;
        _n.set(dx / d, 0, dz / d);
        const pen = o.r - d;
        _r.subVectors(wp, this.pos);
        const vp = _b.copy(this.ang).cross(_r).add(this.vel);
        const vn = vp.dot(_n);
        // Push out.
        this.pos.addScaledVector(_n, pen * 0.9);
        if (vn >= 0) continue;
        // Impulse with rotation.
        const rn = _c.crossVectors(_r, _n);
        const rnl = rn.clone().applyQuaternion(_q.copy(this.quat).invert());
        rnl.x *= this.invI.x; rnl.y *= this.invI.y; rnl.z *= this.invI.z;
        rnl.applyQuaternion(this.quat);
        const k = 1 / this.mass + rnl.clone().cross(_r).dot(_n);
        const e = o.bouncy ? 0.35 : 0.18;
        const j = -(1 + e) * vn / k;
        const J = _f.copy(_n).multiplyScalar(j);
        // Friction along the obstacle surface.
        const vt = vp.clone().addScaledVector(_n, -vn);
        if (vt.lengthSq() > 0.01) J.addScaledVector(vt.normalize(), -Math.min(0.35 * j, vt.length() * this.mass * 0.2));
        this.vel.addScaledVector(J, 1 / this.mass);
        const dw = _r.clone().cross(J).applyQuaternion(_q.copy(this.quat).invert());
        dw.x *= this.invI.x; dw.y *= this.invI.y; dw.z *= this.invI.z;
        this.ang.add(dw.applyQuaternion(this.quat));
        const strength = -vn;
        if (strength > 1.5) {
          this.events.push({ type: 'impact', strength: Math.min(1, strength / 14), obstacle: o.kind, x: wp.x, y: wp.y, z: wp.z, local: p.clone() });
          this.addDamage(strength, p.z > 1 ? 'front' : p.z < -1 ? 'rear' : 'side', p);
          if (o.kind === 'post' || o.kind === 'bale' || o.kind === 'cone') o.hit = true;
        }
      }
    }
  }

  addDamage(v, where, p) {
    if (v < 4) return;
    const a = Math.min(0.35, (v - 4) * 0.025);
    const d = this.damage;
    d.body = Math.min(1, d.body + a);
    if (where === 'front') { d.radiator = Math.min(1, d.radiator + a * 0.8); d.engine = Math.min(1, d.engine + a * 0.4); d.steering = Math.min(1, d.steering + a * 0.6); }
    else if (where === 'side') { d.suspension = Math.min(1, d.suspension + a * 0.7); d.steering = Math.min(1, d.steering + a * 0.3); }
    else if (where === 'rear') { d.gearbox = Math.min(1, d.gearbox + a * 0.4); d.suspension = Math.min(1, d.suspension + a * 0.3); }
    else d.suspension = Math.min(1, d.suspension + a * 0.3);
    if (p && v > 11 && this.rand() < 0.35) {
      const w = this.wheels[(p.x > 0 ? 0 : 1) + (p.z > 0 ? 0 : 2)];
      if (!w.puncture) { w.puncture = true; this.events.push({ type: 'puncture' }); }
    }
    this.events.push({ type: 'damage', amount: a, where });
  }

  postFrame(dt) {
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    _fw.set(0, 0, 1).applyQuaternion(this.quat);
    const q = this.road.nearest(this.pos.x, this.pos.z, 80, this.q);
    if (q.i >= 0) { this.lastS = this.s; this.s = q.s; this.u = q.u; this.roadDist = q.d - q.w; }
    else { this.roadDist = 99; }
    this.surfaceName = this.wheels[0].surface;
    const fwdSpeed = this.vel.dot(_fw);
    // Body slip angle (for drift scoring, camera and counter-steer room).
    const flat = _a.copy(this.vel); flat.y = 0;
    if (flat.length() > 3) {
      const fh = Math.atan2(_fw.x, _fw.z), vh = Math.atan2(flat.x, flat.z);
      let d = vh - fh; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      this.slipAngle = fwdSpeed > 0 ? d : 0;
    } else this.slipAngle *= 0.9;
    this.drift = Math.abs(this.slipAngle) > 0.18 && this.speed > 8 ? this.drift + dt : 0;
    // Air time & landings.
    if (!this.onGround) this.airTime += dt;
    else {
      if (this.airTime > 0.35) this.events.push({ type: 'land', strength: Math.min(1, this.airTime / 1.2 + Math.max(0, -this.vel.y) / 12) });
      this.airTime = 0;
    }
    if (_up.y < 0.25 && this.speed < 3) this.upsideTime += dt; else this.upsideTime = 0;
    this.odometer += this.speed * dt;
    const sf = SURFACES[this.surfaceName] || SURFACES.gravel;
    this.dirt = Math.min(1, this.dirt + this.speed * dt * 0.00006 * (sf.dust + (this.surfaceName === 'water' ? 6 : 0) + (sf.loose ? 0.5 : 0.05)));
    this.fwdSpeed = fwdSpeed;
  }

  heading() { _fw.set(0, 0, 1).applyQuaternion(this.quat); return Math.atan2(_fw.x, _fw.z); }

  drainEvents() { const e = this.events; this.events = []; return e; }

  // Snapshot for replays and ghosts.
  snapshot() {
    const W = this.wheels;
    return [this.pos.x, this.pos.y, this.pos.z, this.quat.x, this.quat.y, this.quat.z, this.quat.w,
      W[0].len, W[1].len, W[2].len, W[3].len, this.steerAngle, W[0].angle, W[2].angle, this.rpm, this.throttle, this.speed];
  }
}

// Spatial index of obstacles (trees, rocks, posts) for collisions.
export class ObstacleGrid {
  constructor(cell = 8) { this.cell = cell; this.map = new Map(); this._out = []; }
  key(x, z) { return Math.floor(x / this.cell) * 92821 ^ Math.floor(z / this.cell) * 68917; }
  add(o) { const k = this.key(o.x, o.z); let a = this.map.get(k); if (!a) this.map.set(k, (a = [])); a.push(o); }
  near(x, z) {
    const out = this._out; out.length = 0;
    const c = this.cell;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = this.map.get(this.key(x + dx * c, z + dz * c));
      if (a) for (const o of a) out.push(o);
    }
    return out;
  }
}
