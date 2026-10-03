// Particle effects (dust clouds, gravel and snow spray, water splashes,
// sparks, exhaust smoke), tyre tracks and falling weather.
import * as THREE from '../../vendor/three.module.min.js';
import { smokeTexture, softDot } from './textures.js';
import { SURFACES } from './stages.js';
import { clamp } from './util.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3();

// Camera-facing billboards in one instanced draw call.
class Billboards {
  constructor(max, { texture, blending = THREE.NormalBlending, lit = true, depthWrite = false }) {
    this.max = max; this.n = 0;
    this.p = []; // particle state objects
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // xyz + size
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // rgb + alpha
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (const a of [this.aPos, this.aCol, this.aRot]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iRot', this.aRot);
    g.instanceCount = 0;
    this.uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), { map: { value: texture }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.5, 0.5, 0.5) }, uLit: { value: lit ? 1 : 0 } });
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite, blending, fog: true,
      vertexShader: `
        attribute vec4 iPos; attribute vec4 iCol; attribute float iRot;
        varying vec2 vUv; varying vec4 vCol; varying vec3 vView;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv; vCol = iCol;
          vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
          float c = cos(iRot), s = sin(iRot);
          vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iPos.w;
          mv.xy += q;
          vView = normalize(mv.xyz);
          gl_Position = projectionMatrix * mv;
          vec4 mvPosition = mv;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 uSun, uSunCol, uAmb; uniform float uLit;
        varying vec2 vUv; varying vec4 vCol; varying vec3 vView;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(map, vUv);
          vec3 col = vCol.rgb;
          if (uLit > 0.5) {
            // Back-lit dust glows when you look toward the sun; the top of the puff is brighter.
            vec3 sunView = normalize((viewMatrix * vec4(uSun, 0.0)).xyz);
            float fwd = pow(max(dot(vView, sunView), 0.0), 4.0);
            float top = vUv.y;
            col *= uAmb + uSunCol * (0.45 + 0.35 * top + 1.4 * fwd);
          }
          gl_FragColor = vec4(col * t.rgb, t.a * vCol.a);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push(o);
  }
  update(dt) {
    const P = this.p;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const o = P[i];
      o.age += dt;
      if (o.age >= o.life) continue;
      o.vx *= 1 - o.drag * dt; o.vz *= 1 - o.drag * dt; o.vy = o.vy * (1 - o.drag * dt) - o.grav * dt;
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      if (o.floor !== undefined && o.y < o.floor) { o.y = o.floor; o.vy *= -0.3; o.vx *= 0.6; o.vz *= 0.6; }
      P[w++] = o;
    }
    P.length = w;
    const pa = this.aPos.array, ca = this.aCol.array, ra = this.aRot.array;
    for (let i = 0; i < w; i++) {
      const o = P[i], t = o.age / o.life;
      pa[i * 4] = o.x; pa[i * 4 + 1] = o.y; pa[i * 4 + 2] = o.z;
      pa[i * 4 + 3] = o.s0 + (o.s1 - o.s0) * Math.sqrt(t);
      ca[i * 4] = o.r; ca[i * 4 + 1] = o.g; ca[i * 4 + 2] = o.b;
      ca[i * 4 + 3] = o.a * Math.min(1, o.age / (o.fadeIn || 0.08)) * (1 - t) ** (o.fadePow || 1.3);
      ra[i] = o.rot + o.spin * o.age;
    }
    this.mesh.geometry.instanceCount = w;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aRot.needsUpdate = true;
  }
  clear() { this.p.length = 0; this.mesh.geometry.instanceCount = 0; }
}

// Tyre tracks: a ring buffer of quads per wheel.
class Tracks {
  constructor(max) {
    this.max = max; this.i = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 4 * 3);
    this.alpha = new Float32Array(max * 4);
    this.uv = new Float32Array(max * 4 * 2);
    const idx = new Uint32Array(max * 6);
    for (let q = 0; q < max; q++) { const a = q * 4; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], q * 6); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.uColor = { value: new THREE.Color(0, 0, 0) };
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), { uColor: this.uColor }), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true,
      vertexShader: 'attribute float aAlpha; varying float vA; varying vec2 vUv;\n#include <fog_pars_vertex>\nvoid main(){ vA = aAlpha; vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
      fragmentShader: 'uniform vec3 uColor; varying float vA; varying vec2 vUv;\n#include <fog_pars_fragment>\nvoid main(){ float tread = 0.75 + 0.25 * step(0.5, fract(vUv.y * 6.0)); float e = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x); gl_FragColor = vec4(uColor, vA * e * tread);\n#include <fog_fragment>\n}',
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.last = [null, null, null, null];
  }
  add(wi, p, side, alpha, width) {
    const prev = this.last[wi];
    const L = { x: p.x + side.x * width, y: p.y + 0.03, z: p.z + side.z * width, x2: p.x - side.x * width, z2: p.z - side.z * width, d: prev ? prev.d + Math.hypot(p.x - prev.cx, p.z - prev.cz) : 0, cx: p.x, cz: p.z, a: alpha };
    if (prev && alpha > 0.01 && Math.hypot(p.x - prev.cx, p.z - prev.cz) < 3) {
      const q = this.i % this.max, a = q * 4;
      const P = this.pos;
      P.set([prev.x, prev.y, prev.z, prev.x2, prev.y, prev.z2, L.x, L.y, L.z, L.x2, L.y, L.z2], a * 3);
      this.alpha.set([prev.a, prev.a, alpha, alpha], a);
      this.uv.set([0, prev.d, 1, prev.d, 0, L.d, 1, L.d], a * 2);
      this.i++;
      const g = this.mesh.geometry;
      g.attributes.position.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true; g.attributes.uv.needsUpdate = true;
    }
    this.last[wi] = alpha > 0.01 ? L : null;
  }
  clear() { this.pos.fill(0); this.alpha.fill(0); this.i = 0; this.last = [null, null, null, null]; const g = this.mesh.geometry; g.attributes.position.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true; }
}

export class Effects {
  constructor(scene, stage, quality) {
    this.scene = scene; this.stage = stage; this.q = quality;
    const maxDust = [350, 700, 1100, 1600][quality];
    this.dust = new Billboards(maxDust, { texture: smokeTexture() });
    this.debris = new Billboards(900, { texture: softDot(32, 0.6), lit: true, depthWrite: false });
    this.sparks = new Billboards(300, { texture: softDot(32, 0.2), blending: THREE.AdditiveBlending, lit: false });
    this.tracks = new Tracks([3000, 5000, 8000, 12000][quality]);
    const surf = stage.surface;
    this.tracks.uColor.value.set(surf === 'snow' ? 0x9aa6b8 : surf === 'tarmac' ? 0x111111 : new THREE.Color(stage.palette.road).multiplyScalar(0.45).getHex());
    scene.add(this.dust.mesh, this.debris.mesh, this.sparks.mesh, this.tracks.mesh);
    this.dustCol = new THREE.Color(stage.dust);
    this.acc = [0, 0, 0, 0];
    this.weather = null;
    if (stage.weather === 'rain' || stage.weather === 'snow') this.weather = new Weather(scene, stage.weather, quality);
    this.popLight = new THREE.PointLight(0xff8833, 0, 12, 2);
    scene.add(this.popLight);
    this.popT = 0;
  }

  setLighting(sunDir, sunCol, amb) {
    for (const b of [this.dust, this.debris]) { b.uniforms.uSun.value.copy(sunDir); b.uniforms.uSunCol.value.copy(sunCol); b.uniforms.uAmb.value.copy(amb); }
  }

  // Per-frame emission from the car.
  emit(car, dt, model) {
    const st = this.stage;
    _up.set(0, 1, 0).applyQuaternion(car.quat);
    _fw.set(0, 0, 1).applyQuaternion(car.quat);
    _rt.set(-1, 0, 0).applyQuaternion(car.quat);
    const speed = car.speed;
    car.wheels.forEach((w, i) => {
      if (!w.contact) { this.tracks.add(i, w.point, _rt, 0, 0.1); return; }
      const sf = SURFACES[w.surface] || SURFACES.gravel;
      const slip = clamp(w.slip / 8, 0, 1);
      const surf = w.surface;
      // Tyre tracks: always on loose surfaces, only when sliding on tarmac.
      const trackA = sf.loose ? clamp(0.25 + slip * 0.6, 0, 0.75) : clamp((slip - 0.25) * 1.2, 0, 0.85);
      this.tracks.add(i, w.point, _rt, speed > 0.5 ? trackA : 0, 0.11);
      // Dust and spray, mostly from the rear wheels.
      const rear = i >= 2;
      const rate = speed * (sf.dust * (rear ? 1 : 0.4)) * (0.5 + slip * 1.5) * (st.wet ? 0.3 : 1) * [0.5, 0.8, 1, 1.2][this.q];
      this.acc[i] += rate * dt * 0.55;
      while (this.acc[i] > 1) {
        this.acc[i] -= 1;
        const snow = surf === 'snow' || surf === 'snowbank' || surf === 'deepsnow' || surf === 'ice';
        const c = snow ? new THREE.Color(0.95, 0.97, 1) : this.dustCol;
        const back = -(4 + speed * 0.25) * (0.5 + Math.random() * 0.5);
        this.dust.spawn({
          x: w.point.x + (Math.random() - 0.5) * 0.4, y: w.point.y + 0.25, z: w.point.z + (Math.random() - 0.5) * 0.4,
          vx: _fw.x * back + car.vel.x * 0.35 + (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 1.8, vz: _fw.z * back + car.vel.z * 0.35 + (Math.random() - 0.5) * 2,
          drag: 1.4, grav: -0.15, age: 0, life: snow ? 2.6 + Math.random() * 1.5 : 3.5 + Math.random() * 3.5,
          s0: 0.7, s1: snow ? 5 : 7 + Math.random() * 4, r: c.r, g: c.g, b: c.b, a: snow ? 0.55 : 0.32 + slip * 0.15,
          rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.6, fadeIn: 0.25, fadePow: 1.6,
        });
      }
      // Flying stones / chunks of snow on loose surfaces.
      if (sf.loose && speed > 6 && Math.random() < (0.3 + slip) * dt * speed * 0.6) {
        for (let k = 0; k < 2; k++) {
          const snow = surf.includes('snow') || surf === 'ice';
          const dc = snow ? [0.92, 0.94, 0.98] : [this.dustCol.r * 0.45, this.dustCol.g * 0.42, this.dustCol.b * 0.4];
          const spd = 4 + Math.random() * 7 + slip * 5;
          this.debris.spawn({
            x: w.point.x, y: w.point.y + 0.15, z: w.point.z,
            vx: -_fw.x * spd + car.vel.x * 0.5 + (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4, vz: -_fw.z * spd + car.vel.z * 0.5 + (Math.random() - 0.5) * 4,
            drag: 0.3, grav: 9.8, age: 0, life: 0.9 + Math.random() * 0.6, s0: snow ? 0.12 : 0.06, s1: snow ? 0.2 : 0.07,
            r: dc[0], g: dc[1], b: dc[2], a: 1, rot: 0, spin: 0, fadeIn: 0.01, fadePow: 0.3, floor: w.point.y,
          });
        }
      }
      // Water splash.
      if (surf === 'water' && speed > 3) {
        const n = Math.min(6, speed * dt * 8);
        for (let k = 0; k < n; k++) {
          const side = Math.random() < 0.5 ? -1 : 1;
          const spd = speed * (0.3 + Math.random() * 0.4);
          this.dust.spawn({
            x: w.point.x, y: w.point.y + 0.2, z: w.point.z,
            vx: _rt.x * side * spd * 0.6 + car.vel.x * 0.5, vy: 2 + Math.random() * speed * 0.35, vz: _rt.z * side * spd * 0.6 + car.vel.z * 0.5,
            drag: 0.6, grav: 9.8, age: 0, life: 0.9 + Math.random() * 0.5, s0: 0.5, s1: 2.6,
            r: 0.85, g: 0.88, b: 0.9, a: 0.7, rot: Math.random() * 6, spin: 1, fadeIn: 0.02, fadePow: 1,
          });
        }
      }
      // Tyre smoke on tarmac when sliding hard.
      if (!sf.loose && slip > 0.45 && Math.random() < dt * 30 * slip) {
        this.dust.spawn({
          x: w.point.x, y: w.point.y + 0.2, z: w.point.z,
          vx: car.vel.x * 0.2, vy: 0.6, vz: car.vel.z * 0.2, drag: 1.2, grav: -0.2, age: 0, life: 2.2,
          s0: 0.6, s1: 4.5, r: 0.85, g: 0.85, b: 0.86, a: 0.35 * slip, rot: Math.random() * 6, spin: 0.4, fadeIn: 0.15, fadePow: 1.5,
        });
      }
    });
    // Rain spray from the tyres.
    if (st.wet && speed > 8) {
      for (let k = 0; k < 2; k++) {
        const w = car.wheels[2 + k];
        if (!w.contact || Math.random() > speed * dt * 0.9) continue;
        this.dust.spawn({ x: w.point.x, y: w.point.y + 0.3, z: w.point.z, vx: car.vel.x * 0.6, vy: 1.2, vz: car.vel.z * 0.6, drag: 2.2, grav: 0.5, age: 0, life: 1.2, s0: 0.6, s1: 3.2, r: 0.75, g: 0.78, b: 0.8, a: 0.22, rot: Math.random() * 6, spin: 0.3, fadeIn: 0.05 });
      }
    }
    // Exhaust smoke at idle/low speed.
    if (speed < 5 && Math.random() < dt * 6) {
      model.root.localToWorld(_v.copy(model.flamePos));
      this.dust.spawn({ x: _v.x, y: _v.y, z: _v.z, vx: -_fw.x * 1.5, vy: 0.3, vz: -_fw.z * 1.5, drag: 1, grav: -0.3, age: 0, life: 1.6, s0: 0.2, s1: 1.4, r: 0.6, g: 0.6, b: 0.62, a: 0.18, rot: 0, spin: 0.5 });
    }
    if (this.popT > 0) { this.popT -= dt; this.popLight.intensity = Math.max(0, this.popT) * 400; }
  }

  backfire(model, big) {
    model.root.localToWorld(_v.copy(model.flamePos));
    this.popLight.position.copy(_v);
    this.popT = big ? 0.09 : 0.05;
    for (let k = 0; k < (big ? 10 : 4); k++) {
      this.sparks.spawn({ x: _v.x, y: _v.y, z: _v.z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3, drag: 2, grav: 2, age: 0, life: 0.18, s0: 0.25, s1: 0.05, r: 1, g: 0.55, b: 0.2, a: 1, rot: 0, spin: 0 });
    }
  }

  impact(p, strength, surfaceSparks = true) {
    const n = Math.round(10 + strength * 40);
    for (let k = 0; k < n; k++) {
      if (surfaceSparks) this.sparks.spawn({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 10, vy: Math.random() * 6, vz: (Math.random() - 0.5) * 10, drag: 1, grav: 9.8, age: 0, life: 0.3 + Math.random() * 0.4, s0: 0.08, s1: 0.03, r: 1, g: 0.75, b: 0.35, a: 1, rot: 0, spin: 0 });
      this.debris.spawn({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 8, vy: Math.random() * 6, vz: (Math.random() - 0.5) * 8, drag: 0.3, grav: 9.8, age: 0, life: 1.2, s0: 0.08, s1: 0.08, r: 0.15, g: 0.15, b: 0.15, a: 1, rot: 0, spin: 0, fadePow: 0.3 });
    }
    for (let k = 0; k < 4 + strength * 8; k++) {
      this.dust.spawn({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 3, drag: 1.5, grav: 0, age: 0, life: 2.5, s0: 1, s1: 5, r: this.dustCol.r, g: this.dustCol.g, b: this.dustCol.b, a: 0.4, rot: Math.random() * 6, spin: 0.3 });
    }
  }

  landing(car, strength) {
    for (const w of car.wheels) {
      for (let k = 0; k < 6 * strength; k++) this.dust.spawn({ x: w.point.x, y: w.point.y + 0.2, z: w.point.z, vx: (Math.random() - 0.5) * 6 + car.vel.x * 0.3, vy: 0.5 + Math.random() * 2, vz: (Math.random() - 0.5) * 6 + car.vel.z * 0.3, drag: 1.6, grav: 0, age: 0, life: 3, s0: 1, s1: 6, r: this.dustCol.r, g: this.dustCol.g, b: this.dustCol.b, a: 0.35, rot: Math.random() * 6, spin: 0.3, fadeIn: 0.1 });
    }
  }

  update(dt, camera) {
    this.dust.update(dt); this.debris.update(dt); this.sparks.update(dt);
    this.weather?.update(dt, camera);
  }

  clear() { this.dust.clear(); this.debris.clear(); this.sparks.clear(); this.tracks.clear(); }

  dispose() {
    for (const m of [this.dust.mesh, this.debris.mesh, this.sparks.mesh, this.tracks.mesh, this.popLight]) { this.scene.remove(m); m.geometry?.dispose(); m.material?.dispose(); }
    this.weather?.dispose();
  }
}

// Rain streaks or snowflakes in a box that travels with the camera.
class Weather {
  constructor(scene, kind, quality) {
    this.scene = scene; this.kind = kind;
    const n = [2500, 5000, 8000, 12000][quality];
    const g = new THREE.InstancedBufferGeometry();
    const rain = kind === 'rain';
    g.setAttribute('position', new THREE.Float32BufferAttribute(rain ? [-0.008, 0, 0, 0.008, 0, 0, 0.008, 1, 0, -0.008, 1, 0] : [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const off = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { off[i * 4] = Math.random(); off[i * 4 + 1] = Math.random(); off[i * 4 + 2] = Math.random(); off[i * 4 + 3] = Math.random(); }
    g.setAttribute('iOff', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = n;
    this.u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime; uniform vec3 uCam, uVel; attribute vec4 iOff; varying float vA; varying vec2 vP;
        void main() {
          float box = ${rain ? '36.0' : '44.0'};
          float fall = ${rain ? '18.0' : '1.6'};
          vec3 p = iOff.xyz * box;
          p.y -= uTime * fall * (0.8 + 0.4 * iOff.w);
          ${rain ? '' : 'p.x += sin(uTime * 0.7 + iOff.w * 30.0) * 1.5; p.z += cos(uTime * 0.5 + iOff.w * 20.0) * 1.5;'}
          p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          ${rain ? `
            vec3 streak = (viewMatrix * vec4(-uVel * 0.03 + vec3(0.0, -0.9, 0.0), 0.0)).xyz;
            mv.xyz += streak * position.y; mv.x += position.x * 1.5;` : `
            mv.xy += position.xy * (0.06 + iOff.w * 0.06);`}
          vA = (${rain ? '0.28' : '0.85'}) * smoothstep(0.0, 4.0, -mv.z) * (1.0 - smoothstep(box * 0.4, box * 0.5, length(mv.xyz)));
          vP = position.xy;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; varying vec2 vP; void main() { ${rain ? 'gl_FragColor = vec4(0.75, 0.8, 0.88, vA);' : 'float d = length(vP) * 2.0; gl_FragColor = vec4(vec3(0.96, 0.98, 1.0), vA * smoothstep(1.0, 0.3, d));'} }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.lastCam = new THREE.Vector3();
  }
  update(dt, camera) {
    this.u.uTime.value += dt;
    const v = this.u.uVel.value.copy(camera.position).sub(this.lastCam).divideScalar(Math.max(dt, 1e-3));
    if (v.length() > 80) v.set(0, 0, 0);
    this.lastCam.copy(camera.position);
    this.u.uCam.value.copy(camera.position);
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
