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

Discontinuities: a break is *declared* with --break-at and is exact. Failing
that, a fallback heuristic breaks the path wherever consecutive samples differ
by more than --jump-frac of the y-range (default 0.5). What that heuristic can
see: a jump larger than the threshold. What it cannot: a jump smaller than the
threshold (a small step is invisible), and the difference between a pole and a
merely steep curve, which at the sampling resolution produce the same jump --
so it both misses real breaks and invents false ones. Raise --samples and the
same curve looks less discontinuous; that is a property of the guess, not of
the function. When you know the function, say so with --break-at.

Usage:
  python3 scripts/plot.py -e "sin(x)" -e "cos(x)" -x -6.3 6.3 -t "sin and cos"
  python3 scripts/plot.py -e "x**2" -e "x**3" -x 0 1 --fill 0 1 -t "region"
  python3 scripts/plot.py -e "1/x" -x 0.5 6 --points "1,1 2,0.5 3,0.3333"
  python3 scripts/plot.py --polar "t" --trange 0 18.85 -t "spiral"
  python3 scripts/plot.py --param "cos(t)" "sin(t)*cos(t)" -t "lemniscate"
  python3 scripts/plot.py -e "sin(x)" -x 0 6.28 --riemann 12 --riemann-at mid
  python3 scripts/plot.py -e "tan(x)" --break-at -1.5708 --break-at 1.5708
  python3 scripts/plot.py -e "sin(50*x)" --samples 4000
  python3 scripts/plot.py -e "sin(x)" --xlabel "t (s)" --ylabel "amplitude" \
      --annotate 1.5708 1 "first peak"
  python3 scripts/plot.py --vec "2,1:u" --vec "2,1->3,3:v" --vec "3,3:u+v"
