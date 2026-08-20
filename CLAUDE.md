# claude-inline-images — agent guide

This repo patches the installed **`anthropic.claude-code` VSCode extension** so
images render inline in its chat panel, plus `plot.py`, a token-cheap SVG
plotter. Read [README.md](README.md) for the root cause and [TODO.md](TODO.md)
for what's unfinished.

## The one thing to understand first

`webview/index.js` is a **5MB minified React bundle**. Never read it whole — it
will blow your context. Always grep with bounded context:

```bash
python3 - <<'PY'
s=open('<ext>/webview/index.js',encoding='utf-8').read()
i=s.index('components:{'); print(repr(s[i-260:i+420]))
PY
```

Find the live install with `node -e "console.log(require('./patch.js').findExtensionDir())"`.

## Working on the patch

`patch.js` is a **table of exact string edits**, not a codemod. Each entry is
`[file, original, replacement, expectedCount]`. It refuses to write if any count
is off, so a bundle change fails loudly instead of corrupting anything.

**The copy of `patch.js` in this repo is the only one that may exist.** The
companion extension under `extension/` `require`s it rather than embedding the
edit table, and `test/extension.test.js` fails if any anchor or injected
fragment appears under `extension/src/`. A convenience copy elsewhere (there was
one at `~/.claude/inline-images/patch.js`, stale at v1) is a bug, not a
shortcut: two edit tables that must agree exactly will not.

**After touching any injected fragment, run `node test/verify.js`.** It has 56
assertions covering security, KaTeX coexistence, anchor uniqueness, syntax, and
a byte-identical round trip per version. It evaluates the *actual injected
string*, so tests can't drift from what ships.

`node test/extension.test.js` covers the companion extension under `extension/`
— activation, the self-heal decision, and the uninstall hook. It injects a
stubbed `vscode` (the extension never requires it at module load) and patches
only synthetic fixtures in a temp dir, so it runs headless and never touches a
real install. Run both.

The version-selection assertions run against a **synthetic fixture** built in a
temp dir from the anchor strings themselves (`makeFixture()` in `test/verify.js`).
If you change an anchor, the fixture follows automatically — but if you add a
*new* anchored file to `EDITS`, add it to `FIXTURE_FILES` and the fixture too.

Rules that are not obvious and were each learned the hard way:

- **Insert after `remarkPlugins:[…]`, never right after the `{`.** The
  `nuriyev.claude-code-katex` extension patches the same call site with a regex
  requiring `{remarkPlugins:[` immediately after the component argument.
  Inserting before it silently disables KaTeX.
- **Don't anchor on the viewport `<meta>`** — it appears twice; the second is
  the plan-preview webview. Use the CSP line, which is unique to the chat panel.
- **Style images inline, not in `index.css`.** `img[src^="data:"]` is `0,1,1`
  specificity and beats `.thumbIcon_*` at `0,1,0`, which breaks the tool-result
  thumbnail pill.
- **Never widen `urlTransform` to identity.** Upstream blocks external image
  URLs deliberately, to stop exfiltration via markdown image URLs. Keep the
  allowlist tight and keep the security assertions green.
- **Keep no backup file.** A backup may capture a KaTeX-patched bundle;
  restoring it later resurrects a stale KaTeX build. `remove()` is the inverse.

## Verifying a change actually works

Static tests can't prove the webview renders. The loop is:

1. `node patch.js apply`
2. Reload — **and which reload depends on which half of the patch you touched:**

   | You changed | Reload | Cost |
   |---|---|---|
   | `webview/index.js` only (all of v1) | **Developer: Reload Webviews** | none — the session survives |
   | `extension.js` (v2's meta tag and `localResourceRoots`) | **Developer: Reload Window**, or restart VS Code | restarts the extension host and **kills the running session** |

   Prefer Reload Webviews; it is enough for most work. But `extension.js` is
   evaluated by the extension host at startup, so a webview reload leaves the
   panel being built by the *old* host code. Verified the hard way on
   2026-08-18: with v2 fully on disk and only webviews reloaded, `data:` URIs
   rendered while the injected `<meta name="claude-ws-base">` was absent and
   relative paths blanked to `[Image]`. That looks exactly like a broken patch
   and is not one — see
   [ticket 02's findings](specs/workspace-relative-images/tickets/02-confirm-webview-uri-passes-csp.md).
3. Emit a small `data:image/svg+xml` URI in a chat message and look at it.

Reading the three outcomes:

| You see | Meaning |
|---|---|
| the image | working |
| `[Image]` | markdown parsed fine; the patch isn't active (usually: not reloaded) |
| raw markdown text | **your URI is malformed** — almost always an unencoded space |

That last one is the trap. A literal space in a markdown link destination makes
CommonMark not produce an image node at all. It is not a patch failure, and it
looks nothing like one.

## Permissions

Writes into `~/.vscode/extensions/**` and `~/.claude/**` are commonly denied by
the permission classifier, and an agent **should not** try to phrase around
that. If denied, ask the user to run `node patch.js apply` themselves, or to add
an allow-rule via `/permissions`. An agent editing its own permission grants is
correctly blocked — don't attempt it.

"Commonly denied" is not "always denied": it depends on the session's permission
mode. `node install-skill.js` succeeded from an agent on 2026-08-19. So **run
the command and report the real result** rather than declining pre-emptively and
citing this paragraph.

## plot.py

Stdlib only, no matplotlib — deliberately. The output URI is retyped by the
model into its own message, so **bytes are tokens**. Current cost ~550–840
tokens per plot; matplotlib would be 5–12k. If you add features, re-check the
size printed on stderr and don't regress it.

Size levers already used: RDP simplification, integer pixel coords, shared
attributes on `<g>` wrappers, consecutive-duplicate-point dropping.

## Scope

This is a workaround for a bug in someone else's extension. Prefer the smallest
patch that works, keep it exactly reversible, and keep the README honest about
what is verified live versus only statically checked — right now stage 2 is the
latter.
