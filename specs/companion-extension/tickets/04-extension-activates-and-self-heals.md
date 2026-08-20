# 04 — The extension re-applies the patch when it finds it missing

**What to build:** the core behaviour. On startup the extension resolves the
running Claude Code install through the editor's own extension registry, checks
for the version stamp, and patches when it is absent. It calls the existing
patcher; it does not reimplement or copy the edit table.

**Blocked by:** 03 (the duplicate is still on disk; the extension does not call it).

**Status:** awaiting-user — built and covered by headless tests; one box needs a human looking at a real panel

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

## Left for a human

Install the extension folder into a real editor, let a Claude Code update land
(or `node patch.js remove`), restart, and confirm an image renders without
running anything. That is the box above, and it is also ticket 05.
