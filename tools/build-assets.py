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
       python3 tools/build-assets.py --only zombie   (zombie sheets only)
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

import sprite_stabilizer as S   # tools/sprite_stabilizer.py: frame-by-frame sprite registration

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
HERO_IDLE = "boy/Side and Back Idle Animation Sprite Sheet.png"   # left half side, right half back
CELL = 362
COLS, ROWS = 4, 3
HERO_SHADOW = CELL // 2       # constant shadow width: no pop when the sheet changes
# How each sheet is stabilised (tools/sprite_stabilizer.py).  "plant": the
# boots stay put, airborne frames (cheer / jump) keep their height above the
# ground line of their grid row.  "body": in-place run, the head is the
# anchor.  harmonics: loops keep 1 (idle sway / breathing) or 2 (two steps
# per run cycle) smooth cycles of head motion; the rest is drawing noise.
HERO_ANIM = {
    "sideIdle": {"mode": "plant", "loop": True, "harmonics": 1},
    "backIdle": {"mode": "plant", "loop": True, "harmonics": 1},
    "sideRun": {"mode": "body", "loop": True, "harmonics": 2, "max_squash": 0.08},
    "backRun": {"mode": "body", "loop": True, "harmonics": 2, "max_squash": 0.08},
}
HERO_HAZE = {"backCheer"}     # smoky background residue around the figure


