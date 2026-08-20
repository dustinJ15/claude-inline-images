# Theming experiment — is an embedded `prefers-color-scheme` honoured?

Ticket: [02-theming-experiment-then-decision.md](tickets/02-theming-experiment-then-decision.md).
**This is the experiment, not the answer.** Nothing in `plot.py` has changed;
run the steps below in the real chat panel, record the outcome at the bottom,
and only then pick the feature the ticket describes.

## The question

A generated image cannot inherit the surrounding page's CSS. An SVG can carry
its own `@media (prefers-color-scheme: dark)` block, but a browser rendering an
SVG through `<img>` often resolves that query against a fixed default rather
than the host page's theme — the SVG is an independent document, and whether it
is told about the host's colour scheme is a renderer decision. VS Code webviews
add a second unknown, because the panel's `prefers-color-scheme` follows the
editor's colour theme rather than the OS. Both need to be tried; neither can be
argued from first principles.

## The probe

A 320x120 SVG. Its `<style>` says the word is `LIGHT` and the swatch is dark on
a white ground; the dark-scheme block flips both and swaps in the word `DARK`.
Every colour also has a presentation-attribute fallback, and the `DARK` text is
hidden only by CSS — so if the stylesheet is ignored altogether, both words
render on top of each other and the failure is visible rather than silently
looking like "light".

Paste this whole line into a chat message in the patched panel:

```
![theme probe](data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='320'%20height='120'%20viewBox='0%200%20320%20120'%20font-family='system-ui,sans-serif'%3E%3Cstyle%3E.bg{fill:%23ffffff}.fg{fill:%23111111}.d{display:none}@media%20%28prefers-color-scheme:dark%29{.bg{fill:%230d1117}.fg{fill:%23f0f3f8}.l{display:none}.d{display:inline}}%3C/style%3E%3Crect%20class='bg'%20width='320'%20height='120'%20fill='%23ffffff'/%3E%3Crect%20class='fg'%20x='16'%20y='16'%20width='40'%20height='88'%20fill='%23111111'/%3E%3Ctext%20class='fg%20l'%20x='190'%20y='76'%20font-size='46'%20text-anchor='middle'%20fill='%23111111'%3ELIGHT%3C/text%3E%3Ctext%20class='fg%20d'%20x='190'%20y='76'%20font-size='46'%20text-anchor='middle'%20fill='%23111111'%3EDARK%3C/text%3E%3C/svg%3E)
```

Source, for reference:

```xml
<svg xmlns='http://www.w3.org/2000/svg' width='320' height='120' viewBox='0 0 320 120' font-family='system-ui,sans-serif'><style>.bg{fill:#ffffff}.fg{fill:#111111}.d{display:none}@media (prefers-color-scheme:dark){.bg{fill:#0d1117}.fg{fill:#f0f3f8}.l{display:none}.d{display:inline}}</style><rect class='bg' width='320' height='120' fill='#ffffff'/><rect class='fg' x='16' y='16' width='40' height='88' fill='#111111'/><text class='fg l' x='190' y='76' font-size='46' text-anchor='middle' fill='#111111'>LIGHT</text><text class='fg d' x='190' y='76' font-size='46' text-anchor='middle' fill='#111111'>DARK</text></svg>
```

## Steps

1. `node patch.js apply` (or ask for it to be run — see CLAUDE.md on
   permissions), then `Ctrl+Shift+P` -> **Developer: Reload Webviews**.
   *Not* Reload Window: that restarts the extension host and kills the session.
2. Set a **dark** editor theme: `Ctrl+Shift+P` -> **Preferences: Color Theme**
   -> *Dark Modern* (or any dark theme). Paste the line above. Note the word.
3. Set a **light** editor theme the same way (*Light Modern*). Paste the line
   again in a **new** message — do not rely on the already-rendered image
   updating; a cached decode may not re-evaluate the query.
4. If step 3 shows no change, also flip the **OS** theme (Fedora: Settings ->
   Appearance -> Style) and repeat, to separate "follows the editor" from
   "follows the desktop" from "follows neither".

## Reading the result

| What both pastes show | Meaning | Consequence for the ticket |
|---|---|---|
| `DARK` on the dark theme, `LIGHT` on the light theme | the embedded query is honoured in this panel | take the media-query route: colours adapt with no flag, cost is one `<style>` block per plot — measure it against the reference set |
| `LIGHT` both times | the query resolves against a fixed light default | add an explicit option (`--theme dark\|light`), default unchanged |
| `DARK` both times | as above, fixed dark default | same: explicit option |
| the two words overlapping, or an all-black box | the `<style>` element is not applied at all | explicit option, and no CSS-based feature is worth trying |
| nothing, or raw markdown text | not a theming result: the patch is not active, or the URI got mangled (an unencoded space) — see CLAUDE.md | re-run the setup and retry |

Whichever way it goes, the ticket still requires the byte cost against the
reference set to be compared before and after
(`python3 test/test_plot.py --update-baseline` prints the sizes).

## Result

- Date: 2026-08-18
- VS Code version: 1.133.0 (`anthropic.claude-code` 2.1.234, patch v2)
- Dark theme showed: `LIGHT`, single clean word on a white ground
- Light theme showed: not tested — a dark editor already showing `LIGHT`
  settles the question, so step 3 was skipped deliberately
- OS theme flip changed anything (y/n): **not tested.** Left open on purpose;
  see below.
- Conclusion: **the embedded query is not honoured against the editor theme.**
  Row 2 of the table — explicit option, default unchanged.

The stylesheet itself was applied: a single word rendered, not two overlapping
ones, so the `<style>` block parsed and `.d{display:none}` took effect. The
media query simply evaluated false in a visibly dark editor. That rules out the
media-query feature regardless of anything else.

What is *not* settled is whether `prefers-color-scheme` resolves against a
hardcoded light default or against the OS appearance. The desktop was not
flipped, so "follows the desktop" and "follows neither" remain
indistinguishable from this one data point. It does not change the feature —
both land on the explicit option — but do not write either cause into the
README as fact. If a future session wants it, step 4 answers it in a minute.

Incidental, and worth more than the theming answer: this was the **first time
patch v2 was looked at in a real editor**, and the `data:` URI rendered. That
confirms v2 did not regress v1's behaviour. It says nothing about v2's
relative-path half, which is still spec 1's unrendered claim.
