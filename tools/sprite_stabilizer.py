"""
Sprite-sheet frame stabilizer.

AI-drawn sprite sheets are a grid of separate drawings: every cell has the
figure at a slightly different place, size and lean, so playback jiggles.
Video-driven sprite tools avoid that because their frames come from one
continuous clip with a locked camera.  This module gives a drawn grid the same
properties, the way video stabilization does:

  1. track   - template-match rigid parts of the figure against a reference
               frame (the head, the boots) for a sub-pixel position and a
               per-frame scale; the ground contact is the lowest solid row
  2. place   - one anchor per frame: planted boots (idle, throw, attack ...)
               or the head (in-place runs), airborne frames by their height
               above the ground line of their row
  3. smooth  - the tracked head path is low-passed over time (periodic for
               loops), the intended motion stays, frame-to-frame zig-zag goes
  4. correct - each frame gets a small affine about its anchor: uniform scale
               (size pops), shear (lean jitter) and vertical squash (bob
               jitter), so the head lands on the smoothed path while the feet
               stay exactly where they are
  5. order   - (idle loops only, optional) frames re-ordered so the sway is one
               smooth cycle instead of a random walk

Pure numpy / scipy / Pillow; used by tools/build-assets.py and
tools/sprite-qa.py.
"""
import itertools

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.signal import fftconvolve


# --------------------------------------------------------------------------- #
# image helpers
# --------------------------------------------------------------------------- #
def feature(fig, blur=1.2):
    """Grey-level feature image for matching: the figure's luminance over a
    mid-grey backdrop, lightly blurred so redraw noise does not dominate."""
    a = fig[:, :, 3:4].astype(np.float32) / 255
    lum = (fig[:, :, :3].astype(np.float32) * np.array([0.299, 0.587, 0.114], np.float32)).sum(2, keepdims=True)
    f = (lum * a + 128 * (1 - a))[:, :, 0]
    return ndimage.gaussian_filter(f, blur) if blur else f


def solid(fig, thresh=128):
    return fig[:, :, 3] > thresh


def main_body(mask):
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    return lab == (int(np.argmax(ndimage.sum(mask, lab, range(1, n + 1)))) + 1)


def ground_y(fig, min_px=6):
    """Ground contact: the lowest row of the main body with at least `min_px`
    solid pixels (a dangling lace or a stray speck does not count)."""
    m = main_body(solid(fig))
    rows = np.nonzero(m.sum(1) >= min_px)[0]
    return float(rows[-1] + 1) if len(rows) else float(fig.shape[0])


def top_y(fig):
    m = main_body(solid(fig))
    rows = np.nonzero(m.any(1))[0]
    return float(rows[0]) if len(rows) else 0.0


def resize(arr, s):
    """Premultiplied Lanczos resize (no dark or light halos at the edges)."""
    h, w = arr.shape[:2]
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    return warp(arr, (s, 0, 0, 0, s, 0), (nw, nh))


def warp(arr, m, size):
    """Premultiplied affine warp.  m = (a, b, c, d, e, f) maps SOURCE to
    OUTPUT: x' = a x + b y + c, y' = d x + e y + f.  size = (w, h)."""
    a, b, c, d, e, f = m
    inv = np.linalg.inv(np.array([[a, b, c], [d, e, f], [0, 0, 1]], np.float64))
    coeffs = tuple(inv[:2].reshape(-1))
    big = max(abs(a), abs(e)) >= 0.999
    al = arr[:, :, 3].astype(np.float32) / 255
    pm = arr[:, :, :3].astype(np.float32) * al[:, :, None]
    if abs(b) < 1e-9 and abs(d) < 1e-9 and not big:
        # pure downscale: Lanczos is sharper and alias-free (offsets are 0)
        def f_(ch):
            return np.array(Image.fromarray(ch).resize(size, Image.LANCZOS))
    else:
        def f_(ch):
            return np.array(Image.fromarray(ch).transform(size, Image.AFFINE, coeffs, Image.BICUBIC))
    al2 = np.clip(f_(al), 0, 1)
    rgb = np.stack([f_(np.ascontiguousarray(pm[:, :, i])) for i in range(3)], 2) / np.maximum(al2[:, :, None], 1e-3)
    out = np.dstack([np.clip(rgb, 0, 255), al2 * 255])
    out[al2 < 0.02] = 0
    return out.round().astype(np.uint8)


