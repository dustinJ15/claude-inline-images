#!/usr/bin/env node
'use strict';
/*
 * claude-inline-images — doctor
 *
 *   node doctor.js [<consumer-repo> ...] [--ext-dir <path>] [--skills-dir <dir>] [--json]
 *
 * Answers one question: "is my whole local integration actually working right
 * now?" — and, for anything that is not, names the exact command that fixes it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Both ways this setup breaks are silent:
 *
 *   1. Every Claude Code update installs into a NEW versioned directory, so the
 *      bundle patch is simply gone and images revert to the literal text
 *      "[Image]" with no error anywhere.
 *   2. The skill installer versions SKILL.md and plot.py separately. On
 *      2026-08-19 `--status` read "SKILL.md current / plot.py stale": the skill
 *      was installed, and shipping a plot.py that predated `--theme`. An agent
 *      in an unrelated repo would have invoked a flag that did not exist.
 *
 * Neither surfaces as an error, and both are trivially detectable — hence one
 * command that checks all of it and exits non-zero when anything needs
 * attention.
 *
 * WHY A SEPARATE SCRIPT, not `patch.js doctor`
 * --------------------------------------------
 * patch.js's subcommands are all scoped to one artefact (the extension bundle)
 * and three of the four mutate it. The doctor spans three artefacts — the
 * extension, the installed skill, and plot.py as an executable — and is
 * strictly read-only. Folding it into patch.js would either drag install-skill
 * and a subprocess spawn into the patcher's dependency surface, or split the
 * report across two commands. It is its own thing.
 *
 * READ-ONLY. The doctor never patches, never installs, never writes anywhere.
 * It only reads, executes plot.py in a temp-free way (stdout only), and reports.
 * test/doctor.js asserts the byte-level no-write property directly.
 *
 * NO DUPLICATED LOGIC. Patch state comes from patch.js's own `status()`; skill
 * staleness comes from install-skill.js's own `plan()`/`status()` comparison.
 * This file contains no copy of the edit table and no second definition of what
 * "current" means.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const P = require('./patch.js');
const inst = require('./install-skill.js');

const REPO_PLOT = path.join(__dirname, 'plot.py');

// --- check helpers ----------------------------------------------------------

const mk = (id, name, status, detail, fix, extra) =>
  Object.assign({ id, name, status, detail, fix: fix || null }, extra || {});

// The first line of an error message, so a report never carries a stack trace.
const oneLine = (e) => String(e && e.message ? e.message : e).split('\n')[0].trim();

// --- 1. which install, and which discovery route found it -------------------

/**
 * Reproduce patch.js's precedence *labels* only — the resolution itself is
 * patch.js's findExtensionDir(). CLAUDE_CODE_EXECPATH is detected by the
 * resolved directory being an ancestor of the exec path, which is exactly the
 * shape fromExecPath() produces.
 */
function routeFor(dir, explicit) {
  if (explicit) return '--ext-dir';
  if (process.env.CLAUDE_CODE_EXT_DIR) return 'CLAUDE_CODE_EXT_DIR';
  const ep = process.env.CLAUDE_CODE_EXECPATH;
  if (ep && (ep === dir || ep.startsWith(dir + path.sep))) return 'CLAUDE_CODE_EXECPATH';
  return 'scan of extension roots (newest version wins)';
}

function checkInstall(opts) {
  let installs = [];
  try { installs = P.listInstalls(); } catch (_) { /* unreadable roots are not fatal */ }

  let dir;
  try {
    dir = P.findExtensionDir(opts.extDir);
  } catch (e) {
    return mk('install', 'extension install', 'fail', oneLine(e),
      'install the Claude Code VSCode extension, or: node patch.js list  (then pass --ext-dir <path>)',
      { installs: installs.map((i) => i.dir) });
  }

  const route = routeFor(dir, opts.extDir);
  const others = installs.filter((i) => i.dir !== dir);
  let detail = dir;
  if (others.length) detail += `  (+${others.length} other install(s) found — not selected)`;
  return mk('install', 'extension install', 'ok', detail, null,
    { route, extDir: dir, installs: installs.map((i) => i.dir) });
}

// --- 2. patch applied, and at the version this repo ships -------------------

