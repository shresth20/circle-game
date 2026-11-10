/* Motion system: every tween in the game is made here, with GSAP 3.13
   (bundled at js/libs/gsap.min.js - no CDN, works offline).  Rules:
   .claude/skills/animation_skill.md + motion_catalog_prompt.md.
     - transform / opacity only (+ stroke-dashoffset for lines that draw)
     - time-based: GSAP's ticker runs on requestAnimationFrame and smooths
       over a long hitch instead of jumping
     - ease-out to enter, ease-in to leave, back.out(1.2) at most for a pop
     - one place for every timing and easing: DUR / EASE / STAGGER for the
       UI, PHYS for world motion (characters, camera, projectile, debris).
       World durations are scene data in ms (`ms: D(520)`), run through
       ZD.scene.D like the clock's waits, so motion and waits stay in step
       with the sprite frames, sounds and read-aloud lines around them.
   No reduced-motion mode in this game: every animation always plays in
   full (the user's call, 2026-11-06).
   Layers: force3D 'auto' moves an element on its own GPU layer (translate3d)
   only while it tweens, then drops back to 2D - will-change for the
   animation only, as the skill asks.
   CSS transitions on a tweened element are held off while the tween runs:
   a CSS transition re-eases every frame GSAP writes, so the motion lags
   and lands late.
   Every maker returns the GSAP tween: `await` it (it is thenable - one
   awaiter per tween), or .kill() it. */
window.ZD = window.ZD || {};

