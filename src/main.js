// Game shell: renderer, menus, game modes and the main loop.
import * as THREE from '../vendor/three.module.min.js';
import { TEAMS, TRACKS, CLASSES, THEMES, POINTS } from './data.js';
import { Race } from './race.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { createPostPass, psxUniforms } from './psx.js';
import { particleScale } from './particles.js';
import { buildShipModel } from './shipmodels.js';
import { drawRaceHUD, text, panel, fmtTime, drawStatBar, teamColor } from './hud.js';

// ---- Renderer --------------------------------------------------------------
const canvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
const hud = hudCanvas.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 4 / 3, 0.5, 8000);
const rt = new THREE.WebGLRenderTarget(320, 240, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
rt.texture.colorSpace = THREE.SRGBColorSpace;
const post = createPostPass();
post.mat.uniforms.tDiffuse.value = rt.texture;

// Team preview scene for the selection screen.
const previewScene = new THREE.Scene();
const previewCam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
previewCam.position.set(0, 3.2, 9.5);
previewCam.lookAt(0, 0, 0);
const previewModels = TEAMS.map((t) => { const m = buildShipModel(t).mesh; previewScene.add(m); m.visible = false; return m; });

const settings = loadSettings();
const params = new URLSearchParams(location.search);
const AUTOPILOT = params.has('autopilot'); // testing aid: the AI flies the player's craft
let W = 320, H = 240, HUD_SCALE = 2;
function resize() {
  const aspect = Math.max(1, Math.min(2.4, innerWidth / innerHeight));
  H = settings.hires ? 480 : 240;
  W = Math.round(H * aspect);
  renderer.setSize(W, H, false);
  rt.setSize(W, H);
  HUD_SCALE = settings.hires ? 1 : 2;
  hudCanvas.width = W * HUD_SCALE; hudCanvas.height = H * HUD_SCALE;
  camera.aspect = W / H; camera.updateProjectionMatrix();
  particleScale.value = H / 4;
  applySettings();
}
window.addEventListener('resize', resize);

function applySettings() {
  psxUniforms.uSnap.value.set(settings.wobble ? W / 4 : 4096, settings.wobble ? H / 4 : 4096);
  psxUniforms.uAffine.value = settings.affine ? 0.65 : 0;
  post.mat.uniforms.uDither.value = settings.dither ? 1 : 0;
  audio.setVolumes(settings.music, settings.sfx);
}

function loadSettings() {
  const def = { music: 0.6, sfx: 0.8, wobble: true, affine: true, dither: true, hires: false, laps: 3 };
  try { return { ...def, ...JSON.parse(localStorage.getItem('hoverline.settings') || '{}') }; } catch { return def; }
}
function saveSettings() { try { localStorage.setItem('hoverline.settings', JSON.stringify(settings)); } catch { /* storage unavailable */ } }
function loadRecords() { try { return JSON.parse(localStorage.getItem('hoverline.records') || '{}'); } catch { return {}; } }
function saveRecords(r) { try { localStorage.setItem('hoverline.records', JSON.stringify(r)); } catch { /* storage unavailable */ } }

const input = new Input();
const audio = new Audio();
resize();

// ---- Game state --------------------------------------------------------------
const game = {
  state: 'title',
  mode: 'race', // race | time | champ
  classIndex: 0,
  team: 0,
  pilot: 0,
  track: 0,
  race: null,
  menu: null,
  champ: null,
  records: loadRecords(),
  t: 0,
};

function startAttract(trackIndex = Math.floor(Math.random() * TRACKS.length)) {
  if (game.race) game.race.dispose();
  game.race = new Race({ scene, camera, audio, trackDef: TRACKS[trackIndex], classIndex: 1, mode: 'attract' });
  game.attractTrack = trackIndex;
}

function startRace() {
  game.state = 'loading';
  drawLoading();
  setTimeout(() => {
    if (game.race) game.race.dispose();
    const opts = {
      scene, camera, audio, trackDef: TRACKS[game.track], classIndex: game.classIndex,
      mode: game.mode === 'time' ? 'time' : 'race', playerTeam: game.team, playerPilot: game.pilot, laps: Number(params.get('laps')) || settings.laps, autopilot: AUTOPILOT,
    };
    if (game.mode === 'champ' && game.champ.grid) opts.grid = game.champ.grid;
    game.race = new Race(opts);
    game.state = 'race';
    audio.startMusic(TRACKS[game.track].music);
  }, 30);
}

function toMenu(menu) {
  game.state = 'menu';
  game.menu = menu;
  menu.sel = menu.sel || 0;
}

// ---- Menus -----------------------------------------------------------------
function mainMenu() {
  return {
    title: 'MAIN MENU',
    items: [
      { label: 'SINGLE RACE', action: () => { game.mode = 'race'; toMenu(classMenu()); } },
      { label: 'TIME TRIAL', action: () => { game.mode = 'time'; toMenu(classMenu()); } },
      { label: 'CHAMPIONSHIP', action: () => { game.mode = 'champ'; toMenu(classMenu()); } },
      { label: 'OPTIONS', action: () => toMenu(optionsMenu()) },
      { label: 'CONTROLS', action: () => toMenu(controlsMenu()) },
    ],
    back: () => { game.state = 'title'; },
  };
}

function classMenu() {
  return {
    title: 'SELECT CLASS',
    items: CLASSES.map((c, i) => ({ label: c.name, sub: i === 0 ? 'STANDARD SPEED' : 'HIGH SPEED - EXPERTS ONLY', action: () => { game.classIndex = i; toMenu(teamMenu()); } })),
    back: () => toMenu(mainMenu()),
  };
}

function teamMenu() {
  const m = {
    title: 'SELECT TEAM',
    kind: 'team',
    items: TEAMS.map((t, i) => ({ label: t.name, action: () => { game.team = i; toMenu(pilotMenu()); } })),
    back: () => toMenu(classMenu()),
  };
  m.sel = game.team;
  return m;
}

function pilotMenu() {
  const team = TEAMS[game.team];
  return {
    title: 'SELECT PILOT',
    kind: 'team',
    fixedTeam: game.team,
    items: team.pilots.map((p, i) => ({
      label: p, action: () => {
        game.pilot = i;
        if (game.mode === 'champ') startChampionship(); else toMenu(trackMenu());
      },
    })),
    back: () => toMenu(teamMenu()),
  };
}

function trackMenu() {
  const m = {
    title: 'SELECT CIRCUIT',
    kind: 'track',
    items: TRACKS.map((t, i) => ({ label: t.name, action: () => { game.track = i; startRace(); } })),
    back: () => toMenu(teamMenu()),
    onChange: (i) => { if (game.attractTrack !== i) startAttract(i); },
  };
  m.sel = game.track;
  return m;
}

function optionsMenu() {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const onoff = (v) => (v ? 'ON' : 'OFF');
  const adj = (key, d) => { settings[key] = Math.max(0, Math.min(1, Math.round((settings[key] + d) * 10) / 10)); applySettings(); saveSettings(); };
  const tog = (key) => () => { settings[key] = !settings[key]; key === 'hires' ? resize() : applySettings(); saveSettings(); };
  return {
    title: 'OPTIONS',
    items: [
      { label: 'MUSIC VOLUME', value: () => pct(settings.music), left: () => adj('music', -0.1), right: () => adj('music', 0.1) },
      { label: 'EFFECTS VOLUME', value: () => pct(settings.sfx), left: () => adj('sfx', -0.1), right: () => adj('sfx', 0.1) },
      { label: 'RACE LAPS', value: () => `${settings.laps}`, left: () => { settings.laps = Math.max(1, settings.laps - 1); saveSettings(); }, right: () => { settings.laps = Math.min(9, settings.laps + 1); saveSettings(); } },
      { label: 'VERTEX WOBBLE', value: () => onoff(settings.wobble), action: tog('wobble'), left: tog('wobble'), right: tog('wobble') },
      { label: 'TEXTURE WARP', value: () => onoff(settings.affine), action: tog('affine'), left: tog('affine'), right: tog('affine') },
      { label: 'COLOUR DITHER', value: () => onoff(settings.dither), action: tog('dither'), left: tog('dither'), right: tog('dither') },
      { label: 'RESOLUTION', value: () => (settings.hires ? '480P' : '240P'), action: tog('hires'), left: tog('hires'), right: tog('hires') },
      { label: 'BACK', action: () => toMenu(mainMenu()) },
    ],
    back: () => toMenu(mainMenu()),
  };
}

function controlsMenu() {
  return {
    title: 'CONTROLS',
    kind: 'info',
    lines: [
      ['THRUST', 'X / W / UP'],
      ['STEER', 'LEFT RIGHT / A D'],
      ['LEFT AIRBRAKE', 'Z / Q'],
      ['RIGHT AIRBRAKE', 'C / E'],
      ['FIRE WEAPON', 'SPACE / SHIFT'],
      ['NOSE UP (AIR)', 'DOWN / S'],
      ['CHANGE VIEW', 'V'],
      ['PAUSE', 'ESC / P'],
      ['GAMEPAD', 'A THRUST  B FIRE  L/R AIRBRAKES'],
    ],
    items: [{ label: 'BACK', action: () => toMenu(mainMenu()) }],
    back: () => toMenu(mainMenu()),
  };
}

function pauseMenu() {
  return {
    title: 'PAUSED',
    overlay: true,
    items: [
      { label: 'CONTINUE', action: () => { game.state = 'race'; } },
      { label: 'RESTART', action: () => { if (game.mode === 'champ') game.champ.tries = Math.max(0, game.champ.tries); startRace(); } },
      { label: 'QUIT', action: () => quitToMenu() },
    ],
    back: () => { game.state = 'race'; },
  };
}

function quitToMenu() {
  audio.stopMusic();
  startAttract();
  toMenu(mainMenu());
}

// ---- Championship ------------------------------------------------------------
function startChampionship() {
  game.champ = { round: 0, points: {}, tries: 3, grid: null };
  game.track = 0;
  startRace();
}

function finishRace() {
  const race = game.race;
  const res = race.results();
  game.lastResults = res;
  const me = res.find((r) => r.player);
  // records
  const key = `${TRACKS[game.track].id}-${game.classIndex}`;
  const rec = game.records[key] || { race: Infinity, lap: Infinity };
  if (me) {
    let newRec = false;
    if (me.ship.finished && me.time < (rec.race ?? Infinity) && (race.mode === 'race' || race.mode === 'time')) { rec.race = me.time; newRec = true; }
    if (me.best < (rec.lap ?? Infinity)) { rec.lap = me.best; newRec = true; }
    game.records[key] = rec;
    if (newRec) saveRecords(game.records);
    game.newRecord = newRec;
  }
  if (game.mode === 'champ') {
    const c = game.champ;
    const place = res.findIndex((r) => r.player) + 1;
    c.lastPlace = place;
    if (place <= 3) {
      res.forEach((r, i) => { c.points[r.ship.id] = (c.points[r.ship.id] || 0) + POINTS[i]; });
    }
    c.qualified = place <= 3;
  }
  game.state = 'results';
  game.resultsTimer = 0;
}

function afterResults() {
  if (game.mode === 'champ') {
    const c = game.champ;
    if (c.qualified) {
      c.round++;
      if (c.round >= TRACKS.length) { game.state = 'champEnd'; return; }
      game.state = 'standings';
    } else {
      c.tries--;
      game.state = c.tries <= 0 ? 'champOver' : 'retry';
    }
    return;
  }
  toMenu({
    title: game.mode === 'time' ? 'TIME TRIAL' : 'RACE OVER',
    overlay: true,
    items: [
      { label: 'RACE AGAIN', action: () => startRace() },
      { label: 'CHOOSE CIRCUIT', action: () => { audio.stopMusic(); toMenu(trackMenu()); } },
      { label: 'MAIN MENU', action: () => quitToMenu() },
    ],
    back: () => quitToMenu(),
  });
}

function standings() {
  const c = game.champ;
  const rows = [];
  TEAMS.forEach((t, ti) => t.pilots.forEach((p, pi) => rows.push({ id: `${ti}-${pi}`, pilot: p, team: ti, pts: c.points[`${ti}-${pi}`] || 0 })));
  rows.sort((a, b) => b.pts - a.pts);
  return rows;
}

// ---- Update ------------------------------------------------------------------
function menuInput(menu) {
  const n = menu.items.length;
  const prevSel = menu.sel;
  if (input.pressed('up')) { menu.sel = (menu.sel - 1 + n) % n; audio.play('menu'); }
  if (input.pressed('down')) { menu.sel = (menu.sel + 1) % n; audio.play('menu'); }
  const item = menu.items[menu.sel];
  if (input.pressed('left')) {
    if (item.left) { item.left(); audio.play('menu'); }
    else if (menu.kind === 'team' || menu.kind === 'track') { menu.sel = (menu.sel - 1 + n) % n; audio.play('menu'); }
  }
  if (input.pressed('right')) {
    if (item.right) { item.right(); audio.play('menu'); }
    else if (menu.kind === 'team' || menu.kind === 'track') { menu.sel = (menu.sel + 1) % n; audio.play('menu'); }
  }
  if (menu.sel !== prevSel && menu.onChange) menu.onChange(menu.sel);
  if (input.pressed('ok') && item.action) { audio.play('select'); item.action(); return; }
  if (input.pressed('back') && menu.back) { audio.play('back'); menu.back(); }
}

let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.t += dt;
  const inp = input.poll();
  if (Object.values(inp).some((v) => v)) audio.init();

  switch (game.state) {
    case 'title':
      if (input.pressed('ok') || input.pressed('fire')) { audio.init(); audio.play('select'); toMenu(mainMenu()); }
      break;
    case 'menu':
      menuInput(game.menu);
      break;
    case 'race': {
      const r = game.race;
      if (input.pressed('pause')) { toMenu(pauseMenu()); audio.stopEngines(); break; }
      inp.fireOnce = input.pressed('fire');
      inp.viewOnce = input.pressed('view');
      if (r.state === 'done') finishRace();
      break;
    }
    case 'results':
      game.resultsTimer += dt;
      if (game.resultsTimer > 0.6 && (input.pressed('ok') || input.pressed('back'))) { audio.play('select'); afterResults(); }
      break;
    case 'standings':
      if (input.pressed('ok')) {
        audio.play('select');
        game.track = game.champ.round;
        // Grid for the next round: reverse championship order, player last.
        const order = standings().reverse().map((r) => ({ ti: r.team, pi: Number(r.id.split('-')[1]) }));
        const me = order.findIndex((e) => e.ti === game.team && e.pi === game.pilot);
        order.push(order.splice(me, 1)[0]);
        game.champ.grid = order;
        startRace();
      }
      break;
    case 'retry':
      if (input.pressed('ok')) { audio.play('select'); startRace(); }
      if (input.pressed('back')) quitToMenu();
      break;
    case 'champOver':
    case 'champEnd':
      if (input.pressed('ok') || input.pressed('back')) { audio.play('select'); quitToMenu(); }
      break;
  }

  // Simulate.
  const r = game.race;
  const paused = game.state === 'menu' && game.menu.overlay || game.state === 'loading';
  if (r && !paused) {
    const raceInput = game.state === 'race' ? inp : {};
    r.update(dt, raceInput);
  }
  render();
}

