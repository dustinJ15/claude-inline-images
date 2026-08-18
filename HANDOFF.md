# Handoff — turning this into a real VSCode extension

You are picking up a working proof of concept and making it a legitimate,
publishable extension. Read [CLAUDE.md](CLAUDE.md) for the rules that keep the
patch safe, [README.md](README.md) for the root cause, [TODO.md](TODO.md) for the
full backlog. This document is the current state and the plan.

---

## 1. State right now — read this before touching anything

```
$ node patch.js status
{
  "extDir": ".../anthropic.claude-code-2.1.234-linux-x64",
  "patchedVersions": ["1"],     <-- the LIVE install is at v1
  "current": false,             <-- repo ships v2
  "katexPatched": true
}
```

**The live install and this repo disagree on purpose.** v1 (data: URIs) was
applied and confirmed rendering in a real panel. v2 (relative paths) was written
afterwards and has **never been applied to a running webview** — only statically
verified. Running `node patch.js apply` upgrades v1 → v2 and *could* break a
currently-working setup. `node patch.js remove` restores pristine.

| Stage | What | Evidence |
|-------|------|----------|
| 1 | `data:image/*` renders inline | **Confirmed live.** A human looked at a rendered SVG in the panel. |
| 2 | `![](plots/x.png)` relative paths | Parses, anchors unique, round-trips byte-identical. **Never rendered.** |
| 3 | Companion extension | **Not started.** No code exists. |

`node test/verify.js` — 29 assertions, all green. Run it after every change.

## 2. Environment it was built against

- `anthropic.claude-code` **2.1.234** (linux-x64), VSCode **1.133.0**, Fedora 44
- Panel mode: `"claudeCode.preferredLocation": "panel"` → `createWebviewPanel("claudeVSCodePanel", …)`
- `nuriyev.claude-code-katex` **2.1.1** is installed and patches **the same call
  site**. Keeping it working is a hard requirement, not a nice-to-have. Its
  manifest is the reference design for stage 3:

  ```json
  { "activationEvents": ["onStartupFinished"],
    "extensionDependencies": ["anthropic.claude-code"],
    "scripts": { "vscode:uninstall": "node ./uninstall-hook.js" } }
  ```

Only this one configuration has been exercised. Everything about other
platforms, VSCode versions, and Claude Code versions is unverified.

## 3. Two constraints that will shape how you work

### You cannot verify rendering with code

Static tests prove the bundle parses and the strings are right. They cannot
prove the webview draws an image. **Only a human looking at the panel can
confirm that.** Budget for that round trip; don't declare stage 2 done without it.

The verification loop:

1. `node patch.js apply`
2. `Ctrl+Shift+P` → **Developer: Reload Webviews**
   (*not* Reload Window — that restarts the extension host and kills the session)
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

### The permission classifier will block you

Writes into `~/.vscode/extensions/**` and `~/.claude/**` are denied to agents,
as is editing `settings.json` to grant yourself permission. **Do not hunt for a
phrasing that gets through.** Ask the user to run the command, or to add an
allow-rule via `/permissions`. Repo-local writes under `~/projects` are fine.

## 4. Task A — verify stage 2 before building anything on it

Do not wrap unverified code in an extension. Confirm v2 works first.

- [ ] Have the user run `node patch.js apply`, then reload webviews.
- [ ] Confirm `<meta name="claude-ws-base">` actually appears in the webview
      HTML and holds a real URI (Developer: Open Webview Developer Tools).
- [ ] Emit `![t](scratch/plots/test.png)` against a real file and confirm it draws.
- [ ] **Most likely failure point:** whether `asWebviewUri`'s host is covered by
      the CSP's `${cspSource}` once `localResourceRoots` is widened. If it is
      not, fall back to writing images into `<ext>/resources/`, which is already
      an allowed root and needs no `extension.js` change at all.
- [ ] Regression check in the same message: KaTeX math still typesets, and a
      `Read` of a PNG still shows its normal thumbnail pill (not stretched — see
      the specificity trap in CLAUDE.md).
- [ ] If v2 fails and can't be fixed quickly, `node patch.js remove` then
      re-apply v1 so the user keeps a working setup while you iterate.

## 5. Task B — the companion extension

The whole point: **the patch dies at every Claude Code update**, because updates
install into a new versioned directory. Today recovery is manual.

