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

function injectedUrlTransform() {
  const frag = P.EDITS['2'].find(([f, , to]) => f === 'webview/index.js' && to.includes('urlTransform'))[2];
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

  const ours = P.EDITS['2'].find(([f, from]) => f === 'webview/index.js' && from === ',components:{');
  const patched = pristine.replace(ours[1], ours[2]);

  check('KaTeX regex still matches after our patch', () =>
    assert.ok(KATEX_RE.test(patched), 'our insertion broke the KaTeX anchor'));
  check('our prop lands after remarkPlugins, not before', () =>
    assert.ok(patched.indexOf('remarkPlugins') < patched.indexOf('urlTransform')));
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
    for (const [rel, from, , count] of P.EDITS[P.VERSION]) {
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

console.log(`\n${failures ? failures + ' FAILURE(S)' : 'all checks passed'}` +
            (skipped ? ` (${skipped} skipped)` : '') + '\n');
process.exit(failures ? 1 : 0);
