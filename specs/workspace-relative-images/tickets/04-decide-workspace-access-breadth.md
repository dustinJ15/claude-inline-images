# 04 — Decide, and document, how much of the workspace the panel may read

**What to build:** an explicit, written decision on the access this feature
grants. Allowing the panel to load any file under the workspace as an image is a
real if minor widening of what a prompt-injected assistant message could cause
to be fetched, since model output is attacker-influenceable. The decision may be
"accept it" — what is unacceptable is leaving it unstated.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] The choice is made and recorded: whole workspace, or a named subdirectory.
- [ ] If scoped to a subdirectory, a path outside it is confirmed to be refused, not merely expected to be.
- [ ] The security section of the README states the resulting access in plain terms, at the same level of candour as the existing explanation of why external URLs stay blocked.
- [ ] The static harness asserts the boundary, so a later change cannot widen it silently.
