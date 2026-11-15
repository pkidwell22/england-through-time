# Photo mode: path-traced stills

Photo mode renders the current view at the current year with physically simulated light (soft
sun shadows, light bounced between surfaces, real reflections, sky light from the photographed
HDR sky) and lets it converge over a few seconds into a still that reads far more like a photograph
than the live, rasterised view. It is for stills only: any camera move or year change returns to the
live view.

Every image it makes is a **reconstruction**. The on-screen mode and the saved PNG carry the
caption "*Site* · *year* · Reconstruction rendered from a 3D model, not a photograph or a record".
The caption is burned into the PNG by default; a checkbox saves it without.

## How to use it

- **Photo** button (bottom-left layer switches, `data-testid="photo-mode"`), or `?photo=1` in the
  address (opens about 3 s after the scene is ready; `&photoDelay=<ms>` changes the wait,
  `&photoSamples=<n>` the sample target). A `ltt:photo` window event also opens it (used by the tests).
- Playback pauses, labels and the evidence tint are hidden while the photo is made (and restored on
  exit). The panel shows the stage (baking, building, compiling), then *samples / target · seconds*.
- **Samples**: 64 / 160 (default) / 400 / 1000. Accumulation stops at the target.
- **Size**: 1× = the canvas in CSS pixels; 2× = twice that (restarts the accumulation; about 4× slower).
- **Depth of field**: off (pinhole), f/8 or f/2.8, with the real focal length of the view (35 mm film
  gauge); **click the image to focus** (the distance is picked with the ray-tracing BVH).
- **Exposure**: ±2 EV around the automatic exposure (see below). **Denoise**: on by default.
- **Save image** (`data-testid="photo-save"`): PNG at the photo's resolution, caption burned in unless
  unticked. **Back to live view** (`data-testid="photo-exit"`), or move the camera / change the year.

While photo mode is open a transparent layer covers the scene, so a stray drag cannot move the camera.

## How it works

```
enter → wait until the camera is still (8 identical frames) → measure the live frame's mid-tone
      → SNAPSHOT BAKE (main thread, src/scene/photo/snapshot.ts)
      → sky and sun (env.ts) → BVH in a Web Worker (three-mesh-bvh GenerateMeshBVHWorker)
      → progressive path tracing (three-gpu-pathtracer WebGLPathTracer, 2×2 tiles, adaptive samples per frame)
      → composite: live haze/aerial perspective + mist on the photo's depth, matched exposure, the live tone mapper,
        edge-aware denoise → canvas (engine.setRenderOverride)
exit  → dispose BVH, textures, render targets, worker; release the override; restore labels/evidence tint
```

Library: **three-gpu-pathtracer 0.0.24** with **three-mesh-bvh 0.9.8**, pinned exactly in
`package.json`. 0.0.24 is the last release that supports three 0.180 (0.0.25 and later require
three ≥ 0.185). No Next.js configuration was needed; the BVH worker is bundled by webpack from
`three-mesh-bvh/worker`.

### 1. Snapshot baker (`snapshot.ts`, `capture.ts`, `terrainBake.ts`)

The live scene is not path-tracer friendly: buildings, trees and props are InstancedMeshes whose
per-instance life window (`aLife` against `uYear`) is applied in the vertex shader; figures walk,
ground cover is draped and boats bob in vertex shaders; landmarks under construction or in ruin are
cut by a material clipping plane; the terrain colours itself in its fragment shader. The baker turns
what the live frame draws into plain, static, world-space meshes, one per output material:

- **GPU vertex capture.** Every mesh with an instanced or patched vertex stage is drawn once more as
  points with *its own vertex shader* (all `onBeforeCompile` patches chained) plus a capture tail
  that writes the world position, normal, final vertex colour (instance tint included) and texture
  coordinate of each vertex of each instance to a 4-target float render target (one pixel per vertex,
  1024² vertices per pass), which is read back. So a building half-way through its appear/vanish window
  is scaled exactly as the rasteriser scales it, a building not yet built or already gone collapses to
  a point and is dropped as degenerate, and figures, draped cover and camera-facing cards are where
  the live frame shows them. Plain meshes (most landmark geometry) are transformed on the CPU.
