// Sky dome (atmospheric gradient, sun disc, drifting clouds, stars), sun
// and moon lights with a shadow box that follows the car, lens flare, and
// photographed image-based lighting for reflections.
import * as THREE from '../../vendor/three.module.min.js';
import { EXRLoader } from '../../vendor/addons/loaders/EXRLoader.js';
import { Lensflare, LensflareElement } from '../../vendor/addons/objects/Lensflare.js';
import { softDot } from './textures.js';
import { hdriUrl } from './assets.js';

const envCache = new Map();
// Full-resolution skies are plain .exr files (see assets/tex/manifest.json); the
// small studio sky for the showroom is packaged as a JS module.
export function loadEnvironment(name, renderer) {
  if (!envCache.has(name)) {
    const bytesP = hdriUrl(name).then(async (url) => {
      if (url) return (await fetch(url)).arrayBuffer();
      const { default: b64 } = await import(`../assets/hdri/${name}.exr.js`);
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    });
    envCache.set(name, bytesP.then((buf) => {
      const td = new EXRLoader().parse(buf);
      const tex = new THREE.DataTexture(td.data, td.width, td.height, td.format, td.type);
      tex.colorSpace = td.colorSpace ?? THREE.LinearSRGBColorSpace;
      tex.flipY = false;
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.needsUpdate = true;
      const pm = new THREE.PMREMGenerator(renderer);
      const rt = pm.fromEquirectangular(tex);
      pm.dispose(); tex.dispose();
      return rt.texture;
    }).catch((e) => { console.warn('env map failed', e); return null; }));
  }
  return envCache.get(name);
}