"""

import argparse
import math
import os
import sys
from xml.sax.saxutils import escape

W, H = 560, 340
PAD_L, PAD_R, PAD_T, PAD_B = 46, 14, 26, 32

# Palettes. `auto` is the default and is deliberately a compromise: mid-tone
# grays that read acceptably against both dark and light backgrounds, because
# an image cannot know what it is sitting on.
#
# It cannot find out, either. An SVG carrying its own
# `@media (prefers-color-scheme: dark)` block was tested in the real chat panel
# and the query evaluated false under a visibly dark editor theme -- the
# stylesheet applied, the query simply did not match. See
# specs/plot-py/theming-experiment.md. So the choice is explicit, via --theme,
# and `auto` stays exactly what it always was.
THEMES = {
    "auto": {
        "AXIS": "#8b93a7", "GRID": "#8b93a7", "LABEL": "#8b93a7",
        "TITLE": "#c8cfe0", "FILL": "#4fc3f7",
        "SERIES": ["#4fc3f7", "#ff8a65", "#a5d6a7", "#ce93d8", "#ffd54f"],
    },
    "dark": {
        "AXIS": "#98a1b6", "GRID": "#98a1b6", "LABEL": "#a8b1c6",
        "TITLE": "#e6ebf5", "FILL": "#4fc3f7",
        "SERIES": ["#4fc3f7", "#ff8a65", "#a5d6a7", "#ce93d8", "#ffd54f"],
    },
    "light": {
        "AXIS": "#5a6274", "GRID": "#5a6274", "LABEL": "#4a5162",
        "TITLE": "#1f2430", "FILL": "#0277bd",
        "SERIES": ["#0277bd", "#c62828", "#2e7d32", "#6a1b9a", "#a05000"],
    },
}

AXIS = GRID = LABEL = TITLE = FILL = ""
SERIES = []


def use_theme(name):
    """Rebind the active palette. Every colour site reads these at draw time.

    Globals rather than a palette threaded through build(): the drawing code is
    one long function of f-strings, and passing an object into each would be a
    large diff for no behavioural gain. The cost is that this is process-wide
    state -- fine for a CLI, and the tests set it explicitly.
    """
    if name not in THEMES:
        raise ValueError(f"unknown theme {name!r}; "
                         f"pick one of {', '.join(sorted(THEMES))}")
    palette = dict(THEMES[name])
    palette["SERIES"] = list(palette["SERIES"])
    globals().update(palette)


use_theme("auto")

SAFE_ENV = {
    k: getattr(math, k)
    for k in "sin cos tan asin acos atan sinh cosh tanh exp log log10 sqrt "
             "floor ceil fabs atan2 pow".split()
}
SAFE_ENV.update({"abs": abs, "ln": math.log, "pi": math.pi, "e": math.e})


def esc(s):
    """XML-escape text content.

    Every string that reaches a <text> node goes through this. An unescaped
    '&' or '<' makes the document not well-formed, and the panel then renders
    nothing at all -- a failure indistinguishable from the patch being off.
    Only &, < and > are escaped: quotes are legal in text content and escaping
    them would cost bytes for nothing.
    """
    return escape(str(s))


# Rough advance width per character as a fraction of the font size. Deliberately
# generous: over-estimating truncates a shade early, under-estimating lets a
# label run off the edge of the image, and only one of those is recoverable.
CHAR_W = 0.62


def clip(text, max_px, font_size=11):
    """Shorten text with an ellipsis so it cannot overflow max_px.

    Truncation, not shrinking or wrapping: shrinking makes a long label
    unreadable at exactly the moment it has the most to say, and wrapping costs
    a second <text> element plus the line-breaking logic to place it. Three
    ASCII dots, not U+2026, because the URI is not percent-encoded beyond the
    characters that would break a markdown link.
    """
    n = max(1, int(max_px / (font_size * CHAR_W)))
    text = str(text)
    return text if len(text) <= n else text[:max(1, n - 3)] + "..."


def parse_points(spec):
    """'1,1 2,0.5:peak' -> [(1.0, 1.0, None), (2.0, 0.5, 'peak')].

    The annotation is the tail after ':'. Points are whitespace-separated, so a
    label written this way cannot contain a space; `annotate` takes one that
    does.
    """
    out = []
    for tok in (spec or "").split():
        body, _, label = tok.partition(":")
        px, py = body.split(",")
        out.append((float(px), float(py), label or None))
    return out


def parse_vec(spec):
    """'1,1->4,3:v' -> (1.0, 1.0, 4.0, 3.0, 'v').

    Two forms, and the arrow is what tells them apart:

        'X,Y'              from the origin to (X, Y)
        'TX,TY->HX,HY'     from (TX, TY) to (HX, HY)

    with an optional ':label' on either. The tail-to-tip form is the one that
    makes vector addition drawable -- u, then v starting where u ended.
    """
    body, _, label = (spec or "").partition(":")
    tail, arrow, tip = body.partition("->")
    if not arrow:
        tail, tip = "0,0", body

    def pt(text):
        try:
            px, py = text.split(",")
            return float(px), float(py)
        except ValueError:
            raise ValueError(f"--vec wants X,Y or TX,TY->HX,HY"
                             f"[:label], not {spec!r}") from None

    tx, ty = pt(tail)
    hx, hy = pt(tip)
    return tx, ty, hx, hy, label.strip() or None


def normalize_vecs(vecs):
    """Accept either a spec string or an already-parsed tuple, per vector."""
    out = []
    for v in vecs or []:
        if isinstance(v, str):
            out.append(parse_vec(v))
        else:
            tx, ty, hx, hy = (float(c) for c in v[:4])
            out.append((tx, ty, hx, hy, v[4] if len(v) > 4 else None))
    return out


def evaluate(expr, x, var="x"):
    """Evaluate expr at x, returning None for undefined/non-finite points."""
    try:
        v = eval(expr, {"__builtins__": {}}, dict(SAFE_ENV, **{var: x}))
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
    ys += [y for _, y, _ in scatter]
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


def sample_paths(polar, param, t0, t1, samples):
    """Data-space point lists for polar and parametric curves.

    A path is a sequence in *parameter* order, not a function of x: a
    lemniscate visits the same x twice with two different y values, so nothing
    downstream may assume single-valuedness. `None` marks an undefined sample
    and breaks the path there.
    """
    paths = []

    def walk(fn):
        out = []
        for i in range(samples + 1):
            t = t0 + (t1 - t0) * i / samples
            out.append(fn(t))
        return out

    for expr in polar or []:
        def polar_pt(t, expr=expr):
            r = evaluate(expr, t, "t")
            return None if r is None else (r * math.cos(t), r * math.sin(t))
        paths.append((walk(polar_pt), f"r={expr}"))

    for xe, ye in param or []:
        def param_pt(t, xe=xe, ye=ye):
            px, py = evaluate(xe, t, "t"), evaluate(ye, t, "t")
            return None if px is None or py is None else (px, py)
        paths.append((walk(param_pt), f"({xe},{ye})"))

    return paths


def build(exprs, x0=None, x1=None, y0=None, y1=None, title=None, fill=None,
          points=None, samples=400, polar=None, param=None,
          t0=0.0, t1=2 * math.pi, riemann=None, riemann_at="mid",
          riemann_range=None, breaks=None, jump_frac=0.5,
          xlabel=None, ylabel=None, annotate=None, vecs=None):
    if riemann is not None and riemann_at not in ("left", "right", "mid"):
        raise ValueError(f"riemann_at must be left, right or mid, "
                         f"not {riemann_at!r}")

    # Labels take their room out of the padding, never out of the plot area,
    # and only when they exist: an unlabelled plot uses the original constants
    # and so is byte-for-byte what it was before this feature.
    pl = PAD_L + (13 if ylabel else 0)
    pb = PAD_B + (14 if xlabel else 0)
    pt, pr = PAD_T, PAD_R

    # A break is either an x value (every curve breaks there) or an
    # (index, x) pair (only that expression does).
    gbreaks, ebreaks = [], {}
    for b in breaks or []:
        if isinstance(b, (tuple, list)):
            ebreaks.setdefault(int(b[0]), []).append(float(b[1]))
        else:
            gbreaks.append(float(b))

    vecs = normalize_vecs(vecs)
    paths = sample_paths(polar, param, t0, t1, samples)
    auto_x = x0 is None or x1 is None
    auto_y = y0 is None or y1 is None

    if auto_x:
        xs = [p[0] for pts, _ in paths for p in pts if p]
        xs += [c for tx, ty, hx, hy, _ in vecs for c in (tx, hx)]
        if xs:
            x0, x1 = min(xs), max(xs)
            pad = max((x1 - x0) * 0.08, 1e-9)
            x0, x1 = x0 - pad, x1 + pad
        else:
            x0, x1 = -6.3, 6.3

    series = []
    for expr in exprs:
        series.append([
            (x0 + (x1 - x0) * i / samples, evaluate(expr, x0 + (x1 - x0) * i / samples))
            for i in range(samples + 1)
        ])

    scatter = parse_points(points)
    scatter += [(float(px), float(py), str(txt))
                for px, py, txt in (annotate or [])]

    if auto_y:
        if paths or vecs:
            ys = [p[1] for pts, _ in paths for p in pts if p]
            ys += [c for tx, ty, hx, hy, _ in vecs for c in (ty, hy)]
            ys += [y for pts in series for _, y in pts if y is not None]
            ys += [y for _, y, _ in scatter]
            y0, y1 = (min(ys), max(ys)) if ys else (-1.0, 1.0)
            if y1 - y0 < 1e-9:
                y0, y1 = y0 - 1, y1 + 1
            pad = (y1 - y0) * 0.08
            y0, y1 = y0 - pad, y1 + pad
        else:
            y0, y1 = auto_yrange(series, scatter)

    # A circle must look like a circle, and a 45-degree vector must come out
    # at 45 degrees: when both ranges are ours to choose and a path or a vector
    # is on the plot, equalise units per pixel. Unequal axes on a vector
    # diagram do not merely look odd, they state a false angle and a false
    # relative length -- so -x/-y still win, but silence does not.
    if (paths or vecs) and auto_x and auto_y:
        wp, hp = W - pl - pr, H - pt - pb
        k = max((x1 - x0) / wp, (y1 - y0) / hp)
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        x0, x1 = mx - k * wp / 2, mx + k * wp / 2
        y0, y1 = my - k * hp / 2, my + k * hp / 2

    if x1 - x0 == 0:
        raise ValueError(f"x range has zero width ({x0}); give two "
                         "different values")
    if y1 - y0 == 0:
        raise ValueError(f"y range has zero width ({y0}); give two "
                         "different values")

    def sx(x):
        return pl + (x - x0) / (x1 - x0) * (W - pl - pr)

    def sy(y):
        return H - pb - (y - y0) / (y1 - y0) * (H - pt - pb)

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
        a(f"<line x1='{px}' y1='{pt}' x2='{px}' y2='{H-pb}'/>")
    for yt in yticks:
        py = round(sy(yt))
        a(f"<line x1='{pl}' y1='{py}' x2='{W-pr}' y2='{py}'/>")
    a("</g>")

    a(f"<g font-size='11' fill='{LABEL}' text-anchor='middle'>")
    for xt in xticks:
        a(f"<text x='{round(sx(xt))}' y='{H-pb+16}'>{fmt(xt)}</text>")
    a("</g>")

    a(f"<g font-size='11' fill='{LABEL}' text-anchor='end'>")
    for yt in yticks:
        a(f"<text x='{pl-7}' y='{round(sy(yt))+4}'>{fmt(yt)}</text>")
    a("</g>")

    if y0 <= 0 <= y1:
        zy = round(sy(0))
        a(f"<line x1='{pl}' y1='{zy}' x2='{W-pr}' y2='{zy}' stroke='{AXIS}' stroke-opacity='.55'/>")
    if x0 <= 0 <= x1:
        zx = round(sx(0))
        a(f"<line x1='{zx}' y1='{pt}' x2='{zx}' y2='{H-pb}' stroke='{AXIS}' stroke-opacity='.55'/>")

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

    # Riemann rectangles, drawn under the curve. All styling lives on the <g>:
    # a hundred rectangles must cost a hundred coordinate sets and exactly one
    # copy of the fill and stroke.
    if riemann:
        if not exprs:
            raise ValueError("riemann needs at least one expression")
        lo, hi = riemann_range if riemann_range else (x0, x1)
        step = (hi - lo) / riemann
        base = min(max(sy(0.0), pt), H - pb)
        rects = []
        for i in range(riemann):
            xl = lo + step * i
            at = {"left": xl, "right": xl + step,
                  "mid": xl + step / 2}[riemann_at]
            v = evaluate(exprs[0], at)
            if v is None:
                continue
            # sorted(), not abs(): a curve below the axis draws downward from
            # it, and SVG has no such thing as a negative height.
            top, bot = sorted((min(max(sy(v), pt), H - pb), base))
            px = round(min(max(sx(xl), pl), W - pr))
            pw = round(min(max(sx(xl + step), pl), W - pr)) - px
            rects.append(f"M{px},{round(top)}h{pw}v{round(bot) - round(top)}"
                         f"h{-pw}z")
        if rects:
            # One path, not one element per rectangle: `<rect x= y= width=
            # height=>` costs ~57B in the URI once the attribute spaces are
            # percent-encoded, against ~19B for a subpath. The <g> still
            # carries the styling, so it is stored exactly once either way.
            a(f"<g fill='{SERIES[0]}' fill-opacity='.18' stroke='{SERIES[0]}' "
              f"stroke-opacity='.5'>")
            a(f"<path d='{''.join(rects)}'/>")
            a("</g>")

    # Curves, split into segments so asymptotes are not bridged by a line.
    #
    # Three separate reasons to break, in decreasing order of trustworthiness:
    # the sample is undefined or far off-range (a fact); the user declared a
    # break there (a statement); the jump between neighbouring samples exceeds
    # jump_frac of the y-range (a guess -- see the module docstring for what it
    # can and cannot see).
    for idx, pts in enumerate(series):
        color = SERIES[idx % len(SERIES)]
        cuts = gbreaks + ebreaks.get(idx, [])
        seg, segs, prev, prev_x = [], [], None, None
        for x, y in pts:
            declared = prev_x is not None and any(prev_x < b <= x for b in cuts)
            prev_x = x
            if y is None or y < y0 - (y1 - y0) or y > y1 + (y1 - y0):
                if len(seg) > 1:
                    segs.append(seg)
                seg, prev = [], None
                continue
            if declared or (jump_frac > 0 and prev is not None
                            and abs(y - prev) > (y1 - y0) * jump_frac):
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

    # Polar and parametric paths. Not exempt from the size levers: undefined
    # samples break the path, RDP simplifies it, coordinates are integers and
    # consecutive duplicates are dropped, exactly as for a Cartesian curve.
    for i, (pts, _label) in enumerate(paths):
        color = SERIES[(len(exprs) + i) % len(SERIES)]
        seg, segs = [], []
        for p in pts:
            if p is None:
                if len(seg) > 1:
                    segs.append(seg)
                seg = []
                continue
            seg.append((sx(p[0]), sy(p[1])))
        if len(seg) > 1:
            segs.append(seg)
        for sgm in segs:
            a(f"<polyline points='{render(rdp(sgm))}' fill='none' stroke='{color}' "
              f"stroke-width='2.2' stroke-linejoin='round' stroke-linecap='round'/>")

    # Vectors. One <g> per series colour carrying the fill, stroke and joins
    # once, and every vector of that colour a pair of subpaths inside a single
    # <path>: the shaft, then the arrowhead as a closed triangle. Measured
    # against the obvious form -- a fully attributed <line> plus <polygon> per
    # vector -- that is ~40B of URI each against ~193B, for the same reason the
    # Riemann rectangles are subpaths: attribute spaces become %20.
    if vecs:
        groups, order = {}, []
        for i, (tx, ty, hx, hy, label) in enumerate(vecs):
            color = SERIES[(len(exprs) + len(paths) + i) % len(SERIES)]
            if color not in groups:
                order.append(color)
            groups.setdefault(color, []).append((tx, ty, hx, hy, label))

        drawn = []
        for color in order:
            subs, labels = [], []
            for tx, ty, hx, hy, label in groups[color]:
                ax, ay, bx, by = sx(tx), sy(ty), sx(hx), sy(hy)
                dx, dy = bx - ax, by - ay
                length = math.hypot(dx, dy)
                if length < 1e-9:
                    continue          # no direction, so no arrow to draw
                ux, uy = dx / length, dy / length
                # The head has a floor as well as a ceiling: a short vector
                # keeps a head you can see, rather than shrinking to a dot.
                hl = max(4.0, min(9.0, 0.45 * length))
                hw = max(3.0, hl / 2)
                kx, ky = bx - ux * hl, by - uy * hl
                subs.append(
                    f"M{ax:.0f},{ay:.0f}L{bx:.0f},{by:.0f}"
                    f"M{kx - uy * hw:.0f},{ky + ux * hw:.0f}"
                    f"L{bx:.0f},{by:.0f}"
                    f"L{kx + uy * hw:.0f},{ky - ux * hw:.0f}z")
                if label:
                    labels.append((ax, ay, bx, by, ux, uy, label))
            if subs:
                a(f"<g fill='{color}' stroke='{color}' stroke-width='2.2' "
                  f"stroke-linejoin='round'><path d='{''.join(subs)}'/></g>")
                drawn.append((color, labels))

        # Labels last, so a later vector's shaft cannot be drawn over one. The
        # <g> inherits nothing from the arrow group, so it carries its own
        # fill -- which is the point: the label is the vector's colour.
        for color, labels in drawn:
            if not labels:
                continue
            a(f"<g font-size='11' fill='{color}' text-anchor='middle'>")
            for ax, ay, bx, by, ux, uy, label in labels:
                # Beside the shaft, on its upper side where there is one: the
                # tip is where two vectors of a sum meet, so a label placed
                # there would collide with its neighbour.
                nx, ny = -uy, ux
                if ny > 0:
                    nx, ny = uy, -ux
                label = clip(label, W / 2)
                half = len(label) * 11 * CHAR_W / 2
                lx = min(max((ax + bx) / 2 + nx * 11, half + 2), W - half - 2)
                ly = min(max((ay + by) / 2 + ny * 11 + 4, 10), H - 2)
                a(f"<text x='{lx:.0f}' y='{ly:.0f}'>{esc(label)}</text>")
            a("</g>")

    # Scatter, for sequences and partial sums.
    for px, py, _txt in scatter:
        a(f"<circle cx='{sx(px):.0f}' cy='{sy(py):.0f}' r='3' fill='{SERIES[1]}'/>")

    # Point annotations. One <g> for the shared styling, nothing emitted at all
    # when no point carries a label.
    notes = [(px, py, txt) for px, py, txt in scatter if txt]
    if notes:
        a(f"<g font-size='10' fill='{LABEL}' text-anchor='middle'>")
        for px, py, txt in notes:
            # Half the image width: a note belongs beside its point, not
            # stretched across the plot, and the clamp below keeps it on-image.
            txt = clip(txt, W / 2, 10)
            half = len(txt) * 10 * CHAR_W / 2
            cx = min(max(sx(px), half + 2), W - half - 2)
            cy = min(max(sy(py) - 8, 10), H - 2)
            a(f"<text x='{cx:.0f}' y='{cy:.0f}'>{esc(txt)}</text>")
        a("</g>")

    if title:
        a(f"<text x='{W//2}' y='16' font-size='13' fill='{TITLE}' text-anchor='middle'>{esc(clip(title, W - 16, 13))}</text>")
    if xlabel:
        a(f"<text x='{(pl + W - pr)//2}' y='{H-5}' font-size='11' fill='{LABEL}' "
          f"text-anchor='middle'>{esc(clip(xlabel, W - pl - pr))}</text>")
    if ylabel:
        # Rotated about its own anchor, which sits left of the widest tick
        # value because pl was widened above to make room for it.
        cy = (pt + H - pb) // 2
        a(f"<text x='12' y='{cy}' font-size='11' fill='{LABEL}' "
          f"text-anchor='middle' transform='rotate(-90 12 {cy})'>"
          f"{esc(clip(ylabel, H - pt - pb))}</text>")
    a(f"<g font-size='11' fill='{LABEL}'>")
    for idx, label in enumerate(list(exprs) + [lbl for _, lbl in paths]):
        color = SERIES[idx % len(SERIES)]
        ly = pt + 6 + idx * 16
        a(f"<line x1='{W-pr-116}' y1='{ly}' x2='{W-pr-96}' y2='{ly}' stroke='{color}' stroke-width='2.2'/>")
        a(f"<text x='{W-pr-91}' y='{ly+4}'>{esc(label)}</text>")
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
    p.add_argument("-x", nargs=2, type=float, default=None, metavar=("X0", "X1"))
    p.add_argument("-y", nargs=2, type=float, default=None, metavar=("Y0", "Y1"))
    p.add_argument("-t", "--title", default=None)
    p.add_argument("--fill", nargs=2, type=float, default=None, metavar=("A", "B"),
                   help="shade between the first two curves on [a,b]")
    p.add_argument("--points", default=None, help="scatter, e.g. '1,1 2,0.5 3,0.33'")
    p.add_argument("--polar", action="append", default=[], metavar="R",
                   help="polar curve r(t), e.g. 't' for a spiral (repeatable)")
    p.add_argument("--param", action="append", nargs=2, default=[],
                   metavar=("X_T", "Y_T"),
                   help="parametric path x(t) y(t) (repeatable)")
    p.add_argument("--trange", nargs=2, type=float, default=[0.0, 2 * math.pi],
                   metavar=("T0", "T1"),
                   help="parameter range for --polar/--param (default 0 2pi)")
    p.add_argument("--riemann", type=int, default=None, metavar="N",
                   help="draw N rectangles under the first --expr")
    p.add_argument("--riemann-at", choices=("left", "right", "mid"),
                   default="mid", help="where each rectangle takes its height")
    p.add_argument("--riemann-range", nargs=2, type=float, default=None,
                   metavar=("A", "B"), help="sum over [a,b] (default: the x range)")
    p.add_argument("--samples", type=int, default=400,
                   help="samples per curve before simplification (default 400);"
                        " raise it for fine structure, RDP still simplifies")
    p.add_argument("--break-at", action="append", default=[], metavar="X",
                   help="declare a discontinuity at x=X, exactly, for every "
                        "curve; 'I:X' breaks only expression I (repeatable)")
    p.add_argument("--jump-frac", type=float, default=0.5, metavar="F",
                   help="fallback heuristic: break where consecutive samples "
                        "differ by more than F of the y-range (default 0.5, "
                        "0 disables it)")
    p.add_argument("--xlabel", default=None, help="label for the x axis")
    p.add_argument("--ylabel", default=None, help="label for the y axis")
    p.add_argument("--annotate", action="append", nargs=3, default=[],
                   metavar=("X", "Y", "TEXT"),
                   help="mark a point and label it (repeatable)")
    p.add_argument("--vec", action="append", default=[], metavar="V",
                   help="draw an arrow: 'X,Y' from the origin, or "
                        "'TX,TY->HX,HY' from an arbitrary tail; append "
                        "':label' to either (repeatable). Tail-to-tip is how "
                        "vector addition is drawn: --vec 2,1:u "
                        "--vec 2,1->3,3:v --vec 3,3:u+v. For a negative "
                        "leading component use --vec=-3,2 so argparse does "
                        "not read it as a flag. Axes are equalised when both "
                        "ranges are automatic, so angles and lengths are true")
    p.add_argument("--theme", choices=tuple(sorted(THEMES)), default="auto",
                   help="palette: auto (default, reads on either background), "
                        "dark, or light. The image cannot detect the editor "
                        "theme -- see specs/plot-py/theming-experiment.md")
    p.add_argument("--alt", default="plot")
    p.add_argument("-o", "--out", default=None, help="also save the raw .svg here")
    args = p.parse_args()

    if not (args.expr or args.points or args.polar or args.param or args.vec):
        p.error("need at least one --expr, --points, --polar, --param or --vec")
    if args.riemann is not None and args.riemann < 1:
        p.error("--riemann needs a positive rectangle count")
    if args.samples < 2:
        p.error("--samples needs at least 2 samples")

    breaks = []
    for spec in args.break_at:
        idx, sep, val = spec.rpartition(":")
        try:
            breaks.append((int(idx), float(val)) if sep else float(val))
        except ValueError:
            p.error(f"--break-at wants X or I:X, not {spec!r}")

    try:
        annotate = [(float(ax), float(ay), txt)
                    for ax, ay, txt in args.annotate]
    except ValueError:
        p.error("--annotate wants a numeric X and Y")

    try:
        vecs = normalize_vecs(args.vec)
    except ValueError as exc:
        p.error(str(exc))

    y0, y1 = args.y if args.y else (None, None)
    x0, x1 = args.x if args.x else (None, None)
    if x0 is None and not (args.polar or args.param or args.vec):
        x0, x1 = -6.3, 6.3          # the Cartesian default, unchanged

    use_theme(args.theme)

    try:
        svg = build(args.expr, x0, x1, y0, y1,
                    title=args.title, fill=args.fill, points=args.points,
                    samples=args.samples,
                    polar=args.polar, param=[tuple(q) for q in args.param],
                    t0=args.trange[0], t1=args.trange[1],
                    riemann=args.riemann, riemann_at=args.riemann_at,
                    riemann_range=args.riemann_range,
                    breaks=breaks, jump_frac=args.jump_frac,
                    xlabel=args.xlabel, ylabel=args.ylabel,
                    annotate=annotate, vecs=vecs)
    except ValueError as exc:
        sys.stderr.write(f"plot.py: {exc}\n")
        return 2
    uri = to_data_uri(svg)

    if args.out:
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        with open(args.out, "w") as f:
            f.write(svg)

    sys.stderr.write(f"[svg {len(svg)}B -> uri {len(uri)}B, ~{len(uri)//4} tokens]\n")
    print(f"![{args.alt}]({uri})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
