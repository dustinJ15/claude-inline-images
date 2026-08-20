# 01 — The skill exists in this repo, under version control

**What to build:** the canonical skill file, held in this repo rather than only
in a home directory, so it has a history and survives a machine change. It
teaches an agent how to produce an image, the encoding rule, and how to read the
panel's three possible outcomes — and nothing about how the patch works.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The skill's description is written for recall: it should trigger on wanting to plot, graph, visualise, or sketch a curve, not on the name of the tool.
- [x] The body fits the stated budget of a few hundred tokens. This is a pass/fail criterion, not a target.
- [x] It carries the encoding rule — percent-encode fully; a literal space makes the image fail to parse entirely — as a rule, not a caveat.
- [x] It carries the three-outcome diagnostic: the image means working, the blocked-image placeholder means the patch is inactive, raw markdown means the URI is malformed.
- [x] It states that investigating the extension bundle is not the agent's job, and points at this repo instead.
- [x] It says nothing about anchors, coexistence with the LaTeX extension, the CSS specificity trap, or the security model.

**Built:** `skill/inline-plots/SKILL.md` (canonical, version-controlled).
Body measures ~466 tokens (chars/3.6 estimate; 1676 chars, 275 words) — inside
the few-hundred-token budget. `node test/skill.js` asserts the budget, the
recall trigger words in the description, the encoding RULE, all three
diagnostic outcomes, and the *absence* of any patch internals.
