# 04 — Rectangles under a curve

**What to build:** the picture that makes an approximating sum something a
learner can look at rather than imagine: rectangles drawn under a curve, with a
choice of where each one takes its height.

**Blocked by:** 01.

**Status:** done

- [x] Rectangle count and the sampling position — left, right, or midpoint — are both controllable.
- [x] Rectangles are drawn with shared attributes on a group rather than repeated per element; a hundred rectangles must not cost a hundred copies of the same styling.
- [x] A curve that goes below the axis is drawn correctly rather than assuming positive values.
- [x] The size cost is measured and reported in the ticket, since this is the feature most likely to be expensive.

## What was built

```bash
python3 plot.py -e "sin(x)" -x 0 6.283 --riemann 12 --riemann-at mid
python3 plot.py -e "x**2" -x -1 3 --riemann 8 --riemann-at left --riemann-range 0 2
```

- `--riemann N` — rectangle count, under the **first** `--expr`.
- `--riemann-at {left,right,mid}` — where each rectangle takes its height
  (default `mid`). Rejected values fail at argparse on the CLI and raise
  `ValueError` from `build()`.
- `--riemann-range A B` — sum over a sub-interval; defaults to the x range.

Rectangles are drawn before the curve, so the curve stays on top.

### Below the axis

Each rectangle spans from the value to the **zero line** (clamped into the plot
area when 0 is off-range), with the two ends sorted so height is never
negative — SVG has no negative height, and assuming positivity would have drawn
nothing for the second half of a sine. `test_a_curve_below_the_axis_draws_
downward_rectangles` plots `sin(x)` over `0..2pi` with 8 midpoint rectangles and
asserts 4 sit above the axis and 4 below, each with one edge on the axis.

### Size cost — measured

Reference: `sin(x)` over `0..2pi`, no rectangles = **2310B** URI.

| N | URI bytes | delta | ~tokens added | per rectangle |
|---|---|---|---|---|
| 4 | 2507 | +197 | 49 | 49.2B |
| 8 | 2579 | +269 | 67 | 33.6B |
| 12 | 2652 | +342 | 85 | 28.5B |
| 20 | 2805 | +495 | 123 | 24.8B |
| 50 | 3369 | +1059 | 264 | 21.2B |
| 100 | 4117 | +1807 | 451 | 18.1B |

**Marginal cost: 16.7B (~4 tokens) per rectangle**, measured 10 → 110. The
fixed part of the first rectangle's 49B is the `<g>` and its styling, paid once.

That number is the reason the rectangles are subpaths of one `<path>` inside the
styled `<g>` rather than `<rect>` elements. Both were implemented and measured:

| encoding | marginal per rectangle | 100 rectangles |
|---|---|---|
| `<rect x= y= width= height=/>` in a styled `<g>` | 56.8B | +5789B (~1447 tok) |
| subpaths `M x,y h w v h h -w z` in a styled `<g>` | **16.7B** | **+1807B (~451 tok)** |

`<rect>` loses because each element carries four attributes whose separating
spaces each become `%20`. The `<g>` carries `fill`, `fill-opacity`, `stroke` and
`stroke-opacity` exactly once in both encodings; the path form simply stops
paying for element syntax per rectangle. Tests read the geometry back out of the
`d` attribute (`RECT_RE` in `test/test_plot.py`), so the assertions are the same
ones that would have been made against `<rect>` attributes.

Reference plot added to the baseline: **riemann-midpoint** (`sin(x)` over
`0..2pi`, 12 midpoint rectangles, titled) — **2765B, ~691 tokens**. The eight
original reference plots are byte-identical.
