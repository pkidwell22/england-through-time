# Look development: light, atmosphere, camera, water

Goal: make the live view read as photographed rather than rendered, by changing how the scene is
lit and photographed. Content (buildings, streets, trees, people) was not touched.
This document is the record of what was built, the iterations, and an honest account of what
still gives the image away.

## What the pipeline is now

Code: `src/scene/look/*` (new), `src/scene/engine.ts`, `src/scene/mist.ts`, `src/scene/fx.ts`.

### 1. Light units, exposure and camera response (`look/rig.ts`, `look/post.ts`)

- **Units from the photograph.** The HDR sky is measured on load (`look/sky.ts`): the sun disc is
  found and integrated (irradiance facing the sun, per channel), the rest of the sky is integrated over
  a level surface, the horizon band is averaged towards and away from the sun, and the cloud fraction is
  estimated from saturation. One scale factor takes the photograph to scene units so that open level
  ground always receives `REF_EH = 4` (sun + sky). Sun colour, sun-to-sky ratio and horizon colour are
  the photograph's own, so the directional light now agrees with the sky it is drawn under.
- **No double sun.** The image used for lighting is a copy of the sky with the sun disc painted out (the
  shadow-casting light carries the sun) and the lower hemisphere replaced by ground bounce: the
  terrain's measured albedo (mean of its scanned grass and earth textures, with the terrain shader's
  tints) times the irradiance on the ground, divided by pi. The old extra hemisphere light is off once
  the photograph is in. The background keeps the original sky with its sun (for bloom and glitter).
- **Metered exposure.** The camera is metered like a reflected-light meter (K = 12.5): level ground of
  12.5% reflectance comes out as scene-linear 0.18. Presets add compensation in stops; a site's old
  `exposure` value is kept as compensation relative to the old fixed 0.72.
- **Tone mapping.** AgX (three's Filament/Blender base transform) with Blender's look stage restored in
  AgX log space (power 1.06–1.14, saturation 1.0–1.12 per preset). Compared by eye with Khronos PBR
  Neutral and ACES on the same views (`docs/screenshots/look/tm-*`): Neutral was the most "digital
  camera" but crushed street shadows to black; ACES was contrasty and warm-shifted; bare AgX was flat
  and greyed the blue sky. AgX plus a mild look keeps soft highlight roll-off and shadows that hold
  colour, with restrained saturation. `?tonemap=neutral|aces` switches for comparison.
- **Grade.** White balance (linear), saturation, lift/gamma/gain in display space, per preset; very
  light natural vignetting and luminance-weighted film grain (strongest in mid-tones); dithering.
- **Bloom.** 13-tap downsample (Karis-weighted first level, so single bright pixels cannot make blobs)
  and tent upsample over 4–6 levels, mixed energy-conservingly at 3–7%: veiling glare that only
  visibly blooms what is genuinely bright (sky near the sun, glitter on water).
- **Anti-aliasing.** Medium: 4x MSAA. High and Cinematic: 4x MSAA plus temporal AA (Halton 2,3 jitter,
  reprojection from depth with the nearest depth of the 3x3 neighbourhood, Catmull-Rom history, variance
  clipping in YCoCg on tone-compressed colour, tighter while moving, history reset on camera cuts). No
  motion vectors: moving boats, people and smoke are handled by the clipping, not by reprojection.
- **Ambient occlusion.** GTAO (three's pass, used only for its AO texture, which saves the two
  full-screen copy/blend passes the pass does by default), applied in the final pass with less weight
  in bright (mostly sunlit) pixels and faded out between 120 and 450 m, where screen-space samples span
  whole blocks and produced striped artefacts on open downland.
- **Depth of field.** Cinematic only, eye-level cameras only: thin-lens circle of confusion for the
  camera's real field of view on a full-frame sensor at f/4, gathered at half resolution. At street
  distances this is physically almost nothing except for very near foreground, which is the point.
- **Sun shafts.** High and Cinematic, when a low sun is on or near the screen: radial blur of visible
  sky towards the sun at quarter resolution.

### 2. Light (`look/shadows.ts`, `look/atmosphere.ts`)

- **Cascaded shadows without three's CSM addon** (which replaces every material's `onBeforeCompile`
  and would break the life, terrain and tree patches). Cascades are ordinary directional lights; the
  shared `lights_fragment_begin` chunk treats two or more shadowed directional lights as cascades of one
  sun, picks the finest cascade containing the fragment, blends across borders and applies the sun once
  (cascades after the first have zero intensity, so a path tracer reading the scene sees one sun).
  Splits are half logarithmic, half uniform; each cascade is the bounding sphere of its frustum slice
  (no resizing as the camera turns) and texel-snapped (no crawling edges). Cascades after the first are
  refreshed on alternate frames. Medium keeps one map (fitted and snapped), High has two, Cinematic three.
