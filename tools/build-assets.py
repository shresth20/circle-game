#!/usr/bin/env python3
"""
Asset pipeline for "Zombie Defense: Parts of a Circle".

Reads the raw art in  assets/images/  and writes game-ready WebP files plus a
measured manifest to  assets/build/.

What it does
  * cleans sprite-sheet alpha (haze / halo removal, white-key for the zombie
    reference strips, component filtering for the noisy celebrate sheet)
  * re-packs every animation into a uniform grid and records cols/rows/frames
  * crops environment layers to their content and records the crop offsets
  * measures the circular opening of every wall asset (centre + radii) so the
    runtime can place the glass mechanism exactly
  * converts everything to WebP (lossy for opaque backdrops, lossy-with-alpha for
    sprites) and writes assets/build/manifest.json

Run:   python3 tools/build-assets.py        (needs Pillow, numpy, scipy)
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "images"
OUT = ROOT / "assets" / "build"

MANIFEST = {"version": 1, "images": {}, "sprites": {}, "walls": {}}


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def load(rel):
    return np.array(Image.open(SRC / rel).convert("RGBA"))


def save(arr, rel, quality=88, lossless=False):
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    im = Image.fromarray(arr)
    if lossless:
        im.save(path, "WEBP", lossless=True, method=6)
    else:
        im.save(path, "WEBP", quality=quality, method=6)
    return rel


def save_opaque(arr, rel, quality=82):
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr[:, :, :3]).save(path, "WEBP", quality=quality, method=6)
    return rel


def stretch_alpha(arr, lo=20, hi=None):
    """Remove faint haze (alpha<lo -> 0) and push the figure's alpha to full."""
    a = arr[:, :, 3].astype(np.float32)
    if hi is None:
        solid = a[a > 150]
        hi = float(np.percentile(solid, 97)) if solid.size else 255.0
        hi = max(hi, lo + 1)
    a = np.clip((a - lo) / (hi - lo), 0, 1) * 255
    arr[:, :, 3] = a.astype(np.uint8)
    return arr


def keep_big_components(arr, thresh=150, min_area=1500, grow=3):
    """Keep only large connected alpha regions (figures); drops haze blobs."""
    a = arr[:, :, 3]
    mask = a > thresh
    lab, n = ndimage.label(mask)
    if n == 0:
        return arr
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep_ids = [i + 1 for i, s in enumerate(sizes) if s >= min_area]
    keep = np.isin(lab, keep_ids)
    keep = ndimage.binary_dilation(keep, iterations=grow)
    arr[:, :, 3] = np.where(keep, a, 0).astype(np.uint8)
    return arr


def runs(mask, min_len=1, merge_gap=0):
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append([start, i])
            start = None
    if start is not None:
        out.append([start, len(mask)])
    if merge_gap:
        merged = []
        for r in out:
            if merged and r[0] - merged[-1][1] <= merge_gap:
                merged[-1][1] = r[1]
            else:
                merged.append(r)
        out = merged
    return [r for r in out if r[1] - r[0] >= min_len]


def bbox(arr, thresh=20):
    a = arr[:, :, 3] > thresh
    ys = np.where(a.any(axis=1))[0]
    xs = np.where(a.any(axis=0))[0]
    return int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1


