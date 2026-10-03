// Builds and animates the stage scenery: terrain, road, forests, grass,
// rocks, walls, spectators, banners, water splashes.
import * as THREE from '../../vendor/three.module.min.js';
import { mergeGeometries } from '../../vendor/addons/utils/BufferGeometryUtils.js';
import { rng, smoothstep, clamp } from './util.js';
import { STEP } from './road.js';
import * as TX from './textures.js';

const shared = { time: { value: 0 }, wind: { value: 1 } };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

// Adds gentle wind sway to instanced foliage/grass (height-weighted).
function addWind(mat, amp, base = 0, stiff = 2) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev && prev(sh, r);
    sh.uniforms.uTime = shared.time; sh.uniforms.uWind = shared.wind;
    sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float hgt = max(0.0, position.y - ${base.toFixed(2)});
        float bend = pow(hgt, ${stiff.toFixed(1)}) * ${amp.toFixed(4)} * uWind;
        float ph = ip.x * 0.21 + ip.z * 0.17;
        float gust = 0.6 + 0.4 * sin(uTime * 0.35 + ip.x * 0.01);
        transformed.x += (sin(uTime * 1.3 + ph) + 0.35 * sin(uTime * 3.1 + ph * 2.0 + position.z)) * bend * gust;
        transformed.z += (cos(uTime * 1.1 + ph * 1.3) * 0.6 + 0.3 * sin(uTime * 2.7 + position.x)) * bend * gust;
      }`);
  };
  mat.customProgramCacheKey = () => 'wind' + amp + base + stiff;
}

export class World {
  constructor(renderer, scene, road, layout, stage, quality) {
    this.renderer = renderer; this.scene = scene; this.road = road; this.L = layout; this.stage = stage; this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = []; // { center, meshes[] } for distance culling
    this.animated = [];
    this.waters = [];
    this.crowdMeshes = [];
    this.materials = [];
    this.culled = [];
    this.build();
  }

  build() {
    TX.setAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    this.buildTerrain();
    this.buildRoad();
    this.buildTrees();
    this.buildFarTrees();
    if (this.stage.grass > 0) this.buildGrass();
    this.buildRocks();
    this.buildProps();
    this.buildCrowds();
    this.buildGantries();
    this.buildWater();
  }

  // ---- Terrain -------------------------------------------------------------
  terrainMaterial() {
    const st = this.stage;
    const gt = TX.groundTextures(st);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: st.surface === 'snow' ? 0.55 : 0.95, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, {
        tGrass: { value: gt.grass.map }, tDirt: { value: gt.dirt.map }, tRock: { value: gt.rock.map },
        nGrass: { value: gt.grass.normal }, nDirt: { value: gt.dirt.normal }, nRock: { value: gt.rock.normal },
        tMacro: { value: gt.macro },
      });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aSplat; varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNorm;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = aSplat; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tGrass, tDirt, tRock, nGrass, nDirt, nRock, tMacro;
          varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNorm;
          vec3 splatW;
          vec3 tex3(sampler2D t, vec2 uv) { return mix(texture2D(t, uv).rgb, texture2D(t, uv * 0.27 + 0.31).rgb, 0.45); }`)
        .replace('#include <map_fragment>', `
          vec2 tuv = vWPos.xz / 3.2;
          float macro = texture2D(tMacro, vWPos.xz / 260.0).r;
          float macro2 = texture2D(tMacro, vWPos.xz / 47.0 + 0.5).r;
          vec4 sp = vSplat;
          // Break up the blend edges with noise so they don't look smeared.
          sp.y = clamp(sp.y + (macro2 - 0.5) * 0.7 * sp.y * (1.0 - sp.y) * 4.0, 0.0, 1.0);
          sp.z = clamp(sp.z + (macro2 - 0.5) * 0.6 * sp.z * (1.0 - sp.z) * 4.0, 0.0, 1.0);
          float wr = sp.z, wd = sp.y * (1.0 - wr), wg = max(0.0, 1.0 - wr - wd);
          splatW = vec3(wg, wd, wr);
          vec3 rockUV = tex3(tRock, vec2(vWPos.x + vWPos.z, vWPos.y * 1.6) / 4.0);
          vec3 col = wg * tex3(tGrass, tuv) + wd * tex3(tDirt, tuv) + wr * rockUV;
          col *= 0.72 + 0.56 * macro;
          col *= mix(1.0, 0.82 + 0.3 * macro2, 0.6);
          col = mix(col, col * vec3(1.06, 0.98, 0.86), sp.w);
          diffuseColor.rgb *= col;`)
        .replace('#include <normal_fragment_maps>', `
          vec3 nm = splatW.x * (texture2D(nGrass, tuv).xyz * 2.0 - 1.0) + splatW.y * (texture2D(nDirt, tuv).xyz * 2.0 - 1.0) + splatW.z * (texture2D(nRock, vec2(vWPos.x + vWPos.z, vWPos.y * 1.6) / 4.0).xyz * 2.0 - 1.0);
          vec3 wn = normalize(vWNorm);
          vec3 T = normalize(vec3(1.0, 0.0, 0.0) - wn * wn.x); vec3 B = normalize(cross(T, wn));
          vec3 pn = normalize(wn + (T * nm.x - B * nm.y) * 0.9);
          normal = normalize((viewMatrix * vec4(pn, 0.0)).xyz);`);
    };
    return mat;
  }

  buildTerrain() {
    const road = this.road, st = this.stage, b = road.bounds;
    const mat = this.terrainMaterial();
    this.terrainMat = mat;
    const nearPad = 420, size = 256;
    const x0 = Math.floor((b.minX - nearPad) / size) * size, x1 = Math.ceil((b.maxX + nearPad) / size) * size;
    const z0 = Math.floor((b.minZ - nearPad) / size) * size, z1 = Math.ceil((b.maxZ + nearPad) / size) * size;
    this.nearBox = { x0, x1, z0, z1 };
    // Road polyline sampled every 16 m for chunk distance tests.
    const pts = [];
    for (let s = 0; s < road.length; s += 16) { const f = road.frameAt(s); pts.push([f.x, f.z]); }
    const roadDist = (x, z) => { let m = Infinity; for (const [px, pz] of pts) m = Math.min(m, (px - x) ** 2 + (pz - z) ** 2); return Math.sqrt(m); };
    const qual = this.quality;
    for (let cx = x0; cx < x1; cx += size) for (let cz = z0; cz < z1; cz += size) {
      const d = roadDist(cx + size / 2, cz + size / 2) - size * 0.71;
      if (d > nearPad + 200) continue;
      const segs = d < 140 ? [48, 64, 80, 112][qual] : d < 320 ? [16, 20, 28, 40][qual] : 10;
      const geo = this.terrainChunk(cx, cz, size, segs, d < 70, false);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      this.group.add(mesh);
    }
    // Far terrain out to the horizon; anything under the near box is sunk out of sight.
    const far = 1024, R = 4096;
    const fx0 = Math.floor((b.minX - R) / far) * far, fx1 = Math.ceil((b.maxX + R) / far) * far;
    const fz0 = Math.floor((b.minZ - R) / far) * far, fz1 = Math.ceil((b.maxZ + R) / far) * far;
    for (let cx = fx0; cx < fx1; cx += far) for (let cz = fz0; cz < fz1; cz += far) {
      if (cx >= x0 && cx + far <= x1 && cz >= z0 && cz + far <= z1) continue;
      const geo = this.terrainChunk(cx, cz, far, 20, false, true);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = false;
      this.group.add(mesh);
    }
  }

  terrainChunk(cx, cz, size, segs, nearRoad, far) {
    const road = this.road, st = this.stage;
    const n = segs + 1, step = size / segs;
    const N = n + 2; // with a border for normals
    const H = new Float32Array(N * N), D = new Float32Array(N * N);
    const q = {};
    const nb = this.nearBox;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = cx + (i - 1) * step, z = cz + (j - 1) * step;
      let h;
      if (far) {
        h = road.base(x, z);
        if (x > nb.x0 + 1 && x < nb.x1 - 1 && z > nb.z0 + 1 && z < nb.z1 - 1) h -= 40;
        D[j * N + i] = 999;
      } else {
        road.nearest(x, z, 64, q);
        h = road.height(x, z, q);
        D[j * N + i] = q.i >= 0 ? q.d - q.w : 999;
        // Tuck the terrain just under the road surface to avoid z-fighting.
        if (q.i >= 0 && q.d < q.w + 0.6) h -= 0.14 * (1 - smoothstep(q.w - 0.3, q.w + 0.6, q.d));
      }
      H[j * N + i] = h;
    }
    const pos = [], nor = [], uv = [], spl = [], idx = [];
    const noise = road.noise2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = (j + 1) * N + (i + 1);
      const x = cx + i * step, z = cz + j * step, y = H[k];
      pos.push(x, y, z);
      const nx = H[k - 1] - H[k + 1], nz = H[k - N] - H[k + N], ny = 2 * step;
      const l = Math.hypot(nx, ny, nz);
      const NY = ny / l;
      nor.push(nx / l, NY, nz / l);
      uv.push(x / 4, z / 4);
      // Splat: grass, dirt (verges and patches), rock (steep), tint (dry).
      const e = D[k];
      const slope = 1 - NY;
      let rock = smoothstep(0.22, 0.42, slope);
      let dirt = Math.max(1 - smoothstep(0.4, 3.6, e), smoothstep(0.35, 0.75, noise(x / 30, z / 30)) * 0.7);
      if (st.surface === 'snow') { dirt = 0; rock = smoothstep(0.35, 0.6, slope); }
      if (st.surface === 'tarmac') dirt = Math.max(dirt, smoothstep(0.1, 0.5, noise(x / 60 + 3, z / 60)) * 0.6);
      const tint = smoothstep(0.0, 0.6, noise(x / 140 - 7, z / 140 + 2));
      spl.push(0, dirt, rock, tint);
    }
    for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // Skirts hide cracks between chunks of different resolution.
    const addSkirt = (list) => {
      for (let t = 0; t < list.length - 1; t++) {
        const a = list[t], b = list[t + 1];
        const base = pos.length / 3;
        for (const v of [a, b]) {
          pos.push(pos[v * 3], pos[v * 3 + 1] - (far ? 30 : 4), pos[v * 3 + 2]);
          nor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
          uv.push(uv[v * 2], uv[v * 2 + 1]);
          spl.push(spl[v * 4], spl[v * 4 + 1], spl[v * 4 + 2], spl[v * 4 + 3]);
        }
        idx.push(a, b, base, b, base + 1, base, a, base, b, b, base, base + 1);
      }
    };
    const top = [], bot = [], lef = [], rig = [];
    for (let i = 0; i < n; i++) { top.push(i); bot.push(segs * n + i); lef.push(i * n); rig.push(i * n + segs); }
    addSkirt(top); addSkirt(bot); addSkirt(lef); addSkirt(rig);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aSplat', new THREE.Float32BufferAttribute(spl, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  // ---- Road -----------------------------------------------------------------
  buildRoad() {
    const road = this.road, st = this.stage;
    const tex = TX.roadTextures(st);
    const cols = [-1, -0.9, -0.72, -0.5, -0.28, -0.1, 0, 0.1, 0.28, 0.5, 0.72, 0.9, 1];
    const pos = [], nor = [], uv = [], idx = [];
    const extra = 1.25;
    const n = road.n;
    const _n = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const f = road.frameAt(i * STEP);
      const half = f.w + extra;
      for (const c of cols) {
        const x = f.x + f.rx * c * half, z = f.z + f.rz * c * half;
        const y = road.height(x, z) + 0.035;
        road.normal(x, z, _n);
        pos.push(x, y, z); nor.push(_n.x, _n.y, _n.z);
        uv.push((c + 1) / 2, i * STEP / TX.ROAD_TEX_METRES);
      }
    }
    const m = cols.length;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < m - 1; j++) {
      const a = i * m + j, b = a + 1, c = a + m, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeTangents?.();
    const mat = new THREE.MeshStandardMaterial({
      map: tex.map, normalMap: tex.normal, roughnessMap: tex.rough, roughness: 1, metalness: 0,
      normalScale: new THREE.Vector2(1, 1), alphaTest: 0.35, alphaToCoverage: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    if (st.wet) { mat.color.setScalar(0.78); mat.envMapIntensity = 1.6; }
    // Split into pieces so off-screen road is culled.
    const per = 120 * m * 6; // ~240 m per piece
    for (let start = 0; start < idx.length; start += per) {
      const gg = g.clone();
      gg.setIndex(idx.slice(start, start + per));
      gg.computeBoundingSphere();
      // Bounding sphere of the used part only.
      const used = idx.slice(start, start + per);
      const box = new THREE.Box3();
      for (const v of used) box.expandByPoint(_p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]));
      box.getBoundingSphere(gg.boundingSphere);
      const mesh = new THREE.Mesh(gg, mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.roadMat = mat;
  }

  // ---- Vegetation -------------------------------------------------------------
  treeGeometries(kind) {
    const r = rng(kind.length * 17 + 3);
    const parts = { trunk: null, crown: null, crownFar: null, H: 14 };
    if (kind === 'pine' || kind === 'snowpine') {
      const H = 15;
      parts.H = H;
      const trunk = new THREE.CylinderGeometry(0.1, 0.32, H, 7, 1, true);
      trunk.translate(0, H / 2, 0);
      scaleUV(trunk, 1, 4);
      parts.trunk = trunk;
      const makeCrown = (layers, radial) => {
        const gs = [];
        for (let i = 0; i < layers; i++) {
          const t = i / layers;
          const y0 = H * 0.22 + t * H * 0.72;
          const rad = (1 - t) * 3.1 + 0.55;
          const h = H * 0.8 / layers * 2.0;
          const c = new THREE.ConeGeometry(rad, h, radial, 1, true);
          c.translate(0, y0 + h / 2, 0);
          // Droop the rim and jitter for an irregular silhouette.
          const p = c.attributes.position, nrm = c.attributes.normal, col = [];
          for (let v = 0; v < p.count; v++) {
            const yy = p.getY(v) - y0;
            const rr = Math.hypot(p.getX(v), p.getZ(v));
            const j = 1 + (r() - 0.5) * 0.25;
            if (rr > 0.01) { p.setX(v, p.getX(v) * j); p.setZ(v, p.getZ(v) * j); }
            if (yy < 0.2) p.setY(v, p.getY(v) - r() * 0.5);
            // Soft, rounded normals (half way to "up and out").
            const nx = p.getX(v), nz = p.getZ(v);
            const l = Math.hypot(nx, nz) || 1;
            _p.set(nx / l, 0.9, nz / l).normalize();
            nrm.setXYZ(v, _p.x, _p.y, _p.z);
            const ao = 0.55 + 0.45 * t + 0.25 * (yy / h);
            col.push(ao, ao, ao);
          }
          c.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
          gs.push(c);
        }
        return mergeGeometries(gs);
      };
      parts.crown = makeCrown(7, 11);
      parts.crownFar = makeCrown(4, 7);
      parts.foliage = kind === 'snowpine' ? 'snowneedles' : 'needles';
      parts.bark = 'pine';
    } else {
      // Broadleaf: trunk + a few branches + clustered leaf cards.
      const H = kind === 'gum' ? 17 : kind === 'birch' ? 13 : kind === 'umbrella' ? 10 : 2.4;
      parts.H = H;
      const tr = [];
      if (kind !== 'shrub') {
        const t = new THREE.CylinderGeometry(kind === 'gum' ? 0.14 : 0.1, kind === 'gum' ? 0.38 : 0.22, H * 0.8, 7, 1, true);
        t.translate(0, H * 0.4, 0); scaleUV(t, 1, 3); tr.push(t);
        for (let i = 0; i < 4; i++) {
          const bl = H * 0.3;
          const bgeo = new THREE.CylinderGeometry(0.04, 0.09, bl, 5, 1, true);
          bgeo.translate(0, bl / 2, 0);
          bgeo.rotateZ(0.6 + r() * 0.5); bgeo.rotateY(i * 1.6 + r());
          bgeo.translate(0, H * (0.45 + i * 0.08), 0);
          tr.push(bgeo);
        }
      }
      parts.trunk = tr.length ? mergeGeometries(tr) : null;
      const makeCrown = (cards) => {
        const gs = [];
        const cy = kind === 'shrub' ? 1.0 : kind === 'umbrella' ? H * 0.82 : H * 0.68;
        const rx = kind === 'umbrella' ? 4.2 : kind === 'gum' ? 3.6 : kind === 'shrub' ? 1.4 : 2.6;
        const ry = kind === 'umbrella' ? 1.0 : kind === 'shrub' ? 0.9 : H * 0.28;
        for (let i = 0; i < cards; i++) {
          const sz = kind === 'shrub' ? 1.6 : 2.6 + r() * 1.2;
          const p = new THREE.PlaneGeometry(sz, sz);
          p.rotateX((r() - 0.5) * 1.4); p.rotateY(r() * Math.PI);
          const ang = r() * Math.PI * 2, rr = Math.sqrt(r());
          const ox = Math.cos(ang) * rx * rr * 0.8, oz = Math.sin(ang) * rx * rr * 0.8, oy = cy + (r() - 0.5) * ry * 1.6;
          p.translate(ox, oy, oz);
          const nrm = p.attributes.normal, ps = p.attributes.position, col = [];
          for (let v = 0; v < ps.count; v++) {
            _p.set(ps.getX(v), (ps.getY(v) - cy) * 1.2 + 0.6, ps.getZ(v)).normalize();
            nrm.setXYZ(v, _p.x, _p.y, _p.z);
            const ao = 0.6 + 0.4 * clamp((ps.getY(v) - cy) / ry * 0.5 + 0.5, 0, 1);
            col.push(ao, ao, ao);
          }
          p.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
          gs.push(p);
        }
        return mergeGeometries(gs);
      };
      parts.crown = twoSided(makeCrown(kind === 'shrub' ? 7 : 16));
      parts.crownFar = twoSided(makeCrown(kind === 'shrub' ? 4 : 8));
      parts.cards = true;
      parts.foliage = kind === 'birch' ? 'birch' : kind === 'gum' ? 'gum' : 'shrub';
      parts.bark = kind === 'birch' ? 'birch' : kind === 'gum' ? 'gum' : 'pine';
    }
    return parts;
  }

  buildTrees() {
    const L = this.L, st = this.stage, road = this.road;
    const byKind = new Map();
    for (const t of L.trees) { let a = byKind.get(t.kind); if (!a) byKind.set(t.kind, (a = [])); a.push(t); }
    const chunkLen = 260;
    const q = {};
    for (const [kind, list] of byKind) {
      const parts = this.treeGeometries(kind);
      const ftex = TX.foliageTexture(parts.foliage);
      const bark = TX.barkTexture(parts.bark);
      const leafCol = kind === 'snowpine' ? 0xffffff : new THREE.Color(st.palette.needle).multiplyScalar(kind === 'pine' ? 1.9 : 2.2).getHex();
      const crownMat = new THREE.MeshStandardMaterial({ map: ftex, color: kind.includes('pine') ? leafCol : 0xffffff, vertexColors: true, alphaTest: 0.42, alphaToCoverage: true, side: parts.cards ? THREE.FrontSide : THREE.DoubleSide, roughness: 0.85, metalness: 0 });
      addWind(crownMat, kind === 'shrub' ? 0.05 : 0.0016, kind === 'shrub' ? 0 : 3, 2);
      const trunkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normal, roughness: 0.95 });
      const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: ftex, alphaTest: 0.42 });
      // Group instances into chunks by road distance for culling; far trees get the simpler crown.
      const buckets = new Map();
      for (const t of list) {
        road.nearest(t.x, t.z, 64, q);
        const s = q.i >= 0 ? q.s : 0;
        const far = t.d > 55;
        const key = Math.floor(s / chunkLen) * 2 + (far ? 1 : 0);
        let a = buckets.get(key); if (!a) buckets.set(key, (a = [])); a.push(t);
      }
      for (const [key, arr] of buckets) {
        const far = key % 2 === 1;
        const crown = new THREE.InstancedMesh(far ? parts.crownFar : parts.crown, crownMat, arr.length);
        crown.customDepthMaterial = depthMat;
        const trunk = parts.trunk ? new THREE.InstancedMesh(parts.trunk, trunkMat, arr.length) : null;
        const col = new THREE.Color();
        arr.forEach((t, i) => {
          _e.set(t.lean, t.rot, t.lean * 0.5);
          _q.setFromEuler(_e);
          const sc = t.scale;
          _s.set(sc, sc * (0.9 + t.tint * 0.25), sc);
          _m.compose(_p.set(t.x, t.y - 0.3, t.z), _q, _s);
          crown.setMatrixAt(i, _m);
          trunk?.setMatrixAt(i, _m);
          const v = 0.78 + t.tint * 0.4;
          col.setRGB(v * (0.95 + t.tint * 0.1), v, v * (1.02 - t.tint * 0.08));
          crown.setColorAt(i, col);
        });
        crown.castShadow = !far; crown.receiveShadow = true;
        crown.computeBoundingSphere();
        this.group.add(crown);
        this.cull(crown, far ? 900 : 650);
        if (trunk) { trunk.castShadow = !far; trunk.receiveShadow = true; trunk.computeBoundingSphere(); this.group.add(trunk); this.cull(trunk, far ? 500 : 400); }
      }
    }
  }

  // Distant forest: two crossed quads per tree, lit softly from above.
  buildFarTrees() {
    const st = this.stage, L = this.L;
    if (!L.farTrees?.length) return;
    const byKind = new Map();
    for (const t of L.farTrees) { let a = byKind.get(t.kind); if (!a) byKind.set(t.kind, (a = [])); a.push(t); }
    for (const [kind, list] of byKind) {
      const h = kind === 'pine' || kind === 'snowpine' ? 15 : kind === 'gum' ? 16 : kind === 'birch' ? 12 : kind === 'umbrella' ? 10 : 3;
      const w = h * 0.5;
      const q1 = new THREE.PlaneGeometry(w, h); q1.translate(0, h / 2 - 0.3, 0);
      const q2 = q1.clone(); q2.rotateY(Math.PI / 2);
      const g0 = mergeGeometries([q1, q2]);
      const nrm = g0.attributes.normal;
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
      const geo = twoSided(g0);
      const leaf = kind === 'snowpine' ? 0x2e4a34 : new THREE.Color(st.palette.needle).multiplyScalar(kind.includes('pine') ? 1.5 : 1.9).getHex();
      const mat = new THREE.MeshStandardMaterial({ map: TX.impostorTexture(kind, leaf), alphaTest: 0.45, alphaToCoverage: true, roughness: 0.9 });
      // Chunk spatially so frustum culling helps.
      const cells = new Map();
      for (const t of list) { const k = Math.floor(t.x / 400) * 1000 + Math.floor(t.z / 400); let a = cells.get(k); if (!a) cells.set(k, (a = [])); a.push(t); }
      const col = new THREE.Color();
      for (const arr of cells.values()) {
        const im = new THREE.InstancedMesh(geo, mat, arr.length);
        arr.forEach((t, i) => {
          _m.compose(_p.set(t.x, t.y, t.z), _q.setFromAxisAngle(_s.set(0, 1, 0), t.tint * 6.28), _s.set(t.scale, t.scale * (0.85 + t.tint * 0.3), t.scale));
          im.setMatrixAt(i, _m);
          const v = 0.75 + t.tint * 0.35; col.setRGB(v, v, v); im.setColorAt(i, col);
        });
        im.computeBoundingSphere();
        this.group.add(im);
      }
    }
  }

  buildGrass() {
    const road = this.road, st = this.stage, q = {};
    const r = rng(st.seed + 55);
    const tex = TX.grassCardTexture(st);
    const g1 = new THREE.PlaneGeometry(1.3, 0.7); g1.translate(0, 0.35, 0);
    const parts = [0, 1].map((i) => { const p = g1.clone(); p.rotateY(i * Math.PI / 2 + 0.3); return p; });
    const geo0 = mergeGeometries(parts);
    // Normals point up so clumps light like the ground they sit on.
    const nrm = geo0.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const geo = twoSided(geo0);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, alphaToCoverage: true, roughness: 0.9 });
    addWind(mat, 0.18, 0, 1.5);
    const count = Math.round(road.finish / 1000 * [4000, 7000, 11000, 16000][this.quality] * st.grass);
    const chunkLen = 90;
    const buckets = new Map();
    for (let k = 0; k < count; k++) {
      const s = r() * (road.finish + 100);
      const f = road.frameAt(s);
      const side = r.sign();
      const d = f.w + 1.6 + Math.pow(r(), 1.8) * 22;
      const x = f.x + f.rx * side * d + (r() - 0.5) * 2, z = f.z + f.rz * side * d + (r() - 0.5) * 2;
      road.nearest(x, z, 64, q);
      if (q.d < q.w + 1.2) continue;
      const y = road.height(x, z, q);
      const key = Math.floor(s / chunkLen);
      let a = buckets.get(key); if (!a) buckets.set(key, (a = [])); a.push([x, y, z, r() * 6.28, 0.6 + r() * 0.9, r()]);
    }
    const col = new THREE.Color();
    for (const arr of buckets.values()) {
      const im = new THREE.InstancedMesh(geo, mat, arr.length);
      arr.forEach(([x, y, z, rot, sc, t], i) => {
        _m.compose(_p.set(x, y - 0.05, z), _q.setFromAxisAngle(_s.set(0, 1, 0), rot), _s.set(sc, sc * (0.8 + t * 0.6), sc));
        im.setMatrixAt(i, _m);
        col.setRGB(0.8 + t * 0.35, 0.85 + t * 0.25, 0.75 + t * 0.2);
        im.setColorAt(i, col);
      });
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      this.cull(im, [90, 120, 160, 220][this.quality]);
    }
  }

  // Hide a mesh when the camera is further than `dist` from its bounds.
  cull(mesh, dist) {
    const bs = mesh.boundingSphere || mesh.geometry.boundingSphere;
    this.culled.push({ mesh, c: bs.center.clone(), r: bs.radius, d: dist });
  }

  buildRocks() {
    const L = this.L, st = this.stage;
    const gt = TX.groundTextures(st);
    const r = rng(st.seed + 12);
    const variants = [0, 1, 2].map((v) => {
      const g = new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position;
      const rr = rng(v * 31 + 7);
      const n2 = this.road.noise;
      for (let i = 0; i < p.count; i++) {
        _p.set(p.getX(i), p.getY(i), p.getZ(i));
        const k = 0.75 + 0.35 * n2(_p.x * 1.7 + v * 5, _p.z * 1.7 + _p.y) + (rr() - 0.5) * 0.08;
        _p.multiplyScalar(k);
        _p.y *= 0.62;
        if (_p.y < -0.2) _p.y = -0.2 - (_p.y + 0.2) * 0.2;
        p.setXYZ(i, _p.x, _p.y, _p.z);
      }
      g.computeVertexNormals();
      // Planar UVs for the rock texture.
      const uv = [];
      for (let i = 0; i < p.count; i++) uv.push(p.getX(i) * 0.6 + p.getZ(i) * 0.3, p.getY(i) * 0.8);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      return g;
    });
    const mat = new THREE.MeshStandardMaterial({ map: gt.rock.map, normalMap: gt.rock.normal, roughness: 0.9, color: st.surface === 'snow' ? 0xb8bcc4 : 0xffffff });
    const buckets = [[], [], []];
    L.rocks.forEach((k) => buckets[Math.floor(r() * 3)].push(k));
    buckets.forEach((arr, v) => {
      if (!arr.length) return;
      const im = new THREE.InstancedMesh(variants[v], mat, arr.length);
      arr.forEach((k, i) => {
        _m.compose(_p.set(k.x, k.y - k.r * 0.15, k.z), _q.setFromAxisAngle(_s.set(0, 1, 0), k.rot), _s.set(k.r, k.r, k.r * (0.8 + r() * 0.4)));
        im.setMatrixAt(i, _m);
      });
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    });
  }

  // ---- Trackside props --------------------------------------------------------
  buildProps() {
    const L = this.L, st = this.stage, road = this.road;
    // Marker posts: white with a red reflector band.
    if (L.posts.length) {
      const pg = new THREE.BoxGeometry(0.1, 1.1, 0.1); pg.translate(0, 0.55, 0);
      const col = [];
      const p = pg.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); const red = y > 0.82 && y < 1.0; col.push(red ? 0.9 : 0.92, red ? 0.1 : 0.92, red ? 0.08 : 0.9); }
      pg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const pm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
      const im = new THREE.InstancedMesh(pg, pm, L.posts.length);
      L.posts.forEach((k, i) => { _m.compose(_p.set(k.x, k.y - 0.05, k.z), _q.setFromAxisAngle(_s.set(0, 1, 0), k.h), _s.set(1, 1, 1)); im.setMatrixAt(i, _m); });
      im.castShadow = true; im.computeBoundingSphere();
      this.group.add(im);
    }
    // Hay bales.
    if (L.bales.length) {
      const bg = new THREE.CylinderGeometry(0.62, 0.62, 1.2, 14); bg.rotateZ(Math.PI / 2); bg.translate(0, 0.6, 0);
      const btex = strawTexture();
      const bm = new THREE.MeshStandardMaterial({ map: btex, roughness: 1, color: st.surface === 'snow' ? 0xe0e0e0 : 0xffffff });
      const im = new THREE.InstancedMesh(bg, bm, L.bales.length);
      L.bales.forEach((k, i) => { _m.compose(_p.set(k.x, k.y - 0.05, k.z), _q.setFromAxisAngle(_s.set(0, 1, 0), k.h), _s.set(1, 1, 1)); im.setMatrixAt(i, _m); });
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
      this.group.add(im);
    }
    // Chevron boards.
    const ctex = TX.chevronTexture();
    for (const c of L.chevrons) {
      const g = new THREE.Group();
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshStandardMaterial({ map: ctex, roughness: 0.4, emissive: 0x222200, side: THREE.DoubleSide }));
      board.position.y = 1.15;
      if (c.dir < 0) board.scale.x = -1;
      g.add(board);
      for (const x of [-1.1, 1.1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.08), postMat()); post.position.set(x, 0.75, -0.05); g.add(post); }
      g.position.set(c.x, c.y, c.z);
      g.rotation.y = c.h + Math.PI;
      g.traverse((o) => { o.castShadow = true; });
      this.group.add(g);
    }
    // Stone walls (tarmac stages).
    if (L.walls.length) {
      const gt = TX.groundTextures(st);
      const wm = new THREE.MeshStandardMaterial({ map: gt.rock.map, normalMap: gt.rock.normal, roughness: 0.92, color: 0xd8d0c0 });
      let total = 0; for (const w of L.walls) total += w.length;
      const geo = new THREE.BoxGeometry(1.35, 0.9, 0.7); geo.translate(0, 0.35, 0);
      const im = new THREE.InstancedMesh(geo, wm, total);
      const r = rng(st.seed + 88);
      let i = 0;
      for (const w of L.walls) for (const k of w) {
        _m.compose(_p.set(k.x, k.y, k.z), _q.setFromEuler(_e.set((r() - 0.5) * 0.05, k.h + (r() - 0.5) * 0.06, (r() - 0.5) * 0.05)), _s.set(1, 0.85 + r() * 0.3, 1));
        im.setMatrixAt(i++, _m);
      }
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
      this.group.add(im);
    }
    // Spectator tape.
    const tt = TX.tapeTexture();
    const tm = new THREE.MeshStandardMaterial({ map: tt, side: THREE.DoubleSide, roughness: 0.6 });
    const tgeos = [];
    for (const line of L.tape) {
      const pos = [], uv = [], idx = [];
      let u = 0;
      line.forEach((p, i) => {
        if (i) u += Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z) / 2;
        pos.push(p.x, p.y + 0.95, p.z, p.x, p.y + 0.85, p.z);
        uv.push(u, 0, u, 1);
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      tgeos.push(g);
      // Stakes.
      for (const p of line) { const s = new THREE.BoxGeometry(0.04, 1.0, 0.04); s.translate(p.x, p.y + 0.5, p.z); s.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(s.attributes.position.count * 2).fill(0.01), 2)); tgeos.push(s); }
    }
    if (tgeos.length) {
      const strip = mergeGeometries(tgeos.map((g) => { g.deleteAttribute('normal'); g.computeVertexNormals(); return g; }));
      const mesh = new THREE.Mesh(strip, tm);
      this.group.add(mesh);
    }
    // Parked spectator cars.
    for (const c of L.cars) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 4.2), new THREE.MeshPhysicalMaterial({ color: c.color, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.2 }));
      body.position.y = 0.65;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 2.1), new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.15, metalness: 0.4 }));
      cab.position.set(0, 1.25, -0.2);
      g.add(body, cab);
      for (const [x, z] of [[0.8, 1.3], [-0.8, 1.3], [0.8, -1.3], [-0.8, -1.3]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }));
        w.rotation.z = Math.PI / 2; w.position.set(x, 0.33, z); g.add(w);
      }
      g.position.set(c.x, c.y, c.z); g.rotation.y = c.h;
      g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      this.group.add(g);
    }
  }

  // ---- Spectators -------------------------------------------------------------
  buildCrowds() {
    const L = this.L;
    const people = [];
    for (const c of L.crowds) for (const p of c.people) people.push(p);
    if (!people.length) return;
    // Body (jacket, tinted per instance) and head+legs (shared colours).
    const torso = new THREE.CylinderGeometry(0.2, 0.24, 0.62, 8); torso.translate(0, 1.2, 0);
    const armL = new THREE.CylinderGeometry(0.06, 0.07, 0.6, 5); armL.translate(0, -0.3, 0); armL.rotateZ(0.25); armL.translate(0.25, 1.48, 0);
    const armR = armL.clone(); armR.scale(-1, 1, 1);
    const jacket = mergeGeometries([torso, armL, armR].map((g) => g.toNonIndexed()));
    // Arms are marked so the shader can raise them to wave.
    const arm = new Float32Array(jacket.attributes.position.count);
    const tc = torso.toNonIndexed().attributes.position.count, ac = armL.toNonIndexed().attributes.position.count;
    for (let i = tc; i < tc + ac; i++) arm[i] = 1;
    for (let i = tc + ac; i < tc + 2 * ac; i++) arm[i] = -1;
    jacket.setAttribute('aArm', new THREE.BufferAttribute(arm, 1));
    const head = new THREE.SphereGeometry(0.12, 10, 8); head.translate(0, 1.66, 0);
    const legs = new THREE.CylinderGeometry(0.17, 0.12, 0.9, 7); legs.translate(0, 0.45, 0);
    const hat = new THREE.CylinderGeometry(0.13, 0.13, 0.08, 10); hat.translate(0, 1.76, 0);
    const colorize = (g, c) => { const n = g.toNonIndexed(); const col = []; for (let i = 0; i < n.attributes.position.count; i++) col.push(c.r, c.g, c.b); n.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); return n; };
    const rest = mergeGeometries([colorize(head, new THREE.Color(0xd9a98a)), colorize(legs, new THREE.Color(0x2a2f3a)), colorize(hat, new THREE.Color(0x303030))]);
    const waveShader = (mat, armed) => {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = shared.time;
        sh.vertexShader = 'uniform float uTime;\nattribute float aPhase; attribute float aExcite;' + (armed ? 'attribute float aArm;' : '') + '\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float jump = max(0.0, sin(uTime * 9.0 + aPhase * 6.0)) * 0.18 * aExcite;
          transformed.y += jump + sin(uTime * 2.0 + aPhase * 9.0) * 0.015;
          ${armed ? `if (abs(aArm) > 0.5) {
            float up = aExcite * (0.5 + 0.5 * sin(uTime * 7.0 + aPhase * 5.0));
            vec3 sh0 = vec3(0.25 * aArm, 1.48, 0.0);
            vec3 d = transformed - vec3(sh0.x, sh0.y + jump, 0.0);
            float a = up * 2.6 * aArm;
            transformed = vec3(sh0.x, sh0.y + jump, 0.0) + vec3(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a), d.z);
          }` : ''}`);
      };
    };
    const jm = new THREE.MeshStandardMaterial({ roughness: 0.75 });
    waveShader(jm, true);
    const rm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    waveShader(rm, false);
    const n = people.length;
    const phase = new Float32Array(n), excite = new Float32Array(n);
    const jMesh = new THREE.InstancedMesh(jacket, jm, n), rMesh = new THREE.InstancedMesh(rest, rm, n);
    const cols = [0xd62828, 0x1d4ed8, 0xf4c430, 0x16a34a, 0xf97316, 0xffffff, 0x111111, 0x7c3aed, 0x0ea5e9, 0xe11d48];
    const col = new THREE.Color();
    people.forEach((p, i) => {
      _m.compose(_p.set(p.x, p.y - 0.05, p.z), _q.setFromAxisAngle(_s.set(0, 1, 0), p.face), _s.set(p.h, p.h, p.h));
      jMesh.setMatrixAt(i, _m); rMesh.setMatrixAt(i, _m);
      col.set(cols[Math.floor(p.seed * cols.length)]);
      jMesh.setColorAt(i, col);
      phase[i] = p.seed;
    });
    for (const m of [jMesh, rMesh]) {
      m.geometry = m.geometry.clone();
      m.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
      m.geometry.setAttribute('aExcite', new THREE.InstancedBufferAttribute(excite, 1));
      m.castShadow = true; m.receiveShadow = true;
      m.computeBoundingSphere();
      this.group.add(m);
    }
    this.crowd = { people, jMesh, rMesh, excite };
  }

  // ---- Start / split / finish -------------------------------------------------
  buildGantries() {
    const road = this.road;
    const spons = TX.sponsorBoards();
    for (const g of this.L.gantries) {
      const f = road.frameAt(g.s);
      const grp = new THREE.Group();
      const w = f.w + 2.2;
      const towerMat = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.5, metalness: 0.6 });
      if (g.kind === 'stop') {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshStandardMaterial({ map: TX.bannerTexture('STOP', '', '#d01818', '#fff', 256, 256), side: THREE.DoubleSide, emissive: 0x330000 }));
        board.position.set(w + 0.5, 1.9, 0); board.rotation.y = Math.PI;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, 0.1), postMat()); post.position.set(w + 0.5, 0.95, 0.05);
        grp.add(board, post);
      } else {
        const text = g.kind === 'start' ? 'START' : g.kind === 'finish' ? 'FLYING FINISH' : `SPLIT ${g.n}`;
        const bg = g.kind === 'start' ? '#0b6e2e' : g.kind === 'finish' ? '#d01818' : '#1b4fb5';
        const tex = TX.bannerTexture(text, this.stage.rally.toUpperCase(), bg);
        const span = w * 2;
        for (const x of [-w, w]) {
          const tower = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.4, 0.5), towerMat);
          tower.position.set(x, 2.7, 0); grp.add(tower);
          const side = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 4.0), new THREE.MeshStandardMaterial({ map: spons, roughness: 0.6 }));
          side.position.set(x, 2.4, 0.26); grp.add(side);
        }
        const banner = new THREE.Mesh(new THREE.BoxGeometry(span + 0.5, 1.3, 0.25), [towerMat, towerMat, towerMat, towerMat,
          new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 }),
          new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 })]);
        banner.position.set(0, 5.2, 0);
        banner.rotation.y = Math.PI;
        grp.add(banner);
        // Advertising boards along the road near start and finish.
        if (g.kind !== 'split') {
          for (const side of [-1, 1]) for (let k = 0; k < 6; k++) {
            const bf = road.frameAt(g.s + (k - 2.5) * 3.2);
            const bd = bf.w + 3.0;
            const b = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshStandardMaterial({ map: spons, roughness: 0.55, side: THREE.DoubleSide }));
            const v = (k * 3 + (side > 0 ? 1 : 0)) % 8;
            b.geometry = b.geometry.clone();
            const uv = b.geometry.attributes.uv;
            for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (v + (1 - uv.getY(i))) / 8);
            const x = bf.x + bf.rx * side * bd, z = bf.z + bf.rz * side * bd;
            b.position.set(x, road.height(x, z) + 0.45, z);
            b.rotation.y = bf.h + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
            this.group.add(b);
          }
        }
      }
      grp.position.set(f.x, road.height(f.x, f.z), f.z);
      grp.rotation.y = f.h;
      grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(grp);
    }
  }

  buildWater() {
    const road = this.road;
    const nt = TX.waterNormal();
    for (const f of road.features) {
      if (f.type !== 'splash') continue;
      const len = f.w * 1.25, wid = 34;
      const fr = road.frameAt(f.s);
      const mat = new THREE.MeshPhysicalMaterial({ color: 0x4a4636, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.78, normalMap: nt, normalScale: new THREE.Vector2(0.4, 0.4), clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wid, len), mat);
      m.rotation.x = -Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(m);
      holder.position.set(fr.x, f.water, fr.z);
      holder.rotation.y = fr.h;
      this.group.add(holder);
      this.waters.push({ mesh: m, tex: nt, f });
    }
  }

  update(dt, time, camPos, car) {
    shared.time.value = time;
    for (const c of this.culled) c.mesh.visible = c.c.distanceTo(camPos) - c.r < c.d;
    for (const w of this.waters) w.tex.offset.set(time * 0.03, time * 0.05);
    // Crowds get excited as the car approaches.
    if (this.crowd && car) {
      const { people, excite, jMesh, rMesh } = this.crowd;
      let changed = false;
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        const d = Math.hypot(p.x - car.pos.x, p.z - car.pos.z);
        const e = d < 70 ? 1 - d / 70 : 0;
        const target = Math.min(1, e * 1.6);
        const v = excite[i] + (target - excite[i]) * Math.min(1, dt * 3);
        if (Math.abs(v - excite[i]) > 0.002) { excite[i] = v; changed = true; }
      }
      if (changed) { jMesh.geometry.attributes.aExcite.needsUpdate = true; rMesh.geometry.attributes.aExcite.needsUpdate = true; }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) m.dispose();
    });
  }
}

// Duplicate a card mesh with reversed winding (same normals), so both faces
// light the same way instead of the back face going dark.
function twoSided(g) {
  const b = g.index ? g.toNonIndexed() : g.clone();
  const p = b.attributes.position.array;
  for (const name of Object.keys(b.attributes)) {
    const a = b.attributes[name], n = a.itemSize, arr = a.array;
    for (let i = 0; i < arr.length; i += 3 * n) for (let k = 0; k < n; k++) { const t = arr[i + n + k]; arr[i + n + k] = arr[i + 2 * n + k]; arr[i + 2 * n + k] = t; }
  }
  void p;
  return mergeGeometries([g.index ? g.toNonIndexed() : g, b]);
}
function scaleUV(g, su, sv) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); }
let _postMat;
function postMat() { return _postMat || (_postMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.6, metalness: 0.4 })); }
let _straw;
function strawTexture() {
  if (_straw) return _straw;
  const c = TX.canvas(256, 128), ctx = c.getContext('2d'), r = rng(5);
  ctx.fillStyle = '#c9a85a'; ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 1500; i++) { ctx.strokeStyle = `rgba(${150 + r() * 90},${120 + r() * 70},${50 + r() * 30},0.7)`; ctx.beginPath(); const x = r() * 256, y = r() * 128; ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 20, y + (r() - 0.5) * 6); ctx.stroke(); }
  return (_straw = TX.toTexture(c));
}

export { shared };
