# Changelog

All notable changes to the Claude Inline Images companion extension.
This project follows [Keep a Changelog](https://keepachangelog.com/) loosely and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Self-healing activation. On `onStartupFinished` the extension resolves the
  running `anthropic.claude-code` install through the editor's own extension
  registry and applies the inline-image patch when the version stamp is absent.
  Absence of the stamp is the only condition, so the patch also comes back after
  a Claude Code update installs into a new directory, or after another extension
  restores its own pristine copy of the shared bundle.
- The webviews are reloaded (`workbench.action.webview.reloadWebviewAction`)
  only when a patch was actually applied. An ordinary startup writes nothing,
  reloads nothing, and shows nothing.
- Visible failure. If the install cannot be found or cannot be patched, an error
  notification names what went wrong and what to do about it. Silence is not an
  accepted outcome.
- Recovery from a **half-applied** patch. When another extension writes its own
  pristine copy of `webview/index.js` back over the shared bundle — which
  `nuriyev.claude-code-katex` does whenever it re-patches — our edits to that
  file are reverted while our edits to `extension.js` remain. `patch.js` treats
  a version as present only when every one of its edits is present, so it
  reported the install as unpatched and then `apply()` aborted on the
  `extension.js` anchors it could no longer find (`anchor occurs 0x, expected
  4x`). Startup now reverses whichever fragments are actually on disk first, so
  the patcher sees a tree it recognises and re-applies cleanly. This runs only
  on the about-to-patch path, so an ordinary startup still writes nothing.
  Nothing is ever restored from a saved copy and no copy is ever made — a copy
  would have captured the other extension's edits and replaying it would
  resurrect a stale build of someone else's patch.
- `claudeInlineImages.autoPatch` setting (default `true`) to turn automatic
  patching off entirely.
- Commands: apply, remove, and show status on demand.
- `vscode:uninstall` hook that removes the patch from every install found, by
  targeted string removal. It restores the files byte-identically, never
  restores from a saved copy, and never creates one.

### Notes

- The patch logic is not duplicated here: the extension calls the repository's
  `patch.js`, which remains the single source of the edit table.
- Not yet packaged or published; see the companion-extension spec, tickets 01
  and 08.
