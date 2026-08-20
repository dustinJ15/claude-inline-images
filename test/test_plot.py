#!/usr/bin/env python3
"""Property tests and a size baseline for plot.py.

Run the suite:

    python3 test/test_plot.py            # or: python3 -m unittest discover -s test

Regenerate the recorded size baseline (do this deliberately, and only when a
size change is intended and reviewed):

    python3 test/test_plot.py --update-baseline

Design notes
------------
These tests assert *properties* of the SVG -- well-formedness, geometry inside
the plot area, curve counts, breaks at discontinuities -- and never exact bytes,
because the exact bytes shift whenever a size lever (RDP epsilon, coordinate
rounding, shared <g> attributes) is tuned. The one place bytes are checked is
the size baseline, and there they are checked as an upper *bound* with a
tolerance, so an optimisation passes and an inflation fails.

Stdlib only, matching plot.py: no pytest, no matplotlib.
"""

import json
import math
import os
import re
import sys
import unittest
import xml.etree.ElementTree as ET

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

import plot  # noqa: E402

BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "plot_size_baseline.json")

# Growth allowance on the recorded baseline. Small enough that a real feature
# cost shows up, loose enough that tick-label rounding noise does not.
SIZE_TOLERANCE_FRAC = 0.02
SIZE_TOLERANCE_BYTES = 8

SVG_NS = "{http://www.w3.org/2000/svg}"

# One Riemann rectangle as it appears in the shared <path>:
#   M<x>,<y-top>h<width>v<height>h-<width>z
RECT_RE = re.compile(r"M(-?\d+),(-?\d+)h(-?\d+)v(-?\d+)h-?\d+z")

# One vector as it appears in the shared <path>: the shaft, then the arrowhead
# as a filled triangle.
#   M<tail>L<tip>M<head-left>L<tip>L<head-right>z
VEC_RE = re.compile(
    r"M(-?\d+),(-?\d+)L(-?\d+),(-?\d+)"
    r"M(-?\d+),(-?\d+)L(-?\d+),(-?\d+)L(-?\d+),(-?\d+)z")

# The plot area, in SVG user units.
BOX = (plot.PAD_L, plot.PAD_T, plot.W - plot.PAD_R, plot.H - plot.PAD_B)

# plot.py deliberately lets a curve run one full plot-height past the y-range
# before dropping it, so an asymptote leaves the frame instead of stopping
# short at the edge. Unbounded reference plots are checked against that.
OVERSHOOT = plot.H - plot.PAD_T - plot.PAD_B


# --------------------------------------------------------------------------
# The reference set. Shared by the property tests and the size baseline so the
# two can never drift apart.
# --------------------------------------------------------------------------

REFERENCE_PLOTS = {
    "single-curve": dict(exprs=["sin(x)"], x0=-6.3, x1=6.3, title="sin x"),
    "several-curves": dict(exprs=["sin(x)", "cos(x)", "sin(2*x)"],
                           x0=-6.3, x1=6.3, title="three curves"),
    "shaded-region": dict(exprs=["x**2", "x**3"], x0=0.0, x1=1.0,
                          fill=(0.0, 1.0), title="region"),
    "asymptote": dict(exprs=["1/x"], x0=-3.0, x1=3.0, title="1/x"),
    "tan-asymptotes": dict(exprs=["tan(x)"], x0=-4.5, x1=4.5),
    "scatter-overlay": dict(exprs=["1/x"], x0=0.5, x1=6.0,
                            points="1,1 2,0.5 3,0.3333 4,0.25 5,0.2"),
    "scatter-only": dict(exprs=[], x0=0.0, x1=6.0,
                         points="1,1 2,0.5 3,0.3333 4,0.25 5,0.2"),
    "explicit-yrange": dict(exprs=["exp(x)"], x0=-2.0, x1=2.0, y0=0.0, y1=8.0),
    # New modes (tickets 03, 04). These are additional entries, never edits to
    # the eight above: the existing set must stay byte-for-byte the same size.
    "polar-circle": dict(exprs=[], polar=["1"], title="r = 1"),
    "polar-spiral": dict(exprs=[], polar=["t"], t1=6 * math.pi,
                         title="Archimedean spiral"),
    "param-lemniscate": dict(exprs=[], param=[("cos(t)", "sin(t)*cos(t)")],
                             title="lemniscate"),
    "riemann-midpoint": dict(exprs=["sin(x)"], x0=0.0, x1=2 * math.pi,
                             riemann=12, riemann_at="mid",
                             title="midpoint sum"),
    # Tickets 05 and 06, same rule: additional entries, and the eight above
    # must not move by a byte.
    "declared-break": dict(exprs=["1/x"], x0=-3.0, x1=3.0, breaks=[0.0],
                           jump_frac=0),
    "labelled-axes": dict(exprs=["sin(x)"], x0=-6.3, x1=6.3,
                          xlabel="t (s)", ylabel="amplitude",
                          points="1.57,1:peak"),
    # Ticket 07, same rule again: additional entries only.
    "vector-pair": dict(exprs=[], vecs=["3,2:u", "-1,2:v"],
                        title="two vectors"),
    "vector-addition": dict(exprs=[], vecs=["2,1:u", "2,1->3,3:v",
                                            "3,3:u+v"],
                            title="tip to tail"),
}

# Reference plots that exercise the new modes; kept apart so the eight
# original ones can be size-checked as a closed set.
NEW_MODE_REFERENCES = {"polar-circle", "polar-spiral", "param-lemniscate",
                       "riemann-midpoint", "declared-break", "labelled-axes",
                       "vector-pair", "vector-addition"}
ORIGINAL_REFERENCES = set(REFERENCE_PLOTS) - NEW_MODE_REFERENCES

# Reference plots whose curves are bounded inside the y-range, and so must draw
# entirely within the plot area. The rest are asymptotic by construction.
BOUNDED_REFERENCES = {"single-curve", "several-curves", "shaded-region",
                      "scatter-overlay", "scatter-only", "explicit-yrange",
                      "polar-circle", "polar-spiral", "param-lemniscate",
                      "riemann-midpoint", "labelled-axes",
                      "vector-pair", "vector-addition"}


def expected_labels(kw):
    """Legend labels a reference plot should carry, in drawing order."""
    labels = list(kw.get("exprs", []))
    labels += [f"r={e}" for e in kw.get("polar", [])]
    labels += [f"({a},{b})" for a, b in kw.get("param", [])]
    return labels


def make(name):
    """Build a reference plot by name."""
    return plot.build(**REFERENCE_PLOTS[name])


def uri_size(name):
    return len(plot.to_data_uri(make(name)))


# --------------------------------------------------------------------------
# Helpers for reading geometry back out of the SVG.
# --------------------------------------------------------------------------

def parse(svg):
    return ET.fromstring(svg)


def _points_attr(elem):
    return [tuple(float(v) for v in p.split(","))
            for p in elem.get("points", "").split()]


def polylines(root):
    return [_points_attr(e) for e in root.iter(SVG_NS + "polyline")]


def polygons(root):
    return [_points_attr(e) for e in root.iter(SVG_NS + "polygon")]


def circles(root):
    return [(float(e.get("cx")), float(e.get("cy")))
            for e in root.iter(SVG_NS + "circle")]


def vectors(root):
    """[(tail, tip, head_left, head_right), ...] read back out of the <path>."""
    out = []
    for pth in root.iter(SVG_NS + "path"):
        for m in VEC_RE.findall(pth.get("d", "")):
            v = [float(x) for x in m]
            out.append(((v[0], v[1]), (v[2], v[3]),
                        (v[4], v[5]), (v[8], v[9])))
    return out


def all_drawn_points(root):
    pts = []
    for seq in polylines(root) + polygons(root):
        pts.extend(seq)
    pts.extend(circles(root))
    for tail, tip, hl, hr in vectors(root):
        pts.extend((tail, tip, hl, hr))
    return pts


def stroke_colors(root):
    return [e.get("stroke") for e in root.iter(SVG_NS + "polyline")]


# --------------------------------------------------------------------------


class TestWellFormed(unittest.TestCase):
    """Every reference plot parses as XML and looks like an SVG."""

    def test_reference_plots_parse(self):
        for name in REFERENCE_PLOTS:
            with self.subTest(plot=name):
                root = parse(make(name))
                self.assertEqual(root.tag, SVG_NS + "svg")
                self.assertEqual(root.get("width"), str(plot.W))
                self.assertEqual(root.get("height"), str(plot.H))
                self.assertEqual(root.get("viewBox"),
                                 f"0 0 {plot.W} {plot.H}")

    def test_no_unencoded_uri_breakers_in_data_uri(self):
        """The URI must survive as a markdown link destination."""
        for name in REFERENCE_PLOTS:
            with self.subTest(plot=name):
                uri = plot.to_data_uri(make(name))
                self.assertTrue(uri.startswith("data:image/svg+xml,"))
                for ch in " <>#\"()\n\t":
                    self.assertNotIn(ch, uri,
                                     f"unencoded {ch!r} breaks the markdown link")

    def test_output_is_deterministic(self):
        for name in REFERENCE_PLOTS:
            with self.subTest(plot=name):
                self.assertEqual(make(name), make(name))


