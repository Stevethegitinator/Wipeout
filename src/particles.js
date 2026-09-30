// Pooled additive point sprites for exhaust, sparks and explosions.
import * as THREE from '../vendor/three.module.min.js';

export const particleScale = { value: 60 };

export class Particles {
  constructor(max = 2000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.baseCol = new Float32Array(max * 3);
    this.drag = new Float32Array(max);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      uniforms: { uScale: particleScale },
      vertexShader: `
        attribute float size; varying vec3 vCol; uniform float uScale;
        void main(){ vCol = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec3 vCol;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard;
          gl_FragColor = vec4(vCol * (1.0 - r * 3.0), 1.0); }`,
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(p, v, color, size, life, drag = 1) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    this.baseCol[i * 3] = c.r; this.baseCol[i * 3 + 1] = c.g; this.baseCol[i * 3 + 2] = c.b;
    this.baseSize[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.drag[i] = drag;
  }

  burst(p, color, count, speed, size, life) {
    const v = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      this.emit(p, v, color, size * (0.6 + Math.random() * 0.8), life * (0.5 + Math.random()), 2);
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      for (let a = 0; a < 3; a++) {
        this.vel[i * 3 + a] *= damp;
        this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
        this.col[i * 3 + a] = this.baseCol[i * 3 + a] * k;
      }
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * k);
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = g.color.needsUpdate = g.size.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.size.fill(0); }
}
