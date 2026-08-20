# Spec — agent discovery (the inline-plot skill)

## Problem Statement

The patch works, and no agent knows it. A fresh Claude Code session in an
unrelated repo has no way to learn that this panel renders images, so it
explains a curve in prose — which is exactly the failure the whole project
exists to fix. The capability is installed and unreachable, in the same way the
underlying feature was before the patch.

The obvious remedy — a note in every repo's agent instructions — is the wrong
one. It duplicates the same paragraph across every project, has to be updated in
each of them whenever the guidance changes, and spends context in every session
of every repo, including the many that will never draw a plot.

There is a second, subtler cost. This repo's own instructions are dense with
things an agent working *on the patch* must know: bundle anchors, coexistence
with the LaTeX extension, a CSS specificity trap, the security model. None of
that is any use to an agent that merely wants to draw a sine wave, and pasting
it around would bury the two facts that actually matter in a page of ones that
do not.

## Solution

One user-level skill, installed once, auto-discovered in every project. Its
name and description are the only thing loaded per session; the body loads when
the agent decides a picture is the right answer.

The skill teaches the minimum: how to produce an image, the one encoding trap
that makes images silently fail, and how to tell a broken setup from a malformed
URI. It explains nothing about how the patch works, and links here for that.

The repo keeps the canonical copy under version control with an install step, so
the skill is not a file that exists only in one home directory.

## User Stories

1. As a user asking about a curve in any repo, I want the assistant to draw it, so that I see the shape instead of reading a description of it.
2. As a user, I want that to work in a repo I have never used with this project, so that the capability follows me rather than the project.
3. As a user, I do not want to add a note to each repo I work in, so that adopting this costs nothing per project.
4. As a user, I do not want sessions that never draw a plot to pay for the instructions, so that the cost is proportional to the use.
5. As a user whose images have stopped rendering, I want the assistant to tell me what to run, so that a reverted patch is a ten-second fix rather than a mystery.
6. As a user, I want the assistant to distinguish "the patch is off" from "the assistant wrote a bad URI", so that I am not asked to re-run a command that will not help.
7. As an agent, I want to know how to produce an image cheaply, so that drawing one is never weighed against explaining in words.
8. As an agent, I want the encoding rule stated as a rule, so that I do not discover it by producing raw text in front of the user.
9. As an agent, I want to know what is deliberately not my concern, so that I do not read a five-megabyte bundle to answer a question about a sine wave.
10. As the repo maintainer, I want the skill under version control, so that its history is visible and it can be reinstalled after a machine change.

## Implementation Decisions

- **A user-level skill, not project instructions and not a per-repo file.** This
  is the mechanism that gets global reach at per-session cost near zero, and it
  is the only one specified here. A repo-local note is warranted only where a
  repo has image conventions of its own — where generated plots live, for
  instance — and that note should point at the skill rather than restate it.

- **The description is the whole discovery mechanism**, so it is written for
  recall rather than for accuracy of self-description. It should trigger on the
  situations where a picture is the better answer — plotting, graphing,
  visualising, sketching a curve, showing the shape of a function — not merely
  on the name of the tool. The built-in visualisation skill's description is the
  model to follow.

- **A hard budget on the body: it must fit in a few hundred tokens.** This is a
  design constraint, not an aspiration. It buys the constraint by carrying only:
  how to generate an image, the encoding rule, and the diagnostic table. Anything
  that does not change what the agent *does* is cut.

- **The skill explicitly disclaims the patch.** An agent that reads it must come
  away knowing it should not investigate the extension bundle, and should send
  the user to this repo instead. Without that, a curious agent will go looking,
  and the bundle is large enough to end the session's usefulness.

- **The emit guidance depends on the relative-path work.** While images are
  inlined, the skill teaches generating a compact URI and encoding it fully.
  Once relative paths land, the recommended form changes to writing a file and
  referencing it by short path, and the encoding trap becomes a footnote rather
  than the headline. The skill is written for whichever is true at the time and
  revised when that changes; it must not describe both as equally good.

- **Installation is a step, not a copy.** The repo holds the canonical file and
  provides a documented way to install it. Writes into the agent configuration
  directory are blocked for agents by the permission classifier, so the install
  step is something the user runs, and the documentation should say so rather
  than an agent discovering it by being denied.

## Testing Decisions

The only test that matters is behavioural, and it cannot be automated: in a
fresh session in an unrelated repo, ask something whose best answer is a curve,
and see whether the assistant draws one without being told to. A skill that
reads well and never triggers has failed, and no assertion about its text would
have caught that.

What can be checked mechanically is small and worth doing anyway: the file
parses as a skill, the description is present, and the body is within budget.
Prior art is the existing static harness in this repo — same spirit, asserting
the artefact that actually ships rather than a copy of it.

Regression to watch: the skill must not fire on requests that are about images
but not about drawing one — reading an image file, discussing a screenshot. A
skill that triggers constantly gets ignored, which is the same outcome as not
existing.

## Out of Scope

- Keeping the patch alive across extension updates. Specified separately; until
  that lands, the skill's contribution is telling the user what to run.
- Any change to the patch itself.
- Plotting features.
- Notes in consuming repos. Deliberately excluded, per the decision above.

## Further Notes

There is a real risk the skill is written, is accurate, and never fires. Judge it
in a fresh session in a repo that has nothing to do with this one — testing it
here, where the context is saturated with images, proves nothing.

The three-outcome diagnostic is the single highest-value paragraph in the skill.
It is what stops an agent from confidently reporting a broken patch when the real
fault is a space in a URI, which has already cost real debugging time once.
