---
name: inline-plots
description: Draw the picture instead of describing it. Use whenever the answer is a shape rather than a sentence — plotting or graphing a function, visualising or sketching a curve, showing how a value varies, comparing two functions, drawing vectors or a linear combination in the plane, or displaying a small dataset the user would rather see than read. Also use when a plot you emitted failed to appear and you need to tell working from broken.
---

# Inline plots

This chat panel renders `data:image/*` markdown images inline. Show the picture rather than describing it.

## Emit an image

`plot.py` ships next to this file. It prints a ready-to-paste `![alt](data:...)` line (~550-840 tokens per plot):

```bash
P=~/.claude/skills/inline-plots/plot.py
python3 $P -e "sin(x)" -e "cos(x)" -x -6.3 6.3 -t "sin and cos"
python3 $P --vec "2,1:u" --vec "2,1->3,3:v" --vec "3,3:u+v" -t "u+v"
python3 $P --help   # fills, scatter, parametric, polar
```

Paste its output line into your reply verbatim. Hand-written SVG also works, as `![alt](data:image/svg+xml,<percent-encoded svg>)` — keep it small, every byte is a token you retype.

`--vec "X,Y:label"` draws from the origin, `--vec "TX,TY->HX,HY:label"` from any tail — that second form is tip-to-tail addition. Repeatable; axes are equalised so angles and lengths are true. A leading minus needs `--vec=-3,2`, since a bare `-3,2` is read as a flag. 2D only — curves, parametric paths, scatter, arrows: no planes, no 3D, no matrix or basis-grid rendering; say so rather than faking one.

## RULE: percent-encode the URI completely

**A literal space in a markdown link destination stops CommonMark emitting an image node at all** — not a broken image, no image: raw text on screen. Encode space `%20`, `<` `%3C`, `>` `%3E`, `#` `%23`; use single quotes inside SVG. `plot.py` handles this.

## Diagnose what the user sees

| Shown | Meaning | Do |
|---|---|---|
| the image | working | nothing |
| `[Image]` | markdown parsed; the panel patch is inactive | ask the user to run `node patch.js apply` in their `claude-inline-images` checkout, then `Ctrl+Shift+P` → **Developer: Reload Webviews** (not Reload Window — it kills the session) |
| raw markdown text | **your URI is malformed**, nearly always an unencoded space | fix the encoding, re-emit; do not ask for a re-patch |

## Not your job

How the patch works is out of scope. Never open or grep the VSCode extension bundle — it is 5MB of minified JS and reading it ends the session's usefulness. Send the user to the `claude-inline-images` repo instead.
