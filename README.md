# Zombie Defense — Parts of a Circle

An HTML5 educational zombie-defense game (grades 8–10) built with vanilla
HTML/CSS/JS and GSAP. Learners identify arcs, sectors, segments and their
minor/major forms by throwing matching circle pieces through a geometric wall
before the zombies get through.

## Run it

Any static server works (the game also runs from `file://`):

```bash
cd circle-game
python3 -m http.server 8080        # then open http://localhost:8080
```

Everything is local (fonts, GSAP, generated WebP art) so it works offline
once loaded. Best on a landscape tablet; it scales to any 16:9 → 20:9 screen.

## How a wall plays out

(Redesigned from the LXD feedback, Nov 2026.)  One mission = **6 walls = 6
questions**, one question per wall.  At the start of every play the six
pieces (minor/major arc, sector, segment) are shuffled and dealt one per wall,
so each piece is asked exactly once in a random order.  Each wall has one
zombie behind a round glass window with one opening.  The learner answers
with **four pill buttons** in a side panel right of the wall, chosen by rule
(`ZD.geo.options`, second LXD round, Nov 2026): the gap's own name, its
*size twin* (same type, other size), a *type twin* (same size, another type)
and a *wild card*, shuffled every time - so a guess has to judge both the
type and the size.  Colour appears only as feedback.

Arcs are drawn as a **thin line** on the circle (`geo.shape`, `ARC_R`), never
as a band: in the glass a thin slot with the rim light along it and the rest
of the circle as a faint outline, in flight a thin curved rod.  Sectors and
segments stay cut-out regions.

**Front-view camera** (`FrontScene.frame` + `shots` in `js/scene.js`): the
view sits in a camera rig that zooms and pans. A camera move is one
`ZD.motion` (GSAP) tween on the frame clock that writes the rig's transform
(paused with the game by `ZD.motion.freeze`). It is deliberately NOT a
compositor Web Animation: each time a compositor animation starts or stops
on the rig, Chrome re-picks the raster scale of every layer inside it and
re-paints their tiles, which showed as missing tiles at every punch-in and a
half-drawn wall when the view swung away (see "Performance"). The views and
the rig are always their own compositor layers (CSS `will-change`, never
toggled). The hidden view is `visibility: hidden`, so it holds no GPU
memory. Before a view swings in it is made ready in two steps: seconds ahead
(`camera.prewarm`: the wall title prepares the front view, the throw the
side view) every image it draws is decoded (`ZD.assets.decode`); right
before the move `camera.to` paints it unseen under the current view and
starts the move only after a real browser paint, so its tiles are rastered
before anything moves (both views hold GPU tiles only for that moment and
the swing). The swing itself is a **cut on
motion** (`SWING` in `js/scene.js`): both views drift the same way as one
camera move and the picture changes at 40 % with a hard one-frame cut - only
one view is ever on screen, and both stay within 48 px of where they rest, so
the pre-painted tiles are the ones shown. Coming from the side view,
`camera.to('front', { shot: 'focus' })` lands on the `focus` shot (the wall
fills the space left of the answer panel, a focus vignette darkens the
edges). The opening's light-yellow neon rim lights then fade up
(`GlassMech.lightUp`; the glows are separate small svgs, so they never
repaint the zoomed view).
When an answer is picked, the rim flares and the shape pings outward
(`GlassMech.pick`) and the camera pulls back to the `wide` shot: four closed
**crates** stand on the road at the boy's feet (`Crates` in `js/scene.js`,
drawn in code), named as the buttons in the same order, so the names must be
read - the pieces stay hidden inside.  The tapped name's crate lights up, its
lid pops, the piece hops out into the boy's hands as he bends for it
(`FrontScene.pickUp`; there is no bend sheet - it is the throw sheet's first
pose leaning, dipping and squashing, transform only), he straightens up and
throws.  The camera follows the piece toward the wall (`impact`), and the
view swings to the side at the window.

