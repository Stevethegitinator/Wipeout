// Rallies, stages, cars and rival crews. All names are fictional.

const GR = (flat, easy, medium, hard, square, hairpin) => [flat, easy, medium, hard, square, hairpin];

export const STAGES = [
  {
    id: 'harrow', rally: 'Rally of the Moors', country: 'GB', name: 'Harrowmoor Forest', seed: 1201, length: 4300,
    surface: 'gravel', verge: 'loose', offroad: 'grass', edge: 'ditch', width: 7.0, heading: 0.3,
    grades: GR(2, 4, 5, 4, 2, 0.6), straight: [6, 70], longStraight: 0.12,
    hillScale: 700, hillHeight: 70, ridged: false, profileSmooth: 70, maxGrade: 0.09, blend: 36,
    featureRate: 0.65, jumpRate: 0.25, splashRate: 0.22,
    trees: { kind: 'pine', density: 1.0, near: 6.5 }, grass: 1.0, rocks: 0.5,
    sky: { elev: 24, azim: 140, turb: 5.5, cloud: 0.55 }, hdri: 'forest', envInt: 0.9, sunInt: 3.1,
    fog: { color: 0xb9c6cf, density: 0.0021 }, grade: { sat: 1.03, contrast: 1.06, tint: [1.0, 1.0, 1.02] },
    palette: { road: 0x8a7b68, grass: 0x4f6b2c, dirt: 0x6b5a45, rock: 0x77746c, needle: 0x2c4a2a },
    weather: 'clear', dust: 0x9c8a72, mud: 0x5a4632,
  },
  {
    id: 'lakes', rally: 'Thousand Lakes Rally', country: 'FI', name: 'Kuusijärvi Ridge', seed: 3307, length: 4700,
    surface: 'gravel', verge: 'loose', offroad: 'grass', edge: 'berm', width: 7.6, heading: -0.5,
    grades: GR(4, 5, 4, 2.4, 0.8, 0.2), straight: [15, 120], longStraight: 0.25,
    hillScale: 520, hillHeight: 58, ridged: false, profileSmooth: 46, maxGrade: 0.11, blend: 30,
    featureRate: 0.95, jumpRate: 0.55, splashRate: 0.05,
    trees: { kind: 'mixed', density: 1.0, near: 6 }, grass: 1.1, rocks: 0.6,
    sky: { elev: 14, azim: 250, turb: 3.2, cloud: 0.35 }, hdri: 'sunrise', envInt: 1.15, sunInt: 3.6,
    fog: { color: 0xd8c4a8, density: 0.0016 }, grade: { sat: 1.08, contrast: 1.08, tint: [1.05, 1.0, 0.94] },
    palette: { road: 0xa48e6d, grass: 0x5e7a33, dirt: 0x86704f, rock: 0x86827a, needle: 0x2e4d2a },
    weather: 'clear', dust: 0xc4ad88, mud: 0x6a5536,
  },
  {
    id: 'corse', rally: 'Rallye des Cols', country: 'FR', name: 'Col de Varenne', seed: 5519, length: 4100,
    surface: 'tarmac', verge: 'dirt', offroad: 'dirt', edge: 'verge', width: 7.4, heading: 1.0,
    grades: GR(1, 3, 4, 5, 3, 1.4), straight: [5, 55], longStraight: 0.06,
    hillScale: 600, hillHeight: 150, ridged: true, profileSmooth: 40, maxGrade: 0.1, blend: 22,
    featureRate: 0.25, jumpRate: 0.0, splashRate: 0.0,
    trees: { kind: 'maquis', density: 0.7, near: 7 }, grass: 0.7, rocks: 1.6, walls: true,
    sky: { elev: 48, azim: 200, turb: 2.4, cloud: 0.2 }, hdri: 'sky', envInt: 1.0, sunInt: 3.8,
    fog: { color: 0xc6d6e6, density: 0.0011 }, grade: { sat: 1.1, contrast: 1.08, tint: [1.02, 1.0, 0.98] },
    palette: { road: 0x3d3d40, grass: 0x6c7a3a, dirt: 0x8e7d60, rock: 0x9a958a, needle: 0x46582c },
    weather: 'clear', dust: 0xaaa090, mud: 0x6a5a42,
  },
  {
    id: 'varm', rally: 'Winter Rally Värmland', country: 'SE', name: 'Snöberget Night', seed: 7741, length: 4400,
    surface: 'snow', verge: 'snowbank', offroad: 'deepsnow', edge: 'snowbank', width: 7.4, heading: -1.1,
    grades: GR(3, 5, 4, 3, 1.2, 0.4), straight: [12, 100], longStraight: 0.2,
    hillScale: 650, hillHeight: 55, ridged: false, profileSmooth: 60, maxGrade: 0.08, blend: 30,
    featureRate: 0.6, jumpRate: 0.35, splashRate: 0.0,
    trees: { kind: 'snowpine', density: 1.15, near: 7.5 }, grass: 0, rocks: 0.2,
    sky: { elev: -9, azim: 60, turb: 2, cloud: 0.3, night: true }, hdri: 'night', envInt: 0.32, sunInt: 0.35,
    fog: { color: 0x1c2638, density: 0.0034 }, grade: { sat: 0.95, contrast: 1.1, tint: [0.92, 0.98, 1.1] },
    palette: { road: 0xdfe6ee, grass: 0xe8eef5, dirt: 0xd0d8e2, rock: 0x5a5f66, needle: 0x22382a },
    weather: 'snow', dust: 0xf2f6ff, mud: 0xdde6f0, night: true,
  },
  {
    id: 'outback', rally: 'Red Dust Rally', country: 'AU', name: 'Mundaring Red', seed: 9133, length: 4600,
    surface: 'dirt', verge: 'loose', offroad: 'scrub', edge: 'berm', width: 8.0, heading: 0.7,
    grades: GR(3, 5, 4, 3, 1.4, 0.5), straight: [15, 120], longStraight: 0.22,
    hillScale: 800, hillHeight: 45, ridged: false, profileSmooth: 60, maxGrade: 0.08, blend: 34,
    featureRate: 0.7, jumpRate: 0.4, splashRate: 0.15,
    trees: { kind: 'gum', density: 0.55, near: 8 }, grass: 0.8, rocks: 0.8,
    sky: { elev: 38, azim: 320, turb: 4.5, cloud: 0.25 }, hdri: 'park', envInt: 0.95, sunInt: 4.2,
    fog: { color: 0xd8c3a5, density: 0.0014 }, grade: { sat: 0.98, contrast: 1.08, tint: [1.03, 1.0, 0.95] },
    palette: { road: 0xa47452, grass: 0xa09663, dirt: 0x9c6c4e, rock: 0x8c6a52, needle: 0x6b7448 },
    weather: 'clear', dust: 0xc28058, mud: 0x8a4a2a,
  },
  {
    id: 'wales', rally: 'Rally of the Moors', country: 'GB', name: 'Cwm Glas (Rain)', seed: 2417, length: 4000,
    surface: 'gravel', verge: 'loose', offroad: 'mud', edge: 'ditch', width: 7.0, heading: 2.2,
    grades: GR(2, 4, 5, 5, 2, 0.8), straight: [5, 60], longStraight: 0.08,
    hillScale: 480, hillHeight: 85, ridged: false, profileSmooth: 50, maxGrade: 0.1, blend: 28,
    featureRate: 0.75, jumpRate: 0.2, splashRate: 0.35,
    trees: { kind: 'pine', density: 1.25, near: 6 }, grass: 1.2, rocks: 0.7,
    sky: { elev: 18, azim: 100, turb: 9, cloud: 0.92 }, hdri: 'dawn', envInt: 0.55, sunInt: 1.1,
    fog: { color: 0x8c949a, density: 0.0062 }, grade: { sat: 0.86, contrast: 1.05, tint: [0.96, 1.0, 1.03] },
    palette: { road: 0x6e604f, grass: 0x405a2a, dirt: 0x4e3e2e, rock: 0x60605c, needle: 0x253f26 },
    weather: 'rain', dust: 0x5d4c3a, mud: 0x3d3022, wet: true,
  },
];

