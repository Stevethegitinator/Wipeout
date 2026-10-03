// Track geometry as data: a closed spline sampled into evenly spaced sections,
// each with a position, forward/right/up frame, bank angle and width.
// Kept free of rendering so the physics can be simulated headlessly.
import * as THREE from '../vendor/three.module.min.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _seg = new THREE.Vector3();

export const SECTION_SPACING = 6;
export const LANES = 4;

export class TrackData {
  constructor(def) {
    this.def = def;
    const sc = def.scale || 1.6;
    const pts = def.points.map((p) => new THREE.Vector3(p[0] * sc, p[1] * 1.3, p[2] * sc));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    curve.arcLengthDivisions = 4000;
    this.length = curve.getLength();
    const N = Math.floor(this.length / SECTION_SPACING);
    this.N = N;
    this.spacing = this.length / N;

    this.P = []; this.T = []; this.R = []; this.U = [];
    this.width = new Float32Array(N);
    this.bank = new Float32Array(N);
    this.dist = new Float32Array(N);
    this.tunnel = new Uint8Array(N);

    for (let i = 0; i < N; i++) {
      this.P.push(curve.getPointAt(i / N));
      this.dist[i] = i * this.spacing;
    }

    // Jumps: a kicker ramp, then either a sharp drop (gap = 0) or a missing
    // stretch of track to fly over, landing lower down.
    this.gap = new Uint8Array(N);
    this.gapEnd = new Int32Array(N).fill(-1);
    this.jumps = [];
    const offset = new Float32Array(N);
    for (const [f, gapLen] of def.jumps || []) {
      const s = Math.floor(f * N);
      const RAMP = 14, H = 5, D = 4, G = gapLen || 3, LAND = 30;
      this.jumps.push({ section: s % N, gap: gapLen, end: (s + G) % N });
      for (let k = 0; k < RAMP; k++) offset[(s - RAMP + k + N) % N] += H * (1 - Math.cos((Math.PI / 2) * (k / RAMP)));
      for (let k = 0; k < G; k++) {
        const i = (s + k) % N;
        offset[i] += H + (-D - H) * ((k + 1) / G);
        if (gapLen) { this.gap[i] = 1; this.gapEnd[i] = (s + G + 2) % N; }
      }
      for (let k = 0; k < LAND; k++) {
        const x = k / LAND;
        offset[(s + G + k) % N] += -D * (1 - x * x * (3 - 2 * x));
      }
    }
    for (let i = 0; i < N; i++) this.P[i].y += offset[i];
    for (let i = 0; i < N; i++) {
      // forward tangents so the lip of a kicker launches the craft
      const t = new THREE.Vector3().subVectors(this.P[(i + 1) % N], this.P[i]);
      const back = new THREE.Vector3().subVectors(this.P[i], this.P[(i - 1 + N) % N]);
      this.T.push(t.add(back).normalize());
    }

    // Signed horizontal curvature (positive = left turn), smoothed.
    const curv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.T[(i - 1 + N) % N], b = this.T[(i + 1) % N];
      const cross = a.x * b.z - a.z * b.x; // y of b x a
      const ang = Math.asin(Math.max(-1, Math.min(1, -cross)));
      curv[i] = ang / (2 * this.spacing);
    }
    const smooth = new Float32Array(N);
    const W = 10;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -W; k <= W; k++) s += curv[(i + k + N) % N];
      smooth[i] = s / (2 * W + 1);
    }
    this.curvature = smooth;

    for (let i = 0; i < N; i++) {
      const T = this.T[i];
      const R = new THREE.Vector3().crossVectors(T, WORLD_UP).normalize();
      const U = new THREE.Vector3().crossVectors(R, T).normalize();
      const b = Math.max(-0.55, Math.min(0.55, smooth[i] * 26));
      this.bank[i] = b;
      const c = Math.cos(b), s = Math.sin(b);
      const U2 = U.clone().multiplyScalar(c).addScaledVector(R, -s);
      const R2 = R.clone().multiplyScalar(c).addScaledVector(U, s);
      this.R.push(R2); this.U.push(U2);
      this.width[i] = def.width;
    }

    for (const [a, b] of def.tunnels || []) {
      for (let i = Math.floor(a * N); i < Math.floor(b * N); i++) this.tunnel[i % N] = 1;
    }

    this.pads = [];
    const addPad = (type) => ([f, lane]) => {
      const s = Math.floor(f * N) % N;
      this.pads.push({ type, section: s, lane, length: 2 });
    };
    (def.speedPads || []).forEach(addPad('speed'));
    (def.weaponPads || []).forEach(addPad('weapon'));
    this.padAt = new Map();
    for (const p of this.pads) for (let k = 0; k < p.length; k++) {
      const s = (p.section + k) % N;
      if (!this.padAt.has(s)) this.padAt.set(s, []);
      this.padAt.get(s).push(p);
    }

    this.bounds = new THREE.Box3().setFromPoints(this.P);
    this.minY = this.bounds.min.y;
  }

  wrap(i) { return ((i % this.N) + this.N) % this.N; }

  laneOffset(i, lane) {
    const w = this.width[i];
    return -w / 2 + (lane + 0.5) * (w / LANES);
  }

  // Find the nearest point on the centreline near `hint` and fill `out` with
  // the interpolated local frame and the query position's local coordinates.
  query(pos, hint, out) {
    const N = this.N;
    let best = -1, bestD = Infinity, bestT = 0;
    const scan = (from, to) => {
      for (let k = from; k <= to; k++) {
        const i = this.wrap(k), j = this.wrap(k + 1);
        _seg.subVectors(this.P[j], this.P[i]);
        const len2 = _seg.lengthSq();
        let t = _v.subVectors(pos, this.P[i]).dot(_seg) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = _v.copy(this.P[i]).addScaledVector(_seg, t).distanceToSquared(pos);
        if (d < bestD) { bestD = d; best = i; bestT = t; }
      }
    };
    if (hint == null || hint < 0) scan(0, N - 1);
    else {
      scan(hint - 3, hint + 5);
      if (bestD > 70 * 70) scan(0, N - 1);
    }
    const i = best, j = this.wrap(i + 1), t = bestT;
    out.index = i;
    out.t = t;
    out.P = (out.P || new THREE.Vector3()).lerpVectors(this.P[i], this.P[j], t);
    out.T = (out.T || new THREE.Vector3()).lerpVectors(this.T[i], this.T[j], t).normalize();
    out.U = (out.U || new THREE.Vector3()).lerpVectors(this.U[i], this.U[j], t).normalize();
    out.R = (out.R || new THREE.Vector3()).lerpVectors(this.R[i], this.R[j], t).normalize();
    out.width = this.width[i] + (this.width[j] - this.width[i]) * t;
    _v.subVectors(pos, out.P);
    out.h = _v.dot(out.U);
    out.lat = _v.dot(out.R);
    out.tunnel = this.tunnel[i];
    out.gap = this.gap[i];
    return out;
  }

  // World position of a point on the track surface.
  pointAt(i, lat, h = 0, target = new THREE.Vector3()) {
    i = this.wrap(i);
    return target.copy(this.P[i]).addScaledVector(this.R[i], lat).addScaledVector(this.U[i], h);
  }
}
