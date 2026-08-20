# 07 — Vectors and arrows

**What to build:** an arrow primitive, so linear algebra is drawable. Spans,
vector addition and the action of a matrix on a vector were the one thing
`plot.py` could not draw at all; `~/school/linear-algebra/CLAUDE.md` told agents
to fall back to LaTeX prose because of it.

**Blocked by:** 01.

**Status:** done, except the live look

- [x] Vectors from the origin.
- [x] Vectors from an arbitrary tail, so tip-to-tail addition is drawable.
- [x] Optional per-vector text label, in the vector's own colour, escaped and truncated like every other label.
- [x] A CLI surface consistent with `--points` / `--annotate`: `--vec`, repeatable, documented in `--help`.
- [x] Equal aspect ratio when both ranges are automatic, with `-x`/`-y` still overriding.
- [x] Arrowheads visible at typical scale and non-degenerate for very short vectors.
- [x] Works under all three `--theme` palettes at identical byte cost.
- [x] The eight original reference plots are byte-identical.
- [ ] A human has looked at a rendered vector diagram in the panel.

## What was built

CLI:

```bash
python3 plot.py --vec "2,1:u" --vec "2,1->3,3:v" --vec "3,3:u+v" \
    -t "u + v, tip to tail"
python3 plot.py --param "cos(t)" "sin(t)" \
    --param "2*cos(t)+sin(t)" "cos(t)+2*sin(t)" \
    --vec="3,3:3v1" --vec="-1,1:v2" -t "unit circle under A=[[2,1],[1,2]]"
```

`build(..., vecs=[...])`, where each entry is either a spec string or an
already-parsed `(tx, ty, hx, hy, label)` tuple.

### Syntax

```
X,Y[:label]                 from the origin to (X, Y)
TX,TY->HX,HY[:label]        from (TX, TY) to (HX, HY)
```

`->` is what distinguishes the two forms, so neither needs a mode flag and
neither is ambiguous. The label is the tail after `:`, matching
`--points "1,1:peak"`. Whitespace around any part is tolerated, which matters
because `--vec "1,1 -> 4,3"` is what a person actually types.

One sharp edge, documented in `--help`: `--vec -3,2` is read by argparse as a
flag, because `-3,2` does not match its negative-number pattern. Write
`--vec=-3,2`. This is inherited from argparse, not chosen.

### Equal aspect

`--polar`/`--param` already equalised units per pixel when both ranges were
automatic; vectors join that rule. This is not cosmetic. On unequal axes a
45-degree vector renders at some other angle and two vectors of equal length
render unequal — the picture states things that are false. `-x`/`-y` still win,
because an explicit range is the user's, and a test asserts they are not
silently widened.

### Arrowheads

Shaft plus a filled triangle. Head length `max(4, min(9, 0.45L))` pixels and
half-width `max(3, hl/2)`, so the head shrinks with the vector down to a floor
and no further: a 2-pixel vector keeps a head you can see instead of vanishing
into a dot. A vector of exactly zero length has no direction, so it draws
nothing rather than a NaN.

### Size: the two approaches, measured

Both were written and measured on the same random vector sets, counting
percent-encoded URI bytes (attribute spaces become `%20`, which is what makes
the obvious form expensive).

| approach | 1 vector | 10 | 110 | **marginal per vector** |
|---|---|---|---|---|
| `<line>` + `<polygon>` per vector, fully attributed | 189B | 1926B | 21144B | **192.6B** |
| shared `<g>` per colour, one `<path>`, two subpaths per vector | 181B | 541B | 4459B | **39.5B** |

The grouped form ships — ~4.9x cheaper, the same reason the Riemann rectangles
are subpaths of one `<path>`. A third variant using relative path commands
(`l dx,dy`) measured **37.1B** per vector; it was not kept, because 2.4B is not
worth a `d` attribute that no test can read back with a regex.

In the shipped code the marginal cost measured **39.3B per unlabelled vector**,
161B for the first one on an otherwise bare plot (the first `<g>` carries the
styling), and **+116B for a label** (its own coloured `<g>` plus the `<text>`);
subsequent labels in the same colour group are cheaper.

Two new baseline entries:

| plot | URI bytes | ~tokens |
|---|---|---|
| vector-pair (two labelled vectors from the origin) | 2230 | 557 |
| vector-addition (u, v tip-to-tail, u+v) | 2512 | 628 |

The eight originals are unmoved:
`test_the_original_reference_set_is_still_byte_identical` re-asserts it from
this ticket's side, alongside the existing
`test_the_original_reference_set_is_unchanged`.

### Colours

A vector takes the next series colour after the curves and paths, so a vector
beside `sin(x)` is never the same hue as it. Vectors are grouped by colour so
the styling is stored once per hue, at most five times. Every palette entry is
still a 7-character hex literal, so `--theme` costs zero bytes here too — a
test asserts the three themes produce the same vector-plot size.

### Tests

41 new tests (161 total), covering parsing and its rejections, direction on a
y-down canvas, the arrowhead being at the tip and non-degenerate, tip-to-tail
closure, equal aspect and its override, label placement/escaping/truncation/
clamping, colour cycling, per-vector byte cost, and the CLI including `--help`.
The reference geometry is read back out of the `<path>` `d` attribute with
`VEC_RE`, so the assertions test what actually ships.

### Not verified

Nobody has looked at a vector diagram rendered in the chat panel. The geometry
is asserted from the parsed SVG and the two demo diagrams build clean from the
command line, but "the arrowheads read as arrowheads at 560x340" is a human
judgement and stays unticked.