// ---- Render ------------------------------------------------------------------
function render() {
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  if (game.state === 'menu' && game.menu.kind === 'team') {
    const ti = game.menu.fixedTeam ?? game.menu.sel;
    previewModels.forEach((m, i) => { m.visible = i === ti; m.rotation.y = game.t * 0.8; m.position.y = Math.sin(game.t * 2) * 0.1; });
    const size = Math.round(H * 0.62);
    const x = Math.round(W * 0.56), y = Math.round(H * 0.18);
    renderer.clearDepth();
    rt.viewport.set(x, y, size * 1.3, size);
    rt.scissor.set(x, y, size * 1.3, size);
    rt.scissorTest = true;
    previewCam.aspect = 1.3; previewCam.updateProjectionMatrix();
    renderer.setRenderTarget(rt);
    renderer.autoClear = false;
    renderer.render(previewScene, previewCam);
    renderer.autoClear = true;
    rt.viewport.set(0, 0, W, H); rt.scissor.set(0, 0, W, H); rt.scissorTest = false;
  }
  const flash = game.race ? game.race.flash : 0;
  post.mat.uniforms.uFlash.value.set(1, 0.3, 0.2, flash * 0.6);
  renderer.setRenderTarget(null);
  renderer.render(post.scene, post.cam);
  drawHUD();
}

