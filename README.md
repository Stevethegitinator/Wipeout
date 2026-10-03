# HOVERLINE — anti-gravity racing, 2052

An original browser racing game in the spirit of the mid-90s 32-bit
anti-gravity racers. The ships, teams, circuits, music, logos and sponsors
are all new, created for this project. None of it is copied from any
commercial game.

## Play

```sh
npm start            # serves the game on http://localhost:8080
```

There are no dependencies to install: three.js is vendored in `vendor/`.
Any static file server works too, e.g. `python3 -m http.server`.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Thrust | X / W / ↑ | A |
| Steer | ← → / A D | Left stick / D-pad |
| Left / right airbrake | Z / C (or Q / E) | LB / RB (or triggers) |
| Fire weapon | Space / Shift | B or X |
| Nose up (in the air) | ↓ / S | Stick down |
| Change camera | V | Y |
| Pause | Esc / P | Start |

Tip: hold thrust as the countdown reaches **1** for a boost start. Tap an
airbrake to swing the nose round tight corners.

## What's in it

- **Handling:** anti-gravity hover physics with slide, inertia and
  airbrakes. Touch a barrier and you grind along the rail in a shower of
  sparks, bleeding speed; only a square-on hit costs a big chunk.
- **Jumps and gaps:** kicker ramps launch you into the air, and some leap
  over open gaps in the track. Arrive too slowly and you fall and respawn on
  the far side, well off the pace. Hold nose-up in the air to float further.
- **Four circuits**, each with its own look: Cobalt Ridge (alpine), Neon
  Basin (night city), Sable Dunes (desert sunset) and Aurora Rift (arctic
  night). They have banked corners, hills, tunnels, speed pads and weapon
  pads.
- **Four teams, eight pilots**, each team with its own craft and its own
  speed, thrust and handling.
- **Two speed classes**, plus Single Race, Time Trial (5 laps, saved
  records) and Championship (finish in the top 3 to advance, 3 attempts).
- **Eleven weapons:** rockets, homing missile, mines, shockwave, E-bolt
  (disrupts the target's systems), autocannon, plasma lance, EMP burst (hits
  everyone near you), gravity well (a trap that drags rivals in), shield and
  turbo.
- **AI rivals** that follow a racing line, dodge each other and use
  weapons.
- **Modern graphics (default):** full-resolution anti-aliased rendering,
  sun lighting with real-time shadows, sky reflections on the craft, bloom
  on glowing elements and filmic tone mapping. Detailed craft with glass
  canopies, glowing nozzles, light trails and race numbers. Speed blur and
  streaks near top speed, heat shimmer behind the engines, a sun with lens
  flare and light shafts, drifting clouds, valley
  mist, grandstands, billboards, smoke and debris from explosions, and a
  colour grade for each circuit. Glowing edge strips and
  yellow chevron boards on corners make the track easy to read at speed.
  Quality scales down automatically if the frame rate drops.
- **Graphics quality** (Options → Quality): Low, Medium, High (default) or
  Ultra. High and Ultra add mirror reflections on the road, ambient
  occlusion, real lamp lighting at night and denser scenery. Ultra adds
  bigger shadow maps and up to 8x anti-aliasing.
- **Weather** (Options → Weather): rain with a wet, reflective road,
  lightning and spray on Neon Basin; snow on Cobalt Ridge; a sandstorm on
  Sable Dunes; ice crystals on Aurora Rift.
- **Living scenery:** waving team flags, a bobbing crowd, city traffic,
  sweeping searchlights, and craft with vents, panel seams and airbrake
  flaps that lift when you brake.
- **Lighting:** photographed real-world environment maps (Poly Haven, CC0)
  light and reflect on everything; see `assets/CREDITS.md`.
- **Retro 32-bit mode** (Options → Graphics): 240p output, vertex wobble,
  affine texture warping, vertex lighting and 15-bit colour dithering.
- **Audio, all synthesised in code:**
  - Layered jet engines (turbine whine, combustion rumble, air roar and an
    afterburner crackle on boost), with a different voice per team. Rivals
    are placed in stereo and shift pitch as they pass (Doppler).
  - Distinct sounds for all eleven weapons, impacts with metallic clangs,
    explosions with debris crackle, and reverb.
  - Rail grinding: a ringing metal scrape with spark crackle that follows
    your speed, plus a clang on first contact.
  - A soundtrack with a different style per circuit: breakbeat (Cobalt
    Ridge), drum & bass (Neon Basin), acid techno (Sable Dunes) and dark
    techno (Aurora Rift), plus menu music. Each track has an intro,
    build-ups, drops and breakdowns, with kick-ducked bass and pads.

## Development

- `npm test` runs a headless simulation in which an AI pilot from each team
  completes three laps of every circuit. This checks the track geometry,
  physics and AI together.
- Open `index.html?autopilot&laps=1` to have the AI fly your craft, which
  is handy for testing menus and results flow. Add `track=N` (0–3) to jump
  straight into a race.

```
src/
  data.js        teams, classes, circuits, themes
  trackdata.js   spline → sections, frames, local queries (no rendering)
  ship.js        hover physics, walls, pads, laps
  ai.js          AI pilots
  weapons.js     pickups, projectiles, mines
  trackmesh.js   road, barriers, tunnels, scenery, terrain, sky
  shipmodels.js  low-poly craft
  psx.js         PS1-style shaders and post pass
  race.js        race orchestration and camera
  hud.js         HUD drawing
  audio.js       WebAudio synthesis and music
  main.js        renderer, menus, game modes
```
