/* Sprite-sheet animator.  One rAF ticker drives every Sprite; frames are
   shown by moving the background-position of a fixed-size element, so there
   is no per-frame image decoding and transforms stay GPU friendly. */
window.ZD = window.ZD || {};

(function () {
  const live = new Set();
  let paused = false;
  let last = 0;

  /* Display refresh interval (s), the median of recent rAF steps.  Sprite
     frames are held for a whole number of refreshes: 16 fps on a 60 Hz
     screen would otherwise alternate 4,4,4,3 refreshes (67/67/67/50 ms) and
     9 fps 7,7,6 - an uneven cadence that reads as stutter even when every
     drawing is perfect. */
  let vsync = 1 / 60;
  const steps = [];
  let sinceEstimate = 0;
  function sampleRefresh(dt) {
    if (dt <= 0.002 || dt > 0.05) return; // hidden tab, hitch, or duplicate stamp
    steps.push(dt);
    if (steps.length > 40) steps.shift();
    if (++sinceEstimate >= 20 && steps.length >= 10) {
      sinceEstimate = 0;
      const s = steps.slice().sort((a, b) => a - b);
      vsync = Math.min(1 / 24, Math.max(1 / 240, s[s.length >> 1]));
    }
  }

  function tick(t) {
    requestAnimationFrame(tick);
    const raw = (t - last) / 1000;
    last = t;
    if (paused) return;
    sampleRefresh(raw);
    const dt = Math.min(0.1, raw);
    live.forEach((s) => s._advance(dt));
  }
  requestAnimationFrame((t) => {
    last = t;
    tick(t);
  });

  class Sprite {
    /**
     * @param {object} o  { className, scale, anchorY, flip, zIndex, skin }
     *   skin: a character variant.  Sheets named "zombie.<view>.<action>" are
     *   read from "<skin>.<view>.<action>" instead (e.g. skin "zombie2"), so
     *   game code always names the zombie sheets the same way.
     */
    constructor(o = {}) {
      this.el = ZD.util.el('div', { class: 'sprite ' + (o.className || '') });
      this.shadow = ZD.util.el('div', { class: 'sprite-shadow' });
      this.img = ZD.util.el('div', { class: 'sprite-img' });
      this.el.append(this.shadow, this.img);
      this.scale = o.scale || 1;
      this.scaleY = o.scaleY || null;
      this.flip = !!o.flip;
      this.skin = o.skin || null;
      this.anchorY = o.anchorY == null ? 0.95 : o.anchorY;
      this.x = 0;
      this.y = 0;
      this.rot = 0;
      this.offsetY = 0;
      this.sheet = null;
      this.sheetKey = null;
      this.anim = null;
      this.frame = 0;
      this.acc = 0;
      this.onComplete = null;
      if (o.zIndex != null) this.el.style.zIndex = o.zIndex;
      live.add(this);
    }

    /* The sheet actually drawn for `key` under this sprite's skin. */
    resolve(key) {
      if (this.skin && key.startsWith('zombie.')) {
        const alt = this.skin + key.slice(6);
        if (ZD.assets.sprite(alt)) return alt;
      }
      return key;
    }

    /* Switch variant; the current sheet and frame carry over. */
    setSkin(skin) {
      skin = skin || null;
      if (skin === this.skin) return;
      this.skin = skin;
      const name = this.sheetName;
      if (!name) return;
      const old = this.sheet;
      const frame = this.frame;
      this.sheetKey = null;
      this.setSheet(name);
      // the variants' sheets may differ in length: keep a playing animation
      // spanning the whole sheet, and the frame inside it
      const a = this.anim;
      const last = this.sheet.frames - 1;
      if (a && old && a.to === old.frames - 1) a.to = last;
      if (a) a.to = Math.min(a.to, last);
      this.frame = Math.min(frame, a ? a.to : last);
      this.setFrame(this.frame);
    }

    setSheet(name) {
      const key = this.resolve(name);
      this.sheetName = name;
      if (key === this.sheetKey) return;
      const s = ZD.assets.sprite(key);
      if (!s) throw new Error('unknown sprite ' + key);
      this.sheet = s;
      this.sheetKey = key;
      this.anchorY = s.anchorY != null ? s.anchorY : this.anchorY;
      const st = this.img.style;
      st.width = s.fw + 'px';
      st.height = s.fh + 'px';
      st.backgroundImage = `url("${ZD.assets.spriteUrl(key)}")`;
      st.backgroundSize = `${s.fw * s.cols}px ${s.fh * s.rows}px`;
      this.el.style.width = s.fw + 'px';
      this.el.style.height = s.fh + 'px';
      this.shadow.style.top = s.fh * this.anchorY + 'px';
      // sheets re-packed to their own cell widths carry a fixed shadow width,
      // so the shadow does not change size between animations
      this.shadow.style.width = (s.shadowW || s.fw * 0.5) + 'px';
      this._applyTransform();
      this.setFrame(0);
    }

    setFrame(i) {
      if (!this.sheet) return;
      const s = this.sheet;
      i = ((i % s.frames) + s.frames) % s.frames;
      this.frame = i;
      const c = i % s.cols;
      const r = Math.floor(i / s.cols);
      this.img.style.backgroundPosition = `${-c * s.fw}px ${-r * s.fh}px`;
    }

    /** anim: { sheet, fps, loop, from, to, hold } */
    play(anim, onComplete) {
      if (anim.sheet) this.setSheet(anim.sheet);
      this.anim = Object.assign({ fps: 12, loop: false, from: 0, to: this.sheet.frames - 1 }, anim);
      this.frame = this.anim.from;
      this.acc = 0;
      this.onComplete = onComplete || null;
      this.setFrame(this.frame);
      return new Promise((res) => {
        const prev = this.onComplete;
        this.onComplete = () => {
          prev && prev();
          res();
        };
        if (this.anim.loop) res(); // loops resolve immediately
      });
    }

    stop() {
      this.anim = null;
    }

    _advance(dt) {
      const a = this.anim;
      if (!a) return;
      this.acc += dt;
      // every frame lasts the same whole number of display refreshes; the
      // half-refresh tolerance absorbs rAF timestamp jitter, and the carried
      // remainder keeps the long-run rate exact after dropped refreshes
      const step = Math.max(1, Math.round(1 / (a.fps * vsync))) * vsync;
      while (this.acc >= step - vsync * 0.5) {
        this.acc -= step;
        if (this.frame < a.to) {
          this.frame++;
        } else if (a.loop) {
          this.frame = a.from;
        } else {
          this.anim = null;
          const cb = this.onComplete;
          this.onComplete = null;
          cb && cb();
          return;
        }
        this.setFrame(this.frame);
      }
    }

    setPos(x, y) {
      this.x = x;
      this.y = y;
      this._applyTransform();
    }

    setScale(s, sy) {
      this.scale = s;
      this.scaleY = sy == null ? null : sy;
      this._applyTransform();
    }

    setFlip(f) {
      this.flip = !!f;
      this._applyTransform();
    }

    setRotation(deg) {
      this.rot = deg;
      this._applyTransform();
    }

    setOffsetY(v) {
      this.offsetY = v;
      this._applyTransform();
    }

    _applyTransform() {
      const adj = (this.sheet && this.sheet.scaleAdjust) || 1;
      const sx = this.scale * adj * (this.flip ? -1 : 1);
      const sy = (this.scaleY == null ? this.scale : this.scaleY) * adj;
      this.el.style.transformOrigin = `50% ${this.anchorY * 100}%`;
      this.el.style.transform =
        `translate(${this.x}px, ${this.y + this.offsetY}px) translate(-50%, -${this.anchorY * 100}%) ` +
        `rotate(${this.rot}deg) scale(${sx}, ${sy})`;
    }

    show(v = true) {
      this.el.style.display = v ? '' : 'none';
    }

    destroy() {
      live.delete(this);
      this.el.remove();
    }
  }

  ZD.Sprite = Sprite;
  ZD.sprites = {
    setPaused: (p) => {
      paused = p;
    },
  };
})();