* **Right piece** - it slips through the glass, the view switches to the
  side, the zombie is knocked out and the window opens while the piece's
  name and rule are shown and read aloud (free review).  Then the learner
  takes the **run-and-jump controller** (icons only, no text): hold the
  green RUN button (bottom-left) to run at the wall, tap the orange JUMP
  button (bottom-right) to leap through the circle, and keep running to the
  next wall (after wall 6: the safe zone), where the flow continues.  A jump
  before the take-off zone is a small hop; running into the wall bumps off
  it.  The button to press next pulses.  Keyboard: Right / D = run, Space /
  Up / W = jump.  (`game.runAndJump`, `js/controls.js`.)  (`hits` > 1 on a
  wall would add in-glass hits with new openings first; the shipped config
  uses 1.)
* **Wrong piece** - the answer panel marks the right piece; the thrown piece
  smashes the glass and the zombie dives through and attacks.  The boy is
  too frightened to fight back: he recoils, staggers and falls flat on his
  back where he stood (`hero.sideFall`, no knockback), and stays down while
  the zombie looms.  The camera pushes in on the two of them, the view dims
  to purple, red rays open and the GAME OVER sign (`gameOverSign`, from
  `circle-game-art/images/gameover.png`) drops in.  After a beat it rises
  away and the **Look again** review comes up (`ZD.ui.reviewCard`): the gap
  that was needed and the piece that was thrown, side by side, and the
  reason the gap is what it is (`reason*` keys).  Its button zooms back out
  and plays the same wall again with a fresh zombie and a new opening of the
  same piece (walls already cleared stay cleared).
* **Time out** - on timed walls the zombie climbs up behind the glass (the
  timer is its distance; the rim pulses red in the last 30%).  When it gets
  there it bangs through: same as a wrong piece (the review shows the gap
  only, "Time ran out!").
* **Two chances per wall** (`CHANCES` in `js/game.js`).  A time-out counts
  as a miss.  The first review's button is *Try again*, the second's *Show
  me*: on the third go the wall has no timer and the game answers it itself -
  "The gap is a ...", the intro's demo hand taps the right name
  (`game.assistTap`), and the boy throws, knocks the zombie out and runs on
  as usual.

Timers and difficulty per wall come from `rounds` in the config: walls 1-2
clear sizes, walls 3-4 rotated, walls 5-6 close to half.  Every wall has a
10 s timer, but it only appears after a thinking time (`delay`) that shrinks
stage by stage but never below 3 s (four names to read): 5, 5, 4, 4, 3, 3 s.
During it the zombie waits behind the glass; answering inside it means no
timer at all.  The front view has no sun (it competed with the window).

Every answer is logged on the device (`localStorage` key `zd.log`, last 400):
mission, wall, opening, what was picked (`timeout`, or `auto` when the game
answered the third go) and time taken.  `ZD.report()` in the browser console
prints a per-piece table for teachers (`shown` = answered by the game).

The intro opens on the horde at the first wall, then **one continuous pan**
down the whole road (`SideScene.startTour` / `tourAt`): all six walls, as far
apart as in the game, a zombie behind each, a wall counter ticking up, and
the Safe Zone gate at the end.  Only the two wall slots and two extra
zombies exist - the one the camera has passed leapfrogs ahead.  It then
shows both outcomes with the same code (`throwFront`,
`zombieBreakIn`, `heroJumpThrough`); after the boy falls, the scene dips to
dark and resets for the right piece.  Leaps use
`SideScene.leapThrough` plus a wall "cover" layer so whatever has passed the
wall is hidden by bricks and seen only through the hole.

## Project layout

