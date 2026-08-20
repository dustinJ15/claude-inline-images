# 02 — File the upstream issue first

**What to build:** an issue against Claude Code describing the missing property
that blocks these images, and the unused handling branch that suggests the
feature was intended to work. This is plausibly the highest-value action in the
whole project: if it is fixed upstream, this spec and the relative-path spec
both become unnecessary.

It is deliberately sequenced ahead of the extension, because the extension is
weeks of work to permanently maintain a workaround for a one-line omission.

**Blocked by:** None — can start immediately, in parallel with everything else.

**Status:** awaiting-user

**Draft:** [../upstream-issue.md](../upstream-issue.md) — ready to paste.
**Only the user can post it.** An agent must not open or comment on the tracker.

- [x] The issue explains the mechanism precisely enough to be actionable: the property is absent, so the source is blanked before the handling code ever runs.
- [x] It notes that the policy already permits these images and that a handling branch already exists — the feature is written, permitted, and unreachable.
- [x] It references the related terminal-interface issue as context, while being clear that this is a different surface.
- [x] It does not propose relaxing the deliberate block on external image URLs, which exists to prevent exfiltration through markdown image links.
- [ ] The issue link is recorded in the repo. **(blocked on the user posting it)**

**State:** the draft is complete and every technical claim in it was verified on
2026-08-18 against the installed bundle at
`~/.vscode/extensions/anthropic.claude-code-2.1.234-linux-x64/` — the single
`,components:{` call site with no `urlTransform`, react-markdown's
`defaultUrlTransform` allowlist `/^(https?|ircs?|mailto|xmpp)$/i`, the CSP
directive `img-src ${e.cspSource} data:`, the unused `data:` branch in the `img`
override, and the tool-result path that already renders `<img src="data:…">`.

Post it at <https://github.com/anthropics/claude-code/issues> — the tracker
named by the extension's own `package.json` `bugs.url`. Then paste the issue URL
here and tick the box above.
