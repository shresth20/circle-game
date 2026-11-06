/* Scenes: layered parallax environments for the FRONT camera (hero faces the
   wall) and the SIDE camera (hero, thick wall, zombie), plus the glass
   mechanism, projectile, effects and camera transitions.

   Layer order (per brief):
     L1 distant background  sky, clouds, skyline
     L2 environment         haze, mountains, tower, tree, fence
     L3 ground + wall       ground/platform, wall, glass opening
     L4 gameplay objects    hero, zombie, projectile
     L5 effects + UI        shards, cracks, flashes (UI lives outside #world) */
window.ZD = window.ZD || {};

(function () {
  const { el, svg, rand, randInt, pick, clamp } = ZD.util;
  const A = ZD.assets;

  const STAGE_W = 1920;
  const STAGE_H = 1080;
  // finale building; door / plaque boxes are in the built image's pixels
  const SAFE_ZONE = {
    scale: 0.78,
    left: 600, // stage x of the building's left edge at rest
    sink: 34, // base blocks stand on the road's top surface
    door: { x: 1243, y: 390, w: 150, h: 422 },
    plaque: { x: 621, y: 499, w: 370, h: 85 },
  };
  const WORLD_W = 2560; // scenery is wider than the stage so 20:9 screens stay filled
  const WORLD_X = (STAGE_W - WORLD_W) / 2; // -320
  const S_WIDE = WORLD_W / 1870; // scale for the 1870px-wide layers
  const S_FENCE = WORLD_W / 2500; // scale for the 2500px-wide layers
  // far skyline is drawn smaller than the other wide layers and keeps its
  // bottom edge where it was
  const S_FAR = S_WIDE * 0.7;
  // skyline art runs solid to its bottom edge: pin source row 640 (the old
  // crop bottom) at screenY so the rooftops stay put and the base extends down
  const skylineTop = (screenY) => Math.round(screenY - (640 - (A.image('skyline').oy || 0)) * S_FAR);

  /* A few separate small clouds (cut out by the build) instead of a tiled
     cloud bank.  [key, x, baseline y, scale, flip] */
  function cloudLayers(defs, factor) {
    // each cloud drifts at its own speed: bigger (nearer) clouds a little
    // faster, with a small per-cloud variation so they slide past each other
    return defs.map(([key, x, y, scale, flip], i) => Object.assign(propLayer(key, { x, y, scale, z: 2, factor, cls: 'far cloud', flip }), { cloud: true, drift: 0, flip: !!flip, speed: 0.55 + scale * 0.8 + ((i * 37) % 5) * 0.06 }));
  }

  /* One sun, drawn here: the skyline art's own sun repeated with every tile. */
  function sunLayer({ x, y, d, factor }) {
    const node = el('div', { class: 'layer sun far', style: { left: x - d / 2 + 'px', top: y - d / 2 + 'px', width: d + 'px', height: d + 'px', zIndex: 3 } });
    return { node, factor, tiled: false, x: x - d / 2, w: d };
  }

  /* clouds drift slowly and wrap around the world */
  function placeCloud(l, px) {
    l.node.style.transform = `translateX(${wrapX(l.x - px * l.factor - l.drift, l.w) - l.x}px)${l.flip ? ' scaleX(-1)' : ''}`;
  }

  /* Every animation always plays in full (no reduced-motion mode).  D() is
     the one place to tune the game's overall animation timing. */
  const settings = {};
  const D = (ms) => ms;
  // forget the setting from the removed reduced-motion option
  try { localStorage.removeItem('zd.reducedMotion'); } catch (e) {}

  let uid = 0;

  /* ----------------------------------------------------------------------- */
  /* layers                                                                  */
  /* ----------------------------------------------------------------------- */
  /* Horizontally tiled layer scrolled with a transform (no repaint) and
     wrapped every period so parallax is seamless.
     mirror: alternate tiles are flipped so the seam is pixel-continuous
     (used for silhouettes, fences and bricks; never for the sky's sun). */
  function tiledLayer(key, { y, h, z, factor = 0, cls = '', opacity = 1, scale, bg, mirror = false }) {
    const img = A.image(key);
    const sc = scale || (img.w > 2000 ? S_FENCE : S_WIDE);
    const tileW = Math.round(img.w * sc);
    const tileH = Math.round(img.h * sc);
    const height = h || tileH;
    const period = mirror ? tileW * 2 : tileW;
    const count = Math.ceil((WORLD_W + period) / tileW) + 1;
    const node = el('div', {
      class: 'layer tiled ' + cls,
      style: { left: WORLD_X + 'px', top: y + 'px', width: tileW * count + 'px', height: height + 'px', zIndex: z, opacity, backgroundColor: bg || 'transparent' },
    });
    for (let i = 0; i < count; i++) {
      node.appendChild(
        el('div', {
          class: 'tile',
          style: {
            left: i * tileW + 'px',
            width: tileW + 1 + 'px', // 1px overlap hides sub-pixel seams
            height: height + 'px',
            backgroundImage: `url("${A.imageUrl(key)}")`,
            backgroundSize: `${tileW}px ${tileH}px`,
            // flipped tiles anchor right so the flip puts the art flush left
            backgroundPosition: mirror && i % 2 ? 'right top' : 'left top',
            backgroundRepeat: 'repeat-x', // fill the 1px overlap column
            transform: mirror && i % 2 ? 'scaleX(-1)' : '',
          },
        })
      );
    }
    return { node, factor, tiled: true, drift: 0, tileW, period };
  }

  function scrollTiled(l, px) {
    const off = (((px * l.factor + l.drift) % l.period) + l.period) % l.period;
    l.node.style.transform = `translateX(${-off}px)`;
  }

  function propLayer(key, { x, y, scale = 1, z, factor = 0, cls = '', flip = false, opacity = 1 }) {
    const img = A.image(key);
    const w = Math.round(img.w * scale);
    const h = Math.round(img.h * scale);
    const node = el('div', {
      class: 'layer prop ' + cls,
      style: {
        left: x + 'px',
        top: y - h + 'px', // y = baseline (bottom edge)
        width: w + 'px',
        height: h + 'px',
        zIndex: z,
        opacity,
        backgroundImage: `url("${A.imageUrl(key)}")`,
        backgroundSize: '100% 100%',
        transform: flip ? 'scaleX(-1)' : '',
      },
    });
    return { node, factor, tiled: false, x, w };
  }

  function wrapX(x, w) {
    const span = WORLD_W + w;
    let v = ((x - WORLD_X + w) % span + span) % span;
    return v - w + WORLD_X;
  }

  /* ----------------------------------------------------------------------- */
  /* endless scenery                                                         */
  /* ----------------------------------------------------------------------- */
  /* The run between walls never repeats: the land beside the road is
     generated from the distance travelled.  The world is split into zones,
     one per wall (ZONE_LEN = the run between walls in game.js, centred on
     each wall), and each zone has a biome that sets which props appear and
     how densely, so the land changes during every run: a grove of dead
     trees, an outpost with watchtowers, a rocky stretch, open grassland.
     Everything is seeded, so a spot always looks the same. */
  const ZONE_LEN = 1750;
  const BIOMES = ['grove', 'outpost', 'rocky', 'wild'];
  const DRY_TREES = ['dryTree1', 'dryTree2', 'dryTree3', 'dryTree4', 'dryTree5', 'dryTree6', 'dryTree7', 'dryTree8', 'dryTree9', 'dryTree10', 'dryTree11', 'dryTree12'];
  const GRASS_S = ['grass3', 'grass4', 'grass5', 'grass6', 'grass7'];
  const GRASS_L = ['grass1', 'grass2', 'grass3'];
  const ROCK_S = ['rock5', 'rock6', 'rock7', 'rock8'];
  const ROCK_L = ['rock1', 'rock2', 'rock3', 'rock4'];

  function hash32(a, b) {
    let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  /* small seeded random source (mulberry32) */
  function seeded(seed) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (a, b) => a + (b - a) * next();
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.chance = (p) => next() < p;
    return next;
  }

  /* Biome of the zone around travel distance `dist`.  Zone 0 (the first
     wall) is 'home', the hand-placed opening.  After that the biomes come in
     shuffled rounds of four, so every four walls show all four and the same
     biome never comes twice in a row. */
  const biomeSeq = [];
  function biomeAt(dist) {
    const z = Math.floor(dist / ZONE_LEN + 0.5);
    if (z <= 0) return 'home';
    while (biomeSeq.length < z) {
      const rnd = seeded(hash32(biomeSeq.length, 7));
      const round = BIOMES.slice();
      for (let i = round.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [round[i], round[j]] = [round[j], round[i]];
      }
      if (round[0] === biomeSeq[biomeSeq.length - 1]) round.push(round.shift());
      biomeSeq.push(...round);
    }
    return biomeSeq[z - 1];
  }

  /* One parallax band of generated props.  The band is cut into chunks of
     `chunk` layer px; a chunk's props are built from its own seed when it
     scrolls into view and removed when it leaves, so the band is endless and
     only what is on screen is in the DOM.  The whole band moves with one
     transform.  gen(rnd, x, biome) -> { item: {key, y, scale, flip} | null, gap }
     walks each chunk left to right.  `anchors` are fixed hand-placed props
     (the opening composition); generated props keep clear of them. */
  class Scatter {
    constructor({ factor, z, cls = '', chunk = 1200, seed, gen, anchors = [], clear = 0 }) {
      this.factor = factor;
      this.chunk = chunk;
      this.seed = seed;
      this.gen = gen;
      this.clear = clear;
      this.node = el('div', { class: 'scatter ' + cls, style: { zIndex: z } });
      this.anchors = anchors.map((a) => Object.assign({ w: A.image(a.key).w * a.scale }, a));
      this.anchors.forEach((a) => this.node.appendChild(this._item(a, a.x)));
      this.chunks = new Map();
    }

    _item({ key, y, scale, flip }, x) {
      const n = propLayer(key, { x: Math.round(x), y: Math.round(y), scale, flip }).node;
      n.style.zIndex = Math.round(y); // nearer (lower) props overlap farther ones
      return n;
    }

    _build(i) {
      const rnd = seeded(hash32(this.seed, i));
      const x1 = (i + 1) * this.chunk;
      const nodes = [];
      let x = i * this.chunk + rnd.range(0, 90);
      while (x < x1) {
        // a prop's biome is the zone the camera is in when it passes mid-screen
        const { item, gap } = this.gen(rnd, x, biomeAt((x - STAGE_W / 2) / this.factor));
        if (item) {
          const w = A.image(item.key).w * item.scale;
          const hit = this.anchors.some((a) => x < a.x + a.w + this.clear && x + w > a.x - this.clear);
          if (!hit) {
            const n = this._item(item, x);
            this.node.appendChild(n);
            nodes.push(n);
          }
        }
        x += gap;
      }
      return nodes;
    }

    update(scroll) {
      const wx = scroll * this.factor;
      this.node.style.transform = `translateX(${-wx}px)`;
      // props are at most ~800px wide, so a chunk left of the window by more
      // than that can no longer be seen
      const lo = Math.floor((wx + WORLD_X - 800) / this.chunk);
      const hi = Math.floor((wx + WORLD_X + WORLD_W) / this.chunk);
      for (const [i, nodes] of this.chunks) {
        if (i < lo || i > hi) {
          nodes.forEach((n) => n.remove());
          this.chunks.delete(i);
        }
      }
      for (let i = lo; i <= hi; i++) if (!this.chunks.has(i)) this.chunks.set(i, this._build(i));
    }
  }

  /* Gap ranges per biome: [min, max] layer px between props. */
  const gapOf = (rnd, table, biome) => rnd.range(...table[biome]);

  /* SIDE view bands, far to near.  y = baseline (stage px). */
  function sideScatter(road) {
    const vb = road.bottom;
    return {
      // distant dead trees (and watchtowers at outposts) seen through the fence
      far: new Scatter({
        factor: 0.32, z: 6, cls: 'far distant', chunk: 1000, seed: 11,
        gen: (rnd, x, b) => {
          const gap = gapOf(rnd, { home: [380, 700], grove: [110, 240], outpost: [300, 560], rocky: [520, 900], wild: [240, 460] }, b);
          if (b === 'outpost' && rnd.chance(0.3)) return { gap: gap + 120, item: { key: 'tower', y: rnd.range(704, 712), scale: rnd.range(0.34, 0.4), flip: rnd.chance(0.5) } };
          if (!rnd.chance(b === 'rocky' ? 0.5 : 0.9)) return { gap };
          return { gap, item: { key: rnd.pick(DRY_TREES), y: rnd.range(698, 712), scale: rnd.range(0.38, 0.56), flip: rnd.chance(0.5) } };
        },
      }),
      // big trees and watchtowers just behind the fence
      mid: new Scatter({
        factor: 0.55, z: 6, cls: 'mid', chunk: 1400, seed: 23, clear: 380,
        anchors: [
          { key: 'tower', x: 40, y: 762, scale: 0.74 },
          { key: 'tree', x: 1420, y: 800, scale: 0.9 },
        ],
        gen: (rnd, x, b) => {
          const gap = gapOf(rnd, { home: [800, 1200], grove: [240, 460], outpost: [520, 880], rocky: [760, 1250], wild: [440, 780] }, b);
          if (b === 'outpost' && rnd.chance(0.38)) return { gap: gap + 200, item: { key: 'tower', y: rnd.range(756, 768), scale: rnd.range(0.64, 0.76), flip: rnd.chance(0.5) } };
          if ((b === 'wild' && rnd.chance(0.28)) || (b === 'rocky' && rnd.chance(0.22))) return { gap: gap + 380, item: { key: 'tree', y: rnd.range(790, 806), scale: rnd.range(0.7, 0.9), flip: rnd.chance(0.5) } };
          if (b === 'rocky' && rnd.chance(0.35)) return { gap };
          return { gap, item: { key: rnd.pick(DRY_TREES), y: rnd.range(744, 792), scale: rnd.range(0.86, 1.24), flip: rnd.chance(0.5) } };
        },
      }),
      // grass and pebbles along the road's back edge
      road: new Scatter({
        factor: 1, z: 9, seed: 37,
        gen: (rnd, x, b) => {
          const gap = gapOf(rnd, { home: [170, 380], grove: [160, 340], outpost: [190, 400], rocky: [110, 250], wild: [100, 230] }, b);
          const rock = rnd.chance({ rocky: 0.65, wild: 0.2 }[b] || 0.4);
          return { gap, item: rock ? { key: rnd.pick(ROCK_S), y: road.back + 14 + rnd.range(-2, 3), scale: rnd.range(0.34, 0.46), flip: rnd.chance(0.5) } : { key: rnd.pick(GRASS_S), y: road.back + 14 + rnd.range(-2, 3), scale: rnd.range(0.42, 0.56), flip: rnd.chance(0.5) } };
        },
      }),
      // the dirt verge below the road
      verge: new Scatter({
        factor: 1, z: 9, seed: 41,
        gen: (rnd, x, b) => {
          const gap = gapOf(rnd, { home: [180, 340], grove: [170, 320], outpost: [190, 360], rocky: [120, 260], wild: [110, 230] }, b);
          const rock = rnd.chance({ rocky: 0.6, wild: 0.2 }[b] || 0.35);
          const y = vb + rnd.range(10, 30);
          return { gap, item: rock ? { key: rnd.pick(ROCK_S), y, scale: rnd.range(0.44, 0.58), flip: rnd.chance(0.5) } : { key: rnd.pick(GRASS_S), y, scale: rnd.range(0.5, 0.66), flip: rnd.chance(0.5) } };
        },
      }),
      // big rocks and tufts nearest the camera (a touch faster than the road)
      fore: new Scatter({
        factor: 1.14, z: 9, seed: 53,
        gen: (rnd, x, b) => {
          const gap = gapOf(rnd, { home: [380, 760], grove: [400, 800], outpost: [380, 760], rocky: [260, 520], wild: [280, 560] }, b);
          if (rnd.chance(0.12)) return { gap };
          const rock = rnd.chance({ rocky: 0.7, wild: 0.3 }[b] || 0.5);
          return { gap, item: rock ? { key: rnd.pick(ROCK_L), y: rnd.range(1080, 1106), scale: rnd.range(0.55, 0.74), flip: rnd.chance(0.5) } : { key: rnd.pick(GRASS_L), y: rnd.range(1084, 1100), scale: rnd.range(0.6, 0.82), flip: rnd.chance(0.5) } };
        },
      }),
    };
  }

  /* FRONT view: the land beside the road for one wall, matching the biome
     the hero has run into.  Props stay outside the road + fences (road half-
     width 742 * (y - 610) / 470 at baseline y, see FRONT_CAM in
     tools/build-assets.py).  Returns [key, left x, baseline y, scale, flip]. */
  function frontScenery(rnd, biome) {
    const out = [];
    const hw = (y) => (742 * Math.max(0, y - 610)) / 470;
    // a random left x beside the road (left or right side) for a prop of width w
    // (mostly inside the 16:9 frame; a little spills into the 20:9 margins)
    const spot = (w, y) => {
      const pad = 60 + hw(y) * 0.12;
      const left = [-120 - w * 0.3, 960 - hw(y) - pad - w];
      const right = [960 + hw(y) + pad, STAGE_W + 120 - w * 0.7];
      const sides = [left, right].filter(([a, b]) => b > a);
      if (!sides.length) return null;
      const [a, b] = rnd.pick(sides);
      return rnd.range(a, b);
    };
    const add = (key, y, scale) => {
      const x = spot(A.image(key).w * scale, y);
      if (x != null) out.push([key, Math.round(x), Math.round(y), scale, rnd.chance(0.5)]);
    };
    const nFar = { grove: [5, 7], outpost: [3, 4], rocky: [1, 3], wild: [3, 5] }[biome];
    const nTrees = { grove: [7, 9], outpost: [3, 5], rocky: [2, 4], wild: [4, 6] }[biome];
    const nGround = { grove: [20, 24], outpost: [20, 24], rocky: [28, 34], wild: [30, 36] }[biome];
    const rockP = { grove: 0.4, outpost: 0.45, rocky: 0.7, wild: 0.2 }[biome];
    // a thin far row of small trees right on the horizon
    for (let i = 0, n = Math.round(rnd.range(...nFar)); i < n; i++) add(rnd.pick(DRY_TREES), rnd.range(618, 630), rnd.range(0.36, 0.46));
    // watchtowers on the horizon at an outpost, one lone big tree in the wild
    if (biome === 'outpost') for (let i = 0, n = rnd.chance(0.5) ? 2 : 1; i < n; i++) add('tower', rnd.range(640, 662), rnd.range(0.3, 0.38));
    if (biome === 'wild' || (biome === 'rocky' && rnd.chance(0.5))) add('tree', rnd.range(676, 700), rnd.range(0.42, 0.5));
    // dead trees along the horizon, bigger the nearer they stand
    for (let i = 0, n = Math.round(rnd.range(...nTrees)); i < n; i++) {
      const y = rnd.range(632, 690);
      add(rnd.pick(DRY_TREES), y, 0.58 + ((y - 632) / 58) * 0.42 + rnd.range(-0.06, 0.06));
    }
    // grass and rocks scattered over the land, smaller with distance
    for (let i = 0, n = Math.round(rnd.range(...nGround)); i < n; i++) {
      const y = rnd.range(640, 1060);
      const near = (y - 640) / 420;
      const rock = rnd.chance(rockP);
      const key = rock ? rnd.pick(near > 0.7 ? ['rock4', 'rock5', 'rock6'] : ROCK_S) : rnd.pick(near > 0.6 ? ['grass2', 'grass3', 'grass4', 'grass5', 'grass6'] : GRASS_S);
      add(key, y, 0.3 + 0.3 * near + rnd.range(-0.04, 0.04));
    }
    return out;
  }

  /* ----------------------------------------------------------------------- */
  /* glass mechanism                                                         */
  /* ----------------------------------------------------------------------- */
  class GlassMech {
    /**
     * @param {object} o { cx, cy, r, squash (scaleX for side view), rot (deg, clockwise) }
     */
    constructor(o) {
      this.id = 'glass' + ++uid;
      this.cx = o.cx;
      this.cy = o.cy;
      this.r = o.r;
      this.squash = o.squash || 1;
      this.rot = o.rot || 0;
      const R = this.r;
      const pad = 6;
      this.svg = svg('svg', {
        class: 'glass',
        viewBox: `${-R - pad} ${-R - pad} ${2 * (R + pad)} ${2 * (R + pad)}`,
        width: 2 * (R + pad),
        height: 2 * (R + pad),
        style: { left: this.cx - R - pad + 'px', top: this.cy - R - pad + 'px', transform: `rotate(${this.rot}deg) scaleX(${this.squash})` },
      });
      const defs = svg('defs');
      const grad = svg('radialGradient', { id: this.id + '-g', cx: '35%', cy: '30%', r: '80%' });
      grad.append(
        svg('stop', { offset: '0%', 'stop-color': '#b9e8ff', 'stop-opacity': '0.55' }),
        svg('stop', { offset: '55%', 'stop-color': '#5aa3e6', 'stop-opacity': '0.42' }),
        svg('stop', { offset: '100%', 'stop-color': '#2b2a7a', 'stop-opacity': '0.6' })
      );
      const mask = svg('mask', { id: this.id + '-m' });
      this.cut = svg('path', { d: '', fill: 'black' });
      mask.append(svg('rect', { x: -R - pad, y: -R - pad, width: 2 * (R + pad), height: 2 * (R + pad), fill: 'white' }), this.cut);
      const glow = svg('filter', { id: this.id + '-glow', x: '-30%', y: '-30%', width: '160%', height: '160%' });
      glow.append(svg('feGaussianBlur', { stdDeviation: '4', result: 'b' }), svg('feMerge', {}, [svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' })]));
      defs.append(grad, mask, glow);

      this.gGlass = svg('g', { mask: `url(#${this.id}-m)` });
      this.disc = svg('circle', { r: R + 2, fill: `url(#${this.id}-g)`, class: 'glass-disc' });
      this.shine = svg('ellipse', { cx: -R * 0.35, cy: -R * 0.45, rx: R * 0.42, ry: R * 0.16, fill: '#fff', opacity: '0.28', transform: 'rotate(-28)' });
      this.shine2 = svg('ellipse', { cx: R * 0.3, cy: R * 0.5, rx: R * 0.25, ry: R * 0.07, fill: '#fff', opacity: '0.16', transform: 'rotate(-28)' });
      this.tint = svg('circle', { r: R + 2, fill: '#ff2d55', opacity: '0', class: 'glass-tint' });
      this.gGlass.append(this.disc, this.shine, this.shine2, this.tint);

      // the opening: a light dark tint (the zombie behind must stay visible -
      // it is the timer) + a dark edge under a solid bright outline, so even
      // a thin arc reads clearly against the glass
      this.openShadow = svg('path', { d: '', fill: '#120a2a', opacity: '0.3' });
      this.edge = svg('path', { d: '', class: 'glass-edge', fill: 'none', stroke: '#1a0a2e', 'stroke-width': 11, 'stroke-linejoin': 'round', opacity: '0.85' });
      this.outline = svg('path', { d: '', class: 'glass-outline', fill: 'none', stroke: '#ffd166', 'stroke-width': 5, 'stroke-linejoin': 'round', filter: `url(#${this.id}-glow)` });
      this.center = svg('circle', { r: 4.5, fill: '#ffe08a', stroke: '#5b2a86', 'stroke-width': 2, class: 'glass-center' });
      this.cracks = svg('g', { class: 'cracks', filter: `url(#${this.id}-glow)` });
      this.rim = svg('circle', { r: R - 1, fill: 'none', stroke: '#ffffff', 'stroke-opacity': '0.25', 'stroke-width': 2 });
      this.lock = svg('circle', { r: R + 3, fill: 'none', stroke: '#7CFF8A', 'stroke-width': 5, opacity: '0', class: 'glass-lock' });
      // zombie timer: the rim pulses red in the last seconds
      this.danger = svg('circle', { r: R + 1, fill: 'none', stroke: '#ff3b5c', 'stroke-width': 8, class: 'glass-danger' });
      // (the shadow only covers the cut-out area, so it can sit above the glass)
      this.gOpen = svg('g', { class: 'glass-open' }, [this.openShadow, this.edge, this.outline]);
      this.svg.append(defs, this.gGlass, this.gOpen, this.center, this.cracks, this.rim, this.danger, this.lock);
      this.el = this.svg;
      this.spec = null;
    }

    setTarget(spec) {
      this.spec = spec;
      const d = spec ? ZD.geo.piecePath(spec, 0, 0, this.r) : '';
      this.cut.setAttribute('d', d);
      this.outline.setAttribute('d', d);
      this.edge.setAttribute('d', d);
      this.openShadow.setAttribute('d', d);
      this.outline.classList.remove('locked', 'good', 'bad');
      [this.outline, this.edge, this.openShadow].forEach((n) => (n.style.display = spec ? '' : 'none'));
    }

    /* Danger pulse on the rim (zombie timer running out). */
    setDanger(on) {
      this.svg.classList.toggle('danger', !!on);
    }

    /* The glass reseals with a NEW opening: old cracks fade, a shimmer ring
       sweeps the glass and the new opening fades in. */
    async reform(spec) {
      this.restore();
      this.setTarget(spec);
      ZD.audio.play('reform');
      anime.remove([this.gOpen, this.lock]);
      this.lock.setAttribute('stroke', '#bfe9ff');
      anime({ targets: this.lock, opacity: [0.9, 0], scale: [0.86, 1.08], duration: D(520), easing: 'easeOutCubic', complete: () => this.lock.setAttribute('stroke', '#7CFF8A') });
      await anime({ targets: this.gOpen, opacity: [0, 1], duration: D(420), delay: D(120), easing: 'easeOutQuad' }).finished;
    }

    /* 'approach' | 'good' | 'bad' | 'idle' */
    highlight(state) {
      this.outline.classList.remove('locked', 'good', 'bad');
      if (state === 'approach') this.outline.classList.add('locked');
      if (state === 'good') this.outline.classList.add('good');
      if (state === 'bad') this.outline.classList.add('bad');
    }

    /* Red glowing cracks spreading from (px,py) in local glass coordinates. */
    crack(px, py) {
      this.cracks.innerHTML = '';
      const R = this.r;
      const n = 11;
      const lines = [];
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + rand(-0.25, 0.25);
        let x = px;
        let y = py;
        const pts = [`${x},${y}`];
        const segs = randInt(3, 5);
        const len = rand(R * 0.5, R * 1.1);
        for (let s = 0; s < segs; s++) {
          const a = ang + rand(-0.5, 0.5);
          const l = len / segs;
          x += Math.cos(a) * l;
          y += Math.sin(a) * l;
          if (Math.hypot(x, y) > R - 2) {
            const k = (R - 2) / Math.hypot(x, y);
            x *= k;
            y *= k;
            pts.push(`${x},${y}`);
            break;
          }
          pts.push(`${x},${y}`);
        }
        const p = svg('polyline', { points: pts.join(' '), fill: 'none', stroke: '#ff3b5c', 'stroke-width': rand(2, 3.5), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        this.cracks.appendChild(p);
        lines.push(p);
        if (Math.random() < 0.6) {
          const q = svg('polyline', { points: pts.slice(1, 3).join(' '), fill: 'none', stroke: '#ffd0d8', 'stroke-width': 1.2, 'stroke-linecap': 'round', opacity: '0.7' });
          this.cracks.appendChild(q);
        }
      }
      lines.forEach((p) => {
        const L = p.getTotalLength();
        p.style.strokeDasharray = L;
        p.style.strokeDashoffset = L;
      });
      anime({ targets: lines, strokeDashoffset: 0, duration: D(420), easing: 'easeOutQuart', delay: anime.stagger(18) });
      anime({ targets: this.tint, opacity: [0, 0.55, 0.3], duration: D(500), easing: 'easeOutQuad' });
      this.svg.classList.add('cracked');
    }

    /* Whole glass breaks away (breach / game over). */
    shatter() {
      this.svg.classList.add('shattered');
      anime({ targets: [this.gGlass, this.cracks, this.rim, this.center], opacity: 0, duration: D(250), easing: 'linear' });
      [this.outline, this.edge, this.openShadow].forEach((n) => (n.style.display = 'none'));
      this.setDanger(false);
    }

    /* Mechanism unlocks after a correct hit: glass turns green and dissolves. */
    async unlock() {
      [this.outline, this.edge, this.openShadow].forEach((n) => (n.style.display = 'none'));
      this.setDanger(false);
      this.cut.setAttribute('d', '');
      await anime({ targets: this.lock, opacity: [0, 1], scale: [1, 1.08], duration: D(420), easing: 'easeOutCubic' }).finished;
      anime({ targets: this.lock, opacity: 0, duration: D(500), easing: 'linear' });
      await anime({ targets: [this.gGlass, this.rim, this.center], opacity: 0, duration: D(500), easing: 'easeInQuad' }).finished;
    }

    restore() {
      this.svg.classList.remove('cracked', 'shattered', 'danger');
      this.cracks.innerHTML = '';
      [this.gGlass, this.cracks, this.rim, this.center].forEach((n) => {
        n.style.opacity = '';
        n.removeAttribute('opacity');
      });
      anime.remove(this.gOpen);
      this.gOpen.style.opacity = '';
      this.tint.setAttribute('opacity', '0');
      this.tint.style.opacity = '';
      this.lock.setAttribute('opacity', '0');
      this.lock.style.opacity = '';
      this.lock.style.transform = '';
      this.setTarget(this.spec);
    }
  }

  /* ----------------------------------------------------------------------- */
  /* projectile                                                              */
  /* ----------------------------------------------------------------------- */
  class Projectile {
    constructor(r) {
      this.id = 'proj' + ++uid;
      this.r = r;
      const pad = 18;
      this.size = 2 * (r + pad);
      this.el = el('div', { class: 'projectile', style: { width: this.size + 'px', height: this.size + 'px' } });
      this.trail = el('div', { class: 'trail' });
      this.svg = svg('svg', { viewBox: `${-r - pad} ${-r - pad} ${this.size} ${this.size}`, width: this.size, height: this.size });
      const defs = svg('defs');
      const g = svg('linearGradient', { id: this.id + '-g', x1: '0', y1: '0', x2: '0', y2: '1' });
      g.append(svg('stop', { offset: '0%', 'stop-color': '#ffe8a3' }), svg('stop', { offset: '45%', 'stop-color': '#ffb347' }), svg('stop', { offset: '100%', 'stop-color': '#ff6f3c' }));
      const glow = svg('filter', { id: this.id + '-glow', x: '-40%', y: '-40%', width: '180%', height: '180%' });
      glow.append(svg('feGaussianBlur', { stdDeviation: '6', result: 'b' }), svg('feMerge', {}, [svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' })]));
      defs.append(g, glow);
      this.halo = svg('path', { d: '', fill: '#ffd166', opacity: '0.55', filter: `url(#${this.id}-glow)` });
      this.body = svg('path', { d: '', fill: `url(#${this.id}-g)`, stroke: '#7a2d12', 'stroke-width': 4, 'stroke-linejoin': 'round' });
      this.sheen = svg('path', { d: '', fill: 'none', stroke: '#fff6d6', 'stroke-width': 2.5, 'stroke-linejoin': 'round', opacity: '0.7', transform: 'translate(-3,-3)' });
      this.svg.append(defs, this.halo, this.body, this.sheen);
      this.el.append(this.trail, this.svg);
      this.x = 0;
      this.y = 0;
      this.scale = 1;
      this.rot = 0;
      this.sx = 1;
      this.spec = null;
    }

    setSpec(spec, rot = 0) {
      this.spec = spec;
      const d = ZD.geo.piecePath(spec, 0, 0, this.r, rot);
      this.body.setAttribute('d', d);
      this.halo.setAttribute('d', d);
      this.sheen.setAttribute('d', d);
    }

    set(x, y, scale, rot, sx) {
      if (x != null) this.x = x;
      if (y != null) this.y = y;
      if (scale != null) this.scale = scale;
      if (rot != null) this.rot = rot;
      if (sx != null) this.sx = sx;
      this.el.style.transform = `translate(${this.x - this.size / 2}px, ${this.y - this.size / 2}px) rotate(${this.rot}deg) scale(${this.scale * this.sx}, ${this.scale})`;
    }

    setTrail(angleDeg, strength) {
      this.trail.style.opacity = strength;
      this.trail.style.transform = `rotate(${angleDeg}deg) scaleX(${0.6 + strength})`;
    }

    show(v) {
      this.el.style.display = v ? '' : 'none';
    }

    /**
     * Fly along a quadratic bezier.  from/to/ctrl: {x,y}; returns promise.
     * onProgress(t, pos) lets callers react (e.g. alignment lock-on).
     */
    fly({ from, to, ctrl, duration, scaleFrom = 1, scaleTo = 1, rotFrom = 0, rotTo = 0, spin = 0, sxFrom = 1, sxTo = 1, easing = 'easeInQuad', onProgress }) {
      const o = { t: 0 };
      this.show(true);
      let prev = from;
      return anime({
        targets: o,
        t: 1,
        duration,
        easing,
        update: () => {
          const t = o.t;
          const mt = 1 - t;
          const x = mt * mt * from.x + 2 * mt * t * ctrl.x + t * t * to.x;
          const y = mt * mt * from.y + 2 * mt * t * ctrl.y + t * t * to.y;
          const align = clamp((t - 0.55) / 0.35, 0, 1); // last third: align with the opening
          const rot = rotFrom + (rotTo - rotFrom) * align + spin * Math.sin(t * Math.PI) * (1 - align);
          const sc = scaleFrom + (scaleTo - scaleFrom) * t;
          const sx = sxFrom + (sxTo - sxFrom) * t;
          this.set(x, y, sc, rot, sx);
          const ang = (Math.atan2(y - prev.y, x - prev.x) * 180) / Math.PI;
          this.setTrail(ang, clamp(1 - t * 0.6, 0.15, 1));
          prev = { x, y };
          onProgress && onProgress(t, { x, y });
        },
      }).finished;
    }
  }

  /* ----------------------------------------------------------------------- */
  /* effects                                                                 */
  /* ----------------------------------------------------------------------- */
  const fx = {
    shards(container, x, y, n = 14, colors = ['#bfe9ff', '#8fd3ff', '#ffffff', '#ff8aa0']) {
      for (let i = 0; i < n; i++) {
        const s = el('div', { class: 'shard', style: { left: x + 'px', top: y + 'px', background: pick(colors), width: randInt(10, 26) + 'px', height: randInt(10, 26) + 'px', clipPath: pick(['polygon(0 0,100% 20%,60% 100%)', 'polygon(10% 0,100% 0,70% 100%,0 60%)', 'polygon(50% 0,100% 100%,0 100%)']) } });
        container.appendChild(s);
        const ang = rand(0, Math.PI * 2);
        const dist = rand(90, 320);
        anime({
          targets: s,
          translateX: Math.cos(ang) * dist,
          translateY: [Math.sin(ang) * dist * 0.6, Math.sin(ang) * dist * 0.6 + rand(120, 260)],
          rotate: rand(-540, 540),
          opacity: [1, 0],
          duration: D(rand(650, 1000)),
          easing: 'easeOutQuad',
          complete: () => s.remove(),
        });
      }
    },
    sparkles(container, x, y, n = 16, color = '#fff2a8') {
      for (let i = 0; i < n; i++) {
        const s = el('div', { class: 'spark', style: { left: x + 'px', top: y + 'px', background: color } });
        container.appendChild(s);
        const ang = rand(0, Math.PI * 2);
        const dist = rand(60, 220);
        anime({ targets: s, translateX: Math.cos(ang) * dist, translateY: Math.sin(ang) * dist, scale: [rand(0.8, 1.6), 0], opacity: [1, 0], duration: D(rand(500, 900)), easing: 'easeOutCubic', complete: () => s.remove() });
      }
    },
    ring(container, x, y, color = '#ffd166', size = 60) {
      const r = el('div', { class: 'ring', style: { left: x + 'px', top: y + 'px', width: size + 'px', height: size + 'px', marginLeft: -size / 2 + 'px', marginTop: -size / 2 + 'px', borderColor: color } });
      container.appendChild(r);
      anime({ targets: r, scale: [0.3, 4], opacity: [0.9, 0], duration: D(600), easing: 'easeOutCubic', complete: () => r.remove() });
    },
    puffs(container, x, y, n = 7) {
      for (let i = 0; i < n; i++) {
        const p = el('div', { class: 'puff', style: { left: x + 'px', top: y + 'px' } });
        container.appendChild(p);
        const ang = rand(0, Math.PI * 2);
        const dist = rand(30, 110);
        anime({ targets: p, translateX: Math.cos(ang) * dist, translateY: Math.sin(ang) * dist - 30, scale: [0.4, rand(1.2, 2.2)], opacity: [0.9, 0], duration: D(rand(500, 800)), easing: 'easeOutQuad', complete: () => p.remove() });
      }
    },
    /* a little road dust behind running feet: drifts back and up, fades */
    dust(container, x, y, dir = 1) {
      const p = el('div', { class: 'puff dust', style: { left: x + 'px', top: y + 'px' } });
      container.appendChild(p);
      anime({ targets: p, translateX: -dir * rand(50, 110), translateY: -rand(10, 34), scale: [0.45, rand(1.5, 2.1)], opacity: [0.85, 0], duration: D(rand(420, 620)), easing: 'easeOutQuad', complete: () => p.remove() });
    },
    stars(container, x, y, n = 5, dur = 1800) {
      const g = el('div', { class: 'dizzy', style: { left: x + 'px', top: y + 'px' } });
      for (let i = 0; i < n; i++) g.appendChild(el('span', { text: '★', style: { transform: `rotate(${(360 / n) * i}deg) translateX(44px)` } }));
      container.appendChild(g);
      anime({ targets: g, rotate: 720, duration: dur, easing: 'linear' });
      anime({ targets: g, opacity: [0, 1, 1, 0], duration: dur, easing: 'linear', complete: () => g.remove() });
      return g;
    },
    flash(color = '#ffffff', dur = 260, maxOpacity = 0.7) {
      const f = document.getElementById('flash');
      f.style.background = color;
      anime.remove(f);
      anime({ targets: f, opacity: [maxOpacity, 0], duration: D(dur), easing: 'easeOutQuad' });
    },
    shake(intensity = 10, dur = 420) {
      const w = document.getElementById('world');
      anime.remove(w);
      anime({
        targets: w,
        translateX: [0, intensity, -intensity, intensity * 0.6, -intensity * 0.6, 0],
        translateY: [0, -intensity * 0.5, intensity * 0.5, -intensity * 0.3, 0],
        duration: dur,
        easing: 'easeOutQuad',
      });
    },
  };

  /* ----------------------------------------------------------------------- */
  /* FRONT scene                                                             */
  /* ----------------------------------------------------------------------- */
  class FrontScene {
    constructor() {
      this.el = el('div', { class: 'scene front', id: 'front' });
      this.layers = [];
      const L = (lay) => {
        this.layers.push(lay);
        this.el.appendChild(lay.node);
        return lay;
      };
      L(tiledLayer('sky', { y: -60, z: 1, factor: 0 }));
      this.clouds = cloudLayers([['cloud1', 120, 150, 0.6, false], ['cloud3', 760, 95, 0.55, true], ['cloud4', 1250, 230, 0.6, false], ['cloud2', 1650, 120, 0.5, true], ['cloud3', -260, 300, 0.5, false]], 0.02).map(L);
      // no sun in the front view (it competes with the window); the side view keeps its sun
      L(tiledLayer('skyline', { y: skylineTop(574), z: 3, factor: 0.05, cls: 'far', mirror: true, scale: S_FAR }));
      L(tiledLayer('haze', { y: 230, z: 4, factor: 0, opacity: 0.55, cls: 'far', mirror: true }));
      L(tiledLayer('mountains', { y: 440, z: 5, factor: 0.08, cls: 'far', mirror: true }));
      // the side view's tree stands on the left, where the side view has its
      // watchtower (first wall only; later walls get their own land, setScenery)
      this.bigTree = L(propLayer('tree', { x: -150, y: 760, scale: 0.8, z: 6, factor: 0.12, cls: 'mid faded' }));
      /* Ground, road and fences are pre-rendered by tools/build-assets.py
         (build_front_road) from ONE perspective camera, so the wall reads as
         standing IN the road:  vanishing point (960, 610), camera height 470,
         perspective 1000, road half-width 742 -> ~297px at the wall's depth,
         i.e. the wall spans the road fence to fence.  Change FRONT_CAM there,
         not here. */
      const baked = (key, z) => {
        const im = A.image(key);
        return el('div', { class: 'layer baked', style: { left: WORLD_X + 'px', top: im.y + 'px', width: im.w + 'px', height: im.h + 'px', zIndex: z, backgroundImage: `url("${A.imageUrl(key)}")` } });
      };
      this.el.appendChild(baked('frontGround', 7));

      /* Scenery on the land outside the fences: a row of dry trees along the
         horizon and small grass and rocks scattered over the ground.  The
         first wall uses this hand-placed layout; every later wall gets land
         generated for the biome the hero has run into (setScenery).
         [key, left x, baseline y, scale]; drawn far-to-near so nearer things
         overlap farther ones. */
      const propsEl = el('div', { class: 'props', style: { zIndex: 8 } });
      this.el.appendChild(propsEl);
      this.sceneryEl = el('div', { class: 'props' });
      propsEl.appendChild(this.sceneryEl);
      this.homeScenery = [
        // dry trees along the horizon (left and right of the road)
        ['dryTree9', 400, 640, 0.68], ['dryTree11', -60, 665, 0.75],
        ['dryTree2', 1270, 636, 0.66], ['dryTree6', 1480, 652, 0.8], ['dryTree12', 1700, 672, 0.95],
        // small grass and rocks, smaller with distance
        ['grass7', 560, 640, 0.3], ['rock8', 420, 652, 0.32], ['grass6', 1250, 646, 0.3], ['rock7', 1400, 660, 0.34],
        ['grass5', 330, 690, 0.36], ['rock6', 160, 712, 0.38], ['grass4', 1460, 700, 0.38], ['rock8', 1640, 716, 0.4],
        ['grass6', 1880, 690, 0.4], ['grass3', -60, 760, 0.44], ['rock5', 300, 790, 0.42], ['grass7', 1560, 780, 0.46],
        ['rock6', 1820, 800, 0.46], ['grass5', 120, 870, 0.5], ['rock7', 1700, 900, 0.5], ['grass2', -80, 960, 0.56],
        ['rock4', 1840, 990, 0.52], ['grass6', 1520, 1010, 0.56], ['rock8', 60, 1050, 0.6],
      ];
      this.setScenery(0);

      /* Small rocks lying on the brick road: [key, centre x, baseline y, size].
         Scaled by depth on the road plane (k = (y - 610) / 470, 1 at the stage
         bottom) and darkened toward the far end like the road; drawn under the
         fences, so one near an edge tucks under the fence.  Kept off the
         hero's spot (x 310-470). */
      const roadRocks = [
        ['rock8', 862, 818, 0.9], ['rock8', 884, 821, 0.55],
        ['rock7', 1088, 836, 0.75],
        ['rock8', 700, 866, 1.0],
        ['rock6', 1232, 884, 0.55], ['rock8', 1262, 888, 0.6],
        ['rock7', 936, 912, 0.8],
        ['rock8', 1452, 964, 1.0], ['rock8', 1480, 968, 0.6],
        ['rock7', 1530, 1012, 0.9],
        ['rock8', 560, 1036, 0.9],
      ];
      roadRocks.forEach(([k, cx, y, size]) => {
        const depth = (y - 610) / 470;
        const scale = size * depth;
        const p = propLayer(k, { x: Math.round(cx - (A.image(k).w * scale) / 2), y, scale, z: 8 });
        const t = Math.min(1, Math.max(0, (y - 790) / 290));
        p.node.style.filter = `brightness(${(0.84 + 0.16 * t).toFixed(2)}) drop-shadow(0 ${Math.max(1, Math.round(3 * depth))}px 1px rgba(40, 10, 0, 0.45))`;
        propsEl.appendChild(p.node);
      });

      // chain-link fences lining both sides of the road
      this.el.appendChild(baked('frontFences', 9));

      // the wall, standing across the road (fence to fence)
      /* Placed by its base, not its hole: the base stands on the road at
         WALL_BASE_Y (just past the brick road's far edge, y 790) and the wall
         is exactly as wide as the road there, fence to fence (FRONT_CAM in
         tools/build-assets.py: half-width 742 * (y - 610) / 470).  The hole
         and the glass follow from the art. */
      const wall = A.wall('front');
      const WALL_BASE_Y = 798;
      const span = (2 * 742 * (WALL_BASE_Y - 610)) / 470;
      this.wallScale = span / wall.w;
      const ww = Math.round(wall.w * this.wallScale);
      const wh = Math.round(wall.h * this.wallScale);
      const wx = Math.round(960 - ww / 2);
      const wy = WALL_BASE_Y - wh;
      this.hole = { x: wx + wall.hole.cx * this.wallScale, y: wy + wall.hole.cy * this.wallScale };
      // the glass reaches 2px under the opening's edge so it sits flush on the
      // bricks (no dark gap from the art's outline around the hole)
      const GLASS_OVERLAP = 2;
      this.R = Math.round(((wall.hole.rx + wall.hole.ry) / 2) * this.wallScale) + GLASS_OVERLAP;
      // contact shadow on the road under the wall's base
      this.el.appendChild(el('div', { class: 'wall-shadow', style: { left: wx - 30 + 'px', top: wy + wh - 18 + 'px', width: ww + 60 + 'px', height: '40px', zIndex: 10 } }));
      // corner rocks + grass in the foreground (as in the land art)
      const fore = el('div', { class: 'props', style: { zIndex: 13 } });
      this.el.appendChild(fore);
      [[-150, 1110, 'rock1', 1.0], [70, 1095, 'grass3', 0.9], [1720, 1105, 'rock2', 1.0], [1640, 1090, 'grass1', 0.85], [1930, 1100, 'grass4', 0.9]].forEach(([x, y, k, sc]) => {
        fore.appendChild(propLayer(k, { x, y, scale: sc, z: 13 }).node);
      });

      // zombie waits behind the wall, visible through the opening.  Its
      // distance from the glass is the timer: ZPOSE.far (head just above the
      // sill) -> ZPOSE.near (face pressed to the glass); see zombieClimb().
      this.zombie = new ZD.Sprite({ className: 'char-zombie behind', zIndex: 10 });
      this.zombie.setSheet('zombie.front.idle');
      this.zpose = {
        far: { y: this.hole.y + this.R * 1.55, s: 0.92 },
        mid: { y: this.hole.y + this.R * 1.05, s: 1.1 },
        near: { y: this.hole.y + this.R * 1.14, s: 1.85 },
      };
      this._placeZombie(this.zpose.mid, 0);
      this.el.appendChild(this.zombie.el);
      // soft dark interior behind the glass so the zombie reads as "beyond"
      this.interior = el('div', { class: 'interior', style: { left: this.hole.x - this.R + 'px', top: this.hole.y - this.R + 'px', width: this.R * 2 + 'px', height: this.R * 2 + 'px', zIndex: 10 } });
      this.el.appendChild(this.interior);
      this.wallEl = el('div', { class: 'wall-stage', style: { left: wx + 'px', top: wy + 'px', width: ww + 'px', height: wh + 'px', zIndex: 11, backgroundImage: `url("${A.wallUrl('front')}")` } });
      this.el.appendChild(this.wallEl);
      this.glass = new GlassMech({ cx: this.hole.x, cy: this.hole.y, r: this.R });
      this.glass.el.style.zIndex = 12;
      this.el.appendChild(this.glass.el);

      // zombie health: one glowing orb per hit still needed, on a plaque
      // fixed to the bricks under the window
      this.hpEl = el('div', { class: 'zombie-hp', style: { left: this.hole.x + 'px', top: this.hole.y + this.R + 46 + 'px', zIndex: 12 } });
      this.el.appendChild(this.hpEl);

      // hero (back view) in the foreground
      this.hero = new ZD.Sprite({ className: 'char-hero', zIndex: 20 });
      this.hero.setSheet('hero.backIdle');
      this.heroHome = { x: 390, y: 1062 };
      this.hero.setScale(1.2);
      this.hero.setPos(this.heroHome.x, this.heroHome.y);
      this.el.appendChild(this.hero.el);
      this.heroHand = { x: 530, y: 790 };

      this.projectile = new Projectile(this.R);
      this.projectile.el.style.zIndex = 15;
      this.projectile.show(false);
      this.el.appendChild(this.projectile.el);

      this.fxLayer = el('div', { class: 'fx', style: { zIndex: 30 } });
      this.el.appendChild(this.fxLayer);
      this.setScroll(0);
    }

    setScroll(px) {
      this.layers.forEach((l) => {
        if (l.tiled) scrollTiled(l, px);
        else if (l.cloud) placeCloud(l, px);
        else if (l.factor) l.node.style.transform = `translateX(${-px * l.factor}px)`;
      });
    }

    setTarget(spec) {
      this.glass.setTarget(spec);
    }

    /* Land beside the road for the wall at `travel` px along the run (the
       side view's distance): same biome as the side view shows there, and a
       fresh layout per wall.  Called while this view is hidden. */
    setScenery(travel) {
      const at = Math.round(travel);
      if (at === this._sceneryAt) return;
      this._sceneryAt = at;
      const biome = biomeAt(at);
      const list = biome === 'home' ? this.homeScenery : frontScenery(seeded(hash32(at, 99)), biome);
      this.sceneryEl.innerHTML = '';
      list
        .slice()
        .sort((a, b) => a[2] - b[2])
        // dry trees and towers are faded a little (see .faded in style.css)
        .forEach(([k, x, y, sc, flip]) => this.sceneryEl.appendChild(propLayer(k, { x, y, scale: sc, flip: !!flip, cls: /^(dryTree|tower|tree)/.test(k) ? 'faded' : '' }).node));
      this.bigTree.node.style.display = biome === 'home' ? '' : 'none';
    }

    idle() {
      this.hero.play({ sheet: 'hero.backIdle', fps: 9, loop: true });
      this.zombie.play({ sheet: 'zombie.front.idle', fps: 8, loop: true });
    }

    /* ---- zombie health pips ---- */
    setZombieHp(n, max) {
      this.hpEl.innerHTML = '';
      this.hpEl.style.display = max > 1 ? '' : 'none'; // only when a wall needs several hits
      for (let i = 0; i < max; i++) this.hpEl.appendChild(el('span', { class: 'hp' + (i < n ? '' : ' gone') }));
    }
    popZombieHp(index) {
      const pip = this.hpEl.children[index];
      if (!pip) return;
      anime.remove(pip);
      anime({ targets: pip, scale: [1, 1.7, 1], duration: D(420), easing: 'easeOutBack' });
      ZD.clock.timeout(() => pip.classList.add('gone'), D(140));
    }

    /* ---- zombie behind the glass (the timer) ---- */
    _placeZombie(p, bob) {
      this.zombie.setScale(p.s);
      this.zombie.setPos(this.hole.x + (p.x || 0), p.y + (bob || 0));
      // the closer it is, the less the dark interior hides it
      const k = clamp((p.s - this.zpose.far.s) / (this.zpose.near.s - this.zpose.far.s), 0, 1);
      if (this.interior) this.interior.style.opacity = String(1 - 0.55 * k);
    }

    stopZombie() {
      if (this._zAnim) {
        this._zAnim._killed = true; // never restarted by a pause-menu resume
        this._zAnim.pause();
      }
      this._zAnim = null;
      this.climbing = false;
      this.glass.setDanger(false);
    }

    /* No timer: the zombie paces from side to side behind the glass. */
    zombiePace() {
      this.stopZombie();
      const z = this.zombie;
      z.play({ sheet: 'zombie.front.run', fps: 9, loop: true });
      const base = Object.assign({}, this.zpose.mid);
      const o = { x: 0 };
      this._placeZombie(base, 0);
      this._zAnim = anime({ targets: o, x: [-this.R * 0.42, this.R * 0.42], duration: 2600, direction: 'alternate', loop: true, easing: 'easeInOutSine', update: () => this._placeZombie(Object.assign({}, base, { x: o.x }), 0) });
    }

    /* Timer: the zombie climbs from far below the sill up to the glass in
       `ms`.  Resolves 'timeout' when it gets there; stopZombie() cancels.
       Paused with the game (anime + ZD.clock). */
    zombieClimb(ms) {
      this.stopZombie();
      const z = this.zombie;
      z.play({ sheet: 'zombie.front.run', fps: 7, loop: true });
      const { far, near } = this.zpose;
      const o = { p: 0 };
      const steps = Math.max(4, Math.round(ms / 1600)); // hand-over-hand pulls
      let lastStep = 0;
      let lastBeat = 0;
      this._placeZombie(far, 0);
      this.climbing = true;
      return new Promise((resolve) => {
        this._zAnim = anime({
          targets: o,
          p: 1,
          duration: ms,
          easing: 'linear',
          update: () => {
            const p = o.p;
            // each pull is quick then a pause: a stepped climb, not a glide
            const f = p * steps;
            const stepP = (Math.floor(f) + ZD.util.easeOutCubic(f % 1)) / steps;
            const q = Math.min(1, stepP);
            this._placeZombie({ y: far.y + (near.y - far.y) * q, s: far.s + (near.s - far.s) * q }, -Math.sin((f % 1) * Math.PI) * 10);
            if (Math.floor(f) !== lastStep) {
              lastStep = Math.floor(f);
              ZD.audio.play('scrape');
            }
            const danger = p > 0.7;
            this.glass.setDanger(danger);
            if (danger && performance.now() - lastBeat > 850) {
              lastBeat = performance.now();
              ZD.audio.play('heartbeat');
            }
          },
          complete: () => {
            this._zAnim = null;
            this.climbing = false;
            resolve('timeout');
          },
        });
      });
    }

    /* Hit (not the knockout): the zombie reels and drops back from the glass. */
    async zombieKnockBack() {
      this.stopZombie();
      const z = this.zombie;
      const from = { y: z.y, s: z.scale };
      const to = this.zpose.far;
      const o = { t: 0 };
      z.play({ sheet: 'zombie.front.hit', fps: 14 });
      await anime({ targets: o, t: 1, duration: D(650), easing: 'easeInBack', update: () => this._placeZombie({ y: from.y + (to.y + this.R * 0.3 - from.y) * o.t, s: from.s + (to.s - from.s) * o.t }, 0) }).finished;
    }

    /* Time out: the zombie bangs on the glass until it cracks. */
    async zombieBang() {
      this.stopZombie();
      const z = this.zombie;
      this._placeZombie(this.zpose.near, 0);
      ZD.audio.play('groan');
      await z.play({ sheet: 'zombie.front.attack', fps: 20 });
    }
  }

  /* ----------------------------------------------------------------------- */
  /* SIDE scene                                                              */
  /* ----------------------------------------------------------------------- */
  class SideScene {
    constructor() {
      this.el = el('div', { class: 'scene side', id: 'side' });
      this.layers = [];
      this.scrollX = 0;
      const L = (lay) => {
        this.layers.push(lay);
        this.el.appendChild(lay.node);
        return lay;
      };
      L(tiledLayer('sky', { y: -60, z: 1, factor: 0 }));
      this.clouds = cloudLayers([['cloud2', 60, 140, 0.55, false], ['cloud3', 620, 250, 0.6, false], ['cloud1', 1080, 110, 0.55, true], ['cloud4', 1560, 220, 0.55, true], ['cloud3', 2000, 90, 0.5, false], ['cloud1', -280, 280, 0.45, false]], 0.04).map(L);
      // the sun is very far away: it barely moves however far the hero runs
      L(sunLayer({ x: 1480, y: 330, d: 230, factor: 0.012 }));
      L(tiledLayer('skyline', { y: skylineTop(534), z: 3, factor: 0.1, cls: 'far', mirror: true, scale: S_FAR }));
      L(tiledLayer('haze', { y: 200, z: 4, factor: 0.12, opacity: 0.6, cls: 'far', mirror: true }));
      L(tiledLayer('mountains', { y: 420, z: 5, factor: 0.2, cls: 'far', mirror: true }));
      // (the land's props - trees, watchtowers, grass, rocks - are generated
      // bands, added below once the road is measured)
      const fenceL = L(tiledLayer('fenceFront', { y: 416, z: 7, factor: 0.7, cls: 'mid', mirror: true }));
      /* Road (land/image copy.png): a brick walkway whose top surface is visible.
         ROAD.y is the layer top; at ROAD.scale its top surface runs from
         ROAD.back (far edge) to ROAD.front (near edge).  Characters stand on it
         at groundY; the wall's base sits between roadBack and roadFront (below). */
      const ROAD = { y: 712, scale: 1.25 };
      ROAD.back = ROAD.y + 4 * ROAD.scale; // image rows, relative to the built crop
      ROAD.front = ROAD.y + 98 * ROAD.scale;
      this.road = ROAD;
      this.groundY = 770;
      // dirt verge below the (lower) road; drawn first so the road's
      // shadowed bottom edge overlaps it
      ROAD.bottom = ROAD.y + Math.round(A.image('roadTop').h * ROAD.scale);
      L(tiledLayer('dirt', { y: ROAD.bottom - 14, z: 8, factor: 1, h: 1080 - ROAD.bottom + 14, scale: 0.55, mirror: true }));
      L(tiledLayer('roadTop', { y: ROAD.y, z: 8, factor: 1, scale: ROAD.scale, mirror: true }));
      /* The land's props, generated endlessly from the distance run (see
         Scatter): distant trees and watchtowers seen through the fence, big
         ones just behind it, grass and pebbles on the road's back edge and
         the verge, big rocks and tufts nearest the camera. */
      this.scatter = sideScatter(ROAD);
      const sc = this.scatter;
      this.el.insertBefore(sc.far.node, fenceL.node);
      this.el.insertBefore(sc.mid.node, fenceL.node);
      [sc.road, sc.verge, sc.fore].forEach((s) => this.el.appendChild(s.node));
      // distance already run past earlier walls; scroll px is added on top
      this.travel = 0;

      // walls: two slots so the next checkpoint can slide in while this one leaves
      this.wallHome = 985; // x of the wall's left edge at rest
      const wallDef = A.wall('angle1');
      // same on-screen size as with the first wall art (see-through height 126.6)
      this.wallScale = 126.6 / wallDef.hole.ry;
      this.wallW = Math.round(wallDef.w * this.wallScale);
      this.wallH = Math.round(wallDef.h * this.wallScale);
      // see-through part of the hole (the leap cover is cut at its centre)
      this.holeOffset = { x: wallDef.hole.cx * this.wallScale, y: wallDef.hole.cy * this.wallScale };
      /* The glass fills the hole's FRONT opening (the rim on the wall face,
         incl. the brick tunnel seen through it), an ellipse fitted in
         build_walls (`rim`: centre, semi-axes, tilt). */
      const rim = wallDef.rim;
      this.rimOffset = { x: rim.cx * this.wallScale, y: rim.cy * this.wallScale };
      const GLASS_OVERLAP = 2; // as in the front view: flush with the bricks, no gap
      this.holeRy = rim.ry * this.wallScale + GLASS_OVERLAP;
      this.holeRx = rim.rx * this.wallScale + GLASS_OVERLAP;
      this.holeRot = rim.rot;

      /* Stand the wall (the least-turned wall of wall/image copy.png, drawn as
         it is - no skew) on the road's top surface.  Its base runs from the
         far corner down to the near corner (both measured by build_walls):
         the near corner stands just behind the road's front edge, which puts
         the far corner just inside the back edge. */
      const near = { x: wallDef.base.near.x * this.wallScale, y: wallDef.base.near.y * this.wallScale };
      const far = { x: wallDef.base.far.x * this.wallScale, y: wallDef.base.far.y * this.wallScale };
      const nearY = ROAD.front - 10;
      this.wallTop = nearY - near.y;
      this.baseLine = { x0: this.wallHome + far.x, y0: this.wallTop + far.y, x1: this.wallHome + near.x, y1: nearY };

      this.walls = [this._makeWall(), this._makeWall()];
      this.cur = 0;
      this.walls[1].root.style.display = 'none';

      this.hole = { x: this.wallHome + this.rimOffset.x, y: this.wallTop + this.rimOffset.y };

      // Depth cover for leaps through the circle: a copy of the wall's far half
      // (right of the hole centre), drawn above the characters.  Whatever has
      // passed the wall plane is hidden by bricks and seen only through the
      // (transparent) hole.  Shown only while someone goes through the wall.
      this.cover = el('div', { class: 'wall-cover-wrap', style: { zIndex: 21, display: 'none' } });
      const coverBox = this._wallBox();
      const coverSvg = svg('svg', { class: 'wall-cover', width: this.wallW, height: this.wallH, viewBox: `0 0 ${this.wallW} ${this.wallH}` });
      Object.assign(coverSvg.style, { left: this.wallHome + 'px', top: this.wallTop + 'px' });
      const cm = svg('mask', { id: 'wall-cover-m' });
      cm.append(svg('rect', { x: this.holeOffset.x, y: 0, width: this.wallW, height: this.wallH, fill: 'white' }));
      coverSvg.append(svg('defs', {}, [cm]), svg('image', { href: A.wallUrl('angle1'), width: this.wallW, height: this.wallH, preserveAspectRatio: 'none', mask: 'url(#wall-cover-m)' }));
      coverBox.appendChild(coverSvg);
      this.cover.appendChild(coverBox);
      this.el.appendChild(this.cover);
      // character sizes in the side view
      this.heroScale = 0.86;
      this.zombieScale = 1.38;
      // feet -> body-centre distance (scaled px), measured from the sheets;
      // heroLeapCore is for hero.sideLeap, whose mid-air frames sit higher
      this.heroCore = Math.round(150 * this.heroScale);
      this.heroLeapCore = Math.round(205 * this.heroScale);
      // zombie cores are read per skin from the sheets (see zombieCore)

      // characters
      this.heroHome = { x: 330, y: this.groundY };
      this.hero = new ZD.Sprite({ className: 'char-hero', zIndex: 20 });
      this.hero.setSheet('hero.sideIdle');
      this.hero.setScale(this.heroScale);
      this.hero.setPos(this.heroHome.x, this.heroHome.y);
      this.el.appendChild(this.hero.el);
      this.heroHand = { x: this.heroHome.x + Math.round(170 * this.heroScale), y: this.groundY - Math.round(190 * this.heroScale) };

      this.zombieHome = { x: 1500, y: this.groundY + 4 };
      this.zombie = new ZD.Sprite({ className: 'char-zombie', zIndex: 18 });
      this.zombie.setSheet('zombie.side.idle');
      this.zombie.setScale(this.zombieScale);
      this.zombie.setPos(this.zombieHome.x, this.zombieHome.y);
      this.el.appendChild(this.zombie.el);

      // extra zombies for the intro horde
      this.extras = [];

      this.projectile = new Projectile(this.holeRy);
      this.projectile.el.style.zIndex = 15;
      this.projectile.show(false);
      this.el.appendChild(this.projectile.el);

      this.gate = null;
      this.fxLayer = el('div', { class: 'fx', style: { zIndex: 30 } });
      this.el.appendChild(this.fxLayer);
      this.setScroll(0);
    }

    /* full-stage box holding the wall art and what is drawn on it */
    _wallBox() {
      return el('div', { class: 'wall-box' });
    }

    _makeWall() {
      const root = el('div', { class: 'wall-slot', style: { zIndex: 12 } });
      // contact shadow on the road, along the wall's base
      const b = this.baseLine;
      const len = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
      const shadow = el('div', { class: 'wall-shadow', style: { left: (b.x0 + b.x1) / 2 - len * 0.6 + 'px', top: (b.y0 + b.y1) / 2 - 16 + 'px', width: len * 1.2 + 'px', transform: `rotate(${(Math.atan2(b.y1 - b.y0, b.x1 - b.x0) * 180) / Math.PI}deg)` } });
      const body = this._wallBox();
      const img = el('div', { class: 'wall-side', style: { left: this.wallHome + 'px', top: this.wallTop + 'px', width: this.wallW + 'px', height: this.wallH + 'px', backgroundImage: `url("${A.wallUrl('angle1')}")` } });
      const glass = new GlassMech({ cx: this.wallHome + this.rimOffset.x, cy: this.wallTop + this.rimOffset.y, r: this.holeRy, squash: this.holeRx / this.holeRy, rot: this.holeRot });
      body.append(img, glass.el);
      root.append(shadow, body);
      this.el.appendChild(root);
      return { root, img, glass, offset: 0 };
    }

    get wall() {
      return this.walls[this.cur];
    }

    get nextWall() {
      return this.walls[1 - this.cur];
    }

    setTarget(spec) {
      this.wall.glass.setTarget(spec);
    }

    /* px = camera offset from the current checkpoint (walls, zombie and gate
       are placed relative to it).  The scenery uses the total distance run
       (travel + px), so it never jumps back when a new checkpoint becomes
       current - the land keeps rolling on from wall to wall. */
    setScroll(px) {
      this.scrollX = px;
      const world = this.travel + px;
      this.sceneX = world;
      this.layers.forEach((l) => {
        if (l.tiled) scrollTiled(l, world);
        else if (l.cloud) placeCloud(l, world);
        else if (l.factor) l.node.style.transform = `translateX(${wrapX(l.x - world * l.factor, l.w) - l.x}px)`;
      });
      Object.values(this.scatter).forEach((s) => s.update(world));
      this.walls.forEach((w) => {
        w.root.style.transform = `translateX(${w.offset - px}px)`;
      });
      this.zombie.setPos(this.zombieHome.x + this.zombieOffset - px, this.zombieHome.y);
      if (this.gate) this.gate.style.transform = `translateX(${this.gateOffset - px}px)`;
    }

    zombieOffset = 0;

    showCover(on) {
      this.cover.style.display = on ? '' : 'none';
      this.cover.style.transform = `translateX(${this.wall.offset - this.scrollX}px)`;
    }

    /* Leap a character head-first through the wall's circle.
       Feet start at (x0, y) and land at (x1, y); the body centre follows a
       parabola whose midpoint is the hole centre, rotating to horizontal
       (dive) exactly as it crosses the wall.  `tilt` is the peak rotation
       (90 = dive; a small lean for an upright leap sheet).  onProgress(t)
       lets the caller drive frames from the arc.  onCross fires when the
       head reaches the hole (glass break / whoosh).  Caller shows the cover. */
    async leapThrough(sprite, { x0, x1, y, core, duration = 900, tilt = 90, onProgress, onCross } = {}) {
      const dir = Math.sign(x1 - x0) || 1;
      const H = this.hole;
      const P0 = { x: x0, y: y - core };
      const P2 = { x: x1, y: y - core };
      const P1 = { x: 2 * H.x - (P0.x + P2.x) / 2, y: 2 * H.y - (P0.y + P2.y) / 2 };
      const o = { t: 0 };
      let crossed = false;
      await anime({ targets: o, t: 1, duration: D(duration), easing: 'linear', update: () => {
        const t = o.t;
        const u = 1 - t;
        const cx = u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x;
        const cy = u * u * P0.y + 2 * u * t * P1.y + t * t * P2.y;
        const deg = dir * tilt * Math.sin(Math.PI * t);
        const r = (deg * Math.PI) / 180;
        sprite.setRotation(deg);
        sprite.setPos(cx - core * Math.sin(r), cy + core * Math.cos(r));
        onProgress && onProgress(t);
        if (!crossed && t >= 0.4) {
          crossed = true;
          onCross && onCross();
        }
      } }).finished;
      sprite.setRotation(0);
      sprite.setPos(x1, y);
    }

    idle() {
      this.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true });
      this.zombie.show(true);
      this.zombie.play({ sheet: 'zombie.side.idle', fps: 7, loop: true });
    }

    /* Run to the next checkpoint: world scrolls, the next wall slides in. */
    async runToNext(distance = 1700, duration = 2600, { withZombie = true, gate = false } = {}) {
      const nw = this.nextWall;
      nw.offset = distance;
      nw.glass.restore();
      nw.glass.setTarget(null);
      nw.root.style.display = gate ? 'none' : '';
      if (gate) this._buildGate(distance);
      this.zombieOffset = distance;
      if (withZombie) {
        this.zombie.show(true);
        this.zombie.setFlip(false);
        this.zombie.setRotation(0);
        this.zombie.setOffsetY(0);
        this.zombie.play({ sheet: 'zombie.side.idle', fps: 7, loop: true });
      } else {
        this.zombie.show(false);
      }
      this.zombie.el.style.opacity = '';
      this.hero.play({ sheet: 'hero.sideRun', fps: 16, loop: true });
      const stepTimer = setInterval(() => {
        ZD.audio.play('step');
        fx.dust(this.fxLayer, this.hero.x - 18, this.heroHome.y - 8);
      }, 230);
      // the hero may be on the far side of the wall (after jumping through):
      // the camera catches up and the hero settles back at the home spot
      const hx0 = this.hero.x;
      const hx1 = this.heroHome.x;
      const o = { v: 0 };
      await anime({ targets: o, v: distance, duration: D(duration), easing: 'easeInOutSine', update: () => {
        this.setScroll(o.v);
        if (hx0 !== hx1) this.hero.setPos(hx0 + (hx1 - hx0) * (o.v / distance), this.heroHome.y);
      } }).finished;
      clearInterval(stepTimer);
      // finalize: the new wall becomes current at the home position.  The
      // distance run moves into `travel`, so the scenery stays exactly where
      // it is (no snap back to the previous wall's view).
      this.walls[this.cur].root.style.display = 'none';
      this.cur = 1 - this.cur;
      this.wall.offset = 0;
      this.zombieOffset = 0;
      if (this.gate) this.gateOffset = 0;
      this.travel += distance;
      this.setScroll(0);
      this.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true });
    }

    /* Finale: the SAFE ZONE building (assets/images/land/safe zone.png).
       The tower's front panel (green banner) is its door. */
    _buildGate(offset) {
      if (this.gate) this.gate.remove();
      const img = A.image('safeZone');
      const S = SAFE_ZONE.scale;
      const w = Math.round(img.w * S);
      const h = Math.round(img.h * S);
      const g = el('div', { class: 'gate safe-zone', style: { left: SAFE_ZONE.left + 'px', top: this.groundY + SAFE_ZONE.sink - h + 'px', width: w + 'px', height: h + 'px', zIndex: 12 } });
      g.append(el('div', { class: 'safe-zone-art', style: { backgroundImage: `url("${A.imageUrl('safeZone')}")` } }));
      // the art has the English sign baked in; other languages get a label over it
      if (window.I18n && I18n.lang !== 'en') {
        const p = SAFE_ZONE.plaque;
        g.append(el('div', { class: 'safe-label', text: ZD.T('intro3Safe'), style: { left: p.x * S + 'px', top: p.y * S + 'px', width: p.w * S + 'px', height: p.h * S + 'px', fontSize: p.h * S * 0.62 + 'px' } }));
      }
      const d = SAFE_ZONE.door;
      const door = el('div', { class: 'safe-door', style: { left: d.x * S + 'px', top: d.y * S + 'px', width: d.w * S + 'px', height: d.h * S + 'px' } });
      door.append(el('div', { class: 'safe-door-light' }));
      g.append(door);
      this.el.appendChild(g);
      this.gate = g;
      this.gateOffset = offset;
      this.doorX = SAFE_ZONE.left + (d.x + d.w / 2) * S; // stage x of the door centre (at rest)
      g.style.transform = `translateX(${offset}px)`;
    }

    /* The door rolls open, the hero runs in, and it shuts behind them. */
    async enterSafeZone() {
      if (!this.gate) return;
      const light = this.gate.querySelector('.safe-door-light');
      const hero = this.hero;
      ZD.audio.play('unlock');
      await anime({ targets: light, opacity: [0, 1], scaleY: [0, 1], duration: D(520), easing: 'easeOutCubic' }).finished;
      hero.setFlip(false);
      hero.play({ sheet: 'hero.sideRun', fps: 16, loop: true });
      const stepTimer = setInterval(() => ZD.audio.play('step'), 230);
      const o = { x: hero.x };
      const dist = Math.abs(this.doorX - o.x);
      await anime({ targets: o, x: this.doorX, duration: D(Math.max(600, dist * 1.25)), easing: 'easeInOutSine', update: () => hero.setPos(o.x, this.heroHome.y) }).finished;
      clearInterval(stepTimer);
      // step inside: shrink a touch into the doorway and vanish into the light
      ZD.audio.play('whoosh');
      const k = { s: this.heroScale };
      await Promise.all([
        anime({ targets: k, s: this.heroScale * 0.86, duration: D(420), easing: 'easeInQuad', update: () => hero.setScale(k.s) }).finished,
        anime({ targets: hero.el, opacity: [1, 0], duration: D(420), easing: 'easeInQuad' }).finished,
      ]);
      hero.stop();
      await anime({ targets: light, scaleY: [1, 0], duration: D(420), easing: 'easeInCubic' }).finished;
      ZD.audio.play('thud');
      fx.flash('#fff2a8', 300, 0.3);
      fx.sparkles(this.fxLayer, this.doorX, this.heroHome.y - 180, 26, '#fff2a8');
    }

    removeGate() {
      if (this.gate) this.gate.remove();
      this.gate = null;
      this.hero.setScale(this.heroScale);
      this.hero.el.style.opacity = '';
    }

    /* Feet -> torso distance (scaled px) of the current zombie skin, measured
       by the asset build: `core` of the sheet, in sheet px.  zombieCore is
       the running body (the throw-back arc), zombieLeapCore the mid-air
       frames of zombie.side.leap - the torso is what flies through the
       circle's centre. */
    _zombieCore(name) {
      const s = A.sprite(this.zombie.resolve(name));
      return Math.round((s.core || 0) * (s.scaleAdjust || 1) * this.zombieScale);
    }

    get zombieCore() {
      return this._zombieCore('zombie.side.run');
    }

    get zombieLeapCore() {
      return this._zombieCore('zombie.side.leap');
    }

    /* Horde used by the intro: both zombie skins, alternating. */
    spawnHorde(n = 3) {
      this.clearHorde();
      for (let i = 0; i < n; i++) {
        const z = new ZD.Sprite({ className: 'char-zombie extra', zIndex: 17 - i, skin: ZD.scene.zombieSkins[(i + 1) % 2] });
        z.setSheet('zombie.side.run');
        const sc = (1.45 - i * 0.2) * (this.zombieScale / 1.6);
        z.setScale(sc);
        z.setPos(2000 + i * 230, this.groundY + 4 - i * 6);
        z.play({ sheet: 'zombie.side.run', fps: 12 + i, loop: true });
        this.el.appendChild(z.el);
        this.extras.push(z);
      }
      return this.extras;
    }

    clearHorde() {
      this.extras.forEach((z) => z.destroy());
      this.extras = [];
    }
  }

  /* ----------------------------------------------------------------------- */
  /* camera                                                                  */
  /* ----------------------------------------------------------------------- */
  class Camera {
    constructor(front, side) {
      this.front = front;
      this.side = side;
      this.current = null;
    }

    _scene(name) {
      return name === 'front' ? this.front : this.side;
    }

    /* The stage carries the current view (CSS: front-view-only layout,
       e.g. the narrower message bar). */
    _tag(name) {
      document.getElementById('stage').dataset.view = name;
    }

    /* the front view shows the land at the wall the hero has reached */
    _syncFront(name) {
      if (name === 'front') this.front.setScenery(this.side.travel);
    }

    cut(name) {
      this._syncFront(name);
      this._tag(name);
      ['front', 'side'].forEach((n) => {
        const s = this._scene(n).el;
        s.classList.toggle('active', n === name);
        s.style.opacity = n === name ? 1 : 0;
        s.style.transform = '';
      });
      this.current = name;
    }

    /* Cinematic shift between views with a perspective swing + zoom. */
    async to(name, { duration = 820, zoomAt } = {}) {
      if (this.current === name) return;
      this._syncFront(name);
      this._tag(name);
      const from = this._scene(this.current).el;
      const to = this._scene(name).el;
      const dir = name === 'side' ? 1 : -1;
      to.classList.add('active');
      to.style.opacity = 0;
      const origin = zoomAt ? `${zoomAt.x}px ${zoomAt.y}px` : '50% 50%';
      from.style.transformOrigin = origin;
      to.style.transformOrigin = '50% 50%';
      ZD.audio.play('swoosh');
      await Promise.all([
        anime({ targets: from, opacity: [1, 0], scale: [1, 1.18], rotateY: [0, -18 * dir], duration, easing: 'easeInQuad' }).finished,
        anime({ targets: to, opacity: [0, 1], scale: [0.92, 1], rotateY: [16 * dir, 0], duration, delay: duration * 0.35, easing: 'easeOutCubic' }).finished,
      ]);
      from.classList.remove('active');
      from.style.transform = '';
      to.style.transform = '';
      this.current = name;
    }
  }

  /* ----------------------------------------------------------------------- */
  ZD.scene = {
    settings,
    D,
    fx,
    GlassMech,
    Projectile,
    STAGE_W,
    STAGE_H,
    /* Zombie variants (sprite skins): the road worker ("zombie.*" sheets)
       and the hard-hat worker ("zombie2.*").  null = the default sheets. */
    zombieSkins: [null, 'zombie2'],
    /* Dress the wall's zombie (front + side views) as variant `i`. */
    setZombieSkin(i) {
      const skin = this.zombieSkins[((i % this.zombieSkins.length) + this.zombieSkins.length) % this.zombieSkins.length];
      this.front.zombie.setSkin(skin);
      this.side.zombie.setSkin(skin);
    },
    init(worldEl) {
      this.front = new FrontScene();
      this.side = new SideScene();
      worldEl.append(this.front.el, this.side.el);
      this.camera = new Camera(this.front, this.side);
      this.camera.cut('side');
      /* Clouds drift slowly right to left, each at its own speed (kept on the
         parallax path so it composes with scrolling).  Time-based rAF loop;
         a cloud's drift is kept modulo its wrap span (WORLD_W + width), so
         it wraps seamlessly forever. */
      const CLOUD_PX_PER_S = 16;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const step = (l, scroll) => {
          l.drift = (l.drift + dt * CLOUD_PX_PER_S * l.speed) % (WORLD_W + l.w);
          placeCloud(l, scroll);
        };
        this.front.clouds.forEach((l) => step(l, 0));
        this.side.clouds.forEach((l) => step(l, this.side.sceneX));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return this;
    },
  };
})();
