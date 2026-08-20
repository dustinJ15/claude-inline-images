#!/usr/bin/env node
'use strict';
// Installs the canonical `inline-plots` skill into the user's Claude Code
// config so images work in every repo, not just this one.
//
//   node install-skill.js            # install/update ~/.claude/skills/inline-plots
//   node install-skill.js --status   # report without writing
//   node install-skill.js --remove   # uninstall
//
// Re-running updates the installed copy in place; it never creates a second
// divergent copy. Target overrides, highest precedence first:
//   --target <dir>   CLAUDE_SKILLS_DIR   CLAUDE_CONFIG_DIR/skills   ~/.claude/skills
//
// NOTE FOR AGENTS: do not run this. Writes into ~/.claude/** are refused by the
// permission classifier. Ask the user to run it.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SKILL = 'inline-plots';
const SRC_DIR = path.join(__dirname, 'skill', SKILL);
// [source file, name in the installed skill directory]
const FILES = [
  [path.join(SRC_DIR, 'SKILL.md'), 'SKILL.md'],
  [path.join(__dirname, 'plot.py'), 'plot.py'],
];

function skillsDir(argv) {
  const i = argv.indexOf('--target');
  if (i !== -1) {
    if (!argv[i + 1]) throw new Error('--target needs a directory');
    return path.resolve(argv[i + 1]);
  }
  if (process.env.CLAUDE_SKILLS_DIR) return path.resolve(process.env.CLAUDE_SKILLS_DIR);
  if (process.env.CLAUDE_CONFIG_DIR) return path.resolve(process.env.CLAUDE_CONFIG_DIR, 'skills');
  return path.join(os.homedir(), '.claude', 'skills');
}

function plan(dest) {
  return FILES.map(([src, name]) => {
    if (!fs.existsSync(src)) throw new Error(`missing source file: ${src}`);
    const want = fs.readFileSync(src);
    const to = path.join(dest, name);
    const have = fs.existsSync(to) ? fs.readFileSync(to) : null;
    const state = have === null ? 'new' : have.equals(want) ? 'current' : 'stale';
    return { src, to, want, state };
  });
}

function install(dest) {
  const items = plan(dest);            // validate every source before writing
  fs.mkdirSync(dest, { recursive: true });
  let changed = 0;
  for (const it of items) {
    if (it.state === 'current') continue;
    const tmp = `${it.to}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, it.want);
    fs.renameSync(tmp, it.to);         // atomic, so an update never half-lands
    changed++;
  }
  return { dest, items, changed };
}

function status(dest) {
  return { dest, items: plan(dest) };
}

function remove(dest) {
  let removed = 0;
  for (const [, name] of FILES) {
    const to = path.join(dest, name);
    if (fs.existsSync(to)) { fs.unlinkSync(to); removed++; }
  }
  if (fs.existsSync(dest) && fs.readdirSync(dest).length === 0) fs.rmdirSync(dest);
  return { dest, removed };
}

function main(argv) {
  const dest = path.join(skillsDir(argv), SKILL);
  if (argv.includes('--status')) {
    const r = status(dest);
    console.log(`skill dir: ${r.dest}`);
    for (const it of r.items) console.log(`  ${path.basename(it.to).padEnd(9)} ${it.state}`);
    const ok = r.items.every((i) => i.state === 'current');
    console.log(ok ? 'installed and up to date' : 'not up to date — run: node install-skill.js');
    return ok ? 0 : 1;
  }
  if (argv.includes('--remove')) {
    const r = remove(dest);
    console.log(`removed ${r.removed} file(s) from ${r.dest}`);
    return 0;
  }
  const r = install(dest);
  console.log(`skill dir: ${r.dest}`);
  console.log(r.changed === 0 ? 'already up to date' : `updated ${r.changed} file(s)`);
  console.log('Start a new Claude Code session to pick it up.');
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`install-skill: ${e.message}`);
    process.exit(2);
  }
}

module.exports = { SKILL, SRC_DIR, FILES, skillsDir, plan, install, status, remove };
