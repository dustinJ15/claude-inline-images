# 02 — Find out whether the image can adapt to the editor's theme

**What to build:** an answer to a cheap empirical question, then the smaller of
the two possible features. A generated image cannot inherit the surrounding
page's styling, so adapting to a dark or light background needs either an
explicit option at generation time or a media query embedded inside the image.
Whether the embedded query is honoured in this panel is unknown and takes
minutes to test.

**Blocked by:** 01.

**Status:** awaiting-user

- [x] The embedded-query approach is tested in the real panel and the result recorded.
- [~] If it works, colours adapt with no option needed. **Not applicable** — it does not.
- [x] If it does not, an explicit option is added and the default stays the current both-backgrounds compromise.
- [x] Either way, the byte cost against the reference set is compared before and after.
- [ ] Confirmed by a human looking at a plot in both themes. Colour legibility is not assertable.

## The probe is ready — nothing decided

The experiment is built and written up in
[../theming-experiment.md](../theming-experiment.md): a 320x120 self-contained
SVG, already percent-encoded as a `data:` URI ready to paste into a chat
message, whose embedded `@media (prefers-color-scheme: dark)` block swaps the
word `LIGHT` for `DARK` and inverts a background and a swatch. Every colour also
has a presentation-attribute fallback and the `DARK` text is hidden by CSS
alone, so "the stylesheet was ignored entirely" shows up as two overlapping
words rather than silently masquerading as "light theme detected".

That document carries the step-by-step instructions (which theme toggles to
flip, in which order, and why to paste a fresh message rather than trust the
already-rendered image), a table mapping each of the five possible outcomes to
what it means and which feature it implies, and an empty **Result** section to
fill in.

*That section describes the state before the probe was run. The probe has since
been run; see **Outcome** below.*

## Outcome — 2026-08-18

**The embedded query is not honoured.** Probed live in the patched panel under
a visibly dark editor theme; the SVG rendered the word `LIGHT`. Full write-up
and caveats in [../theming-experiment.md](../theming-experiment.md).

One deviation from the written procedure, recorded rather than glossed: only
the **dark** editor theme was pasted, not both. A dark editor showing `LIGHT`
already falsifies "the query follows the editor", and the light-theme paste
could only have agreed. What was *not* run is step 4, the OS-appearance flip,
so "fixed light default" and "follows the desktop" are still indistinguishable.
That distinction does not change the feature and is not claimed either way.

### What shipped

`--theme auto|dark|light`, defaulting to `auto`.

- `auto` is byte-for-byte the palette that existed before this ticket, asserted
  against hardcoded values in `TestThemes` rather than read back out of the
  table — so retuning it fails a test instead of silently invalidating the
  recorded size baseline.
- The palette lives in a `THEMES` table and is applied by `use_theme()`, which
  rebinds module globals. Globals, not a palette threaded through `build()`:
  the drawing code is one long function of f-strings and passing an object into
  every colour site would be a large diff for no behavioural gain. The cost is
  process-wide state, which the tests set and restore explicitly.

### Byte cost: none

Every colour in every palette is a 7-character hex literal, so a theme swap
cannot move a single byte. `test_choosing_a_theme_costs_nothing` asserts each
theme reproduces the recorded baseline size for all reference plots exactly,
and `test_every_colour_is_a_seven_character_hex` pins the property that makes
that hold. The baseline was **not** regenerated — there was nothing to
regenerate. Ten new tests, 110 -> 120.

### Still open

The last box needs a human: nobody has looked at a `--theme light` plot on a
light background or a `--theme dark` plot on a dark one. The colours are
reasoned, not seen. Legibility is not assertable in code, which is why the box
is written the way it is.
