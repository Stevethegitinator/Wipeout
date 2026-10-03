// Builds the renderable world for a circuit: road, barriers, tunnels, pads,
// gantries, supports, terrain, sky and themed scenery.
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './builder.js';
import { psxMaterial, renderStyle } from './psx.js';
import { THEMES } from './data.js';
import { LANES } from './trackdata.js';
import * as TX from './textures.js';

const WALL_H = 2.6;
const TUNNEL_H = 10;
const LAMP_EVERY = 24;

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function buildWorld(track) {
  const def = track.def;
  const theme = THEMES[def.theme];
  const group = new THREE.Group();
  const N = track.N;
  const rng = rngFrom(def.music.seed * 97 + 5);
  const night = theme.night;
  const v = (i, lat, h) => track.pointAt(i, lat, h);

  // Per-section brightness: lamp pools, darker tunnels with strip lights.
  const light = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const d = Math.min(i % LAMP_EVERY, LAMP_EVERY - (i % LAMP_EVERY));
    const bump = Math.max(0, 1 - d / 4);
    let l = night ? 0.55 + 0.45 * bump : 0.88 + 0.12 * bump;
    l *= 0.94 + 0.06 * ((i * 7919) % 13) / 13;
    if (track.tunnel[i]) l = i % 6 < 2 ? 1.0 : 0.45;
    light[i] = l;
  }

  // ---- Road surface -------------------------------------------------------
  const roadMaps = renderStyle.modern ? { normalMap: TX.surfaceMaps('road').normal, roughnessMap: TX.surfaceMaps('road').rough } : {};
  const roadIn = new MeshBuilder(), roadEdge = new MeshBuilder(), under = new MeshBuilder();
  for (let i = 0; i < N; i++) {
    if (track.gap[i]) continue;
    const j = track.wrap(i + 1);
    const lw0 = track.width[i] / LANES, lw1 = track.width[j] / LANES;
    const v0 = (i * track.spacing) / lw0, v1 = ((i + 1) * track.spacing) / lw0;
    const c0 = light[i], c1 = light[j];
    for (let L = 0; L < LANES; L++) {
      const a = v(i, -track.width[i] / 2 + L * lw0, 0), b = v(i, -track.width[i] / 2 + (L + 1) * lw0, 0);
      const c = v(j, -track.width[j] / 2 + (L + 1) * lw1, 0), d = v(j, -track.width[j] / 2 + L * lw1, 0);
      const flip = L === LANES - 1;
      const u0 = flip ? 1 : 0, u1 = flip ? 0 : 1;
      const bld = L === 0 || L === LANES - 1 ? roadEdge : roadIn;
      // baked ambient occlusion: darker where the road meets the barrier
      const ao = 0.72;
      const ca = L === 0 ? c0 * ao : c0, cb = L === LANES - 1 ? c0 * ao : c0;
      const cc = L === LANES - 1 ? c1 * ao : c1, cd = L === 0 ? c1 * ao : c1;
      bld.quad(a, b, c, d, [u0, v0, u1, v0, u1, v1, u0, v1], [ca, cb, cc, cd]);
    }
    // underside and skirts
    const wi = track.width[i] / 2, wj = track.width[j] / 2;
    under.quad(v(i, wi, -1.5), v(i, -wi, -1.5), v(j, -wj, -1.5), v(j, wj, -1.5), [0, 0, 1, 0, 1, 1, 0, 1], [0.6, 0.6, 0.6, 0.6]);
    for (const s of [-1, 1]) {
      under.quad(v(i, s * wi, 0), v(i, s * wi, -1.5), v(j, s * wj, -1.5), v(j, s * wj, 0), [0, 0, 0, 1, 1, 1, 1, 0], [0.8, 0.6, 0.6, 0.8]);
    }
  }
  const side = THREE.DoubleSide;
  group.add(roadIn.build(psxMaterial({ map: TX.roadTexture(false, theme.accent), vertexColors: true, side, rough: 0.55, metal: 0.25, ...roadMaps })));
  group.add(roadEdge.build(psxMaterial({ map: TX.roadTexture(true, theme.accent), vertexColors: true, side, rough: 0.55, metal: 0.25, ...roadMaps })));
  group.add(under.build(psxMaterial({ map: TX.underTexture(), vertexColors: true, side })));

  // ---- Barriers and tunnels ----------------------------------------------
  const wall = new MeshBuilder(), roof = new MeshBuilder();
  for (let i = 0; i < N; i++) {
    if (track.gap[i]) continue;
    const j = track.wrap(i + 1);
    const u0 = (i * track.spacing) / 8, u1 = ((i + 1) * track.spacing) / 8;
    const tun = track.tunnel[i] || track.tunnel[j];
    const c0 = light[i] * 0.95, c1 = light[j] * 0.95;
    for (const s of [-1, 1]) {
      const wi = s * track.width[i] / 2, wj = s * track.width[j] / 2;
      wall.quad(v(i, wi, 0), v(j, wj, 0), v(j, wj, WALL_H), v(i, wi, WALL_H),
        [u0, 1, u1, 1, u1, 0, u0, 0], [c0 * 0.7, c1 * 0.7, c1, c0]);
      if (tun) {
        const ri = s * (track.width[i] / 2 - 4), rj = s * (track.width[j] / 2 - 4);
        roof.quad(v(i, wi, WALL_H), v(j, wj, WALL_H), v(j, wj, 7), v(i, wi, 7),
          [0, 0, 1, 0, 1, 0.5, 0, 0.5], [c0 * 0.6, c1 * 0.6, c1 * 0.7, c0 * 0.7]);
        roof.quad(v(i, wi, 7), v(j, wj, 7), v(j, rj, TUNNEL_H), v(i, ri, TUNNEL_H),
          [0, 0.5, 1, 0.5, 1, 1, 0, 1], [c0 * 0.7, c1 * 0.7, c1, c0]);
        // outer shell
        roof.quad(v(i, wi * 1.02 + s, 0), v(j, wj * 1.02 + s, 0), v(j, wj * 1.02 + s, 8), v(i, wi * 1.02 + s, 8),
          [0, 0, 1, 0, 1, 1, 0, 1], [0.5, 0.5, 0.7, 0.7]);
      } else {
        // lip on top of the barrier
        const oi = s * (track.width[i] / 2 + 1.2), oj = s * (track.width[j] / 2 + 1.2);
        wall.quad(v(i, wi, WALL_H), v(j, wj, WALL_H), v(j, oj, WALL_H + 0.3), v(i, oi, WALL_H + 0.3),
          [u0, 0, u1, 0, u1, 0.1, u0, 0.1], [c0 * 0.6, c1 * 0.6, c1 * 0.6, c0 * 0.6]);
      }
    }
    if (tun) {
      const ri = track.width[i] / 2 - 4, rj = track.width[j] / 2 - 4;
      roof.quad(v(i, -ri, TUNNEL_H), v(j, -rj, TUNNEL_H), v(j, rj, TUNNEL_H), v(i, ri, TUNNEL_H),
        [0, (i % 6) / 6, 1, (i % 6) / 6, 1, (i % 6 + 1) / 6, 0, (i % 6 + 1) / 6], [c0, c1, c1, c0]);
      const wi = track.width[i] / 2 + 2, wj = track.width[j] / 2 + 2;
      roof.quad(v(i, -wi, 8), v(j, -wj, 8), v(j, wj, 12), v(i, wi, 12), [0, 0, 1, 0, 1, 1, 0, 1], [0.6, 0.6, 0.8, 0.8]);
    }
  }
  group.add(wall.build(psxMaterial({ map: TX.wallTexture(theme.accent, theme.accent2), vertexColors: true, side, rough: 0.5, metal: 0.3, normalMap: renderStyle.modern ? TX.surfaceMaps('wall').normal : null })));
  if (!roof.empty) group.add(roof.build(psxMaterial({ map: TX.roofTexture(night), vertexColors: true, side, glow: 0.9 })));

  // ---- Speed and weapon pads ---------------------------------------------
  const padSpeed = new MeshBuilder(), padWeapon = new MeshBuilder();
  for (const p of track.pads) {
    const bld = p.type === 'speed' ? padSpeed : padWeapon;
    for (let k = 0; k < p.length; k++) {
      const i = track.wrap(p.section + k), j = track.wrap(i + 1);
      const lwI = track.width[i] / LANES, lwJ = track.width[j] / LANES;
      const l0 = -track.width[i] / 2 + p.lane * lwI + 0.5, l1 = l0 + lwI - 1;
      const m0 = -track.width[j] / 2 + p.lane * lwJ + 0.5, m1 = m0 + lwJ - 1;
      const va = k / p.length, vb = (k + 1) / p.length;
      bld.quad(v(i, l0, 0.06), v(i, l1, 0.06), v(j, m1, 0.06), v(j, m0, 0.06), [0, 1 - va, 1, 1 - va, 1, 1 - vb, 0, 1 - vb]);
    }
  }
  if (!padSpeed.empty) group.add(padSpeed.build(psxMaterial({ map: TX.speedPadTexture(), vertexColors: true, side, affine: false, glow: 1.6 })));
  if (!padWeapon.empty) group.add(padWeapon.build(psxMaterial({ map: TX.weaponPadTexture(), vertexColors: true, side, affine: false, glow: 1.6 })));

  // ---- Guide lights: glowing edge strips and corner chevrons ------------------
  const strip = new MeshBuilder(), chev = new MeshBuilder();
  for (let i = 0; i < N; i++) {
    if (track.gap[i]) continue;
    const j = track.wrap(i + 1);
    for (const s of [-1, 1]) {
      const a0 = s * (track.width[i] / 2 - 0.1), a1 = s * (track.width[i] / 2 - 0.5);
      const b0 = s * (track.width[j] / 2 - 0.1), b1 = s * (track.width[j] / 2 - 0.5);
      strip.quad(v(i, a1, 0.05), v(i, a0, 0.05), v(j, b0, 0.05), v(j, b1, 0.05));
      if (!track.tunnel[i]) {
        const o0 = s * (track.width[i] / 2 + 0.05), o1 = s * (track.width[j] / 2 + 0.05);
        strip.quad(v(i, o0, WALL_H - 0.25), v(j, o1, WALL_H - 0.25), v(j, o1, WALL_H - 0.05), v(i, o0, WALL_H - 0.05));
      }
    }
  }
  for (let i = 0; i < N; i += 5) {
    if (track.gap[i]) continue;
    const k = track.curvature[i];
    if (Math.abs(k) < 0.0055) continue;
    const s = k > 0 ? 1 : -1; // board on the outside wall of the corner
    const j = track.wrap(i + 1);
    const li = s * (track.width[i] / 2 - 0.08), lj = s * (track.width[j] / 2 - 0.08);
    chev.quad(v(i, li, 0.3), v(j, lj, 0.3), v(j, lj, WALL_H - 0.35), v(i, li, WALL_H - 0.35), [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  group.add(strip.build(psxMaterial({ color: new THREE.Color(night ? theme.accent2 : theme.accent), side, glow: night ? 2.2 : 1.2 })));
  if (!chev.empty) group.add(chev.build(psxMaterial({ map: TX.chevronTexture('#ffd020'), side, affine: false, glow: 1.4 })));

  // ---- Structures: gantries, lamps, supports ------------------------------
  const steel = new MeshBuilder();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const m4 = new THREE.Matrix4(), basis = new THREE.Matrix4();
  const place = (i, lat, h, sx, sy, sz, color) => {
    i = track.wrap(i);
    const P = track.pointAt(i, lat, h);
    basis.makeBasis(track.R[i], track.U[i], track.T[i].clone().negate());
    m4.copy(basis).setPosition(P).multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
    steel.addGeometry(box, m4, color);
  };
  const banners = [];
  const gantry = (i, texture) => {
    const w = track.width[track.wrap(i)] / 2 + 1.5;
    for (const s of [-1, 1]) place(i, s * w, 7, 1.2, 14, 1.2, 0.7);
    place(i, 0, 13.6, w * 2 + 1.2, 1.2, 1.4, 0.6);
    const bld = new MeshBuilder();
    const ii = track.wrap(i);
    for (const off of [-0.8, 0.8]) {
      const a = track.pointAt(ii, -w + 1, 10.5).addScaledVector(track.T[ii], off);
      const b = track.pointAt(ii, w - 1, 10.5).addScaledVector(track.T[ii], off);
      const c = track.pointAt(ii, w - 1, 13).addScaledVector(track.T[ii], off);
      const d = track.pointAt(ii, -w + 1, 13).addScaledVector(track.T[ii], off);
      // readable from the approach side (off < 0) and from behind
      if (off < 0) bld.quad(a, b, c, d, [0, 0, 1, 0, 1, 1, 0, 1]);
      else bld.quad(b, a, d, c, [0, 0, 1, 0, 1, 1, 0, 1]);
    }
    banners.push(bld.build(psxMaterial({ map: texture, side, affine: false, glow: 0.7 })));
  };
  gantry(0, TX.bannerTexture('START', '#ffffff', '#101014'));
  gantry(-40, TX.bannerTexture(def.name, theme.accent, '#101014'));
  const adEvery = Math.floor(N / 6);
  for (let k = 1; k < 6; k++) {
    const i = k * adEvery + 7;
    if (track.tunnel[track.wrap(i)]) continue;
    gantry(i, TX.adTexture(Math.floor(rng() * TX.BRAND_COUNT)));
  }
  // Jump warnings: a gantry ahead of each kicker and a glowing lip line.
  const lip = new MeshBuilder();
  for (const j of track.jumps) {
    gantry(j.section - 35, TX.bannerTexture(j.gap ? 'GAP AHEAD' : 'JUMP', '#ffd020', '#101014'));
    for (const k of [1, 3]) {
      const i = track.wrap(j.section - k), i2 = track.wrap(i + 1);
      const w = track.width[i] / 2 - 0.5, w2 = track.width[i2] / 2 - 0.5;
      const a = v(i, -w, 0.07), b = v(i, w, 0.07);
      const c = v(i, w, 0.07).lerp(v(i2, w2, 0.07), 0.3), d = v(i, -w, 0.07).lerp(v(i2, -w2, 0.07), 0.3);
      lip.quad(a, b, c, d);
    }
  }
  if (!lip.empty) group.add(lip.build(psxMaterial({ color: 0xffc020, side, glow: 1.2 })));

  // Grandstands along the start straight, with a crowd painted on each tier.
  const crowd = new MeshBuilder();
  for (let i = N - 70; i < N - 6; i++) {
    const ii = track.wrap(i), jj = track.wrap(i + 1);
    if (track.gap[ii]) continue;
    for (const sd of [-1, 1]) {
      for (let t = 0; t < 6; t++) {
        const l0 = sd * (track.width[ii] / 2 + 7 + t * 2.2), l1 = sd * (track.width[jj] / 2 + 7 + t * 2.2);
        const h0 = t * 1.7, h1 = h0 + 1.7;
        const q = [v(ii, l0, h0), v(jj, l1, h0), v(jj, l1, h1), v(ii, l0, h1)];
        crowd.quad(q[0], q[1], q[2], q[3], [0, 0, 1, 0, 1, 1, 0, 1], [0.9, 0.9, 1, 1]);
      }
      if (i % 4 === 0) {
        place(ii, sd * (track.width[ii] / 2 + 7 + 6.6), 3.5, 13.2, 7, 4.2, 0.45);
        place(ii, sd * (track.width[ii] / 2 + 13), 14, 0.6, 7, 0.6, 0.5);
        place(ii, sd * (track.width[ii] / 2 + 10), 17.6, 9, 0.4, 4.4, 0.6);
      }
    }
  }
  group.add(crowd.build(psxMaterial({ map: TX.crowdTexture(), vertexColors: true, side })));

  // Roadside billboards and footbridges.
  const boards = new MeshBuilder();
  for (let k = 0; k < 8; k++) {
    const i = track.wrap(Math.floor((k + 0.5) * N / 8));
    if (track.gap[i] || track.tunnel[i]) continue;
    const sd = k % 2 ? 1 : -1, lat = sd * (track.width[i] / 2 + 16);
    place(i, lat, 6, 0.8, 12, 0.8, 0.5);
    const c = track.pointAt(i, lat, 15);
    const r = track.R[i].clone().multiplyScalar(9), u = new THREE.Vector3(0, 3.5, 0);
    const f = track.T[i].clone().multiplyScalar(-0.5);
    boards.quad(c.clone().sub(r).sub(u).add(f), c.clone().add(r).sub(u).add(f), c.clone().add(r).add(u).add(f), c.clone().sub(r).add(u).add(f));
    place(i, lat, 15, 18.6, 7.6, 0.6, 0.3);
  }
  if (!boards.empty) group.add(boards.build(psxMaterial({ map: TX.adTexture(Math.floor(rng() * TX.BRAND_COUNT)), side, glow: 0.6 })));
  for (const f of [0.3, 0.68]) {
    const i = track.wrap(Math.floor(f * N));
    if (track.gap[i] || track.tunnel[i]) continue;
    const w = track.width[i] / 2;
    for (const sd of [-1, 1]) place(i, sd * (w + 6), 9, 2.5, 22, 2.5, 0.55);
    place(i, 0, 19, w * 2 + 16, 2, 4, 0.6);
    place(i, 0, 21.2, w * 2 + 16, 0.3, 4, 0.8);
  }

  banners.forEach((b) => group.add(b));

  const glows = [];
  for (let i = 0; i < N; i += LAMP_EVERY) {
    if (track.gap[i]) continue;
    if (track.tunnel[i]) continue;
    const s = (i / LAMP_EVERY) % 2 ? 1 : -1;
    const w = track.width[i] / 2 + 2.2;
    place(i, s * w, 4.5, 0.5, 9, 0.5, 0.55);
    place(i, s * (w - 1.6), 9, 3.6, 0.4, 0.8, 0.55);
    glows.push(track.pointAt(i, s * (w - 3), 8.6));
  }
  const groundY = track.minY - 26;
  for (let i = 0; i < N; i += 16) {
    if (track.gap[i]) continue;
    const P = track.P[i];
    const hgt = P.y - 1.5 - groundY;
    if (hgt < 4) continue;
    place(i, 0, -1.5 - hgt / 2, 4, hgt, 3, 0.5);
  }
  group.add(steel.build(psxMaterial({ vertexColors: true, lit: true, color: 0x9aa0aa, rough: 0.4, metal: 0.6 }), true));

  // Glow sprites for lamps and barrier lights.
  const glowTex = TX.glowTexture();
  const addPoints = (pts, color, size) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.PointsMaterial({ map: glowTex, color, size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    group.add(new THREE.Points(g, m));
  };
  const gk = renderStyle.modern ? 0.45 : 1;
  addPoints(glows, night ? 0xfff0c0 : 0xffffff, (night ? 9 : 4) * gk);
  if (night) {
    const edge = [];
    for (let i = 0; i < N; i += 3) {
      if (track.gap[i]) continue;
      if (track.tunnel[i]) continue;
      for (const s of [-1, 1]) edge.push(track.pointAt(i, s * (track.width[i] / 2 + 0.4), WALL_H + 0.5));
    }
    addPoints(edge, new THREE.Color(theme.accent2), 2.2 * gk);
  }

  // ---- Terrain -----------------------------------------------------------
  const samples = [];
  for (let i = 0; i < N; i += 3) samples.push(track.P[i]);
  const distToTrack = (x, z) => {
    let best = Infinity;
    for (const p of samples) {
      const dx = p.x - x, dz = p.z - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const b = track.bounds;
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const size = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) + 2400;
  const G = 72;
  const hillSeed = rng() * 100;
  const terrainH = (x, z, d) => {
    const n = Math.sin(x * 0.004 + hillSeed) * Math.cos(z * 0.005 - hillSeed) + 0.5 * Math.sin(x * 0.011 + z * 0.009);
    const rise = Math.max(0, Math.min(1, (d - 60) / 260));
    const amp = def.theme === 'city' ? 8 : def.theme === 'desert' ? 50 : 90;
    return groundY + rise * (n + 1.2) * amp;
  };
  const terrain = new MeshBuilder();
  const hmap = [];
  for (let gz = 0; gz <= G; gz++) for (let gx = 0; gx <= G; gx++) {
    const x = cx - size / 2 + (gx / G) * size, z = cz - size / 2 + (gz / G) * size;
    const d = distToTrack(x, z);
    hmap.push(new THREE.Vector3(x, terrainH(x, z, d), z));
  }
  const H = (gx, gz) => hmap[gz * (G + 1) + gx];
  const tscale = 1 / 40;
  const snowline = groundY + 70;
  const shade = (p, k) => {
    let c = 0.75 + 0.25 * Math.sin(k * 12.9898) ** 2;
    if (def.theme === 'alpine' && p.y > snowline) c = 1.25;
    return c;
  };
  for (let gz = 0; gz < G; gz++) for (let gx = 0; gx < G; gx++) {
    const a = H(gx, gz), bb = H(gx + 1, gz), c = H(gx + 1, gz + 1), d = H(gx, gz + 1);
    const k = gz * G + gx;
    terrain.quad(a, d, c, bb,
      [a.x * tscale, a.z * tscale, d.x * tscale, d.z * tscale, c.x * tscale, c.z * tscale, bb.x * tscale, bb.z * tscale],
      [shade(a, k), shade(d, k + 1), shade(c, k + 2), shade(bb, k + 3)]);
  }
  group.add(terrain.build(psxMaterial({ map: TX.groundTexture(theme.ground), vertexColors: true, side, rough: theme.ground === 'ice' ? 0.25 : 0.9, normalMap: renderStyle.modern ? TX.surfaceMaps('ground').normal : null, normalScale: 0.8 })));
  const groundAt = (x, z) => terrainH(x, z, distToTrack(x, z));

  // ---- Sky dome and horizon ----------------------------------------------
  const sky = new THREE.SphereGeometry(4000, 16, 12);
  const sc = [];
  const [top, mid, hor] = theme.sky.map((c) => new THREE.Color(c));
  const tmp = new THREE.Color();
  for (let i = 0; i < sky.attributes.position.count; i++) {
    const y = sky.attributes.position.getY(i) / 4000;
    if (y > 0.25) tmp.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
    else tmp.copy(hor).lerp(mid, Math.max(0, y / 0.25));
    sc.push(tmp.r, tmp.g, tmp.b);
  }
  sky.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  const skyMesh = new THREE.Mesh(sky, psxMaterial({ vertexColors: true, fog: false, side: THREE.BackSide, depthWrite: false }));
  skyMesh.renderOrder = -10;
  skyMesh.frustumCulled = false;

  const skyGroup = new THREE.Group();
  skyGroup.add(skyMesh);

  // Drifting cloud layer overhead, and low mist lying in the valleys.
  const cloudTex = TX.cloudTexture(night);
  cloudTex.repeat.set(5, 5);
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(Math.PI / 2),
    psxMaterial({ map: cloudTex, transparent: true, alpha: night ? 0.5 : 0.85, fog: false, side, depthWrite: false }));
  clouds.position.y = 650;
  clouds.renderOrder = -8.5;
  clouds.frustumCulled = false;
  skyGroup.add(clouds);
  let mist = null;
  if (def.theme !== 'city') {
    const mistTex = TX.cloudTexture(false);
    mistTex.repeat.set(3, 3);
    mist = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      psxMaterial({ map: mistTex, transparent: true, alpha: night ? 0.18 : 0.3, side, depthWrite: false, color: theme.fog }));
    mist.scale.set(size, 1, size);
    mist.position.set(cx, groundY + 14, cz);
    mist.renderOrder = 2;
    group.add(mist);
  }
  const mtn = new MeshBuilder();
  const mCol = new THREE.Color(theme.mountains);
  const capCol = def.theme === 'alpine' || def.theme === 'arctic' ? new THREE.Color(0xe8f0ff) : mCol.clone().multiplyScalar(1.3);
  const baseCol = mCol.clone().lerp(hor, 0.35);
  const M = 48;
  for (let k = 0; k < M; k++) {
    const a0 = (k / M) * Math.PI * 2, a1 = ((k + 1) / M) * Math.PI * 2, am = (a0 + a1) / 2;
    const R = 3000, h = 250 + rng() * (def.theme === 'city' ? 150 : 650);
    const p0 = new THREE.Vector3(Math.cos(a0) * R, -200, Math.sin(a0) * R);
    const p1 = new THREE.Vector3(Math.cos(a1) * R, -200, Math.sin(a1) * R);
    const pk = new THREE.Vector3(Math.cos(am) * R * 0.97, h, Math.sin(am) * R * 0.97);
    mtn.tri(p0, p1, pk, undefined, [baseCol, baseCol, h > 600 ? capCol : mCol]);
  }
  const mtnMesh = mtn.build(psxMaterial({ vertexColors: true, fog: false, side, depthWrite: false }));
  mtnMesh.renderOrder = -9;
  mtnMesh.frustumCulled = false;
  skyGroup.add(mtnMesh);

  if (def.theme === 'arctic') {
    const aur = new MeshBuilder();
    const g1 = new THREE.Color(0x30ff9a), g2 = new THREE.Color(0x8a40ff), k0 = new THREE.Color(0);
    for (let k = 0; k < 40; k++) {
      const a0 = -0.6 + k * 0.05, a1 = a0 + 0.05;
      const r0 = 2500 + Math.sin(k * 0.5) * 300, r1 = 2500 + Math.sin((k + 1) * 0.5) * 300;
      const p = (a, r, y) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      aur.quad(p(a0, r0, 700), p(a1, r1, 700), p(a1, r1, 1500), p(a0, r0, 1500), undefined, [g1, g1, k0, k0]);
      aur.quad(p(a0, r0 - 50, 500), p(a1, r1 - 50, 500), p(a1, r1 - 50, 900), p(a0, r0 - 50, 900), undefined, [k0, k0, g2, g2]);
    }
    const am = aur.build(psxMaterial({ vertexColors: true, additive: true, fog: false, side }));
    am.renderOrder = -8; am.frustumCulled = false;
    skyGroup.add(am);
  }
  if (night) {
    const stars = [];
    for (let k = 0; k < 400; k++) {
      const a = rng() * Math.PI * 2, e = 0.15 + rng() * 1.3;
      stars.push(new THREE.Vector3(Math.cos(a) * Math.cos(e) * 3500, Math.sin(e) * 3500, Math.sin(a) * Math.cos(e) * 3500));
    }
    const sg = new THREE.BufferGeometry().setFromPoints(stars);
    const sp = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, fog: false, depthWrite: false }));
    sp.renderOrder = -9.5; sp.frustumCulled = false;
    skyGroup.add(sp);
  }

  // ---- Themed scenery ----------------------------------------------------
  buildScenery(group, track, def.theme, rng, distToTrack, groundAt, night, cx, cz, size);

  return { group, skyGroup, theme, clouds, mist };
}

