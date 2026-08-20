# Decision — may this be published to the VS Code Marketplace?

**Ticket:** [01 — Answer the publication question](tickets/01-resolve-marketplace-question.md)
**Decided:** 2026-08-18
**All policy documents below were read on 2026-08-18.**

---

## Decision

**Do not publish to the Microsoft Visual Studio Marketplace as the initial
distribution channel.** Ship instead as a **GitHub release** (`.vsix` +
the existing standalone `npx`-able patcher), **mirrored to Open VSX**, with the
"modifies another extension's files" disclosure in the first paragraph of every
surface that a prospective installer sees.

This is a *risk* decision, not a compliance finding. Microsoft's published
policy neither permits nor forbids this specific act — it is genuinely
**ambiguous**, and the analysis below shows exactly where it runs out. The
binding constraint is not Microsoft's; it is **Anthropic's licence on the
software being modified**, which is proprietary and carries a
reverse-engineering restriction. That risk exists in every channel, but the
Marketplace is the channel where a takedown is unilateral, retroactive for all
installed users, and attached to a publisher identity that is expensive to
re-establish.

Revisit the Marketplace only after the upstream issue
([`upstream-issue.md`](upstream-issue.md)) has been filed and has either been
declined or gone unanswered — and preferably only with an explicit "we don't
object" from Anthropic on that issue.

---

## What the policies actually say

### 1. Microsoft VS Marketplace Participation Policies (Last Updated June 2021)

Source: <https://cdn.vsassets.io/v/M253_20250303.9/_content/Visual-Studio-Marketplace-Participation-Policies.pdf>
(the current build served from `aka.ms/vsmarketplace-policies`; read 2026-08-18)

Three clauses in **Section 1, Base Criteria** are the closest thing to
on-point rules. All three are scoped to *"In-Scope Products and Services"*,
defined in §1(a) as:

> "(a) Offerings must be designed to work with and extend the capabilities of
> Microsoft Visual Studio, Visual Studio for Mac, Visual Studio Code, GitHub
> Codespaces, Azure DevOps, Azure DevOps Server, and successor products and
> services offered by Microsoft and GitHub (collectively, the "In-Scope
> Products and Services")."

> "(b) Publishers will not develop or enable others to develop any Offering
> which circumvents any technical restrictions implemented in the In-Scope
> Products and Services."

> "(c) Publishers will design and test the download, installation, and
> uninstallation of their Offerings to ensure that such processes do not
> disable any features or adversely affect the functionality of the In-Scope
> Products and Services."

> "(e) Publishers may not disable or otherwise change (or enable users to
> disable or otherwise change) any settings in any In-Scope Products and
> Services that Microsoft manages (or enables users to manage) in such In-Scope
> Products and Services."

**Reading these against this project:**

- **§1(b) — circumventing technical restrictions.** The restriction being
  worked around belongs to a *third-party extension*
  (`react-markdown`'s URL allowlist inside Anthropic's bundle), not to VS Code.
  The one genuine VS Code technical restriction in play is the **webview
  Content-Security-Policy**, and this patch does **not** circumvent it: the
  chat webview's CSP already contains `img-src … data:`, and the patch's
  `urlTransform` is narrower than the CSP, not wider. No `localResourceRoots`
  widening happens in v1; the v2 widening uses VS Code's own documented
  `localResourceRoots` API rather than defeating it. On the text, §1(b) is not
  breached — but note that "extension bundles are not In-Scope Products" is an
  *inference*, not something the policy states.
- **§1(c) — install/uninstall must not disable features.** This is the clause
  that most nearly bites, and it is the reason the spec's "uninstall does
  targeted string removal, never file restore" rule is a compliance property
  and not just an engineering preference. The patcher's `remove()` is asserted
  byte-identical; keep it that way. Again, §1(c) is scoped to *Microsoft's*
  products, so the letter does not cover damage to `anthropic.claude-code` —
  the spirit plainly does.
- **§1(e) — settings Microsoft manages.** Not engaged. Nothing here touches
  VS Code settings.
- **§1(i)** requires detailed technical documentation linked from the listing.
  Satisfiable, and it is where the disclosure belongs.

**§5(a)** is the operative risk clause:

> "Microsoft reserves the right to suspend or remove an Offering from the
> Visual Studio Marketplace for any reason."

with removal reasons including "(iv) The Publisher has failed to comply with
terms and conditions". "For any reason" means no policy reading, however
careful, converts into a guarantee.

### 2. Microsoft VS Marketplace Publisher Agreement (Effective June 2021)