```
index.html                 shell: stage, HUD, overlays, script order
css/style.css              all styling (HUD, options, panels, fx)
js/
  i18n.js                  game-i18n: T('key'), data-i18n, I18n.say (voice by key)
  core/util.js             DOM helpers, pausable clock, prefs
  core/perf.js             ?perf diagnostics panel + ?perf=stress transition test
  core/audio.js            procedural SFX (WebAudio) + read-aloud fallback
                           + theme music (assets/audio/theme-song.webm, .mp3 fallback)
                           (speech); silent while page is inactive
  core/assets.js           manifest access, preloader (everything before Play,
                           stall-proof), decode-before-paint
  core/sprites.js          sprite-sheet animator (one rAF ticker)
  config/missions.js       missions → walls → openings (data only)
  geometry.js              arc/sector/segment paths, piece ids + correctness
  scene.js                 front & side parallax scenes, glass mechanism,
                           projectile, effects, camera transitions; endless
                           seeded scenery (Scatter bands + biomes per wall:
                           grove / outpost / rocky / wild) so the land keeps
                           changing between walls instead of resetting
  ui.js                    HUD, four-button answer panel, review card, panels, bottom message bar
  controls.js              run-and-jump controller: RUN (hold) / JUMP (tap) buttons + keys
  intro.js                 title + 3-scene cinematic
  game.js                  state machine (wall loop, outcomes, finale)
  main.js                  boot + viewport fitting
  motion.js                the motion system: every tween goes through it
                           (GSAP; DUR / EASE / PHYS constants, enter / exit /
                           pop / pulse / shake, pause freeze / thaw, reset)
  libs/gsap.min.js         GSAP 3.13 core (bundled, no CDN)
  libs/Flip.min.js         GSAP Flip 3.13 (bundled; not loaded - no layout
                           animations yet)
locales/locales.json       learner-facing strings — English only ("en")
locales/locales.js         generated copy for file:// (command in js/i18n.js header)
assets/
  VO/en/manifest.json      keys that have a recorded clip at assets/VO/en/<key>.webm
  images/                  RAW art (untouched source of truth)
  build/                   GENERATED game-ready WebP + manifest (do not edit)
  fonts/                   Lilita One, Nunito (OFL)
tools/build-assets.py      raw art (../circle-game-art/images) → assets/build (Pillow, numpy, scipy)
tools/sprite_stabilizer.py frame-by-frame registration of AI-drawn sprite sheets
tools/sprite-qa.py         smoothness check of the built sheets (jitter, slide, seams)
tools/perf-lab.cjs         GPU rendering lab: missing tiles, dropped frames, offscreen
                           passes, tile memory per transition (Chrome trace)
```

## Asset pipeline

`python3 tools/build-assets.py` rebuilds `assets/build/`. The raw PNG art (~134 MB)
is **not** part of the game: it lives in `../circle-game-art/images/` next to this
repo (or wherever `CIRCLE_ART` points), so the shipped folder stays small.
The script does:

* cleans sprite alpha (haze/halo removal, white-keying of the zombie
  reference cards, component filtering of the noisy celebrate sheet),
* repacks every animation into a uniform grid and records `cols/rows/frames`,
* crops environment layers and measures each wall's circular opening
  (`cx, cy, rx, ry`) so the glass mechanism is placed exactly; walls come
  from `wall/image copy 2.png` (front) and `wall/image copy.png` (three turned
  views; the side view uses the least turned), black backdrop and hole keyed
  out, the outline closed so the rounded brick corners leave no see-through
  notches (filled with the art's mortar colour), and turned walls also
  record their base corners (`base.far/near`) so the side view stands them
  on the road; the side view's glass fills the hole's front opening
  (`WALL_RIMS`, an ellipse fitted to the rim - re-fit if the art changes),
* drops the sheets the game never draws (`UNUSED`: the front-view zombie
  die/dead, `hero.backJump`, walls `angle2/3`) - the preloader downloads every
  manifest entry,
* writes `manifest.json` and `manifest.js` (loaded as a classic script so the
  game works from `file://`).

`--only hero` / `--only zombie` rebuild just those sheets into the existing
manifest.

### Smooth sprite animation

The character sheets are AI-drawn grids: every cell is a separate drawing,
so the figure sits at a slightly different place, size and lean in each one
and plays back as jiggle. (Video-driven sprite generators avoid this because
their frames come from one continuous clip with a locked camera.)
`tools/sprite_stabilizer.py` gives the drawn grids the same consistency,
the way video stabilisation does:

1. **Track**: the head (with size and tilt) and the boots are template-matched
   against a reference frame. The ground line is the lowest solid row.
2. **Place**: one anchor per frame. Idle, throw, fear and attack use the
   planted boots. In-place runs use the head (offset to the vest for
   zombies). Airborne cheer/jump frames keep their height above the ground
   line of their grid row.
3. **Smooth**: the head path is low-passed over time. Loops get a periodic fit
   (idle: one sway per loop, run: two steps per loop), one-shots get a light
   gaussian. The intended motion stays and the frame-to-frame zig-zag goes.
4. **Correct**: each frame gets a small affine warp anchored at the feet: uniform
   scale for size pops, shear for lean jitter, and a stretch of the body
   below the neck for bob jitter (the head is never squashed). The head
   lands on the smoothed path while the feet stay where they are. The warp
   is rendered from the full-resolution drawing, so each frame is resampled
   once.
5. **Clean**: `defringe()` gives white- or grey-tinted anti-aliased edges the
   ink colour and peels white matting specks (and, for the back-cheer sheet,
   background haze) that differ per frame and would sparkle.

The hero keeps the anchor where the old build had it (measured on the idle
sheets: about 1 px from the boots, feet 8–11 px below the line), so the
game's hand/core offsets still hold. Sheets the generator drew at another
size are scaled to the idle sheet's size (`HERO_SCALE`: fear ×0.915, fall
×1.10, checked on head width and standing height). The fall sheet
(`boy/image.png` → `hero.sideFall`) can't be head-tracked because the head
turns over, so `build_hero_fall` registers it on the ground contact: each
grid row keeps its own motion, and the rows are joined where the front of the
boots meets. Every hero and zombie sheet carries a
fixed `shadowW`, so the shadow doesn't change size when the animation does.

