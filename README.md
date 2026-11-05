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

## Project layout

```
index.html                 shell: stage, HUD, overlays, script order
css/style.css              all styling (HUD, options, lessons, panels, fx)
js/
  i18n.js                  game-i18n: T('key'), data-i18n, I18n.say (voice by key)
  core/util.js             DOM helpers, pausable clock, prefs
  core/audio.js            procedural SFX (WebAudio) + speech narration
  core/assets.js           manifest access + preloader
  core/sprites.js          sprite-sheet animator (one rAF ticker)
  config/missions.js       missions → walls → challenges (data only)
  geometry.js              arc/sector/segment/chord paths + correctness
  scene.js                 front & side parallax scenes, glass mechanism,
                           projectile, effects, camera transitions
  ui.js                    HUD, prompt, answer options, stamps, panels
  learn.js                 Encounter / Manipulate / primers / demonstration
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
```

## Asset pipeline

`python3 tools/build-assets.py` rebuilds `assets/build/`:

* cleans sprite alpha (haze/halo removal, white-keying of the zombie
  reference cards, component filtering of the noisy celebrate sheet),
* repacks every animation into a uniform grid and records `cols/rows/frames`,
* crops environment layers and measures each wall's circular opening
  (`cx, cy, rx, ry`) so the glass mechanism is placed exactly,
* writes `manifest.json` and `manifest.js` (loaded as a classic script so the
  game works from `file://`).

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

## Adding questions / missions

All learning content is data in `js/config/missions.js`:

```js
{ mode: 'shape',                       // 'shape' | 'name' | 'identify'
  target: P('sector', -35, 100),       // type, start angle, sweep (deg)
  options: [P('arc', -35, 100), P('sector', -35, 100), P('segment', -35, 100)] }
```

* `sweep < 180` → minor, `> 180` → major (never use exactly 180).
* `P(type, start, sweep, rot)` – `rot` only changes how the option thumbnail
  is displayed (orientation transfer); the projectile aligns during flight.
* `C(piece)` builds the complementary piece (minor ↔ major distractor).
* A wall's `level` is `'basic'` (ARC/SECTOR/SEGMENT labels, type-only match)
  or `'full'` (MINOR/MAJOR labels, type + size must match).
* A wall's `lesson` is `'encounter'` (full Encounter → Manipulate lesson),
  `'minorMajor'`, `'segments'`, or `null`.
* Append a mission object to `ZD.MISSIONS` to add a 3-wall mission; the
  finale shows **Next mission** automatically.

Correctness is evaluated by `ZD.geo.matches(option, target, level)` from this
data — never from pixels — and the same `ZD.geo.piecePath` draws the wall
opening, the projectile, the option thumbnails and the lesson diagrams.

## Localisation (game-i18n)

Every learner-facing line is a key: `T('fbCorrect')` in JS, `data-i18n="appTitle"`
in HTML, `I18n.say('intro1Vo')` for narration; generated keys use
`I18n.key('piece', 'minor', 'sector')` → `pieceMinorSector`. `locales/locales.json`
holds the English text only. Add a language by adding `"hi": {…}` next to `"en"`
and open `index.html?lan=hi` (missing keys fall back to English, then show the
key itself). After editing the JSON, regenerate `locales/locales.js` (command in
the header of `js/i18n.js`) so the game still runs from `file://`.

Voice-over: drop `assets/VO/<lang>/<key>.webm` and list the key in
`assets/VO/<lang>/manifest.json`; unlisted keys are spoken by the browser's
speech engine (language codes in `js/i18n.js`).

## Audio

All sound effects are synthesised in `js/core/audio.js` (`SFX` recipes), so
no audio files are required. Toggle sound (M key / HUD button), voice
narration and reduced motion from the pause menu (Esc / P).

## Visual consistency

Mixed-source art is unified by (1) alpha cleanup in the pipeline,
(2) per-layer CSS filters (`--f-far`, `--f-mid`, `--f-hero`, `--f-zombie`,
`--f-wall` in `style.css`) and (3) one soft-light colour-grade overlay plus a
vignette (`#grade`, `#vignette`). Tweak the CSS variables to retune the look.
