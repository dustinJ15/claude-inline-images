# Handoff

You are picking up a working proof of concept and turning it into a clean,
credible repo. Read [CLAUDE.md](CLAUDE.md) for the rules that keep the patch
safe, [README.md](README.md) for the root cause, [specs/](specs/) for the work.
This document is the current state, the goal, and how to run the loop.

---

## 0. How to work this repo

The mode that works here is **supervisor + subagents**, one spec track per
agent, TDD throughout. If the user says "read HANDOFF.md" or "run the loop",
this is what they mean:

1. Read [specs/README.md](specs/README.md), then every ticket's
   `**Status:**` line: `grep -H '^\*\*Status:' specs/*/tickets/*.md`
2. Pick the tickets that are `ready-for-agent` **and** not gated on a human
   (see §3). Group them so that **no two concurrent agents edit the same file** —
   this is the one hard scheduling constraint. `plot.py`, `patch.js`, and
   `README.md` each have exactly one owner at a time.
3. Launch them as parallel subagents (opus, medium reasoning or better). Give
   each one: read CLAUDE.md first, the ticket, TDD explicitly, the file
   exclusion list, and the two hard prohibitions in §2.
4. When one lands, run the suite yourself — `npm test` — before launching
   whatever it unblocked. Don't take a subagent's "all green" on faith.
5. Each agent updates its own ticket file: tick only genuinely satisfied boxes,
   set `**Status:**` to `done` / `awaiting-user` / `blocked` **with a reason**.
   Never tick a box the ticket says needs a human.
6. Stop when everything left is gated on the user. Hand back a list of the
   specific actions only they can take.

Serialization that worked last time: plot-py 01 (tests) → 03+04 → 05+06, since
all three waves edit `plot.py`. workspace-relative-images 01 must land before
anything touches the live install, because it *is* the rollback net.

## 1. Goal — and what it is not

**Goal: a repo that is a pleasure to land on.** Honest README, real tests, clean
history, every claim marked verified-live or statically-checked. A portfolio
piece.

**Not a goal right now: publishing to the VS Code Marketplace.** Do not work
toward it, do not optimise packaging for it. If a `.vsix` is ever wanted it goes
out as a GitHub release. [specs/companion-extension/ticket 08](specs/companion-extension/tickets/08-package-and-publish.md)
stays `blocked` and out of scope; its manifest-completeness and candid-README
points are still worth doing *as repo quality*, just not as a store submission.

The reasoning is recorded in
[decision-publication.md](specs/companion-extension/decision-publication.md) and
is worth knowing: Microsoft's policy is silent on modifying another publisher's
extension, but **Anthropic's licence and reverse-engineering terms are the real
constraint**. `nuriyev.claude-code-katex` doing the same thing is tolerance, not
permission. Don't cite it as cover in the README.

## 2. Two constraints that will shape how you work

### You cannot verify rendering with code

Static tests prove the bundle parses and the strings are right. They cannot
prove the webview draws an image. **Only a human looking at the panel can
confirm that.** Budget for that round trip; don't close a ticket that says it
needs a human.

The loop:

1. `node patch.js apply` *(the user runs this — see below)*
2. `Ctrl+Shift+P` → **Developer: Reload Webviews** for anything in
   `webview/index.js`. For v2's `extension.js` edits — the meta tag and the
   widened `localResourceRoots` — a webview reload is **not enough**; the
   extension host only evaluates `extension.js` at startup, so it takes
   **Developer: Reload Window** or a restart, and that kills the session.
   Budget for it. Learned on 2026-08-18; details in
   [ticket 02](specs/workspace-relative-images/tickets/02-confirm-webview-uri-passes-csp.md).
3. Emit a small image in a chat message and ask the user what they see.

Read the result carefully — the three outcomes mean different things:

| Shown | Meaning |
|---|---|
| the image | working |
| `[Image]` | markdown parsed fine, patch not active — usually not reloaded |
| raw markdown text | **your URI is malformed**, almost always an unencoded space |

That third row cost real debugging time. A literal space in a markdown link
destination makes CommonMark not emit an image node at all. It is not a patch
failure and looks nothing like one.

