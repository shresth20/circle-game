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
   --gpu-mem 128 caps the GPU tile budget the way Chrome on a budget Android
     tablet does (desktop Chrome allows 512 MB, Android 2-3 GB devices
     ~128-256 MB): the late-game flicker only shows when the budget is
     short. --raster-scale reads Chrome's per-frame layer snapshots:
     holeFrames (visible tiles not painted), pixelatedFrames (layers painted
     below the scale they are shown at - not counted as "checkerboard"),
     softFrames (stand-in tiles), nowMB (tile memory the screen needs now:
     keep it well under the budget) and the worst layers; the game scenario
     prints a per-wall table (the trace restarts at every wall, so a whole
     game fits Chrome's trace buffer). The K10 run:
       --scenario game --raster-scale --gpu-mem 128 --low-power
       --viewport 1280x800 --dpr 1.5
     --layers samples the GPU layer tree (count, area) at every settled
     view, wall by wall; --layers-detail lists the biggest layers with why
     Chrome made them; --until-wall N stops the game scenario at wall N.
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

/* --raster-scale: Chrome's per-frame layer snapshot (cc.debug), boiled
   down as it arrives (a whole game of snapshots is gigabytes):
     lowRes    visible layers whose best raster is below the scale they are
               drawn at (blurred / pixelated for as long as it lasts)
     missing   visible tiles needed now that have no paint yet (holes)
     nonIdeal  visible tiles drawn from a tiling of another scale (a stand-in
               while the right one is painted: blurred or soft)
     layers / layerMB   the layer count and GPU memory the tree holds */
const layerLabel = (l) => (l.layer_name || '?').replace(/^Layout\w+ \([^)]*\) /, '').replace(/^DIV /, '').slice(0, 64) + ` ${l.bounds ? l.bounds.width + 'x' + l.bounds.height : ''}`;
let dumped = 0;
const layerNames = new Map(); // cc layer id -> label (raster tasks name only the id)
function boilSnapshot(snap) {
  if (opt('dump', false) && !opt('dump-hole', false) && !dumped && (snap.active_tree.layers || []).length > 60) {
    dumped = 1;
    fs.writeFileSync(opt('dump'), JSON.stringify(snap));
  }
  const layers = (snap.active_tree && snap.active_tree.layers) || [];
  const byId = {};
  const out = { layers: layers.length, layerMB: 0, nowMB: 0, lowRes: [], missing: {}, nonIdeal: {} };
  let now = 0;
  let mem = 0;
  for (const l of layers) {
    byId[l.layer_id] = l;
    if (!layerNames.has(l.layer_id)) layerNames.set(l.layer_id, layerLabel(l));
    mem += l.gpu_memory_usage || 0;
    const v = l.visible_rect;
    if (!l.tilings || !l.draws_content || !v || !v[2] || !v[3]) continue;
    if (l.geometry_contents_scale < l.ideal_contents_scale * 0.9) out.lowRes.push(`${layerLabel(l)} raster ${l.geometry_contents_scale.toFixed(2)} < ${l.ideal_contents_scale.toFixed(2)}`);
  }
  out.layerMB = Math.round(mem / 1048576);
  // the biggest GPU users in this frame (label, MB[, reasons, MB on screen now])
  const nowBy = {};
  for (const t of snap.active_tiles || []) {
    const p = t.combined_priority || {};
    if (p.priority_bin !== 'NOW' || p.distance_to_visible !== 0 || p.is_occluded) continue;
    if (t.draw_info && (t.draw_info.is_solid_color || t.draw_info.is_transparent)) continue;
    nowBy[t.layer_id] = (nowBy[t.layer_id] || 0) + (t.content_rect ? t.content_rect[2] * t.content_rect[3] * 4 : 0);
  }
  out.top = layers
    .filter((l) => l.gpu_memory_usage > 1048576)
    .sort((a, b) => b.gpu_memory_usage - a.gpu_memory_usage)
    .slice(0, opt('layers-detail', false) ? 60 : 12)
    .map((l) => [layerLabel(l), Math.round(l.gpu_memory_usage / 104857.6) / 10].concat(opt('layers-detail', false) ? [(l.compositing_reasons || []).join('; ').slice(0, 70), Math.round((nowBy[l.layer_id] || 0) / 104857.6) / 10] : []));
  for (const t of snap.active_tiles || []) {
    const p = t.combined_priority || {};
    if (p.priority_bin !== 'NOW' || p.distance_to_visible !== 0 || p.is_occluded) continue;
    if (t.draw_info && (t.draw_info.is_solid_color || t.draw_info.is_transparent)) continue;
    // what the frame needs painted: tiles on screen now (budget-independent)
    now += t.has_resource && t.gpu_memory_usage ? t.gpu_memory_usage : t.content_rect ? t.content_rect[2] * t.content_rect[3] * 4 : 0;
    const l = byId[t.layer_id];
    const k = l ? layerLabel(l) : '?';
    if (!t.has_resource) {
      out.missing[k] = (out.missing[k] || 0) + 1;
      // --dump-hole <regex>: save the first snapshot where such a layer has a hole
      if (opt('dump-hole', false) && !dumped && new RegExp(opt('dump-hole')).test(k)) {
        dumped = 1;
        fs.writeFileSync(opt('dump'), JSON.stringify(Object.assign({ holeLayer: t.layer_id }, snap)));
      }
    }
    else if (t.resolution !== 'HIGH_RESOLUTION') out.nonIdeal[k] = (out.nonIdeal[k] || 0) + 1;
  }
  out.nowMB = Math.round(now / 1048576);
  return out;
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
    // one phase per change of state (prewarm / painted / swing / settled /
    // camera move); `wall:N` marks (game scenario) label the phases after them
    .filter((m) => /^(camera\.(prepare|prepared|prewarm|painted|swing|settled|cut)|front\.frame|wall):/.test(m.name));
  const phaseOf = (ts) => {
    let lo = -1;
    for (let i = 0; i < marks.length && marks[i].ts <= ts; i++) lo = i;
    return lo;
  };
  let wall = '';
  const blank = () => ({ raster: 0, checkerboard: 0, dropped: 0, rsMax: 0, tileMB: 0, nowMB: 0, lowResFrames: 0, holeFrames: 0, softFrames: 0, layersMax: 0, layerMB: 0 });
  const worstOf = {}; // phase -> layer label -> frames (lowRes / missing / nonIdeal)
  const heaviest = {}; // phase -> biggest layers in its heaviest frame
  const rasterBy = {}; // phase -> layer -> raster tasks (what keeps being painted)
  const blame = (phase, kind, label) => {
    const w = (worstOf[phase] = worstOf[phase] || {});
    const k = kind + ' ' + label;
    w[k] = (w[k] || 0) + 1;
  };
  const rows = marks.map((m) => {
    if (m.name.startsWith('wall:')) wall = 'w' + m.name.slice(5) + ' ';
    return Object.assign({ phase: wall + m.name.replace(/:$/, '') }, blank());
  });
  const pre = Object.assign({ phase: '(before first mark)' }, blank());
  const row = (ts) => rows[phaseOf(ts)] || pre;
  for (const e of events) {
    if (e.pid !== rp) continue;
    if (e.name === 'RasterTask' && e.ph === 'X') {
      const r = row(e.ts);
      r.raster++;
      const id = e.args && e.args.tileData && e.args.tileData.layerId;
      if (id != null) {
        const w = (rasterBy[r.phase] = rasterBy[r.phase] || {});
        const k = layerNames.get(id) || 'layer ' + id;
        w[k] = (w[k] || 0) + 1;
      }
    }
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
    } else if (e.name === 'LayerTreeHostImpl:snapshot' && e.args && e.args.boiled) {
      const b = e.args.boiled;
      const r = row(e.ts);
      r.layersMax = Math.max(r.layersMax, b.layers);
      r.nowMB = Math.max(r.nowMB, b.nowMB);
      if (b.layerMB > r.layerMB) heaviest[r.phase] = b.top;
      r.layerMB = Math.max(r.layerMB, b.layerMB);
      if (b.lowRes.length) r.lowResFrames++;
      if (Object.keys(b.missing).length) r.holeFrames++;
      if (Object.keys(b.nonIdeal).length) r.softFrames++;
      b.lowRes.forEach((l) => blame(r.phase, 'pixelated', l));
      Object.keys(b.missing).forEach((l) => blame(r.phase, 'hole', l));
      Object.keys(b.nonIdeal).forEach((l) => blame(r.phase, 'soft', l));
    }
  }
  const all = [pre, ...rows].filter((r) => r.raster || r.checkerboard || r.dropped || r.rsMax || r.lowResFrames || r.holeFrames || r.phase !== pre.phase);
  const sum = (k) => all.reduce((a, r) => a + r[k], 0);
  const max = (k) => Math.max(...all.map((r) => r[k]));
  // the layers to blame, worst first, per kind (phase: kind layer x frames)
  const all3 = Object.entries(worstOf).flatMap(([phase, w]) => Object.entries(w).map(([k, n]) => ({ phase, layer: k, frames: n })));
  const culprits = ['pixelated', 'hole', 'soft'].flatMap((kind) =>
    all3
      .filter((c) => c.layer.startsWith(kind + ' '))
      .sort((a, b) => b.frames - a.frames)
      .slice(0, 12)
  );
  const rasterTop = Object.fromEntries(Object.entries(rasterBy).map(([ph, w]) => [ph, Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 10)]));
  return { rows: all, culprits, heaviest, rasterTop, totals: { checkerboard: sum('checkerboard'), dropped: sum('dropped'), raster: sum('raster'), pixelatedFrames: sum('lowResFrames'), holeFrames: sum('holeFrames'), softFrames: sum('softFrames'), layersMax: max('layersMax'), layerMB: max('layerMB'), nowMB: max('nowMB'), rsMax: max('rsMax'), tileMB: max('tileMB') } };
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: !opt('headed', false),
    args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'].concat(opt('gpu-mem', null) ? [`--force-gpu-mem-available-mb=${opt('gpu-mem')}`] : [])
      // the compositor rasters at the real device scale only with this flag
      // (the context's deviceScaleFactor alone left the trace at 1x)
      .concat([`--force-device-scale-factor=${DPR}`]),
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
  cdp.on('Tracing.dataCollected', (e) => {
    for (const ev of e.value) {
      if (ev.name === 'LayerTreeHostImpl:snapshot') {
        if (ev.ph !== 'I' || !ev.args || !ev.args.snapshot) continue;
        ev.args = { boiled: boilSnapshot(ev.args.snapshot) };
      } else if (/cc\.debug/.test(ev.cat || '') && ev.name !== 'RasterTask') continue; // only the snapshots are wanted
      events.push(ev);
    }
  });
  /* The trace is taken in segments (a new one at every wall, see the game
     scenario): with --raster-scale a whole game of layer snapshots would
     overflow Chrome's trace buffer by wall 3. */
  let traceDone = null;
  const startTrace = async () => {
    traceDone = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.start', {
      traceConfig: {
        includedCategories: ['cc', 'benchmark', 'blink.user_timing', 'disabled-by-default-memory-infra'].concat(opt('raster-scale', false) ? ['disabled-by-default-cc.debug'] : []),
        memoryDumpConfig: { triggers: [{ mode: 'light', periodicIntervalMs: 500 }] },
        traceBufferSizeInKb: 1000000,
      },
    });
  };
  const stopTrace = async () => {
    await cdp.send('Tracing.end');
    await traceDone;
  };
  await startTrace();
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
  /* --layers: the GPU layer tree (CDP LayerTree), sampled at every settled
     view: how many layers, how much area (device px) they cover, the biggest */
  const layerSamples = [];
  let layerTree = [];
  if (opt('layers', false)) {
    await cdp.send('DOM.enable');
    await cdp.send('LayerTree.enable');
    cdp.on('LayerTree.layerTreeDidChange', (e) => e.layers && (layerTree = e.layers));
  }
  const sampleLayers = async (label) => {
    if (!opt('layers', false)) return;
    const drawn = layerTree.filter((l) => l.drawsContent && !l.invisible);
    const area = (l) => l.width * l.height * DPR * DPR;
    const top = drawn.slice().sort((a, b) => area(b) - area(a)).slice(0, 6);
    const names = [];
    for (const l of top) {
      let n = '?';
      try {
        const d = (await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId })).node;
        const a = d.attributes || [];
        const cls = a[a.indexOf('class') + 1];
        const id = a[a.indexOf('id') + 1];
        n = d.nodeName.toLowerCase() + (a.includes('id') ? '#' + id : '') + (a.includes('class') ? '.' + cls.trim().split(/\s+/).join('.') : '');
      } catch (err) {}
      names.push(`${n} ${Math.round(l.width)}x${Math.round(l.height)}`);
    }
    layerSamples.push({ at: label, layers: layerTree.length, drawing: drawn.length, MPx: Math.round(drawn.reduce((t, l) => t + area(l), 0) / 1e5) / 10, biggest: names.join(' | ') });
  };
  if (scenario === 'game') {
    // the whole mission, hands-free: skip the intro, answer every wall
    // (one wrong answer on wall `--wrong`, default 3, to play the game
    // over -> Replay path), run and jump with the keyboard, to the finale
    const wrongAt = Number(opt('wrong', 3));
    await page.evaluate((wrongAt) => {
      // label the trace wall by wall (the analysis splits phases on these)
      const setStage = ZD.ui.setStage.bind(ZD.ui);
      let wallNo = 0;
      let k = 0;
      ZD.ui.setStage = (n, total) => ((wallNo = ZD.perf.wallNo = n), ZD.perf.mark('wall', n), setStage(n, total));
      // "w3 side #12": the view settled on, for the layer samples
      const mark = ZD.perf.mark;
      ZD.perf.mark = (ev, d) => (ev === 'camera.settled' && (ZD.perf.lastSettled = `w${wallNo} ${d} #${++k}`), mark(ev, d));
      const finale = ZD.game.finale.bind(ZD.game);
      ZD.game.finale = (...a) => ((wallNo = ZD.perf.wallNo = 'F'), ZD.perf.mark('wall', 'finale'), finale(...a));
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
    let settled = '';
    let traceWall = 0;
    const end = Date.now() + 420000;
    while (Date.now() < end) {
      const s = await page.evaluate(() => ({
        wall: ZD.perf.wallNo || 0,
        settled: ZD.perf.lastSettled || '',
        controls: !!document.querySelector('#controls.visible'),
        jump: !!document.querySelector('.ctrl-btn.jump.hint'),
        retry: !!document.querySelector('.go-retry'),
        done: !!document.querySelector('#complete.visible'),
      }));
      if (opt('raster-scale', false) && s.wall !== traceWall) {
        traceWall = s.wall;
        await stopTrace();
        await startTrace();
      }
      if (s.settled !== settled) {
        settled = s.settled;
        await page.waitForTimeout(300); // the settled frame's layer tree
        await sampleLayers(settled);
      }
      if (s.done) {
        await sampleLayers('end screen');
        break;
      }
      // --until-wall N: stop when wall N comes up (a quicker A/B of the first runs)
      if (opt('until-wall', null) && typeof s.wall === 'number' && s.wall >= Number(opt('until-wall'))) break;
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
  await stopTrace();
  await browser.close();
  server.close();

  const { rows, totals, culprits, heaviest, rasterTop } = analyse(events);
  console.log(`browser ${path.basename(browserPath)} - raster: ${gpu} - viewport ${W}x${H}@${DPR}${opt('cpu', null) ? ' - cpu /' + opt('cpu') : ''}${opt('low-power', false) ? ' - low-power profile' : ''} - scenario ${scenario}${scenario === 'stress' ? ' x' + rounds : ''}`);
  console.table(rows);
  // one line per wall: does it get worse toward the end of the game?
  const byWall = {};
  rows.forEach((r) => {
    const w = (/^(w\S+) /.exec(r.phase) || [, 'start'])[1];
    const b = (byWall[w] = byWall[w] || { checkerboard: 0, holeFrames: 0, pixelatedFrames: 0, softFrames: 0, dropped: 0, raster: 0, nowMBmax: 0, layersMax: 0, tileMB: 0 });
    b.checkerboard += r.checkerboard;
    b.holeFrames += r.holeFrames;
    b.pixelatedFrames += r.lowResFrames;
    b.softFrames += r.softFrames;
    b.dropped += r.dropped;
    b.raster += r.raster;
    b.nowMBmax = Math.max(b.nowMBmax, r.nowMB);
    b.layersMax = Math.max(b.layersMax, r.layersMax);
    b.tileMB = Math.max(b.tileMB, r.tileMB);
  });
  if (scenario === 'game') console.table(byWall);
  console.log('totals', totals);
  if (culprits.length) {
    console.log('worst layers (pixelated = rastered below screen scale, hole = tile not painted, soft = stand-in tile):');
    console.table(culprits);
  }
  console.log('boot/assets', boot);
  if (pagePerf) {
    const { log, ...p } = pagePerf;
    console.log('in-page (rAF) frames:', p);
  }
  if (layerSamples.length) {
    console.log('GPU layer tree at each settled view (MPx = device megapixels the drawing layers cover):');
    console.table(layerSamples);
  }
  if (errors.length) console.log('page errors:', errors);
  if (framesDir) console.log(`${nFrames} composited frames saved in ${framesDir}`);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ gpu, viewport: [W, H, DPR], scenario, gpuMem: opt('gpu-mem', null), boot, rows, totals, culprits, heaviest, rasterTop, layerSamples, pagePerf, errors }, null, 1));
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
    totals.holeFrames > 0 ||
    totals.pixelatedFrames > 0 ||
    errors.length > 0 ||
    (pagePerf && (pagePerf.swingDropped > 0 || pagePerf.swingBlendedFrames > 0 || pagePerf.missingImages.length > 0)) ||
    (scenario === 'game' && pagePerf && !pagePerf.completed);
  if (opt('strict', false) && strictFailure) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
