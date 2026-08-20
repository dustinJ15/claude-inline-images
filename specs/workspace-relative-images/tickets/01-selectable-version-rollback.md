# 01 — Make rolling back to the previous version possible

**What to build:** a way to put the live install back on the last known-good
patch version, not merely to unpatch it. The handoff notes promise "remove, then
re-apply v1" as the safety net for a failed experiment, but the CLI only ever
applies the version the repo currently ships — so today the only rollback is to
no images at all. Every later ticket in this spec assumes this net exists.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The CLI can apply a named version, not just the newest one. `node patch.js apply 1` / `apply v1`; `apply` with no argument still applies the shipped version. An unknown version throws before any file is touched.
- [x] `status` stays accurate after a targeted downgrade — asserted: after `apply 1` on a repo shipping v2 it reports `patchedVersions: ["1"], current: false`. It also now reports `latestVersion` and `knownVersions`.
- [x] Applying a version when a different one is present lifts the old one first — asserted for v1→v2 and v2→v1, including that the v2 `extension.js` edits are fully lifted on downgrade.
- [x] The static harness asserts apply/parse/status/remove per version independently against a synthetic fixture in a temp dir, plus byte-identical restoration after each. The pre-existing live-copy round trip is unchanged. 48 assertions green.
- [ ] Exercised for real on the live install: downgrade to the previous version, confirm images still render, return to the current one. **Not done — deliberately.** Agents are blocked from writing into `~/.vscode/extensions/**`, and this ticket was scoped to not touch the live install (still v1, untouched). The user must run this leg: `node patch.js apply` → *Developer: Reload Webviews* → check an image → `node patch.js apply 1` → reload → check again.

## Outcome

`apply()` gained a second parameter: `apply(extDir, version)`. Both arguments are
optional; `version` accepts `'1'`, `'v1'`, or undefined (meaning the shipped
`VERSION`). The result object now always carries `version` — the version that
ended up applied — alongside the existing `changed` / `reason` / `extDir`.

New exports: `normalizeVersion(version)` and `ALL_VERSIONS`.

The live-install leg above is the only thing left, and it needs a human at the
panel; everything mechanical is asserted.
