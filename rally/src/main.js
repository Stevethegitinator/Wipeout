// Game shell: renderer and post-processing, showroom, menus, stage flow,
// cameras, replays and ghosts.
import * as THREE from '../../vendor/three.module.min.js';
import { EffectComposer } from '../../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../vendor/addons/postprocessing/OutputPass.js';
import { ShaderPass } from '../../vendor/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from '../../vendor/addons/postprocessing/GTAOPass.js';
import { STAGES, CARS, RIVALS, SURFACES } from './stages.js';
import { Road } from './road.js';
import { buildLayout } from './layout.js';
import { World } from './world.js';
import { Sky, loadEnvironment } from './sky.js';
import { Effects } from './fx.js';
import { Car } from './car.js';
import { buildCarModel } from './carmodel.js';
import { Audio } from './audio.js';
import { CoDriver } from './codriver.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Driver } from './ai.js';
import { clamp, lerp, damp, fmtTime, fmtDelta, wrapAngle, smoothstep, rng } from './util.js';

const params = new URLSearchParams(location.search);
const AUTOPILOT = params.has('autopilot');
const STORE = 'overcrest.';
const load = (k, d) => { try { const v = localStorage.getItem(STORE + k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(STORE + k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

// ---- Settings ------------------------------------------------------------------
const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const settings = Object.assign({ quality: mobile ? 1 : 2, voice: 'george', gearbox: 'auto', camera: 0, master: 0.9, engine: 1, codriver: 1, music: 0.6, difficulty: 1, assist: 1 }, load('settings', {}));
if (params.has('q')) settings.quality = clamp(+params.get('q'), 0, 3);

// ---- Height fog --------------------------------------------------------------------
// Replaces three.js's distance fog: mist is thickest in the dips below the camera
// and thins out over the hills, so valleys fill with haze and ridgelines stand clear.
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth; varying vec3 vFogWorld;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = THREE.ShaderChunk.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth; varying vec3 vFogWorld;');
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogDist = length(vFogWorld - cameraPosition);
    float hk = 0.022;                       // density halves every ~30 m of height
    float y0 = cameraPosition.y - 6.0, dy = vFogWorld.y - cameraPosition.y;
    float h0 = exp(-hk * (cameraPosition.y - y0));
    float avg = abs(dy) > 0.5 ? h0 * (1.0 - exp(-hk * dy)) / (hk * dy) : h0;
    float tau = fogDensity * fogDensity * fogDist * fogDist * clamp(avg, 0.15, 3.0);
    float fogFactor = 1.0 - exp(-tau);
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;

// ---- Renderer & post -----------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 6500);
let scene = new THREE.Scene();

const samples = () => [0, 2, 4, 8][settings.quality];
const composerRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: samples() });
const composer = new EffectComposer(renderer, composerRT);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const aoPass = new GTAOPass(scene, camera, 256, 256);
aoPass.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 1.5, distanceFallOff: 1, samples: 12 });
aoPass.blendIntensity = 0.8;
composer.addPass(aoPass);
// Sun shafts through the trees: march toward the sun gathering bright sky.
const raysPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.8) }, uRays: { value: 0 }, uTint: { value: new THREE.Color(1, 0.92, 0.75) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uRays; uniform vec3 uTint; varying vec2 vUv;
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      if (uRays <= 0.001) { gl_FragColor = vec4(base, 1.0); return; }
      vec2 delta = (vUv - uSun) * (0.9 / 40.0);
      vec2 p = vUv; float decay = 1.0; vec3 acc = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        p -= delta;
        vec3 s = texture2D(tDiffuse, clamp(p, 0.0, 1.0)).rgb;
        float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
        acc += s * smoothstep(0.9, 2.2, l) * decay;
        decay *= 0.95;
      }
      float fall = 1.0 - smoothstep(0.0, 1.0, length((vUv - uSun) * vec2(1.6, 1.0)));
      gl_FragColor = vec4(base + acc / 40.0 * uTint * uRays * (0.35 + fall), 1.0);
    }`,
});
composer.addPass(raysPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.55, 0.92);
composer.addPass(bloom);
// Grade: radial speed blur, chromatic fringe, saturation/contrast/tint, vignette, grain.
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uBlur: { value: 0 }, uAberr: { value: 0.25 }, uSat: { value: 1.05 }, uContrast: { value: 1.05 },
    uTint: { value: new THREE.Vector3(1, 1, 1) }, uVignette: { value: 0.42 }, uTime: { value: 0 }, uGrain: { value: 0.035 }, uFlash: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uBlur, uAberr, uSat, uContrast, uVignette, uTime, uGrain, uFlash; uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 3.1) * 43758.5453); }
    void main() {
      vec2 dir = vUv - vec2(0.5, 0.52); float d = length(dir);
      float amt = uBlur * 0.025 * smoothstep(0.15, 0.75, d);
      vec3 c = vec3(0.0);
      for (int i = 0; i < 8; i++) c += texture2D(tDiffuse, vUv - dir * amt * (float(i) / 7.0)).rgb;
      c /= 8.0;
      float ca = uAberr * 0.006 * d * d * 2.0;
      c.r = mix(c.r, texture2D(tDiffuse, vUv + dir * ca).r, 0.85);
      c.b = mix(c.b, texture2D(tDiffuse, vUv - dir * ca).b, 0.85);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c = max(vec3(0.0), (c - 0.18) * uContrast + 0.18) * uTint;
      c *= 1.0 - smoothstep(0.4, 0.95, d) * uVignette;
      c += (hash(vUv * 900.0) - 0.5) * uGrain * (0.4 + l);
      c = mix(c, vec3(1.0), uFlash);
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(gradePass);
composer.addPass(new OutputPass());

let W = 1, H = 1, dynScale = 1;
function applyQuality() {
  const q = settings.quality;
  aoPass.enabled = q >= 3;
  raysPass.enabled = q >= 2;
  bloom.enabled = true;
  renderer.shadowMap.enabled = q >= 1;
  composerRT.samples = samples();
  resize();
}
function resize() {
  W = innerWidth; H = innerHeight;
  const maxPR = [0.75, 1, 1.5, 2][settings.quality];
  const pr = Math.min(devicePixelRatio || 1, maxPR) * dynScale;
  renderer.setPixelRatio(pr);
  renderer.setSize(W, H, false);
  composer.setPixelRatio(pr);
  composer.setSize(W, H);
  bloom.resolution.set(W * pr / 2, H * pr / 2);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  hud.resize(W, H, Math.min(devicePixelRatio || 1, 2));
}

// ---- Core objects --------------------------------------------------------------
const hud = new Hud(document.getElementById('hud'));
const input = new Input();
const audio = new Audio();
Object.assign(audio.settings, { master: settings.master, engine: settings.engine, codriver: settings.codriver, music: settings.music });
addEventListener('resize', resize);
applyQuality();

// ---- Showroom (menus) ---------------------------------------------------------
const showroom = new THREE.Scene();
showroom.background = new THREE.Color(0x07090d);
showroom.fog = new THREE.Fog(0x07090d, 14, 40);
{
  // Unlit gradient floor plus a shadow catcher keeps the studio dark and moody.
  const fc = document.createElement('canvas'); fc.width = fc.height = 256;
  const fctx = fc.getContext('2d');
  const grd = fctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, '#1a2230'); grd.addColorStop(0.35, '#0d1118'); grd.addColorStop(1, '#07090d');
  fctx.fillStyle = grd; fctx.fillRect(0, 0, 256, 256);
  const ftex = new THREE.CanvasTexture(fc); ftex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshBasicMaterial({ map: ftex }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.505;
  showroom.add(floor);
  const catcher = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.ShadowMaterial({ opacity: 0.75 }));
  catcher.rotation.x = -Math.PI / 2; catcher.position.y = -0.5; catcher.receiveShadow = true;
  showroom.add(catcher);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.48, 96), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = -0.495;
  showroom.add(ring);
  const key = new THREE.SpotLight(0xffffff, 70, 40, 0.45, 0.8, 1.6);
  key.position.set(-3, 10, 3); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002;
  showroom.add(key, key.target);
  const rim = new THREE.SpotLight(0x5ad0ff, 90, 40, 0.5, 0.8, 1.6);
  rim.position.set(-6, 4, -7);
  showroom.add(rim, rim.target);
  const warm = new THREE.SpotLight(0xffb060, 50, 40, 0.5, 0.8, 1.6);
  warm.position.set(7, 2.5, -4);
  showroom.add(warm, warm.target);
  // Light strips overhead for streaky reflections in the paint.
  for (let i = -2; i <= 2; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 9), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4) }));
    strip.position.set(i * 1.6, 6.5, 0); showroom.add(strip);
  }
}
let showCar = null, showCarIdx = -1;
function setShowroomCar(i) {
  if (showCarIdx === i && showCar) return;
  if (showCar) showroom.remove(showCar.root);
  const spec = CARS[i];
  const tmp = new Car(spec, { stage: { wet: false } });
  showCar = buildCarModel(spec, tmp.wheels.map((w) => w.mount), tmp.R);
  showCar.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  showCar.fake = { wheels: tmp.wheels.map((w) => ({ ...w, len: 0.25, steer: 0, angle: 0 })) };
  showCar.pose(showCar.fake);
  showroom.add(showCar.root);
  showCarIdx = i;
}
loadEnvironment('studio', renderer).then((t) => { showroom.environment = t; showroom.environmentIntensity = 0.55; });

// ---- Game state ----------------------------------------------------------------
const G = {
  mode: 'title', // title | menu | loading | race
  race: null,
  menuCar: settings.lastCar ?? 0,
  menuStage: 0,
  rally: null, // { stages: [...], idx, results: [{stage, times}] }
  time: 0,
};

// ---- UI ----------------------------------------------------------------------
const ui = document.getElementById('ui');
let nav = { items: [], sel: 0, back: null, grid: 0 };
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
function screen(build) {
  const old = ui.querySelector('.screen.on');
  if (old) { old.classList.remove('on'); setTimeout(() => old.remove(), 400); }
  const s = el('div', 'screen');
  ui.appendChild(s);
  nav = { items: [], sel: 0, back: null, grid: 0, onMove: null };
  build(s);
  requestAnimationFrame(() => s.classList.add('on'));
  focus(nav.sel);
  return s;
}
function addNav(e, action, opts = {}) {
  const i = nav.items.length;
  nav.items.push({ e, action, ...opts });
  e.addEventListener('click', () => { focus(i); audio.ui('select'); action(); });
  e.addEventListener('mouseenter', () => { if (nav.sel !== i) { focus(i); } });
  return e;
}
function focus(i) {
  if (!nav.items.length) return;
  nav.sel = (i + nav.items.length) % nav.items.length;
  nav.items.forEach((it, k) => it.e.classList.toggle('sel', k === nav.sel));
  nav.items[nav.sel].e.scrollIntoView?.({ block: 'nearest' });
  nav.onMove?.(nav.sel);
}
function menuInput() {
  if (G.mode !== 'menu' && G.mode !== 'title') return;
  const up = input.hit('ArrowUp', 'KeyW', 'PadUp'), down = input.hit('ArrowDown', 'KeyS', 'PadDown');
  const left = input.hit('ArrowLeft', 'KeyA', 'PadLeft'), right = input.hit('ArrowRight', 'KeyD', 'PadRight');
  const ok = input.hit('Enter', 'Space', 'PadA'), back = input.hit('Escape', 'Backspace', 'PadB');
  const it = nav.items[nav.sel];
  if (nav.grid) {
    if (left) { focus(nav.sel - 1); audio.ui('move'); }
    if (right) { focus(nav.sel + 1); audio.ui('move'); }
    if (up) { focus(nav.sel - nav.grid); audio.ui('move'); }
    if (down) { focus(nav.sel + nav.grid); audio.ui('move'); }
  } else {
    if (up) { focus(nav.sel - 1); audio.ui('move'); }
    if (down) { focus(nav.sel + 1); audio.ui('move'); }
    if ((left || right) && it?.change) { it.change(left ? -1 : 1); audio.ui('move'); }
    else if ((left || right) && nav.lr) { nav.lr(left ? -1 : 1); audio.ui('move'); }
  }
  if (ok && it) { audio.ui('select'); it.action(); }
  if (back && nav.back) { audio.ui('back'); nav.back(); }
}

function titleScreen() {
  G.mode = 'title';
  setShowroomCar(G.menuCar);
  screen((s) => {
    s.appendChild(el('div', 'vignette'));
    const wrap = el('div', '', '');
    wrap.style.cssText = 'margin-top:auto;margin-bottom:auto;position:relative';
    wrap.appendChild(el('div', 'logo', '<span class="a sweep">Over Crest</span><span class="b"><span>Rally Championship</span></span>'));
    const p = el('div', 'press', 'PRESS ENTER / CLICK TO START');
    wrap.appendChild(p);
    s.appendChild(wrap);
    s.appendChild(el('div', 'hint', 'A tribute to the late-90s rally greats · headphones recommended'));
    const go = async () => { await startAudio(); mainMenu(); };
    addNav(p, go);
    s.addEventListener('click', go, { once: true });
  });
}
async function startAudio() {
  await audio.init();
  audio.setVolumes();
  audio.startMusic();
  if (settings.voice !== 'off' && audio.voiceName !== settings.voice) audio.loadVoice(settings.voice).catch((e) => console.warn(e));
}

function mainMenu() {
  G.mode = 'menu';
  audio.startMusic();
  setShowroomCar(G.menuCar);
  screen((s) => {
    s.appendChild(el('div', 'vignette'));
    s.appendChild(el('div', 'logo', '<span class="a" style="font-size:clamp(40px,6vw,84px)">Over Crest</span><span class="b"><span>Rally Championship</span></span>'));
    const m = el('div', 'menu');
    const items = [
      ['Rally Championship', 'Six stages, five countries. Beat seven crews on aggregate time.', () => carSelect('rally')],
      ['Single Stage', 'Pick a stage and set a time against the field.', () => carSelect('single')],
      ['Time Trial', 'Chase your own ghost. Best times are saved.', () => carSelect('trial')],
      ['Options', 'Graphics, co-driver, gearbox, audio.', optionsMenu],
      ['Controls', 'Keyboard, gamepad and touch.', controlsScreen],
    ];
    for (const [t, sub, fn] of items) m.appendChild(addNav(el('button', 'btn', `<span>${t}<small>${sub}</small></span>`), fn));
    s.appendChild(m);
    s.appendChild(el('div', 'hint', '<b>↑↓</b> choose <b>Enter</b> select <b>Esc</b> back'));
    nav.back = titleScreen;
  });
}

function carSelect(mode) {
  G.mode = 'menu';
  G.pendingMode = mode;
  let i = G.menuCar;
  setShowroomCar(i);
  screen((s) => {
    s.appendChild(el('div', 'vignette'));
    s.appendChild(el('div', 'hdr', `Choose your car <span class="tag">${mode === 'rally' ? 'CHAMPIONSHIP' : mode === 'trial' ? 'TIME TRIAL' : 'SINGLE STAGE'}</span>`));
    const info = el('div', 'carinfo glass');
    s.appendChild(info);
    const render = () => {
      const c = CARS[i];
      info.innerHTML = `<div class="cls">${c.cls}</div><h2>${c.name}</h2><p>${c.blurb}</p>` +
        ['power', 'grip', 'handling', 'weight'].map((k) => `<div class="stat">${k === 'weight' ? 'lightness' : k}<div class="bar"><i style="width:${c.stats[k] * 100}%"></i></div></div>`).join('') +
        `<div class="stat">specs<span style="color:#fff;letter-spacing:.06em">${c.power} HP · ${c.mass} KG · ${c.turbo ? 'TURBO' : 'NA'} · ${c.redline} RPM</span></div>`;
      setShowroomCar(i);
      G.menuCar = i;
    };
    const arrows = el('div', 'arrows');
    const l = el('button', '', '‹'), r = el('button', '', '›');
    l.onclick = () => { i = (i + CARS.length - 1) % CARS.length; render(); audio.ui('move'); };
    r.onclick = () => { i = (i + 1) % CARS.length; render(); audio.ui('move'); };
    arrows.append(l, r);
    s.appendChild(arrows);
    const m = el('div', 'menu'); m.style.marginTop = '2vh';
    m.appendChild(addNav(el('button', 'btn', '<span>Select car</span>'), () => { settings.lastCar = i; save('settings', settings); mode === 'rally' ? startRally() : stageSelect(mode); }));
    s.appendChild(m);
    nav.lr = (d) => { i = (i + CARS.length + d) % CARS.length; render(); };
    nav.back = mainMenu;
    s.appendChild(el('div', 'hint', '<b>←→</b> change car <b>Enter</b> select <b>Esc</b> back'));
    render();
  });
}

const STAGE_BG = (st) => {
  const p = st.palette;
  const c1 = '#' + new THREE.Color(st.fog.color).getHexString(), c2 = '#' + new THREE.Color(p.grass).getHexString(), c3 = '#' + new THREE.Color(p.road).getHexString();
  return `linear-gradient(160deg, ${c1} 0%, ${c2} 55%, ${c3} 100%)`;
};
function stageSelect(mode) {
  G.mode = 'menu';
  screen((s) => {
    s.appendChild(el('div', 'vignette'));
    s.appendChild(el('div', 'hdr', `Choose a stage <span class="tag">${CARS[G.menuCar].name.toUpperCase()}</span>`));
    const grid = el('div', 'stages');
    const best = load('best', {});
    STAGES.forEach((st, k) => {
      const card = el('div', 'card');
      card.style.backgroundImage = STAGE_BG(st);
      const b = best[`${st.id}:${CARS[G.menuCar].id}`];
      card.innerHTML = `<div class="rally">${st.rally} · ${st.country}</div><div class="name">${st.name}</div><div class="chips">
        <span class="chip">${st.surface}</span><span class="chip">${(st.length / 1000).toFixed(1)} km</span>
        <span class="chip">${st.night ? 'night' : st.weather === 'rain' ? 'rain' : st.weather === 'snow' ? 'snow' : st.sky.elev < 15 ? 'low sun' : 'day'}</span>
        ${b ? `<span class="chip best">best ${fmtTime(b)}</span>` : ''}</div>`;
      grid.appendChild(addNav(card, () => { G.menuStage = k; startStage({ mode, stage: k, car: G.menuCar }); }));
    });
    s.appendChild(grid);
    const cols = () => Math.max(1, Math.round(grid.clientWidth / 274));
    nav.grid = 3;
    setTimeout(() => { nav.grid = cols(); }, 50);
    nav.sel = G.menuStage;
    nav.back = () => carSelect(mode);
    s.appendChild(el('div', 'hint', '<b>Arrows</b> choose <b>Enter</b> drive <b>Esc</b> back'));
  });
}

const OPTION_DEFS = [
  ['Graphics quality', 'quality', [0, 1, 2, 3], ['Low', 'Medium', 'High', 'Ultra']],
  ['Co-driver', 'voice', ['george', 'emma', 'off'], ['George (UK)', 'Emma (UK)', 'Off']],
  ['Gearbox', 'gearbox', ['auto', 'manual'], ['Automatic', 'Manual (Q / E)']],
  ['Camera', 'camera', [0, 1, 2, 3, 4], ['Chase far', 'Chase near', 'Bonnet', 'Bumper', 'Helicopter']],
  ['Rival pace', 'difficulty', [0, 1, 2], ['Easy', 'Professional', 'Champion']],
  ['Drift assist', 'assist', [0, 1], ['Off (pro)', 'On']],
  ['Master volume', 'master', [0, 0.3, 0.6, 0.9, 1.2], ['0%', '25%', '50%', '75%', '100%']],
  ['Engine volume', 'engine', [0, 0.5, 0.8, 1, 1.3], ['Off', 'Low', 'Medium', 'High', 'Max']],
  ['Co-driver volume', 'codriver', [0, 0.6, 1, 1.4], ['Off', 'Low', 'Normal', 'Loud']],
  ['Music volume', 'music', [0, 0.3, 0.6, 1], ['Off', 'Low', 'Medium', 'High']],
];
function optionsMenu(fromPause) {
  G.mode = fromPause ? G.mode : 'menu';
  screen((s) => {
    s.appendChild(el('div', 'vignette'));
    s.appendChild(el('div', 'hdr', 'Options'));
    const box = el('div', 'opts');
    for (const [label, key, vals, names] of OPTION_DEFS) {
      const row = el('div', 'opt');
      const val = el('span', 'val');
      const show = () => { const k = vals.findIndex((v) => v === settings[key]); val.textContent = names[k < 0 ? 0 : k]; };
      row.append(el('span', '', label), val);
      show();
      const change = (d) => {
        let k = vals.findIndex((v) => v === settings[key]); if (k < 0) k = 0;
        settings[key] = vals[(k + d + vals.length) % vals.length];
        show();
        save('settings', settings);
        if (key === 'quality') applyQuality();
        if (['master', 'engine', 'codriver', 'music'].includes(key)) { audio.settings[key] = settings[key]; audio.setVolumes(); }
        if (key === 'voice' && settings.voice !== 'off') audio.loadVoice(settings.voice).then(() => audio.say(['hard_right', 'into', 'easy_left', 'd100'])).catch(() => {});
        if (key === 'codriver' && settings.codriver > 0) audio.say(['caution', 'hairpin_left']);
      };
      box.appendChild(addNav(row, () => change(1), { change }));
    }
    s.appendChild(box);
    const m = el('div', 'row');
    m.appendChild(addNav(el('button', 'btn', '<span>Back</span>'), () => (fromPause ? pauseMenu() : mainMenu())));
    s.appendChild(m);
    nav.back = () => (fromPause ? pauseMenu() : mainMenu());
    s.appendChild(el('div', 'hint', '<b>←→</b> change <b>Esc</b> back'));
  });
}

function controlsScreen() {
  G.mode = 'menu';
  screen((s) => {
    s.appendChild(el('div', 'vignette'));
    s.appendChild(el('div', 'hdr', 'Controls'));
    const rows = [
      ['Accelerate', '↑ / W', 'RT / A'], ['Brake · reverse', '↓ / S', 'LT / X'], ['Steer', '← → / A D', 'Left stick'],
      ['Handbrake', 'Space', 'B / RB'], ['Gear up · down (manual)', 'E · Q', 'Y · LB'], ['Change camera', 'C', 'View / Back'],
      ['Recover to road', 'R', 'D-pad up'], ['Pause', 'Esc / P', 'Start'],
    ];
    const g = el('div', 'keys');
    for (const [a, k, p] of rows) g.append(el('div', '', a), el('div', 'k', k), el('div', 'p', p));
    s.appendChild(g);
    s.appendChild(el('p', '', '<span style="color:#9fb3c8;max-width:640px;display:block;line-height:1.5;margin-top:3vh">Listen to your co-driver: corners are called <b style="color:#fff">flat, easy, medium, hard, square</b> and <b style="color:#fff">hairpin</b>, from fastest to slowest, with the distance to the next call. Lift or flick the handbrake to throw the car in, then catch the slide with the throttle.</span>'));
    const m = el('div', 'row');
    m.appendChild(addNav(el('button', 'btn', '<span>Back</span>'), mainMenu));
    s.appendChild(m);
    nav.back = mainMenu;
  });
}

function clearUI() { const old = ui.querySelector('.screen.on'); if (old) { old.classList.remove('on'); setTimeout(() => old.remove(), 400); } nav = { items: [], sel: 0, back: null }; }

// ---- Rival times -----------------------------------------------------------------
// A quick lap-time estimate from corner radii and grip, used to set the field's pace.
function parTime(road, stage) {
  const surf = SURFACES[stage.wet ? stage.surface + '_wet' : stage.surface] || SURFACES[stage.surface] || SURFACES.gravel;
  const mu = surf.mu * 0.9;
  const ds = 2, n = Math.floor(road.finish / ds);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = road.start + i * ds;
    const k = Math.abs(road.frameAt(s).k);
    v[i] = Math.min(52, k > 1e-4 ? Math.sqrt(mu * 9.81 / k) * 1.03 : 52);
    for (const f of road.features) if (f.type === 'splash' && Math.abs(s - f.s) < f.w * 0.6) v[i] = Math.min(v[i], 17);
  }
  for (let i = 1; i < n; i++) { const a = Math.min(mu * 9.81 * 0.8, 380000 / (1300 * Math.max(v[i - 1], 5))); v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * a * ds)); }
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * mu * 9.81 * 0.8 * ds));
  v[0] = 0.1;
  let t = 1.2; // launch
  for (let i = 1; i < n; i++) t += ds / Math.max(1, (v[i] + v[i - 1]) / 2);
  return t;
}
function rivalTimes(road, stage, seed) {
  const par = parTime(road, stage);
  const diff = [1.24, 1.13, 1.045][settings.difficulty]; // calibrated against the AI driver (≈ par × 1.17)
  const r = rng(seed);
  return RIVALS.map((rv) => ({ name: rv.name, car: rv.car, time: par * rv.pace * diff * (1 + (r() - 0.5) * 0.016) })).sort((a, b) => a.time - b.time);
}

// ---- Rally mode ------------------------------------------------------------------
function startRally() {
  G.rally = { idx: 0, car: G.menuCar, totals: Object.fromEntries(RIVALS.map((r) => [r.name, 0])), me: 0, stageResults: [] };
  G.rally.totals.YOU = 0;
  startStage({ mode: 'rally', stage: 0, car: G.menuCar });
}

// ---- Stage loading ---------------------------------------------------------------
const TIPS = [
  'Your co-driver calls corners by how fast you can take them: flat is nearly flat out, hairpin is first gear.',
  'Lift off the throttle to shift weight forward and tuck the nose in. Flick the handbrake for hairpins.',
  '"Don\'t cut" means a rock sits on the inside of the corner. Believe it.',
  '"Caution" is your co-driver telling you that this one bites. Slow in, fast out.',
  'On gravel the car wants to slide. Steer with the throttle and catch it early.',
  'Snowbanks will hold you up if you lean on them gently. Hit them hard and you are stuck.',
  'On tarmac, the tyres grip harder but let go suddenly. Be smooth.',
  'Over a crest, keep the wheels straight. Land on all four, then turn.',
];
let loadingToken = 0;
async function startStage(opts) {
  const token = ++loadingToken;
  G.mode = 'loading';
  clearUI();
  audio.stopMusic();
  const st = STAGES[opts.stage];
  const spec = CARS[opts.car];
  const lo = document.getElementById('loading');
  document.getElementById('ld-stage').textContent = st.name;
  document.getElementById('ld-sub').textContent = `${st.rally} · ${(st.length / 1000).toFixed(1)} km · ${st.surface}`;
  document.getElementById('ld-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  const bar = document.getElementById('ld-bar');
  lo.classList.add('on');
  const step = async (p) => { bar.style.width = p + '%'; await new Promise((r) => setTimeout(r, 16)); if (token !== loadingToken) throw new Error('cancelled'); };
  try {
    disposeRace();
    await step(5);
    const road = new Road(st);
    await step(15);
    const layout = buildLayout(road, settings.quality);
    await step(25);
    scene = new THREE.Scene();
    const env = await loadEnvironment(st.hdri, renderer);
    scene.environment = env; scene.environmentIntensity = st.envInt;
    await step(35);
    const sky = new Sky(scene, st, settings.quality);
    await step(45);
    const world = new World(renderer, scene, road, layout, st, settings.quality);
    await step(80);
    const fx = new Effects(scene, st, settings.quality);
    const car = new Car(spec, road, { autoGear: settings.gearbox !== 'manual', assist: settings.assist ? 1 : 0 });
    car.place(road.start - 9);
    const model = buildCarModel(spec, car.wheels.map((w) => w.mount), car.R);
    model.setNight(!!st.night);
    model.setDirt(0, st.mud);
    scene.add(model.root);
    if (st.night) model.lights.forEach((l) => { l.castShadow = false; });
    await step(90);
    // Ghost for time trial.
    let ghost = null;
    if (opts.mode === 'trial') {
      const data = load(`ghost.${st.id}.${spec.id}`, null);
      if (data && data.frames?.length) {
        const gm = buildCarModel(spec, car.wheels.map((w) => w.mount), car.R);
        gm.root.traverse((o) => {
          if (o.isMesh && o.material) {
            const ms = [].concat(o.material).map((m) => { const c = m.clone(); c.transparent = true; c.opacity = 0.35; c.depthWrite = false; return c; });
            o.material = Array.isArray(o.material) ? ms : ms[0];
            o.castShadow = false;
          }
        });
        gm.root.visible = false;
        scene.add(gm.root);
        ghost = { model: gm, data, time: data.time };
      }
    }
    // Warm up shaders.
    renderPass.scene = scene; aoPass.scene = scene;
    sky.update(0, car.pos, camera);
    camera.position.set(car.pos.x, car.pos.y + 3, car.pos.z - 8);
    camera.lookAt(car.pos);
    renderer.compile(scene, camera);
    await step(100);
    const sunDirLight = sky.uniforms.uSunDir.value.clone();
    fx.setLighting(sunDirLight, sky.sun.color.clone().multiplyScalar(Math.min(1.2, st.sunInt / 3)), new THREE.Color(st.fog.color).multiplyScalar(st.night ? 0.25 : 0.55));
    const grade = st.grade;
    gradePass.uniforms.uSat.value = grade.sat; gradePass.uniforms.uContrast.value = grade.contrast;
    gradePass.uniforms.uTint.value.set(...grade.tint);
    renderer.toneMappingExposure = st.night ? 1.25 : 1.0;
    raysPass.uniforms.uTint.value.copy(sky.uniforms.uSunCol.value);
    const rivals = rivalTimes(road, st, st.seed + opts.car * 7 + (G.rally ? 0 : Math.floor(Math.random() * 1000)));
    const co = new CoDriver(road, audio);
    if (audio.ready && settings.voice !== 'off' && !audio.voiceClips) await audio.loadVoice(settings.voice).catch(() => {});
    audio.setVoice?.(spec);
    G.race = {
      opts, st, spec, road, layout, world, sky, fx, car, model, co, rivals, ghost,
      phase: 'intro', t: 0, time: 0, penalty: 0, splits: [], splitIdx: 0, frames: [], recT: 0,
      cam: { mode: settings.camera, pos: camera.position.clone(), yaw: car.heading(), look: car.pos.clone(), shake: 0, fov: 62 },
      driver: AUTOPILOT ? new Driver(car) : null, endDriver: null,
      stuckT: 0, wrongT: 0, lastGoodS: road.start, crowdLevel: 0, nearCrowdCheer: new Set(), countdown: null,
      replay: null, paused: false, finishT: 0,
    };
    lo.classList.remove('on');
    hud.msgs = [];
    G.mode = 'race';
    // Test hooks: ?quick skips the intro and countdown, ?at=metres starts further down the stage, ?cam=N.
    if (params.has('quick')) { G.race.phase = 'running'; car.gear = 1; G.race.goT = 2; }
    if (params.has('at')) { car.place(+params.get('at')); G.race.co.reset(car.s); G.race.lastGoodS = car.s; }
    if (params.has('cam')) G.race.cam.mode = +params.get('cam');
    hud.message(st.name.toUpperCase(), `${st.rally} · ${((road.finish - road.start) / 1000).toFixed(1)} km`, '#ffcc00', 3.2, true);
    if (audio.ready) setTimeout(() => G.race?.phase === 'intro' && audio.say(['ready'], { priority: true }), 900);
  } catch (e) {
    if (e.message !== 'cancelled') { console.error(e); toast('Failed to load stage: ' + e.message); lo.classList.remove('on'); mainMenu(); }
  }
}

function disposeRace() {
  const R = G.race;
  if (!R) return;
  R.world.dispose(); R.sky.dispose(); R.fx.dispose();
  scene.remove(R.model.root);
  if (R.ghost) scene.remove(R.ghost.model.root);
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  audio.silenceCar();
  G.race = null;
}

function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; clearTimeout(toast.t); toast.t = setTimeout(() => { t.textContent = ''; }, 4000); }

// ---- Race loop ---------------------------------------------------------------------
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _fw = new THREE.Vector3(), _q = new THREE.Quaternion();

function raceUpdate(dt) {
  const R = G.race;
  if (camera.view?.enabled) camera.clearViewOffset();
  const { car, road, model, fx, co, world, sky } = R;
  if (input.hit('Escape', 'KeyP', 'PadStart') && !R.replay && R.phase !== 'done') { pauseMenu(); return; }
  if (input.hit('KeyC', 'PadBack', 'PadY') && !(settings.gearbox === 'manual' && input.hit('PadY'))) { R.cam.mode = (R.cam.mode + 1) % 5; settings.camera = R.cam.mode; save('settings', settings); }
  if (R.replay) { replayUpdate(dt); return; }
  R.t += dt;
  // Inputs.
  let inp = input.drive(dt, car.speed);
  if (settings.gearbox === 'manual') { inp.shiftUp = input.hit('KeyE', 'PadY', 'PadRB'); inp.shiftDown = input.hit('KeyQ', 'PadLB'); }
  if (R.driver) inp = R.driver.update(dt);
  if (R.phase === 'intro') {
    car.gear = 0;
    inp = { ...inp, steer: 0, brake: 1, handbrake: 1 };
    if (R.t > 2.6) { R.phase = 'countdown'; R.t = 0; R.cdLast = 6; }
  } else if (R.phase === 'countdown') {
    car.gear = 0;
    inp = { ...inp, steer: 0, brake: 0, handbrake: 1 };
    const n = 5 - Math.floor(R.t);
    if (n !== R.cdLast) {
      R.cdLast = n;
      if (n > 0) { audio.beep(false); if (n <= 3) audio.say(['c' + n], { priority: true }); }
    }
    R.countdown = n > 0 ? n : 0;
    if (R.t >= 5) {
      R.phase = 'running'; R.time = 0; R.countdown = 0;
      car.gear = 1; car.shiftCool = 0.6;
      audio.beep(true); audio.say(['go'], { priority: true });
      R.goT = 0;
    }
  } else if (R.phase === 'running') {
    R.time += dt;
    R.goT += dt;
    if (R.goT > 1.2) R.countdown = undefined;
  } else if (R.phase === 'finished') {
    // Coast to a stop past the flying finish.
    inp = { steer: R.endDriver.update(dt).steer, throttle: 0, brake: car.speed > 3 ? 0.6 : 1, handbrake: 0 };
    R.finishT += dt;
    if (R.finishT > 4.5 && R.phase === 'finished') { R.phase = 'done'; resultsScreen(); }
  }
  car.update(inp, dt);
  // Events.
  for (const e of car.drainEvents()) {
    if (e.type === 'backfire') { audio.backfire(e.big); fx.backfire(model, e.big); R.flame = e.big ? 1 : 0.6; }
    else if (e.type === 'bov') audio.blowOff(e.amount);
    else if (e.type === 'shift') audio.shift();
    else if (e.type === 'impact') {
      audio.impact(e.strength, e.obstacle);
      if (e.x !== undefined) fx.impact(_v.set(e.x, e.y, e.z), e.strength, e.obstacle !== 'bale' && e.obstacle !== 'tree');
      if (e.local) model.dent(e.local, e.strength * 1.4);
      else if (e.ground && e.strength > 0.45) model.dent(new THREE.Vector3(0, 0.85, 0), e.strength);
      R.cam.shake = Math.max(R.cam.shake, e.strength * 1.2);
      if (e.strength > 0.5 && R.phase === 'running') co.remark(['ouch'], 5, true);
      if (e.obstacle === 'bale') R.penalty += 0;
    } else if (e.type === 'damage' && e.amount > 0.08 && R.phase === 'running') co.remark(['damage'], 12);
    else if (e.type === 'puncture') { co.remark(['puncture'], 2, true); hud.message('PUNCTURE', '', '#ff5a4a', 2.5); }
    else if (e.type === 'land') { audio.landing(e.strength); fx.landing(car, e.strength); R.cam.shake = Math.max(R.cam.shake, e.strength * 0.8); if (e.strength > 0.65 && R.phase === 'running') co.remark(['nice'], 8); }
  }
  // Splash.
  const inWater = car.wheels.some((w) => w.contact && w.surface === 'water');
  if (inWater && !R.wasWater) audio.splash(car.speed);
  R.wasWater = inWater;
  // Race logic.
  if (R.phase === 'running') {
    co.update(dt, car, true);
    if (co.halfway(car)) co.remark(['halfway'], 4);
    // Splits.
    if (R.splitIdx < road.splits.length && car.s >= road.splits[R.splitIdx] && car.s - road.splits[R.splitIdx] < 60) {
      const frac = (road.splits[R.splitIdx] - road.start) / (road.finish - road.start);
      const leader = R.rivals[0].time * frac;
      const t = R.time + R.penalty;
      R.splits.push({ label: `SPLIT ${R.splitIdx + 1}`, time: t, delta: t - leader });
      hud.message(`SPLIT ${R.splitIdx + 1}`, `${fmtTime(t)}   ${fmtDelta(t - leader)} to ${R.rivals[0].name}`, t - leader <= 0 ? '#4dff88' : '#ff7a5a', 3);
      audio.say(['split']);
      R.splitIdx++;
    }
    // Finish.
    if (car.s >= road.finish && car.s - road.finish < 80) {
      R.phase = 'finished'; R.finishT = 0;
      R.final = R.time + R.penalty;
      R.endDriver = new Driver(car);
      audio.say(['finish'], { priority: true });
      const pos = R.rivals.filter((r) => r.time < R.final).length + 1;
      R.position = pos;
      hud.message('STAGE COMPLETE', `${fmtTime(R.final)} · P${pos}`, '#ffcc00', 4.2, true);
      setTimeout(() => audio.say([pos === 1 ? 'fastest' : pos <= 3 ? 'good_stage' : pos <= 6 ? 'ok_stage' : 'slow_stage']), 1600);
      saveBest();
    }
    // Recovery: well off the road, on the roof, or stuck.
    const off = car.roadDist > 16;
    const stuck = car.speed < 1 && car.roadDist > 2.5 && inp.throttle > 0.5;
    R.stuckT = stuck ? R.stuckT + dt : Math.max(0, R.stuckT - dt);
    if (car.roadDist < 1) R.lastGoodS = Math.max(R.lastGoodS, car.s);
    if (off || car.upsideTime > 2.2 || R.stuckT > 3 || input.hit('KeyR', 'PadUp')) recover();
    // Wrong way.
    const along = car.vel.x * Math.sin(road.frameAt(car.s).h) + car.vel.z * Math.cos(road.frameAt(car.s).h);
    R.wrongT = along < -4 ? R.wrongT + dt : 0;
    if (R.wrongT > 2.5) { R.wrongT = -4; hud.message('WRONG WAY', '', '#ff5a4a', 2); co.remark(['wrong_way'], 6, true); }
    // Recording for replay / ghost (30 Hz).
    R.recT += dt;
    if (R.recT >= 1 / 30) { R.recT -= 1 / 30; R.frames.push([R.time, ...car.snapshot()]); }
  } else co.update(dt, car, false);
  // Ghost playback.
  if (R.ghost && R.phase === 'running') {
    const f = sampleFrames(R.ghost.data.frames, R.time);
    if (f) { poseFromFrame(R.ghost.model, f); R.ghost.model.root.visible = true; R.ghost.s = road.nearest(f[1], f[3], 60, {}).s; }
  }
  // Crowd noise and cheers.
  let crowd = 0;
  for (const c of R.layout.crowds) {
    const f = road.frameAt(c.s);
    const d = Math.hypot(f.x - car.pos.x, f.z - car.pos.z);
    if (d < 90) crowd = Math.max(crowd, 1 - d / 90);
    if (d < 40 && !R.nearCrowdCheer.has(c) && R.phase === 'running') { R.nearCrowdCheer.add(c); audio.cheer(0.8 + car.speed / 40); }
  }
  R.crowdLevel = crowd;
  // Visuals.
  model.root.position.copy(car.pos);
  model.root.quaternion.copy(car.quat);
  model.pose(car);
  model.setBrake(inp.brake * (car.gear >= 0 ? 1 : 0));
  R.flame = Math.max(0, (R.flame || 0) - dt * 9);
  model.setFlame(R.flame, R.t);
  model.setDirt(car.dirt * 0.95);
  fx.emit(car, dt, model);
  audio.updateCar(car, dt, { stage: R.st, crowd, interior: R.cam.mode === 2 || R.cam.mode === 3 });
  updateCamera(dt);
  fx.update(dt, camera);
  world.update(dt, G.time, camera.position, car);
  sky.update(G.time, car.pos, camera);
  postFx(car.speed);
}

function recover() {
  const R = G.race, car = R.car;
  if (R.recovering) return;
  R.recovering = true;
  const fade = document.getElementById('fade');
  fade.style.opacity = 1;
  setTimeout(() => {
    if (!G.race) return;
    const s = clamp(Math.max(R.lastGoodS - 10, car.s - 15), R.road.start, R.road.finish - 5);
    car.place(s);
    R.penalty += 5;
    R.stuckT = 0;
    R.fx.tracks.last = [null, null, null, null];
    hud.message('RECOVERED', '+5s', '#ff9d2e', 2);
    R.co.reset(s);
    R.co.remark(['back_on'], 2, true);
    R.cam.pos.copy(car.pos).add(_v.set(-Math.sin(car.heading()) * 7, 3, -Math.cos(car.heading()) * 7));
    R.cam.yaw = car.heading();
    fade.style.opacity = 0;
    R.recovering = false;
  }, 380);
}

function saveBest() {
  const R = G.race;
  const key = `${R.st.id}:${R.spec.id}`;
  const best = load('best', {});
  R.newBest = !best[key] || R.final < best[key];
  if (R.newBest) {
    best[key] = R.final; save('best', best);
    // Ghost at 10 Hz, rounded, to keep storage small.
    const frames = R.frames.filter((_, i) => i % 3 === 0).map((f) => [f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7]].map((v) => Math.round(v * 1000) / 1000));
    save(`ghost.${R.st.id}.${R.spec.id}`, { time: R.final, frames });
  }
}

function sampleFrames(frames, t) {
  if (!frames.length) return null;
  let lo = 0, hi = frames.length - 1;
  if (t <= frames[0][0]) return frames[0];
  if (t >= frames[hi][0]) return frames[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (frames[m][0] <= t) lo = m; else hi = m; }
  const a = frames[lo], b = frames[hi], k = (t - a[0]) / (b[0] - a[0]);
  return a.map((v, i) => v + (b[i] - v) * k);
}
function poseFromFrame(model, f) {
  model.root.position.set(f[1], f[2], f[3]);
  _q.set(f[4], f[5], f[6], f[7]).normalize();
  model.root.quaternion.copy(_q);
}

// ---- Cameras ------------------------------------------------------------------------
function updateCamera(dt) {
  const R = G.race, car = R.car, C = R.cam;
  const hd = car.heading();
  _fw.set(Math.sin(hd), 0, Math.cos(hd));
  const speed = car.speed;
  const vh = speed > 3 ? Math.atan2(car.vel.x, car.vel.z) : hd;
  C.shake = Math.max(0, C.shake - dt * 2.5);
  let fov = 60 + Math.min(14, speed * 0.32);
  if (R.phase === 'intro') {
    // Swoop round the car on the start line.
    const a = hd + Math.PI * (0.9 - R.t * 0.32);
    C.pos.set(car.pos.x + Math.sin(a) * 7, car.pos.y + 1.6 + R.t * 0.3, car.pos.z + Math.cos(a) * 7);
    camera.position.copy(C.pos);
    camera.lookAt(car.pos.x, car.pos.y + 0.4, car.pos.z);
    fov = 50;
  } else if (R.phase === 'finished' || R.phase === 'done') {
    // Trackside TV shot of the finish.
    if (!C.finishPos) { const f = R.road.frameAt(R.road.finish + 45); C.finishPos = new THREE.Vector3(f.x + f.rx * 9, R.road.height(f.x + f.rx * 9, f.z + f.rz * 9) + 2.2, f.z + f.rz * 9); }
    camera.position.lerp(C.finishPos, 1 - Math.exp(-dt * 2));
    camera.lookAt(car.pos.x, car.pos.y + 0.4, car.pos.z);
    fov = clamp(2 * Math.atan(5 / camera.position.distanceTo(car.pos)) * 180 / Math.PI, 18, 60);
  } else if (C.mode === 2 || C.mode === 3) {
    // Bonnet / bumper: fixed to the body.
    const off = C.mode === 2 ? _v.set(0, 0.98, 0.35) : _v.set(0, 0.25, 2.35);
    off.applyQuaternion(car.quat).add(car.pos);
    camera.position.copy(off);
    _v2.set(0, C.mode === 2 ? 0.75 : 0.2, 30).applyQuaternion(car.quat).add(car.pos);
    camera.up.set(0, 1, 0).applyQuaternion(car.quat).lerp(_v.set(0, 1, 0), 0.6);
    camera.lookAt(_v2);
    camera.up.set(0, 1, 0);
    fov = 66 + Math.min(10, speed * 0.25);
  } else {
    const far = C.mode === 0, heli = C.mode === 4;
    const dist = heli ? 15 : far ? 6.6 : 4.8, height = heli ? 7.5 : far ? 2.1 : 1.55;
    // Follow mostly the car's heading, partly its direction of travel, so slides show.
    let target = hd + wrapAngle(vh - hd) * (heli ? 0.6 : 0.32);
    C.yaw += wrapAngle(target - C.yaw) * (1 - Math.exp(-dt * (heli ? 2 : 4.2)));
    const want = _v.set(car.pos.x - Math.sin(C.yaw) * dist, car.pos.y + height, car.pos.z - Math.cos(C.yaw) * dist);
    // Spring toward the target (looser vertically for a floaty feel over crests).
    C.pos.x = damp(C.pos.x, want.x, 14, dt); C.pos.z = damp(C.pos.z, want.z, 14, dt);
    C.pos.y = damp(C.pos.y, want.y, car.onGround ? 8 : 3, dt);
    const gh = R.road.height(C.pos.x, C.pos.z) + 0.6;
    if (C.pos.y < gh) C.pos.y = gh;
    camera.position.copy(C.pos);
    C.look.lerp(_v2.set(car.pos.x + _fw.x * 1.8, car.pos.y + (heli ? 0 : 0.85), car.pos.z + _fw.z * 1.8), 1 - Math.exp(-dt * 18));
    camera.lookAt(C.look);
  }
  // Shake from bumps, landings and impacts; road rumble grows with speed.
  const rough = (R.road.stage.surface === 'tarmac' ? 0.15 : 1) * Math.min(1, speed / 30) * 0.012 + C.shake * 0.06;
  if (rough > 0.001) {
    camera.position.x += (Math.random() - 0.5) * rough; camera.position.y += (Math.random() - 0.5) * rough;
    camera.rotation.z += (Math.random() - 0.5) * rough * 0.5;
  }
  C.fov = damp(C.fov, fov, 3, dt);
  camera.fov = C.fov; camera.updateProjectionMatrix();
}

function postFx(speed) {
  const R = G.race;
  gradePass.uniforms.uBlur.value = smoothstep(26, 50, speed) * (R?.cam.mode === 2 ? 0.6 : 1);
  gradePass.uniforms.uTime.value = G.time;
  // Sun shafts: where is the sun on screen?
  if (R && raysPass.enabled && !R.st.night) {
    _v.copy(camera.position).addScaledVector(R.sky.sunDir, 1000).project(camera);
    const onScreen = _v.z < 1 && Math.abs(_v.x) < 1.6 && Math.abs(_v.y) < 1.6;
    raysPass.uniforms.uSun.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    _v2.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const facing = Math.max(0, _v2.dot(R.sky.sunDir));
    raysPass.uniforms.uRays.value = onScreen ? Math.pow(facing, 2) * (R.st.sky.elev < 20 ? 1.0 : 0.6) : 0;
  } else raysPass.uniforms.uRays.value = 0;
}

// ---- Replay with TV cameras -------------------------------------------------------
function startReplay() {
  const R = G.race;
  if (!R || !R.frames.length) return;
  clearUI();
  G.mode = 'race';
  R.replay = { t: 0, cams: buildTvCams(R.road), cam: -1, end: R.frames[R.frames.length - 1][0], speed: 1 };
  R.fx.clear();
  hud.message('REPLAY', 'Enter / Esc to exit', '#29d3ff', 2.5);
}
function buildTvCams(road) {
  const cams = [];
  const r = rng(road.stage.seed + 3);
  for (let s = road.start + 20; s < road.finish + 60; s += 70 + r() * 60) {
    const f = road.frameAt(s);
    const side = r.sign(), d = f.w + 5 + r() * 9;
    const x = f.x + f.rx * side * d, z = f.z + f.rz * side * d;
    cams.push({ s, pos: new THREE.Vector3(x, road.height(x, z) + 1.4 + r() * 3.5, z) });
  }
  return cams;
}
function replayUpdate(dt) {
  const R = G.race, P = R.replay, car = R.car, model = R.model;
  if (input.hit('Enter', 'Escape', 'PadA', 'PadB', 'Space')) { R.replay = null; resultsScreen(); return; }
  P.t += dt * P.speed;
  if (P.t > P.end + 1) P.t = 0;
  const f = sampleFrames(R.frames, P.t);
  car.pos.set(f[1], f[2], f[3]);
  car.quat.set(f[4], f[5], f[6], f[7]).normalize();
  // Rebuild enough wheel state to pose the model and drive the audio.
  _v2.set(0, 1, 0).applyQuaternion(car.quat);
  car.wheels.forEach((w, i) => {
    w.len = f[8 + i]; w.steer = w.front ? -f[12] : 0; w.angle = i < 2 ? f[13] : f[14];
    w.point.copy(w.mount).applyQuaternion(car.quat).add(car.pos).addScaledVector(_v2, -(w.len + car.R));
    w.omega = f[17] / car.R;
  });
  car.rpm = f[15]; car.load = f[16]; car.speed = f[17]; car.throttle = f[16];
  car.vel.set(0, 0, 1).applyQuaternion(car.quat).multiplyScalar(f[17]);
  model.root.position.copy(car.pos); model.root.quaternion.copy(car.quat); model.pose(car);
  const q = R.road.nearest(car.pos.x, car.pos.z, 80, {});
  const s = q.i >= 0 ? q.s : 0;
  // Pick the TV camera just ahead of the car.
  let best = 0;
  for (let i = 0; i < P.cams.length; i++) if (P.cams[i].s < s + 45) best = i;
  if (best !== P.cam) P.cam = best;
  const cam = P.cams[P.cam];
  camera.position.copy(cam.pos);
  camera.lookAt(car.pos.x, car.pos.y + 0.4, car.pos.z);
  const d = cam.pos.distanceTo(car.pos);
  camera.fov = clamp(2 * Math.atan(5.5 / d) * 180 / Math.PI, 8, 65); camera.updateProjectionMatrix();
  for (const w of car.wheels) { w.contact = true; w.surface = R.road.surface(R.road.nearest(w.point.x, w.point.z, 64, {})); w.slip = 0; }
  car.limiter = 0; car.shiftTimer = 0; car.boost = car.load;
  audio.updateCar(car, dt, { stage: R.st, crowd: 0 });
  R.fx.emit(car, dt, model);
  R.fx.update(dt, camera);
  R.world.update(dt, G.time, camera.position, car);
  R.sky.update(G.time, car.pos, camera);
  postFx(0);
}

// ---- Pause & results ----------------------------------------------------------------
function pauseMenu() {
  const R = G.race;
  if (!R) return;
  R.paused = true;
  G.mode = 'menu';
  audio.silenceCar();
  screen((s) => {
    s.style.background = 'rgba(0,0,0,.45)';
    s.appendChild(el('div', 'hdr', `Paused <span class="tag">${R.st.name.toUpperCase()}</span>`));
    const m = el('div', 'menu');
    m.appendChild(addNav(el('button', 'btn', '<span>Resume</span>'), resume));
    m.appendChild(addNav(el('button', 'btn', '<span>Restart stage</span>'), () => startStage(R.opts)));
    m.appendChild(addNav(el('button', 'btn', '<span>Options</span>'), () => optionsMenu(true)));
    m.appendChild(addNav(el('button', 'btn', `<span>${G.rally ? 'Retire from rally' : 'Quit to menu'}</span>`), quitToMenu));
    s.appendChild(m);
    nav.back = resume;
  });
}
function resume() { const R = G.race; if (!R) return; R.paused = false; G.mode = 'race'; clearUI(); }
function quitToMenu() { disposeRace(); G.rally = null; scene = new THREE.Scene(); mainMenu(); }

function resultsScreen() {
  const R = G.race;
  G.mode = 'menu';
  audio.silenceCar();
  const rows = R.rivals.map((r) => ({ name: r.name, car: r.car, time: r.time }));
  rows.push({ name: 'YOU', car: R.spec.name, time: R.final, me: true });
  rows.sort((a, b) => a.time - b.time);
  const lead = rows[0].time;
  let overall = null;
  if (G.rally && !R.rallyCounted) {
    R.rallyCounted = true;
    for (const r of rows) G.rally.totals[r.me ? 'YOU' : r.name] += r.time;
    G.rally.stageResults.push({ stage: R.st.name, time: R.final });
  }
  if (G.rally) {
    overall = Object.entries(G.rally.totals).map(([name, t]) => ({ name, time: t, me: name === 'YOU' })).sort((a, b) => a.time - b.time);
  }
  screen((s) => {
    s.style.background = 'linear-gradient(90deg, rgba(0,0,0,.8), rgba(0,0,0,.35))';
    s.appendChild(el('div', 'hdr', `${R.st.name} <span class="tag">${R.newBest ? 'NEW BEST' : 'STAGE RESULT'}</span>`));
    const tbl = el('table', 'res');
    tbl.innerHTML = rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td class="pos">${i + 1}</td><td>${r.name}<span style="color:#9fb3c8;font-size:.8em;margin-left:10px">${r.car}</span></td><td class="t">${fmtTime(r.time)}</td><td class="d">${i ? '+' + (r.time - lead).toFixed(2) : ''}</td></tr>`).join('');
    s.appendChild(tbl);
    if (R.penalty) s.appendChild(el('div', '', `<div style="margin-top:8px;color:#ff9d2e;font-family:var(--cond);font-weight:700;letter-spacing:.1em">INCLUDES ${R.penalty}s RECOVERY PENALTY</div>`));
    if (overall) {
      s.appendChild(el('div', 'hdr', `<span style="font-size:.6em">Rally standings after stage ${G.rally.idx + 1}/${STAGES.length}</span>`)).style.marginTop = '3vh';
      const t2 = el('table', 'res');
      const l2 = overall[0].time;
      t2.innerHTML = overall.slice(0, 8).map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td class="pos">${i + 1}</td><td>${r.name}</td><td class="t">${fmtTime(r.time)}</td><td class="d">${i ? '+' + (r.time - l2).toFixed(2) : ''}</td></tr>`).join('');
      s.appendChild(t2);
    }
    const m = el('div', 'row');
    if (G.rally) {
      if (G.rally.idx < STAGES.length - 1) m.appendChild(addNav(el('button', 'btn', '<span>Next stage · service</span>'), () => { G.rally.idx++; startStage({ mode: 'rally', stage: G.rally.idx, car: G.rally.car }); }));
      else m.appendChild(addNav(el('button', 'btn', '<span>Final results</span>'), () => rallyFinal(overall)));
    } else {
      m.appendChild(addNav(el('button', 'btn', '<span>Retry</span>'), () => startStage(R.opts)));
    }
    m.appendChild(addNav(el('button', 'btn', '<span>Watch replay</span>'), startReplay));
    m.appendChild(addNav(el('button', 'btn', '<span>Main menu</span>'), quitToMenu));
    s.appendChild(m);
  });
}

function rallyFinal(overall) {
  disposeRace();
  scene = new THREE.Scene();
  G.mode = 'menu';
  audio.startMusic();
  const pos = overall.findIndex((r) => r.me) + 1;
  screen((s) => {
    s.appendChild(el('div', 'vignette'));
    s.appendChild(el('div', 'logo', `<span class="a" style="font-size:clamp(44px,8vw,110px)">${pos === 1 ? 'Champion!' : 'P' + pos}</span><span class="b"><span>Rally Championship · Final</span></span>`));
    const t = el('table', 'res');
    const l = overall[0].time;
    t.innerHTML = overall.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td class="pos">${i + 1}</td><td>${r.name}</td><td class="t">${fmtTime(r.time)}</td><td class="d">${i ? '+' + (r.time - l).toFixed(2) : ''}</td></tr>`).join('');
    s.appendChild(t);
    const m = el('div', 'row');
    m.appendChild(addNav(el('button', 'btn', '<span>Main menu</span>'), () => { G.rally = null; mainMenu(); }));
    s.appendChild(m);
  });
  if (pos === 1) audio.say(['good_stage']);
}

