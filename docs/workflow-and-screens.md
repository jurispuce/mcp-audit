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
- After a new version of a document (#76), a banner says how many internal requirements need review after it. **Recheck against new version** has AI compare each with the new text and propose an update (with a quote from the new version) or a removal, with the reason; the auditor accepts or rejects each, alone or selected together. Rejecting leaves it to the auditor: keep, use the new passage, or remove.
- Documents of earlier engagements whose internal requirements are carried over are listed under **From earlier engagements**, with **Upload new version**: the requirements are copied into this engagement under the same INT codes and checked against the new text; the earlier engagement keeps its records, and carry-over from then on takes the newest version. Only accepted, reviewed requirements are carried over.
- Set-up, Requirements, for ISO/IEC 27001 and 27701 audits: upload the Statement of Applicability; "Check scope against SoA" records its lines and flags selected controls it excludes or does not list. The auditor keeps each in scope with a reason, or removes it (#81).
- Set-up, Risks: upload the auditee's risk register (PDF, Excel, Word, CSV or Markdown); "Extract risks" proposes its risks with level, description and affected requirements. Proposed risks set no criticality until accepted (#78).
- Add an internal requirement by hand.
- *Prototype only:* only file names are recorded; extraction is simulated.

### Plan, Events
- Plan header: status of the plan as a whole (draft, sent to auditee, agreed), with a "Changed since then" flag when events change after sending.
- Documents already received count before the meeting (#83): the app proposes links from received documents to rule evidence, by section (with the internal requirements' quotes) or the whole document, with no extra step: when Plan, Events, an event's Run screen or Proposals opens, after an upload and after Draft plan. A rejected match is not proposed again. The event screen lists what is still **to obtain at this event** first and what is **already received** below; the plan document asks the auditee only for what is missing and names what is already received.
- Plan, Coverage: requirements no event covers can be removed from the audit scope, one or several, with a reason kept in their history (#82). A requirement still in an event, in planned evidence or with a finding is not removed.
- Planning inputs come first: fieldwork days, working hours and lunch, about how many meetings (the form shows how many fit) and exceptions. "Draft plan" runs only once they are saved.
- "Draft plan" proposes events grouped by topic with planned evidence, fitted into the fieldwork time: an opening meeting (30 min) at the start, a closing meeting (30 min) at the end, a daily summary (15 min) at the end of the other days, lunch, and 10 minutes after every meeting for notes.
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

### Library (outside engagements)
- Tabs: Sources, Review, Mapping, Import.
- Import: upload the text of a law or standard (PDF, Word, text) as a library document; copy the import and mapping prompts for Claude; or import a YAML file.
- Review: what AI proposed for the library. An imported source is previewed as a tree, edited in place, and published as a whole; changes to published requirements show what they were; accept, reject or accept all. Nothing proposed is selectable or searchable.
- Mapping: choose the source to map and the existing source to map it to; each requirement shows its links to the target with type, coverage and the reason; accept, edit or reject each, accept all, or map by hand. A summary counts mapped requirements.
- *Milestone 7:* "Extract requirements" and "Propose mapping" buttons run the same flow inside the app.

### Guide (outside engagements, #84)
- **Audit steps** (`/guide`): the audit as five steps (Set up, The auditee's own rules, Plan, Run, Conclude) over the eight phases, each an expandable card with what you do, what AI can do, what you decide and when it is done; a "Before you start" card for the instance. Opened from an engagement (`?e=`), each step shows that engagement's progress from the phase checklist, the first open step is expanded, and buttons open its screens.
- **Connect your AI** (`/guide/connect`): this instance's MCP address with Copy, a note when the address is not https, and steps for one assistant at a time: Claude (custom connector), ChatGPT (custom MCP server, marked not yet verified), Claude Code and Claude Desktop on a private network. Then: check the connection, load the skills, reuse transcripts, what an assistant can never do.
- **Download guide** returns the same guide as one self-contained HTML file with the instance's address, for people without an account. In it the reader can change the address and tick off steps (kept in their browser). `node scripts/build-guide.mjs` writes the same page without an instance.
- **First-time welcome:** a person who has not dismissed it sees a welcome card on the engagements screen and on an engagement's Home, with the five steps, **Open the guide**, **Connect Claude or ChatGPT** and **Hide this welcome**; any of the three dismisses it for that person (`user.welcomed`, versioned). The guide page can show it again.
- All of it comes from `src/lib/guide/content.ts`.

### Settings (outside engagements)
- **Account:** name and email, password, and **Passkeys** (#87): add one on this device with a name, see when each was added and last used, rename and remove. The last passkey can be removed only while another way in exists (a password, or sign-in codes by email). Where the address cannot have passkeys (not https, or an IP address) the section says so.
- **Email** (admins, #86): whether outbound email is set up, the sender and mail server without the password, **Send test email** to one's own address, and the most recent sends.
- **Users** (admins): besides the actions of milestone 1, **End sessions and remove passkeys** for another person (#88), for a lost device. It asks first, and the person is told by email.
- AI (admins), Skills, Access tokens: see their milestones.
- The sign-in page offers **Sign in with a passkey** below the password form, where the address can have passkeys, and **Email me a sign-in code** where email is set up (#88).
- **Sign in with a code** (`/login/code`, #88): enter the email, then the six-digit code from the email, or open its link in the same browser. The screen is the same for an address without an account. **Send a new code** and **Use another address** start over. A link opened in another browser says to open it where the code was asked for.
- **Add a passkey to this device** (`/add-passkey`): shown after every sign-in with a code where the address can have passkeys, with **Continue without a passkey**.

### Item sheet
- Details, Comments, History for any record. History lists versions with author, time, channel and changed fields, and offers revert on every version except the current one.

### Test notes (prototype only)
- "Log a gap" on every screen; not part of the app.
