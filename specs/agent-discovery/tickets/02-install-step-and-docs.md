# 02 — Installing the skill is a documented, user-run step

**What to build:** a way for a user to get the skill from this repo into their
agent configuration, and documentation that sets the expectation correctly —
including that an agent cannot do this step itself, because writes into the
agent configuration directory are refused by the permission classifier.

**Blocked by:** 01.

**Status:** done

- [x] There is a single documented action a user runs to install the skill.
- [x] Re-running it after the repo's copy changes updates the installed one rather than producing a second, divergent copy.
- [x] The README explains what the skill does and that it is what makes images happen in other repos — a reader should not have to infer the connection.
- [x] The documentation states plainly that this step is the user's to run, so an agent does not attempt it, get denied, and then look for a way around the denial.

**Built:** `node install-skill.js` — a single idempotent, atomic, per-file copy
into `~/.claude/skills/inline-plots/` (`--status`, `--remove`, and a `--target`
/ `CLAUDE_SKILLS_DIR` / `CLAUDE_CONFIG_DIR` override used by the tests). It
copies `plot.py` alongside `SKILL.md` so the skill is self-contained in repos
with no checkout of this project. README gained a "The skill — what makes this
work in *other* repos" section, a pointer from the Install section, and an
explicit callout that an agent cannot run this step because writes into
`~/.claude/**` are refused by the permission classifier. Idempotence and
update-in-place are covered by `node test/skill.js`.

Ticket 03 (does it fire unprompted?) needs a fresh session in an unrelated repo
and is deliberately left untouched here.