function buildScenery(group, track, theme, rng, distToTrack, groundAt, night, cx, cz, size) {
  const lit = new MeshBuilder();
  const win = new MeshBuilder();
  const m = new THREE.Matrix4();
  const pick = (minD, maxD, tries = 40) => {
    for (let t = 0; t < tries; t++) {
      const x = cx + (rng() - 0.5) * size * 0.8, z = cz + (rng() - 0.5) * size * 0.8;
      const d = distToTrack(x, z);
      if (d > minD && d < maxD) return [x, z];
    }
    return null;
  };
  const cone = new THREE.ConeGeometry(1, 1, 6, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 7, 1);
  const boxG = new THREE.BoxGeometry(1, 1, 1);
  const col = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

  if (theme === 'alpine') {
    for (let k = 0; k < 520; k++) {
      const p = pick(30, 700); if (!p) continue;
      const [x, z] = p; const y = groundAt(x, z); const s = 0.7 + rng() * 0.8;
      m.makeScale(1.2 * s, 5 * s, 1.2 * s).setPosition(x, y + 2.5 * s, z);
      lit.addGeometry(cyl, m, col(0x5a3a22));
      for (let t = 0; t < 3; t++) {
        const r = (5 - t * 1.4) * s;
        m.makeScale(r, 7 * s, r).setPosition(x, y + (7 + t * 4) * s, z);
        lit.addGeometry(cone, m, col(t === 2 ? 0xdde8ee : 0x2f5a34, 0.9 + rng() * 0.2));
      }
    }
    for (let k = 0; k < 60; k++) {
      const p = pick(40, 800); if (!p) continue;
      const [x, z] = p; const s = 6 + rng() * 14;
      const g = new THREE.DodecahedronGeometry(1, 0);
      m.makeRotationY(rng() * 6).scale(new THREE.Vector3(s, s * 0.7, s)).setPosition(x, groundAt(x, z), z);
      lit.addGeometry(g, m, col(0x7a7a80));
    }
  } else if (theme === 'city') {
    for (let k = 0; k < 220; k++) {
      const p = pick(45, 900); if (!p) continue;
      const [x, z] = p; const d = distToTrack(x, z);
      const w = 20 + rng() * 40, dpt = 20 + rng() * 40, h = 30 + rng() * (d > 200 ? 260 : 110);
      const y = groundAt(x, z);
      m.makeRotationY(Math.floor(rng() * 4) * Math.PI / 2 + 0.1).scale(new THREE.Vector3(w, h, dpt)).setPosition(x, y + h / 2, z);
      const g = boxG.clone();
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 16, uv.getY(i) * h / 32);
      win.addGeometry(g, m, 0.85 + rng() * 0.3);
      if (rng() < 0.3) {
        m.makeScale(1, 40, 1).setPosition(x, y + h + 20, z);
        lit.addGeometry(boxG, m, col(0xff2a8a, 2));
      }
    }
  } else if (theme === 'desert') {
    for (let k = 0; k < 70; k++) {
      const p = pick(50, 900); if (!p) continue;
      const [x, z] = p; const r = 20 + rng() * 50, h = 30 + rng() * 90;
      const y = groundAt(x, z);
      for (let t = 0; t < 3; t++) {
        m.makeScale(r * (1 - t * 0.12), h / 3, r * (1 - t * 0.12)).setPosition(x, y + h / 6 + t * h / 3, z);
        lit.addGeometry(cyl, m, col(t % 2 ? 0xb8683e : 0xa0552e));
      }
    }
    for (let k = 0; k < 160; k++) {
      const p = pick(25, 600); if (!p) continue;
      const [x, z] = p; const s = 2 + rng() * 6;
      m.makeRotationY(rng() * 6).scale(new THREE.Vector3(s, s * 0.6, s)).setPosition(x, groundAt(x, z), z);
      lit.addGeometry(new THREE.DodecahedronGeometry(1, 0), m, col(0x8a5030));
    }
  } else if (theme === 'arctic') {
    const shard = new THREE.ConeGeometry(1, 1, 4, 1);
    for (let k = 0; k < 260; k++) {
      const p = pick(30, 800); if (!p) continue;
      const [x, z] = p; const s = 4 + rng() * 14, h = s * (2 + rng() * 3);
      m.makeRotationFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, rng() * 6, (rng() - 0.5) * 0.5))
        .scale(new THREE.Vector3(s, h, s)).setPosition(x, groundAt(x, z) + h * 0.4, z);
      lit.addGeometry(shard, m, col(rng() < 0.5 ? 0x9ad8ff : 0xc8f0ff));
    }
  }
  if (!lit.empty) group.add(lit.build(psxMaterial({ vertexColors: true, lit: true, side: THREE.DoubleSide }), true));
  if (!win.empty) group.add(win.build(psxMaterial({ map: TX.windowTexture(night), vertexColors: true, glow: night ? 0.9 : 0, rough: 0.3, metal: 0.4 })));
}
