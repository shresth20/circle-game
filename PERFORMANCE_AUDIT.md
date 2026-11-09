# Rendering and transition audit

Date: 2026-11-09

## Outcome

The front/side transition now follows one lifecycle: download, bounded decode,
hidden first paint, camera move, one-frame cut, settle. The outgoing scene stays
fully visible until the cut and the incoming scene cannot become visible until
its images have decoded and the browser has crossed a paint boundary.

The automated full-game run completed all six walls, a wrong-answer/game-over
and replay path, the controls, and the Safe Zone finale. It recorded 14 view
changes with:

- 0 checkerboard or missing-content events in the Chrome compositor trace;
- 0 dropped compositor frames during a view swing;
- 0 frames with both scenes partially visible;
- 0 missing images or page errors.

Physical Lenovo K10 and Chromebook testing is still required. CPU throttling
can model main-thread pressure, but it cannot reproduce a particular device's
GPU driver, thermal throttling, memory contention, or display panel.

## Root causes

### Confirmed

1. **The transition did not actually wait for a painted incoming scene.**
   `Camera.prewarm()` revealed the incoming scene, but its promise completed
   immediately afterward. `Camera.to()` then saw that the scene was already
   revealed and skipped its frame wait. A transition could therefore start
   before the browser had painted and uploaded a complete set of tiles.

2. **Decode readiness was time-limited rather than required.** A 700 ms
   `Promise.race` allowed the camera move to start while slow decodes remained
   in flight. A timeout is not evidence that an image is ready.

3. **The two complete scenes were deliberately blended.** The previous 70 ms
   blend exposed front and side views together. This accounts for the strong
   double image in the supplied transition frames; it was deterministic, not
   a network failure.

4. **Boot decoded the entire manifest.** All 91 WebP files represent about
   231.66 MiB as RGBA pixels, even though the shipped files occupy only
   10.47 MiB. Decoding all of them eagerly caused a memory/texture upload burst
   before most were needed.

5. **Later decode requests could bypass the intended concurrency limit.**
   Callers used `Promise.all` over a view's files. Only the initial loader was
   bounded, so camera and sprite preparation could still create decode bursts.

6. **Large composited surfaces were being rebuilt at camera boundaries.**
   Promoting/demoting large scene layers and animating raster scale makes Chrome
   choose new raster scales and repopulate tiles. The rectangular holes in the
   screenshots align with compositor tiles and later fill in; that is the
   signature of missing/late raster tiles, not a partially downloaded WebP.
   The retained scene layers, clipped full-screen overlays, transform-only
   parallax, and prepaint path prevent that churn.

7. **Audio graph creation blocked the first interaction.** The baseline trace
   contained an approximately 105 ms task while constructing `AudioContext` in
   the Play gesture. The graph is now constructed while the welcome/loading
   screen is present and only resumed by the user gesture.

### Not found in the measured flows

- Broken image URLs or repeated network requests: the asset cache holds one
  `Image` promise per build path; all validation runs reported no missing image.
- Layout shifts during camera moves: measured cumulative transition shift was 0.
- A z-index race as the primary defect: layer order remained stable once scene
  visibility was controlled by the camera state machine.
- Garbage collection or a long JavaScript task during a measured view swing:
  the view swings stayed at a 17 ms worst frame in the desktop and throttled
  stress runs. Startup can still contain a long audio/browser initialization
  frame, but it is outside gameplay transitions.

## Implementation

| File | Change | Reason |
| --- | --- | --- |
| `js/core/assets.js` | Shared two/four-worker decode queue, four/eight-worker download pool, capability profile, boot decodes only welcome and initial-view assets | Prevent duplicate requests, unbounded decode bursts, and the 232 MiB eager-decode spike |
| `js/scene.js` | Await decode plus forced layout and two `requestAnimationFrame` boundaries; removed timeout race; hard cut at 40% of a transform-only 700 ms swing | The next scene must be paint-ready; never expose both scenes |
| `js/core/sprites.js` | Accumulated-time 30 Hz state updates on low-power devices | Reduce sprite work without slowing animation time |
| `js/core/audio.js` | Added `prime()` for welcome-screen AudioContext creation | Move one-time construction off the Play frame |
| `js/main.js` | Await initial scene preparation and prime audio before leaving loading/welcome | Establish a ready first frame |
| `js/core/perf.js` | Added scene-blend detection, device profile, decode and swing metrics | Make overlap and frame pacing testable |
| `tools/perf-lab.cjs` | Chrome trace, CDP composited-frame capture, low-power override, repeated transition/full-game scenarios, strict failures | Detect real compositor failures that page screenshots hide |
| `tools/asset-audit.cjs` | Disk/dimension/RGBA accounting by asset category | Measure runtime memory rather than compressed bytes only |

