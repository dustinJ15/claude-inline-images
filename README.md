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
node test/verify.js      # 56 assertions; do this first
node doctor.js           # or afterwards: is the whole setup actually healthy?
node patch.js apply
```

Then in VSCode: `Ctrl+Shift+P` → **Developer: Reload Webviews**.

*Reload Webviews*, not *Reload Window* — the latter restarts the extension host
and kills any running Claude Code session.

One exception, and it is the reason stage 2 below is still unverified: the patch
also edits `extension.js`, which the extension host evaluates **at startup**. A
webview reload does not re-read it, so the relative-path half of the patch stays
dormant until a **Developer: Reload Window** or a VS Code restart. Inline
`data:` images work after a webview reload; workspace-relative paths need the
full reload.

To have the assistant actually *use* this in other repos, also install the skill
— see [The skill](#the-skill--what-makes-this-work-in-other-repos):

```bash
node install-skill.js
```

```bash
node patch.js status     # what's applied
node patch.js remove     # exact inverse, byte-identical
node patch.js list       # which installs were found, and which one is selected
```

### Applying a specific version

`apply` takes an optional version, so a failed experiment rolls back to a
known-good patch rather than only to unpatched:

```bash
node patch.js apply      # the version this repo ships (v2)
node patch.js apply 1    # or `apply v1` — pin the older data:-URI-only patch
```

Whatever version is already present is lifted first, so exactly one edit set is
ever applied — never two overlapping ones. `status` reports `patchedVersions`
(what is on disk), `current` (whether that includes the shipped version), and
`knownVersions`. After `node patch.js apply 1` on a repo shipping v2, `status`
reads `"patchedVersions": ["1"], "current": false` — that is the expected shape
of a deliberate downgrade, not a broken install.

### How it finds your install

`patch.js` is a standalone file patcher — it does not run inside VSCode and is
not itself an extension. It resolves the target in this order:

1. `--ext-dir <path>`
2. `CLAUDE_CODE_EXT_DIR`
3. **`CLAUDE_CODE_EXECPATH`** — set whenever the patcher is run from inside
   Claude Code itself, and points at the exact install that is running, so no
   guessing is involved. This is the most reliable route and needs no config.
4. A scan of every known extension root, newest version winning:
   `~/.vscode`, `~/.vscode-insiders`, `~/.vscode-oss` (VSCodium),
   `~/.vscode-server` (Remote SSH / WSL / devcontainers), and the Flatpak path.
   `$VSCODE_EXTENSIONS` is honoured for `--extensions-dir` and portable installs.

Entries listed in the extension root's `.obsolete` file are skipped, and a
candidate must actually contain `webview/index.js` to be considered.

Run `node patch.js list` to see exactly what was found and picked.

### It does not survive Claude Code updates

Each update installs into a **new versioned directory**, so the patch is gone
and images silently revert to `[Image]`. Re-run `node patch.js apply`.

The companion extension under [extension/](extension/) exists to automate exactly
this — it re-applies on startup whenever the version stamp is absent, and removes
itself cleanly via a `vscode:uninstall` hook. Both loss-and-recovery scenarios (a
version bump, and KaTeX restoring its own backup over the shared file) are
simulated headlessly, 62 assertions.

Simulating the second one found a real defect: a KaTeX re-patch leaves the tree
**half** patched — `webview/index.js` pristine, our `extension.js` edits intact —
which `patch.js` reports as unpatched while refusing to re-apply over the four
surviving anchors. The extension now lifts partial versions before patching.
It **loads in a real editor** as of 2026-08-20 — installed by symlinking
`extension/` into `~/.vscode/extensions/`, after which its status command
reported the live install's patch state correctly. What has not been exercised
live is the repair itself: that needs an install actually missing the patch. See
[TODO.md](TODO.md).

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

# polar: r as a function of t, over --trange (default 0 2pi)
python3 plot.py --polar "1" -t "unit circle"
python3 plot.py --polar "t" --trange 0 18.85 -t "Archimedean spiral"

# parametric: x(t) and y(t) — may cross itself, nothing assumes one y per x
python3 plot.py --param "cos(t)" "sin(t)*cos(t)" -t "lemniscate"
python3 plot.py --param "sin(3*t)" "sin(2*t)" -t "Lissajous 3:2"

# vectors: 'X,Y' from the origin, 'TX,TY->HX,HY' from any tail, ':label' on either
python3 plot.py --vec "2,1:u" --vec "2,1->3,3:v" --vec "3,3:u+v" -t "u + v"
python3 plot.py --param "cos(t)" "sin(t)" --param "2*cos(t)+sin(t)" "cos(t)+2*sin(t)" \
    --vec="3,3:3v1" --vec="-1,1:v2" -t "unit circle under A=[[2,1],[1,2]]"

# Riemann rectangles under the first --expr; left, right or midpoint heights
python3 plot.py -e "sin(x)" -x 0 6.283 --riemann 12 --riemann-at mid
python3 plot.py -e "x**2" -x -1 3 --riemann 8 --riemann-at left --riemann-range 0 2

# declared discontinuities (exact) and the fallback heuristic's threshold
python3 plot.py -e "tan(x)" -x -4.5 4.5 --break-at -1.5708 --break-at 1.5708
python3 plot.py -e "sin(x)" -e "1/x" --break-at "1:0"     # only the 2nd curve
python3 plot.py -e "tanh(50*x)" -x -1 1 -y -1.2 1.2 --jump-frac 0.85

# palette: auto (default) reads on either background; dark and light are explicit
python3 plot.py -e "sin(x)" --theme light -t "on a light background"

# sampling density, and a plot that explains itself
python3 plot.py -e "sin(50*x)" --samples 4000
python3 plot.py -e "sin(x)" --xlabel "t (s)" --ylabel "amplitude" \
    --annotate 1.5708 1 "first peak"
python3 plot.py --points "1,1:start 3,0.33:tail"          # inline annotation
```