### The permission classifier may block you — it depends on the session

Writes into `~/.vscode/extensions/**` and `~/.claude/**` are *often* denied to
agents, and editing `settings.json` to grant yourself permission always should
be. **Do not hunt for a phrasing that gets through** — if you are denied, ask
the user to run the command.

But do not assume the denial either. This document previously stated flatly
that agents are blocked; on **2026-08-19** an agent in an auto-mode session ran
`node install-skill.js` successfully, writing `~/.claude/skills/inline-plots/`.
The outcome is a function of the session's permission mode, not a fixed
property of the path. **Try the command, then report what actually happened** —
quoting this file's old claim instead of testing it is how the stale version
survived as long as it did. Repo-local writes
are fine. Tests must use synthetic fixtures in a temp dir — `test/verify.js` has
a `makeFixture()` helper built from `P.EDITS`, so fixture anchors cannot drift
from the real ones. Never run the patcher against the live install.

## 3. State

```
$ node patch.js status
{ "extDir": ".../anthropic.claude-code-2.1.234-linux-x64",
  "patchedVersions": ["1"],   <-- the LIVE install is at v1
  "current": false,           <-- repo ships v2
  "latestVersion": "2", "knownVersions": ["1","2"], "katexPatched": true }
```

*(The status block above is pre-2026-08-18. The live install has since been
upgraded: `patchedVersions: ["2"]`, `current: true`.)*

**The live install is now at v2**, applied 2026-08-18, webviews reloaded, and a
`data:` URI SVG confirmed rendering in the panel. That is the first time v2 has
been looked at in a real editor, and it establishes that v2 did not regress
what v1 did. It does **not** touch v2's relative-path half, which remains the
unrendered claim.

| Stage | What | Evidence |
|-------|------|----------|
| 1 | `data:image/*` renders inline | **Confirmed live, under both v1 and v2.** A human looked at a rendered SVG in the panel, 2026-08-18. |
| 2 | `![](plots/x.png)` relative paths | Parses, anchors unique, round-trips byte-identical. **Still never rendered.** |
| 3 | Companion extension | **Built and headless-tested, including both loss-and-recovery scenarios (2026-08-20). Never run in a real editor.** |

Rollback now exists: `node patch.js apply 1` returns the live install to the
known-good v1 without going through unpatched. That was the gating ticket for
everything in spec 1.

### Tests

`npm test` runs all five suites. Keep them all green; run the whole thing, not
just the one you touched.

| Suite | Command | Covers |
|---|---|---|
| patch | `npm run test:patch` | edit table, security, KaTeX coexistence, round trips, version targeting |
| extension | `npm run test:extension` | activate/self-heal/uninstall against fixtures, `vscode` injected |
| skill | `npm run test:skill` | skill content rules + installer idempotence |
| plot | `npm run test:plot` | 161 tests + a 16-plot byte baseline with a growth threshold |
| doctor | `npm run test:doctor` | one-command health check, against fixtures only |

The plot baseline is the interesting one: the eight original reference plots are
asserted **byte-identical**, not within tolerance, so a new feature cannot
quietly make every existing plot more expensive. Regenerate deliberately with
`python3 test/test_plot.py --update-baseline`.

### Ticket board

`done` — workspace-relative-images 01; agent-discovery 01, 02;
companion-extension 01; plot-py 01, 03, 04, 05, 06.

`awaiting-user` — companion-extension 02, 03, 04, 06, 07; plot-py 02.
These are built and tested; what is missing is a human action, listed in §4.

**plot-py 02 update (2026-08-18):** the experiment is run and the feature is
built. The embedded media query is *not* honoured — a dark editor rendered the
`LIGHT` probe — so `--theme auto|dark|light` shipped instead, `auto` unchanged
and byte-identical, 120 tests. The one box left needs a human to look at a
`--theme light` plot on a light background; the colours are reasoned, not seen.

**2026-08-20 wave.** plot-py 07 (vectors/arrows) shipped — `--vec`, equal aspect,
39.5B/vector, 161 tests. A new `doctor` spec shipped: `node doctor.js` checks
install discovery, patch currency, per-file skill staleness, and *executes*
`plot.py`; 30 assertions. companion-extension 05 was simulated headlessly and
**found a real defect** — see the half-patch gotcha in §6 — now fixed, 62
assertions. Suites: five, all green.

