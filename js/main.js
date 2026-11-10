/* Boot: load locales, fit the 1920x1080 stage to the viewport, preload, start. */
/* Fit the stage right away (before locales load) so the loading screen -
   which is the welcome screen - shows at its final size from the first frame. */
let paintedScale = 0; // the stage scale the GPU layers were painted at
let repaintTimer = 0;
function fitStage() {
  const stage = document.getElementById('stage');
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  /* The camera rig, the sprites and other small movers keep will-change:
     transform, and Chrome keeps such a layer at the scale it was first painted at:
     after the window grows (or a tablet turns) the game would stay blurred,
     after it shrinks it would hold oversized tiles.  Once the size settles,
     every layer is painted again at the new scale (ZD.scene.repaint). */
  if (!paintedScale) paintedScale = s;
  else if (Math.abs(s / paintedScale - 1) > 0.02) {
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(() => {
      paintedScale = s;
      if (ZD.scene && ZD.scene.repaint) ZD.scene.repaint();
    }, 300);
  }
  const root = document.documentElement.style;
  root.setProperty('--s', s);
  /* The game-over shade (.go-shade) only covers what this screen shows of
     the stage (+ a margin for fx.shake), inside its design box 2560 x 1700
     at (-320, -300).  Its gradient stays laid out on the design box (CSS),
     so the look is the same - the GPU just stops rasterising and blending
     off-screen area.  (The other full-screen gradients are small canvases:
     paintWashes in js/scene.js.) */
  const M = 24;
  const l = Math.max(-320, Math.floor(960 - window.innerWidth / (2 * s)) - M);
  const t = Math.max(-300, Math.floor(540 - window.innerHeight / (2 * s)) - M);
  root.setProperty('--ov-l', l + 'px');
  root.setProperty('--ov-t', t + 'px');
  root.setProperty('--ov-w', Math.min(2240, 1920 - l) - l + 'px');
  root.setProperty('--ov-h', Math.min(1400, 1080 - t) - t + 'px');
}
window.addEventListener('resize', fitStage);
window.addEventListener('orientationchange', () => setTimeout(fitStage, 200));
fitStage();

/* The loading screen: bar + one status line.  Downloads take the bar to
   90 %, decoding the first view the last 10 %.  The line shows the
   percentage, and says so when the network is slow or gone, so a learner on
   a phone can see the game is not stuck.  Text waits for the locales. */
const loading = (() => {
  const bar = document.querySelector('#loader .bar > div');
  const text = document.querySelector('#loader .loader-text');
  let shown = '';
  let p = 0;
  let status = '';
  let ready = false;
  let failed = false;
  let queued = false;
  const draw = () => {
    queued = false;
    if (bar) bar.style.transform = `scaleX(${p})`;
    if (!ready || !text) return;
    if (failed) {
      text.textContent = T('appLoadFailed');
      return;
    }
    const pct = Math.floor(p * 100);
    const line = status === 'offline' ? T('appOffline') : T(status === 'slow' ? 'appLoadingSlow' : 'appLoadingPct', { pct });
    if (line !== shown) text.textContent = shown = line;
  };
  return {
    // progress arrives per received chunk; the screen is updated once a frame
    set(fraction, net) {
      p = Math.max(p, fraction); // never runs backwards
      status = net || '';
      if (!queued) {
        queued = true;
        requestAnimationFrame(draw);
      }
    },
    ready() {
      ready = true;
      draw();
    },
    fail() {
      failed = true;
      ready = true;
      draw();
    },
  };
})();

/* Start downloading now, in parallel with the locales - not after them. */
const preloading = ZD.assets.preload((f, net) => loading.set(f * 0.9, net));
preloading.catch(() => {}); // (handled in boot, which may await it later)

async function boot() {
  const stage = document.getElementById('stage');
  try {
    await preloading;
  } catch (e) {
    // Never enter gameplay with a known-missing background or character.
    // The loader remains visible with a useful localized failure message.
    console.error('preload failed', e);
    loading.fail();
    return;
  }
  // The welcome picture is a CSS background by path (so the loading screen
  // has it at once).  If that request of the page's (<link rel=preload> /
  // stylesheet) never finished - a phone can lose one - draw the
  // preloader's downloaded copy instead.  Resource timing lists a request
  // only once it has finished; the preloader's own fetch is left out.
  const welcomePath = new URL(ZD.assets.url('') + ZD.assets.image('roadPersp').src, document.baseURI).href;
  const welcomeShown = performance.getEntriesByName(welcomePath).some((e) => e.initiatorType !== 'fetch' && e.responseEnd > 0);
  const welcomeCopy = ZD.assets.imageUrl('roadPersp');
  if (!welcomeShown && welcomeCopy.startsWith('blob:')) document.documentElement.style.setProperty('--welcome-bg', `url("${welcomeCopy}")`);

  ZD.scene.init(document.getElementById('world'));
  ZD.ui.init(stage);
  ZD.controls.init(stage);
  // Decode only the initial side view now. The front view and later sprite
  // sheets are decoded by camera.prewarm / primeSheets before they appear.
  await ZD.scene.camera.prepareCurrent((f) => loading.set(0.9 + 0.1 * f));
  loading.set(1);
  // AudioContext construction is expensive on some tablets; create the
  // suspended graph under the loading screen, then unlock it on the gesture.
  ZD.audio.prime();

  // the loader is the welcome screen: ZD.intro.title() swaps it for the real
  // one (identical layout) and brings in the play button

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') ZD.game.togglePause();
    if (e.key === 'm') {
      ZD.audio.setMuted(!ZD.audio.muted);
      ZD.ui._syncMute();
    }
  });
  // No sound while the learner is away: tab hidden, app backgrounded, or the
  // window lost focus. Hidden also pauses the game.
  const syncActive = () => ZD.audio.setActive(!document.hidden && document.hasFocus());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !ZD.game.paused) ZD.game.togglePause();
    syncActive();
  });
  window.addEventListener('blur', syncActive);
  window.addEventListener('focus', syncActive);
  window.addEventListener('pagehide', () => ZD.audio.setActive(false));
  window.addEventListener('pageshow', syncActive);
  // keep the audio context alive after the first gesture on iOS
  window.addEventListener('pointerdown', () => ZD.audio.unlock(), { once: true });

  ZD.game.run();
}

I18n.load(() => {
  I18n.applyStatic();
  loading.ready();
  boot();
});