At runtime (`js/core/sprites.js`) each frame is held for a whole number of
display refreshes (measured from rAF). On a 60 Hz screen, 16 fps used to
alternate 4,4,4,3 refreshes (67/67/67/50 ms); now every frame lasts 4.

Check a build with `python3 tools/sprite-qa.py` (`--strict` exits 1 on a
failure). Per sheet it reports head noise (zig-zag left after removing the
smooth motion), feet slide, ground-line spread, size pops and the loop
seam. Values are in on-screen px at scale 1. Run it after replacing any
character art.

### Replacing an asset

1. Drop the new file over the old one in `../circle-game-art/images/…` (same name) or
   point the relevant entry in `tools/build-assets.py` (`HERO_GRIDS`,
   `ZOMBIE_FRONT`, `ZOMBIE_SIDE`, `build_layers`, `build_walls`) at the new file.
2. Re-run the pipeline. Frame counts, cell sizes and wall openings are
   re-measured automatically; gameplay code reads them from the manifest.
3. Role mapping (which sheet is "throw", "cheer"…) lives in `HERO_GRIDS` /
   `ZOMBIE_*` in the build script and in the `sheet:` names used in `game.js`.

Hero sheets are 4×3 grids (12 frames). Zombie side sheets are 4×N grids.
Zombie front strips are extracted from the labelled reference cards.

## Message bar

Every in-play line - wall titles, the question, rule reviews, "checkpoint
cleared", the intro alarm - appears in one bar at the bottom of the screen
(`ZD.ui.showBanner(title, text, kind)` / `hideBanner()` / `caption(key)`).
Its art is `circle-game-art/images/banner.png`, cleaned by `build_banner()` in
`tools/build-assets.py` (crop, noisy portrait socket replaced by a dark disc)
and stretched at runtime as a 9-slice, so the socket and stripes never
distort.  The hero's profile picture (`boy/profile.png`, cropped by
`build_profile()`) sits in the socket and in the HUD portrait.  Overlay screens (title,
mission map, results, game over) keep their own panels.

## Front view (road, fences, wall)

The front view's ground and fences are pre-rendered by `build_front_road()` in
`tools/build-assets.py`: the dirt land (`land/Open Dirt Terrain with Corner
Rocks.png`, tiled via `build_dirt()`) is projected onto the ground plane and
the front-view fence art onto two planes lining the road, all from one camera
(`FRONT_CAM`: vanishing point 960,610 - camera height 470 - perspective 1000 -
road half-width 742).  At the wall's depth the road is exactly as wide as the
wall, so the wall stands across the road fence to fence (the front scene
places the wall by its base - y 798, as wide as the road there - and the hole
and glass follow from the art).  The brick road art
(`land/front-view road.png`, see `ROAD_ART`) is perspective-warped onto the
ground between the fence base lines, from just under the wall's base (y 790)
to the stage bottom.  Change `FRONT_CAM` there (not in `js/scene.js`) and
re-run the pipeline.

## Adding questions / missions

All learning content is data in `js/config/missions.js` (the file header
documents every field):

