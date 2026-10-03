// Static game data: teams, speed classes and circuit definitions.
// All names, liveries and circuits are original to this project.

export const TEAMS = [
  {
    id: 'kestrel', name: 'KESTREL DYNAMICS', style: 'needle',
    primary: 0xd8342c, secondary: 0xf2f2f2, accent: 0x202020,
    stats: { speed: 0.78, thrust: 0.72, handling: 0.62 },
    pilots: ['RYN OKAFOR', 'JUNO VASQUEZ'],
  },
  {
    id: 'nova', name: 'NOVA ARC', style: 'delta',
    primary: 0x1f5fd6, secondary: 0xf5c518, accent: 0x10183a,
    stats: { speed: 0.95, thrust: 0.5, handling: 0.45 },
    pilots: ['TOMAS BRANDT', 'AIKO SORENSEN'],
  },
  {
    id: 'halcyon', name: 'HALCYON MOTIVE', style: 'twin',
    primary: 0x2fae5a, secondary: 0xc8ccd2, accent: 0x1b2a22,
    stats: { speed: 0.6, thrust: 0.8, handling: 0.92 },
    pilots: ['LEV MARCHETTI', 'PRIYA DUNMORE'],
  },
  {
    id: 'orion', name: 'ORION FAUST', style: 'brick',
    primary: 0x7a2fc8, secondary: 0xff8a1c, accent: 0x1c1026,
    stats: { speed: 0.74, thrust: 0.95, handling: 0.55 },
    pilots: ['KADE SOLBERG', 'MIRA CASTELLAN'],
  },
];

export const CLASSES = [
  { name: 'CLASS I', topSpeed: [98, 124], accel: [52, 80], turn: [1.55, 2.25], aiSkill: 0.9 },
  { name: 'CLASS II', topSpeed: [132, 166], accel: [66, 104], turn: [1.7, 2.45], aiSkill: 1.0 },
];

// Circuit control points are [x, y, z]; y is height. Features use fractions of
// the lap (0..1). Lanes run 0..3 from left to right.
export const TRACKS = [
  {
    id: 'cobalt', name: 'COBALT RIDGE', location: 'NORDVIK HIGHLANDS', theme: 'alpine',
    width: 26,
    points: [
      [0, 0, 0], [0, 0, -400], [40, 10, -700], [200, 30, -900], [450, 40, -900],
      [600, 30, -750], [600, 20, -500], [480, 10, -380], [450, 0, -200], [560, -10, -50],
      [600, -10, 150], [480, 0, 330], [250, 20, 380], [80, 15, 300],
    ],
    tunnels: [[0.42, 0.5]],
    jumps: [[0.1, 6], [0.175, 0]],
    speedPads: [[0.06, 1], [0.06, 2], [0.3, 0], [0.55, 3], [0.8, 1], [0.8, 2]],
    weaponPads: [[0.14, 0], [0.14, 3], [0.36, 1], [0.36, 2], [0.62, 0], [0.62, 2], [0.88, 1], [0.88, 3]],
    music: { seed: 11, bpm: 136, root: 45 },
  },
  {
    id: 'neon', name: 'NEON BASIN', location: 'KAIHO MEGAPLEX', theme: 'city',
    width: 24,
    points: [
      [0, 0, 0], [0, 0, -300], [-80, 0, -520], [-260, 10, -600], [-420, 20, -520],
      [-460, 20, -320], [-340, 15, -200], [-300, 5, -40], [-420, 0, 120], [-400, 0, 320],
      [-220, -10, 420], [-40, -10, 380], [60, 0, 220],
    ],
    tunnels: [[0.1, 0.2], [0.66, 0.74]],
    jumps: [[0.075, 5]],
    speedPads: [[0.04, 1], [0.04, 2], [0.24, 3], [0.46, 0], [0.6, 1], [0.84, 2]],
    weaponPads: [[0.12, 0], [0.12, 3], [0.33, 1], [0.52, 2], [0.52, 3], [0.77, 0], [0.9, 1], [0.9, 2]],
    music: { seed: 23, bpm: 142, root: 41 },
  },
  {
    id: 'sable', name: 'SABLE DUNES', location: 'QASR AL-RIH', theme: 'desert',
    width: 28,
    points: [
      [0, 0, 0], [0, 5, -350], [40, 30, -480], [100, 45, -600], [350, 60, -650], [550, 30, -550],
      [620, 0, -300], [700, -10, -50], [650, 10, 200], [450, 50, 250], [320, 40, 150],
      [200, 10, 300], [40, -5, 280],
    ],
    tunnels: [[0.56, 0.62]],
    jumps: [[0.135, 0], [0.47, 7]],
    speedPads: [[0.05, 0], [0.05, 3], [0.2, 1], [0.4, 2], [0.66, 1], [0.66, 2], [0.86, 0]],
    weaponPads: [[0.1, 1], [0.1, 2], [0.28, 0], [0.28, 3], [0.5, 1], [0.74, 3], [0.92, 1], [0.92, 2]],
    music: { seed: 37, bpm: 132, root: 43 },
  },
  {
    id: 'aurora', name: 'AURORA RIFT', location: 'SVALTA ICE SHELF', theme: 'arctic',
    width: 24,
    points: [
      [0, 0, 0], [0, 0, -250], [60, 10, -450], [220, 20, -500], [330, 30, -400], [300, 40, -220],
      [380, 40, -80], [560, 30, -60], [640, 20, -240], [800, 10, -300], [900, 0, -120],
      [820, -10, 120], [600, -10, 220], [400, 0, 180], [250, 10, 300], [80, 5, 250],
    ],
    tunnels: [[0.3, 0.37], [0.78, 0.84]],
    jumps: [[0.075, 6]],
    speedPads: [[0.05, 1], [0.05, 2], [0.18, 3], [0.42, 0], [0.58, 2], [0.7, 1], [0.9, 3]],
    weaponPads: [[0.11, 0], [0.11, 3], [0.26, 1], [0.26, 2], [0.47, 3], [0.64, 0], [0.64, 1], [0.95, 2]],
    music: { seed: 53, bpm: 146, root: 38 },
  },
];