const skyVert = `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFrag = `
uniform vec3 uSunDir, uZenith, uHorizon, uSunCol, uGround, uCloudCol, uCloudShade;
uniform float uTime, uCloud, uNight, uSunSize;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float sd = max(dot(d, uSunDir), 0.0);
  // Atmosphere: horizon haze to deep zenith, warmer toward the sun.
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
  col += uSunCol * (pow(sd, 6.0) * 0.35 + pow(sd, 48.0) * 0.6) * (1.0 - uNight * 0.8);
  col = mix(col, uGround, smoothstep(0.0, -0.08, h));
  // Sun disc.
  float disc = smoothstep(uSunSize, uSunSize * 1.04, sd);
  col += uSunCol * disc * 30.0 * (1.0 - uNight);
  // Stars and moon glow at night.
  if (uNight > 0.0) {
    vec2 sp = d.xz / max(0.08, d.y + 0.3) * 160.0;
    float st = step(0.996, hash(floor(sp))) * smoothstep(0.0, 0.25, h) * (0.6 + 0.4 * sin(uTime * 3.0 + hash(floor(sp)) * 40.0));
    col += vec3(st) * uNight * 1.4;
    col += vec3(0.6, 0.7, 1.0) * smoothstep(0.9993, 0.9996, sd) * 4.0 * uNight;
    col += vec3(0.2, 0.25, 0.4) * pow(sd, 30.0) * uNight;
  }
  // Clouds: two layers projected onto a plane above.
  if (h > 0.0 && uCloud > 0.0) {
    vec2 uv = d.xz / (h + 0.12);
    float c1 = fbm(uv * 1.1 + vec2(uTime * 0.004, uTime * 0.002));
    float c2 = fbm(uv * 3.4 - vec2(uTime * 0.007, 0.0));
    float cov = 1.0 - uCloud;
    float c = smoothstep(cov - 0.05, cov + 0.32, c1 * 0.78 + c2 * 0.32);
    float shade = smoothstep(cov, cov + 0.6, fbm(uv * 1.1 + 0.08 + vec2(uTime * 0.004, uTime * 0.002)));
    vec3 cc = mix(uCloudCol, uCloudShade, shade * 0.85);
    cc += uSunCol * pow(sd, 8.0) * 0.8 * (1.0 - shade) * (1.0 - uNight);   // silver lining
    float fade = smoothstep(0.0, 0.12, h);
    col = mix(col, cc, c * fade * 0.95);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(scene, stage, quality) {
    this.scene = scene; this.stage = stage;
    const s = stage.sky;
    const elev = s.elev * Math.PI / 180, az = s.azim * Math.PI / 180;
    this.sunDir = new THREE.Vector3(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)).normalize();
    const night = s.night ? 1 : 0;
    const lowSun = 1 - Math.min(1, Math.max(0, s.elev) / 35);
    const zen = new THREE.Color(night ? 0x02040c : 0x2a64b8).lerp(new THREE.Color(0x6f8fb8), s.cloud * 0.6);
    const hor = new THREE.Color(stage.fog.color);
    const sunCol = new THREE.Color(1, 0.93, 0.82).lerp(new THREE.Color(1, 0.62, 0.32), lowSun * 0.8);
    this.uniforms = {
      uSunDir: { value: night ? new THREE.Vector3(-this.sunDir.x, 0.45, -this.sunDir.z).normalize() : this.sunDir },
      uZenith: { value: zen }, uHorizon: { value: hor }, uSunCol: { value: sunCol },
      uGround: { value: hor.clone().multiplyScalar(0.6) },
      uCloudCol: { value: night ? new THREE.Color(0x1a2030) : new THREE.Color(1, 1, 1).lerp(sunCol, lowSun * 0.4).multiplyScalar(1.15 - s.cloud * 0.45) },
      uCloudShade: { value: night ? new THREE.Color(0x0a0e18) : new THREE.Color(0x7d8794).lerp(new THREE.Color(0x4a5260), s.cloud) },
      uTime: { value: 0 }, uCloud: { value: s.cloud }, uNight: { value: night }, uSunSize: { value: 0.99965 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // Sun / moon light with soft shadows following the car.
    const sunI = stage.sunInt;
    this.sun = new THREE.DirectionalLight(night ? 0x8fa8e0 : sunCol, sunI);
    this.sun.castShadow = true;
    const ms = [1024, 2048, 2048, 4096][quality];
    this.sun.shadow.mapSize.set(ms, ms);
    const S = 70;
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 600 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(zen.clone().lerp(hor, 0.5), new THREE.Color(stage.palette.grass).multiplyScalar(0.5), night ? 0.15 : 0.35);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(stage.fog.color, stage.fog.density);
    // Lens flare on the sun.
    if (!night && s.elev > 0) {
      const flare = new Lensflare();
      const dot = softDot(128, 0.05);
      flare.addElement(new LensflareElement(dot, 380, 0, sunCol.clone().multiplyScalar(0.55)));
      flare.addElement(new LensflareElement(dot, 60, 0.6, new THREE.Color(0.5, 0.6, 1).multiplyScalar(0.3)));
      flare.addElement(new LensflareElement(dot, 90, 0.75, new THREE.Color(1, 0.7, 0.4).multiplyScalar(0.25)));
      flare.addElement(new LensflareElement(dot, 160, 0.92, new THREE.Color(0.4, 1, 0.6).multiplyScalar(0.12)));
      flare.addElement(new LensflareElement(dot, 40, 1.05, new THREE.Color(1, 1, 1).multiplyScalar(0.25)));
      this.flareLight = new THREE.PointLight(0xffffff, 0, 1);
      this.flareLight.add(flare);
      scene.add(this.flareLight);
    }
  }

  update(time, focus, camera) {
    this.uniforms.uTime.value = time;
    this.dome.position.copy(camera.position);
    const d = this.uniforms.uSunDir.value;
    this.sun.position.copy(focus).addScaledVector(d, 250);
    this.sun.target.position.copy(focus);
    // Snap the shadow box to texels to stop shimmering.
    if (this.flareLight) this.flareLight.position.copy(camera.position).addScaledVector(this.sunDir, 4000);
  }

  dispose() {
    this.scene.remove(this.dome, this.sun, this.sun.target, this.hemi);
    if (this.flareLight) this.scene.remove(this.flareLight);
    this.dome.geometry.dispose(); this.dome.material.dispose();
    this.sun.dispose?.();
    this.scene.fog = null;
  }
}
