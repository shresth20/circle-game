/* HUD, question prompt, answer options, banners and overlay panels. */
window.ZD = window.ZD || {};

(function () {
  const { el, svg } = ZD.util;
  const M = ZD.motion;
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
      this.bannerEl = root.querySelector('#banner');
      this._buildHud();
      this._buildBar();
    },

    /* ---------------- HUD ---------------- */
    _buildHud() {
      const h = this.hud;
      h.innerHTML = '';
      // profile picture (circle-game-art/images/boy/profile.png via the asset pipeline)
      const portrait = el('div', { class: 'portrait', style: { backgroundImage: `url("${ZD.assets.imageUrl('profile')}")` } });
      // stage chip: "Wall 2/6" (set per wall by setStage)
      this.stageEl = el('div', { class: 'hud-stage' });
      const left = el('div', { class: 'hud-left' }, [portrait, this.stageEl]);

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
    /* Current / total stage in the top-left chip; pops when the stage changes. */
    setStage(n, total) {
      const text = T('hudStage', { n, total });
      if (this.stageEl.textContent === text) return;
      this.stageEl.textContent = text;
      M.stop(this.stageEl);
      M.fromTo(this.stageEl, { scale: 1.25 }, { scale: 1, duration: M.DUR.SLOW, ease: M.EASE.POP });
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
    /* The panel box spans from the wall's right edge to the stage's right
       edge, top to bottom of the wall as framed while asking (the 'focus'
       shot); CSS centres the pills in it both ways.  Stage px, so on a
       16:9 screen the pills sit midway between wall and screen edge, and
       on wider screens (scenery past the stage edge) they stay by the wall. */
    _placePanel() {
      const front = ZD.scene.front;
      if (!front || !front.wallInShot) return;
      const w = front.wallInShot('focus');
      const left = Math.round(w.x + w.w);
      Object.assign(this.optionsEl.style, {
        left: left + 'px',
        width: ZD.scene.STAGE_W - left + 'px',
        top: Math.round(w.y) + 'px',
        height: Math.round(w.h) + 'px',
      });
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
      this._placePanel();
      const box = this.optionsEl;
      const wasVisible = box.classList.contains('visible');
      if (this.answerBtns) M.stop(Object.values(this.answerBtns));
      this._fillOptions(targetId);
      box.classList.remove('locked');
      const pills = Object.values(this.answerBtns);
      if (!wasVisible) {
        box.classList.add('visible');
        M.stop(box);
        M.enter(box, { x: 80 });
      }
      // once in, the pills hand their look back to the stylesheet (hover,
      // press, picked, dimmed when locked)
      M.enter(pills, { x: 40 }, { delay: wasVisible ? 0 : M.DUR.INSTANT, stagger: M.STAGGER.UI, clearProps: 'transform,opacity' });
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
      if (state === 'reveal') M.pulse(b, 1.08, { duration: M.DUR.SLOW, clearProps: 'transform' });
    },
    hideGrid(instant = false) {
      const box = this.optionsEl;
      this._asking = null;
      if (!box.classList.contains('visible')) return Promise.resolve();
      const pills = Object.values(this.answerBtns || {});
      M.stop([box, ...pills]);
      if (instant || !this._panelBuilt) {
        box.classList.remove('visible');
        return Promise.resolve();
      }
      return M.exit(box, { x: 80 }).then(() => box.classList.remove('visible'));
    },

    /* ---------------- zombie timer meter ----------------
       Top strip shown while a timed question is open: the wall zombie's
       face on the left, the small brick wall on the right, a plain red line
       joining them.  The face closes in on the wall as time runs out and the
       line shrinks with it.  game.js drives it from the climbing zombie's
       own tween (front.zombieClimb onProgress), so the meter, the climb and
       the time-out share one clock and pause together.  Per frame only
       transform / opacity change. */
    TIMER: { W: 780, H: 150, FACE_H: 112, WALL_H: 132, BRICKS: 0.2, WALL_UP: 18, LINE_H: 14 }, // WALL_UP: wall sits this much above the line
    _buildTimer() {
      const box = this.root.querySelector('#timer');
      box.innerHTML = '';
      box.setAttribute('role', 'progressbar');
      box.setAttribute('aria-label', T('timerLabel'));
      box.style.width = this.TIMER.W + 'px';
      box.style.height = this.TIMER.H + 'px';
      this.tLine = el('div', { class: 'timer-line' });
      this.tFace = el('div', { class: 'timer-face' });
      this.tFaceImg = el('img', { class: 'timer-face-img', alt: '', draggable: 'false' });
      this.tFace.appendChild(this.tFaceImg);
      this.tWall = el('img', { class: 'timer-wall', alt: '', draggable: 'false', src: ZD.assets.imageUrl('timerWall') });
      box.append(this.tLine, this.tWall, this.tFace);
      this.timerEl = box;
    },
    /* Show the meter for a `seconds` countdown with zombie skin `skin`. */
    timerShow(skin, seconds) {
      if (!this.timerEl) this._buildTimer();
      const C = this.TIMER;
      const box = this.timerEl;
      const key = 'timerFace' + (((skin || 0) % 2) + 2) % 2;
      const face = ZD.assets.image(key);
      const faceW = Math.round((face.w * C.FACE_H) / face.h);
      const wallArt = ZD.assets.image('timerWall');
      const wallW = Math.round((wallArt.w * C.WALL_H) / wallArt.h);
      const wallX = C.W - wallW;
      const mid = C.H / 2;
      Object.assign(this.tFaceImg.style, { width: faceW + 'px', height: C.FACE_H + 'px' });
      this.tFaceImg.src = ZD.assets.imageUrl(key);
      Object.assign(this.tFace.style, { width: faceW + 'px', height: C.FACE_H + 'px', top: mid - C.FACE_H / 2 + 'px' });
      Object.assign(this.tWall.style, { width: wallW + 'px', height: C.WALL_H + 'px', top: mid - C.WALL_H / 2 - C.WALL_UP + 'px' });
      // the line runs from the face's centre to just under the wall's bricks
      const lineL = faceW / 2;
      const lineR = wallX + wallW * (C.BRICKS + 0.12);
      Object.assign(this.tLine.style, { left: lineL + 'px', width: lineR - lineL + 'px', height: C.LINE_H + 'px', top: mid - C.LINE_H / 2 + 'px' });
      // at q = 1 the face presses into the bricks
      this._t = { faceW, lineL, lineR, travel: wallX + wallW * C.BRICKS - faceW * 0.82, seconds, left: null };
      box.classList.remove('danger');
      this.timerSet(0, 0);
      M.stop([box, this.tWall, this.tFaceImg]);
      M.clear([this.tWall, this.tFaceImg], 'transform');
      box.classList.add('visible');
      M.enter(box, { y: -40 });
    },
    /* q 0..1 = how far the zombie has come; hop 0..1 = its stride bounce. */
    timerSet(q, hop) {
      const t = this._t;
      if (!t) return;
      const x = q * t.travel;
      this.tFace.style.transform = `translate3d(${x.toFixed(1)}px, ${(-hop * 10).toFixed(1)}px, 0) rotate(${(hop * 7 - 2).toFixed(1)}deg)`;
      const len = t.lineR - t.lineL;
      this.tLine.style.transform = `scaleX(${Math.max(0, (len - x) / len).toFixed(4)})`;
      this.timerEl.classList.toggle('danger', q > 0.7);
      const left = Math.ceil(t.seconds * (1 - q));
      if (left !== t.left) {
        t.left = left;
        this.timerEl.setAttribute('aria-valuenow', String(left));
        this.timerEl.setAttribute('aria-valuetext', left === 1 ? T('timerLeftOne') : T('timerLeft', { s: left }));
      }
    },
    /* Time up: the face slams the wall, the wall shakes, then the meter goes. */
    timerHit() {
      if (!this._t) return Promise.resolve();
      this.timerSet(1, 0);
      M.stop([this.tWall, this.tFaceImg]);
      // the face squashes on the bricks and springs back; the wall rattles
      M.fromTo(this.tFaceImg, { scaleX: 1.25, scaleY: 0.8 }, { scaleX: 1, scaleY: 1, duration: M.DUR.SLOW, ease: M.EASE.POP });
      return M.shake(this.tWall, { x: [0, 12, -10, 7, -4, 0], rotation: [0, 3, -2, 1, 0, 0] }, { duration: M.DUR.REVEAL }).then(() => this.timerHide());
    },
    timerHide(instant = false) {
      const box = this.timerEl;
      if (!box || !box.classList.contains('visible')) return Promise.resolve();
      this._t = null;
      M.stop(box);
      const done = () => box.classList.remove('visible', 'danger');
      if (instant) return Promise.resolve(done());
      return M.exit(box, { y: -30 }).then(done);
    },

    /* ---------------- instruction bar ----------------
       Every line (the intro story, each step of a wall, rule reviews)
       appears in ONE bar at the bottom: circle-game-art/images/banner.png,
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
      // every line sits in the same grid cell, so the outgoing line fades
      // out exactly where the incoming one rises in (no jump, no blank frame)
      this.barText = el('div', { class: 'msgbar-text' });
      b.append(face, this.barText);
      this._queue = []; // lines waiting to appear
      this._busy = false; // the line on screen is still being read
      this._lineId = 0;
    },

    /* ---------------- instruction bar: one sentence at a time ----------
       guide(key) is the only way text reaches the bar.  Each call shows ONE
       sentence (an i18n key), reads it aloud, and resolves true once the
       learner has had time to read it: its reading time has passed AND the
       read-aloud has finished (it resolves false if it was dropped before
       it appeared).  Lines queue in order: a line waits until the one on
       screen has been read, so lines never flash past.  Lines are short
       and never wrap: one line in the bar (_fitLine shrinks one that is too
       long, e.g. in another language).
         prompt: true   an action prompt (RUN, JUMP...) - it can go out of date
         replace: true  drops the waiting prompts and takes their place
         now: true      drops the waiting lines and shows at once (urgent)
       kind: info | alert | ask | good | bad.  *word* in the text marks a
       key word (highlighted).  Motion: transform / opacity only. */
    guide(key, { vars, kind = 'info', now = false, replace = false, prompt = false, speak = true } = {}) {
      return new Promise((resolve) => {
        if (now) this._dropWaiting();
        else if (replace) this._dropWaiting((e) => e.prompt);
        const entry = { key, vars, kind, speak, prompt, resolve };
        if (now) this._play(entry);
        else {
          this._queue.push(entry);
          this._pump();
        }
      });
    },
    _dropWaiting(which = () => true) {
      this._queue = this._queue.filter((e) => {
        if (!which(e)) return true;
        e.resolve(false);
        return false;
      });
    },
    _pump() {
      if (this._busy || !this._queue.length) return;
      this._play(this._queue.shift());
    },
    _play(entry) {
      const id = ++this._lineId;
      this._busy = true;
      const text = T(entry.key, entry.vars);
      this._showLine(text, entry.kind);
      const read = this._readMs(text);
      const spoken = entry.speak ? I18n.say(entry.key, entry.vars) : Promise.resolve();
      // (a read-aloud that never reports its end can hold a line only so long)
      Promise.all([ZD.clock.wait(read), Promise.race([spoken, ZD.clock.wait(read + 5000)])]).then(() => {
        entry.resolve(true);
        if (id !== this._lineId) return; // a newer line (or a reset) took over
        this._busy = false;
        this._pump();
      });
    },
    /* Time to read a line: a beat to notice it plus ~0.3 s a word. */
    _readMs(text) {
      const words = text.replace(/\*/g, '').trim().split(/\s+/).length;
      return Math.max(1600, 800 + words * 300);
    },
    /* A line wider than the bar is set smaller (once, before it shows -
       never animated), so it still fits on one line. */
    _fitLine(line) {
      const box = this.barText;
      const cs = getComputedStyle(box);
      const room = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const w = line.scrollWidth;
      if (room > 0 && w > room) {
        const size = parseFloat(getComputedStyle(line).fontSize);
        line.style.fontSize = Math.floor(size * (room / w) * 0.98) + 'px';
      }
    },
    /* Words as inline-blocks so each can rise in on its own; *...* = key word. */
    _lineNode(text, kind) {
      const line = el('div', { class: 'msgbar-line ' + kind });
      const words = [];
      text.split(/(\*[^*]+\*)/).forEach((part) => {
        if (!part) return;
        const hl = part.length > 2 && part[0] === '*' && part[part.length - 1] === '*';
        (hl ? part.slice(1, -1) : part).split(/(\s+)/).forEach((w) => {
          if (!w) return;
          if (/^\s+$/.test(w)) return line.appendChild(document.createTextNode(' '));
          const span = el('span', { class: 'w' + (hl ? ' hl' : ''), text: w });
          // hidden from the very first frame (no flash before the tween starts)
          span.style.opacity = '0';
          span.style.transform = 'translateY(18px)'; // (= the tween's start: _showLine)
          line.appendChild(span);
          words.push(span);
        });
      });
      return { line, words };
    },
    _showLine(text, kind) {
      const b = this.bannerEl;
      const box = this.barText;
      const { line, words } = this._lineNode(text, kind);
      const barUp = b.classList.contains('visible') && !this._barHiding;
      this._barHiding = false;
      // the line on screen leaves: up and out, quickly (ease-in)
      const old = Array.from(box.children).filter((n) => !n.classList.contains('leaving'));
      old.forEach((n) => {
        n.classList.add('leaving');
        M.stop(n.querySelectorAll('.w'));
        M.exit(n, { y: -14 }, { onComplete: () => n.remove() });
      });
      box.appendChild(line);
      // cross-fade: the new line starts halfway through the old one's exit
      let delay = old.length ? M.DUR.FAST / 2 : 0;
      if (!barUp) {
        M.stop(b);
        b.classList.add('visible');
        // hidden before it is shown, so it can never pop up for a frame
        M.set(b, { y: 60, opacity: 0 });
      }
      this._fitLine(line); // (the bar is laid out now: measure the line)
      if (!barUp) {
        M.enter(b, { y: 60 });
        delay = M.DUR.NORMAL / 2; // the words rise as the bar settles
      }
      // the new sentence rises in word by word (ease-out), the whole line
      // in about 0.6 s whatever its length
      M.enter(words, { y: 18 }, { delay, stagger: Math.max(0.018, Math.min(0.045, 0.6 / words.length)) });
    },
    /* Slide the bar away (the line stays in it until it is shown again). */
    hideBanner() {
      const b = this.bannerEl;
      // drop the lines still waiting; the next line shows at once
      this._dropWaiting();
      this._lineId++;
      this._busy = false;
      if (!b.classList.contains('visible') || this._barHiding) return Promise.resolve();
      this._barHiding = true;
      M.stop(b);
      const done = () => {
        if (!this._barHiding) return; // a new line arrived meanwhile
        this._barHiding = false;
        b.classList.remove('visible');
        this.barText.innerHTML = '';
      };
      return M.exit(b, { y: 40 }).then(done);
    },
    /* Instant reset (restart / home): no bar, no queued lines. */
    clearGuide() {
      this._dropWaiting();
      this._lineId++;
      this._busy = false;
      this._barHiding = false;
      M.stop(this.bannerEl);
      this.bannerEl.classList.remove('visible');
      this.barText.innerHTML = '';
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
      M.pop(p, { scale: 0.85 });
      return { el: ov, panel: p, body, result };
    },
    closePanel(id) {
      const ov = document.getElementById(id);
      const p = ov.querySelector('.panel');
      if (!p) {
        ov.classList.remove('visible');
        return Promise.resolve();
      }
      return M.exit(p, { scale: 0.9 }).then(() => {
        ov.classList.remove('visible');
        ov.innerHTML = '';
      });
    },

    /* Pause menu: just the title and Resume.  Sound is switched from the
       speaker icon in the HUD; read-aloud and the zombie timer are always on. */
    pauseMenu(onResume) {
      return this.panel({
        id: 'pause',
        title: T('pauseTitle'),
        cls: 'pause',
        buttons: [{ label: T('btnResume'), cls: 'primary', onClick: onResume }],
      });
    },
  };

  ZD.ui = ui;
})();