No gameplay rules, geometry, artwork, camera views, or learning content were
changed. The project remains vanilla HTML/CSS/JavaScript with local GSAP.

## Asset report

The current build pipeline already crops/re-packs source art, removes unused
sheets, and writes WebP. Re-encoding it again would trade visual quality for a
small disk change without reducing decoded RGBA memory, so no artwork was
recompressed or resized in this fix. Consequently the before/after dimensions
for this pass are identical; the improvement is which working sets are decoded
at once. `node tools/asset-audit.cjs --json report.json` writes the full 91-file
built-dimension, disk-size, and decoded-size inventory.

| Set | Files | Disk | Potential decoded RGBA |
| --- | ---: | ---: | ---: |
| Images | 54 | 3.45 MiB | 68.16 MiB |
| Walls | 2 | 0.08 MiB | 1.66 MiB |
| Sprite sheets | 35 | 6.95 MiB | 161.84 MiB |
| **Total build** | **91** | **10.47 MiB** | **231.66 MiB** |

The external raw-art source is 133.49 MiB. The generated build is 92.2%
smaller on disk. The initial side-view working set is about 39 MiB decoded and
the front-view set about 40 MiB; the browser may retain or evict decoded images
under its own cache policy, so these are preparation sets rather than a claimed
resident-memory ceiling.

Largest decoded textures:

| Asset | Built dimensions | Disk | Decoded RGBA |
| --- | ---: | ---: | ---: |
| `hero.sideFall` | 2736×1002 | 225 KiB | 10.46 MiB |
| `zombie2.side.run` | 1704×1440 | 323 KiB | 9.36 MiB |
| `zombie.side.leap` | 1960×1144 | 270 KiB | 8.55 MiB |
| `zombie2.side.leap` | 1688×1304 | 290 KiB | 8.40 MiB |
| `zombie.side.attack` | 1856×1184 | 308 KiB | 8.38 MiB |
| `frontFences` | 2560×660 | 691 KiB | 6.45 MiB |

Run `node tools/asset-audit.cjs` after changing art. The generated dimensions
are the optimized/cropped build dimensions; source-to-build transforms are
defined in `tools/build-assets.py` and should remain the single source of truth.

## Before and after measurements

All comparisons used hardware-accelerated Chrome. The baseline is the same
working tree before the decode/state-machine changes; it already contained
some compositor-layer improvements, which is why baseline checkerboarding was
not reproduced on this Mac even though the race was present in code.

| Test | Metric | Before | After |
| --- | --- | ---: | ---: |
| Desktop stress, 6 swings, DPR 2 | Decodes | 295 | 241 |
|  | Peak tile cache | 189 MiB | 187 MiB |
|  | Raster tasks | 1655 | 1654 |
|  | Swing worst frame | 17 ms | 17 ms |
|  | Checkerboards / compositor drops | 0 / 0 | 0 / 0 |
| Throttled stress, 4 swings, CPU 6×, DPR 1.5 | Decodes | 227 | 173 |
|  | Peak tile cache | 169 MiB | 171 MiB |
|  | Raster tasks | 1025 | 1018 |
|  | Swing worst frame | 17 ms | 17 ms |
|  | Checkerboards / compositor drops | 0 / 0 | 0 / 0 |
| Intro with composited-frame recording | Decodes | 239 | 185 |
|  | Total compositor drops | 4 | 1 |
|  | rAF dropped-frame estimates | 9 | 5 |
|  | Worst rAF interval | 117 ms | 100 ms |

