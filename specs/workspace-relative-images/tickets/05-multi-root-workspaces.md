# 05 — Multi-root workspaces either work or are documented as unsupported

**What to build:** consistent behaviour when more than one folder is open. Today
only the first folder is published, so relative paths would resolve in one folder
and silently fail in another — the worst outcome, because it looks like a broken
patch rather than a limit.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Behaviour with two folders open is observed, not assumed.
- [ ] Either all open folders resolve, or the single-folder limit is stated in the README.
- [ ] If the limit stands, a path in a non-first folder fails in a way a reader can recognise as "unsupported" rather than "broken".
