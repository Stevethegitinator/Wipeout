// Racing craft built from lofted cross-sections with creased normals, glass
// canopies, engine nozzles, running lights and race-number decals. Four
// original silhouettes, one per team. Nose points towards -Z.
import * as THREE from '../vendor/three.module.min.js';
import { toCreasedNormals } from '../vendor/addons/utils/BufferGeometryUtils.js';
import { MeshBuilder } from './builder.js';
import { psxMaterial, renderStyle } from './psx.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A cross-section: rounded-box outline (super-ellipse) with separate top and
// bottom heights. `p` < 1 squares it off.
function ring(z, w, top, bot, { n = 10, x = 0, y = 0, p = 0.75 } = {}) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + Math.PI / 2;
    const c = Math.cos(a), s = Math.sin(a);
    const cx = Math.sign(c) * Math.abs(c) ** p, sy = Math.sign(s) * Math.abs(s) ** p;
    pts.push([x + w * cx, y + (sy >= 0 ? top : bot) * sy]);
  }
  return { z, pts };
}

function loft(b, rings, colorFor, capEnd = null, capStart = null) {
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1];
    const n = A.pts.length;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const a = V(A.pts[k][0], A.pts[k][1], A.z), bb = V(A.pts[k2][0], A.pts[k2][1], A.z);
      const c = V(B.pts[k2][0], B.pts[k2][1], B.z), d = V(B.pts[k][0], B.pts[k][1], B.z);
      const col = colorFor((A.pts[k][1] + A.pts[k2][1]) / 2, r, k, (A.pts[k][0] + A.pts[k2][0]) / 2);
      b.quad(a, bb, c, d, undefined, [col, col, col, col]);
    }
  }
  const cap = (R, flip, col) => {
    const cx = R.pts.reduce((s, p) => s + p[0], 0) / R.pts.length;
    const cy = R.pts.reduce((s, p) => s + p[1], 0) / R.pts.length;
    const center = V(cx, cy, R.z);
    for (let k = 0; k < R.pts.length; k++) {
      const k2 = (k + 1) % R.pts.length;
      const a = V(R.pts[k][0], R.pts[k][1], R.z), c = V(R.pts[k2][0], R.pts[k2][1], R.z);
      if (flip) b.tri(center, c, a, undefined, [col, col, col]); else b.tri(center, a, c, undefined, [col, col, col]);
    }
  };
  if (capEnd) cap(rings[rings.length - 1], true, capEnd);
  if (capStart) cap(rings[0], false, capStart);
}

// Flat wing/fin plate from an outline in the x/z plane, with bevelled thickness.
function plate(b, pts, thickness, col, y = 0, edgeCol = col) {
  const top = pts.map(([x, z]) => V(x, y + thickness / 2, z));
  const bot = pts.map(([x, z]) => V(x, y - thickness / 2, z));
  for (let k = 1; k < pts.length - 1; k++) {
    b.tri(top[0], top[k + 1], top[k], undefined, [col, col, col]);
    b.tri(bot[0], bot[k], bot[k + 1], undefined, [col, col, col]);
  }
  for (let k = 0; k < pts.length; k++) {
    const k2 = (k + 1) % pts.length;
    b.quad(bot[k], bot[k2], top[k2], top[k], undefined, [edgeCol, edgeCol, edgeCol, edgeCol]);
  }
}

function fin(b, base0, base1, tip0, tip1, t, col) {
  const o = V(t / 2, 0, 0);
  const P = [base0, base1, tip1, tip0];
  const L = P.map((p) => p.clone().sub(o)), R = P.map((p) => p.clone().add(o));
  b.quad(R[0], R[1], R[2], R[3], undefined, [col, col, col, col]);
  b.quad(L[1], L[0], L[3], L[2], undefined, [col, col, col, col]);
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    b.quad(L[k], L[k2], R[k2], R[k], undefined, [col, col, col, col]);
  }
}

function numberTexture(num, team) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#' + new THREE.Color(team.secondary).getHexString();
  x.beginPath(); x.roundRect(4, 4, 120, 56, 14); x.fill();
  x.fillStyle = '#' + new THREE.Color(team.accent).getHexString();
  x.beginPath(); x.roundRect(10, 10, 108, 44, 10); x.fill();
  x.fillStyle = '#ffffff';
  x.font = 'italic 900 40px "Arial Black", Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(num).padStart(2, '0'), 64, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Returns { mesh: Group, engines: [Vector3 local exhaust positions] }