```js
rounds: [{ tier: 'start', timer: 10, delay: 5 }, { tier: 'start', timer: 10, delay: 4 }, ...],  // one per wall
openings: { start: tier([90], [270], [-90, 90, 0, 180]), middle: ..., hard: ... }
```

* There must be one round per piece (6).  Each tier needs at least 2
  openings for every piece (retries use a different one); a guard at the
  bottom of the file warns in the console otherwise.
* `O(type, sweep, dir)` is one opening; `tier(minorSweeps, majorSweeps, dirs)`
  builds every type at a minor and a major size for each direction.
* `sweep < 180` → minor, `> 180` → major.  Never use 180: a semicircle has no
  button.  `dir` is where the piece points (-90 up, 0 right, 90 down).

Correctness is `ZD.geo.matches(chosenId, target)` on this data - never pixels -
and the same `ZD.geo.piecePath` draws the wall opening, the projectile, the
button icons and the lesson diagram.  Buttons carry only a piece id; nothing in
the page marks which one is right.

## Localisation (game-i18n)

Every learner-facing line is a key: `T('fbCorrect')` in JS, `data-i18n="appTitle"`
in HTML; generated keys use
`I18n.key('piece', 'minor', 'sector')` → `pieceMinorSector`. `locales/locales.json`
holds the English text only. Add a language by adding `"hi": {…}` next to `"en"`
and open `index.html?lan=hi` (missing keys fall back to English, then show the
key itself). After editing the JSON, regenerate `locales/locales.js` (command in
the header of `js/i18n.js`) so the game still runs from `file://`.

Read-aloud uses the same keys: `I18n.say(key)` plays `assets/VO/<lang>/<key>.webm`
when the key is listed in `assets/VO/<lang>/manifest.json`, otherwise the
browser speaks the text.  Spoken lines: the six piece names (`piece*`, on a
hit), the six rules (`rule*`, on the walk through the window) and the six
reasons (`reason*`, lesson card).  To ship recorded voice-overs, record those
18 keys and list them in the manifest.

## Audio

All sound effects are synthesised in `js/core/audio.js` (`SFX` recipes); the
only audio file is the looping theme (`assets/audio/theme-song.webm`, Opus
64 kbps; browsers without WebM Opus get the `.mp3`). Toggle sound (M key / HUD button), read-aloud,
the zombie timer and reduced motion from the pause menu (Esc / P). When the tab is hidden or the window
loses focus, the AudioContext is suspended (`ZD.audio.setActive`, wired in
`js/main.js`) — no ambient loop or effects play until the learner returns.

## Visual consistency

Mixed-source art is unified by (1) alpha cleanup in the pipeline,
(2) per-layer CSS filters (`--f-far`, `--f-mid`, `--f-hero`, `--f-zombie`,
`--f-wall` in `style.css`) and (3) one soft-light colour-grade overlay plus a
vignette (`#grade`, `#vignette`: small canvases drawn by `paintWashes` in
`js/scene.js`). Tweak the CSS variables / those gradients to retune the look.

## Performance

Target: budget Android tablets (Lenovo K10 class: PowerVR GE8320, 3 GB) and
low-end Chromebooks. The scene is plain DOM: every moving part is its own
GPU layer, painted ("rasterised") into tiles once and then moved by the
compositor. Flicker in this kind of game is almost never "the image wasn't
loaded" - it is a frame drawn while some layer's tiles were not painted yet.