Source: <https://cdn.vsassets.io/v/M253_20250303.9/_content/Visual-Studio-Marketplace-Publisher-Agreement.pdf>
(read 2026-08-18)

> §7 "Microsoft also may disable your Offering from operating with the In-Scope
> Products and Services if: (a) Microsoft determines that the Offering causes
> harm to Customers or their devices, third parties (including any Covered
> Parties) or any network …"

Note **"or third parties"** — this one is *not* scoped to Microsoft's products.
An assertion by Anthropic that a bundle-patching extension harms them is
sufficient grounds under this clause, with no adjudication required.

Also relevant, and the same clause list that governs naming:

> §7 grounds for suspension include "(iv) an assertion or claim that your
> Offering infringes the intellectual property rights of a third party in
> accordance with our Notice and Takedown process".

Exhibit A §2 defines a VS Code extension as an Offering that installs into
VS Code and "provide[s] new capabilities to users of that program". Nothing in
Exhibit A addresses modifying a co-installed extension.

**Nothing in either document contains a clause of the form "you may not modify
another publisher's Offering."** I looked for one. It does not exist. That
absence is the ambiguity.

### 3. Microsoft VS Marketplace / NuGet.org Terms of Use (Last Updated January 2025)

Source: <https://cdn.vsassets.io/v/M253_20250303.9/_content/Microsoft-Visual-Studio-Marketplace-Terms-of-Use.pdf>
(read 2026-08-18)

§3 restricts *use of the Sites* (damaging Microsoft servers, scraping,
unauthorised access) — it governs consumers of the Marketplace, not the
behaviour of extension code on an end user's machine. And explicitly:

> "Your right to use any Publisher Offering is governed by separate terms of
> use provided by the Publisher."

That sentence is the hinge of this whole decision: Microsoft is telling us the
governing terms for `anthropic.claude-code` are **Anthropic's**, not
Microsoft's. Which sends us to §5.

### 4. VS Code extension capabilities documentation

Source: <https://code.visualstudio.com/api/extension-capabilities/overview>
(read 2026-08-18)

> "Extensions have no access to the DOM of VS Code UI. You **cannot** write an
> extension that applies custom CSS to VS Code or adds an HTML element to
> VS Code UI." … "To ensure that extensions cannot interfere with the stability
> and performance of VS Code … we run extensions in an Extension Host process
> and prevent direct access to the DOM."

This is a statement of intent worth taking seriously even though it does not
literally cover us. The documented design goal is that extensions *do not reach
into UI they do not own*. Patching another extension's webview bundle from
Node is not blocked by the extension host — the extension host has ordinary
filesystem access — but it achieves exactly the thing this paragraph says the
architecture is meant to prevent. There is no API for what this project does,
and that is not an oversight.

<https://code.visualstudio.com/api/references/extension-manifest> (read
2026-08-18) contains no behavioural restrictions at all; it is purely
technical.

### 5. Anthropic's licence on the software being modified — the real constraint

`anthropic.claude-code` 2.1.234 `package.json` declares:

> `"license": "© Anthropic PBC. All rights reserved. Use is subject to the
> Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance"`

There is no `LICENSE` file in the extension directory. This is **proprietary,
all-rights-reserved** software — not open source, not modifiable by default.

<https://code.claude.com/docs/en/legal-and-compliance> (read 2026-08-18) routes
to two agreements:

- **Consumer Terms of Service** (effective 2025-10-08),
  <https://www.anthropic.com/legal/consumer-terms>, §3 Use of Our Services:
  > "decompile, reverse engineer, disassemble, or otherwise reduce our Services
  > to human-readable form"

  is prohibited (except where such prohibition is barred by applicable law).
- **Commercial Terms** (effective 2025-06-17),
  <https://www.anthropic.com/legal/commercial-terms>, §D.4 Use Restrictions:
  > "Customer may not and must not attempt to (a) access the Services to build
  > a competing product or service … (b) reverse engineer or duplicate the
  > Services; or (c) support any third party's attempt at any of the conduct
  > restricted in this sentence."

Reading a 5MB minified bundle to locate a call site and then rewriting it is,
on any ordinary reading, "reducing to human-readable form" and modifying. Note
that clause (c) — *supporting a third party's attempt* — is precisely what a
distributed patcher does, in every channel. It is not more permitted on GitHub
than on the Marketplace; it is merely less conspicuous and easier to withdraw.

Two honest mitigations, neither of which is a defence:

