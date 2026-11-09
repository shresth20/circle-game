/* Performance diagnostics - off unless the page is opened with ?perf.
     ?perf          small panel (top-left): fps, frame time, dropped frames,
                    long tasks / long animation frames, layout shifts, JS
                    heap, the camera's current view and last event, image
                    decodes, and the worst frame of the last view swing
     ?perf=stress   the same, plus a repeated-transition stress test right
                    after loading (&n=20 sets the count): front <-> side
                    swings and every camera move of a wall, each measured;
                    the result is in the panel and in the console
   Console: ZD.perf.report() - one row per swing / camera move.
   Lifecycle marks (camera.prewarm / painted / swing / settled / cut,
   front.frame) are also User Timing marks, so they show in the "Timings"
   track of a Chrome DevTools Performance recording.
   What this can NOT see: missing GPU tiles (checkerboarding) and
   compositor-only frames - use tools/perf-lab.cjs (a Chrome trace) or
   DevTools > Rendering for those.  See README "Performance". */
window.ZD = window.ZD || {};

(function () {
  const params = new URLSearchParams(location.search);
  const mode = params.get('perf');
  const on = mode !== null;
  const T = (k, v) => ZD.T(k, v);

  const perf = {
    on,
    swings: [], // one entry per swing / camera move: worst frame, drops
    mark() {},
    decoded() {},
    report() {},
    stress() {},
  };
  ZD.perf = perf;
  if (!on) return;

  /* ---- frames ---- */
  let vsync = 1000 / 60;
  const recent = []; // last ~2 s of frame times (ms)
  let last = 0;
  let frames = 0;
  let drops = 0;
  let longFrames = 0; // > 50 ms
  let worst = 0;
  let seg = null; // the swing / camera move being measured
  const steps = [];
  function tick(t) {
    requestAnimationFrame(tick);
    if (last) {
      const dt = t - last;
      frames++;
      recent.push(dt);
      if (recent.length > 120) recent.shift();
      if (dt > 2 && dt < 50) {
        steps.push(dt);
        if (steps.length > 60) steps.shift();
        if (frames % 30 === 0) vsync = steps.slice().sort((a, b) => a - b)[steps.length >> 1];
      }
      const lost = dt > vsync * 1.5 ? Math.round(dt / vsync) - 1 : 0;
      drops += lost;
      if (dt > 50) longFrames++;
      worst = Math.max(worst, dt);
      if (seg) {
        seg.frames++;
        seg.drops += lost;
        seg.worst = Math.max(seg.worst, dt);
        if (seg.kind === 'swing') {
          const active = [...document.querySelectorAll('.scene.active')];
          if (active.some((node) => {
            const opacity = Number(getComputedStyle(node).opacity);
            return opacity > 0.02 && opacity < 0.98;
          })) seg.blendedFrames++;
        }
      }
    }
    last = t;
  }
  requestAnimationFrame(tick);

  let lastEvent = ''; // the latest lifecycle mark (what a long frame happened during)

  /* ---- long tasks, long animation frames, layout shifts ---- */
  let tasks = 0;
  let taskMs = 0;
  let loafs = 0;
  const loafWorst = [];
  let cls = 0;
  const shifts = []; // what moved: element, from -> to (stage px are scaled)
  const observe = (type, fn) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true });
    } catch (e) {
      /* not supported by this browser */
    }
  };
  observe('longtask', (e) => {
    tasks++;
    taskMs += e.duration;
  });
  observe('long-animation-frame', (e) => {
    loafs++;
    // where the time went: scripts (the slowest one named) vs style + layout
    const s = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
    const scriptMs = (e.scripts || []).reduce((t, x) => t + x.duration, 0);
    const styleLayoutMs = e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0;
    loafWorst.push({
      at: Math.round(e.startTime),
      ms: Math.round(e.duration),
      blocking: Math.round(e.blockingDuration || 0),
      scriptMs: Math.round(scriptMs),
      styleLayoutMs: Math.round(styleLayoutMs),
      script: s ? `${s.invoker || ''} ${s.sourceFunctionName || ''} ${s.sourceURL ? s.sourceURL.split('/').pop() : ''}:${s.sourceCharPosition}`.trim() : '',
      during: lastEvent,
    });
    loafWorst.sort((a, b) => b.ms - a.ms);
    loafWorst.length = Math.min(loafWorst.length, 8);
  });
  const describe = (n) => (n ? (n.id ? '#' + n.id : n.nodeName.toLowerCase()) + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).join('.') : '') : '?');
  observe('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    cls += e.value;
    (e.sources || []).forEach((s) => {
      if (shifts.length < 30) shifts.push({ at: Math.round(e.startTime), value: +e.value.toFixed(4), node: describe(s.node), from: `${Math.round(s.previousRect.x)},${Math.round(s.previousRect.y)}`, to: `${Math.round(s.currentRect.x)},${Math.round(s.currentRect.y)}` });
    });
  });

  /* ---- lifecycle ---- */
  let view = '';
  const log = [];
  perf.mark = (ev, detail = '') => {
    const now = performance.now();
    // (sprite sheet switches are frequent: trace + log only)
    if (ev !== 'sprite.sheet') lastEvent = `${ev} ${detail}`;
    log.push([Math.round(now), ev, detail]);
    if (log.length > 300) log.shift();
    try {
      performance.mark(`zd:${ev}:${detail}`);
    } catch (e) {}
    if (ev === 'camera.settled' || ev === 'camera.cut') view = detail;
    // a swing is measured from its first moving frame to the settled view;
    // a camera move (front.frame) until the next lifecycle event
    if (seg && (ev === 'camera.settled' || ev === 'front.frame' || ev === 'camera.cut')) {
      seg.ms = Math.round(now - seg.t0);
      perf.swings.push(seg);
      if (perf.swings.length > 200) perf.swings.shift();
      seg = null;
    }
    if (ev === 'camera.swing' || ev === 'front.frame') seg = { kind: ev === 'camera.swing' ? 'swing' : 'camera', to: detail, t0: now, ms: 0, frames: 0, drops: 0, worst: 0, blendedFrames: 0 };
  };

  /* ---- image decodes ---- */
  let decodes = 0;
  let slowDecode = { src: '', ms: 0 };
  perf.decoded = (src, ms) => {
    decodes++;
    if (ms > slowDecode.ms) slowDecode = { src: src.split('/').pop(), ms: Math.round(ms) };
  };

  /* ---- panel (outside the stage, plain text, refreshed twice a second) ---- */
  const panel = document.createElement('div');
  panel.className = 'perf-panel';
  let note = '';
  const r1 = (v) => Math.round(v * 10) / 10;
  function draw() {
    const fps = recent.length ? 1000 / (recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
    const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    const lastSwing = perf.swings.filter((s) => s.kind === 'swing').pop();
    const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : '-';
    const lines = [
      T('perfFps', { fps: Math.round(fps), avg: r1(avg), worst: Math.round(worst) }),
      T('perfDrops', { drops, long: longFrames }),
      T('perfTasks', { n: tasks, ms: Math.round(taskMs), loaf: loafs }),
      T('perfShift', { cls: cls.toFixed(3) }),
      T('perfHeap', { mb: heap }),
      T('perfView', { view: view || '-', event: lastEvent || '-' }),
      T('perfDecode', { n: decodes, ms: slowDecode.ms, src: slowDecode.src }),
    ];
    if (ZD.assets && ZD.assets.stats.failed.length) lines.push(T('perfFailed', { n: ZD.assets.stats.failed.length }));
    if (lastSwing) lines.push(T('perfLast', { worst: Math.round(lastSwing.worst), drops: lastSwing.drops }));
    if (note) lines.push(note);
    panel.textContent = lines.join('\n');
  }
  const start = () => {
    document.body.appendChild(panel);
    setInterval(draw, 500);
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);

  /* ---- report ---- */
  perf.report = () => {
    const rows = perf.swings.map((s) => ({ kind: s.kind, to: s.to, ms: s.ms, frames: s.frames, dropped: s.drops, blendedFrames: s.blendedFrames, worstFrameMs: Math.round(s.worst) }));
    console.table(rows);
    if (loafWorst.length) console.table(loafWorst);
    if (shifts.length) console.table(shifts);
    const sw = perf.swings.filter((s) => s.kind === 'swing');
    const out = {
      refreshMs: r1(vsync),
      frames,
      dropped: drops,
      longFrames,
      worstFrameMs: Math.round(worst),
      longTasks: tasks,
      longAnimationFrames: loafs,
      layoutShift: +cls.toFixed(3),
      swings: sw.length,
      swingWorstMs: Math.round(Math.max(0, ...sw.map((s) => s.worst))),
      swingDropped: sw.reduce((a, s) => a + s.drops, 0),
      swingBlendedFrames: sw.reduce((a, s) => a + s.blendedFrames, 0),
      decodes,
      slowestDecode: slowDecode,
      missingImages: ZD.assets ? ZD.assets.stats.failed : [],
      deviceProfile: ZD.device || null,
      worstLongFrames: loafWorst,
      timeOrigin: performance.timeOrigin, // epoch ms of performance.now() 0 (lines frames up with the log)
      layoutShifts: shifts,
      log,
    };
    console.log('[perf]', out);
    return out;
  };

  /* ---- repeated-transition stress test ----
     Takes the game over (reload to play): a clean first wall, then n
     rounds of what a wall does to the camera - prewarm the front view,
     swing to it, punch in (lock), pull back (wide), ride the throw
     (impact), prewarm the side view, swing back. */
  perf.stress = async (n = 10) => {
    const { camera, front, side } = ZD.scene;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    ZD.game.epoch++;
    ZD.clock.clearAll();
    // As the Play tap does: resume the graph that main.js primed behind the
    // welcome screen, so the first swing's sound never constructs it.
    ZD.audio.unlock();
    // leave the title the way the game does (intro.title): let the scene
    // paint under the opaque welcome picture first, then take it away
    document.querySelectorAll('.overlay.visible, .welcome-screen').forEach((o) => (o.style.opacity = '0.999'));
    await wait(400);
    document.querySelectorAll('.overlay, .welcome-screen').forEach((o) => {
      o.style.opacity = '';
      o.className = 'overlay';
      o.innerHTML = '';
    });
    ZD.game.resetAll();
    camera.cut('side');
    const t = ZD.geo.normalize({ type: 'sector', sweep: 100, start: -140 });
    side.setTarget(t);
    front.setTarget(t);
    perf.swings.length = 0;
    drops = 0;
    worst = 0;
    longFrames = 0;
    await wait(1500);
    for (let i = 0; i < n; i++) {
      note = T('perfStress', { i: i + 1, n });
      camera.prewarm('front', { shot: 'focus' });
      await wait(1500);
      await camera.to('front', { shot: 'focus' });
      await wait(800);
      await front.frame('lock', { duration: 300, easing: 'easeOutCubic' });
      await wait(200);
      await front.frame('wide', { duration: 690, easing: 'easeInOutCubic' });
      await front.frame('impact', { duration: 900, easing: 'easeInOutSine' });
      camera.prewarm('side');
      await wait(1200);
      await camera.to('side');
      await wait(800);
    }
    const r = perf.report();
    note = T('perfStressDone', { n: r.swings, worst: r.swingWorstMs, drops: r.swingDropped });
    return r;
  };
  if (mode === 'stress') {
    const go = () => (document.querySelector('.play-btn') ? perf.stress(+params.get('n') || 10) : setTimeout(go, 300));
    go();
  }
})();
