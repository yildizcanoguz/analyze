# CRITIQUE RUBRIC — the AAA bar

Used by the visual-critic agents every round. The critic's job is to find reasons this is
**not** shippable, not to praise it. A round that returns "looks great" with no specific,
actionable defects is a **failed critique** and must be redone.

## How to grade

Score each axis 0–10. **AAA floor is 8.** Anything below 8 is a defect that must be fixed.
Report the score, the specific evidence in the image, and the specific fix.

Reference standard: *Call of Duty: Modern Warfare II/III* and *Black Ops 6* — a bright
Mediterranean urban map at mid-morning. Judge against your actual memory of how those games
look in a still frame, not against "good for a browser game". **Never grade on a curve for
the platform.** If the shot would look out of place in a CoD screenshot gallery, it fails.

## Axes

**1. Lighting & shadow.** Directional key with long raking shadows. Contact darkening in
every corner and under every object. Soft penumbra widening with distance from the contact.
No light leaking through geometry. No flat/ambient-only regions. Shadow acne, peter-panning,
visible cascade seams, and low-res shadow stairstepping are all failures.

**2. Materials & texture.** Consistent texel density (no surface visibly blurrier or sharper
than its neighbour). Roughness variation across every surface. Real mid-frequency structure,
not noise. Visible edge wear and cavity dirt. No visible tiling repetition. Nothing plastic,
nothing flat-coloured. Normal detail must survive close-up.

**3. Composition & scale.** Does it read as a real place at human scale? Door/step/car/curb
proportions correct against a 1.68 m eye height. Depth layering — foreground occluders,
midground action, background silhouette. No empty dead space, no symmetric prop placement,
no objects floating or intersecting the ground with no contact shadow.

**4. Colour & grade.** Warm highlights, cool shadows, split-toned. Narrow desaturated albedo
midrange. Filmic toe and highlight rolloff — no clipped white blobs, no crushed black holes.
Accent colour under 3% of frame. If the image looks like raw untonemapped WebGL output —
oversaturated, high-contrast, "video-gamey" — it fails hard.

**5. Post & atmosphere.** Aerial perspective separating depth planes. Visible airborne
particulate/dust. Volumetric shafts where geometry admits light. Bloom that bleeds naturally
from highlights without veiling the frame. AA with no crawling or ghosting.
**Penalty: if you can individually name the grain, chromatic aberration, or vignette from
the still, they are too strong — that is a defect, not a feature.**

**6. Detail density & storytelling.** Does the frame reward looking? Rubble with a correct
fine→coarse size distribution, damage that implies events, decals, small props, wear
concentrated where people and bullets actually go. Sparse, tidy, or evenly-scattered debris
is a failure. Every large flat untouched surface is a failure.

**7. Weapon & viewmodel** (gameplay framings). Correct proportions and length. Real material
separation between polymer/steel/anodised parts. Hands present and correctly posed with no
interpenetration. Sight alignment dead-centre and correct on ADS. Believable animation pose,
not a static prop. Viewmodel lighting must match the world it is standing in.

**8. Characters** (when in frame). Silhouette readability. Gear that layers correctly.
Cloth that is not shrink-wrapped. Plausible pose and weight distribution, weapon held
correctly with both hands. Faces/heads that do not read as mannequins.

**9. HUD.** Typographic discipline — condensed, tabular numerals, no default browser fonts,
nothing pure #fff, no rounded bubbles. Restrained. Reads instantly at a glance. Correctly
composed against the frame. Animated with real easing.

**10. Frame cohesion.** The whole-image gestalt. Does it look like one artist made it, or
like ten systems bolted together? Any single element that betrays the illusion — one
untextured face, one wrong-scale prop, one blown-out highlight — caps this axis at 5.

## Blind A/B protocol

For the head-to-head, describe what a CoD still of the same scenario would contain that this
frame does not — element by element. Then state which you would pick if shown both without
labels, **and say plainly if it is the CoD frame.** Do not soften the verdict to be
encouraging; an inflated pass makes the whole loop worthless. Name the top three things that
give ours away as the non-CoD frame.

## Output discipline

- Every defect: **where** in the image, **what** is wrong, **which system owns it**
  (see CONTRACT.md ownership table), and **what specifically to change**.
- Rank defects by how much they cost the illusion, worst first.
- No defect may be "add more detail". Say what detail, where, and why.
