# 04 — Rewrite the emit guidance once relative paths land

**What to build:** an update to the skill for the cheaper referencing form. While
images are inlined, the skill teaches producing a compact encoded URI. Once
images can be referenced by short relative path, that becomes the recommended
form, the cost drops by roughly two orders of magnitude, and the encoding trap
demotes from headline to footnote.

**Blocked by:** the workspace-relative-images spec landing live. Do not start on
the strength of that work being written — only on it being confirmed rendering.

**Status:** blocked

- [ ] The skill recommends one form as the default, not two as equally good.
- [ ] The encoding rule survives in reduced form, since inline URIs remain valid for images with no file on disk.
- [ ] Guidance on where to write image files matches whatever access decision that spec settled on.
- [ ] Re-tested in a fresh session per ticket 03 — a rewrite can break the trigger.
- [ ] The stated cost figure matches the measured one, not the estimate.
