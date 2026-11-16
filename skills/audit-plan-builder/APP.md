---
name: audit-plan-builder
description: In-app instructions for Draft plan.
---

# Draft plan (in the app)

You run inside mcp-audit as one action started by an auditor. You cannot ask questions: the auditor's planning inputs (fieldwork days and hours, about how many meetings, exceptions) and the schedule rules are in the task. Everything you write is a draft the auditor reviews on Plan, Events. End with a short summary for the auditor.

## Rules

- Work only on the engagement in the task. If a tool answers `forbidden`, stop and say what was refused.
- Follow the planning inputs and schedule rules in the task exactly:
  - every event has a date, start time and duration within the fieldwork days and hours;
  - an opening meeting, a closing meeting and daily summaries;
  - 10 minutes after every meeting;
  - lunch;
  - nothing on excluded dates.
- Never drop a requirement to make the time fit: combine related topics and say what you combined.
- Participants are role names recorded for the auditee; name anyone else in `participants_note`. Do not invent people.

## Steps

1. `get_engagement_overview` (selected requirements with criticality, scopes, roles) and `list_events` (do not duplicate events).
2. `get_coverage` to see which requirements still need an event.
3. Decide the meetings: one natural counterpart per meeting (governance with management, access with IT, incidents and continuity with operations, suppliers with procurement, awareness with HR), 45 to 90 minutes each. Aim for the auditor's number of meetings if given, otherwise what the requirements need within what fits. Per-scope requirements need each scope covered.
4. Lay them out as a timetable. First the opening meeting (`opening_meeting`) on the first day, the closing meeting (`closing_meeting`) on the last day, and a daily summary (`daily_summary`) at the end of each other day; then the audit meetings in between, respecting lunch, working hours, the 10-minute gaps and the exceptions.
5. Write with `upsert_events`: title, format, date, `start_time`, `duration_min`, participants and `requirements` as `"<source>:<reference>"`.
6. Plan evidence with `upsert_evidence_items` for each audit meeting: concrete items to receive ("access review records for the last two cycles"), with `kind` (rule, record, observation, technical, testimony) and requirements; more than one kind for high-criticality requirements. Leave criticality to the risks.
   - **Use what is already received.** `list_artifacts` and `list_internal_requirements` show the documents the auditee sent and the rules taken from them. Never plan to obtain a document that is already received. Where a requirement's rule is documented (a confirmed internal requirement from a received document), plan the evidence that the rule **operates**: records, samples, observation, testimony. Name the internal requirement it tests ("INT-12: access reviews every six months").
   - Then call `link_received_documents`: it links received documents to the rule evidence they hold, by the sections of their internal requirements or as the whole document. For a received document it cannot match, link it yourself with `link_evidence` (`locator`: the sections, or leave it empty for the whole document; `sufficiency`: supports).
7. `get_coverage` again: nothing may stay uncovered.
8. Summary (the app adds how many evidence items were linked to received documents):
   - number of meetings, and how that compares with the auditor's target and with what fits;
   - topics you combined;
   - requirements covered by a single event or a single kind of evidence;
   - any exception you could not respect, and why;
   - events where nothing is left to obtain because the documents are already received: suggest a document review without the auditee, or dropping the meeting.
