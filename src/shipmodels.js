// Low-poly, flat-shaded craft built from lofted cross-sections. Four original
// silhouettes, one per team. Nose points towards -Z.
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './builder.js';
import { psxMaterial } from './psx.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function loft(b, rings, colorFor) {
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1];
    const n = A.pts.length;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const a = V(A.pts[k][0], A.pts[k][1], A.z), bb = V(A.pts[k2][0], A.pts[k2][1], A.z);
      const c = V(B.pts[k2][0], B.pts[k2][1], B.z), d = V(B.pts[k][0], B.pts[k][1], B.z);
      const col = colorFor((A.pts[k][1] + A.pts[k2][1]) / 2, r, k);
      b.quad(a, bb, c, d, undefined, [col, col, col, col]);
    }
  }
  // caps
  const cap = (R, flip, col) => {
    const cz = R.pts.reduce((s, p) => s + p[1], 0) / R.pts.length;
    const cx = R.pts.reduce((s, p) => s + p[0], 0) / R.pts.length;
    const center = V(cx, cz, R.z);
    for (let k = 0; k < R.pts.length; k++) {
      const k2 = (k + 1) % R.pts.length;
      const a = V(R.pts[k][0], R.pts[k][1], R.z), c = V(R.pts[k2][0], R.pts[k2][1], R.z);
      if (flip) b.tri(center, c, a, undefined, [col, col, col]); else b.tri(center, a, c, undefined, [col, col, col]);
    }
  };
  return cap;
}

function slab(b, pts, thickness, col, y = 0) {
  // flat polygon wing (x,z list) extruded by thickness around y
  const top = pts.map(([x, z]) => V(x, y + thickness / 2, z));
  const bot = pts.map(([x, z]) => V(x, y - thickness / 2, z));
  for (let k = 1; k < pts.length - 1; k++) {
    b.tri(top[0], top[k + 1], top[k], undefined, [col, col, col]);
    b.tri(bot[0], bot[k], bot[k + 1], undefined, [col, col, col]);
  }
  for (let k = 0; k < pts.length; k++) {
    const k2 = (k + 1) % pts.length;
    b.quad(bot[k], bot[k2], top[k2], top[k], undefined, [col, col, col, col]);
  }
}

function fin(b, base0, base1, tip, t, col) {
  const o = V(t / 2, 0, 0);
  b.tri(base0.clone().add(o), base1.clone().add(o), tip.clone().add(o), undefined, [col, col, col]);
  b.tri(base1.clone().sub(o), base0.clone().sub(o), tip.clone().sub(o), undefined, [col, col, col]);
  b.quad(base0.clone().sub(o), base0.clone().add(o), tip.clone().add(o), tip.clone().sub(o), undefined, [col, col, col, col]);
  b.quad(base1.clone().add(o), base1.clone().sub(o), tip.clone().sub(o), tip.clone().add(o), undefined, [col, col, col, col]);
}

function canopy(b, z0, z1, w, y, h, col) {
  const f = V(0, y, z0), l = V(-w, y, (z0 + z1) / 2 + 0.2), r = V(w, y, (z0 + z1) / 2 + 0.2);
  const t = V(0, y + h, (z0 + z1) / 2 + 0.3), bk = V(0, y, z1);
  b.tri(f, t, l, undefined, [col, col, col]); b.tri(f, r, t, undefined, [col, col, col]);
  b.tri(l, t, bk, undefined, [col, col, col]); b.tri(r, bk, t, undefined, [col, col, col]);
}

