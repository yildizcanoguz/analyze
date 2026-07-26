# CLAUDE OF DUTY

A first-person shooter that runs entirely in the browser, built with
[Three.js](https://threejs.org) and WebGL. **There are no art assets.**
Every texture is painted onto a canvas at runtime, every mesh is assembled
from primitives, every animation is driven by code, and every sound is
synthesized with the Web Audio API. Three.js (loaded from a CDN) is the
only dependency — there is no build step.

An original homage to [mshumer/Claude-of-Duty](https://github.com/mshumer/Claude-of-Duty)
(MIT), written from scratch by Claude.

## Run it

Serve the folder with any static file server and open it:

```bash
cd claude-of-duty
npm start          # python3 -m http.server 8000
# then open http://localhost:8000
```

A server is needed only because browsers refuse to load ES modules over
`file://`. To get a version you can double-click instead, build the
single-file bundle — Three.js and all eleven modules inlined into one
self-contained HTML document with no network access of any kind:

```bash
npm install
npm run build      # -> dist/claude-of-duty.html (~594 KB)
```

`--fragment` additionally emits `dist/claude-of-duty.page.html`, the same
page without the document wrapper, for embedding.

## Gameplay

Survive endless waves of hostiles in a night-time urban arena.
Each wave is larger, tougher and more accurate than the last.

| Input | Action |
|---|---|
| `W A S D` | Move |
| Mouse | Aim — LMB fire, RMB aim down sights |
| `Shift` | Sprint |
| `Space` | Jump |
| `C` / `Ctrl` | Crouch |
| `R` | Reload |
| `1 / 2 / 3` or wheel | Switch weapon |
| `Esc` | Pause |

The mouse is captured with pointer lock. Some embedded contexts (a sandboxed
iframe, for example) refuse that request; the game detects this and keeps
playing off raw mouse deltas instead, with `Esc` driving the pause screen
that the browser would otherwise handle.

**Arsenal:** CF-5 Vandal (auto rifle) · P-9 Scribe (semi-auto pistol) ·
M77 Breacher (pump shotgun). Damage falls off with range, spread grows
with movement and sustained fire, ADS tightens it. Health regenerates
CoD-style after 4 seconds without taking damage. Reserves are refilled
after every cleared wave.

## Subsystems

| Module | Responsibility |
|---|---|
| `src/main.js` | Bootstrap, input, game state machine, wave orchestration, main loop |
| `src/config.js` | Tuning constants |
| `src/textures.js` | Procedural canvas textures (asphalt, brick, camo, windows, …) |
| `src/world.js` | Arena generation: buildings, cover, floodlights, skyline, stars |
| `src/physics.js` | Cylinder-vs-AABB collision and arena clamping |
| `src/player.js` | First-person controller, health regen, recoil |
| `src/weapons.js` | Procedural gun models, hitscan ballistics, ADS, reloads |
| `src/enemies.js` | Procedural humanoids, AI state machine, burst fire, waves |
| `src/effects.js` | Tracers, sparks, blood, bullet holes, muzzle lights, screen shake |
| `src/audio.js` | Fully synthesized sound: gunshots, footsteps, UI stings, wind bed |
| `src/hud.js` | DOM heads-up display, kill feed, announcements, menus |
