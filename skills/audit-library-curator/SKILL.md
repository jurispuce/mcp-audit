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
| Import a law or standard | `list_library_documents`, then `get_library_document_text` page by page (or the file the auditor gave you); find the roles and ask which to import; then `upsert_sources` with `document_id` and `roles`, then `upsert_requirements` with the reference as written, a short title, a self-contained text, `source_text`, `roles` and `parent` (see step 4) |
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

Keep the source's own structure through `parent` and its exact reference codes. For public law store the text; for licensed standards, codes and titles unless the auditor confirms the licence allows more.

**Roles first.** Read the subject matter, scope and definitions, and find whom the document sets auditable obligations for: for example essential and important entities, providers and deployers, or an entity and its IS auditor. Leave out the state, supervisors and other authorities unless the document is about them. Record the roles on the source with `upsert_sources` (`roles`: a short key, the label as the document names it, and a one-line description citing the definition). Then show the auditor the roles and ask which to import: all, one or several, and whether any are missing. A document with one addressee needs no question. When the source already has roles, keep them exactly as they are and only add: removing or renaming a role is done by the auditor on Library, Import. Extracting for more roles later keeps the existing requirements: add the new role keys to those that also apply, and add only what is new.

**Auditable requirements only.** Import a provision only when it obliges a chosen role to do, have or document something an auditor can check with evidence. Skip recitals, scope and definitions, duties of the state or supervisors, delegations, penalties, amendments to other acts and transitional and final provisions. Keep a chapter or article as a heading (reference and title, no text) only where it holds auditable requirements. Tell the auditor what you skipped, by group, with the reason.

**One role per requirement where it matters.** Give each requirement `roles`, the keys it applies to; leave it out when it applies to all of them. Where one provision sets different obligations for different roles, make one requirement per role, with the role key in square brackets after the reference, for example `Art. 5(1) [important]`.

**Self-contained text.** Write `text` so it can be audited without the document at hand: spell out what a reference to another provision says, as far as the audit needs it, in the document's language and terms, adding nothing it does not say. Put the original passage in `source_text` whenever the text differs from it. Name references to other acts rather than copying them in.

### 5. Cross-source mapping

Work requirement by requirement; read both sides with `get_requirement` first (existing links show up there). Propose links with a one-line justification each and mark low-confidence ones so the auditor reviews those first. Many-to-many is normal. Do not force a link where the two texts merely share a topic.

## Judgement notes

- The confidentiality rule matters most here. When unsure whether something identifies the client, leave it out.
- Keep guidance practical and short. If it reads like the standard restated, it adds nothing.
- Never delete existing guidance; replace it with an improved version and explain the change with `add_comment`.
