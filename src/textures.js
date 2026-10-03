// Procedurally painted low-resolution textures (no external image assets).
import * as THREE from '../vendor/three.module.min.js';
import { renderStyle } from './psx.js';

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Modern mode paints the same designs at 8x resolution for crisp detail.
function canvas(w, h) {
  const k = renderStyle.modern ? 8 : 1;
  const c = document.createElement('canvas');
  c.width = w * k; c.height = h * k;
  const ctx = c.getContext('2d');
  ctx.scale(k, k);
  return [c, ctx];
}

function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (renderStyle.modern) {
    t.anisotropy = 8;
  } else {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  }
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function noise(ctx, w, h, amount, rng, alpha = 1) {
  if (renderStyle.modern) amount *= 0.5;
  const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    img.data[i + 3] = img.data[i + 3] * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

export function roadTexture(edge, accent) {
  const [c, x] = canvas(64, 64);
  const rng = makeRng(edge ? 7 : 3);
  x.fillStyle = '#5a5e66'; x.fillRect(0, 0, 64, 64);
  noise(x, 64, 64, 22, rng);
  // panel seams
  x.fillStyle = '#3c3f46';
  x.fillRect(0, 0, 64, 1); x.fillRect(0, 32, 64, 1); x.fillRect(0, 0, 1, 64);
  x.fillStyle = '#70747c';
  x.fillRect(0, 1, 64, 1); x.fillRect(0, 33, 64, 1); x.fillRect(1, 0, 1, 64);
  // rivets
  x.fillStyle = '#2e3036';
  for (const [a, b] of [[4, 4], [60, 4], [4, 28], [60, 28], [4, 36], [60, 36], [4, 60], [60, 60]]) x.fillRect(a, b, 2, 2);
  if (edge) {
    // edge stripe on the outer (u = 0) side
    x.fillStyle = accent; x.fillRect(0, 0, 7, 64);
    x.fillStyle = '#e8e8e8'; x.fillRect(8, 0, 2, 64);
    x.fillStyle = '#1c1c20';
    for (let y = 0; y < 64; y += 16) x.fillRect(0, y, 7, 6);
  } else {
    // dashed lane line on the u = 0 side
    x.fillStyle = '#d8d8d0';
    x.fillRect(0, 6, 2, 20); x.fillRect(0, 38, 2, 20);
  }
  return toTexture(c);
}

export function wallTexture(accent, accent2) {
  const [c, x] = canvas(64, 32);
  const rng = makeRng(11);
  x.fillStyle = '#8a8e96'; x.fillRect(0, 0, 64, 32);
  noise(x, 64, 32, 18, rng);
  x.fillStyle = accent; x.fillRect(0, 8, 64, 10);
  x.fillStyle = accent2;
  for (let i = -16; i < 64; i += 16) {
    x.beginPath(); x.moveTo(i, 18); x.lineTo(i + 8, 8); x.lineTo(i + 12, 8); x.lineTo(i + 4, 18); x.fill();
  }
  x.fillStyle = '#3a3c42'; x.fillRect(0, 0, 64, 3); x.fillRect(0, 26, 64, 6);
  x.fillStyle = '#c8ccd4'; x.fillRect(0, 3, 64, 1);
  x.fillStyle = '#26282c'; x.fillRect(31, 0, 2, 32);
  return toTexture(c);
}

export function roofTexture(night) {
  const [c, x] = canvas(32, 32);
  x.fillStyle = night ? '#1a1c24' : '#34363e'; x.fillRect(0, 0, 32, 32);
  noise(x, 32, 32, 14, makeRng(5));
  x.fillStyle = '#fff8c0'; x.fillRect(12, 0, 8, 6);
  x.fillStyle = '#101014'; x.fillRect(0, 15, 32, 2);
  return toTexture(c);
}

export function underTexture() {
  const [c, x] = canvas(32, 32);
  x.fillStyle = '#2a2c30'; x.fillRect(0, 0, 32, 32);
  x.fillStyle = '#3a3c42';
  for (let i = 0; i < 32; i += 8) x.fillRect(i, 0, 2, 32);
  noise(x, 32, 32, 10, makeRng(9));
  return toTexture(c);
}

export function speedPadTexture() {
  const [c, x] = canvas(32, 64);
  x.fillStyle = '#082838'; x.fillRect(0, 0, 32, 64);
  for (let i = 0; i < 4; i++) {
    const y = 4 + i * 16;
    x.fillStyle = i % 2 ? '#20e0ff' : '#90f8ff';
    x.beginPath();
    x.moveTo(3, y + 12); x.lineTo(16, y); x.lineTo(29, y + 12); x.lineTo(29, y + 16);
    x.lineTo(16, y + 5); x.lineTo(3, y + 16); x.fill();
  }
  x.strokeStyle = '#20e0ff'; x.strokeRect(0.5, 0.5, 31, 63);
  return toTexture(c, false);
}

export function weaponPadTexture() {
  const [c, x] = canvas(32, 64);
  x.fillStyle = '#28082e'; x.fillRect(0, 0, 32, 64);
  const cols = ['#ff3a3a', '#ffb02a', '#fff02a', '#3aff6a', '#2ac8ff', '#b04aff'];
  for (let i = 0; i < 6; i++) { x.fillStyle = cols[i]; x.fillRect(2, 4 + i * 10, 28, 6); }
  x.fillStyle = '#28082e';
  x.beginPath(); x.moveTo(16, 10); x.lineTo(27, 32); x.lineTo(16, 54); x.lineTo(5, 32); x.fill();
  x.fillStyle = '#ffffff';
  x.beginPath(); x.moveTo(16, 18); x.lineTo(22, 32); x.lineTo(16, 46); x.lineTo(10, 32); x.fill();
  return toTexture(c, false);
}

export function groundTexture(kind) {
  const [c, x] = canvas(64, 64);
  const rng = makeRng(kind.length * 31);
  const base = { snowgrass: '#5f7f48', concrete: '#2a2830', sand: '#c89058', ice: '#8ab0c8' }[kind];
  x.fillStyle = base; x.fillRect(0, 0, 64, 64);
  noise(x, 64, 64, kind === 'concrete' ? 16 : 30, rng);
  if (kind === 'snowgrass') {
    for (let i = 0; i < 90; i++) { x.fillStyle = rng() < 0.5 ? '#e8eef2' : '#4a6a3a'; x.fillRect(rng() * 64, rng() * 64, 3, 2); }
  } else if (kind === 'concrete') {
    x.fillStyle = '#18161c'; x.fillRect(0, 0, 64, 2); x.fillRect(0, 0, 2, 64);
    x.fillStyle = '#ff2a8a'; x.fillRect(30, 0, 1, 64);
  } else if (kind === 'sand') {
    x.strokeStyle = '#a87040';
    for (let y = 4; y < 64; y += 9) { x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(20, y - 4, 40, y + 4, 64, y); x.stroke(); }
  } else if (kind === 'ice') {
    x.strokeStyle = '#d8f0ff';
    for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(rng() * 64, rng() * 64); x.lineTo(rng() * 64, rng() * 64); x.stroke(); }
  }
  return toTexture(c);
}

