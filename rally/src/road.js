// Stage geometry: a point-to-point road built from straights and clothoid
// corners, its height profile, the terrain around it, fast spatial queries,
// and the co-driver's pace notes, which are derived from the same plan the
// road was built from (so every call matches the road exactly).
import { rng, makeNoise2, fbm, clamp, lerp, smoothstep } from './util.js';

export const STEP = 2; // metres between road samples

// Corner grades, tightest last. Radius ranges in metres, turn angles in degrees.
export const GRADES = [
  { name: 'flat', r: [250, 380], ang: [8, 18] },
  { name: 'easy', r: [130, 230], ang: [18, 48] },
  { name: 'medium', r: [72, 125], ang: [25, 80] },
  { name: 'hard', r: [40, 68], ang: [40, 100] },
  { name: 'square', r: [19, 30], ang: [78, 100] },
  { name: 'hairpin', r: [9, 13], ang: [150, 185] },
];
const gradeIndex = Object.fromEntries(GRADES.map((g, i) => [g.name, i]));
export function gradeForRadius(r) {
  if (r < 16) return 'hairpin';
  if (r < 34) return 'square';
  if (r < 70) return 'hard';
  if (r < 128) return 'medium';
  if (r < 250) return 'easy';
  return 'flat';
}

export class Road {
  constructor(stage) {
    this.stage = stage;
    const seed = stage.seed;
    this.noise = makeNoise2(seed * 7 + 1);
    this.noise2 = makeNoise2(seed * 13 + 5);
    this.halfWidth = stage.width / 2;
    this.plan();
    this.buildGrid();
    this.buildProfile();
    this.buildNotes();
  }

