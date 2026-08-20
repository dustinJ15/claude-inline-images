#!/usr/bin/env node
'use strict';
// Static checks for the inline-plots skill and its installer.
// Behavioural discovery (does it fire unprompted in a fresh session?) cannot be
// automated — see specs/agent-discovery/tickets/03.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const inst = require('../install-skill.js');
const src = fs.readFileSync(path.join(inst.SRC_DIR, 'SKILL.md'), 'utf8');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

// --- the skill file ---------------------------------------------------------
const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(src);
ok('parses as a skill: frontmatter then body', () => assert(m, 'no YAML frontmatter'));
const fm = m[1];
const body = m[2].trim();

ok('frontmatter has name: inline-plots', () => assert(/^name:\s*inline-plots\s*$/m.test(fm)));
const desc = /^description:\s*(.+)$/m.exec(fm);
ok('frontmatter has a description', () => assert(desc && desc[1].trim().length > 40));

ok('description is written for recall, not for the tool name', () => {
  const d = desc[1].toLowerCase();
  for (const w of ['plot', 'graph', 'visualis', 'sketch', 'curve'])
    assert(d.includes(w), `description misses trigger word: ${w}`);
});

ok('description reaches linear-algebra phrasing too', () => {
  assert(/vector/i.test(desc[1]), 'description misses trigger word: vector');
});

// Budget: "a few hundred tokens", pass/fail. No tokenizer dependency, so use a
// deliberately conservative chars-per-token estimate.
const estTokens = Math.round(body.length / 3.6);
ok(`body fits the budget (~${estTokens} tokens)`, () => assert(estTokens < 600, `body is ~${estTokens} tokens`));

ok('teaches both vector forms, the quoting trap, and the honest limit', () => {
  assert(/--vec/.test(body), 'no --vec at all');
  assert(/->/.test(body), 'missing the tail->head form');
  assert(/--vec=-/.test(body), 'missing the leading-negative quoting form');
  assert(/(no|not).{0,40}(3D|plane)/i.test(body), 'does not state what it cannot draw');
});

ok('carries the percent-encoding rule as a rule', () => {
  assert(/RULE:/.test(body), 'not stated as a rule');
  assert(/%20/.test(body));
  assert(/literal space/i.test(body) && /CommonMark/.test(body));
});

ok('carries all three diagnostic outcomes', () => {
  assert(/\[Image\]/.test(body), 'missing the [Image] outcome');
  assert(/Reload Webviews/.test(body), 'missing the remedy for an inactive patch');
  assert(/raw markdown/i.test(body), 'missing the malformed-URI outcome');
  assert(/malformed/i.test(body));
});

ok('teaches how to produce an image', () => {
  assert(/plot\.py/.test(body));
  assert(/data:image\/svg\+xml/.test(body));
});

ok('disclaims the patch internals and points at the repo', () => {
  assert(/claude-inline-images/.test(body));
  assert(/(not your job|out of scope)/i.test(body));
});

ok('leaks nothing about how the patch works', () => {
  for (const w of ['urlTransform', 'remarkPlugins', 'katex', 'KaTeX', 'specificity',
                   'thumbIcon', 'anchor', 'CSP', 'exfiltration', 'index.js'])
    assert(!body.includes(w), `body mentions patch internals: ${w}`);
});

// --- the installer ----------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'skilltest-'));
const dest = path.join(tmp, 'skills', inst.SKILL);

ok('installs into an empty target', () => {
  const r = inst.install(dest);
  assert.strictEqual(r.changed, 2);
  for (const [, name] of inst.FILES) assert(fs.existsSync(path.join(dest, name)));
});

ok('is idempotent: a second run writes nothing', () => {
  assert.strictEqual(inst.install(dest).changed, 0);
  assert.strictEqual(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), src);
});

ok('updates in place rather than making a second copy', () => {
  fs.writeFileSync(path.join(dest, 'SKILL.md'), 'stale\n');
  assert.strictEqual(inst.install(dest).changed, 1);
  assert.strictEqual(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), src);
  assert.deepStrictEqual(fs.readdirSync(dest).sort(), ['SKILL.md', 'plot.py']);
});

ok('--status reports drift and then cleanliness', () => {
  assert(inst.status(dest).items.every((i) => i.state === 'current'));
  fs.writeFileSync(path.join(dest, 'plot.py'), 'stale\n');
  assert(inst.status(dest).items.some((i) => i.state === 'stale'));
  inst.install(dest);
});

ok('remove() is the inverse', () => {
  inst.remove(dest);
  assert(!fs.existsSync(dest), 'skill directory left behind');
});

ok('target resolution honours --target, then env, then ~/.claude', () => {
  assert.strictEqual(inst.skillsDir(['--target', tmp]), path.resolve(tmp));
  const saved = process.env.CLAUDE_SKILLS_DIR;
  process.env.CLAUDE_SKILLS_DIR = tmp;
  assert.strictEqual(inst.skillsDir([]), path.resolve(tmp));
  if (saved === undefined) delete process.env.CLAUDE_SKILLS_DIR; else process.env.CLAUDE_SKILLS_DIR = saved;
  const savedCfg = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  assert.strictEqual(inst.skillsDir([]), path.join(os.homedir(), '.claude', 'skills'));
  if (savedCfg !== undefined) process.env.CLAUDE_CONFIG_DIR = savedCfg;
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} assertions passed`);
