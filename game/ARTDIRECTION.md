# ART DIRECTION — OVERSTRIKE

Every agent renders to *this* look. Deviating from the palette, lighting, or scale rules
produces a scene that reads as amateur even when each part is individually well-made.

## The pitch

A mid-morning firefight through a bombed-out Mediterranean coastal town. Think
*Modern Warfare* "Piccadilly"/"Hackney Yard" tonally, but sun-bleached: bright hazy sky,
hard low-angle sun, dust hanging in every shaft of light, wet asphalt from a recent rain.
Grounded military realism. **No neon, no sci-fi, no fantasy.**

## Colour & grade

- Overall grade: warm highlights (`#ffe7c4`), cool shadows (`#3d4a5c`). Split-tone.
  This warm/cool separation is the single biggest driver of the "AAA" read.
- Base albedo must sit in a **narrow, desaturated midrange**: sRGB luminance 0.18–0.55.
  Nothing pure white, nothing pure black. Saturation ceiling ~0.25 for architecture.
- Accent colour, used sparingly (<3% of screen): faded ochre/amber `#d8ab4a`,
  oxidised teal `#3f7a72`, rust `#8c4a2f`, and the *one* saturated element — muzzle flash.
- Reference values: dry concrete `#9a938a`, wet asphalt `#3a3a3c`, rusted steel `#6b4a38`,
  painted steel `#5d6a6b`, sand `#c6ad86`, dry foliage `#6e7146`, gun polymer `#2b2d2b`.
- **Never** use flat untextured saturated colours. Every surface gets albedo variation.

## Lighting

- Key: directional sun, **elevation 22°, azimuth 118°**, colour `#fff2d8`, intensity ~3.4.
  Long raking shadows across the street. All systems must use these exact values.
- Sky/ambient: physically-derived from the sky model via PMREM. Cool blue bounce
  `#7fa3d1` in shadow. Ambient occlusion must be visible in every corner and contact point.
- Bounce: a warm ground-bounce fill `#c9a882` at ~0.25 from below on characters/props.
- Interiors are ~2.5 stops darker than exteriors — the contrast between the two is where
  the drama lives. Every doorway should read as a bright hole or a dark hole.
- Volumetric shafts through window openings, doorways, and holes in ceilings. Mandatory.
- Emissives: only fires, muzzle flashes, tracers, screens, and vehicle lights.

## Scale & proportion (this is where fake-looking scenes get caught)

- Human eye height **1.68 m**, crouched 1.05 m. Player capsule radius 0.34 m.
- Door 0.9 × 2.1 m. Storey height 3.2 m. Standard step rise 0.17 m.
- Street width 9–14 m. Sidewalk 2.2 m wide, 0.14 m curb.
- Car ~4.4 × 1.8 × 1.5 m. Sandbag 0.5 × 0.3 × 0.2 m. Jersey barrier 2.0 × 0.6 × 0.81 m.
- Rifle length 0.86 m; muzzle sits ~0.62 m forward of the eye in the viewmodel.
- **Texel density: 512 px per metre**, uniformly, everywhere. Mismatched texel density
  across adjacent surfaces is the #1 tell of amateur work.

## Surface language

Every material needs all four of these or it reads as plastic:
1. **Base variation** — large-scale blotching/discolouration (2–4 m wavelength).
2. **Mid detail** — the material's actual structure (aggregate, grain, weave, pitting).
3. **Micro roughness break-up** — roughness must *never* be constant across a surface.
   Vary it ±0.15 with a high-frequency noise. This alone doubles perceived quality.
4. **Wear at edges/contacts** — dirt in crevices, chipping on corners, streaks below
   ledges (gravity-driven vertical streaking), scuffing at floor level, water pooling.

Curvature-driven edge wear and gravity-driven vertical streaking are both mandatory on
architecture. Concrete is chipped at every corner exposing aggregate.

## Damage & storytelling

The town has been fought over: shell craters, collapsed façade sections, rebar exposed,
burnt vehicle husks, scattered rubble with correct size distribution (fine dust → fist →
block), broken glass, shredded awnings, bullet scarring clustered around cover edges,
sandbag emplacements, scorch marks radiating from blast centres. Rubble piles up against
obstacles — it never sits in tidy heaps.

## Post-processing chain (fixed order)

`scene → SSAO/GTAO → SSR (ultra) → volumetrics → bloom (threshold 1.05, soft knee) →
motion blur → DOF (ADS only) → ACES tonemap → LUT grade → chromatic aberration (edges
only, ≤1.2 px) → film grain (0.022, animated) → vignette (0.28) → sharpen (0.35) → SMAA/TAA`

Grain, aberration, and vignette must all be *subtle*. If a critic can name them
individually from a still, they are too strong.

## Camera feel

- FOV 90 hip / interpolates to weapon-specific ADS FOV over 180 ms with an ease-out curve.
- Weapon sway lags camera rotation by ~90 ms — the gun must feel like it has mass.
- Landing, firing, and explosions all shake the camera on separate channels that sum.
- Vertical bob amplitude at sprint ≤ 0.035 m. Anything more feels like a bobblehead.

## Anti-patterns — instant fail

- Flat ambient light with no directional shadow.
- Untextured single-colour geometry.
- Perfectly sharp 90° corners on everything (bevel/chamfer edges — they catch light).
- Uniform roughness across a whole material.
- Repeating tiling visible at a glance (break it up with decals, dirt, variation).
- Objects intersecting the ground plane with no contact shadow or debris skirt.
- Symmetrical, evenly-spaced prop placement.
- HUD that uses default browser fonts, pure `#fff`, or `border-radius` bubbles.