# --------------------------------------------------------------------------- #
# template matching (normalised cross-correlation, sub-pixel peak)
# --------------------------------------------------------------------------- #
def _box(img, h, w):
    c = np.cumsum(np.cumsum(np.pad(img, ((1, 0), (1, 0))), 0), 1)
    return c[h:, w:] - c[:-h, w:] - c[h:, :-w] + c[:-h, :-w]


def ncc(img, tpl, wgt=None):
    """NCC map of template `tpl` over `img` (valid positions only).  With a
    weight mask the template's statistics use only its weighted pixels (the
    figure, not the backdrop around it)."""
    th, tw = tpl.shape
    if img.shape[0] < th or img.shape[1] < tw:
        return None
    if wgt is None:
        wgt = np.ones_like(tpl)
    wsum = wgt.sum()
    t = (tpl - (tpl * wgt).sum() / wsum) * wgt
    tnorm = np.sqrt((t * t).sum())
    num = fftconvolve(img, t[::-1, ::-1], mode="valid")
    # local weighted mean / energy of the image under the mask
    s1 = fftconvolve(img, wgt[::-1, ::-1], mode="valid")
    s2 = fftconvolve(img * img, wgt[::-1, ::-1], mode="valid")
    # floor: a flat patch (empty backdrop) has ~0 variance; without a floor
    # FFT round-off there divides into huge false peaks
    var = np.maximum(s2 - s1 * s1 / wsum, 4.0 * wsum)
    return np.clip(num / (tnorm * np.sqrt(var) + 1e-6), -1, 1)


def _subpix(m, y, x):
    def par(a, b, c):
        d = a - 2 * b + c
        return 0.0 if abs(d) < 1e-9 else 0.5 * (a - c) / d
    dy = par(m[y - 1, x], m[y, x], m[y + 1, x]) if 0 < y < m.shape[0] - 1 else 0.0
    dx = par(m[y, x - 1], m[y, x], m[y, x + 1]) if 0 < x < m.shape[1] - 1 else 0.0
    return y + float(np.clip(dy, -1, 1)), x + float(np.clip(dx, -1, 1))


