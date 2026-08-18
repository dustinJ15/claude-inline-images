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

**After touching any injected fragment, run `node test/verify.js`.** It has 29
assertions covering security, KaTeX coexistence, anchor uniqueness, syntax, and
a byte-identical round trip. It evaluates the *actual injected string*, so tests
can't drift from what ships.

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
2. `Ctrl+Shift+P` → **Developer: Reload Webviews**
   (*not* Reload Window — that restarts the extension host and kills the session)
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
that. Ask the user to run `node patch.js apply` themselves, or to add an
allow-rule via `/permissions`. An agent editing its own permission grants is
correctly blocked — don't attempt it.

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