class TestInsidePlotArea(unittest.TestCase):
    """Drawn geometry stays where it belongs."""

    def test_bounded_plots_draw_inside_the_plot_area(self):
        x_lo, y_lo, x_hi, y_hi = BOX
        for name in sorted(BOUNDED_REFERENCES):
            with self.subTest(plot=name):
                pts = all_drawn_points(parse(make(name)))
                self.assertTrue(pts, "expected some drawn geometry")
                for px, py in pts:
                    self.assertGreaterEqual(px, x_lo - 1)
                    self.assertLessEqual(px, x_hi + 1)
                    self.assertGreaterEqual(py, y_lo - 1)
                    self.assertLessEqual(py, y_hi + 1)

    def test_x_is_always_inside_the_plot_area(self):
        """Horizontal placement is exact for every plot, asymptotes included."""
        x_lo, _, x_hi, _ = BOX
        for name in REFERENCE_PLOTS:
            with self.subTest(plot=name):
                for px, _ in all_drawn_points(parse(make(name))):
                    self.assertGreaterEqual(px, x_lo - 1)
                    self.assertLessEqual(px, x_hi + 1)

    def test_asymptotic_plots_stay_within_the_documented_overshoot(self):
        _, y_lo, _, y_hi = BOX
        for name in sorted(set(REFERENCE_PLOTS) - BOUNDED_REFERENCES):
            with self.subTest(plot=name):
                for _, py in all_drawn_points(parse(make(name))):
                    self.assertGreaterEqual(py, y_lo - OVERSHOOT - 1)
                    self.assertLessEqual(py, y_hi + OVERSHOOT + 1)


class TestCurveCount(unittest.TestCase):
    """The number of distinct curves matches the request."""

    def test_one_color_per_expression(self):
        for name, kw in REFERENCE_PLOTS.items():
            with self.subTest(plot=name):
                root = parse(make(name))
                colors = set(stroke_colors(root))
                expected = {plot.SERIES[i % len(plot.SERIES)]
                            for i in range(len(expected_labels(kw)))}
                self.assertEqual(colors, expected)

    def test_legend_has_one_entry_per_expression(self):
        for name, kw in REFERENCE_PLOTS.items():
            with self.subTest(plot=name):
                svg = make(name)
                for label in expected_labels(kw):
                    self.assertIn(f">{plot.esc(label)}<", svg)

    def test_a_continuous_curve_is_one_polyline(self):
        for expr, rng in (("sin(x)", (-6.3, 6.3)),
                          ("x**3-2*x", (-2.0, 2.0)),
                          ("exp(x)", (-2.0, 2.0))):
            with self.subTest(expr=expr):
                root = parse(plot.build([expr], *rng))
                self.assertEqual(len(polylines(root)), 1)

    def test_five_curves_get_five_distinct_colors(self):
        exprs = ["sin(x)", "cos(x)", "sin(2*x)", "cos(2*x)", "sin(x)/2"]
        root = parse(plot.build(exprs, -6.3, 6.3))
        self.assertEqual(len(set(stroke_colors(root))), 5)


class TestDiscontinuity(unittest.TestCase):
    """A known discontinuity breaks the path rather than bridging it."""

    def test_one_over_x_is_drawn_as_two_branches(self):
        root = parse(plot.build(["1/x"], -3.0, 3.0))
        segs = polylines(root)
        self.assertGreaterEqual(len(segs), 2)

    def test_no_segment_bridges_the_pole_at_zero(self):
        svg = plot.build(["1/x"], -3.0, 3.0)
        root = parse(svg)
        zero_px = plot.PAD_L + (0.0 - -3.0) / 6.0 * (plot.W - plot.PAD_L - plot.PAD_R)
        for seg in polylines(root):
            xs = [px for px, _ in seg]
            self.assertFalse(min(xs) < zero_px - 2 < zero_px + 2 < max(xs),
                             "a single polyline spans the pole at x=0")

    def test_tan_has_a_segment_per_branch(self):
        # tan on [-4.5, 4.5] has poles at +-pi/2 only (+-3pi/2 is 4.712, just
        # outside), so three branches, each its own polyline.
        root = parse(plot.build(["tan(x)"], -4.5, 4.5))
        self.assertEqual(len(polylines(root)), 3)

    def test_a_steep_but_continuous_curve_is_not_split(self):
        # Documents the current heuristic: a jump over half the y-range breaks
        # the path. x**3 is steep near the edges but never jumps that far
        # between samples, so it must stay one path.
        root = parse(plot.build(["x**3"], -2.0, 2.0))
        self.assertEqual(len(polylines(root)), 1)


class TestEdgeCases(unittest.TestCase):
    """The four edge cases the spec calls out for day one."""

    def test_expression_undefined_over_part_of_the_range(self):
        # sqrt(x) is undefined for x < 0; the defined half must still be drawn.
        svg = plot.build(["sqrt(x)"], -1.0, 4.0)
        root = parse(svg)
        segs = polylines(root)
        self.assertEqual(len(segs), 1)
        zero_px = plot.PAD_L + (0.0 - -1.0) / 5.0 * (plot.W - plot.PAD_L - plot.PAD_R)
        for px, _ in segs[0]:
            self.assertGreaterEqual(px, zero_px - 2,
                                    "drew the curve where it is undefined")

    def test_range_with_no_finite_values(self):
        # log(x) is undefined everywhere on [-5, -1]: axes only, no curve, and
        # crucially no crash and no NaN in the output.
        svg = plot.build(["log(x)"], -5.0, -1.0)
        root = parse(svg)
        self.assertEqual(polylines(root), [])
        self.assertNotIn("nan", svg.lower())
        self.assertNotIn("inf", svg.lower())

    def test_single_point(self):
        svg = plot.build([], 0.0, 2.0, points="1,1")
        root = parse(svg)
        pts = circles(root)
        self.assertEqual(len(pts), 1)
        x_lo, y_lo, x_hi, y_hi = BOX
        (px, py), = pts
        self.assertTrue(x_lo <= px <= x_hi and y_lo <= py <= y_hi)

    def test_single_sample_of_a_curve_is_not_a_stroke(self):
        # One in-range sample cannot make a polyline; it must not emit a
        # degenerate one-point path either.
        root = parse(plot.build(["1/x"], -1e-9, 1e-9))
        for seg in polylines(root):
            self.assertGreaterEqual(len(seg), 2)

    def test_constant_function(self):
        svg = plot.build(["3"], -2.0, 2.0)
        root = parse(svg)
        segs = polylines(root)
        self.assertEqual(len(segs), 1)
        ys = {py for _, py in segs[0]}
        self.assertEqual(len(ys), 1, "a constant should be a flat line")
        y_lo, y_hi = BOX[1], BOX[3]
        self.assertTrue(y_lo <= ys.pop() <= y_hi)

    def test_zero_width_x_range_fails_cleanly(self):
        # Ticket 01 defect 2, now fixed: a degenerate range is a usage error,
        # not a ZeroDivisionError from inside the scaling helper.
        with self.assertRaises(ValueError) as cm:
            plot.build(["x**2"], 1.0, 1.0)
        self.assertIn("x range", str(cm.exception))

    def test_zero_width_y_range_fails_cleanly(self):
        with self.assertRaises(ValueError) as cm:
            plot.build(["x**2"], -1.0, 1.0, y0=2.0, y1=2.0)
        self.assertIn("y range", str(cm.exception))


class TestTextIsEscaped(unittest.TestCase):
    """Ticket 01 defect 1: unescaped text made the whole image fail to render."""

    HOSTILE = ["a & b", "x < y", "x > y", 'he said "hi"', "it's fine",
               "<script>alert(1)</script>", "a&b<c>d"]

    def test_hostile_titles_still_produce_well_formed_svg(self):
        for t in self.HOSTILE:
            with self.subTest(title=t):
                root = parse(plot.build(["sin(x)"], -1.0, 1.0, title=t))
                texts = [e.text for e in root.iter(SVG_NS + "text")]
                self.assertIn(t, texts, "title text did not round-trip")

    def test_hostile_legend_labels_still_produce_well_formed_svg(self):
        # The legend prints each expression verbatim, so a stray '&' there had
        # exactly the same effect as one in the title.
        root = parse(plot.build(["x if x<1 else 1", "sin(x)"], -1.0, 1.0))
        texts = [e.text for e in root.iter(SVG_NS + "text")]
        self.assertIn("x if x<1 else 1", texts)

    def test_hostile_polar_and_parametric_labels_are_escaped(self):
        root = parse(plot.build([], polar=["1 if t<1 else 1"], title="p & q"))
        texts = [e.text for e in root.iter(SVG_NS + "text")]
        self.assertIn("r=1 if t<1 else 1", texts)
        self.assertIn("p & q", texts)

    def test_a_hostile_title_does_not_leak_raw_markup(self):
        svg = plot.build(["sin(x)"], -1.0, 1.0, title="<script>x</script>")
        self.assertNotIn("<script>", svg)
        self.assertIn("&lt;script&gt;", svg)

    def test_escaping_costs_nothing_when_nothing_needs_escaping(self):
        for name in sorted(ORIGINAL_REFERENCES):
            with self.subTest(plot=name):
                self.assertNotIn("&", make(name))