- **Life window on the CPU first.** For life-patched instances the same smoothstep life function
  is evaluated on the CPU, and dead instances are never captured.
- **Landmark phases.** Hidden phase groups are skipped (the engine already hides absent and
  superseded phases). Active clip planes (a phase under construction, being taken down or ruined)
  are applied triangle by triangle (Sutherland–Hodgman), so the photo shows the same partly built
  state as the live view (open cut, as live).
- **Level of detail.** Whatever the live frame uses at that moment: the fabric's near/district/overview
  houses by distance (`FabricLayer.setLod`, driven by the camera), the trees' card LODs.
- **Terrain.** The geometry as is (river bed under opaque water dropped). Its shader-computed colour
  (scanned grass, forest floor, mud, earth, dry ground blended per vertex, land-cover tint) and draped
  overlays (street surfaces, ground decals) are rendered with lighting switched off into top-down
  albedo tiles of 1024² texels, arranged as a quadtree (root offset so the camera never sits on a tile
  corner) that is refined where a texel is coarser than a screen pixel, 40 tiles in all: the nearest
  tiles are 20–330 m across depending on the camera (2–32 cm per texel), the farthest about 20 km. The
  ground is kept out to the horizon. Draped layers that blank themselves for the under-water reflection
  camera (draw range or instance count set to 0 in `onBeforeRender`) are restored for the capture.
- **Materials.** Standard, Lambert, Phong and Basic materials become `MeshPhysicalMaterial` with the
  same colour, map, normal map, roughness and metalness maps (texture clones sharing the live images);
  bump maps are dropped (not supported by the path tracer). The 0.3×colour "legibility" self-light of
  flat stand-in tints is removed; fire emission is kept. Materials with the same signature are merged.
- **Leaves and cut-outs.** Alpha-tested cards keep their alpha test. Two-sided cards carry outward
  "crown" normals that the live view keeps on both faces; the path tracer flips the normal of a
  back-face hit, which turned every crown into a stack of lit and unlit plates, so each such card is
  emitted as two single-sided copies (one per winding). Cut-out cards that the live view keeps out of the
  shadow map (tree impostors) cast no shadow here either, and the impostors' horizontal "crown-top" card,
  a device for views from above, is dropped unless the camera looks steeply down.
