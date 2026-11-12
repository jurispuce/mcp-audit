# Engagement files (files mode)

All six audit skills share this folder layout. It mirrors the audit app's data model, so the same instructions work later against the app's MCP tools (see the last section).

## Folder layout

```
audit-workspace/
├── library/                          # shared across all engagements and clients
│   └── sources/<source-id>.yaml      # one file per external source (NIS 2, ISO 27001, ...)
└── engagements/<engagement-id>/      # one folder per engagement; never mix clients
    ├── engagement.yaml
    ├── scopes.yaml
    ├── roles.yaml
    ├── risks.yaml
    ├── requirements.yaml             # selected external requirements, pinned
    ├── internal-requirements.yaml
    ├── criteria.yaml                 # engagement-specific criteria (optional)
    ├── documents/                    # auditee files as received
    │   └── documents.yaml            # index of those files
    ├── plan/
    │   ├── events.yaml
    │   ├── evidence.yaml             # planned evidence
    │   └── audit-plan.md             # generated, for the auditee
    ├── events/<event-id>/
    │   ├── notes.md                  # auditor notes
    │   ├── materials/                # transcripts, screenshots, files from the event
    │   ├── links.yaml                # material -> planned evidence
    │   └── post-event-report.md      # generated, for sharing
    ├── findings.yaml
    ├── reports/                      # generated reports
    └── log.md                        # change log (stands in for version history)
```

If the auditor keeps files somewhere else, ask once where the engagement folder is and use that. If a file does not exist yet, create it when you first need it.

## File shapes

Keep ids short and stable. Never renumber existing ids.

```yaml
# engagement.yaml
id: iso27001-baltic-freight-2026
name: ISO 27001 audit, Riga office
auditee: Baltic Freight SIA
auditee_description: Logistics company, 120 employees, two sites.
start_date: 2026-11-16
end_date:
auditors: [Juris Pūce]
working_language: en        # language the auditor records in
report_language: lv         # language of generated reports
scope_mode: multiple        # single | multiple
plan_status: draft          # draft | sent | agreed
carry_over_internal: false  # reuse this auditee's internal requirements from an earlier engagement
finding_scale:              # editable per engagement
  - {id: na,    label: No reasonable assurance}
  - {id: c,     label: Conformity}
  - {id: cp,    label: Conformity with positive note}
  - {id: cn,    label: Conformity with auditor note}
  - {id: minor, label: Minor non-conformity}
  - {id: major, label: Major non-conformity}
```

```yaml
# scopes.yaml
- {id: hq, name: Head office, description: ""}
- {id: wh, name: Warehouse, description: ""}

# roles.yaml  (the role is what matters; name and email are optional)
- id: head-it
  role: Head of IT
  name: ""
  email: ""                  # optional, for sending the plan and follow-ups
  unit: IT
  responsibilities: [Grants and reviews access rights]
  source: {document: access-control-policy.pdf, section: "3.1"}   # where the role was found, if derived
  status: confirmed          # proposed | confirmed

# risks.yaml
- id: R1
  title: Leaver accounts stay active
  level: high               # high | medium | low
  origin: auditor           # auditee-register | auditor
  requirements: [A.5.18]
  scopes: [all]
```

```yaml
# requirements.yaml  (selected external requirements)
- id: A.5.15                 # the ref code is the id
  source: iso27001-2022
  title: Access control
  text: ""                   # full text if the auditor's licence allows storing it
  pinned: 2026-11-12         # date this text was taken from the library
  scope_handling: per-scope  # common | per-scope
  criticality: high          # optional auditor override

# internal-requirements.yaml
- id: INT-1
  text: Access rights are reviewed by the system owner every six months.
  quote: "Piekļuves tiesības pārskata reizi sešos mēnešos."   # short, original language
  document: access-control-policy.pdf
  section: "4.2"
  implements:
    - {requirement: A.5.18, coverage: full, note: ""}        # full | partial
  status: proposed           # proposed | confirmed | rejected
  proposed_by: claude

# criteria.yaml
- requirement: A.5.18
  scope: all
  criteria:
    - Access rights are reviewed at a defined interval.
    - Review results are recorded and acted on.
  expected_evidence: [review records for two cycles, list of changes made after review]
```

