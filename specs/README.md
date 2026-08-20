# Specs

Five specs finish this project. Each is `<slug>/spec.md` with `tickets/` beside
it, per the repo's spec → tickets → implement convention. Work one ticket at a
time, clearing context between them.

Read [CLAUDE.md](../CLAUDE.md) before touching the patch, and
[HANDOFF.md](../HANDOFF.md) if you are arriving cold.

## Order, and why

| # | Spec | Why here |
|---|---|---|
| 1 | [workspace-relative-images](workspace-relative-images/) | Cuts the per-image cost by roughly two orders of magnitude. Gates the other two, because it changes what the skill should tell agents to emit and what the extension's edit table contains. |
| 2 | [agent-discovery](agent-discovery/) | Works against the already-verified inline form, so it delivers value immediately. Its last ticket is deliberately blocked on spec 1. |
| 3 | [doctor](doctor/) | Read-only health check over all of the above. Cheap, and the only thing standing between a silent breakage and a noticed one until spec 4 ships. |
| 4 | [companion-extension](companion-extension/) | The largest piece. Its first two tickets — the publication question and the upstream issue — can start now and should. |
| 5 | [plot-py](plot-py/) | Lowest priority; the plotter already works. Its first ticket, the test suite, is worth pulling forward. |

Two tickets are worth starting immediately regardless of order:
**file the upstream issue** (companion-extension 02) — if the one-line fix lands
upstream, specs 1 and 4 both become unnecessary — and **the plotter's test
suite** (plot-py 01), which is cheap and makes every later change safer.

## Two questions this answers up front

**Do consuming repos need notes in their agent instructions?** No. Spec 2 puts
one user-level skill in place, auto-discovered in every project. Per-repo notes
would duplicate the same paragraph everywhere and spend context in every session
of every repo, including the ones that never draw a plot. Add a repo-local note
only where a repo has image conventions of its own — where generated plots live,
say — and have it point at the skill rather than restate it.

**How much context does a fresh agent need?** Three budgets, and the third is the
one that matters:

| | Cost | What |
|---|---|---|
| Every session | ~30 tokens | the skill's name and description |
| On invoke | a few hundred tokens, once | how to generate an image, the encoding rule, the diagnostic table |
| **Per image** | **550–840 tokens today, ~10 after spec 1** | the URI travels through the assistant's own message |

A consuming agent needs none of this project's internals — anchors, coexistence
with the LaTeX extension, the CSS specificity trap, the security model. That
stays in [CLAUDE.md](../CLAUDE.md) and is explicitly kept out of the skill.

The recurring per-image cost is the reason spec 1 comes first: it is the
difference between a plot being a decision and a plot being free.

## The one thing static tests cannot do

`node test/verify.js` proves the bundle parses and the injected strings are
right. It cannot prove the panel draws an image. Several tickets across specs 1
and 3 close only on a human looking at the panel — apply, *Developer: Reload
Webviews* (never Reload Window, which kills the running session), emit an image,
and ask. Those tickets say so explicitly. Do not close them on static evidence.
