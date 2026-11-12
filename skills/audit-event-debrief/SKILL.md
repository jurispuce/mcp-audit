---
name: audit-event-debrief
description: "Process what came out of an audit event: read auditor notes, transcripts, screenshots and documents, attribute them to the planned evidence, work out what is still missing and what was promised for later, record suspected issues, and draft the post-event report for the auditee. Use this skill whenever the user has finished or is in the middle of an audit interview, walkthrough or review and shares notes, a transcript or files from it, asks what is still missing, wants a follow-up list, or needs a post-interview report or meeting summary for an audit."
---

# Audit event debrief

After an event the auditor has raw material and a plan. Connect the two: say which planned evidence is now in hand, how well it supports the requirement, what is still owed and by whom, and what the auditor should worry about.

Read `references/engagement-files.md` first, including the auditor notes format. The report template is `assets/post-event-report-template.md`.

## Where the event lives

- **App mode.** When the mcp-audit tools are available (`get_event_status`, `upsert_notes`, `link_evidence`, `render_post_event_report`), the event is in the audit app. Use the tools; do not write YAML or Markdown files.
- **Files mode.** Without those tools, work in `events/<event-id>/` as described below.

### In app mode

| Step | Use |
| --- | --- |
| Find the event | `list_engagements`, then `list_events`; `get_event_status` gives its planned evidence (with status and links), notes and participants |
| 1. Gather | a transcript from another tool or pasted in chat: `register_artifact` (kind `transcript`); files the auditor uploaded on the event screen: `list_artifacts` and `get_artifact_text` |
| 2. Structure | `upsert_notes` with `type` note, promise or issue and `mentions` (`{type, id, label}` from `get_event_status` and `get_engagement_overview`). A promise mentioning planned evidence sets it to promised; give `due` only when a date was said. A document mentioned but not received: an `artifact` mention with an empty `id` |
| 3. Attribute | `link_evidence` with `artifact_id`, `evidence_item_id`, `locator`, a short `excerpt` and `sufficiency`. Links are proposed: the evidence becomes received only when the auditor confirms them |
| 4. Statuses | statuses follow the confirmed links; for evidence clearly not provided, say so in your summary rather than changing statuses |
| 5. Report | `render_post_event_report` (Markdown to show; `docx` or `pdf` to save it). It never contains suspected issues, sufficiency or criticality |
| 6. Tell the auditor | how many links and notes wait on the event screen (Run, the event), and what is still outstanding |

If a tool answers `forbidden` because AI is switched off for the engagement, stop and tell the auditor. Everything you write shows in the app as "Claude on behalf of <auditor>".

## Steps

### 1. Gather the event's material

Read `events/<event-id>/notes.md` and everything in `materials/`. If a transcript comes from a recording tool or another connected source, save it into `materials/` first so it is part of the record. If the auditor pastes notes in chat, write them to `notes.md` before anything else.

### 2. Read the notes for structure

From typed lines (`/promise`, `/issue`, `/document`, `/requirement`) and `@` mentions, and from plain prose when the format was not used, extract:

- **promises**: what, who (role), by when. No date given means "no date", not a guess.
- **suspected issues**: what the auditor suspects, and which requirement it concerns.
- **documents mentioned** that were not received: add them to `documents/documents.yaml` with `state: mentioned`.

Say which of these you inferred from prose rather than read from a typed line.

### 3. Attribute material to planned evidence

For each planned evidence item of this event, look for material that addresses it. Write a link in `links.yaml` with:

- `locator`: page, paragraph, cell range or transcript timestamp,
- `excerpt`: the few words that matter, in the original language,
- `sufficiency`:
  - `supports`: the material shows what the evidence item asked for,
  - `partial`: it points the right way but is incomplete, covers a shorter period, or is testimony only,
  - `contradicts`: it shows the requirement was not met,
- `status: proposed`.

What someone said in an interview supports understanding, but for evidence of kind `record`, `observation` or `technical` it is at most `partial` until a record or observation backs it. One piece of material may link to several evidence items, and material that fits no planned item should be listed as "unplanned, possibly relevant to <requirement>".

### 4. Propose evidence statuses

In `plan/evidence.yaml`, propose for each item: `received` (a `supports` link exists), `partial`, `promised` (with `promised_by` and `promised_due` from the notes), or `missing`. Do not downgrade a status the auditor set by hand; flag the disagreement instead.

### 5. Write the post-event report

Fill `assets/post-event-report-template.md` in the report language and save it to `events/<event-id>/post-event-report.md`. It is meant to be shared with the people who attended, so it contains: what was covered, what was received, what is still outstanding, and who promised what by when.

It must not contain suspected issues, sufficiency judgements, criticality or anything that reads as a preliminary finding. Those go in the summary to the auditor only.

### 6. Tell the auditor

Finish with the summary: links proposed, evidence still missing sorted by criticality, promises with owners and dates, suspected issues with the requirement they touch, and any requirement of this event that now has no evidence path at all.

## Judgement notes

- Quote, do not characterise. "41 accounts reviewed, 3 removed" is useful; "reviews seem adequate" is a finding in disguise.
- A transcript is not verbatim truth: speech recognition mangles names, numbers and Latvian terms. Flag numbers and dates you rely on so the auditor can check them.
- If the material contradicts a document from `documents/`, record both locators. That contrast is often the most valuable output of the event.
- Never mark anything `confirmed`. Acceptance is the auditor's.