- Many jurisdictions (notably EU Directive 2009/24/EC Art. 5-6, and comparable
  fair-use doctrine elsewhere) preserve a right to modify a lawfully obtained
  copy for interoperability and error correction, which this arguably is — the
  extension's own `img` component contains a `data:` branch that never runs, so
  this is error correction in the literal sense. That is an argument, not a
  permission, and it is jurisdiction-dependent.
- Nothing is redistributed. The `.vsix` contains no Anthropic code; it carries
  a table of string edits applied on the user's own machine to their own
  lawfully installed copy.

### 6. The precedent is not permission

`nuriyev.claude-code-katex` 2.1.1 is published on the Marketplace (~5k
installs, last updated 2026-07-23) and its own listing states it "patches
Claude Code's webview bundle on startup". So this is **tolerated in practice**
today. That fact establishes exactly two things: that the Marketplace review
process does not automatically reject bundle-patching extensions, and that no
takedown has happened *yet*.

It establishes nothing about whether it is permitted. Marketplace review is not
an adjudication, §5(a) of the Participation Policies reserves removal "for any
reason", and the party with standing to object here is Anthropic, who has not
been asked. An extension surviving a year is evidence about enforcement
attention, not about policy. **Do not cite it as authority in the README, and
do not let it be the reason this ships.**

---

## Consequences for ticket 08 (packaging, identity, README)

### Packaging

- **Primary channel: GitHub release.** Build with `@vscode/vsce package` and
  attach the `.vsix`; install path is `code --install-extension <file>.vsix`.
  Keep the standalone CLI path working (`node patch.js apply`) — it is the
  fallback that makes losing any registry a non-event, and it costs nothing
  because the patcher is already standalone.
- **Secondary channel: Open VSX** (<https://open-vsx.org>, Eclipse Foundation).
  Requires an Eclipse account whose GitHub username matches, signing the Open
  VSX Publisher Agreement from the profile page, and publishing with `ovsx`.
  Namespaces are auto-created at "contributor" level; request owner level to
  clear the unverified-publisher warning. This also covers VSCodium and
  Cursor-family users, who cannot reach the Microsoft Marketplace anyway — a
  real user-facing benefit, not just a hedge.
- **No auto-update channel is available in this form**, so the extension must
  tell the user about new versions itself, or the README must be honest that
  updates are manual.
- Keep the `.vsix` minimal and inspect it (`vsce ls`): manifest, `patch.js`,
  `src/`, `icon.png`, `README.md`, `CHANGELOG.md`, `LICENSE`. No test files,
  no `specs/`.

### Extension identity

- **Do not use a publisher name or extension name that reads as Anthropic's.**
  No `anthropic.*` publisher, no `claude-code-*` extension id that could be
  mistaken for a first-party component. Something like
  `<yourhandle>.inline-images-for-claude-code` keeps the description
  referential ("for Claude Code") rather than possessive.
- **Do not use Anthropic's logo, wordmark, or colours in the icon.** Referential
  use of the *name* in the description is defensible; using the marks is not,
  and Publisher Agreement §7 makes a third-party IP assertion a sufficient
  basis for removal on its own.
- Display name should state the relationship plainly, e.g.
  "Inline Images for Claude Code (unofficial)". The word **unofficial** should
  appear in the display name or the first line of the description.
- Reserve the same publisher/namespace on Open VSX so identity is consistent if
  the Marketplace ever becomes the primary channel.

### README framing

The current README is written for GitHub and buries the disclosure. For a
distributed artefact it needs, **above the fold, before installation
instructions**:

1. "This is an unofficial extension. It is not affiliated with or endorsed by
   Anthropic."
2. "It modifies files inside the installed `anthropic.claude-code` extension on
   your machine." Say which file, say why, and say that it is a workaround for
   a missing property upstream.
3. "It can undo this completely" — with the exact command, and the statement
   that removal is asserted byte-identical, plus the note that reinstalling
   Claude Code also restores it.
4. A link to the filed upstream issue, and the sentence that if upstream fixes
   it this extension becomes unnecessary and will be retired. A workaround that
   announces its own expiry date is much easier to trust.
5. That patching may violate Anthropic's terms for the user's own installation,
   and that the user is making that call — one plain sentence, not buried in a
   footnote. This is the disclosure that matters most and it is the one most
   likely to get softened during editing. Don't soften it.

Do **not** cite `nuriyev.claude-code-katex` as evidence that this is allowed.

### Sequencing

File the upstream issue *first* (ticket 02). If it is accepted, all of this
becomes moot and the extension is never packaged, which is the best available
outcome. If it is declined, the decline itself is the clearest signal about how
Anthropic views the workaround, and the answer above can be revisited with far
better information than any policy document provides.
