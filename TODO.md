# TODO

Ordered roughly by value. Stage numbers match the README status table.

## Stage 2 — relative paths (applied live; the relative-path half unrendered)

`patch.js` v2 is complete, passes `test/verify.js`, and **is applied to the live
install** (2026-08-18 — `status` reports `patchedVersions: ["2"], current: true`).
That confirmed v2 did not regress v1: `data:` URIs still render. It did **not**
exercise the relative-path half, which remains unverified against a running
webview — everything below still stands.

- [x] Apply v2 without regressing `data:` URIs. Done 2026-08-18.
- [ ] Confirm `![x](plots/foo.png)` renders. Needs **Developer: Reload Window**,
      not Reload Webviews — `extension.js` is only evaluated by the extension
      host at startup, so a webview reload leaves the old host code building the
      panel. Verified the hard way on 2026-08-18.
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

## Stage 3 — companion extension (built, never loaded in a real editor)

Without this the patch dies at every Claude Code update. It lives in
[extension/](extension/), `require`s the repo's `patch.js` rather than embedding
a second edit table, and is covered by `test/extension.test.js` (36 assertions,
headless, synthetic fixtures only).

- [x] `activationEvents: ["onStartupFinished"]`,
      `extensionDependencies: ["anthropic.claude-code"]`
- [x] Resolve the target with
      `vscode.extensions.getExtension('anthropic.claude-code').extensionPath`
      rather than the directory glob `patch.js` uses standalone
- [x] Re-apply whenever the version stamp is absent — this is what makes it
      self-healing if KaTeX restores from `index.js.katex-bak` and clobbers us
- [x] Uninstall via `vscode:uninstall` hook doing **targeted string removal**,
      never file restore (see README → "How the patch stays safe")
- [x] Finish with `workbench.action.webview.reloadWebviewAction` so no window
      reload is needed
- [ ] **Load it in a real editor.** Everything above is asserted against
      fixtures; none of it has run inside VS Code. Until that happens, updates
      still need a manual `node patch.js apply`.
- [ ] Handle the ordering race: if both this and KaTeX patch on startup, confirm
      the result is correct regardless of which wins (the static assertion is in
      place; the live ordering needs a real machine)

## Robustness

- [ ] **Anchor fragility.** `A_LRR` and `A_CSP` embed the minified vscode alias
      `Lt` and CSP template vars `${p} ${f} ${m} ${u} ${g}`. These will break on
      a rebuild. Consider regex anchors with captured identifiers, the way the
      KaTeX extension does it.
- [ ] Test against more than one Claude Code version. Only 2.1.234 is confirmed.
- [ ] Check whether VSCode ever flags the modified bundle (corrupt-install
      warning). Not observed so far, but not deliberately tested.
- [ ] Install discovery now searches VSCode / Insiders / VSCodium /
      `.vscode-server` / Flatpak roots and prefers `CLAUDE_CODE_EXECPATH`, but
      only the plain `~/.vscode` path has actually been exercised. Test the
      others — particularly `.vscode-server`, where Remote/WSL users live.
- [ ] When several installs are live, the highest version wins. Verify that's
      the right rule (it may not be, if an older one is the running window).
- [ ] Windows path handling is untested end to end.

## plot.py

Everything originally listed here has shipped. Tests: 120, plus a 14-plot byte
baseline (`test/plot_size_baseline.json`) whose eight original entries are pinned
byte-identical, so a new feature cannot quietly make old plots more expensive.

- [x] **Dark/light theming** — shipped as `--theme auto|dark|light`. The
      `prefers-color-scheme` route was tested and **does not work**: a dark
      editor rendered the light probe. Write-up in
      [specs/plot-py/theming-experiment.md](specs/plot-py/theming-experiment.md).
- [x] Polar and parametric plotting — `--polar`, `--param`, `--trange`.
- [x] Riemann-sum overlays — `--riemann`, `--riemann-at`, `--riemann-range`.
      (Solid-of-revolution sketches were **not** done and are not planned.)
- [x] Discontinuities — `--break-at X` / `--break-at I:X` declares one exactly;
      `--jump-frac` tunes or disables the old heuristic.
- [x] `--samples` exposed (default 400).
- [x] Axis labels (`--xlabel`, `--ylabel`) and point annotations
      (`--annotate X Y TEXT`, or `--points "1,1:label"`).
- [x] Tests — `python3 test/test_plot.py`.

Still open:

- [ ] Nobody has looked at a `--theme light` plot on a light background or a
      `--theme dark` plot on a dark one. The palettes are reasoned, not seen.
- [x] Arrow/vector primitive — shipped 2026-08-20 as `--vec "X,Y[:label]"` and
      `--vec "TX,TY->HX,HY[:label]"`, forcing an equal aspect ratio. Measured
      39.5B/vector via a shared `<g>` + single `<path>`, against 192.6B for the
      obvious `<line>`+`<polygon>` form. Spans and tip-to-tail addition are
      drawable; **grid-deformation-under-a-matrix still is not**.
- [ ] No planes, no 3D, no basis-grid deformation. R^3 pictures and
      column-space-as-a-plane remain undrawable — the remaining linear-algebra
      gap, now narrower than it was.
- [ ] Solid-of-revolution sketches (dropped from the list above; still unbuilt).

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
