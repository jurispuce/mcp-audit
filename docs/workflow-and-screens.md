# Workflow and screens

The reference for every screen is `prototype/audit-prototype.html`. Open it in a browser and click through; it runs without a server. This file says what each screen must do in the real app and what the prototype only simulated.

## The eight phases

Phases are guidance, not gates. Home shows them as a checklist; any phase can be opened at any time.

| # | Phase | Done when | Destination |
| --- | --- | --- | --- |
| 1 | Define the engagement | engagement exists | Home |
| 2 | Select requirements | at least one requirement selected | Set-up, Requirements |
| 3 | Understand the auditee | at least one role and one risk | Set-up, Auditee |
| 4 | Set scope handling | single scope, or two or more scopes defined | Set-up, Scopes |
| 5 | Extract internal requirements | at least one confirmed internal requirement | Set-up, Documents |
| 6 | Plan events | plan status is agreed and evidence is planned | Plan |
| 7 | Run events | no planned evidence is still in status planned | Run |
| 8 | Conclude | every assessment unit has an approved finding | Findings |

## Navigation

Five destinations inside an engagement, in audit order: **Home, Set-up, Plan, Run, Findings**. Rail on desktop (768px and wider), bottom bar on a phone. Library and Settings sit outside the engagement. Full rules: `design/navigation.md`.

Any record opens as an item sheet (right panel on desktop, full screen on a phone) with the tabs Details, Links, Comments, History.

## Screens

### Home
- Create engagement: name, auditee, start date, optional end date, working language, report language, description.
- Phase checklist with one fact per phase and a "Continue" button for the first open phase.
- Engagement details editable in place; each save is a version.

### Set-up, Requirements
- Sources with their requirements; select all or individual requirements. Selection pins the library version.
- With multiple scopes: per requirement, "one finding" or "per scope".
- Confirmed internal requirements listed below with what they implement.
- *Prototype only:* fixed sample library (NIS 2 Art. 21(2), eleven ISO 27001 Annex A controls), no requirement links, selection not versioned.

### Set-up, Scopes
- Choose single or multiple scopes. Add and remove scopes. Shows how many assessment units result.

### Set-up, Auditee
- Auditee description.
- Roles: role required; name, unit and email optional.
- "Derive roles from documents" proposes roles with a responsibility and source document; accept or reject each, or accept all.
- *Prototype only:* role derivation is simulated.

### Set-up, Risks
- Empty state pushes for a risk list (auditee register, or auditor's own view).
- Add risk: title, level, origin, and one or more affected requirements chosen from a searchable checklist.

### Set-up, Documents
- Upload one or many files at once with no metadata. Title and kind are edited in the list afterwards.
- "Extract requirements" proposes internal requirements with document, section and the external requirement implemented; accept, reject, accept all.
- Add an internal requirement by hand.
- *Prototype only:* only file names are recorded; extraction is simulated.

### Plan, Events
- Plan header: status of the plan as a whole (draft, sent to auditee, agreed), with a "Changed since then" flag when events change after sending.
- "Draft plan" proposes events grouped by topic with planned evidence.
- Every event can be edited (title, format, date, start time, duration, participants, requirements), including AI drafts before acceptance. Events can be removed.
- "Plan evidence" opens the event to list expected evidence with criticality, requirement and scope.

### Plan, Coverage
- Summary bar: how many requirements are in at least one event; toggle to show only uncovered; search requirements.
- Per requirement: pills for the events it is in (tap to open the event for editing, × to remove), and "+ Add to event" with a searchable event list and "Create a new event" that pre-links the requirement.
- A requirement can be in several events.

### Plan, Audit plan
- Table of the plan as exported: date, time, event, format, duration, participants, requirements. Lists selected requirements that are in no event.
- Real app: export to DOCX or PDF from the plan-builder skill's template in the report language. The export leaves out criticality, risks and auditor reasoning.

### Run, Events and Event screen (phone-first)
- Event header with "Mark held".
- Planned evidence rows: status (planned, received, partial, promised, missing); promised shows who and due date; sorted with open and high-criticality items first.
- **Auditor notes:** a text field where "/" opens commands (requirement, document, person, promise, issue) and "@" opens a picker of existing requirements, internal requirements, documents, roles and this event's planned evidence. Enter saves. Each note shows a time offset from the first note of the event.
  - `/promise` with an evidence mention sets that evidence to promised, by the mentioned role.
  - `/issue` records a suspected issue: shown on the Findings card for the mentioned requirement, never in anything shared with the auditee.
  - `/document` with an unknown name creates a document in state "mentioned".
- Files and transcripts: add an artifact; link it to an evidence item with sufficiency (supports, partial, contradicts).
- "Process event materials" proposes links for unlinked artifacts.
- Post-event report: received, partly received, promised, missing, promises made. Suspected issues are for the auditor only.
- *Prototype only:* artifacts are title and text; mentions are single words while typing; processing is simulated.

### Run, Inbox
- Artifacts not yet linked to any planned evidence.

### Findings
- Tabs: All, To approve, Conclusions.
- One card per assessment unit: requirement, scope, evidence summary, internal rules, suspected issues, finding value, rationale.
- "Propose findings" (all) or "Propose" (one). Rule: incomplete evidence gives no reasonable assurance; a contradicting link gives a non-conformity (major when the evidence is high criticality); all evidence received with supporting links gives conformity; a suspected issue blocks proposing conformity.
- Accept as draft, save draft, approve (locks), reopen, approve all drafts. Comments and history per finding.

### Item sheet
- Details, Comments, History for any record. History lists versions with author, time, channel and changed fields, and offers revert on every version except the current one.

### Test notes (prototype only)
- "Log a gap" on every screen; not part of the app.
