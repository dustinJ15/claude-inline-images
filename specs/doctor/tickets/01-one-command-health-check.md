# 01 — One command that says whether the whole integration works

**What to build:** a single read-only command that checks every link in the
chain — extension install, bundle patch, installed skill, `plot.py` as an
executable — reports precisely what is wrong, names the exact command that fixes
each thing, and exits non-zero when anything needs attention.

**Status:** done

- [x] Reports which extension install is selected, exactly as `patch.js list`
      resolves it, **and which discovery route won** (`--ext-dir`,
      `CLAUDE_CODE_EXT_DIR`, `CLAUDE_CODE_EXECPATH`, or the root scan).
- [x] Distinguishes three patch states, not two: unpatched (failure),
      patched-at-an-older-version (a **warning** — a deliberate downgrade is a
      legitimate state), and patched-and-current (ok).
- [x] Fails when any file of the installed skill is stale, not merely when the
      directory is absent. The 2026-08-19 state — `SKILL.md` current beside a
      stale `plot.py` — must read as broken.
- [x] Executes `plot.py` and parses a `data:` URI out of its output. Statting the
      file is not evidence that it runs.
- [x] Consumer-repo checks exist only for paths passed as arguments. No
      `~/school/...` path is hardcoded, and a fresh clone elsewhere reports
      healthy with none.
- [x] Exit 0 healthy, 1 needs attention, 2 the doctor itself could not run.
- [x] Every failure line names a fix command (asserted by the tests).
- [x] Runs cleanly with **no** Claude Code install present — a clear diagnostic,
      no stack trace.
- [x] Reuses `patch.js` and `install-skill.js`. No duplicated edit table, no
      second definition of "current".
- [x] Read-only, asserted at byte level: a full run against a patched and an
      unpatched fixture leaves both untouched.
- [x] Tested against synthetic fixtures in a temp dir only, never the live
      install.

**Built:** `node doctor.js` (npm: `npm run doctor`), tested by
`node test/doctor.js` (30 assertions, npm: `npm run test:doctor`, wired into
`npm test`).

Kept as its own script rather than a `patch.js doctor` subcommand: `patch.js`'s
subcommands are all scoped to the extension bundle and three of four mutate it,
while the doctor spans three artefacts and is strictly read-only. Folding it in
would drag `install-skill.js` and a subprocess spawn into the patcher's
dependency surface.

`install-skill.js` needed no change — it already exported `status()`/`plan()`,
which is where skill staleness is decided.

Two touches worth keeping: the plot check passes `--theme dark` deliberately, so
the flag whose absence *was* the 2026-08-19 staleness is exercised functionally
and not only by byte comparison; and the emitted URI is rejected if it contains
an unencoded space, which is the failure mode that renders as raw markdown text
in the panel and looks nothing like a patch failure.

**What it still cannot detect:** whether the panel actually *draws* the image.
That needs a human looking at a reloaded webview (see
[workspace-relative-images ticket 03](../../workspace-relative-images/tickets/03-render-relative-path-image-live.md)).
A green doctor means every precondition holds and the patch is on disk — it does
not mean the webview has been reloaded since.
