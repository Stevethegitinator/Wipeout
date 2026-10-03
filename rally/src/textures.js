// Procedural textures: road surfaces, ground, rock, bark, foliage cards,
// grass, signs and banners. Everything is drawn on canvases at load time.
import * as THREE from '../../vendor/three.module.min.js';
import { rng, makeNoise2, fbm } from './util.js';

const cache = new Map();
let maxAniso = 8;
export function setAnisotropy(a) { maxAniso = a; }

function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function hex(c) { return '#' + new THREE.Color(c).getHexString(); }
function shade(c, f, hue = 0) {
  const col = new THREE.Color(c);
  const hsl = {}; col.getHSL(hsl);
  col.setHSL((hsl.h + hue + 1) % 1, hsl.s, Math.min(1, hsl.l * f));
  return col;
}
function rgba(col, a = 1) { return `rgba(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0},${a})`; }

function toTexture(c, { repeat = true, srgb = true, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso ? maxAniso : 1;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Height canvas → tangent-space normal map.
function normalFromHeight(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    d[i] = (dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

// Tileable noise field on a canvas (grey), used for heights and variation.
function noiseCanvas(size, seed, scale, oct = 4, contrast = 1) {
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const n = makeNoise2(seed);
  const per = scale; // integer periods across the tile for seamless wrap
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Seamless: blend four offset samples.
    const u = x / size, v = y / size;
    const s = (a, b) => fbm(n, a * per, b * per, oct);
    const val = s(u, v) * (1 - u) * (1 - v) + s(u + 1, v) * u * (1 - v) + s(u, v + 1) * (1 - u) * v + s(u + 1, v + 1) * u * v;
    const g = Math.max(0, Math.min(255, (val * contrast * 0.5 + 0.5) * 255));
    const i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Scatter stones (albedo + height) with wrap-around.
function stones(ctx, hctx, size, r, count, rmin, rmax, colors, hBase = 200) {
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, rad = rmin + Math.pow(r(), 2.2) * (rmax - rmin);
    const col = colors[Math.floor(r() * colors.length)];
    const f = 0.75 + r() * 0.5;
    const rot = r() * Math.PI, ax = 0.7 + r() * 0.5;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const px = x + ox, py = y + oy;
      if (px < -rmax || py < -rmax || px > size + rmax || py > size + rmax) continue;
      ctx.fillStyle = rgba(shade(col, f));
      ctx.beginPath(); ctx.ellipse(px, py, rad, rad * ax, rot, 0, Math.PI * 2); ctx.fill();
      // highlight
      ctx.fillStyle = rgba(shade(col, f * 1.25), 0.5);
      ctx.beginPath(); ctx.ellipse(px - rad * 0.25, py - rad * 0.25, rad * 0.5, rad * 0.5 * ax, rot, 0, Math.PI * 2); ctx.fill();
      if (hctx) {
        const g = hctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, `rgb(${hBase},${hBase},${hBase})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        hctx.fillStyle = g;
        hctx.beginPath(); hctx.ellipse(px, py, rad, rad * ax, rot, 0, Math.PI * 2); hctx.fill();
      }
    }
  }
}

// ---- Road ----------------------------------------------------------------
// Laid out across U (edge → edge) and along V; worn wheel lines where cars
// have swept the surface, loose material in the middle and at the edges.
export const ROAD_TEX_METRES = 14; // metres of road per texture repeat (V)
export function roadTextures(stage) {
  const key = 'road-' + stage.id;
  if (cache.has(key)) return cache.get(key);
  const W = 1024, H = 1536;
  const r = rng(stage.seed + 5);
  const surf = stage.surface;
  const base = new THREE.Color(stage.palette.road);
  const lines = [0.3, 0.42, 0.58, 0.7];
  const lineW = 0.045;
  const lineMask = (u) => { let m = 0; for (const l of lines) m = Math.max(m, 1 - Math.min(1, Math.abs(u - l) / lineW)); return m * m * (3 - 2 * m); };
  // Per-pixel base: multi-scale noise, fine grain, wheel lines.
  const n1 = makeNoise2(stage.seed + 11), n2 = makeNoise2(stage.seed + 12);
  const img = new ImageData(W, H), d = img.data;
  const hgt = new Float32Array(W * H);
  const rough = new Uint8ClampedArray(W * H);
  // Low-resolution noise fields (tileable along V), sampled bilinearly per pixel.
  const LW = 128, LH = 192;
  const field = (f, off) => {
    const a = new Float32Array(LW * LH);
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      const v = y / LH;
      const p = fbm(n1, x / LW * f * 0.6 + off, v * f, 3), q = fbm(n1, x / LW * f * 0.6 + off, (v - 1) * f, 3);
      a[y * LW + x] = p * (1 - v) + q * v;
    }
    return a;
  };
  const F1 = field(5, 0), F2 = field(22, 9.3);
  const sample = (F, x, y) => {
    const fx = x / W * LW, fy = y / H * LH, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const x1 = Math.min(LW - 1, x0 + 1), y1 = (y0 + 1) % LH;
    return (F[y0 * LW + x0] * (1 - tx) + F[y0 * LW + x1] * tx) * (1 - ty) + (F[y1 * LW + x0] * (1 - tx) + F[y1 * LW + x1] * tx) * ty;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, i = y * W + x;
      const lm = lineMask(u);
      const big = sample(F1, x, y), mid = sample(F2, x, y);
      const grain = r() - 0.5;
      let lum = 1 + big * 0.18 + mid * 0.1 + grain * (surf === 'tarmac' ? 0.22 : surf === 'snow' ? 0.06 : 0.28) * (1 - lm * 0.6);
      let cr = base.r, cg = base.g, cb = base.b;
      if (surf === 'gravel' || surf === 'dirt') { lum *= 1 - lm * 0.22; const wet = lm * 0.1; cr -= wet * 0.4; cg -= wet * 0.35; cb -= wet * 0.25; }
      if (surf === 'snow') { lum *= 1 - lm * 0.09; cb += lm * 0.03; }
      if (surf === 'tarmac') lum *= 1 - lm * 0.12;
      d[i * 4] = Math.min(255, cr * lum * 255); d[i * 4 + 1] = Math.min(255, cg * lum * 255); d[i * 4 + 2] = Math.min(255, cb * lum * 255); d[i * 4 + 3] = 255;
      hgt[i] = 0.5 + big * 0.1 + grain * (surf === 'tarmac' ? 0.15 : 0.25) * (1 - lm * 0.7);
      rough[i] = surf === 'tarmac' ? (stage.wet ? 70 : 185) - lm * 40 + grain * 30 : surf === 'snow' ? 150 - lm * 90 : (stage.wet ? 120 : 235) - lm * (stage.wet ? 70 : 20);
    }
  }
  const c = canvas(W, H), ctx = c.getContext('2d');
  ctx.putImageData(img, 0, 0);
  const hc = canvas(W, H), hctx = hc.getContext('2d');
  const himg = new ImageData(W, H);
  for (let i = 0; i < W * H; i++) { const v = Math.max(0, Math.min(255, hgt[i] * 255)); himg.data[i * 4] = himg.data[i * 4 + 1] = himg.data[i * 4 + 2] = v; himg.data[i * 4 + 3] = 255; }
  hctx.putImageData(himg, 0, 0);
  const rc = canvas(W, H), rctx = rc.getContext('2d');
  const rimg = new ImageData(W, H);
  for (let i = 0; i < W * H; i++) { rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = rough[i]; rimg.data[i * 4 + 3] = 255; }
  rctx.putImageData(rimg, 0, 0);
  if (surf === 'gravel' || surf === 'dirt') {
    // Thousands of small stones: dense in the loose middle and edges, sparse in the wheel lines.
    const cols = [shade(base, 1.18), shade(base, 0.85), shade(base, 1.32, 0.015), shade(base, 0.68), new THREE.Color(0x8a867e), new THREE.Color(0x6e6a64)];
    const N = 90000;
    for (let k = 0; k < N; k++) {
      const u = r();
      if (r() < lineMask(u) * 0.85) continue;
      const x = u * W, y = r() * H;
      const rad = 0.7 + Math.pow(r(), 4) * 3.2;
      const col = cols[Math.floor(r() * cols.length)];
      const f = 0.85 + r() * 0.3;
      const offs = y < 8 ? [0, H] : y > H - 8 ? [0, -H] : [0];
      for (const oy of offs) {
        ctx.fillStyle = rgba(shade(col, f * 0.7), 0.9); // shadow side
        ctx.beginPath(); ctx.arc(x + rad * 0.25, y + oy + rad * 0.25, rad, 0, 6.3); ctx.fill();
        ctx.fillStyle = rgba(shade(col, f)); ctx.beginPath(); ctx.arc(x, y + oy, rad * 0.85, 0, 6.3); ctx.fill();
        ctx.fillStyle = rgba(shade(col, f * 1.3), 0.6); ctx.beginPath(); ctx.arc(x - rad * 0.3, y + oy - rad * 0.3, rad * 0.35, 0, 6.3); ctx.fill();
        const hv = 170 + r() * 80;
        hctx.fillStyle = `rgb(${hv},${hv},${hv})`; hctx.beginPath(); hctx.arc(x, y + oy, rad * 0.85, 0, 6.3); hctx.fill();
      }
    }
    if (stage.wet) {
      for (let i = 0; i < 30; i++) {
        const x = (0.2 + r() * 0.6) * W, y = r() * H, rw = 30 + r() * 90, rh = 50 + r() * 160;
        ctx.fillStyle = 'rgba(38,30,22,0.32)'; ctx.beginPath(); ctx.ellipse(x, y, rw, rh, 0, 0, 6.3); ctx.fill();
        rctx.fillStyle = 'rgba(8,8,8,0.9)'; rctx.beginPath(); rctx.ellipse(x, y, rw * 0.75, rh * 0.75, 0, 0, 6.3); rctx.fill();
        hctx.fillStyle = 'rgba(110,110,110,0.95)'; hctx.beginPath(); hctx.ellipse(x, y, rw * 0.75, rh * 0.75, 0, 0, 6.3); hctx.fill();
      }
    }
  } else if (surf === 'tarmac') {
    for (let i = 0; i < 10; i++) {
      const x = (0.1 + r() * 0.65) * W, y = r() * H, w = 90 + r() * 260, h = 120 + r() * 400;
      ctx.fillStyle = rgba(shade(base, r() < 0.5 ? 0.82 : 1.15), 0.5); ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(10,10,10,0.45)'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
    }
    // Cracks.
    ctx.strokeStyle = 'rgba(15,15,15,0.5)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 40; i++) { let x = r() * W, y = r() * H; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 40; y += r() * 30; ctx.lineTo(x, y); } ctx.stroke(); }
    ctx.fillStyle = 'rgba(232,232,222,0.95)';
    ctx.fillRect(W * 0.09, 0, 14, H); ctx.fillRect(W * 0.91 - 14, 0, 14, H);
    for (let y = 0; y < H; y += 384) ctx.fillRect(W / 2 - 6, y, 12, 180);
    rctx.fillStyle = 'rgba(110,110,110,1)';
    rctx.fillRect(W * 0.09, 0, 14, H); rctx.fillRect(W * 0.91 - 14, 0, 14, H);
    // Gravel dragged onto the edges by cars cutting corners, and rubber in the lines.
    for (let i = 0; i < 6000; i++) {
      const side = r() < 0.5 ? r() * r() * 0.16 : 1 - r() * r() * 0.16;
      ctx.fillStyle = rgba(new THREE.Color(stage.palette.dirt).multiplyScalar(0.8 + r() * 0.5), 0.85);
      ctx.beginPath(); ctx.arc(side * W, r() * H, 0.7 + r() * 2.2, 0, 6.3); ctx.fill();
    }
    for (const l of lines) for (let k = 0; k < 6; k++) { ctx.fillStyle = 'rgba(10,10,10,0.08)'; ctx.fillRect((l - 0.02 + r() * 0.04) * W - 8, 0, 16, H); }
  } else if (surf === 'snow') {
    for (let i = 0; i < 26000; i++) {
      const u = r();
      if (r() < lineMask(u) * 0.9) continue;
      ctx.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.6})`;
      ctx.beginPath(); ctx.arc(u * W, r() * H, 0.6 + r() * 2.4, 0, 6.3); ctx.fill();
    }
    for (let i = 0; i < 140; i++) {
      const lx = lines[i % 4] * W + (r() - 0.5) * 40, y = r() * H;
      ctx.strokeStyle = 'rgba(80,90,110,0.22)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx + (r() - 0.5) * 6, y + 60 + r() * 140); ctx.stroke();
    }
  }
  // Edges: blend into the verge colour and fade out in alpha for a soft join.
  const verge = new THREE.Color(surf === 'snow' ? 0xf4f7fb : stage.palette.dirt);
  const eg = ctx.createLinearGradient(0, 0, W, 0);
  eg.addColorStop(0, rgba(verge, 1)); eg.addColorStop(0.06, rgba(verge, 0.45)); eg.addColorStop(0.11, rgba(verge, 0));
  eg.addColorStop(0.89, rgba(verge, 0)); eg.addColorStop(0.94, rgba(verge, 0.45)); eg.addColorStop(1, rgba(verge, 1));
  ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
  const out = ctx.getImageData(0, 0, W, H), od = out.data;
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1), e = Math.min(u, 1 - u);
    const a = Math.min(1, e / 0.05);
    for (let y = 0; y < H; y++) od[(y * W + x) * 4 + 3] = Math.max(0, Math.min(255, (a + (r() - 0.5) * 0.5 * (1 - a)) * 255));
  }
  const res = {
    map: dataTexture(od, W, H),
    normal: toTexture(normalFromHeight(hc, surf === 'tarmac' ? 1.5 : surf === 'snow' ? 1.2 : 3.6), { srgb: false }),
    rough: toTexture(rc, { srgb: false }),
  };
  cache.set(key, res);
  return res;
}

// RGBA bytes → mipmapped texture, keeping colour under transparent pixels
// (canvas textures lose it, which darkens alpha-tested edges).
export function dataTexture(rgba, W, H, { srgb = true, repeat = true } = {}) {
  const flipped = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) flipped.set(rgba.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  const t = new THREE.DataTexture(flipped, W, H, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

// Fill the colour of transparent pixels with the average opaque colour.
function bleed(c) {
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
  if (!n) n = 1;
  R /= n; G /= n; B /= n;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a < 1) { d[i] = d[i] * a + R * (1 - a); d[i + 1] = d[i + 1] * a + G * (1 - a); d[i + 2] = d[i + 2] * a + B * (1 - a); }
  }
  return dataTexture(d, c.width, c.height, { repeat: false });
}

// ---- Ground ----------------------------------------------------------------
export function groundTextures(stage) {
  const key = 'ground-' + stage.id;
  if (cache.has(key)) return cache.get(key);
  const S = 512;
  const r = rng(stage.seed + 77);
  const make = (kind) => {
    const c = canvas(S), ctx = c.getContext('2d');
    const hc = canvas(S), hctx = hc.getContext('2d');
    const nz = noiseCanvas(256, stage.seed + kind.length * 31, 4, 5, 1.6);
    let base;
    if (kind === 'grass') base = new THREE.Color(stage.palette.grass);
    else if (kind === 'dirt') base = new THREE.Color(stage.palette.dirt);
    else base = new THREE.Color(stage.palette.rock);
    ctx.fillStyle = rgba(base); ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.7; ctx.drawImage(nz, 0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    hctx.drawImage(nz, 0, 0, S, S);
    if (kind === 'grass') {
      if (stage.surface === 'snow') {
        // Wind-sculpted snow with sparkle.
        for (let i = 0; i < 9000; i++) { ctx.fillStyle = `rgba(255,255,255,${r() * 0.6})`; ctx.fillRect(r() * S, r() * S, 1 + r() * 2, 1); }
        for (let i = 0; i < 60; i++) {
          const y = r() * S;
          ctx.strokeStyle = 'rgba(180,195,220,0.2)'; ctx.lineWidth = 3 + r() * 6;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(S * 0.3, y + 20, S * 0.6, y - 20, S, y); ctx.stroke();
        }
      } else {
        // Dense blades of different hues, plus dead grass and leaves.
        for (let i = 0; i < 22000; i++) {
          const x = r() * S, y = r() * S, len = 3 + r() * 9, a = -Math.PI / 2 + (r() - 0.5) * 1.2;
          const col = shade(base, 0.6 + r() * 0.9, (r() - 0.5) * 0.06);
          if (r() < 0.12) col.lerp(new THREE.Color(0xb0a070), 0.6);
          ctx.strokeStyle = rgba(col, 0.8); ctx.lineWidth = 1 + r();
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
          hctx.strokeStyle = `rgba(255,255,255,0.15)`; hctx.beginPath(); hctx.moveTo(x, y); hctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); hctx.stroke();
        }
      }
    } else if (kind === 'dirt') {
      const cols = [shade(base, 1.2), shade(base, 0.8), shade(base, 0.6), new THREE.Color(stage.palette.rock)];
      stones(ctx, hctx, S, r, 2200, 0.8, 4.5, cols, 210);
      if (stage.surface !== 'snow') for (let i = 0; i < 300; i++) {
        ctx.fillStyle = rgba(shade(new THREE.Color(stage.palette.grass), 0.6 + r() * 0.5), 0.6);
        ctx.fillRect(r() * S, r() * S, 1 + r() * 3, 2 + r() * 5);
      }
    } else {
      // Rock: layered strata and cracks.
      for (let i = 0; i < 70; i++) {
        const y = r() * S;
        ctx.strokeStyle = rgba(shade(base, 0.55 + r() * 0.3), 0.6); ctx.lineWidth = 1 + r() * 3;
        ctx.beginPath(); ctx.moveTo(0, y);
        for (let x = 0; x <= S; x += 32) ctx.lineTo(x, y + (r() - 0.5) * 18);
        ctx.stroke();
        hctx.strokeStyle = 'rgba(0,0,0,0.5)'; hctx.lineWidth = 2; hctx.beginPath(); hctx.moveTo(0, y); hctx.lineTo(S, y + (r() - 0.5) * 10); hctx.stroke();
      }
      stones(ctx, hctx, S, r, 300, 2, 10, [shade(base, 1.2), shade(base, 0.85)], 160);
      if (stage.surface !== 'snow') for (let i = 0; i < 400; i++) { ctx.fillStyle = 'rgba(120,140,80,0.35)'; ctx.beginPath(); ctx.arc(r() * S, r() * S, 2 + r() * 6, 0, 6.3); ctx.fill(); } // lichen
    }
    return { map: toTexture(c), normal: toTexture(normalFromHeight(hc, kind === 'rock' ? 4 : 2.2), { srgb: false }) };
  };
  const res = { grass: make('grass'), dirt: make('dirt'), rock: make('rock'), macro: toTexture(noiseCanvas(256, stage.seed + 3, 3, 5, 1.8), { srgb: false }) };
  cache.set(key, res);
  return res;
}

// ---- Vegetation ---------------------------------------------------------
export function barkTexture(kind) {
  const key = 'bark-' + kind;
  if (cache.has(key)) return cache.get(key);
  const W = 128, H = 512, r = rng(kind.length * 97);
  const c = canvas(W, H), ctx = c.getContext('2d');
  const hc = canvas(W, H), hctx = hc.getContext('2d');
  if (kind === 'birch') {
    ctx.fillStyle = '#e6e2d8'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(30,28,26,${0.4 + r() * 0.5})`;
      const y = r() * H, w = 8 + r() * 40;
      ctx.fillRect(r() * W, y, w, 1 + r() * 4);
    }
    hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, W, H);
  } else {
    const base = kind === 'gum' ? new THREE.Color(0xb8a890) : new THREE.Color(0x5a4636);
    ctx.fillStyle = rgba(base); ctx.fillRect(0, 0, W, H);
    hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 160; i++) {
      const x = r() * W, w = 2 + r() * 6;
      ctx.fillStyle = rgba(shade(base, 0.45 + r() * 0.4), 0.8);
      hctx.fillStyle = 'rgba(0,0,0,0.6)';
      let y = 0;
      while (y < H) { const h = 10 + r() * 60; ctx.fillRect(x + (r() - 0.5) * 3, y, w, h); hctx.fillRect(x, y, w * 0.8, h); y += h + r() * 30; }
    }
    if (kind === 'gum') for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(${200 + r() * 40},${190 + r() * 40},${170},0.6)`; ctx.fillRect(r() * W, r() * H, 10 + r() * 30, 20 + r() * 60); }
  }
  const res = { map: toTexture(c), normal: toTexture(normalFromHeight(hc, 3), { srgb: false }) };
  cache.set(key, res);
  return res;
}

// Foliage card: a clump of needles or leaves with alpha.
export function foliageTexture(kind) {
  const key = 'fol-' + kind;
  if (cache.has(key)) return cache.get(key);
  const S = 256, r = rng(kind.length * 131 + 7);
  const c = canvas(S), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  if (kind === 'needles' || kind === 'snowneedles') {
    // Rows of drooping needle sprays, dense in the middle, ragged at the bottom edge.
    for (let i = 0; i < 1800; i++) {
      const x = r() * S, y = Math.pow(r(), 0.7) * S * 0.98;
      const len = 6 + r() * 16, a = Math.PI / 2 + (r() - 0.5) * 1.6;
      const g = 70 + r() * 70;
      ctx.strokeStyle = `rgba(${g * 0.55},${g},${g * 0.55},${0.85})`;
      ctx.lineWidth = 1.2 + r() * 1.3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
    }
    if (kind === 'snowneedles') for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(250,252,255,${0.7 + r() * 0.3})`; ctx.beginPath(); ctx.ellipse(r() * S, r() * S * 0.9, 3 + r() * 9, 2 + r() * 4, 0, 0, 6.3); ctx.fill(); }
  } else {
    // Leaves: small ovals in clusters around twigs.
    const pal = kind === 'gum' ? [[122, 128, 72], [148, 142, 84], [102, 112, 62]] : kind === 'shrub' ? [[85, 105, 50], [110, 125, 60], [70, 90, 45]] : [[95, 140, 55], [120, 160, 60], [80, 120, 50], [150, 170, 70]];
    ctx.strokeStyle = 'rgba(70,55,40,0.9)'; ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.moveTo(S / 2, S); ctx.quadraticCurveTo(r() * S, S * 0.6, r() * S, r() * S * 0.7); ctx.stroke(); }
    const n = kind === 'gum' ? 900 : 1500;
    for (let i = 0; i < n; i++) {
      const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * S * 0.46;
      const x = S / 2 + Math.cos(ang) * rad, y = S / 2 + Math.sin(ang) * rad * 0.9;
      const p = pal[Math.floor(r() * pal.length)], f = 0.7 + r() * 0.6;
      ctx.fillStyle = `rgba(${p[0] * f},${p[1] * f},${p[2] * f},0.95)`;
      const lw = kind === 'gum' ? 2 : 3.5, lh = kind === 'gum' ? 9 : 6;
      ctx.beginPath(); ctx.ellipse(x, y, lw + r() * 2, lh + r() * 3, r() * 6.3, 0, 6.3); ctx.fill();
    }
  }
  const t = bleed(c);
  cache.set(key, t);
  return t;
}

// Impostor of a whole tree for the distant forest.
export function impostorTexture(kind, needle) {
  const key = 'imp-' + kind + needle;
  if (cache.has(key)) return cache.get(key);
  const W = 128, H = 256, r = rng(kind.length * 7 + 1);
  const c = canvas(W, H), ctx = c.getContext('2d');
  const leaf = new THREE.Color(needle);
  if (kind === 'pine' || kind === 'snowpine') {
    ctx.fillStyle = '#3a2c20'; ctx.fillRect(W / 2 - 3, H * 0.7, 6, H * 0.3);
    for (let i = 0; i < 9; i++) {
      const t = i / 9, y = H * (0.08 + t * 0.72), w = W * (0.1 + t * 0.42);
      const g = ctx.createLinearGradient(0, y - 20, 0, y + 30);
      g.addColorStop(0, rgba(shade(leaf, 1.25 - t * 0.3))); g.addColorStop(1, rgba(shade(leaf, 0.55)));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(W / 2, y - 26); ctx.lineTo(W / 2 + w, y + 22); ctx.lineTo(W / 2 - w, y + 22); ctx.closePath(); ctx.fill();
      for (let k = 0; k < 30; k++) { ctx.strokeStyle = rgba(shade(leaf, 0.5 + r() * 0.7), 0.9); ctx.lineWidth = 1.5; const x = W / 2 + (r() - 0.5) * 2 * w, yy = y + 18 + r() * 6; ctx.beginPath(); ctx.moveTo(x, yy - 8); ctx.lineTo(x + (r() - 0.5) * 4, yy + 4); ctx.stroke(); }
      if (kind === 'snowpine') { ctx.fillStyle = 'rgba(245,248,255,0.9)'; ctx.beginPath(); ctx.moveTo(W / 2, y - 24); ctx.lineTo(W / 2 + w * 0.7, y + 6); ctx.lineTo(W / 2 - w * 0.7, y + 6); ctx.closePath(); ctx.fill(); }
    }
  } else {
    const trunk = kind === 'birch' ? '#e0dcd2' : kind === 'gum' ? '#c8bca8' : '#4a3a2a';
    ctx.fillStyle = trunk; ctx.fillRect(W / 2 - 3, H * 0.45, 6, H * 0.55);
    const cy = kind === 'shrub' ? H * 0.75 : kind === 'umbrella' ? H * 0.3 : H * 0.38;
    const rx = kind === 'umbrella' ? W * 0.48 : W * 0.4, ry = kind === 'umbrella' ? H * 0.12 : kind === 'shrub' ? H * 0.2 : H * 0.3;
    for (let k = 0; k < 600; k++) {
      const a = r() * 6.28, rr = Math.sqrt(r());
      const x = W / 2 + Math.cos(a) * rx * rr, y = cy + Math.sin(a) * ry * rr;
      const lit = 0.6 + 0.6 * (1 - (y - cy + ry) / (2 * ry));
      ctx.fillStyle = rgba(shade(leaf, lit * (0.8 + r() * 0.4)), 0.95);
      ctx.beginPath(); ctx.arc(x, y, 2 + r() * 3, 0, 6.3); ctx.fill();
    }
  }
  const t = bleed(c);
  cache.set(key, t);
  return t;
}

export function grassCardTexture(stage) {
  const key = 'grasscard-' + stage.id;
  if (cache.has(key)) return cache.get(key);
  const W = 256, H = 128, r = rng(stage.seed + 9);
  const c = canvas(W, H), ctx = c.getContext('2d');
  const base = new THREE.Color(stage.palette.grass);
  for (let i = 0; i < 260; i++) {
    const x = r() * W, h = H * (0.35 + r() * 0.62), bend = (r() - 0.5) * 30;
    const col = shade(base, 0.7 + r() * 0.8, (r() - 0.5) * 0.05);
    if (r() < 0.2) col.lerp(new THREE.Color(0xc8b880), 0.5);
    const g = ctx.createLinearGradient(0, H, 0, H - h);
    g.addColorStop(0, rgba(shade(col, 0.45))); g.addColorStop(1, rgba(shade(col, 1.15)));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x - 2, H); ctx.quadraticCurveTo(x + bend * 0.5, H - h * 0.6, x + bend, H - h); ctx.quadraticCurveTo(x + bend * 0.5 + 1, H - h * 0.6, x + 2, H); ctx.fill();
  }
  // Wild flowers.
  if (stage.id !== 'corse') for (let i = 0; i < 12; i++) { ctx.fillStyle = r() < 0.5 ? '#f2e45a' : '#e8e8f0'; ctx.beginPath(); ctx.arc(r() * W, H * (0.1 + r() * 0.4), 2 + r() * 2, 0, 6.3); ctx.fill(); }
  const t = bleed(c);
  cache.set(key, t);
  return t;
}

// ---- Signs, banners and decals -------------------------------------------
export function bannerTexture(text, sub, bg = '#d01818', fg = '#ffffff', w = 1024, h = 192) {
  const key = `ban-${text}-${sub}-${bg}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  if (text === 'FINISH' || text === 'FLYING FINISH') {
    const sq = h / 4;
    for (let y = 0; y < 4; y++) for (let x = 0; x < w / sq; x++) { ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; ctx.fillRect(x * sq, y * sq, sq, sq); }
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(w * 0.18, h * 0.12, w * 0.64, h * 0.76);
  }
  ctx.fillStyle = fg;
  ctx.font = `italic 900 ${h * 0.52}px "Barlow Condensed", "Arial Narrow", Impact, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h * (sub ? 0.42 : 0.52));
  if (sub) { ctx.font = `700 ${h * 0.18}px "Barlow Condensed", Arial, sans-serif`; ctx.fillText(sub, w / 2, h * 0.82); }
  const t = toTexture(c, { repeat: false });
  cache.set(key, t);
  return t;
}

export function sponsorBoards() {
  if (cache.has('sponsors')) return cache.get('sponsors');
  const names = [['NOVA', '#0d2f8f', '#f4c430'], ['TAKARA', '#ffffff', '#c8102e'], ['BARRA OIL', '#111111', '#ffd400'], ['VOLTA', '#e3262c', '#ffffff'], ['GRIPTEK TYRES', '#ffd400', '#111111'], ['ARCTIC FUEL', '#1b4fb5', '#ffffff'], ['KESTREL', '#1a1a1a', '#59d1ff'], ['MONOLITH', '#f2f2ee', '#222']];
  const c = canvas(1024, 1024), ctx = c.getContext('2d');
  names.forEach(([n, bg, fg], i) => {
    const y = i * 128;
    ctx.fillStyle = bg; ctx.fillRect(0, y, 1024, 128);
    ctx.fillStyle = fg; ctx.font = 'italic 900 92px "Barlow Condensed", Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n, 512, y + 66);
  });
  const t = toTexture(c, { repeat: false });
  cache.set('sponsors', t);
  return t;
}

export function chevronTexture() {
  if (cache.has('chev')) return cache.get('chev');
  const c = canvas(512, 128), ctx = c.getContext('2d');
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#ffd21a';
  for (let i = 0; i < 4; i++) { const x = 30 + i * 120; ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x + 60, 64); ctx.lineTo(x, 114); ctx.lineTo(x + 34, 114); ctx.lineTo(x + 94, 64); ctx.lineTo(x + 34, 14); ctx.fill(); }
  const t = toTexture(c, { repeat: false });
  cache.set('chev', t);
  return t;
}

export function tapeTexture() {
  if (cache.has('tape')) return cache.get('tape');
  const c = canvas(256, 16), ctx = c.getContext('2d');
  for (let x = 0; x < 256; x += 32) { ctx.fillStyle = '#e8e8e8'; ctx.fillRect(x, 0, 16, 16); ctx.fillStyle = '#d0141e'; ctx.fillRect(x + 16, 0, 16, 16); }
  const t = toTexture(c);
  cache.set('tape', t);
  return t;
}

export function softDot(size = 128, hard = 0.0) {
  const key = 'dot' + size + hard;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(hard, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = toTexture(c, { repeat: false, aniso: false });
  cache.set(key, t);
  return t;
}

// Puffy dust/smoke sprite with internal structure.
export function smokeTexture() {
  if (cache.has('smoke')) return cache.get('smoke');
  const S = 128, c = canvas(S), ctx = c.getContext('2d');
  const n = makeNoise2(99);
  const img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x / S - 0.5, dy = y / S - 0.5, r = Math.hypot(dx, dy) * 2;
    const f = fbm(n, x / 22, y / 22, 4) * 0.5 + 0.5;
    const a = Math.max(0, 1 - r) ** 1.5 * (0.45 + 0.75 * f);
    const i = (y * S + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255 * (0.82 + 0.18 * f);
    d[i + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c, { repeat: false, aniso: false });
  cache.set('smoke', t);
  return t;
}

export function waterNormal() {
  if (cache.has('water')) return cache.get('water');
  const t = toTexture(normalFromHeight(noiseCanvas(256, 4242, 8, 4, 1.2), 6), { srgb: false });
  cache.set('water', t);
  return t;
}

export { bleed, canvas, toTexture, normalFromHeight, noiseCanvas, rgba, shade, hex };