// Fictional sponsor boards.
const BRANDS = [
  ['KORVAX', '#ffdf20', '#101010'], ['SYNTHOLA', '#ffffff', '#d0202a'], ['ZEROPOINT', '#20e0ff', '#081830'],
  ['MAGLEV CO', '#101010', '#f0f0f0'], ['HELIX', '#ff6a00', '#1a1a1a'], ['QUANTA', '#ffffff', '#2a3acf'],
  ['VOLTEX', '#1aff7a', '#0a1a10'], ['ARKON FUEL', '#ffcc00', '#6a1010'],
];
export const BRAND_COUNT = BRANDS.length;

export function adTexture(i) {
  const [name, fg, bg] = BRANDS[i % BRANDS.length];
  const [c, x] = canvas(128, 32);
  x.fillStyle = bg; x.fillRect(0, 0, 128, 32);
  x.fillStyle = fg; x.fillRect(0, 0, 128, 2); x.fillRect(0, 30, 128, 2);
  x.font = 'italic bold 20px Arial Black, Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(name, 64, 17, 120);
  return toTexture(c, false);
}

export function bannerTexture(text, fg, bg) {
  const [c, x] = canvas(128, 32);
  x.fillStyle = bg; x.fillRect(0, 0, 128, 32);
  x.fillStyle = fg;
  for (let i = 0; i < 128; i += 8) { x.fillRect(i, 0, 4, 3); x.fillRect(i + 4, 29, 4, 3); }
  x.font = 'italic bold 18px Arial Black, Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 64, 16, 120);
  return toTexture(c, false);
}

