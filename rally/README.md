# OVER CREST — Rally Championship

A browser rally game in tribute to the late-90s rally classics: point-to-point
stages against the clock, a co-driver calling pace notes in your ear, and a car
that wants to go sideways. The cars, crews, rallies, sponsors and stages are
all original to this project.

## Play

```sh
npm start                 # from the repository root
# open http://localhost:8080/rally/
```

There is nothing to install: three.js is vendored in `../vendor/`. Any static
file server works if it serves the repository root (the game loads
`../vendor/three.module.min.js`).

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate | ↑ / W | RT / A |
| Brake, then reverse | ↓ / S | LT / X |
| Steer | ← → / A D | Left stick |
| Handbrake | Space | B / RB |
| Gear up / down (manual box) | E / Q | Y / LB |
| Change camera | C | View |
| Recover to the road (+5 s) | R | D-pad up |
| Pause | Esc / P | Start |

Touch screens get on-screen pedals and steering.

## What's in it

- **The co-driver.** Pace notes are generated from the same plan the road is
  built from, so every call is exact: *flat, easy, medium, hard, square,
  hairpin* (fastest to slowest), with *long, tightens, opens, don't cut, keep
  in, caution, over crest, jump, water splash, narrows, dip* and the distance to
  the next call. Close corners are chained with *"into"*. He reads further
  ahead the faster you go, counts you down, calls splits and the flying finish,
  and has opinions about your driving. Two voices (George and Emma) were
  recorded with the Kokoro neural TTS and play through a band-limited,
  compressed helmet-intercom chain. The HUD shows each call as an arrow coloured
  by severity.
- **Drift physics.** A rigid body on four raycast struts with a combined-slip
  tyre model (loose surfaces peak late and fall away gently, which is what lets
  a rally car hang in a long slide), weight transfer, anti-roll bars, load
  sensitivity, limited-slip diffs front/rear/centre, a hydraulic handbrake that
  opens the centre diff on 4WD cars, a turbo with lag, a sequential box with
  ignition cut, launch control slip, aero drag, water drag in fords and body
  collisions so cars roll, dig in and dent. Fourteen surfaces: tarmac, wet
  tarmac, gravel, wet gravel, red dirt, loose verge, compacted snow, ice,
  snowbanks, deep snow, grass, scrub, mud and water.
- **Steering** is proportional and speed-sensitive, like a real rally car:
  full lock shrinks with speed (about 35° at walking pace, 20° at 50 km/h,
  9° at 100 km/h), so a full input takes the car to its grip limit without
  pivoting it; tyres build cornering
  force over a short rolling distance; castor lets the wheel self-centre into
  a slide when you let go; and keyboard steering winds on progressively,
  slower at speed. Extra lock is only available for counter-steer.
- **Drift assist** (Options, on by default): when you let go of the steering
  the car catches its own slide, and a stability aid steps in past about 25°
  of slide. It never adds to your own counter-steer. Turn it off for the raw car.
- **Four cars** with different drivetrains: Kaizen R4 Turbo (4WD, rear-biased),
  Torva GT-Four (heavy 4WD, huge turbo), Hornet RS 1800 (classic RWD, 8,800 rpm)
  and Brisa S16 Kit Car (light FWD).
- **Six stages, five rallies**: Harrowmoor Forest (UK gravel, pine forest,
  water splashes), Kuusijärvi Ridge (fast Finnish gravel with jumps, low sun),
  Col de Varenne (French mountain tarmac with stone walls), Snöberget Night
  (Swedish snow and ice at night on headlights and a light pod, snowbanks,
  snowfall), Mundaring Red (Australian red dirt and gum trees) and Cwm Glas
  (Welsh mud in the rain).
- **Modes**: Rally Championship (six stages, aggregate time against seven
  crews, service between stages), Single Stage and Time Trial (chase your own
  ghost; best times and ghosts are saved). Rival pace has three levels.
- **Graphics**: physically based shading with photographed sky lighting and
  scanned road, ground and rock surfaces (Poly Haven, CC0; see
  `tools/fetch_assets.py`), height fog that pools in the valleys, ACES tone mapping, soft sun shadows that follow the car,
  bloom, sun shafts through the trees, lens flare, ambient occlusion (Ultra),
  speed blur, film grain and a colour grade per stage. Terrain blends grass,
  dirt and rock by slope with normal-mapped detail; the road has worn wheel
  lines and loose gravel; forests of instanced pines, birches, gums and maquis
  sway in the wind, with impostor forests on distant hills; grass verges,
  rocks, marker posts, hay bales, chevrons, stone walls, spectators who jump
  and wave as you pass, tape lines, parked cars and start/split/finish
  gantries. The car is clear-coated, picks up dirt (or snow) as the stage goes
  on, dents where it hits things, and has a crew you can see through the glass.
  Lit dust clouds that hang in the air, gravel and snow spray, water splashes,
  tyre tracks, sparks, exhaust pops and flames, rain and snowfall.
  Quality presets (Low → Ultra) and automatic resolution scaling.
- **Sound**, all synthesised except the co-driver: a physically modelled
  engine running in an AudioWorklet (each cylinder firing launches an exhaust
  pulse through pipe resonators and a load-dependent muffler, plus intake
  roar), overrun burble and anti-lag bangs, turbo whistle and blow-off,
  straight-cut gearbox whine, gear-change clunks, tyre roll, gravel crunch,
  tarmac squeal, stones pinging the underbody, wind, water, impacts with metal
  and glass, landings, crowds cheering as you pass, birdsong and rain, and menu
  music.
- **Replays** from trackside TV cameras after every stage.

## Development

- `npm run test:rally` (or `node rally/tools/simtest.js [stage] [car]`) drives
  every stage in every car with the AI and fails if the car can't finish. It
  exercises the stage generator, physics and AI together.
- URL switches for testing: `?stage=N&car=N` jumps into a stage, `&autopilot`
  lets the AI drive, `&quick` skips the countdown, `&at=metres` starts further
  down the stage, `&cam=0..4` picks a camera, `&q=0..3` sets the quality.
- `rally/tools/make_voice.py` re-records the co-driver (needs `kokoro-onnx`,
  its model files and ffmpeg).

```
rally/src/
  stages.js    stages, surfaces, cars, rival crews
  road.js      stage generator, terrain height, spatial queries, pace notes
  layout.js    trees, rocks, crowds, props, gantries (data only)
  car.js       vehicle physics
  ai.js        driver for autopilot and tests
  codriver.js  pace-note caller
  world.js     terrain, road, forests, grass, props, crowds, water
  sky.js       sky dome, sun/moon, shadows, lens flare, environment maps
  carmodel.js  lofted car body, livery, wheels, lights, dents, dirt
  fx.js        particles, tyre tracks, weather
  textures.js  procedural textures
  audio.js     engine worklet, effects, co-driver intercom, music
  hud.js       HUD
  input.js     keyboard, gamepad, touch
  main.js      renderer, post-processing, menus, game flow, cameras, replays
```

See `CREDITS.md` for third-party assets.
