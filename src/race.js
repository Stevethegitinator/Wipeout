// A single race: circuit, craft, AI, weapons, camera and race rules.
import * as THREE from '../vendor/three.module.min.js';
import { TEAMS, CLASSES, THEMES, WEAPONS } from './data.js';
import { TrackData } from './trackdata.js';
import { buildWorld } from './trackmesh.js';
import { Ship, HOVER_HEIGHT } from './ship.js';
import { AIPilot } from './ai.js';
import { Weapons, rollWeapon } from './weapons.js';
import { Particles } from './particles.js';
import { buildShipModel } from './shipmodels.js';
import { psxMaterial, psxUniforms } from './psx.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();
const _e = new THREE.Euler();
const _qq = new THREE.Quaternion();

const trackCache = new Map();
function getTrack(def) {
  if (!trackCache.has(def.id)) trackCache.set(def.id, new TrackData(def));
  return trackCache.get(def.id);
}

export class Race {
  constructor(opts) {
    const { scene, camera, audio, trackDef, classIndex = 0, mode = 'race', playerTeam = 0, playerPilot = 0, laps = 3, grid = null, autopilot = false } = opts;
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.mode = mode;
    this.laps = mode === 'time' ? 5 : mode === 'attract' ? 99 : laps;
    this.classIndex = classIndex;
    this.track = getTrack(trackDef);
    this.def = trackDef;
    this.theme = THEMES[trackDef.theme];

    this.root = new THREE.Group();
    const world = buildWorld(this.track);
    this.world = world;
    this.root.add(world.group);
    this.skyGroup = world.skyGroup;
    this.root.add(this.skyGroup);
    this.particles = new Particles(2500);
    this.root.add(this.particles.points);
    this.weapons = new Weapons(this);
    this.root.add(this.weapons.group);
    scene.add(this.root);

    psxUniforms.uFogColor.value.set(this.theme.fog);
    psxUniforms.uFogNear.value = this.theme.fogNear;
    psxUniforms.uFogFar.value = this.theme.fogFar;
    scene.background = new THREE.Color(this.theme.fog);

    // Entrants: every pilot of every team. Grid order may be given (championship).
    const entrants = [];
    TEAMS.forEach((team, ti) => team.pilots.forEach((_, pi) => entrants.push({ ti, pi })));
    let order = grid ? grid.slice() : entrants;
    if (mode !== 'attract' && !grid) {
      // shuffle rivals, player starts at the back of the grid
      order = entrants.filter((e) => !(e.ti === playerTeam && e.pi === playerPilot));
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      order.push({ ti: playerTeam, pi: playerPilot });
    }
    if (mode === 'time') order = [{ ti: playerTeam, pi: playerPilot }];

    this.ships = [];
    this.ais = [];
    const cls = CLASSES[classIndex];
    const N = this.track.N;
    order.forEach((e, idx) => {
      const isPlayer = mode !== 'attract' && e.ti === playerTeam && e.pi === playerPilot;
      const ship = new Ship(this.track, TEAMS[e.ti], e.pi, classIndex, isPlayer);
      ship.id = `${e.ti}-${e.pi}`;
      ship.entrant = e;
      const row = Math.floor(idx / 2);
      const lane = mode === 'time' ? 0 : idx % 2 ? 1 : -1;
      ship.placeAt(N - 3 - row * 3, lane * this.track.width[0] / 4.2);
      this.ships.push(ship);
      if (isPlayer) {
        this.player = ship;
        if (autopilot) this.autopilot = new AIPilot(ship, 1);
      }
      else {
        const skill = cls.aiSkill * (0.93 + 0.07 * ((idx * 37) % 8) / 7);
        this.ais.push(new AIPilot(ship, skill));
      }
      this.attachVisual(ship);
    });

    this.time = 0;
    this.countdown = mode === 'attract' ? 0 : 4.2;
    this.lastBeep = 5;
    this.state = mode === 'attract' ? 'racing' : 'countdown';
    this.messages = [];
    this.finishOrder = [];
    this.cameraMode = 0;
    this.camOffset = new THREE.Vector3(0, 3, 9);
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.camShake = 0;
    this.flash = 0;
    this.attract = { target: this.ships[0], timer: 0, kind: 'chase', pos: new THREE.Vector3() };
    this.doneTimer = 0;
    this.snapCamera();
  }