export const THEMES = {
  alpine: {
    sky: [0x3a78c8, 0x9cc4e8, 0xdfe9f0], fog: 0xb8cfe0, fogNear: 260, fogFar: 1100,
    grade: { tint: [1.0, 1.0, 1.03], sat: 1.12, contrast: 1.08 }, weather: 'snow', env: 'city', ground: 'snowgrass', accent: '#e8402c', accent2: '#ffffff', mountains: 0x6f86a8, night: false,
  },
  city: {
    sky: [0x05030f, 0x1b0f3a, 0x6a2c6e], fog: 0x2a1640, fogNear: 200, fogFar: 950,
    grade: { tint: [1.04, 0.96, 1.08], sat: 1.22, contrast: 1.12 }, weather: 'rain', env: 'night', ground: 'concrete', accent: '#ff2a8a', accent2: '#22e6ff', mountains: 0x1a1030, night: true,
  },
  desert: {
    sky: [0x3b2a6a, 0xd06a48, 0xffc27a], fog: 0xe8a070, fogNear: 260, fogFar: 1150,
    grade: { tint: [1.06, 1.0, 0.92], sat: 1.15, contrast: 1.1 }, weather: 'sand', env: 'sunset', ground: 'sand', accent: '#ffb000', accent2: '#2a2a2a', mountains: 0x9a5a48, night: false,
  },
  arctic: {
    sky: [0x020818, 0x0c2a4a, 0x2a6a7a], fog: 0x12304a, fogNear: 220, fogFar: 1000,
    grade: { tint: [0.94, 1.0, 1.08], sat: 1.1, contrast: 1.1 }, weather: 'crystals', env: 'night', ground: 'ice', accent: '#46f0c8', accent2: '#b070ff', mountains: 0x1c3a58, night: true,
  },
};

export const WEAPONS = {
  rockets: { name: 'ROCKETS', color: '#ff5a2a' },
  missile: { name: 'MISSILE', color: '#ffd02a' },
  mines: { name: 'MINES', color: '#ff2a6a' },
  shock: { name: 'SHOCKWAVE', color: '#2ad0ff' },
  bolt: { name: 'E-BOLT', color: '#8a6aff' },
  shield: { name: 'SHIELD', color: '#4aff9a' },
  turbo: { name: 'TURBO', color: '#ffffff' },
  cannon: { name: 'AUTOCANNON', color: '#ffe08a' },
  plasma: { name: 'PLASMA LANCE', color: '#ff40ff' },
  emp: { name: 'EMP BURST', color: '#60b0ff' },
  well: { name: 'GRAVITY WELL', color: '#c080ff' },
};

export const POINTS = [9, 7, 5, 4, 3, 2, 1, 0];
