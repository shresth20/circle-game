/* On-screen controller for the run-and-jump stretch between walls.
   Two round buttons, icons only (no visible text; aria-labels by key):
     bottom-left  RUN  - hold to run (right arrow with speed lines)
     bottom-right JUMP - tap to jump (up arrow over the ground)
   Both work at the same time on a touch screen (hold RUN with one thumb,
   tap JUMP with the other).  Keyboard: Right / D held = run, Space / Up / W
   = jump.  game.js reads `running` and `takeJump()` every frame. */
window.ZD = window.ZD || {};

(function () {
  const { el } = ZD.util;
  const M = ZD.motion;
  const T = (k, v) => ZD.T(k, v);

  const ICON_RUN =
    '<svg viewBox="0 0 100 100" aria-hidden="true">' +
    '<g stroke="#0f4a22" stroke-linecap="round" stroke-width="7"><path d="M10 37h14M6 50h18M10 63h14"/></g>' +
    '<path d="M44 20 L84 50 L44 80 L44 63 L30 63 L30 37 L44 37 Z" fill="#fff" stroke="#0f4a22" stroke-width="6" stroke-linejoin="round"/>' +
    '</svg>';
  const ICON_JUMP =
    '<svg viewBox="0 0 100 100" aria-hidden="true">' +
    '<path d="M50 10 L80 44 L62 44 L62 72 L38 72 L38 44 L20 44 Z" fill="#fff" stroke="#6b2a00" stroke-width="6" stroke-linejoin="round"/>' +
    '<path d="M22 88h56" stroke="#6b2a00" stroke-width="7" stroke-linecap="round"/>' +
    '</svg>';

  const JUMP_BUFFER_MS = 160; // a tap just before the jump is possible still counts
  const RUN_KEYS = new Set(['ArrowRight', 'KeyD']);
  const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);

  const controls = {
    active: false,
    _pointers: new Set(), // pointers holding RUN
    _keyRun: false,
    _jumpAt: -Infinity,

    /* RUN is held (finger on the button or key down). */
    get running() {
      return this.active && (this._pointers.size > 0 || this._keyRun);
    },

    init(root) {
      this.box = root.querySelector('#controls');
      this.runBtn = this._button('run', T('ctrlRun'), ICON_RUN);
      this.jumpBtn = this._button('jump', T('ctrlJump'), ICON_JUMP);
      this.box.append(this.runBtn, this.jumpBtn);

      // RUN: hold.  Pointer capture keeps the hold even if the thumb slides a little.
      const run = this.runBtn;
      run.addEventListener('pointerdown', (e) => {
        if (!this.active) return;
        e.preventDefault();
        try {
          run.setPointerCapture(e.pointerId);
        } catch (_) {
          /* synthetic pointer */
        }
        this._pointers.add(e.pointerId);
        this._sync();
      });
      const release = (e) => {
        this._pointers.delete(e.pointerId);
        this._sync();
      };
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => run.addEventListener(t, release));

      // JUMP: tap (registered on press, so it feels instant)
      const jump = this.jumpBtn;
      jump.addEventListener('pointerdown', (e) => {
        if (!this.active) return;
        e.preventDefault();
        this._jump();
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => jump.addEventListener(t, () => jump.classList.remove('pressed')));

      // no long-press menu / text callout on the buttons
      this.box.addEventListener('contextmenu', (e) => e.preventDefault());

      window.addEventListener('keydown', (e) => {
        if (!this.active) return;
        if (RUN_KEYS.has(e.code)) {
          e.preventDefault();
          this._keyRun = true;
          this._sync();
        } else if (JUMP_KEYS.has(e.code)) {
          e.preventDefault(); // Space must not "click" a focused button
          if (!e.repeat) this._jump();
        }
      });
      window.addEventListener('keyup', (e) => {
        if (RUN_KEYS.has(e.code)) {
          this._keyRun = false;
          this._sync();
        }
        if (JUMP_KEYS.has(e.code)) this.jumpBtn.classList.remove('pressed');
      });
      // a held key never gets its keyup if the window loses focus
      window.addEventListener('blur', () => this._release());
    },

    _button(kind, label, icon) {
      return el('button', { class: `ctrl-btn ${kind}`, type: 'button', 'aria-label': label, tabindex: '-1' }, [
        el('span', { class: 'ctrl-ring' }),
        el('span', { class: 'ctrl-base' }),
        el('span', { class: 'ctrl-face', html: icon }),
      ]);
    },

    _jump() {
      this._jumpAt = performance.now();
      this.jumpBtn.classList.add('pressed');
    },

    _sync() {
      this.runBtn.classList.toggle('pressed', this.running);
    },

    _release() {
      this._pointers.clear();
      this._keyRun = false;
      this._jumpAt = -Infinity;
      if (this.runBtn) {
        this.runBtn.classList.remove('pressed');
        this.jumpBtn.classList.remove('pressed');
      }
    },

    /* True once per JUMP press (a press up to JUMP_BUFFER_MS old still counts). */
    takeJump() {
      if (!this.active || performance.now() - this._jumpAt > JUMP_BUFFER_MS) return false;
      this._jumpAt = -Infinity;
      return true;
    },

    /* Pulse a button as a wordless hint: hint('run' | 'jump', on). */
    hint(kind, on) {
      const b = kind === 'run' ? this.runBtn : this.jumpBtn;
      if (b.classList.contains('hint') !== !!on) b.classList.toggle('hint', !!on);
    },

    show() {
      this._release();
      this.active = true;
      const btns = [this.runBtn, this.jumpBtn];
      btns.forEach((b) => b.classList.remove('hint'));
      this.box.classList.add('visible');
      M.stop(btns);
      return M.pop(btns, { y: 160 }, { duration: M.DUR.SLOW, stagger: M.STAGGER.STEP });
    },

    hide() {
      this.active = false;
      this._release();
      if (!this.box.classList.contains('visible')) return Promise.resolve();
      const btns = [this.runBtn, this.jumpBtn];
      M.stop(btns);
      return M.exit(btns, { y: 160 }, { duration: M.DUR.NORMAL }).then(() => {
        if (!this.active) this.box.classList.remove('visible');
      });
    },

    /* Instant hide (restart / home). */
    reset() {
      this.active = false;
      this._release();
      if (!this.box) return;
      const btns = [this.runBtn, this.jumpBtn];
      M.stop(btns);
      btns.forEach((b) => {
        b.classList.remove('hint');
        b.style.opacity = 0;
      });
      this.box.classList.remove('visible');
    },
  };

  ZD.controls = controls;
})();
