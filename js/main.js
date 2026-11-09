/* Boot: load locales, fit the 1920x1080 stage to the viewport, preload, start. */
/* Fit the stage right away (before locales load) so the loading screen -
   which is the welcome screen - shows at its final size from the first frame. */
function fitStage() {
  const stage = document.getElementById('stage');
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  const root = document.documentElement.style;
  root.setProperty('--s', s);
  /* Full-screen overlays (#grade, #vignette, #alarm-light, .go-shade) only
     cover what this screen shows of the stage (+ a margin for fx.shake),
     inside their design box 2560 x 1700 at (-320, -300).  Their gradients
     stay laid out on the design box (CSS), so the look is the same - the
     GPU just stops rasterising and blending off-screen area. */
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

async function boot() {
  const stage = document.getElementById('stage');
  const bar = document.querySelector('#loader .bar > div');
  try {
    await ZD.assets.preload((p) => {
      bar.style.transform = `scaleX(${p})`;
    });
  } catch (e) {
    console.error('preload failed', e);
  }

  ZD.scene.init(document.getElementById('world'));
  ZD.ui.init(stage);
  ZD.controls.init(stage);

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
  boot();
});
