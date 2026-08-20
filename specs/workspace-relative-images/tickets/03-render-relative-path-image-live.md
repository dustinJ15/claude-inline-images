# 03 — A relative-path image renders in the panel, with nothing else broken

**What to build:** the feature itself, confirmed by a human looking at the panel:
an assistant message referencing an image by short relative path draws that
image. Existing behaviour that shares the same call site survives unchanged.

Static tests cannot close this ticket. They prove the bundle parses and the
strings are right; only a person looking at the panel can confirm it draws.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] A real image file in the workspace, referenced by relative path in an assistant message, is confirmed drawn by the user.
- [ ] A `data:` URI image still draws in the same message — the previously working path is not traded away for the new one.
- [ ] In that same message: math still typesets (the LaTeX extension patches this exact call site and must keep working), and reading a PNG still shows its normal small thumbnail rather than a full-width image.
- [ ] Any "raw markdown text" result is diagnosed as a malformed URI — almost always an unencoded space — and not reported as a patch failure.
- [ ] If the feature cannot be landed in this session, the install is returned to the last known-good version before the session ends.
