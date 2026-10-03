// Weather: a volume of precipitation that follows the camera (rain streaks,
// snow, blowing sand or drifting ice crystals), plus lightning for storms.
import * as THREE from '../vendor/three.module.min.js';

const BOX = 90; // size of the particle volume around the camera
const HALF = BOX / 2;
const wrap = (v, c) => c + ((((v - c + HALF) % BOX) + BOX) % BOX) - HALF;

const KINDS = {
  rain: { color: 0x9fb4cc, fall: 75, drift: [6, 0], size: 0, streak: true },
  snow: { color: 0xffffff, fall: 6, drift: [2, 1], size: 0.55, swirl: 1.2 },
  sand: { color: 0xd89858, fall: 1.5, drift: [55, 14], size: 0.7, swirl: 0.5 },
  crystals: { color: 0xc8f0ff, fall: 1.2, drift: [1, 1], size: 0.18, swirl: 0.6, sparkle: true },
};

export class Weather {
  constructor(kind, count, glowTex) {
    this.kind = kind;
    this.cfg = KINDS[kind];
    this.count = count;
    this.p = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.p[i * 3] = (Math.random() - 0.5) * BOX;
      this.p[i * 3 + 1] = (Math.random() - 0.5) * BOX;
      this.p[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      this.phase[i] = Math.random() * 100;
    }
    const g = new THREE.BufferGeometry();
    const color = new THREE.Color(this.cfg.color);
    if (this.cfg.streak) {
      this.pos = new Float32Array(count * 6);
      this.col = new Float32Array(count * 6);
      for (let i = 0; i < count; i++) {
        const k = 0.35 + Math.random() * 0.4;
        this.col.set([color.r * k, color.g * k, color.b * k, 0, 0, 0], i * 6);
      }
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
      this.object = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
      }));
    } else {
      this.pos = new Float32Array(count * 3);
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      this.object = new THREE.Points(g, new THREE.PointsMaterial({
        map: glowTex, color, size: this.cfg.size, transparent: true, depthWrite: false, opacity: kind === 'sand' ? 0.8 : 0.9,
        blending: kind === 'sand' ? THREE.NormalBlending : THREE.AdditiveBlending, fog: kind === 'sand',
      }));
    }
    this.object.frustumCulled = false;
    this.object.renderOrder = 6;
    this.flash = 0;
    this.nextBolt = 6 + Math.random() * 8;
    this.time = 0;
  }

  // camVel: how fast the camera moves, so rain streaks lean into the motion.
  update(dt, camera, camVel) {
    this.time += dt;
    const c = camera.position, cfg = this.cfg, n = this.count, p = this.p;
    const t = this.time;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const ph = this.phase[i];
      p[k] += (cfg.drift[0] + (cfg.swirl ? Math.sin(t * cfg.swirl + ph) * 3 : 0)) * dt;
      p[k + 1] -= cfg.fall * (0.8 + (ph % 1) * 0.4) * dt;
      p[k + 2] += (cfg.drift[1] + (cfg.swirl ? Math.cos(t * cfg.swirl * 0.8 + ph) * 3 : 0)) * dt;
      const x = wrap(p[k], c.x), y = wrap(p[k + 1], c.y), z = wrap(p[k + 2], c.z);
      p[k] = x; p[k + 1] = y; p[k + 2] = z;
      if (cfg.streak) {
        // streak = drop's motion relative to the camera over a short exposure
        const sx = (cfg.drift[0] - camVel.x) * 0.025, sy = (-cfg.fall - camVel.y) * 0.025, sz = (cfg.drift[1] - camVel.z) * 0.025;
        this.pos.set([x, y, z, x - sx, y - sy, z - sz], i * 6);
      } else {
        this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
      }
    }
    if (cfg.sparkle) this.object.material.opacity = 0.6 + 0.4 * Math.sin(t * 9);
    this.object.geometry.attributes.position.needsUpdate = true;

    // Lightning for rainstorms: a bright double flicker every so often.
    if (this.kind === 'rain') {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = 7 + Math.random() * 12; this.flickers = 2; }
      if (this.flash > 0) {
        this.flash -= dt * 5;
        if (this.flash <= 0 && this.flickers > 1) { this.flickers--; this.flash = 0.7; }
      }
    }
    return Math.max(0, this.flash);
  }
}