Stdlib only, no matplotlib. Prints a ready-to-paste `![alt](data:…)` line and
reports its token cost on stderr. Handles multiple curves, shaded regions
between curves, asymptote-aware segmenting, scatter overlays, polar and
parametric paths, Riemann rectangles, and vectors.

Polar, parametric and vector plots pick both ranges themselves and equalise the
units per pixel on the two axes, so `--polar "1"` is a circle rather than an
ellipse and a 45-degree vector comes out at 45 degrees; passing both `-x` and
`-y` explicitly overrides that. `--samples N` (default 400)
controls the sampling density before simplification — raise it for a curve with
fine structure, such as `sin(50*x)`, which 400 samples alias away; RDP still
simplifies afterwards, so 10x the samples is well under 2x the bytes.

**Vectors.** `--vec` takes `X,Y` for an arrow from the origin or
`TX,TY->HX,HY` for one from an arbitrary tail — that second form is what makes
tip-to-tail addition drawable — with an optional `:label` on either, in the
vector's own colour. It is repeatable, and a vector takes the next series
colour after the curves, so it is never confused with one. Equalised axes are
not decoration here: on unequal units per pixel a vector diagram states a false
angle and a false relative length, so `--vec` opts into the same equalisation
as `--polar`/`--param` unless `-x` and `-y` say otherwise. Arrowheads shrink
with a short vector down to a floor and no further, so a small vector still
looks like an arrow. One argparse edge: write `--vec=-3,2`, since a bare
`-3,2` is read as a flag.

A vector costs about **39B of URI each** (161B for the first one, which carries
the shared styling) and **+116B** for a label. Same lever as the rectangles:
each vector is two subpaths — shaft, then arrowhead — inside one `<path>`
inside a `<g>` per colour. The obvious form, a fully attributed `<line>` plus
`<polygon>` per vector, measured **193B each**; a relative-coordinate variant
measured 37B and was not kept, because 2B a vector is not worth a `d`
attribute the tests cannot read back.

Riemann rectangles cost about **17B of URI per rectangle** — they are subpaths
of a single `<path>` inside a `<g>` that carries the fill and stroke once, so a
hundred of them cost their coordinates and one copy of the styling.

**Discontinuities.** `--break-at X` declares one, exactly: the path is cut
between the samples straddling `X`, whatever the values there do, and each side
is simplified separately so nothing can bridge it afterwards. `--break-at I:X`
scopes the break to expression `I` (0-based). Undeclared, a heuristic breaks the
path wherever consecutive samples differ by more than `--jump-frac` of the
y-range (default `0.5`, the previously hardcoded value; `0` disables it). That
heuristic sees a jump and nothing else: it cannot tell a pole from a merely
steep curve, misses any step smaller than the threshold, and changes its mind
when `--samples` changes. Raise `--jump-frac` when a steep curve is being cut in
half; use `--break-at` when you know where the function actually breaks.

**Theming.** `--theme auto|dark|light`. `auto` is the default and is a
deliberate compromise — mid-tone grays legible on either background — because
an image cannot know what it is sitting on. It cannot detect it either: an SVG
carrying its own `@media (prefers-color-scheme: dark)` block was pasted into
the patched panel under a dark editor theme and the query evaluated false, so
there is no automatic route. The write-up, including what that probe did *not*
establish, is in
[specs/plot-py/theming-experiment.md](specs/plot-py/theming-experiment.md).
Every colour in every palette is a 7-character hex literal, so choosing a theme
costs exactly zero bytes; a test asserts each theme reproduces the recorded
baseline size. The `dark` and `light` palettes are reasoned rather than
verified — nobody has yet looked at one against its intended background.

