// Weapon pickups, projectiles, mines and their effects on ships.
import * as THREE from '../vendor/three.module.min.js';
import { psxMaterial } from './psx.js';

const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();

const TABLES = {
  front: [['mines', 3], ['shield', 3], ['well', 2], ['rockets', 2], ['emp', 1], ['shock', 1], ['turbo', 1]],
  mid: [['rockets', 3], ['cannon', 3], ['missile', 2], ['mines', 2], ['shock', 1], ['bolt', 1], ['emp', 1], ['well', 1], ['shield', 1], ['turbo', 1]],
  back: [['missile', 3], ['turbo', 3], ['plasma', 2], ['cannon', 2], ['bolt', 2], ['rockets', 2], ['emp', 1], ['shock', 1]],
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
  round: new THREE.BoxGeometry(0.18, 0.18, 1.1),
  plasma: new THREE.IcosahedronGeometry(1, 1),
  ring: new THREE.TorusGeometry(1, 0.12, 4, 32).rotateX(Math.PI / 2),
  well: new THREE.TorusGeometry(1, 0.18, 6, 24).rotateX(Math.PI / 2),
};

export class Weapons {
  constructor(race) {
    this.race = race;
    this.track = race.track;
    this.items = [];
    this.group = new THREE.Group();
    this.mats = {
      rocket: psxMaterial({ color: 0xff7a2a, glow: 1.5 }),
      missile: psxMaterial({ color: 0xffe04a, glow: 1.5 }),
      mine: psxMaterial({ color: 0xff2a6a, glow: 1.5 }),
      bolt: psxMaterial({ color: 0xb09aff, additive: true }),
      shock: psxMaterial({ color: 0x2ad0ff, additive: true, side: THREE.DoubleSide }),
      round: psxMaterial({ color: 0xffe08a, glow: 2 }),
      plasma: psxMaterial({ color: 0xff40ff, additive: true }),
      ring: psxMaterial({ color: 0x60b0ff, additive: true, side: THREE.DoubleSide }),
      well: psxMaterial({ color: 0xc080ff, additive: true, side: THREE.DoubleSide }),
    };
  }

  spawn(kind, owner, pos, vel, opts = {}) {
    const mesh = new THREE.Mesh(GEOS[opts.geo || kind], this.mats[opts.geo || kind]);
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
      case 'cannon':
        ship.cannonShots = 16; ship.cannonTimer = 0;
        break;
      case 'plasma': {
        const target = this.targetAhead(ship, 600);
        const it = this.spawn('plasma', ship, nose, fwd.clone().multiplyScalar(speed + 130), { life: 3.5, radius: 3.2, target, turn: 1.2 });
        it.mesh.scale.setScalar(1.3);
        race.sound('plasma', ship);
        break;
      }
      case 'emp': {
        // Instant burst: disrupts and slows everyone nearby.
        const ring = this.spawn('ring', ship, ship.pos, new THREE.Vector3(), { life: 0.6, radius: 0, arm: 99 });
        ring.static = true; ring.expand = 70;
        for (const o of race.ships) {
          if (o === ship || o.pos.distanceTo(ship.pos) > 45) continue;
          if (o.hit(0.35)) { o.stunTime = 2; race.onHit(ship, o, 'emp'); }
        }
        race.sound('emp', ship);
        race.flashAt(ship.pos, 0x60b0ff);
        break;
      }
      case 'well': {
        const p = ship.pos.clone().addScaledVector(ship.fwd, -5);
        const it = this.spawn('well', ship, p, new THREE.Vector3(), { life: 18, radius: 0, arm: 99 });
        it.static = true; it.field = 7.5; it.mesh.scale.setScalar(7.5);
        race.sound('well', ship);
        break;
      }
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

    // Autocannon bursts.
    for (const s of race.ships) {
      if (!s.cannonShots) continue;
      s.cannonTimer -= dt;
      if (s.cannonTimer <= 0) {
        s.cannonTimer = 0.07;
        s.cannonShots--;
        const side = new THREE.Vector3().crossVectors(s.fwd, s.up);
        const p = s.pos.clone().addScaledVector(s.fwd, 3).addScaledVector(side, s.cannonShots % 2 ? 0.9 : -0.9);
        const v = s.fwd.clone().multiplyScalar(Math.max(0, s.vel.dot(s.fwd)) + 260).addScaledVector(side, (Math.random() - 0.5) * 6);
        this.spawn('round', s, p, v, { life: 1.4, radius: 1.5, geo: 'round' });
        if (s === race.player || Math.random() < 0.3) race.sound('cannon', s);
      }
    }

    for (const s of race.ships) { s.wasInWell = s.inWell; s.inWell = false; }
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
        if (it.expand) it.mesh.scale.setScalar((0.6 - it.life) * it.expand + 1);
        if (it.field) {
          // Gravity well: drags and pulls in any craft passing through.
          for (const s of race.ships) {
            if (s === it.owner && it.life > 16.5) continue;
            _d.subVectors(it.pos, s.pos);
            const d = _d.length();
            if (d > it.field) continue;
            if (s.shieldTime > 0) continue;
            s.vel.multiplyScalar(Math.max(0, 1 - 2.2 * dt));
            s.vel.addScaledVector(_d.normalize(), 25 * dt);
            if (!s.wasInWell) race.onHit(it.owner, s, 'well');
            s.inWell = true;
          }
          if (Math.random() < 0.5) {
            const a = Math.random() * 6.28;
            race.particles.emit(_d.set(it.pos.x + Math.cos(a) * it.field, it.pos.y + 0.5, it.pos.z + Math.sin(a) * it.field),
              new THREE.Vector3(-Math.cos(a) * 12, 1, -Math.sin(a) * 12), 0xb070ff, 1.2, 0.6, 0);
          }
        }
      }
      if (it.kind === 'plasma') {
        it.mesh.rotation.x += dt * 5;
        race.particles.emit(it.pos, _d.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6), 0xff60ff, 2.4, 0.3);
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
    const power = { rocket: 0.6, missile: 0.9, mine: 0.55, shock: 0.85, bolt: 0.3, round: 0.12, plasma: 1 }[it.kind];
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
