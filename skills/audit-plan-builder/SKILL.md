---
name: audit-plan-builder
description: "Build and revise the audit plan: group requirements into audit events (interviews, walkthroughs, document reviews, technical tests), check requirement coverage, define the evidence to collect at each event with criticality, and produce the audit plan document for the auditee. Use this skill whenever the user wants an audit plan, interview plan, audit schedule or evidence collection plan, wants to move requirements between events, asks which requirements are not covered, or needs to revise the plan after auditee feedback."
---

# Audit plan builder

Produce a plan the auditee can agree to and the auditor can run: a set of events, each with the roles involved, the requirements it will validate and the evidence the auditor expects to walk away with.

Read `references/engagement-files.md` first. The plan document template is `assets/audit-plan-template.md`.

## Where the plan lives

- **App mode.** When the mcp-audit tools are available (`list_events`, `upsert_events`, `upsert_evidence_items`, `get_coverage`, `render_audit_plan`), the plan is in the audit app. Use the tools; do not write YAML files.
- **Files mode.** Without those tools, work in the engagement's `plan/` folder as described below.

### In app mode

| Step | Use |
| --- | --- |
| Find the engagement | `list_engagements`, then `get_engagement_overview` for the selected requirements (with criticality), scopes, roles and `planning_inputs` |
| 0. Ask first | Unless `planning_inputs` is set and the auditor confirms it still holds, ask before drafting anything (see "0. Ask before drafting" below), then record the answers with `set_planning_inputs`. It returns how many meetings fit and the schedule rules to follow |
| 1. Draft events | `list_events` first (do not duplicate), then `upsert_events`: `participants` are role names recorded for the auditee (record missing ones with `upsert_people`, or name them in `participants_note`); `requirements` as `"<source>:<reference>"`. An event with the same title is updated rather than added |
| 2. Coverage | `get_coverage`: `uncovered` must be empty before the plan is sent; each requirement shows its criticality and events |
| 3. Evidence | `upsert_evidence_items` with the `event_id` from step 1, `kind`, `requirements` and, for per-scope requirements, `scope`. Leave `criticality` out to take the highest linked risk level |
| 4. Document | `render_audit_plan` with no format returns the Markdown to show the auditor; `format: docx` or `pdf` saves the file with the engagement's documents |
| 5. Revise | the same tools; events and evidence keep their ids |

Everything you draft is shown on Plan, Events as proposed: the auditor edits, accepts, rejects or accepts all, and only accepted events reach the plan document. Plan status (draft, sent, agreed) is set by the auditor in the app; no tool changes it. If a tool answers `forbidden` because AI is switched off for the engagement, stop and tell the auditor.

## Steps

### 0. Ask before drafting

The plan has to fit the time the auditee can give. Ask first, in one message, and draft nothing until the auditor answers:

1. **Duration.** The fieldwork days (first and last day; weekends are not counted), working hours and lunch.
2. **Meetings.** Estimate how many audit meetings the selected requirements need (one natural counterpart per meeting, 45 to 90 minutes each) and how many fit in the time: subtract the fixed parts below and allow an hour plus 10 minutes per meeting. Tell the auditor both numbers and ask how many they want. If the requirements need more than fit, say which topics you would combine, or ask for more time.
3. **Exceptions.** Dates or times to avoid, people who are away, sites only reachable on certain days, anything else the plan must respect.

Record the answers with `set_planning_inputs` (in files mode, in `plan/planning-inputs.yaml`). In the app, the auditor may have set them already on Plan, Events; the in-app Draft plan button only runs once they are saved, and passes them to you as a planning brief.

### Schedule rules (always)

- **Opening meeting** of 30 minutes at the start of the first day, and a **closing meeting** of 30 minutes at the end of the last day (formats `opening_meeting` and `closing_meeting`; no requirements, the auditee's management and contact person attend).
- A **daily summary** of 15 minutes at the end of every other day (format `daily_summary`) to go through what was seen, what is still missing and the next day.
- **10 minutes after every meeting** for the auditor's notes: the next meeting starts at least 10 minutes after one ends.
- **Lunch** as given; no meetings during it, outside working hours or on excluded dates.
- Every event gets a date, start time and duration, so the plan reads as a timetable.
- Never drop a requirement to make the time fit. Combine related topics, and say what you combined.

### 1. Draft events

Group the selected requirements so that each event has one natural counterpart: a role, a team or a system. People should not be called back twice for things one conversation could cover. Typical groupings: governance and risk with management, access and identity with IT, incidents and continuity with operations, suppliers with procurement, awareness with HR.

For each event set format, date and start time (within the fieldwork days and the schedule rules above), duration, participants (role ids) and requirements. Rules of thumb:

- An interview holds 45 to 90 minutes of attention. Budget roughly five to ten minutes per evidence item and split events that run longer.
- A requirement may appear in several events when it needs more than one viewpoint (rule owner and the people who follow the rule). This is normal for high-risk requirements.
- Per-scope requirements need an event in each scope, or one event with people from each scope.

Write events to `plan/events.yaml` with `proposed_by: claude` (app mode: `upsert_events`).

### 2. Check coverage

List every selected requirement with the events that cover it. Report clearly:

- requirements in no event (must be fixed before the plan is sent),
- high-criticality requirements covered by a single event or a single kind of evidence,
- scopes with no event.

When the auditor asks to move a requirement, edit the `requirements` lists of the events involved and re-run this check.

### 3. Plan the evidence

For each event and requirement, write the evidence to obtain in `plan/evidence.yaml`. Think in three kinds and ask for more than one where the risk is high:

- **rule**: the documented requirement exists and is approved,
- **record**: proof the rule operated over time (logs, tickets, review records, samples),
- **observation or technical**: seeing the control work, or a configuration export,
- **testimony**: what people say. Useful for understanding, weak on its own.

Set criticality from the risk list: evidence for a requirement linked to a high risk is high; otherwise medium; low only when the auditor says so. Phrase each item as something concrete to receive ("access review records for the last two cycles"), never as a topic ("access reviews").

### 4. Produce the plan document

Fill `assets/audit-plan-template.md` in the report language and save it as `plan/audit-plan.md` (app mode: `render_audit_plan`, which fills the same template). The plan goes to the auditee as a whole. It lists events, formats, times, participants, requirements and what to prepare. Leave out criticality, the risk list and the auditor's reasoning: those are the auditor's working papers.

### 5. Revise

The plan usually changes after the auditee replies. Apply changes to the YAML files, keep event and evidence ids stable, re-run the coverage check and regenerate the document. Set `plan_status` in `engagement.yaml` only when the auditor says the plan was sent or agreed.

Log the run (files mode only) and finish with the summary, leading with anything uncovered. In app mode, end by telling the auditor how many events and evidence items wait for review on Plan, Events.

## Judgement notes

- Start from the roles the auditor recorded. If a needed role is missing from `roles.yaml`, name it and ask rather than inventing a person.
- Do not pad the plan to look thorough. Every planned evidence item is a promise to check something.
- If there is no risk list, say that criticality is a guess and recommend building one first.
