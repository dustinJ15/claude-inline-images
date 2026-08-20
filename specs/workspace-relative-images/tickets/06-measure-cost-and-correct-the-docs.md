# 06 — Measure the real per-image cost and make the docs match reality

**What to build:** the honest number, and a status table that reflects what has
actually been verified. The whole justification for this spec is cost, and the
README currently carries an estimate for the old approach and a status table
listing this feature as never rendered.

**Blocked by:** 03, 04, 05.

**Status:** ready-for-agent

- [ ] The per-image token cost of a relative-path reference is measured, not estimated, and compared against the inline-URI cost for the same image.
- [ ] The README quotes the measured figure.
- [ ] The status table moves this feature to verified-live, and the distinction between "verified live" and "only statically checked" is preserved for everything else — it is the most useful line in the docs for the next reader.
- [ ] The handoff and backlog documents no longer describe this work as outstanding.
