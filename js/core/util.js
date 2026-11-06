/* Shared helpers: DOM building, math, pausable clock, prefs. */
window.ZD = window.ZD || {};

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function applyAttrs(node, attrs, isSvg) {
    if (!attrs) return node;
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'class') node.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) node.style.setProperty(sk, sv);
          else node.style[sk] = sv;
        }
      }
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (!isSvg && k in node && typeof v !== 'string') node[k] = v;
      else node.setAttribute(k, v);
    }
    return node;
  }

  function append(node, children) {
    if (children == null) return;
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }

  const util = {
    el(tag, attrs, children) {
      const n = applyAttrs(document.createElement(tag), attrs, false);
      append(n, children);
      return n;
    },
    svg(tag, attrs, children) {
      const n = applyAttrs(document.createElementNS(SVG_NS, tag), attrs, true);
      append(n, children);
      return n;
    },
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a = 0, b = 1) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    rad: (deg) => (deg * Math.PI) / 180,
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
    nextFrame: () => new Promise((r) => requestAnimationFrame(() => r())),
    wait: (ms) => ZD.clock.wait(ms),
    fmtPct: (v) => `${Math.round(v * 100)}%`,
    once(target, type) {
      return new Promise((res) => target.addEventListener(type, res, { once: true }));
    },
  };

  /* A clock whose timeouts can be paused (pause menu) and resumed. */
  const timers = new Set();
  const clock = {
    paused: false,
    timeout(fn, ms) {
      const t = { fn, remaining: ms, start: performance.now(), id: null, done: false };
      const arm = () => {
        t.start = performance.now();
        t.id = setTimeout(() => {
          t.done = true;
          timers.delete(t);
          fn();
        }, t.remaining);
      };
      t.arm = arm;
      t.cancel = () => {
        if (t.id) clearTimeout(t.id);
        t.done = true;
        timers.delete(t);
      };
      timers.add(t);
      if (!clock.paused) arm();
      return t;
    },
    wait(ms) {
      return new Promise((res) => clock.timeout(res, ms));
    },
    pause() {
      if (clock.paused) return;
      clock.paused = true;
      const now = performance.now();
      timers.forEach((t) => {
        if (t.id) {
          clearTimeout(t.id);
          t.id = null;
          t.remaining = Math.max(0, t.remaining - (now - t.start));
        }
      });
      // anime.js drops paused instances from anime.running on the next frame,
      // so remember them here or resume() would never restart them
      if (window.anime) {
        clock.frozen = anime.running.slice();
        clock.frozen.forEach((a) => a.pause());
      }
      ZD.sprites && ZD.sprites.setPaused(true);
    },
    resume() {
      if (!clock.paused) return;
      clock.paused = false;
      timers.forEach((t) => {
        if (!t.id && !t.done) t.arm();
      });
      // (skip tweens that were deliberately stopped while paused: a._killed)
      if (window.anime) (clock.frozen || []).forEach((a) => !a.completed && !a._killed && a.play());
      clock.frozen = [];
      ZD.sprites && ZD.sprites.setPaused(false);
    },
    clearAll() {
      timers.forEach((t) => t.id && clearTimeout(t.id));
      timers.clear();
    },
  };

  const prefs = {
    get(k, def) {
      try {
        const v = localStorage.getItem('zd.' + k);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return def;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('zd.' + k, JSON.stringify(v));
      } catch (e) {
        /* private mode etc. */
      }
    },
  };

  ZD.util = util;
  ZD.clock = clock;
  ZD.prefs = prefs;
  ZD.T = window.T; // game-i18n (js/i18n.js is loaded first)
})();
