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
  const WORLD_W = 2560; // scenery is wider than the stage so 20:9 screens stay filled
  const WORLD_X = (STAGE_W - WORLD_W) / 2; // -320
  const S_WIDE = WORLD_W / 1870; // scale for the 1870px-wide layers
  const S_FENCE = WORLD_W / 2500; // scale for the 2500px-wide layers

  const settings = { reducedMotion: ZD.prefs.get('reducedMotion', window.matchMedia('(prefers-reduced-motion: reduce)').matches) };
  const D = (ms) => (settings.reducedMotion ? Math.round(ms * 0.55) : ms);

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
            width: tileW + 'px',
            height: height + 'px',
            backgroundImage: `url("${A.imageUrl(key)}")`,
            backgroundSize: `${tileW}px ${tileH}px`,
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
  /* glass mechanism                                                         */
  /* ----------------------------------------------------------------------- */
  class GlassMech {
    /**
     * @param {object} o { cx, cy, r, squash (scaleX for side view) }
     */
    constructor(o) {
      this.id = 'glass' + ++uid;
      this.cx = o.cx;
      this.cy = o.cy;
      this.r = o.r;
      this.squash = o.squash || 1;
      const R = this.r;
      const pad = 6;
      this.svg = svg('svg', {
        class: 'glass',
        viewBox: `${-R - pad} ${-R - pad} ${2 * (R + pad)} ${2 * (R + pad)}`,
        width: 2 * (R + pad),
        height: 2 * (R + pad),
        style: { left: this.cx - R - pad + 'px', top: this.cy - R - pad + 'px', transform: `scaleX(${this.squash})` },
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

      this.openShadow = svg('path', { d: '', fill: '#120a2a', opacity: '0.45' });
      this.outline = svg('path', { d: '', class: 'glass-outline', fill: 'none', stroke: '#ffd166', 'stroke-width': 4, 'stroke-dasharray': '10 8', 'stroke-linejoin': 'round', filter: `url(#${this.id}-glow)` });
      this.center = svg('circle', { r: 4.5, fill: '#ffe08a', stroke: '#5b2a86', 'stroke-width': 2, class: 'glass-center' });
      this.cracks = svg('g', { class: 'cracks', filter: `url(#${this.id}-glow)` });
      this.rim = svg('circle', { r: R - 1, fill: 'none', stroke: '#ffffff', 'stroke-opacity': '0.25', 'stroke-width': 2 });
      this.lock = svg('circle', { r: R + 3, fill: 'none', stroke: '#7CFF8A', 'stroke-width': 5, opacity: '0', class: 'glass-lock' });
      this.svg.append(defs, this.openShadow, this.gGlass, this.outline, this.center, this.cracks, this.rim, this.lock);
      this.el = this.svg;
      this.spec = null;
    }

    setTarget(spec) {
      this.spec = spec;
      const d = spec ? ZD.geo.piecePath(spec, 0, 0, this.r) : '';
      this.cut.setAttribute('d', d);
      this.outline.setAttribute('d', d);
      this.openShadow.setAttribute('d', d);
      this.outline.classList.remove('locked', 'good', 'bad');
      this.outline.style.display = spec ? '' : 'none';
      this.openShadow.style.display = spec ? '' : 'none';
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
      const n = settings.reducedMotion ? 7 : 11;
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
      this.outline.style.display = 'none';
      this.openShadow.style.display = 'none';
    }

    /* Mechanism unlocks after a correct hit: glass turns green and dissolves. */
    async unlock() {
      this.outline.style.display = 'none';
      this.openShadow.style.display = 'none';
      this.cut.setAttribute('d', '');
      await anime({ targets: this.lock, opacity: [0, 1], scale: [1, 1.08], duration: D(420), easing: 'easeOutCubic' }).finished;
      anime({ targets: this.lock, opacity: 0, duration: D(500), easing: 'linear' });
      await anime({ targets: [this.gGlass, this.rim, this.center], opacity: 0, duration: D(500), easing: 'easeInQuad' }).finished;
    }

    restore() {
      this.svg.classList.remove('cracked', 'shattered');
      this.cracks.innerHTML = '';
      [this.gGlass, this.cracks, this.rim, this.center].forEach((n) => {
        n.style.opacity = '';
        n.removeAttribute('opacity');
      });
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
      if (settings.reducedMotion) n = Math.ceil(n / 2);
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
      if (settings.reducedMotion) n = Math.ceil(n / 2);
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
      if (settings.reducedMotion) return;
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
      this.clouds = L(tiledLayer('clouds', { y: -40, z: 2, factor: 0.02, cls: 'far clouds', mirror: true }));
      L(tiledLayer('skyline', { y: 150, z: 3, factor: 0.05, cls: 'far', mirror: true }));
      L(tiledLayer('haze', { y: 230, z: 4, factor: 0, opacity: 0.55, cls: 'far', mirror: true }));
      L(tiledLayer('mountains', { y: 440, z: 5, factor: 0.08, cls: 'far', mirror: true }));
      L(propLayer('tower', { x: -40, y: 780, scale: 0.72, z: 6, factor: 0.12, cls: 'mid' }));
      L(propLayer('tree', { x: 1440, y: 760, scale: 0.8, z: 6, factor: 0.14, cls: 'mid' }));
      L(tiledLayer('fencePersp', { y: 360, z: 7, factor: 0, cls: 'mid', mirror: true }));
      // ground plane with scattered props
      this.ground = el('div', { class: 'ground', style: { left: WORLD_X + 'px', top: '600px', width: WORLD_W + 'px', height: '560px', zIndex: 8 } });
      this.el.appendChild(this.ground);
      const propsEl = el('div', { class: 'props', style: { zIndex: 9 } });
      this.el.appendChild(propsEl);
      const spots = [
        [-120, 700, 'grass2'], [60, 760, 'rock3'], [180, 700, 'grass5'], [-230, 900, 'rock1'], [120, 1000, 'grass1'], [1620, 690, 'grass4'], [1760, 740, 'rock4'], [1900, 820, 'grass2'], [2000, 980, 'rock2'], [1700, 1010, 'grass1'], [1300, 650, 'grass6'], [560, 650, 'grass7'], [2150, 700, 'grass3'], [-300, 1040, 'grass3'], [1500, 1055, 'rock6'], [330, 640, 'rock7'],
      ];
      spots.forEach(([x, y, k]) => {
        const sc = 0.45 + ((y - 600) / 480) * 0.8;
        const p = propLayer(k, { x, y, scale: sc, z: 9 });
        propsEl.appendChild(p.node);
      });

      // wall + platform
      const wall = A.wall('stage');
      this.wallScale = 0.82;
      const ww = Math.round(wall.w * this.wallScale);
      const wh = Math.round(wall.h * this.wallScale);
      this.hole = { x: 960, y: 430 };
      this.R = Math.round(((wall.hole.rx + wall.hole.ry) / 2) * this.wallScale);
      const wx = this.hole.x - wall.hole.cx * this.wallScale;
      const wy = this.hole.y - wall.hole.cy * this.wallScale;
      this.wallBox = { x: wx, y: wy, w: ww, h: wh };
      // zombie waits behind the wall, visible through the opening
      this.zombie = new ZD.Sprite({ className: 'char-zombie behind', zIndex: 10 });
      this.zombie.setSheet('zombie.front.idle');
      this.zombie.setPos(this.hole.x, this.hole.y + this.R * 0.98);
      this.zombie.setScale(1.0);
      this.el.appendChild(this.zombie.el);
      // soft dark interior behind the glass so the zombie reads as "beyond"
      this.interior = el('div', { class: 'interior', style: { left: this.hole.x - this.R + 'px', top: this.hole.y - this.R + 'px', width: this.R * 2 + 'px', height: this.R * 2 + 'px', zIndex: 9 } });
      this.el.appendChild(this.interior);
      this.wallEl = el('div', { class: 'wall-stage', style: { left: wx + 'px', top: wy + 'px', width: ww + 'px', height: wh + 'px', zIndex: 11, backgroundImage: `url("${A.wallUrl('stage')}")` } });
      this.el.appendChild(this.wallEl);
      this.glass = new GlassMech({ cx: this.hole.x, cy: this.hole.y, r: this.R });
      this.glass.el.style.zIndex = 12;
      this.el.appendChild(this.glass.el);

      // hero (back view) in the foreground
      this.hero = new ZD.Sprite({ className: 'char-hero', zIndex: 20 });
      this.hero.setSheet('hero.backIdle');
      this.heroHome = { x: 330, y: 1062 };
      this.hero.setScale(1.2);
      this.hero.setPos(this.heroHome.x, this.heroHome.y);
      this.el.appendChild(this.hero.el);
      this.heroHand = { x: 470, y: 790 };

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
        else if (l.factor) l.node.style.transform = `translateX(${-px * l.factor}px)`;
      });
    }

    setTarget(spec) {
      this.glass.setTarget(spec);
    }

    idle() {
      this.hero.play({ sheet: 'hero.backIdle', fps: 9, loop: true });
      this.zombie.play({ sheet: 'zombie.front.idle', fps: 8, loop: true });
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
      this.clouds = L(tiledLayer('clouds', { y: -50, z: 2, factor: 0.04, cls: 'far clouds', mirror: true }));
      L(tiledLayer('skyline', { y: 110, z: 3, factor: 0.1, cls: 'far', mirror: true }));
      L(tiledLayer('haze', { y: 200, z: 4, factor: 0.12, opacity: 0.6, cls: 'far', mirror: true }));
      L(tiledLayer('mountains', { y: 420, z: 5, factor: 0.2, cls: 'far', mirror: true }));
      this.tower = L(propLayer('tower', { x: -140, y: 820, scale: 0.82, z: 6, factor: 0.45, cls: 'mid' }));
      this.tree = L(propLayer('tree', { x: 1420, y: 800, scale: 0.9, z: 6, factor: 0.55, cls: 'mid' }));
      L(tiledLayer('fenceFront', { y: 416, z: 7, factor: 0.7, cls: 'mid', mirror: true }));
      this.groundY = 790;
      L(tiledLayer('landRoad', { y: 776, z: 8, factor: 1, h: 520, bg: '#71395e', mirror: true }));
      // props on the wall-top (scroll with the ground)
      this.props = [];
      const propsEl = el('div', { class: 'props', style: { zIndex: 9 } });
      this.el.appendChild(propsEl);
      [[-200, 'grass3'], [120, 'rock5'], [640, 'grass6'], [1180, 'grass4'], [1700, 'rock6'], [2050, 'grass2'], [-20, 'rock8'], [1350, 'grass7']].forEach(([x, k]) => {
        const p = propLayer(k, { x, y: this.groundY + 4, scale: 0.6, z: 9, factor: 1 });
        p.home = x;
        propsEl.appendChild(p.node);
        this.props.push(p);
      });
      [[-300, 'rock1'], [700, 'rock2'], [1500, 'rock3'], [2200, 'rock4'], [300, 'grass1'], [1900, 'grass2']].forEach(([x, k]) => {
        const p = propLayer(k, { x, y: 1060, scale: 1.0, z: 9, factor: 1.08 });
        p.home = x;
        propsEl.appendChild(p.node);
        this.props.push(p);
      });

      // walls: two slots so the next checkpoint can slide in while this one leaves
      this.wallHome = 985; // x of the wall's left edge at rest
      const wallDef = A.wall('angle1');
      this.wallScale = 1.12;
      this.wallW = Math.round(wallDef.w * this.wallScale);
      this.wallH = Math.round(wallDef.h * this.wallScale);
      this.holeOffset = { x: wallDef.hole.cx * this.wallScale, y: wallDef.hole.cy * this.wallScale };
      this.holeRy = wallDef.hole.ry * this.wallScale;
      this.holeRx = wallDef.hole.rx * this.wallScale;

      /* Plant the wall ON the road.  The angle1 art's base runs from its far
         corner (x 0, y 506) down to its near corner (x 265, y 598) - steeper
         than the narrow road strip (y ~803 back edge .. ~842 front edge).  So:
         drop the wall until the near corner stands on the front edge, then
         skew it vertically about that corner so the far corner lands on the
         back edge.  Verticals stay vertical; the art and everything drawn on
         it (glass, cover, hole target) share one transform. */
      const roadBack = 803;
      const roadFront = 842;
      const near = { x: 265 * this.wallScale, y: 598 * this.wallScale };
      const far = { x: 0, y: 506 * this.wallScale };
      this.wallTop = roadFront - near.y;
      this.skewOrigin = { x: this.wallHome + near.x, y: roadFront };
      this.skewTan = (roadBack - (this.wallTop + far.y) - (roadFront - (this.wallTop + near.y))) / (far.x - near.x);
      this.skewCss = `skewY(${(Math.atan(this.skewTan) * 180) / Math.PI}deg)`;
      this.baseLine = { x0: this.wallHome + far.x, y0: roadBack, x1: this.skewOrigin.x, y1: roadFront };

      this.walls = [this._makeWall(), this._makeWall()];
      this.cur = 0;
      this.walls[1].root.style.display = 'none';

      this.hole = this._skewPt(this.wallHome + this.holeOffset.x, this.wallTop + this.holeOffset.y);

      // Depth cover for leaps through the circle: a copy of the wall's far half
      // (right of the hole centre), drawn above the characters.  Whatever has
      // passed the wall plane is hidden by bricks and seen only through the
      // (transparent) hole.  Shown only while someone goes through the wall.
      this.cover = el('div', { class: 'wall-cover-wrap', style: { zIndex: 21, display: 'none' } });
      const coverSkew = this._skewBox();
      const coverSvg = svg('svg', { class: 'wall-cover', width: this.wallW, height: this.wallH, viewBox: `0 0 ${this.wallW} ${this.wallH}` });
      Object.assign(coverSvg.style, { left: this.wallHome + 'px', top: this.wallTop + 'px' });
      const cm = svg('mask', { id: 'wall-cover-m' });
      cm.append(svg('rect', { x: this.holeOffset.x, y: 0, width: this.wallW, height: this.wallH, fill: 'white' }));
      coverSvg.append(svg('defs', {}, [cm]), svg('image', { href: A.wallUrl('angle1'), width: this.wallW, height: this.wallH, preserveAspectRatio: 'none', mask: 'url(#wall-cover-m)' }));
      coverSkew.appendChild(coverSvg);
      this.cover.appendChild(coverSkew);
      this.el.appendChild(this.cover);
      // feet -> body-centre distance (scaled px), measured from the sheets
      this.heroCore = 150;
      this.zombieCore = 120;

      // characters
      this.heroHome = { x: 330, y: this.groundY };
      this.hero = new ZD.Sprite({ className: 'char-hero', zIndex: 20 });
      this.hero.setSheet('hero.sideIdle');
      this.hero.setScale(1.0);
      this.hero.setPos(this.heroHome.x, this.heroHome.y);
      this.el.appendChild(this.hero.el);
      this.heroHand = { x: 500, y: this.groundY - 190 };

      this.zombieHome = { x: 1500, y: this.groundY + 4 };
      this.zombie = new ZD.Sprite({ className: 'char-zombie', zIndex: 18 });
      this.zombie.setSheet('zombie.side.idle');
      this.zombie.setScale(1.6);
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

    /* point in the wall's unskewed layout -> where it is drawn */
    _skewPt(x, y) {
      return { x, y: y + (x - this.skewOrigin.x) * this.skewTan };
    }

    /* full-stage box carrying the wall's skew */
    _skewBox() {
      return el('div', { class: 'wall-skew', style: { transformOrigin: `${this.skewOrigin.x}px ${this.skewOrigin.y}px`, transform: this.skewCss } });
    }

    _makeWall() {
      const root = el('div', { class: 'wall-slot', style: { zIndex: 12 } });
      // contact shadow on the road, along the wall's base
      const b = this.baseLine;
      const len = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
      const shadow = el('div', { class: 'wall-shadow', style: { left: (b.x0 + b.x1) / 2 - len * 0.6 + 'px', top: (b.y0 + b.y1) / 2 - 16 + 'px', width: len * 1.2 + 'px', transform: `rotate(${(Math.atan2(b.y1 - b.y0, b.x1 - b.x0) * 180) / Math.PI}deg)` } });
      const body = this._skewBox();
      const img = el('div', { class: 'wall-side', style: { left: this.wallHome + 'px', top: this.wallTop + 'px', width: this.wallW + 'px', height: this.wallH + 'px', backgroundImage: `url("${A.wallUrl('angle1')}")` } });
      const glass = new GlassMech({ cx: this.wallHome + this.holeOffset.x, cy: this.wallTop + this.holeOffset.y, r: this.holeRy, squash: this.holeRx / this.holeRy });
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

    setScroll(px) {
      this.scrollX = px;
      // props keep their `left`; only transform moves (and wraps) them
      this.layers.forEach((l) => {
        if (l.tiled) scrollTiled(l, px);
        else if (l.factor) l.node.style.transform = `translateX(${wrapX(l.x - px * l.factor, l.w) - l.x}px)`;
      });
      this.props.forEach((p) => {
        p.node.style.transform = `translateX(${wrapX(p.home - px * p.factor, p.w) - p.home}px)`;
      });
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
       (dive) exactly as it crosses the wall.  onCross fires when the head
       reaches the hole (glass break / whoosh).  Caller shows the cover. */
    async leapThrough(sprite, { x0, x1, y, core, duration = 900, onCross } = {}) {
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
        const deg = dir * 90 * Math.sin(Math.PI * t);
        const r = (deg * Math.PI) / 180;
        sprite.setRotation(deg);
        sprite.setPos(cx - core * Math.sin(r), cy + core * Math.cos(r));
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
      const stepTimer = setInterval(() => ZD.audio.play('step'), 230);
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
      // finalize: the new wall becomes current at the home position
      this.walls[this.cur].root.style.display = 'none';
      this.cur = 1 - this.cur;
      this.wall.offset = 0;
      this.zombieOffset = 0;
      if (this.gate) this.gateOffset = 0;
      this.setScroll(0);
      this.hero.play({ sheet: 'hero.sideIdle', fps: 9, loop: true });
    }

    /* Finale gate: pillars, metal gate, SAFE ZONE sign, survivors, shield. */
    _buildGate(offset) {
      if (this.gate) this.gate.remove();
      const g = el('div', { class: 'gate', style: { left: this.wallHome - 40 + 'px', top: this.groundY - 520 + 'px', zIndex: 12 } });
      g.innerHTML = `
        <div class="gate-survivors">
          <svg viewBox="0 0 400 160" width="400" height="160">
            <g fill="#2a123f" opacity="0.9">
              <g class="surv" transform="translate(40,20)"><circle cx="0" cy="18" r="16"/><rect x="-14" y="36" width="28" height="70" rx="10"/><rect class="arm" x="-30" y="40" width="14" height="48" rx="7"/></g>
              <g class="surv" transform="translate(120,40)"><circle cx="0" cy="14" r="13"/><rect x="-12" y="30" width="24" height="60" rx="9"/><rect class="arm" x="12" y="30" width="12" height="44" rx="6"/></g>
              <g class="surv" transform="translate(210,10)"><circle cx="0" cy="20" r="18"/><rect x="-16" y="40" width="32" height="80" rx="11"/><rect class="arm" x="16" y="36" width="14" height="52" rx="7"/></g>
              <g class="surv" transform="translate(300,45)"><circle cx="0" cy="12" r="11"/><rect x="-10" y="26" width="20" height="50" rx="8"/><rect class="arm" x="-24" y="30" width="11" height="40" rx="5"/></g>
            </g>
          </svg>
        </div>
        <div class="gate-pillar left"></div>
        <div class="gate-pillar right"></div>
        <div class="gate-bars"></div>
        <div class="gate-sign"><span>${ZD.T('intro3Safe')}</span></div>
        <div class="gate-lamp warn"></div>
        <div class="shield"></div>`;
      this.el.appendChild(g);
      this.gate = g;
      this.gateOffset = offset;
      g.style.transform = `translateX(${offset}px)`;
    }

    async activateShield() {
      if (!this.gate) return;
      const lamp = this.gate.querySelector('.gate-lamp');
      lamp.className = 'gate-lamp safe';
      const sh = this.gate.querySelector('.shield');
      sh.classList.add('on');
      ZD.audio.play('shield');
      await anime({ targets: sh, opacity: [0, 0.85], scale: [0.2, 1], duration: D(1100), easing: 'easeOutElastic(1, .6)' }).finished;
    }

    removeGate() {
      if (this.gate) this.gate.remove();
      this.gate = null;
    }

    /* Horde used by the intro. */
    spawnHorde(n = 3) {
      this.clearHorde();
      for (let i = 0; i < n; i++) {
        const z = new ZD.Sprite({ className: 'char-zombie extra', zIndex: 17 - i });
        z.setSheet('zombie.side.run');
        const sc = 1.45 - i * 0.2;
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

    cut(name) {
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
      const from = this._scene(this.current).el;
      const to = this._scene(name).el;
      const dir = name === 'side' ? 1 : -1;
      to.classList.add('active');
      to.style.opacity = 0;
      if (settings.reducedMotion) {
        await Promise.all([
          anime({ targets: from, opacity: 0, duration: 300, easing: 'linear' }).finished,
          anime({ targets: to, opacity: 1, duration: 300, easing: 'linear' }).finished,
        ]);
      } else {
        const origin = zoomAt ? `${zoomAt.x}px ${zoomAt.y}px` : '50% 50%';
        from.style.transformOrigin = origin;
        to.style.transformOrigin = '50% 50%';
        ZD.audio.play('swoosh');
        await Promise.all([
          anime({ targets: from, opacity: [1, 0], scale: [1, 1.18], rotateY: [0, -18 * dir], duration, easing: 'easeInQuad' }).finished,
          anime({ targets: to, opacity: [0, 1], scale: [0.92, 1], rotateY: [16 * dir, 0], duration, delay: duration * 0.35, easing: 'easeOutCubic' }).finished,
        ]);
      }
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
    init(worldEl) {
      this.front = new FrontScene();
      this.side = new SideScene();
      worldEl.append(this.front.el, this.side.el);
      this.camera = new Camera(this.front, this.side);
      this.camera.cut('side');
      // slow cloud drift (kept on the parallax path so it composes with scrolling)
      const drift = { v: 0 };
      anime({ targets: drift, v: 2560, duration: 240000, easing: 'linear', loop: true, update: () => {
        this.front.clouds.drift = drift.v;
        this.side.clouds.drift = drift.v;
        scrollTiled(this.front.clouds, 0);
        scrollTiled(this.side.clouds, this.side.scrollX);
      } });
      return this;
    },
    setReducedMotion(v) {
      settings.reducedMotion = v;
      ZD.prefs.set('reducedMotion', v);
      document.body.classList.toggle('reduced-motion', v);
    },
  };
})();