- **Bounce.** Ground-bounce hemisphere in the lighting sky (above). No screen-space or probe GI.
- **Cloud shadows.** A tiling cloud-density texture is projected along the sun direction from a deck
  at 1500 m and drifts with the wind (from the south-west, matching the fire smoke), multiplied into the
  sun's direct light only, in every lit material through the shared chunk, and in the water. Coverage
  is the photograph's measured cloud fraction (clamped), so a nearly clear sky gives few shadows.
- **Tide line.** At river sites, surfaces up to 0.6 m above high water are wet: darker and glossier.

### 3. Atmosphere (`look/atmosphere.ts`, `mist.ts`)

- Exponential fog is replaced by **aerial perspective** integrated along each view ray through two
  exponential height layers: aerosol (scale height 0.7–1.2 km) and a low haze (25–35 m) based on the
  water level (river sites) or typical ground level, so the river and valleys hold a little haze.
  Extinction is slightly wavelength dependent; in-scatter tends to the photograph's horizon colour
  (warmer and brighter towards the sun, with a Henyey-Greenstein forward-scattering glow around a low
  sun). Looking down from height the path is short and the ground stays clear; long grazing paths fill in.
- The **dated mist** (Barnet 1471) is unchanged in shape and applied after the aerial perspective; its
  colour is now the light it actually scatters (sky plus sun under the current rig).
- **Smoke, fire, wakes** opt in with `applyLookFog()`: fogged like everything else, and smoke and foam are
  lit by the current sky (a grey diffuser under the rig's sky and sun), flames stay self-lit.

### 4. Water (`look/water.ts`)

One plane at high water with a custom shader: depth from a top-down height map of the terrain
(re-rendered whenever the terrain mesh changes, i.e. when the banks move with the year), silty
olive-brown body colour that darkens with depth and lets the bed through only in the shallowest few
centimetres, Schlick Fresnel for n = 1.33 over a planar mirror image (or the sky photograph on Low),
normals at three scales advected along the river's own flow direction (two-phase flow map from the
centreline), GGX sun glitter under the cascaded and cloud shadows, a soft waterline, broken scum lines
along the bank, aerial perspective and mist. The mirror is rendered at 40% of the screen resolution every third frame on Medium, half resolution every
other frame on High, three quarters every frame on Cinematic, without small detail (layer 3: people,
props, ground cover, understorey). Far away the ripples are smaller than a pixel, so the surface is treated
as rough: roughness-aware Fresnel, a GGX glitter with the Smith visibility term, and at grazing angles the
mirror image is blended towards a broad band of sky above the horizon (the facets that can be seen at
grazing angles face the camera and reflect higher sky).

### 5. Presets (`look/presets.ts`, `?look=`)

`clear` (default: the original partly cloudy sky), `golden` (Table Mountain 1, sun 13 degrees, partly
cloudy), `overcast` (Kloofendal overcast, no direct sun, so no shadow passes at all), `dawn` (misty
dawn: Syferfontein 6d, sun 6 degrees, heavy haze and a whole-timeline ground mist). All CC0 from Poly
Haven via `data/assets.json` (`skies`) and `scripts/fetch-assets.py`. A site that fixes its own sun
(Barnet) keeps its own light whatever the preset: it uses the dawn sky, its own azimuth and elevation
and its own dated mist.

### 6. Tiers

