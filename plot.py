#!/usr/bin/env python3
"""
Compact SVG plotter for inline chat graphs.

Emits a small, self-contained SVG as a percent-encoded data: URI, ready to paste
into a chat message as `![alt](data:image/svg+xml,...)`.

Why not matplotlib: a matplotlib SVG of a single curve is 15-40KB, and the URI
has to travel through the assistant's message text. This emits ~1-2KB for the
same curve -- a few hundred tokens instead of several thousand.

Colors are chosen to read on both dark and light panel themes, since an <img>
cannot inherit the surrounding page's CSS.

Usage:
  python3 scripts/plot.py -e "sin(x)" -e "cos(x)" -x -6.3 6.3 -t "sin and cos"
  python3 scripts/plot.py -e "x**2" -e "x**3" -x 0 1 --fill 0 1 -t "region"
  python3 scripts/plot.py -e "1/x" -x 0.5 6 --points "1,1 2,0.5 3,0.3333"
"""

import argparse
import math
import os
import sys

W, H = 560, 340
PAD_L, PAD_R, PAD_T, PAD_B = 46, 14, 26, 32

# Mid-tone grays read acceptably against both dark and light backgrounds.
AXIS = "#8b93a7"
GRID = "#8b93a7"
LABEL = "#8b93a7"
TITLE = "#c8cfe0"
SERIES = ["#4fc3f7", "#ff8a65", "#a5d6a7", "#ce93d8", "#ffd54f"]
FILL = "#4fc3f7"

SAFE_ENV = {
    k: getattr(math, k)
    for k in "sin cos tan asin acos atan sinh cosh tanh exp log log10 sqrt "
             "floor ceil fabs atan2 pow".split()
}
SAFE_ENV.update({"abs": abs, "ln": math.log, "pi": math.pi, "e": math.e})


def evaluate(expr, x):
    """Evaluate expr at x, returning None for undefined/non-finite points."""
    try:
        v = eval(expr, {"__builtins__": {}}, dict(SAFE_ENV, x=x))
    except Exception:
        return None
    if isinstance(v, (int, float)) and math.isfinite(v):
        return float(v)
    return None


def nice_ticks(lo, hi, target=7):
    """Round tick values covering [lo, hi]."""
    span = hi - lo
    if span <= 0:
        return [lo]
    raw = span / target
    mag = 10 ** math.floor(math.log10(raw))
    step = 10 * mag
    for m in (1, 2, 2.5, 5, 10):
        if raw <= m * mag:
            step = m * mag
            break
    out, v = [], math.ceil(lo / step) * step
    while v <= hi + step * 1e-9:
        out.append(round(v, 10))
        v += step
    return out


def fmt(v):
    return "0" if abs(v) < 1e-12 else f"{v:.4g}"


def rdp(pts, eps=0.6):
    """Ramer-Douglas-Peucker. Drops points a curve does not need.

    Sampling densely then simplifying keeps asymptotes and sharp turns accurate
    while cutting a smooth curve from 400 points to ~50 -- which matters a lot,
    because every point is characters in a data URI the assistant must retype.
    """
    if len(pts) < 3:
        return pts
    x0, y0 = pts[0]
    x1, y1 = pts[-1]
    dx, dy = x1 - x0, y1 - y0
    norm = math.hypot(dx, dy)
    worst, idx = -1.0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        if norm < 1e-12:
            d = math.hypot(px - x0, py - y0)
        else:
            d = abs(dy * px - dx * py + x1 * y0 - y1 * x0) / norm
        if d > worst:
            worst, idx = d, i
    if worst <= eps:
        return [pts[0], pts[-1]]
    return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)


def auto_yrange(series, scatter):
    ys = [y for pts in series for _, y in pts if y is not None]
    ys += [y for _, y in scatter]
    if not ys:
        return -1.0, 1.0
    ys.sort()
    lo, hi = ys[0], ys[-1]
    # Clip pathological ranges (tan, 1/x) to the bulk of the data.
    q_lo = ys[int(len(ys) * 0.02)]
    q_hi = ys[max(0, int(len(ys) * 0.98) - 1)]
    if hi - lo > 8 * max(1e-9, q_hi - q_lo):
        lo, hi = q_lo, q_hi
    if hi - lo < 1e-9:
        lo, hi = lo - 1, hi + 1
    pad = (hi - lo) * 0.10
    return lo - pad, hi + pad


