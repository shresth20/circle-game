/* Asset manifest + loader.
   The measured manifest (sprite grids, wall openings, layer crops) is generated
   by tools/build-assets.py into assets/build/manifest.js.  This module maps
   it to game roles, downloads EVERYTHING the game will fetch (every image,
   both fonts, the theme music) before the play button appears, and decodes
   only the assets needed by the view that is about to paint.  After the
   play button nothing waits on the network.

   Every image is drawn as a CSS background (or an svg <image>), so the
   browser owns the decoded pixels: they live in its image decode cache,
   which has its own memory budget and drops what has not been drawn for a
   while.  This module never keeps decoded copies of its own (no canvases,
   no ImageBitmaps) - that would double the memory on a 1 GB tablet.  What
   it keeps is each file's compressed bytes (a Blob drawn through its blob:
   URL, ~10 MB for the whole game), so nothing is ever requested twice and
   nothing is fetched after the play button, and it re-decodes a view's images
   right before that view is painted (ZD.assets.decode via
   ZD.scene.camera.prewarm), so an image the browser has dropped is
   decoded off the critical path instead of in the middle of a swing.

   Phones: a request can be lost without an error (switching cells, a
   stalled connection) and the browser then waits minutes before failing
   it.  A preload that waits for every file must never wait on such a
   request, or the loading bar stops for good.  See "Downloads" below. */
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
  /* Downloads are not decodes (an Image that is not drawn keeps only its
     compressed bytes), so a phone gets as many parallel requests as a
     desktop: on a mobile network the round-trip time, not the CPU, is what
     a small pool wastes. */
  const LOAD_CONCURRENCY = 8;
  ZD.device = { memoryGB, cores, lowPower, targetFps: lowPower ? 30 : 60 };
  if (lowPower && window.gsap && gsap.ticker) gsap.ticker.fps(30);

  /* Downloads.  Every file is fetched with fetch() + AbortController - the
     only request every browser really cancels (WebKit keeps a cancelled
     <img> request open and hands the retry to it) - and kept as a Blob.
     Draws use its blob: URL, so once the play button is up no picture
     waits on the network or on the server's cache headers.
     Stall rule: a request is cancelled and asked again when NO BYTES have
     arrived for STALL_MS (doubled for each later attempt of that file).  A
     slow download that is still moving is never cut off; one a phone lost
     without an error (switching cells, a dead connection) is.  MAX_ATTEMPTS
     bounds a file that really is missing (reported in stats.failed - the
     game still starts).  On file:// (no fetch) each file is an Image as
     before. */
  const STALL_MS = 15000;
  const MAX_ATTEMPTS = 5;
  /* A decode that never settles (seen in some mobile WebKit builds) must not
     hold a decode slot forever; the image is still drawable without it. */
  const DECODE_CAP_MS = 8000;
  /* Fonts are tiny; past this the text simply uses the fallback face. */
  const FONT_CAP_MS = 20000;
  /* The theme music counts as this many images on the loading bar (~1.3 MB
     against ~115 KB per image). */
  const MUSIC_UNITS = 10;
  const CAN_FETCH = !!(window.fetch && window.AbortController && window.URL && URL.createObjectURL) && location.protocol !== 'file:';

  const cache = new Map(); // src -> Promise<Image> (one download per file, ever)
  const decoding = new Map(); // src -> Promise (queued or decoding now)
  const decodeQueue = [];
  let activeDecodes = 0;
  const stats = { loaded: 0, failed: [], retries: 0, stalls: 0, decodes: 0, decodeMs: 0, slowest: { src: '', ms: 0 }, decodeConcurrency: DECODE_CONCURRENCY };
  const markFailed = (src) => {
    if (!stats.failed.includes(src)) stats.failed.push(src);
  };
  const clearFailed = (src) => {
    const i = stats.failed.indexOf(src);
    if (i >= 0) stats.failed.splice(i, 1);
  };

  const net = { slow: false, offline: navigator.onLine === false };
  let onNet = null; // preload's status listener
  const tellNet = () => onNet && onNet();
  window.addEventListener('offline', () => {
    net.offline = true;
    tellNet();
  });
  window.addEventListener('online', () => {
    net.offline = false;
    tellNet();
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* Resolves at once when online; while the device reports offline, waits
     for it to come back instead of spending attempts. */
  const online = () => (navigator.onLine === false ? new Promise((r) => window.addEventListener('online', r, { once: true })) : Promise.resolve());

  const blobUrl = new Map(); // src -> blob: URL of its downloaded bytes
  const srcOfBlob = new Map(); // blob: URL -> src
  /* The URL every draw uses for `src`: its downloaded copy once there is one. */
  function url(src) {
    return blobUrl.get(src) || BASE + src;
  }

  /* One download of `path`.  Rejects on an HTTP error, a network error or a
     stall (error.stalled).  onBytes(0..1) as bytes arrive. */
  async function fetchOnce(path, stallMs, onBytes) {
    const ctl = new AbortController();
    let stalled = false;
    let timer = 0;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        ctl.abort();
      }, stallMs);
    };
    try {
      arm();
      const r = await fetch(path, { signal: ctl.signal });
      if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
      arm();
      const type = r.headers.get('content-type') || '';
      if (!r.body || !r.body.getReader) return await r.blob();
      const total = Number(r.headers.get('content-length')) || 0;
      const reader = r.body.getReader();
      const parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        parts.push(value);
        got += value.length;
        if (onBytes && total) onBytes(Math.min(1, got / total));
      }
      return new Blob(parts, { type });
    } catch (e) {
      const err = stalled ? new Error('Stalled loading ' + path) : e;
      err.stalled = stalled;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /* fetchOnce with retries.  Resolves the Blob, or rejects after
     MAX_ATTEMPTS. */
  async function fetchBlob(path, onBytes) {
    for (let n = 1; ; n++) {
      await online();
      try {
        const blob = await fetchOnce(path, STALL_MS * 2 ** (n - 1), onBytes);
        if (onBytes) onBytes(1);
        return blob;
      } catch (e) {
        if (n >= MAX_ATTEMPTS) throw e;
        stats.retries++;
        if (e.stalled) {
          stats.stalls++;
          net.slow = true;
          tellNet();
        }
        if (onBytes) onBytes(0);
        await sleep(500 * n);
      }
    }
  }

  function imageFrom(href) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load ' + href));
      img.src = href;
    });
  }

  const capped = (p, ms) => Promise.race([p, sleep(ms).then(() => Promise.reject(new Error('Timed out')))]);
  /* Set when this page cannot use fetch() or blob: images (file://, or a
     host's security policy) but plain image requests work: from then on
     every file is a plain request (capped, so it still cannot hang). */
  let plainOnly = !CAN_FETCH;

  /* The Image for `src` (bytes downloaded, not decoded). */
  function loadImage(src, onBytes) {
    if (cache.has(src)) return cache.get(src);
    let p;
    p = (async () => {
      let refused = false;
      if (!plainOnly) {
        let blob = null;
        try {
          blob = await fetchBlob(BASE + src, onBytes);
        } catch (e) {
          if (e.stalled) throw e; // the network itself: a plain request would wait too
        }
        if (blob) {
          const u = URL.createObjectURL(blob);
          try {
            const img = await imageFrom(u);
            blobUrl.set(src, u);
            srcOfBlob.set(u, src);
            return img;
          } catch (e) {
            URL.revokeObjectURL(u);
          }
        }
        refused = true;
      }
      for (let n = 1; ; n++) {
        try {
          const img = await capped(imageFrom(BASE + src), STALL_MS * 2 ** (n - 1));
          if (refused) plainOnly = true;
          return img;
        } catch (e) {
          if (n >= MAX_ATTEMPTS) throw e;
          await sleep(500 * n);
        }
      }
    })().then((img) => {
      clearFailed(src);
      stats.loaded++;
      return img;
    }).catch((e) => {
      // A rejected promise must not poison the cache forever. A later
      // preload/decode can retry after connectivity returns.
      if (cache.get(src) === p) cache.delete(src);
      markFailed(src);
      console.warn('[assets]', e.message);
      throw e;
    });
    cache.set(src, p);
    return p;
  }

  /* Decode `src` now (fetching it first if needed).  `load` means the bytes
     are here, not that the picture is ready to draw: a large WebP still
     has to be decoded, and if that happens during a camera move it
     competes with the move and the browser may show an empty or blurred
     tile. A real load failure rejects; decode() quirks after a successful
     load are tolerated because the image is still drawable. */
  async function runDecode(src) {
    const t0 = performance.now();
    const img = await loadImage(src);
    try {
      if (img.decode) await Promise.race([img.decode(), sleep(DECODE_CAP_MS)]);
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
      runDecode(job.src)
        .then(job.resolve, job.reject)
        .finally(() => {
          activeDecodes--;
          decoding.delete(job.src);
          pumpDecodes();
        });
    }
  }

  function decodeOne(src) {
    if (decoding.has(src)) return decoding.get(src);
    let resolve;
    let reject;
    const p = new Promise((r, j) => {
      resolve = r;
      reject = j;
    });
    decoding.set(src, p);
    decodeQueue.push({ src, resolve, reject });
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

  /* Load every @font-face the stylesheet declares (a face is otherwise only
     fetched when text first uses it - mid-game on a slow phone). */
  function loadFonts() {
    let faces = [];
    try {
      faces = document.fonts ? [...document.fonts] : [];
    } catch (e) {
      /* FontFaceSet not iterable: the faces load on first use */
    }
    const all = Promise.all(faces.map((f) => f.load().catch(() => {})));
    return Promise.race([all, sleep(FONT_CAP_MS)]);
  }

  const assets = {
    manifest,
    url,
    stats,
    image: (key) => manifest.images[key],
    sprite: (key) => manifest.sprites[key],
    wall: (key) => manifest.walls[key],
    /* 'bg/sky.webp' for a URL this module handed out (blob: or plain), else null */
    srcOf(u) {
      if (!u) return null;
      if (srcOfBlob.has(u)) return srcOfBlob.get(u);
      return u.startsWith(BASE) ? u.slice(BASE.length) : null;
    },
    imageUrl: (key) => url(manifest.images[key].src),
    spriteUrl: (key) => url(manifest.sprites[key].src),
    wallUrl: (key) => url(manifest.walls[key].src),

    /* Decode these build paths ('bg/sky.webp') before they are painted.
       Duplicates and decodes already in flight are shared. Resolves when
       all are done and rejects a real load failure so a scene is never
       shown with a known-missing texture. onProgress(0..1) is optional. */
    decode(srcs, onProgress) {
      const list = [...new Set(srcs)];
      let done = 0;
      return Promise.all(list.map((s) => decodeOne(s).then(() => onProgress && onProgress(++done / list.length))));
    },

    /* Download everything the game will fetch, before the play button:
       every image (the game must also run offline once loaded), every
       font face and the theme music.  The welcome screen's own pictures
       go first.  Only the title art is decoded here (not all 91 images
       into ~232 MB of RGBA); main.js decodes the initial side view after
       the scene exists, and Camera.prewarm decodes each incoming view.
       onProgress(fraction 0..1, status '' | 'slow' | 'offline').
       Never rejects and never waits on a lost request. */
    async preload(onProgress) {
      const first = ['roadPersp', 'welcomeLogo', 'startButton'].map((k) => manifest.images[k] && manifest.images[k].src).filter(Boolean);
      const list = [
        ...first,
        ...Object.values(manifest.images).map((i) => i.src),
        ...Object.values(manifest.walls).map((w) => w.src),
        ...Object.values(manifest.sprites).map((s) => s.src),
      ];
      const files = [...new Set(list)];
      const music = CAN_FETCH && ZD.audio && ZD.audio.musicSrc;
      const units = files.length + 1 + (music ? MUSIC_UNITS : 0);
      let done = 0; // finished units
      let partial = 0; // received fractions of files still downloading
      const parts = new Map(); // what each of those contributes to `partial`
      const part = (key, f) => {
        partial += f - (parts.get(key) || 0);
        parts.set(key, f);
        report();
      };
      const report = () => {
        if (!onProgress) return;
        const status = net.offline ? 'offline' : net.slow ? 'slow' : '';
        onProgress(Math.min(1, (done + partial) / units), status);
      };
      onNet = report;
      try {
        const musicDone = music
          ? fetchBlob(music, (f) => part('music', f * MUSIC_UNITS))
              .then((blob) => ZD.audio.useMusicBlob && ZD.audio.useMusicBlob(blob))
              .catch((e) => console.warn('[assets] theme music will stream:', e.message))
              .then(() => {
                part('music', 0);
                done += MUSIC_UNITS;
                report();
              })
          : Promise.resolve();
        const fontsDone = loadFonts().then(() => {
          done++;
          report();
        });
        await pool(files, LOAD_CONCURRENCY, (src) =>
          loadImage(src, (f) => part(src, f))
            .then(() => {
              part(src, 0);
              parts.delete(src);
              done++;
              report();
            })
        );
        await Promise.all([musicDone, fontsDone]);
        // the welcome screen's art, so the swap to the play button is instant
        await Promise.all(first.map(decodeOne));
      } finally {
        onNet = null;
      }
      if (onProgress) onProgress(1, '');
      if (stats.failed.length) console.warn('[assets] missing after retries:', stats.failed);
    },
  };

  ZD.assets = assets;
})();
