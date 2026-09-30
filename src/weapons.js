// Weapon pickups, projectiles, mines and their effects on ships.
import * as THREE from '../vendor/three.module.min.js';
import { psxMaterial } from './psx.js';

const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

const TABLES = {
  front: [['mines', 3], ['shield', 3], ['rockets', 2], ['shock', 1], ['turbo', 1]],
  mid: [['rockets', 3], ['missile', 2], ['mines', 2], ['shock', 1], ['bolt', 1], ['shield', 1], ['turbo', 1]],
  back: [['missile', 3], ['turbo', 3], ['bolt', 2], ['rockets', 2], ['shock', 1]],
};

export function rollWeapon(place, count, rng = Math.random) {
  const table = place === 1 ? TABLES.front : place > count * 0.6 ? TABLES.back : TABLES.mid;
  let total = table.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [id, w] of table) { if ((r -= w) <= 0) return id; }
  return table[0][0];
}

const GEOS = {
  rocket: new THREE.BoxGeometry(0.35, 0.35, 1.4),
  missile: new THREE.ConeGeometry(0.35, 1.6, 5).rotateX(-Math.PI / 2),
  mine: new THREE.OctahedronGeometry(0.8, 0),
  bolt: new THREE.OctahedronGeometry(0.7, 0),
  shock: new THREE.TorusGeometry(1, 0.25, 4, 16),
};

export class Weapons {
  constructor(race) {
    this.race = race;
    this.track = race.track;
    this.items = [];
    this.group = new THREE.Group();
    this.mats = {
      rocket: psxMaterial({ color: 0xff7a2a }),
      missile: psxMaterial({ color: 0xffe04a }),
      mine: psxMaterial({ color: 0xff2a6a }),
      bolt: psxMaterial({ color: 0xb09aff, additive: true }),
      shock: psxMaterial({ color: 0x2ad0ff, additive: true, side: THREE.DoubleSide }),
    };
  }

  spawn(kind, owner, pos, vel, opts = {}) {
    const mesh = new THREE.Mesh(GEOS[kind], this.mats[kind]);
    mesh.position.copy(pos);
    this.group.add(mesh);
    const it = {
      kind, owner, pos: pos.clone(), vel: vel.clone(), mesh, frame: {}, section: owner.section,
      life: opts.life ?? 3, radius: opts.radius ?? 2.5, target: opts.target || null,
      turn: opts.turn ?? 0, arm: opts.arm ?? 0.15, grow: opts.grow ?? 0,
    };
    this.items.push(it);
    return it;
  }