- **Water.** The live water planes are replaced by a surface at y = 0 built from every terrain cell
  that dips below the datum (so the waterline is where the ground crosses high water, as live; ground
  lying wholly deeper than 1 m is dropped). A true dielectric (specular and diffuse lobes) left a
  non-converging speckle at grazing angles in this tracer, and sub-pixel ripple normals aliased into
  noise, so the water is a near-mirror conductor whose Schlick reflectance has water's angular curve:
  about 6 % at normal incidence (2 % Fresnel plus the live water's silty olive body), rising to a
  mirror at grazing angles, roughness 0.1 (softened, stretched reflections; it converges without speckle). What this loses: the body colour does not darken in shadow,
  and the surface is glassy calm (no ripples, wakes or foam). Landmark "water" surfaces (moats, ponds)
  get the same material. Window glass becomes a polished dark dielectric.
- **Left out.** Lines (district outline), points (fire sparks, chimney smoke), the cloud deck and
  the live sky meshes (the sky is the environment), translucent map-style overlays that are not
  draped on the ground, invisible helpers (the tree probe), labels (DOM), and anything smaller than
  0.6 px on screen.
- **Region and budget.** An instance or triangle is kept when it is within 7 km of the camera and
  inside a frustum 35 % wider than the view, or within 70 m of the camera (off-screen neighbours
  still cast shadows and reflect), or when its shadow can fall into the view (a sphere swept away from
  the sun). The ground is kept out to the horizon. Instances are ranked by projected size and taken
  until the budget (4 M triangles) is spent.

### 2. Path-traced render (`photoMode.ts`, `env.ts`)

- **Sky and sun.** The live view's HDR sky photograph (Kloofendal, unclipped: the sun disc peaks near
  73,000 and carries about half the sky's energy) lights the scene and fills the background. Its own
  sun is the photograph's sun with its true angular size, so shadow edges are soft and the sun/sky
  balance is physical. The image is turned so its sun lies exactly at the azimuth of the live view's
  shadow-casting light. The path tracer stores environment maps as half floats (max 65,504), so the
  data are divided by a scale that keeps the sun in range and the intensity is multiplied back
  (without this the sun overflows to infinity and the image turns black or NaN). If the live sun's
  height differs from the photograph's by more than 3°, the sun disc is cut out of the image and
  replaced by a directional light of the same energy at the live direction. A scene whose background is
  three.js's analytic Sky shader gets that sky rendered to a cube map with the live parameters and the live
  sun as a directional light (hard-edged shadows). At the time of the test run every site, Barnet's dawn
  included, offered a float equirectangular sky to copy (`env: "hdr"` in results.json), so this fallback was
  not exercised.
- **Integrator.** Multiple importance sampling of environment and BRDF, 5 bounces (+3 transmissive),
  glossy filtering 0.5, 2×2 tiles, an adaptive number of samples per frame (aiming at about 40–80 ms a
  frame so the page stays responsive), stopping at the target.
- **Haze and mist.** Distance haze is not path traced (a homogeneous fog volume would take thousands of
  samples to settle). Instead a depth pass of the snapshot drives the live view's aerial perspective and
  ground mist, with every parameter read each frame from `engine.getAtmosphere()` and the sun direction
  from `engine.getSun()`, evaluated with the integral documented on `getAtmosphere()` (two exponential
  layers, per-channel extinction, the away/toward/downward in-scatter colours and the sun glow), then the
  mist. When the live view's aerial perspective is off, three.js's FogExp2 colour and density are used.
- **Units.** The photo shows the sky photograph at the live view's scale (`scene.backgroundIntensity`, the
  rig's k), so its radiance is in the live scene units: the haze colours and the live meter apply as they are.
- **Camera response.** The live final pass is reproduced: exposure, the preset's white balance and
  saturation, the tone mapper from `getAtmosphere().toneMap` (AgX with the preset's look contrast and
  saturation, or Neutral/ACES), the sRGB transfer, and lift/gamma/gain in display space (preset values from
  look/presets.ts for `engine.getLook()`). Not reproduced: bloom, sun shafts, vignetting, film grain and the
  live screen-space occlusion (the path tracer computes real occlusion). The `agxLook` function is copied from
  look/post.ts (not exported); if that pass changes, the photo's tone will drift.
- **Exposure.** Matched automatically: after 6 samples the photo's median display luminance is bisected onto
  the live frame's through the display chain above, which also absorbs the live auto-exposure. The ratio of
  the matched exposure to the live meter (`getAtmosphere().exposure`) is recorded in `envInfo` as a
  consistency check. The slider offsets it by ±2 EV.
- **Denoise.** three-gpu-pathtracer's edge-aware (smart) denoiser on the tone-mapped image, stronger
  while the image is grainy and light once it has converged.
- **Depth of field.** `PhysicalCamera` with the live view's lens; f-number from the panel, focus by
  click (BVH ray cast).
- **Camera or year change.** Ends photo mode and hands the frame back to the live view (the
  snapshot is only valid for one view). The camera is compared every frame with a tolerance.

### 3. Clean-up

Exit disposes the path-tracing material's data textures (BVH, vertex attributes, materials, the
texture array, environment CDFs, lights; some of the library's helpers have no dispose of their own
and are swept), both path-tracing render pipelines, the merged geometry and intermediate geometry,
the BVH worker, the snapshot's meshes, material texture clones and terrain tiles, the environment
copy, and the composite targets; it then releases the render override and restores labels and the
evidence tint. Camera, year and quality are never touched.

## Requirements and limits

- WebGL 2 with float render targets and float blending (`EXT_color_buffer_float`, `EXT_float_blend`),
  as on any recent desktop GPU. Tested on an Apple M3 Max in headless Chrome (ANGLE on Metal):
  headless works; no real display is needed.