function checkPatch(extDir) {
  if (!extDir) {
    return mk('patch', 'bundle patch', 'skip', 'no extension install to inspect',
      'fix the extension install check first');
  }
  let s;
  try {
    s = P.status(extDir);
  } catch (e) {
    return mk('patch', 'bundle patch', 'fail', oneLine(e), 'node patch.js status');
  }

  const katex = s.katexPatched ? '; coexisting with claude-code-katex' : '';
  if (s.current) {
    const extra = s.patchedVersions.filter((v) => v !== s.latestVersion);
    const also = extra.length ? ` (also v${extra.join(', v')})` : '';
    return mk('patch', 'bundle patch', 'ok',
      `v${s.latestVersion} applied, current${also}${katex}`, null, { patchStatus: s });
  }
  if (s.patchedVersions.length) {
    // A deliberate downgrade is a legitimate state — report it loudly, but it
    // is not a broken install and must not fail the run.
    return mk('patch', 'bundle patch', 'warn',
      `patched at v${s.patchedVersions.join(', v')}, but this repo ships v${s.latestVersion}` +
      ` — deliberate downgrade is fine; drift after an update is not${katex}`,
      `node patch.js apply    # to move to v${s.latestVersion}`, { patchStatus: s });
  }
  return mk('patch', 'bundle patch', 'fail',
    `not patched — images render as the literal text "[Image]"` +
    ` (every Claude Code update installs to a new directory and drops the patch)${katex}`,
    'node patch.js apply    # then in VSCode: Developer: Reload Window', { patchStatus: s });
}

// --- 3. skill installed AND every file current ------------------------------

function checkSkill(skillsRoot) {
  const dest = path.join(skillsRoot, inst.SKILL);
  let items;
  try {
    items = inst.status(dest).items;         // install-skill.js's own comparison
  } catch (e) {
    return mk('skill', 'inline-plots skill', 'fail', oneLine(e), 'node install-skill.js', { dest });
  }

  const bad = items.filter((i) => i.state !== 'current');
  const summary = items.map((i) => `${path.basename(i.to)} ${i.state}`).join(', ');
  if (!bad.length) return mk('skill', 'inline-plots skill', 'ok', `${dest}  (${summary})`, null, { dest, items });

  const missing = bad.every((i) => i.state === 'new');
  return mk('skill', 'inline-plots skill', 'fail',
    (missing ? 'not installed' : 'installed but out of date') + ` — ${summary}` +
    (missing ? '' : '; the installed copy is what other repos run, so a stale file ships stale flags'),
    'node install-skill.js', { dest, items });
}

// --- 4. plot.py actually runs and emits a parseable data: URI ---------------

// The installed copy is the one agents in other repos actually execute, so it
// is the one worth exercising; the repo copy is the fallback when nothing is
// installed. `--theme` is passed deliberately: it is the flag whose absence was
// the 2026-08-19 staleness, so a stale plot.py fails here functionally and not
// only by byte comparison.
function checkPlot(skillsRoot) {
  const installed = path.join(skillsRoot, inst.SKILL, 'plot.py');
  const which = fs.existsSync(installed) ? installed : REPO_PLOT;
  const fromRepo = which === REPO_PLOT;
  const fix = fromRepo ? 'python3 test/test_plot.py    # then check plot.py' : 'node install-skill.js';

  if (!fs.existsSync(which)) {
    return mk('plot', 'plot.py runs', 'fail', `no plot.py at ${which}`, fix, { plotPath: which });
  }

  const r = spawnSync('python3', [which, '-e', 'sin(x)', '-x', '-6.3', '6.3', '--theme', 'dark'],
    { encoding: 'utf8', timeout: 30000 });

  if (r.error && r.error.code === 'ENOENT') {
    return mk('plot', 'plot.py runs', 'fail', 'python3 not found on PATH',
      'install Python 3 (plot.py is stdlib-only, no packages needed)', { plotPath: which });
  }
  if (r.error) return mk('plot', 'plot.py runs', 'fail', oneLine(r.error), fix, { plotPath: which });
  if (r.status !== 0) {
    return mk('plot', 'plot.py runs', 'fail',
      `${which} exited ${r.status}: ${(r.stderr || '').trim().split('\n').pop() || 'no output'}`,
      fix, { plotPath: which });
  }

  const m = /!\[[^\]]*\]\((data:image\/svg\+xml,[^)\s]+)\)/.exec(r.stdout || '');
  if (!m) {
    return mk('plot', 'plot.py runs', 'fail',
      `${which} ran but printed no parseable ![alt](data:image/svg+xml,…) URI`, fix, { plotPath: which });
  }
  let decoded = '';
  try { decoded = decodeURIComponent(m[1].slice('data:image/svg+xml,'.length)); } catch (_) { /* below */ }
  if (!decoded.includes('<svg') || !decoded.includes('</svg>')) {
    return mk('plot', 'plot.py runs', 'fail',
      `${which} emitted a data: URI that does not decode to an SVG document`, fix, { plotPath: which });
  }
  if (/\s/.test(m[1])) {
    // A literal space in a markdown destination makes CommonMark not produce an
    // image node at all — raw text in the panel, which looks nothing like a
    // patch failure. Worth catching here rather than in a live chat.
    return mk('plot', 'plot.py runs', 'fail',
      `${which} emitted a URI containing an unencoded space`, fix, { plotPath: which });
  }
  return mk('plot', 'plot.py runs', 'ok',
    `${which} → ${m[1].length} B data: URI${fromRepo ? ' (repo copy; skill not installed)' : ''}`,
    null, { plotPath: which, uriBytes: m[1].length });
}