// Surface grip and drag. `peak` is the slip at which tyres grip hardest;
// loose surfaces peak late and fall away gently, which is what lets a rally
// car hang in a long, controllable slide.
export const SURFACES = {
  tarmac: { mu: 1.22, peak: 0.13, fall: 0.72, roll: 0.012, dust: 0, loose: 0, snd: 'tarmac' },
  tarmac_wet: { mu: 0.86, peak: 0.12, fall: 0.62, roll: 0.012, dust: 0, loose: 0, snd: 'wet' },
  gravel: { mu: 0.96, peak: 0.22, fall: 0.86, roll: 0.022, dust: 1, loose: 1, snd: 'gravel' },
  gravel_wet: { mu: 0.84, peak: 0.22, fall: 0.85, roll: 0.026, dust: 0.25, loose: 1, snd: 'gravel' },
  dirt: { mu: 0.92, peak: 0.24, fall: 0.86, roll: 0.022, dust: 1.4, loose: 1, snd: 'gravel' },
  loose: { mu: 0.72, peak: 0.26, fall: 0.82, roll: 0.04, dust: 1.2, loose: 1, snd: 'gravel' },
  snow: { mu: 0.8, peak: 0.2, fall: 0.88, roll: 0.024, dust: 0.9, loose: 1, snd: 'snow' },
  ice: { mu: 0.42, peak: 0.16, fall: 0.85, roll: 0.012, dust: 0.2, loose: 0.5, snd: 'snow' },
  snowbank: { mu: 0.5, peak: 0.3, fall: 0.8, roll: 0.16, dust: 1.6, loose: 1, snd: 'snow' },
  deepsnow: { mu: 0.42, peak: 0.3, fall: 0.8, roll: 0.24, dust: 1.6, loose: 1, snd: 'snow' },
  grass: { mu: 0.62, peak: 0.24, fall: 0.75, roll: 0.06, dust: 0.3, loose: 1, snd: 'grass' },
  scrub: { mu: 0.62, peak: 0.25, fall: 0.8, roll: 0.07, dust: 1.2, loose: 1, snd: 'gravel' },
  mud: { mu: 0.52, peak: 0.25, fall: 0.8, roll: 0.08, dust: 0.1, loose: 1, snd: 'mud' },
  water: { mu: 0.6, peak: 0.2, fall: 0.8, roll: 0.08, dust: 0, loose: 1, snd: 'water' },
};

