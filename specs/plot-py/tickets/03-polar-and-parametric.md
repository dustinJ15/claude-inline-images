# 03 — Polar and parametric curves

**What to build:** the two plot types whose shapes are hardest to convey in
words and therefore most worth drawing — a curve given in polar form, and a path
given as coordinates over a parameter.

**Blocked by:** 01.

**Status:** done

- [x] A polar curve renders with the correct shape, confirmed against a known example whose appearance is not in doubt.
- [x] A parametric path renders, including one that crosses itself — a case that breaks any assumption that each horizontal position has one value.
- [x] The existing size levers apply to the new paths; they are not exempt from simplification.
- [x] Size against the reference set is unchanged, since these are new modes rather than changes to the existing one.
- [x] Tests cover both, at the same level as the existing types.

## What was built

CLI:

```bash
python3 plot.py --polar "1"                              # unit circle
python3 plot.py --polar "t" --trange 0 18.85             # Archimedean spiral
python3 plot.py --param "cos(t)" "sin(t)*cos(t)"         # lemniscate
python3 plot.py --param "sin(3*t)" "sin(2*t)"            # Lissajous 3:2
python3 plot.py --samples 800 --polar "t"                # sampling density
```

`--polar` and `--param` are repeatable and compose with `-e`, `--points`,
`--fill` and `-t`. Both take their parameter from `--trange` (default `0 2pi`).
`plot.sample_paths()` produces point lists in **parameter order**, never as a
function of x, and the renderer walks them in that order — the lemniscate test
asserts that a single pixel column carries two distinct y values and that the x
sequence is neither ascending nor descending, which is what would break a
single-valued renderer.

When both ranges are auto (the usual case for these modes) the plot equalises
units per pixel across the two axes, so `--polar "1"` is a circle and not an
ellipse. Passing `-x` and `-y` explicitly overrides that.

### Shape confirmation

- `r=1` — every point is within 6% of the mean radius from the path centroid,
  and the path closes on itself within 3px.
- `r=t` over `0..6pi` — per-turn peak radius is strictly increasing and the
  last turn is more than twice the first.
- `x=cos t, y=sin t cos t` — one polyline, self-crossing (see above).

### Size levers

The new paths go through exactly the same pipeline as a Cartesian curve:
undefined samples break the path, RDP simplifies each segment, coordinates are
integers and consecutive duplicates are dropped. A 400-sample unit circle
becomes 34 points, asserted by `test_size_levers_apply_to_the_new_paths`.

### Size

The eight original reference plots are **byte-identical** — pinned by
`test_the_original_reference_set_is_unchanged`, which asserts equality rather
than a tolerance. New reference plots added to the baseline:

| plot | URI bytes | ~tokens |
|---|---|---|
| polar-circle (`r=1`) | 2431 | 607 |
| polar-spiral (`r=t`, 0..6pi) | 2947 | 736 |
| param-lemniscate | 2566 | 641 |

All within the range of an ordinary single-curve plot (2619B).
