# Spec — companion extension (stage 3)

## Problem Statement

The patch dies at every Claude Code update. Updates install into a new versioned
directory, so the patched files are simply gone, and images revert to a blocked
placeholder with no warning and no explanation. Recovery is manual and requires
knowing this project exists, where it is checked out, and what command to run.

The failure is silent, which is what makes it bad. The user does not see an
error; they see the assistant stop drawing pictures, and have no reason to
connect that to an extension update that happened days earlier. Meanwhile the
assistant, having no idea either, quietly goes back to explaining curves in
prose — so the capability degrades without anyone noticing it has.

There is a second way to lose the patch: the LaTeX extension keeps its own
pristine backup of the same bundle and can restore it, erasing this patch as a
side effect of its own maintenance.

## Solution

A small companion extension that re-applies the patch when it finds it missing.
It activates after startup, resolves the Claude Code install through the editor
rather than by guessing, and patches only when the patch is absent. It reloads
the webviews only when it actually changed something, so a normal startup is
invisible.

When it cannot patch, it says so, visibly. A silent no-op is the worst possible
outcome, because it reproduces exactly the failure this extension exists to
eliminate.

## User Stories

1. As a user, I want images to keep working after a Claude Code update, so that I do not lose a capability without being told.
2. As a user, I want that to happen without me running anything, so that the fix is not conditional on my remembering this project exists.
3. As a user, I want a normal startup to be invisible, so that the extension does not announce itself or disturb a running session every time I open the editor.
4. As a user whose patch could not be applied, I want to be told, so that I can act instead of wondering why pictures stopped.
5. As a user, I want images to survive the LaTeX extension restoring its own backup, so that two extensions maintaining the same file does not mean one of them loses.
6. As a user of both extensions, I want the outcome to be correct no matter which starts first, so that a race decides nothing that matters.
7. As a user, I want to turn the automatic patching off, so that the extension being installed does not commit me to it modifying anything.
8. As a user, I want to apply, remove, and inspect state on demand, so that I am not dependent on startup timing to fix something.
9. As a user uninstalling it, I want my editor left as it was, so that removing the extension is a complete undo.
10. As a prospective installer, I want to be told before I install that this modifies another extension's files, so that I can decide with the facts.
11. As a maintainer, I want the patch logic to exist in exactly one place, so that a fix cannot land in one copy and not the other.

## Implementation Decisions

- **The existing patcher stays the single source of truth.** The extension calls
  it; the edit table is never forked, reimplemented, or copied into the
  extension. Two copies of an edit table that must agree exactly is the failure
  mode this decision exists to prevent — and it is not hypothetical, since a
  stale duplicate of the patcher already exists in the agent configuration
  directory, still at the older version. Deleting it is part of this work.

- **Resolve the target through the editor's own extension registry**, not by
  scanning directories. The registry names the install that is actually running.
  The standalone discovery heuristics stay, but only for command-line use.

- **Patch when the version stamp is absent, on every activation.** Not "on
  update", not "once". Absence of the stamp is the only condition, and using it
  is what makes recovery from the LaTeX extension's backup restore automatic
  rather than something anyone has to notice.

- **Reload the webviews only when a patch was actually applied.** Reloading on
  every startup is disruptive and would make the extension unpleasant to have
  installed.

- **Uninstall does targeted string removal, never file restore.** This is a hard
  constraint carried over from the patcher's design. A restore would write back
  a file captured while the LaTeX extension's changes were present, resurrecting
  a stale build of someone else's patch. The patcher's removal path is already
  an exact inverse, asserted byte-identical; the uninstall hook uses it.

- **Failures are surfaced as a visible notification.** Silence is the worst
  outcome — it is the original bug wearing a different hat.

- **Both extensions activate at the same moment, so the race is real.** The
  correctness requirement is that the result is right in either order. That is
  settled by testing both orders, not by reasoning about which is likely.

- **Commands for apply, remove, and status, plus a setting to disable automatic
  patching.** Installing the extension should not, by itself, be an irrevocable
  decision to have files modified.

- **Marketplace publication is contingent and must be resolved before packaging.**
  This ships something that modifies another publisher's extension on disk. The
  LaTeX extension is precedent that this is tolerated, but one example is not a
  policy. If the answer is no, the work degrades cleanly to a release plus a
  command-line installer — the patcher already works standalone, so nothing is
  wasted.

## Testing Decisions

Good tests here assert what a user would notice: after an update the images
work; after an uninstall the editor is as it was; a normal startup changes
nothing.

- **The existing static harness stays the seam for the edit table.** It runs the
  actual injected strings and asserts the apply/remove round trip is
  byte-identical. Because the extension does not fork that logic, it inherits
  those guarantees rather than needing its own copies of them.

- **The extension's own behaviour is tested against a scratch editor install**:
  patch it, assert the bundle changed, remove, assert it is restored exactly.
  This is the layer the static harness cannot reach, because it is about
  activation and resolution rather than about strings.

- **Continuous integration runs the static harness.** It already skips the
  bundle checks cleanly when no Claude Code install is present, so it works on a
  machine that has none.

- **The startup race is tested in both orders, on a real machine.** It is not
  reachable from the scratch-install tests and is not settled by argument.

- **The update path is exercised at least once for real** — the entire
  justification for the extension is a scenario nothing else in the test suite
  reproduces.

## Out of Scope

- Changing what the patch does. This spec is about keeping it applied.
- The agent-facing skill.
- Supporting editors and platforms beyond those already verified. The patcher
  searches several extension roots but only one has been exercised; broadening
  that is real work, tracked separately, and not a prerequisite here.

## Further Notes

Before building this, consider whether it should exist. The underlying fix
upstream is a single missing property, and the extension already ships an unused
branch for handling these images — strong evidence the feature was intended to
work. Filing that upstream may be the highest-value action available, and if it
lands, this spec and the one before it both become unnecessary. Filing it costs
an afternoon; this spec costs considerably more.

The honest framing for anyone considering installing this is that it modifies
another extension's files on disk and can undo that completely. Say that plainly
and up front. A reader who finds it out later will reasonably wonder what else
was not mentioned.