```yaml
# documents/documents.yaml
- file: access-control-policy.pdf
  title: Access control policy
  kind: policy               # policy | procedure | instruction | risk-register | record | other | (empty)
  state: received            # received | mentioned (named in an interview, not received yet)
  analysed: false
  version: "3.1"
  approved: 2025-03-01

# plan/events.yaml
- id: E1
  title: Access and identity interview
  format: interview          # interview | walkthrough | document-review | technical-test | site-visit
  date: 2026-11-17
  time: "10:00"
  duration_min: 60
  participants: [head-it]    # role ids
  auditors: [Juris Pūce]
  requirements: [A.5.15, A.5.18]
  status: planned            # planned | held
  proposed_by: claude        # remove once the auditor accepts it

# plan/evidence.yaml
- id: EV1
  event: E1
  text: Access review records for the last two cycles
  kind: record               # rule | record | observation | testimony | technical
  criticality: high          # high | medium | low
  requirements: [A.5.18]
  scope: all                 # all | <scope id>
  status: planned            # planned | received | partial | promised | missing
  promised_by:
  promised_due:
```

```yaml
# events/<event-id>/links.yaml
- material: materials/access-review-2026-10.xlsx
  locator: "sheet Oct, rows 2-41"     # page, paragraph, timestamp, cell range
  excerpt: "41 accounts reviewed, 3 removed"
  evidence: EV1
  sufficiency: supports      # supports | partial | contradicts
  status: proposed           # proposed | confirmed
  proposed_by: claude

# findings.yaml
- unit: A.5.18@hq            # requirement@scope ("@all" when common)
  value: minor               # id from engagement.yaml finding_scale
  rationale: >
    ...
  evidence: [EV1, EV4]       # planned evidence ids relied on
  status: proposed           # proposed | draft | approved
  proposed_by: claude
```

## Auditor notes format (events/<event-id>/notes.md)

One line per note. A line may start with a time offset and a type. `@` quotes an existing item by id, role or document title.

```
[00:00] Started with access process overview
[04:10] /promise @head-it will send the leaver list for 2026 @EV2 by Friday
[09:32] /issue no review was done in H1 @A.5.18
[12:05] /document they follow an "Onboarding checklist" not sent to us
[15:40] reviews are stored in @access-control-policy section 4
```

Types: no prefix = plain note, `/promise` = follow-up promised, `/issue` = suspected issue (auditor only), `/document` and `/requirement` = something quoted. Notes written without this format are still valid input: read them as plain notes and infer promises and issues, saying that you inferred them.

## Rules every skill follows

1. **Propose, never decide.** Anything you write that involves judgement gets `status: proposed` and `proposed_by: claude`. The auditor accepts by changing the status. Never write `approved` on a finding and never remove another person's entry.
2. **Log every write.** Append one line to `log.md`: date and time, "Claude on behalf of <auditor>", file, what changed. This is the audit trail until the app provides version history.
3. **One client per folder.** Never read another engagement's folder to fill gaps. Reuse an auditee's earlier internal requirements only when `carry_over_internal: true`, and say that you did.
4. **Keep the library clean.** `library/` holds only external sources and general guidance. Nothing that identifies a client goes there.
5. **Do not invent evidence.** Every claim about what a document or person said needs a file and a locator. If you cannot find it, say so and leave the item open.
6. **Languages.** Write records in `working_language` and reports in `report_language`. Keep quotes in their original language. Never translate requirement ids or reference codes.
7. **Tell the auditor what changed.** End each run with a short summary: what you wrote, what is proposed and waiting for review, what is still missing, and the suggested next step.

## When the audit app's MCP tools are available

Use the tools instead of the files; the steps stay the same. Rough mapping:

| File | MCP tools |
| --- | --- |
| library/sources/*.yaml | search_requirements, get_requirement, upsert_sources, upsert_requirements, link_requirements, set_guidance, set_criteria |
| engagement.yaml, scopes, roles, risks | get_engagement_overview, upsert_scopes, upsert_people, upsert_risks |
| requirements.yaml | search_requirements, select_requirements, set_scope_handling |
| internal-requirements.yaml | upsert_requirements, link_requirements |
| criteria.yaml | set_criteria |
| documents/ | list_artifacts, get_artifact_text, register_artifact |
| plan/ | upsert_events, upsert_evidence_items, render_audit_plan |
| events/ | link_evidence, get_event_status, render_post_event_report |
| findings.yaml | get_assessment_unit, propose_finding |
| log.md, library/log.md | not needed: the app records every version, with you as "Claude on behalf of <auditor>" |

For any item: `add_comment`, `get_history` and `revert` (a revert is a new version; nothing is lost).
