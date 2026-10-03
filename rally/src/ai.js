// A driver that follows the road: used for attract mode, the autopilot test
// switch and the headless physics test.
import { clamp, wrapAngle } from './util.js';
import { SURFACES } from './stages.js';

export class Driver {
  constructor(car, aggression = 1) {
    this.car = car; this.aggr = aggression; this.hbTimer = 0;
    this.out = { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false };
    this.f = {};
  }
  update(dt) {
    const car = this.car, road = car.road, o = this.out;
    const v = car.speed;
    const look = 5 + v * 0.42;
    const f = road.frameAt(car.s + look, this.f);
    // Aim slightly inside the corner ahead.
    const k = road.frameAt(car.s + look * 1.6).k;
    const inside = clamp(-k * 220, -1, 1) * f.w * 0.35; // k>0 turns left; right offset negative
    const tx = f.x + f.rx * inside, tz = f.z + f.rz * inside;
    const dx = tx - car.pos.x, dz = tz - car.pos.z;
    const want = Math.atan2(dx, dz);
    // Point the front wheels where we want to go; in a slide that is counter-steer.
    const hd = car.heading();
    const vh = v > 4 ? Math.atan2(car.vel.x, car.vel.z) : hd;
    const err = wrapAngle(want - vh);
    const wheelAim = wrapAngle(want - hd) + err * 0.6; // overshoot the travel error a touch
    const lock = 0.58 - 0.42 * clamp((v - 2) / 36, 0, 1) + Math.min(0.5, Math.abs(car.slipAngle) * 0.85);
    o.steer = clamp(-wheelAim / lock, -1, 1);
    if (!car.onGround) o.steer *= 0.3; // keep the wheels straight in the air
    const sf = SURFACES[car.surfaceName] || SURFACES.gravel;
    const mu = (road.stage.surface === 'tarmac' ? 1.0 : Math.max(sf.mu, 0.6)) * (car.wet ? 0.8 : road.stage.surface === 'snow' ? 0.9 : 1);
    const vT = road.adviseSpeed(car.s + 3, mu * 0.98 * this.aggr);
    if (v > vT + 1.2) { o.throttle = 0; o.brake = clamp((v - vT) / 5, 0.25, 1); }
    else { o.brake = 0; o.throttle = clamp((vT - v) / 2 + 0.55, 0.3, 1); }
    if (Math.abs(err) > 0.9 && v > 4) o.throttle *= 0.5;
    // Feed the throttle in gently while the car is still sideways.
    o.throttle *= clamp(1 - (Math.abs(car.slipAngle) - 0.2) * 2.5, 0.3, 1);
    // Flick the handbrake into hairpins.
    this.hbTimer -= dt;
    if (this.hbTimer <= 0 && Math.abs(err) > 0.55 && v > 8 && v < 18) this.hbTimer = 0.35;
    o.handbrake = this.hbTimer > 0 ? 1 : 0;
    return o;
  }
}