`ready-for-agent` but human-gated — workspace-relative-images 02–06 and
companion-extension 05 all need the panel or a real editor restart. An agent can
prepare and diagnose, but cannot close them.

`blocked` — agent-discovery 04 (needs spec 1 confirmed live, *not* merely
written); companion-extension 08 (out of scope, §1).

## 4. What only the user can do

Nothing here is a thing to work around. Ask, then wait.

1. ~~**`node patch.js apply`** → **Developer: Reload Webviews** → look at the
   panel.~~ **Done 2026-08-18.** v1 → v2, reloaded, `data:` URI rendered. This
   did *not* exercise relative paths, so spec 1 is still open — see §5.1.
   `node patch.js apply 1` remains the way back if v2 misbehaves.
2. ~~**`rm -rf ~/.claude/inline-images`**~~ — **Done 2026-08-18.** The stale
   v1 duplicate of the patcher is gone.
3. **`node install-skill.js`** — run 2026-08-18, and re-run 2026-08-19 after
   `--theme` shipped, because the installed `plot.py` had gone stale while
   `SKILL.md` stayed current (the installer versions each file separately, so
   "installed" does not imply "current" — check `--status`, not just presence).
   Re-run again 2026-08-20 after `--vec` shipped. **The rule this keeps
   teaching: any `plot.py` change makes the installed copy stale, and the
   consumer repos run the installed copy, not this one.** `node doctor.js` now
   catches it automatically.

   **Still outstanding:** a fresh session **in an unrelated repo**, to confirm
   the skill fires unprompted. Testing it in this repo proves nothing. Note
   this got harder to measure on 2026-08-19: the user's two course repos
   (`~/school/calculus-2`, `~/school/linear-algebra`) now carry explicit
   CLAUDE.md sections telling the agent to plot. Those repos are a good test of
   *the workflow* but no longer a clean test of *unprompted discovery* — for
   that, use a repo with no such instruction.
4. ~~**Paste the theming probe.**~~ **Done 2026-08-18** — result and caveats in
   [theming-experiment.md](specs/plot-py/theming-experiment.md), feature
   shipped. Optional leftover: step 4 of that document, the OS-appearance flip,
   which would separate "fixed light default" from "follows the desktop". It
   changes nothing about the feature; it only makes the recorded cause exact.
5. **Load `extension/` into a real editor.** *(Install done 2026-08-20 — the
   user ran `ln -sfn ~/projects/claude-inline-images/extension
   ~/.vscode/extensions/claude-inline-images-0.1.0`. Symlink verified; manifest
   and `main` both resolve. NOT yet restarted, so nothing about loading is
   confirmed.)*

   **On the next window restart, read the outcome like this:**

   **Confirmed working 2026-08-20.** After a window restart, *Claude Inline
   Images: Show Patch Status* reported `patched at v2 (current); KaTeX patch
   also present`, sourced from the extension. Neither feared failure mode
   occurred: VS Code scans symlinked extension folders, and the host does not
   run with `--preserve-symlinks`, so `loadPatcher()`'s two-levels-up lookup
   resolves. The copy-and-vendor fallback is therefore not needed.

   Then the three scenarios, in rising order of value:
   a. ordinary startup — nothing happens, images still render;
   b. after `node patch.js remove` + window restart — recovers unprompted;
   c. **after triggering KaTeX's own re-patch + window restart** — this is the
   path that was broken until 2026-08-20 and is the one worth testing.
   If an error notification appears, paste it verbatim into ticket 05; it names
   the failing anchor.
6. **Post the upstream issue** —
   [upstream-issue.md](specs/companion-extension/upstream-issue.md), ready to
   paste, verified against the real bundle. Tracker:
   https://github.com/anthropics/claude-code/issues
   **This is plausibly the highest-value action in the repo:** the fix upstream
   is one property, and if it lands, specs 1 and 3 both become unnecessary.

While a panel is open, three freebies worth one glance: a labelled plot has
never been seen rendered, neither has a Riemann plot, and neither has a
`--theme light` or `--theme dark` plot against its intended background.