def _hero_frames(key):
    """The 12 figures of a hero sheet, cleaned, each with the top-left of its
    crop in the cell it had in the previous (unregistered) build - that is
    what the game's hand / core offsets were measured on."""
    if key in ("sideIdle", "backIdle"):
        arr = stretch_alpha(load(HERO_IDLE), lo=30)
        arr = keep_big_components(arr, thresh=140, min_area=6000, grow=3)
        xa = 0 if key == "sideIdle" else 724
        half = arr[:, xa:xa + 724]
        figs = S.extract_grid(half, COLS, ROWS)
        old = []
        for k, (fig, x0, y0) in enumerate(figs):
            # the old build centred each figure's column run in its cell
            r, c = divmod(k, COLS)
            band = half[r * CELL:(r + 1) * CELL]
            rx0, rx1 = runs((band[:, :, 3] > 40).any(axis=0), min_len=60, merge_gap=12)[c]
            old.append((x0 - rx0 + (CELL - (rx1 - rx0)) // 2, y0 - r * CELL))
    else:
        arr = load(HERO_GRIDS[key])
        # component filter removes the haze blobs on the back-cheer sheet and
        # the stray streak on the side-fear sheet
        arr = keep_big_components(arr, thresh=140, min_area=6000, grow=3)
        arr = stretch_alpha(arr, lo=30)
        figs = S.extract_grid(arr[:ROWS * CELL, :COLS * CELL], COLS, ROWS)
        old = [(x0 - (k % COLS) * CELL, y0 - (k // COLS) * CELL) for k, (_, x0, y0) in enumerate(figs)]
    haze = key in HERO_HAZE
    return [S.defringe(f, haze=haze) for f, _, _ in figs], old


def build_hero():
    """Hero sheets, re-registered frame by frame (see sprite_stabilizer).
    The anchor keeps its old place on the body - CELL/2 right of and
    0.95*CELL down from the cell corner in the old build, measured on the
    idle sheets per view - so the game's hand / core offsets still hold, but
    now it is the same point in every frame of every sheet."""
    print("hero")
    sheets = {k: _hero_frames(k) for k in ["sideIdle", "backIdle", *HERO_GRIDS]}
    line0 = 0.95 * CELL
    calib = {}
    for view in ("side", "back"):
        figs, old = sheets[f"{view}Idle"]
        tr = S.track(figs, 300)
        stand = float(np.median([m["ground"] - m["top"] for m in tr]))
        calib[view] = {
            "stand": stand,
            # anchor offset from the boots, and how far the feet sat below the line
            "dx": float(np.median([CELL / 2 - (o[0] + m["bx"]) for m, o in zip(tr, old)])),
            "sink": float(np.median([(o[1] + m["ground"]) - line0 for m, o in zip(tr, old)])),
        }
        print(f"  {view}: stand {stand:.0f}px, anchor {calib[view]['dx']:+.1f}px from the boots, feet {calib[view]['sink']:.1f}px below it")
    for key, (figs, old) in sheets.items():
        view = "side" if key.startswith("side") else "back"
        cal = calib[view]
        opt = dict(HERO_ANIM.get(key, {"mode": "plant", "loop": False}))
        tr = S.track(figs, cal["stand"])
        if opt["mode"] == "plant" and not opt["loop"]:
            opt["lift"] = S.grid_lift([o[1] + m["ground"] for m, o in zip(tr, old)], COLS, cal["stand"])
        if opt["mode"] == "body":
            # keep the sheet's own average place of the anchor on the body
            opt["x_offset"] = float(np.median([CELL / 2 - (o[0] + m["hx"]) for m, o in zip(tr, old)]))
        print(f"  hero.{key}")
        frames, anchors, info = S.stabilize(figs, cal["stand"], log=print, **opt)
        dx = cal["dx"] if opt["mode"] == "plant" else 0.0
        anchors = [(ax + dx, ay - cal["sink"]) for ax, ay in anchors]
        sheet, meta = S.pack(frames, anchors)
        MANIFEST["sprites"][f"hero.{key}"] = dict(
            {"src": save(sheet, f"hero/{key}.webp", 86)}, **meta,
            loop=bool(opt["loop"]), shadowW=HERO_SHADOW)

    build_hero_leap()


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
        "anchorY": 0.95, "shadowW": HERO_SHADOW,
    }


# --------------------------------------------------------------------------- #
# zombies
# --------------------------------------------------------------------------- #
# Two zombie skins share one set of animation names: "zombie.*" is the
# messy-haired road worker (assets/images/zombi-1), "zombie2.*" the hard-hat
# worker (assets/images/zombi-2).  The runtime picks a skin per wall
# (ZD.Sprite.setSkin), so game code only ever names "zombie.<view>.<action>".
#
# The source sheets are AI-drawn: every figure is centred in its own cell and
# different sheets are drawn at different sizes, which plays back as jiggle
# and size pops.  So every frame is re-registered:
#   * scale  - one factor per source image, from the figure's area (sqrt of
#              its opaque pixels barely changes with pose), so every sheet of
#              a skin matches its idle sheet and both skins share one standing
#              height per view (Z_STAND);
#   * x      - an anchor that should not move in the world: planted feet
#              (idle, attack) or the torso = hi-vis vest (run, hit, die, leap);
#   * y      - the lowest pixel sits on the ground line; airborne leap frames
#              keep their torso a fixed `core` above it instead (that is the
#              point the game flies along the arc through the circle).
# Frames are re-packed into 4-column grids with the anchor at the cell's
# horizontal centre and at anchorY, so flipping and the runtime anchor agree.

Z_STAND = {"front": 330, "side": 340}   # standing height in sheet px
Z_SCREEN = {"front": 145, "side": 188}  # standing height at sprite scale 1 (old art: 138 / 176)
Z_PAD = 6


def P(src, cols, rows, ref="all"):
    """One source image: grid size, and the upright frames used to measure
    its scale ("all" for sheets that never leave an upright pose)."""
    return {"src": src, "cols": cols, "rows": rows, "ref": ref}


# anchor: feet | torso | dead (match the last frame of `die`)
# airborne: leap frames placed by torso height instead of feet
# derive: build from another action's frames; hold: repeat every frame n times
ZOMBIE_SRC = {
    "zombie": {
        "dir": "zombi-1",
        "front": {
            "idle": {"parts": [P("Idle — 8 frames (4×2).png", 4, 2)], "anchor": "feet", "loop": True},
            "run": {"parts": [P("Complete running animation — 16 frames (4×4).png", 4, 4)], "anchor": "torso", "loop": True},
            # 8 frames; held x2 so it lasts as long as the 16-frame zombie2 bang
            "attack": {"parts": [P("image.png", 4, 2, [0, 4])], "anchor": "feet", "hold": 2},
            "hit": {"parts": [P("image copy.png", 4, 2, [0, 7])], "anchor": "torso"},
            "die": {"parts": [P("image copy 2.png", 4, 2, [0]), P("image copy 3.png", 4, 2, [0])], "anchor": "torso"},
            "dead": {"parts": [P("image copy 4.png", 1, 1)], "anchor": "dead"},
        },
        "side": {
            "idle": {"parts": [P("image copy 5.png", 4, 2)], "anchor": "feet", "loop": True},
            "run": {"parts": [P("Complete 16-frame sheet side view.png", 4, 4)], "anchor": "torso", "loop": True},
            "attack": {"parts": [P("Complete 16-frame sprite sheet attack side view.png", 4, 4, [0, 15])], "anchor": "feet"},
            # part 2 frame 0 wears a dizzy halo on the hair: measure on 1-2
            "die": {"parts": [P("image copy 6.png", 4, 2, [0]), P("image copy 7.png", 4, 2, [1, 2])], "anchor": "torso"},
            # no side-hit sheet for this skin: the first beats of `die` there and
            # back, ending on the struck pose (die / the run-back follow on)
            "hit": {"derive": ("die", [0, 1, 2, 3, 4, 3, 2, 1]), "anchor": "torso"},
            "dead": {"parts": [P("image copy 8.png", 1, 1)], "anchor": "dead"},
            "leap": {"parts": [P("Complete 16-frame sprite sheet jumping inside of the wall.png", 4, 4, [12, 13, 14, 15])],
                     "anchor": "torso", "airborne": [3, 4, 5, 6]},
        },
    },
    "zombie2": {
        "dir": "zombi-2",
        "front": {
            "idle": {"parts": [P("image.png", 4, 2)], "anchor": "feet", "loop": True},
            "run": {"parts": [P("image copy.png", 4, 2)], "anchor": "torso", "loop": True},
            "attack": {"parts": [P("image copy 2.png", 4, 2, [0, 4]), P("image copy 3.png", 4, 2, [0, 1])], "anchor": "feet"},
            "hit": {"parts": [P("image copy 5.png", 4, 2, [0, 7])], "anchor": "torso"},
            "die": {"parts": [P("image copy 4.png", 4, 2, [0]), P("image copy 6.png", 4, 2, [0])], "anchor": "torso"},
            "dead": {"parts": [P("image copy 7.png", 1, 1)], "anchor": "dead"},
        },
        "side": {
            "idle": {"parts": [P("image copy 8.png", 4, 2)], "anchor": "feet", "loop": True},
            "run": {"parts": [P("image copy 9.png", 4, 2), P("image copy 10.png", 4, 2)], "anchor": "torso", "loop": True},
            "attack": {"parts": [P("image copy 11.png", 4, 2, [0]), P("image copy 12.png", 4, 2, [7])], "anchor": "feet"},
            "hit": {"parts": [P("image copy 13.png", 4, 2, [0, 7])], "anchor": "torso"},
            "die": {"parts": [P("image copy 14.png", 4, 2, [0]), P("image copy 15.png", 4, 2, [0])], "anchor": "torso"},
            "dead": {"parts": [P("image copy 16.png", 1, 1)], "anchor": "dead"},
            "leap": {"parts": [P("image copy 18.png", 4, 2, [0, 1]), P("image copy 19.png", 4, 2, [6, 7])],
                     "anchor": "torso", "airborne": [3, 4, 5, 6]},
        },
    },
}
# order matters: `hit` may derive from `die`, `dead` matches the end of `die`
Z_ORDER = ["idle", "run", "attack", "die", "hit", "dead", "leap"]
# Frame stabilisation (tools/sprite_stabilizer.py) on top of the registration
# above: head tracked per frame, its path smoothed, a small feet-anchored
# shear / stretch per frame removes the drawing's lean and bob jitter.  An
# idle sways once per loop, a run cycle has two steps (two bobs) per loop.
# die / dead / hit / leap keep the plain registration (the head turns over,
# or the frames follow the game's arc), and so does the side attack: its
# lunge carries the head further than the tracker follows (measured: the
# boots slid 2-4 px with it, 0.7-1.3 px without).  Keys: "<view>.<action>"
# or "<action>" for both views.
Z_STAB = {
    "idle": {"mode": "plant", "loop": True, "harmonics": 1},
    "run": {"mode": "body", "loop": True, "harmonics": 2, "max_squash": 0.08},
    "front.attack": {"mode": "plant", "loop": False},
}


def _hsv(rgb):
    rgb = rgb.astype(np.float32) / 255
    mx, mn = rgb.max(2), rgb.min(2)
    d = mx - mn
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros_like(mx)
    m = d > 1e-6
    rr = m & (mx == r)
    gg = m & (mx == g) & ~rr
    bb = m & ~rr & ~gg
    h[rr] = ((g - b)[rr] / d[rr]) % 6
    h[gg] = ((b - r)[gg] / d[gg]) + 2
    h[bb] = ((r - g)[bb] / d[bb]) + 4
    return h * 60, np.where(mx > 0, d / np.maximum(mx, 1e-6), 0), mx


def _figures_in_grid(arr, cols, rows, near=45):
    """Split a sheet into one isolated figure per cell.  Components are
    assigned to the cell holding their centre (a figure may overhang its
    cell); small bits (stars, dizzy swirls, impact marks) are kept when they
    float near the figure, haze and specks are dropped."""
    H, W = arr.shape[:2]
    cw, ch = W / cols, H / rows
    m = arr[:, :, 3] > 90
    lab, n = ndimage.label(m)
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    coms = ndimage.center_of_mass(m, lab, range(1, n + 1))
    cells = {}
    for i, (sz, (cy, cx)) in enumerate(zip(sizes, coms)):
        if sz < 30:
            continue
        k = min(rows - 1, int(cy // ch)) * cols + min(cols - 1, int(cx // cw))
        cells.setdefault(k, []).append((i + 1, sz))
    objs = ndimage.find_objects(lab)
    out = []
    for k in range(cols * rows):
        comps = cells.get(k)
        assert comps, f"empty cell {k}"
        big = max(s for _, s in comps)
        main = [i for i, s in comps if s >= 0.2 * big]
        # work in a window around the figure (dilating whole sheets is slow)
        y0 = max(0, min(objs[i - 1][0].start for i, _ in comps) - near - 4)
        y1 = min(H, max(objs[i - 1][0].stop for i, _ in comps) + near + 4)
        x0 = max(0, min(objs[i - 1][1].start for i, _ in comps) - near - 4)
        x1 = min(W, max(objs[i - 1][1].stop for i, _ in comps) + near + 4)
        wl = lab[y0:y1, x0:x1]
        around = ndimage.binary_dilation(np.isin(wl, main), iterations=near)
        extra = [i for i, s in comps if i not in main and (around & (wl == i)).any()]
        keep = ndimage.binary_dilation(np.isin(wl, main + extra), iterations=2)
        fig = np.where(keep[:, :, None], arr[y0:y1, x0:x1], 0).astype(np.uint8)
        out.append(_crop(_drop_painted_background(fig)))
    return out


def _drop_painted_background(fig):
    """Remove background the generator painted in as opaque pixels: pale grey
    ground shadows under the feet, and near-white pockets (e.g. the gap
    between the legs).  Both lie outside the outline, so they touch the
    transparent background; grey or white parts of the figure itself (a
    sneaker, eye whites) are enclosed by the outline and stay."""
    a = fig[:, :, 3]
    ys = np.nonzero((a > 90).any(1))[0]
    if not len(ys):
        return fig
    y1 = ys[-1] + 1
    hgt = y1 - ys[0]
    rgb = fig[:, :, :3].astype(int)
    chroma = rgb.max(2) - rgb.min(2)
    lum = rgb.mean(2)
    band = np.zeros(a.shape, bool)
    band[max(0, y1 - int(0.2 * hgt)):y1] = True
    # light neutrals anywhere (white pockets), mid greys near the ground
    # (shadows); a blob is background when it is reached from the transparent
    # area along a real edge, not through a one-pixel anti-aliasing gap
    light = (a > 20) & (chroma < 35) & (rgb.min(2) > 170)
    grey = band & (a > 20) & (chroma < 40) & (lum > 95) & (lum < 205)
    clear_edge = ndimage.binary_dilation(a < 20, iterations=1)
    out = fig.copy()
    lab, n = ndimage.label(light | grey)
    if not n:
        return out
    contact = ndimage.sum(clear_edge, lab, range(1, n + 1))
    size = ndimage.sum(np.ones_like(a, bool), lab, range(1, n + 1))
    drop = [i + 1 for i in range(n) if contact[i] >= 8 and size[i] >= 40]
    out[np.isin(lab, drop)] = 0
    # pockets closed off by the legs and the painted ground line: pure
    # off-white, sizeable, below the waist (teeth, eyes and the vest stripe
    # are tinted, small, or higher up)
    pocket = (out[:, :, 3] > 20) & (chroma < 14) & (rgb.min(2) > 232)
    pocket[: ys[0] + int(0.55 * hgt)] = False
    lab, n = ndimage.label(pocket)
    if n:
        size = ndimage.sum(pocket, lab, range(1, n + 1))
        out[np.isin(lab, [i + 1 for i in range(n) if size[i] >= 60])] = 0
    return out


def _crop(arr, pad=2):
    ys, xs = np.nonzero(arr[:, :, 3] > 8)
    y0, y1 = max(0, ys.min() - pad), min(arr.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(arr.shape[1], xs.max() + 1 + pad)
    return arr[y0:y1, x0:x1].copy()


def _resize(arr, s):
    """Premultiplied Lanczos resize (no dark or light halos at the edges)."""
    h, w = arr.shape[:2]
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    a = arr[:, :, 3].astype(np.float32) / 255
    pm = arr[:, :, :3].astype(np.float32) * a[:, :, None]
    f = lambda ch: np.array(Image.fromarray(ch).resize((nw, nh), Image.LANCZOS))
    al = np.clip(f(a), 0, 1)
    rgb = np.stack([f(np.ascontiguousarray(pm[:, :, i])) for i in range(3)], 2) / np.maximum(al[:, :, None], 1e-3)
    out = np.dstack([np.clip(rgb, 0, 255), al * 255])
    out[al < 0.02] = 0
    return out.round().astype(np.uint8)


def _area(fig):
    return float(np.sqrt((fig[:, :, 3] > 128).sum()))


def _head(fig, band):
    """Width of the head (hair / hard hat): the widest blob in the top `band`
    rows of the main body.  The head is rigid, so it is the best ruler for
    matching sizes across sheets; floating stars/swirls are ignored."""
    a = fig[:, :, 3] > 128
    lab, n = ndimage.label(a)
    if not n:
        return np.nan
    body = lab == (int(np.argmax(ndimage.sum(a, lab, range(1, n + 1)))) + 1)
    y0 = int(np.nonzero(body.any(1))[0][0])
    top = np.zeros_like(body)
    top[y0:y0 + int(band)] = body[y0:y0 + int(band)]
    lab, n = ndimage.label(top)
    if not n:
        return np.nan
    sl = ndimage.find_objects(lab)[int(np.argmax(ndimage.sum(top, lab, range(1, n + 1))))]
    return float(sl[1].stop - sl[1].start)


def _head_scale(figs, s, stand, head_ref):
    """Correct an area-based scale `s` so the median head width of `figs`
    matches the idle sheet's (`head_ref`, in output px).  Clamped: a sheet
    drawn in a very different pose must not be blown up or shrunk."""
    band = 0.18 * stand / s
    hw = np.array([_head(f, band) * s for f in figs])
    hw = hw[np.isfinite(hw)]
    hw = hw[(hw > 0.6 * head_ref) & (hw < 1.5 * head_ref)]
    if not len(hw):
        return s
    return s * float(np.clip(head_ref / np.median(hw), 0.8, 1.25))


def _measure(fig, stand):
    """Anchors of one scaled figure (cell-local px)."""
    a = fig[:, :, 3] > 90
    ys, xs = np.nonzero(a)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    h, s, v = _hsv(fig[:, :, :3])
    vest = (fig[:, :, 3] > 200) & (h > 8) & (h < 32) & (s > 0.6) & (v > 0.75)
    lab, n = ndimage.label(vest)
    if n:
        sizes = ndimage.sum(vest, lab, range(1, n + 1))
        vest = np.isin(lab, [i + 1 for i, sz in enumerate(sizes) if sz >= 0.25 * sizes.max()])
    if vest.sum() > 50:
        ty, tx = ndimage.center_of_mass(vest)
    else:
        ty, tx = ndimage.center_of_mass(a)
    # feet: the bottom band, laces / thin strands opened away
    band = np.zeros_like(a)
    bh = max(6, int(0.07 * stand))
    band[max(0, y1 - bh):y1] = a[max(0, y1 - bh):y1]
    opened = ndimage.binary_opening(band, structure=np.ones((5, 5)))
    fx = ndimage.center_of_mass(opened if opened.sum() > 20 else band)[1]
    return {"x0": x0, "x1": x1, "y0": y0, "y1": y1, "tx": tx, "ty": ty, "fx": fx, "cx": (x0 + x1) / 2}


def _place(frames, anchors, loop):
    """Pack figures into a 4-column grid; anchor (ax, ay) -> cell centre x,
    shared anchor line y.  Returns (canvas, manifest fields)."""
    left = max(ax - m["x0"] for (ax, ay), m in anchors)
    right = max(m["x1"] - ax for (ax, ay), m in anchors)
    top = max(ay - m["y0"] for (ax, ay), m in anchors)
    bottom = max(0, max(m["y1"] - ay for (ax, ay), m in anchors))
    half = int(np.ceil(max(left, right))) + Z_PAD
    fw = 2 * half
    fh = int(np.ceil(top + bottom)) + 2 * Z_PAD
    fh += fh % 2
    line = Z_PAD + int(np.ceil(top))
    n = len(frames)
    cols = min(4, n)
    rows = (n + cols - 1) // cols
    canvas = np.zeros((rows * fh, cols * fw, 4), np.uint8)
    for k, (fig, ((ax, ay), m)) in enumerate(zip(frames, anchors)):
        r, c = divmod(k, cols)
        dx = int(round(half - ax))
        dy = int(round(line - ay))
        h, w = fig.shape[:2]
        sy0, sx0 = max(0, -dy), max(0, -dx)
        sy1, sx1 = min(h, fh - dy), min(w, fw - dx)
        cell = canvas[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw]
        src = fig[sy0:sy1, sx0:sx1]
        dst = cell[dy + sy0:dy + sy1, dx + sx0:dx + sx1]
        np.copyto(dst, src, where=src[:, :, 3:4] > dst[:, :, 3:4])
    return canvas, {"fw": fw, "fh": fh, "cols": cols, "rows": rows, "frames": n, "loop": loop,
                    "anchorY": round(line / fh, 4)}


def _skin_sheets(skin, cfg, view):
    """Registered frames for one skin + view: {action: (frames, anchors, spec)}."""
    stand = Z_STAND[view]
    base = SRC / cfg["dir"]
    raw = {}
    for act in Z_ORDER:
        spec = cfg[view].get(act)
        if not spec or "parts" not in spec:
            continue
        parts = []
        for p in spec["parts"]:
            arr = np.array(Image.open(base / p["src"]).convert("RGBA"))
            figs = _figures_in_grid(stretch_alpha(arr, lo=20, hi=200), p["cols"], p["rows"])
            # matting specks and white-tinted edges differ per frame and sparkle
            figs = [S.defringe(f) for f in figs]
            parts.append((p, figs))
        raw[act] = parts
    # scale: idle sets the skin's standing height, everything else matches its area
    idle = [f for _, figs in raw["idle"] for f in figs]
    s_idle = stand / float(np.median([f.shape[0] - 4 for f in idle]))
    a_idle = float(np.median([_area(f) for f in idle]))
    head_idle = float(np.nanmedian([_head(f, 0.18 * stand / s_idle) * s_idle for f in idle]))
    out = {}
    for act in Z_ORDER:
        spec = cfg[view].get(act)
        if not spec:
            continue
        if "derive" in spec:
            src_act, idx = spec["derive"]
            sf, sa, _ = out[src_act]
            out[act] = ([sf[i] for i in idx], [sa[i] for i in idx], spec)
            continue
        frames, meas, srcs, scales = [], [], [], []
        for p, figs in raw[act]:
            if spec["anchor"] == "dead":
                # match the last frame of `die` (the pose it settles into)
                last_f = out["die"][0][-1]
                s = _area(last_f) / _area(figs[0])
            else:
                refs = figs if p["ref"] == "all" else [figs[i] for i in p["ref"]]
                s = s_idle * a_idle / float(np.median([_area(f) for f in refs]))
                if act != "idle":
                    s = _head_scale(refs, s, stand, head_idle)
            for f in figs:
                g = _resize(f, s)
                frames.append(g)
                srcs.append(f)
                scales.append(s)
                meas.append(_measure(g, stand))
        anchors = []
        for k, m in enumerate(meas):
            if spec["anchor"] == "feet":
                ax = m["fx"]
            elif spec["anchor"] == "dead":
                # same bbox-centre offset from the anchor as die's last frame
                (dax, _), dm = out["die"][1][-1]
                ax = m["cx"] - (dm["cx"] - dax)
            else:
                ax = m["tx"]
            anchors.append([ax, m["y1"]])
        stab = Z_STAB.get(f"{view}.{act}") or Z_STAB.get(act)
        if stab:
            opt = dict(stab)
            if opt["mode"] == "body":
                opt["torso_x"] = [m["tx"] for m in meas]   # anchor stays on the vest
            print(f"  {skin}.{view}.{act}")
            frames, st, _ = S.stabilize(frames, stand, src=srcs, src_scale=scales, log=print, **opt)
            meas = [_measure(g, stand) for g in frames]
            # the stabilizer's anchors are steady frame to frame; shift them as
            # a whole onto this file's convention (feet centroid / lowest
            # pixel) so the idle -> hit -> die hand-overs stay seamless
            dx = float(np.median([m["fx"] - a[0] for m, a in zip(meas, st)])) if opt["mode"] == "plant" else 0.0
            dy = float(np.median([m["y1"] - a[1] for m, a in zip(meas, st)]))
            anchors = [[a[0] + dx, a[1] + dy] for a in st]
        if "airborne" in spec:
            # take-off frame (first airborne - 1) defines the torso height
            t0 = spec["airborne"][0] - 1
            core = meas[t0]["y1"] - meas[t0]["ty"]
            for k in spec["airborne"]:
                anchors[k][1] = meas[k]["ty"] + core
            spec = dict(spec, core=core)
        hold = spec.get("hold", 1)
        frames = [f for f in frames for _ in range(hold)]
        pairs = [(tuple(a), m) for a, m in zip(anchors, meas) for _ in range(hold)]
        out[act] = (frames, pairs, spec)
    return out


def build_zombie():
    print("zombie")
    for key in [k for k in MANIFEST["sprites"] if k.split(".")[0] in ZOMBIE_SRC]:
        del MANIFEST["sprites"][key]
    for skin, cfg in ZOMBIE_SRC.items():
        for view in ("front", "side"):
            sheets = _skin_sheets(skin, cfg, view)
            for act, (frames, pairs, spec) in sheets.items():
                canvas, meta = _place(frames, pairs, bool(spec.get("loop")))
                meta["scaleAdjust"] = round(Z_SCREEN[view] / Z_STAND[view], 4)
                # one shadow size per view (cell widths differ per sheet)
                meta["shadowW"] = round(0.55 * Z_STAND[view])
                if view == "side":
                    meta["facing"] = "left"
                if "core" in spec:
                    meta["core"] = round(float(spec["core"]), 1)
                if act == "run" and view == "side":
                    # feet -> torso height while running (the throw-back arc)
                    meta["core"] = round(float(np.median([a[1] - m["ty"] for a, m in pairs])), 1)
                rel = f"{skin}/{view}-{act}.webp"
                MANIFEST["sprites"][f"{skin}.{view}.{act}"] = dict({"src": save(canvas, rel, 86)}, **meta)
                print(f"  {skin}.{view}.{act}: {meta['frames']} frames {meta['fw']}x{meta['fh']}")


# --------------------------------------------------------------------------- #
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    only = {"zombie": lambda: build_zombie(), "hero": lambda: build_hero()}
    if sys.argv[1:2] == ["--only"] and sys.argv[2:3] and sys.argv[2] in only:
        # rebuild just these sheets into the existing manifest
        with open(OUT / "manifest.json") as f:
            MANIFEST.update(json.load(f))
        only[sys.argv[2]]()
    else:
        build_layers()
        build_walls()
        build_hero()
        build_zombie()
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
