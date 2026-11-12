---
name: audit-library-curator
description: "Maintain the reusable audit requirement library after or between engagements: improve the 'how to audit this' guidance for requirements, refine general audit criteria, and add or correct typed links between requirements across sources (details, explains, implements, equivalent, conflicts). Use this skill whenever the user wants to capture lessons learned from an audit, improve audit guidance or criteria, map one standard to another (for example NIS 2 to ISO 27001), import or update a standard, or tidy the requirement library."
---

# Audit library curator

The library is what makes the second audit faster than the first. After an engagement, carry over what was learned about how to audit each requirement, without carrying over anything about the client.

Read `references/engagement-files.md` first. Source files live in `library/sources/` in the shape shown in `audit-engagement-setup`.

## What can be improved

**Guidance** (`guidance` on a requirement): how to audit it in practice. Good guidance says who to ask, what record proves operation, what a weak answer sounds like, and the common ways organisations get it wrong. Keep it to a short paragraph or a few bullets.

**General criteria** (`criteria` on a requirement): what evidence must show for any organisation. Promote an engagement-specific criterion only if it would hold for most auditees.

**Links** (`links` on a requirement): typed and directional.

| Type | Meaning | Example |
| --- | --- | --- |
| details | this requirement spells out part of the target | ISO A.5.18 details ISO A.5.15 |
| explains | this text clarifies how to read the target | a guidance clause explains a normative one |
| implements | meeting this contributes to meeting the target | ISO A.8.13 implements NIS 2 Art. 21(2)(c) |
| equivalent | the two ask for the same thing | use sparingly; add a note on any difference |
| conflicts | meeting one makes the other harder | rare; always add a note |

## Steps

### 1. Collect lessons

With the auditor, or from a finished engagement folder they point to, look for:

- evidence items that turned out to be the decisive ones,
- criteria that were added during the engagement,
- requirements where evidence was hard to get or the first plan missed something,
- links between requirements the auditor relied on.

### 2. Generalise and strip

Rewrite each lesson so it would make sense to an auditor who never saw this client. Remove names, systems, numbers, dates, document titles and anything else that could identify the auditee. If a lesson cannot be stated without those details, it does not belong in the library; leave it in the engagement.

### 3. Propose changes

Show the auditor each change as before and after, per requirement. Do not write to the library until they agree; library changes affect every future engagement. Then update the source file, set `updated` on the requirement, and log the change in `library/log.md`.

Existing engagements are unaffected: they pinned their requirements at selection time. Say so when the auditor asks whether a change will alter an audit in progress.

### 4. Cross-source mapping

When asked to map one source to another, work requirement by requirement, propose links with a one-line justification each, and mark low-confidence links so the auditor reviews those first. A many-to-many mapping is normal. Do not force a link where the two texts merely share a topic.

## Judgement notes

- The confidentiality rule is the one that matters most here. When unsure whether something identifies the client, leave it out.
- Keep guidance practical and short. If it reads like the standard restated, it adds nothing.
- Do not reproduce licensed standard text into guidance or notes.
- Never delete existing guidance; replace it with an improved version and note what changed in the log.
