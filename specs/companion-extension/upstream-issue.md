# Upstream issue — ready to paste

**Ticket:** [02 — File the upstream issue first](tickets/02-file-the-upstream-issue.md)
**Status: drafted, NOT posted.**

**Where to file:** <https://github.com/anthropics/claude-code/issues>
That is the tracker named by the extension's own manifest
(`package.json` → `"bugs": { "url": "https://github.com/anthropics/claude-code/issues" }`)
and by the project README ("Use the `/bug` command to report issues directly
within Claude Code, or file a GitHub issue"). The repo is issue-only; there is
no public source to send a PR against, so this must go in as an issue.

**Posting it is the user's action, not the agent's.** An agent must not open,
comment on, or otherwise interact with the tracker. Copy everything below the
rule into a new issue, adjust the environment line if yours differs, and post it
yourself. Then record the resulting issue URL back in this file and tick the
last checkbox on ticket 02.

Everything asserted below was verified on 2026-08-18 against the installed
bundle at
`~/.vscode/extensions/anthropic.claude-code-2.1.234-linux-x64/`.

---

## Title

Inline images in chat never render: the react-markdown call site passes no `urlTransform`, so `data:` image sources are blanked before the `img` component runs

## Environment

- Extension: `anthropic.claude-code` **2.1.234** (`linux-x64`)
- VS Code **1.133.0**
- Fedora 44, panel mode (`"claudeCode.preferredLocation": "panel"`)

## Summary

Every image in assistant markdown renders in the chat panel as the literal
placeholder text `[Image]`, including `data:image/*` URIs, which the extension
already appears to intend to support.

The cause is a single omitted prop. The chat panel's one `react-markdown` call
site does not pass `urlTransform`, so react-markdown applies its stock
`defaultUrlTransform`, whose scheme allowlist is
`/^(https?|ircs?|mailto|xmpp)$/i`. `data:` is not on that list, so the `src` is
replaced with `""` **before** the `components` map is invoked. The extension's
own `img` override then evaluates `"".startsWith("data:")` — false — and falls
through to the `[Image]` placeholder.

The feature looks intended: the CSP already permits `data:` images, and the
`img` override already contains a working `data:` branch. It is unreachable
because of one missing property.

## Reproduction

1. Install `anthropic.claude-code` 2.1.234 in VS Code 1.133.
2. Have the assistant emit any `data:` image in a chat message, e.g. a 1x1 SVG:

   ```markdown
   ![dot](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='40'%20height='40'%3E%3Ccircle%20cx='20'%20cy='20'%20r='16'%20fill='%2344f'/%3E%3C/svg%3E)
   ```

3. Look at the chat panel.

(Percent-encode fully — a literal space in a markdown link destination makes
CommonMark not produce an image node at all, which is a different failure that
shows up as raw text rather than as `[Image]`.)

**Expected:** the image renders inline.
**Actual:** the text `[Image]`, with the hover title `Image blocked: unknown`.

The `unknown` in that tooltip is itself a symptom: the tooltip is built from the
`src`, and the `src` has already been emptied by the time the component sees it.

## Evidence

All line references are offsets into the minified bundle; identifiers are the
minified names in this build.

**1. The call site passes no `urlTransform`.** In `webview/index.js`, the single
`react-markdown` render in the chat panel (there is exactly one — `,components:{`
occurs once in the whole 5MB bundle):

```js
b(QQ, {
  remarkPlugins: [XA],
  components: {
    a: …, pre: …, code: …,
    img: ({src: l, alt: c}) => {
      if (l?.startsWith("data:")) return b("img", {src: l, alt: c || ""});
      return b("span", {title: `Image blocked: ${l || "unknown"}`, children: "[Image]"})
    }
  },
  children: n
})
```

There is a working `data:` branch in that `img` override. It is dead code today.

**2. react-markdown blanks the URL before components run.** The bundled copy of
react-markdown (v9-era; the bundle carries the `#add-urltransform` migration
table entries for `transformImageUri`/`transformLinkUri`) resolves the transform
as:

```js
h = e.urlTransform || F5e
```

and `F5e` is `defaultUrlTransform`:

```js
Apt = /^(https?|ircs?|mailto|xmpp)$/i;

function F5e(e) {
  let t = e.indexOf(":"), i = e.indexOf("?"), n = e.indexOf("#"), o = e.indexOf("/");
  if (t === -1 || (o !== -1 && t > o) || (i !== -1 && t > i) || (n !== -1 && t > n) || Apt.test(e.slice(0, t)))
    return e;
  return ""
}
```

`data:` matches none of the escape hatches and is not in `Apt`, so the return
value is `""`. `hast-util-to-jsx-runtime` applies this transform to `src` while
building props, i.e. strictly before the `components.img` override is called.

**3. The CSP already allows exactly this.** From `extension.js`, in the chat
webview's HTML template — including the existing comment, which states the
security intent precisely:

```html
<!--
  Use a content security policy to only allow loading images from our extension directory or data URIs,
  and only allow scripts that have a specific nonce.
  Note: External https: URLs are blocked to prevent data exfiltration via markdown image URLs.
-->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${p}; ${f}; ${m}; script-src 'nonce-${u}'; ${g};">
```

where the `img-src` directive resolves to `img-src ${webview.cspSource} data:`.

So: the policy permits `data:` images, the renderer has a branch for them, and
the only thing standing in the way is that react-markdown's default allowlist
does not include `data:` and no override is supplied.

**4. The same extension already renders `data:` images elsewhere.** Tool-result
attachments render as real `<img src="data:…">` elements in this same webview
today (styled down to a small thumbnail). The webview is fully capable of
displaying them; only the markdown path is blocked.

## Suggested fix

Pass a **narrow** `urlTransform` at that one call site — one that permits
`data:image/*` and otherwise reproduces `defaultUrlTransform` exactly:

```js
urlTransform: (url) => {
  if (typeof url !== "string") return url;
  if (/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(url)) return url;
  // otherwise: react-markdown's defaultUrlTransform, unchanged
  const colon = url.indexOf(":");
  const questionOrHashOrSlash = url.search(/[?#\/]/);
  if (colon < 0 || (questionOrHashOrSlash > -1 && colon > questionOrHashOrSlash)) return url;
  return /^(https?|ircs?|mailto|xmpp):$/i.test(url.slice(0, colon + 1)) ? url : "";
}
```

### Please do not use `urlTransform: (url) => url`

Identity would be the shorter fix and it would be a security regression. The
comment quoted above says why: model output is attacker-influenceable (prompt
injection through a fetched page, a repo file, a tool result), and an `<img>`
element is an unconditional GET with an attacker-chosen URL — a working
exfiltration channel for anything the model can put into a path. The
`https:`-blocking behaviour is deliberate and should stay exactly as it is.

The transform above keeps that property:

- `https:`/`http:` pass the transform exactly as they do today, and are then
  still rejected by the `img` override and by the CSP. Behaviour is unchanged.
- `data:text/html`, `javascript:`, `vbscript:`, `blob:`, `file:` are still
  blanked. Only `data:` URIs whose media type is a known raster or SVG image
  type are added.
- `data:image/svg+xml` deserves a moment's thought, since SVG can carry script.
  It is safe here specifically because the CSP is `default-src 'none'` with a
  nonce-based `script-src`, and because an SVG loaded through `<img>` is a
  replaced element: it cannot execute script or issue network requests in any
  current browser engine. If you would rather not rely on that, dropping
  `svg\+xml` from the pattern still fixes the raster case.

A `rehype`-based approach would also work, but is more machinery than the
problem needs, and `urlTransform` is the documented hook for exactly this.

I have applied the change above locally (as an external patch to the installed
bundle) and confirmed that `data:image/*` markdown images render inline in the
chat panel, with no change to any other behaviour and no CSP change required.

## Why this seems worth fixing

It makes the assistant able to *show* things — plots, diagrams, small
renderings it generated itself — rather than describing them in prose. The
capability is one property away from working, and the presence of the unused
`data:` branch suggests it was meant to.

## Related

- anthropics/claude-code#54546 — inline images in the **terminal** UI. Different
  surface and a different mechanism (that one is about terminal image
  protocols, not about a webview markdown pipeline), but the same underlying
  want, so linking the two may be useful for prioritisation.
