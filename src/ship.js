// Anti-gravity craft physics. Pure simulation: rendering objects are attached
// by the race when running in the browser.
import * as THREE from '../vendor/three.module.min.js';
import { CLASSES } from './data.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _side = new THREE.Vector3();
const _q = new THREE.Quaternion();

export const HOVER_HEIGHT = 1.1;
const GRAVITY = 70;
const SHIP_HALF_WIDTH = 1.4;

const lerp = (a, b, t) => a + (b - a) * t;

export class Ship {
  constructor(track, team, pilotIndex, classIndex, isPlayer = false) {
    this.track = track;
    this.team = team;
    this.pilot = team.pilots[pilotIndex];
    this.isPlayer = isPlayer;
    const cls = CLASSES[classIndex];
    const s = team.stats;
    this.topSpeed = lerp(cls.topSpeed[0], cls.topSpeed[1], s.speed);
    this.accel = lerp(cls.accel[0], cls.accel[1], s.thrust);
    this.turnRate = lerp(cls.turn[0], cls.turn[1], s.handling);
    this.steerResponse = 4 + 5 * s.handling;
    this.grip = 2.2 + 2.4 * s.handling;
    this.speedScale = 1; // AI tuning / rubber band

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.yawVel = 0;
    this.frame = {};
    this.section = -1;

    this.input = { steer: 0, thrust: 0, brakeL: 0, brakeR: 0, pitch: 0, fire: false };

    // Visual state
    this.roll = 0;
    this.pitch = 0;
    this.airborne = false;
    this.airTime = 0;

    // Race state
    this.lap = -1;
    this.maxLap = -1;
    this.progress = 0;
    this.finished = false;
    this.finishTime = 0;
    this.lapTimes = [];
    this.lapStart = 0;
    this.bestLap = Infinity;
    this.place = 1;
    this.wrongWay = 0;

    // Effects
    this.weapon = null;
    this.boostTime = 0;
    this.shieldTime = 0;
    this.stunTime = 0;
    this.spinTime = 0;
    this.shake = 0;
    this.wallHit = 0; // intensity of last wall contact, for audio/visual
    this.usedPads = new Set();
    this.events = []; // {type, ...} consumed by the race each frame
  }

  get speed() { return this.vel.length(); }

  placeAt(section, lat) {
    const tr = this.track;
    const i = tr.wrap(section);
    tr.pointAt(i, lat, HOVER_HEIGHT, this.pos);
    this.fwd.copy(tr.T[i]);
    this.up.copy(tr.U[i]);
    this.vel.set(0, 0, 0);
    this.yawVel = 0;
    this.section = i;
    tr.query(this.pos, i, this.frame);
    this.updateProgress(true);
  }

