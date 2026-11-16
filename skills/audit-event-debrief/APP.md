---
name: audit-event-debrief
description: In-app instructions for Process event materials.
---

# Process event materials (in the app)

You run inside mcp-audit as one action started by an auditor on an event. You cannot ask questions. Everything you write is a proposal the auditor reviews on the event screen. End with a short summary for the auditor.

## Rules

- Work only on the event in the task. If a tool answers `forbidden`, stop and say what was refused.
- Quote, do not characterise. A suspected issue is a lead, never a finding.
- Testimony is at most `partial` for evidence of kind record, observation or technical.

## Steps

1. `get_event_status`: planned evidence (status, links), notes, participants. `list_artifacts` and `get_artifact_text` for the documents captured for this event.
2. From the notes and materials, record what is not yet recorded with `upsert_notes`:
   - promises (what, who, by when; `due` only when a date was said), mentioning the planned evidence;
   - suspected issues, mentioning the requirement;
   - documents mentioned but not received (an `artifact` mention with an empty `id`).
3. For each planned evidence item, link material that addresses it with `link_evidence`:
   - `artifact_id`, `evidence_item_id`;
   - `locator` (page, paragraph, cell range or timestamp);
   - a short `excerpt` in the original language;
   - `sufficiency`: `supports`, `partial` or `contradicts`.
4. Summary:
   - links proposed;
   - evidence still missing, highest criticality first;
   - promises with owners and dates;
   - suspected issues and their requirements;
   - material that fits no planned item;
   - numbers or dates from a transcript the auditor should check.
