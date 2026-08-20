# 07 — Uninstalling is a complete undo

**What to build:** an uninstall path that removes the patch by targeted string
removal, restoring the files exactly. It must not restore from a saved copy: any
such copy would have been taken while another extension's changes were present,
and writing it back would resurrect a stale version of someone else's patch.

**Blocked by:** 04.

**Status:** awaiting-user — built and tested; the KaTeX-still-working box needs both extensions on a real machine

- [x] Uninstalling removes the patch and leaves the files byte-identical to their unpatched state. (`test/extension.test.js` snapshots the fixture, patches, uninstalls, and compares both files byte for byte.)
- [x] Nothing is restored from a saved copy, and no such copy is created at any point. (The file listing of the install directory is identical before patching, after patching, and after uninstalling; a source-level assertion also fails the hook if it ever grows a copy/restore mechanism.)
- [ ] Uninstalling with the LaTeX extension also installed leaves that extension working. **Needs a real machine with both installed** — the static harness proves the removal is an exact string inverse, which is necessary but not the observation this box asks for.
- [x] Uninstalling when the patch was already absent does nothing and reports nothing alarming. (Returns `changed: false, reason: "not patched"`, writes nothing, throws nothing.)

## What was built

`extension/src/uninstall.js`, wired as `"vscode:uninstall": "node ./src/uninstall.js"`.

It runs in a plain node process with **no `vscode` API**, so it finds the
install the way the command line does — `patch.js listInstalls()` — and clears
**every** install found, not just the newest: an older versioned directory may
still be patched, and "no trace" means no trace anywhere. Removal is
`patch.remove(dir)`, the same targeted string removal the static harness already
asserts is byte-identical. Per-directory failures are reported, never thrown,
and the hook always exits 0 — a failed cleanup must not block the uninstall.
