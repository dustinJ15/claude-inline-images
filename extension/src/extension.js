'use strict';
/*
 * claude-inline-images — companion extension.
 *
 * The patch lives in exactly one place: ../../patch.js (the repo root patcher,
 * vendored next to this file when packaged). This module never contains an edit
 * table, an anchor, or an injected fragment — it only decides WHEN to call the
 * patcher, and makes the outcome visible.
 *
 * Behaviour, in one paragraph: on `onStartupFinished` we resolve the running
 * Claude Code install through the editor's own extension registry, ask the
 * patcher whether the current version stamp is present, and patch only if it is
 * not. A patched install therefore starts up with nothing written, nothing
 * reloaded, and nothing shown. When we do patch, we reload the webviews once so
 * the change takes effect without a window reload. When we cannot patch, we say
 * so in an error notification — a silent no-op is the original bug wearing a
 * different hat.
 *
 * `vscode` is never required at module load; it is injected. That keeps the
 * whole file testable under plain node (see test/extension.test.js).
 */

const fs = require('fs');
const path = require('path');

const SECTION = 'claudeInlineImages';
const TARGET_ID = 'anthropic.claude-code';
const RELOAD_COMMAND = 'workbench.action.webview.reloadWebviewAction';

/**
 * Locate the one patcher. When packaged, patch.js is vendored beside this file;
 * when running from the repo it is two levels up. Never a second copy of the
 * logic — just a second place the same file might sit.
 */