export function buildShipModel(team, number = 1) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), metal = new MeshBuilder();
  const glow = new MeshBuilder(), trim = new MeshBuilder(), decal = new MeshBuilder();
  const P = new THREE.Color(team.primary), S = new THREE.Color(team.secondary), A = new THREE.Color(team.accent);
  const livery = (top, bot) => (y, r, k) => (y > top ? P : y < bot ? A : S);
  let engines = [], engineR = 0.3, decals = [], lights = [];

  const canopy = (z0, z1, w, y, h) => {
    loft(glass, [
      ring(z0, 0.02, 0.01, 0.01, { n: 8, y }),
      ring(z0 + (z1 - z0) * 0.35, w * 0.85, h * 0.85, 0.02, { n: 8, y, p: 0.9 }),
      ring(z0 + (z1 - z0) * 0.75, w, h, 0.02, { n: 8, y, p: 0.9 }),
      ring(z1, w * 0.6, h * 0.45, 0.02, { n: 8, y, p: 0.9 }),
    ], () => 1, 1);
  };
  const strip = (x, y, z0, z1) => {
    const g = new THREE.BoxGeometry(0.05, 0.06, z1 - z0);
    trim.addGeometry(g, new THREE.Matrix4().makeTranslation(x, y, (z0 + z1) / 2));
  };

  if (team.style === 'needle') {
    loft(body, [
      ring(-3.0, 0.05, 0.03, 0.03),
      ring(-2.1, 0.32, 0.26, 0.16),
      ring(-0.9, 0.55, 0.42, 0.24),
      ring(0.4, 0.66, 0.5, 0.28),
      ring(1.5, 0.62, 0.46, 0.26),
      ring(2.0, 0.5, 0.36, 0.2),
    ], livery(0.22, -0.12), A);
    plate(body, [[0.45, 0.1], [2.0, 0.75], [2.15, 1.35], [0.5, 1.45]], 0.1, S, 0.02, A);
    plate(body, [[-0.45, 0.1], [-0.5, 1.45], [-2.15, 1.35], [-2.0, 0.75]], 0.1, S, 0.02, A);
    for (const sx of [-1, 1]) fin(body, V(sx * 0.62, 0.2, 0.8), V(sx * 0.58, 0.2, 1.9), V(sx * 0.85, 1.05, 1.55), V(sx * 0.82, 1.05, 2.05), 0.07, P);
    canopy(-1.7, 0.1, 0.32, 0.3, 0.36);
    strip(0.66, 0.02, -0.6, 1.5); strip(-0.66, 0.02, -0.6, 1.5);
    engines = [V(0, 0.08, 2.0)]; engineR = 0.34;
    decals = [[1.3, 0.08, 1.0, 0.9], [-1.3, 0.08, 1.0, 0.9]];
    lights = [V(2.1, 0.05, 1.1), V(-2.1, 0.05, 1.1)];
  } else if (team.style === 'delta') {
    loft(body, [
      ring(-2.7, 0.18, 0.04, 0.04, { p: 0.6 }),
      ring(-1.4, 0.6, 0.3, 0.18, { p: 0.6 }),
      ring(0.2, 1.0, 0.42, 0.24, { p: 0.6 }),
      ring(1.6, 1.15, 0.45, 0.26, { p: 0.6 }),
      ring(1.9, 1.05, 0.38, 0.22, { p: 0.6 }),
    ], livery(0.2, -0.1), A);
    plate(body, [[0.7, -1.3], [2.3, 1.2], [2.3, 1.75], [1.0, 1.7]], 0.12, P, 0.02, S);
    plate(body, [[-0.7, -1.3], [-1.0, 1.7], [-2.3, 1.75], [-2.3, 1.2]], 0.12, P, 0.02, S);
    for (const sx of [-1, 1]) {
      loft(body, [
        ring(0.6, 0.22, 0.18, 0.18, { x: sx * 2.0, y: 0.12, n: 8 }),
        ring(1.0, 0.34, 0.26, 0.26, { x: sx * 2.0, y: 0.12, n: 8 }),
        ring(1.9, 0.34, 0.26, 0.26, { x: sx * 2.0, y: 0.12, n: 8 }),
      ], () => S, A, S);
    }
    fin(body, V(0, 0.4, 0.5), V(0, 0.4, 1.8), V(0, 1.25, 1.45), V(0, 1.25, 2.0), 0.1, S);
    canopy(-1.8, -0.1, 0.38, 0.28, 0.34);
    strip(1.0, 0.0, -0.2, 1.6); strip(-1.0, 0.0, -0.2, 1.6);
    engines = [V(-0.5, 0.1, 1.95), V(0.5, 0.1, 1.95), V(-2.0, 0.12, 1.95), V(2.0, 0.12, 1.95)]; engineR = 0.24;
    decals = [[1.35, 0.09, 0.5, 0.9], [-1.35, 0.09, 0.5, 0.9]];
    lights = [V(2.35, 0.1, 1.5), V(-2.35, 0.1, 1.5)];
  } else if (team.style === 'twin') {
    for (const sx of [-1, 1]) {
      loft(body, [
        ring(-2.6, 0.06, 0.05, 0.05, { x: sx * 1.0, n: 10 }),
        ring(-1.5, 0.32, 0.3, 0.26, { x: sx * 1.0, n: 10 }),
        ring(0.2, 0.44, 0.38, 0.3, { x: sx * 1.0, n: 10 }),
        ring(1.7, 0.42, 0.36, 0.3, { x: sx * 1.0, n: 10 }),
        ring(2.0, 0.36, 0.3, 0.26, { x: sx * 1.0, n: 10 }),
      ], livery(0.18, -0.14), A);
      fin(body, V(sx * 1.0, 0.3, 0.7), V(sx * 1.0, 0.3, 1.8), V(sx * 1.12, 1.0, 1.5), V(sx * 1.12, 1.0, 2.0), 0.08, S);
    }
    loft(body, [
      ring(-1.9, 0.08, 0.08, 0.06),
      ring(-1.0, 0.36, 0.3, 0.14),
      ring(0.4, 0.5, 0.42, 0.16),
      ring(1.3, 0.38, 0.3, 0.12),
    ], () => S, A);
    plate(body, [[-1.0, -0.4], [1.0, -0.4], [1.0, 1.0], [-1.0, 1.0]], 0.12, P, 0.0, A);
    canopy(-1.5, 0.3, 0.3, 0.3, 0.32);
    strip(1.44, 0.0, -1.2, 1.7); strip(-1.44, 0.0, -1.2, 1.7);
    engines = [V(-1.0, 0.04, 2.0), V(1.0, 0.04, 2.0)]; engineR = 0.3;
    decals = [[0, 0.07, 0.55, 0.8]];
    lights = [V(1.45, 0.1, -0.6), V(-1.45, 0.1, -0.6)];
  } else {
    // 'brick': chunky armoured body with side pods and one tall fin
    loft(body, [
      ring(-2.5, 0.4, 0.12, 0.12, { p: 0.4 }),
      ring(-1.6, 0.75, 0.45, 0.3, { p: 0.4 }),
      ring(0.2, 0.92, 0.6, 0.32, { p: 0.4 }),
      ring(1.7, 0.95, 0.62, 0.32, { p: 0.4 }),
      ring(2.0, 0.85, 0.52, 0.28, { p: 0.4 }),
    ], (y, r, k, x) => (Math.abs(x) < 0.45 && y > 0 ? P : y > 0.25 ? S : y < -0.1 ? A : P), A);
    for (const sx of [-1, 1]) {
      loft(body, [
        ring(-1.5, 0.12, 0.1, 0.1, { x: sx * 1.55, n: 8 }),
        ring(-0.7, 0.36, 0.3, 0.3, { x: sx * 1.55, n: 8 }),
        ring(1.8, 0.38, 0.32, 0.32, { x: sx * 1.55, n: 8 }),
        ring(2.1, 0.32, 0.27, 0.27, { x: sx * 1.55, n: 8 }),
      ], () => P, A);
      plate(body, sx > 0 ? [[0.85, -0.5], [1.3, -0.5], [1.3, 1.3], [0.85, 1.3]] : [[-0.85, -0.5], [-0.85, 1.3], [-1.3, 1.3], [-1.3, -0.5]], 0.12, A, 0.0);
    }
    fin(body, V(0, 0.6, 0.1), V(0, 0.6, 1.9), V(0, 1.65, 1.5), V(0, 1.65, 2.15), 0.14, P);
    canopy(-1.9, -0.4, 0.42, 0.45, 0.34);
    strip(0.95, 0.15, -1.2, 1.7); strip(-0.95, 0.15, -1.2, 1.7);
    engines = [V(0, 0.12, 2.0), V(-1.55, 0, 2.1), V(1.55, 0, 2.1)]; engineR = 0.3;
    decals = [[0.4, 0.66, 0.9, 0.7, 'side']];
    lights = [V(1.95, 0.0, -0.6), V(-1.95, 0.0, -0.6)];
  }

  // Engine nozzles: dark metal shroud with a glowing core.
  const shroud = new THREE.CylinderGeometry(engineR * 1.15, engineR * 0.95, 0.5, 12, 1, true).rotateX(Math.PI / 2);
  const core = new THREE.CircleGeometry(engineR * 0.85, 12);
  for (const e of engines) {
    metal.addGeometry(shroud, new THREE.Matrix4().makeTranslation(e.x, e.y, e.z - 0.05));
    glow.addGeometry(core, new THREE.Matrix4().makeTranslation(e.x, e.y, e.z + 0.12));
  }
  // Running lights at the wingtips.
  const lamp = new THREE.BoxGeometry(0.14, 0.08, 0.3);
  for (const l of lights) trim.addGeometry(lamp, new THREE.Matrix4().makeTranslation(l.x, l.y, l.z));
  // Race-number decals: flat on wings, or on the fin's sides.
  for (const [x, y, z, w, kind] of decals) {
    const h = w * 0.5;
    if (kind === 'side') {
      for (const sx of [-1, 1]) {
        const xx = sx * 0.08;
        const a = V(xx, y + 0.2, z + w / 2), b = V(xx, y + 0.2, z - w / 2), c = V(xx, y + 0.2 + h * 1.2, z - w / 2), d = V(xx, y + 0.2 + h * 1.2, z + w / 2);
        if (sx > 0) decal.quad(a, b, c, d, [0, 0, 1, 0, 1, 1, 0, 1]); else decal.quad(b, a, d, c, [1, 0, 0, 0, 0, 1, 1, 1]);
      }
    } else {
      decal.quad(V(x - w / 2, y, z + h), V(x + w / 2, y, z + h), V(x + w / 2, y, z - h), V(x - w / 2, y, z - h), [0, 0, 1, 0, 1, 1, 0, 1]);
    }
  }

  const modern = renderStyle.modern;
  const group = new THREE.Group();
  const finish = (bld, mat, crease = true) => {
    if (bld.empty) return;
    const mesh = bld.build(mat, true);
    if (modern && crease) mesh.geometry = toCreasedNormals(mesh.geometry, 0.55);
    mesh.matrixAutoUpdate = true;
    mesh.castShadow = true;
    group.add(mesh);
  };
  finish(body, psxMaterial({ vertexColors: true, lit: true, side: THREE.DoubleSide, rough: 0.28, metal: 0.55 }));
  finish(metal, psxMaterial({ color: 0x3a3d44, lit: true, side: THREE.DoubleSide, rough: 0.35, metal: 0.85 }), false);
  finish(trim, psxMaterial({ color: team.secondary, glow: 2.2 }), false);
  finish(glow, psxMaterial({ color: 0xffa860, glow: 1.6, side: THREE.DoubleSide }), false);
  if (modern) {
    const gm = new THREE.MeshPhysicalMaterial({
      color: 0x0c1824, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.82,
      clearcoat: 1, envMapIntensity: 2.5, side: THREE.DoubleSide,
    });
    finish(glass, gm);
  } else {
    finish(glass, psxMaterial({ color: 0x10a0d0, lit: true, side: THREE.DoubleSide }), false);
  }
  if (!decal.empty) {
    const tex = numberTexture(number, team);
    const dm = modern
      ? new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })
      : psxMaterial({ map: tex, side: THREE.DoubleSide });
    const m = decal.build(dm, true);
    m.matrixAutoUpdate = true;
    group.add(m);
  }
  return { mesh: group, engines };
}
