/* Circle diagrams: TeachCircle + the game-over demonstration.  Built with
   ZD.geo so they use exactly the same geometry as the gameplay pieces. */
window.ZD = window.ZD || {};

(function () {
  const { el, svg, clamp } = ZD.util;
  const T = (k, v) => ZD.T(k, v);
  const geo = ZD.geo;
  const D = (ms) => ZD.scene.D(ms);

  const COLORS = { arc: '#ff8fb1', sector: '#ffd166', segment: '#7cd8ff', chord: '#c8b6ff', radius: '#9dffb0' };

  /* An interactive circle diagram. */
  class TeachCircle {
    constructor({ size = 520, r = 200 } = {}) {
      this.size = size;
      this.r = r;
      const h = size / 2;
      this.svg = svg('svg', { class: 'teach', viewBox: `${-h} ${-h} ${size} ${size}`, width: size, height: size });
      const defs = svg('defs');
      const glow = svg('filter', { id: 'tglow', x: '-30%', y: '-30%', width: '160%', height: '160%' });
      glow.append(svg('feGaussianBlur', { stdDeviation: '5', result: 'b' }), svg('feMerge', {}, [svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' })]));
      defs.append(glow);
      this.base = svg('circle', { r, class: 'teach-circle', fill: 'rgba(255,255,255,0.04)', stroke: 'rgba(255,255,255,0.55)', 'stroke-width': 4 });
      this.region = svg('path', { d: '', fill: COLORS.sector, opacity: 0, class: 'teach-region' });
      this.radii = svg('g', { class: 'teach-radii' });
      this.chord = svg('path', { d: '', fill: 'none', stroke: COLORS.chord, 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0 });
      this.arc = svg('path', { d: '', fill: 'none', stroke: COLORS.arc, 'stroke-width': 12, 'stroke-linecap': 'round', opacity: 0, filter: 'url(#tglow)' });
      this.center = svg('g', {}, [svg('circle', { r: 6, fill: '#fff' }), svg('text', { x: 12, y: -10, class: 'teach-small', text: 'O' })]);
      this.labels = svg('g', { class: 'teach-labels' });
      this.handles = svg('g', { class: 'teach-handles' });
      this.svg.append(defs, this.base, this.region, this.radii, this.chord, this.arc, this.center, this.labels, this.handles);
      this.el = this.svg;
      this.spec = null;
      this.onChange = null;
    }

    clear() {
      this.region.setAttribute('opacity', 0);
      this.radii.innerHTML = '';
      this.chord.setAttribute('opacity', 0);
      this.arc.setAttribute('opacity', 0);
      this.labels.innerHTML = '';
      this.handles.innerHTML = '';
    }

    label(text, x, y, cls = '') {
      const t = svg('text', { x, y, class: 'teach-label ' + cls, text, 'text-anchor': 'middle' });
      this.labels.appendChild(t);
      anime({ targets: t, opacity: [0, 1], duration: D(400), easing: 'easeOutQuad' });
      return t;
    }

    smallLabel(text, x, y) {
      const t = svg('text', { x, y, class: 'teach-small', text, 'text-anchor': 'middle' });
      this.labels.appendChild(t);
      anime({ targets: t, opacity: [0, 1], duration: D(400), easing: 'easeOutQuad' });
      return t;
    }

    /* Animated arc highlight along the circumference. */
    async showArc(spec, { animate = true } = {}) {
      this.spec = spec;
      const d = geo.arcStroke(0, 0, this.r, spec.start, spec.sweep);
      this.arc.setAttribute('d', d);
      this.arc.setAttribute('stroke', COLORS.arc);
      this.arc.setAttribute('opacity', 1);
      if (animate) {
        const L = this.arc.getTotalLength();
        this.arc.style.strokeDasharray = L;
        this.arc.style.strokeDashoffset = L;
        await anime({ targets: this.arc, strokeDashoffset: 0, duration: D(1100), easing: 'easeInOutSine' }).finished;
      } else {
        this.arc.style.strokeDasharray = '';
        this.arc.style.strokeDashoffset = '';
      }
    }

    /* Two radii grow from the centre, then the wedge fills. */
    async showSector(spec, { animate = true } = {}) {
      this.spec = spec;
      const paths = geo.radiiPaths(spec, 0, 0, this.r);
      this.radii.innerHTML = '';
      const lines = paths.map((d) => svg('path', { d, fill: 'none', stroke: COLORS.radius, 'stroke-width': 6, 'stroke-linecap': 'round' }));
      lines.forEach((l) => this.radii.appendChild(l));
      this.region.setAttribute('d', geo.piecePath(spec, 0, 0, this.r));
      this.region.setAttribute('fill', COLORS.sector);
      const arcD = geo.arcStroke(0, 0, this.r, spec.start, spec.sweep);
      this.arc.setAttribute('d', arcD);
      this.arc.setAttribute('stroke', COLORS.arc);
      if (animate) {
        lines.forEach((l) => {
          l.style.strokeDasharray = this.r;
          l.style.strokeDashoffset = this.r;
        });
        await anime({ targets: lines, strokeDashoffset: 0, duration: D(600), delay: anime.stagger(250), easing: 'easeOutCubic' }).finished;
        this.arc.setAttribute('opacity', 0.9);
        await anime({ targets: this.region, opacity: [0, 0.85], duration: D(500), easing: 'easeOutQuad' }).finished;
      } else {
        this.arc.setAttribute('opacity', 0.9);
        this.region.setAttribute('opacity', 0.85);
      }
    }

    /* Chord appears, then the cap fills. */
    async showSegment(spec, { animate = true } = {}) {
      this.spec = spec;
      this.chord.setAttribute('d', geo.chordLine(spec, 0, 0, this.r));
      this.region.setAttribute('d', geo.piecePath(spec, 0, 0, this.r));
      this.region.setAttribute('fill', COLORS.segment);
      this.arc.setAttribute('d', geo.arcStroke(0, 0, this.r, spec.start, spec.sweep));
      this.arc.setAttribute('stroke', COLORS.arc);
      this.chord.setAttribute('opacity', 1);
      if (animate) {
        const L = this.chord.getTotalLength();
        this.chord.style.strokeDasharray = L;
        this.chord.style.strokeDashoffset = L;
        await anime({ targets: this.chord, strokeDashoffset: 0, duration: D(600), easing: 'easeOutCubic' }).finished;
        this.arc.setAttribute('opacity', 0.9);
        await anime({ targets: this.region, opacity: [0, 0.85], duration: D(500), easing: 'easeOutQuad' }).finished;
      } else {
        this.chord.style.strokeDasharray = '';
        this.arc.setAttribute('opacity', 0.9);
        this.region.setAttribute('opacity', 0.85);
      }
    }

    /* Immediate (no animation) rendering used while dragging. */
    render(type, spec) {
      this.spec = spec;
      this.radii.innerHTML = '';
      this.chord.setAttribute('opacity', 0);
      this.region.setAttribute('opacity', 0);
      this.arc.setAttribute('opacity', 0);
      if (type === 'arc') {
        this.showArc(spec, { animate: false });
      } else if (type === 'sector') {
        this.showSector(spec, { animate: false });
      } else {
        this.showSegment(spec, { animate: false });
      }
      this.arc.style.strokeDasharray = '';
      this.arc.style.strokeDashoffset = '';
    }

    /* Draggable endpoints A and B; onChange(spec). */
    enableDrag(type, spec, onChange) {
      this.handles.innerHTML = '';
      this.dragType = type;
      this.spec = Object.assign({}, spec);
      const mk = (name) => {
        const g = svg('g', { class: 'handle', style: { cursor: 'grab' } });
        g.append(svg('circle', { r: 26, fill: 'rgba(255,255,255,0.12)' }), svg('circle', { r: 14, fill: '#fff', stroke: '#5b2a86', 'stroke-width': 4 }), svg('text', { y: -24, class: 'teach-small handle-name', text: name, 'text-anchor': 'middle' }));
        this.handles.appendChild(g);
        return g;
      };
      this.hA = mk('A');
      this.hB = mk('B');
      this.onChange = onChange;
      this._placeHandles();
      this.render(type, this.spec);

      const toAngle = (evt) => {
        const pt = this.svg.createSVGPoint();
        pt.x = evt.clientX;
        pt.y = evt.clientY;
        const p = pt.matrixTransform(this.svg.getScreenCTM().inverse());
        return (Math.atan2(p.y, p.x) * 180) / Math.PI;
      };
      let active = null;
      let lastTick = 0;
      const down = (which) => (e) => {
        active = which;
        e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
        e.preventDefault();
      };
      const move = (e) => {
        if (!active) return;
        const a = toAngle(e);
        const s = this.spec;
        if (active === 'A') {
          const end = s.start + s.sweep;
          s.start = a;
          s.sweep = ((end - a) % 360 + 360) % 360;
        } else {
          s.sweep = ((a - s.start) % 360 + 360) % 360;
        }
        s.sweep = clamp(s.sweep, 8, 352);
        this.render(type, s);
        this._placeHandles();
        if (performance.now() - lastTick > 90) {
          ZD.audio.play('drag');
          lastTick = performance.now();
        }
        this.onChange && this.onChange(geo.normalize(s));
      };
      const up = () => {
        active = null;
      };
      this.hA.addEventListener('pointerdown', down('A'));
      this.hB.addEventListener('pointerdown', down('B'));
      this.svg.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      this._dragCleanup = () => {
        this.svg.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
    }

    disableDrag() {
      this._dragCleanup && this._dragCleanup();
      this.handles.innerHTML = '';
    }

    _placeHandles() {
      if (!this.hA) return;
      const [a, b] = geo.endpoints(this.spec, 0, 0, this.r);
      this.hA.setAttribute('transform', `translate(${a.x},${a.y})`);
      this.hB.setAttribute('transform', `translate(${b.x},${b.y})`);
    }
  }

  const learn = {
    TeachCircle,
    COLORS,

    /* Game-over: the correct piece slides into the gap. */
    async demonstrate(container, target, level) {
      const tc = new TeachCircle({ size: 360, r: 130 });
      container.appendChild(tc.el);
      const n = geo.normalize(target);
      // the circle with the piece missing
      const cut = svg('path', { d: geo.piecePath(n, 0, 0, tc.r), fill: '#1a0f33', stroke: 'rgba(255,255,255,0.4)', 'stroke-width': 2, 'stroke-dasharray': '6 6' });
      tc.svg.insertBefore(cut, tc.region);
      tc.base.setAttribute('fill', 'rgba(120,170,255,0.25)');
      const piece = svg('path', { d: geo.piecePath(n, 0, 0, tc.r), fill: '#ffb347', stroke: '#5b2a0e', 'stroke-width': 3, 'stroke-linejoin': 'round', filter: 'url(#tglow)' });
      tc.svg.appendChild(piece);
      const mid = geo.midAngle(n);
      const off = geo.polar(0, 0, 140, mid);
      piece.setAttribute('transform', `translate(${off.x},${off.y}) rotate(25)`);
      await ZD.util.wait(D(500));
      const o = { t: 0 };
      await anime({ targets: o, t: 1, duration: D(1400), easing: 'easeInOutQuad', update: () => {
        piece.setAttribute('transform', `translate(${off.x * (1 - o.t)},${off.y * (1 - o.t)}) rotate(${25 * (1 - o.t)})`);
      } }).finished;
      ZD.audio.play('lock');
      tc.label(T(geo.labelKey(n, level)), 0, tc.r + 40);
      if (n.type === 'sector') {
        geo.radiiPaths(n, 0, 0, tc.r).forEach((d) => tc.radii.appendChild(svg('path', { d, fill: 'none', stroke: COLORS.radius, 'stroke-width': 4 })));
      }
      if (n.type === 'segment') {
        tc.chord.setAttribute('d', geo.chordLine(n, 0, 0, tc.r));
        tc.chord.setAttribute('opacity', 1);
      }
      return tc;
    },
  };

  ZD.learn = learn;
})();
