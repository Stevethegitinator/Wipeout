// Where everything beside the road goes: trees, rocks, walls, hay bales,
// marker posts, chevron boards, spectators and the start/split/finish
// gantries. Pure data (no rendering) so physics tests can use it too.
import { rng, smoothstep } from './util.js';
import { ObstacleGrid } from './car.js';

export function buildLayout(road, quality = 2) {
  const st = road.stage;
  const r = rng(st.seed + 404);
  const L = { trees: [], rocks: [], bales: [], posts: [], chevrons: [], crowds: [], walls: [], gantries: [], tape: [], cars: [], grass: [], stumps: [] };
  const obs = new ObstacleGrid(8);
  road.obstacles = obs;
  const q = {};
  const n = road.noise2;
  const treeCap = [0.45, 0.7, 1, 1.35][quality] ?? 1;
  const tdens = st.trees.density * treeCap;

  // Trees: scattered over a band either side of the road, thinning into clearings.
  const span = road.finish + 120;
  const bandFar = 165;
  const count = Math.round(span * 2 * bandFar * 0.0085 * tdens);
  for (let k = 0; k < count; k++) {
    const s = r() * span;
    const side = r.sign();
    // Bias density toward the road edge so the forest feels close.
    const d = st.trees.near + Math.pow(r(), 1.6) * bandFar;
    const f = road.frameAt(s);
    const x = f.x + f.rx * side * d + (r() - 0.5) * 6, z = f.z + f.rz * side * d + (r() - 0.5) * 6;
    road.nearest(x, z, 64, q);
    if (q.i >= 0 && q.d < q.w + st.trees.near) continue;
    const clear = n(x / 90, z / 90) + 0.25 * n(x / 25, z / 25);
    if (clear < (st.trees.kind === 'gum' ? 0.0 : -0.35)) continue; // clearings
    if (q.i >= 0 && q.s < road.start + 50 && q.d < 40) continue; // open start area
    const y = road.height(x, z, q);
    const kind = pickKind(st.trees.kind, r, x, z, n);
    const scale = kind === 'birch' ? r.range(0.8, 1.2) : r.range(0.75, 1.35);
    const t = { x, y, z, kind, scale, rot: r() * Math.PI * 2, tint: r(), lean: (r() - 0.5) * 0.08, d: q.i >= 0 ? q.d : 99 };
    L.trees.push(t);
    if (t.d < 40) obs.add({ x, z, y: y - 1, h: 30, r: 0.22 * scale + 0.12, kind: 'tree' });
  }
  // Distant forest on the hills (rendered as cheap impostors, no collisions).
  L.farTrees = [];
  const farCount = Math.round(span * 2 * 520 * 0.0032 * st.trees.density * [0.35, 0.6, 1, 1.3][quality]);
  for (let k = 0; k < farCount; k++) {
    const s = r() * (span + 400) - 200;
    const side = r.sign();
    const d = 200 + Math.pow(r(), 1.3) * 560;
    const f = road.frameAt(s);
    const x = f.x + f.rx * side * d + (r() - 0.5) * 40, z = f.z + f.rz * side * d + (r() - 0.5) * 40;
    if (n(x / 160, z / 160) < (st.trees.kind === 'gum' ? 0.05 : -0.25)) continue;
    road.nearest(x, z, 64, q);
    if (q.i >= 0 && q.d < 150) continue;
    L.farTrees.push({ x, y: road.height(x, z, q), z, kind: pickKind(st.trees.kind, r, x, z, n), scale: r.range(0.8, 1.35), tint: r() });
  }
  // Trees just past the outside of fast corners ("keep in" hazards).
  for (const h of road.hazards) {
    const f = road.frameAt(h.s);
    if (h.type === 'trees') {
      for (let j = 0; j < 5; j++) {
        const s = h.s + (j - 2) * 6;
        const g = road.frameAt(s);
        const d = g.w + 2.6 + r() * 1.5;
        const x = g.x + g.rx * h.side * d, z = g.z + g.rz * h.side * d;
        const y = road.height(x, z);
        const kind = pickKind(st.trees.kind, r, x, z, n);
        L.trees.push({ x, y, z, kind, scale: r.range(0.9, 1.2), rot: r() * 6.28, tint: r(), lean: 0, d });
        obs.add({ x, z, y: y - 1, h: 30, r: 0.3, kind: 'tree' });
      }
    } else {
      // A big rock on the inside of the apex: cut the corner and you'll hit it.
      const d = f.w + 0.9;
      const x = f.x + f.rx * h.side * d, z = f.z + f.rz * h.side * d;
      const y = road.height(x, z);
      const rad = r.range(0.7, 1.0);
      L.rocks.push({ x, y, z, r: rad, rot: r() * 6.28, hazard: true });
      obs.add({ x, z, y: y - 0.5, h: rad * 1.1, r: rad * 0.95, kind: 'rock', bouncy: true });
    }
  }
  // Rocks and boulders scattered off the road.
  const nRocks = Math.round(span / 1000 * 70 * st.rocks * treeCap);
  for (let k = 0; k < nRocks; k++) {
    const s = r() * span, side = r.sign();
    const f = road.frameAt(s);
    const d = f.w + 3 + Math.pow(r(), 2) * 60;
    const x = f.x + f.rx * side * d, z = f.z + f.rz * side * d;
    road.nearest(x, z, 64, q);
    if (q.i >= 0 && q.d < q.w + 2.5) continue;
    const y = road.height(x, z, q);
    const rad = r.range(0.3, 1.6) * (r() < 0.1 ? 2 : 1);
    L.rocks.push({ x, y, z, r: rad, rot: r() * 6.28 });
    if (q.d < 30 && rad > 0.5) obs.add({ x, z, y: y - 0.5, h: rad * 0.9, r: rad * 0.85, kind: 'rock', bouncy: true });
  }
  // Stone walls on the outside of tarmac corners.
  if (st.walls) {
    for (const c of road.corners) {
      if (r() < 0.45) continue;
      const side = -c.dir;
      const s0 = c.s - 20, s1 = c.end + 20;
      const pts = [];
      for (let s = s0; s <= s1; s += 1.2) {
        const f = road.frameAt(s);
        const d = f.w + 1.6;
        const x = f.x + f.rx * side * d, z = f.z + f.rz * side * d;
        const y = road.height(x, z);
        pts.push({ x, y, z, h: f.h });
        obs.add({ x, z, y: y - 0.5, h: 1.3, r: 0.55, kind: 'wall' });
      }
      L.walls.push(pts);
    }
  }
  // Hay bales on the outside of slow corners, chevron boards facing the car.
  for (const c of road.corners) {
    const slow = c.grade === 'hairpin' || c.grade === 'square';
    if (slow || (c.grade === 'hard' && r() < 0.5)) {
      const side = -c.dir;
      const mid = (c.s + c.end) / 2;
      for (let j = -2; j <= 2; j++) {
        const f = road.frameAt(mid + j * 3.2);
        const d = f.w + 2.0;
        const x = f.x + f.rx * side * d, z = f.z + f.rz * side * d;
        const y = road.height(x, z);
        L.bales.push({ x, y, z, h: f.h });
        obs.add({ x, z, y: y - 0.2, h: 1.2, r: 0.75, kind: 'bale', bouncy: true });
      }
      const f = road.frameAt(c.s + 4);
      // Chevron board straight ahead at the corner's entry, on the outside.
      const ax = f.x + f.dx * 16 + f.rx * side * (f.w + 3.2), az = f.z + f.dz * 16 + f.rz * side * (f.w + 3.2);
      L.chevrons.push({ x: ax, y: road.height(ax, az), z: az, h: f.h, dir: c.dir });
    }
  }
  // Marker posts every 50 m, alternating sides, with reflectors.
  for (let s = road.start + 30; s < road.finish; s += 50) {
    for (const side of [-1, 1]) {
      const f = road.frameAt(s + (side > 0 ? 25 : 0));
      const d = f.w + 1.3;
      const x = f.x + f.rx * side * d, z = f.z + f.rz * side * d;
      road.nearest(x, z, 64, q);
      if (q.d < q.w + 0.8) continue;
      L.posts.push({ x, y: road.height(x, z, q), z, h: f.h, side });
    }
  }
  // Spectators: crowds on the outside banks of slow corners and at jumps.
  const crowdSpots = [];
  for (const c of road.corners) if ((c.grade === 'hairpin' || c.grade === 'square' || c.grade === 'hard') && r() < 0.55) crowdSpots.push({ s: (c.s + c.end) / 2, side: c.dir, len: 18 });
  for (const f of road.features) if (f.type === 'jump' || f.type === 'splash') crowdSpots.push({ s: f.s + 12, side: r.sign(), len: 22 });
  crowdSpots.push({ s: road.start + 12, side: 1, len: 26 }, { s: road.start + 12, side: -1, len: 20 }, { s: road.finish + 20, side: 1, len: 30 });
  for (const spot of crowdSpots) {
    const people = [];
    const nP = Math.round(spot.len * 1.1 * (quality >= 2 ? 1 : 0.6));
    for (let k = 0; k < nP; k++) {
      const s = spot.s + (r() - 0.5) * spot.len;
      const f = road.frameAt(s);
      const d = f.w + 6 + r() * 6;
      const x = f.x + f.rx * spot.side * d, z = f.z + f.rz * spot.side * d;
      road.nearest(x, z, 64, q);
      if (q.d < q.w + 5) continue;
      people.push({ x, y: road.height(x, z, q), z, face: Math.atan2(f.x - x, f.z - z) + (r() - 0.5) * 0.8, seed: r(), h: r.range(0.92, 1.08) });
    }
    // Tape line between them and the road.
    const tape = [];
    for (let s = spot.s - spot.len / 2 - 4; s <= spot.s + spot.len / 2 + 4; s += 4) {
      const f = road.frameAt(s);
      const d = f.w + 4.5;
      const x = f.x + f.rx * spot.side * d, z = f.z + f.rz * spot.side * d;
      tape.push({ x, y: road.height(x, z), z });
    }
    L.tape.push(tape);
    L.crowds.push({ ...spot, people });
    // A parked car or two behind the crowd.
    if (r() < 0.4) {
      const f = road.frameAt(spot.s + 8);
      const d = f.w + 18;
      const x = f.x + f.rx * spot.side * d, z = f.z + f.rz * spot.side * d;
      L.cars.push({ x, y: road.height(x, z), z, h: f.h + r() * 1.5, color: r.pick([0xb03030, 0x2a5d9a, 0xe0e0d8, 0x3a6b3a, 0x202020, 0xc8a040]) });
    }
  }
  // Gantries.
  L.gantries.push({ s: road.start, kind: 'start' });
  road.splits.forEach((s, i) => L.gantries.push({ s, kind: 'split', n: i + 1 }));
  L.gantries.push({ s: road.finish, kind: 'finish' });
  L.gantries.push({ s: road.finish + 90, kind: 'stop' });
  return L;
}

function pickKind(kind, r, x, z, n) {
  if (kind === 'mixed') return n(x / 60 + 3, z / 60) > 0.15 ? 'birch' : 'pine';
  if (kind === 'maquis') return r() < 0.3 ? 'umbrella' : 'shrub';
  if (kind === 'gum') return r() < 0.75 ? 'gum' : 'shrub';
  if (kind === 'snowpine') return 'snowpine';
  return r() < 0.06 ? 'birch' : 'pine';
}

export { smoothstep };
