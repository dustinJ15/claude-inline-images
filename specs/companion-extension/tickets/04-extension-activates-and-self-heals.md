# 04 — The extension re-applies the patch when it finds it missing

**What to build:** the core behaviour. On startup the extension resolves the
running Claude Code install through the editor's own extension registry, checks
for the version stamp, and patches when it is absent. It calls the existing
patcher; it does not reimplement or copy the edit table.

**Blocked by:** 03 (the duplicate is still on disk; the extension does not call it).

**Status:** awaiting-user — loads and reports correctly in a real editor (2026-08-20); the auto-repair box needs an actually-unpatched install, i.e. ticket 05

- [x] A patched install starts up with nothing changed and nothing shown. (`test/extension.test.js`: contents *and* mtimes unchanged, no notification, no reload.)
- [ ] An unpatched install is patched automatically and the images work afterwards. Patching is asserted; **"the images work afterwards" needs a human looking at the panel** and cannot be closed from code.
- [x] The webviews are reloaded only when a patch was actually applied — never on an ordinary startup. (Reload is asserted exactly once after a patch, and absent on no-op, disabled, resolution-failure and patch-failure paths.)
- [x] Patching is skipped entirely when the user has disabled it in settings. (`claudeInlineImages.autoPatch`, default `true`, declared in `contributes.configuration`.)
- [x] A failure to patch produces a visible notification naming what went wrong. Silence is a failed ticket: it is the original bug in a new place. (Both resolution failure and patch failure show one error message carrying the underlying reason verbatim plus what to do next.)
- [x] The target is resolved through the extension registry; the directory-scanning heuristics remain for command-line use only. (`vscode.extensions.getExtension('anthropic.claude-code').extensionPath`; `patch.js findExtensionDir()` is used only if the registry yields nothing.)

## What was built

```
extension/package.json        onStartupFinished, extensionDependencies, setting, 3 commands
extension/src/extension.js    activate() -> ensurePatched(); vscode is injected, never
                              required at module load, so it is testable headless
extension/src/uninstall.js    ticket 07
extension/.vscodeignore
extension/CHANGELOG.md
test/extension.test.js        33 assertions, node only, synthetic fixtures in a temp dir
```

The edit table is not duplicated: the extension `require`s the repo's `patch.js`
(vendoring beside `src/` is supported for packaging, still one file). A test
asserts no anchor or injected fragment appears anywhere under `extension/src/`.

## Findings

**2026-08-20 — it loads in a real editor.** Installed by symlink:

```
ln -sfn ~/projects/claude-inline-images/extension \
        ~/.vscode/extensions/claude-inline-images-0.1.0
```

After a window restart, *Claude Inline Images: Show Patch Status* returned:

> Claude inline images: patched at v2 (current); KaTeX patch also present —
> /home/dustin/.vscode/extensions/anthropic.claude-code-2.1.234-linux-x64
>
> *Source: Claude Inline Images*

That single notification establishes several things that had only ever been
asserted against fixtures: VS Code scans and activates a **symlinked** extension
folder (its `extensions.json` registry is not a barrier); `loadPatcher()`
resolves `patch.js` two levels up through the symlink, so the extension host
does **not** run with `--preserve-symlinks`; registry-based target resolution
returns the same install `patch.js` finds standalone; and the KaTeX detection is
correct against a real co-installed extension.

It also exercised the first ticked box for real: a patched, current install
started up and the extension did nothing at all.

**Still unticked, and this notification does not close it.** The install was
already patched, so no repair path ran. "An unpatched install is patched
automatically and the images work afterwards" needs the install to actually be
missing the patch first — that is ticket 05.

## Left for a human

Install the extension folder into a real editor, let a Claude Code update land
(or `node patch.js remove`), restart, and confirm an image renders without
running anything. That is the box above, and it is also ticket 05.
