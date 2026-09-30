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
  airbrakes. Hitting a wall costs a lot of speed, so clean lines matter.
- **Four circuits**, each with its own look: Cobalt Ridge (alpine), Neon
  Basin (night city), Sable Dunes (desert sunset) and Aurora Rift (arctic
  night). They have banked corners, hills, tunnels, speed pads and weapon
  pads.
- **Four teams, eight pilots**, each team with its own craft and its own
  speed, thrust and handling.
- **Two speed classes**, plus Single Race, Time Trial (5 laps, saved
  records) and Championship (finish in the top 3 to advance, 3 attempts).
- **Weapons:** rockets, homing missile, mines, shockwave, E-bolt (disrupts
  the target's systems), shield and turbo.
- **AI rivals** that follow a racing line, dodge each other and use
  weapons.
- **PS1-style rendering:** 240p output, vertex snapping (wobble), affine
  texture warping, Gouraud vertex lighting, depth-cue fog and 15-bit colour
  with ordered dithering. Each effect can be switched off in Options.
- **Procedural audio:** synthesised engines and effects, plus a generated
  electronic soundtrack with a different track for each circuit.

## Development

- `npm test` runs a headless simulation in which an AI pilot from each team
  completes three laps of every circuit. This checks the track geometry,
  physics and AI together.
- Open `index.html?autopilot&laps=1` to have the AI fly your craft, which
  is handy for testing menus and results flow.

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
