'use strict';
/*
 * vscode:uninstall hook.
 *
 * Runs as `node ./src/uninstall.js` in a plain node process AFTER the editor has
 * decided to remove this extension. There is no `vscode` API here — not the
 * module, not the registry — so the install has to be found the same way the
 * command line finds it: patch.js's own discovery.
 *
 * It removes the patch by TARGETED STRING REMOVAL, which patch.js's remove()
 * already guarantees is an exact, byte-identical inverse. It does not restore
 * from a saved copy, and it does not create one at any point. A saved copy would
 * have been taken while another extension's edits to the same bundle were
 * present, so writing it back would resurrect a stale build of someone else's
 * patch — the failure this design exists to avoid.
 *
 * Every install is cleared, not just the newest: an older versioned directory
 * may still be patched, and "uninstall leaves no trace" means no trace anywhere.
 * Failures are reported and never thrown — an uninstall must not be blocked by
 * one unreachable directory.
 */

const fs = require('fs');
const path = require('path');

function loadPatcher() {
  const candidates = [
    path.join(__dirname, 'patch.js'),
    path.join(__dirname, '..', 'patch.js'),
    path.join(__dirname, '..', '..', 'patch.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return require(c);
  }
  throw new Error('claude-inline-images: patch.js not found (looked in ' + candidates.join(', ') + ')');
}

/**
 * @param {{patch?: object, dirs?: string[]}} deps
 * @returns {Array<{dir: string, changed?: boolean, reason?: string, error?: string}>}
 */
function uninstall(deps = {}) {
  const patch = deps.patch || loadPatcher();

  let dirs = deps.dirs;
  if (!dirs) {
    try {
      dirs = patch.listInstalls().map((i) => i.dir);
    } catch (e) {
      return [{ dir: null, error: e.message }];
    }
  }

  const results = [];
  for (const dir of dirs) {
    try {
      results.push(Object.assign({ dir }, patch.remove(dir)));
    } catch (e) {
      results.push({ dir, error: e.message });
    }
  }
  return results;
}

module.exports = { uninstall, loadPatcher };

if (require.main === module) {
  let results = [];
  try {
    results = uninstall();
  } catch (e) {
    console.error('claude-inline-images: uninstall hook failed: ' + e.message);
  }
  for (const r of results) {
    console.log('claude-inline-images: ' + r.dir + ' — ' + (r.error ? 'ERROR ' + r.error : r.reason));
  }
  // Always exit 0: a failed cleanup must never block the uninstall itself.
  process.exit(0);
}