// --- 5. consumer repos — OPT-IN ONLY ----------------------------------------

// Never inferred, never hardcoded: a check only exists for a path the caller
// passed. A fresh clone on any machine therefore reports healthy with none.
function checkConsumer(repo) {
  const id = 'consumer:' + repo;
  const name = 'consumer repo ' + path.basename(repo);
  const md = path.join(repo, 'CLAUDE.md');
  if (!fs.existsSync(repo)) return mk(id, name, 'fail', `${repo} does not exist`, `pass a path that exists`);
  if (!fs.existsSync(md)) {
    return mk(id, name, 'fail', `no CLAUDE.md in ${repo}`,
      `create ${md} telling the assistant to use the inline-plots skill / plot.py for graphs`);
  }
  const text = fs.readFileSync(md, 'utf8');
  if (!/inline-plots|plot\.py/.test(text)) {
    return mk(id, name, 'fail', `${md} does not mention the inline-plots skill or plot.py`,
      `add a line to ${md}: "Draw graphs with the inline-plots skill (plot.py), not prose."`);
  }
  return mk(id, name, 'ok', `${md} carries the instruction`);
}

// --- driver -----------------------------------------------------------------

function runChecks(opts) {
  const o = opts || {};
  const skillsRoot = o.skillsRoot || inst.skillsDir([]);
  const checks = [];

  const install = checkInstall(o);
  checks.push(install);
  checks.push(checkPatch(install.extDir));
  checks.push(checkSkill(skillsRoot));
  checks.push(checkPlot(skillsRoot));
  for (const repo of o.repos || []) checks.push(checkConsumer(repo));

  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  return { checks, failed, warned, exitCode: failed ? 1 : 0, skillsRoot };
}

const MARK = { ok: 'ok  ', warn: 'WARN', fail: 'FAIL', skip: 'skip' };

function render(r) {
  const out = ['', 'claude-inline-images doctor', ''];
  const w = Math.max(22, ...r.checks.map((c) => c.name.length));
  for (const c of r.checks) {
    out.push(`  ${MARK[c.status]}  ${c.name.padEnd(w)} ${c.detail}`);
    if (c.route) out.push(`        via ${c.route}`);
    if (c.status !== 'ok' && c.fix) out.push(`        fix: ${c.fix}`);
  }
  out.push('');
  const bits = [];
  if (r.failed) bits.push(`${r.failed} problem${r.failed === 1 ? '' : 's'}`);
  if (r.warned) bits.push(`${r.warned} warning${r.warned === 1 ? '' : 's'}`);
  out.push(bits.length
    ? `${bits.join(', ')} found.` + (r.failed ? '' : ' Nothing is broken.')
    : 'All checks passed — no problems found.');
  out.push('');
  return out.join('\n');
}

const renderJson = (r) => JSON.stringify(r, (k, v) => (k === 'want' ? undefined : v), 2);

function parseArgs(argv) {
  const o = { extDir: undefined, skillsRoot: undefined, repos: [], json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ext-dir') { o.extDir = argv[++i]; if (!o.extDir) throw new Error('--ext-dir needs a path'); }
    else if (a === '--skills-dir') { const v = argv[++i]; if (!v) throw new Error('--skills-dir needs a directory'); o.skillsRoot = path.resolve(v); }
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else rest.push(path.resolve(a));
  }
  o.repos = rest;
  // Delegate the default target to install-skill.js so there is exactly one
  // definition of where skills live.
  if (!o.skillsRoot) o.skillsRoot = inst.skillsDir([]);
  return o;
}

const USAGE =
  'usage: node doctor.js [<consumer-repo> ...] [--ext-dir <path>] [--skills-dir <dir>] [--json]\n' +
  '\n' +
  '  Read-only health check of the whole local integration:\n' +
  '    - which Claude Code install is selected, and by which discovery route\n' +
  '    - whether the bundle patch is applied, and at the shipped version\n' +
  '    - whether the inline-plots skill is installed AND every file is current\n' +
  '    - whether plot.py actually runs and emits a parseable data: URI\n' +
  '    - optionally, whether the CLAUDE.md of each repo path given mentions the skill\n' +
  '\n' +
  '  Exit 0 = healthy (warnings allowed), 1 = something needs attention, 2 = the\n' +
  '  doctor itself could not run. It never writes, patches, or installs anything.';

function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error('doctor: ' + oneLine(e) + '\n\n' + USAGE); return 2; }
  if (o.help) { console.log(USAGE); return 0; }
  const r = runChecks(o);
  console.log(o.json ? renderJson(r) : render(r));
  return r.exitCode;
}

module.exports = { runChecks, render, renderJson, parseArgs, main, USAGE };

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error('doctor: ' + oneLine(e));
    process.exit(2);
  }
}
