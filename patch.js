'use strict';
/*
 * claude-inline-images — render `![alt](...)` images inline in the Claude Code
 * VSCode chat panel.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * Assistant markdown goes through exactly one react-markdown call site in
 * <ext>/webview/index.js. No `urlTransform` prop is passed there, so
 * react-markdown falls back to its stock `defaultUrlTransform`, whose scheme
 * allowlist is /^(https?|ircs?|mailto|xmpp)$/i. `data:` is absent, so every
 * data-URI image src is blanked to "" BEFORE the components map runs. The
 * extension's own `img` override already has a working data: branch and the
 * CSP already says `img-src ${cspSource} data:` — the feature is written and
 * permitted, just unreachable. v1 supplies the missing prop.
 *
 * v2 additionally lets `![alt](plots/foo.png)` resolve against the workspace,
 * so images can be referenced by short relative path instead of being inlined
 * as base64 (a 37KB PNG is ~50KB of base64, roughly 12k output tokens per
 * image, since the URI travels through the assistant's own message text).
 *
 * SECURITY
 * --------
 * Anthropic deliberately blocks external image URLs. Verbatim source comment
 * from getHtmlForWebview():
 *
 *   "Use a content security policy to only allow loading images from our
 *    extension directory or data URIs, and only allow scripts that have a
 *    specific nonce. Note: External https: URLs are blocked to prevent data
 *    exfiltration via markdown image URLs."
 *
 * That protection is preserved here:
 *   - urlTransform is NOT an identity function. It adds only `data:image/*`
 *     and otherwise reproduces defaultUrlTransform exactly, so an https: image
 *     URL still cannot reach an <img>.
 *   - the v2 relative-path branch fires ONLY for scheme-less paths, resolved
 *     against the workspace root. VSCode's own localResourceRoots is the
 *     backstop: nothing outside the workspace or extension dir can load.
 *   - data:text/html, javascript:, vbscript: and blob: all stay blocked.
 * See test/verify.js, which asserts each of these.
 *
 * COEXISTENCE WITH nuriyev.claude-code-katex
 * ------------------------------------------
 * That extension patches the same call site, anchored on a regex requiring
 * `{remarkPlugins:[` immediately after the component argument. We insert AFTER
 * the remarkPlugins array — immediately before `,components:{` — so its anchor
 * still matches and both patches apply in either order.
 *
 * RECOVERY
 * --------
 * remove() is an exact string-level inverse (test/verify.js asserts the round
 * trip is byte-identical). We deliberately keep no backup of our own: any
 * backup would be of a possibly-KaTeX-patched bundle, and restoring it later
 * could resurrect a stale KaTeX build. If KaTeX is installed, its own
 * webview/index.js.katex-bak is the true pristine original.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = '2';

// ---------------------------------------------------------------------------
// Original (unpatched) anchors. Every one is asserted to occur an exact number
// of times before anything is written; a mismatch aborts the whole patch.
// ---------------------------------------------------------------------------

const A_COMPONENTS = ',components:{';

// ---------------------------------------------------------------------------
// Identifier probes.
//
// The bundle is minified, and esbuild rerolls its short names on every release
// (the vscode module alias has been `Lt`, `Nt`, and `S4` across three Claude
// Code versions). So nothing here anchors on a minified name: each probe
// captures whatever name this particular bundle happens to use, and the edit
// strings are built from the captures. Every probe is chosen to match in BOTH
// the patched and the unpatched state, so `remove` resolves names too.
// ---------------------------------------------------------------------------

const ID = '[A-Za-z_$][A-Za-z0-9_$]*';

// The vscode module alias, from the webview's localResourceRoots. 4 sites.
const P_VS = new RegExp(
  'localResourceRoots:\\[(' + ID + ')\\.Uri\\.joinPath\\(this\\.extensionUri,"webview"\\)', 'g');

// The webview parameter of getHtmlForWebview — `e` once, `$` in 2.1.245.
const P_WV = new RegExp('getHtmlForWebview\\((' + ID + ')[,)]', 'g');

// The markdown img component: its two destructured params and the JSX factory.
// Anchored on the "[Image]" fallback, which the patch leaves untouched, with a
// bounded lazy gap so the patched body (~470 chars) still matches.
const P_IMG = new RegExp(
  'img:\\(\\{src:(' + ID + '),alt:(' + ID + ')\\}\\)=>\\{[\\s\\S]{0,900}?' +
  'return (' + ID + ')\\("span",\\{title:`Image blocked', 'g');

// The chat webview's CSP line and its five interpolated names. Deliberately
// NOT anchored on the viewport <meta> tag: that appears TWICE (the plan-preview
// webview has its own template), and patching both would corrupt the preview.
// This shape appears once; the plan preview's CSP is a literal, not a template.
const P_CSP = new RegExp(
  'content="default-src \'none\'; \\$\\{(' + ID + ')\\}; \\$\\{(' + ID + ')\\}; \\$\\{(' + ID + ')\\}; ' +
  'script-src \'nonce-\\$\\{(' + ID + ')\\}\'; \\$\\{(' + ID + ')\\};">', 'g');

/**
 * Run one probe over `src` and return its capture groups.
 * Throws unless it matches exactly `count` times with identical captures every
 * time — an ambiguous or absent probe must abort, never guess.
 */
