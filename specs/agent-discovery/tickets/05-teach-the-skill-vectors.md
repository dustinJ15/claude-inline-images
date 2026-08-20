# 05 — Teach the skill about vectors

**What to build:** the smallest edit to `skill/inline-plots/SKILL.md` that lets an
agent in an unrelated repo — the linear-algebra course repo especially — draw a
tip-to-tail vector sum correctly on the first try, plus the widened description
that makes the skill discoverable from a linear-algebra question at all.

`plot.py` gained `--vec` today; the skill body did not know it existed, so the
installed copy in `~/.claude/skills/` could not use it.

**Status:** done

- [x] Body teaches both forms: `--vec "X,Y:label"` from the origin and
      `--vec "TX,TY->HX,HY:label"` from an arbitrary tail, with the second shown
      as the way vector addition is drawn.
- [x] Body carries the argparse trap — a leading negative component needs
      `--vec=-3,2`, because a bare `-3,2` is read as a flag. This is the one
      thing an agent cannot recover from by guessing.
- [x] Body states the honest limit in one clause: 2D only, curves/parametric/
      scatter/arrows, **no planes, no 3D, no matrix or basis-grid rendering**.
      Without it, "vectors are supported" invites a fabricated R^3 picture.
- [x] Description widened by one clause: "drawing vectors or a linear
      combination in the plane". Reasoning: the discovery surface is only the
      name and description, and none of the existing triggers ("graphing a
      function", "comparing two functions", "a small dataset") match "show me
      the span of these two vectors" or "what does this matrix do to the unit
      square". Widened by the *subject* (vectors, linear combination), not by
      the flag name and not by a list of features — a description that
      enumerates `--vec`, `--polar`, `--param` would bloat every session's
      context for no extra recall.
- [x] Stayed under the asserted budget in `test/skill.js` (~586 of 600 tokens,
      from 466). Paid for by deleting the `sqrt(x) --points` example, whose two
      ideas (an x-range, scatter) survive in the first example and the `--help`
      comment.
- [x] `test/skill.js` grew three assertions, written before the edit: the
      description mentions vectors; the body carries both forms, the `--vec=-`
      quoting form, and a statement of what cannot be drawn.
- [x] The three hard rules are untouched: complete percent-encoding, the
      three-outcome table, never grep the 5MB bundle. No patch internals added.
- [ ] **Ticket 03 (does it fire unprompted) needs re-running** — the description
      changed, and that is the whole trigger surface. Re-test both the original
      curve phrasings (a widened description must not dilute them) and a
      linear-algebra one, in a fresh session, in a repo with no checkout here.