// ---- Touch controls -------------------------------------------------------------------
function setupTouch() {
  if (!('ontouchstart' in window)) return;
  const t = document.getElementById('touch');
  t.innerHTML = '<div class="z" id="t-l" style="left:16px">◀</div><div class="z" id="t-r" style="left:122px">▶</div><div class="z" id="t-hb" style="right:228px">HB</div><div class="z" id="t-br" style="right:122px">BRK</div><div class="z" id="t-th" style="right:16px">GAS</div>';
  const st = input.touch;
  const bind = (id, on, off) => { const e = document.getElementById(id); e.addEventListener('touchstart', (ev) => { ev.preventDefault(); st.active = true; on(); }, { passive: false }); e.addEventListener('touchend', (ev) => { ev.preventDefault(); off(); }, { passive: false }); };
  bind('t-l', () => { st.steer = -1; }, () => { st.steer = 0; });
  bind('t-r', () => { st.steer = 1; }, () => { st.steer = 0; });
  bind('t-th', () => { st.throttle = 1; }, () => { st.throttle = 0; });
  bind('t-br', () => { st.brake = 1; }, () => { st.brake = 0; });
  bind('t-hb', () => { st.handbrake = 1; }, () => { st.handbrake = 0; });
  G.touchEl = t;
}
setupTouch();

