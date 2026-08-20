# 08 — Package it, and be candid about what it does

**What to build:** a distributable artefact in whichever form ticket 01 settled
on, with documentation that states up front that this modifies another
extension's files on disk and can undo that completely.

**Blocked by:** 01, 05, 06, 07.

**Status:** blocked — and out of scope for now. The user has descoped marketplace
publication (2026-08-18); the goal is a clean GitHub repo, not a store listing.
If a `.vsix` is ever wanted it ships as a GitHub release. The manifest
completeness and candid-README points below are still worth doing as repo
quality — just not as store preparation. See HANDOFF.md §1.

- [ ] Manifest is complete: display name, description, categories, repository, issue tracker, icon, licence, editor version range.
- [ ] The package contains only what it needs; its contents are inspected rather than assumed.
- [ ] A changelog exists, and the README reads correctly in whichever place it will actually be displayed — the current one is written for a source host.
- [ ] The description says plainly, before installation, that another extension's files are modified, and how to fully undo it.
- [ ] Automated checks run the static harness on a machine with no Claude Code install present.
- [ ] Scratch-install tests cover patch, assert changed, remove, assert restored.