function drawLoading() {
  hud.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  hud.fillStyle = '#000'; hud.fillRect(0, 0, hudCanvas.width, hudCanvas.height);
  const S = hudCanvas.height / 240;
  text(hud, 'LOADING', hudCanvas.width / 2, hudCanvas.height / 2, 16 * S, '#fff', 'center');
  text(hud, TRACKS[game.track].name, hudCanvas.width / 2, hudCanvas.height / 2 + 18 * S, 9 * S, '#9ad0ff', 'center');
}

function logo(ctx, cx, cy, S) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.transform(1, 0, -0.25, 1, 0, 0);
  const grad = ctx.createLinearGradient(0, -20 * S, 0, 8 * S);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.5, '#9ad8ff'); grad.addColorStop(1, '#2a60ff');
  ctx.font = `900 ${34 * S}px ${'"Arial Black", Arial, sans-serif'}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText('HOVERLINE', 3 * S, 3 * S);
  ctx.fillStyle = grad; ctx.fillText('HOVERLINE', 0, 0);
  ctx.fillStyle = '#ff2a6a'; ctx.fillRect(-120 * S, 6 * S, 240 * S, 3 * S);
  ctx.restore();
  text(ctx, 'ANTI-GRAVITY RACING  ·  2052', cx, cy + 22 * S, 8 * S, '#ffffff', 'center');
}

function drawHUD() {
  const ctx = hud;
  const HW = hudCanvas.width, HH = hudCanvas.height, S = HH / 240;
  if (game.state === 'loading') return;
  ctx.clearRect(0, 0, HW, HH);
  const blink = Math.floor(game.t * 3) % 2 === 0;

  if (game.state === 'title') {
    ctx.fillStyle = 'rgba(0,0,10,0.35)'; ctx.fillRect(0, 0, HW, HH);
    logo(ctx, HW / 2, HH * 0.42, S);
    if (blink) text(ctx, 'PRESS ENTER', HW / 2, HH * 0.75, 10 * S, '#ffd040', 'center');
    text(ctx, 'AN ORIGINAL TRIBUTE TO 32-BIT ERA ANTI-GRAVITY RACERS', HW / 2, HH - 8 * S, 5 * S, '#9ab', 'center', false);
    return;
  }

  if (game.race && (game.state === 'race' || (game.state === 'menu' && game.menu.overlay))) {
    drawRaceHUD(ctx, game.race, HW, HH, blink);
  }

  if (game.state === 'menu') drawMenu(ctx, game.menu, HW, HH, S);
  else if (game.state === 'results') drawResults(ctx, HW, HH, S);
  else if (game.state === 'standings' || game.state === 'champEnd') drawStandings(ctx, HW, HH, S);
  else if (game.state === 'retry' || game.state === 'champOver') {
    ctx.fillStyle = 'rgba(0,0,10,0.6)'; ctx.fillRect(0, 0, HW, HH);
    const over = game.state === 'champOver';
    text(ctx, over ? 'CHAMPIONSHIP OVER' : 'NOT QUALIFIED', HW / 2, HH * 0.4, 16 * S, '#ff4a4a', 'center');
    text(ctx, over ? 'NO ATTEMPTS REMAINING' : `FINISH IN THE TOP 3 TO ADVANCE - ${game.champ.tries} ATTEMPT${game.champ.tries === 1 ? '' : 'S'} LEFT`, HW / 2, HH * 0.5, 7 * S, '#fff', 'center');
    if (blink) text(ctx, over ? 'PRESS ENTER' : 'ENTER TO RETRY  ·  ESC TO QUIT', HW / 2, HH * 0.65, 8 * S, '#ffd040', 'center');
  }
}

function drawMenu(ctx, m, HW, HH, S) {
  ctx.fillStyle = m.overlay ? 'rgba(0,0,10,0.55)' : 'rgba(0,0,10,0.3)'; ctx.fillRect(0, 0, HW, HH);
  if (!m.overlay) logo(ctx, HW / 2, 36 * S, S * 0.55);
  const left = m.kind === 'team' || m.kind === 'track' ? 16 * S : HW / 2 - 90 * S;
  text(ctx, m.title, left, 70 * S, 12 * S, '#9ad0ff');
  if (game.mode && !m.overlay && m.title !== 'MAIN MENU' && m.title !== 'OPTIONS' && m.title !== 'CONTROLS') {
    const modeName = { race: 'SINGLE RACE', time: 'TIME TRIAL', champ: 'CHAMPIONSHIP' }[game.mode];
    text(ctx, modeName, left, 80 * S, 6 * S, '#ffd040');
  }

  if (m.kind === 'info') {
    let y = 96 * S;
    for (const [a, b] of m.lines) {
      text(ctx, a, left, y, 7 * S, '#fff');
      text(ctx, b, left + 180 * S, y, 7 * S, '#ffd040', 'right');
      y += 11 * S;
    }
  }

  let y = m.kind === 'info' ? 210 * S : 96 * S;
  m.items.forEach((it, i) => {
    const sel = i === m.sel;
    if (sel) panel(ctx, left - 8 * S, y - 10 * S, (m.kind === 'team' || m.kind === 'track' ? 150 : 180) * S, 14 * S, 0.8, '#ffd040');
    text(ctx, it.label, left, y, 9 * S, sel ? '#ffd040' : '#fff');
    if (it.value) text(ctx, `< ${it.value()} >`, left + 165 * S, y, 8 * S, sel ? '#fff' : '#9ad0ff', 'right');
    if (it.sub && sel) text(ctx, it.sub, left, y + 9 * S, 5 * S, '#9ad0ff');
    y += (it.sub ? 20 : 16) * S;
  });

  if (m.kind === 'team') {
    const ti = m.fixedTeam ?? m.sel;
    const t = TEAMS[ti];
    const x = HW * 0.56;
    text(ctx, t.name, x, HH - 56 * S, 10 * S, teamColor(ti));
    const stats = [['SPEED', t.stats.speed], ['THRUST', t.stats.thrust], ['HANDLING', t.stats.handling]];
    let sy = HH - 44 * S;
    for (const [n, v] of stats) {
      text(ctx, n, x, sy + 6 * S, 6 * S, '#fff');
      drawStatBar(ctx, x + 50 * S, sy - 1 * S, 90 * S, 8 * S, v, teamColor(ti));
      sy += 11 * S;
    }
  }
  if (m.kind === 'track') {
    const tr = TRACKS[m.sel];
    const x = HW * 0.55;
    panel(ctx, x - 10 * S, 90 * S, 190 * S, 70 * S, 0.7);
    text(ctx, tr.name, x, 106 * S, 11 * S, THEMES[tr.theme].accent);
    text(ctx, tr.location, x, 118 * S, 6 * S, '#9ad0ff');
    const rec = game.records[`${tr.id}-${game.classIndex}`];
    text(ctx, `RECORD RACE  ${rec ? fmtTime(rec.race) : '-:--.--'}`, x, 134 * S, 6 * S, '#fff');
    text(ctx, `RECORD LAP    ${rec ? fmtTime(rec.lap) : '-:--.--'}`, x, 144 * S, 6 * S, '#fff');
    text(ctx, CLASSES[game.classIndex].name, x, 154 * S, 6 * S, '#ffd040');
  }
  text(ctx, 'ENTER SELECT  ·  ESC BACK', HW / 2, HH - 6 * S, 5 * S, '#9ab', 'center', false);
}

function drawResults(ctx, HW, HH, S) {
  ctx.fillStyle = 'rgba(0,0,10,0.6)'; ctx.fillRect(0, 0, HW, HH);
  const race = game.race;
  text(ctx, game.mode === 'time' ? 'TIME TRIAL RESULTS' : 'RACE RESULTS', HW / 2, 30 * S, 13 * S, '#9ad0ff', 'center');
  text(ctx, `${TRACKS[game.track].name}  ·  ${CLASSES[game.classIndex].name}`, HW / 2, 42 * S, 6 * S, '#ffd040', 'center');
  const x0 = HW / 2 - 150 * S;
  let y = 60 * S;
  text(ctx, 'POS', x0, y, 6 * S, '#9ab'); text(ctx, 'PILOT', x0 + 30 * S, y, 6 * S, '#9ab');
  text(ctx, 'TEAM', x0 + 120 * S, y, 6 * S, '#9ab'); text(ctx, 'TIME', x0 + 250 * S, y, 6 * S, '#9ab', 'right');
  text(ctx, 'BEST LAP', x0 + 300 * S, y, 6 * S, '#9ab', 'right');
  y += 12 * S;
  game.lastResults.forEach((r, i) => {
    const col = r.player ? '#ffd040' : '#fff';
    if (r.player) panel(ctx, x0 - 6 * S, y - 9 * S, 312 * S, 12 * S, 0.6, '#ffd040');
    text(ctx, `${i + 1}`, x0 + 6 * S, y, 8 * S, col);
    text(ctx, r.ship.pilot, x0 + 30 * S, y, 7 * S, col);
    text(ctx, r.ship.team.name, x0 + 120 * S, y, 6 * S, teamColor(TEAMS.indexOf(r.ship.team)));
    text(ctx, (r.ship.finished ? '' : '~') + fmtTime(r.time), x0 + 250 * S, y, 7 * S, col, 'right');
    text(ctx, fmtTime(r.best), x0 + 300 * S, y, 7 * S, col, 'right');
    y += 13 * S;
  });
  if (game.mode === 'time') {
    const me = game.lastResults[0];
    me.ship.lapTimes.forEach((t, i) => { text(ctx, `LAP ${i + 1}  ${fmtTime(t)}`, HW / 2, y + 6 * S + i * 10 * S, 7 * S, t === me.best ? '#60ff90' : '#fff', 'center'); });
  }
  if (game.newRecord) text(ctx, 'NEW RECORD!', HW / 2, HH - 30 * S, 10 * S, '#60ff90', 'center');
  if (Math.floor(game.t * 3) % 2 === 0) text(ctx, 'PRESS ENTER', HW / 2, HH - 12 * S, 8 * S, '#ffd040', 'center');
}

function drawStandings(ctx, HW, HH, S) {
  ctx.fillStyle = 'rgba(0,0,10,0.65)'; ctx.fillRect(0, 0, HW, HH);
  const end = game.state === 'champEnd';
  const rows = standings();
  const myId = `${game.team}-${game.pilot}`;
  text(ctx, end ? 'FINAL STANDINGS' : 'CHAMPIONSHIP STANDINGS', HW / 2, 30 * S, 13 * S, '#9ad0ff', 'center');
  if (!end) text(ctx, `NEXT: ${TRACKS[game.champ.round].name}  (ROUND ${game.champ.round + 1}/${TRACKS.length})`, HW / 2, 42 * S, 6 * S, '#ffd040', 'center');
  else {
    const won = rows[0].id === myId;
    text(ctx, won ? 'YOU ARE THE CHAMPION!' : `YOU FINISHED P${rows.findIndex((r) => r.id === myId) + 1}`, HW / 2, 44 * S, 9 * S, won ? '#60ff90' : '#ffd040', 'center');
  }
  const x0 = HW / 2 - 110 * S;
  let y = 62 * S;
  rows.forEach((r, i) => {
    const me = r.id === myId;
    const col = me ? '#ffd040' : '#fff';
    if (me) panel(ctx, x0 - 6 * S, y - 9 * S, 232 * S, 12 * S, 0.6, '#ffd040');
    text(ctx, `${i + 1}`, x0 + 6 * S, y, 8 * S, col);
    text(ctx, r.pilot, x0 + 30 * S, y, 7 * S, col);
    text(ctx, TEAMS[r.team].name, x0 + 110 * S, y, 6 * S, teamColor(r.team));
    text(ctx, `${r.pts}`, x0 + 220 * S, y, 8 * S, col, 'right');
    y += 13 * S;
  });
  if (Math.floor(game.t * 3) % 2 === 0) text(ctx, 'PRESS ENTER', HW / 2, HH - 12 * S, 8 * S, '#ffd040', 'center');
}

// ---- Boot --------------------------------------------------------------------
startAttract();
requestAnimationFrame(frame);
window.__game = game;
