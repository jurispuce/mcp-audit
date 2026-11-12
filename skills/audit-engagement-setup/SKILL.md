---
name: audit-engagement-setup
description: "Set up a new audit engagement as structured files: engagement details, selected external requirements (NIS 2, ISO 27001 or any other source), scopes, auditee roles and a starting risk list. Use this skill whenever the user wants to start, define, scope or prepare an audit or assessment engagement, choose which standard or requirements to audit against, decide single versus multiple scopes, or build an auditee risk list, even if they only say 'new audit for client X'. Also use it to import a standard or regulation into the requirement library."
---

# Audit engagement setup

Create the engagement folder and fill it far enough that planning can start. The auditor should finish this step knowing exactly what will be audited, in which scopes, with whom, and which risks drive the depth of the audit.

Read `references/engagement-files.md` first. It defines the folder layout, file shapes and the rules every audit skill follows.

## Where the engagement lives

Check which tools you have before you start.

- **App mode.** When the mcp-audit tools are available (`list_engagements`, `get_engagement_overview`, `select_requirements`, `upsert_scopes`, `set_scope_handling`, `upsert_people`, `upsert_risks`), the engagement is in the audit app. Use the tools; do not write YAML files.
- **Files mode.** Without those tools, work in the engagement folder as described below.

### In app mode

| Step | Use |
| --- | --- |
| 1. Basics | The auditor creates the engagement in the app (Engagements, Create engagement: name, auditee, dates, languages). Then `list_engagements` to find its id and `get_engagement_overview` to see what is done and what is next. |
| 2. Sources | `search_requirements`; a missing source is imported with `upsert_sources` and `upsert_requirements` (same licence rules as below) |
| 3. Select | `select_requirements` with `select` and `deselect` lists of `"<source>:<reference>"`; each is pinned at the library's current version |
| 4. Scopes | `upsert_scopes` with `mode` and the scopes; then `set_scope_handling` per requirement (`common` or `per_scope`). The result reports the number of assessment units: tell the auditor. Dropping a scope that has units needs the auditor's yes, then `confirm_units_lost: true` |
| 5. Roles | `upsert_people`: role required, name, unit and email optional. They arrive as proposed for the auditor to accept on Set-up, Auditee |
| 6. Risks | `upsert_risks` with level, origin (`auditee_register` or `auditor`) and the selected requirements each affects; the highest linked level becomes the requirement's default criticality |
| 7. Hand over | `get_engagement_overview` again, and summarise its phases and the open points |

If a tool answers `forbidden` because AI is switched off for the engagement, stop and tell the auditor; only they can switch it on (Home, engagement details). If it answers `stale_write`, read again and redo the change on top. Everything you write shows in the app as "Claude on behalf of <auditor>"; judgement writes land as proposed for the auditor to accept.

The engagement's AI switch, plan status, model profile and carry-over of internal requirements are the auditor's settings in the app; no tool changes them.

## Steps

### 1. Collect the basics

Take what the auditor already said. Ask only for what is missing, in one message:

- engagement name, auditee, start date (end date optional), auditors
- working language and report language
- which external sources apply (for example NIS 2, ISO/IEC 27001:2022)

Create `engagements/<id>/engagement.yaml` with the default finding scale unless the auditor gives another. In app mode the auditor creates the engagement in the app; it gets the default scale, one scope named after the auditee and the creator as lead auditor.

### 2. Make sure the sources are in the library

Look in `library/sources/`. If a source is missing, build it:

- For public law (NIS 2 and similar), write each requirement with its reference, a short title and the text.
- For licensed standards (ISO and similar), store reference codes and titles. Store full text only if the auditor confirms their licence allows it, or pastes the text themselves. Never reproduce standard text from memory.
- Keep the source's own structure through `parent`. Use the reference code as the id.

```yaml
# library/sources/nis2.yaml
id: nis2
title: NIS 2 Directive (EU) 2022/2555
language: en
licence_note: Public EU law
requirements:
  - id: "Art. 21(2)(a)"
    parent: "Art. 21(2)"
    title: Risk analysis and information system security policies
    text: ""
    links: []          # {type: details|explains|implements|equivalent|conflicts, to: <id>, note: ""}
    guidance: ""       # how to audit this, maintained by audit-library-curator
    criteria: []       # general criteria
```

### 3. Select requirements

Propose a selection and let the auditor cut it. Selecting everything is a valid answer; so is one clause. Write the result to `requirements.yaml` with `pinned` set to today, so later library changes do not silently alter this engagement.

### 4. Scopes

Ask whether the organisation works the same way everywhere. If yes: `scope_mode: single` and one scope named after the auditee. If parts may work differently (sites, business units, subsidiaries, IT environments): `scope_mode: multiple`, list the scopes, and set `scope_handling` per requirement:

- `common` when one answer holds for the whole organisation (governance, policy approval)
- `per-scope` when practice can differ (access control at each site, physical security)

Explain the consequence: every per-scope requirement gets one finding per scope. Suggest a split and let the auditor adjust; do not over-split, because each split multiplies the evidence needed.

### 5. Auditee roles

Record the roles the auditor expects to engage with in `roles.yaml`. A role is enough to plan; names are optional and can come later. If auditee documents are already in `documents/`, suggest running `audit-role-discovery` to derive the roles from them.

### 6. Risk list

Push for this; it is what makes the audit risk-driven. In order of preference:

1. the auditee's own risk register (ask the auditor to request it, then import it),
2. an audit-specific list built with the auditor from what is known about the auditee,
3. at minimum, the auditor's own view of the three to five things most likely to be wrong.

Write `risks.yaml`, linking each risk to requirements and scopes where the link is clear. Mark the origin. Do not score beyond high, medium, low.

### 7. Hand over

Finish with the summary required by the shared rules, plus a short list of what is still open (documents not received, roles unknown, no risk register). Suggest the next step: `audit-document-analysis` if documents have arrived, otherwise `audit-plan-builder`.

## Judgement notes

- Prefer a smaller, defensible selection over "everything": the auditor has to reach a finding on every selected requirement in every scope.
- If the auditor names a source you do not know well, ask for its text rather than guessing its content.
- Do not copy anything from another client's engagement, including risk lists that "probably apply".
