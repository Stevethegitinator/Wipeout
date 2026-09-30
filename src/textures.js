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