class Part:
    """A rigid part cut from the reference frame (feature image + mask, and
    the part's reference point inside the template)."""

    def __init__(self, fig, box, point):
        x0, y0, x1, y1 = [int(round(v)) for v in box]
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(fig.shape[1], x1), min(fig.shape[0], y1)
        self.feat = feature(fig)[y0:y1, x0:x1]
        a = fig[y0:y1, x0:x1, 3].astype(np.float32) / 255
        # include a thin ring of backdrop: the outline is the strongest cue
        self.wgt = np.clip(ndimage.maximum_filter(a, 5), 0, 1)
        self.point = (point[0] - x0, point[1] - y0)
        self.size = (x1 - x0, y1 - y0)

    def _tpl(self, s, rot):
        key = (round(s, 4), round(rot, 2))
        cache = self.__dict__.setdefault("_cache", {})
        if key not in cache:
            tpl, wgt = self.feat, self.wgt
            if abs(s - 1) > 1e-6:
                nw, nh = max(4, round(self.size[0] * s)), max(4, round(self.size[1] * s))
                tpl = np.array(Image.fromarray(tpl).resize((nw, nh), Image.BILINEAR))
                wgt = np.array(Image.fromarray(wgt).resize((nw, nh), Image.BILINEAR))
            # reference point relative to the template centre (rotates with it)
            cx, cy = (tpl.shape[1] - 1) / 2, (tpl.shape[0] - 1) / 2
            px, py = self.point[0] * tpl.shape[1] / self.size[0] - cx, self.point[1] * tpl.shape[0] / self.size[1] - cy
            if abs(rot) > 1e-6:
                bg = float((tpl * wgt).sum() / max(wgt.sum(), 1e-6))
                tpl = ndimage.rotate(tpl, rot, reshape=False, order=1, mode="constant", cval=bg)
                wgt = np.clip(ndimage.rotate(wgt, rot, reshape=False, order=1, mode="constant", cval=0), 0, 1)
                t = np.deg2rad(rot)
                # ndimage.rotate turns the array counter-clockwise on screen
                px, py = px * np.cos(t) + py * np.sin(t), -px * np.sin(t) + py * np.cos(t)
            cache[key] = (tpl, wgt, (px + cx, py + cy))
        return cache[key]

    def find(self, fig, scales=(1.0,), rots=(0.0,), region=None, expect=None, img=None):
        """Best match in `fig`: (x, y, scale, score, rot) of the reference
        point.  `region` = (x0, y0, x1, y1) limits the search; `expect` =
        (x, y, r) softly prefers matches near an expected point."""
        img = feature(fig) if img is None else img
        ox, oy = 0, 0
        if region is not None:
            x0, y0, x1, y1 = [int(round(v)) for v in region]
            x0, y0 = max(0, x0), max(0, y0)
            x1, y1 = min(img.shape[1], x1), min(img.shape[0], y1)
            img, ox, oy = img[y0:y1, x0:x1], x0, y0
        # the search area must hold the largest template: pad with backdrop
        th = max(self._tpl(s, r)[0].shape[0] for s in scales for r in rots)
        tw = max(self._tpl(s, r)[0].shape[1] for s in scales for r in rots)
        py, px = max(0, th - img.shape[0] + 2), max(0, tw - img.shape[1] + 2)
        if py or px:
            img = np.pad(img, ((py // 2, py - py // 2), (px // 2, px - px // 2)), constant_values=128.0)
            ox, oy = ox - px // 2, oy - py // 2
        best = None
        for s in scales:
            for rot in rots:
                tpl, wgt, (qx, qy) = self._tpl(s, rot)
                m = ncc(img, tpl, wgt)
                if m is None:
                    continue
                if expect is not None:
                    ex, ey, er = expect
                    yy, xx = np.mgrid[0:m.shape[0], 0:m.shape[1]]
                    m = m - 0.25 * np.clip(np.hypot(xx + ox + qx - ex, yy + oy + qy - ey) / er, 0, 4) ** 2 / 16
                y, x = np.unravel_index(int(np.argmax(m)), m.shape)
                sc = float(m[y, x])
                if best is None or sc > best[3]:
                    yy, xx = _subpix(m, y, x)
                    best = (xx + ox + qx, yy + oy + qy, float(s), sc, float(rot))
        return best


# --------------------------------------------------------------------------- #
# temporal smoothing
# --------------------------------------------------------------------------- #
def smooth_loop(v, harmonics):
    """Least-squares fit of a periodic signal with the first `harmonics`
    Fourier terms (the intended cycle; the residual is drawing noise)."""
    v = np.asarray(v, np.float64)
    n = len(v)
    t = np.arange(n) * 2 * np.pi / n
    cols = [np.ones(n)]
    for k in range(1, harmonics + 1):
        cols += [np.cos(k * t), np.sin(k * t)]
    A = np.stack(cols, 1)
    coef, *_ = np.linalg.lstsq(A, v, rcond=None)
    return A @ coef


def smooth_once(v, sigma=0.8):
    """Gaussian smoothing for one-shot actions; the two end frames keep their
    values (they meet the idle pose / the next action)."""
    v = np.asarray(v, np.float64)
    if len(v) < 3 or sigma <= 0:
        return v.copy()
    pad = int(np.ceil(3 * sigma))
    # odd reflection keeps the ends in place and the slope continuous
    left = 2 * v[0] - v[1:pad + 1][::-1]
    right = 2 * v[-1] - v[-pad - 1:-1][::-1]
    ext = np.concatenate([left, v, right])
    out = ndimage.gaussian_filter1d(ext, sigma, mode="nearest")[pad:pad + len(v)]
    out[0], out[-1] = v[0], v[-1]
    return out


def jerk(v, loop):
    """RMS second difference: how much a track zig-zags frame to frame."""
    v = np.asarray(v, np.float64)
    d2 = (np.roll(v, -1) - 2 * v + np.roll(v, 1)) if loop else (v[2:] - 2 * v[1:-1] + v[:-2])
    return float(np.sqrt((d2 ** 2).mean())) if len(d2) else 0.0


# --------------------------------------------------------------------------- #
# frame order (idle loops)
# --------------------------------------------------------------------------- #
def best_cycle(D):
    """Shortest closed tour through all frames (Held-Karp, n <= 13), starting
    at frame 0, in the direction that keeps most of the original order."""
    n = len(D)
    if n <= 3:
        return list(range(n))
    INF = float("inf")
    full = 1 << (n - 1)
    dp = np.full((full, n - 1), INF)
    par = np.full((full, n - 1), -1, np.int32)
    for j in range(n - 1):
        dp[1 << j, j] = D[0][j + 1]
    for mask in range(1, full):
        for j in range(n - 1):
            if not (mask >> j) & 1 or dp[mask, j] == INF:
                continue
            for k in range(n - 1):
                if (mask >> k) & 1:
                    continue
                nm = mask | (1 << k)
                c = dp[mask, j] + D[j + 1][k + 1]
                if c < dp[nm, k]:
                    dp[nm, k] = c
                    par[nm, k] = j
    last = int(np.argmin([dp[full - 1, j] + D[j + 1][0] for j in range(n - 1)]))
    order, mask = [], full - 1
    j = last
    while j != -1:
        order.append(j + 1)
        pj = par[mask, j]
        mask ^= 1 << j
        j = pj
    order = [0] + order[::-1]
    rev = [0] + order[1:][::-1]
    keep = lambda o: sum(1 for a, b in zip(o, o[1:]) if b == a + 1)
    return order if keep(order) >= keep(rev) else rev


def cycle_cost(D, order):
    return float(sum(D[a][b] for a, b in zip(order, order[1:] + order[:1])))


# --------------------------------------------------------------------------- #
# the stabilizer
# --------------------------------------------------------------------------- #
def _head_box(fig, stand):
    """Head of the reference frame: the top 22% of the standing height, cut to
    the widest blob there (hair spikes and raised hands excluded)."""
    m = main_body(solid(fig))
    y0 = int(np.nonzero(m.any(1))[0][0])
    band = m[y0:y0 + int(0.22 * stand)]
    lab, n = ndimage.label(band)
    sl = ndimage.find_objects(lab)[int(np.argmax(ndimage.sum(band, lab, range(1, n + 1))))]
    x0, x1 = sl[1].start, sl[1].stop
    pad = 6
    return (x0 - pad, y0 - pad, x1 + pad, y0 + int(0.22 * stand) + pad)


def _boots_box(fig, stand):
    g = ground_y(fig)
    m = main_body(solid(fig))
    h = int(0.13 * stand)
    cols = np.nonzero(m[int(g) - h:int(g)].any(0))[0]
    return (cols[0] - 6, g - h - 4, cols[-1] + 6, g + 4)


def track(figs, stand, ref=0, scales=None, head=True, boots=True):
    """Measure every frame against frame `ref`: ground line, head point (x, y)
    and scale, boots point.  Returns a list of dicts (frame-local px)."""
    if scales is None:
        scales = np.round(np.arange(0.94, 1.0601, 0.02), 3)
    P = 24                                   # margin so a template fits any frame
    figs = [np.pad(f, ((P, P), (P, P), (0, 0))) for f in figs]
    R = figs[ref]
    hbox = _head_box(R, stand)
    hp = Part(R, hbox, ((hbox[0] + hbox[2]) / 2, (hbox[1] + hbox[3]) / 2))
    bbox_ = _boots_box(R, stand)
    bp = Part(R, bbox_, ((bbox_[0] + bbox_[2]) / 2, bbox_[3] - 4))
    out = []
    for f in figs:
        g = ground_y(f)
        t = top_y(f)
        m = {"ground": g - P, "top": t - P, "w": f.shape[1] - 2 * P, "h": f.shape[0] - 2 * P}
        if head:
            img = feature(f)
            # coarse over the whole frame (also finds a head below raised
            # arms), then tilt and size around that peak, then refine both
            hx, hy, _, sc, _ = hp.find(f, (1.0,), img=img)
            win = (hx - hp.size[0], hy - hp.size[1], hx + hp.size[0], hy + hp.size[1])
            hx, hy, _, sc, rot = hp.find(f, (1.0,), rots=range(-15, 16, 5), region=win, img=img)
            hx, hy, s, sc, rot = hp.find(f, scales, rots=(rot,), region=win, img=img)
            hx, hy, s, sc, rot = hp.find(f, [s - 0.01, s, s + 0.01], rots=(rot - 2.5, rot, rot + 2.5), region=win, img=img)
            m.update(hx=hx - P, hy=hy - P, scale=s, hscore=sc, rot=rot)
        if boots:
            region = (0, g - 0.25 * stand, f.shape[1], f.shape[0])
            bx, by, _, bsc, _ = bp.find(f, (1.0,), region=region)
            m.update(bx=bx - P, by=by - P, bscore=bsc)
        # plain bottom-band centroid as a fallback for the boots
        mb = main_body(solid(f))
        band = np.zeros_like(mb)
        bh = max(6, int(0.07 * stand))
        band[max(0, int(g) - bh):int(g)] = mb[max(0, int(g) - bh):int(g)]
        m["fx"] = (float(ndimage.center_of_mass(band)[1]) if band.any() else f.shape[1] / 2) - P
        out.append(m)
    return out


def _deadzone(v, gate):
    """Shrink v toward 0 by `gate`: measurement noise inside the gate is
    ignored, real size pops beyond it are corrected."""
    return np.sign(v) * np.maximum(np.abs(v) - gate, 0)


def _anchor_canvas(figs, anchors, feat=True):
    """All frames on one canvas with their anchors on the same point (for
    frame-distance / onion-skin comparisons)."""
    left = max(ax for ax, ay in anchors)
    right = max(f.shape[1] - ax for f, (ax, ay) in zip(figs, anchors))
    top = max(ay for ax, ay in anchors)
    bottom = max(f.shape[0] - ay for f, (ax, ay) in zip(figs, anchors))
    W, H = int(np.ceil(left + right)) + 2, int(np.ceil(top + bottom)) + 2
    out = []
    for f, (ax, ay) in zip(figs, anchors):
        c = np.zeros((H, W, 4), np.uint8)
        dx, dy = int(round(left - ax)), int(round(top - ay))
        c[dy:dy + f.shape[0], dx:dx + f.shape[1]] = f
        out.append(c)
    return out


def frame_distances(figs, anchors):
    cv = _anchor_canvas(figs, anchors)
    F = [ndimage.gaussian_filter(feature(c, 0), 2.0) for c in cv]
    A = [c[:, :, 3] > 128 for c in cv]
    n = len(figs)
    D = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            u = A[i] | A[j]
            D[i, j] = D[j, i] = float(np.abs(F[i] - F[j])[u].mean()) if u.any() else 0.0
    return D


def apply_warp(fig, anchor, c=1.0, k=1.0, hn=1e9, kx=0.0, du=0.0, dh=0.0, pad=None):
    """Warp one frame about its anchor (ax, ay = ground point):
         uniform scale c, then the body below the neck height `hn` stretched
         by k (the head above it is only moved, never squashed), then a shear
         kx (x moves kx px per px of height above the ground), then a shift.
    Returns (frame, anchor) - anchor in the returned frame's coordinates."""
    from scipy.ndimage import map_coordinates
    ax, ay = anchor
    h, w = fig.shape[:2]
    if pad is None:
        pad = int(np.ceil(abs(kx) * h + abs(c - 1) * max(h, w) + abs(k - 1) * h + abs(du) + abs(dh))) + 2
    H, W = h + 2 * pad, w + 2 * pad
    oax, oay = ax + pad, ay + pad
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
    u3, h3 = xx - oax, oay - yy
    h2, u2 = h3 - dh, u3 - du
    u1 = u2 - kx * np.maximum(h2, 0)
    kh = k * hn
    h1 = np.where(h2 <= 0, h2, np.where(h2 <= kh, h2 / k, h2 - kh + hn))
    sx, sy = ax + u1 / c, ay - h1 / c
    a = fig[:, :, 3].astype(np.float64) / 255
    pm = np.dstack([fig[:, :, :3].astype(np.float64) * a[:, :, None], a * 255])
    out = np.stack([map_coordinates(pm[:, :, i], [sy, sx], order=3, mode="constant", cval=0.0, prefilter=True)
                    for i in range(4)], 2)
    al = np.clip(out[:, :, 3], 0, 255)
    rgb = out[:, :, :3] * 255 / np.maximum(al[:, :, None], 1e-3)
    res = np.dstack([np.clip(rgb, 0, 255), al])
    res[al < 4] = 0
    res = res.round().astype(np.uint8)
    # trim the empty padding back off
    ys, xs = np.nonzero(res[:, :, 3] > 0)
    y0, y1, x0, x1 = max(0, ys.min() - 2), min(H, ys.max() + 3), max(0, xs.min() - 2), min(W, xs.max() + 3)
    return res[y0:y1, x0:x1].copy(), (oax - x0, oay - y0)


def stabilize(figs, stand, mode="plant", loop=False, lift=None, ref=0, x_offset=None, torso_x=None,
              harmonics=2, sigma=0.7, max_shear=0.05, max_squash=0.05, scale_gate=0.03,
              max_shift=None, reorder=False, src=None, src_scale=1.0, log=None):
    """Stabilize one animation.

    figs      frames (RGBA crops) at the final scale
    stand     standing height of the character in these px (sets part sizes)
    mode      "plant": the boots stay put (idle, throw, attack ...)
              "body":  the head is the anchor (in-place runs)
    loop      periodic smoothing + seamless wrap
    lift      per-frame height of the ground line below the figure (airborne
              frames > 0); grounded frames get the shear / squash correction,
              airborne ones are only moved onto the smoothed path
    x_offset  anchor x = boots x (plant) / head x (body) + x_offset
    torso_x   body mode: per-frame torso x; x_offset = median(torso - head)
              so the anchor keeps its usual place on the body
    src       optional frames at source resolution, src_scale = figs / src
              (one number, or one per frame): the correction is rendered
              from them, so the frame is resampled once instead of twice
    Returns (frames, anchors, info)."""
    n = len(figs)
    lift = np.zeros(n) if lift is None else np.asarray(lift, np.float64)
    air = lift > 0
    tr = track(figs, stand, ref=ref)
    hx = np.array([m["hx"] for m in tr])
    hy = np.array([m["hy"] for m in tr])
    gy = np.array([m["ground"] for m in tr])
    hs = np.array([m["scale"] for m in tr])
    boots = np.array([m["bx"] if m["bscore"] >= 0.7 else m["fx"] for m in tr])
    if mode == "body":
        if x_offset is None:
            x_offset = float(np.median(np.asarray(torso_x) - hx)) if torso_x is not None else 0.0
        ax = hx + x_offset
    else:
        ax = boots + (x_offset or 0.0)
    ay = gy + lift
    if mode == "plant" and air.any() and (~air).any():
        # airborne frames: x by the head, continuing the grounded frames' head offset
        g = np.nonzero(~air)[0]
        rel = np.interp(np.arange(n), g, (hx - ax)[g])
        ax = np.where(air, hx - rel, ax)
    info = {"order": list(range(n))}

    if reorder and loop and n >= 4:
        # visual difference + head travel, each normalised: the cycle that
        # changes least from frame to frame, with the head moving smoothly
        D = frame_distances(figs, list(zip(ax, ay)))
        hp = np.stack([hx - ax, hy - ay], 1)
        Dh = np.hypot(*(hp[:, None, :] - hp[None, :, :]).transpose(2, 0, 1))
        off = ~np.eye(n, dtype=bool)
        D = D / np.median(D[off]) + Dh / max(np.median(Dh[off]), 1e-3)
        order = best_cycle(D)
        c0, c1 = cycle_cost(D, list(range(n))), cycle_cost(D, order)
        if c1 < 0.8 * c0:
            info.update(order=order, cost=(round(c0, 1), round(c1, 1)))
            figs = [figs[i] for i in order]
            if src is not None:
                src = [src[i] for i in order]
            tr = [tr[i] for i in order]
            hx, hy, gy, hs, ax, ay, lift, air = (v[order] for v in (hx, hy, gy, hs, ax, ay, lift, air))

    # 1. size: per-frame head scale relative to the sheet's median, dead-zoned;
    #    only trusted where the head matched well (a redrawn / turned head
    #    says nothing reliable about size)
    good = np.array([m["hscore"] >= 0.75 for m in tr])
    med = np.median(hs[good]) if good.sum() >= 2 else 1.0
    srel = np.where(good, hs / med, 1.0)
    c = 1.0 / (1.0 + _deadzone(srel - 1.0, scale_gate))
    # head point relative to the anchor (x right, height up), after scaling
    rx, rh = c * (hx - ax), c * (ay - hy)
    # 2. the intended path
    sm = (lambda v: smooth_loop(v, harmonics)) if loop else (lambda v: smooth_once(v, sigma))
    tx = rx if mode == "body" else sm(rx)
    th = sm(rh)
    head_r = 0.11 * stand
    max_shift = 0.06 * stand if max_shift is None else max_shift
    frames, anchors, corr = [], [], []
    for i in range(n):
        if air[i]:
            du = float(np.clip(tx[i] - rx[i], -max_shift, max_shift))
            dh = float(np.clip(th[i] - rh[i], -max_shift, max_shift))
            p = dict(c=c[i], du=du, dh=dh)
        else:
            hn = max(rh[i] - head_r, 0.3 * rh[i])
            k = float(np.clip((hn + th[i] - rh[i]) / hn, 1 - max_squash, 1 + max_squash))
            kh = k * hn + (rh[i] - hn)                      # head height after the stretch
            kx = float(np.clip((tx[i] - rx[i]) / max(kh, 1), -max_shear, max_shear))
            p = dict(c=c[i], k=k, hn=hn, kx=kx)
        corr.append(p)
        trivial = abs(p["c"] - 1) < 1e-3 and abs(p.get("k", 1) - 1) < 2e-3 and abs(p.get("kx", 0)) < 2e-3 \
            and abs(p.get("du", 0)) < 0.5 and abs(p.get("dh", 0)) < 0.5
        if trivial:
            frames.append(figs[i])
            anchors.append((float(ax[i]), float(ay[i])))
        elif src is not None:
            # render from the full-resolution drawing: one resample, not two
            ss = float(src_scale[i]) if np.ndim(src_scale) else float(src_scale)
            sx, sy = figs[i].shape[1] / src[i].shape[1], figs[i].shape[0] / src[i].shape[0]
            q = dict(p)
            q["hn"] = p.get("hn", 1e9) / ss
            q["du"], q["dh"] = p.get("du", 0) / ss, p.get("dh", 0) / ss
            f, (bx, by) = apply_warp(src[i], (ax[i] / sx, ay[i] / sy), **q)
            g = resize(f, ss)
            # anchor scales with the frame (resize maps pixel edges: x * s)
            frames.append(g)
            anchors.append((bx * g.shape[1] / f.shape[1], by * g.shape[0] / f.shape[0]))
        else:
            f, a = apply_warp(figs[i], (ax[i], ay[i]), **p)
            frames.append(f)
            anchors.append(a)
    info.update(
        before={"x": jerk(rx, loop), "h": jerk(rh, loop)},
        after={"x": jerk([t if mode != "body" else r for t, r in zip(tx, rx)], loop), "h": jerk(th, loop)},
        scale=[round(float(v), 3) for v in c], corr=corr,
    )
    if log:
        log(f"    head zig-zag x {info['before']['x']:.1f}->{info['after']['x']:.1f}  "
            f"y {info['before']['h']:.1f}->{info['after']['h']:.1f} px"
            + (f"  order {info['order']}" if info["order"] != list(range(n)) else ""))
    return frames, anchors, info


def grid_lift(grounds, cols, stand, snap=0.04, tol=0.06):
    """Height above the ground line for frames cut from a grid sheet.
    `grounds` = each figure's lowest solid row in cell coordinates.  AI grids
    share one baseline per row (drifting a few px between rows): a row's
    baseline is its lowest figure, unless the whole row is in the air (then
    the sheet's typical baseline).  Lifts under `snap` x stand are drawing
    noise and become 0 (the figure stands on the ground)."""
    g = np.asarray(grounds, np.float64)
    rows = [g[i:i + cols] for i in range(0, len(g), cols)]
    ref = float(np.median([r.max() for r in rows]))
    base = np.concatenate([np.full(len(r), r.max() if r.max() >= ref - tol * stand else ref) for r in rows])
    lift = np.maximum(base - g, 0)
    return np.where(lift < snap * stand, 0.0, lift)


# --------------------------------------------------------------------------- #
# sheet I/O: cut a grid into figures, clean their edges, pack them again
# --------------------------------------------------------------------------- #
def extract_grid(arr, cols, rows, thresh=90, near=40, min_px=30):
    """One figure per grid cell, with its offset in the sheet.  Components
    belong to the cell holding their centre (a figure may overhang its cell);
    small bits floating near the figure are kept, specks are dropped.
    Returns [(fig, x0, y0)] row-major (fig = tight RGBA crop)."""
    H, W = arr.shape[:2]
    cw, ch = W / cols, H / rows
    m = arr[:, :, 3] > thresh
    lab, n = ndimage.label(m)
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    coms = ndimage.center_of_mass(m, lab, range(1, n + 1))
    objs = ndimage.find_objects(lab)
    cells = {}
    for i, (sz, (cy, cx)) in enumerate(zip(sizes, coms)):
        if sz >= min_px:
            k = min(rows - 1, int(cy // ch)) * cols + min(cols - 1, int(cx // cw))
            cells.setdefault(k, []).append((i + 1, sz))
    out = []
    for k in range(cols * rows):
        comps = cells.get(k)
        assert comps, f"empty cell {k}"
        big = max(s for _, s in comps)
        main = [i for i, s in comps if s >= 0.2 * big]
        y0 = max(0, min(objs[i - 1][0].start for i, _ in comps) - near - 4)
        y1 = min(H, max(objs[i - 1][0].stop for i, _ in comps) + near + 4)
        x0 = max(0, min(objs[i - 1][1].start for i, _ in comps) - near - 4)
        x1 = min(W, max(objs[i - 1][1].stop for i, _ in comps) + near + 4)
        wl = lab[y0:y1, x0:x1]
        around = ndimage.binary_dilation(np.isin(wl, main), iterations=near)
        extra = [i for i, s in comps if i not in main and (around & (wl == i)).any()]
        keep = ndimage.binary_dilation(np.isin(wl, main + extra), iterations=2)
        part = np.where(keep[:, :, None], arr[y0:y1, x0:x1], 0).astype(np.uint8)
        ys, xs = np.nonzero(part[:, :, 3] > 8)
        cy0, cy1 = max(0, ys.min() - 2), min(part.shape[0], ys.max() + 3)
        cx0, cx1 = max(0, xs.min() - 2), min(part.shape[1], xs.max() + 3)
        out.append((part[cy0:cy1, cx0:cx1].copy(), x0 + cx0, y0 + cy0))
    return out


def defringe(fig, depth=4, haze=False):
    """Clean the silhouette of background residue, frame-consistently:
      * soft edge pixels (anti-aliasing, alpha < 230) take the colour of the
        nearest solid pixel - a white- or grey-tinted edge becomes the ink
        colour, alpha unchanged, so edges stay smooth;
      * opaque light-grey/white fragments touching the transparent outside
        (matting specks) are peeled, at most `depth` px - the art's dark ink
        outline keeps real light colours (eyes, a white shirt) out of reach;
      * haze=True: soft pixels more than 2.5 px from any solid pixel (smoky
        background left around the figure) are removed."""
    out = fig.copy()
    a = out[:, :, 3]
    rgb = out[:, :, :3].astype(np.float32)
    mx, mn = rgb.max(2), rgb.min(2)
    lum = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    sat = (mx - mn) / np.maximum(mx, 1)
    outside = a < 24
    white = (a >= 128) & (lum >= 150) & (sat <= 0.2)
    if haze:
        # smoke: greyish, lighter than the ink, not fully solid
        white |= (a < 235) & (lum >= 105) & (sat <= 0.22)
        depth = max(depth, 8)
    removed = np.zeros_like(outside)
    for _ in range(depth):
        edge = white & ~removed & ~outside & ndimage.binary_dilation(outside | removed)
        if not edge.any():
            break
        removed |= edge
    out[removed] = 0
    a = out[:, :, 3]
    core = a >= 230
    if core.any():
        d, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
        soft = (a > 0) & ~core
        if haze:
            out[soft & (d > 2.5)] = 0
            soft &= d <= 2.5
        out[soft, :3] = out[iy[soft], ix[soft], :3]
    # isolated specks left floating after the peel
    m = out[:, :, 3] > 24
    lab, n = ndimage.label(m)
    if n > 1:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        out[np.isin(lab, [k + 1 for k, sz in enumerate(sizes) if sz < 12])] = 0
    return out


def pack(frames, anchors, cols=4, pad=6, min_half=0, min_up=0):
    """Pack frames into a grid; every frame's anchor lands on its cell's
    horizontal centre and on one shared line.  Returns (sheet, meta)."""
    left = max(ax for ax, ay in anchors)
    right = max(f.shape[1] - ax for f, (ax, ay) in zip(frames, anchors))
    up = max(max(ay for ax, ay in anchors), min_up)
    down = max(0.0, max(f.shape[0] - ay for f, (ax, ay) in zip(frames, anchors)))
    half = max(int(np.ceil(max(left, right))) + pad, min_half)
    fw = 2 * half
    line = pad + int(np.ceil(up))
    fh = line + int(np.ceil(down)) + pad
    fh += fh % 2
    n = len(frames)
    cols = min(cols, n)
    rows = (n + cols - 1) // cols
    sheet = np.zeros((rows * fh, cols * fw, 4), np.uint8)
    for k, (f, (ax, ay)) in enumerate(zip(frames, anchors)):
        r, c = divmod(k, cols)
        dx, dy = int(round(half - ax)), int(round(line - ay))
        h, w = f.shape[:2]
        sy0, sx0 = max(0, -dy), max(0, -dx)
        sy1, sx1 = min(h, fh - dy), min(w, fw - dx)
        cell = sheet[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw]
        src = f[sy0:sy1, sx0:sx1]
        dst = cell[dy + sy0:dy + sy1, dx + sx0:dx + sx1]
        np.copyto(dst, src, where=src[:, :, 3:4] > dst[:, :, 3:4])
    return sheet, {"fw": fw, "fh": fh, "cols": cols, "rows": rows, "frames": n, "anchorY": round(line / fh, 4)}
