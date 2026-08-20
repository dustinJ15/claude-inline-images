# 01 — A test suite, and a recorded size baseline

**What to build:** tests for what the plotter already does, plus a captured set
of reference plots and their byte sizes. Everything else in this spec is blocked
on this, because adding plot types to an untested generator means each one is
verified once by eye and never again.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Tests assert properties of the output, not exact bytes — exact bytes change whenever a size lever is tuned, which would make every optimisation look like a break.
- [x] Covered: output is well-formed, drawn paths stay inside the plot area, the number of curves matches the request, a known discontinuity produces a break rather than a connecting line.
- [x] Edge cases covered from the start: an expression undefined across part of its range, a range with no finite values, a single point, a constant function.
- [x] A reference set — several curves, a shaded region, an asymptote, a scatter overlay — is captured with its sizes recorded.
- [x] Size is asserted as a bound against that set, so a later change that inflates the output fails rather than being noticed eventually.

## What was built

- `test/test_plot.py` — 34 tests, stdlib `unittest`, no dependencies.
  Run: `python3 test/test_plot.py` or `python3 -m unittest discover -s test`.
- `test/plot_size_baseline.json` — the recorded sizes.
  Regenerate deliberately: `python3 test/test_plot.py --update-baseline`.
- README gained a "Testing plot.py" subsection with both commands.

The reference set is defined once, in `REFERENCE_PLOTS`, and is shared by the
property tests and the size baseline, so the two cannot drift apart.

### Size baseline (data-URI bytes)

| plot | bytes | ~tokens |
|---|---|---|
| several-curves (3 curves) | 4371 | 1092 |
| shaded-region | 3046 | 761 |
| tan-asymptotes | 2673 | 668 |
| single-curve | 2619 | 654 |
| asymptote (1/x) | 2366 | 591 |
| scatter-overlay | 2314 | 578 |
| explicit-yrange | 2014 | 503 |
| scatter-only | 1980 | 495 |
| **total** | **21383** | |

Tolerance: growth beyond `2% + 8B` per plot (and on the total) fails. Shrinking
never fails — an optimisation should not have to touch the baseline file, though
regenerating after one keeps the bound tight.

## Defects found (not fixed here — plot.py behaviour was left alone)

1. **Zero-width x range divides by zero.** `build([...], 1.0, 1.0)` raises
   `ZeroDivisionError` in `sx()` rather than plotting a degenerate range or
   erroring cleanly. Reachable from the CLI as `-x 1 1`. Pinned by
   `test_zero_width_x_range_raises`, which asserts the *current* behaviour so
   the fix is noticed; update that test when it is fixed.

2. **Title and legend text are interpolated into the SVG unescaped.** A title
   containing `&` or `<` (e.g. `-t "a & b"`) produces a document that is not
   well-formed XML, so the image silently fails to render — the same
   indistinguishable-from-a-patch-failure symptom CLAUDE.md warns about. The
   legend prints each expression verbatim, so an expression with `&` has the
   same effect. Pinned by `test_title_containing_an_ampersand_is_not_well_formed`.
   The fix is a small `xml.sax.saxutils.escape` on the two interpolation sites
   and costs bytes only for titles that need it, but it is a behaviour change
   and so belongs in its own ticket.

Neither defect affects any plot in the reference set.

## Behaviour documented by the tests (not defects, but worth knowing)

- Curves are allowed to run **one full plot-height past the y-range** before
  being dropped, so an asymptote leaves the frame rather than stopping at the
  edge. "Paths inside the plot area" is therefore asserted strictly for bounded
  reference plots and against that documented overshoot for `1/x` and `tan`.
  There is no `clipPath`; the SVG viewBox is what limits the overflow.
- The discontinuity rule is still the heuristic the spec wants to replace: a
  jump of more than half the y-range starts a new segment. `test_a_steep_but_
  continuous_curve_is_not_split` pins the current side of that line.
