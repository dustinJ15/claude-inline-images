'use strict';
/*
 * Safety harness for the bundle patch.
 *
 * These are the checks that were actually run before the patch was first
 * applied to a live install. Run them after ANY change to the injected
 * fragments in patch.js:
 *
 *   node test/verify.js
 *
 * The security assertions run everywhere. The bundle assertions are skipped
 * (not failed) when no Claude Code install is present, so this is CI-safe.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const assert = require('assert');

const P = require('../patch.js');

let failures = 0;
let skipped = 0;

function check(name, fn) {
  try {
    fn();
    console.log('  ok    ' + name);
  } catch (e) {
    failures++;
    console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]);
  }
}

function skip(name, why) {
  skipped++;
  console.log('  skip  ' + name + ' (' + why + ')');
}

// ---------------------------------------------------------------------------
// 1. Security: the injected urlTransform must not become a hole.
//
// This evaluates the ACTUAL string that gets injected, not a copy of it, so the
// test cannot drift from the shipped fragment.
// ---------------------------------------------------------------------------

// Two realistic minified-name sets. esbuild rerolls these on every Claude Code
// release (`Lt` -> `Nt` -> `S4` across three versions), so every assertion below
// runs against BOTH: an edit table that can only handle one of them is the exact
// regression that broke patching on 2.1.245.
const IDENT_SETS = {
  'old names': { vs: 'Lt', wv: 'e', src: 'l', alt: 'c', h: 'b', csp: ['p', 'f', 'm', 'u', 'g'] },
  '2.1.245 names': { vs: 'S4', wv: '$', src: 'z', alt: 'U', h: 'j', csp: ['B', 'N', 'q', 'U', 'D'] },
};
const IDENTS = IDENT_SETS['old names'];

function injectedUrlTransform() {
  const frag = P.editsFor(IDENTS)['2'].find(([f, , to]) => f === 'webview/index.js' && to.includes('urlTransform'))[2];
  const body = frag.slice(frag.indexOf('urlTransform:'), frag.lastIndexOf(',components:{'));
  return vm.runInNewContext('({' + body + '})').urlTransform;
}

console.log('\nsecurity: urlTransform allowlist');
{
  const f = injectedUrlTransform();

  const MUST_PASS = [
    'data:image/svg+xml,<svg/>',
    'data:image/png;base64,iVBOR',
    'data:image/jpeg;base64,/9j/',
    'plots/sine.png',              // relative — stock behaviour
    '/abs/path.png',               // relative — stock behaviour
    './a:b/x.png',                 // colon after a slash is still relative
    'https://example.com/a.png',   // stock behaviour; CSP + img override block it
    'mailto:someone@example.com',
  ];
  const MUST_BLANK = [
    'data:text/html;base64,PHNjcmlwdD4',   // not an image
    'data:application/javascript,alert(1)',
    'javascript:alert(1)',
    'vbscript:msgbox',
    'blob:abc123',                          // not in the CSP
    'file:///etc/passwd',
    'vscode-resource:/etc/passwd',
  ];

  for (const u of MUST_PASS) {
    check('passes: ' + u.slice(0, 46), () =>
      assert.notStrictEqual(f(u), '', 'was blanked but should pass'));
  }
  for (const u of MUST_BLANK) {
    check('blanks: ' + u.slice(0, 46), () =>
      assert.strictEqual(f(u), '', 'was NOT blanked — this is a security regression'));
  }
  check('non-string input is passed through untouched', () => {
    assert.strictEqual(f(undefined), undefined);
    assert.strictEqual(f(null), null);
  });
}

// ---------------------------------------------------------------------------
// 2. Coexistence: our insertion must not break the KaTeX extension's anchor.
//
// nuriyev.claude-code-katex matches on `X(Y,{remarkPlugins:[Z]`. If we inserted
// our prop immediately after the `{`, that regex would stop matching and KaTeX
// would silently stop applying. We therefore insert before `,components:{`.
// ---------------------------------------------------------------------------

console.log('\ncoexistence: KaTeX anchor survives our patch');
{
  const KATEX_RE = /([A-Za-z_$][\w$]{0,40})\(([A-Za-z_$][\w$]{0,40}),\{remarkPlugins:\[([A-Za-z_$][\w$,]{0,200})\]/;
  const pristine = 'b(QQ,{remarkPlugins:[XA],components:{a:1}})';

  check('KaTeX regex matches the pristine call site', () =>
    assert.ok(KATEX_RE.test(pristine)));

  // Asserted for EVERY version, not just the newest: a rolled-back install runs
  // an older edit set and must coexist just as well.
  for (const v of P.ALL_VERSIONS) {
    const ours = P.editsFor(IDENTS)[v].find(([f, from]) => f === 'webview/index.js' && from === ',components:{');

    // The insertion point itself: the replacement must be the anchor with our
    // props prepended, i.e. it ENDS with `,components:{` and nothing of ours
    // appears before `{remarkPlugins:[`. This is the single property that makes
    // coexistence work; an edit that moves the insertion earlier fails here.
    check(`v${v} replacement ends at the ,components:{ insertion point`, () =>
      assert.ok(ours[2].endsWith(',components:{'),
        'v' + v + ' inserts somewhere other than immediately before ,components:{'));

    const patched = pristine.replace(ours[1], ours[2]);

    check(`v${v}: KaTeX regex still matches after our patch`, () =>
      assert.ok(KATEX_RE.test(patched), 'our insertion broke the KaTeX anchor'));
    check(`v${v}: the literal {remarkPlugins:[ sequence is unbroken`, () =>
      assert.ok(patched.includes('{remarkPlugins:['),
        'nothing may be inserted between the `{` and `remarkPlugins:[`'));
    check(`v${v}: our prop lands after remarkPlugins, not before`, () =>
      assert.ok(patched.indexOf('remarkPlugins') < patched.indexOf('urlTransform')));
    check(`v${v}: KaTeX's captured component argument is unchanged`, () => {
      assert.deepStrictEqual(
        KATEX_RE.exec(patched).slice(1), KATEX_RE.exec(pristine).slice(1),
        'our patch changed what the KaTeX anchor captures');
    });
  }
}

// ---------------------------------------------------------------------------
// 3. Live bundle: anchors are unique, patched bundle parses, round trip is
//    byte-identical. Operates on a COPY — never touches the real install.
// ---------------------------------------------------------------------------

console.log('\nbundle: anchors, syntax, round trip');
{
  let ext = null;
  try {
    ext = P.findExtensionDir();
  } catch (_) { /* not installed */ }

  if (!ext) {
    skip('bundle checks', 'no anthropic.claude-code install found');
  } else {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-verify-'));
    const wv = path.join(work, 'webview');
    fs.mkdirSync(wv, { recursive: true });
    fs.copyFileSync(path.join(ext, 'webview', 'index.js'), path.join(wv, 'index.js'));
    fs.copyFileSync(path.join(ext, 'extension.js'), path.join(work, 'extension.js'));

    // The live install may already be patched (possibly at an older version).
    // Normalize the copy to pristine first, otherwise the anchor-count and
    // round-trip assertions below would be measuring a patched baseline.
    const lifted = P.remove(work);
    if (lifted.changed) console.log('  note  copy was ' + lifted.reason + ' to get a pristine baseline');

    const before = {
      'webview/index.js': fs.readFileSync(path.join(wv, 'index.js'), 'utf8'),
      'extension.js': fs.readFileSync(path.join(work, 'extension.js'), 'utf8'),
    };

    // Anchor uniqueness — the whole safety story rests on this.
    for (const [rel, from, , count] of P.editsFor(P.resolveIdents(work))[P.VERSION]) {
      check(`anchor in ${rel} occurs exactly ${count}x`, () =>
        assert.strictEqual(P.occurrences(before[rel], from), count));
    }

    check('apply() succeeds on a copy', () => {
      const r = P.apply(work);
      assert.ok(r.changed, r.reason);
    });

    check('patched webview bundle parses', () => {
      new vm.Script(fs.readFileSync(path.join(wv, 'index.js'), 'utf8'), { filename: 'index.js' });
    });
    check('patched extension.js parses', () => {
      new vm.Script(fs.readFileSync(path.join(work, 'extension.js'), 'utf8'), { filename: 'extension.js' });
    });

    check('status() reports the current version', () => {
      const s = P.status(work);
      assert.ok(s.patchedVersions.includes(P.VERSION), JSON.stringify(s.patchedVersions));
    });

    check('remove() restores both files byte-identically', () => {
      P.remove(work);
      for (const rel of Object.keys(before)) {
        const after = fs.readFileSync(path.join(work, rel), 'utf8');
        assert.strictEqual(after, before[rel], rel + ' differs after round trip');
      }
    });

    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 4. Version selection: apply a NAMED version, downgrade, and round trip.
//
// Runs entirely against a synthetic fixture in a temp dir that reproduces the
// anchors — never the live install, and never a copy of it. That keeps these
// assertions meaningful on a machine with no Claude Code installed, and keeps
// them honest about each version independently rather than only the newest.
// ---------------------------------------------------------------------------

// A minimal but syntactically valid stand-in for the two patched files. It
// embeds the exact anchor strings from patch.js, so if an anchor ever changes
// the fixture changes with it and cannot silently drift.
function makeFixture(ids) {
  const edits = P.editsFor(ids);
  const A_IMG = edits['1'].find(([f, from]) => f === 'webview/index.js' && from.startsWith('img:'))[1];
  const A_LRR = edits['2'].find(([f, from]) => f === 'extension.js' && from.startsWith('localResourceRoots:'))[1];
  const A_CSP = edits['2'].find(([f, from]) => f === 'extension.js' && from.startsWith('content='))[1];

  const bundle =
    '"use strict";\n' +
    'var ' + ids.h + '=function(){return null};var QQ=1,XA=2;\n' +
    'function render(){return ' + ids.h + '(QQ,{remarkPlugins:[XA],components:{' + A_IMG + '}})}\n' +
    'module.exports={render};\n';

  const lrrBlock = (n) => '  root' + n + '(){return {enableScripts:true,' + A_LRR + '}}\n';
  const extension =
    '"use strict";\n' +
    'const ' + ids.vs + '=require("vscode");\n' +
    'class Panel{\n' +
    lrrBlock(0) + lrrBlock(1) + lrrBlock(2) + lrrBlock(3) +
    '  getHtmlForWebview(' + ids.wv + ',' + ids.csp.join(',') + '){return `<!DOCTYPE html><html><head>\n' +
    '        <meta http-equiv="Content-Security-Policy" ' + A_CSP + '\n' +
    '      </head><body></body></html>`}\n' +
    '}\n' +
    'module.exports={Panel};\n';

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-fixture-'));
  fs.mkdirSync(path.join(work, 'webview'), { recursive: true });
  fs.writeFileSync(path.join(work, 'webview', 'index.js'), bundle, 'utf8');
  fs.writeFileSync(path.join(work, 'extension.js'), extension, 'utf8');
  return work;
}

const FIXTURE_FILES = ['webview/index.js', 'extension.js'];
const snapshot = (dir) => Object.fromEntries(
  FIXTURE_FILES.map((rel) => [rel, fs.readFileSync(path.join(dir, rel), 'utf8')]));

for (const [setName, ids] of Object.entries(IDENT_SETS)) {
console.log(`\nversion selection (${setName}): named apply, downgrade, per-version round trip`);
{
  const work = makeFixture(ids);
  const pristine = snapshot(work);

  // The fixture itself must reproduce every anchor at the expected count,
  // otherwise the assertions below would be testing nothing.
  for (const v of P.ALL_VERSIONS) {
    for (const [rel, from, , count] of P.editsFor(ids)[v]) {
      check(`fixture(${setName}): v${v} anchor in ${rel} occurs ${count}x`, () =>
        assert.strictEqual(P.occurrences(pristine[rel], from), count));
    }
  }

  // Each version applies, parses, is reported by status(), and round trips.
  for (const v of P.ALL_VERSIONS) {
    check(`apply(dir, "${v}") applies exactly v${v}`, () => {
      const r = P.apply(work, v);
      assert.ok(r.changed, r.reason);
      assert.strictEqual(r.version, v);
      const s = P.status(work);
      assert.deepStrictEqual(s.patchedVersions, [v], JSON.stringify(s.patchedVersions));
      assert.strictEqual(s.current, v === P.VERSION);
    });
    check(`v${v} patched files parse`, () => {
      for (const rel of FIXTURE_FILES) {
        new vm.Script(fs.readFileSync(path.join(work, rel), 'utf8'), { filename: rel });
      }
    });
    check(`remove() after v${v} restores byte-identical files`, () => {
      P.remove(work);
      assert.deepStrictEqual(P.status(work).patchedVersions, []);
      const after = snapshot(work);
      for (const rel of FIXTURE_FILES) {
        assert.strictEqual(after[rel], pristine[rel], rel + ' differs after v' + v + ' round trip');
      }
    });
  }

  // The rollback story: v1 -> v2 -> back to v1, never two edit sets at once.
  check('upgrade v1 -> v2 leaves only v2 applied', () => {
    P.apply(work, '1');
    const r = P.apply(work, '2');
    assert.ok(r.changed, r.reason);
    assert.deepStrictEqual(P.status(work).patchedVersions, ['2']);
  });
  check('downgrade v2 -> v1 leaves only v1 applied', () => {
    const r = P.apply(work, 'v1');            // "v1" spelling accepted too
    assert.ok(r.changed, r.reason);
    assert.strictEqual(r.version, '1');
    const s = P.status(work);
    assert.deepStrictEqual(s.patchedVersions, ['1']);
    assert.strictEqual(s.current, false, 'v1 must not be reported as current');
  });
  check('downgraded files still parse', () => {
    for (const rel of FIXTURE_FILES) {
      new vm.Script(fs.readFileSync(path.join(work, rel), 'utf8'), { filename: rel });
    }
  });
  check('downgrade left no v2 residue in extension.js', () => {
    const ext = fs.readFileSync(path.join(work, 'extension.js'), 'utf8');
    assert.strictEqual(ext, pristine['extension.js'], 'v2 extension.js edits were not lifted');
  });
  check('remove() after a downgrade still returns pristine', () => {
    P.remove(work);
    const after = snapshot(work);
    for (const rel of FIXTURE_FILES) assert.strictEqual(after[rel], pristine[rel], rel);
  });

  check('re-applying the same version is a no-op', () => {
    P.apply(work, '1');
    const r = P.apply(work, '1');
    assert.strictEqual(r.changed, false, r.reason);
    assert.deepStrictEqual(P.status(work).patchedVersions, ['1']);
    P.remove(work);
  });
  check('apply() with no version still applies the shipped VERSION', () => {
    const r = P.apply(work);
    assert.strictEqual(r.version, P.VERSION);
    assert.strictEqual(P.status(work).current, true);
    P.remove(work);
  });
  check('an unknown version is rejected without touching the files', () => {
    assert.throws(() => P.apply(work, '99'), /unknown patch version/);
    assert.deepStrictEqual(snapshot(work), pristine);
  });

  fs.rmSync(work, { recursive: true, force: true });
}
}

console.log(`\n${failures ? failures + ' FAILURE(S)' : 'all checks passed'}` +
            (skipped ? ` (${skipped} skipped)` : '') + '\n');
process.exit(failures ? 1 : 0);
