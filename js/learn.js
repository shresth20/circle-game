/* Teaching moments (LXD feedback: "make every mistake teach something").
   After a wrong tap or a time-out the learner sees the CORRECT piece slide
   into the gap - drawn in the same orientation as the window - with its
   name and its defining parts lit up.
   Built with ZD.geo, so it is exactly the geometry the game evaluated. */
window.ZD = window.ZD || {};

(function () {
  const { el, svg } = ZD.util;
  const T = (k, v) => ZD.T(k, v);
  const geo = ZD.geo;
  const D = (ms) => ZD.scene.D(ms);

  /* Feedback colours (used only AFTER answering, never on the buttons). */
  const COLORS = { arc: '#ff8fb1', radius: '#9dffb0', chord: '#e9dcff', half: 'rgba(255,255,255,0.85)' };
  let uid = 0;

  /* Circle with the target's gap; play() slides the correct piece in and
     lights up what makes it that piece. */
  function pieceDiagram(target, { size = 320 } = {}) {
    const n = geo.normalize(target);
    const r = size * 0.36;
    const h = size / 2;
    const id = 'ld' + ++uid;
    const root = svg('svg', { class: 'lesson-svg', viewBox: `${-h} ${-h} ${size} ${size}`, width: size, height: size });
    const defs = svg('defs');
    const grad = svg('linearGradient', { id: id + '-p', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(svg('stop', { offset: '0%', 'stop-color': '#ffe8a3' }), svg('stop', { offset: '50%', 'stop-color': '#ffb347' }), svg('stop', { offset: '100%', 'stop-color': '#ff6f3c' }));
    const glow = svg('filter', { id: id + '-g', x: '-40%', y: '-40%', width: '180%', height: '180%' });
    glow.append(svg('feGaussianBlur', { stdDeviation: '5', result: 'b' }), svg('feMerge', {}, [svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' })]));
    const mask = svg('mask', { id: id + '-m' });
    mask.append(svg('rect', { x: -h, y: -h, width: size, height: size, fill: 'white' }), svg('path', { d: geo.piecePath(n, 0, 0, r), fill: 'black' }));
    defs.append(grad, glow, mask);

    const pieceD = geo.piecePath(n, 0, 0, r);
    // the window: glass with the opening cut out
    const glass = svg('circle', { r, fill: '#6fa8e8', opacity: 0.55, mask: `url(#${id}-m)` });
    const gap = svg('path', { d: pieceD, fill: '#140b2c', stroke: '#ffd166', 'stroke-width': 3, 'stroke-dasharray': '7 6', 'stroke-linejoin': 'round' });
    const rim = svg('circle', { r, fill: 'none', stroke: 'rgba(255,255,255,0.55)', 'stroke-width': 3 });
    // dashed diameter at right angles to the piece: "half" of the circle
    const mid = geo.midAngle(n);
    const d0 = geo.polar(0, 0, r + 14, mid + 90);
    const d1 = geo.polar(0, 0, r + 14, mid - 90);
    const halfLine = svg('line', { x1: d0.x, y1: d0.y, x2: d1.x, y2: d1.y, stroke: COLORS.half, 'stroke-width': 3, 'stroke-dasharray': '4 7', 'stroke-linecap': 'round', opacity: 0 });
    const lp = geo.polar(0, 0, r + 30, mid + 90);
    const halfLabel = svg('text', { x: lp.x, y: lp.y + 8, class: 'lesson-small', 'text-anchor': 'middle', text: T('lessonHalf'), opacity: 0 });
    // the correct piece (starts outside the circle) + its green "it fits" copy
    const piece = svg('g', { class: 'lesson-piece' });
    const body = svg('path', { d: pieceD, fill: `url(#${id}-p)`, stroke: '#7a2d12', 'stroke-width': 3, 'stroke-linejoin': 'round' });
    const fit = svg('path', { d: pieceD, fill: 'none', stroke: '#7cff8a', 'stroke-width': 7, 'stroke-linejoin': 'round', opacity: 0, filter: `url(#${id}-g)` });
    piece.append(body, fit);
    // what makes it this piece
    const parts = svg('g', { opacity: 0 });
    parts.appendChild(svg('path', { d: geo.arcStroke(0, 0, r, n.start, n.sweep), fill: 'none', stroke: COLORS.arc, 'stroke-width': 8, 'stroke-linecap': 'round' }));
    if (n.type === 'sector') geo.radiiPaths(n, 0, 0, r).forEach((d) => parts.appendChild(svg('path', { d, fill: 'none', stroke: COLORS.radius, 'stroke-width': 6, 'stroke-linecap': 'round' })));
    if (n.type === 'segment') parts.appendChild(svg('path', { d: geo.chordLine(n, 0, 0, r), fill: 'none', stroke: COLORS.chord, 'stroke-width': 8, 'stroke-linecap': 'round' }));
    const centre = svg('circle', { r: 5, fill: '#fff' });
    root.append(defs, glass, gap, rim, piece, halfLine, halfLabel, parts, centre);

    const off = geo.polar(0, 0, r * 0.95, mid);
    const place = (t) => piece.setAttribute('transform', `translate(${off.x * (1 - t)} ${off.y * (1 - t)}) rotate(${-35 * (1 - t)})`);
    place(0);

    let tl = null;
    return {
      el: root,
      play() {
        const o = { t: 0 };
        tl = anime.timeline({ easing: 'easeOutCubic' });
        tl.add({ targets: o, t: 1, duration: D(900), delay: D(250), easing: 'easeInOutCubic', update: () => place(o.t), complete: () => ZD.audio.play('lock') })
          .add({ targets: fit, opacity: [0, 1], duration: D(400), easing: 'easeOutQuad' })
          .add({ targets: parts, opacity: [0, 1], duration: D(400) }, '-=200')
          .add({ targets: [halfLine, halfLabel], opacity: [0, 1], duration: D(400), delay: anime.stagger(80) }, '-=150');
        return tl.finished;
      },
      /* Skip: jump to the end state (and stop the timeline). */
      finish() {
        if (tl) tl.pause();
        tl = null;
        place(1);
        [fit, parts, halfLine, halfLabel].forEach((n2) => {
          n2.style.opacity = '';
          n2.setAttribute('opacity', 1);
        });
      },
    };
  }

  /* Header + diagram, used by the lesson card and the game-over
     panel.  chosen: piece id the learner tapped, or null for a time-out. */
  function lessonBody(target, chosen, { size = 320, showChoice = true } = {}) {
    const name = T(geo.labelKey(target));
    const diagram = pieceDiagram(target, { size });
    const kids = [];
    if (showChoice) {
      kids.push(chosen
        ? el('div', { class: 'lesson-chip wrong' }, [el('span', { class: 'ico', text: '✖' }), el('span', { text: T('lessonYouChose', { name: T(geo.labelKey(chosen)) }) })])
        : el('div', { class: 'lesson-chip time' }, [el('span', { class: 'ico', text: '⏱' }), el('span', { text: T('lessonTimeUp') })]));
    }
    const title = el('div', { class: 'lesson-title' });
    // the name is highlighted inside the localised sentence
    const parts = T('lessonNeeded', { name: '\u0000' }).split('\u0000');
    title.append(parts[0] || '', el('b', { text: name }), parts[1] || '');
    kids.push(el('div', { class: 'lesson-main' }, [
      el('div', { class: 'lesson-diagram' }, [diagram.el]),
      el('div', { class: 'lesson-text' }, [title]),
    ]));
    return { el: el('div', { class: 'lesson-body' }, kids), diagram };
  }

  const learn = {
    COLORS,
    pieceDiagram,
    lessonBody,

    /* The lesson card after a mistake.  Resolves when the learner taps
       "Got it!" (which also skips the animation). */
    lesson(target, chosen) {
      const ov = document.getElementById('lesson');
      ov.innerHTML = '';
      ov.className = 'overlay lesson visible';
      const { el: body, diagram } = lessonBody(target, chosen);
      const btn = el('button', { class: 'btn primary', text: T('btnGotIt') });
      const card = el('div', { class: 'lesson-card' }, [body, el('div', { class: 'btn-row' }, [btn])]);
      ov.appendChild(card);
      anime({ targets: card, translateX: [80, 0], opacity: [0, 1], duration: D(380), easing: 'easeOutBack' });
      diagram.play();
      return new Promise((res) => {
        btn.addEventListener('click', () => {
          ZD.audio.play('click');
          I18n.stop();
          diagram.finish();
          learn.closeLesson().then(res);
        }, { once: true });
      });
    },

    closeLesson() {
      const ov = document.getElementById('lesson');
      const card = ov.querySelector('.lesson-card');
      if (!card) {
        ov.className = 'overlay';
        return Promise.resolve();
      }
      return anime({ targets: card, translateX: 60, opacity: 0, duration: D(220), easing: 'easeInQuad' }).finished.then(() => {
        ov.className = 'overlay';
        ov.innerHTML = '';
      });
    },
  };

  ZD.learn = learn;
})();