| Tier | Shadows | AA | AO | Mirror | Extras |
|---|---|---|---|---|---|
| low | none | canvas MSAA | none | sky photograph only | tone mapping in the materials, no post |
| medium | 1 map 2048, fitted, snapped | 4x MSAA | GTAO half res, 6 samples | 0.4 x screen, every 3rd frame | bloom (4), grade, grain, vignette, auto-exposure |
| high | 2 cascades 2048 | 4x MSAA + TAA | GTAO half res, 8 samples | 0.5 x screen, every 2nd frame | + bloom (5), sun shafts |
| cinematic | 3 cascades 4096/2048/2048 | 4x MSAA + TAA | GTAO full res, 12 samples | 0.75 x screen, every frame | + bloom (6), depth of field at eye level |


`low` (unchanged path: direct to screen, AgX in the materials, no shadows, sky-only water),
`medium`, `high`, and the new `cinematic` (content of High plus 3 cascades with a 4096 near map,
full-resolution AO with 12 samples, mirror at 0.75 every frame, depth of field). See the table below.

## Method

`node tests/look-shots.mjs <label> [--tiers=low,medium,high,cinematic] [--bench=N] [--only=a,b] [--qs=look=golden]`
captures eleven fixed cameras: London `bridge`, `bridge-low`, `bridgehead`, `city`, `overview` at 1616,
`city` at 150, `overview` at 2000 BCE, eye level in Thames Street (1616) and Fish Street Hill (1300) using
the cameras and camera sequence of `tests/street-shots.mjs`, Barnet 1471 and Stonehenge's default view.
Iterations are in `docs/screenshots/look/`: `v0` (before, all tiers), `tm-agx|neutral|aces` (tone mapper
comparison), `v1`, `v2`, `v3`, `v3b`, `v4` (final, High), `tiers` (Low / Medium / Cinematic side by side),
`p-clear|golden|overcast|dawn` (presets), `p-golden-cine` (golden hour on Cinematic).
Each iteration was judged against what a photograph of such a scene would look like, not against the
previous render.

## Iterations and critique

**v0 (before).** ACES at a fixed exposure of 0.72. The sun was counted twice (the photographed sun disc
lit the scene through the environment map and again as the directional light) and a hemisphere light
filled on top, so shadows were filled flat and the light had no direction. Water was the stock `Water`
shader: a chrome mirror with a tiling normal map, no depth, no shore. Fog was squared-exponential and
tinted the distance green-yellow. One shadow map around the point of interest: blocky near the camera,
nothing beyond ~1 km. No camera response at all. Reads as CG because of: mirror water, flat directionless
fill, saturated "plastic" colour (yellow-green ground, orange roofs), crisp aliased edges, green fog.

**v1.** AgX/Neutral/ACES compared (AgX chosen, with a look stage). New water, cascades, aerial
perspective, cloud shadows, presets. Critique: about a stop too dark (metered for 18% grey under AgX);
distant land went olive-yellow (wavelength-dependent extinction taking out blue while the in-scatter
colour, taken from the photograph's dark horizon band, did not put it back); GTAO drew striped bands
across open downland at Stonehenge (screen-space samples spanning hundreds of metres); a white surf line
ran along the quay wall; shallow marsh pools looked like ice; cloud shadows too dark and blotchy; grain
and vignette visible as effects.

**v2.** Meter recalibrated (K = 12.5), AO faded beyond 120–450 m, near-grey extinction, in-scatter
pulled towards the mean sky radiance, darker silty water body, scum line instead of surf. Critique:
Barnet's dawn mist was a white-out (after normalisation the mist was lit like noon, plus a large
direct-sun term from a 6-degree sun); Stonehenge and the London overview were murky olive; under the
bridge arches the mirror image showed bright white patches (the mirror camera sat below the haze base,
so everything in the reflection was hazed far more than in the real view).

**v3 / v3b.** Heights in the haze integral taken as absolute (the mirror camera sees the same air), a
proxy for far water inside the mirror (later found to do nothing and removed, see the follow-up section), mist lit by about half the sky's radiance and only a little of
the sun, partial auto-exposure (centre- and bottom-weighted matrix meter, 30% of the way from the
meter to the scene average, ±1 EV, adapting over about a second). Critique: at 50% the auto-exposure
made the aerial views milky; reduced to 30%. Barnet is now a readable, warm misty dawn. Aerial views
remain the weakest frames (see below).

