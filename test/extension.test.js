'use strict';
/*
 * Headless tests for the companion extension (tickets 04 and 07).
 *
 *   node test/extension.test.js
 *
 * The extension is never allowed to require the real `vscode` module here: it
 * is injected, so this runs under plain node with no editor present. Every
 * filesystem assertion runs against a synthetic fixture in a temp dir — the
 * live install is never touched, never read, never written.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const P = require('../patch.js');
const EXT = require('../extension/src/extension.js');
const UNINSTALL = require('../extension/src/uninstall.js');

let failures = 0;
const pending = [];

function check(name, fn) {
  pending.push(async () => {
    try {
      await fn();
      console.log('  ok    ' + name);
    } catch (e) {
      failures++;
      console.log('  FAIL  ' + name + '\n        ' + String(e && e.message).split('\n')[0]);
    }
  });
}

// ---------------------------------------------------------------------------
// Fixture: a synthetic stand-in for the two patched files.
//
// Every anchor is taken from patch.js's own edit table rather than retyped, so
// the fixture cannot drift from the shipped anchors. (Same technique as
// test/verify.js's makeFixture; kept local so this file runs standalone.)
// ---------------------------------------------------------------------------

// Minified names as of Claude Code 2.1.245. esbuild rerolls them every release,
// so the fixture states them explicitly and patch.js probes for them.
const IDENTS = { vs: 'S4', wv: '$', src: 'z', alt: 'U', h: 'j', csp: ['B', 'N', 'q', 'U', 'D'] };

function fixtureSources() {
  const edits = P.editsFor(IDENTS);
  const A_IMG = edits['1'].find(([f, from]) => f === 'webview/index.js' && from.startsWith('img:'))[1];
  const A_LRR = edits['2'].find(([f, from]) => f === 'extension.js' && from.startsWith('localResourceRoots:'))[1];
  const A_CSP = edits['2'].find(([f, from]) => f === 'extension.js' && from.startsWith('content='))[1];

  const bundle =
    '"use strict";\n' +
    'var ' + IDENTS.h + '=function(){return null};var QQ=1,XA=2;\n' +
    'function render(){return ' + IDENTS.h + '(QQ,{remarkPlugins:[XA],components:{' + A_IMG + '}})}\n' +
    'module.exports={render};\n';

  const lrrBlock = (n) => '  root' + n + '(){return {enableScripts:true,' + A_LRR + '}}\n';
  const extension =
    '"use strict";\n' +
    'const ' + IDENTS.vs + '=require("vscode");\n' +
    'class Panel{\n' +
    lrrBlock(0) + lrrBlock(1) + lrrBlock(2) + lrrBlock(3) +
    '  getHtmlForWebview(' + IDENTS.wv + ',' + IDENTS.csp.join(',') + '){return `<!DOCTYPE html><html><head>\n' +
    '        <meta http-equiv="Content-Security-Policy" ' + A_CSP + '\n' +
    '      </head><body></body></html>`}\n' +
    '}\n' +
    'module.exports={Panel};\n';

  return { bundle, extension };
}

/**
 * Write a pristine synthetic install into `dir` (created if absent) and return
 * it. With no argument it makes its own temp directory, which is what the
 * ticket-04/07 sections use.
 */
function makeFixtureAt(dir) {
  const { bundle, extension } = fixtureSources();
  const work = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'cii-ext-'));
  fs.mkdirSync(path.join(work, 'webview'), { recursive: true });
  fs.writeFileSync(path.join(work, 'webview', 'index.js'), bundle, 'utf8');
  fs.writeFileSync(path.join(work, 'extension.js'), extension, 'utf8');
  return work;
}

function makeFixture() { return makeFixtureAt(null); }

const FILES = ['webview/index.js', 'extension.js'];
const snapshot = (dir) => Object.fromEntries(
  FILES.map((rel) => [rel, fs.readFileSync(path.join(dir, rel), 'utf8')]));

