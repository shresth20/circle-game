/* Deterministic side -> front transition capture.
   Usage:
     NODE_PATH=/path/to/node_modules node tools/transition-frames.cjs [output-dir]

   The transition is paused and sampled at every 60 Hz frame, so Playwright's
   screenshot cost cannot make it skip the one frame that contains a raster
   or compositing defect. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const output = process.argv[2] || '/private/tmp/circle-game-transition';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const viewport = {
  width: Number(process.env.CAPTURE_WIDTH || 1440),
  height: Number(process.env.CAPTURE_HEIGHT || 810),
};
const deviceScaleFactor = Number(process.env.CAPTURE_DPR || 1);

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync'],
  });
  const page = await browser.newPage({ viewport, deviceScaleFactor });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ZD && ZD.scene && ZD.scene.camera, null, { timeout: 120000 });

  await page.evaluate(() => {
    ZD.game.epoch++;
    ZD.clock.clearAll();
    ZD.audio.setMuted(true);
    document.querySelectorAll('.overlay, .welcome-screen').forEach((node) => {
      node.className = 'overlay';
      node.innerHTML = '';
    });
    ZD.scene.camera.cut('side');
  });

  await page.locator('#stage').screenshot({ path: path.join(output, 'frame-000.png') });
  await page.evaluate(() => {
    window.__transitionCapture = ZD.scene.camera.to('front', { duration: 820, shot: 'focus' });
  });
  await page.waitForFunction(() => ZD.scene.camera._swing && ZD.scene.camera._swing.length === 2);
  await page.evaluate(() => {
    ZD.scene.camera._swing.forEach((animation) => animation.pause());
    if (ZD.scene.front._camAnims) ZD.scene.front._camAnims.forEach((animation) => animation.pause());
  });

  const duration = 820;
  const total = duration;
  const frameMs = 1000 / 60;
  const samples = [];
  let frame = 1;
  for (let time = 0; time <= total + 0.1; time += frameMs, frame++) {
    const sample = await page.evaluate((time) => {
      ZD.scene.camera._swing.forEach((animation) => (animation.currentTime = time));
      if (ZD.scene.front._camAnims) ZD.scene.front._camAnims.forEach((animation) => (animation.currentTime = time));
      const front = getComputedStyle(ZD.scene.front.el);
      const side = getComputedStyle(ZD.scene.side.el);
      const rig = getComputedStyle(ZD.scene.front.rig);
      return {
        time,
        frontOpacity: front.opacity,
        frontTransform: front.transform,
        sideOpacity: side.opacity,
        sideTransform: side.transform,
        rigTransform: rig.transform,
      };
    }, time);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const number = String(frame).padStart(3, '0');
    await page.locator('#stage').screenshot({ path: path.join(output, `frame-${number}.png`) });
    samples.push(sample);
  }

  const settled = await page.evaluate(async () => {
    const swing = ZD.scene.camera._swing || [];
    swing.forEach((animation) => animation.play());
    await window.__transitionCapture;
    return {
      current: ZD.scene.camera.current,
      active: [...document.querySelectorAll('.scene.active')].map((node) => node.id),
      frontWillChange: ZD.scene.front.el.style.willChange,
      sideWillChange: ZD.scene.side.el.style.willChange,
      rigWillChange: ZD.scene.front.rig.style.willChange,
      frontTransform: getComputedStyle(ZD.scene.front.el).transform,
    };
  });
  fs.writeFileSync(path.join(output, 'samples.json'), JSON.stringify({ errors, settled, samples }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ output, viewport, deviceScaleFactor, frames: frame, errors }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
