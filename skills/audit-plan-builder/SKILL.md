---
name: audit-plan-builder
description: "Build and revise the audit plan in mcp-audit through its connector: first agree the fieldwork time, number of meetings and exceptions with the auditor, then group requirements into dated audit events (interviews, walkthroughs, document reviews, technical tests) inside a fixed day structure, check requirement coverage, define the evidence to collect with criticality, and produce the audit plan document for the auditee. Use this skill whenever the user wants an audit plan, interview plan, audit schedule or agenda, or evidence collection plan, wants to move requirements between events, asks which requirements are not covered, or needs to revise the plan after auditee feedback."
---

# Audit plan builder

Produce a plan the auditee can agree to and the auditor can run: a timetable of events, each with the roles involved, the requirements it will validate and the evidence the auditor expects to walk away with.

Read `references/audit-rules.md` first. The plan document template is `assets/audit-plan-template.md`; the app's `render_audit_plan` fills it. This skill works through the mcp-audit connector; if its tools are not available, tell the auditor to connect mcp-audit and stop.

## Steps

### 0. Ask before drafting

Find the engagement (`list_engagements`, then `get_engagement_overview`: selected requirements with criticality, scopes, roles and `planning_inputs`). Unless `planning_inputs` is set and the auditor confirms it still holds, ask first, in one message, and draft nothing until the auditor answers:

1. **Duration.** The fieldwork days (first and last; weekends are not counted), working hours and lunch.
2. **Meetings.** Estimate how many audit meetings the selected requirements need (one natural counterpart per meeting, 45 to 90 minutes each) and how many fit in the time: subtract the fixed parts below and allow an hour plus 10 minutes per meeting. Tell the auditor both numbers and ask how many they want. If the requirements need more than fit, say which topics you would combine, or ask for more time.
3. **Exceptions.** Dates or times to avoid, people who are away, sites only reachable on certain days, anything else the plan must respect.

Record the answers with `set_planning_inputs`. It returns how many meetings fit and the schedule rules.

### Schedule rules (always)

- An **opening meeting** of 30 minutes at the start of the first day and a **closing meeting** of 30 minutes at the end of the last day (formats `opening_meeting` and `closing_meeting`; no requirements; the auditee's management and contact person attend).
- A **daily summary** of 15 minutes at the end of every other day (format `daily_summary`): what was seen, what is still missing, the next day.
- **10 minutes after every meeting** for the auditor's notes: the next meeting starts at least 10 minutes after one ends.
- **Lunch** as agreed; no meetings during it, outside working hours or on excluded dates.
- Every event has a date, start time and duration, so the plan reads as a timetable.
- Never drop a requirement to make the time fit. Combine related topics, and say what you combined.

### 1. Draft events

`list_events` first, so you do not duplicate. Group the selected requirements so that each event has one natural counterpart: a role, a team or a system. People should not be called back twice for things one conversation could cover. Typical groupings: governance and risk with management, access and identity with IT, incidents and continuity with operations, suppliers with procurement, awareness with HR.

Write with `upsert_events`: format, date, start time, duration, `participants` (role names recorded for the auditee; record missing ones with `upsert_people`, or name them in `participants_note`) and `requirements` as `"<source>:<reference>"`. An event with the same title is updated rather than added. Rules of thumb:

- An interview holds 45 to 90 minutes of attention. Budget five to ten minutes per evidence item and split events that run longer.
- A requirement may appear in several events when it needs more than one viewpoint (rule owner and the people who follow the rule). This is normal for high-risk requirements.
- Per-scope requirements need an event in each scope, or one event with people from each scope.

### 2. Check coverage

`get_coverage`: `uncovered` must be empty before the plan is sent. Report requirements in no event, high-criticality requirements covered by a single event or a single kind of evidence, and scopes with no event. When the auditor asks to move a requirement, change the events involved and check again.

### 3. Plan the evidence

`upsert_evidence_items` with the `event_id`, `kind`, `requirements` and, for per-scope requirements, `scope`. Leave `criticality` out to take the highest linked risk level. Think in kinds and ask for more than one where the risk is high:

- **rule**: the documented requirement exists and is approved,
- **record**: proof the rule operated over time (logs, tickets, review records, samples),
- **observation** or **technical**: seeing the control work, or a configuration export,
- **testimony**: what people say. Useful for understanding, weak on its own.

Phrase each item as something concrete to receive ("access review records for the last two cycles"), never as a topic ("access reviews").

### 4. Produce the plan document

`render_audit_plan` with no format returns the Markdown to show the auditor; `format: docx` or `pdf` saves it with the engagement's documents. It lists events, formats, times, participants, requirements and what to prepare, and leaves out criticality, the risk list and your reasoning.

### 5. Revise

The plan usually changes after the auditee replies. Use the same tools; events and evidence keep their ids. Re-run the coverage check.

Everything you draft is proposed: the auditor accepts it on Plan, Events, and only accepted events reach the plan document. Plan status (draft, sent, agreed) is the auditor's; no tool changes it. End by telling the auditor how many events and evidence items wait for review.

## Judgement notes

- Start from the roles the auditor recorded. If a needed role is missing, name it and ask rather than inventing a person.
- Do not pad the plan to look thorough. Every planned evidence item is a promise to check something.
- If there is no risk list, say that criticality is a guess and recommend building one first.