def make_tileable(arr, blend=140):
    """Trim transparent edge columns, then (blend > 0) cross-fade the right
    edge into the left so the layer repeats horizontally without a seam.
    Layers the runtime mirror-tiles only need the trim (blend=0)."""
    a = arr[:, :, 3]
    cols = np.where((a > 20).any(axis=0))[0]
    if cols.size:
        arr = arr[:, cols[0]:cols[-1] + 1]
    if blend <= 0:
        return arr
    w = arr.shape[1]
    blend = min(blend, w // 4)
    out = arr.astype(np.float32)
    t = np.linspace(0, 1, blend, dtype=np.float32)[None, :, None]
    left = out[:, :blend].copy()
    right = out[:, w - blend:].copy()
    # premultiplied cross-fade keeps semi-transparent fringes clean
    def premul(x):
        return np.concatenate([x[:, :, :3] * x[:, :, 3:4] / 255.0, x[:, :, 3:4]], axis=2)
    def unpremul(x):
        rgb = np.where(x[:, :, 3:4] > 0, x[:, :, :3] * 255.0 / np.maximum(x[:, :, 3:4], 1e-6), 0)
        return np.concatenate([rgb, x[:, :, 3:4]], axis=2)
    mixed = unpremul(premul(right) * (1 - t) + premul(left) * t)
    out[:, w - blend:] = mixed
    return np.clip(out, 0, 255).astype(np.uint8)


def key_black(arr, lo=3, hi=16, min_area=150):
    """Turn a flat black backdrop into alpha. Only dark regions that touch the
    border (or are big enclosed gaps, e.g. between tower braces) are keyed, so
    dark outlines inside the art stay opaque; edges get a soft alpha ramp."""
    m = arr[:, :, :3].max(axis=2).astype(np.float32)
    dark = m < hi
    lab, n = ndimage.label(dark)
    if n == 0:
        return arr
    sizes = ndimage.sum(dark, lab, range(1, n + 1))
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    keep = [i + 1 for i, s in enumerate(sizes) if (i + 1) in border or s >= min_area]
    bg = np.isin(lab, keep)
    a = np.where(bg, np.clip((m - lo) / (hi - lo), 0, 1) * 255, 255)
    arr[:, :, 3] = np.minimum(arr[:, :, 3], a).astype(np.uint8)
    return arr


def remove_sun(arr):
    """Erase the sun disc baked into the skyline art (the largest warm-coloured
    blob) so the runtime can draw one sun of its own instead of one per tile.
    Lit windows are small separate blobs and are kept."""
    r, g, b, a = (arr[:, :, i].astype(np.int32) for i in range(4))
    warm = (a > 40) & (r > 180) & (b < 120) & (r - b > 90)
    lab, n = ndimage.label(warm)
    if n == 0:
        return arr
    sizes = ndimage.sum(warm, lab, range(1, n + 1))
    sun = lab == (int(np.argmax(sizes)) + 1)
    # grow over the anti-aliased rim, but only onto warm-ish pixels
    rim = ndimage.binary_dilation(sun, iterations=4) & (r - b > 30)
    arr[:, :, 3] = np.where(sun | rim, 0, arr[:, :, 3]).astype(np.uint8)
    return arr


# separate clouds cut from the cloud-bank art (x0, y0, x1, y1); the runtime
# scatters a few of them instead of tiling the whole bank
CLOUD_BOXES = [(1135, 32, 1564, 121), (3, 58, 516, 180), (498, 185, 830, 257), (950, 204, 1340, 273)]


def build_clouds():
    arr = stretch_alpha(load("bg/ChatGPT Image Nov 5, 2026, 04_35_09 PM-5.png"), lo=20)
    solid = ndimage.binary_closing(arr[:, :, 3] > 60, iterations=3)
    lab, _ = ndimage.label(solid)
    for i, (x0, y0, x1, y1) in enumerate(CLOUD_BOXES, 1):
        # keep only the blob that owns this box (neighbours overlap the boxes)
        ids, counts = np.unique(lab[y0:y1, x0:x1][solid[y0:y1, x0:x1]], return_counts=True)
        own = ndimage.binary_dilation(lab == ids[np.argmax(counts)], iterations=3)
        part = arr.copy()
        part[:, :, 3] = np.where(own, part[:, :, 3], 0)
        part = part[max(0, y0 - 4):y1 + 4, max(0, x0 - 4):x1 + 4]
        bx0, by0, bx1, by1 = bbox(part)
        part = part[by0:by1, bx0:bx1]
        MANIFEST["images"][f"cloud{i}"] = {"src": save(part, f"props/cloud-{i}.webp", 86), "w": part.shape[1], "h": part.shape[0]}


def build_dry_trees():
    """Split bg/trees.png (two rows of dry trees on grass tufts) into single
    props dryTree1..N, ordered row by row, left to right."""
    arr = stretch_alpha(load("bg/trees.png"), lo=20)
    solid = ndimage.binary_closing(arr[:, :, 3] > 60, iterations=6)
    lab, n = ndimage.label(solid)
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    boxes = ndimage.find_objects(lab)
    trees = [i + 1 for i, sz in enumerate(sizes) if sz > 12000]
    trees.sort(key=lambda i: (boxes[i - 1][0].start > arr.shape[0] // 2, boxes[i - 1][1].start))
    for k, i in enumerate(trees, 1):
        own = ndimage.binary_dilation(lab == i, iterations=3)
        part = arr.copy()
        part[:, :, 3] = np.where(own, part[:, :, 3], 0)
        x0, y0, x1, y1 = bbox(part)
        part = part[y0:y1, x0:x1]
        MANIFEST["images"][f"dryTree{k}"] = {"src": save(part, f"props/dry-tree-{k}.webp", 86), "w": part.shape[1], "h": part.shape[0]}


def interior_hole(arr, thresh=40):
    """Find the transparent region fully enclosed by the opaque wall."""
    t = arr[:, :, 3] < thresh
    lab, n = ndimage.label(t)
    h, w = t.shape
    border_ids = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    best, best_size = None, 0
    for i in range(1, n + 1):
        if i in border_ids:
            continue
        size = int((lab == i).sum())
        if size > best_size:
            best, best_size = i, size
    if best is None:
        return None
    ys, xs = np.where(lab == best)
    return {
        "cx": round(float(xs.mean()), 1),
        "cy": round(float(ys.mean()), 1),
        "rx": round(float(xs.max() - xs.min() + 1) / 2, 1),
        "ry": round(float(ys.max() - ys.min() + 1) / 2, 1),
    }


# --------------------------------------------------------------------------- #
# environment layers
# --------------------------------------------------------------------------- #
def build_layers():
    print("layers")
    sky = make_tileable(load("bg/ChatGPT Image Nov 5, 2026, 04_35_00 PM-1.png"), blend=360)
    MANIFEST["images"]["sky"] = {"src": save_opaque(sky, "bg/sky.webp", 80), "w": sky.shape[1], "h": sky.shape[0]}

    def alpha_layer(key, rel, out, crop=None, lo=20, tile=False, black_bg=False, post=None):
        arr = load(rel)
        arr = key_black(arr) if black_bg else stretch_alpha(arr, lo=lo)
        x0, y0 = 0, 0
        if crop == "auto":
            x0, y0, x1, y1 = bbox(arr)
            arr = arr[y0:y1, x0:x1]
        elif crop:
            x0, y0, x1, y1 = crop
            arr = arr[y0:y1, x0:x1]
        if tile:
            arr = make_tileable(arr, blend=tile if isinstance(tile, int) and not isinstance(tile, bool) else 140)
        if post:
            arr = post(arr)
        MANIFEST["images"][key] = {"src": save(arr, out, 86), "w": arr.shape[1], "h": arr.shape[0], "ox": x0, "oy": y0}

    # tile=0 → trim only; these layers are mirror-tiled by the runtime
    build_clouds()
    build_dry_trees()
    alpha_layer("haze", "bg/ChatGPT Image Nov 5, 2026, 04_35_03 PM-2.png", "bg/haze.webp", crop=(0, 280, 1870, 841), lo=28, tile=0)
    alpha_layer("mountains", "bg/ChatGPT Image Nov 5, 2026, 04_35_05 PM-3.png", "bg/mountains.webp", crop=(0, 400, 1870, 841), tile=0)
    # bg/image.png: the skyline repainted solid down to the bottom edge, so it
    # never shows a cut-off base (the runtime pins source row 640, the old
    # crop bottom, to the same screen y as before)
    alpha_layer("skyline", "bg/image.png", "bg/skyline.webp", crop=(0, 280, 1870, 841), tile=0, post=remove_sun)
    # side-view watchtower: the tall lattice tower (bg/image copy.png), on black
    alpha_layer("tower", "bg/image copy.png", "bg/tower.webp", crop="auto", black_bg=True)
    alpha_layer("tree", "bg/Isolated Sunset Tree and Grass.png", "bg/tree.webp", crop="auto")
    # crop from the first post's centre to the last post's centre: mirror-tiled,
    # neighbouring tiles share one post and the spacing stays even (~390px)
    alpha_layer("fenceFront", "bg/fence_front_view_25x9.png", "bg/fence-front.webp", crop=(81, 505, 2420, 880), tile=0)
    alpha_layer("safeZone", "land/safe zone.png", "bg/safe-zone.webp", crop="auto")

    # side-view road: brick walkway with a visible top surface (rows 230-324)
    # and front face (to 500); trimmed to its content, mirror-tiled at runtime
    road = stretch_alpha(load("land/image copy.png"), lo=20)[226:504]
    # a lower road: keep the top surface, the cap row and the first 2 brick
    # rows (to the mortar line at 203), then re-attach the dark bottom edge
    # (mortar + shadow, rows 268-276) so it still ends cleanly
    road = np.concatenate([road[:203], road[268:276]], axis=0)
    MANIFEST["images"]["roadTop"] = {"src": save(road, "bg/road-top.webp", 86), "w": road.shape[1], "h": road.shape[0]}

    for i in range(1, 8):
        arr = stretch_alpha(load(f"land/grass_0{i}.png"), lo=12)
        MANIFEST["images"][f"grass{i}"] = {"src": save(arr, f"props/grass-{i}.webp", 86), "w": arr.shape[1], "h": arr.shape[0]}
    for i in range(1, 9):
        arr = stretch_alpha(load(f"land/rock_0{i}.png"), lo=12)
        MANIFEST["images"][f"rock{i}"] = {"src": save(arr, f"props/rock-{i}.webp", 86), "w": arr.shape[1], "h": arr.shape[0]}

    build_dirt()
    build_front_road()
    build_banner()
    build_profile()
    build_welcome()
    build_start_button()

    # Perspective road (used by the mission-map intro scene) and the defeat illustration.
    road = load("full-picture/image copy 5.png")
    MANIFEST["images"]["roadPersp"] = {"src": save_opaque(road, "bg/road-persp.webp", 80), "w": road.shape[1], "h": road.shape[0]}
    go = load("full-picture/image copy.png")[108:882, 50:1622]
    MANIFEST["images"]["gameOver"] = {"src": save_opaque(go, "bg/game-over.webp", 82), "w": go.shape[1], "h": go.shape[0]}


# Bottom message bar (assets/images/banner.png): the purple plate with a round
# socket on the left.  Cropped to its content, faint fringe removed, the noisy
# socket interior replaced by a dark disc (the hero portrait sits in it), and
# halved.  The runtime stretches it as a 9-slice: the manifest records the
# left / right caps (socket + stripes) and the socket circle, in output px.
# socket = least-squares fit of the ring's inner edge (centre x, y, radius to
# the bright orange); the ring is hand-drawn, its dark inner outline wanders
# between r 114 and 120, so the runtime portrait covers it up to r 121 and
# draws its own even outline.
BANNER = {"crop": (50, 229, 2120, 527), "socket": (381.7, 375.2, 121.0), "cap_l": 540, "cap_r": 1860, "scale": 0.5}


def build_banner():
    b = BANNER
    arr = stretch_alpha(load("banner.png"), lo=40)
    cx, cy, r = b["socket"]
    yy, xx = np.mgrid[0:arr.shape[0], 0:arr.shape[1]].astype(np.float32)
    d = np.hypot(xx - cx, yy - cy)
    # dark disc with a soft top-light, plus a thin dark rim against the ring
    t = np.clip(np.hypot(xx - cx, yy - (cy - r * 0.45)) / (r * 1.6), 0, 1)[:, :, None]
    disc = np.array([110, 62, 170], np.float32) * (1 - t) + np.array([38, 16, 64], np.float32) * t
    inside = (d <= r - 3)       # under the portrait; leaves the ring's orange alone
    arr[:, :, :3] = np.where(inside[:, :, None], disc, arr[:, :, :3]).astype(np.uint8)
    arr[:, :, 3] = np.where(inside, 255, arr[:, :, 3])
    x0, y0, x1, y1 = b["crop"]
    arr = arr[y0:y1, x0:x1]
    k = b["scale"]
    w, h = round(arr.shape[1] * k), round(arr.shape[0] * k)
    arr = np.array(Image.fromarray(arr).resize((w, h), Image.LANCZOS))
    MANIFEST["images"]["banner"] = {
        "src": save(arr, "ui/banner.webp", 90), "w": w, "h": h,
        "capL": round((b["cap_l"] - x0) * k), "capR": round((x1 - b["cap_r"]) * k),
        "socket": {"x": round((cx - x0) * k, 1), "y": round((cy - y0) * k, 1), "r": round(r * k, 1)},
    }


def build_start_button():
    """Welcome-screen play button (assets/images/image copy.png, transparent:
    the round yellow button with slime): cropped to its content, ~2x its
    230px display width.  Its disc (without the slime) spans 99.4% x 93.5%
    of the crop, centred at 49.9% / 50.5% - the CSS pulse rings use that."""
    arr = load("image copy.png")
    x0, y0, x1, y1 = bbox(arr)
    arr = arr[y0:y1, x0:x1]
    w = 480
    h = round(arr.shape[0] * w / arr.shape[1])
    arr = np.array(Image.fromarray(arr).resize((w, h), Image.LANCZOS))
    MANIFEST["images"]["startButton"] = {"src": save(arr, "ui/start-button.webp", 90), "w": w, "h": h}


def build_welcome():
    """Welcome-screen logo (assets/images/welcome.png, transparent): cropped
    to its content and sized for a ~1200px-wide display.  The welcome
    background is the existing `roadPersp` (full-picture/image copy 5.png)."""
    arr = load("welcome.png")
    x0, y0, x1, y1 = bbox(arr)
    arr = arr[y0:y1, x0:x1]
    w = 1300
    h = round(arr.shape[0] * w / arr.shape[1])
    arr = np.array(Image.fromarray(arr).resize((w, h), Image.LANCZOS))
    MANIFEST["images"]["welcomeLogo"] = {"src": save(arr, "ui/welcome-logo.webp", 90), "w": w, "h": h}


def build_profile():
    """Hero profile picture (assets/images/boy/profile.png, opaque on purple):
    a square around the head, 256 px.  Shown in round frames (HUD portrait,
    message-bar socket), so the purple corners are simply clipped."""
    arr = load("boy/profile.png")[90:1110, 110:1130]
    arr = np.array(Image.fromarray(arr).resize((256, 256), Image.LANCZOS))
    MANIFEST["images"]["profile"] = {"src": save_opaque(arr, "ui/profile.webp", 90), "w": 256, "h": 256}


def build_dirt():
    """Front-view ground: the dirt terrain without its corner-rock band, at half
    size, mirrored 2x2 so the runtime can repeat it seamlessly across the 3D
    ground plane (the corner rocks are placed as separate props)."""
    dirt = load("land/Open Dirt Terrain with Corner Rocks.png")[60:660, 8:-8, :3].astype(np.float32)
    # flatten the art's top vignette so repeated tiles don't band
    rows = ndimage.uniform_filter1d(dirt.mean(axis=(1, 2)), 61, mode="nearest")
    cols = ndimage.uniform_filter1d(dirt.mean(axis=(0, 2)), 61, mode="nearest")
    m = dirt.mean()
    dirt = np.clip(dirt * (m / rows)[:, None, None] * (m / cols)[None, :, None], 0, 255).astype(np.uint8)
    dirt = np.dstack([dirt, np.full(dirt.shape[:2], 255, np.uint8)])
    dirt = np.array(Image.fromarray(dirt).resize((dirt.shape[1] // 2, dirt.shape[0] // 2), Image.LANCZOS))
    top = np.concatenate([dirt, dirt[:, ::-1]], axis=1)
    tile = np.concatenate([top, top[::-1]], axis=0)
    MANIFEST["images"]["dirt"] = {"src": save_opaque(tile, "bg/dirt.webp", 80), "w": tile.shape[1], "h": tile.shape[0]}


# Front-view camera (stage px).  Must match FrontScene in js/scene.js.
FRONT_CAM = {
    "vp": (960.0, 610.0),   # vanishing point / horizon
    "cam_h": 470.0,         # camera height: ground at depth 0 is the stage bottom (y 1080)
    "persp": 1000.0,        # perspective distance (depth units = px at depth 0)
    "road_hw": 742.0,       # half-width of the road between the fences
    "fence_h": 560.0,       # fence height
    "world_x": -320, "world_w": 2560,
}


def _mips(tex, levels=6):
    """Box-filtered pyramid, each level resized back to full size so lookups
    use the same coordinates (cheap stand-in for mipmapping)."""
    out = [tex.astype(np.float32)]
    im = Image.fromarray(tex)
    for i in range(1, levels):
        f = 2 ** i
        small = im.resize((max(1, tex.shape[1] // f), max(1, tex.shape[0] // f)), Image.BOX)
        out.append(np.array(small.resize((tex.shape[1], tex.shape[0]), Image.BILINEAR)).astype(np.float32))
    return out


# The brick road art (assets/images/land/front-view road.png) is itself drawn in
# perspective: its top surface is a trapezoid whose far / near width ratio
# (292 / 769 = 0.38) matches FRONT_CAM between the wall's base (y 790) and the
# stage bottom (y 1080).  A single homography therefore maps it onto the ground
# with its side edges exactly on the fence base lines (x = vx +/- road_hw * k).
ROAD_ART = {
    "src": "land/front-view road.png",
    # top-surface corners in the art: far-left, far-right, near-right, near-left
    "quad": [(252.0, 38.0), (544.0, 38.0), (782.0, 382.0), (13.0, 382.0)],
    "junk_x": 772,      # a stray panel edge at the art's right border (x >= 772, y < 340)
    "far_y": 790.0,     # screen row of the far edge (hidden just under the wall's base)
    "near_y": 1080.0,   # screen row of the near edge (stage bottom)
    # px (at depth 0) to pull the road edges in from the fence line; negative =
    # past it.  The fence's bottom rail is ~37px up, so the ground seen under
    # it lies out to ~805px: the paving runs to 822 and the fence stands ON the
    # road (no dirt wedge between road and fence).
    "inset": -80.0,
}


def _homography(src, dst):
    """Coefficients for PIL's PERSPECTIVE transform mapping dst -> src points."""
    A, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return np.linalg.solve(np.array(A, np.float64), np.array(b, np.float64)).tolist()


def _lay_front_road(ground, X0, Y0, ss):
    """Warp the brick road onto the baked ground (RGBA, top-left at stage
    (X0, Y0)) between the fences, from the wall's base to the stage bottom."""
    c, r = FRONT_CAM, ROAD_ART
    vx, vy = c["vp"]
    art = load(r["src"])
    art[:340, r["junk_x"]:, 3] = 0
    # premultiply so the warp's filtering doesn't bleed dark fringe colour
    pm = art.astype(np.float32)
    pm[:, :, :3] *= pm[:, :, 3:4] / 255.0
    hw = c["road_hw"] - r["inset"]
    k_far = (r["far_y"] - vy) / c["cam_h"]
    k_near = (r["near_y"] - vy) / c["cam_h"]
    dst = [(vx - hw * k_far, r["far_y"]), (vx + hw * k_far, r["far_y"]),
           (vx + hw * k_near, r["near_y"]), (vx - hw * k_near, r["near_y"])]
    # output-space (supersampled) coordinates
    dst = [((x - X0) * ss, (y - Y0) * ss) for x, y in dst]
    H, W = ground.shape[:2]
    coeffs = _homography(r["quad"], dst)
    big = []
    for ch in range(4):
        im = Image.fromarray(np.clip(pm[:, :, ch], 0, 255).astype(np.uint8))
        big.append(np.array(im.transform((W * ss, H * ss), Image.PERSPECTIVE, coeffs, Image.BICUBIC)))
    warped = np.dstack(big)
    warped = np.array(Image.fromarray(warped).resize((W, H), Image.LANCZOS)).astype(np.float32)
    # depth grading: the far end a touch darker / hazier so it sits in the scene
    ys = Y0 + np.arange(H, dtype=np.float32)
    t = np.clip((ys - r["far_y"]) / (r["near_y"] - r["far_y"]), 0, 1)[:, None, None]
    warped[:, :, :3] *= 0.84 + 0.16 * t
    a = warped[:, :, 3:4] / 255.0
    g = ground.astype(np.float32)
    g[:, :, :3] = warped[:, :, :3] + g[:, :, :3] * (1 - a)      # premultiplied "over"
    return np.clip(g, 0, 255).astype(np.uint8)


def build_front_road():
    """Pre-render the front view's ground (dirt land receding to the horizon,
    a worn road track between the fences) and the two chain-link fences that
    line the road, as seen by FRONT_CAM.  Two layers so props can sit between
    them.  Rendered at 2x and downsampled for anti-aliasing."""
    c = FRONT_CAM
    vx, vy = c["vp"]
    H0, P, RW, FH = c["cam_h"], c["persp"], c["road_hw"], c["fence_h"]
    ss = 2
    TEX_K = 2.0                                          # dirt texel = 2 px at depth 0
    X0, W = c["world_x"], c["world_w"]

    # ---- ground: rows y 590..1080 ------------------------------------------
    gy0, gy1 = 590, 1080
    dirt = np.array(Image.open(OUT / "bg" / "dirt.webp").convert("RGB"))
    th, tw = dirt.shape[:2]
    mips = _mips(dirt)
    ys = gy0 + (np.arange((gy1 - gy0) * ss) + 0.5) / ss
    xs = X0 + (np.arange(W * ss) + 0.5) / ss
    k = np.clip((ys - vy) / H0, 1e-3, None)            # projection scale per row
    depth = P * (1.0 / k - 1.0)                          # depth (px at depth 0)
    out = np.zeros((len(ys), len(xs), 3), np.float32)
    for r, (kr, dr) in enumerate(zip(k, depth)):
        foot = P / (H0 * kr * kr) / ss / TEX_K           # texture px per output px (vertical)
        lvl = int(np.clip(np.log2(max(foot, 1.0)) + 0.5, 0, len(mips) - 1))
        xw = (xs - vx) / kr                              # lateral position on the ground
        u = np.mod(xw / TEX_K + tw / 2, tw).astype(np.int32)
        v = int(np.mod(dr / TEX_K, th))
        out[r] = mips[lvl][v, u]
    # road track: lighter between the fences, darker outside, two wheel ruts
    XW = (xs[None, :] - vx) / k[:, None]
    a = np.abs(XW)
    shade = np.interp(a, [0, 120, 230, 300, 380, RW - 80, RW, RW + 40, RW + 220], [1.12, 1.10, 1.02, 0.88, 1.03, 1.04, 0.86, 0.80, 0.74])
    out *= shade[:, :, None]
    # horizon haze
    haze = np.array([120, 70, 165], np.float32)
    hz = np.clip(1.0 - (ys - vy) / 95.0, 0, 1) ** 1.6
    out = out * (1 - hz[:, None, None]) + haze * hz[:, None, None]
    alpha = np.clip((ys - gy0) / 22.0, 0, 1)[:, None] * np.ones((1, len(xs)))
    rgba = np.dstack([np.clip(out, 0, 255), alpha * 255]).astype(np.uint8)
    rgba = np.array(Image.fromarray(rgba).resize((W, gy1 - gy0), Image.LANCZOS))
    rgba = _lay_front_road(rgba, X0, gy0, ss)
    MANIFEST["images"]["frontGround"] = {"src": save(rgba, "bg/front-ground.webp", 82), "w": W, "h": gy1 - gy0, "y": gy0}

    # ---- fences: rows y 420..1080 ------------------------------------------
    fy0, fy1 = 420, 1080
    # post centre to post centre (5 bays) = one seamless period
    fence = stretch_alpha(load("bg/fence_front_view_25x9.png"), lo=20)[505:880, 75:2027]
    fth, ftw = fence.shape[:2]
    fs = fth / FH                                                  # texture px per fence px
    fm = _mips(fence, levels=7)
    ys = fy0 + (np.arange((fy1 - fy0) * ss) + 0.5) / ss
    xs = X0 + (np.arange(W * ss) + 0.5) / ss
    acc = np.zeros((len(ys), len(xs), 4), np.float32)
    for side in (-1, 1):
        kc = side * (xs - vx) / RW                                 # projection scale per column
        ok = kc > 0.02
        kcs = np.where(ok, kc, 1.0)
        y_base = vy + H0 * kcs
        y_top = vy + (H0 - FH) * kcs
        dcol = P * (1.0 / kcs - 1.0)
        for ci in np.nonzero(ok)[0]:
            kk = kcs[ci]
            rows = np.nonzero((ys >= y_top[ci]) & (ys < y_base[ci]))[0]
            if not len(rows):
                continue
            foot = max(fs / (kk * ss), fs * P / (RW * kk * kk * ss))
            lvl = int(np.clip(np.log2(max(foot, 1.0)), 0, len(fm) - 1))
            h = (y_base[ci] - ys[rows]) / kk                       # height above ground
            tv = np.clip(((FH - h) * fs).astype(np.int32), 0, fth - 1)
            tu = int(np.mod(dcol[ci] * fs, ftw))
            px = fm[lvl][tv, tu]
            hz = np.clip(1.0 - (y_base[ci] - vy) / 95.0, 0, 1) ** 1.6
            px[:, :3] = px[:, :3] * (1 - hz) + haze * hz
            acc[rows, ci] = px
    rgba = np.array(Image.fromarray(np.clip(acc, 0, 255).astype(np.uint8)).resize((W, fy1 - fy0), Image.LANCZOS))
    MANIFEST["images"]["frontFences"] = {"src": save(rgba, "bg/front-fences.webp", 84), "w": W, "h": fy1 - fy0, "y": fy0}


# --------------------------------------------------------------------------- #
# walls
# --------------------------------------------------------------------------- #
# Wall art (black backdrop, the see-through part of each hole is black too):
#   wall/image copy 2.png  front view (flat face, round hole)
#   wall/image copy.png    three turned views, least to most turned
WALL_FRONT = "wall/image copy 2.png"
WALL_ANGLES = "wall/image copy.png"
# Front opening (rim on the wall face) of each turned wall, in its cropped
# webp px: centre, semi-axes, tilt (deg clockwise).  Direct ellipse fit
# (Fitzgibbon) to the rim highlight (lower left), the face/tunnel boundary
# (upper left) and the face's edge at the see-through part (right).  The side
# view's glass fills this ellipse.  Re-fit if the wall art changes.
WALL_RIMS = {"angle1": {"cx": 122.8, "cy": 285.1, "rx": 76.7, "ry": 130.9, "rot": 3.0}}


def _disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def _solid_wall(arr, r=9):
    """The art's bricks have rounded corners, so wherever two bricks meet the
    wall's outline (outer edge, hole edge) a small V-notch of backdrop shows
    through and the wall reads as loose blocks.  Close the outline (disk r)
    and fill the notches with the art's own mortar colour."""
    a = arr[:, :, 3].astype(np.float32) / 255.0
    solid = a > 0.5
    pad = r + 2
    closed = ndimage.binary_closing(np.pad(solid, pad), structure=_disk(r))[pad:-pad, pad:-pad]
    # soft edge for the filled outline
    cover = np.maximum(a, np.clip(ndimage.gaussian_filter(closed.astype(np.float32), 0.8) * 1.15 - 0.075, 0, 1))
    lum = arr[:, :, :3].astype(np.float32).mean(axis=2)
    mortar_px = solid & (lum < 70) & ndimage.binary_erosion(solid, iterations=3)
    mortar = np.median(arr[mortar_px][:, :3].astype(np.float32), axis=0) if mortar_px.any() else np.array([60, 25, 12], np.float32)
    add = (cover - a)[:, :, None]
    rgb = arr[:, :, :3].astype(np.float32) * a[:, :, None] + mortar * add
    out = arr.copy()
    out[:, :, :3] = np.clip(rgb / np.maximum(cover, 1e-6)[:, :, None], 0, 255).astype(np.uint8)
    out[:, :, 3] = np.clip(cover * 255, 0, 255).astype(np.uint8)
    return out


def _wall_part(arr):
    """Key the black backdrop and the hole to alpha, close the outline, crop."""
    arr = key_black(arr, lo=4, hi=22, min_area=2000)
    arr = _solid_wall(arr)
    bx0, by0, bx1, by1 = bbox(arr, thresh=40)
    return arr[by0:by1, bx0:bx1].copy()


def _wall_base(arr, thresh=128):
    """Base corners of a turned wall, as drawn: far = bottom of its left
    (far) edge, near = its lowest point (the near bottom corner)."""
    a = arr[:, :, 3] > thresh
    cols = np.where(a.any(axis=0))[0]
    x0 = int(cols[0])
    far_y = int(max(np.where(a[:, c])[0].max() for c in range(x0, x0 + 4)))
    bottoms = np.array([np.where(a[:, c])[0].max() if a[:, c].any() else -1 for c in range(a.shape[1])])
    near_y = int(bottoms.max())
    near_x = int(np.where(bottoms >= near_y - 1)[0].mean())
    return {"far": {"x": x0, "y": far_y}, "near": {"x": near_x, "y": near_y}}


def build_walls():
    print("walls")
    front = _wall_part(load(WALL_FRONT))
    MANIFEST["walls"]["front"] = {"src": save(front, "wall/front.webp", 88), "w": front.shape[1], "h": front.shape[0], "hole": interior_hole(front)}
    sheet = load(WALL_ANGLES)
    opaque = sheet[:, :, :3].max(axis=2) > 40
    cols = runs(opaque.sum(axis=0) > 5, min_len=60, merge_gap=8)
    assert len(cols) == 3, cols
    for name, (x0, x1) in zip(["angle1", "angle2", "angle3"], cols):
        part = _wall_part(sheet[:, max(0, x0 - 6):x1 + 6].copy())
        MANIFEST["walls"][name] = {"src": save(part, f"wall/{name}.webp", 88), "w": part.shape[1], "h": part.shape[0],
                                   "hole": interior_hole(part), "base": _wall_base(part)}
        if name in WALL_RIMS:
            MANIFEST["walls"][name]["rim"] = WALL_RIMS[name]


# --------------------------------------------------------------------------- #
# hero
# --------------------------------------------------------------------------- #
HERO_GRIDS = {
    "sideThrow": "boy/ChatGPT Image Nov 5, 2026, 03_48_02 PM-1.png",
    "sideCheer": "boy/ChatGPT Image Nov 5, 2026, 03_48_04 PM-2.png",
    "sideFear": "boy/ChatGPT Image Nov 5, 2026, 03_48_07 PM-3.png",
    "sideRun": "boy/ChatGPT Image Nov 5, 2026, 03_48_09 PM-4.png",
    "sideJump": "boy/ChatGPT Image Nov 5, 2026, 03_48_12 PM-5.png",
    "backThrow": "boy/ChatGPT Image Nov 5, 2026, 03_48_14 PM-6.png",
    "backCheer": "boy/ChatGPT Image Nov 5, 2026, 03_48_16 PM-7.png",
    "backFear": "boy/ChatGPT Image Nov 5, 2026, 03_48_21 PM-8.png",
    "backRun": "boy/ChatGPT Image Nov 5, 2026, 03_48_22 PM-9.png",
    "backJump": "boy/ChatGPT Image Nov 5, 2026, 03_48_24 PM-10.png",
}
CELL = 362
COLS, ROWS = 4, 3


def build_hero():
    print("hero")
    for key, rel in HERO_GRIDS.items():
        arr = load(rel)
        # component filter removes the haze on the back-cheer sheet and the
        # stray streak on the side-fear sheet; harmless on the clean sheets.
        arr = keep_big_components(arr, thresh=140, min_area=6000, grow=3)
        arr = stretch_alpha(arr, lo=30)
        h, w = arr.shape[:2]
        canvas = np.zeros((ROWS * CELL, COLS * CELL, 4), np.uint8)
        canvas[:h, :w] = arr[: ROWS * CELL, : COLS * CELL]
        MANIFEST["sprites"][f"hero.{key}"] = {
            "src": save(canvas, f"hero/{key}.webp", 86),
            "fw": CELL, "fh": CELL, "cols": COLS, "rows": ROWS, "frames": COLS * ROWS,
            "anchorY": 0.95,
        }

    build_hero_leap()

    # Idle sheet: left half = side idle (4x3), right half = back idle (4x3), uneven spacing.
    arr = stretch_alpha(load("boy/Side and Back Idle Animation Sprite Sheet.png"), lo=30)
    arr = keep_big_components(arr, thresh=140, min_area=6000, grow=3)
    for key, (xa, xb) in {"sideIdle": (0, 724), "backIdle": (724, 1448)}.items():
        half = arr[:, xa:xb]
        canvas = np.zeros((ROWS * CELL, COLS * CELL, 4), np.uint8)
        for r in range(ROWS):
            band = half[r * CELL:(r + 1) * CELL]
            cols = runs((band[:, :, 3] > 40).any(axis=0), min_len=60, merge_gap=12)
            assert len(cols) == 4, (key, r, cols)
            for c, (x0, x1) in enumerate(cols):
                fig = band[:, x0:x1]
                fw = x1 - x0
                dx = c * CELL + (CELL - fw) // 2
                canvas[r * CELL:(r + 1) * CELL, dx:dx + fw] = fig
        MANIFEST["sprites"][f"hero.{key}"] = {
            "src": save(canvas, f"hero/{key}.webp", 86),
            "fw": CELL, "fh": CELL, "cols": COLS, "rows": ROWS, "frames": COLS * ROWS,
            "anchorY": 0.95,
        }


LEAP_W, LEAP_H = 420, 362          # wider cell: the mid-air strides are long
LEAP_GROUND = round(0.95 * LEAP_H)  # feet line, matches anchorY


def build_hero_leap():
    """boy/jump.png -> hero.sideLeap: the run-up leap through the wall circle.
    4x3 sheet with uneven spacing: row 0 stand -> crouch -> take-off, row 1
    mid-air, row 2 landing -> stand.  Each figure is re-packed into a fixed
    cell, torso centred, feet on the shared ground line."""
    arr = keep_big_components(load("boy/jump.png"), thresh=140, min_area=6000, grow=3)
    arr = stretch_alpha(arr, lo=30)
    mask = arr[:, :, 3] > 140
    lab, n = ndimage.label(mask)
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    figs = [sl for i, sl in enumerate(ndimage.find_objects(lab)) if sizes[i] >= 6000]
    assert len(figs) == 12, len(figs)
    rows = sorted(figs, key=lambda s: (s[0].start + s[0].stop) / 2)
    rows = [sorted(rows[r * 4:(r + 1) * 4], key=lambda s: s[1].start) for r in range(3)]
    # sheet y of the ground under each row; row 1 is all mid-air, so place its
    # lowest foot a little above the ground (continues the take-off frame).
    ground = [max(s[0].stop for s in rows[0]), max(s[0].stop for s in rows[1]) + 17, max(s[0].stop for s in rows[2])]
    canvas = np.zeros((3 * LEAP_H, 4 * LEAP_W, 4), np.uint8)
    pad = 4
    for r, row in enumerate(rows):
        for c, (ys, xs) in enumerate(row):
            y0, y1 = max(ys.start - pad, 0), min(ys.stop + pad, arr.shape[0])
            x0, x1 = max(xs.start - pad, 0), min(xs.stop + pad, arr.shape[1])
            fig = arr[y0:y1, x0:x1]
            fh, fw = fig.shape[:2]
            # torso x = alpha centroid of the upper 45% (head + chest)
            top = fig[: int(fh * 0.45), :, 3].astype(np.float32)
            tx = float((top.sum(axis=0) * np.arange(fw)).sum() / max(top.sum(), 1))
            dx = int(np.clip(round(LEAP_W / 2 - tx), 0, LEAP_W - fw))
            dy = LEAP_GROUND - (ground[r] - y0)
            sy0, sy1 = max(0, -dy), min(fh, LEAP_H - dy)
            cy, cx = r * LEAP_H + dy + sy0, c * LEAP_W + dx
            canvas[cy:cy + sy1 - sy0, cx:cx + fw] = fig[sy0:sy1]
    MANIFEST["sprites"]["hero.sideLeap"] = {
        "src": save(canvas, "hero/sideLeap.webp", 86),
        "fw": LEAP_W, "fh": LEAP_H, "cols": 4, "rows": 3, "frames": 12,
        "anchorY": 0.95,
    }


# --------------------------------------------------------------------------- #
# zombie
# --------------------------------------------------------------------------- #
def key_light_background(arr, band):
    """Make the light reference-card background transparent (flood by component)."""
    rgb = arr[:, :, :3].astype(int)
    a = arr[:, :, 3]
    light = (rgb.min(axis=2) > 200) & (a > 0)
    lab, n = ndimage.label(light)
    if n == 0:
        return arr
    y0, y1 = band
    sizes = ndimage.sum(light[y0:y1], lab[y0:y1], range(1, n + 1))
    bg_id = int(np.argmax(sizes)) + 1
    bg = lab == bg_id
    edge = ndimage.binary_dilation(bg, iterations=1) & ~bg
    bright = rgb.mean(axis=2) > 185
    out = arr.copy()
    out[:, :, 3] = np.where(bg, 0, a)
    soft = edge & bright
    out[soft, 3] = (out[soft, 3] * 0.45).astype(np.uint8)
    return out


ZOMBIE_FRONT = {
    "idle": ("zombi/zombie_front_idle.png", 8, True),
    "run": ("zombi/zombie_front_run.png", 16, True),
    "attack": ("zombi/zombie_front_attack.png", 16, False),
    "hit": ("zombi/zombie_front_hit.png", 8, False),
    "die": ("zombi/zombie_front_die.png", 16, False),
    "dead": ("zombi/zombie_front_dead.png", 1, False),
}
ZOMBIE_SIDE = {
    "idle": ("zombi/zombie_side_idle.png", 4, 2, True),
    "run": ("zombi/zombie_side_run.png", 4, 4, True),
    "attack": ("zombi/zombie_side_attack.png", 4, 4, False),
    "hit": ("zombi/zombie_side_hit.png", 4, 2, False),
    "die": ("zombi/zombie_side_die.png", 4, 4, False),
    "dead": ("zombi/zombie_side_dead.png", 1, 1, False),
}
# Single-pose sheets are drawn at a different scale than their animations;
# scaleAdjust tells the runtime how to match them to the last "die" frame.
# The leap sheet is drawn a touch larger than the side run/attack sheets.
SCALE_ADJUST = {"zombie.side.dead": 0.6, "zombie.front.dead": 0.22, "zombie.side.leap": 0.9}


def build_zombie_leap():
    """zombi/image.png -> zombie.side.leap: the jump through the wall circle
    at the hero.  4x4 grid of 320x384 cells, feet on y=348 in every cell:
    0-1 crouch, 2-6 airborne, 7-11 land, 12-14 attack-ready (15 faces the
    other way; unused).  Each frame is shifted so the shirt (the most stable
    part of a leaping body) sits at the cell centre."""
    arr = stretch_alpha(load("zombi/image.png"), lo=20)
    arr = keep_big_components(arr, thresh=140, min_area=6000, grow=3)
    FW, FH, COLS, ROWS = 320, 384, 4, 4
    rgb = arr[:, :, :3].astype(int)
    shirt = (rgb[:, :, 2] > 150) & (rgb[:, :, 2] > rgb[:, :, 0] + 30) & (arr[:, :, 3] > 200)
    canvas = np.zeros_like(arr)
    for r in range(ROWS):
        for c in range(COLS):
            ys, xs = slice(r * FH, (r + 1) * FH), slice(c * FW, (c + 1) * FW)
            cell, sx = arr[ys, xs], np.nonzero(shirt[ys, xs])[1]
            dx = int(round(FW / 2 - sx.mean())) if len(sx) else 0
            src0, src1 = max(0, -dx), min(FW, FW - dx)
            canvas[ys, c * FW + src0 + dx:c * FW + src1 + dx] = cell[:, src0:src1]
    MANIFEST["sprites"]["zombie.side.leap"] = {
        "src": save(canvas, "zombie/side-leap.webp", 86),
        "fw": FW, "fh": FH, "cols": COLS, "rows": ROWS, "frames": COLS * ROWS, "loop": False,
        "anchorY": round(348.5 / FH, 4), "facing": "left",
    }


def build_zombie():
    print("zombie")
    for key, (rel, expected, loop) in ZOMBIE_FRONT.items():
        raw = load(rel)
        h, w = raw.shape[:2]
        band = (54, h - 40)
        # Frame centres come from the lavender number pills under each frame
        # (figures may touch each other, pills never do).
        foot = raw[h - 38:h - 8].astype(int)
        spread = foot[:, :, :3].max(axis=2) - foot[:, :, :3].min(axis=2)
        pill = (foot[:, :, 3] > 0) & (spread > 14) & (foot[:, :, :3].mean(axis=2) > 120)
        pills = runs(pill.any(axis=0), min_len=18, merge_gap=8)
        centers = [(x0 + x1) / 2 for x0, x1 in pills]
        if expected > 1 and len(centers) != expected:
            # a merged or split pill: rebuild the centres from the median spacing
            gaps = np.diff(centers)
            step = float(np.median(gaps)) if len(gaps) else 0
            print(f"  note {key}: found {len(centers)} pills, expected {expected}; using median spacing {step:.1f}")
            centers = [centers[0] + i * step for i in range(expected)]
        arr = key_light_background(raw, band)
        strip = arr[band[0]:band[1]]
        strip = keep_big_components(strip, thresh=60, min_area=400, grow=2)
        if len(centers) > 1:
            spacing = (centers[-1] - centers[0]) / (len(centers) - 1)
        else:
            x0, _, x1, _ = bbox(strip)
            spacing = (x1 - x0) + 8
            centers = [(x0 + x1) / 2]
        fw = int(round(spacing)) + 4
        fh = strip.shape[0]
        canvas = np.zeros((fh, fw * len(centers), 4), np.uint8)
        for i, c in enumerate(centers):
            x0 = int(round(c - fw / 2))
            x1 = x0 + fw
            sx0, sx1 = max(x0, 0), min(x1, w)
            fig = strip[:, sx0:sx1]
            dx = i * fw + (sx0 - x0)
            canvas[:, dx:dx + fig.shape[1]] = fig
        cols = centers
        MANIFEST["sprites"][f"zombie.front.{key}"] = {
            "src": save(canvas, f"zombie/front-{key}.webp", 86),
            "fw": fw, "fh": fh, "cols": len(cols), "rows": 1, "frames": len(cols), "loop": loop,
            "anchorY": 0.97,
        }

    for key, (rel, cols, rows, loop) in ZOMBIE_SIDE.items():
        arr = stretch_alpha(load(rel), lo=20)
        h, w = arr.shape[:2]
        fw, fh = w // cols, h // rows
        MANIFEST["sprites"][f"zombie.side.{key}"] = {
            "src": save(arr, f"zombie/side-{key}.webp", 86),
            "fw": fw, "fh": fh, "cols": cols, "rows": rows, "frames": cols * rows, "loop": loop,
            "anchorY": 0.83, "facing": "left",
        }
    build_zombie_leap()


# --------------------------------------------------------------------------- #
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    build_layers()
    build_walls()
    build_hero()
    build_zombie()
    for key, adj in SCALE_ADJUST.items():
        if key in MANIFEST["sprites"]:
            MANIFEST["sprites"][key]["scaleAdjust"] = adj
    with open(OUT / "manifest.json", "w") as f:
        json.dump(MANIFEST, f, indent=1)
    # Classic-script copy so the game also runs from file:// (no fetch/CORS).
    with open(OUT / "manifest.js", "w") as f:
        f.write("// generated by tools/build-assets.py - do not edit\n")
        f.write("window.ZD_MANIFEST = " + json.dumps(MANIFEST) + ";\n")
    total = sum(p.stat().st_size for p in OUT.rglob("*.webp"))
    print(f"done: {len(list(OUT.rglob('*.webp')))} files, {total/1024/1024:.2f} MB -> {OUT}")


if __name__ == "__main__":
    main()