// Every file in the tree, relative and sorted — used to prove no backup copy is
// ever created alongside the patched files.
function tree(dir) {
  const out = [];
  (function walk(d, prefix) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else out.push(rel);
    }
  })(dir, '');
  return out;
}

// ---------------------------------------------------------------------------
// Stub editor
// ---------------------------------------------------------------------------

function makeVscode(opts = {}) {
  const calls = { errors: [], infos: [], warnings: [], commands: [], configSections: [] };
  return {
    calls,
    extensions: {
      getExtension(id) {
        if (id !== 'anthropic.claude-code') return undefined;
        if (opts.registryThrows) throw new Error('registry exploded');
        return opts.extPath ? { id, extensionPath: opts.extPath, isActive: true } : undefined;
      },
    },
    workspace: {
      getConfiguration(section) {
        calls.configSections.push(section);
        return {
          get(key, dflt) {
            if (opts.config && Object.prototype.hasOwnProperty.call(opts.config, key)) return opts.config[key];
            return dflt;
          },
        };
      },
    },
    window: {
      showErrorMessage(m) { calls.errors.push(m); return Promise.resolve(undefined); },
      showInformationMessage(m) { calls.infos.push(m); return Promise.resolve(undefined); },
      showWarningMessage(m) { calls.warnings.push(m); return Promise.resolve(undefined); },
    },
    commands: {
      executeCommand(c) { calls.commands.push(c); return Promise.resolve(); },
      registerCommand(id, handler) { return { id, handler, dispose() {} }; },
    },
  };
}

// A patcher stub that always fails, used for the failure paths. It deliberately
// implements the same surface as patch.js.
function failingPatcher(message) {
  return {
    VERSION: P.VERSION,
    status() { throw new Error(message); },
    apply() { throw new Error(message); },
    remove() { throw new Error(message); },
    findExtensionDir() { throw new Error(message); },
    listInstalls() { return []; },
  };
}

function section(title) { pending.push(() => console.log('\n' + title)); }

const RELOAD = 'workbench.action.webview.reloadWebviewAction';

// ---------------------------------------------------------------------------
// Ticket 04 — activation behaviour
// ---------------------------------------------------------------------------

section('ticket 04: an unpatched install is patched automatically');
{
  const dir = makeFixture();
  const vscode = makeVscode({ extPath: dir });

  check('ensurePatched() applies the shipped version', async () => {
    const r = await EXT.ensurePatched({ vscode, patch: P });
    assert.strictEqual(r.action, 'patched', JSON.stringify(r));
    assert.strictEqual(r.version, P.VERSION);
    assert.deepStrictEqual(P.status(dir).patchedVersions, [P.VERSION]);
  });
  check('the webviews are reloaded exactly once', () => {
    assert.deepStrictEqual(vscode.calls.commands, [RELOAD]);
  });
  check('no error is shown on a successful patch', () => {
    assert.deepStrictEqual(vscode.calls.errors, []);
  });
  check('the target came from the extension registry, not a directory scan', async () => {
    const r = await EXT.resolveExtensionDir({ vscode, patch: failingPatcher('scan must not be used') });
    assert.strictEqual(r.dir, dir);
    assert.strictEqual(r.source, 'registry');
  });

  pending.push(() => fs.rmSync(dir, { recursive: true, force: true }));
}

section('ticket 04: a patched install starts up with nothing changed and nothing shown');
{
  const dir = makeFixture();
  P.apply(dir);
  const before = snapshot(dir);
  const beforeMtimes = FILES.map((rel) => fs.statSync(path.join(dir, rel)).mtimeMs);
  const vscode = makeVscode({ extPath: dir });

  check('ensurePatched() reports a no-op', async () => {
    const r = await EXT.ensurePatched({ vscode, patch: P });
    assert.strictEqual(r.action, 'noop', JSON.stringify(r));
  });
  check('no file was rewritten', () => {
    assert.deepStrictEqual(snapshot(dir), before);
    assert.deepStrictEqual(FILES.map((rel) => fs.statSync(path.join(dir, rel)).mtimeMs), beforeMtimes);
  });
  check('nothing was shown to the user', () => {
    assert.deepStrictEqual(vscode.calls.errors, []);
    assert.deepStrictEqual(vscode.calls.infos, []);
    assert.deepStrictEqual(vscode.calls.warnings, []);
  });
  check('the webviews were NOT reloaded', () => {
    assert.deepStrictEqual(vscode.calls.commands, []);
  });

  pending.push(() => fs.rmSync(dir, { recursive: true, force: true }));
}

