#!/usr/bin/env node
'use strict';
/*
 * Tests for `node doctor.js` — the one-command health check.
 *
 * Everything here runs against synthetic fixtures in a temp dir. Nothing in
 * this file reads, writes, or even resolves the live Claude Code install: the
 * extension fixture is built from patch.js's own anchor strings (so it follows
 * an anchor change automatically) and the skill fixture is installed into a
 * temp skills root via install-skill.js's own installer.
 *
 * The one thing that is real is plot.py — the doctor executes it, and so does
 * this suite. That is the repo's own file, not an installed artefact.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require('../patch.js');
const inst = require('../install-skill.js');
const D = require('../doctor.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ok    ${name}`); };

const get = (r, id) => r.checks.find((c) => c.id === id);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-doctor-'));

// --- fixtures ---------------------------------------------------------------

// Built from the anchors themselves, exactly as test/verify.js does, so this
// file never carries a second copy of the edit table.
// Minified names as of Claude Code 2.1.245; esbuild rerolls them every release.
const IDENTS = { vs: 'S4', wv: '$', src: 'z', alt: 'U', h: 'j', csp: ['B', 'N', 'q', 'U', 'D'] };

function makeExtFixture() {
  const edits = P.editsFor(IDENTS);
  const A_IMG = edits['1'].find(([f, from]) => f === 'webview/index.js' && from.startsWith('img:'))[1];
  const A_LRR = edits['2'].find(([f, from]) => f === 'extension.js' && from.startsWith('localResourceRoots:'))[1];
  const A_CSP = edits['2'].find(([f, from]) => f === 'extension.js' && from.startsWith('content='))[1];

  const bundle =
    '"use strict";\n' +
    'var ' + IDENTS.h + '=function(){return null};var QQ=1,XA=2;\n' +
    'function render(){return ' + IDENTS.h + '(QQ,{remarkPlugins:[XA],components:{' + A_IMG + '}})}\n' +
    'module.exports={render};\n';
  const lrrBlock = (i) => '  root' + i + '(){return {enableScripts:true,' + A_LRR + '}}\n';
  const extension =
    '"use strict";\n' +
    'const ' + IDENTS.vs + '=require("vscode");\n' +
    'class Panel{\n' + lrrBlock(0) + lrrBlock(1) + lrrBlock(2) + lrrBlock(3) +
    '  getHtmlForWebview(' + IDENTS.wv + ',' + IDENTS.csp.join(',') + '){return `<!DOCTYPE html><html><head>\n' +
    '        <meta http-equiv="Content-Security-Policy" ' + A_CSP + '\n' +
    '      </head><body></body></html>`}\n' +
    '}\nmodule.exports={Panel};\n';

  const dir = fs.mkdtempSync(path.join(tmpRoot, 'ext-'));
  fs.mkdirSync(path.join(dir, 'webview'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'webview', 'index.js'), bundle, 'utf8');
  fs.writeFileSync(path.join(dir, 'extension.js'), extension, 'utf8');
  return dir;
}

const FIXTURE_FILES = ['webview/index.js', 'extension.js'];
const snapshot = (dir) => Object.fromEntries(
  FIXTURE_FILES.map((rel) => [rel, fs.readFileSync(path.join(dir, rel), 'utf8')]));

const extDir = makeExtFixture();
const skillsRoot = path.join(tmpRoot, 'skills');
const skillDest = path.join(skillsRoot, inst.SKILL);
const base = () => ({ extDir, skillsRoot, repos: [] });

// --- 1. install discovery ---------------------------------------------------

console.log('\ninstall discovery');

ok('finds the target and names the discovery route', () => {
  const c = get(D.runChecks(base()), 'install');
  assert.strictEqual(c.status, 'ok', c.detail);
  assert(c.detail.includes(extDir), c.detail);
  assert(/--ext-dir/.test(c.route), c.route);
});

ok('a directory that is not an install fails, with no stack trace', () => {
  const bogus = fs.mkdtempSync(path.join(tmpRoot, 'bogus-'));
  const r = D.runChecks({ extDir: bogus, skillsRoot, repos: [] });
  const c = get(r, 'install');
  assert.strictEqual(c.status, 'fail');
  assert(/webview\/index\.js/.test(c.detail), c.detail);
  assert(c.fix, 'no fix command offered');
});

ok('no Claude Code install anywhere is a diagnostic, not a crash', () => {
  // Point every discovery route at nothing: an empty home, no env overrides.
  const emptyHome = fs.mkdtempSync(path.join(tmpRoot, 'home-'));
  const realHome = os.homedir;
  const saved = {};
  for (const k of ['CLAUDE_CODE_EXT_DIR', 'CLAUDE_CODE_EXECPATH', 'VSCODE_EXTENSIONS']) {
    saved[k] = process.env[k]; delete process.env[k];
  }
  os.homedir = () => emptyHome;
  try {
    const r = D.runChecks({ skillsRoot, repos: [] });
    const c = get(r, 'install');
    assert.strictEqual(c.status, 'fail', JSON.stringify(c));
    assert(/no active anthropic\.claude-code/i.test(c.detail), c.detail);
    assert.strictEqual(get(r, 'patch').status, 'skip', 'patch check should skip, not fail');
    assert.notStrictEqual(r.exitCode, 0);
    // the rest of the report still runs
    assert(get(r, 'skill'), 'skill check missing');
    assert(get(r, 'plot'), 'plot check missing');
  } finally {
    os.homedir = realHome;
    for (const k of Object.keys(saved)) if (saved[k] !== undefined) process.env[k] = saved[k];
  }
});

ok('render() of a failed run emits no stack trace and names the fix', () => {
  const bogus = fs.mkdtempSync(path.join(tmpRoot, 'bogus2-'));
  const text = D.render(D.runChecks({ extDir: bogus, skillsRoot, repos: [] }));
  assert(!/\n\s+at /.test(text), 'stack trace leaked into the report');
  assert(/fix:/.test(text), 'no fix line in the report');
});

// --- 2. patch state ---------------------------------------------------------

console.log('\npatch state');

ok('unpatched is a failure naming `node patch.js apply`', () => {
  const c = get(D.runChecks(base()), 'patch');
  assert.strictEqual(c.status, 'fail');
  assert(/not patched|unpatched/i.test(c.detail), c.detail);
  assert(/node patch\.js apply/.test(c.fix), c.fix);
});

ok('an older applied version is a warning, not a failure', () => {
  P.apply(extDir, '1');
  const r = D.runChecks(base());
  const c = get(r, 'patch');
  assert.strictEqual(c.status, 'warn', JSON.stringify(c));
  assert(/v1/.test(c.detail) && /v2/.test(c.detail), c.detail);
  assert(/node patch\.js apply/.test(c.fix), c.fix);
  assert(!r.checks.some((x) => x.id === 'patch' && x.status === 'fail'),
    'a deliberate downgrade must not fail the run');
});

ok('current is ok and says so', () => {
  P.apply(extDir, P.VERSION);
  const c = get(D.runChecks(base()), 'patch');
  assert.strictEqual(c.status, 'ok', JSON.stringify(c));
  assert(new RegExp('v' + P.VERSION).test(c.detail), c.detail);
  assert(/current/.test(c.detail), c.detail);
});

// --- 3. skill freshness -----------------------------------------------------

console.log('\nskill freshness');

ok('an absent skill fails, naming `node install-skill.js`', () => {
  const c = get(D.runChecks(base()), 'skill');
  assert.strictEqual(c.status, 'fail');
  assert(/node install-skill\.js/.test(c.fix), c.fix);
});

ok('an installed, current skill is ok', () => {
  inst.install(skillDest);
  const c = get(D.runChecks(base()), 'skill');
  assert.strictEqual(c.status, 'ok', JSON.stringify(c));
  assert(c.detail.includes(skillDest), c.detail);
});

ok('THE 2026-08-19 BUG: a stale plot.py beside a current SKILL.md fails', () => {
  // Exactly the reported state: the directory exists, SKILL.md is current, and
  // plot.py predates a flag. "installed" must not read as healthy.
  const good = fs.readFileSync(path.join(skillDest, 'plot.py'));
  fs.writeFileSync(path.join(skillDest, 'plot.py'), '#!/usr/bin/env python3\nraise SystemExit(2)\n');
  try {
    const r = D.runChecks(base());
    const c = get(r, 'skill');
    assert.strictEqual(c.status, 'fail', JSON.stringify(c));
    assert(/plot\.py/.test(c.detail) && /stale/.test(c.detail), c.detail);
    assert(/SKILL\.md current/.test(c.detail), 'SKILL.md should still read current: ' + c.detail);
    assert(/node install-skill\.js/.test(c.fix), c.fix);
    assert.notStrictEqual(r.exitCode, 0);
  } finally {
    fs.writeFileSync(path.join(skillDest, 'plot.py'), good);
  }
});

ok('a skill directory that exists but is empty is not success', () => {
  const bare = path.join(tmpRoot, 'bare-skills');
  fs.mkdirSync(path.join(bare, inst.SKILL), { recursive: true });
  const c = get(D.runChecks({ extDir, skillsRoot: bare, repos: [] }), 'skill');
  assert.strictEqual(c.status, 'fail', JSON.stringify(c));
});

// --- 4. plot.py actually runs -----------------------------------------------

console.log('\nplot.py execution');

ok('executes the installed plot.py and parses a data: URI out of it', () => {
  const c = get(D.runChecks(base()), 'plot');
  assert.strictEqual(c.status, 'ok', JSON.stringify(c));
  assert(c.detail.includes(path.join(skillDest, 'plot.py')), c.detail);
  assert(/\d+\s*B/.test(c.detail), 'no URI size reported: ' + c.detail);
});

ok('a plot.py that does not run is a failure, not a crash', () => {
  const good = fs.readFileSync(path.join(skillDest, 'plot.py'));
  fs.writeFileSync(path.join(skillDest, 'plot.py'), 'import sys\nsys.exit(3)\n');
  try {
    const c = get(D.runChecks(base()), 'plot');
    assert.strictEqual(c.status, 'fail', JSON.stringify(c));
    assert(c.fix, 'no fix offered');
  } finally {
    fs.writeFileSync(path.join(skillDest, 'plot.py'), good);
  }
});

ok('plot.py that prints no image is a failure', () => {
  const good = fs.readFileSync(path.join(skillDest, 'plot.py'));
  fs.writeFileSync(path.join(skillDest, 'plot.py'), 'print("hello")\n');
  try {
    const c = get(D.runChecks(base()), 'plot');
    assert.strictEqual(c.status, 'fail', JSON.stringify(c));
    assert(/data:/.test(c.detail), c.detail);
  } finally {
    fs.writeFileSync(path.join(skillDest, 'plot.py'), good);
  }
});

ok('falls back to the repo copy when no skill is installed', () => {
  const bare = path.join(tmpRoot, 'bare-skills2');
  const c = get(D.runChecks({ extDir, skillsRoot: bare, repos: [] }), 'plot');
  assert.strictEqual(c.status, 'ok', JSON.stringify(c));
  assert(!c.detail.includes(bare), 'used a skills copy that does not exist: ' + c.detail);
  assert(/repo copy/.test(c.detail), c.detail);
});

// --- 5. consumer repos are opt-in -------------------------------------------

console.log('\nconsumer repos (opt-in)');

ok('no consumer check exists unless a path is passed', () => {
  const r = D.runChecks(base());
  assert(!r.checks.some((c) => c.id.startsWith('consumer:')), 'consumer check ran unasked');
});

ok('a fresh clone with no consumer paths is healthy', () => {
  const r = D.runChecks(base());
  assert.strictEqual(r.failed, 0, JSON.stringify(r.checks.filter((c) => c.status === 'fail')));
  assert.strictEqual(r.exitCode, 0);
});

ok('a repo whose CLAUDE.md carries the instruction passes', () => {
  const repo = fs.mkdtempSync(path.join(tmpRoot, 'repo-'));
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# course\n\nUse the inline-plots skill to draw graphs.\n');
  const c = get(D.runChecks({ extDir, skillsRoot, repos: [repo] }), 'consumer:' + repo);
  assert.strictEqual(c.status, 'ok', JSON.stringify(c));
});

ok('a repo without the instruction fails and says what to add', () => {
  const repo = fs.mkdtempSync(path.join(tmpRoot, 'repo2-'));
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# course\n\nnothing relevant here\n');
  const c = get(D.runChecks({ extDir, skillsRoot, repos: [repo] }), 'consumer:' + repo);
  assert.strictEqual(c.status, 'fail', JSON.stringify(c));
  assert(/CLAUDE\.md/.test(c.fix), c.fix);
});

ok('a missing consumer path fails rather than throwing', () => {
  const missing = path.join(tmpRoot, 'nope-does-not-exist');
  const c = get(D.runChecks({ extDir, skillsRoot, repos: [missing] }), 'consumer:' + missing);
  assert.strictEqual(c.status, 'fail', JSON.stringify(c));
});

// --- 6. the doctor is read-only ---------------------------------------------

console.log('\nread-only guarantee');

ok('a full run leaves the extension bytes untouched', () => {
  const before = snapshot(extDir);
  D.runChecks({ extDir, skillsRoot, repos: [] });
  assert.deepStrictEqual(snapshot(extDir), before, 'doctor modified the extension');
});

ok('a full run leaves the skill directory untouched', () => {
  const before = fs.readdirSync(skillDest).sort()
    .map((f) => [f, fs.readFileSync(path.join(skillDest, f), 'utf8').length]);
  D.runChecks({ extDir, skillsRoot, repos: [] });
  const after = fs.readdirSync(skillDest).sort()
    .map((f) => [f, fs.readFileSync(path.join(skillDest, f), 'utf8').length]);
  assert.deepStrictEqual(after, before, 'doctor modified the installed skill');
});

ok('a full run against an unpatched fixture does not patch it', () => {
  const other = makeExtFixture();
  const before = snapshot(other);
  const r = D.runChecks({ extDir: other, skillsRoot, repos: [] });
  assert.strictEqual(get(r, 'patch').status, 'fail');
  assert.deepStrictEqual(snapshot(other), before, 'doctor applied the patch');
});

// --- 7. exit codes and rendering --------------------------------------------

console.log('\nexit codes and output');

ok('exit code is 0 when everything is healthy', () => {
  assert.strictEqual(D.runChecks(base()).exitCode, 0);
});

ok('exit code is 1 when something needs attention', () => {
  const other = makeExtFixture();          // unpatched
  assert.strictEqual(D.runChecks({ extDir: other, skillsRoot, repos: [] }).exitCode, 1);
});

ok('warnings alone do not change the exit code', () => {
  const other = makeExtFixture();
  P.apply(other, '1');
  const r = D.runChecks({ extDir: other, skillsRoot, repos: [] });
  assert.strictEqual(r.warned, 1, JSON.stringify(r.checks));
  assert.strictEqual(r.exitCode, 0);
});

ok('every failure line in the report names a fix command', () => {
  const other = makeExtFixture();
  const bare = path.join(tmpRoot, 'bare-skills3');
  const r = D.runChecks({ extDir: other, skillsRoot: bare, repos: [] });
  for (const c of r.checks) {
    if (c.status === 'fail') assert(c.fix && c.fix.length > 3, `no fix for ${c.id}`);
  }
  const text = D.render(r);
  assert(/FAIL/.test(text));
  assert(/problem/i.test(text), 'no summary line');
});

ok('--json renders machine-readable output', () => {
  const r = D.runChecks(base());
  const parsed = JSON.parse(D.renderJson(r));
  assert.strictEqual(parsed.exitCode, 0);
  assert(Array.isArray(parsed.checks) && parsed.checks.length >= 4);
});

ok('parseArgs collects options and repo paths', () => {
  const o = D.parseArgs(['--ext-dir', '/x', '--skills-dir', '/y', '--json', '/repo/a', '/repo/b']);
  assert.strictEqual(o.extDir, '/x');
  assert.strictEqual(o.skillsRoot, path.resolve('/y'));
  assert.strictEqual(o.json, true);
  assert.deepStrictEqual(o.repos, [path.resolve('/repo/a'), path.resolve('/repo/b')]);
});

ok('with no --skills-dir, the target comes from install-skill.js, not a copy', () => {
  const saved = process.env.CLAUDE_SKILLS_DIR;
  process.env.CLAUDE_SKILLS_DIR = tmpRoot;
  try {
    assert.strictEqual(D.parseArgs([]).skillsRoot, inst.skillsDir([]));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_SKILLS_DIR; else process.env.CLAUDE_SKILLS_DIR = saved;
  }
});

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(`\n${n} assertions passed`);