## 5. Next work, in order

1. **Spec 1 end to end**, once the user has done §4.1. Tickets 02→03→04→05→06:
   prove the workspace URI passes CSP, render a relative-path image, decide and
   *document* how much of the workspace the panel may read, settle multi-root,
   then measure the real per-image token cost and correct the README. Most
   likely failure point: whether `asWebviewUri`'s host is covered by
   `${cspSource}` once `localResourceRoots` widens. If not, fall back to writing
   images into `<ext>/resources/` — already an allowed root, needs no
   `extension.js` edit at all. Say so plainly in the docs rather than shipping an
   unverified claim.
2. **agent-discovery 04** — rewrite the skill's emit guidance for relative paths
   once, and only once, spec 1 is confirmed *rendering*. One recommended form,
   not two equally good ones.
3. **Repo polish, as its own pass** — CI running `npm test` (the patch suite
   already skips bundle checks cleanly when no Claude Code install is present),
   a top-level README that opens with what this is and what is verified, and the
   manifest/CHANGELOG completeness points from ticket 08 treated as quality work
   rather than store prep.

## 6. Gotchas, condensed

- Never read `webview/index.js` whole — 5MB minified, it will blow your context.
  Grep with bounded context; recipe in CLAUDE.md.
- Insert **after** `remarkPlugins:[…]`, never right after the `{` — KaTeX's
  anchor regex requires `{remarkPlugins:[` and inserting before it silently
  disables KaTeX. `test/verify.js` now asserts, per version, that KaTeX's regex
  still matches *and* that its captured groups are identical to pristine.
- Don't anchor on the viewport `<meta>` — it appears **twice**; the second is the
  plan-preview webview. Use the CSP line.
- Style images inline, not via `index.css` — `img[src^="data:"]` (0,1,1) beats
  `.thumbIcon_*` (0,1,0) and breaks the tool-result thumbnail pill.
- Never widen `urlTransform` to identity. Upstream blocks external image URLs to
  prevent exfiltration via markdown image URLs; keep the security assertions green.
- **A KaTeX re-patch leaves the tree HALF patched, not unpatched.** KaTeX
  restores only `webview/index.js` from its own pristine copy; our `extension.js`
  edits survive. `patch.js` counts a version present only when *every* edit is
  present, so it reports `patchedVersions: []` while four `extension.js` anchors
  are still injected — and a bare `apply()` then aborts with
  `anchor occurs 0x, expected 4x`. The extension handles this via
  `liftPartialVersions()`, which reverses whatever fragments are actually on disk
  before patching. Found 2026-08-20 by simulating the clobber; every earlier test
  started from a fully patched or fully pristine tree and could not see it.
- Keep **no backup file**, ever. Any backup may capture a KaTeX-patched bundle,
  and restoring it later resurrects a stale KaTeX build. `remove()` is the
  inverse, and the extension's uninstall hook is tested to create no copy at all.
- `A_LRR` and `A_CSP` embed the minified alias `Lt` and CSP template vars
  `${p} ${f} ${m} ${u} ${g}`. These **will** break on a Claude Code rebuild.
  Consider regex anchors with captured identifiers, as KaTeX does.
- In `plot.py`, bytes are tokens. Every text site goes through `esc()`; every new
  path goes through the same simplification pipeline. Measure, don't assume — the
  Riemann rectangles ship as subpaths of one `<path>` because that measured
  16.7B each against 56.8B for `<rect>` elements, the attribute spaces becoming
  `%20` in the URI.

## 7. Environment it was built against

- `anthropic.claude-code` **2.1.234** (linux-x64), VSCode **1.133.0**, Fedora 44
- Panel mode: `"claudeCode.preferredLocation": "panel"` →
  `createWebviewPanel("claudeVSCodePanel", …)`
- `nuriyev.claude-code-katex` **2.1.1** is installed and patches **the same call
  site**. Keeping it working is a hard requirement, not a nice-to-have.

Only this one configuration has been exercised. Everything about other
platforms, VSCode versions, and Claude Code versions is unverified — and the
README should keep saying so.
