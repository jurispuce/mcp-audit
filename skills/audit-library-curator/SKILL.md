---
name: audit-library-curator
description: "Maintain the reusable requirement library in mcp-audit: import a law or standard from a document, improve the 'how to audit this' guidance for requirements, refine general audit criteria, and add or correct typed links between requirements across sources (details, explains, implements, equivalent, conflicts). Use this skill whenever the user wants to capture lessons learned from an audit, improve audit guidance or criteria, map one standard to another (for example NIS 2 to ISO 27001), import or update a standard or regulation, or tidy the requirement library."
---

# Audit library curator

The library is what makes the second audit faster than the first. After an engagement, carry over what was learned about how to audit each requirement, without carrying over anything about the client.

Read `references/audit-rules.md` first. This skill works through the mcp-audit connector; if its tools are not available, tell the auditor to connect mcp-audit and stop.

## Tools

| To | Use |
| --- | --- |
| Find requirements | `search_requirements` (code, title or text; diacritics ignored), then `get_requirement` for text, links, guidance and criteria |
| Name a requirement | its id, or `"<source code>:<reference>"`, for example `"nis2:Art. 21(2)(d)"` |
| Improve guidance | `set_guidance` with the full new text; pass `base_version` from `get_requirement` so you never overwrite a newer edit |
| Refine general criteria | `set_criteria` with `mode: add`, or `mode: replace` with the complete list when the auditor agreed to the whole set |
| Map sources | first ask the auditor which existing source to map to; then `link_requirements` in batches, each with a one-line reason in `note` (start it with "Low confidence:" where it applies) |
| Import a law or standard | `list_library_documents`, then `get_library_document_text` page by page (or the file the auditor gave you); then `upsert_sources` with `document_id`, then `upsert_requirements` with the reference as written, a short title, the text (licence permitting) and `parent` |
| Update a standard | `upsert_requirements` (only the fields you give change) |
| See what waits for review | `list_library_proposals` |
| Undo, explain a change | `get_history`, `revert`, `add_comment` |

Everything you write to the library is a proposal: a new source stays unpublished, and new or changed requirements and links wait until the auditor accepts them on Library, Review and Library, Mapping. Proposed requirements are not used in audits. End every import or mapping by telling the auditor how many proposals wait and where.

## What can be improved

**Guidance**: how to audit a requirement in practice. Good guidance says who to ask, what record proves operation, what a weak answer sounds like, and the common ways organisations get it wrong. A short paragraph or a few bullets.

**General criteria**: what evidence must show for any organisation. Promote an engagement-specific criterion only if it would hold for most auditees.

**Links**: typed and directional.

| Type | Meaning | Example |
| --- | --- | --- |
| details | this requirement spells out part of the target | ISO A.5.18 details ISO A.5.15 |
| explains | this text clarifies how to read the target | a guidance clause explains a normative one |
| implements | meeting this contributes to meeting the target | ISO A.8.13 implements NIS 2 Art. 21(2)(c) |
| equivalent | the two ask for the same thing | use sparingly; add a note on any difference |
| conflicts | meeting one makes the other harder | rare; always add a note |

## Steps

### 1. Collect lessons

With the auditor, or from a finished engagement they point to: evidence items that turned out decisive, criteria added during the engagement, requirements where evidence was hard to get or the first plan missed something, links the auditor relied on.

### 2. Generalise and strip

Rewrite each lesson so it makes sense to an auditor who never saw this client. Remove names, systems, numbers, dates, document titles and anything else that could identify the auditee. If a lesson cannot be stated without those details, it does not belong in the library.

### 3. Propose changes

Show the auditor each change as before and after, per requirement, and write only once they agree: library changes affect every future engagement. Existing engagements are unaffected, since they pinned their requirements at selection time; say so when asked.

### 4. Import a source

Keep the source's own structure through `parent` and its exact reference codes and wording. For public law store the text; for licensed standards, codes and titles unless the auditor confirms the licence allows more.

### 5. Cross-source mapping

Work requirement by requirement; read both sides with `get_requirement` first (existing links show up there). Propose links with a one-line justification each and mark low-confidence ones so the auditor reviews those first. Many-to-many is normal. Do not force a link where the two texts merely share a topic.

## Judgement notes

- The confidentiality rule matters most here. When unsure whether something identifies the client, leave it out.
- Keep guidance practical and short. If it reads like the standard restated, it adds nothing.
- Never delete existing guidance; replace it with an improved version and explain the change with `add_comment`.
