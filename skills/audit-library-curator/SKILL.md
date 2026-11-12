---
name: audit-library-curator
description: "Maintain the reusable audit requirement library after or between engagements: improve the 'how to audit this' guidance for requirements, refine general audit criteria, and add or correct typed links between requirements across sources (details, explains, implements, equivalent, conflicts). Use this skill whenever the user wants to capture lessons learned from an audit, improve audit guidance or criteria, map one standard to another (for example NIS 2 to ISO 27001), import or update a standard, or tidy the requirement library."
---

# Audit library curator

The library is what makes the second audit faster than the first. After an engagement, carry over what was learned about how to audit each requirement, without carrying over anything about the client.

Read `references/engagement-files.md` first.

## Where the library lives

Check which tools you have before you start.

- **App mode.** When the mcp-audit tools are available (`search_requirements`, `get_requirement`, `set_guidance`, `set_criteria`, `link_requirements`, `upsert_sources`, `upsert_requirements`, `list_library_documents`, `get_library_document_text`, `list_library_proposals`), the library is in the audit app. Use the tools; do not write YAML files. Every change you make is versioned and shown to the team as "Claude on behalf of <auditor>", so the app keeps the log for you.
- **Files mode.** Without those tools, the library is in `library/sources/*.yaml`, in the shape shown in `audit-engagement-setup`, with changes logged in `library/log.md`.

The steps below are the same in both modes; where they differ, the app-mode way is given first.

### In app mode

| To | Use |
| --- | --- |
| Find requirements | `search_requirements` (code, title or text; diacritics ignored), then `get_requirement` for text, links, guidance and criteria |
| Name a requirement | its id, or `"<source code>:<reference>"`, for example `"nis2:Art. 21(2)(d)"` |
| Improve guidance | `set_guidance` with the full new text; pass `base_version` from `get_requirement` so you never overwrite someone's newer edit |
| Refine general criteria | `set_criteria` with `mode: add` to add, or `mode: replace` with the complete list when the auditor agreed to the whole set |
| Map sources | first ask the auditor which existing source to map to; then `link_requirements` in batches, each with a one-line reason in `note` (start it with "Low confidence:" where it applies) |
| Import a law or standard | the document: `list_library_documents`, then `get_library_document_text` page by page (or the file the auditor gave you); then `upsert_sources` with `document_id`, then `upsert_requirements` with the reference as written, a short title, the text (licence permitting) and `parent` |
| Update a standard | `upsert_requirements` (only the fields you give change) |
| See what waits for review | `list_library_proposals` |
| Undo | `get_history` and `revert` on the item |

Everything you write to the library is a proposal: a new source stays unpublished, and new or changed requirements and links are proposed until the auditor accepts them on Library, Review and Library, Mapping. Proposed requirements are not used in audits. End every import or mapping by telling the auditor how many proposals wait and where (`list_library_proposals`).

If a tool answers `stale_write`, someone changed the item since you read it: fetch it again, show the auditor the difference, and redo the change on top. If it answers `forbidden`, do not look for a way around it; tell the auditor what was refused and why.

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

Show the auditor each change as before and after, per requirement. Do not write to the library until they agree; library changes affect every future engagement. Then write it: in app mode with `set_guidance`, `set_criteria` and `link_requirements`; in files mode by updating the source file, setting `updated` on the requirement and logging the change in `library/log.md`.

In app mode, finish by telling the auditor where to see the result: Library, open the requirement; the guidance, criteria and links show "Claude on behalf of <auditor>", and the History tab of each item can revert it.

Existing engagements are unaffected: they pinned their requirements at selection time. Say so when the auditor asks whether a change will alter an audit in progress.

### 4. Cross-source mapping

When asked to map one source to another, work requirement by requirement, propose links with a one-line justification each, and mark low-confidence links so the auditor reviews those first. A many-to-many mapping is normal. Do not force a link where the two texts merely share a topic. In app mode, read both sides with `get_requirement` first: existing links show up there and `link_requirements` reports a link that already exists instead of duplicating it.

## Judgement notes

- The confidentiality rule is the one that matters most here. When unsure whether something identifies the client, leave it out.
- Keep guidance practical and short. If it reads like the standard restated, it adds nothing.
- Do not reproduce licensed standard text into guidance or notes.
- Never delete existing guidance; replace it with an improved version and note what changed in the log (files mode) or in a comment on the guidance with `add_comment` (app mode).
