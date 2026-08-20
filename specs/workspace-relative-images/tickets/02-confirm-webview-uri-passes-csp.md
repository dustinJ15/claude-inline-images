# 02 — Prove the workspace resource host is actually loadable

**What to build:** a definitive yes/no on the assumption the whole relative-path
design rests on — that a webview URI for a workspace file is covered by the chat
panel's existing image content-security-policy once the allowed resource roots
are widened. This is the one assumption whose failure invalidates the approach
rather than being a bug inside it, so it is answered before anything is built on
top of it.

**Blocked by:** 01 — the rollback net must exist before the live install is
touched.

**Status:** awaiting-user — blocked on a full window reload; see Findings

- [x] The patch is applied to the live install and the webviews reloaded — **but see Findings: for v2 this is not sufficient.**
- [ ] In the webview developer tools, the injected workspace-base metadata is confirmed present in the panel's HTML and holding a real, non-empty URI.
- [ ] A workspace image is loaded and either draws or produces a CSP violation in the console; the console is read, not guessed at.
- [ ] The outcome is recorded in the spec folder: approach confirmed, or approach rejected with the exact violation text.
- [ ] If rejected, the fallback is adopted — serve images from the extension's already-allowed resources directory, dropping both host-side anchors — and the remaining tickets are re-scoped to it before any further work.

## Findings — 2026-08-18

**The CSP question is still unanswered, because the host half of v2 was never
running.** What was learned instead is a procedural fact that the rest of this
spec depends on.

### Reload Webviews does not activate v2

`node patch.js apply` put both v2 edits on disk — verified in the live install:

```
localResourceRoots:[...,/*claude-inline-images:v2*/((Lt.workspace.workspaceFolders||[]).map(...))]
<meta name="claude-ws-base" data-cii="v2" content="${...asWebviewUri(...)...}">
```

Then **Developer: Reload Webviews**, and a `data:` URI rendered — so v2's
webview-side edit was live. But `plots/probe.svg` rendered as `[Image]`, and
the injected meta tag was absent from the panel.

The cause is that the two v2 edits load at different times. The webview edit
lives in `webview/index.js` and is re-read on a webview reload. The meta tag and
the widened `localResourceRoots` live in `extension.js`, which is evaluated by
the **extension host at startup**. Reloading webviews does not re-evaluate it,
so the panel is built by the old host code and no meta tag is emitted. With no
base URI to resolve against, a scheme-less path cannot be turned into a webview
URI and blanks — `[Image]` is the *designed* behaviour here, not a failure.

**Consequence for the whole spec:** v1 was a webview-only patch, so
`Reload Webviews` was the entire procedure. v2 is not. Testing v2 requires
**Developer: Reload Window** or a VS Code restart — which kills the running
Claude Code session. That trade is unavoidable and needs to be stated wherever
the reload loop is documented (CLAUDE.md, README, HANDOFF), all of which
currently say "never Reload Window" without qualification. That advice was
correct for v1 and is wrong for v2.

### One caveat on the evidence

The `META MISSING` result was read with the devtools console attached to the
`top` frame, while the panel content lives in a nested iframe
(`index.html?id=…`) — the console itself printed "Using standard dev tools to
debug iframe based webview". A query against `top` could not have found the
meta regardless. The reasoning above does not rest on that reading, but the
frame-scoped re-check is worth one line of confirmation after the window reload.

### Freebie confirmed while the panel was open

`[Claude Code LaTeX v2] math pipeline loaded` appeared in the console with the
v2 patch applied. KaTeX coexistence is asserted statically per version in
`test/verify.js`; this is the first time it has also been observed live.

### Next step, unchanged in substance

Reload the window, then re-run: read the meta in the **webview iframe**, load
`plots/probe.svg`, and read the console for a CSP violation. The original
question — whether `asWebviewUri`'s host is covered by `${cspSource}` once
`localResourceRoots` widens — is exactly as open as it was.
