# ENGINE CONTRACT — read this fully before writing any code

This file is the **binding interface spec** for a multi-agent build. Many agents work in
parallel on the same filesystem. Violating file ownership or the API shapes below breaks
everyone else's work.

## HARD RULES

1. **You may only create/edit files you own** (see OWNERSHIP). Never edit another
   module's file, `main.js`, `index.html`, `CONTRACT.md`, or `vendor/`.
2. If you need something from another system, go through `ctx` or the **event bus**.
   Never import another system's file directly unless the contract says so.
3. No network access at runtime. No CDNs. Everything is local or procedurally generated.
   Textures are **generated in code** (canvas/noise/shader), not downloaded.
4. Target: **60fps at 1080p** on an integrated GPU. Budget your draw calls and shaders.
5. ES modules only. Import three as `import * as THREE from 'three'` and addons as
   `import { X } from 'three/addons/path/File.js'` (importmap is already configured).
6. Everything must degrade: read `ctx.settings.quality` (`'low'|'medium'|'high'|'ultra'`)
   and scale your effect accordingly.

## FILE OWNERSHIP

| Owner id | Files owned (exclusive write access) |
|---|---|
| `render` | `src/core/postfx.js`, `src/core/quality.js` |
| `materials` | `src/world/materials.js`, `src/world/texgen.js` |
| `level` | `src/world/level.js`, `src/world/props.js` |
| `sky` | `src/world/sky.js`, `src/world/atmosphere.js` |
| `player` | `src/player/controller.js`, `src/player/camera.js` |
| `weapons` | `src/weapons/*.js` |
| `ballistics` | `src/combat/ballistics.js`, `src/combat/damage.js`, `src/combat/decals.js` |
| `ai` | `src/ai/*.js` |
| `fx` | `src/fx/*.js` |
| `audio` | `src/audio/*.js` |
| `ui` | `src/ui/*.js` |
| `gamemode` | `src/game/*.js` |
| `physics` | `src/core/physics.js` |

Files owned by **integration only** (do not touch): `src/main.js`, `src/core/engine.js`,
`src/core/input.js`, `src/core/events.js`, `src/core/context.js`, `index.html`.

## SYSTEM SHAPE

Every module exports a default class:

```js
export default class MySystem {
  static id = 'mySystem';            // key it gets registered under on ctx
  constructor(ctx) { this.ctx = ctx; }
  async init() {}                    // awaited once, in dependency order
  update(dt, t) {}                   // dt = seconds (clamped <= 0.1), t = elapsed seconds
  lateUpdate(dt, t) {}               // optional, after all update()
  resize(w, h) {}                    // optional
  dispose() {}                       // optional
}
```

Init order (guaranteed): `quality → texgen/materials → sky → level → physics → fx →
audio → player → weapons → ballistics → ai → gamemode → ui → postfx`.
Anything you need from an earlier system is available on `ctx` inside your `init()`.
Anything from a *later* system must be accessed lazily inside `update()`.

## ctx — the shared context

```js
ctx.renderer      // THREE.WebGLRenderer  (ACESFilmic, sRGB out, shadows on)
ctx.scene         // world scene
ctx.camera        // world PerspectiveCamera (driven by player/camera.js)
ctx.viewScene     // SEPARATE scene for the first-person viewmodel (weapons/hands)
ctx.viewCamera    // SEPARATE camera for viewmodel (own FOV, no world clipping)
ctx.canvas
ctx.events        // EventBus (see below)
ctx.settings      // { quality, fov, sensitivity, adsSensitivity, invertY, volume, ... }
ctx.input         // Input service (see below)
ctx.rng(seed?)    // deterministic RNG factory -> ()=>float 0..1
ctx.dt            // last frame delta
ctx.time          // elapsed seconds
ctx.frame         // frame counter
ctx.systems       // map of id -> system instance
ctx.state         // 'menu' | 'playing' | 'paused' | 'dead' | 'gameover'
```

Systems register themselves on `ctx` under `static id`, e.g. `ctx.materials`,
`ctx.level`, `ctx.fx`, `ctx.audio`, `ctx.ui`, `ctx.physics`, `ctx.player`, `ctx.weapons`,
`ctx.ballistics`, `ctx.ai`, `ctx.sky`, `ctx.postfx`, `ctx.gamemode`.