Proposed layout — keep the patcher as the single source of truth, don't fork the
edit logic:

```
extension/
  package.json        manifest
  src/extension.js    activate() -> ensurePatched()
  src/uninstall.js    vscode:uninstall hook
  .vscodeignore
  CHANGELOG.md
  icon.png            128x128
patch.js              <- required by the extension, NOT duplicated
```

Core behaviour:

- [ ] `activationEvents: ["onStartupFinished"]`,
      `extensionDependencies: ["anthropic.claude-code"]`
- [ ] Resolve the target with
      `vscode.extensions.getExtension('anthropic.claude-code').extensionPath`
      and pass it to `apply(extDir)` — more reliable than the standalone
      heuristics, which exist only for CLI use.
- [ ] Re-apply whenever the version stamp is absent. This is what makes it
      self-healing when KaTeX restores from `index.js.katex-bak` and clobbers us.
- [ ] Call `workbench.action.webview.reloadWebviewAction` **only when a patch was
      actually applied.** Reloading on every startup is disruptive.
- [ ] Uninstall hook does **targeted string removal, never file restore** (see
      CLAUDE.md for why a backup is actively dangerous here).
- [ ] Surface failures as a notification. Silent no-op is the worst outcome —
      the user sees `[Image]` and has no idea why.
- [ ] Contribute commands: apply / remove / status, and a setting to disable
      auto-patching.
- [ ] Handle the startup race with KaTeX: both patch on `onStartupFinished`.
      Verify the result is correct regardless of which wins, in both orders.

## 6. Task C — what makes it "legit"

- [ ] Manifest completeness: `displayName`, `description`, `categories`,
      `repository`, `bugs`, `icon`, `license`, `engines.vscode`
- [ ] `CHANGELOG.md`, and a README that renders well on the Marketplace
      (the current one is written for GitHub — check the image/table rendering)
- [ ] Package with `@vscode/vsce`; verify the `.vsix` contents are minimal
- [ ] Integration tests with `@vscode/test-electron` — install into a scratch
      VSCode, patch, assert the bundle changed, assert `remove` restores it
- [ ] GitHub Actions running `node test/verify.js` (it already skips the bundle
      checks cleanly when no Claude Code install is present, so CI works)
- [ ] Publisher identity on the Marketplace, and decide the extension ID
- [ ] State plainly in the README that it modifies another extension's files,
      and how to fully undo it. Users deserve to know before installing.

### Open question you must resolve with the user

**Is publishing this to the Marketplace acceptable?** It modifies another
publisher's extension on disk. `nuriyev.claude-code-katex` is precedent that it
is at least tolerated, but confirm against current Marketplace policy before
publishing. If it is not acceptable, ship as a GitHub release + `npx` CLI
instead — the patcher works standalone today.

There is also a real chance this becomes unnecessary. The fix upstream is a
one-line `urlTransform`, and the extension already contains a dead `data:` branch
in its `img` override, which suggests inline images were *intended* to work.
**Filing an upstream issue may be the highest-value action in this whole repo.**
Related: [claude-code#54546](https://github.com/anthropics/claude-code/issues/54546)
tracks inline images in the terminal UI — a different surface, same underlying want.

## 7. Gotchas, condensed

- Never read `webview/index.js` whole — 5MB minified, it will blow your context.
  Grep with bounded context; there's a recipe in CLAUDE.md.
- Insert **after** `remarkPlugins:[…]`, never right after the `{` — KaTeX's
  anchor regex requires `{remarkPlugins:[` and inserting before it silently
  disables KaTeX.
- Don't anchor on the viewport `<meta>` — it appears **twice**; the second is the
  plan-preview webview. Use the CSP line.
- Style images inline, not via `index.css` — `img[src^="data:"]` (0,1,1) beats
  `.thumbIcon_*` (0,1,0) and breaks the tool-result thumbnail pill.
- Never widen `urlTransform` to identity. Upstream blocks external image URLs to
  prevent exfiltration via markdown image URLs; keep the security assertions green.
- `A_LRR` and `A_CSP` embed the minified alias `Lt` and CSP template vars
  `${p} ${f} ${m} ${u} ${g}`. These **will** break on a rebuild. Consider regex
  anchors with captured identifiers, as KaTeX does.