export function windowTexture(night) {
  const [c, x] = canvas(32, 64);
  const rng = makeRng(night ? 77 : 78);
  x.fillStyle = night ? '#101018' : '#6a7080'; x.fillRect(0, 0, 32, 64);
  for (let yy = 2; yy < 64; yy += 6) for (let xx = 2; xx < 32; xx += 6) {
    const lit = rng() < (night ? 0.45 : 0.2);
    x.fillStyle = night ? (lit ? (rng() < 0.3 ? '#ff5ad0' : '#ffe8a0') : '#1c1c2a') : (lit ? '#c8e0f0' : '#3a4050');
    x.fillRect(xx, yy, 4, 4);
  }
  return toTexture(c);
}

export function glowTexture() {
  const [c, x] = canvas(32, 32);
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  return toTexture(c, false);
}

export function chevronTexture(color) {
  const [c, x] = canvas(64, 32);
  x.fillStyle = '#101014'; x.fillRect(0, 0, 64, 32);
  x.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const o = 6 + i * 19;
    x.beginPath(); x.moveTo(o, 4); x.lineTo(o + 10, 16); x.lineTo(o, 28); x.lineTo(o + 6, 28); x.lineTo(o + 16, 16); x.lineTo(o + 6, 4); x.fill();
  }
  x.fillRect(0, 0, 64, 2); x.fillRect(0, 30, 64, 2);
  return toTexture(c, false);
}

export function crowdTexture() {
  const [c, x] = canvas(64, 16);
  const rng = makeRng(42);
  x.fillStyle = '#20222a'; x.fillRect(0, 0, 64, 16);
  const cols = ['#e8c8a0', '#c08060', '#f0f0f0', '#e04040', '#4080e0', '#f0d040', '#40c060', '#202020'];
  for (let i = 0; i < 90; i++) {
    x.fillStyle = cols[Math.floor(rng() * cols.length)];
    const px = rng() * 64, py = 3 + rng() * 10;
    x.fillRect(px, py, 1.6, 2.4);
    x.fillStyle = '#e8c8a0'; x.fillRect(px + 0.2, py - 1.2, 1.2, 1.2);
  }
  x.fillStyle = '#50545e'; x.fillRect(0, 14, 64, 2);
  return toTexture(c);
}

