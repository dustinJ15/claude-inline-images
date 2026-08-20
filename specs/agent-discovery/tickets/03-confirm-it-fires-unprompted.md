# 03 — The skill actually fires in a fresh session in an unrelated repo

**What to build:** evidence that the discovery mechanism works, which is the only
claim in this spec that matters and the only one no assertion can check. A skill
that reads well and never triggers has failed exactly as completely as one that
was never written.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] Tested in a fresh session, in a repo unrelated to this one. Testing it here proves nothing — the context is already saturated with images.
- [ ] Asked a question whose best answer is a picture, without mentioning plots, images, or this project; the assistant reaches for the skill on its own.
- [ ] Checked the other direction: a request that mentions an image but does not want one drawn — reading an image file, discussing a screenshot — does not trigger it.
- [ ] If it does not fire, the description is revised and re-tested. The body is not the suspect; the description is the entire discovery surface.
- [ ] The wording that finally worked is recorded, so a later edit does not undo it by accident.

## Findings

**2026-08-19 — pick your test repo carefully.** The user's two course repos,
`~/school/calculus-2` and `~/school/linear-algebra`, now carry explicit CLAUDE.md
sections instructing the agent to plot (added at their request, so the workflow
holds up mid-semester). Those repos therefore **cannot** close the first two
boxes above: an agent plotting there may be following the project instruction,
not discovering the skill. They remain a good end-to-end test of the *workflow*.

Use a repo with no plotting instruction for the discovery test. The cleanest
signal is a question whose best answer is a shape, asked somewhere the topic is
not obviously mathematical.

Also relevant to the description's reach: `plot.py` has no arrow/vector
primitive, so in the linear-algebra repo the honest answer to many questions is
still prose. The linear-algebra CLAUDE.md says so explicitly, to stop an agent
substituting ASCII art when it reads "use graphs liberally". If a vector
primitive ever ships, revisit that instruction — see TODO.md → plot.py.