- The bake runs on the main thread (1–6 s, the page is unresponsive meanwhile, with a progress line);
  the BVH builds in a worker. JS heap rises by 0.4–1 GB while a photo is open (geometry, BVH and the
  path tracer's CPU-side textures) and returns on exit.
- Budgets: 4 M triangles, 7 km for buildings and props (ground to the horizon), 40 terrain tiles of
  1024², texture layers of 1024² (512² if more than 110 distinct textures).

## Measurements

`node tests/photo-shots.mjs [filter] [samples]` (headless system Chrome through playwright-core with the
same flags as `tests/dbg.mjs`, plus `--expose-gc`; 1600×900, device pixel ratio 1, quality High, Apple M3
Max). For each view it saves the live frame (`<name>-live.png`), the converged photo with its burned-in
caption (`<name>-photo.png`) and a side-by-side pair (`<name>-pair.png`) in `docs/screenshots/photo/`, and
writes every number below to `docs/screenshots/photo/results.json`. Other agents were editing the scene
while it ran; a hot reload that rebuilds the page mid-shot is retried (up to 3 attempts).

| View | Live ms/frame, live triangles | Photo triangles (terrain) | Instances kept / culled | Clipped tris | Bake s | BVH s | 160 samples s (spp/s) | Heap MB before / in photo / after exit | GPU textures before / in / after |
|---|---|---|---|---|---|---|---|---|---|
| `london-bridge-low-1616` | 22.54, 2.34 M | 0.86 M (0.22 M) | 9,738 / 38,176 | 0 | 2.3 | 4.4 | 24.1 (6.64) | 731 / 1728 / 754 | 258 / 323 / 259 |
| `london-bridgehead-1616` | 30.32, 4.09 M | 0.75 M (0.16 M) | 11,258 / 17,773 | 0 | 2.4 | 3.2 | 25 (6.4) | 762 / 1664 / 775 | 254 / 319 / 255 |
| `london-thames-street-1616` | 23.33, 4.97 M | 0.63 M (0.09 M) | 7,903 / 57,227 | 0 | 3.7 | 3.2 | 47.4 (3.38) | 814 / 1619 / 829 | 259 / 324 / 260 |
| `london-bridge-150` | 32.93, 1.27 M | 0.33 M (0.15 M) | 3,524 / 11,930 | 0 | 0.9 | 1.5 | 12.1 (13.22) | 833 / 1175 / 842 | 216 / 281 / 217 |
| `london-bridge-2000bce` | 18.94, 1.05 M | 0.74 M (0.15 M) | 49,798 / 11,014 | 0 | 5.5 | 2.9 | 22.7 (7.05) | 878 / 1353 / 866 | 176 / 241 / 177 |
| `stonehenge-default` | 20.41, 2.94 M | 1.34 M (0.83 M) | 643 / 4 | 105,069 | 1.0 | 4.0 | 7.2 (22.22) | 994 / 2051 / 1013 | 139 / 204 / 140 |
| `barnet-1471` | 22.56, 1.43 M | 0.61 M (0.09 M) | 3,778 / 7,702 | 0 | 0.6 | 2.4 | 10.7 (14.95) | 412 / 1152 / 418 | 196 / 261 / 197 |
| `london-bridge-1195-construction` | 74.87, 1.56 M | 0.45 M (0.16 M) | 5,115 / 13,010 | 5,012 | 0.9 | 2.0 | 11.2 (14.29) | 1506 / 2004 / 1520 | 228 / 293 / 229 |
| `london-westminster-abbey-1450-construction` | 20.11, 1.83 M | 0.15 M (0.08 M) | 2,225 / 17,151 | 8,168 | 0.7 | 1.4 | 18.3 (8.74) | 883 / 1056 / 886 | 212 / 287 / 223 |

2×: `london-bridge-low-1616` at [3200, 1800]: 96 samples in 30 s; heap in photo 1828.9 MB.

Repeated enter/exit (`london-bridgehead-1616`, 8 samples each), after exit and GC:

| Cycle | Geometries | GPU textures | JS heap MB |
|---|---|---|---|
| before | 573 | 254 | 736.3 |
| 1 | 573 | 254 | 747.7 |
| 2 | 573 | 254 | 748.1 |
| 3 | 573 | 254 | 748.4 |
| 4 | 573 | 254 | 748.5 |

Camera, year and quality identical before and after photo mode in every view: yes

Notes on the table. "Live triangles" is what the rasteriser draws per frame (shadow cascades, reflection and
all LODs included); the photo keeps only what is in or near the view and larger than 0.6 px. "Clipped tris" are
triangles cut at a landmark's construction/ruin clip plane; non-zero in the two construction views and at
Stonehenge (monuments being built at 2400 BCE). Time to 160 samples excludes bake, BVH and shader compilation
(about 1–3 s). The JS heap includes the whole app; it returns to within a few MB of its previous value after
exit (the remaining drift is the live app's own allocation and GC timing). The per-view "after" texture
counts in the table are one higher than "before" because they were measured before the last leak was fixed
(the path tracer's texture-array render target, now released through the target itself); the repeated
enter/exit run above was measured after the fix and is flat. The 2× render holds about 1.8 GB of JS heap
while open (the live app included).

## Honest assessment

Pairs most worth looking at: `london-bridge-low-1616-pair.png` (the river view), `london-thames-street-1616-pair.png`
(eye level), `london-bridgehead-1616-pair.png` (the district from above), `london-bridge-2000bce-pair.png`
(forest), `london-westminster-abbey-1450-construction-pair.png` (partly built nave).

What gets closer to a photograph:
- Light is coherent for the first time. Sun and sky come from one photograph, shadows have the soft edges of
  a real 0.5° sun, shadowed walls are lit by blue skylight and by light bounced off the street and the facing
  houses, eaves and jetties darken the walls under them without screen-space halos, and nothing glows.
- Reflections are real: the bridge, the ships, the banks and the clouds in the river, sky in the window glass.
- The eye-level street is the most convincing frame: the light in a narrow street (bright upper storeys, dim
  bounced light below) is exactly what a raster pipeline gets wrong and a path tracer gets right.

What still gives it away, in order of damage:
1. Geometry. Walls are flat and perfectly straight, edges are knife-sharp, roofs have no sag, no ridge tiles,
   no gutters; window openings are mostly textures. Physical light makes this more obvious, not less.
2. Repetition. The same few house models and scanned textures recur across a whole view.
3. Figures are low-polygon mannequins; in a still at eye level they are the first thing the eye rejects.
4. No dirt, wear or weathering: no soot under eaves, no damp at wall feet, no moss, no staining, no rubbish,
   and the ground is an even, clean colour (its albedo is calibrated for the live lighting and reads dark here).
5. The water is glassy calm: no ripples, wakes, foam or tidal mud; reflections are too perfect for the Thames.
   Where the live water lets a shallow foreshore show through (the quay at the bridgehead), the photo shows
   water up to the wall: it has no shallow see-through water.
6. Far trees are impostor cards; at a distance they pass, closer than about 200 m they read as cut-outs.
   The tree level of detail is the live view's (the photo cannot ask the vegetation layer for richer trees).
7. Haze and mist are composited from depth, not path traced: no light shafts, no sun glow through mist.

**Verdict: the stills are not photorealistic.** They are good architectural-visualisation renders: the
lighting would pass, the content would not. Next to the live view they are a clear step (most of all at eye
level and on the river), but nobody would mistake them for a photograph for more than a moment, mainly
because of the geometry and the absence of dirt and wear. That is also why the caption is burned in.


## Follow-up: engine accessors, the sky-light fix and the four looks

After the live view's image-based light was found upside down and fixed (`light.flipY = true`, docs/LOOK.md),
and four looks were added (`?look=clear|golden|overcast|dawn`), photo mode was moved onto `getSun()` /
`getAtmosphere()` and checked against the live frame. The photo never used the live lighting copy (it lights
the snapshot with the sky photograph itself, `scene.background`), so the flip did not change the photo's light;
it changed the live frames the photo is compared with. Re-shot pairs: `london-bridge-low-1616-pair.png` and
`london-thames-street-1616-pair.png` (clear), `london-bridgehead-1616-overcast-pair.png`,
`london-bridge-low-1616-dawn-pair.png` (bridge-low was re-shot again after the water roughness change).

| Pair | Look | Photo rotation / live background rotation (rad) | HDR / live sun elevation | Sun energy photo ÷ live | Live meter | Matched exposure (× meter) |
|---|---|---|---|---|---|---|
| `london-bridge-low-1616` | clear | -1.8816 / -1.8816 | 47.9° / 47.9° | 0.946 | 1.131 | 1.0226 (×0.904) |
| `london-thames-street-1616` | clear | -1.8816 / -1.8816 | 47.9° / 47.9° | 0.946 | 1.131 | 10.1461 (×8.971) |
| `london-bridgehead-1616-overcast` | overcast | -1.9645 / -1.9645 | 23.1° / 23.1° | no direct sun | 1.2991 | 1.3427 (×1.034) |
| `london-bridge-low-1616-dawn` | dawn | 0.5371 / 0.5371 | 5.9° / 5.9° | 0.949 | 1.4415 | 0.7382 (×0.512) |

What matches:
- **Sky orientation and sun.** The rotation the photo applies equals the live background's to four decimals in
  every look, and the photograph's sun height equals the live sun's (47.9°, 23.1°, 5.9°), so shadows fall the
  same way and the background clouds are the same clouds in the same place. The photograph's sun disc carries
  0.95 of the live sun's irradiance (within the 15 % tolerance, so it was not rescaled); overcast has no direct
  sun and none is added.
- **Exposure, in the open.** River and roofscape views need 0.90–1.03× the live meter to match the live frame
  (clear and overcast): the photo's units and the live view's agree.
- **Overall look.** With the live grade reproduced, the clear, overcast and dawn pairs have the same colour,
  contrast and haze as the live frames; the dawn mist and the overcast haze match closely.

What does not:
- **Shaded streets.** At eye level in Thames Street the photo needs 9× (3.2 stops) more exposure than the live
  meter to match the live frame's mid-tones. The live view lights shade with an unoccluded sky (only
  screen-space occlusion darkens it) plus the meter's auto-exposure; a narrow street seen physically gets far
  less skylight. After matching, the photo's shaded ground and walls are a darker, cooler, desaturated version
  of the sunlit ones, which is right, but the shaded ground is still fairly even: the puddles, ruts and straw
  of the ground decal are in the albedo but their wet, glossy puddle surfaces are not (roughness is not baked),
  so the sky does not reflect in them as it does live.
- **Dawn exposure.** The dawn photo needs half the live meter (0.51×): it is brighter than the live frame at
  the same exposure, likely because the low, frontal sun reaches more of the scene through the mist in the
  photo (the mist is composited, not a medium that blocks light).
- **Water.** Darker and bluer than the live silty river, with smooth stretched reflections where the live
  water is broken by ripples and has foam along the quay. Overcast water is a dull mirror where live is grey.
- **Ground in the open.** Not dark and even any more under clear sky at a distance (the albedo tiles carry the
  live ground colours and the camera response now matches), but at the bridgehead the photo's foreshore is
  water up to the quay where the live view shows exposed mud.

## Files

- `src/scene/photo/photoMode.ts` – the mode: lifecycle, path tracer set-up, sampling, composite, save, exit.
- `src/scene/photo/snapshot.ts` – the baker (selection, budget, clipping, materials, water, assembly).
- `src/scene/photo/capture.ts` – GPU vertex capture through each mesh's own vertex shader.
- `src/scene/photo/terrainBake.ts` – terrain albedo quadtree tiles.
- `src/scene/photo/env.ts` – sky, sun alignment, half-float scaling, analytic-sky fallback.
- `src/scene/photo/caption.ts` – caption text and burn-in.
- `src/scene/photo/PhotoPanel.tsx` – the overlay (progress, options, save, exit).
- `src/components/Viewer.tsx` – additive: the Photo button, `?photo=1`, the `ltt:photo` event, and the panel.
- `tests/photo-shots.mjs` – the verification run described above.

## Requests to the engine owner

Photo mode uses `getRenderContext()`, `setRenderOverride()`, `getSun()`, `getAtmosphere()`, `getLook()` and
other public methods; it no longer reads `LOOK_A` or `MIST_PARAMS`. One copy remains: the final grade
(`agxLook` and the order of exposure, white, saturation, tone, transfer, lift/gamma/gain) from look/post.ts.
A `getGrade()` accessor (or an exported grade function) would remove it. The vegetation layer could offer an
optional `photoLod(scale)` hook so a still can use full tree models further out.