// Tileable soft cloud noise (value noise, several octaves) on transparency.
export function cloudTexture(dark) {
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const rng = makeRng(dark ? 99 : 17);
  const grid = (n) => Array.from({ length: n * n }, () => rng());
  const octs = [[4, 0.5], [8, 0.25], [16, 0.15], [32, 0.1]].map(([n, a]) => ({ n, a, g: grid(n) }));
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = (o, u, v) => {
    const fx = u * o.n, fy = v * o.n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
    const g = (i, j) => o.g[((j % o.n) * o.n) + (i % o.n)];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx, b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
  const img = x.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    let n = 0;
    for (const o of octs) n += sample(o, i / S, j / S) * o.a;
    const cover = Math.max(0, Math.min(1, (n - 0.5) * 3.2));
    const k = (j * S + i) * 4;
    const shade = dark ? 70 + n * 60 : 225 + n * 30;
    img.data[k] = shade; img.data[k + 1] = shade; img.data[k + 2] = shade + (dark ? 20 : 0);
    img.data[k + 3] = cover * 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- Surface detail maps (modern mode) --------------------------------------
// Height fields painted at 512px, turned into tangent-space normal maps, plus
// roughness maps for scuffs and polish. Layouts match the colour textures.
function heightCanvas(draw, size = 512, seed = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, size, size);
  draw(x, size, makeRng(seed));
  return c;
}

function normalFromHeight(hc, strength) {
  const S = hc.width;
  const src = hc.getContext('2d').getImageData(0, 0, S, S).data;
  const out = document.createElement('canvas'); out.width = out.height = S;
  const ox = out.getContext('2d');
  const img = ox.createImageData(S, S);
  const h = (i, j) => src[((((j + S) % S) * S) + ((i + S) % S)) * 4] / 255;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = (h(i + 1, j) - h(i - 1, j)) * strength, dy = (h(i, j + 1) - h(i, j - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const k = (j * S + i) * 4;
    img.data[k] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[k + 1] = (dy / l * 0.5 + 0.5) * 255;
    img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[k + 3] = 255;
  }
  ox.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function grain(x, S, rng, amount, size = 1) {
  for (let k = 0; k < S * S * 0.15 / (size * size); k++) {
    const v = 128 + (rng() - 0.5) * amount;
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.fillRect(rng() * S, rng() * S, size, size);
  }
}

function dataTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const surfaceCache = new Map();
export function surfaceMaps(kind) {
  if (surfaceCache.has(kind)) return surfaceCache.get(kind);
  let maps;
  if (kind === 'road') {
    const hc = heightCanvas((x, S, rng) => {
      grain(x, S, rng, 70, 2);
      grain(x, S, rng, 40, 1);
      // panel seams (grooves) matching the colour texture
      x.fillStyle = 'rgb(20,20,20)';
      x.fillRect(0, 0, S, 10); x.fillRect(0, S / 2, S, 10); x.fillRect(0, 0, 10, S);
      // rivets
      x.fillStyle = 'rgb(230,230,230)';
      for (const [a, b] of [[4, 4], [60, 4], [4, 28], [60, 28], [4, 36], [60, 36], [4, 60], [60, 60]]) {
        x.beginPath(); x.arc((a + 1) * S / 64, (b + 1) * S / 64, S / 64, 0, 7); x.fill();
      }
      // tread plate texture on each panel
      x.fillStyle = 'rgba(200,200,200,0.35)';
      for (let yy = 24; yy < S; yy += 28) for (let xx = 24 + ((yy / 28) % 2) * 14; xx < S; xx += 28) x.fillRect(xx, yy, 12, 4);
    }, 512, 3);
    const rc = heightCanvas((x, S, rng) => {
      x.fillStyle = 'rgb(110,110,110)'; x.fillRect(0, 0, S, S);
      // polished racing line streaks and scuffs
      for (let k = 0; k < 40; k++) {
        const v = 60 + rng() * 120;
        x.fillStyle = `rgba(${v},${v},${v},0.35)`;
        x.fillRect(rng() * S, 0, 4 + rng() * 30, S);
      }
      grain(x, S, rng, 80, 2);
    }, 512, 4);
    maps = { normal: normalFromHeight(hc, 3), rough: dataTexture(rc) };
  } else if (kind === 'wall') {
    const hc = heightCanvas((x, S, rng) => {
      grain(x, S, rng, 40, 2);
      x.fillStyle = 'rgb(40,40,40)';
      x.fillRect(0, S * 3 / 32, S, 6); x.fillRect(0, S * 26 / 32, S, 8); x.fillRect(S * 31 / 64, 0, 10, S);
      x.fillStyle = 'rgb(200,200,200)';
      x.fillRect(0, S * 8 / 32, S, 4); x.fillRect(0, S * 18 / 32, S, 4);
    }, 512, 5);
    maps = { normal: normalFromHeight(hc, 2.5), rough: null };
  } else {
    const hc = heightCanvas((x, S, rng) => {
      for (let k = 0; k < 900; k++) {
        const v = 80 + rng() * 120, r = 2 + rng() * 14;
        x.fillStyle = `rgba(${v},${v},${v},0.5)`;
        x.beginPath(); x.arc(rng() * S, rng() * S, r, 0, 7); x.fill();
      }
      grain(x, S, rng, 90, 2);
    }, 256, 6);
    maps = { normal: normalFromHeight(hc, 4), rough: null };
  }
  surfaceCache.set(kind, maps);
  return maps;
}