  update(dt, raceTime, controlsLive) {
    const tr = this.track;
    const f = tr.query(this.pos, this.section, this.frame);
    const prevSection = this.section;
    this.section = f.index;

    const inp = this.input;
    const live = controlsLive;
    const stunned = this.stunTime > 0;
    let steer = live ? inp.steer : 0;
    let thrust = live ? inp.thrust : 0;
    let brakeL = live ? inp.brakeL : 0;
    let brakeR = live ? inp.brakeR : 0;
    if (this.finished) thrust *= 0.45; // cool-down lap
    if (stunned) { thrust *= 0.25; steer *= 0.4; }
    if (this.spinTime > 0) { steer = 0; thrust = 0; }

    // Align heading to the track plane.
    const U = f.U;
    const grounded = f.h < 7 && f.h > -4;
    if (grounded) this.up.lerp(U, Math.min(1, dt * 10)).normalize();
    else this.up.lerp(_a.set(0, 1, 0), Math.min(1, dt * 0.8)).normalize();
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();

    // Steering with inertia; airbrakes add yaw and drag.
    const brakeYaw = (brakeL - brakeR) * 0.95;
    const targetYaw = -steer * this.turnRate + brakeYaw;
    this.yawVel += (targetYaw - this.yawVel) * Math.min(1, dt * this.steerResponse);
    if (this.spinTime > 0) this.yawVel = 7;
    _q.setFromAxisAngle(this.up, this.yawVel * dt);
    this.fwd.applyQuaternion(_q).normalize();

    // Thrust and drag.
    const top = this.topSpeed * this.speedScale;
    let accel = thrust * this.accel;
    if (this.boostTime > 0) accel += this.accel * 1.4;
    const drag = this.accel / top;
    this.vel.addScaledVector(this.fwd, accel * dt);

    // Split velocity into track-plane and vertical parts.
    const vUp = this.vel.dot(this.up);
    _a.copy(this.vel).addScaledVector(this.up, -vUp); // planar
    _a.multiplyScalar(Math.max(0, 1 - drag * dt));
    const airbrakeDrag = (brakeL + brakeR) * 0.45 + (thrust ? 0 : 0.12);
    _a.multiplyScalar(Math.max(0, 1 - airbrakeDrag * dt));

    // Lateral grip: bleed off sideways slide. Airbrakes grip harder.
    _side.crossVectors(this.fwd, this.up).normalize();
    const vSide = _a.dot(_side);
    const grip = this.grip * (1 + (brakeL + brakeR) * 0.6) * (this.airborne ? 0.15 : 1);
    const keep = Math.max(0, 1 - grip * dt);
    const lost = vSide * (1 - keep);
    _a.addScaledVector(_side, -lost);
    _a.addScaledVector(this.fwd, Math.abs(lost) * 0.2); // grip partly redirects the slide
    this.vel.copy(_a).addScaledVector(this.up, vUp);

    // Hover: spring towards hover height plus gravity towards the track.
    if (grounded) {
      const h = f.h;
      const vU = this.vel.dot(U);
      let force = -GRAVITY * 0.9;
      if (h < HOVER_HEIGHT * 3) force += (HOVER_HEIGHT - h) * 220 - vU * 16;
      this.vel.addScaledVector(U, force * dt);
      // Slopes: downhill speeds you up, uphill slows you down.
      this.vel.y -= GRAVITY * 0.1 * dt;
    } else {
      this.vel.y -= GRAVITY * dt;
    }
    // Pitch control in the air: nose down dives, nose up floats.
    if (!grounded || f.h > HOVER_HEIGHT * 2.5) {
      this.vel.y += inp.pitch * (live ? 1 : 0) * 18 * dt;
    }

    this.pos.addScaledVector(this.vel, dt);

    // Re-query after moving for collision response.
    tr.query(this.pos, this.section, f);
    this.section = f.index;

    // Floor.
    if (f.h < 0.35 && f.h > -6) {
      this.pos.addScaledVector(f.U, 0.35 - f.h);
      const vU = this.vel.dot(f.U);
      if (vU < 0) {
        if (vU < -25) this.events.push({ type: 'land', power: Math.min(1, -vU / 60) });
        this.vel.addScaledVector(f.U, -vU);
      }
    }

    // Walls (and tunnel ceiling).
    this.wallHit = 0;
    const maxLat = f.width / 2 - SHIP_HALF_WIDTH;
    if (Math.abs(f.lat) > maxLat && f.h < 6) {
      const sign = Math.sign(f.lat);
      this.pos.addScaledVector(f.R, -(f.lat - sign * maxLat));
      const vLat = this.vel.dot(f.R);
      if (vLat * sign > 0) {
        const spd = this.speed;
        const impact = Math.min(1, Math.abs(vLat) / Math.max(20, spd));
        this.vel.addScaledVector(f.R, -vLat * 1.45);
        // Scraping costs speed; a square-on hit costs a lot.
        this.vel.multiplyScalar(1 - (0.1 + impact * 0.55));
        // Deflect the nose along the wall.
        const along = Math.sign(this.fwd.dot(f.T)) || 1;
        _b.copy(f.T).multiplyScalar(along);
        this.fwd.lerp(_b, 0.25 + impact * 0.3).normalize();
        this.yawVel *= 0.3;
        this.wallHit = 0.3 + impact;
        this.shake = Math.max(this.shake, impact * 0.8);
        this.events.push({ type: 'wall', power: impact, side: sign });
      } else {
        this.wallHit = 0.15;
      }
    }
    if (f.tunnel && f.h > 7) {
      this.pos.addScaledVector(f.U, 7 - f.h);
      const vU = this.vel.dot(f.U);
      if (vU > 0) this.vel.addScaledVector(f.U, -vU);
    }

    // Fell off the world: respawn on the centreline.
    if (f.h < -40 || f.h > 120) {
      this.placeAt(f.index, 0);
      this.vel.copy(tr.T[f.index]).multiplyScalar(20);
      this.events.push({ type: 'respawn' });
    }

    this.airborne = f.h > HOVER_HEIGHT * 2.5;
    this.airTime = this.airborne ? this.airTime + dt : 0;

    // Speed and weapon pads.
    const pads = tr.padAt.get(f.index);
    if (pads) {
      for (const p of pads) {
        if (this.usedPads.has(p) || this.airborne) continue;
        const lw = f.width / 4;
        const lo = -f.width / 2 + p.lane * lw;
        if (f.lat > lo - 0.6 && f.lat < lo + lw + 0.6) {
          this.usedPads.add(p);
          if (p.type === 'speed') {
            if (this.boostTime > 0.2) continue; // side-by-side pads only fire once
            const room = Math.max(0, this.topSpeed * 1.4 - this.vel.dot(this.fwd));
            this.vel.addScaledVector(this.fwd, Math.min(34, room));
            this.boostTime = Math.max(this.boostTime, 0.5);
            this.events.push({ type: 'speedpad' });
          } else if (!this.weapon) {
            this.events.push({ type: 'weaponpad' });
          }
        }
      }
    } else if (this.usedPads.size) {
      this.usedPads.clear();
    }

    // Timers.
    this.boostTime = Math.max(0, this.boostTime - dt);
    this.shieldTime = Math.max(0, this.shieldTime - dt);
    this.stunTime = Math.max(0, this.stunTime - dt);
    this.spinTime = Math.max(0, this.spinTime - dt);
    this.shake = Math.max(0, this.shake - dt * 2);

    // Visual attitude.
    const targetRoll = (steer * 0.45 + (brakeR - brakeL) * 0.35) * (this.spinTime > 0 ? 0 : 1);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 6);
    const targetPitch = this.airborne ? -this.vel.y * 0.006 + inp.pitch * 0.2 : -inp.pitch * 0.05;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 4);

    this.updateProgress(false, prevSection, raceTime);
  }

  updateProgress(reset, prevSection, raceTime) {
    const N = this.track.N;
    const s = this.section;
    if (!reset && prevSection >= 0) {
      if (prevSection > N * 0.8 && s < N * 0.2) this.crossLine(raceTime, 1);
      else if (prevSection < N * 0.2 && s > N * 0.8) this.crossLine(raceTime, -1);
    }
    this.progress = this.lap * N + s + (this.frame.t || 0);
    const dir = this.fwd.dot(this.track.T[s]);
    this.wrongWay = dir < -0.2 && this.speed > 5 ? this.wrongWay + 1 : 0;
  }

  crossLine(raceTime, dir) {
    this.lap += dir;
    if (dir < 0 || this.lap <= this.maxLap) return; // reversing, or re-crossing after it
    this.maxLap = this.lap;
    if (this.lap >= 1) {
      const t = raceTime - this.lapStart;
      this.lapTimes.push(t);
      this.bestLap = Math.min(this.bestLap, t);
      this.events.push({ type: 'lap', time: t });
    }
    this.lapStart = raceTime;
  }

  hit(power = 1) {
    if (this.shieldTime > 0) { this.events.push({ type: 'shieldblock' }); return false; }
    this.vel.multiplyScalar(Math.max(0.15, 1 - 0.7 * power));
    this.vel.y += 10 * power;
    this.spinTime = Math.max(this.spinTime, 0.35 * power);
    this.shake = 1;
    this.events.push({ type: 'hit', power });
    return true;
  }
}
