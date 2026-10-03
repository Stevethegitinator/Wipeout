// Visual effects: engine light trails, speed streaks, smoke, debris and the
// energy-shield shader.
import * as THREE from '../vendor/three.module.min.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

// Ribbon of light that follows a point, fading towards the tail.
export class Trail {
  constructor(color, length = 26, width = 0.5, maxLen = 14) {
    this.n = length;
    this.maxLen = maxLen;
    this.width = width;
    this.points = Array.from({ length }, () => new THREE.Vector3());
    this.sides = Array.from({ length }, () => new THREE.Vector3(1, 0, 0));
    this.primed = false;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(length * 2 * 3);
    this.col = new Float32Array(length * 2 * 3);
    const idx = [];
    for (let i = 0; i < length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.color = new THREE.Color(color);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  update(head, side, intensity) {
    if (!this.primed) { this.points.forEach((p) => p.copy(head)); this.primed = true; }
    for (let i = this.n - 1; i > 0; i--) { this.points[i].copy(this.points[i - 1]); this.sides[i].copy(this.sides[i - 1]); }
    this.points[0].copy(head);
    this.sides[0].copy(side);
    // Fade by distance travelled, so the trail is a fixed length at any frame rate.
    let dist = 0;
    for (let i = 0; i < this.n; i++) {
      if (i > 0) dist += this.points[i].distanceTo(this.points[i - 1]);
      if (dist > this.maxLen) this.points[i].copy(this.points[i - 1]);
      const f = Math.max(0, 1 - dist / this.maxLen);
      const w = this.width * (0.3 + 0.7 * f);
      _a.copy(this.points[i]).addScaledVector(this.sides[i], w);
      _b.copy(this.points[i]).addScaledVector(this.sides[i], -w);
      this.pos.set([_a.x, _a.y, _a.z, _b.x, _b.y, _b.z], i * 6);
      const k = f * f * intensity;
      const r = this.color.r * k, g = this.color.g * k, bl = this.color.b * k;
      this.col.set([r, g, bl, r, g, bl], i * 6);
    }
    const at = this.mesh.geometry.attributes;
    at.position.needsUpdate = at.color.needsUpdate = true;
  }

  reset() { this.primed = false; }
}

// Thin streaks that rush past the camera at high speed.
export class SpeedLines {
  constructor(count = 70) {
    this.count = count;
    this.items = Array.from({ length: count }, () => ({ p: new THREE.Vector3(), life: 0, len: 0 }));
    this.pos = new Float32Array(count * 6);
    this.col = new Float32Array(count * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
    }));
    this.lines.frustumCulled = false;
    this.next = 0;
  }

  update(dt, camera, dir, amount) {
    const spawn = amount * 90 * dt;
    for (let k = 0; k < spawn; k++) {
      const it = this.items[this.next];
      this.next = (this.next + 1) % this.count;
      const ang = Math.random() * Math.PI * 2, rad = 5 + Math.random() * 9;
      _a.set(Math.cos(ang) * rad, Math.sin(ang) * rad * 0.6, -(25 + Math.random() * 40)).applyQuaternion(camera.quaternion);
      it.p.copy(camera.position).add(_a);
      it.life = 0.35;
      it.len = 6 + amount * 14;
    }
    for (let i = 0; i < this.count; i++) {
      const it = this.items[i];
      it.life -= dt;
      const k = Math.max(0, it.life / 0.35) * amount * 0.7;
      _b.copy(it.p).addScaledVector(dir, -it.len);
      this.pos.set([it.p.x, it.p.y, it.p.z, _b.x, _b.y, _b.z], i * 6);
      this.col.set([0.8 * k, 0.9 * k, k, 0, 0, 0], i * 6);
    }
    const at = this.lines.geometry.attributes;
    at.position.needsUpdate = at.color.needsUpdate = true;
  }
}

// Soft smoke puffs (normal blending) for explosions and damaged craft.
export class Smoke {
  constructor(max = 240, tex) {
    this.max = max;
    this.items = Array.from({ length: max }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, size: 1 }));
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: tex, color: 0x404448, transparent: true, depthWrite: false, opacity: 0.55,
    }), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.next = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
  }

  puff(p, v, size, life) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.max;
    it.p.copy(p); it.v.copy(v); it.life = it.max = life; it.size = size;
  }

  burst(p, count, speed, size) {
    for (let k = 0; k < count; k++) {
      _a.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * Math.random());
      this.puff(p, _a, size * (0.6 + Math.random() * 0.8), 1 + Math.random() * 1.2);
    }
  }

  update(dt, camera) {
    this.q.copy(camera.quaternion);
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i];
      if (it.life > 0) {
        it.life -= dt;
        it.v.multiplyScalar(Math.max(0, 1 - 1.5 * dt));
        it.v.y += 2 * dt;
        it.p.addScaledVector(it.v, dt);
      }
      const f = Math.max(0, it.life / it.max);
      const sc = it.life > 0 ? it.size * (1.8 - f) * Math.min(1, f * 4) : 0;
      this.m.compose(it.p, this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Tumbling hull fragments thrown out by explosions.
export class Debris {
  constructor(max = 48) {
    this.items = [];
    const geo = new THREE.TetrahedronGeometry(0.35, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.7, roughness: 0.4, emissive: 0xff6020, emissiveIntensity: 0.6 });
    this.group = new THREE.Group();
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.group.add(m);
      this.items.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 });
    }
    this.next = 0;
  }

  burst(p, count, baseVel) {
    for (let k = 0; k < count; k++) {
      const it = this.items[this.next];
      this.next = (this.next + 1) % this.items.length;
      it.m.position.copy(p);
      it.v.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).multiplyScalar(30);
      if (baseVel) it.v.addScaledVector(baseVel, 0.6);
      it.w.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      it.life = 1.2 + Math.random() * 0.6;
      it.m.visible = true;
      it.m.scale.setScalar(0.6 + Math.random() * 1.2);
    }
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      it.v.y -= 50 * dt;
      it.m.position.addScaledVector(it.v, dt);
      it.m.rotation.x += it.w.x * dt; it.m.rotation.y += it.w.y * dt; it.m.rotation.z += it.w.z * dt;
      if (it.life <= 0) it.m.visible = false;
    }
  }
}

// Energy shield: fresnel rim with drifting hexagonal bands.
export function shieldMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x40ffa0) }, uFade: { value: 1 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        vP = position;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; uniform float uFade;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 2.5);
        vec2 h = vP.xy * 3.0 + vec2(0.0, uTime * 1.5);
        float hex = smoothstep(0.85, 1.0, abs(sin(h.x * 2.0) * sin(h.y * 2.0 + vP.z * 3.0)));
        float band = 0.5 + 0.5 * sin(vP.y * 6.0 - uTime * 6.0);
        float a = (rim * 1.4 + hex * 0.35 + band * 0.08) * uFade;
        gl_FragColor = vec4(uColor * a * 1.6, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}
