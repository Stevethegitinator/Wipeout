// Loads a stage's scanned surfaces (Poly Haven, CC0): road plus the three
// terrain layers, each with colour, normal and AO/roughness maps, and the
// real-world size of one tile so they repeat at true scale.
import * as THREE from '../../vendor/three.module.min.js';

const base = new URL('../assets/', import.meta.url);
let manifestP = null;
export function manifest() {
  if (!manifestP) manifestP = fetch(new URL('tex/manifest.json', base)).then((r) => r.json()).catch(() => null);
  return manifestP;
}

const loader = new THREE.TextureLoader();
const cache = new Map();
function tex(path, srgb, aniso) {
  if (cache.has(path)) return cache.get(path);
  const p = new Promise((resolve) => {
    loader.load(new URL(path, base).href, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = aniso;
      resolve(t);
    }, undefined, () => resolve(null));
  });
  cache.set(path, p);
  return p;
}

async function surface(name, info, aniso) {
  const [map, normal, arm] = await Promise.all([
    tex(`tex/${name}/diff.jpg`, true, aniso),
    tex(`tex/${name}/nor.jpg`, false, aniso),
    info.arm ? tex(`tex/${name}/arm.jpg`, false, aniso) : null,
  ]);
  if (!map) return null;
  return { name, map, normal, arm, size: info.size[0] || 2, avg: averageColor(map) };
}

// Mean colour of a texture (linear), so a scan can be used as pure detail.
function averageColor(t) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d'); g.drawImage(t.image, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch { return new THREE.Color(0.5, 0.5, 0.5); }
}

// Resolves to { road, grass, dirt, rock, hdri } or null if the scans are missing.
export async function loadStageSurfaces(stageId, renderer) {
  const m = await manifest();
  const s = m?.stages?.[stageId];
  if (!s) return null;
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const out = { hdri: s.hdri };
  await Promise.all(['road', 'grass', 'dirt', 'rock'].map(async (k) => { out[k] = await surface(s[k], m.textures[s[k]], aniso); }));
  return out.road && out.grass ? out : null;
}

// URL of a downloaded sky, if present.
export async function hdriUrl(name) {
  const m = await manifest();
  return m?.hdris?.[name] ? new URL(`hdri/${name}_1k.exr`, base).href : null;
}
