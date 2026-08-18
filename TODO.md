# TODO

Ordered roughly by value. Stage numbers match the README status table.

## Stage 2 — relative paths (code written, never applied live)

`patch.js` v2 is complete and passes `test/verify.js`, but has **never been
applied to a live install**. Everything below is unverified against a running
webview.

- [ ] Apply v2 and confirm `![x](plots/foo.png)` renders. Run
      `node patch.js apply` then *Developer: Reload Webviews*.
- [ ] Confirm the injected `<meta name="claude-ws-base">` actually lands in the
      webview HTML, and that `asWebviewUri` returns a host the CSP's
      `${cspSource}` accepts. **This is the most likely failure point** — the
      whole design rests on `img-src ${cspSource}` covering workspace files once
      `localResourceRoots` is widened. If it fails, fall back to writing images
      into `<ext>/resources/`, which is already an allowed root.
- [ ] Verify multi-root workspaces. Currently only `workspaceFolders[0]` is
      published; decide whether to support the rest or document the limit.
- [ ] Decide whether widening `localResourceRoots` to the whole workspace is too
      broad. It lets the panel load any file under the workspace as an image.
      That is a real (if minor) widening of what a prompt-injected model output
      could cause to be fetched — scope it to a subdirectory if that matters.
- [ ] Once working, measure the real token cost per graph (expected ~10 vs the
      current ~550–840) and update the README.

## Stage 3 — companion extension (not started)

Without this the patch dies at every Claude Code update. Model it on
`nuriyev.claude-code-katex`, which solves the identical problem:

- [ ] `activationEvents: ["onStartupFinished"]`,
      `extensionDependencies: ["anthropic.claude-code"]`
- [ ] Resolve the target with
      `vscode.extensions.getExtension('anthropic.claude-code').extensionPath`
      rather than the directory glob `patch.js` uses standalone
- [ ] Re-apply whenever the version stamp is absent — this is what makes it
      self-healing if KaTeX restores from `index.js.katex-bak` and clobbers us
- [ ] Uninstall via `vscode:uninstall` hook doing **targeted string removal**,
      never file restore (see README → "How the patch stays safe")
- [ ] Finish with `workbench.action.webview.reloadWebviewAction` so no window
      reload is needed
- [ ] Handle the ordering race: if both this and KaTeX patch on startup, confirm
      the result is correct regardless of which wins

## Robustness

- [ ] **Anchor fragility.** `A_LRR` and `A_CSP` embed the minified vscode alias
      `Lt` and CSP template vars `${p} ${f} ${m} ${u} ${g}`. These will break on
      a rebuild. Consider regex anchors with captured identifiers, the way the
      KaTeX extension does it.
- [ ] Test against more than one Claude Code version. Only 2.1.234 is confirmed.
- [ ] Check whether VSCode ever flags the modified bundle (corrupt-install
      warning). Not observed so far, but not deliberately tested.
- [ ] `patch.js` picks the highest-versioned non-obsolete install. Verify that's
      right when several are live.

## plot.py

- [ ] **Dark/light theming.** Colors are fixed mid-tones chosen to be legible on
      both. An `<img>` can't inherit page CSS, so proper theming needs either a
      `--theme` flag or `prefers-color-scheme` inside the SVG (worth testing —
      media queries inside an SVG data URI may work in the webview).
- [ ] Polar and parametric plotting (`r(θ)`, `x(t), y(t)`).
- [ ] Riemann-sum / rectangle overlays, and solid-of-revolution sketches.
- [ ] Vertical asymptote detection is heuristic (a jump > half the y-range).
      Improve, or expose a `--discontinuity` flag.
- [ ] `--samples` is fixed at 400 pre-simplification; expose it.
- [ ] Axis labels, and optional point annotations with text.
- [ ] Tests. There are none.

## Packaging / publishing

- [ ] Decide the distribution story: plain repo, npm package with a `bin`, or
      a published VSCode extension. A published extension is the best UX but
      means shipping something that patches another vendor's extension —
      consider how that reads on the Marketplace.
- [ ] Add the screenshot the README has a placeholder for.
- [ ] CI: `node test/verify.js` runs clean without a Claude Code install (bundle
      checks skip rather than fail) — wire it to GitHub Actions.
- [ ] `plot.py` currently uses `eval` with a restricted namespace. Fine for
      local use; revisit before recommending it to anyone else.

## Open questions

- Is there an upstream-friendly version of this? A one-line `urlTransform` in
  the real extension would make the whole project unnecessary. Worth filing an
  issue — the existing dead `data:` branch suggests it was intended to work.
- Upstream issue [#54546](https://github.com/anthropics/claude-code/issues/54546)
  tracks terminal-UI inline images (OSC 1337 / Kitty / sixel). Different surface
  from this webview, but related; worth referencing if filing.
