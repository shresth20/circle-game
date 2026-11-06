# Zombie Defense — Parts of a Circle

An HTML5 educational zombie-defense game (grades 8–10) built with vanilla
HTML/CSS/JS and anime.js. Learners identify arcs, sectors, segments and their
minor/major forms by throwing matching circle pieces through a geometric wall
before the zombies get through.

## Run it

Any static server works (the game also runs from `file://`):

```bash
cd circle-game
python3 -m http.server 8080        # then open http://localhost:8080
```

Everything is local (fonts, anime.js, generated WebP art) so it works offline
once loaded. Best on a landscape tablet; it scales to any 16:9 → 20:9 screen.

## How a wall plays out

(Redesigned from the LXD feedback, Nov 2026.)  One mission = **6 walls = 6
questions**, one question per wall.  At the start of every play the six
pieces (minor/major arc, sector, segment) are shuffled and dealt one per wall,
so each piece is asked exactly once in a random order.  Each wall has one
zombie behind a round glass window with one opening.  The learner always
answers with the same **six pill buttons** in a side panel right of the wall
("Which piece fits?"), in fixed type pairs - minor / major arc, sector,
segment - so every answer needs both a type and a size (random guess = 1 in 6).  Buttons are
never shuffled and use one neutral icon colour; colour appears only as
feedback.

* **Right piece** - it slips through the glass, the view switches to the
  side, the zombie is knocked out, the window opens and the hero dives
  through while the piece's name and rule are shown and read aloud (free
  review), then runs to the next wall.  (`hits` > 1 on a wall would add
  in-glass hits with new openings first; the shipped config uses 1.)
* **Wrong piece** - it smashes the glass; the zombie dives through and knocks
  the hero down (one heart lost, 3 per mission).  A lesson card then slides
  the CORRECT piece into the gap (same orientation as the window), lights up
  its parts (radii / chord / arc), shows a dashed "half" line for minor vs
  major, and gives a one-line reason (read aloud).  "Got it!" asks the SAME
  piece again in a different opening (new direction / size).
* **Time out** - on timed walls the zombie climbs up behind the glass (the
  timer is its distance; the rim pulses red in the last 30%).  When it gets
  there it bangs through: same as a wrong piece, and the lesson still shows.
* **No hearts left** - cartoon defeat, the same lesson, then retry the wall.

Timers and difficulty per wall come from `rounds` in the config: walls 1-2
clear sizes (none / 20 s), walls 3-4 rotated (15 / 14 s), walls 5-6 close to
half (13 / 12 s).  The front view has no sun (it competed with the window).  The pause menu can switch the zombie timer off, plus
read-aloud, sound and reduced motion.

Every answer is logged on the device (`localStorage` key `zd.log`, last 400):
mission, wall, opening, what was picked (or `timeout`) and time taken.  The
mission-complete panel lists the top mix-ups ("Practise these"), and
`ZD.report()` in the browser console prints a per-piece table for teachers.

The intro shows both outcomes with the same code (`ZD.game.sideThrowDemo`,
`zombieBreakIn`, `securityReset`, `heroJumpThrough`).  Leaps use
`SideScene.leapThrough` plus a wall "cover" layer so whatever has passed the
wall is hidden by bricks and seen only through the hole.

## Project layout

```
index.html                 shell: stage, HUD, overlays, script order
css/style.css              all styling (HUD, options, panels, fx)
js/
  i18n.js                  game-i18n: T('key'), data-i18n, I18n.say (voice by key)
  core/util.js             DOM helpers, pausable clock, prefs
  core/audio.js            procedural SFX (WebAudio) + read-aloud fallback
                           (speech); silent while page is inactive
  core/assets.js           manifest access + preloader
  core/sprites.js          sprite-sheet animator (one rAF ticker)
  config/missions.js       missions → walls → openings (data only)
  geometry.js              arc/sector/segment paths, piece ids + correctness
  scene.js                 front & side parallax scenes, glass mechanism,
                           projectile, effects, camera transitions; endless
                           seeded scenery (Scatter bands + biomes per wall:
                           grove / outpost / rocky / wild) so the land keeps
                           changing between walls instead of resetting
  ui.js                    HUD, six-button answer panel, stamps, panels, bottom message bar
  learn.js                 lesson card: correct piece fills the gap + reason
  intro.js                 title + 3-scene cinematic
  game.js                  state machine (wall loop, outcomes, finale)
  main.js                  boot + viewport fitting
  vendor/anime.min.js      anime.js 3.2.2 (MIT)
locales/locales.json       learner-facing strings — English only ("en")
locales/locales.js         generated copy for file:// (command in js/i18n.js header)
assets/
  VO/en/manifest.json      keys that have a recorded clip at assets/VO/en/<key>.webm
  images/                  RAW art (untouched source of truth)
  build/                   GENERATED game-ready WebP + manifest (do not edit)
  fonts/                   Lilita One, Nunito (OFL)
tools/build-assets.py      raw art → assets/build (Pillow, numpy, scipy)
tools/sprite_stabilizer.py frame-by-frame registration of AI-drawn sprite sheets
tools/sprite-qa.py         smoothness check of the built sheets (jitter, slide, seams)
```

## Asset pipeline

`python3 tools/build-assets.py` rebuilds `assets/build/`:

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
game's hand/core offsets still hold. Every hero and zombie sheet carries a
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

1. Drop the new file over the old one in `assets/images/…` (same name) or
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
Its art is `assets/images/banner.png`, cleaned by `build_banner()` in
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
rounds: [{ tier: 'start', timer: null }, { tier: 'start', timer: 20 }, ...],  // one per wall
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

All sound effects are synthesised in `js/core/audio.js` (`SFX` recipes), so
no audio files are required. Toggle sound (M key / HUD button), read-aloud,
the zombie timer and reduced motion from the pause menu (Esc / P). When the tab is hidden or the window
loses focus, the AudioContext is suspended (`ZD.audio.setActive`, wired in
`js/main.js`) — no ambient loop or effects play until the learner returns.

## Visual consistency

Mixed-source art is unified by (1) alpha cleanup in the pipeline,
(2) per-layer CSS filters (`--f-far`, `--f-mid`, `--f-hero`, `--f-zombie`,
`--f-wall` in `style.css`) and (3) one soft-light colour-grade overlay plus a
vignette (`#grade`, `#vignette`). Tweak the CSS variables to retune the look.