**The budget.** Chrome keeps every layer's painted tiles in a fixed GPU
budget: 512 MB on a desktop, about 128-256 MB on a 2-4 GB Android tablet
(Chrome sizes it from the device's memory). When the tiles the screen needs
right now do not fit, it draws the frame anyway: some tiles are missing
(holes, "not loaded") or stand-ins at another scale are shown (blurred,
"pixelated"), until it catches up. A desktop never hits the limit, which is
why the flicker only shows on a tablet - and why it starts late in a game:
the need grows with what the game has built (layers, scenery, both views
painted around a swing) until it crosses the budget. Measured 2026-11-10
(`tools/perf-lab.cjs --scenario game --gpu-mem 128`, a 1920x1200 tablet):
the committed build needed 202-353 MB of on-screen tiles per wall (peaks at
every swing, higher at later walls): 52 checkerboard frames at a 128 MB
budget, 6 at 256 MB (walls 3 and 5). After the rules below it needs at most
~140 MB (3 checkerboard frames at 128 MB, none at 256 MB or on a desktop).
See PERFORMANCE_AUDIT.md.

### Rules (they apply to any HTML/CSS game built this way)

1. **Never scale a layer tree with a compositor animation.** A Web Animation
   or CSS animation of `transform: scale()` makes Chrome re-pick the raster
   scale of every layer inside, at the start and the end of the animation,
   and re-paint all of it - the frames in between show missing or blurred
   tiles. Zoom from the frame clock (GSAP / rAF writing the transform) and
   pre-paint at the shot you will show. Translation-only compositor
   animations are fine.
2. **Paint before you show - but not long before.** A view that becomes
   visible must already be painted: decode its images a second or more
   ahead (`camera.prewarm`), then show it at `opacity: 0.001` under the
   current view and wait for a real paint (layout + two animation frames)
   right before the move (`camera.to`). An element hidden by
   `visibility: hidden`, `display: none`, or `opacity: 0` is not painted.
   Painted seconds ahead, the hidden view's tiles compete with the visible
   one's for the whole wait, and on a tablet the VISIBLE view loses tiles.
3. **One view on screen at a time.** Swing between views with a cut on
   motion, not a long cross-fade (two full scenes blended, one through an
   offscreen pass) and not a long slide (the incoming view starts off
   screen, its painted tiles are dropped and come back missing).
4. **No CSS `filter`, `clip-path`, `mask` or `mix-blend-mode` on an element
   that is its own GPU layer** (`will-change`, animated transform/opacity,
   GSAP-tweened). Each one is an offscreen pass redone every frame. Put
   colour filters on the art inside the layer (`.art`); draw shapes as svg
   instead of `clip-path`. (`#grade`'s soft-light blend is the one kept on
   purpose: it is the game's look; it costs two passes per frame.)
5. **Never toggle `will-change`** on a view or the camera rig, and don't let
   an animation promote one - the layer tree is rebuilt and every tile
   re-painted. Never add it per tween either (`ZD.motion` doesn't): a
   `will-change: transform` layer keeps the scale it was first painted at,
   so anything that pops up from small stays pixelated.
6. **Inside a scaled stage, promote big things with `will-change: opacity`,
   not `transform`.** The 1920x1080 stage is shrunk to the screen (x0.67 on
   a 1280-wide tablet, about x0.35 on a phone). Chrome paints a layer that
   has `will-change: transform` - or sits inside one - at no less than the
   screen's full resolution, ignoring that shrink: such a layer holds
   (1 / scale)^2 times the tiles it shows (2.25x on the tablet, ~9x on a
   phone). `#world` and the views use `will-change: opacity` (+ a fixed
   identity `transform`, so a shake / swing only changes a value); only
   small moving parts (sprites, clouds, the projectile, UI) and the camera
   rig (its zoom must never re-paint) keep `will-change: transform`.
7. **Few, small layers at rest; parallax layers only while scrolling.**
   Every layer is a screen of tiles where it shows. The parallax strips,
   bands, wall slots and the safe zone (`.scrolls`) get their own layers
   (`will-change: opacity`, rule 6) only while the side view scrolls
   (`side.setScrolling`, on in
   `prepareRun`, off in `finishRun` - switched while the picture is
   still). At rest and during a swing they are painted together. A strip is
   clipped to the world's width (`.strip-clip`): a 7-10k px wide strip can't
   share a layer (the browser refuses to merge mostly-empty space), so each
   kept a screen of tiles. Nothing may grow with the distance run (a
   scenery band once kept its first props and widened at every wall).
8. **No full-screen gradients in GPU tiles.** A smooth gradient looks the
   same from a fifth of its pixels: the colour grade, vignettes, alarm
   light and page backdrop are drawn once into small canvases that the GPU
   stretches (`paintWashes`; ~0.7 MB each instead of ~23 MB of tiles).
9. **Decode right before use, not just at boot.** The browser drops decoded
   images it has not drawn for a while (a K10's budget is small), so a
   sprite sheet switched to minutes after loading may need decoding in the
   frame it is shown - the sprite blinks. Decode what a view or an outcome
   will draw a second ahead (`ZD.assets.decode`, `ZD.scene.primeSheets`).
   Never keep decoded copies yourself (canvas / ImageBitmap): that doubles
   the memory.
10. **Keep long work off swings.** Building the AudioContext (~100 ms),
   big DOM rebuilds or style changes on a high ancestor (`#stage`) must not
   happen on the frame a move starts.
11. **Repaint after a resize.** Layers with `will-change: transform` keep
   their paint scale when the stage is resized; `fitStage` calls
   `ZD.scene.repaint()` once the size settles (hints lifted for two frames).
12. **Load everything before Play, and never wait on a lost request.** The
   play button appears only when every file the game uses is in memory:
   every image, both fonts, the theme music (`ZD.assets.preload`). Files are
   downloaded with `fetch()` and drawn from their `blob:` copies, so nothing
   touches the network after Play. A phone can lose a request without an
   error (switching cells, a dead connection) and the browser then waits
   minutes; a request that receives no bytes for 15 s is cancelled and asked
   again (patience doubles per attempt; `fetch` + `AbortController` is the
   only request WebKit really cancels - a cancelled `<img>` keeps its
   connection). Offline, the loader waits for the connection to come back.
   The loading line shows the percentage, "Slow internet..." after a stall
   and "No internet. Waiting..." when offline, so a learner can see it is
   not stuck. A file that still fails after 5 attempts keeps the loader up
   with "Some game files could not load..." (`appLoadFailed`) - the game
   never starts with a missing background or character. Test it with a
   server that hangs and throttles requests, in Chromium and WebKit, never
   only on a fast desktop connection.

### Measuring (screenshots can't)

A screenshot waits for every tile to be painted, so it never shows the
frames where one is missing - that is why Playwright shots looked fine.
Use the compositor's own records:

* `?perf` - a small panel: fps, frame time, dropped frames, long tasks /
  long animation frames, layout shifts, JS heap, the camera's last event,
  image decodes, the worst frame of the last swing. `ZD.perf.report()` in
  the console lists every swing / camera move with its worst frame and the
  slowest long frames with the script responsible.
* `?perf=stress&n=20` - after loading, takes the game over and repeats a
  wall's camera work (prewarm, swing to front, lock / wide / impact, swing
  back) n times, then shows the worst swing frame and drops. Runs on a real
  tablet - no laptop needed.
* `tools/perf-lab.cjs` - a Chrome trace on a real GPU (Mac: Metal) of
  `--scenario stress | intro | game` (game = the whole mission played
  hands-free), with per-phase **checkerboard frames** (drawn with missing
  tiles - the flicker), dropped frames, offscreen passes and tile memory.
  `--gpu-mem 128` gives Chrome a budget tablet's tile budget (the flicker
  only shows when it is short); `--raster-scale` reads Chrome's per-frame
  layer snapshots: frames with **holes** (tiles not painted), **pixelated**
  layers (painted below the scale they are shown at), the **MB of tiles
  the screen needs now** (`nowMB` - keep it well under the budget), and a
  per-wall table (does it get worse toward the end?); `--layers-detail`
  lists the biggest layers with why Chrome made them; `--layers` samples
  the layer tree at every settled view. A K10 is `--viewport 1280x800
  --dpr 1.5 --low-power`. `--frames dir` saves every composited frame;
  `--strict` fails on any missing tile. Needs `playwright-core`
  (`NODE_PATH=...`).
* Chrome DevTools: *Rendering* > Frame Rendering Stats (fps + GPU memory),
  Layer borders (orange = GPU layers), Paint flashing (green = re-painted;
  nothing should flash during a camera move). *Performance* > record a
  transition: the `zd:` marks are in the Timings track.

Telling the causes apart: a missing image for many frames that a reload
fixes = **loading** (`stats.failed`, "missing images" in the panel); a
blink on the first frame something is shown = **decode** (long "Decode
image" / "Image Decode" tasks in the trace); the whole picture freezes while
compositor moves carry on = **main-thread scheduling** (long animation
frames with script time); green flashes during a move = **paint**; holes or
blurred patches with no main-thread work = **raster / GPU** (checkerboard
frames in perf-lab, tile memory near the limit in Frame Rendering Stats).
