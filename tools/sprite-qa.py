#!/usr/bin/env python3
"""
Sprite-sheet smoothness check for the built sheets in assets/build/.

For every animation in the manifest it measures, frame by frame, against the
sheet's own anchor (cell centre x, anchorY line):

  head noise   RMS zig-zag of the head path once its smooth, intended motion
               is removed (periodic fit for loops, gaussian for one-shots) -
               this is what reads as "jiggle"
  feet slide   spread of the boots' x over the grounded frames (sheets whose
               feet should stay planted)
  ground       spread of the lowest solid row over the grounded frames
  size         spread of the head's matched scale (size pops)
  seam         loops only: head jump last->first vs the median step

Values are in on-screen px at sprite scale 1 (sheet px x scaleAdjust).

Run:   python3 tools/sprite-qa.py                  all sheets
       python3 tools/sprite-qa.py hero zombie.side  sheets whose key starts so
       python3 tools/sprite-qa.py --strict          exit 1 if any sheet fails
       python3 tools/sprite-qa.py --build=DIR       check another build folder
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import sprite_stabilizer as S

ROOT = Path(__file__).resolve().parent.parent
BUILD = next((Path(a.split("=", 1)[1]) for a in sys.argv if a.startswith("--build=")), ROOT / "assets" / "build")

# pass limits (screen px at scale 1; size in %)
LIMIT = {"noise": 2.0, "slide": 1.5, "ground": 1.0, "size": 3.0, "seam": 2.0}
# sheets whose boots should not move (one-shots with steps - the side attack
# lunges -, runs, leaps and deaths are excluded from the slide check)
PLANTED = ("Idle", ".idle", "Throw", "front.attack", "Fear")
NO_HEAD = (".die", ".dead", ".leap", "Leap", "Fall")   # head turns over / leaves the frame
# Head noise is graded where the head should move little and smoothly (loops
# and planted actions).  Head size spread includes ~1.5-2.5% measurement
# noise on a moving head; front-view actions are not graded on it.  Jumps, cheers and hit recoils are large, fast,
# intended motion that no smoother separates from jitter: reported, not graded.


def frames_of(spec):
    im = np.array(Image.open(BUILD / spec["src"]).convert("RGBA"))
    out = []
    for i in range(spec["frames"]):
        r, c = divmod(i, spec["cols"])
        out.append(im[r * spec["fh"]:(r + 1) * spec["fh"], c * spec["fw"]:(c + 1) * spec["fw"]])
    return out


def check(key, spec):
    figs = frames_of(spec)
    n = len(figs)
    if n < 3:
        return None
    ax, ay = spec["fw"] / 2, spec["fh"] * spec["anchorY"]
    k = spec.get("scaleAdjust", 1.0)
    loop = bool(spec.get("loop")) or key.endswith(("Idle", "Run"))
    stand = float(np.median([S.ground_y(f) - S.top_y(f) for f in figs]))
    tr = S.track(figs, stand)
    g = np.array([m["ground"] for m in tr])
    grounded = g >= g.max() - 0.04 * stand
    res = {"frames": n, "loop": loop}
    if not key.endswith(NO_HEAD):
        rx = np.array([m["hx"] - ax for m in tr])
        rh = np.array([ay - m["hy"] for m in tr])
        sm = (lambda v: S.smooth_loop(v, 2)) if loop else (lambda v: S.smooth_once(v, 1.0))
        res["noise"] = k * float(np.sqrt(((rx - sm(rx)) ** 2 + (rh - sm(rh)) ** 2).mean()))
        good = np.array([m["hscore"] >= 0.75 for m in tr])
        if good.sum() >= 3:
            hs = np.array([m["scale"] for m in tr])[good]
            res["size"] = 100 * float(np.std(hs / np.median(hs)))
        if loop:
            steps = np.hypot(np.diff(np.r_[rx, rx[0]]), np.diff(np.r_[rh, rh[0]]))
            res["seam"] = k * float(max(0.0, steps[-1] - np.median(steps[:-1])))
    if key.endswith(PLANTED) and grounded.sum() >= 3:
        bx = np.array([m["bx"] if m["bscore"] >= 0.7 else m["fx"] for m in tr])[grounded]
        res["slide"] = k * float(np.std(bx))
    if grounded.sum() >= 3:
        res["ground"] = k * float(np.std(g[grounded]))
    graded = dict(LIMIT)
    if not (loop or key.endswith(PLANTED)):
        graded.pop("noise")
    if ".front." in key and not loop:
        # front-view actions come at the camera: the head grows on purpose
        graded.pop("size")
    res["fail"] = [m for m, lim in graded.items() if res.get(m, 0) > lim]
    return res


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    strict = "--strict" in sys.argv
    sprites = json.load(open(BUILD / "manifest.json"))["sprites"]
    keys = [k for k in sprites if not args or any(k.startswith(a) for a in args)]
    print(f"{'sheet':24s} {'n':>3s} {'head noise':>10s} {'feet slide':>10s} {'ground':>7s} {'size %':>7s} {'seam':>6s}")
    fails = 0
    for key in keys:
        r = check(key, sprites[key])
        if r is None:
            continue
        cell = lambda m, w: (f"{r[m]:{w}.1f}" + ("!" if m in r["fail"] else " ")) if m in r else " " * w + " "
        print(f"{key:24s} {r['frames']:3d} {cell('noise', 9)} {cell('slide', 9)} {cell('ground', 6)} {cell('size', 6)} {cell('seam', 5)}")
        fails += bool(r["fail"])
    print(f"\n{len(keys)} sheets, {fails} over the limits {LIMIT} (! marks the value;"
          f" head noise is graded on loops and planted actions only)")
    if strict and fails:
        sys.exit(1)


if __name__ == "__main__":
    main()
