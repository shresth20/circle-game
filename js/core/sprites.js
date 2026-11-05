/* Sprite-sheet animator.  One rAF ticker drives every Sprite; frames are
   shown by moving the background-position of a fixed-size element, so there
   is no per-frame image decoding and transforms stay GPU friendly. */
window.ZD = window.ZD || {};

(function () {
  const live = new Set();
  let paused = false;
  let last = 0;

  function tick(t) {
    requestAnimationFrame(tick);
    if (paused) {
      last = t;
      return;
    }
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    live.forEach((s) => s._advance(dt));
  }
  requestAnimationFrame((t) => {
    last = t;
    tick(t);
  });

  class Sprite {
    /**
     * @param {object} o  { className, scale, anchorY, flip, zIndex }
     */
    constructor(o = {}) {
      this.el = ZD.util.el('div', { class: 'sprite ' + (o.className || '') });
      this.shadow = ZD.util.el('div', { class: 'sprite-shadow' });
      this.img = ZD.util.el('div', { class: 'sprite-img' });
      this.el.append(this.shadow, this.img);
      this.scale = o.scale || 1;
      this.scaleY = o.scaleY || null;
      this.flip = !!o.flip;
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

    setSheet(key) {
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
      this.shadow.style.width = s.fw * 0.5 + 'px';
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
      const step = 1 / a.fps;
      while (this.acc >= step) {
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
