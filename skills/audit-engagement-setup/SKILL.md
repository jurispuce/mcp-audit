---
name: audit-engagement-setup
description: "Set up a new audit engagement as structured files: engagement details, selected external requirements (NIS 2, ISO 27001 or any other source), scopes, auditee roles and a starting risk list. Use this skill whenever the user wants to start, define, scope or prepare an audit or assessment engagement, choose which standard or requirements to audit against, decide single versus multiple scopes, or build an auditee risk list, even if they only say 'new audit for client X'. Also use it to import a standard or regulation into the requirement library."
---

# Audit engagement setup

Create the engagement folder and fill it far enough that planning can start. The auditor should finish this step knowing exactly what will be audited, in which scopes, with whom, and which risks drive the depth of the audit.

Read `references/engagement-files.md` first. It defines the folder layout, file shapes and the rules every audit skill follows.

## Steps

### 1. Collect the basics

Take what the auditor already said. Ask only for what is missing, in one message:

- engagement name, auditee, start date (end date optional), auditors
- working language and report language
- which external sources apply (for example NIS 2, ISO/IEC 27001:2022)

Create `engagements/<id>/engagement.yaml` with the default finding scale unless the auditor gives another.

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
