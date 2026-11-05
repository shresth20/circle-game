/* Learning layer: Encounter -> Manipulate -> (per-wall mini lessons) ->
   Name-it feedback -> Game-over demonstration.  All diagrams are built with
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

  /* ------------------------------------------------------------------ */
  function lessonShell(id, title) {
    const ov = document.getElementById('learn');
    ov.innerHTML = '';
    ov.className = 'overlay lesson visible';
    const wrap = el('div', { class: 'lesson-wrap' });
    const stage = el('div', { class: 'lesson-stage' });
    const text = el('div', { class: 'lesson-text' });
    const head = el('div', { class: 'lesson-title', text: title });
    const concept = el('div', { class: 'lesson-concept' });
    const sub = el('div', { class: 'lesson-sub' });
    const extra = el('div', { class: 'lesson-extra' });
    const row = el('div', { class: 'btn-row' });
    text.append(head, concept, sub, extra, row);
    wrap.append(stage, text);
    ov.appendChild(wrap);
    anime({ targets: wrap, opacity: [0, 1], translateY: [30, 0], duration: D(500), easing: 'easeOutCubic' });
    return { ov, wrap, stage, text, concept, sub, extra, row };
  }

  function button(label, cls = 'primary') {
    return el('button', { class: 'btn ' + cls, text: label });
  }

  function waitClick(btn) {
    return new Promise((res) =>
      btn.addEventListener('click', () => {
        ZD.audio.play('click');
        res();
      }, { once: true })
    );
  }

  function setConcept(node, text, color) {
    node.textContent = text;
    node.style.color = color;
    anime({ targets: node, scale: [0.6, 1], opacity: [0, 1], duration: D(500), easing: 'easeOutBack' });
    ZD.audio.play('pop');
  }

  async function closeLesson() {
    const ov = document.getElementById('learn');
    const wrap = ov.querySelector('.lesson-wrap');
    if (wrap) await anime({ targets: wrap, opacity: 0, translateY: -20, duration: D(260), easing: 'easeInQuad' }).finished;
    ov.classList.remove('visible');
    ov.innerHTML = '';
  }

  const learn = {
    TeachCircle,
    COLORS,

    /* Phase 1: Encounter - arc, sector, segment, one at a time. */
    async encounter() {
      const L = lessonShell('learn', T('learnTitle'));
      const tc = new TeachCircle();
      L.stage.appendChild(tc.el);
      const next = button(T('btnNext'));
      L.row.appendChild(next);
      next.style.visibility = 'hidden';

      const steps = [
        { type: 'arc', spec: { type: 'arc', start: -60, sweep: 120 }, label: 'pieceArc', vo: 'learnArcVo', sub: 'learnArcSub', color: COLORS.arc },
        { type: 'sector', spec: { type: 'sector', start: 200, sweep: 110 }, label: 'pieceSector', vo: 'learnSectorVo', sub: 'learnSectorSub', color: COLORS.sector },
        { type: 'segment', spec: { type: 'segment', start: 15, sweep: 130 }, label: 'pieceSegment', vo: 'learnSegmentVo', sub: 'learnSegmentSub', color: COLORS.segment },
      ];
      for (const st of steps) {
        tc.clear();
        L.concept.textContent = '';
        L.sub.textContent = '';
        next.style.visibility = 'hidden';
        ZD.ui.caption(st.vo);
        if (st.type === 'arc') await tc.showArc(st.spec);
        if (st.type === 'sector') {
          await tc.showSector(st.spec);
          const [p0, p1] = geo.endpoints(st.spec, 0, 0, tc.r * 0.55);
          tc.smallLabel(T('pieceRadius'), p0.x, p0.y - 10);
          tc.smallLabel(T('pieceRadius'), p1.x, p1.y + 24);
        }
        if (st.type === 'segment') {
          await tc.showSegment(st.spec);
          const [p0, p1] = geo.endpoints(st.spec, 0, 0, tc.r);
          tc.smallLabel(T('pieceChordLc'), (p0.x + p1.x) / 2 - 40, (p0.y + p1.y) / 2 + 8);
        }
        const mid = geo.midAngle(st.spec);
        const lp = geo.polar(0, 0, st.type === 'arc' ? tc.r + 36 : tc.r * 0.62, mid);
        tc.label(T(st.label), lp.x, lp.y + 10);
        setConcept(L.concept, T(st.label), st.color);
        L.sub.textContent = T(st.sub);
        await ZD.util.wait(D(500));
        next.style.visibility = '';
        anime({ targets: next, scale: [0.8, 1], opacity: [0, 1], duration: D(300), easing: 'easeOutBack' });
        await waitClick(next);
      }
      ZD.ui.caption('');
      await closeLesson();
    },

    /* Phase 2: Manipulate - drag the endpoints, watch the label change,
       complete a tiny guided task. */
    async manipulate() {
      const L = lessonShell('learn', T('learnManipTitle'));
      const tc = new TeachCircle();
      L.stage.appendChild(tc.el);
      const tabs = el('div', { class: 'tabs' });
      const types = ['arc', 'sector', 'segment'];
      let type = 'sector';
      let spec = { type, start: -30, sweep: 110 };
      const live = el('div', { class: 'live-label' });
      const task = el('div', { class: 'task' });
      L.extra.append(tabs, live, task);
      const cont = button(T('btnToWall'));
      cont.style.visibility = 'hidden';
      L.row.appendChild(cont);

      const tasks = { sector: { key: 'learnManipTaskSector', test: (s) => s.size === 'major' }, arc: { key: 'learnManipTaskArc', test: (s) => s.size === 'minor' }, segment: { key: 'learnManipTaskSegment', test: (s) => s.size === 'major' } };
      let doneCount = 0;
      const doneTypes = new Set();
      let lastSize = null;

      const update = (s) => {
        const key = geo.labelKey(s, 'full');
        live.innerHTML = `<span class="live-name" style="color:${COLORS[type]}">${T(key)}</span><span class="live-deg">${T('learnAngle', { deg: Math.round(s.sweep) })}</span>`;
        if (lastSize && lastSize !== s.size) {
          ZD.audio.play('flip');
          anime({ targets: live, scale: [1.15, 1], duration: D(300), easing: 'easeOutBack' });
        }
        lastSize = s.size;
        if (!doneTypes.has(type) && tasks[type].test(s)) {
          doneTypes.add(type);
          doneCount++;
          task.classList.add('done');
          task.innerHTML = `✔ ${T('learnManipDone')}`;
          ZD.audio.play('success');
          if (cont.style.visibility === 'hidden') {
            cont.style.visibility = '';
            anime({ targets: cont, scale: [0.8, 1], opacity: [0, 1], duration: D(300), easing: 'easeOutBack' });
          }
        }
      };
      const setType = (t) => {
        type = t;
        spec = { type: t, start: spec.start, sweep: spec.sweep };
        tabs.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
        tc.disableDrag();
        tc.clear();
        tc.enableDrag(t, spec, update);
        task.classList.toggle('done', doneTypes.has(t));
        task.innerHTML = doneTypes.has(t) ? `✔ ${T('learnManipDone')}` : T(tasks[t].key);
        lastSize = null;
        update(geo.normalize(spec));
      };
      types.forEach((t) => {
        const b = el('button', { class: 'tab', dataset: { t }, text: T(I18n.key('piece', t)), style: { '--c': COLORS[t] }, onClick: () => {
          ZD.audio.play('click');
          setType(t);
        } });
        tabs.appendChild(b);
      });
      L.sub.textContent = T('learnManipSub');
      ZD.ui.caption('learnManipVo');
      setType('sector');
      // safety: allow moving on after a while even without finishing the task
      const skipTimer = ZD.clock.timeout(() => {
        if (cont.style.visibility === 'hidden') {
          cont.style.visibility = '';
          cont.classList.add('secondary');
        }
      }, 25000);
      await waitClick(cont);
      skipTimer.cancel();
      tc.disableDrag();
      ZD.ui.caption('');
      await closeLesson();
    },

    /* Wall-2 primer: the same piece grows from minor to major; rotation
       does not change the classification. */
    async minorMajor() {
      const L = lessonShell('learn', T('learnMinorMajorTitle'));
      const tc = new TeachCircle();
      L.stage.appendChild(tc.el);
      const live = el('div', { class: 'live-label' });
      L.extra.appendChild(live);
      L.sub.textContent = T('learnMinorMajorSub');
      ZD.ui.caption('learnMinorMajorVo');
      const got = button(T('btnGotIt'));
      got.style.visibility = 'hidden';
      L.row.appendChild(got);
      const show = (type, s) => {
        tc.render(type, s);
        const n = geo.normalize(s);
        const side = n.size === 'major' ? '> 180°' : '< 180°';
        live.innerHTML = `<span class="live-name" style="color:${COLORS[type]}">${T('learnAngle', { deg: Math.round(n.sweep) })}</span><span class="live-deg">${side}</span>`;
      };
      const run = async (type) => {
        const o = { sweep: 60, start: -30 };
        let flipped = false;
        show(type, { type, start: o.start, sweep: o.sweep });
        setConcept(L.concept, T(I18n.key('piece', 'minor', type)), COLORS[type]);
        await anime({ targets: o, sweep: 290, duration: D(2600), easing: 'easeInOutSine', update: () => {
          show(type, { type, start: o.start, sweep: o.sweep });
          if (!flipped && o.sweep > 180) {
            flipped = true;
            ZD.audio.play('flip');
            setConcept(L.concept, T(I18n.key('piece', 'major', type)), COLORS[type]);
          }
        } }).finished;
        await ZD.util.wait(D(400));
        // rotate: still major
        await anime({ targets: o, start: 150, duration: D(1200), easing: 'easeInOutSine', update: () => show(type, { type, start: o.start, sweep: o.sweep }) }).finished;
        await ZD.util.wait(D(500));
      };
      await run('sector');
      tc.clear();
      await run('arc');
      got.style.visibility = '';
      anime({ targets: got, scale: [0.8, 1], opacity: [0, 1], duration: D(300), easing: 'easeOutBack' });
      await waitClick(got);
      ZD.ui.caption('');
      await closeLesson();
    },

    /* Wall-3 primer: sector (radii) vs segment (chord); chord alone is a line. */
    async segments() {
      const L = lessonShell('learn', T('learnSegmentsTitle'));
      L.wrap.classList.add('two');
      const a = new TeachCircle({ size: 400, r: 150 });
      const b = new TeachCircle({ size: 400, r: 150 });
      L.stage.append(a.el, b.el);
      L.sub.textContent = T('learnSegmentsSub');
      ZD.ui.caption('learnSegmentsVo');
      const got = button(T('btnGotIt'));
      got.style.visibility = 'hidden';
      L.row.appendChild(got);
      const spec = { start: 20, sweep: 130 };
      await a.showSector({ type: 'sector', ...spec });
      const [p0, p1] = geo.endpoints(spec, 0, 0, a.r * 0.5);
      a.smallLabel(T('pieceRadius'), p0.x + 6, p0.y - 10);
      a.smallLabel(T('pieceRadius'), p1.x - 20, p1.y + 22);
      a.label(T('pieceSector'), 0, a.r + 44);
      setConcept(L.concept, T('pieceSector') + '  vs  ' + T('pieceSegment'), '#fff');
      await b.showSegment({ type: 'segment', ...spec });
      const [q0, q1] = geo.endpoints(spec, 0, 0, b.r);
      b.smallLabel(T('pieceChordLc'), (q0.x + q1.x) / 2 - 46, (q0.y + q1.y) / 2 + 8);
      b.label(T('pieceSegment'), 0, b.r + 44);
      await ZD.util.wait(D(900));
      // chord only
      b.region.setAttribute('opacity', 0.25);
      anime({ targets: b.chord, opacity: [1, 0.3, 1], duration: D(900), easing: 'easeInOutSine' });
      got.style.visibility = '';
      anime({ targets: got, scale: [0.8, 1], opacity: [0, 1], duration: D(300), easing: 'easeOutBack' });
      await waitClick(got);
      ZD.ui.caption('');
      await closeLesson();
    },

    /* Game-over demonstration: the correct piece slides in to complete the circle. */
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
