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

    def alpha_layer(key, rel, out, crop=None, lo=20, tile=False):
        arr = stretch_alpha(load(rel), lo=lo)
        x0, y0 = 0, 0
        if crop == "auto":
            x0, y0, x1, y1 = bbox(arr)
            arr = arr[y0:y1, x0:x1]
        elif crop:
            x0, y0, x1, y1 = crop
            arr = arr[y0:y1, x0:x1]
        if tile:
            arr = make_tileable(arr, blend=tile if isinstance(tile, int) and not isinstance(tile, bool) else 140)
        MANIFEST["images"][key] = {"src": save(arr, out, 86), "w": arr.shape[1], "h": arr.shape[0], "ox": x0, "oy": y0}

    # tile=0 → trim only; these layers are mirror-tiled by the runtime
    alpha_layer("clouds", "bg/ChatGPT Image Nov 5, 2026, 04_35_09 PM-5.png", "bg/clouds.webp", crop=(0, 0, 1870, 420), tile=0)
    alpha_layer("haze", "bg/ChatGPT Image Nov 5, 2026, 04_35_03 PM-2.png", "bg/haze.webp", crop=(0, 280, 1870, 841), lo=28, tile=0)
    alpha_layer("mountains", "bg/ChatGPT Image Nov 5, 2026, 04_35_05 PM-3.png", "bg/mountains.webp", crop=(0, 400, 1870, 841), tile=0)
    alpha_layer("skyline", "bg/ChatGPT Image Nov 5, 2026, 04_35_07 PM-4.png", "bg/skyline.webp", crop=(0, 330, 1870, 640), tile=0)
    alpha_layer("tower", "bg/Purple Watchtower with Golden Spotlight.png", "bg/tower.webp", crop="auto")
    alpha_layer("tree", "bg/Isolated Sunset Tree and Grass.png", "bg/tree.webp", crop="auto")
    alpha_layer("fenceFront", "bg/fence_front_view_25x9.png", "bg/fence-front.webp", crop=(0, 505, 2500, 880), tile=0)
    alpha_layer("fencePersp", "bg/fence_perspective_25x9.png", "bg/fence-persp.webp", crop=(0, 400, 2500, 880), tile=0)
    alpha_layer("landRoad", "land/land_road_25x9.png", "bg/land-road.webp", crop=(0, 530, 2500, 900), tile=0)

    for i in range(1, 8):
        arr = stretch_alpha(load(f"land/grass_0{i}.png"), lo=12)
        MANIFEST["images"][f"grass{i}"] = {"src": save(arr, f"props/grass-{i}.webp", 86), "w": arr.shape[1], "h": arr.shape[0]}
    for i in range(1, 9):
        arr = stretch_alpha(load(f"land/rock_0{i}.png"), lo=12)
        MANIFEST["images"][f"rock{i}"] = {"src": save(arr, f"props/rock-{i}.webp", 86), "w": arr.shape[1], "h": arr.shape[0]}

    # Perspective road (used by the mission-map intro scene) and the defeat illustration.
    road = load("full-picture/image copy 5.png")
    MANIFEST["images"]["roadPersp"] = {"src": save_opaque(road, "bg/road-persp.webp", 80), "w": road.shape[1], "h": road.shape[0]}
    go = load("full-picture/image copy.png")[108:882, 50:1622]
    MANIFEST["images"]["gameOver"] = {"src": save_opaque(go, "bg/game-over.webp", 82), "w": go.shape[1], "h": go.shape[0]}


# --------------------------------------------------------------------------- #
# walls
# --------------------------------------------------------------------------- #
def build_walls():
    print("walls")
    sheet = load("wall/image.png")
    cols = runs((sheet[:, :, 3] > 20).any(axis=0), min_len=60)
    names = ["front", "angle1", "angle2", "angle3"]
    assert len(cols) == 4, cols
    for name, (x0, x1) in zip(names, cols):
        part = sheet[:, x0:x1]
        bx0, by0, bx1, by1 = bbox(part)
        part = stretch_alpha(part[by0:by1, bx0:bx1].copy(), lo=24)
        hole = interior_hole(part)
        MANIFEST["walls"][name] = {"src": save(part, f"wall/{name}.webp", 88), "w": part.shape[1], "h": part.shape[0], "hole": hole}

    stage = load("wall/Transparent Stone Ring in Brick Wall.png")
    stage = keep_big_components(stage, thresh=150, min_area=400000, grow=2)  # only the wall+platform
    stage = stretch_alpha(stage, lo=60)
    x0, y0, x1, y1 = bbox(stage, thresh=40)
    stage = stage[y0:y1, x0:x1]
    hole = interior_hole(stage)
    MANIFEST["walls"]["stage"] = {"src": save(stage, "wall/stage.webp", 88), "w": stage.shape[1], "h": stage.shape[0], "hole": hole}


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
SCALE_ADJUST = {"zombie.side.dead": 0.6, "zombie.front.dead": 0.22}


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