class TestPolarAndParametric(unittest.TestCase):
    """Ticket 03."""

    def data_points(self, svg, label_index=0):
        """Pixel points of the label_index'th drawn path."""
        return polylines(parse(svg))[label_index]

    def test_unit_circle_is_equidistant_from_the_origin(self):
        svg = plot.build([], polar=["1"])
        root = parse(svg)
        segs = polylines(root)
        self.assertEqual(len(segs), 1)
        # The origin in pixel space: where both axis lines cross.
        cx = sum(px for px, _ in segs[0]) / len(segs[0])
        cy = sum(py for _, py in segs[0]) / len(segs[0])
        radii = [math.hypot(px - cx, py - cy) for px, py in segs[0]]
        r0 = sum(radii) / len(radii)
        self.assertGreater(r0, 20, "circle is too small to judge")
        for r in radii:
            self.assertLess(abs(r - r0) / r0, 0.06,
                            "r=1 did not render as a circle")

    def test_the_circle_closes(self):
        segs = polylines(parse(plot.build([], polar=["1"])))
        first, last = segs[0][0], segs[0][-1]
        self.assertLess(math.hypot(first[0] - last[0], first[1] - last[1]), 3)

    def test_archimedean_spiral_radius_increases(self):
        svg = plot.build([], polar=["t"], t0=0.0, t1=6 * math.pi)
        pts = polylines(parse(svg))[0]
        cx, cy = pts[0]                      # the spiral starts at the origin
        radii = [math.hypot(px - cx, py - cy) for px, py in pts]
        # Sampled at each turn, the radius must be strictly increasing.
        peaks = [max(radii[i:i + len(radii) // 6])
                 for i in range(0, len(radii) - len(radii) // 6,
                                max(1, len(radii) // 6))]
        self.assertEqual(peaks, sorted(peaks))
        self.assertGreater(peaks[-1], peaks[0] * 2)

    def test_a_parametric_path_that_crosses_itself_is_one_path(self):
        # Lemniscate of Gerono: x=cos t, y=sin t cos t. It crosses at the
        # origin, so any assumption that one x has one y breaks here.
        svg = plot.build([], param=[("cos(t)", "sin(t)*cos(t)")])
        segs = polylines(parse(svg))
        self.assertEqual(len(segs), 1)
        pts = segs[0]
        by_x = {}
        for px, py in pts:
            by_x.setdefault(round(px), set()).add(round(py))
        multi = [x for x, ys in by_x.items() if len(ys) > 1]
        self.assertTrue(multi, "no x carried two y values; path was flattened")
        xs = [px for px, _ in pts]
        self.assertNotEqual(xs, sorted(xs))
        self.assertNotEqual(xs, sorted(xs, reverse=True))

    def test_a_lissajous_figure_renders(self):
        svg = plot.build([], param=[("sin(3*t)", "sin(2*t)")])
        segs = polylines(parse(svg))
        self.assertEqual(len(segs), 1)
        self.assertGreater(len(segs[0]), 20)

    def test_new_paths_stay_inside_the_plot_area(self):
        x_lo, y_lo, x_hi, y_hi = BOX
        for kw in (dict(polar=["1"]), dict(polar=["t"], t1=6 * math.pi),
                   dict(param=[("cos(t)", "sin(t)*cos(t)")]),
                   dict(param=[("sin(3*t)", "sin(2*t)")])):
            with self.subTest(**kw):
                for px, py in all_drawn_points(parse(plot.build([], **kw))):
                    self.assertTrue(x_lo - 1 <= px <= x_hi + 1)
                    self.assertTrue(y_lo - 1 <= py <= y_hi + 1)

    def test_size_levers_apply_to_the_new_paths(self):
        # Integer pixel coordinates, no consecutive duplicates, and RDP
        # actually simplifying: 400 samples must not become 400 points.
        svg = plot.build([], polar=["1"], samples=400)
        pts_attr = parse(svg).find(f".//{SVG_NS}polyline").get("points")
        for tok in pts_attr.split():
            self.assertRegex(tok, r"^-?\d+,-?\d+$", "non-integer coordinate")
        toks = pts_attr.split()
        self.assertLess(len(toks), 200, "RDP did not simplify the polar path")
        for a, b in zip(toks, toks[1:]):
            self.assertNotEqual(a, b, "consecutive duplicate point kept")

    def test_denser_sampling_is_not_thrown_away(self):
        few = plot.build([], polar=["t"], t1=6 * math.pi, samples=60)
        many = plot.build([], polar=["t"], t1=6 * math.pi, samples=800)
        self.assertNotEqual(few, many)

    def test_polar_and_cartesian_can_be_combined(self):
        root = parse(plot.build(["sin(x)"], -2.0, 2.0, y0=-2.0, y1=2.0,
                                polar=["1"]))
        self.assertEqual(len(set(stroke_colors(root))), 2)

    def test_a_polar_expression_that_is_undefined_does_not_crash(self):
        svg = plot.build([], polar=["log(t)"], t0=0.0, t1=2 * math.pi)
        parse(svg)
        self.assertNotIn("nan", svg.lower())


class TestRiemannRectangles(unittest.TestCase):
    """Ticket 04."""

    def rects(self, svg):
        """(<g>, [(x, y_top, width, height), ...]) for the rectangle group.

        The rectangles are subpaths of one <path> rather than <rect> elements
        -- see plot.py for why -- so the geometry is read back out of the `d`
        attribute. The assertions below are the same either way.
        """
        root = parse(svg)
        out = []
        for g in root.iter(SVG_NS + "g"):
            for pth in g.iter(SVG_NS + "path"):
                found = RECT_RE.findall(pth.get("d", ""))
                if found:
                    out.append((g, [tuple(float(v) for v in m)
                                    for m in found]))
        return out

    def test_rectangle_count_is_controllable(self):
        for n in (1, 4, 12, 50):
            with self.subTest(n=n):
                (g, rs), = self.rects(plot.build(["x**2"], 0.0, 2.0, riemann=n))
                self.assertEqual(len(rs), n)

    def test_sampling_position_changes_the_heights(self):
        heights = {}
        for at in ("left", "right", "mid"):
            (g, rs), = self.rects(
                plot.build(["x**2"], 0.0, 2.0, riemann=6, riemann_at=at))
            heights[at] = [r[3] for r in rs]
        self.assertNotEqual(heights["left"], heights["right"])
        self.assertNotEqual(heights["left"], heights["mid"])
        self.assertNotEqual(heights["right"], heights["mid"])

    def test_left_sum_underestimates_an_increasing_function(self):
        def total(at):
            (g, rs), = self.rects(
                plot.build(["x**2"], 0.0, 2.0, riemann=8, riemann_at=at,
                           y0=0.0, y1=4.0))
            return sum(r[3] for r in rs)
        self.assertLess(total("left"), total("mid"))
        self.assertLess(total("mid"), total("right"))

    def test_an_unknown_sampling_position_is_rejected(self):
        with self.assertRaises(ValueError):
            plot.build(["x**2"], 0.0, 2.0, riemann=4, riemann_at="middle")

    def test_riemann_without_an_expression_is_rejected(self):
        with self.assertRaises(ValueError):
            plot.build([], 0.0, 2.0, riemann=4)

    def test_styling_is_shared_not_repeated_per_rectangle(self):
        svg = plot.build(["x**2"], 0.0, 2.0, riemann=40)
        (g, rs), = self.rects(svg)
        self.assertEqual(len(rs), 40)
        self.assertIsNotNone(g.get("fill"))
        self.assertIsNotNone(g.get("stroke"))
        # One copy of the fill colour for the group, one for the stroke, and
        # nothing per rectangle. (The curve's own stroke is a different hue.)
        self.assertEqual(svg.count("fill-opacity='.18'"), 1)
        self.assertEqual(svg.count("stroke-opacity='.5'"), 1)

    def test_per_rectangle_byte_cost_is_small(self):
        """A hundred rectangles must not cost a hundred copies of the styling."""
        def uri(n):
            return len(plot.to_data_uri(
                plot.build(["sin(x)"], 0.0, 2 * math.pi, riemann=n)))
        per = (uri(110) - uri(10)) / 100.0
        self.assertLess(per, 22, f"{per:.1f}B per rectangle is too expensive")
        # And the styling is not part of that marginal cost.
        styling = len("fill='#4fc3f7' fill-opacity='.18' "
                      "stroke='#4fc3f7' stroke-opacity='.5'")
        self.assertLess(per, styling)

    def test_a_curve_below_the_axis_draws_downward_rectangles(self):
        # sin over 0..2pi: the first half is above the axis, the second below.
        svg = plot.build(["sin(x)"], 0.0, 2 * math.pi, riemann=8,
                         riemann_at="mid", y0=-1.2, y1=1.2)
        (g, rs), = self.rects(svg)
        zero_py = plot.H - plot.PAD_B - (0.0 - -1.2) / 2.4 * (
            plot.H - plot.PAD_T - plot.PAD_B)
        above, below = 0, 0
        for x, y, w, h in rs:
            self.assertGreaterEqual(h, 0, "negative height is invalid SVG")
            self.assertGreater(h, 0, "a nonzero value drew no rectangle")
            if y + h <= zero_py + 1:
                above += 1
            elif y >= zero_py - 1:
                below += 1
            self.assertLess(min(abs(y - zero_py), abs(y + h - zero_py)), 1.5,
                            "a rectangle does not sit on the axis")
        self.assertEqual(above, 4)
        self.assertEqual(below, 4)

    def test_rectangles_stay_inside_the_plot_area(self):
        svg = plot.build(["sin(x)"], 0.0, 2 * math.pi, riemann=20)
        (g, rs), = self.rects(svg)
        for x, y, w, h in rs:
            self.assertGreaterEqual(x, BOX[0] - 1)
            self.assertLessEqual(x + w, BOX[2] + 1)
            self.assertGreaterEqual(y, BOX[1] - 1)
            self.assertLessEqual(y + h, BOX[3] + 1)

    def test_rectangles_tile_the_range_without_gaps(self):
        (g, rs), = self.rects(plot.build(["x**2"], 0.0, 2.0, riemann=10))
        rs.sort()
        for (x, _, w, _), (nx, _, _, _) in zip(rs, rs[1:]):
            self.assertEqual(x + w, nx, "rectangles do not tile")

    def test_a_sub_range_can_be_integrated(self):
        (g, rs), = self.rects(plot.build(["x**2"], -2.0, 2.0, riemann=4,
                                         riemann_range=(0.0, 2.0)))
        mid_px = plot.PAD_L + (0.0 - -2.0) / 4.0 * (plot.W - plot.PAD_L - plot.PAD_R)
        self.assertGreaterEqual(min(r[0] for r in rs), mid_px - 1)

    def test_rectangles_are_drawn_under_the_curve_not_over_it(self):
        svg = plot.build(["x**2"], 0.0, 2.0, riemann=6)
        self.assertLess(svg.index("<path"), svg.index("<polyline"))

    def test_the_rectangles_are_well_formed_geometry(self):
        for at in ("left", "right", "mid"):
            with self.subTest(at=at):
                (g, rs), = self.rects(
                    plot.build(["1/x"], 0.5, 4.0, riemann=9, riemann_at=at))
                for x, y, w, h in rs:
                    self.assertGreater(w, 0)
                    self.assertGreaterEqual(h, 0)


class TestDeclaredBreaks(unittest.TestCase):
    """Ticket 05: a discontinuity the user knows about is stated, not guessed.

    The heuristic can only see a jump; a small jump is invisible to it at any
    threshold that does not also cut steep curves in half. `breaks` is exact:
    the path is cut between the samples that straddle the declared x, whatever
    the values there do.
    """

    # atan(x) with a 0.05 step at x=1: continuous to the heuristic (the jump is
    # far under any usable threshold), discontinuous in fact.
    SMALL_STEP = "atan(x)+(0 if x<1 else 0.05)"

    def px(self, x, x0=-2.0, x1=3.0):
        return plot.PAD_L + (x - x0) / (x1 - x0) * (plot.W - plot.PAD_L - plot.PAD_R)

    def test_the_heuristic_cannot_see_a_small_jump(self):
        root = parse(plot.build([self.SMALL_STEP], -2.0, 3.0))
        self.assertEqual(len(polylines(root)), 1)

    def test_a_declared_break_actually_breaks_the_path(self):
        root = parse(plot.build([self.SMALL_STEP], -2.0, 3.0, breaks=[1.0]))
        self.assertEqual(len(polylines(root)), 2)

    def test_no_segment_crosses_a_declared_break(self):
        root = parse(plot.build([self.SMALL_STEP], -2.0, 3.0, breaks=[1.0]))
        bx = self.px(1.0)
        for seg in polylines(root):
            xs = [p[0] for p in seg]
            self.assertFalse(min(xs) < bx - 2 < bx + 2 < max(xs),
                             "a polyline spans the declared break")
        left = [s for s in polylines(root) if max(p[0] for p in s) <= bx + 1]
        right = [s for s in polylines(root) if min(p[0] for p in s) >= bx - 1]
        self.assertEqual(len(left), 1)
        self.assertEqual(len(right), 1)

    def test_a_declared_break_survives_simplification(self):
        """RDP runs per segment, so it can never bridge a break.

        A straight line either side of the break is exactly the case where a
        naive implementation -- simplify first, split after -- would collapse
        the two halves into one segment.
        """
        svg = plot.build(["x if x<1 else x+0.02"], -2.0, 3.0, breaks=[1.0],
                         jump_frac=0)
        segs = polylines(parse(svg))
        self.assertEqual(len(segs), 2)
        for s in segs:
            self.assertLessEqual(len(s), 4, "RDP stopped simplifying")

    def test_several_breaks_can_be_declared(self):
        segs = polylines(parse(plot.build(
            ["sin(x)"], -6.3, 6.3, breaks=[-3.0, 0.0, 3.0])))
        self.assertEqual(len(segs), 4)

    def test_a_break_can_be_scoped_to_one_expression(self):
        """(index, x) declares the break for that expression only."""
        root = parse(plot.build(["sin(x)", "cos(x)"], -6.3, 6.3,
                                breaks=[(1, 0.0)]))
        by_color = {}
        for e in root.iter(SVG_NS + "polyline"):
            by_color.setdefault(e.get("stroke"), []).append(e)
        self.assertEqual(len(by_color[plot.SERIES[0]]), 1)
        self.assertEqual(len(by_color[plot.SERIES[1]]), 2)

    def test_a_break_outside_the_range_changes_nothing(self):
        self.assertEqual(plot.build(["sin(x)"], -6.3, 6.3),
                         plot.build(["sin(x)"], -6.3, 6.3, breaks=[99.0]))

    def test_declaring_no_breaks_costs_nothing(self):
        for name in sorted(ORIGINAL_REFERENCES):
            with self.subTest(plot=name):
                kw = dict(REFERENCE_PLOTS[name])
                self.assertEqual(plot.build(**kw),
                                 plot.build(breaks=[], **kw))


class TestJumpThreshold(unittest.TestCase):
    """Ticket 05: the heuristic stays the default, but its threshold is a knob."""

    # tanh(50x) on a fixed y-range, sampled coarsely: continuous, but two
    # neighbouring samples land near -1 and +1, which the default 0.5 rule
    # reads as a discontinuity. This is precisely the misfire the ticket names.
    STEEP = dict(exprs=["tanh(50*x)"], x0=-1.0, x1=1.0, y0=-1.2, y1=1.2,
                 samples=41)

    def segs(self, **over):
        return polylines(parse(plot.build(**dict(self.STEEP, **over))))

    def test_the_default_threshold_misfires_on_a_steep_curve(self):
        # Documented, not endorsed: this is why the threshold is exposed.
        self.assertEqual(len(self.segs()), 2)

    def test_raising_the_threshold_keeps_a_steep_curve_continuous(self):
        self.assertEqual(len(self.segs(jump_frac=0.85)), 1)

    def test_zero_disables_the_heuristic_entirely(self):
        self.assertEqual(len(self.segs(jump_frac=0)), 1)

    def test_lowering_the_threshold_splits_more(self):
        many = len(polylines(parse(plot.build(["sin(x)"], -6.3, 6.3,
                                              samples=41, jump_frac=0.05))))
        self.assertGreater(many, 1)

    def test_disabling_the_heuristic_does_not_bridge_a_real_pole(self):
        """Out-of-range samples still break the path; that is not heuristic."""
        root = parse(plot.build(["1/x"], -3.0, 3.0, jump_frac=0))
        zero_px = plot.PAD_L + 0.5 * (plot.W - plot.PAD_L - plot.PAD_R)
        for seg in polylines(root):
            xs = [p[0] for p in seg]
            self.assertFalse(min(xs) < zero_px - 2 < zero_px + 2 < max(xs))

    def test_the_default_is_the_previous_hardcoded_value(self):
        for name in sorted(ORIGINAL_REFERENCES):
            with self.subTest(plot=name):
                kw = dict(REFERENCE_PLOTS[name])
                self.assertEqual(plot.build(**kw),
                                 plot.build(jump_frac=0.5, **kw))


class TestSamplingDensity(unittest.TestCase):
    """Ticket 05: fine structure must survive to the drawing stage."""

    FINE = dict(exprs=["sin(50*x)"], x0=-6.3, x1=6.3)

    def points_of(self, samples):
        segs = polylines(parse(plot.build(samples=samples, **self.FINE)))
        return [p for s in segs for p in s]

    def extrema(self, pts):
        n = 0
        for a, b, c in zip(pts, pts[1:], pts[2:]):
            if (b[1] - a[1]) * (c[1] - b[1]) < 0:
                n += 1
        return n

    def test_coarse_sampling_aliases_fine_structure_away(self):
        # 100 samples over 100 half-periods: the curve is unrecoverable.
        self.assertLess(self.extrema(self.points_of(100)), 60)

    def test_dense_sampling_recovers_it(self):
        # sin(50x) over [-6.3, 6.3] has ~100 turning points.
        self.assertGreater(self.extrema(self.points_of(4000)), 90)

    def test_density_does_not_cost_bytes_proportionally(self):
        """Ten times the samples must not be ten times the URI."""
        def size(n):
            return len(plot.to_data_uri(plot.build(samples=n, **self.FINE)))
        self.assertLess(size(4000), size(400) * 2)

    def test_sampling_density_reaches_every_mode(self):
        for kw in (dict(exprs=["sin(30*x)"], x0=-3.0, x1=3.0),
                   dict(exprs=[], polar=["1+0.3*sin(20*t)"]),
                   dict(exprs=[], param=[("sin(9*t)", "sin(8*t)")])):
            with self.subTest(**kw):
                self.assertNotEqual(plot.build(samples=60, **kw),
                                    plot.build(samples=2000, **kw))

    def test_the_default_sample_count_is_unchanged(self):
        for name in sorted(ORIGINAL_REFERENCES):
            with self.subTest(plot=name):
                kw = dict(REFERENCE_PLOTS[name])
                self.assertEqual(plot.build(**kw),
                                 plot.build(samples=400, **kw))


class TestAxisLabelsAndAnnotations(unittest.TestCase):
    """Ticket 06."""

    def texts(self, root):
        return [(e, e.text or "") for e in root.iter(SVG_NS + "text")]

    def find_text(self, root, needle):
        for e, t in self.texts(root):
            if needle in t:
                return e
        return None

    def test_axis_labels_are_drawn(self):
        root = parse(plot.build(["sin(x)"], -6.3, 6.3,
                                xlabel="time (s)", ylabel="amplitude"))
        self.assertIsNotNone(self.find_text(root, "time (s)"))
        self.assertIsNotNone(self.find_text(root, "amplitude"))

    def test_the_y_label_is_rotated(self):
        root = parse(plot.build(["sin(x)"], -6.3, 6.3, ylabel="amplitude"))
        e = self.find_text(root, "amplitude")
        self.assertIn("rotate", e.get("transform", ""))

    def test_labels_do_not_overlap_the_plot_area(self):
        svg = plot.build(["sin(x)"], -6.3, 6.3, xlabel="time", ylabel="volts")
        root = parse(svg)
        xl = self.find_text(root, "time")
        # Below every gridline and every x tick value.
        tick_ys = [float(e.get("y")) for e, t in self.texts(root)
                   if t and re.fullmatch(r"-?[\d.]+", t)
                   and e.get("transform") is None
                   and float(e.get("y")) > plot.H / 2]
        self.assertTrue(tick_ys)
        self.assertGreater(float(xl.get("y")), max(tick_ys) + 8)
        self.assertLessEqual(float(xl.get("y")), plot.H)
        # And left of every y tick value, allowing for their rendered width.
        yl = self.find_text(root, "volts")
        tick_left = min(float(e.get("x")) - 6.2 * len(t)
                        for e, t in self.texts(root)
                        if t and re.fullmatch(r"-?[\d.]+", t)
                        and e.get("transform") is None
                        and float(e.get("x")) < plot.W / 2)
        self.assertLess(float(yl.get("x")) + 4, tick_left)

    def test_the_plot_area_shrinks_to_make_room(self):
        """Labels take space from the padding, never from the curve."""
        plain = all_drawn_points(parse(plot.build(["sin(x)"], -6.3, 6.3)))
        boxed = all_drawn_points(parse(plot.build(
            ["sin(x)"], -6.3, 6.3, xlabel="t", ylabel="y")))
        self.assertGreater(min(p[0] for p in boxed), min(p[0] for p in plain))
        self.assertLess(max(p[1] for p in boxed), max(p[1] for p in plain))

    def test_a_point_can_carry_an_annotation(self):
        root = parse(plot.build([], 0.0, 4.0, points="1,1:start 3,2:peak"))
        self.assertEqual(len(circles(root)), 2)
        self.assertIsNotNone(self.find_text(root, "start"))
        self.assertIsNotNone(self.find_text(root, "peak"))

    def test_an_annotation_sits_next_to_its_point(self):
        root = parse(plot.build([], 0.0, 4.0, points="1,1:here"))
        (cx, cy), = circles(root)
        e = self.find_text(root, "here")
        self.assertLess(abs(float(e.get("x")) - cx), 60)
        self.assertLess(abs(float(e.get("y")) - cy), 24)

    def test_annotations_may_contain_spaces_via_the_explicit_form(self):
        root = parse(plot.build([], 0.0, 4.0,
                                annotate=[(1.0, 1.0, "local maximum")]))
        self.assertEqual(len(circles(root)), 1)
        self.assertIsNotNone(self.find_text(root, "local maximum"))

    def test_annotations_stay_inside_the_image(self):
        root = parse(plot.build([], 0.0, 4.0, y0=-1.0, y1=1.0,
                                points="0.02,1:leftmost 3.98,1:rightmost "
                                       "2,9:above 2,-9:below"))
        for e, t in self.texts(root):
            if t in ("leftmost", "rightmost", "above", "below"):
                half = 6.2 * len(t) / 2
                self.assertGreaterEqual(float(e.get("x")) - half, 0)
                self.assertLessEqual(float(e.get("x")) + half, plot.W)
                self.assertGreaterEqual(float(e.get("y")) - 8, 0)
                self.assertLessEqual(float(e.get("y")), plot.H)

    def test_unlabelled_plots_are_byte_identical(self):
        """The hard requirement: optional and free."""
        base = load_baseline()
        for name in sorted(ORIGINAL_REFERENCES):
            with self.subTest(plot=name):
                self.assertEqual(uri_size(name), base["plots"][name])

    def test_labels_and_annotations_are_escaped(self):
        svg = plot.build(["sin(x)"], -6.3, 6.3, xlabel="a & b",
                         ylabel="x < y > z", points="1,0:p&<>q")
        root = parse(svg)                     # would raise if malformed
        texts = [t for _, t in self.texts(root)]
        self.assertIn("a & b", texts)
        self.assertIn("x < y > z", texts)
        self.assertIn("p&<>q", texts)
        self.assertNotIn("<script", svg)

    def test_a_long_label_is_truncated_rather_than_overflowing(self):
        long = "amplitude of the measured response in millivolts " * 3
        root = parse(plot.build(["sin(x)"], -6.3, 6.3,
                                xlabel=long, ylabel=long))
        for _, t in self.texts(root):
            if t.startswith("amplitude"):
                self.assertTrue(t.endswith("..."), t)
                self.assertLess(len(t), len(long))
                self.assertLess(6.2 * len(t), plot.W)

    def test_a_long_annotation_is_truncated(self):
        long = "this annotation is far too long to fit beside its point"
        root = parse(plot.build([], 0.0, 4.0, annotate=[(2.0, 1.0, long)]))
        e = self.find_text(root, "this annotation")
        self.assertTrue(e.text.endswith("..."))
        self.assertLess(6.2 * len(e.text), plot.W)

    def test_a_long_title_is_truncated(self):
        long = "a title nobody would sensibly write but which must not " \
               "run off the edge of the image " * 2
        root = parse(plot.build(["sin(x)"], -6.3, 6.3, title=long))
        e = self.find_text(root, "a title nobody")
        self.assertTrue(e.text.endswith("..."))
        self.assertLess(7.2 * len(e.text), plot.W)

    def test_truncation_leaves_short_text_alone(self):
        self.assertEqual(plot.clip("short", 200), "short")


class TestVectors(unittest.TestCase):
    """Ticket 07: arrows, so linear algebra is drawable.

    A vector is a *displacement*, so the two things that must be true of every
    one of them are that it points the right way and that its length means
    something. The second is why these plots equalise the axes: unequal units
    per pixel makes a 45-degree vector render at some other angle, which is
    not a cosmetic problem -- it is a wrong picture.
    """

    def vecs(self, **kw):
        return vectors(parse(plot.build(kw.pop("exprs", []), **kw)))

    def px(self, x, y, **kw):
        """Where (x, y) lands, read back from the plot's own scaling."""
        root = parse(plot.build([], **kw))
        return root

    # -- parsing ---------------------------------------------------------

    def test_a_bare_point_is_a_vector_from_the_origin(self):
        self.assertEqual(plot.parse_vec("3,2"), (0.0, 0.0, 3.0, 2.0, None))

    def test_an_arrow_gives_the_tail_and_the_tip(self):
        self.assertEqual(plot.parse_vec("1,1->4,3"),
                         (1.0, 1.0, 4.0, 3.0, None))

    def test_a_label_is_the_tail_after_a_colon(self):
        self.assertEqual(plot.parse_vec("3,2:u"), (0.0, 0.0, 3.0, 2.0, "u"))
        self.assertEqual(plot.parse_vec("1,1->4,3:v"),
                         (1.0, 1.0, 4.0, 3.0, "v"))

    def test_whitespace_and_negatives_parse(self):
        self.assertEqual(plot.parse_vec(" -1.5,-2 -> 0,0.5 : w "),
                         (-1.5, -2.0, 0.0, 0.5, "w"))

    def test_a_malformed_vector_is_a_value_error(self):
        for spec in ("", "3", "3,2,1", "a,b", "1,1->", "->1,1", "1,1->2"):
            with self.subTest(spec=spec):
                with self.assertRaises(ValueError):
                    plot.parse_vec(spec)

    def test_build_accepts_both_a_spec_and_a_tuple(self):
        self.assertEqual(plot.build([], vecs=["3,2"]),
                         plot.build([], vecs=[(0.0, 0.0, 3.0, 2.0, None)]))

    # -- geometry --------------------------------------------------------

    def test_one_vector_is_one_shaft_and_one_arrowhead(self):
        vs = self.vecs(vecs=["3,2"])
        self.assertEqual(len(vs), 1)

    def test_a_vector_from_the_origin_starts_at_the_origin(self):
        """Its tail must sit where the two axis lines cross, not near it."""
        svg = plot.build([], vecs=["3,2"])
        root = parse(svg)
        (tail, tip, _, _), = vectors(root)
        axes = [e for e in root.iter(SVG_NS + "line")
                if e.get("stroke-opacity") == ".55"]
        self.assertEqual(len(axes), 2, "expected both zero lines on the plot")
        vertical = [e for e in axes if e.get("x1") == e.get("x2")][0]
        horizontal = [e for e in axes if e.get("y1") == e.get("y2")][0]
        self.assertAlmostEqual(tail[0], float(vertical.get("x1")), delta=1)
        self.assertAlmostEqual(tail[1], float(horizontal.get("y1")), delta=1)

    def test_a_vector_points_up_and_right_on_the_image(self):
        """SVG y grows downward; a positive y component must still point up."""
        (tail, tip, _, _), = self.vecs(vecs=["3,2"])
        self.assertGreater(tip[0], tail[0])
        self.assertLess(tip[1], tail[1])

    def test_a_tail_to_tip_vector_starts_where_it_was_told_to(self):
        """u then v-from-u's-tip: the second tail is the first tip."""
        vs = self.vecs(vecs=["2,1", "2,1->3,3"])
        self.assertEqual(len(vs), 2)
        (u_tail, u_tip, _, _), (v_tail, _, _, _) = vs
        self.assertAlmostEqual(v_tail[0], u_tip[0], delta=1)
        self.assertAlmostEqual(v_tail[1], u_tip[1], delta=1)
        self.assertNotAlmostEqual(v_tail[0], u_tail[0], delta=1)

    def test_tip_to_tail_addition_closes(self):
        """u, then v from u's tip, then u+v from the origin: same endpoint."""
        vs = self.vecs(vecs=["2,1", "2,1->3,3", "3,3"])
        (_, _, _, _), (_, v_tip, _, _), (s_tail, s_tip, _, _) = vs
        self.assertAlmostEqual(s_tip[0], v_tip[0], delta=1)
        self.assertAlmostEqual(s_tip[1], v_tip[1], delta=1)
        self.assertAlmostEqual(s_tail[0], vs[0][0][0], delta=1)

    def test_the_arrowhead_is_at_the_tip_not_the_tail(self):
        (tail, tip, hl, hr), = self.vecs(vecs=["3,2"])
        for corner in (hl, hr):
            self.assertLess(math.hypot(corner[0] - tip[0], corner[1] - tip[1]),
                            math.hypot(corner[0] - tail[0],
                                       corner[1] - tail[1]))

    def test_the_arrowhead_is_visible_at_typical_scale(self):
        (tail, tip, hl, hr), = self.vecs(vecs=["3,2"])
        width = math.hypot(hl[0] - hr[0], hl[1] - hr[1])
        self.assertGreaterEqual(width, 6, "arrowhead too narrow to see")
        # Non-degenerate triangle: the two corners are off the shaft's axis.
        area = abs((tip[0] - hl[0]) * (hr[1] - hl[1])
                   - (hr[0] - hl[0]) * (tip[1] - hl[1])) / 2
        self.assertGreater(area, 12)

    def test_a_very_short_vector_still_has_a_visible_arrowhead(self):
        """The head has a floor: it may not shrink away with the vector."""
        (tail, tip, hl, hr), = self.vecs(vecs=["0.02,0.01"],
                                         x0=-1.0, x1=1.0, y0=-1.0, y1=1.0)
        width = math.hypot(hl[0] - hr[0], hl[1] - hr[1])
        self.assertGreaterEqual(width, 6)
        area = abs((tip[0] - hl[0]) * (hr[1] - hl[1])
                   - (hr[0] - hl[0]) * (tip[1] - hl[1])) / 2
        self.assertGreater(area, 8)

    def test_a_zero_length_vector_draws_nothing_and_does_not_crash(self):
        svg = plot.build([], vecs=["0,0"], x0=-1.0, x1=1.0, y0=-1.0, y1=1.0)
        parse(svg)
        self.assertEqual(vectors(parse(svg)), [])
        self.assertNotIn("nan", svg.lower())

    def test_the_head_points_along_the_vector(self):
        """The head's midpoint lies behind the tip, on the shaft."""
        for spec in ("3,2", "-3,2", "0,-4", "-5,0", "1,1->-2,-3"):
            with self.subTest(spec=spec):
                (tail, tip, hl, hr), = self.vecs(
                    vecs=[spec], x0=-6.0, x1=6.0, y0=-6.0, y1=6.0)
                mid = ((hl[0] + hr[0]) / 2, (hl[1] + hr[1]) / 2)
                shaft = math.hypot(tip[0] - tail[0], tip[1] - tail[1])
                back = math.hypot(tip[0] - mid[0], tip[1] - mid[1])
                self.assertGreater(back, 1)
                self.assertLess(back, shaft + 1)
                # mid is on the segment tail->tip, not off to one side.
                cross = ((tip[0] - tail[0]) * (mid[1] - tail[1])
                         - (tip[1] - tail[1]) * (mid[0] - tail[0]))
                self.assertLess(abs(cross) / max(shaft, 1), 1.5)

    # -- equal aspect ----------------------------------------------------

    def test_the_axes_are_equalised_for_a_vector_plot(self):
        """(1,0) and (0,1) must come out the same pixel length."""
        vs = self.vecs(vecs=["1,0", "0,1"])
        lengths = [math.hypot(t[0] - h[0], t[1] - h[1]) for t, h, _, _ in vs]
        self.assertAlmostEqual(lengths[0], lengths[1], delta=1)

    def test_a_forty_five_degree_vector_renders_at_forty_five_degrees(self):
        (tail, tip, _, _), = self.vecs(vecs=["2,2"])
        dx, dy = tip[0] - tail[0], tail[1] - tip[1]
        self.assertAlmostEqual(math.degrees(math.atan2(dy, dx)), 45, delta=1.5)

    def test_explicit_ranges_still_override_the_equalisation(self):
        """-x/-y are the user's; they are not silently widened."""
        vs = self.vecs(vecs=["1,0", "0,1"], x0=-10.0, x1=10.0,
                       y0=-1.0, y1=1.0)
        lengths = [math.hypot(t[0] - h[0], t[1] - h[1]) for t, h, _, _ in vs]
        self.assertGreater(abs(lengths[0] - lengths[1]), 5,
                           "an explicit range was overridden")

    def test_vectors_stay_inside_the_plot_area(self):
        x_lo, y_lo, x_hi, y_hi = BOX
        for kw in (dict(vecs=["3,2:u", "-1,2:v"]),
                   dict(vecs=["2,1", "2,1->3,3", "3,3"]),
                   dict(vecs=["100,0.001"]),
                   dict(vecs=["0,-7", "0,7"])):
            with self.subTest(**kw):
                for px, py in all_drawn_points(parse(plot.build([], **kw))):
                    self.assertTrue(x_lo - 1 <= px <= x_hi + 1, (px, py))
                    self.assertTrue(y_lo - 1 <= py <= y_hi + 1, (px, py))

    # -- labels ----------------------------------------------------------

    def test_a_vector_can_carry_a_label(self):
        root = parse(plot.build([], vecs=["3,2:u"]))
        self.assertIn("u", [e.text for e in root.iter(SVG_NS + "text")])

    def test_a_label_sits_beside_its_own_vector(self):
        root = parse(plot.build([], vecs=["3,2:u"]))
        (tail, tip, _, _), = vectors(root)
        e = [e for e in root.iter(SVG_NS + "text") if e.text == "u"][0]
        mid = ((tail[0] + tip[0]) / 2, (tail[1] + tip[1]) / 2)
        self.assertLess(math.hypot(float(e.get("x")) - mid[0],
                                   float(e.get("y")) - mid[1]), 30)

    def test_labels_are_escaped(self):
        svg = plot.build([], vecs=["3,2:a & b", "1,1:x<y"])
        texts = [e.text for e in parse(svg).iter(SVG_NS + "text")]
        self.assertIn("a & b", texts)
        self.assertIn("x<y", texts)
        self.assertNotIn("<script", svg)

    def test_a_long_label_is_truncated(self):
        long = "the sum of the first and the second basis vectors, at length"
        root = parse(plot.build([], vecs=["3,2:" + long]))
        e = [e for e in root.iter(SVG_NS + "text")
             if e.text and e.text.startswith("the sum")][0]
        self.assertTrue(e.text.endswith("..."))
        self.assertLess(6.2 * len(e.text), plot.W)

    def test_labels_stay_on_the_image(self):
        root = parse(plot.build([], vecs=["6,4:northeast", "-6,-4:southwest"],
                                x0=-6.0, x1=6.0, y0=-4.0, y1=4.0))
        for e in root.iter(SVG_NS + "text"):
            if e.text in ("northeast", "southwest"):
                half = 6.2 * len(e.text) / 2
                self.assertGreaterEqual(float(e.get("x")) - half, 0)
                self.assertLessEqual(float(e.get("x")) + half, plot.W)
                self.assertGreaterEqual(float(e.get("y")) - 8, 0)
                self.assertLessEqual(float(e.get("y")), plot.H)

    def test_an_unlabelled_vector_emits_no_text_for_it(self):
        plain = plot.build([], vecs=["3,2"])
        self.assertNotIn("text-anchor='middle'>u<", plain)

    # -- colours and themes ----------------------------------------------

    def test_each_vector_gets_its_own_series_colour(self):
        svg = plot.build([], vecs=["1,0", "0,1", "1,1"])
        for i in range(3):
            self.assertIn(f"stroke='{plot.SERIES[i]}'", svg)

    def test_vectors_follow_the_curves_in_the_colour_cycle(self):
        """A vector next to a curve must not reuse the curve's colour."""
        svg = plot.build(["sin(x)"], -6.3, 6.3, y0=-2.0, y1=2.0,
                         vecs=["3,1"])
        root = parse(svg)
        curve_colour = stroke_colors(root)[0]
        self.assertEqual(curve_colour, plot.SERIES[0])
        self.assertIn(f"fill='{plot.SERIES[1]}' stroke='{plot.SERIES[1]}'", svg)

    def test_every_theme_draws_vectors_at_the_same_size(self):
        try:
            sizes = set()
            for name in sorted(plot.THEMES):
                plot.use_theme(name)
                sizes.add(len(plot.to_data_uri(
                    plot.build([], vecs=["3,2:u", "2,1->3,3:v"]))))
            self.assertEqual(len(sizes), 1, "a theme changed the vector cost")
        finally:
            plot.use_theme("auto")

    # -- size ------------------------------------------------------------

    def test_styling_is_shared_not_repeated_per_vector(self):
        """Ten collinear-coloured vectors, one copy of the styling each hue."""
        svg = plot.build([], vecs=[f"{i},1" for i in range(1, 11)])
        self.assertEqual(len(vectors(parse(svg))), 10)
        # Five series colours, so five groups, and no more.
        self.assertEqual(svg.count("stroke-width='2.2' stroke-linejoin"), 5)

    def test_per_vector_byte_cost_is_small(self):
        def uri(n):
            return len(plot.to_data_uri(plot.build(
                [], vecs=[f"{i % 7 - 3},{i % 5 - 2}" for i in range(n)],
                x0=-4.0, x1=4.0, y0=-4.0, y1=4.0)))
        per = (uri(110) - uri(10)) / 100.0
        self.assertLess(per, 45, f"{per:.1f}B per vector is too expensive")
        # And the styling is not part of that marginal cost: a per-element
        # <line>+<polygon> pair measured ~193B per vector.
        self.assertLess(per, 100)

    def test_no_vectors_costs_nothing(self):
        for name in sorted(ORIGINAL_REFERENCES):
            with self.subTest(plot=name):
                kw = dict(REFERENCE_PLOTS[name])
                self.assertEqual(plot.build(**kw),
                                 plot.build(vecs=[], **kw))

    def test_the_original_reference_set_is_still_byte_identical(self):
        base = load_baseline()
        for name in sorted(ORIGINAL_REFERENCES):
            with self.subTest(plot=name):
                self.assertEqual(uri_size(name), base["plots"][name])

    # -- combining with the rest -----------------------------------------

    def test_vectors_compose_with_a_parametric_path(self):
        """The unit circle and two eigen-directions on one plot."""
        svg = plot.build([], param=[("cos(t)", "sin(t)")],
                         vecs=["1,1:e1", "-1,1:e2"])
        root = parse(svg)
        self.assertEqual(len(polylines(root)), 1)
        self.assertEqual(len(vectors(root)), 2)

    def test_vectors_widen_the_automatic_range_to_fit(self):
        for px, py in all_drawn_points(parse(plot.build([], vecs=["12,9"]))):
            self.assertTrue(BOX[0] - 1 <= px <= BOX[2] + 1)
            self.assertTrue(BOX[1] - 1 <= py <= BOX[3] + 1)

    def test_vectors_and_scatter_coexist(self):
        root = parse(plot.build([], vecs=["3,2"], points="1,1 2,2"))
        self.assertEqual(len(circles(root)), 2)
        self.assertEqual(len(vectors(root)), 1)


class TestCommandLine(unittest.TestCase):
    """The shipped seam: one command, one artefact."""

    def run_cli(self, *args):
        import subprocess
        return subprocess.run(
            [sys.executable, os.path.join(REPO_ROOT, "plot.py"), *args],
            capture_output=True, text=True)

    def test_emits_markdown_image_and_reports_its_cost(self):
        r = self.run_cli("-e", "sin(x)", "-x", "-6.3", "6.3", "-t", "sin")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("![plot](data:image/svg+xml,"))
        self.assertTrue(r.stdout.rstrip().endswith(")"))
        self.assertRegex(r.stderr, r"\[svg \d+B -> uri \d+B, ~\d+ tokens\]")

    def test_requires_something_to_plot(self):
        r = self.run_cli("-x", "0", "1")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("need at least one", r.stderr)

    def test_saves_the_raw_svg_when_asked(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "sub", "p.svg")
            r = self.run_cli("-e", "cos(x)", "-o", out)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(out) as f:
                parse(f.read())

    def svg_from(self, *args):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "p.svg")
            r = self.run_cli(*args, "-o", out)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(out) as f:
                return f.read()

    def test_polar_from_the_command_line(self):
        svg = self.svg_from("--polar", "t", "--trange", "0", "18.85")
        self.assertEqual(len(polylines(parse(svg))), 1)

    def test_parametric_from_the_command_line(self):
        svg = self.svg_from("--param", "cos(t)", "sin(t)*cos(t)")
        self.assertEqual(len(polylines(parse(svg))), 1)

    def test_riemann_from_the_command_line(self):
        for at in ("left", "right", "mid"):
            with self.subTest(at=at):
                svg = self.svg_from("-e", "sin(x)", "-x", "0", "6.283",
                                    "--riemann", "7", "--riemann-at", at)
                self.assertEqual(len(RECT_RE.findall(svg)), 7)

    def test_an_unknown_riemann_position_is_rejected(self):
        r = self.run_cli("-e", "x**2", "--riemann", "4", "--riemann-at", "middle")
        self.assertNotEqual(r.returncode, 0)

    def test_polar_alone_satisfies_the_something_to_plot_check(self):
        r = self.run_cli("--polar", "1")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_a_zero_width_range_exits_non_zero_with_a_message(self):
        for args in (("-e", "x**2", "-x", "1", "1"),
                     ("-e", "x**2", "-y", "2", "2")):
            with self.subTest(args=args):
                r = self.run_cli(*args)
                self.assertEqual(r.returncode, 2)
                self.assertIn("zero width", r.stderr)
                self.assertEqual(r.stdout, "", "emitted a plot anyway")
                self.assertNotIn("Traceback", r.stderr)

    def test_declared_breaks_from_the_command_line(self):
        svg = self.svg_from("-e", "atan(x)+(0 if x<1 else 0.05)",
                            "-x", "-2", "3", "--break-at", "1")
        self.assertEqual(len(polylines(parse(svg))), 2)

    def test_a_per_expression_break_from_the_command_line(self):
        svg = self.svg_from("-e", "sin(x)", "-e", "cos(x)",
                            "--break-at", "1:0")
        self.assertEqual(len(polylines(parse(svg))), 3)

    def test_a_malformed_break_is_rejected(self):
        r = self.run_cli("-e", "sin(x)", "--break-at", "left")
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("Traceback", r.stderr)

    def test_the_jump_threshold_from_the_command_line(self):
        args = ("-e", "tanh(50*x)", "-x", "-1", "1", "-y", "-1.2", "1.2",
                "--samples", "41")
        self.assertEqual(len(polylines(parse(self.svg_from(*args)))), 2)
        self.assertEqual(
            len(polylines(parse(self.svg_from(*args, "--jump-frac", "0.85")))),
            1)

    def test_sampling_density_from_the_command_line(self):
        few = self.svg_from("-e", "sin(50*x)", "--samples", "100")
        many = self.svg_from("-e", "sin(50*x)", "--samples", "4000")
        self.assertNotEqual(few, many)

    def test_axis_labels_and_annotations_from_the_command_line(self):
        svg = self.svg_from("-e", "sin(x)", "--xlabel", "t (s)",
                            "--ylabel", "amplitude",
                            "--annotate", "1.57", "1", "first peak")
        texts = [e.text for e in parse(svg).iter(SVG_NS + "text")]
        self.assertIn("t (s)", texts)
        self.assertIn("amplitude", texts)
        self.assertIn("first peak", texts)

    def test_an_annotated_point_from_the_points_flag(self):
        svg = self.svg_from("--points", "1,1:one 2,0.5")
        texts = [e.text for e in parse(svg).iter(SVG_NS + "text")]
        self.assertIn("one", texts)

    def test_vectors_from_the_command_line(self):
        svg = self.svg_from("--vec", "2,1:u", "--vec", "2,1->3,3:v",
                            "--vec", "3,3:u+v")
        root = parse(svg)
        self.assertEqual(len(vectors(root)), 3)
        texts = [e.text for e in root.iter(SVG_NS + "text")]
        for label in ("u", "v", "u+v"):
            self.assertIn(label, texts)

    def test_a_vector_alone_satisfies_the_something_to_plot_check(self):
        r = self.run_cli("--vec", "1,1")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_a_malformed_vector_is_rejected_cleanly(self):
        r = self.run_cli("--vec", "3")
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("Traceback", r.stderr)

    def test_negative_components_via_the_equals_form(self):
        svg = self.svg_from("--vec=-3,-2:down")
        self.assertEqual(len(vectors(parse(svg))), 1)

    def test_the_help_documents_the_vector_flag(self):
        r = self.run_cli("--help")
        self.assertEqual(r.returncode, 0)
        self.assertIn("--vec", r.stdout)
        self.assertIn("->", r.stdout)

    def test_a_hostile_title_survives_the_whole_pipeline(self):
        r = self.run_cli("-e", "sin(x)", "-t", "a & b < c")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("&amp;", r.stdout)
        self.assertNotIn("%3Cscript", r.stdout)


class TestEvaluate(unittest.TestCase):
    """The evaluation seam, which every curve depends on."""

    def test_non_finite_and_undefined_become_none(self):
        self.assertIsNone(plot.evaluate("1/x", 0.0))
        self.assertIsNone(plot.evaluate("log(x)", -1.0))
        self.assertIsNone(plot.evaluate("sqrt(x)", -1.0))
        self.assertIsNone(plot.evaluate("nonsense(x)", 1.0))

    def test_ordinary_values(self):
        self.assertAlmostEqual(plot.evaluate("x**2", 3.0), 9.0)
        self.assertAlmostEqual(plot.evaluate("sin(x)", 0.0), 0.0)
        self.assertAlmostEqual(plot.evaluate("pi", 0.0), math.pi)

    def test_builtins_are_not_reachable(self):
        self.assertIsNone(plot.evaluate("open('/etc/passwd')", 0.0))
        self.assertIsNone(plot.evaluate("__import__('os')", 0.0))


class TestTicksAndSimplification(unittest.TestCase):

    def test_ticks_cover_the_range_and_are_ordered(self):
        for lo, hi in ((-6.3, 6.3), (0.0, 1.0), (-1e-3, 1e-3), (0.0, 12345.0)):
            with self.subTest(range=(lo, hi)):
                ts = plot.nice_ticks(lo, hi)
                self.assertTrue(ts)
                self.assertEqual(ts, sorted(ts))
                for t in ts:
                    self.assertTrue(lo - 1e-9 <= t <= hi + 1e-9)

    def test_rdp_keeps_the_endpoints_and_never_grows_a_path(self):
        pts = [(i, math.sin(i / 10.0) * 50) for i in range(200)]
        out = plot.rdp(pts)
        self.assertEqual(out[0], pts[0])
        self.assertEqual(out[-1], pts[-1])
        self.assertLessEqual(len(out), len(pts))

    def test_rdp_flattens_a_straight_line_to_two_points(self):
        self.assertEqual(plot.rdp([(0, 0), (5, 5), (10, 10)]),
                         [(0, 0), (10, 10)])


class TestSizeBaseline(unittest.TestCase):
    """Bytes are tokens: a change that inflates the reference plots fails."""

    def test_baseline_file_matches_the_reference_set(self):
        base = load_baseline()
        self.assertEqual(set(base["plots"]), set(REFERENCE_PLOTS),
                         "baseline is stale; run: "
                         "python3 test/test_plot.py --update-baseline")

    def test_no_reference_plot_has_grown(self):
        base = load_baseline()
        for name, recorded in sorted(base["plots"].items()):
            with self.subTest(plot=name):
                actual = uri_size(name)
                limit = int(recorded * (1 + SIZE_TOLERANCE_FRAC)) + SIZE_TOLERANCE_BYTES
                self.assertLessEqual(
                    actual, limit,
                    f"{name} URI grew {actual - recorded}B "
                    f"({recorded} -> {actual}); if intended, review the cost "
                    f"and run: python3 test/test_plot.py --update-baseline")

    def test_total_is_within_the_recorded_bound(self):
        base = load_baseline()
        total = sum(uri_size(n) for n in REFERENCE_PLOTS)
        limit = int(base["total"] * (1 + SIZE_TOLERANCE_FRAC)) + SIZE_TOLERANCE_BYTES
        self.assertLessEqual(total, limit,
                             f"reference set total grew to {total}B from "
                             f"{base['total']}B")

    def test_the_original_reference_set_is_unchanged(self):
        """Tickets 03 and 04 add modes; they must not move the old set."""
        base = load_baseline()
        for name in sorted(ORIGINAL_REFERENCES):
            with self.subTest(plot=name):
                self.assertEqual(uri_size(name), base["plots"][name],
                                 "a new mode changed an existing plot's size")

    def test_a_plot_stays_affordable(self):
        # A hard ceiling independent of the baseline: no ordinary plot should
        # cost more than roughly a thousand tokens.
        for name in REFERENCE_PLOTS:
            with self.subTest(plot=name):
                self.assertLess(uri_size(name), 5000)


class TestThemes(unittest.TestCase):
    """--theme (ticket 02), after the embedded media query was ruled out.

    The panel does not tell an <img>-rendered SVG about the editor theme --
    probed live, recorded in specs/plot-py/theming-experiment.md -- so the
    choice is explicit. These tests pin the two promises that decision made:
    the default is untouched, and choosing a theme is free.
    """

    def tearDown(self):
        plot.use_theme("auto")

    def test_auto_is_the_default_and_its_colours_never_moved(self):
        # Hardcoded, not read from THEMES: this asserts the compromise palette
        # is the same one the recorded size baseline was taken against. If a
        # future edit retunes `auto`, this fails and the baseline must be
        # regenerated deliberately rather than drifting.
        plot.use_theme("auto")
        self.assertEqual(plot.AXIS, "#8b93a7")
        self.assertEqual(plot.GRID, "#8b93a7")
        self.assertEqual(plot.LABEL, "#8b93a7")
        self.assertEqual(plot.TITLE, "#c8cfe0")
        self.assertEqual(plot.FILL, "#4fc3f7")
        self.assertEqual(plot.SERIES,
                         ["#4fc3f7", "#ff8a65", "#a5d6a7", "#ce93d8",
                          "#ffd54f"])

    def test_choosing_a_theme_costs_nothing(self):
        """Bytes are tokens. A palette swap must not be a size regression."""
        for name in sorted(plot.THEMES):
            plot.use_theme(name)
            for ref in sorted(REFERENCE_PLOTS):
                with self.subTest(theme=name, plot=ref):
                    self.assertEqual(uri_size(ref), load_baseline()["plots"][ref],
                                     f"theme {name!r} changed the size of {ref}")

    def test_every_colour_is_a_seven_character_hex(self):
        """The property that makes the size invariance above hold at all."""
        for name, palette in sorted(plot.THEMES.items()):
            colours = [v for k, v in palette.items() if k != "SERIES"]
            colours += palette["SERIES"]
            for colour in colours:
                with self.subTest(theme=name, colour=colour):
                    self.assertRegex(colour, r"^#[0-9a-f]{6}$")

    def test_every_theme_defines_the_same_names(self):
        keys = [frozenset(p) for p in plot.THEMES.values()]
        self.assertEqual(len(set(keys)), 1, "palettes disagree on their keys")
        self.assertEqual(set(keys.pop()),
                         {"AXIS", "GRID", "LABEL", "TITLE", "FILL", "SERIES"})

    def test_every_theme_renders_every_reference_plot(self):
        for name in sorted(plot.THEMES):
            plot.use_theme(name)
            for ref in sorted(REFERENCE_PLOTS):
                with self.subTest(theme=name, plot=ref):
                    root = parse(make(ref))
                    self.assertTrue(list(root.iter()))

    def test_the_themes_are_actually_different(self):
        """A palette that does not change anything is not a feature."""
        rendered = {}
        for name in sorted(plot.THEMES):
            plot.use_theme(name)
            rendered[name] = make("several-curves")
        self.assertEqual(len(set(rendered.values())), len(plot.THEMES),
                         "two themes produced identical output")

    def test_light_and_dark_pull_in_opposite_directions(self):
        """Not a legibility assertion -- only that the intent is encoded.

        Whether the colours actually read well on a given background is a
        human judgement; ticket 02 keeps that box unticked. What is checkable
        is that `light` is darker than `dark`, which would catch the palettes
        being swapped.
        """
        def luminance(hexcolour):
            r, g, b = (int(hexcolour[i:i + 2], 16) for i in (1, 3, 5))
            return 0.2126 * r + 0.7152 * g + 0.0722 * b

        for key in ("AXIS", "LABEL", "TITLE"):
            with self.subTest(colour=key):
                self.assertLess(luminance(plot.THEMES["light"][key]),
                                luminance(plot.THEMES["dark"][key]))

    def test_an_unknown_theme_is_refused_by_name(self):
        with self.assertRaises(ValueError) as caught:
            plot.use_theme("solarized")
        message = str(caught.exception)
        self.assertIn("solarized", message)
        self.assertIn("light", message)   # the error lists what is valid

    def test_a_refused_theme_leaves_the_palette_alone(self):
        plot.use_theme("light")
        before = plot.SERIES[:]
        with self.assertRaises(ValueError):
            plot.use_theme("nope")
        self.assertEqual(plot.SERIES, before)

    def test_the_active_palette_cannot_corrupt_the_table(self):
        """use_theme copies. Otherwise one mutation poisons every later call."""
        plot.use_theme("dark")
        plot.SERIES[0] = "#000000"
        plot.use_theme("dark")
        self.assertNotEqual(plot.SERIES[0], "#000000")


def load_baseline():
    if not os.path.exists(BASELINE_PATH):
        raise AssertionError(
            "no size baseline recorded; run: "
            "python3 test/test_plot.py --update-baseline")
    with open(BASELINE_PATH) as f:
        return json.load(f)


def update_baseline():
    plots = {name: uri_size(name) for name in REFERENCE_PLOTS}
    data = {
        "_comment": "Recorded data-URI byte sizes for the reference plots. "
                    "Regenerate deliberately with: "
                    "python3 test/test_plot.py --update-baseline",
        "tolerance_frac": SIZE_TOLERANCE_FRAC,
        "tolerance_bytes": SIZE_TOLERANCE_BYTES,
        "plots": plots,
        "total": sum(plots.values()),
    }
    with open(BASELINE_PATH, "w") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")
    width = max(len(n) for n in plots)
    for name, size in sorted(plots.items()):
        print(f"{name:<{width}}  {size:>5}B  ~{size // 4:>4} tokens")
    print(f"{'TOTAL':<{width}}  {data['total']:>5}B")
    print(f"wrote {BASELINE_PATH}")


if __name__ == "__main__":
    if "--update-baseline" in sys.argv:
        update_baseline()
    else:
        unittest.main(verbosity=2)