  attachVisual(ship) {
    const { mesh, engines } = buildShipModel(ship.team);
    const g = new THREE.Group();
    g.add(mesh);
    ship.model = mesh;
    ship.engines = engines;
    const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(3.1, 1), psxMaterial({ color: 0x40ff9a, additive: true, alpha: 0.5, side: THREE.DoubleSide }));
    shield.visible = false;
    g.add(shield);
    ship.shieldMesh = shield;
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4.8).rotateX(-Math.PI / 2), psxMaterial({ color: 0x000000, transparent: true, alpha: 0.45 }));
    sh.matrixAutoUpdate = false;
    this.root.add(sh);
    ship.shadow = sh;
    ship.visual = g;
    ship.bob = Math.random() * 10;
    this.root.add(g);
  }

  dispose() {
    this.scene.remove(this.root);
    this.audio.stopEngines();
    this.root.traverse((o) => {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      if (o.material) {
        const u = o.material.uniforms;
        if (u && u.tex && u.tex.value) u.tex.value.dispose();
        o.material.dispose();
      }
    });
  }

  sound(name, ship, vol = 1) {
    let v = vol;
    if (ship && ship !== this.player) {
      const d = ship.pos.distanceTo(this.camera.position);
      v *= Math.max(0, 1 - d / 350) * 0.7;
      if (this.mode === 'attract') v *= 0.6;
    }
    if (v > 0.02) this.audio.play(name, v);
  }

  message(text, dur = 1.6, color = '#ffffff') {
    this.messages.push({ text, time: dur, color });
  }

  explode(pos, kind, ship) {
    const col = kind === 'bolt' ? 0x9a7aff : kind === 'shock' ? 0x40d8ff : 0xffa040;
    this.particles.burst(pos, col, 40, 30, 3, 0.7);
    this.particles.burst(pos, 0xffffff, 12, 15, 2, 0.4);
    const d = pos.distanceTo(this.camera.position);
    this.audio.play('explode', Math.max(0, 1 - d / 400));
    if (ship === this.player) this.flash = 0.5;
  }

  onHit(attacker, victim, kind) {
    if (victim === this.player) this.message('HIT!', 1, '#ff4040');
    else if (attacker === this.player) this.message(`${victim.pilot.split(' ')[1]} HIT`, 1.2, '#ffd040');
  }

  get places() {
    return this.ships.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
  }

  update(dt, input) {
    const live = this.state === 'racing' || this.state === 'finished';
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n < this.lastBeep && n <= 3 && n >= 1) { this.audio.play('beep'); this.lastBeep = n; }
      if (this.countdown <= 0) { this.state = 'racing'; this.audio.play('go'); this.message('GO!', 1, '#40ff80'); }
    }
    if (live) this.time += dt;

    // Player controls.
    if (this.autopilot) {
      this.autopilot.update(dt, this.ships, this.time);
      input = { ...input, fireOnce: this.player.input.fire, thrust: 1 };
    } else if (this.player) {
      const p = this.player.input;
      p.steer = input.steer || 0; p.thrust = input.thrust || 0;
      p.brakeL = input.brakeL || 0; p.brakeR = input.brakeR || 0;
      p.pitch = input.pitch || 0;
      // Launch boost: thrust held as GO appears.
      if (this.state === 'countdown') {
        this.launchCharge = (this.launchCharge || 0);
        if (input.thrust) this.launchCharge += dt; else this.launchCharge = 0;
      }
      if (this.state === 'racing' && this.launchCharge !== undefined) {
        if (this.launchCharge > 0.1 && this.launchCharge < 1.1) {
          this.player.vel.addScaledVector(this.player.fwd, 40); this.player.boostTime = 0.6;
          this.message('BOOST START', 1.2, '#20e0ff'); this.audio.play('speedpad');
        }
        this.launchCharge = undefined;
      }
    }
    if (this.player && input.fireOnce && live && this.player.weapon) this.weapons.fire(this.player);

    // AI.
    const N = this.track.N;
    const ref = this.player && !this.player.finished ? this.player : null;
    for (const ai of this.ais) {
      ai.update(dt, this.ships, this.time);
      const s = ai.ship;
      let scale = ai.skill;
      if (ref) {
        const gap = (ref.progress - s.progress) / N;
        scale *= 1 + Math.max(-0.06, Math.min(0.05, gap * 0.25));
      }
      s.speedScale = scale;
      if (s.input.fire && live) this.weapons.fire(s);
    }

    // Physics with two substeps.
    const sub = 2, h = dt / sub;
    for (let k = 0; k < sub; k++) {
      for (const s of this.ships) s.update(h, this.time, live);
      this.collideShips();
    }
    this.weapons.update(dt);

    // Events, finishing and places.
    const places = this.places;
    places.forEach((s, i) => { s.place = i + 1; });
    for (const s of this.ships) this.handleEvents(s);

    if (this.player && this.player.finished && this.state === 'racing') {
      this.state = 'finished';
      if (!this.autopilot) this.autopilot = new AIPilot(this.player, 1);
      this.doneTimer = 0;
    }
    if (this.state === 'finished') {
      this.doneTimer += dt;
      const allDone = this.ships.every((s) => s.finished);
      if (allDone || this.doneTimer > 8) this.state = 'done';
    }

    this.updateVisuals(dt);
    this.particles.update(dt);
    this.updateCamera(dt, input);
    for (const m of this.messages) m.time -= dt;
    this.messages = this.messages.filter((m) => m.time > 0);
    this.flash = Math.max(0, this.flash - dt * 2);
    psxUniforms.uTime.value += dt;
  }

  collideShips() {
    const S = this.ships;
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const a = S[i], b = S[j];
      _v.subVectors(b.pos, a.pos);
      const d2 = _v.lengthSq();
      if (d2 > 9 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      _v.multiplyScalar(1 / d);
      const push = (3 - d) / 2;
      a.pos.addScaledVector(_v, -push); b.pos.addScaledVector(_v, push);
      const rel = _w.subVectors(b.vel, a.vel).dot(_v);
      if (rel < 0) {
        a.vel.addScaledVector(_v, rel * 0.6); b.vel.addScaledVector(_v, -rel * 0.6);
        if (-rel > 8 && (a === this.player || b === this.player)) this.audio.play('wall', 0.5);
      }
    }
  }

  handleEvents(s) {
    const isP = s === this.player;
    for (const e of s.events) {
      switch (e.type) {
        case 'wall':
          if (e.power > 0.08) this.sound('wall', s, Math.min(1, e.power * 1.5));
          else if (isP) this.audio.play('scrape', 0.6);
          _v.copy(s.pos).addScaledVector(s.frame.R, e.side * 1.4);
          for (let k = 0; k < 6; k++) this.particles.emit(_v, _w.set((Math.random() - 0.5) * 20, Math.random() * 12, (Math.random() - 0.5) * 20).addScaledVector(s.vel, 0.6), 0xffd060, 1.2, 0.3, 3);
          if (isP) this.camShake = Math.max(this.camShake, e.power * 0.6);
          break;
        case 'speedpad':
          if (isP) this.audio.play('speedpad');
          break;
        case 'weaponpad':
          if (this.mode === 'time') break;
          s.weapon = rollWeapon(s.place, this.ships.length);
          if (isP) { this.audio.play('pickup'); this.message(WEAPONS[s.weapon].name, 1.4, WEAPONS[s.weapon].color); }
          break;
        case 'lap': {
          if (s.finished) break;
          if (s.lap >= this.laps) {
            s.finished = true;
            s.finishTime = this.time;
            this.finishOrder.push(s);
            if (isP) { this.audio.play('finish'); this.message(this.mode === 'time' ? 'SESSION COMPLETE' : 'RACE COMPLETE', 4, '#40ff80'); }
          } else if (isP) {
            this.audio.play('lap');
            const best = s.bestLap === e.time && s.lapTimes.length > 1;
            if (s.lap === this.laps - 1) this.message('FINAL LAP', 2, '#ffd040');
            else this.message(`LAP ${s.lap + 1}`, 1.5);
            if (best) this.message('BEST LAP', 1.5, '#40ff80');
          }
          break;
        }
        case 'hit':
          if (isP) this.camShake = 1;
          break;
        case 'land':
          this.sound('land', s, e.power);
          if (isP) this.camShake = Math.max(this.camShake, e.power * 0.5);
          break;
        case 'shieldblock':
          this.sound('shield', s);
          break;
      }
    }
    s.events.length = 0;
  }

  updateVisuals(dt) {
    for (const s of this.ships) {
      s.bob += dt * 3;
      _right.crossVectors(s.fwd, s.up).normalize();
      _back.copy(s.fwd).negate();
      const up = _w.crossVectors(_back, _right).normalize(); // re-orthogonalised up
      _m.makeBasis(_right, up, _back);
      s.visual.quaternion.setFromRotationMatrix(_m);
      _e.set(s.pitch, 0, -s.roll);
      _qq.setFromEuler(_e);
      s.visual.quaternion.multiply(_qq);
      s.visual.position.copy(s.pos).addScaledVector(up, Math.sin(s.bob) * 0.08 - 0.2);
      if (s.spinTime > 0) s.model.rotation.z += dt * 18; else s.model.rotation.z *= 0.8;

      s.shieldMesh.visible = s.shieldTime > 0 && (s.shieldTime > 1 || Math.floor(s.shieldTime * 10) % 2 === 0);

      // shadow on the track surface
      const f = s.frame;
      const sh = s.shadow;
      if (f.h < 12 && f.h > -1) {
        sh.visible = true;
        _v.copy(s.pos).addScaledVector(f.U, -f.h + 0.1);
        _right.crossVectors(s.fwd, f.U).normalize();
        _back.crossVectors(_right, f.U).normalize();
        const sc = 1 + f.h * 0.05;
        _m.makeBasis(_right.multiplyScalar(sc), f.U, _back.multiplyScalar(sc)).setPosition(_v);
        sh.matrix.copy(_m);
        sh.material.uniforms.uAlpha.value = Math.max(0, 0.5 - f.h * 0.04);
      } else sh.visible = false;

      // exhaust
      const thrusting = s.input.thrust && !s.finished ? 1 : 0.4;
      const col = s.boostTime > 0 ? 0x80e0ff : thrusting > 0.5 ? 0xff8a3a : 0x803010;
      for (const e of s.engines) {
        _v.copy(e).applyQuaternion(s.visual.quaternion).add(s.visual.position);
        _w.copy(s.vel).multiplyScalar(0.85).addScaledVector(s.fwd, -8);
        this.particles.emit(_v, _w, col, (s.boostTime > 0 ? 1.8 : 1.2) * (0.6 + thrusting * 0.5), 0.18, 2);
      }
    }
    // Engine audio: player loud, rivals by distance.
    for (const s of this.ships) {
      let vol;
      if (s === this.player) vol = 1;
      else {
        const d = s.pos.distanceTo(this.camera.position);
        vol = Math.max(0, 1 - d / 150) * (this.mode === 'attract' ? 0.35 : 0.45);
      }
      this.audio.engine(s.id, s.speed, s.input.thrust || 0, vol);
    }
  }

  snapCamera() {
    const s = this.player || this.ships[0];
    this.camera.position.copy(s.pos).addScaledVector(s.fwd, -9).addScaledVector(s.up, 3);
    this.camOffset.subVectors(this.camera.position, s.pos);
    this.camUp.copy(s.up);
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(_v.copy(s.pos).addScaledVector(s.fwd, 8));
  }

  updateCamera(dt, input) {
    const cam = this.camera;
    let s = this.player;
    if (this.mode === 'attract') {
      const a = this.attract;
      a.timer -= dt;
      if (a.timer <= 0) {
        a.target = this.ships[Math.floor(Math.random() * this.ships.length)];
        a.kind = Math.random() < 0.55 ? 'trackside' : 'chase';
        a.timer = 5 + Math.random() * 3;
        if (a.kind === 'trackside') {
          const t = a.target, i = t.section + 30 + Math.floor(t.speed * 0.1);
          const side = Math.random() < 0.5 ? -1 : 1;
          this.track.pointAt(i, side * (this.track.width[this.track.wrap(i)] / 2 + 5), 4 + Math.random() * 8, a.pos);
        }
      }
      s = a.target;
      if (a.kind === 'trackside') {
        cam.position.copy(a.pos);
        cam.up.set(0, 1, 0);
        cam.lookAt(s.pos);
        cam.fov = 50; cam.updateProjectionMatrix();
        this.skyGroup.position.copy(cam.position);
        if (s.pos.distanceTo(a.pos) > 400 && a.timer < 4) a.timer = 0;
        return;
      }
    }
    if (input && input.viewOnce) this.cameraMode = (this.cameraMode + 1) % 2;

    const spd = s.speed;
    const inside = this.cameraMode === 1 && s === this.player;
    let desired;
    if (inside) {
      desired = _v.copy(s.fwd).multiplyScalar(0.6).addScaledVector(s.up, 1.0);
      this.camOffset.copy(desired);
    } else {
      desired = _v.copy(s.fwd).multiplyScalar(-(8.5 + spd * 0.012)).addScaledVector(s.up, 2.6 + spd * 0.004);
      this.camOffset.lerp(desired, 1 - Math.exp(-dt * 9));
    }
    cam.position.copy(s.pos).add(this.camOffset);
    this.camUp.lerp(s.up, 1 - Math.exp(-dt * 6)).normalize();
    // bank the view slightly with the craft
    _right.crossVectors(s.fwd, s.up).normalize();
    cam.up.copy(this.camUp).addScaledVector(_right, s.roll * (inside ? 0.25 : 0.12)).normalize();
    const look = _w.copy(s.pos).addScaledVector(s.fwd, 10).addScaledVector(s.up, inside ? 0.9 : 0.8);
    this.camShake = Math.max(0, this.camShake - dt * 2.5);
    const shk = (this.camShake + s.shake * 0.3) * 0.6;
    if (shk > 0) cam.position.add(_right.set((Math.random() - 0.5) * shk, (Math.random() - 0.5) * shk, (Math.random() - 0.5) * shk));
    cam.lookAt(look);
    const fov = (inside ? 78 : 70) + Math.min(22, spd * 0.075) + (s.boostTime > 0 ? 6 : 0);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
    s.visual.visible = !inside;
    for (const o of this.ships) if (o !== s) o.visual.visible = true;
    this.skyGroup.position.copy(cam.position);
  }

  results() {
    const out = this.places.map((s) => {
      let time = s.finishTime;
      if (!s.finished) {
        const remaining = this.laps * this.track.N - s.progress;
        const avg = Math.max(40, s.speed);
        time = this.time + (remaining * this.track.spacing) / avg;
      }
      return { ship: s, time, best: s.bestLap, player: s === this.player };
    });
    out.sort((a, b) => a.time - b.time);
    return out;
  }
}
