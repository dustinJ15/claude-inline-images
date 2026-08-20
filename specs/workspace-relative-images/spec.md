# Spec — workspace-relative images (stage 2)

## Problem Statement

Inline images work today, but every image costs 550–840 output tokens, because
the `data:` URI travels through the assistant's own message text — the model
retypes the whole thing. A 37KB PNG is ~50KB of base64, roughly 12k tokens.

That price means images are a treat, not a default. In a tutoring session where
the natural answer to "what does this transformation do" is a picture, the model
will reach for prose instead, because the picture is expensive enough to feel
like a decision. The goal is for a plot to be so cheap that drawing one is never
weighed against explaining in words.

The mechanism already exists in the repo — `patch.js` v2 resolves scheme-less
markdown paths against the workspace root, so `![](plots/foo.png)` costs about
ten tokens regardless of the image's size. It has never been rendered in a
running webview. The live install is still at v1, and the repo ships v2.

## Solution

Confirm v2 renders in a real panel, resolve the design questions it leaves open,
and make v2 the version the live install runs. Afterwards an agent references an
image by short relative path and the panel draws it.

If v2 cannot be made to work, fall back to a design that needs no `extension.js`
edit at all, and say so plainly in the docs rather than shipping an unverified
claim.

## User Stories

1. As a user studying a curve, I want the assistant to draw it by relative path, so that a plot costs about ten tokens instead of several hundred.
2. As a user, I want the assistant to feel free to draw several plots in one answer, so that a comparison is shown rather than described.
3. As a user, I want `data:` URIs to keep working after this change, so that one-off images with no file on disk are still possible.
4. As a user, I want KaTeX math to keep typesetting after v2 is applied, so that upgrading does not cost me a feature I already rely on.
5. As a user, I want the tool-result thumbnail pill to keep its normal size when the assistant reads a PNG, so that the chat log does not fill with full-size images I did not ask for.
6. As a user, I want a broken v2 to leave me back on a working v1, so that a failed experiment never costs me the working setup.
7. As a user, I want to know which files the panel is allowed to load once this lands, so that I can judge whether the widened access is acceptable to me.
8. As a user with several folders open, I want to know whether images resolve in all of them or only the first, so that I am not silently confused when one folder works and another does not.
9. As an agent, I want an unambiguous diagnostic for what I see in the panel, so that a malformed URI is not misdiagnosed as a broken patch.
10. As an agent picking this up fresh, I want the README's stated status to match reality, so that I do not build on a claim that was never verified.

## Implementation Decisions

- **The design under test is already written.** v2 injects a `<meta>` publishing
  the workspace root as a webview URI, widens the webview's allowed resource
  roots to the workspace folders, and adds a scheme-less branch to the `img`
  override that joins the two. This spec does not redesign it; it verifies it
  and resolves what it left open.

- **The single most likely failure is the resource host.** The whole design
  rests on the chat webview's CSP `img-src` already containing `${cspSource}`,
  and on `asWebviewUri` returning a host that `${cspSource}` actually covers
  once the allowed roots are widened. Everything else in v2 is mechanical.
  Check this **first**, in the webview developer tools, before checking anything
  else — a failure here invalidates the approach rather than being a bug in it.

- **Pre-agreed fallback if it does not hold:** write images into the extension's
  own resources directory, which is already an allowed root. That drops both
  `extension.js` anchors — the resource-roots edit and the CSP/meta edit — and
  reduces v2 to a webview-bundle change alone. It is strictly less code and
  strictly less risk; it is not the first choice only because it puts generated
  files inside another vendor's extension directory, where an update erases them.

- **Two open questions are resolved as part of this work, not deferred:**
  - *Multi-root workspaces.* Only the first workspace folder is published today.
    Either publish all of them, or document the limit in the README. Silently
    working for one folder and not another is the one unacceptable outcome.
  - *Breadth of access.* Widening the allowed roots to the entire workspace lets
    the panel load any file under it as an image. Model output is
    attacker-influenceable, so this is a real if minor widening of what a
    prompt-injected message could cause to be fetched. Decide explicitly:
    accept it, or scope it to a named subdirectory.

- **The upstream security posture is preserved, unchanged.** The URL transform
  is not widened to identity. External URLs stay blocked, and the relative-path
  branch fires only for scheme-less paths. This is not negotiable in service of
  making the feature work.

- **Rollback is part of the deliverable, not a contingency.** The live install
  is a working v1. Any session that applies v2 and cannot land it restores v1
  before it ends.

## Testing Decisions

A good test here asserts external behaviour: what the panel draws, and what
strings the patcher actually writes. It does not assert the shape of the
injected fragment for its own sake.

- **The existing static harness is the seam for everything mechanical.** It runs
  the *actual* injected string rather than a copy, so the assertions cannot
  drift from what ships: the URL-transform allowlist, anchor uniqueness, syntax
  validity, and a byte-identical apply/remove round trip. Extend it rather than
  adding a second harness.

- **Rendering has exactly one seam, and it is a human.** Static tests prove the
  bundle parses and the strings are right. They cannot prove the webview draws
  an image. The loop is: apply, *Developer: Reload Webviews* (**not** Reload
  Window — that restarts the extension host and kills the session), emit an
  image, and **ask the user what they see**. Do not mark a rendering ticket done
  on static evidence.

- **The three outcomes mean different things, and confusing them costs hours:**

  | Shown | Meaning |
  |---|---|
  | the image | working |
  | `[Image]` | markdown parsed fine, patch not active — usually not reloaded |
  | raw markdown text | **the URI is malformed**, almost always an unencoded space |

  The third row is not a patch failure and looks nothing like one. A literal
  space in a markdown link destination makes CommonMark not emit an image node
  at all.

- **Regressions are checked in the same message as the feature**, so one human
  round trip covers all of it: math still typesets, and reading a PNG still
  shows its normal small thumbnail rather than a full-width image.

## Out of Scope

- The companion extension and anything about surviving Claude Code updates.
- The agent-facing skill; it is specified separately and only its emit guidance
  depends on the outcome here.
- Plotting features. This spec changes how an image is referenced, not what is
  drawn.
- Making the bundle anchors robust against a rebuild. Real, tracked separately.

## Further Notes

The per-image token cost is the whole justification, so measure it rather than
asserting it. The README currently claims 550–840 tokens per plot; once relative
paths work the real figure should be roughly ten, and the README should say the
measured number.

The README's status table presently distinguishes "verified live" from
"statically checked". Keep that distinction honest through this work — it is the
single most useful thing in the docs for whoever picks this up next.