function loadPatcher() {
  const candidates = [
    path.join(__dirname, 'patch.js'),
    path.join(__dirname, '..', 'patch.js'),
    path.join(__dirname, '..', '..', 'patch.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return require(c);
  }
  throw new Error(
    'claude-inline-images: patch.js not found (looked in ' + candidates.join(', ') + ')'
  );
}

function getPatcher(deps) {
  return (deps && deps.patch) || loadPatcher();
}

function autoPatchEnabled(vscode) {
  try {
    return vscode.workspace.getConfiguration(SECTION).get('autoPatch', true) !== false;
  } catch (_) {
    return true;                        // a config read failure must not disable the fix
  }
}

/**
 * Resolve the install to patch.
 *
 * The registry is authoritative: it names the extension the editor is actually
 * running, including remote and portable installs that no directory heuristic
 * would find. patch.js's findExtensionDir() is a fallback only — it exists for
 * command-line use, where there is no registry to ask.
 *
 * Returns { dir, source } or { dir: null, error }.
 */
function resolveExtensionDir(deps) {
  const vscode = deps.vscode;
  const patch = getPatcher(deps);
  const tried = [];

  try {
    const ext = vscode.extensions.getExtension(TARGET_ID);
    if (ext && ext.extensionPath) return { dir: ext.extensionPath, source: 'registry' };
    tried.push('the editor knows no ' + TARGET_ID + ' extension');
  } catch (e) {
    tried.push('extension registry lookup failed: ' + e.message);
  }

  try {
    const dir = patch.findExtensionDir();
    if (dir) return { dir, source: 'scan' };
    tried.push('directory scan found nothing');
  } catch (e) {
    tried.push(e.message);
  }

  return { dir: null, error: tried.join('; ') };
}

/**
 * Repair a HALF-applied patch, so the patcher can be run at all.
 *
 * The scenario is ticket 05's second one and it is not hypothetical:
 * nuriyev.claude-code-katex keeps its own pristine copy of `webview/index.js`
 * and writes it back when it re-patches. That reverts our edits to the bundle
 * while leaving our edits to `extension.js` in place. patch.js's view of a
 * version is all-or-nothing — a version counts as present only when every one
 * of its edits is present — so it reports the install as unpatched and then
 * apply() aborts, correctly, because the anchors in `extension.js` have already
 * been replaced and now occur 0 times instead of 4.
 *
 * The repair is to reverse *only the fragments that are actually on disk*,
 * returning the tree to a state the patcher recognises, and then let it apply
 * normally. Note what this is not: nothing is restored from a saved copy, and
 * no copy is ever made. A copy would have captured the other extension's edits
 * and writing it back would resurrect a stale build of someone else's patch.
 * This is the same targeted string removal patch.js's remove() performs, driven
 * by the same edit table — the table is read from the patcher, never duplicated
 * here.
 *
 * Fully-present and fully-absent versions are left alone: the patcher already
 * handles both. Returns the list of versions repaired.
 */
function liftPartialVersions(patch, extDir) {
  const repaired = [];

  for (const version of patch.ALL_VERSIONS) {
    const edits = patch.EDITS[version];

    const counts = edits.map(([rel, , to]) => {
      try {
        return countOf(fs.readFileSync(path.join(extDir, rel), 'utf8'), to);
      } catch (_) {
        return 0;                       // unreadable file — treat as absent
      }
    });
    const present = counts.filter((n) => n > 0).length;
    if (present === 0 || present === counts.length) continue;   // clean either way

    const staged = new Map();
    edits.forEach(([rel, from, to], i) => {
      if (!counts[i]) return;
      const file = path.join(extDir, rel);
      const src = staged.has(file) ? staged.get(file) : fs.readFileSync(file, 'utf8');
      staged.set(file, src.split(to).join(from));
    });
    for (const [file, contents] of staged) {
      const tmp = file + '.cii-tmp';
      fs.writeFileSync(tmp, contents, 'utf8');
      fs.renameSync(tmp, file);                       // atomic; leaves no residue
    }
    repaired.push(version);
  }

  return repaired;
}

function countOf(haystack, needle) {
  let n = 0, i = 0;
  for (;;) {
    const j = haystack.indexOf(needle, i);
    if (j < 0) return n;
    n++; i = j + needle.length;
  }
}

function showFailure(vscode, what, detail) {
  const message =
    'Claude inline images: ' + what + ' — ' + detail +
    '. Images will show as [Image] until this is fixed. Run `node patch.js apply` ' +
    'from the claude-inline-images checkout, or set "' + SECTION + '.autoPatch": false ' +
    'to stop this check.';
  try { vscode.window.showErrorMessage(message); } catch (_) { /* nothing better to do */ }
  return message;
}

/**
 * The core. Idempotent, never throws, always returns a result object:
 *   { action: 'disabled' | 'noop' | 'patched' | 'error', ... }
 */
async function ensurePatched(deps) {
  const vscode = deps.vscode;
  const patch = getPatcher(deps);

  if (!autoPatchEnabled(vscode)) {
    return { action: 'disabled', reason: SECTION + '.autoPatch is false' };
  }

  const resolved = resolveExtensionDir(deps);
  if (!resolved.dir) {
    return {
      action: 'error',
      reason: resolved.error,
      message: showFailure(vscode, 'could not find the Claude Code install', resolved.error),
    };
  }

  // Absence of the stamp is the ONLY condition. Not "on update", not "once" —
  // that is what makes recovery automatic when another extension restores its
  // own pristine backup over the same bundle.
  let state;
  try {
    state = patch.status(resolved.dir);
  } catch (e) {
    return {
      action: 'error',
      reason: e.message,
      message: showFailure(vscode, 'could not inspect the Claude Code install', e.message),
    };
  }

  if (state.current) {
    return { action: 'noop', extDir: resolved.dir, version: state.latestVersion };
  }

  // Not current. Before applying, clear any half-applied version — see
  // liftPartialVersions. Doing this only on the about-to-patch path means an
  // ordinary startup still writes nothing at all.
  let applied, repaired = [];
  try {
    repaired = liftPartialVersions(patch, resolved.dir);
    applied = patch.apply(resolved.dir);
  } catch (e) {
    return {
      action: 'error',
      reason: e.message,
      extDir: resolved.dir,
      message: showFailure(vscode, 'could not patch the Claude Code install', e.message),
    };
  }

  // Only now — a patch actually landed. Reloading the webviews on an ordinary
  // startup would be disruptive and is the reason this is inside this branch.
  try {
    await vscode.commands.executeCommand(RELOAD_COMMAND);
  } catch (e) {
    // The patch is on disk and correct; only the refresh failed.
    try {
      vscode.window.showInformationMessage(
        'Claude inline images: patch applied. Reload the webviews (Developer: Reload Webviews) to see images.'
      );
    } catch (_) { /* ignore */ }
    return { action: 'patched', reloaded: false, repaired, extDir: resolved.dir, version: applied.version, reason: applied.reason };
  }

  return { action: 'patched', reloaded: true, repaired, extDir: resolved.dir, version: applied.version, reason: applied.reason };
}

// ---------------------------------------------------------------------------
// Commands (user story 8: not being dependent on startup timing)
// ---------------------------------------------------------------------------

function registerCommands(context, deps) {
  const vscode = deps.vscode;
  const patch = getPatcher(deps);

  const withDir = (fn) => async () => {
    const resolved = resolveExtensionDir(deps);
    if (!resolved.dir) return showFailure(vscode, 'could not find the Claude Code install', resolved.error);
    try {
      return await fn(resolved.dir);
    } catch (e) {
      return showFailure(vscode, 'command failed', e.message);
    }
  };

  const commands = {
    'claudeInlineImages.apply': withDir(async (dir) => {
      const r = patch.apply(dir);
      if (r.changed) await vscode.commands.executeCommand(RELOAD_COMMAND);
      vscode.window.showInformationMessage('Claude inline images: ' + r.reason + '.');
    }),
    'claudeInlineImages.remove': withDir(async (dir) => {
      const r = patch.remove(dir);
      if (r.changed) await vscode.commands.executeCommand(RELOAD_COMMAND);
      vscode.window.showInformationMessage('Claude inline images: ' + r.reason + '.');
    }),
    'claudeInlineImages.status': withDir(async (dir) => {
      const s = patch.status(dir);
      vscode.window.showInformationMessage(
        'Claude inline images: ' +
        (s.patchedVersions.length ? 'patched at v' + s.patchedVersions.join(', v') : 'not patched') +
        (s.current ? ' (current)' : ' (shipped version is v' + s.latestVersion + ')') +
        (s.katexPatched ? '; KaTeX patch also present' : '') +
        ' — ' + s.extDir
      );
    }),
  };

  for (const [id, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }
}

async function activate(context, deps) {
  const d = Object.assign({}, deps);
  if (!d.vscode) d.vscode = require('vscode');       // lazy: keeps this file headless-testable
  registerCommands(context, d);
  return ensurePatched(d);
}

function deactivate() { /* the patch is on disk; nothing to tear down */ }

module.exports = {
  activate, deactivate, ensurePatched, resolveExtensionDir, loadPatcher, liftPartialVersions,
  SECTION, TARGET_ID, RELOAD_COMMAND,
};
