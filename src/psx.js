// PlayStation-style rendering: low internal resolution, vertex snapping,
// affine texture mapping, Gouraud vertex colours, depth-cue fog and a final
// 15-bit colour quantise with ordered dithering.
import * as THREE from '../vendor/three.module.min.js';

export const psxUniforms = {
  uSnap: { value: new THREE.Vector2(160, 120) },
  uFogColor: { value: new THREE.Color(0x000000) },
  uFogNear: { value: 200 },
  uFogFar: { value: 900 },
  uAffine: { value: 0.65 },
  uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uTime: { value: 0 },
};

const VERT = /* glsl */ `
uniform vec2 uSnap;
uniform float uFogNear, uFogFar;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform float uEmissive;
out vec2 vUvP;
out vec3 vUvA; // uv*w, w: dividing per-pixel gives screen-linear (affine) uvs
out vec3 vColor;
out float vFog;
void main() {
  vec4 local = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  local = instanceMatrix * local;
  #endif
  vec4 mv = modelViewMatrix * local;
  vec4 p = projectionMatrix * mv;
  if (p.w > 0.05) {
    vec2 ndc = p.xy / p.w;
    ndc = floor(ndc * uSnap + 0.5) / uSnap;
    p.xy = ndc * p.w;
  }
  gl_Position = p;
  vUvP = uv;
  vUvA = vec3(uv * p.w, p.w);
  vec3 c = uColor;
  #ifdef USE_VCOLOR
  c *= color;
  #endif
  #ifdef LIT
  vec3 n = normalize(mat3(modelMatrix) * normal);
  float d = max(dot(n, uLightDir), 0.0);
  c *= mix(0.45 + 0.75 * d, 1.0, uEmissive);
  #endif
  vColor = c;
  vFog = clamp((-mv.z - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D tex;
uniform vec3 uFogColor;
uniform float uAffine;
uniform float uAlpha;
in vec2 vUvP;
in vec3 vUvA;
in vec3 vColor;
in float vFog;
void main() {
  vec4 c = vec4(vColor, uAlpha);
  #ifdef USE_TEX
  vec4 t = texture(tex, mix(vUvP, vUvA.xy / vUvA.z, uAffine));
  #ifndef ADDITIVE
  if (t.a < 0.5) discard;
  #endif
  c *= t;
  #endif
  #ifdef ADDITIVE
  c.rgb *= (1.0 - vFog) * c.a;
  #else
  #ifndef NOFOG
  c.rgb = mix(c.rgb, uFogColor, vFog);
  #endif
  #endif
  gl_FragColor = c;
}`;

// Global graphics style. Modern: lit PBR materials, full resolution, bloom.
// Retro: the PlayStation-style shader below.
export const renderStyle = { modern: true };

export function setOpacity(mat, a) {
  if (mat.uniforms && mat.uniforms.uAlpha) mat.uniforms.uAlpha.value = a;
  else mat.opacity = a;
}

function modernMaterial(opts) {
  const {
    map = null, color = 0xffffff, vertexColors = false, additive = false, transparent = false,
    alpha = 1, side = THREE.FrontSide, fog = true, depthWrite, glow = 0, rough = 0.72, metal = 0.08,
  } = opts;
  if (additive || transparent || !fog) {
    return new THREE.MeshBasicMaterial({
      map, color, vertexColors, side, fog: fog && !additive, opacity: alpha,
      transparent: transparent || additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: depthWrite ?? !(transparent || additive), toneMapped: !additive,
    });
  }
  const m = new THREE.MeshStandardMaterial({ map, color, vertexColors, side, roughness: rough, metalness: metal });
  if (glow) {
    m.emissive = new THREE.Color(map ? 0xffffff : color);
    m.emissiveMap = map;
    m.emissiveIntensity = glow;
  }
  return m;
}

export function psxMaterial(opts = {}) {
  if (renderStyle.modern) return modernMaterial(opts);
  const {
    map = null, color = 0xffffff, vertexColors = false, lit = false, additive = false,
    transparent = false, alpha = 1, side = THREE.FrontSide, fog = true, emissive = 0,
    depthWrite, affine = true,
  } = opts;
  const defines = {};
  if (map) defines.USE_TEX = '';
  if (vertexColors) defines.USE_VCOLOR = '';
  if (lit) defines.LIT = '';
  if (additive) defines.ADDITIVE = '';
  if (!fog) defines.NOFOG = '';
  const mat = new THREE.ShaderMaterial({
    defines,
    uniforms: {
      ...psxUniforms,
      uAffine: affine ? psxUniforms.uAffine : { value: 0 },
      tex: { value: map },
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: alpha },
      uEmissive: { value: emissive },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors,
    side,
    transparent: transparent || additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: depthWrite ?? !(transparent || additive),
  });
  return mat;
}

// Screen-space post pass: quantise to 5 bits per channel with 4x4 Bayer dither.
export function createPostPass() {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uDither: { value: 1 }, uFlash: { value: new THREE.Vector4(0, 0, 0, 0) } },
    vertexShader: `out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uDither; uniform vec4 uFlash; in vec2 vUv;
      const float bayer[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
      void main(){
        vec3 c = texture(tDiffuse, vUv).rgb;
        c = mix(c, uFlash.rgb, uFlash.a);
        ivec2 p = ivec2(gl_FragCoord.xy) % 4;
        float b = bayer[p.y * 4 + p.x] / 16.0 - 0.5;
        c += b * uDither / 31.0 * 1.5;
        c = floor(clamp(c, 0.0, 1.0) * 31.0 + 0.5) / 31.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  return { scene, cam, mat };
}