// Engine torque in Nm sampled every 1000 rpm from 0.
export const CARS = [
  {
    id: 'kaizen', name: 'Kaizen R4 Turbo', cls: 'WRC · 4WD', drive: 'awd', split: 0.58, mass: 1230,
    power: 300, torque: [180, 230, 330, 430, 470, 470, 455, 420, 380], redline: 7600, idle: 950,
    gears: [3.4, 2.36, 1.79, 1.39, 1.09, 0.87], final: 4.45, cyl: 4, turbo: 1.0,
    body: 'sedan', colors: { base: 0x0d2f8f, stripe: 0xf4c430, accent: 0xffffff, rim: 0xd8b24a },
    sponsor: 'NOVA', number: 5, stats: { power: 0.85, grip: 0.85, handling: 0.82, weight: 0.6 },
    blurb: 'All-wheel-drive turbo all-rounder. Rear-biased, so it pivots on the throttle.',
  },
  {
    id: 'hornet', name: 'Hornet RS 1800', cls: 'Classic · RWD', drive: 'rwd', split: 1, mass: 1010,
    power: 245, torque: [140, 175, 205, 225, 240, 245, 240, 228, 210, 190], redline: 8800, idle: 1000,
    gears: [3.2, 2.2, 1.65, 1.3, 1.05, 0.88], final: 4.9, cyl: 4, turbo: 0,
    body: 'classic', colors: { base: 0xf2f2ee, stripe: 0x1b4fb5, accent: 0xd61f26, rim: 0xe9e9e9 },
    sponsor: 'BARRA', number: 8, stats: { power: 0.6, grip: 0.55, handling: 0.95, weight: 0.85 },
    blurb: 'Naturally aspirated, rear-drive and screaming to 8,800 rpm. Lives sideways.',
  },
  {
    id: 'brisa', name: 'Brisa S16 Kit Car', cls: 'F2 · FWD', drive: 'fwd', split: 0, mass: 960,
    power: 265, torque: [150, 185, 220, 245, 262, 270, 266, 255, 238, 215], redline: 8700, idle: 1000,
    gears: [3.3, 2.3, 1.75, 1.38, 1.12, 0.92], final: 4.7, cyl: 4, turbo: 0,
    body: 'hatch', colors: { base: 0xffffff, stripe: 0xe3262c, accent: 0x1a1a1a, rim: 0x222222 },
    sponsor: 'VOLTA', number: 14, stats: { power: 0.7, grip: 0.75, handling: 0.88, weight: 0.95 },
    blurb: 'Light front-drive kit car. Brakes late, turns in on the handbrake, pulls itself out.',
  },
  {
    id: 'torva', name: 'Torva GT-Four', cls: 'Group A · 4WD', drive: 'awd', split: 0.5, mass: 1300,
    power: 320, torque: [190, 250, 360, 460, 500, 495, 470, 430, 385], redline: 7400, idle: 900,
    gears: [3.3, 2.3, 1.75, 1.36, 1.07, 0.86], final: 4.3, cyl: 4, turbo: 1.15,
    body: 'coupe', colors: { base: 0xc8102e, stripe: 0xffffff, accent: 0x111111, rim: 0xe0e0e0 },
    sponsor: 'TAKARA', number: 3, stats: { power: 0.95, grip: 0.95, handling: 0.7, weight: 0.5 },
    blurb: 'Heavy, brutal and planted. Huge turbo lag, huge shove. Wants a firm hand.',
  },
];

// Rival crews: pace factor relative to a "par" time (lower is faster).
export const RIVALS = [
  { name: 'A. Virtanen', car: 'Torva GT-Four', pace: 0.985 },
  { name: 'C. Mackenzie', car: 'Kaizen R4 Turbo', pace: 0.992 },
  { name: 'D. Laurent', car: 'Kaizen R4 Turbo', pace: 1.0 },
  { name: 'M. Eriksson', car: 'Torva GT-Four', pace: 1.008 },
  { name: 'R. Aldana', car: 'Brisa S16 Kit Car', pace: 1.02 },
  { name: 'K. Tanaka', car: 'Kaizen R4 Turbo', pace: 1.03 },
  { name: 'P. Duval', car: 'Hornet RS 1800', pace: 1.045 },
];
