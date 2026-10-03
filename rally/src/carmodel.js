// The rally car model. The body is lofted from cross-sections (so it is
// smooth and rounded, with flared arches) and wears a livery painted in its
// UV space; windows are cut out of the paint and glazed, so you can see the
// crew inside. Paint is clear-coated, picks up dirt as the stage goes on, and
// dents where the car hits things.
import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries } from '../../vendor/addons/utils/BufferGeometryUtils.js';
import { canvas, toTexture, noiseCanvas } from './textures.js';
import { clamp, lerp, smoothstep } from './util.js';

// Body profiles: keyframes along z (rear → front), metres in car space.
// yb = underside, yl = beltline, yt = top surface, wb = body half width, wt = top half width.
const BODIES = {
  sedan: { len: 4.36, keys: [
    [-2.18, -0.22, 0.22, 0.3, 0.74, 0.7], [-1.9, -0.28, 0.26, 0.43, 0.84, 0.76], [-1.4, -0.3, 0.27, 0.46, 0.86, 0.74],
    [-1.05, -0.3, 0.27, 0.8, 0.87, 0.6], [-0.45, -0.3, 0.27, 0.88, 0.88, 0.61], [0.45, -0.3, 0.26, 0.88, 0.88, 0.61],
    [0.62, -0.3, 0.26, 0.8, 0.88, 0.64], [1.2, -0.3, 0.23, 0.37, 0.87, 0.78], [1.8, -0.3, 0.2, 0.3, 0.85, 0.78],
    [2.18, -0.22, 0.12, 0.2, 0.76, 0.7],
  ], cabin: [-1.05, 0.62], screen: [0.62, 1.2], rear: [-1.4, -1.05], spoiler: 'wing' },
  coupe: { len: 4.4, keys: [
    [-2.2, -0.22, 0.22, 0.34, 0.74, 0.7], [-1.95, -0.28, 0.26, 0.42, 0.86, 0.76], [-1.6, -0.3, 0.27, 0.5, 0.88, 0.7],
    [-0.9, -0.3, 0.27, 0.76, 0.88, 0.6], [-0.25, -0.3, 0.27, 0.86, 0.88, 0.6], [0.4, -0.3, 0.26, 0.86, 0.88, 0.6],
    [0.6, -0.3, 0.26, 0.78, 0.88, 0.64], [1.2, -0.3, 0.22, 0.34, 0.87, 0.78], [1.85, -0.3, 0.18, 0.27, 0.85, 0.78],
    [2.2, -0.22, 0.1, 0.18, 0.76, 0.7],
  ], cabin: [-1.6, 0.6], screen: [0.6, 1.2], rear: [-1.6, -0.9], spoiler: 'wing' },
  hatch: { len: 3.92, keys: [
    [-1.96, -0.22, 0.24, 0.52, 0.74, 0.62], [-1.8, -0.27, 0.27, 0.76, 0.84, 0.62], [-1.55, -0.29, 0.28, 0.88, 0.86, 0.6],
    [0.3, -0.29, 0.27, 0.9, 0.86, 0.6], [0.48, -0.29, 0.26, 0.82, 0.86, 0.63], [1.05, -0.29, 0.23, 0.38, 0.85, 0.77],
    [1.6, -0.29, 0.2, 0.3, 0.83, 0.77], [1.96, -0.22, 0.12, 0.2, 0.75, 0.68],
  ], cabin: [-1.55, 0.48], screen: [0.48, 1.05], rear: [-1.8, -1.55], spoiler: 'roof' },
  classic: { len: 4.12, keys: [
    [-2.06, -0.24, 0.2, 0.28, 0.8, 0.76], [-1.85, -0.29, 0.24, 0.34, 0.85, 0.8], [-1.25, -0.3, 0.25, 0.37, 0.85, 0.79],
    [-1, -0.3, 0.25, 0.84, 0.85, 0.68], [0.35, -0.3, 0.25, 0.86, 0.85, 0.68], [0.52, -0.3, 0.25, 0.76, 0.85, 0.7],
    [0.95, -0.3, 0.24, 0.32, 0.85, 0.8], [1.8, -0.3, 0.22, 0.28, 0.84, 0.8], [2.06, -0.24, 0.15, 0.22, 0.8, 0.76],
  ], cabin: [-1.0, 0.52], screen: [0.52, 0.95], rear: [-1.25, -1.0], spoiler: 'duck' },
};

// Half cross-section control points (u, which: function returning [x, y]).
// u values roughly follow arc length so the livery isn't stretched.
const U = [0, 0.15, 0.185, 0.235, 0.285, 0.305, 0.4, 0.43, 0.5];

