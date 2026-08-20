# 03 — Collapse to one copy of the patch logic

**What to build:** removal of the stale duplicate of the patcher that lives in
the agent configuration directory. It is a second, older copy of the edit table
— exactly the divergence the single-source-of-truth decision exists to prevent,
already having happened. Doing this before the extension is built means the
extension has only one thing it can possibly call.

Writes into that directory are refused for agents by the permission classifier,
so this is a step for the user to run.

**Blocked by:** None — can start immediately.

**Status:** done — the user ran the deletion on 2026-08-18; verified gone

- [x] The duplicate is gone, or replaced by a link to the copy in this repo.
- [x] Nothing on the machine still invokes the removed copy.
- [x] The repo documents that the copy here is the only one, so a future convenience copy is recognisably a mistake.

## Findings (2026-08-18)

The duplicate exists and is stale, exactly as the spec predicted:

```
/home/dustin/.claude/inline-images/patch.js    8675 bytes, VERSION = '1'
```

The repo copy is at v2, so the two edit tables have already diverged. Nothing on
the machine references it: a search of `~/.claude/settings.json`, `~/.claude/skills`,
`~/.claude/plugins` and this repo found no invocation — the only hits for the
path are in session transcripts, which are history, not callers.

**Run this to close the ticket** (agents are refused writes under `~/.claude`):

```bash
rm -rf ~/.claude/inline-images
```

Then confirm it is gone and that the repo copy still works:

```bash
ls ~/.claude/inline-images 2>&1        # expect: No such file or directory
node ~/projects/claude-inline-images/patch.js status
```

## Closed — 2026-08-18

The user ran `rm -rf ~/.claude/inline-images`. Verified: the path no longer
exists, and `node -e "require('./patch.js')"` in this repo still resolves. One
edit table on the machine, which is the point.
