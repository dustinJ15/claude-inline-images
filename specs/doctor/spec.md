# Spec — doctor (one-command health check)

## Problem Statement

The two ways this setup breaks are both silent, and neither is hard to detect.

**The patch vanishes on every Claude Code update.** Updates install into a new
versioned directory, so the patched bundle is simply gone. Nothing errors; the
assistant just goes back to emitting `[Image]`, and the user has no reason to
connect that to an extension update from days earlier.

**The skill can be installed and stale at the same time.** `install-skill.js`
versions `SKILL.md` and `plot.py` separately. On 2026-08-19 `--status` reported
`SKILL.md current` / `plot.py stale`: the skill was installed, and the installed
`plot.py` predated the `--theme` flag. An agent in an unrelated repo would have
invoked a flag that did not exist. "The directory exists" is not health.

The user tutors two live university courses through this tool. The setup needs
to be *verifiably* intact, not apparently intact — and checking it should not
require remembering which of four commands to run and how to read each one.

## Solution

One read-only command that checks the whole chain end to end and exits non-zero
if any link is broken, naming the exact command that fixes each one.

It owns no knowledge of its own: patch state comes from `patch.js`'s `status()`,
skill staleness from `install-skill.js`'s own file comparison. A second copy of
either would be the same class of bug as a second edit table.

## Why its own spec

It spans all three existing specs — the bundle patch
([workspace-relative-images](../workspace-relative-images/)), the installed skill
([agent-discovery](../agent-discovery/)), and the update-survival problem that
[companion-extension](../companion-extension/) automates. It is also the honest
fallback while the companion extension remains unloaded in a real editor: until
re-application is automatic, *noticing* is the thing that has to be cheap.

## Scope

- Read-only, always. It never patches, installs, or writes anywhere.
- Runs cleanly with no Claude Code install present — a diagnostic, not a crash.
- Consumer-repo checks are opt-in by argument. No user's paths are hardcoded; a
  fresh clone on any machine reports healthy with none given.

## Tickets

- [01 — one command that says whether the whole integration works](tickets/01-one-command-health-check.md)