**v4 (final, High).** Street and river views are the strongest: the bridge from the water reads as a
photograph of a model under real daylight; the street views have directional sun, cool sky-lit shade,
soft occlusion in corners and believable distance haze. Remaining CG tells are listed at the end.

**Presets.** Golden hour (backlit from the west-south-west, warm haze glow, glitter on the water) and
overcast (no shadow passes, soft sky light, the most "photographic" of the street views) both hold up.
Misty dawn is deliberately heavy; on the wide views it hides most of the city, which is what a real
misty dawn does but may not be what a viewer wants. Golden hour and dawn wide views are hazier than the
clear afternoon by design.

## Follow-up fixes (shadowed ground, bridge arches) and accessors

**Ochre shadowed ground (Thames Street).** Cause: the image used for image-based lighting was upside down.
`HDRLoader` leaves the rows in the photograph's order and flips them on upload (`flipY = true`); the
lighting copy built in `look/sky.ts` was a fresh `DataTexture`, whose `flipY` defaults to false. So every
physical material was lit by the ground-bounce hemisphere from above and by the sky from below: ground in
shadow (lit only by that "sky") took the colour of the bounced earth, a saturated ochre, with a hard edge
against the sunlit sand; shade sides of walls were warm instead of cool; and the aerial views carried an
olive cast. Not the bounce tint itself, the terrain albedo, the street shader's colours or the cloud
shadows: the street was still ochre with clouds and AO switched off (`docs/screenshots/look/fix-*`). Fix:
`light.flipY = true` in `engine.ts`. Shadowed ground is now a darker, cooler, desaturated version of the lit
ground in all four presets and at 150, 1300 and 1616 (`compare/fix-thames-street-1616.jpg`,
`compare/fix-streets-presets.jpg`).

Found on the way: Lambert and Phong materials (the ground-cover tufts of `ground/wrapLayer.ts`) get no
image-based light in three.js, and once the photographed sky replaced the hemisphere light they were lit
by the sun alone: black under the overcast preset and in every shadow. A sky/ground fill matching the
image-based light (`LOOK_HEMI`, a separate shared uniform; LOOK_A stays ten vec4s) is now added for
non-physical materials in the shared light chunk.

**White patches through the bridge arches.** Investigated by rendering the water's terms separately
(`compare/fix-arches-mirror-vs-mean-sky.png`): the patches are the far reach of the river reflecting the
sky to the west, the bright, sunward side, at a grazing angle, framed by dark stone. Replacing the mirror
image with the sky's mean radiance makes the openings exactly as bright as the open water nearer the
camera, which shows they are not a stand-in or depth error. The "far-water stand-in" plane added earlier
did nothing (seen from below by the mirror camera it was back-face culled) and has been removed. Changes:
the GGX glitter lacked its geometry term (blew up at grazing angles); grazing reflectance of distant water
is now roughness-aware; and at grazing angles the mirror image is blended towards a broad band of sky.
**Honest result:** the openings are now about the brightness of the horizon sky above the bridge rather
than brighter than it, but they still read as bright patches (`compare/fix-arches-before-after.png`).
That is what a calm reach reflecting a bright western sky does; making them match the darker near water
would mean inventing an occluder. If a darker look is wanted it is a grading decision, not a fix.

**Accessors for other renderers** (`engine.ts`; values are copies, safe to keep):
- `getSun()` returns `{ direction, color, intensity, irradiance, elevationDeg, azimuthDeg, visible }`:
  direction towards the sun (world), the DirectionalLight's colour (unit luminance) and intensity
  (irradiance facing the sun, scene units), the same as an RGB irradiance, and whether there is a direct sun.
- `getAtmosphere()` returns the aerial-perspective layers (`aerosol`, `haze`: density per metre, base
  height, scale height), per-channel `extinction`, in-scatter colours (`inscatterAway`, `inscatterToward`,
  `inscatterDown`, `lobePower`), `sunGlow` (colour, Henyey-Greenstein g), the current `mist` (or null),
  `clouds` (tile size, threshold, softness, strength, deck height, drift offset), `skyIrradiance`,
  metered `exposure` and `toneMap`. The doc comment on the method gives the integral to evaluate.
