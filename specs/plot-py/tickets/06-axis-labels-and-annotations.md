# 06 — Make a plot self-contained

**What to build:** axis labels and optional text annotations on points, so a plot
carries its own meaning instead of needing a sentence alongside it explaining
what is being shown.

**Blocked by:** 01.

**Status:** done

- [x] Axis labels can be set and are positioned so they do not overlap the plotted area or the tick values.
- [x] Individual points can carry a text annotation.
- [x] Both are optional and cost nothing when unused — an unlabelled plot's size is unchanged against the reference set.
- [x] Long labels degrade legibly rather than overflowing the image.

## What was built

CLI:

```bash
python3 plot.py -e "sin(x)" --xlabel "t (s)" --ylabel "amplitude" \
    --annotate 1.5708 1 "first peak"
python3 plot.py --points "1,1:start 3,0.33:tail"     # inline, no spaces
```

`build(..., xlabel=..., ylabel=..., annotate=[(x, y, text), ...])`, and
`--points` now accepts `x,y:text`.

### Positioning

Labels take their room out of the **padding**, not out of the plot area, and
only when they exist: `pl = PAD_L + 13 if ylabel`, `pb = PAD_B + 14 if xlabel`,
with the module constants otherwise untouched. So an unlabelled plot is the
same document it was before, and a labelled one has a slightly smaller plot area
rather than anything overlapping. The x label sits below the tick values at
`y = H-5`; the y label is a rotated `<text>` (`transform='rotate(-90 12 cy)'`)
at `x=12`, left of the widest tick value precisely because the left padding was
widened for it. Both are asserted against the measured tick positions, not by
eye.

Annotations are one `<g>` carrying the shared font and fill, one `<text>` per
labelled point, placed 8px above the marker and clamped to stay on the image
in both axes.

### Long labels: truncation

Chosen over shrinking (which makes the longest label the least readable, at
exactly the moment it has the most to say) and over wrapping (a second `<text>`
element plus line-breaking logic, for bytes). `plot.clip(text, max_px,
font_size)` estimates advance width at a deliberately generous `0.62 x
font-size` per character and appends an ASCII `...` — not `U+2026`, since the
URI is not percent-encoded beyond the characters that break a markdown link.

Limits: title `W-16`, x label the plot width, y label the plot height, an
annotation half the image width (a note belongs beside its point, not stretched
across the plot). Tested at 3x overflow length for the axis labels, and on a
title and an annotation that would each run off the edge.

All new text goes through `plot.esc()`; tested with `&`, `<` and `>` in an axis
label and in a point annotation.

### Size

**The eight original reference plots are byte-identical** —
`test_the_original_reference_set_is_unchanged` still asserts exact equality, and
`test_unlabelled_plots_are_byte_identical` repeats it from this ticket's side.
Marginal cost when used, on a `sin(x)` plot (2513B):

| addition | bytes |
|---|---|
| `--xlabel` | ~102 |
| `--ylabel` (rotated) | ~142 |
| first annotated point | ~179 |
| each further annotated point | ~106 |

One new baseline entry:

| plot | URI bytes | ~tokens |
|---|---|---|
| labelled-axes (x+y labels, one annotated point) | 2926 | 731 |

### Not verified live

Static only, like the rest of the suite: the geometry is asserted from the
parsed SVG, but nobody has looked at a labelled plot in the panel. Worth one
glance when the theming experiment (ticket 02) is run, since that needs a panel
anyway.
