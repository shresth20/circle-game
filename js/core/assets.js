/* Asset manifest + preloader.
   The measured manifest (sprite grids, wall openings, layer crops) is generated
   by tools/build-assets.py into assets/build/manifest.js.  This module maps
   it to game roles and preloads every image before the title screen. */
window.ZD = window.ZD || {};

(function () {
  const BASE = 'assets/build/';
  const manifest = window.ZD_MANIFEST;
  if (!manifest) throw new Error('assets/build/manifest.js missing - run tools/build-assets.py');

  const cache = new Map();

  function url(src) {
    return BASE + src;
  }

  function loadOnce(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = async () => {
        /* `load` means the bytes are available, but a large WebP can still
           be waiting for its first decode.  If the scene starts meanwhile,
           that decode competes with the camera transition and Chrome/Safari
           may briefly composite an empty or low-resolution tile. */
        try {
          if (img.decode) await img.decode();
        } catch (e) {
          /* Some Safari versions reject decode() after a successful load.
             The image is usable in that case, so only the load error below
             is fatal. */
        }
        resolve(img);
      };
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
    const p = attempt(retries);
    cache.set(src, p);
    return p;
  }

  const assets = {
    manifest,
    url,
    image: (key) => manifest.images[key],
    sprite: (key) => manifest.sprites[key],
    wall: (key) => manifest.walls[key],
    imageUrl: (key) => url(manifest.images[key].src),
    spriteUrl: (key) => url(manifest.sprites[key].src),
    wallUrl: (key) => url(manifest.walls[key].src),
    /* Preload everything; onProgress(0..1). */
    async preload(onProgress) {
      const list = [
        ...Object.values(manifest.images).map((i) => i.src),
        ...Object.values(manifest.sprites).map((s) => s.src),
        ...Object.values(manifest.walls).map((w) => w.src),
      ];
      let done = 0;
      await Promise.all(
        list.map((src) =>
          loadImage(src)
            .catch(() => null)
            .then(() => {
              done++;
              onProgress && onProgress(done / list.length);
            })
        )
      );
      try {
        await document.fonts.ready;
      } catch (e) {
        /* fonts are optional */
      }
    },
  };

  ZD.assets = assets;
})();
