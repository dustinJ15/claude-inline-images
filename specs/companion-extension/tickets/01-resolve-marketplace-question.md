# 01 — Answer the publication question before building toward it

**What to build:** a decision, with evidence, on whether this may be published
to the extension marketplace given that it modifies another publisher's
extension on disk. The answer determines the packaging, the identity, and the
framing of everything downstream, so it is settled first rather than discovered
at the end.

**Blocked by:** None — can start immediately.

**Status:** done

**Decision recorded in:** [../decision-publication.md](../decision-publication.md)

- [x] Current marketplace policy is read, not inferred. The existence of a similar published extension is precedent, not permission.
- [x] The decision and the reasoning behind it are recorded in this spec folder.
- [x] If publication is not acceptable, the fallback is chosen — a release plus a command-line installer — and the remaining tickets are re-scoped before any packaging work begins.
- [x] Either way, the answer is known before ticket 07.

**Outcome:** publication to the Microsoft Marketplace is **not** the chosen
initial channel. Microsoft's own policy is ambiguous — it contains no clause
about modifying another publisher's Offering, and its "In-Scope Products and
Services" restrictions are scoped to Microsoft/GitHub products — but Anthropic's
proprietary licence and reverse-engineering restriction apply in every channel,
and the Marketplace is where a takedown is unilateral and retroactive.
Fallback chosen: **GitHub release (.vsix + the standalone CLI patcher), mirrored
to Open VSX**, with explicit unofficial/modifies-files disclosure. Tickets 07
and 08 should be read against the "Consequences for ticket 08" section of the
decision document, which fixes packaging, extension identity, and README
framing. Revisit only if the upstream issue (ticket 02) is declined.