**Making a plot self-contained.** `--xlabel` and `--ylabel` take their room out
of the padding (the y label is a rotated `<text>` left of the tick values), so
the plot area shrinks rather than anything overlapping — and a plot with neither
is byte-for-byte what it was before the feature existed. Points carry text
either as `--points "1,1:start"` (no spaces) or `--annotate X Y "text"` (spaces
fine, repeatable). Labels too long to fit are truncated with an ASCII `...`
rather than running off the image; annotations are capped at half the image
width and clamped to stay on it. Roughly 100B for an x label, 140B for the
rotated y label, ~180B for the first annotated point (its marker, the shared
`<g>` and the text) and ~105B for each one after — and nothing at all when
unused.

Title, legend, label and annotation text is XML-escaped, so `-t "a & b"` renders
instead of silently producing a document the panel refuses to draw. A
zero-width `-x`/`-y` range exits 2 with a message rather than a traceback.

#### Testing plot.py

```bash
python3 test/test_plot.py                  # 161 tests, stdlib unittest, no deps
python3 -m unittest discover -s test       # same suite
python3 test/test_plot.py --update-baseline
```

The tests assert *properties* — the SVG parses, drawn paths stay inside the plot
area, one colour per requested curve, a pole is a break and not a bridging line —
never exact bytes, because exact bytes move whenever a size lever is tuned.

Bytes are checked in one place: `test/plot_size_baseline.json` records the data-URI
size of fourteen reference plots (several curves, a shaded region, an asymptote,
a scatter overlay, a polar circle and spiral, a self-crossing parametric path, a
midpoint Riemann sum, a declared break, a labelled and annotated plot), and the
suite fails if any of them grows more than 2% + 8B
past the recorded number. The eight original plots are additionally pinned to
their exact recorded size, so a new mode cannot quietly move an old one. Regenerating that file is the explicit
`--update-baseline` command above; do it only when a size change is intended.

Current baseline: 1980–4371B per plot, 37282B for the set.

## The skill — what makes this work in *other* repos

Patching the panel makes images *possible*. It does not make them *happen*: a
fresh Claude Code session in an unrelated repo has no idea the panel can render
a picture, so it describes the curve in prose instead of drawing it.

`skill/inline-plots/` fixes that. It is a user-level Claude Code skill —
installed once, discovered automatically in every project. Only its name and
description are loaded per session; the body loads when the assistant decides a
picture is the right answer. It teaches exactly three things: how to emit an
image with `plot.py`, the percent-encoding rule, and how to read the panel's
three possible outcomes. It deliberately says nothing about how the patch works,
and points back here for that.

### Install it

```bash
node install-skill.js          # copies into ~/.claude/skills/inline-plots/
node install-skill.js --status # is the installed copy current?
node install-skill.js --remove # uninstall
```

Then start a new session — skills are picked up at session start.

It copies `SKILL.md` **and** `plot.py`, so the skill works in repos that have no
checkout of this project. Re-running it updates the installed copy in place
(atomically, per file); it never leaves a second divergent copy. Target
overrides, in precedence order: `--target <dir>`, `CLAUDE_SKILLS_DIR`,
`$CLAUDE_CONFIG_DIR/skills`, `~/.claude/skills`.

> **This may or may not be yours to run.** Writes into `~/.claude/**` are often
> refused by the permission classifier, and an agent that gets denied should ask
> you to run the command rather than look for a way around the denial. But the
> refusal is a property of the session's permission mode, not of the path — an
> agent in a permissive session can run it, and one did on 2026-08-19.
>
> Either way, `--status` is what settles whether the installed copy is current.
> `SKILL.md` and `plot.py` are versioned separately, so one can go stale while
> the other stays current; "the skill is installed" does not mean "the skill is
> up to date".

`node test/skill.js` statically checks the skill (frontmatter, token budget, the
encoding rule, the diagnostic table, no patch internals) and the installer's
idempotence, against a temp directory. Whether the skill actually *fires* can
only be judged in a fresh session in an unrelated repo.

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
| 3 | companion extension, auto-reapply | **loads and reports correctly in a real editor** (2026-08-20); auto-repair simulated only |

See [TODO.md](TODO.md), and [HANDOFF.md](HANDOFF.md) if you are picking this up fresh.

## License

MIT