(function () {
  gsap.config({ force3D: 'auto', nullTargetWarn: false });

  // UI (s) - motion_catalog_prompt.md (+ IDLE: one half-breath of an idle float)
  const DUR = { INSTANT: 0.08, FAST: 0.15, NORMAL: 0.25, SLOW: 0.4, REVEAL: 0.6, IDLE: 1.8 };
  const EASE = { OUT: 'power3.out', IN: 'power2.in', INOUT: 'power2.inOut', POP: 'back.out(1.2)', SNAP: 'expo.out' };
  const STAGGER = { UI: 0.05, STEP: 0.08 };
  // world motion: physical curves
  const PHYS = {
    LINEAR: 'none', // steady pace: walks, the timer, arcs whose maths does the easing
    ACCEL: 'power1.in', // speeds up: a charge, falling away
    DECEL: 'power1.out', // slows down: pushed back, drifting debris
    BURST: 'power2.out', // flies out fast and settles: sparks, rings
    GLIDE: 'sine.inOut', // soft start and stop: pans, runs, a sliding gate
    RAMP: 'sine.in', // gentle speed-up: run-up, throw
    WINDUP: 'back.in(1.7)', // pulls back before it goes: the zombie reels
  };
  // the rest value of each property enter() starts away from
  const REST = { opacity: 1, x: 0, y: 0, rotation: 0, scale: 1, scaleX: 1, scaleY: 1 };

  /* The CSS properties a tween drives (from its vars / from-vars). */
  const TRANSFORM_KEY = /^(x|y|z|xPercent|yPercent|rotation|rotate|rotationX|rotationY|rotationZ|scale|scaleX|scaleY|skewX|skewY|transform)$/;
  const cssName = (k) => (TRANSFORM_KEY.test(k) ? 'transform' : k === 'autoAlpha' ? 'opacity' : k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
  function drivenProps(...varsList) {
    const out = new Set();
    varsList.forEach((v) => {
      if (!v) return;
      Object.keys(v).forEach((k) => out.add(cssName(k)));
      if (v.keyframes && !Array.isArray(v.keyframes)) Object.keys(v.keyframes).forEach((k) => out.add(cssName(k)));
    });
    return out;
  }
  /* does a CSS transition on `el` run on one of `props`? */
  function transitionsOn(el, props) {
    const cs = getComputedStyle(el);
    const durs = cs.transitionDuration.split(',').map(parseFloat);
    return cs.transitionProperty.split(',').some((p, i) => {
      p = p.trim();
      return durs[i % durs.length] > 0 && (p === 'all' || props.has(p));
    });
  }

  /* Hold CSS transitions off the HTML elements in `targets` whose CSS
     transitions run on a property this tween drives (others - e.g. a
     class-driven opacity fade under a scale pulse - keep theirs); returns
     the release.  Counted per element, so overlapping tweens share a hold. */
  function holdTransitions(targets, props) {
    const els = gsap.utils.toArray(targets).filter((t) => t instanceof HTMLElement && (t._mHold || transitionsOn(t, props)));
    els.forEach((el) => {
      const h = el._mHold || (el._mHold = { n: 0, css: el.style.transition });
      if (!h.n++) el.style.transition = 'none';
    });
    let held = els.length > 0;
    return () => {
      if (!held) return;
      held = false;
      els.forEach((el) => {
        const h = el._mHold;
        if (h && !--h.n) {
          el.style.transition = h.css;
          el._mHold = null;
        }
      });
    };
  }

  /* GSAP vars + `ms` / `delayMs` (milliseconds) -> seconds; the hold is
     released when the tween completes or is killed. */
  function prep(targets, vars, from) {
    const v = Object.assign({}, vars);
    if (v.ms != null) {
      v.duration = v.ms / 1000;
      delete v.ms;
    }
    if (v.delayMs != null) {
      v.delay = v.delayMs / 1000;
      delete v.delayMs;
    }
    // (no will-change here: a tween that scales something up from small -
    // a pop, the game-over sign - would keep the small raster and look
    // pixelated: Chrome keeps a will-change: transform layer at the scale it
    // was first painted at.  force3D 'auto' already moves it on its own
    // layer while it tweens.)
    const release = holdTransitions(targets, drivenProps(v, from));
    const done = v.onComplete;
    const cut = v.onInterrupt;
    v.onComplete = function () {
      release();
      if (done) done.apply(this, arguments);
    };
    v.onInterrupt = function () {
      release();
      if (cut) cut.apply(this, arguments);
    };
    return v;
  }

  /* A CSS cubic-bezier(x1, y1, x2, y2) as a GSAP ease, so a tween can follow
     exactly the curve a Web Animation uses (the camera's CAM_EASE curves in
     js/scene.js).  Solves x(t) = p by Newton steps (bisection fallback). */
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    const X = (t) => ((ax * t + bx) * t + cx) * t;
    const Y = (t) => ((ay * t + by) * t + cy) * t;
    const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (p) => {
      if (p <= 0) return 0;
      if (p >= 1) return 1;
      let t = p;
      for (let i = 0; i < 8; i++) {
        const e = X(t) - p;
        if (Math.abs(e) < 1e-6) return Y(t);
        const d = dX(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      let lo = 0;
      let hi = 1;
      t = p;
      for (let i = 0; i < 30; i++) {
        if (X(t) < p) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
      return Y(t);
    };
  }

  const topLevel = () => gsap.globalTimeline.getChildren(false, true, true);
  const targetsOf = (a) => (a.targets ? a.targets() : a.getChildren(true, true, false).flatMap((t) => t.targets()));
  let frozen = [];

  const M = {
    DUR,
    EASE,
    STAGGER,
    PHYS,
    bezier,

    to: (targets, vars) => gsap.to(targets, prep(targets, vars)),
    fromTo: (targets, from, vars) => gsap.fromTo(targets, from, prep(targets, vars, from)),
    set: (targets, vars) => gsap.set(targets, vars),
    /* stop every tween on `targets` where it is (its promise never settles) */
    stop: (targets) => gsap.killTweensOf(targets),
    /* drop the inline styles GSAP wrote (the stylesheet takes over again) */
    clear: (targets, props = 'transform,opacity') => gsap.set(targets, { clearProps: props }),

    /* Appear: from `from` (opacity 0 plus any of x / y / rotation / scale)
       to rest, NORMAL, ease-out. */
    enter(targets, from, vars) {
      const f = Object.assign({ opacity: 0 }, from);
      const to = {};
      Object.keys(f).forEach((k) => (to[k] = REST[k]));
      return M.fromTo(targets, f, Object.assign(to, { duration: DUR.NORMAL, ease: EASE.OUT }, vars));
    },
    /* Appear with a slight overshoot (buttons, badges, signs). */
    pop(targets, from, vars) {
      return M.enter(targets, from, Object.assign({ ease: EASE.POP }, vars));
    },
    /* Disappear: fade (+ `to`), FAST, ease-in. */
    exit(targets, to, vars) {
      return M.to(targets, Object.assign({ opacity: 0 }, to, { duration: DUR.FAST, ease: EASE.IN }, vars));
    },
    /* Emphasis: scale 1 -> peak -> 1, once. */
    pulse(targets, peak = 1.04, vars) {
      return M.to(targets, Object.assign({ keyframes: { scale: [1, peak, 1], easeEach: EASE.INOUT }, duration: DUR.NORMAL }, vars));
    },
    /* Shake through `keys` ({ x: [...], y: [...], rotation: [...] }, each
       spread evenly over the time); each swing eases in and out like a
       real oscillation, the whole shake settles. */
    shake(targets, keys, vars) {
      return M.to(targets, Object.assign({ keyframes: Object.assign({ easeEach: PHYS.GLIDE }, keys), duration: DUR.SLOW }, vars));
    },

    /* Pause menu: every tween running now stops where it is; thaw() carries
       them on.  Tweens made while paused (the pause panel's) run as normal. */
    freeze() {
      frozen = frozen.concat(topLevel().filter((a) => !a.paused()));
      frozen.forEach((a) => a.pause());
    },
    thaw() {
      const list = frozen;
      frozen = [];
      // (skip tweens killed while paused: they have left the timeline)
      list.forEach((a) => a.parent && a.resume());
    },
    /* Reset: kill every tween except loops (their owners stop them) and
       those moving something inside a `keep` element (an overlay that
       fades the reset away). */
    stopAll({ keep = [] } = {}) {
      frozen = [];
      topLevel().forEach((a) => {
        if (a.repeat() === -1) return;
        if (keep.length && targetsOf(a).some((t) => t instanceof Node && keep.some((k) => k.contains(t)))) return;
        a.kill();
      });
    },
  };

  ZD.motion = M;
})();
