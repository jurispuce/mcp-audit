---
name: audit-role-discovery
description: "Derive the auditee's roles and responsibilities from uploaded documents (policies, procedures, org charts, RACI tables, job descriptions) so the auditor knows whom to engage with for each requirement. Use this skill whenever the user wants to find out who is responsible for what at the auditee, build or check the list of roles or interviewees for an audit, extract responsibilities, owners or a RACI from documents, or asks 'whom should we talk to about X', even if they do not mention roles explicitly."
---

# Audit role discovery

Find out, from the auditee's own documents, which roles exist and what each is responsible for. The auditor uses the result to decide whom to interview about which requirement, and to spot responsibilities nobody owns.

Read `references/engagement-files.md` first.

## Where the documents and roles live

- **App mode.** When the mcp-audit tools are available (`list_artifacts`, `get_artifact_text`, `upsert_people`), the documents and roles are in the audit app. Use the tools; do not write YAML files.
- **Files mode.** Without those tools, read `documents/` and write `roles.yaml` as described below.

### In app mode

| Step | Use |
| --- | --- |
| Find the engagement | `list_engagements`, then `get_engagement_overview`: it lists the roles already recorded (`people`, with status) and the selected requirements |
| 1. Read | `list_artifacts`, then `get_artifact_text` page by page for each readable document |
| 2. Write | `upsert_people` with `role`, `unit`, `responsibilities` (a list), `source_document` and `source_section`; `name` and `email` only when the document names the holder. A role that already exists is matched by its name and updated rather than duplicated |
| 3. Check | report the gaps in your answer; they are observations, not records |

Every role you write lands as proposed. The auditor sees the source and responsibilities on Set-up, Auditee and accepts, rejects or accepts all. There is no `aliases` or `requirements` field in the app: put title variants and the requirements a role answers for in `responsibilities` or in your summary.

If a tool answers `forbidden` because AI is switched off for the engagement, stop and tell the auditor; only they can switch it on (Home, engagement details). If it answers `stale_write`, read again and redo the change on top. Everything you write shows in the app as "Claude on behalf of <auditor>"; judgement writes land as proposed for the auditor to accept.

## Steps

### 1. Read for roles

Go through the files in `documents/`. A role is a function that the documents give duties to: a job title, a committee, a team, an owner type ("system owner", "data owner"), or an external party (a managed service provider). Good places to look: "roles and responsibilities" sections, RACI tables, approval and review lines, document headers and footers (owner, approver), escalation paths in procedures.

### 2. Write proposed roles

Add each role to `roles.yaml` with `status: proposed` and `proposed_by: claude`:

- `role`: the title as the documents use it. Keep the original language; add a working-language translation in `note` if it differs.
- `unit`: only if the documents say.
- `responsibilities`: short statements of what the role must do, each traceable to a section.
- `source`: document and section where the role is defined or first given a duty.
- `requirements`: selected external requirements this role is the natural counterpart for, judged from its responsibilities.
- `name` and `email`: fill these only when the document itself names the holder. Never guess a person from a title, and never look people up elsewhere.

Merge variants of the same role ("IT Manager", "Head of IT", "IT vadītājs") into one entry and list the variants in `aliases`. If you are not sure two titles are the same role, keep them separate and say so.

Do not overwrite roles the auditor entered. If a derived role matches an existing one, add the responsibilities and source to it as a proposal.

### 3. Check the picture

Report to the auditor:

- **requirements with no role**: selected requirements for which no document names anyone responsible. These are interview questions ("who owns this?"), and often early signs of a governance gap.
- **roles used but never defined**: a procedure assigns a duty to a role that no document establishes.
- **conflicting ownership**: two documents give the same duty to different roles.
- **one role carrying too much**: duties that should be separated sitting with one role (for example requesting and approving access).
- **external parties** with duties, since supplier requirements will apply to them.

Present these as observations for the auditor to follow up, never as findings.

### 4. Hand over

Log the run (files mode only; the app keeps every version) and finish with the summary: roles proposed, how many have named holders, the gaps from step 3, and a suggested interview counterpart per requirement group for `audit-plan-builder`.

## Judgement notes

- Names and email addresses are personal data. Record only what the auditor needs to plan and contact people, and only from documents the auditee provided for the audit.
- An org chart shows reporting lines, not responsibilities. Use it for units and titles; take duties from policies and procedures.
- Documents describe the intended organisation. Titles may be out of date; say that the list needs confirming with the auditee before the plan is sent.
- If no document assigns responsibilities at all, say so plainly. That is useful to know before the first interview.