The remaining intro spike occurs during startup/browser-audio initialization,
not inside a front/side swing. After the low-power profile was enabled, a final
6×-CPU run reported 0 checkerboards, 0 compositor drops, 0 swing drops, 0
blended frames, 173 decodes, and a 171 MiB peak tile cache. Chrome still emits
display `requestAnimationFrame` callbacks at the monitor rate; the game reduces
GSAP and sprite/cloud state work to a stable 30 Hz budget on that profile.

The complete mission trace reached the finale and reported 14 swings, a 17 ms
worst swing frame, 0 blended frames, 0 missing images, and 0 swing compositor
drops. Its desktop Chrome tile cache peaked at 222 MiB after visiting the whole
mission. Tile cache is controlled by Chrome and is not equivalent to JavaScript
heap or total process memory.

## Validation and debugging

Useful commands:

```bash
# In-game live frame/decode/lifecycle panel
open 'http://localhost:8080/?perf'

# Repeated camera changes in the page
open 'http://localhost:8080/?perf=stress&n=20'

# Chrome trace + strict compositor assertions (requires playwright-core)
node tools/perf-lab.cjs --scenario stress --rounds 3 --browser chrome \
  --viewport 1272x719 --dpr 2 --out /tmp/circle-perf --strict

# Constrained profile (also use DevTools CPU throttling on a real browser)
node tools/perf-lab.cjs --scenario stress --rounds 2 --browser chrome \
  --viewport 1280x800 --dpr 1.5 --cpu 6 --low-power \
  --out /tmp/circle-low --strict

node tools/asset-audit.cjs
```

`perf-lab` uses Chrome tracing and CDP screencast frames rather than relying on
individual Playwright screenshots. A screenshot waits for a stable compositor
frame and can miss a bad frame that was actually presented immediately before
it.

To classify a future defect:

- **Network:** failed request or repeated request in the Network waterfall;
  `ZD.assets.stats.failed` names the build path.
- **Decode:** request has completed, but `asset.decode` is slow or still open in
  the performance log. Wait for `Image.decode()`; do not add a delay.
- **JavaScript scheduling:** Long Task/Long Animation Frame overlaps the glitch;
  inspect its script attribution.
- **Layout/paint:** Recalculate Style, Layout, or Paint spikes and nonzero layout
  shifts occur without compositor missing-content events.
- **Raster/GPU upload:** checkerboard/missing-content events or a raster burst
  appears around `camera.swing`; inspect Layers and enable DevTools Rendering
  paint flashing.
- **State/layering:** lifecycle marks are out of order or `swingBlendedFrames`
  is nonzero even though asset/decode metrics are clean.

For physical-device acceptance, record at 60 fps or higher while looping at
least 20 front/side transitions, collect a remote DevTools Performance trace,
watch Chrome's Memory/Performance Monitor, repeat after several full missions,
and test once under thermal load. A stable 30 fps is preferable to oscillating
between 30 and 60 fps on the weakest device.

## Architecture decision and preventive pattern

The existing hybrid is appropriate: retained DOM layers for parallax and
layout, sprite sheets for characters, transform/opacity compositor motion, and
one scheduled sprite ticker. A Canvas rewrite would add a new texture/resource
lifecycle and accessibility cost without solving late decode or oversized
textures by itself.

Reuse this sequence in future games:

1. Build each scene once and retain it; do not destroy the old scene while the
   next scene is loading.
2. Download through a deduplicating cache, but decode only the current and next
   working sets through one bounded queue.
3. Put the incoming scene under the current scene at a tiny nonzero opacity,
   force layout, and cross at least one complete paint boundary.
4. Let one transition owner update scene state. Cancel stale generations and
   never mix CSS transitions, timeouts, and independent rAF loops on the same
   properties.
5. Animate transforms and opacity only. Keep raster scale stable and avoid
   filters/shadows on full-screen moving layers.
6. Cut or hand off atomically. If a crossfade is a design requirement, budget
   for both complete scene surfaces and test it explicitly; never use it to hide
   readiness defects.
7. Measure compressed disk bytes and decoded dimensions separately. A 300 KiB
   WebP can still occupy 8–10 MiB after decode.
8. Validate with trace events and recorded composited frames, then repeat on
   representative physical hardware.