// ---- Main loop -------------------------------------------------------------------------
let last = performance.now();
const perf = { t: 0, frames: 0, settle: 4 };
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.time += dt;
  input.poll(dt);
  renderer.info.reset();
  try {
    if (G.mode === 'race' && G.race && !G.race.paused) {
      raceUpdate(dt);
      renderPass.scene = scene; aoPass.scene = scene;
      composer.render(dt);
      const R = G.race;
      if (R) {
        const car = R.car;
        hud.draw(dt, {
          hidden: !!R.replay || R.phase === 'intro', time: R.phase === 'running' ? R.time + R.penalty : R.final ?? 0, splits: R.splits, penalty: R.penalty,
          progress: (car.s - R.road.start) / (R.road.finish - R.road.start), splitMarks: R.road.splits.map((s) => (s - R.road.start) / (R.road.finish - R.road.start)),
          rpm: car.rpm, redline: car.spec.redline, gear: car.gear, speed: car.speed, shifting: car.shiftTimer > 0, turbo: !!car.spec.turbo, boost: car.boost,
          notes: R.co.shown, noteTime: R.co.time, countdown: R.phase === 'countdown' || R.phase === 'running' ? R.countdown : undefined,
          showDamage: Object.values(car.damage).some((v) => v > 0.04), damage: car.damage,
          ghostProgress: R.ghost?.s !== undefined ? (R.ghost.s - R.road.start) / (R.road.finish - R.road.start) : undefined,
        });
      }
      if (G.touchEl) G.touchEl.classList.toggle('on', G.mode === 'race');
    } else if (G.mode === 'race' && G.race?.paused || (G.mode === 'menu' && G.race)) {
      // Paused or results over a live stage: keep the scene visible.
      menuInput();
      if (G.race) { renderPass.scene = scene; aoPass.scene = scene; composer.render(dt); }
      hud.clear();
      if (G.touchEl) G.touchEl.classList.remove('on');
    } else {
      menuInput();
      // Showroom turntable.
      if (showCar) {
        if (window.__showAngle !== undefined) showCar.root.rotation.y = window.__showAngle; else showCar.root.rotation.y += dt * 0.25;
        const a = G.time * 0.1;
        camera.position.set(Math.sin(a) * 1.2 + 5.6, 1.45 + Math.sin(G.time * 0.3) * 0.15, 6.2 + Math.cos(a) * 0.6);
        camera.lookAt(0, 0.1, 0);
        camera.fov = 34;
        // Frame the car on the right so menus have room on the left.
        const wide = W / H > 1.2;
        camera.setViewOffset(W, H, wide ? -W * 0.2 : 0, wide ? 0 : -H * 0.12, W, H);
        camera.updateProjectionMatrix();
      }
      renderPass.scene = showroom; aoPass.scene = showroom;
      gradePass.uniforms.uBlur.value = 0; raysPass.uniforms.uRays.value = 0;
      gradePass.uniforms.uSat.value = 1.05; gradePass.uniforms.uContrast.value = 1.08; gradePass.uniforms.uTint.value.set(1, 1, 1);
      renderer.toneMappingExposure = 1;
      composer.render(dt);
      hud.clear();
      if (G.touchEl) G.touchEl.classList.remove('on');
    }
  } catch (e) {
    console.error(e);
    toast('Error: ' + e.message);
  }
  // Keep the frame rate up by trimming resolution if needed.
  perf.t += dt; perf.frames++;
  if (perf.t > 2) {
    const fps = perf.frames / perf.t;
    perf.t = 0; perf.frames = 0;
    if (perf.settle > 0) perf.settle--;
    else if (G.mode === 'race') {
      if (fps < 45 && dynScale > 0.6) { dynScale = Math.max(0.6, dynScale - 0.1); resize(); }
      else if (fps > 58 && dynScale < 1) { dynScale = Math.min(1, dynScale + 0.05); resize(); }
    }
    document.getElementById('toast').dataset.fps = fps.toFixed(0);
  }
  input.endFrame();
}

// Debug/test hooks: ?stage=N&car=N jumps straight into a stage; ?autopilot lets the AI drive.
window.__game = { G, settings, startStage, audio, renderer };
window.__setShow = (c, a) => { setShowroomCar(c); window.__showAngle = a; };
if (params.has('stage')) {
  const go = async () => { await startAudio().catch(() => {}); startStage({ mode: params.has('trial') ? 'trial' : 'single', stage: clamp(+params.get('stage') || 0, 0, STAGES.length - 1), car: clamp(+params.get('car') || 0, 0, CARS.length - 1) }); };
  go();
} else titleScreen();
requestAnimationFrame(frame);
