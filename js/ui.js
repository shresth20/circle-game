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
    answerBtns: null,
    init(root) {
      this.root = root;
      this.hud = root.querySelector('#hud');
      this.optionsEl = root.querySelector('#options');
      this.stampEl = root.querySelector('#stamp');
      this.bannerEl = root.querySelector('#banner');
      this._buildHud();
      this._buildBar();
    },

    /* ---------------- HUD ---------------- */
    _buildHud() {
      const h = this.hud;
      h.innerHTML = '';
      // profile picture (assets/images/boy/profile.png via the asset pipeline)
      const portrait = el('div', { class: 'portrait', style: { backgroundImage: `url("${ZD.assets.imageUrl('profile')}")` } });
      this.heartsEl = el('div', { class: 'hearts' });
      const left = el('div', { class: 'hud-left' }, [portrait, this.heartsEl]);

      this.muteBtn = el('button', { class: 'icon-btn', 'aria-label': T('hudMute'), onClick: () => {
        ZD.audio.setMuted(!ZD.audio.muted);
        this._syncMute();
        ZD.audio.play('click');
      } });
      this.pauseBtn = el('button', { class: 'icon-btn pause', 'aria-label': T('hudPause'), html: '<span></span><span></span>', onClick: () => ZD.game && ZD.game.togglePause() });
      const right = el('div', { class: 'hud-right' }, [this.muteBtn, this.pauseBtn]);
      h.append(left, right);
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

    /* ---------------- answer panel ----------------
       A side panel (question title + a column of three text pills) to the
       right of the wall, clear of the window and the hero.  Each question
       offers the right piece plus two others drawn at random from the
       remaining five, in random order, so neither the set nor the position
       gives the answer away.  Buttons carry only the piece id. */
    _buildPanel() {
      const box = this.optionsEl;
      box.innerHTML = '';
      box.className = 'answer-panel';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', T('gridTitle'));
      this.listEl = el('div', { class: 'answer-list' });
      box.appendChild(this.listEl);
      this._panelBuilt = true;
    },
    _fillOptions(targetId) {
      const { shuffle } = ZD.util;
      const others = shuffle(ZD.geo.PIECES.filter((id) => id !== targetId)).slice(0, 2);
      this.listEl.innerHTML = '';
      this.answerBtns = {};
      shuffle([targetId, ...others]).forEach((id) => {
        const label = T(ZD.geo.labelKey(id));
        const b = el('button', { class: 'answer', dataset: { piece: id }, 'aria-label': label }, [el('span', { class: 'answer-label', text: label })]);
        b.addEventListener('click', () => this._pick(id));
        this.listEl.appendChild(b);
        this.answerBtns[id] = b;
      });
    },
    _pick(id) {
      if (!this._asking) return;
      const res = this._asking;
      this._asking = null;
      ZD.audio.play('select');
      this.answerBtns[id].classList.add('selected');
      this.optionsEl.classList.add('locked');
      res(id);
    },
    /* Show three fresh options for `targetId` and resolve with the tapped
       piece id. */
    ask(targetId) {
      if (!this._panelBuilt) this._buildPanel();
      const box = this.optionsEl;
      const wasVisible = box.classList.contains('visible');
      if (this.answerBtns) anime.remove(Object.values(this.answerBtns));
      this._fillOptions(targetId);
      box.classList.remove('locked');
      const pills = Object.values(this.answerBtns);
      if (!wasVisible) {
        box.classList.add('visible');
        anime.remove(box);
        anime({ targets: box, translateX: [80, 0], opacity: [0, 1], duration: 300, easing: 'easeOutCubic' });
      }
      anime({ targets: pills, translateX: [40, 0], opacity: [0, 1], duration: 260, delay: anime.stagger(60, { start: wasVisible ? 0 : 80 }), easing: 'easeOutCubic' });
      return new Promise((res) => (this._asking = res));
    },
    /* Stop accepting taps (time out / abort). */
    endAsk() {
      this._asking = null;
      this.optionsEl.classList.add('locked');
    },
    markAnswer(id, state) {
      const b = this.answerBtns && this.answerBtns[id];
      if (!b) return;
      b.classList.add(state);
      if (state === 'reveal') anime({ targets: b, scale: [1, 1.08, 1], duration: 500, easing: 'easeOutBack' });
    },
    hideGrid(instant = false) {
      const box = this.optionsEl;
      this._asking = null;
      if (!box.classList.contains('visible')) return Promise.resolve();
      const pills = Object.values(this.answerBtns || {});
      anime.remove([box, ...pills]);
      if (instant || !this._panelBuilt) {
        box.classList.remove('visible');
        return Promise.resolve();
      }
      return anime({ targets: box, translateX: 80, opacity: 0, duration: 220, easing: 'easeInQuad' }).finished.then(() => box.classList.remove('visible'));
    },

    /* ---------------- stamp / banner / caption ---------------- */
    stamp(text, kind = 'correct', hold = 1100, { high = false } = {}) {
      const s = this.stampEl;
      s.className = 'stamp ' + kind + (high ? ' high' : '') + ' visible';
      s.innerHTML = '';
      const icon = kind === 'correct' ? '✔' : kind === 'wrong' ? '✖' : '☠';
      s.append(el('span', { class: 'stamp-icon', text: icon }), el('span', { text }));
      anime.remove(s);
      return anime({ targets: s, scale: [2.2, 1], opacity: [0, 1], rotate: [kind === 'correct' ? -8 : 6, 0], duration: 380, easing: 'easeOutBack' }).finished.then(() =>
        ZD.util.wait(hold).then(() => anime({ targets: s, opacity: 0, scale: 0.9, duration: 220, easing: 'easeInQuad' }).finished.then(() => s.classList.remove('visible')))
      );
    },
    /* ---------------- message bar ----------------
       Every in-play line (wall titles, the question, rule reviews, the intro
       alarm) appears in ONE bar at the bottom: assets/images/banner.png,
       stretched as a 9-slice (left cap = portrait socket, right cap =
       stripes; caps measured by tools/build-assets.py build_banner).  It sits
       right of the hero and under the answer panel.  The hero's face looks
       out of the socket. */
    _buildBar() {
      const b = this.bannerEl;
      const art = ZD.assets.image('banner');
      const H = 160;
      const k = H / art.h;
      const capL = Math.round(art.capL * k);
      const capR = Math.round(art.capR * k);
      b.className = 'banner msgbar';
      b.innerHTML = '';
      b.style.height = H + 'px';
      b.style.borderWidth = `0 ${capR}px 0 ${capL}px`;
      b.style.borderImage = `url("${ZD.assets.imageUrl('banner')}") 0 ${art.capR} 0 ${art.capL} fill / 0 ${capR}px 0 ${capL}px stretch`;
      // portrait in the socket (positioned in border-box px: the left cap is a border)
      const r = art.socket.r * k;
      const face = el('div', { class: 'msgbar-face', style: { left: art.socket.x * k - r - capL + 'px', top: art.socket.y * k - r + 'px', width: r * 2 + 'px', height: r * 2 + 'px' } });
      face.style.backgroundImage = `url("${ZD.assets.imageUrl('profile')}")`;
      this.barText = el('div', { class: 'msgbar-text' });
      b.append(face, this.barText);
    },
    /* Show a message in the bar.  kind: info | title | ask | good | alert. */
    showBanner(title, text, kind = 'info') {
      const b = this.bannerEl;
      const t = this.barText;
      const wasVisible = b.classList.contains('visible') && !this._barHiding;
      this._barHiding = false;
      b.className = 'banner msgbar ' + kind + ' visible';
      t.innerHTML = '';
      if (title) t.append(el('div', { class: 'banner-title', text: title }));
      if (text) t.append(el('div', { class: 'banner-text', text }));
      anime.remove([b, t]);
      if (wasVisible) {
        // already up: just swap the words
        b.style.opacity = 1;
        b.style.transform = '';
        anime({ targets: t, opacity: [0, 1], translateX: [16, 0], duration: 220, easing: 'easeOutCubic' });
      } else {
        anime({ targets: b, translateY: [60, 0], opacity: [0, 1], duration: 320, easing: 'easeOutCubic' });
        anime({ targets: t, opacity: [0, 1], duration: 260, delay: 90, easing: 'easeOutCubic' });
      }
    },
    hideBanner() {
      const b = this.bannerEl;
      if (!b.classList.contains('visible') || this._barHiding) return Promise.resolve();
      this._barHiding = true;
      anime.remove([b, this.barText]);
      const done = () => {
        if (!this._barHiding) return; // a new message arrived meanwhile
        this._barHiding = false;
        b.classList.remove('visible');
      };
      return anime({ targets: b, opacity: 0, translateY: 40, duration: 200, easing: 'easeInQuad' }).finished.then(done);
    },
    /* Caption by i18n key -> the message bar ('' hides it). */
    caption(key, { big = false } = {}) {
      if (!key) return this.hideBanner();
      return this.showBanner(big ? T(key) : null, big ? null : T(key), big ? 'alert' : 'info');
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
        toggle(T('pauseTimer'), () => ZD.game.timerOn, (v) => ZD.game.setTimerOn(v)),
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