function probe(src, re, count, what) {
  const seen = [];
  for (const m of src.matchAll(re)) seen.push(m.slice(1));
  if (seen.length !== count) {
    throw new Error(
      'could not read the bundle: ' + what + ' matched ' + seen.length + 'x, expected ' +
      count + 'x — bundle shape changed, refusing to write.');
  }
  const first = JSON.stringify(seen[0]);
  if (seen.some((c) => JSON.stringify(c) !== first)) {
    throw new Error('could not read the bundle: ' + what + ' captured conflicting names ' +
      JSON.stringify(seen) + ' — refusing to write.');
  }
  return seen[0];
}

/** Read both bundles once and resolve every minified name the edits need. */
function resolveIdents(extDir) {
  const ext = fs.readFileSync(path.join(extDir, 'extension.js'), 'utf8');
  const web = fs.readFileSync(path.join(extDir, 'webview', 'index.js'), 'utf8');
  const [vs] = probe(ext, P_VS, 4, 'localResourceRoots');
  const [wv] = probe(ext, P_WV, 1, 'getHtmlForWebview');
  const csp = probe(ext, P_CSP, 1, 'the chat CSP meta tag');
  const [src, alt, h] = probe(web, P_IMG, 1, 'the markdown img component');
  return { vs, wv, csp, src, alt, h };
}

// ---------------------------------------------------------------------------
// Anchors and injected fragments, as functions of the resolved names.
// ---------------------------------------------------------------------------

const A_LRR = (i) =>
  'localResourceRoots:[' + i.vs + '.Uri.joinPath(this.extensionUri,"webview"),' +
  i.vs + '.Uri.joinPath(this.extensionUri,"resources")]';

const A_IMG = (i) =>
  'img:({src:' + i.src + ',alt:' + i.alt + '})=>{if(' + i.src + '?.startsWith("data:"))' +
  'return ' + i.h + '("img",{src:' + i.src + ',alt:' + i.alt + '||""});' +
  'return ' + i.h + '("span",{title:`Image blocked: ${' + i.src + '||"unknown"}`,children:"[Image]"})}';

const A_CSP = (i) =>
  'content="default-src \'none\'; ${' + i.csp[0] + '}; ${' + i.csp[1] + '}; ${' + i.csp[2] + '}; ' +
  'script-src \'nonce-${' + i.csp[3] + '}\'; ${' + i.csp[4] + '};">';

// Mirrors defaultUrlTransform, plus data:image/*. Identical text in v1 and v2.
const URLT_BODY =
  'urlTransform:(u)=>{' +
  'if(typeof u!=="string")return u;' +
  'if(/^data:image\\/(png|jpe?g|gif|webp|avif|svg\\+xml)[;,]/i.test(u))return u;' +
  'let c=u.indexOf(":"),q=u.search(/[?#\\/]/);' +
  'if(c<0||(q>-1&&c>q))return u;' +
  'return /^(https?|ircs?|mailto|xmpp):$/i.test(u.slice(0,c+1))?u:""' +
  '}';

// Applied inline rather than via index.css so we never fight the tool-result
// thumbnail pill (.thumbIcon_* is 0,1,0 specificity; an img[src^="data:"] rule
// would be 0,1,1 and would win, shrinking or stretching that pill), and never
// collide with KaTeX's CSS append.
const IMG_STYLE = '{maxWidth:"100%",height:"auto",display:"block",margin:"8px 0",borderRadius:"6px"}';

const V1_IMG = (i) =>
  'img:({src:' + i.src + ',alt:' + i.alt + '})=>{if(' + i.src + '?.startsWith("data:"))' +
  'return ' + i.h + '("img",{src:' + i.src + ',alt:' + i.alt + '||"",style:' + IMG_STYLE + '});' +
  'return ' + i.h + '("span",{title:`Image blocked: ${' + i.src + '||"unknown"}`,children:"[Image]"})}';

