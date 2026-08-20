# 05 — Stop guessing at discontinuities, and expose sampling density

**What to build:** correct handling of the case where a curve genuinely breaks,
and control over how finely it is sampled. The current rule treats any jump
larger than half the vertical range as a break, which cannot tell a true
asymptote from a steep slope — at the sampling resolution they are
indistinguishable. Sampling density is presently fixed, so a curve with fine
structure can be smoothed away before it is ever drawn.

**Blocked by:** 01.

**Status:** done

- [x] A user can declare a discontinuity explicitly, so someone who knows the function can say so rather than hoping the heuristic agrees.
- [x] The heuristic is improved where it can be, and its limits are stated rather than left to be discovered.
- [x] A genuinely steep but continuous function is drawn continuous.
- [x] Sampling density is controllable, with the current fixed value as the default.
- [x] Raising the density does not raise the output size proportionally — simplification still applies afterwards.
- [x] Both behaviours are covered by tests.

## What was built

CLI:

```bash
python3 plot.py -e "tan(x)" -x -4.5 4.5 --break-at -1.5708 --break-at 1.5708
python3 plot.py -e "sin(x)" -e "1/x" --break-at "1:0"   # 2nd expression only
python3 plot.py -e "tanh(50*x)" -x -1 1 -y -1.2 1.2 --jump-frac 0.85
python3 plot.py -e "sin(50*x)" --samples 4000
```

`build(..., breaks=[...], jump_frac=0.5, samples=400)`. A `breaks` entry is
either an x value (every curve breaks there) or an `(index, x)` pair.

### Declared breaks are exact

The path is cut between the two samples that straddle the declared x —
`prev_x < b <= x` — regardless of what the values do there. RDP runs *per
segment*, after the split, so simplification can never bridge a declared break;
`test_a_declared_break_survives_simplification` uses a near-straight line either
side, which is exactly the case a simplify-then-split implementation would
collapse back into one segment.

The motivating case in the tests is `atan(x)+(0 if x<1 else 0.05)`: a real
discontinuity with a jump far below any usable heuristic threshold. The
heuristic cannot see it at any setting that does not also cut ordinary curves in
half; declaring it works.

### The heuristic: what changed, and what could not

The rule itself is unchanged in kind — it still compares consecutive samples —
because there is nothing better available from the samples alone. What changed:

- the threshold is `jump_frac`, defaulting to `0.5`, the previously hardcoded
  value; `0` disables the heuristic entirely,
- the three reasons to break are now separated in the code and in the docs:
  undefined/off-range (a fact), declared (a statement), jump (a guess),
- the limits are stated in `plot.py`'s module docstring and in the README:
  it cannot distinguish a pole from a steep curve, misses steps smaller than
  the threshold, and changes its answer when `--samples` changes.

`tanh(50*x)` on `[-1,1]` with `y=[-1.2,1.2]` and 41 samples is the documented
misfire: the default splits this continuous curve in two,
`--jump-frac 0.85` (or `0`) draws it as one. Disabling the heuristic does *not*
bridge a real pole — `1/x` still breaks, because off-range samples are a fact
rather than a guess.

### Sampling density

`--samples` existed but was untested and undocumented. Now:
`sin(50*x)` on `[-6.3,6.3]` has ~100 turning points; at 100 samples fewer than
60 survive, at 4000 more than 90 do. The density reaches Cartesian, polar and
parametric modes alike. Ten times the samples costs **well under twice** the
bytes (`test_density_does_not_cost_bytes_proportionally`), because RDP still
runs afterwards.

### Size

The eight original reference plots are **byte-identical**; the feature costs
nothing unused, asserted three ways (`breaks=[]`, `jump_frac=0.5` and
`samples=400` each reproduce the unchanged output exactly). One new baseline
entry:

| plot | URI bytes | ~tokens |
|---|---|---|
| declared-break (`1/x`, `--break-at 0 --jump-frac 0`) | 2264 | 566 |
