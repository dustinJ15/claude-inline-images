# Spec — the plotter

## Problem Statement

The plotter works and has no tests. Every change to it is therefore verified by
looking at the output and deciding it seems fine, which is exactly the kind of
verification that misses the case nobody thought to look at. It has real edge
cases already — asymptotes, empty ranges, values that go non-finite mid-curve —
and no way to notice when one of them regresses.

It is also missing the things a study session actually reaches for. Curves in
Cartesian coordinates are covered; a spiral, a parametric path, or the
rectangles under a curve are not, and those are precisely the pictures that are
hardest to convey in words and therefore most worth drawing.

Two smaller problems: the colours are fixed mid-tones chosen to be tolerable
against either a light or a dark background, so they are optimal against
neither; and detecting a discontinuity is currently a guess based on the size of
a jump, which will misfire on any function that is genuinely steep.

Underneath all of it sits a constraint that governs every change: the output
travels through the assistant's own message, so bytes are tokens. A feature that
makes the output larger has made every plot more expensive, including the plots
that do not use it.

## Solution

Give it a test suite first, then add the missing plot types and fix the two known
weaknesses — each change measured against the byte cost, which is checked rather
than hoped for.

## User Stories

1. As a maintainer, I want tests before features, so that a change to the output can be shown not to have broken the existing shapes.
2. As a maintainer, I want the byte cost checked on every change, so that a feature cannot quietly make every plot more expensive.
3. As a user on a dark background, I want colours that suit it, so that a plot does not look like it was designed for someone else's editor.
4. As a user studying polar equations, I want to see the spiral, so that I am not reading a description of a shape.
5. As a user studying parametric curves, I want to see the path traced, so that the relationship between the parameter and the shape is visible.
6. As a user learning integration, I want the rectangles drawn under the curve, so that the sum being approximated is something I can look at.
7. As a user plotting a function with a genuine asymptote, I want the break drawn as a break, so that the plot does not invent a vertical line that is not there.
8. As a user plotting a merely steep function, I want it drawn continuous, so that steepness is not mistaken for discontinuity.
9. As a user, I want to control the sampling density, so that a curve with fine structure is not smoothed away by a fixed default.
10. As a user, I want axes I can read, so that a plot is self-contained rather than needing a sentence to explain what it shows.
11. As an agent, I want the cost of what I am about to emit reported, so that I can tell when a plot is too expensive to be worth it.

## Implementation Decisions

- **Tests come before features.** This is the ordering decision and it is not
  negotiable within this spec. Adding plot types to an untested generator means
  each new type is verified once, by eye, and never again.

- **Byte cost is an acceptance criterion on every ticket, not a concern raised
  at review.** The generator already reports its size; each ticket compares
  before and after for a fixed set of reference plots, and a regression fails the
  ticket. The existing size levers — curve simplification, integer coordinates,
  shared attributes on grouped elements, dropping repeated points — are the
  prior art for how to claw back bytes when a feature costs some.

- **Stay on the standard library.** This is a deliberate choice, not an
  accident of convenience: the established plotting libraries emit output an
  order of magnitude larger, which for this use case is the only measure that
  matters.

- **Theming needs an experiment before a decision.** A generated image cannot
  inherit the surrounding page's styling, so adapting to a dark or light
  background needs either an explicit option or a media query embedded in the
  image itself. Whether the embedded query works in this panel is unknown and
  cheap to find out; find out first, then decide.

- **Discontinuity detection graduates from heuristic to declarable.** The
  present rule — a jump larger than half the vertical range — cannot distinguish
  a true asymptote from a steep slope, because at the sampling resolution they
  look the same. Improve the heuristic where possible, and provide a way to
  state the discontinuity explicitly, so a user who knows better can say so.

- **Expression evaluation stays as it is for now,** with its restricted
  namespace, and is revisited before this is recommended to anyone beyond its
  current local use. Recording that boundary is the decision; changing it is out
  of scope.

## Testing Decisions

A good test here asserts the properties of the output, not its exact bytes. The
exact bytes change whenever a size lever is tuned, so pinning them would make
every optimisation look like a break. Assert instead that the output is
well-formed, that the drawn path is inside the plot area, that the number of
distinct curves matches what was asked for, and that a known discontinuity
produces a break rather than a connecting line.

- The generator's own output is the seam. It is a single command producing a
  single artefact, which is as high a seam as exists.
- Reference plots covering the existing capability — several curves, a shaded
  region, an asymptote, a scatter overlay — are captured before any feature work
  and become the regression set.
- Size is asserted as a bound against those reference plots, so a regression
  fails rather than being noticed later.
- Edge cases worth having tests for on day one: an expression that is undefined
  across part of its range, a range containing no finite values at all, a single
  point, and a constant function.
- Prior art for the style of testing is the repo's existing harness, which
  asserts against the artefact that actually ships rather than a copy of it.

## Out of Scope

- The patch, the extension, and the agent-facing skill.
- Adopting a plotting library.
- Interactive or animated output.
- Rendering anything other than plots.

## Further Notes

This is the lowest-priority spec of the four, and deliberately so: the plotter
already produces good output for the common case, whereas the other three specs
address a capability that either silently disappears or is never discovered. Do
this once the rest is stable.

The one part worth pulling forward is the test suite, which is cheap and makes
every later change to the plotter safer.