// Returns { mesh, engines: [Vector3 local exhaust positions] }
export function buildShipModel(team) {
  const b = new MeshBuilder();
  const P = new THREE.Color(team.primary), S = new THREE.Color(team.secondary), A = new THREE.Color(team.accent);
  const glass = new THREE.Color(0x10a0d0);
  const dark = new THREE.Color(0x222428);
  const byHeight = (y, r, k) => (y > 0.15 ? P : y > -0.1 ? S : A);
  let engines = [];

  if (team.style === 'needle') {
    const rings = [
      { z: -2.6, pts: [[0, 0.02], [0.08, 0], [0, -0.05], [-0.08, 0]] },
      { z: -1.2, pts: [[0, 0.35], [0.45, 0.05], [0, -0.25], [-0.45, 0.05]] },
      { z: 0.4, pts: [[0, 0.5], [0.6, 0.08], [0, -0.3], [-0.6, 0.08]] },
      { z: 1.7, pts: [[0, 0.42], [0.5, 0.1], [0, -0.25], [-0.5, 0.1]] },
    ];
    const cap = loft(b, rings, (y, r, k) => (k === 0 || k === 3 ? P : k === 1 ? S : A));
    cap(rings[3], true, dark);
    slab(b, [[0.4, 0.2], [1.8, 0.7], [1.9, 1.3], [0.45, 1.3]], 0.1, S, 0.05);
    slab(b, [[-0.4, 0.2], [-0.45, 1.3], [-1.9, 1.3], [-1.8, 0.7]], 0.1, S, 0.05);
    fin(b, V(0.6, 0.1, 0.8), V(0.55, 0.1, 1.7), V(0.8, 1.0, 1.8), 0.08, P);
    fin(b, V(-0.6, 0.1, 0.8), V(-0.55, 0.1, 1.7), V(-0.8, 1.0, 1.8), 0.08, P);
    canopy(b, -1.2, 0.2, 0.3, 0.3, 0.35, glass);
    engines = [V(0, 0.08, 1.75)];
  } else if (team.style === 'delta') {
    const rings = [
      { z: -2.4, pts: [[0, 0.05], [0.25, 0], [0, -0.05], [-0.25, 0]] },
      { z: -0.4, pts: [[0, 0.4], [0.9, 0.05], [0, -0.25], [-0.9, 0.05]] },
      { z: 1.6, pts: [[0, 0.45], [1.1, 0.1], [0, -0.25], [-1.1, 0.1]] },
    ];
    const cap = loft(b, rings, byHeight);
    cap(rings[2], true, dark);
    slab(b, [[0.6, -1.2], [2.1, 1.3], [2.1, 1.7], [0.9, 1.6]], 0.12, P, 0.02);
    slab(b, [[-0.6, -1.2], [-0.9, 1.6], [-2.1, 1.7], [-2.1, 1.3]], 0.12, P, 0.02);
    slab(b, [[1.7, 1.0], [2.3, 1.2], [2.3, 1.7], [1.7, 1.7]], 0.3, S, 0.1);
    slab(b, [[-1.7, 1.0], [-1.7, 1.7], [-2.3, 1.7], [-2.3, 1.2]], 0.3, S, 0.1);
    fin(b, V(0, 0.4, 0.6), V(0, 0.4, 1.6), V(0, 1.1, 1.8), 0.1, S);
    canopy(b, -1.4, 0.0, 0.35, 0.28, 0.32, glass);
    engines = [V(-0.5, 0.1, 1.65), V(0.5, 0.1, 1.65)];
  } else if (team.style === 'twin') {
    for (const sx of [-1, 1]) {
      const rings = [
        { z: -2.3, pts: [[sx * 0.9, 0.05], [sx * 0.9 + 0.12, 0], [sx * 0.9, -0.1], [sx * 0.9 - 0.12, 0]] },
        { z: -1.0, pts: [[sx * 0.9, 0.35], [sx * 0.9 + 0.38, 0.05], [sx * 0.9, -0.3], [sx * 0.9 - 0.38, 0.05]] },
        { z: 1.6, pts: [[sx * 0.9, 0.4], [sx * 0.9 + 0.42, 0.05], [sx * 0.9, -0.3], [sx * 0.9 - 0.42, 0.05]] },
      ];
      const cap = loft(b, rings, byHeight);
      cap(rings[2], true, dark);
      fin(b, V(sx * 0.9, 0.3, 0.6), V(sx * 0.9, 0.3, 1.6), V(sx * 1.0, 0.95, 1.75), 0.08, S);
    }
    const body = [
      { z: -1.6, pts: [[0, 0.2], [0.3, 0.05], [0, -0.1], [-0.3, 0.05]] },
      { z: 0.2, pts: [[0, 0.4], [0.55, 0.05], [0, -0.15], [-0.55, 0.05]] },
      { z: 1.2, pts: [[0, 0.3], [0.4, 0.05], [0, -0.1], [-0.4, 0.05]] },
    ];
    const cap = loft(b, body, () => S);
    cap(body[2], true, dark);
    slab(b, [[-0.9, -0.3], [0.9, -0.3], [0.9, 0.9], [-0.9, 0.9]], 0.12, P, 0.0);
    canopy(b, -1.2, 0.2, 0.3, 0.3, 0.3, glass);
    engines = [V(-0.9, 0.05, 1.65), V(0.9, 0.05, 1.65)];
  } else {
    // 'brick': chunky body with side pods and a single tall fin
    const rings = [
      { z: -2.2, pts: [[0, 0.1], [0.4, 0.05], [0.4, -0.15], [-0.4, -0.15], [-0.4, 0.05]] },
      { z: -0.8, pts: [[0, 0.55], [0.8, 0.3], [0.8, -0.3], [-0.8, -0.3], [-0.8, 0.3]] },
      { z: 1.7, pts: [[0, 0.6], [0.9, 0.35], [0.9, -0.3], [-0.9, -0.3], [-0.9, 0.35]] },
    ];
    const cap = loft(b, rings, (y, r, k) => (k === 0 || k === 4 ? P : k === 2 ? A : S));
    cap(rings[2], true, dark);
    for (const sx of [-1, 1]) {
      const pod = [
        { z: -1.2, pts: [[sx * 1.5, 0.2], [sx * 1.8, 0], [sx * 1.5, -0.25], [sx * 1.2, 0]] },
        { z: 1.8, pts: [[sx * 1.5, 0.3], [sx * 1.9, 0], [sx * 1.5, -0.3], [sx * 1.1, 0]] },
      ];
      const pc = loft(b, pod, () => P);
      pc(pod[0], false, S); pc(pod[1], true, dark);
      slab(b, sx > 0 ? [[0.8, -0.4], [1.3, -0.4], [1.3, 1.2], [0.8, 1.2]] : [[-0.8, -0.4], [-0.8, 1.2], [-1.3, 1.2], [-1.3, -0.4]], 0.1, A, 0.0);
    }
    fin(b, V(0, 0.55, 0.3), V(0, 0.55, 1.7), V(0, 1.5, 1.9), 0.12, P);
    canopy(b, -1.5, -0.2, 0.4, 0.45, 0.3, glass);
    engines = [V(0, 0.1, 1.75), V(-1.5, 0, 1.85), V(1.5, 0, 1.85)];
  }

  const mesh = b.build(psxMaterial({ vertexColors: true, lit: true, side: THREE.DoubleSide, rough: 0.32, metal: 0.45 }), true);
  mesh.castShadow = true;
  mesh.matrixAutoUpdate = true;
  return { mesh, engines };
}