  targetAhead(ship, maxDist = 520) {
    let best = null, bestD = Infinity;
    for (const o of this.race.ships) {
      if (o === ship || o.finished) continue;
      _d.subVectors(o.pos, ship.pos);
      const d = _d.length();
      if (d > maxDist || d < 3) continue;
      if (_d.dot(ship.fwd) / d < 0.5) continue;
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  fire(ship) {
    const w = ship.weapon;
    if (!w) return;
    ship.weapon = null;
    const fwd = ship.fwd, speed = Math.max(0, ship.vel.dot(fwd));
    const nose = ship.pos.clone().addScaledVector(fwd, 3.2);
    const race = this.race;
    switch (w) {
      case 'rockets': {
        const side = new THREE.Vector3().crossVectors(fwd, ship.up);
        for (const s of [-1, 0, 1]) {
          const v = fwd.clone().multiplyScalar(speed + 170).addScaledVector(side, s * 9);
          this.spawn('rocket', ship, nose.clone().addScaledVector(side, s * 1.2), v, { life: 2.6, radius: 2.4 });
        }
        race.sound('rocket', ship);
        break;
      }
      case 'missile': {
        const target = this.targetAhead(ship);
        this.spawn('missile', ship, nose, fwd.clone().multiplyScalar(speed + 110), { life: 5, radius: 2.6, target, turn: 3.2 });
        race.sound('missile', ship);
        break;
      }
      case 'mines':
        ship.mineDrops = 5; ship.mineTimer = 0;
        race.sound('mine', ship);
        break;
      case 'shock':
        this.spawn('shock', ship, nose, fwd.clone().multiplyScalar(speed + 90), { life: 1.8, radius: 5, grow: 5 });
        race.sound('shock', ship);
        break;
      case 'bolt': {
        const target = this.targetAhead(ship, 700);
        this.spawn('bolt', ship, nose, fwd.clone().multiplyScalar(speed + 200), { life: 3, radius: 2.8, target, turn: 6 });
        race.sound('bolt', ship);
        break;
      }
      case 'shield':
        ship.shieldTime = 5;
        race.sound('shield', ship);
        break;
      case 'turbo':
        ship.vel.addScaledVector(fwd, 70);
        ship.boostTime = 1.6;
        race.sound('turbo', ship);
        break;
    }
  }

  update(dt) {
    const tr = this.track;
    const race = this.race;
    // Mine laying over time.
    for (const s of race.ships) {
      if (!s.mineDrops) continue;
      s.mineTimer -= dt;
      if (s.mineTimer <= 0) {
        s.mineTimer = 0.14;
        s.mineDrops--;
        const p = s.pos.clone().addScaledVector(s.fwd, -3.5);
        const it = this.spawn('mine', s, p, new THREE.Vector3(), { life: 30, radius: 2.4, arm: 0.8 });
        it.static = true;
      }
    }

    for (let n = this.items.length - 1; n >= 0; n--) {
      const it = this.items[n];
      it.life -= dt;
      it.arm -= dt;
      let dead = it.life <= 0;

      if (!it.static) {
        if (it.target && it.turn) {
          _d.subVectors(it.target.pos, it.pos).normalize();
          const sp = it.vel.length();
          const cur = it.vel.clone().normalize();
          const ang = Math.acos(Math.max(-1, Math.min(1, cur.dot(_d))));
          if (ang > 1e-3) {
            _axis.crossVectors(cur, _d).normalize();
            _q.setFromAxisAngle(_axis, Math.min(ang, it.turn * dt));
            it.vel.copy(cur.applyQuaternion(_q).multiplyScalar(sp));
          }
        }
        it.pos.addScaledVector(it.vel, dt);
        const f = tr.query(it.pos, it.section, it.frame);
        it.section = f.index;
        // Skim along the track surface.
        const hTarget = it.kind === 'shock' ? 1.5 : 1.3;
        it.pos.addScaledVector(f.U, (hTarget - f.h) * Math.min(1, dt * 12));
        it.vel.addScaledVector(f.U, -it.vel.dot(f.U));
        if (it.kind === 'shock') {
          it.radius += it.grow * dt;
        } else if (Math.abs(f.lat) > f.width / 2 - 0.4) {
          dead = true;
          race.explode(it.pos, it.kind);
        }
        if (it.kind === 'rocket' || it.kind === 'missile') {
          race.particles.emit(it.pos, _d.set(0, 1, 0), 0xff9a40, 1.4, 0.35);
        } else if (it.kind === 'bolt') {
          race.particles.emit(it.pos, _d.set(0, 0, 0), 0x9a7aff, 2, 0.25);
        }
        // Orient mesh
        const dir = _d.copy(it.vel).normalize();
        it.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
        if (it.kind === 'shock') {
          it.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
          it.mesh.scale.setScalar(it.radius);
        }
      } else {
        it.mesh.rotation.y += dt * 3;
      }
      it.mesh.position.copy(it.pos);

      // Hits.
      if (!dead && it.arm <= 0) {
        for (const s of race.ships) {
          if (s === it.owner && it.arm > -1 && it.static) continue;
          if (s === it.owner && !it.static) continue;
          if (s.pos.distanceToSquared(it.pos) < (it.radius + 1.4) ** 2) {
            this.applyHit(it, s);
            if (it.kind !== 'shock') { dead = true; break; }
            it.hitSet = it.hitSet || new Set();
          }
        }
      }
      if (dead) {
        this.group.remove(it.mesh);
        this.items.splice(n, 1);
      }
    }
  }

  applyHit(it, ship) {
    if (it.hitSet) { if (it.hitSet.has(ship)) return; it.hitSet.add(ship); }
    else if (it.kind === 'shock') it.hitSet = new Set([ship]);
    const power = { rocket: 0.6, missile: 0.9, mine: 0.55, shock: 0.85, bolt: 0.3 }[it.kind];
    const took = ship.hit(power);
    if (took && it.kind === 'bolt') ship.stunTime = 2.5;
    this.race.explode(it.pos, it.kind, ship);
    if (took) this.race.onHit(it.owner, ship, it.kind);
  }

  clear() {
    for (const it of this.items) this.group.remove(it.mesh);
    this.items.length = 0;
  }
}