export function buildCarModel(spec, wheelMounts, wheelR) {
  const body = BODIES[spec.body] || BODIES.sedan;
  const root = new THREE.Group();
  const cols = spec.colors;
  const keys = body.keys;
  const zMin = keys[0][0], zMax = keys[keys.length - 1][0];
  const wheelZ = [wheelMounts[0].z, wheelMounts[2].z];
  const prof = (z) => {
    let i = 0; while (i < keys.length - 2 && z > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1];
    const t = clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    const s = t * t * (3 - 2 * t) * 0.5 + t * 0.5;
    const p = { yb: lerp(a[1], b[1], s), yl: lerp(a[2], b[2], s), yt: lerp(a[3], b[3], s), wb: lerp(a[4], b[4], s), wt: lerp(a[5], b[5], s) };
    // Flared arches around each wheel, and the arch opening itself.
    for (const wz of wheelZ) {
      const d = Math.abs(z - wz);
      p.wb += 0.07 * (1 - smoothstep(0.35, 0.62, d));
      const arch = d < 0.47 ? Math.sqrt(1 - (d / 0.47) ** 2) : 0;
      if (arch > 0) p.yb = Math.max(p.yb, -0.19 + arch * 0.42);
    }
    // Round off the nose and tail in plan view.
    const e = Math.max(0, (Math.abs(z) - (Math.abs(z) > 0 && z > 0 ? zMax : -zMin) + 0.35) / 0.35);
    const round = Math.sqrt(Math.max(0.0, 1 - e * e * 0.55));
    p.wb *= round; p.wt *= lerp(1, round, 0.7);
    return p;
  };
  const halfSection = (z) => {
    const p = prof(z);
    const top = Math.max(p.yt, p.yl + 0.03);
    const shoulderW = lerp(p.wb * 0.97, p.wt, smoothstep(0.1, 0.45, top - p.yl) * 0.25);
    const pts = [
      [0, p.yb], [p.wb * 0.86, p.yb], [p.wb * 0.98, p.yb + 0.08], [p.wb * 1.01, lerp(p.yb, p.yl, 0.55)], [p.wb, p.yl - 0.02],
      [shoulderW, p.yl + 0.03], [p.wt, top - 0.07], [p.wt * 0.86, top - 0.005], [0, top + 0.012],
    ];
    return pts;
  };
  // ---- Body loft --------------------------------------------------------
  const NZ = 90, SUB = 3; // sub-samples between control points
  const ringU = [];
  for (let i = 0; i < U.length - 1; i++) for (let k = 0; k < SUB; k++) ringU.push(lerp(U[i], U[i + 1], k / SUB));
  ringU.push(0.5);
  const fullU = ringU.concat(ringU.slice(0, -1).reverse().map((u) => 1 - u));
  const pos = [], uvs = [];
  const catmull = (p0, p1, p2, p3, t) => {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  for (let j = 0; j <= NZ; j++) {
    const z = lerp(zMin, zMax, j / NZ);
    const cp = halfSection(z);
    const half = [];
    for (let i = 0; i < cp.length - 1; i++) {
      const p0 = cp[Math.max(0, i - 1)], p1 = cp[i], p2 = cp[i + 1], p3 = cp[Math.min(cp.length - 1, i + 2)];
      for (let k = 0; k < SUB; k++) {
        const t = k / SUB;
        half.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
      }
    }
    half.push(cp[cp.length - 1]);
    // Full ring: left side (+x) going up, then right side (-x) coming down.
    const ring = half.concat(half.slice(0, -1).reverse().map(([x, y]) => [-x, y]));
    ring.forEach(([x, y], i) => { pos.push(x, y, z); uvs.push(fullU[i], j / NZ); });
  }
  const RN = fullU.length;
  const idx = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < RN - 1; i++) {
    const a = j * RN + i, b = a + 1, c = a + RN, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // End caps (nose and tail) as fans with their own flat-shaded vertices.
  const capStart = pos.length / 3;
  for (const [j, flip] of [[0, true], [NZ, false]]) {
    const z = lerp(zMin, zMax, j / NZ);
    const p = prof(z);
    const base = pos.length / 3;
    // Caps sample a patch of plain paint reserved in the livery's corner.
    for (let i = 0; i < RN; i++) { const k = (j * RN + i) * 3; pos.push(pos[k], pos[k + 1], pos[k + 2]); uvs.push(0.99, 0.005); }
    const center = pos.length / 3;
    pos.push(0, (p.yb + p.yl) / 2, z + (flip ? -0.015 : 0.015)); uvs.push(0.99, 0.005);
    for (let i = 0; i < RN - 1; i++) {
      const a = base + i, b = a + 1;
      if (flip) idx.push(center, a, b); else idx.push(center, b, a);
    }
  }
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bodyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  bodyGeo.setIndex(idx);
  bodyGeo.computeVertexNormals();
  {
    const nrm = bodyGeo.attributes.normal;
    for (let i = capStart; i < nrm.count; i++) nrm.setXYZ(i, 0, 0, i < capStart + RN + 1 ? -1 : 1);
  }
  const basePos = Float32Array.from(pos);

  // ---- Livery ---------------------------------------------------------------
  const liv = paintLivery(spec, body, zMin, zMax);
  const dirtTex = toTexture(noiseCanvas(256, 77, 5, 5, 2.2), { srgb: false });
  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: liv.map, roughnessMap: liv.rough, metalness: 0.05, roughness: 1, clearcoat: 1, clearcoatRoughness: 0.08,
    alphaTest: 0.5, side: THREE.DoubleSide, envMapIntensity: 1.2,
  });
  const dirtU = { uDirt: { value: 0 }, uDirtCol: { value: new THREE.Color(0x6b5a45) }, tDirtN: { value: dirtTex } };
  bodyMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, dirtU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDirt; uniform vec3 uDirtCol; uniform sampler2D tDirtN; varying vec3 vLocal; float gDirt;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float n = texture2D(tDirtN, vLocal.zy * vec2(0.55, 1.1)).r * 0.6 + texture2D(tDirtN, vLocal.zx * 1.7).r * 0.4;
          float low = 1.0 - smoothstep(-0.3, 0.5, vLocal.y);
          float back = smoothstep(0.5, -2.2, vLocal.z) * 0.35;
          float amt = clamp(uDirt * 1.6 * (low * 0.9 + back + 0.15) - (1.0 - n) * 0.9 + uDirt * 0.25, 0.0, 1.0);
          gDirt = amt;
          diffuseColor.rgb = mix(diffuseColor.rgb, uDirtCol * (0.75 + 0.5 * n), amt);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, gDirt);')
      .replace('material.clearcoat = clearcoat;', 'material.clearcoat = clearcoat * (1.0 - gDirt * 0.95);');
  };
  bodyMat.customProgramCacheKey = () => 'carbody';
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  root.add(bodyMesh);
  // Glass shell: the same loft shrunk a touch, tinted and reflective.
  const glassGeo = bodyGeo.clone();
  glassGeo.scale(0.985, 0.995, 0.995);
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0f14, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.72, clearcoat: 1, envMapIntensity: 2.2, depthWrite: false });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.renderOrder = 2;
  root.add(glass);

  // ---- Interior: roll cage, seats, crew -----------------------------------
  const inner = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 });
  const cab = body.cabin;
  const cabinBox = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, cab[1] - cab[0] + 0.4), dark);
  cabinBox.position.set(0, 0.0, (cab[0] + cab[1]) / 2);
  inner.add(cabinBox);
  const cageMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.4, metalness: 0.7 });
  const roofY = prof((cab[0] + cab[1]) / 2).yt - 0.06;
  for (const x of [0.55, -0.55]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, cab[1] - cab[0], 6), cageMat);
    bar.rotation.x = Math.PI / 2; bar.position.set(x, roofY - 0.04, (cab[0] + cab[1]) / 2); inner.add(bar);
  }
  const suitCols = [cols.base, cols.stripe];
  for (const [x, i] of [[-0.36, 0], [0.36, 1]]) { // driver on the right (car's -X), co-driver left
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.15), new THREE.MeshStandardMaterial({ color: 0x1b1b22, roughness: 0.7 }));
    seat.position.set(x, 0.18, -0.25); seat.rotation.x = -0.15; inner.add(seat);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 8), new THREE.MeshStandardMaterial({ color: suitCols[i], roughness: 0.7 }));
    torso.position.set(x, 0.2, -0.12); inner.add(torso);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshPhysicalMaterial({ color: i ? 0xffffff : cols.stripe, roughness: 0.2, clearcoat: 1 }));
    helmet.position.set(x, 0.56, -0.06); inner.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 16, 8, -0.9, 1.8, 1.2, 0.6), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.05, metalness: 0.8 }));
    visor.position.copy(helmet.position); inner.add(visor);
    if (i === 0) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 18), dark);
      wheel.position.set(x, 0.33, 0.25); wheel.rotation.x = -0.4; inner.add(wheel);
    } else {
      // Co-driver's pace-note book.
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.28), new THREE.MeshStandardMaterial({ color: 0xf2f2e8 }));
      book.position.set(x, 0.3, 0.18); book.rotation.x = -0.6; inner.add(book);
    }
  }
  root.add(inner);
  root.userData.crew = inner;

  // ---- Detail parts ------------------------------------------------------------
  const blackPlastic = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 });
  const paint = new THREE.MeshPhysicalMaterial({ color: cols.base, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
  const accent = new THREE.MeshPhysicalMaterial({ color: cols.stripe, roughness: 0.35, clearcoat: 1 });
  const pf = prof(zMax - 0.05), pr = prof(zMin + 0.05);
  // Headlights: round twin lamps behind glass.
  const lampGlass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transmission: 0, metalness: 0.2, emissive: 0xfff2d8, emissiveIntensity: 0.4, clearcoat: 1 });
  const lamps = [];
  for (const sx of [1, -1]) {
    const z = zMax - 0.14;
    const p = prof(z);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 20), lampGlass);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(sx * p.wb * 0.66, p.yl - 0.06, z + 0.02);
    root.add(lamp); lamps.push(lamp);
    const lamp2 = lamp.clone(); lamp2.scale.setScalar(0.7); lamp2.position.x = sx * p.wb * 0.38; root.add(lamp2); lamps.push(lamp2);
  }
  // Grille.
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(pf.wb * 0.5, 0.12), new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.5, metalness: 0.5 }));
  grille.position.set(0, pf.yl - 0.07, zMax + 0.005); root.add(grille);
  // Front splitter & rear diffuser.
  const split = new THREE.Mesh(new THREE.BoxGeometry(pf.wb * 2.1, 0.04, 0.3), blackPlastic);
  split.position.set(0, pf.yb + 0.02, zMax - 0.1); root.add(split);
  // Tail lights.
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0.6, roughness: 0.2 });
  const tails = [];
  for (const sx of [1, -1]) {
    const z = zMin + 0.1;
    const p = prof(z);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.05), tailMat);
    t.position.set(sx * p.wb * 0.66, p.yl - 0.02, z - 0.03); root.add(t); tails.push(t);
  }
  // Mirrors.
  for (const sx of [1, -1]) {
    const z = body.screen[0] + 0.05;
    const p = prof(z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), paint);
    m.position.set(sx * (p.wb + 0.08), p.yl + 0.12, z); root.add(m);
  }
  // Rear wing / roof spoiler / ducktail.
  if (body.spoiler === 'wing') {
    const z = zMin + 0.25;
    const p = prof(z);
    const wing = new THREE.Mesh(foilGeometry(1.62, 0.32, 0.05), accent);
    wing.position.set(0, p.yt + 0.26, z); root.add(wing);
    for (const sx of [0.55, -0.55]) { const up = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.2), paint); up.position.set(sx, p.yt + 0.13, z); root.add(up); }
    for (const sx of [0.81, -0.81]) { const plate = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.38), blackPlastic); plate.position.set(sx, p.yt + 0.25, z); root.add(plate); }
  } else if (body.spoiler === 'roof') {
    const z = body.cabin[0] + 0.02;
    const p = prof(z);
    const s = new THREE.Mesh(foilGeometry(1.25, 0.32, 0.05), accent);
    s.position.set(0, p.yt + 0.02, z - 0.12); s.rotation.x = 0.25; root.add(s);
  } else {
    const z = zMin + 0.14;
    const p = prof(z);
    const s = new THREE.Mesh(new THREE.BoxGeometry(p.wb * 1.8, 0.05, 0.28), blackPlastic);
    s.position.set(0, p.yt + 0.04, z); s.rotation.x = -0.25; root.add(s);
  }
  // Roof vent and antenna.
  {
    const z = (body.cabin[0] + body.cabin[1]) / 2 + 0.3;
    const p = prof(z);
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.28), blackPlastic);
    vent.position.set(0, p.yt + 0.04, z); root.add(vent);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.5, 4), blackPlastic);
    ant.position.set(-0.3, p.yt + 0.25, z - 0.6); ant.rotation.x = -0.4; root.add(ant);
  }
  // Mud flaps behind each wheel.
  const flapMat = new THREE.MeshStandardMaterial({ map: flapTexture(spec), roughness: 0.8, side: THREE.DoubleSide });
  for (const w of wheelMounts) {
    const flap = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.32), flapMat);
    flap.position.set(w.x * 1.0, -0.36, w.z - 0.47);
    flap.rotation.y = Math.PI;
    root.add(flap);
  }
  // Night light pod across the bonnet.
  const pod = new THREE.Group();
  {
    const z = zMax - 0.32;
    const p = prof(z);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.2, 0.08), blackPlastic);
    bar.position.set(0, p.yt + 0.12, z); pod.add(bar);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 18), lampGlass);
      l.rotation.x = Math.PI / 2; l.position.set(-0.42 + i * 0.28, p.yt + 0.12, z + 0.05); pod.add(l);
      lamps.push(l);
    }
  }
  pod.visible = false;
  root.add(pod);
  // Exhaust and flame.
  const exZ = zMin + 0.02, exX = -0.45;
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 1, roughness: 0.3, side: THREE.DoubleSide }));
  exhaust.rotation.x = Math.PI / 2; exhaust.position.set(exX, pr.yb + 0.06, exZ); root.add(exhaust);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.55, 12, 1, true), new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uI: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uT, uI; varying vec2 vUv;
      void main(){ float f = (1.0 - vUv.y); float fl = 0.7 + 0.3 * sin(uT * 90.0 + vUv.y * 20.0 + vUv.x * 30.0);
        vec3 c = mix(vec3(1.0, 0.35, 0.05), vec3(0.5, 0.7, 1.0), smoothstep(0.75, 1.0, vUv.y)) * 3.0;
        gl_FragColor = vec4(c * fl, f * uI * fl); }`,
  }));
  flame.rotation.x = -Math.PI / 2;
  flame.position.set(exX, pr.yb + 0.06, exZ - 0.36);
  flame.visible = false;
  root.add(flame);
  // Wheel arch liners.
  for (const w of wheelMounts) {
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.3, 18, 1, true, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 1, side: THREE.BackSide }));
    liner.rotation.z = Math.PI / 2;
    liner.position.set(w.x * 0.92, -0.19, w.z);
    root.add(liner);
  }

  // ---- Wheels -----------------------------------------------------------------
  const wheels = wheelMounts.map((m, i) => {
    const holder = new THREE.Group(); // steering + suspension
    const spin = new THREE.Group();
    holder.add(spin);
    const tyre = new THREE.Mesh(tyreGeometry(wheelR, 0.215), tyreMaterial());
    tyre.rotation.z = Math.PI / 2;
    spin.add(tyre);
    const rim = new THREE.Mesh(rimGeometry(0.205), new THREE.MeshStandardMaterial({ color: cols.rim, metalness: 0.65, roughness: 0.3 }));
    rim.rotation.y = m.x > 0 ? Math.PI / 2 : -Math.PI / 2;
    rim.position.x = m.x > 0 ? 0.075 : -0.075;
    spin.add(rim);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.025, 24), new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.9, roughness: 0.35 }));
    disc.rotation.z = Math.PI / 2; disc.position.x = m.x > 0 ? -0.02 : 0.02;
    spin.add(disc);
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.13, 0.1), new THREE.MeshStandardMaterial({ color: 0xd8a600, roughness: 0.4 }));
    caliper.position.set(m.x > 0 ? 0.0 : 0.0, 0.1, -0.08);
    holder.add(caliper);
    holder.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    root.add(holder);
    return { holder, spin, mount: m };
  });

  // ---- Lights -------------------------------------------------------------------
  const headlights = [];
  for (const sx of [0.5, -0.5]) {
    const sl = new THREE.SpotLight(0xfff1dc, 0, 160, 0.42, 0.55, 1.4);
    sl.position.set(sx, 0.0, zMax);
    sl.target.position.set(sx * 0.6, -1.2, zMax + 20);
    root.add(sl, sl.target);
    headlights.push(sl);
  }
  // Fake lens glow sprites for bloom.
  const glowMat = new THREE.SpriteMaterial({ color: 0xfff2dd, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const glows = lamps.map((l) => { const s = new THREE.Sprite(glowMat); s.scale.setScalar(0.6); l.getWorldPosition(s.position); root.worldToLocal(s.position); s.position.z += 0.04; root.add(s); return s; });

  const api = {
    root, bodyMesh, wheels, dirtU, glass, pod,
    setDirt(v, col) { dirtU.uDirt.value = v; if (col !== undefined) dirtU.uDirtCol.value.set(col); },
    setNight(on) {
      pod.visible = on;
      headlights.forEach((h, i) => { h.intensity = on ? 260 : 0; h.angle = on ? 0.5 : 0.42; });
      lampGlass.emissiveIntensity = on ? 6 : 0.4;
      glowMat.opacity = on ? 0.9 : 0;
    },
    lights: headlights,
    setBrake(b, reverse) { tailMat.emissiveIntensity = 0.6 + b * 5; },
    setFlame(v, t) { flame.visible = v > 0.02; flame.material.uniforms.uI.value = v; flame.material.uniforms.uT.value = t; flame.scale.set(1, 0.6 + v * 0.8, 1); },
    flamePos: new THREE.Vector3(exX, pr.yb + 0.06, exZ - 0.2),
    // Pose wheels from the physics.
    pose(car) {
      car.wheels.forEach((w, i) => {
        const wv = wheels[i];
        wv.holder.position.set(w.mount.x, w.mount.y - w.len, w.mount.z);
        wv.holder.rotation.y = w.front ? w.steer : 0;
        wv.spin.rotation.x = w.angle;
      });
    },
    // Dent the panels around a local impact point.
    dent(local, amount) {
      const p = bodyGeo.attributes.position;
      const r = 0.55;
      let moved = false;
      for (let i = 0; i < p.count; i++) {
        const dx = p.getX(i) - local.x, dy = p.getY(i) - local.y, dz = p.getZ(i) - local.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > r) continue;
        const f = (1 - d / r) ** 2 * amount * 0.12;
        // Push toward the car's centre line.
        const bx = basePos[i * 3], by = basePos[i * 3 + 1], bz = basePos[i * 3 + 2];
        const cx = p.getX(i) - Math.sign(local.x || 1e-3) * f * (Math.abs(local.x) > 0.5 ? 1 : 0.2);
        const cz = p.getZ(i) - Math.sign(local.z) * f * (Math.abs(local.z) > 1.5 ? 1 : 0.15);
        // Never crumple more than 18 cm from the original panel.
        const lim = 0.18;
        p.setXYZ(i, clamp(cx, bx - lim, bx + lim), clamp(p.getY(i) - f * 0.2, by - lim, by + lim), clamp(cz, bz - lim, bz + lim));
        moved = true;
      }
      if (moved) { p.needsUpdate = true; bodyGeo.computeVertexNormals(); }
    },
    resetDents() { bodyGeo.attributes.position.array.set(basePos); bodyGeo.attributes.position.needsUpdate = true; bodyGeo.computeVertexNormals(); },
  };
  return api;
}

// ---- Parts geometry ---------------------------------------------------------
function foilGeometry(span, chord, thick) {
  const s = new THREE.Shape();
  s.moveTo(-chord / 2, 0);
  s.bezierCurveTo(-chord / 3, thick, chord / 4, thick * 1.1, chord / 2, thick * 0.2);
  s.lineTo(chord / 2, 0);
  s.bezierCurveTo(chord / 4, -thick * 0.2, -chord / 3, -thick * 0.4, -chord / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -span / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

function tyreGeometry(R, W) {
  const pts = [];
  const rIn = 0.205;
  pts.push(new THREE.Vector2(rIn, -W / 2 + 0.01));
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI / 2; pts.push(new THREE.Vector2(R - 0.045 + Math.cos(a) * 0.045, -W / 2 + 0.045 + Math.sin(a) * 0.045)); }
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; pts.push(new THREE.Vector2(R - 0.045 + Math.cos(a) * 0.045, W / 2 - 0.045 + Math.sin(a) * 0.045)); }
  pts.push(new THREE.Vector2(rIn, W / 2 - 0.01));
  const g = new THREE.LatheGeometry(pts, 40);
  return g;
}
let _tyreMat;
function tyreMaterial() {
  if (_tyreMat) return _tyreMat;
  const c = canvas(512, 128), ctx = c.getContext('2d');
  ctx.fillStyle = '#18181a'; ctx.fillRect(0, 0, 512, 128);
  // Chunky gravel tread blocks across the middle band of the lathe UVs.
  for (let x = 0; x < 512; x += 16) for (const [y0, y1] of [[44, 62], [66, 84]]) {
    ctx.fillStyle = '#0c0c0d'; ctx.fillRect(x + ((y0 > 50) ? 4 : 0), y0, 6, y1 - y0);
  }
  ctx.fillStyle = '#2a2a2c';
  ctx.font = 'bold 14px sans-serif';
  for (let x = 0; x < 512; x += 128) { ctx.fillText('GRIPTEK', x + 10, 20); ctx.fillText('GRIPTEK', x + 70, 118); }
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  // Lathe UVs: u around the axis, v along the profile.
  t.rotation = Math.PI / 2;
  _tyreMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, color: 0xffffff });
  return _tyreMat;
}

function rimGeometry(r) {
  const outer = new THREE.Shape();
  outer.absarc(0, 0, r, 0, Math.PI * 2, false);
  const spokes = 6;
  for (let i = 0; i < spokes; i++) {
    const a0 = (i / spokes) * Math.PI * 2 + 0.2, a1 = a0 + Math.PI * 2 / spokes - 0.4;
    const h = new THREE.Path();
    h.moveTo(Math.cos(a0) * r * 0.82, Math.sin(a0) * r * 0.82);
    h.absarc(0, 0, r * 0.82, a0, a1, false);
    h.lineTo(Math.cos(a1 - 0.18) * r * 0.36, Math.sin(a1 - 0.18) * r * 0.36);
    h.absarc(0, 0, r * 0.36, a1 - 0.18, a0 + 0.18, true);
    h.closePath();
    outer.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(outer, { depth: 0.04, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 24 });
  g.translate(0, 0, -0.02);
  const barrel = new THREE.CylinderGeometry(r, r, 0.17, 28, 1, true);
  barrel.rotateX(Math.PI / 2); barrel.translate(0, 0, -0.085);
  const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12);
  hub.rotateX(Math.PI / 2); hub.translate(0, 0, 0.02);
  const parts = [g, barrel, hub].map((x) => { x.deleteAttribute('uv'); return x.toNonIndexed(); });
  return mergeGeometries(parts);
}

function grilleTexture() {
  const c = canvas(128, 32), ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, 128, 32);
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1;
  for (let x = 0; x < 128; x += 5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 4, 32); ctx.stroke(); }
  for (let x = 0; x < 128; x += 5) { ctx.beginPath(); ctx.moveTo(x + 4, 0); ctx.lineTo(x, 32); ctx.stroke(); }
  return toTexture(c, { repeat: false });
}

function flapTexture(spec) {
  const c = canvas(128, 128), ctx = c.getContext('2d');
  ctx.fillStyle = '#' + new THREE.Color(spec.colors.base).getHexString(); ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#' + new THREE.Color(spec.colors.stripe).getHexString();
  ctx.font = 'italic 900 36px "Barlow Condensed", Impact, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(spec.sponsor, 64, 76);
  return toTexture(c, { repeat: false });
}

// Paints the livery in the body's UV space: U runs round the body
// (0 = underside, 0.5 = roof centre, 1 = underside), V runs tail → nose.
function paintLivery(spec, body, zMin, zMax) {
  const W = 2048, H = 1024;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const rc = canvas(W, H), rctx = rc.getContext('2d');
  const col = (h) => '#' + new THREE.Color(h).getHexString();
  const v = (z) => H * (1 - (z - zMin) / (zMax - zMin)); // canvas y (flipY)
  const u = (x) => x * W;
  const C = spec.colors;
  ctx.fillStyle = col(C.base); ctx.fillRect(0, 0, W, H);
  rctx.fillStyle = '#5a5a5a'; rctx.fillRect(0, 0, W, H); // paint roughness (clearcoat on top)
  // Underside and sills in black.
  ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, u(0.165), H); ctx.fillRect(u(0.835), 0, u(0.165), H);
  rctx.fillStyle = '#d0d0d0'; rctx.fillRect(0, 0, u(0.165), H); rctx.fillRect(u(0.835), 0, u(0.165), H);
  const sides = [[0.165, 0.3], [0.7, 0.835]];
  const both = (fn) => { fn(false); fn(true); };
  const mirror = (x0, x1, flip) => (flip ? [1 - x1, 1 - x0] : [x0, x1]);
  // Livery graphics by car.
  ctx.save();
  if (spec.id === 'kaizen') {
    // Gold flashes sweeping back along the sides, and a roof star.
    both((f) => {
      const [a, b] = mirror(0.19, 0.29, f);
      ctx.fillStyle = col(C.stripe);
      ctx.beginPath(); ctx.moveTo(u(a), v(zMax - 0.4)); ctx.lineTo(u(b), v(zMax - 0.9)); ctx.lineTo(u(b), v(zMin + 0.6)); ctx.lineTo(u(a), v(zMin + 1.4)); ctx.fill();
      ctx.fillStyle = col(C.base);
      ctx.beginPath(); ctx.moveTo(u(a), v(0.6)); ctx.lineTo(u(b), v(0.2)); ctx.lineTo(u(b), v(-0.2)); ctx.lineTo(u(a), v(0.2)); ctx.fill();
    });
    ctx.fillStyle = col(C.stripe);
    star(ctx, u(0.5), v((body.cabin[0] + body.cabin[1]) / 2), 70);
  } else if (spec.id === 'hornet') {
    // Twin racing stripes over the whole car, side stripe and red pinline.
    ctx.fillStyle = col(C.stripe);
    ctx.fillRect(u(0.455), 0, u(0.03), H); ctx.fillRect(u(0.515), 0, u(0.03), H);
    both((f) => { const [a, b] = mirror(0.255, 0.275, f); ctx.fillRect(u(a), 0, u(b) - u(a), H); ctx.fillStyle = col(C.accent); const [c0, c1] = mirror(0.278, 0.283, f); ctx.fillRect(u(c0), 0, u(c1) - u(c0), H); ctx.fillStyle = col(C.stripe); });
  } else if (spec.id === 'brisa') {
    // Red chevrons from the nose and a red roof.
    ctx.fillStyle = col(C.stripe);
    ctx.fillRect(u(0.4), v(body.cabin[1]), u(0.2), v(body.cabin[0]) - v(body.cabin[1]));
    both((f) => {
      for (let k = 0; k < 3; k++) {
        const [a, b] = mirror(0.17, 0.3, f);
        const z0 = zMax - 0.3 - k * 0.45;
        ctx.beginPath(); ctx.moveTo(u(a), v(z0)); ctx.lineTo(u(b), v(z0 - 0.5)); ctx.lineTo(u(b), v(z0 - 0.75)); ctx.lineTo(u(a), v(z0 - 0.25)); ctx.fill();
      }
    });
  } else {
    // Torva: white sweep and black lower quarter.
    both((f) => {
      const [a, b] = mirror(0.165, 0.3, f);
      ctx.fillStyle = col(C.stripe);
      ctx.beginPath(); ctx.moveTo(u(a), v(zMax)); ctx.quadraticCurveTo(u(b), v(0.5), u(b), v(zMin + 0.5)); ctx.lineTo(u(b), v(zMin)); ctx.lineTo(u(a), v(zMin)); ctx.fill();
      ctx.fillStyle = col(C.accent);
      ctx.fillRect(u(a), 0, (u(b) - u(a)) * 0.25 * (f ? -1 : 1) + (f ? u(b) - u(a) : 0), H);
    });
  }
  ctx.restore();
  // Door number roundels and sponsor names.
  const doorZ = (body.cabin[0] + body.cabin[1]) / 2 + 0.1;
  both((f) => {
    const cu = f ? 1 - 0.232 : 0.232;
    ctx.save();
    ctx.translate(u(cu), v(doorZ));
    ctx.rotate(f ? -Math.PI / 2 : Math.PI / 2);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(0, 0, 54, 50, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#111'; ctx.font = 'italic 900 70px "Barlow Condensed", Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(spec.number), 0, 4);
    ctx.restore();
    // Sponsor along the rear quarter.
    ctx.save();
    ctx.translate(u(f ? 1 - 0.232 : 0.232), v(body.cabin[0] - 0.05));
    ctx.rotate(f ? -Math.PI / 2 : Math.PI / 2);
    ctx.fillStyle = spec.id === 'brisa' ? '#111' : '#ffffff';
    ctx.font = 'italic 900 48px "Barlow Condensed", Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(spec.sponsor, 0, 0);
    ctx.restore();
    // "GRIPTEK" on the front wing.
    ctx.save();
    ctx.translate(u(f ? 1 - 0.25 : 0.25), v(zMax - 0.75));
    ctx.rotate(f ? -Math.PI / 2 : Math.PI / 2);
    ctx.fillStyle = '#ffd400'; ctx.fillRect(-70, -14, 140, 28);
    ctx.fillStyle = '#111'; ctx.font = '900 24px "Barlow Condensed", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('GRIPTEK', 0, 1);
    ctx.restore();
  });
  // Bonnet sponsor.
  ctx.save();
  ctx.translate(u(0.5), v(zMax - 0.55)); ctx.rotate(Math.PI);
  ctx.fillStyle = spec.id === 'brisa' || spec.id === 'hornet' ? col(C.stripe) : '#ffffff';
  ctx.font = 'italic 900 64px "Barlow Condensed", Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.save(); ctx.rotate(Math.PI / 2); ctx.fillText(spec.sponsor, 0, 0); ctx.restore();
  ctx.restore();
  // Panel lines: doors, bonnet and boot shut lines.
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2;
  for (const z of [body.screen[1] + 0.02, body.cabin[1] - 0.05, (body.cabin[0] + body.cabin[1]) / 2 - 0.15, body.cabin[0] + 0.1]) {
    ctx.beginPath(); ctx.moveTo(u(0.165), v(z)); ctx.lineTo(u(0.3), v(z)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(u(0.7), v(z)); ctx.lineTo(u(0.835), v(z)); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(u(0.3), v(body.screen[1] + 0.02)); ctx.lineTo(u(0.7), v(body.screen[1] + 0.02)); ctx.stroke();
  // Windows: cut out (alpha 0) so the glass shell and the crew show through.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  const pill = 0.05;
  // Side windows (between shoulder and roof edge), split by a B-pillar.
  const [c0, c1] = body.cabin;
  const bp = (c0 + c1) / 2 - 0.15;
  for (const [a, b] of [[0.316, 0.388], [0.612, 0.684]]) {
    ctx.fillRect(u(a), v(c1 - 0.16), u(b) - u(a), v(bp + 0.05) - v(c1 - 0.16));
    ctx.fillRect(u(a), v(bp - 0.05), u(b) - u(a), v(c0 + 0.2) - v(bp - 0.05));
  }
  // Windscreen and rear screen across the top.
  ctx.fillRect(u(0.39), v(body.screen[1] - 0.1), u(0.22), v(body.screen[0] + 0.03) - v(body.screen[1] - 0.1));
  ctx.fillRect(u(0.4), v(body.rear[1] - 0.05), u(0.2), v(body.rear[0] + 0.08) - v(body.rear[1] - 0.05));
  ctx.globalCompositeOperation = 'source-over';
  // Sun strip on the windscreen.
  ctx.fillStyle = '#101010'; ctx.fillRect(u(0.39), v(body.screen[0] + 0.16), u(0.22), v(body.screen[0] + 0.03) - v(body.screen[0] + 0.16));
  ctx.fillStyle = '#ffffff'; ctx.font = '900 34px "Barlow Condensed", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.save(); ctx.translate(u(0.5), v(body.screen[0] + 0.11)); ctx.rotate(Math.PI); ctx.fillText(spec.name.toUpperCase(), 0, 0); ctx.restore();
  ctx.fillStyle = col(C.base); ctx.fillRect(W - 40, H - 20, 40, 20); // plain paint for the end caps
  const map = toTexture(c, { repeat: false });
  map.anisotropy = 8;
  return { map, rough: toTexture(rc, { repeat: false, srgb: false }) };
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.fill();
}