## EVENT BUS

```js
ctx.events.on(name, fn)      // returns unsubscribe fn
ctx.events.off(name, fn)
ctx.events.emit(name, payload)
```

### Canonical events (payload shapes are binding)

| Event | Payload | Emitted by |
|---|---|---|
| `weapon:fire` | `{ weapon, origin:Vec3, dir:Vec3, spread:number }` | weapons |
| `weapon:dryfire` | `{ weapon }` | weapons |
| `weapon:reload:start` | `{ weapon, duration }` | weapons |
| `weapon:reload:end` | `{ weapon }` | weapons |
| `weapon:switch` | `{ from, to }` | weapons |
| `weapon:ads` | `{ active:boolean, weapon }` | weapons |
| `weapon:recoil` | `{ pitch, yaw, kick }` | weapons → player camera |
| `hit:surface` | `{ point:Vec3, normal:Vec3, surface:string, incoming:Vec3, weapon }` | ballistics |
| `hit:entity` | `{ entity, point, normal, damage, headshot:boolean, weapon }` | ballistics |
| `entity:damage` | `{ entity, amount, source, point, dir }` | damage |
| `entity:death` | `{ entity, killer, weapon, headshot }` | damage |
| `player:damage` | `{ amount, dir:Vec3, source }` | damage |
| `player:death` | `{ killer }` | damage |
| `player:land` | `{ velocity:number, surface:string }` | player |
| `player:footstep` | `{ surface:string, speed:number, foot:'l'\|'r' }` | player |
| `player:state` | `{ sprinting, crouching, sliding, airborne, ads }` | player |
| `explosion` | `{ point:Vec3, radius, damage, source }` | any |
| `score` | `{ points, reason }` | gamemode |
| `hud:hitmarker` | `{ headshot:boolean, kill:boolean }` | ballistics/damage |
| `game:state` | `{ state }` | gamemode |

Emit what you own; listen for the rest. **Do not invent renamed variants** of these.

## SURFACE TYPES (string ids — used by audio, fx, decals, ballistics)

`concrete`, `metal`, `wood`, `dirt`, `sand`, `glass`, `water`, `flesh`, `foliage`,
`plaster`, `rubber`, `fabric`, `gravel`, `tile`, `brick`

Materials must tag their three.js material with `material.userData.surface = '<id>'`
and `material.userData.penetration = <0..1>` (0 = bullet stops, 1 = passes freely).

## COLLISION / PHYSICS API (`ctx.physics`)

```js
ctx.physics.raycast(origin, dir, maxDist, opts?) -> null | {
  point, normal, distance, surface, penetration, object, entity|null
}
ctx.physics.sphereCast(origin, dir, radius, maxDist) -> same shape
ctx.physics.capsuleMove(pos, halfHeight, radius, delta) -> { pos, grounded, normal, hitSurface }
ctx.physics.addStatic(object3D)        // register level geometry for collision
ctx.physics.removeStatic(object3D)
ctx.physics.addBody(opts) -> body      // dynamic rigid body for debris/ragdoll
ctx.physics.overlapSphere(pos, r) -> entity[]
ctx.physics.registerEntity(entity)     // entity: { id, object3D, hitboxes[], health, team, alive }
ctx.physics.unregisterEntity(entity)
```

Hitbox shape: `{ name:'head'|'chest'|'stomach'|'arm_l'|'arm_r'|'leg_l'|'leg_r', bone|object3D, radius, height, mult:number }`.

## MATERIAL LIBRARY API (`ctx.materials`)

```js
ctx.materials.get(name, opts?) -> THREE.Material   // cached, surface-tagged
ctx.materials.texture(name, opts?) -> { map, normalMap, roughnessMap, aoMap, ... }
ctx.materials.names                                 // string[] of available materials
ctx.materials.env                                   // PMREM environment texture
```

Required material names (level/props/weapons depend on these existing):
`concrete_wall`, `concrete_floor`, `plaster_wall`, `brick`, `asphalt`, `sand`, `dirt`,
`gravel`, `metal_painted`, `metal_rusted`, `metal_brushed`, `wood_plank`, `wood_crate`,
`glass`, `tile`, `fabric_canvas`, `rubber`, `foliage`, `gun_metal`, `gun_polymer`,
`gun_wood`, `skin`, `camo_fabric`, `tac_nylon`.