def build(exprs, x0, x1, y0=None, y1=None, title=None, fill=None,
          points=None, samples=400):
    series = []
    for expr in exprs:
        series.append([
            (x0 + (x1 - x0) * i / samples, evaluate(expr, x0 + (x1 - x0) * i / samples))
            for i in range(samples + 1)
        ])

    scatter = []
    if points:
        scatter = [tuple(map(float, p.split(","))) for p in points.split()]

    if y0 is None or y1 is None:
        y0, y1 = auto_yrange(series, scatter)

    def sx(x):
        return PAD_L + (x - x0) / (x1 - x0) * (W - PAD_L - PAD_R)

    def sy(y):
        return H - PAD_B - (y - y0) / (y1 - y0) * (H - PAD_T - PAD_B)

    def render(seq):
        """Integer pixel coords with consecutive duplicates dropped."""
        out = []
        for px, py in seq:
            s = f"{px:.0f},{py:.0f}"
            if not out or out[-1] != s:
                out.append(s)
        return " ".join(out)

    o = []
    a = o.append
    a(f"<svg xmlns='http://www.w3.org/2000/svg' width='{W}' height='{H}' "
      f"viewBox='0 0 {W} {H}' font-family='system-ui,sans-serif'>")

    # Shared attributes live on <g> wrappers: repeating stroke/font on every
    # element roughly doubles the URI, and the URI is retyped by the assistant.
    xticks = nice_ticks(x0, x1)
    yticks = nice_ticks(y0, y1, 6)

    a(f"<g stroke='{GRID}' stroke-opacity='.15'>")
    for xt in xticks:
        px = round(sx(xt))
        a(f"<line x1='{px}' y1='{PAD_T}' x2='{px}' y2='{H-PAD_B}'/>")
    for yt in yticks:
        py = round(sy(yt))
        a(f"<line x1='{PAD_L}' y1='{py}' x2='{W-PAD_R}' y2='{py}'/>")
    a("</g>")

    a(f"<g font-size='11' fill='{LABEL}' text-anchor='middle'>")
    for xt in xticks:
        a(f"<text x='{round(sx(xt))}' y='{H-PAD_B+16}'>{fmt(xt)}</text>")
    a("</g>")

    a(f"<g font-size='11' fill='{LABEL}' text-anchor='end'>")
    for yt in yticks:
        a(f"<text x='{PAD_L-7}' y='{round(sy(yt))+4}'>{fmt(yt)}</text>")
    a("</g>")

    if y0 <= 0 <= y1:
        zy = round(sy(0))
        a(f"<line x1='{PAD_L}' y1='{zy}' x2='{W-PAD_R}' y2='{zy}' stroke='{AXIS}' stroke-opacity='.55'/>")
    if x0 <= 0 <= x1:
        zx = round(sx(0))
        a(f"<line x1='{zx}' y1='{PAD_T}' x2='{zx}' y2='{H-PAD_B}' stroke='{AXIS}' stroke-opacity='.55'/>")

    # Shaded region between the first two curves (section 6.2 style).
    if fill and len(series) >= 2:
        fa, fb = fill
        top, bot = [], []
        for (x, ya), (_, yb) in zip(series[0], series[1]):
            if ya is None or yb is None or not (fa <= x <= fb):
                continue
            top.append((sx(x), sy(ya)))
            bot.append((sx(x), sy(yb)))
        if top:
            ring = rdp(top) + rdp(bot)[::-1]
            a(f"<polygon points='{render(ring)}' fill='{FILL}' fill-opacity='.22'/>")

    # Curves, split into segments so asymptotes are not bridged by a line.
    for idx, pts in enumerate(series):
        color = SERIES[idx % len(SERIES)]
        seg, segs, prev = [], [], None
        for x, y in pts:
            if y is None or y < y0 - (y1 - y0) or y > y1 + (y1 - y0):
                if len(seg) > 1:
                    segs.append(seg)
                seg, prev = [], None
                continue
            if prev is not None and abs(y - prev) > (y1 - y0) * 0.5:
                if len(seg) > 1:
                    segs.append(seg)
                seg = []
            seg.append((sx(x), sy(y)))
            prev = y
        if len(seg) > 1:
            segs.append(seg)
        for s in segs:
            a(f"<polyline points='{render(rdp(s))}' fill='none' stroke='{color}' "
              f"stroke-width='2.2' stroke-linejoin='round' stroke-linecap='round'/>")

    # Scatter, for sequences and partial sums.
    for px, py in scatter:
        a(f"<circle cx='{sx(px):.0f}' cy='{sy(py):.0f}' r='3' fill='{SERIES[1]}'/>")

    if title:
        a(f"<text x='{W//2}' y='16' font-size='13' fill='{TITLE}' text-anchor='middle'>{title}</text>")
    a(f"<g font-size='11' fill='{LABEL}'>")
    for idx, expr in enumerate(exprs):
        color = SERIES[idx % len(SERIES)]
        ly = PAD_T + 6 + idx * 16
        a(f"<line x1='{W-PAD_R-116}' y1='{ly}' x2='{W-PAD_R-96}' y2='{ly}' stroke='{color}' stroke-width='2.2'/>")
        a(f"<text x='{W-PAD_R-91}' y='{ly+4}'>{expr}</text>")
    a("</g>")

    a("</svg>")
    return "".join(o)


def to_data_uri(svg):
    """Percent-encode only what would break a markdown link destination."""
    out = svg.replace("%", "%25")
    for ch, code in (("<", "%3C"), (">", "%3E"), ("#", "%23"), ('"', "%22"),
                     (" ", "%20"), ("(", "%28"), (")", "%29"),
                     ("\n", ""), ("\t", "")):
        out = out.replace(ch, code)
    return "data:image/svg+xml," + out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("-e", "--expr", action="append", default=[],
                   help="expression in x, e.g. 'sin(x)' (repeatable)")
    p.add_argument("-x", nargs=2, type=float, default=[-6.3, 6.3], metavar=("X0", "X1"))
    p.add_argument("-y", nargs=2, type=float, default=None, metavar=("Y0", "Y1"))
    p.add_argument("-t", "--title", default=None)
    p.add_argument("--fill", nargs=2, type=float, default=None, metavar=("A", "B"),
                   help="shade between the first two curves on [a,b]")
    p.add_argument("--points", default=None, help="scatter, e.g. '1,1 2,0.5 3,0.33'")
    p.add_argument("--alt", default="plot")
    p.add_argument("-o", "--out", default=None, help="also save the raw .svg here")
    args = p.parse_args()

    if not args.expr and not args.points:
        p.error("need at least one --expr or --points")

    y0, y1 = args.y if args.y else (None, None)
    svg = build(args.expr, args.x[0], args.x[1], y0, y1,
                title=args.title, fill=args.fill, points=args.points)
    uri = to_data_uri(svg)

    if args.out:
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        with open(args.out, "w") as f:
            f.write(svg)

    sys.stderr.write(f"[svg {len(svg)}B -> uri {len(uri)}B, ~{len(uri)//4} tokens]\n")
    print(f"![{args.alt}]({uri})")


if __name__ == "__main__":
    main()