Photo mode can use these instead of reading `LOOK_A`; the array layout is unchanged in the meantime.

## Frame times

`window.__ltt.benchmark(20).msPerFrame` (synchronous renders flushed by a pixel read, so it includes the
mirror pass at its real cadence and the half-rate cascades), Apple M3 Max, headless Chrome (ANGLE/Metal),
1600 x 900, device pixel ratio 1. Before = `docs/screenshots/look/v0/stats.json` (minimum of 3 runs,
load average about 10 on 14 cores). After = minimum over every run made after the final pipeline was in
(count of 20-frame runs in brackets; `docs/screenshots/look/bench*/`).

Frame times were measured before the follow-up fixes; the fixes add one sky lookup on distant water and a
hemisphere term on Lambert materials, which should not move these numbers measurably (not re-measured).

**The machine was heavily shared throughout** (load average 5–20; other agents were running a GPU path
tracer for photo mode, two browser end-to-end suites and Stonehenge captures for most of the session).
The same view and tier varied by up to 4x between runs, so the minimum is the only usable statistic and
single cells are uncertain by a few milliseconds. Barnet's "before" was also taken with the analytic sky.

| View | Low before → after | Medium before → after | High before → after | Cinematic |
|---|---|---|---|---|
| london-bridge-1616 | 6.7 → 6.8 (20) | 18.5 → 16.5 (27) | 21.1 → 18.0 (24) | 19.8 (11) |
| london-bridge-low-1616 | 6.7 → 7.7 (21) | 21.6 → 15.6 (27) | 23.2 → 19.8 (24) | 22.7 (16) |
| london-bridgehead-1616 | 6.9 → 6.9 (21) | 21.4 → 16.6 (27) | 25.3 → 18.4 (19) | 26.1 (13) |
| london-city-1616 | 10.0 → 8.4 (13) | 21.2 → 18.1 (19) | 26.6 → 22.7 (11) | 28.9 (8) |
| london-overview-1616 | 9.8 → 10.1 (13) | 23.7 → 20.9 (8) | 27.9 → 26.5 (11) | 28.4 (8) |
| london-city-150 | 8.2 → 9.1 (13) | 18.9 → 16.6 (13) | 20.3 → 17.3 (11) | 20.1 (8) |
| london-overview-2000bce | 7.5 → 7.5 (13) | 18.3 → 18.1 (13) | 19.3 → 19.7 (11) | 21.4 (8) |
| london-thames-street-1616 | 10.8 → 9.7 (13) | 25.8 → 17.1 (13) | 24.1 → 15.1 (7) | 30.3 (8) |
| london-fish-street-hill-1300 | 6.5 → 10.6 (13) | 20.6 → 15.1 (13) | 22.1 → 20.4 (11) | 24.9 (8) |
| barnet-1471 | 5.1 → 6.7 (21) | 14.3 → 16.2 (21) | 11.5 → 16.3 (19) | 15.8 (16) |
| stonehenge-default | 7.5 → 6.1 (21) | 21.1 → 24.1 (21) | 16.1 → 17.4 (19) | 21.0 (16) |