section('ticket 04: autoPatch=false skips everything');
{
  const dir = makeFixture();
  const before = snapshot(dir);
  const vscode = makeVscode({ extPath: dir, config: { autoPatch: false } });

  check('ensurePatched() reports it is disabled', async () => {
    const r = await EXT.ensurePatched({ vscode, patch: P });
    assert.strictEqual(r.action, 'disabled', JSON.stringify(r));
  });
  check('the install is untouched and still unpatched', () => {
    assert.deepStrictEqual(snapshot(dir), before);
    assert.deepStrictEqual(P.status(dir).patchedVersions, []);
  });
  check('nothing is shown and nothing is reloaded', () => {
    assert.deepStrictEqual(vscode.calls.commands, []);
    assert.deepStrictEqual(vscode.calls.errors, []);
    assert.deepStrictEqual(vscode.calls.infos, []);
  });
  check('the setting is read from the claudeInlineImages section', () => {
    assert.ok(vscode.calls.configSections.includes('claudeInlineImages'),
      JSON.stringify(vscode.calls.configSections));
  });

  pending.push(() => fs.rmSync(dir, { recursive: true, force: true }));
}

section('ticket 04: resolution failure is visible, not silent');
{
  const vscode = makeVscode({ extPath: null });   // registry knows nothing
  let result;

  check('ensurePatched() reports an error instead of throwing', async () => {
    result = await EXT.ensurePatched({ vscode, patch: failingPatcher('no install found anywhere') });
    assert.strictEqual(result.action, 'error', JSON.stringify(result));
  });
  check('exactly one error notification is shown', () => {
    assert.strictEqual(vscode.calls.errors.length, 1, JSON.stringify(vscode.calls.errors));
  });
  check('the notification names what went wrong and what to do', () => {
    const m = vscode.calls.errors[0];
    assert.ok(/claude code/i.test(m), m);
    assert.ok(/no install found anywhere/.test(m), m);
    assert.ok(/autoPatch|node patch\.js/i.test(m), 'message is not actionable: ' + m);
  });
  check('nothing is reloaded when nothing was patched', () => {
    assert.deepStrictEqual(vscode.calls.commands, []);
  });
}

section('ticket 04: a registry that throws falls back to the scan');
{
  const dir = makeFixture();
  const vscode = makeVscode({ registryThrows: true });
  const scanner = Object.assign({}, P, { findExtensionDir: () => dir });

  check('resolveExtensionDir() falls back without throwing', async () => {
    const r = await EXT.resolveExtensionDir({ vscode, patch: scanner });
    assert.strictEqual(r.dir, dir);
    assert.strictEqual(r.source, 'scan');
  });
  check('and the patch is applied through the fallback', async () => {
    const r = await EXT.ensurePatched({ vscode, patch: scanner });
    assert.strictEqual(r.action, 'patched', JSON.stringify(r));
    assert.deepStrictEqual(vscode.calls.commands, [RELOAD]);
  });

  pending.push(() => fs.rmSync(dir, { recursive: true, force: true }));
}

section('ticket 04: a failing patch is visible, not silent');
{
  const dir = makeFixture();
  const vscode = makeVscode({ extPath: dir });
  const broken = Object.assign({}, P, {
    apply() { throw new Error('anchor occurs 0x, expected 1x — bundle shape changed'); },
  });
  let result;

  check('ensurePatched() reports an error instead of throwing', async () => {
    result = await EXT.ensurePatched({ vscode, patch: broken });
    assert.strictEqual(result.action, 'error', JSON.stringify(result));
  });
  check('the failure reason reaches the user verbatim', () => {
    assert.strictEqual(vscode.calls.errors.length, 1);
    assert.ok(/bundle shape changed/.test(vscode.calls.errors[0]), vscode.calls.errors[0]);
  });
  check('no reload is issued after a failed patch', () => {
    assert.deepStrictEqual(vscode.calls.commands, []);
  });

  pending.push(() => fs.rmSync(dir, { recursive: true, force: true }));
}

