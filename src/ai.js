// Computer-controlled pilots: follow a racing line, avoid rivals, use weapons.
import * as THREE from '../vendor/three.module.min.js';

const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _side = new THREE.Vector3();

export class AIPilot {
  constructor(ship, skill = 1, rng = Math.random) {
    this.ship = ship;
    this.skill = skill;
    this.rng = rng;
    this.lineBias = (rng() - 0.5) * 0.5;
    this.wobblePhase = rng() * 100;
    this.weaponDelay = 0;
    this.lat = 0;
  }

  // Ideal lateral offset: hug the inside of upcoming corners.
  racingLine(i) {
    const tr = this.ship.track;
    let k = 0;
    for (let a = 4; a <= 24; a += 4) k += tr.curvature[tr.wrap(i + a)];
    k /= 6;
    const w = tr.width[tr.wrap(i)];
    const inside = Math.max(-1, Math.min(1, k * 70));
    // positive curvature = left turn = negative lateral (left side)
    return (-inside * 0.75 + this.lineBias) * (w / 2 - 3);
  }

  update(dt, ships, time) {
    const s = this.ship;
    const tr = s.track;
    const inp = s.input;
    const spd = s.speed;

    const look = Math.round((10 + spd * 0.32) / tr.spacing);
    const ti = tr.wrap(s.section + Math.max(2, look));
    let target = this.racingLine(ti) + Math.sin(time * 0.3 + this.wobblePhase) * 1.5;

    // Dodge the ship directly ahead.
    for (const o of ships) {
      if (o === s) continue;
      let ahead = o.progress - s.progress;
      if (ahead > 0 && ahead < 5 && Math.abs(o.frame.lat - s.frame.lat) < 3.5) {
        target += (o.frame.lat > s.frame.lat ? -1 : 1) * 5;
      }
    }
    const w = tr.width[ti];
    target = Math.max(-w / 2 + 3, Math.min(w / 2 - 3, target));
    this.lat += (target - this.lat) * Math.min(1, dt * 2.5);

    tr.pointAt(ti, this.lat, 1, _t);
    _d.subVectors(_t, s.pos);
    _d.addScaledVector(s.up, -_d.dot(s.up)).normalize();
    _side.crossVectors(s.fwd, s.up);
    const angle = Math.atan2(_d.dot(_side), _d.dot(s.fwd));
    // Also correct for sideways slide.
    const slide = s.vel.dot(_side) / Math.max(10, spd);

    inp.steer = Math.max(-1, Math.min(1, angle * 3.2 + slide * 1.2));
    inp.thrust = 1;
    const hard = Math.abs(angle) > 0.16 && spd > 60;
    inp.brakeL = hard && angle < 0 ? 1 : 0;
    inp.brakeR = hard && angle > 0 ? 1 : 0;
    inp.pitch = 0;

    // Weapons.
    this.weaponDelay -= dt;
    inp.fire = false;
    if (s.weapon && this.weaponDelay <= 0) {
      const wpn = s.weapon;
      let fire = false;
      if (wpn === 'shield' || wpn === 'turbo') {
        fire = wpn === 'turbo' ? Math.abs(tr.curvature[ti]) < 0.004 : this.rng() < 0.02;
      } else if (wpn === 'emp') {
        fire = ships.some((o) => o !== s && o.pos.distanceTo(s.pos) < 35);
      } else if (wpn === 'mines' || wpn === 'well') {
        fire = ships.some((o) => o !== s && s.progress - o.progress > 2 && s.progress - o.progress < 25);
      } else {
        fire = ships.some((o) => o !== s && o.progress - s.progress > 2 && o.progress - s.progress < 30);
      }
      if (fire) { inp.fire = true; this.weaponDelay = 0.5 + this.rng() * 1.5; }
    }
  }
}