## FX API (`ctx.fx`)

```js
ctx.fx.impact(point, normal, surface, opts?)   // sparks/dust/debris + decal request
ctx.fx.decal(point, normal, surface, opts?)
ctx.fx.tracer(from, to, opts?)
ctx.fx.muzzleFlash(matrixOrObject, opts?)
ctx.fx.shell(pos, dir, opts?)
ctx.fx.blood(point, normal, opts?)
ctx.fx.explosion(point, opts?)
ctx.fx.smoke(point, opts?)
ctx.fx.screenShake(amount, duration)
```

## AUDIO API (`ctx.audio`)

```js
ctx.audio.play(name, opts?)                 // opts: { position, volume, pitch, loop }
ctx.audio.play3d(name, position, opts?)
ctx.audio.stop(handle)
ctx.audio.setListener(camera)
ctx.audio.music(name, opts?)
```
Sounds are **synthesized** (WebAudio graph), not files. Required names:
`fire_ar`, `fire_smg`, `fire_sniper`, `fire_pistol`, `fire_shotgun`, `dryfire`,
`reload_mag_out`, `reload_mag_in`, `reload_charge`, `shell_concrete`, `shell_dirt`,
`impact_<surface>`, `footstep_<surface>`, `land_<surface>`, `whizby`, `hitmarker`,
`hitmarker_kill`, `explosion`, `hurt`, `heartbeat`, `ads_in`, `ads_out`, `swap`.

## UI API (`ctx.ui`)

```js
ctx.ui.setAmmo(mag, reserve)
ctx.ui.setHealth(hp, max)
ctx.ui.hitmarker(kind)          // 'normal'|'headshot'|'kill'|'armor'
ctx.ui.damageIndicator(dirWorld)
ctx.ui.killfeed(entry)          // { killer, victim, weapon, headshot }
ctx.ui.setSpread(px)            // crosshair gap in pixels
ctx.ui.notify(text, kind?)
ctx.ui.setWeapon(info)          // { name, icon, fireMode }
ctx.ui.setState(state)
```

## PLAYER API (`ctx.player`)

```js
ctx.player.position   // Vector3 (feet)
ctx.player.velocity   // Vector3
ctx.player.eye        // Vector3 (camera world pos)
ctx.player.yaw, ctx.player.pitch
ctx.player.state      // { sprinting, crouching, sliding, airborne, ads, leaning }
ctx.player.health, ctx.player.maxHealth
ctx.player.addRecoil(pitch, yaw)
ctx.player.applyImpulse(vec3)
```

## INPUT API (`ctx.input`)

```js
ctx.input.down(action)      // held this frame
ctx.input.pressed(action)   // went down this frame
ctx.input.released(action)
ctx.input.mouse             // { dx, dy, wheel }
ctx.input.locked            // pointer lock active
```
Actions: `forward back left right jump crouch sprint fire ads reload melee use
weapon1 weapon2 weapon3 grenade lean_l lean_r pause inspect firemode`

## VIEWMODEL RULES (weapons)

The viewmodel lives in `ctx.viewScene` with `ctx.viewCamera`, rendered **after** the world
with the depth buffer cleared, so the gun never clips into walls. It gets its own lights
(add them to `viewScene` yourself) but should sample `ctx.materials.env` for reflections.

## QUALITY TIERS

`low`: no SSAO/SSR, half-res bloom, no volumetrics, 1 shadow cascade, no motion blur.
`medium`: SSAO on, 2 cascades, cheap volumetrics.
`high`: GTAO, 3 cascades, volumetric light shafts, motion blur, TAA.
`ultra`: + SSR, higher particle counts, contact shadows, 4 cascades.

## DEV LOOP

- Serve: `node tools/serve.mjs` (port 8099, root = `game/`)
- Screenshot: `node tools/shot.mjs <url> <out.png> [--wait ms] [--script "js"]`
- Automated scenario shots: `node tools/capture.mjs <preset>` (see tools/capture.mjs)
- The page sets `window.__ready = true` once the first frame renders, and exposes
  `window.__game` (the ctx) for automation. Keep that working.