section('ticket 04: activate() wires it up without requiring the real vscode');
{
  const dir = makeFixture();
  const vscode = makeVscode({ extPath: dir });
  const context = { subscriptions: [] };

  check('activate() runs headless and patches', async () => {
    await EXT.activate(context, { vscode, patch: P });
    assert.deepStrictEqual(P.status(dir).patchedVersions, [P.VERSION]);
  });
  check('activate() registers the apply/remove/status commands', () => {
    const ids = context.subscriptions.map((d) => d.id);
    for (const id of ['claudeInlineImages.apply', 'claudeInlineImages.remove', 'claudeInlineImages.status']) {
      assert.ok(ids.includes(id), 'missing command ' + id + ' in ' + JSON.stringify(ids));
    }
  });

  pending.push(() => fs.rmSync(dir, { recursive: true, force: true }));
}

// ---------------------------------------------------------------------------
// Ticket 07 — uninstall
// ---------------------------------------------------------------------------

section('ticket 07: uninstall restores the files byte-identically');
{
  const dir = makeFixture();
  const pristine = snapshot(dir);
  const pristineTree = tree(dir);

  check('setup: the fixture is patched', () => {
    P.apply(dir);
    assert.deepStrictEqual(P.status(dir).patchedVersions, [P.VERSION]);
  });
  check('patching created no backup copy', () => {
    assert.deepStrictEqual(tree(dir), pristineTree);
  });
  check('uninstall() lifts the patch', () => {
    const r = UNINSTALL.uninstall({ patch: P, dirs: [dir] });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].changed, true, JSON.stringify(r[0]));
    assert.deepStrictEqual(P.status(dir).patchedVersions, []);
  });
  check('both files are byte-identical to their unpatched state', () => {
    assert.deepStrictEqual(snapshot(dir), pristine);
  });
  check('uninstall() created no file and left no residue', () => {
    assert.deepStrictEqual(tree(dir), pristineTree);
  });
  check('uninstall() never reads or writes a saved copy', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'uninstall.js'), 'utf8');
    assert.ok(!/copyFile|\.bak|backup|createReadStream/i.test(src),
      'the uninstall hook mentions a backup/copy mechanism');
  });
  check('the hook does not require the vscode API', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'uninstall.js'), 'utf8');
    assert.ok(!/require\((['"])vscode\1\)/.test(src), 'uninstall.js requires vscode; it runs in plain node');
  });

  pending.push(() => fs.rmSync(dir, { recursive: true, force: true }));
}

section('ticket 07: uninstall on an unpatched install is a quiet no-op');
{
  const dir = makeFixture();
  const pristine = snapshot(dir);

  check('it reports no change and does not throw', () => {
    const r = UNINSTALL.uninstall({ patch: P, dirs: [dir] });
    assert.strictEqual(r[0].changed, false, JSON.stringify(r[0]));
    assert.ok(!r[0].error, JSON.stringify(r[0]));
    assert.ok(/not patched/i.test(r[0].reason), r[0].reason);
  });
  check('the files are untouched', () => {
    assert.deepStrictEqual(snapshot(dir), pristine);
  });

  pending.push(() => fs.rmSync(dir, { recursive: true, force: true }));
}

section('ticket 07: uninstall survives an install it cannot touch');
{
  const good = makeFixture();
  P.apply(good);
  const missing = path.join(os.tmpdir(), 'cii-does-not-exist-' + Date.now());

  check('a broken install is reported, not thrown, and the others still clear', () => {
    const r = UNINSTALL.uninstall({ patch: P, dirs: [missing, good] });
    assert.strictEqual(r.length, 2);
    assert.ok(r[0].error, 'expected an error entry for the missing dir');
    assert.strictEqual(r[1].changed, true, JSON.stringify(r[1]));
    assert.deepStrictEqual(P.status(good).patchedVersions, []);
  });
  check('with no dirs at all it returns an empty result', () => {
    assert.deepStrictEqual(UNINSTALL.uninstall({ patch: P, dirs: [] }), []);
  });

  pending.push(() => fs.rmSync(good, { recursive: true, force: true }));
}

// ---------------------------------------------------------------------------
// Ticket 05 — the two ways the patch is lost in the wild
//
// Both are simulated against synthetic fixtures. The KaTeX extension is
// simulated too, because "recovering in isolation is not the scenario that
// matters": every recovery below is asserted to leave nuriyev.claude-code-katex
// still matching its own anchor, with identical captures.
//
// The KaTeX anchor regex is not retyped here — it is lifted out of
// test/verify.js, which owns that assertion, so the two cannot drift.
// ---------------------------------------------------------------------------

const KATEX_RE = (() => {
  const src = fs.readFileSync(path.join(__dirname, 'verify.js'), 'utf8');
  const m = src.match(/const KATEX_RE = (\/.*\/[a-z]*);/);
  if (!m) throw new Error('could not lift KATEX_RE out of test/verify.js — the coexistence assertion moved');
  const re = new Function('return ' + m[1])();
  if (!(re instanceof RegExp)) throw new Error('KATEX_RE in test/verify.js is not a regex');
  return re;
})();

const KATEX_MARK = '__KATEX_V2_LOADED';
const bundlePath = (dir) => path.join(dir, 'webview', 'index.js');
const readFile = (f) => fs.readFileSync(f, 'utf8');

/** Stand-in for nuriyev.claude-code-katex: adds a plugin to remarkPlugins. */
function katexApply(dir) {
  const f = bundlePath(dir);
  const src = readFile(f);
  if (src.includes(KATEX_MARK)) return;
  if (!KATEX_RE.test(src)) throw new Error('KaTeX anchor absent from the fixture bundle');
  const patched = src.replace(KATEX_RE, (whole) => whole.slice(0, -1) + ',KTX]');
  fs.writeFileSync(f, patched + '\nvar ' + KATEX_MARK + '=1;\n', 'utf8');
}

/** What KaTeX reads out of the call site. Must not change when we patch. */
function katexCaptures(dir) {
  const m = KATEX_RE.exec(readFile(bundlePath(dir)));
  return m && m.slice(1);
}

function assertKatexIntact(dir, expectedCaptures) {
  const src = readFile(bundlePath(dir));
  assert.ok(src.includes(KATEX_MARK), 'the KaTeX patch is gone from the bundle');
  assert.ok(KATEX_RE.test(src), 'our patch broke the KaTeX anchor');
  assert.ok(src.includes('{remarkPlugins:['), 'something was inserted between the { and remarkPlugins:[');
  assert.deepStrictEqual(katexCaptures(dir), expectedCaptures,
    'our patch changed what the KaTeX anchor captures');
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
  return to;
}

section('ticket 05 scenario 1: Claude Code updates into a NEW versioned directory');
{
  // A realistic extensions root: the update arrives as a second directory, the
  // old one is left behind still carrying our patch.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-root-'));
  const oldDir = makeFixtureAt(path.join(root, 'anthropic.claude-code-2.1.234-linux-x64'));
  const newDir = path.join(root, 'anthropic.claude-code-99.9.9-linux-x64');
  let oldAfterUpdate, newTree, katexBefore;
  const vscode = makeVscode({ extPath: newDir });

  check('setup: the old install is patched and KaTeX is patched on top of it', () => {
    katexApply(oldDir);
    P.apply(oldDir);
    assert.strictEqual(P.status(oldDir).current, true);
    assert.strictEqual(P.status(oldDir).katexPatched, true);
  });

  check('the update lands as a fresh, unpatched directory', () => {
    makeFixtureAt(newDir);
    katexApply(newDir);                    // KaTeX self-heals into the new dir too
    katexBefore = katexCaptures(newDir);
    newTree = tree(newDir);
    assert.strictEqual(P.status(newDir).current, false);
    oldAfterUpdate = snapshot(oldDir);
    // Without the extension this is the mid-semester failure: images are [Image].
    assert.deepStrictEqual(P.status(newDir).patchedVersions, []);
  });

  check('the next startup re-applies into the new directory, unprompted', async () => {
    const r = await EXT.ensurePatched({ vscode, patch: P });
    assert.strictEqual(r.action, 'patched', JSON.stringify(r));
    assert.strictEqual(r.extDir, newDir);
    assert.strictEqual(P.status(newDir).current, true);
  });
  check('the webviews are reloaded exactly once and nothing is shown as an error', () => {
    assert.deepStrictEqual(vscode.calls.commands, [RELOAD]);
    assert.deepStrictEqual(vscode.calls.errors, []);
  });
  check('KaTeX still matches its own anchor in the new directory, captures identical', () => {
    assertKatexIntact(newDir, katexBefore);
  });
  check('no backup file was created in the new directory', () => {
    assert.deepStrictEqual(tree(newDir), newTree);
  });
  check('the superseded directory was not touched', () => {
    assert.deepStrictEqual(snapshot(oldDir), oldAfterUpdate);
  });
  check('a second startup after the update is a silent no-op', async () => {
    const v2 = makeVscode({ extPath: newDir });
    const before = snapshot(newDir);
    const r = await EXT.ensurePatched({ vscode: v2, patch: P });
    assert.strictEqual(r.action, 'noop', JSON.stringify(r));
    assert.deepStrictEqual(snapshot(newDir), before);
    assert.deepStrictEqual(v2.calls.commands, []);
  });
  check('without a registry, the directory scan also follows the update to the newer dir', () => {
    // patch.js honours VSCODE_EXTENSIONS, so the scan can be pointed at the
    // synthetic root. Restored immediately; the real install is never a candidate.
    // CLAUDE_CODE_EXECPATH / CLAUDE_CODE_EXT_DIR outrank the scan and are set
    // when this suite runs from inside Claude Code — they would point at the
    // REAL install. Cleared for the duration so nothing but the fixture root is
    // reachable, then restored.
    const savedEnv = {};
    for (const k of ['VSCODE_EXTENSIONS', 'CLAUDE_CODE_EXT_DIR', 'CLAUDE_CODE_EXECPATH']) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env.VSCODE_EXTENSIONS = root;
    try {
      const installs = P.listInstalls().filter((i) => i.root === root);
      assert.deepStrictEqual(installs.map((i) => i.dir), [oldDir, newDir]);
      const scanned = EXT.resolveExtensionDir({ vscode: makeVscode({ extPath: null }), patch: P });
      assert.strictEqual(scanned.dir, newDir, 'the scan did not select the updated install');
      assert.strictEqual(scanned.source, 'scan');
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });

  pending.push(() => fs.rmSync(root, { recursive: true, force: true }));
}

section('ticket 05 scenario 2: KaTeX restores its pristine backup over the shared bundle');
{
  const dir = makeFixture();
  const vscode = makeVscode({ extPath: dir });
  let katexOnly, katexBefore, fullTree, patchedSnapshot, recovery;

  check('setup: both extensions are patched, KaTeX first', () => {
    katexApply(dir);
    katexOnly = snapshot(dir);             // the state KaTeX believes is "its" file
    katexBefore = katexCaptures(dir);
    fullTree = tree(dir);
    P.apply(dir);
    patchedSnapshot = snapshot(dir);
    assert.strictEqual(P.status(dir).current, true);
    assertKatexIntact(dir, katexBefore);
  });

  check('KaTeX rolls its own backup forward: our bundle edits are gone, extension.js keeps ours', () => {
    // This is the real shape of the clobber. nuriyev.claude-code-katex owns
    // webview/index.js.katex-bak (pristine, pre-KaTeX) and rewrites only that
    // file. Our v2 edits to extension.js survive, so the install is left HALF
    // patched — a state patch.js's all-or-nothing view reports as "unpatched".
    fs.writeFileSync(bundlePath(dir), fixtureSources().bundle, 'utf8');
    katexApply(dir);
    assert.deepStrictEqual(snapshot(dir)['webview/index.js'], katexOnly['webview/index.js']);
    assert.notDeepStrictEqual(snapshot(dir)['extension.js'], katexOnly['extension.js']);
    assert.deepStrictEqual(P.status(dir).patchedVersions, [], 'expected the stamp to read as absent');
  });

  check('precondition: a bare patch.js apply CANNOT recover this state', () => {
    const scratch = copyDir(dir, path.join(dir + '-scratch'));
    assert.throws(() => P.apply(scratch), /anchor occurs 0x, expected 4x/,
      'if this stops throwing, the half-patched case is handled in patch.js and the ' +
      'extension-side repair below may be redundant');
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  check('the next startup recovers automatically', async () => {
    recovery = await EXT.ensurePatched({ vscode, patch: P });
    assert.strictEqual(recovery.action, 'patched',
      JSON.stringify(recovery) + ' — recovery from the KaTeX clobber failed');
    assert.strictEqual(P.status(dir).current, true);
  });
  check('recovery is a re-application, not a restore: the result is byte-identical to a clean patch', () => {
    assert.deepStrictEqual(snapshot(dir), patchedSnapshot);
  });
  check('the webviews are reloaded once and no error is shown', () => {
    assert.deepStrictEqual(vscode.calls.commands, [RELOAD]);
    assert.deepStrictEqual(vscode.calls.errors, []);
  });
  check('KaTeX survives our recovery, captures identical', () => {
    assertKatexIntact(dir, katexBefore);
  });
  check('no backup file was created at any point', () => {
    assert.deepStrictEqual(tree(dir), fullTree);
  });
  check('the result names the half-applied version it had to lift first', () => {
    assert.deepStrictEqual(recovery.repaired, [P.VERSION], JSON.stringify(recovery));
  });
  check('removing our patch afterwards returns the tree to the KaTeX-only state exactly', () => {
    P.remove(dir);
    assert.deepStrictEqual(snapshot(dir), katexOnly);
    assert.deepStrictEqual(tree(dir), fullTree);
  });

  pending.push(() => fs.rmSync(dir, { recursive: true, force: true }));
}

section('ticket 05 scenario 2b: a full clobber, and the mirror-image half');
{
  check('a clobber of BOTH files recovers on the next startup', async () => {
    const dir = makeFixture();
    katexApply(dir);
    const katexOnly = snapshot(dir);
    const before = tree(dir);
    P.apply(dir);
    const patched = snapshot(dir);
    // both files replaced wholesale, as a reinstall of Claude Code in place would
    fs.writeFileSync(bundlePath(dir), katexOnly['webview/index.js'], 'utf8');
    fs.writeFileSync(path.join(dir, 'extension.js'), katexOnly['extension.js'], 'utf8');
    const vscode = makeVscode({ extPath: dir });
    const r = await EXT.ensurePatched({ vscode, patch: P });
    assert.strictEqual(r.action, 'patched', JSON.stringify(r));
    assert.deepStrictEqual(snapshot(dir), patched);
    assert.deepStrictEqual(tree(dir), before);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('the mirror case — extension.js reverted, bundle still ours — also recovers', async () => {
    const dir = makeFixture();
    katexApply(dir);
    const pristineExt = snapshot(dir)['extension.js'];
    P.apply(dir);
    const patched = snapshot(dir);
    fs.writeFileSync(path.join(dir, 'extension.js'), pristineExt, 'utf8');
    assert.deepStrictEqual(P.status(dir).patchedVersions, []);
    const vscode = makeVscode({ extPath: dir });
    const r = await EXT.ensurePatched({ vscode, patch: P });
    assert.strictEqual(r.action, 'patched', JSON.stringify(r));
    assert.deepStrictEqual(snapshot(dir), patched);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('a half-patched install with autoPatch=false is left strictly alone', async () => {
    const dir = makeFixture();
    P.apply(dir);
    fs.writeFileSync(bundlePath(dir), fixtureSources().bundle, 'utf8');
    const half = snapshot(dir);
    const vscode = makeVscode({ extPath: dir, config: { autoPatch: false } });
    const r = await EXT.ensurePatched({ vscode, patch: P });
    assert.strictEqual(r.action, 'disabled', JSON.stringify(r));
    assert.deepStrictEqual(snapshot(dir), half, 'the repair ran despite autoPatch being off');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('a failure while repairing is reported, not swallowed', async () => {
    const dir = makeFixture();
    P.apply(dir);
    fs.writeFileSync(bundlePath(dir), fixtureSources().bundle, 'utf8');
    const vscode = makeVscode({ extPath: dir });
    const broken = Object.assign({}, P, {
      apply() { throw new Error('anchor occurs 0x, expected 4x — bundle shape changed'); },
    });
    const r = await EXT.ensurePatched({ vscode, patch: broken });
    assert.strictEqual(r.action, 'error', JSON.stringify(r));
    assert.strictEqual(vscode.calls.errors.length, 1);
    assert.deepStrictEqual(vscode.calls.commands, []);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

section('ticket 05: the repair is a re-application, never a file restore');
{
  check('the extension has no copy/backup/restore mechanism anywhere in it', () => {
    // Mechanism, not prose: the comments necessarily discuss KaTeX's backup.
    // What must never appear is code that copies or replays a saved file.
    const dir = path.join(__dirname, '..', 'extension', 'src');
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      assert.ok(!/copyFile|createReadStream|createWriteStream|\.bak\b|\.orig\b/i.test(src),
        f + ' contains a copy/restore mechanism; recovery must be re-application only');
    }
  });
  check('the repair reads its fragments from the patcher, not from a table of its own', () => {
    // A half-applied version can only be recognised from the edit table; the
    // assertion that keeps that table single-sourced is the one below, but this
    // pins the mechanism: liftPartialVersions is driven by whatever it is passed.
    const dir = makeFixture();
    P.apply(dir);
    fs.writeFileSync(bundlePath(dir), fixtureSources().bundle, 'utf8');
    const inert = { ALL_VERSIONS: [], editsFor: () => ({}), resolveIdents: P.resolveIdents };
    const half = snapshot(dir);
    assert.deepStrictEqual(EXT.liftPartialVersions(inert, dir), []);
    assert.deepStrictEqual(snapshot(dir), half, 'the repair acted without an edit table');
    assert.deepStrictEqual(EXT.liftPartialVersions(P, dir), [P.VERSION]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  check('it is a no-op on a clean tree, patched or unpatched', () => {
    const dir = makeFixture();
    const pristine = snapshot(dir), pristineTree = tree(dir);
    assert.deepStrictEqual(EXT.liftPartialVersions(P, dir), []);
    assert.deepStrictEqual(snapshot(dir), pristine);
    P.apply(dir);
    const patched = snapshot(dir);
    assert.deepStrictEqual(EXT.liftPartialVersions(P, dir), []);
    assert.deepStrictEqual(snapshot(dir), patched);
    assert.deepStrictEqual(tree(dir), pristineTree, 'the repair left a temp file behind');
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

// ---------------------------------------------------------------------------
// Single source of truth (spec decision, user story 11)
// ---------------------------------------------------------------------------

section('single source of truth: the extension calls the patcher, never a copy');
{
  check('the extension package contains no second edit table', () => {
    const dir = path.join(__dirname, '..', 'extension', 'src');
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(!src.includes('urlTransform'), f + ' contains a copy of the injected fragment');
      assert.ok(!src.includes(',components:{'), f + ' contains a copy of an anchor');
    }
  });
  check('the loaded patcher is the repo patch.js itself', () => {
    assert.strictEqual(EXT.loadPatcher(), P);
  });
}

// ---------------------------------------------------------------------------

(async () => {
  for (const step of pending) await step();
  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all checks passed') + '\n');
  process.exit(failures ? 1 : 0);
})();
