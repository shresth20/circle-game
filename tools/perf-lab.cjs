/* Rendering lab: what the GPU actually did during the game's transitions.

   Screenshots can't show flicker: a screenshot waits for every tile to be
   painted, so it never catches the frames where a layer is missing.  This
   tool records a Chrome trace instead and reads the compositor's own
   per-frame verdicts:
     checkerboard   frames drawn with tiles still missing (the flicker)
     dropped        frames the compositor could not produce in time
     RS             offscreen passes per frame ("render surfaces": a CSS
                    filter / clip-path / blend on a GPU layer, group opacity)
     raster         tile paints (each view swing re-paints the new view)
     tileMB         GPU memory held by painted tiles
   split by the game's lifecycle marks (zd:camera.swing, zd:front.frame ...,
   from js/core/perf.js).

   Usage (playwright-core must be resolvable, e.g. NODE_PATH=.../node_modules):
     node tools/perf-lab.cjs [--scenario stress|intro] [--rounds 3]
          [--browser edge|chrome|<path>] [--viewport 1272x719] [--dpr 2]
          [--headed] [--frames <dir>] [--out <dir>] [--strict]
   stress (default): ZD.perf.stress(rounds) - prewarm, swing to the front
     view, lock / wide / impact camera moves, swing back - repeated.
   intro: taps Play and records the whole cinematic (both outcomes).
   game: the whole mission hands-free (intro skipped, every wall answered,
     one wrong answer on wall --wrong N (default 3) for the game-over ->
     Replay path, run-and-jump by keyboard, the Safe Zone finale).
   --frames saves every composited frame (CDP screencast) as JPEG.
   --cpu 6 slows the main thread 6x (budget tablet CPU); a K10 screen is
     --viewport 1280x800 --dpr 1.5. --low-power also selects the runtime's
     2 GB / 4-core adaptive profile. The GPU itself can't be emulated.
   --strict exits 1 if any frame was drawn with missing tiles.
   The defaults are a 13" MacBook Air (1280x832 desktop) browser window.
   The trace is GPU-real only with a real GPU: headless Chrome/Edge on a Mac
   uses Metal (checked and printed); in a VM it falls back to software. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i < 0 ? d : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};
const BROWSERS = {
  edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
};
const browserPath = BROWSERS[opt('browser', 'edge')] || opt('browser');
const [W, H] = String(opt('viewport', '1272x719')).split('x').map(Number);
const DPR = Number(opt('dpr', 2));
const scenario = opt('scenario', 'stress');
const rounds = Number(opt('rounds', 3));
const framesDir = opt('frames', null);
const outDir = opt('out', null);
const root = path.resolve(__dirname, '..');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.webm': 'audio/webm', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise((res) => {
    const server = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root)) return rsp.writeHead(403), rsp.end();
      fs.readFile(f, (e, d) => {
        if (e) return rsp.writeHead(404), rsp.end();
        rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
        rsp.end(d);
      });
    });
    server.listen(0, '127.0.0.1', () => res(server));
  });
}

/* the trace -> one row per lifecycle phase */
function analyse(events) {
  const rp = (() => {
    const c = {};
    events.forEach((e) => e.name === 'DidPrepareTiles' && (c[e.pid] = (c[e.pid] || 0) + 1));
    return +Object.keys(c).sort((a, b) => c[b] - c[a])[0];
  })();
  const marks = events
    .filter((e) => e.name.startsWith('zd:') && (e.ph === 'R' || e.ph === 'I' || e.ph === 'n' || e.ph === 'b'))
    .map((e) => ({ ts: e.ts, name: e.name.slice(3) }))
    .sort((a, b) => a.ts - b.ts)
    // one phase per change of state (prewarm / painted / swing / settled / camera move)
    .filter((m) => /^(camera\.(prepare|prepared|prewarm|painted|swing|settled|cut)|front\.frame):/.test(m.name));
  const phaseOf = (ts) => {
    let lo = -1;
    for (let i = 0; i < marks.length && marks[i].ts <= ts; i++) lo = i;
    return lo;
  };
  const rows = marks.map((m) => ({ phase: m.name.replace(/:$/, ''), raster: 0, checkerboard: 0, dropped: 0, rsMax: 0, tileMB: 0 }));
  const pre = { phase: '(before first mark)', raster: 0, checkerboard: 0, dropped: 0, rsMax: 0, tileMB: 0 };
  const row = (ts) => rows[phaseOf(ts)] || pre;
  for (const e of events) {
    if (e.pid !== rp) continue;
    if (e.name === 'RasterTask' && e.ph === 'X') row(e.ts).raster++;
    else if (e.name === 'PipelineReporter' && e.ph === 'b') {
      const f = e.args.frame_reporter || {};
      if (f.checkerboarded_needs_raster || f.has_missing_content) row(e.ts).checkerboard++;
      if (f.state === 'STATE_DROPPED') row(e.ts).dropped++;
    } else if (e.name === 'LayerTreeHostImpl::CalculateRenderPasses' && e.args && 'render_surface_list_size()' in e.args) {
      const r = row(e.ts);
      r.rsMax = Math.max(r.rsMax, e.args['render_surface_list_size()']);
    } else if (e.ph === 'v' && e.args && e.args.dumps && e.args.dumps.allocators) {
      let tot = 0;
      for (const [k, v] of Object.entries(e.args.dumps.allocators)) {
        if (k.startsWith('cc/tile_memory') && k.split('/').length === 2 && v.attrs && v.attrs.size) tot += parseInt(v.attrs.size.value, 16);
      }
      if (tot) {
        const r = row(e.ts);
        r.tileMB = Math.max(r.tileMB, Math.round(tot / 1048576));
      }
    }
  }
  const all = [pre, ...rows].filter((r) => r.raster || r.checkerboard || r.dropped || r.rsMax || r.phase !== pre.phase);
  const sum = (k) => all.reduce((a, r) => a + r[k], 0);
  return { rows: all, totals: { checkerboard: sum('checkerboard'), dropped: sum('dropped'), raster: sum('raster'), rsMax: Math.max(...all.map((r) => r.rsMax)), tileMB: Math.max(...all.map((r) => r.tileMB)) } };
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: !opt('headed', false),
    args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  if (opt('low-power', false)) {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 2 });
      Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 4 });
    });
  }
  const gpuPage = await ctx.newPage();
  await gpuPage.goto('chrome://gpu');
  await gpuPage.waitForTimeout(1200);
  const gpu = await gpuPage.evaluate(() => {
    const t = ((document.querySelector('info-view') || {}).shadowRoot || document.body).textContent || '';
    const m = /Rasterization:\s*([^*\n]+)/.exec(t);
    return m ? m[1].trim() : 'unknown';
  });
  await gpuPage.close();

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await ctx.newCDPSession(page);
  // --cpu N: main thread N x slower (a budget tablet's CPU; the GPU can't be emulated)
  if (opt('cpu', null)) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(opt('cpu', 1)) });
  await page.goto(`http://127.0.0.1:${port}/index.html?perf`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.play-btn', { timeout: 120000 });
  const boot = await page.evaluate(() => {
    const bytes = new Map();
    Object.values(ZD.assets.manifest.images).forEach((a) => bytes.set(a.src, a.w * a.h * 4));
    Object.values(ZD.assets.manifest.walls).forEach((a) => bytes.set(a.src, a.w * a.h * 4));
    Object.values(ZD.assets.manifest.sprites).forEach((a) => bytes.set(a.src, a.fw * a.cols * a.fh * a.rows * 4));
    const sum = (list) => [...new Set(list)].reduce((n, src) => n + (bytes.get(src) || 0), 0);
    const camera = ZD.scene.camera;
    return {
      readyMs: Math.round(performance.now()),
      loadedFiles: ZD.assets.stats.loaded,
      bootDecodes: ZD.assets.stats.decodes,
      decodeConcurrency: ZD.assets.stats.decodeConcurrency,
      potentialDecodedMB: Math.round(sum([...bytes.keys()]) / 1048576),
      sideViewDecodedMB: Math.round(sum(camera._images('side')) / 1048576),
      frontViewDecodedMB: Math.round(sum(camera._images('front')) / 1048576),
      device: ZD.device,
    };
  });
  await page.waitForTimeout(800);

  const events = [];
  cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
  const traceDone = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', {
    traceConfig: {
      includedCategories: ['cc', 'benchmark', 'blink.user_timing', 'disabled-by-default-memory-infra'],
      memoryDumpConfig: { triggers: [{ mode: 'light', periodicIntervalMs: 500 }] },
      traceBufferSizeInKb: 1000000,
    },
  });
  let nFrames = 0;
  if (framesDir) {
    fs.mkdirSync(framesDir, { recursive: true });
    cdp.on('Page.screencastFrame', (f) => {
      fs.writeFileSync(path.join(framesDir, `f${String(nFrames++).padStart(5, '0')}-${Math.round(f.metadata.timestamp * 1000)}.jpg`), Buffer.from(f.data, 'base64'));
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: W, maxHeight: H });
  }

  let pagePerf = null;
  if (scenario === 'game') {
    // the whole mission, hands-free: skip the intro, answer every wall
    // (one wrong answer on wall `--wrong`, default 3, to play the game
    // over -> Replay path), run and jump with the keyboard, to the finale
    const wrongAt = Number(opt('wrong', 3));
    await page.evaluate((wrongAt) => {
      const ask = ZD.ui.ask.bind(ZD.ui);
      let n = 0;
      ZD.ui.ask = (id) => {
        const p = ask(id);
        if (!document.getElementById('stage').classList.contains('intro-on')) {
          n++;
          const pick = n === wrongAt ? Object.keys(ZD.ui.answerBtns).find((k) => k !== id) : id;
          setTimeout(() => ZD.ui._pick(pick), 1200);
        }
        return p;
      };
    }, wrongAt);
    await page.click('.play-btn');
    await page.waitForSelector('.skip', { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.click('.skip');
    let running = false;
    const end = Date.now() + 420000;
    while (Date.now() < end) {
      const s = await page.evaluate(() => ({
        controls: !!document.querySelector('#controls.visible'),
        jump: !!document.querySelector('.ctrl-btn.jump.hint'),
        retry: !!document.querySelector('.go-retry'),
        done: !!document.querySelector('#complete.visible'),
      }));
      if (s.done) break;
      if (s.retry) await page.click('.go-retry').catch(() => {});
      if (s.controls && !running) await page.keyboard.down('ArrowRight'), (running = true);
      if (!s.controls && running) await page.keyboard.up('ArrowRight'), (running = false);
      if (s.jump) await page.keyboard.press('Space');
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1000);
    pagePerf = await page.evaluate(() => Object.assign(ZD.perf.report(), { completed: !!document.querySelector('#complete.visible') }));
  } else if (scenario === 'intro') {
    await page.click('.play-btn');
    const end = Date.now() + 120000;
    while (Date.now() < end && !(await page.$('.btn.start'))) await page.waitForTimeout(500);
    await page.waitForTimeout(1000);
    pagePerf = await page.evaluate(() => ZD.perf.report());
  } else {
    pagePerf = await page.evaluate((n) => ZD.perf.stress(n), rounds);
  }
  if (framesDir) await cdp.send('Page.stopScreencast');
  await cdp.send('Tracing.end');
  await traceDone;
  await browser.close();
  server.close();

  const { rows, totals } = analyse(events);
  console.log(`browser ${path.basename(browserPath)} - raster: ${gpu} - viewport ${W}x${H}@${DPR}${opt('cpu', null) ? ' - cpu /' + opt('cpu') : ''}${opt('low-power', false) ? ' - low-power profile' : ''} - scenario ${scenario}${scenario === 'stress' ? ' x' + rounds : ''}`);
  console.table(rows);
  console.log('totals', totals);
  console.log('boot/assets', boot);
  if (pagePerf) {
    const { log, ...p } = pagePerf;
    console.log('in-page (rAF) frames:', p);
  }
  if (errors.length) console.log('page errors:', errors);
  if (framesDir) console.log(`${nFrames} composited frames saved in ${framesDir}`);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ gpu, viewport: [W, H, DPR], scenario, boot, rows, totals, pagePerf, errors }, null, 1));
    // streamed: a whole game is millions of events (memory dumps are MBs
    // each), far too long for one JSON string - flushed every ~32 MB
    const fd = fs.openSync(path.join(outDir, 'trace.json'), 'w');
    fs.writeSync(fd, '{"traceEvents":[');
    let buf = '';
    events.forEach((e, i) => {
      buf += (i ? ',' : '') + JSON.stringify(e);
      if (buf.length > 32e6) {
        fs.writeSync(fd, buf);
        buf = '';
      }
    });
    fs.writeSync(fd, buf + ']}');
    fs.closeSync(fd);
    console.log('trace + summary in', outDir, '(open trace.json in chrome://tracing or ui.perfetto.dev)');
  }
  const strictFailure =
    totals.checkerboard > 0 ||
    errors.length > 0 ||
    (pagePerf && (pagePerf.swingDropped > 0 || pagePerf.swingBlendedFrames > 0 || pagePerf.missingImages.length > 0)) ||
    (scenario === 'game' && pagePerf && !pagePerf.completed);
  if (opt('strict', false) && strictFailure) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
