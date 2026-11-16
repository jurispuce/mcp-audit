---
name: audit-event-debrief
description: "Process what came out of an audit event in mcp-audit: read auditor notes, transcripts, screenshots and documents, link them to the planned evidence, work out what is still missing and what was promised for later, record suspected issues, and draft the post-event report for the auditee. Use this skill whenever the user has finished or is in the middle of an audit interview, walkthrough or review and shares notes, a transcript or files from it, asks what is still missing, wants a follow-up list, or needs a post-interview report or meeting summary for an audit."
---

# Audit event debrief

After an event the auditor has raw material and a plan. Connect the two: say which planned evidence is now in hand, how well it supports the requirement, what is still owed and by whom, and what the auditor should worry about.

Read `references/audit-rules.md` first. The report template is `assets/post-event-report-template.md`; the app's `render_post_event_report` fills it. This skill works through the mcp-audit connector; if its tools are not available, tell the auditor to connect mcp-audit and stop.

## Steps

### 1. Gather the event's material

Find the event (`list_engagements`, `list_events`); `get_event_status` gives its planned evidence (with status and links), notes and participants. A transcript from a recording tool or pasted in chat: store it first with `register_artifact` (kind `transcript`) so it is part of the record. Files the auditor uploaded on the event screen, and documents received earlier on Set-up, Documents: `list_artifacts` and `get_artifact_text`. A document received before the event may already answer planned evidence: link it rather than asking for it again.

### 2. Structure the notes

From the auditor's notes, and from the transcript, extract:

- **promises**: what, who (role), by when. No date given means no date, not a guess.
- **suspected issues**: what the auditor suspects, and which requirement it concerns.
- **documents mentioned** that were not received.

Write them with `upsert_notes`: `type` note, promise or issue, and `mentions` (`{type, id, label}` from `get_event_status` and `get_engagement_overview`). A promise mentioning planned evidence sets it to promised; give `due` only when a date was said. A document mentioned but not received: an `artifact` mention with an empty `id`. Say which items you inferred from prose rather than read from the auditor's own lines.

### 3. Link material to planned evidence

For each planned evidence item of this event, look for material that addresses it, and write `link_evidence` with `artifact_id`, `evidence_item_id`, `locator` (section, page, paragraph, cell range or timestamp; empty when the whole document is the evidence), a short `excerpt` in the original language, and `sufficiency`:

- `supports`: the material shows what the evidence item asked for,
- `partial`: it points the right way but is incomplete, covers a shorter period, or is testimony only,
- `contradicts`: it shows the requirement was not met.

What someone said supports understanding, but for evidence of kind record, observation or technical it is at most `partial` until a record or observation backs it. Links are proposed; the evidence becomes received only when the auditor confirms them. Material that fits no planned item: list it as "unplanned, possibly relevant to <requirement>".

### 4. Statuses

Statuses follow the confirmed links. For evidence clearly not provided, say so in your summary rather than changing statuses.

### 5. Post-event report

`render_post_event_report` (Markdown to show; `docx` or `pdf` to save). It is shared with the people who attended: what was covered, what was received, what is outstanding, who promised what by when. It never contains suspected issues, sufficiency judgements or criticality.

### 6. Tell the auditor

Links proposed, evidence still missing sorted by criticality, promises with owners and dates, suspected issues with the requirement they touch, and any requirement of this event that now has no evidence path at all. Say how many links and notes wait on the event screen.

## Judgement notes

- Quote, do not characterise. "41 accounts reviewed, 3 removed" is useful; "reviews seem adequate" is a finding in disguise.
- A transcript is not verbatim truth: speech recognition mangles names, numbers and Latvian terms. Flag numbers and dates you rely on so the auditor can check them.
- If the material contradicts a document received earlier, record both locators. That contrast is often the most valuable output of the event.