// v2: also resolve scheme-less paths against the workspace base injected below.
// The CSS attribute selector is deliberately unquoted (meta[name=claude-ws-base])
// so this fragment needs no nested quote escaping.
const V2_IMG = (i) =>
  'img:({src:' + i.src + ',alt:' + i.alt + '})=>{let S=' + IMG_STYLE + ';' +
  'if(' + i.src + '?.startsWith("data:"))return ' + i.h + '("img",{src:' + i.src + ',alt:' + i.alt + '||"",style:S});' +
  'if(' + i.src + '&&!/^[a-z][a-z0-9+.-]*:/i.test(' + i.src + ')){' +
  'if(window.__CII_WS===void 0)window.__CII_WS=(document.querySelector("meta[name=claude-ws-base]")||{}).content||"";' +
  'if(window.__CII_WS)return ' + i.h + '("img",{src:window.__CII_WS.replace(/\\/$/,"")+"/"+' + i.src + '.replace(/^\\.?\\//,""),alt:' + i.alt + '||"",style:S})}' +
  'return ' + i.h + '("span",{title:`Image blocked: ${' + i.src + '||"unknown"}`,children:"[Image]"})}';

// Widen the webview's allowed resource roots to include the open workspace
// folder(s), so webview URIs under the workspace resolve. No CSP change is
// needed: img-src already contains ${cspSource}.
const R_LRR = (i, v) =>
  'localResourceRoots:[' + i.vs + '.Uri.joinPath(this.extensionUri,"webview"),' +
  i.vs + '.Uri.joinPath(this.extensionUri,"resources"),' +
  '.../*claude-inline-images:v' + v + '*/((' + i.vs + '.workspace.workspaceFolders||[]).map((W)=>W.uri))]';

// Publish the workspace root as a webview URI. Built with the webview's own
// asWebviewUri so the vscode-cdn host is never hardcoded.
const R_CSP = (i, v) =>
  A_CSP(i) +
  '\n        <meta name="claude-ws-base" data-cii="v' + v + '" content="${' +
  '(' + i.vs + '.workspace.workspaceFolders&&' + i.vs + '.workspace.workspaceFolders[0])' +
  '?' + i.wv + '.asWebviewUri(' + i.vs + '.workspace.workspaceFolders[0].uri).toString():""' +
  '}">';

// ---------------------------------------------------------------------------
// Edit table, per version. Each entry: [file, original, replacement, count].
// Built per-install from the resolved names; the strings themselves are exact,
// so the staging, counting, and byte-identical inverse below are unchanged.
// ---------------------------------------------------------------------------

function editsFor(i) {
  return {
    '1': [
      ['webview/index.js', A_COMPONENTS, ',/*claude-inline-images:v1*/' + URLT_BODY + ',components:{', 1],
      ['webview/index.js', A_IMG(i), V1_IMG(i), 1],
    ],
    '2': [
      ['webview/index.js', A_COMPONENTS, ',/*claude-inline-images:v2*/' + URLT_BODY + ',components:{', 1],
      ['webview/index.js', A_IMG(i), V2_IMG(i), 1],
      ['extension.js', A_LRR(i), R_LRR(i, '2'), 4],
      ['extension.js', A_CSP(i), R_CSP(i, '2'), 1],
    ],
  };
}

const ALL_VERSIONS_SRC = ['1', '2'];

// Numeric sort, so v10 orders after v9 rather than before it.
const ALL_VERSIONS = ALL_VERSIONS_SRC.slice().sort((a, b) => Number(a) - Number(b));

// ---------------------------------------------------------------------------
// Target discovery
// ---------------------------------------------------------------------------

// Every place VSCode and its forks keep extensions. A directory that does not
// exist is skipped, not an error — most machines will only have one of these.
function extensionRoots() {
  const h = os.homedir();
  const roots = [
    path.join(h, '.vscode', 'extensions'),                    // VSCode (all platforms)
    path.join(h, '.vscode-insiders', 'extensions'),           // Insiders
    path.join(h, '.vscode-oss', 'extensions'),                // VSCodium
    path.join(h, '.vscode-server', 'extensions'),             // Remote SSH / WSL / devcontainer
    path.join(h, '.vscode-server-insiders', 'extensions'),
    path.join(h, '.var/app/com.visualstudio.code/data/vscode/extensions'), // Flatpak
  ];
  // Honoured by VSCode itself, and the escape hatch for --extensions-dir and
  // portable installs.
  if (process.env.VSCODE_EXTENSIONS) roots.unshift(process.env.VSCODE_EXTENSIONS);
  return roots;
}