  // ---- Horizontal layout -------------------------------------------------
  plan() {
    const st = this.stage;
    const r = rng(st.seed);
    const pieces = []; // {type:'straight'|'corner', len, k0, k1 ... } as curvature keyframes
    // Curvature keyframes along distance: [s, k]. Linear between keyframes = clothoids.
    const keys = [[0, 0]];
    let s = 0;
    const xs = [0], zs = [0], hs = [0], ks = [0];
    let x = 0, z = 0, h = 0;
    const grid = new Map();
    const cell = 40;
    const gkey = (gx, gz) => gx * 100003 + gz;
    const addGrid = (i) => {
      const k = gkey(Math.floor(xs[i] / cell), Math.floor(zs[i] / cell));
      let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i);
    };
    addGrid(0);
    const tooClose = (px, pz, minIdx, minD) => {
      const gx = Math.floor(px / cell), gz = Math.floor(pz / cell);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const a = grid.get(gkey(gx + dx, gz + dz)); if (!a) continue;
        for (const i of a) if (i < minIdx && (xs[i] - px) ** 2 + (zs[i] - pz) ** 2 < minD * minD) return true;
      }
      return false;
    };
    // Integrate a curvature program, returning new points; null if it hits earlier road.
    const trial = (prog) => {
      let tx = x, tz = z, th = h;
      const px = [], pz = [], ph = [], pk = [];
      let n = xs.length;
      for (const [len, k0, k1] of prog) {
        const steps = Math.max(1, Math.round(len / STEP));
        for (let j = 1; j <= steps; j++) {
          const k = lerp(k0, k1, (j - 0.5) / steps);
          th += k * STEP;
          tx += Math.sin(th) * STEP; tz += Math.cos(th) * STEP;
          if (tooClose(tx, tz, n + px.length - 110, 62)) return null;
          px.push(tx); pz.push(tz); ph.push(th); pk.push(lerp(k0, k1, j / steps));
        }
      }
      return { px, pz, ph, pk };
    };
    const commit = (res) => {
      for (let j = 0; j < res.px.length; j++) {
        xs.push(res.px[j]); zs.push(res.pz[j]); hs.push(res.ph[j]); ks.push(res.pk[j]);
        addGrid(xs.length - 1);
      }
      x = xs[xs.length - 1]; z = zs[zs.length - 1]; h = hs[hs.length - 1];
    };

    const corners = [];
    const wantLen = st.length;
    const truncate = (len) => {
      while (xs.length > len) {
        const i = xs.length - 1;
        grid.get(gkey(Math.floor(xs[i] / cell), Math.floor(zs[i] / cell))).pop();
        xs.pop(); zs.pop(); hs.pop(); ks.pop();
      }
      x = xs[xs.length - 1]; z = zs[zs.length - 1]; h = hs[hs.length - 1];
    };
    // Opening straight for the start area.
    commit(trial([[90, 0, 0]]));
    const stack = []; // sample count before each committed piece, for backtracking
    let fails = 0, total = 0;
    const weights = st.grades; // relative frequency per grade
    const wsum = weights.reduce((a, b) => a + b, 0);
    let lastDir = 1;
    while ((xs.length - 1) * STEP < wantLen && total++ < 4000) {
      // Straight
      const sl = r() < st.longStraight ? r.range(140, 320) : r.range(st.straight[0], st.straight[1]);
      // Corner grade
      let pick = r() * wsum, gi = 0;
      while (pick > weights[gi]) { pick -= weights[gi]; gi++; }
      gi = Math.min(gi, GRADES.length - 1);
      const g = GRADES[gi];
      const R = r.range(g.r[0], g.r[1]);
      const ang = r.range(g.ang[0], g.ang[1]) * Math.PI / 180;
      // Direction: rhythm alternates more often than not; steer back if heading drifts too far.
      let dir = r() < 0.62 ? -lastDir : lastDir;
      const drift = h - st.heading;
      if (Math.abs(drift) > 1.3) dir = drift > 0 ? 1 : -1; // +heading turns left
      // Compound corners: tightens or opens.
      let mod = null;
      if (gi >= 1 && gi <= 3 && r() < 0.22) mod = r() < 0.5 ? 'tightens' : 'opens';
      const make = (d) => {
        const k = -d / R; // positive curvature turns left
        const trans = clamp(R * 0.35, 8, 40);
        const arc = Math.max(4, R * ang - trans);
        if (mod === 'tightens') {
          const k2 = -d / (R * 0.55);
          return [[sl, 0, 0], [trans, 0, k], [arc * 0.5, k, k], [10, k, k2], [arc * 0.35, k2, k2], [trans * 0.7, k2, 0]];
        }
        if (mod === 'opens') {
          const k2 = -d / (R * 1.8);
          return [[sl, 0, 0], [trans, 0, k], [arc * 0.5, k, k], [14, k, k2], [arc * 0.5, k2, k2], [trans, k2, 0]];
        }
        return [[sl, 0, 0], [trans, 0, k], [arc, k, k], [trans, k, 0]];
      };
      let prog = make(dir);
      let res = trial(prog);
      if (!res && Math.abs(drift) < 1.3) { dir = -dir; prog = make(dir); res = trial(prog); }
      if (!res) {
        // Dead end: back up a piece or two and try something else.
        if (++fails % 5 === 0 && stack.length > 1) {
          const back = Math.min(stack.length - 1, 1 + Math.floor(fails / 25));
          for (let b = 0; b < back; b++) { truncate(stack.pop()); corners.pop(); }
        }
        continue;
      }
      stack.push(xs.length);
      const s0 = (xs.length - 1) * STEP;
      commit(res);
      const cStart = s0 + sl;
      const cLen = prog.slice(1).reduce((a, p) => a + p[0], 0);
      corners.push({ s: cStart, end: cStart + cLen, dir, grade: gradeForRadius(mod === 'tightens' ? R * 0.55 : R), R, ang, mod });
      lastDir = dir;
    }
    // Run-out after the finish.
    commit(trial([[160, 0, 0]]) || { px: [], pz: [], ph: [], pk: [] });

    const n = xs.length;
    this.n = n;
    this.x = Float32Array.from(xs);
    this.z = Float32Array.from(zs);
    this.hdg = Float32Array.from(hs);
    this.k = Float32Array.from(ks);
    this.y = new Float32Array(n);
    this.length = (n - 1) * STEP;
    this.start = 40;
    this.finish = this.length - 130;
    this.corners = corners.filter((c) => c.end < this.finish);
    this.splits = [this.finish * 0.34, this.finish * 0.68];
    // Width variation: narrow sections in places.
    this.w = new Float32Array(n);
    const wr = rng(st.seed + 99);
    const narrow = [];
    for (let i = 0; i < 3; i++) { const c = wr.range(0.15, 0.9) * this.finish; narrow.push([c, c + wr.range(120, 260)]); }
    this.narrowZones = narrow;
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      let w = this.halfWidth;
      for (const [a, b] of narrow) w -= 0.9 * smoothstep(a, a + 30, s) * (1 - smoothstep(b - 30, b, s));
      this.w[i] = w;
    }
  }

  buildGrid() {
    const CELL = (this.CELL = 16);
    this.grid = new Map();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minX = Math.min(minX, this.x[i]); maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]); maxZ = Math.max(maxZ, this.z[i]);
      // Register each sample in its own cell; queries search neighbours.
      const k = this.key(Math.floor(this.x[i] / CELL), Math.floor(this.z[i] / CELL));
      let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(i);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
  }
  key(gx, gz) { return gx * 73856093 ^ gz * 19349663; }

  // Nearest point on the centreline within maxD metres. Returns a reused object.
  nearest(px, pz, maxD = 60, out = this._q || (this._q = {})) {
    const CELL = this.CELL;
    const gx = Math.floor(px / CELL), gz = Math.floor(pz / CELL);
    const rad = Math.ceil(maxD / CELL);
    let best = -1, bd = maxD * maxD;
    for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
      const a = this.grid.get(this.key(gx + dx, gz + dz)); if (!a) continue;
      for (let j = 0; j < a.length; j++) {
        const i = a[j];
        const d = (this.x[i] - px) ** 2 + (this.z[i] - pz) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    if (best < 0) { out.i = -1; return out; }
    // Refine on the adjoining segment.
    let i = best;
    const proj = (a) => {
      const b = a + 1;
      const ex = this.x[b] - this.x[a], ez = this.z[b] - this.z[a];
      const t = clamp(((px - this.x[a]) * ex + (pz - this.z[a]) * ez) / (ex * ex + ez * ez), 0, 1);
      const cx = this.x[a] + ex * t, cz = this.z[a] + ez * t;
      return [t, cx, cz, (px - cx) ** 2 + (pz - cz) ** 2];
    };
    let seg = Math.min(i, this.n - 2), r = proj(seg);
    if (i > 0) { const r2 = proj(i - 1); if (r2[3] < r[3]) { seg = i - 1; r = r2; } }
    const [t, cx, cz] = r;
    const ex = this.x[seg + 1] - this.x[seg], ez = this.z[seg + 1] - this.z[seg];
    const len = Math.hypot(ex, ez);
    // Lateral offset: positive to the right of travel. Travel dir (sin h, cos h); right = (cos h, -sin h)... use cross.
    const u = ((px - cx) * ez - (pz - cz) * ex) / len;
    out.i = seg; out.t = t;
    out.s = (seg + t) * STEP;
    out.u = -u; // + = right side when looking along travel
    out.d = Math.abs(u);
    out.y = lerp(this.y[seg], this.y[seg + 1], t);
    out.w = lerp(this.w[seg], this.w[seg + 1], t);
    out.dx = ex / len; out.dz = ez / len;
    return out;
  }

  // ---- Terrain & vertical profile ---------------------------------------
  base(x, z) {
    const st = this.stage, n = this.noise;
    const big = fbm(n, x / st.hillScale, z / st.hillScale, 4) * st.hillHeight;
    const mid = fbm(this.noise2, x / 140, z / 140, 3) * st.hillHeight * 0.18;
    const ridge = st.ridged ? (1 - Math.abs(n(x / 900 + 7.1, z / 900 - 3.3))) ** 2 * st.hillHeight * 0.9 : 0;
    return big + mid + ridge;
  }

  buildProfile() {
    const n = this.n, st = this.stage;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = this.base(this.x[i], this.z[i]);
    // Smooth: the road follows the land, but softly.
    const win = Math.round(st.profileSmooth / STEP);
    const sm = new Float32Array(n);
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? raw : sm.slice();
      let acc = 0, cnt = 0;
      for (let i = -win; i < n + win; i++) {
        const add = i + win, rem = i - win - 1;
        if (add >= 0 && add < n) { acc += src[add]; cnt++; }
        if (rem >= 0 && rem < n) { acc -= src[rem]; cnt--; }
        if (i >= 0 && i < n) sm[i] = acc / cnt;
      }
    }
    // Grade limit.
    const maxG = st.maxGrade * STEP;
    for (let i = 1; i < n; i++) sm[i] = clamp(sm[i], sm[i - 1] - maxG, sm[i - 1] + maxG);
    for (let i = n - 2; i >= 0; i--) sm[i] = clamp(sm[i], sm[i + 1] - maxG, sm[i + 1] + maxG);
    // Features on straights: crests, jumps, dips and water splashes.
    const r = rng(st.seed + 7);
    this.features = [];
    const straights = [];
    let prevEnd = this.start + 40;
    for (const c of this.corners) { if (c.s - prevEnd > 70) straights.push([prevEnd, c.s]); prevEnd = c.end; }
    if (this.finish - prevEnd > 70) straights.push([prevEnd, this.finish - 30]);
    for (const [a, b] of straights) {
      const len = b - a;
      if (r() > st.featureRate) continue;
      const roll = r();
      const at = a + len * r.range(0.35, 0.7);
      if (roll < st.jumpRate && len > 120) {
        this.features.push({ type: 'jump', s: at, h: r.range(2.2, 3.4), wUp: 24, wDown: 9, big: len > 200 });
      } else if (r() < st.splashRate) {
        this.features.push({ type: 'splash', s: at, h: -1.6, w: 26 });
      } else if (roll < 0.75) {
        this.features.push({ type: 'crest', s: at, h: r.range(1.6, 3.2), w: r.range(24, 40) });
      } else {
        this.features.push({ type: 'dip', s: at, h: -r.range(1.2, 2.2), w: r.range(18, 30) });
      }
    }
    // Crests inside fast corners too (over crest calls mid-corner).
    for (const c of this.corners) {
      if ((c.grade === 'flat' || c.grade === 'easy') && r() < st.featureRate * 0.35)
        this.features.push({ type: 'crest', s: c.s + (c.end - c.s) * 0.4, h: r.range(1.2, 2.2), w: 26, inCorner: true });
    }
    this.features.sort((a, b) => a.s - b.s);
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      let y = sm[i];
      for (const f of this.features) {
        const d = s - f.s;
        if (f.type === 'jump') {
          // Ramp up to a sharp lip, then a steep drop: the car takes off.
          if (d > -f.wUp && d < 0) y += f.h * Math.sin((d / f.wUp + 1) * Math.PI / 2) ** 2;
          else if (d >= 0 && d < f.wDown * 4) y += f.h * Math.max(0, 1 - d / (f.wDown * 4)) ** 1.6;
        } else if (f.type === 'splash' || f.type === 'dip' || f.type === 'crest') {
          if (Math.abs(d) < f.w) y += f.h * 0.5 * (1 + Math.cos(Math.PI * d / f.w));
        }
      }
      this.y[i] = y;
    }
    for (const f of this.features) if (f.type === 'splash') f.water = this.y[Math.round(f.s / STEP)] + 0.32;
    // Terrain can't use `base` raw around the road; it's blended in `height`.
  }

  // Height of the ground (road, verges or terrain) at any world point.
  height(x, z, q = this.nearest(x, z, 64, this._hq || (this._hq = {}))) {
    const b = this.base(x, z);
    if (q.i < 0) return b;
    const d = q.d, hw = q.w;
    let near;
    const edge = this.stage.edge;
    if (d < hw) near = q.y - 0.06 * (d / hw) ** 2;
    else {
      const e = d - hw;
      near = q.y - 0.06;
      if (edge === 'snowbank') near += 1.25 * smoothstep(0, 2.2, e) * (1 - smoothstep(3.5, 7, e)) - 0.3 * smoothstep(5, 9, e);
      else if (edge === 'ditch') near += 0.08 * (1 - smoothstep(0, 0.9, e)) * smoothstep(0, 0.3, e) - 0.55 * smoothstep(0.8, 2.4, e) * (1 - smoothstep(2.6, 4.5, e));
      else if (edge === 'verge') near -= 0.12 * smoothstep(0, 3, e);
      else if (edge === 'berm') near += 0.25 * smoothstep(0, 1.2, e) * (1 - smoothstep(1.6, 3.5, e));
    }
    const t = smoothstep(hw + 4.5, hw + 4.5 + this.stage.blend, d);
    return lerp(near, b, t);
  }

  normal(x, z, out) {
    const e = 0.35;
    const hL = this.height(x - e, z), hR = this.height(x + e, z), hD = this.height(x, z - e), hU = this.height(x, z + e);
    const nx = hL - hR, nz = hD - hU, ny = 2 * e;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  // Surface name under a point, given its nearest-road query.
  surface(q) {
    if (q.i < 0) return this.stage.offroad;
    const e = q.d - q.w;
    if (e < 0) {
      for (const f of this.features) if (f.type === 'splash' && Math.abs(q.s - f.s) < f.w * 0.55) return 'water';
      if (this.stage.surface === 'snow' && this.iceAt(q.s)) return 'ice';
      return this.stage.surface;
    }
    if (e < 1.2) return this.stage.verge;
    return this.stage.offroad;
  }
  iceAt(s) { return Math.sin(s * 0.011 + this.stage.seed) > 0.86; }

  // Point & frame at distance s along the road.
  frameAt(s, out = {}) {
    const f = clamp(s / STEP, 0, this.n - 1.001);
    const i = Math.floor(f), t = f - i;
    out.x = lerp(this.x[i], this.x[i + 1], t);
    out.z = lerp(this.z[i], this.z[i + 1], t);
    out.y = lerp(this.y[i], this.y[i + 1], t);
    const dh = this.hdg[i + 1] - this.hdg[i];
    out.h = this.hdg[i] + dh * t;
    out.w = lerp(this.w[i], this.w[i + 1], t);
    out.k = lerp(this.k[i], this.k[i + 1], t);
    out.dx = Math.sin(out.h); out.dz = Math.cos(out.h);
    out.rx = -Math.cos(out.h); out.rz = Math.sin(out.h); // right-hand side
    return out;
  }

  // ---- Pace notes ---------------------------------------------------------
  buildNotes() {
    const notes = [];
    const feats = this.features;
    const r = rng(this.stage.seed + 31);
    this.hazards = []; // rocks/stumps at apexes for "don't cut"
    const cs = this.corners;
    for (let ci = 0; ci < cs.length; ci++) {
      const c = cs[ci];
      const words = [`${c.grade}_${c.dir > 0 ? 'right' : 'left'}`];
      const deg = c.ang * 180 / Math.PI;
      const prev = cs[ci - 1];
      const straightIn = prev ? c.s - prev.end : c.s;
      const g = gradeIndex[c.grade];
      let caution = false;
      if (g >= 4 && straightIn > 240) caution = true;
      for (const f of feats) if ((f.type === 'jump' || f.type === 'crest') && c.s - f.s > 0 && c.s - f.s < 60 && g >= 2) caution = true;
      if (c.mod === 'tightens' && g >= 2) caution = true;
      if (caution) words.unshift('caution');
      if (g < 5) {
        if (deg > 120) words.push('very_long');
        else if (deg > 85 && g <= 3) words.push('long');
      }
      if (c.mod) words.push(c.mod);
      // In-corner crest
      for (const f of feats) if (f.inCorner && f.s > c.s && f.s < c.end) words.push('over_crest');
      if (g >= 2 && g <= 4 && r() < 0.32) {
        words.push('dont_cut');
        const apex = (c.s + c.end) / 2;
        this.hazards.push({ s: apex, side: c.dir, type: 'rock' });
      } else if (g >= 3 && r() < 0.15) {
        words.push('keep_in');
        this.hazards.push({ s: (c.s + c.end) / 2, side: -c.dir, type: 'trees' });
      }
      notes.push({ s: c.s, end: c.end, words, corner: c, grade: c.grade, dir: c.dir });
    }
    for (const f of feats) {
      if (f.inCorner) continue;
      const map = { jump: f.big ? 'big_jump' : 'jump', crest: 'over_crest', splash: 'water_splash', dip: 'dip' };
      const at = f.type === 'jump' ? f.s - f.wUp : f.s - (f.w || 20) * 0.6;
      notes.push({ s: at, end: f.s + 10, words: f.type === 'jump' ? ['caution', map[f.type]] : [map[f.type]], feature: f });
    }
    for (const [a] of this.narrowZones) if (a < this.finish - 60) notes.push({ s: a, end: a + 20, words: ['narrows'] });
    notes.sort((a, b) => a.s - b.s);
    // Distances to the next call after each note.
    for (let i = 0; i < notes.length; i++) {
      const nx = notes[i + 1];
      const gap = (nx ? nx.s : this.finish) - notes[i].end;
      notes[i].gap = gap;
      if (gap >= 85) {
        const dist = gap < 125 ? 'd100' : gap < 175 ? 'd150' : gap < 250 ? 'd200' : gap < 350 ? 'd300' : gap < 450 ? 'd400' : 'd500';
        notes[i].words.push(dist);
      }
      notes[i].into = nx && gap < 30;
    }
    this.notes = notes;
  }

  // Sensible maximum speed (m/s) at distance s — used by the AI and the HUD.
  adviseSpeed(s, mu) {
    let v = 60;
    for (const c of this.corners) {
      if (c.end < s - 5) continue;
      if (c.s > s + 260) break;
      const vc = Math.sqrt(mu * 9.81 * (c.mod === 'tightens' ? c.R * 0.55 : c.R)) * 0.9 + 1;
      const dist = Math.max(0, c.s - s);
      v = Math.min(v, Math.sqrt(vc * vc + 2 * mu * 7.2 * dist));
    }
    for (const f of this.features) {
      let cap = 0, at = f.s;
      if (f.type === 'splash') { cap = 16; at = f.s - f.w * 0.6; }
      else if (f.type === 'jump') { cap = f.big ? 31 : 28; at = f.s - f.wUp; }
      else if (f.type === 'dip') { cap = 30; at = f.s - f.w; }
      else if (f.type === 'crest') {
        // Blind crest with a bend just after it: lift.
        if (this.corners.some((c) => c.s > f.s && c.s - f.s < 70)) { cap = 26; at = f.s - f.w * 0.5; }
      }
      if (!cap) continue;
      const dist = at - s;
      if (dist > -25 && dist < 220) v = Math.min(v, Math.sqrt(cap * cap + 2 * mu * 7 * Math.max(0, dist)));
    }
    return v;
  }
}
