/* HUD, question prompt, answer options, stamps, banners and overlay panels. */
window.ZD = window.ZD || {};

(function () {
  const { el, svg } = ZD.util;
  const T = (k, v) => ZD.T(k, v);

  /* Thumbnail of a piece inside a ghost circle (so a piece always reads as
     "part of a circle"). */
  function pieceThumb(spec, { size = 120, rot = 0, color = '#ffb347', ghost = true } = {}) {
    const r = size * 0.4;
    const s = svg('svg', { viewBox: `${-size / 2} ${-size / 2} ${size} ${size}`, width: size, height: size, class: 'thumb' });
    if (ghost) s.appendChild(svg('circle', { r, fill: 'rgba(255,255,255,0.06)', stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 2, 'stroke-dasharray': '5 5' }));
    const d = ZD.geo.piecePath(spec, 0, 0, r, rot);
    s.appendChild(svg('path', { d, fill: color, stroke: '#5b2a0e', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
    if (ghost) s.appendChild(svg('circle', { r: 3, fill: '#fff', opacity: 0.8 }));
    return s;
  }

  const ui = {
    pieceThumb,
    init(root) {
      this.root = root;
      this.hud = root.querySelector('#hud');
      this.promptEl = root.querySelector('#prompt');
      this.optionsEl = root.querySelector('#options');
      this.stampEl = root.querySelector('#stamp');
      this.bannerEl = root.querySelector('#banner');
      this.captionEl = root.querySelector('#caption');
      this._buildHud();
    },

    /* ---------------- HUD ---------------- */
    _buildHud() {
      const h = this.hud;
      h.innerHTML = '';
      const portrait = el('div', { class: 'portrait' });
      const face = new ZD.Sprite({ className: 'face' });
      face.setSheet('hero.sideIdle');
      face.setScale(0.42);
      face.anchorY = 0.95;
      face.setPos(48, 158);
      face.play({ sheet: 'hero.sideIdle', fps: 8, loop: true });
      portrait.appendChild(face.el);
      this.heartsEl = el('div', { class: 'hearts' });
      const left = el('div', { class: 'hud-left' }, [portrait, this.heartsEl]);

      this.progressEl = el('div', { class: 'progress' });
      this.scoreEl = el('div', { class: 'score' }, [el('span', { class: 'score-label', text: T('hudScore') }), el('span', { class: 'score-val', text: '0' })]);
      const center = el('div', { class: 'hud-center' }, [this.progressEl, this.scoreEl]);

      this.muteBtn = el('button', { class: 'icon-btn', 'aria-label': T('hudMute'), onClick: () => {
        ZD.audio.setMuted(!ZD.audio.muted);
        this._syncMute();
        ZD.audio.play('click');
      } });
      this.pauseBtn = el('button', { class: 'icon-btn pause', 'aria-label': T('hudPause'), html: '<span></span><span></span>', onClick: () => ZD.game && ZD.game.togglePause() });
      const right = el('div', { class: 'hud-right' }, [this.muteBtn, this.pauseBtn]);
      h.append(left, center, right);
      this._syncMute();
    },
    _syncMute() {
      this.muteBtn.classList.toggle('muted', ZD.audio.muted);
      this.muteBtn.innerHTML = ZD.audio.muted
        ? '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>';
    },
    showHud(v) {
      this.hud.classList.toggle('visible', v);
    },
    setHearts(n, max) {
      this.heartsEl.innerHTML = '';
      for (let i = 0; i < max; i++) this.heartsEl.appendChild(el('div', { class: 'heart' + (i < n ? '' : ' lost') }));
    },
    loseHeart(index) {
      const h = this.heartsEl.children[index];
      if (!h) return;
      ZD.audio.play('heart');
      anime({ targets: h, scale: [1, 1.6, 0.9, 1], rotate: [0, -15, 10, 0], duration: 600, easing: 'easeOutQuad' });
      setTimeout(() => h.classList.add('lost'), 300);
    },
    setProgress(current, total, done) {
      this.progressEl.innerHTML = '';
      const label = el('div', { class: 'progress-label', text: T('hudWall', { n: Math.min(current + 1, total), total }) });
      const pips = el('div', { class: 'pips' });
      for (let i = 0; i < total; i++) pips.appendChild(el('div', { class: 'pip' + (i < done ? ' done' : i === current ? ' active' : '') }));
      this.progressEl.append(label, pips);
    },
    setScore(n, animate = true) {
      const v = this.scoreEl.querySelector('.score-val');
      if (!animate) {
        v.textContent = n;
        return;
      }
      const o = { s: parseInt(v.textContent, 10) || 0 };
      anime({ targets: o, s: n, round: 1, duration: 600, easing: 'easeOutQuad', update: () => (v.textContent = o.s) });
      anime({ targets: v, scale: [1.4, 1], duration: 500, easing: 'easeOutBack' });
    },

    /* ---------------- prompt + options ---------------- */
    showPrompt(main, sub) {
      this.promptEl.innerHTML = '';
      this.promptEl.append(el('div', { class: 'prompt-main', text: main }));
      if (sub) this.promptEl.append(el('div', { class: 'prompt-sub', text: sub }));
      this.promptEl.classList.add('visible');
      anime({ targets: this.promptEl, translateY: [-30, 0], opacity: [0, 1], duration: 450, easing: 'easeOutBack' });
    },
    hidePrompt() {
      this.promptEl.classList.remove('visible');
    },
    /**
     * options: [{spec, id, label, rot}], mode: shape|name|identify
     * resolves with the chosen option (after the learner taps).
     */
    showOptions(options, mode) {
      const box = this.optionsEl;
      box.innerHTML = '';
      box.className = 'mode-' + mode + ' count-' + options.length;
      return new Promise((resolve) => {
        let locked = false;
        options.forEach((opt, i) => {
          const b = el('button', { class: 'option', dataset: { id: opt.id } });
          if (mode !== 'identify') b.appendChild(el('div', { class: 'opt-thumb' }, [pieceThumb(opt.spec, { size: 124, rot: opt.rot || 0 })]));
          else b.appendChild(el('div', { class: 'opt-icon' }, [pieceThumb(opt.spec, { size: 64, rot: 0, color: 'rgba(255,255,255,0.25)', ghost: true })]));
          if (mode !== 'name') b.appendChild(el('div', { class: 'opt-label', text: opt.label }));
          b.addEventListener('click', () => {
            if (locked) return;
            locked = true;
            ZD.audio.play('select');
            box.querySelectorAll('.option').forEach((o) => o.classList.add('disabled'));
            b.classList.remove('disabled');
            b.classList.add('selected');
            resolve(opt);
          });
          box.appendChild(b);
          anime({ targets: b, translateY: [60, 0], opacity: [0, 1], duration: 420, delay: 80 * i, easing: 'easeOutBack' });
        });
        box.classList.add('visible');
      });
    },
    markOption(id, state) {
      const b = this.optionsEl.querySelector(`.option[data-id="${id}"]`);
      if (b) b.classList.add(state);
    },
    hideOptions() {
      const box = this.optionsEl;
      const items = box.querySelectorAll('.option');
      if (!items.length) {
        box.classList.remove('visible');
        return Promise.resolve();
      }
      return anime({ targets: items, translateY: 60, opacity: 0, duration: 260, delay: anime.stagger(40), easing: 'easeInQuad' }).finished.then(() => {
        box.classList.remove('visible');
        box.innerHTML = '';
      });
    },

    /* ---------------- stamp / banner / caption ---------------- */
    stamp(text, kind = 'correct', hold = 1100) {
      const s = this.stampEl;
      s.className = 'stamp ' + kind + ' visible';
      s.innerHTML = '';
      const icon = kind === 'correct' ? '✔' : kind === 'wrong' ? '✖' : '☠';
      s.append(el('span', { class: 'stamp-icon', text: icon }), el('span', { text }));
      anime.remove(s);
      return anime({ targets: s, scale: [2.2, 1], opacity: [0, 1], rotate: [kind === 'correct' ? -8 : 6, 0], duration: 380, easing: 'easeOutBack' }).finished.then(() =>
        ZD.util.wait(hold).then(() => anime({ targets: s, opacity: 0, scale: 0.9, duration: 220, easing: 'easeInQuad' }).finished.then(() => s.classList.remove('visible')))
      );
    },
    showBanner(title, text, kind = 'info') {
      const b = this.bannerEl;
      b.className = 'banner ' + kind + ' visible';
      b.innerHTML = '';
      b.append(el('div', { class: 'banner-title', text: title }));
      if (text) b.append(el('div', { class: 'banner-text', text }));
      anime({ targets: b, translateY: [40, 0], opacity: [0, 1], duration: 420, easing: 'easeOutCubic' });
    },
    hideBanner() {
      const b = this.bannerEl;
      if (!b.classList.contains('visible')) return Promise.resolve();
      return anime({ targets: b, opacity: 0, translateY: 20, duration: 220, easing: 'easeInQuad' }).finished.then(() => b.classList.remove('visible'));
    },
    /* Caption by i18n key; narrates the same key unless speak:false. */
    caption(key, { speak = true, big = false } = {}) {
      const c = this.captionEl;
      c.innerHTML = '';
      if (!key) {
        c.classList.remove('visible');
        return;
      }
      c.className = 'caption visible' + (big ? ' big' : '');
      c.appendChild(el('span', { text: T(key) }));
      anime({ targets: c, opacity: [0, 1], translateY: [16, 0], duration: 380, easing: 'easeOutCubic' });
      if (speak) I18n.say(key);
    },

    /* ---------------- generic overlay panel ---------------- */
    /* buttons: [{label, cls, onClick}] - resolves with the clicked index. */
    panel({ id, title, html, buttons = [], cls = '' }) {
      const ov = document.getElementById(id);
      ov.innerHTML = '';
      ov.className = 'overlay ' + cls;
      const p = el('div', { class: 'panel' });
      if (title) p.appendChild(el('h2', { class: 'panel-title', text: title }));
      const body = el('div', { class: 'panel-body' });
      if (typeof html === 'string') body.innerHTML = html;
      else if (html) body.appendChild(html);
      p.appendChild(body);
      const row = el('div', { class: 'btn-row' });
      const result = new Promise((resolve) => {
        buttons.forEach((b, i) => {
          row.appendChild(
            el('button', { class: 'btn ' + (b.cls || 'primary'), text: b.label, onClick: () => {
              ZD.audio.play('click');
              b.onClick && b.onClick();
              if (!b.keepOpen) ui.closePanel(id);
              resolve(i);
            } })
          );
        });
      });
      if (buttons.length) p.appendChild(row);
      ov.appendChild(p);
      ov.classList.add('visible');
      anime({ targets: p, scale: [0.85, 1], opacity: [0, 1], duration: 420, easing: 'easeOutBack' });
      return { el: ov, panel: p, body, result };
    },
    closePanel(id) {
      const ov = document.getElementById(id);
      const p = ov.querySelector('.panel');
      if (!p) {
        ov.classList.remove('visible');
        return Promise.resolve();
      }
      return anime({ targets: p, scale: 0.9, opacity: 0, duration: 200, easing: 'easeInQuad' }).finished.then(() => {
        ov.classList.remove('visible');
        ov.innerHTML = '';
      });
    },

    /* Pause menu with settings. */
    pauseMenu(onResume, onRestart, onHome) {
      const toggle = (label, get, set) => {
        const b = el('button', { class: 'toggle' + (get() ? ' on' : '') });
        const render = () => {
          b.innerHTML = `<span>${label}</span><span class="state">${get() ? T('pauseOn') : T('pauseOff')}</span>`;
          b.classList.toggle('on', get());
        };
        render();
        b.addEventListener('click', () => {
          set(!get());
          render();
          ZD.audio.play('click');
        });
        return b;
      };
      const body = el('div', { class: 'settings' }, [
        toggle(T('pauseSound'), () => !ZD.audio.muted, (v) => {
          ZD.audio.setMuted(!v);
          this._syncMute();
        }),
        toggle(T('pauseVoice'), () => ZD.audio.voiceEnabled, (v) => ZD.audio.setVoice(v)),
        toggle(T('pauseMotion'), () => ZD.scene.settings.reducedMotion, (v) => ZD.scene.setReducedMotion(v)),
      ]);
      return this.panel({
        id: 'pause',
        title: T('pauseTitle'),
        html: body,
        cls: 'pause',
        buttons: [
          { label: T('btnResume'), cls: 'primary', onClick: onResume },
          { label: T('btnRestart'), cls: 'secondary', onClick: onRestart },
          { label: T('btnHome'), cls: 'secondary', onClick: onHome },
        ],
      });
    },
  };

  ZD.ui = ui;
})();
