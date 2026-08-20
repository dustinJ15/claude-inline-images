# 06 — Correct in either startup order

**What to build:** evidence that the outcome is right regardless of which
extension activates first. Both activate at the same point in startup, so the
ordering is genuinely undetermined and cannot be reasoned away.

**Blocked by:** 04.

**Status:** awaiting-user — the static assertion is in place; the two live-ordering boxes need a real machine

- [ ] Both orders are exercised on a real machine, not argued about.
- [ ] In both, images render and math typesets — neither patch wins at the other's expense.
- [x] The insertion point that makes coexistence work is asserted in the static harness, so a later edit that quietly breaks it fails a test rather than a user's session.
- [ ] If one order produces a wrong result, it is fixed by making the outcome order-independent, not by trying to win the race.

## Static coverage (2026-08-18)

`test/verify.js`, section *coexistence*, now asserts for **every** patch version
(not only the newest — a rolled-back install runs an older edit set):

- the replacement string ends at `,components:{`, i.e. the insertion is
  immediately before it and nothing of ours precedes `remarkPlugins`;
- the literal `{remarkPlugins:[` sequence is unbroken after patching;
- KaTeX's anchor regex still matches the patched call site;
- and its captured groups are *identical* to the pristine ones, so we have not
  changed what the other extension reads out of the match.

Order-independence follows from these being string-level and idempotent, but
"follows from" is not the evidence this ticket asks for. The two live boxes stay
open deliberately.