Reading it: **Medium** is faster than before on every London view (mainly the mirror pass at 40% of the
screen and every other frame without small detail, and GTAO used for its occlusion texture only, without
the pass's two full-screen copy/blend passes); it is at or under 16 ms on the bridge, bridge-low,
bridgehead, Thames Street, Fish Street Hill and city-150 views, not on the city (18), overview (21) or
2000 BCE overview (18) views. After this table was measured the Medium tier was trimmed once more (mirror
every third frame, 6 AO samples); a re-run of Medium on a still busier machine gave higher numbers
across the board (`bench5`), so the effect of that trim is not measured. **High** (TAA, two cascades,
sun shafts) is faster than before on most views and within 25 ms except the overview (26.5).
**Cinematic** is within 40 ms everywhere (20–31 ms). **Low** is unchanged within noise on most views; Barnet
(5.1 → 6.7) and the river-level bridge view (6.7 → 7.7) may be 1 ms slower (the aerial-perspective
integral and the new water shader); Fish Street Hill's eye-level camera did not land on the same spot
in the two runs, so that row is not a like-for-like comparison.

## What still gives it away, and what would fix it

This is **not photorealistic**. The river and street views at High or Cinematic can pass as a photograph of
a very good model at a glance; nothing passes as a photograph of a real place. In rough order of how much
each one costs the illusion:

1. **Geometry regularity (outside this remit).** Houses are a few prisms repeated hundreds of times at the
   same scale, with dead-straight ridges and eaves, no sag, no lean, and identical spacing; the overview's
   street lattice and the blocky field patchwork (terrain vertex colours on a 12–20 m grid) read as a game
   map from any height. Fix: per-building variation in height, jetty depth, roof pitch and ridge sag;
   irregular plots; a terrain colour map at a few metres per texel instead of vertex colour.
2. **Figures (outside this remit).** People and animals are faceted mannequins; at eye level they are the
   first thing the eye rejects. Fix: skinned, clothed figures with a few poses, or remove them from close views.
3. **Texture repetition and uniform materials.** Every plaster wall is the same scan at the same scale with
   the same roughness; no soot, staining, rising damp, weathering by height or exposure. Fix: per-instance
   dirt/age masks and roughness variation (could be added through the shared chunk mechanism used here).
4. **Bounce light is only "from the ground".** Shaded walls get sky light and a uniform ground bounce, but not
   the warm light of the sunlit wall opposite them, and windows are flat dark panes with no interior. Fix:
   screen-space GI (a few cones on the half-resolution depth) or baked irradiance probes per district.
5. **The sky is a still photograph from South Africa.** Its clouds do not move, while their shadows do; the
   shadows match its cloud cover statistically, not cloud by cloud; its horizon (and the colour of its haze)
   is not an English one. Fix: an analytic or volumetric sky with clouds that cast their own shadows, or a
   British time-lapse HDR set.
6. **Distance and aerial views** are still the weakest frames: the haze is physically scaled but its colour
   comes from the photograph's horizon band and the far terrain is flat colour, so the overview reads as an
   olive-grey wash rather than the blue-grey layering of an aerial photograph (part of the olive cast was the
   upside-down lighting sky fixed in the follow-up; the far terrain's flat colour remains).
7. **Water**: no refraction of the bed beyond depth tint, no tide (always high water), no geometric waves,
   and the mirror image leaves out small detail (people, props). Wakes are the populace layer's flat quads.
8. **Camera**: no motion blur; the temporal AA has no motion vectors, so fast boats and people are resolved by
   clipping and can soften when they move; depth of field only on Cinematic, and physically small.
9. **Light units are normalised per sky.** Dawn, overcast and noon all deliver the same irradiance to level
   ground and are then metered, so time of day reads through colour, direction and shadow, not through the
   brightness difference a photographer would also see across a day.

## Files

New: `src/scene/look/{atmosphere,post,shadows,sky,rig,water,presets}.ts`, `tests/look-shots.mjs`,
`tests/unit/look.test.ts`, this file. Rewritten: `src/scene/engine.ts` (all but `getRenderContext` /
`setRenderOverride`, which are unchanged), `src/scene/mist.ts` (keeps `MIST_PARAMS` / `MIST_COLOR`, which
photo mode reads; the shader moved to `look/atmosphere.ts`), `src/scene/fx.ts` (fire smoke lit and fogged).
One-line hooks: `src/scene/pop/smoke.ts` and `src/scene/pop/boats.ts` call `applyLookFog(material, { lit: true })`.
UI: `src/components/Viewer.tsx` adds the Cinematic option, a "Light" selector (`data-testid="look-select"`)
and the `?look=` / `?tonemap=` URL parameters. Assets: `data/assets.json` gains `skies` (three CC0 Poly Haven
pure skies) and `scripts/fetch-assets.py` fetches them. Photo mode's composite declares `uniform vec4 ltA[10]`
and reads `LOOK_A`: keep that array at ten vec4s.

