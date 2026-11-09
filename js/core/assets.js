/* Asset manifest + loader.
   The measured manifest (sprite grids, wall openings, layer crops) is generated
   by tools/build-assets.py into assets/build/manifest.js.  This module maps
   it to game roles, downloads every image before the title screen and
   decodes only the assets needed by the view that is about to paint.

   Every image is drawn as a CSS background (or an svg <image>), so the
   browser owns the decoded pixels: they live in its image decode cache,
   which has its own memory budget and drops what has not been drawn for a
   while.  This module never keeps decoded copies of its own (no canvases,
   no ImageBitmaps) - that would double the memory on a 1 GB tablet.  What
   it keeps is one Image per file (the bytes, ~10 MB for the whole game),
   so nothing is ever requested twice, and it re-decodes a view's images
   right before that view is painted (ZD.assets.decode via
   ZD.scene.camera.prewarm), so an image the browser has dropped is
   decoded off the critical path instead of in the middle of a swing. */
window.ZD = window.ZD || {};

(function () {
  const BASE = 'assets/build/';
  const manifest = window.ZD_MANIFEST;
  if (!manifest) throw new Error('assets/build/manifest.js missing - run tools/build-assets.py');

  /* A low-memory / low-core device gets a stable 30 fps budget and only two
     simultaneous image decodes.  This is deliberately capability-based,
     never user-agent based; browsers that do not expose deviceMemory fall
     back to the core count. */
  const memoryGB = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  // deviceMemory is deliberately coarse (normally 0.25/0.5/1/2/4/8). Treat
  // 4 GB tablets/Chromebooks as constrained too: after the OS and browser,
  // their available graphics/process budget is often well below 1 GB.
  const lowPower = (memoryGB > 0 && memoryGB <= 4) || (cores > 0 && cores <= 4);
  const DECODE_CONCURRENCY = lowPower ? 2 : 4;
  const LOAD_CONCURRENCY = lowPower ? 4 : 8;
  ZD.device = { memoryGB, cores, lowPower, targetFps: lowPower ? 30 : 60 };
  if (lowPower && window.gsap && gsap.ticker) gsap.ticker.fps(30);

  const cache = new Map(); // src -> Promise<Image> (one request per file, ever)
  const decoding = new Map(); // src -> Promise (queued or decoding now)
  const decodeQueue = [];
  let activeDecodes = 0;
  const stats = { loaded: 0, failed: [], decodes: 0, decodeMs: 0, slowest: { src: '', ms: 0 }, decodeConcurrency: DECODE_CONCURRENCY };

  function url(src) {
    return BASE + src;
  }

  function loadOnce(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load ' + src));
      img.src = url(src);
    });
  }

  function loadImage(src, retries = 2) {
    if (cache.has(src)) return cache.get(src);
    const attempt = (n) =>
      loadOnce(src).catch((e) => {
        if (n <= 0) throw e;
        return new Promise((r) => setTimeout(r, 400)).then(() => attempt(n - 1));
      });
    const p = attempt(retries).then(
      (img) => {
        stats.loaded++;
        return img;
      },
      (e) => {
        stats.failed.push(src);
        console.warn('[assets]', e.message);
        throw e;
      }
    );
    cache.set(src, p);
    return p;
  }

  /* Decode `src` now (fetching it first if needed).  `load` means the bytes
     are here, not that the picture is ready to draw: a large WebP still
     has to be decoded, and if that happens during a camera move it
     competes with the move and the browser may show an empty or blurred
     tile.  Never rejects (a failed file is logged in stats.failed). */
  async function runDecode(src) {
    const t0 = performance.now();
    try {
      const img = await loadImage(src);
      if (img.decode) await img.decode();
    } catch (e) {
      /* Some Safari versions reject decode() after a successful load;
         the image is still usable. A load error is already in stats.failed. */
    }
    const ms = performance.now() - t0;
    stats.decodes++;
    stats.decodeMs += ms;
    if (ms > stats.slowest.ms) stats.slowest = { src, ms: Math.round(ms) };
    if (ZD.perf) ZD.perf.decoded(src, ms);
  }

  /* One shared decode queue serves boot, camera prewarms and sprite primes.
     Promise.all at the call site is safe: no call can create an unbounded
     decode burst or a 232 MB simultaneous RGBA allocation. */
  function pumpDecodes() {
    while (activeDecodes < DECODE_CONCURRENCY && decodeQueue.length) {
      const job = decodeQueue.shift();
      activeDecodes++;
      runDecode(job.src).finally(() => {
        activeDecodes--;
        decoding.delete(job.src);
        job.resolve();
        pumpDecodes();
      });
    }
  }

  function decodeOne(src) {
    if (decoding.has(src)) return decoding.get(src);
    let resolve;
    const p = new Promise((r) => (resolve = r));
    decoding.set(src, p);
    decodeQueue.push({ src, resolve });
    pumpDecodes();
    return p;
  }

  /* Run `job` over `list` with at most `n` in flight. */
  async function pool(list, n, job) {
    let i = 0;
    const worker = async () => {
      while (i < list.length) await job(list[i++]);
    };
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
  }

  const assets = {
    manifest,
    url,
    stats,
    image: (key) => manifest.images[key],
    sprite: (key) => manifest.sprites[key],
    wall: (key) => manifest.walls[key],
    imageUrl: (key) => url(manifest.images[key].src),
    spriteUrl: (key) => url(manifest.sprites[key].src),
    wallUrl: (key) => url(manifest.walls[key].src),

    /* Decode these build paths ('bg/sky.webp') before they are painted.
       Duplicates and decodes already in flight are shared.  Resolves when
       all are done; never rejects. */
    decode(srcs) {
      return Promise.all([...new Set(srcs)].map(decodeOne));
    },

    /* Download every image (the game must run offline once loaded), but do
       not decode all 91 into ~232 MB of RGBA at boot.  Only the title art is
       decoded here; main.js decodes the initial side view after the scene
       exists, and Camera.prewarm decodes each incoming view. */
    async preload(onProgress) {
      const list = [
        ...Object.values(manifest.images).map((i) => i.src),
        ...Object.values(manifest.walls).map((w) => w.src),
        ...Object.values(manifest.sprites).map((s) => s.src),
      ];
      const files = [...new Set(list)];
      let done = 0;
      await pool(files, LOAD_CONCURRENCY, (src) =>
        loadImage(src).catch(() => {}).then(() => {
          done++;
          if (onProgress) onProgress((done / files.length) * 0.92);
        })
      );
      const boot = ['welcomeLogo', 'startButton'].map((key) => manifest.images[key] && manifest.images[key].src).filter(Boolean);
      await Promise.all(boot.map(decodeOne));
      if (onProgress) onProgress(1);
      if (stats.failed.length) console.warn('[assets] missing after retries:', stats.failed);
      try {
        await document.fonts.ready;
      } catch (e) {
        /* fonts are optional */
      }
    },
  };

  ZD.assets = assets;
})();
