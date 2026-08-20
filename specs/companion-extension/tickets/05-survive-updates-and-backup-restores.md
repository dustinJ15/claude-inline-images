# 05 — Survive both ways the patch is lost

**What to build:** confirmation that the two real-world loss scenarios actually
recover. The whole justification for the extension is a situation no other test
reproduces, so it is exercised rather than assumed.

**Blocked by:** 04.

**Status:** awaiting-user — both scenarios now simulated headlessly and one real defect fixed; the remaining boxes need a human seeing an image render in a real editor

## Boxes

Split by who can close them. Nothing below is ticked on the strength of a file
inspection — the simulated boxes are simulated, and say so.

### Simulated headlessly (2026-08-20)

- [x] After a Claude Code update installs into a new versioned directory, the
      next activation re-applies there with the user running nothing.
- [x] After the LaTeX extension restores its own pristine bundle over the shared
      file, the next activation recovers automatically.
- [x] The LaTeX extension is patched in both simulations, and after each
      recovery its anchor regex still matches with **identical captured groups**.
- [x] No backup file is created at any point in either scenario.
- [x] Recovery is re-application from the edit table, never a file restore.

### Only a human at a real editor can close these

- [ ] After a real Claude Code update lands, images render again with the user
      running nothing — confirmed by looking at the panel.
- [ ] After `nuriyev.claude-code-katex` really re-patches over the bundle, images
      render again **and** math still typesets — confirmed by looking at the panel.
- [ ] Both extensions installed in the same editor for both of the above.
      Recovering in isolation is not the scenario that matters.

## Findings

### A real defect was found by scenario 2, and fixed

The KaTeX clobber does not leave the install *unpatched*. It leaves it **half
patched**, and that state was unrecoverable.

`nuriyev.claude-code-katex` owns a pristine copy of `webview/index.js` and
writes it back whenever it re-patches. That reverts our edits to the bundle
while leaving our v2 edits to `extension.js` in place. `patch.js` counts a
version as present only when *every* one of its edits is present, so it reported
`patchedVersions: []`, and the extension duly called `apply()` — which aborted:

```text
extension.js: anchor occurs 0x, expected 4x — bundle shape changed, refusing to write.
```

Correct behaviour from the patcher (the `localResourceRoots` anchors really had
already been replaced), but the outcome for the user was an error notification
and `[Image]` until they intervened by hand — precisely the mid-semester failure
the extension exists to prevent. It would have fired on the *first* real KaTeX
update, and no existing test could see it, because every test until now started
from a fully patched or fully pristine tree.

**Fix:** `liftPartialVersions()` in `extension/src/extension.js`. Before
patching, it reverses whichever injected fragments are actually on disk for any
version that is only *partially* present, returning the tree to a shape the
patcher recognises; `apply()` then runs normally. It reads the fragments from
`patch.js`'s edit table — there is still exactly one table — writes atomically
via tmp+rename, and runs only on the about-to-patch path, so an ordinary startup
still writes nothing. It restores nothing from a saved copy and creates no copy,
per the standing rule: a copy would have captured KaTeX's edits and replaying it
would resurrect a stale build of their patch.

`patch.js` was deliberately **not** changed. v2 is applied to the live install;
altering an applied version's fragments would leave `remove()` unable to reverse
it. The repair belongs on the extension side anyway — it is a recovery policy,
not part of the edit table.

### What the simulations actually prove

`test/extension.test.js`, sections `ticket 05 …` — 62 assertions in the file
now, up from 36. Synthetic fixtures in a temp dir throughout; no real install is
read or written. The KaTeX anchor regex is **lifted out of `test/verify.js` at
runtime** rather than retyped, so the coexistence assertion cannot drift into
two versions of itself.

*Scenario 1 — update into a new versioned directory.* A synthetic extensions
root holds `anthropic.claude-code-2.1.234-linux-x64` (patched, KaTeX on top) and
then receives `anthropic.claude-code-99.9.9-linux-x64` unpatched, as a real
update arrives. Proven: the next activation patches the **new** directory
unprompted, reloads the webviews exactly once, shows no error, leaves the
superseded directory untouched, creates no file, and is a silent no-op on the
startup after that. Also proven for the no-registry path: `listInstalls()`
orders the two correctly and the directory scan selects the newer one.
(`CLAUDE_CODE_EXECPATH` / `CLAUDE_CODE_EXT_DIR` are cleared for the duration of
that one check — they outrank the scan and, when the suite runs from inside
Claude Code, would point at the real install.)

*Scenario 2 — KaTeX restores its pristine bundle.* Both extensions patched,
KaTeX first; KaTeX then rewrites `webview/index.js` from its own backup and
re-patches. Proven: the half-patched state is reached exactly as described, a
bare `patch.js apply` on a copy of it still throws (asserted, so the defect
cannot silently return), and the next activation recovers — landing on a result
**byte-identical to a clean patch of the same tree**, with one reload, no error,
no file created, and KaTeX's captures unchanged. Removing our patch afterwards
returns the tree byte-for-byte to the KaTeX-only state. The full clobber (both
files replaced) and the mirror case (only `extension.js` reverted) are covered
too, as is `autoPatch: false`, which leaves a half-patched install strictly
alone.

### What the simulations cannot prove

They do not prove anything renders. The fixture is a synthetic four-line stand-in
for a 5MB bundle; the stubbed editor records that
`workbench.action.webview.reloadWebviewAction` was invoked, not that a webview
came back. The KaTeX stand-in is a plugin insertion at the same call site, not
that extension's real code. And nothing here exercises extension **activation
order** on a real host — that is ticket 06.

One thing worth carrying into the live test: after a Claude Code update, our v2
edits to `extension.js` are re-applied by the extension host at startup, but the
host has already evaluated the old `extension.js` for the session in progress.
Expect the relative-path half of v2 to need one more window reload after an
update lands. The `data:` half comes back with the webview reload.

## Steps for the human

1. Install `extension/` into the editor (`code --install-extension`, or a
   symlink into `~/.vscode/extensions/`), with `nuriyev.claude-code-katex` also
   installed. Restart the window.
2. Simulate the update *or* wait for a real one. To simulate: `node patch.js
   remove`, then restart the window. Expect no notification, and an image plus
   typeset math in the panel with nothing run by hand. A real update is the
   stronger test, because it also exercises the new directory.
3. For the KaTeX clobber: trigger that extension's re-patch (its apply command,
   or reinstall it), then restart the window. Expect the same — image renders,
   math still typesets. This is the path that was broken until 2026-08-20.
4. If instead an error notification appears, copy it verbatim into this ticket
   and reopen it. The message names the anchor that failed, which is the whole
   diagnosis.