function versionOf(dirname) {
  const m = dirname.match(/-(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}

/** Every installed, non-obsolete Claude Code extension, newest last. */
function listInstalls() {
  const found = [];
  for (const root of extensionRoots()) {
    let entries;
    try {
      entries = fs.readdirSync(root);
    } catch (_) {
      continue;                                   // root absent — normal
    }
    let obsolete = {};
    try {
      obsolete = JSON.parse(fs.readFileSync(path.join(root, '.obsolete'), 'utf8'));
    } catch (_) { /* absent is fine */ }

    for (const d of entries) {
      if (!/^anthropic\.claude-code-/.test(d)) continue;
      if (obsolete[d]) continue;                  // superseded, pending cleanup
      const dir = path.join(root, d);
      if (!fs.existsSync(path.join(dir, 'webview', 'index.js'))) continue;
      found.push({ dir, root, name: d, version: versionOf(d) });
    }
  }
  found.sort((a, b) =>
    a.version[0] - b.version[0] || a.version[1] - b.version[1] || a.version[2] - b.version[2]);
  return found;
}

// When this runs from inside Claude Code, the env names the exact install that
// is running -- far better than guessing. Walk up from the binary to the
// extension root.
function fromExecPath(execPath) {
  let d = path.dirname(execPath);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, 'webview', 'index.js'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

/**
 * Resolve which install to patch. Order, most authoritative first:
 *   1. explicit argument (CLI --ext-dir)
 *   2. CLAUDE_CODE_EXT_DIR
 *   3. CLAUDE_CODE_EXECPATH — set when run from inside Claude Code
 *   4. scan of all known extension roots, newest version wins
 */
function findExtensionDir(explicit) {
  const pick = explicit || process.env.CLAUDE_CODE_EXT_DIR;
  if (pick) {
    if (!fs.existsSync(path.join(pick, 'webview', 'index.js'))) {
      throw new Error(pick + ' does not look like a Claude Code extension (no webview/index.js)');
    }
    return pick;
  }

  if (process.env.CLAUDE_CODE_EXECPATH) {
    const d = fromExecPath(process.env.CLAUDE_CODE_EXECPATH);
    if (d) return d;
  }

  const installs = listInstalls();
  if (!installs.length) {
    throw new Error(
      'no active anthropic.claude-code extension found. Searched:\n' +
      extensionRoots().map((r) => '  ' + r).join('\n') +
      '\nPass --ext-dir <path> or set CLAUDE_CODE_EXT_DIR if it lives elsewhere.'
    );
  }
  return installs[installs.length - 1].dir;
}

function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) {
    const j = hay.indexOf(needle, i);
    if (j < 0) return n;
    n++; i = j + needle.length;
  }
}

function replaceAll(hay, from, to) { return hay.split(from).join(to); }

function writeAtomic(file, contents) {
  const tmp = file + '.cii-tmp';
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

function versionsPresent(dir, idents) {
  let edits;
  try {
    edits = editsFor(idents || resolveIdents(dir));
  } catch (_) {
    return [];                      // unreadable bundle — report as unpatched
  }
  return ALL_VERSIONS.filter((v) =>
    edits[v].every(([rel, , to]) => {
      const f = path.join(dir, rel);
      return fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes(to);
    })
  );
}

/**
 * Resolve a user-supplied version name to a known patch version.
 * Accepts '1', 'v1', 'V1', and undefined/'' (meaning: the version this repo
 * ships, i.e. VERSION). Anything else throws rather than silently defaulting —
 * a typo must not quietly apply a version the caller did not ask for.
 */
function normalizeVersion(version) {
  if (version === undefined || version === null || version === '') return VERSION;
  const v = String(version).trim().replace(/^v/i, '');
  if (!ALL_VERSIONS.includes(v)) {
    throw new Error(
      'unknown patch version "' + version + '" — known versions: ' +
      ALL_VERSIONS.map((x) => 'v' + x).join(', ')
    );
  }
  return v;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

// Apply an edit set in one direction. direction === -1 reverses it.
// Every file is staged in memory and every anchor count validated BEFORE any
// write, so a shape change aborts without leaving a half-patched bundle.
function runEdits(extDir, version, direction, idents) {
  const edits = editsFor(idents || resolveIdents(extDir))[version];
  const staged = new Map();

  const read = (rel) => {
    if (!staged.has(rel)) staged.set(rel, fs.readFileSync(path.join(extDir, rel), 'utf8'));
    return staged.get(rel);
  };

  for (const [rel, orig, repl, count] of edits) {
    const from = direction === 1 ? orig : repl;
    const to = direction === 1 ? repl : orig;
    const src = read(rel);
    const found = occurrences(src, from);
    if (found !== count) {
      throw new Error(
        rel + ': anchor occurs ' + found + 'x, expected ' + count + 'x — bundle shape changed, refusing to write.\n' +
        '  anchor: ' + from.slice(0, 90) + (from.length > 90 ? '…' : '')
      );
    }
    staged.set(rel, replaceAll(src, from, to));
  }

  for (const [rel, contents] of staged) writeAtomic(path.join(extDir, rel), contents);
  return [...staged.keys()];
}

function status(extDir) {
  const dir = findExtensionDir(extDir);
  const bundle = fs.readFileSync(path.join(dir, 'webview', 'index.js'), 'utf8');
  let idents = null, identError = null;
  try {
    idents = resolveIdents(dir);
  } catch (e) {
    identError = e.message;
  }
  const present = versionsPresent(dir, idents);
  return {
    extDir: dir,
    identError,
    patchedVersions: present,
    current: present.includes(VERSION),
    latestVersion: VERSION,
    knownVersions: ALL_VERSIONS.slice(),
    katexPatched: bundle.includes('__KATEX_V2_LOADED'),
  };
}

/**
 * Apply a specific patch version, lifting any other version first so exactly
 * one edit set is ever present. `version` may be omitted (meaning the version
 * this repo ships), or named as '1' / 'v1' — that is how a failed experiment is
 * rolled back to a known-good version instead of only to unpatched.
 */
function apply(extDir, version) {
  const target = normalizeVersion(version);   // validate BEFORE touching anything
  const dir = findExtensionDir(extDir);
  const idents = resolveIdents(dir);          // throws on a shape change, before any write
  const present = versionsPresent(dir, idents);

  const lifted = [];
  for (const v of present) {
    if (v === target) continue;
    runEdits(dir, v, -1, idents);
    lifted.push(v);
  }

  if (present.includes(target)) {
    return {
      changed: lifted.length > 0,
      reason: lifted.length
        ? 'removed v' + lifted.join(',v') + '; already patched at v' + target
        : 'already patched at v' + target,
      version: target,
      extDir: dir,
    };
  }

  const files = runEdits(dir, target, 1, idents);
  let reason = 'patched at v' + target;
  if (lifted.length) {
    const dir_ = lifted.every((v) => Number(v) < Number(target)) ? 'upgraded'
      : lifted.every((v) => Number(v) > Number(target)) ? 'downgraded'
      : 'switched';
    reason = dir_ + ' from v' + lifted.join(',v') + ' to v' + target;
  }
  return { changed: true, reason, version: target, filesChanged: files, extDir: dir };
}

function remove(extDir) {
  const dir = findExtensionDir(extDir);
  const idents = resolveIdents(dir);
  const present = versionsPresent(dir, idents);
  if (!present.length) return { changed: false, reason: 'not patched', extDir: dir };
  for (const v of present) runEdits(dir, v, -1, idents);
  return { changed: true, reason: 'removed v' + present.join(',v'), extDir: dir };
}

module.exports = {
  apply, remove, status, findExtensionDir, listInstalls, extensionRoots,
  normalizeVersion, VERSION, ALL_VERSIONS, editsFor, resolveIdents, occurrences,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--ext-dir');
  const dir = i >= 0 ? argv[i + 1] : undefined;
  if (i >= 0) argv.splice(i, 2);
  const cmd = argv[0] || 'status';
  const arg = argv[1];

  const USAGE =
    'usage: node patch.js [apply [<version>]|remove|status|list] [--ext-dir <path>]\n' +
    '  apply            apply the version this repo ships (v' + VERSION + ')\n' +
    '  apply <version>  apply a named version, e.g. `apply 1` or `apply v1`;\n' +
    '                   any other version present is lifted first, so a failed\n' +
    '                   experiment rolls back to a known-good version rather\n' +
    '                   than to unpatched. known: ' + ALL_VERSIONS.map((v) => 'v' + v).join(', ') + '\n' +
    '  remove           lift every applied version (exact, byte-identical inverse)\n' +
    '  status           which versions are applied, and whether it is current\n' +
    '  list             which installs were found, and which one is selected';

  try {
    const out = cmd === 'apply' ? apply(dir, arg)
      : cmd === 'remove' ? remove(dir)
      : cmd === 'status' ? status(dir)
      : cmd === 'list' ? {
          searched: extensionRoots(),
          installs: listInstalls().map((x) => ({ dir: x.dir, version: x.version.join('.') })),
          selected: (() => { try { return findExtensionDir(dir); } catch (_) { return null; } })(),
        }
      : (() => { throw new Error(USAGE); })();
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('ERROR: ' + e.message);
    process.exit(1);
  }
}
