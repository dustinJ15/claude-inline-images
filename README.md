# claude-inline-images

Make `![alt](...)` images actually render inline in the **Claude Code VSCode
extension's chat panel**, plus a token-cheap SVG plotter for generating them.

Out of the box the panel renders every image in assistant markdown as the
literal text `[Image]`. This project explains exactly why, and fixes it with a
small, reversible, self-verifying patch to the extension bundle.

<!-- TODO: screenshot of a rendered plot in the panel -->

---

## The bug

The chat panel is a `WebviewPanel` rendering a React bundle. Assistant markdown
passes through **exactly one** `react-markdown` call site in
`<ext>/webview/index.js`:

```js
b(QQ,{remarkPlugins:[XA],components:{
  a:…, pre:…, code:…,
  img:({src:l,alt:c})=>{
    if(l?.startsWith("data:"))return b("img",{src:l,alt:c||""});
    return b("span",{title:`Image blocked: ${l||"unknown"}`,children:"[Image]"})
  }},children:n})
```

Three things are true at once:

1. **The CSP already allows images.** `getHtmlForWebview()` emits
   `img-src ${cspSource} data:`.
2. **The renderer already handles them.** That `img` override has a working
   `data:` branch, and the tool-result path renders `<img src="data:…">` today
   (just CSS-capped to a 12px thumbnail pill).
3. **One missing prop kills it.** No `urlTransform` is passed, so react-markdown
   falls back to `defaultUrlTransform`, whose scheme allowlist is
   `/^(https?|ircs?|mailto|xmpp)$/i`. **`data:` is not in that list**, so the src
   is blanked to `""` *before* the components map runs. `"".startsWith("data:")`
   is false → `[Image]`.

The feature is written, permitted, and unreachable. This patch supplies the prop.

Raw HTML is a separate dead end: the bundle has no `rehype-raw`, so `<img>` and
inline `<svg>` become unparsed `raw` hast nodes and are dropped entirely.

## Install

Requires Node 18+ and the `anthropic.claude-code` VSCode extension.

```bash
git clone <this repo> && cd claude-inline-images
node test/verify.js      # 29 assertions; do this first
node patch.js apply
```

Then in VSCode: `Ctrl+Shift+P` → **Developer: Reload Webviews**.

Use *Reload Webviews*, not *Reload Window* — the latter restarts the extension
host and kills any running Claude Code session.

```bash
node patch.js status     # what's applied
node patch.js remove     # exact inverse, byte-identical
```

### It does not survive Claude Code updates

Each update installs into a **new versioned directory**, so the patch is gone
and images silently revert to `[Image]`. Re-run `node patch.js apply`. The
companion extension that automates this is **not built yet** — see [TODO.md](TODO.md).

## Usage

Once patched, any `data:image/*` URI in assistant markdown renders inline:

```markdown
![sine](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'…)
```

**Percent-encode fully.** A literal space in a markdown link destination makes
CommonMark fail to parse the image at all — you get raw text, not `[Image]`.
That failure mode looks nothing like the patch not working, and cost real
debugging time. `plot.py` handles the encoding for you.

### plot.py

`plot.py` emits a compact SVG data URI sized for the fact that **the URI travels
through the assistant's own output**, where every byte is a token it must
retype. A matplotlib SVG of one curve is 15–40KB (~5–12k tokens). This emits
~2KB (~550–840 tokens) for the same curve, via Ramer–Douglas–Peucker
simplification, integer pixel coordinates, and shared attributes on `<g>`
wrappers.

```bash
python3 plot.py -e "sin(x)" -e "cos(x)" -x -6.3 6.3 -t "sin and cos"
python3 plot.py -e "sqrt(x)" -e "x**2" -x 0 1.1 --fill 0 1 -t "area between"
python3 plot.py -e "1/x" -x 0.2 6 --points "1,1 2,0.5 3,0.333"
```

Stdlib only, no matplotlib. Prints a ready-to-paste `![alt](data:…)` line and
reports its token cost on stderr. Handles multiple curves, shaded regions
between curves, asymptote-aware segmenting, and scatter overlays.

## Security

The upstream CSP comment is explicit about why external images are blocked:

> Note: External https: URLs are blocked to prevent data exfiltration via
> markdown image URLs.

That is a real protection — model output is attacker-influenceable, and an
`<img>` fetch is a GET with attacker-chosen path. **This patch preserves it.**

- `urlTransform` is **not** an identity function. It adds `data:image/*` and
  otherwise reproduces `defaultUrlTransform` exactly.
- `data:text/html`, `javascript:`, `vbscript:`, `blob:`, `file:` all stay blanked.
- `https:` passes the transform exactly as it does upstream, then is rejected by
  *two* further layers: the `img` override and the CSP.
- v2's relative-path branch resolves only scheme-less paths against the
  workspace root, with VSCode's own `localResourceRoots` as the backstop.

`test/verify.js` asserts every one of these against the **actual injected
string**, so the tests cannot drift from the shipped fragment.

## How the patch stays safe

- **Unique anchors.** `,components:{` occurs *exactly once* in the 5MB bundle.
  Every anchor's occurrence count is asserted before any write; a mismatch
  aborts rather than guessing.
- **Staged writes.** All files are built in memory and validated before the
  first byte is written, so a shape change can't leave a half-patched bundle.
- **Atomic writes** via temp-file + rename.
- **Exact inverse.** `remove()` restores byte-identical files (asserted).
- **No backup file.** A backup would capture a possibly-KaTeX-patched bundle;
  restoring it later could resurrect a stale KaTeX build.

### Coexistence with `nuriyev.claude-code-katex`

That extension (which renders LaTeX in the same panel) patches the **same call
site**, anchored on a regex requiring `{remarkPlugins:[` immediately after the
component argument. We therefore insert **after** the remarkPlugins array — just
before `,components:{` — so its anchor still matches and both patches apply in
either order. `test/verify.js` asserts this directly.

### Anchor traps

Two anchors look obvious and are wrong:

- The viewport `<meta>` tag appears **twice** — the plan-preview webview has its
  own HTML template. Patching both would corrupt the plan preview. Anchor on the
  CSP line instead, which is unique to the chat webview.
- `img[src^="data:"]` in CSS is specificity `0,1,1` and would **beat**
  `.thumbIcon_*` at `0,1,0`, breaking the tool-result thumbnail pill. Styling is
  therefore applied inline on the element, not via `index.css`.

## Compatibility

Developed against `anthropic.claude-code` **2.1.234** (VSCode 1.133, Linux).
Anchors are minifier-name-independent except `A_LRR`/`A_CSP`, which reference
the minified vscode alias `Lt` and the CSP template variables `${p} ${f} ${m}
${u} ${g}`. Those may need re-deriving on other builds; `node patch.js apply`
will refuse loudly rather than corrupt anything.

## Status

| Stage | What | State |
|---|---|---|
| 1 | `data:` URIs render inline | **working, verified live** |
| 2 | relative paths → workspace files | code written, statically verified, **never applied live** |
| 3 | companion extension, auto-reapply | **not started** |

See [TODO.md](TODO.md).

## License

MIT
