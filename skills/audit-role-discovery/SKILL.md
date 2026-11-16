---
name: audit-role-discovery
description: "Derive the auditee's roles and responsibilities from the documents uploaded to an mcp-audit engagement (policies, procedures, org charts, RACI tables, job descriptions) so the auditor knows whom to engage with for each requirement. Use this skill whenever the user wants to find out who is responsible for what at the auditee, build or check the list of roles or interviewees for an audit, extract responsibilities, owners or a RACI from documents, or asks 'whom should we talk to about X', even if they do not mention roles explicitly."
---

# Audit role discovery

Find out, from the auditee's own documents, which roles exist and what each is responsible for. The auditor uses the result to decide whom to interview about which requirement, and to spot responsibilities nobody owns.

Read `references/audit-rules.md` first. This skill works through the mcp-audit connector; if its tools are not available, tell the auditor to connect mcp-audit and stop.

## Steps

### 1. Read for roles

Find the engagement with `list_engagements`, then `get_engagement_overview`: it lists the roles already recorded (`people`, with status) and the selected requirements. List the documents with `list_artifacts` and read each readable one with `get_artifact_text`, page by page.

A role is a function the documents give duties to: a job title, a committee, a team, an owner type ("system owner", "data owner"), or an external party (a managed service provider). Good places to look: "roles and responsibilities" sections, RACI tables, approval and review lines, document headers and footers (owner, approver), escalation paths in procedures.

### 2. Propose roles

Write each role with `upsert_people`:

- `role`: the title as the documents use it, in the original language.
- `unit`: only if the documents say.
- `responsibilities`: short statements of what the role must do, each traceable to a section. Put title variants ("IT Manager", "Head of IT", "IT vadītājs") and the requirements the role naturally answers for here too.
- `source_document` and `source_section`: where the role is defined or first given a duty.
- `name` and `email`: only when the document itself names the holder. Never guess a person from a title, and never look people up elsewhere.

A role that already exists is matched by its name and updated rather than duplicated. If you are not sure two titles are the same role, keep them separate and say so. Do not overwrite roles the auditor entered. Every role you write is proposed; the auditor accepts it on Set-up, Auditee.

### 3. Check the picture

Report to the auditor:

- **requirements with no role**: selected requirements for which no document names anyone responsible. These are interview questions ("who owns this?"), and often early signs of a governance gap.
- **roles used but never defined**: a procedure assigns a duty to a role that no document establishes.
- **conflicting ownership**: two documents give the same duty to different roles.
- **one role carrying too much**: duties that should be separated sitting with one role (for example requesting and approving access).
- **external parties** with duties, since supplier requirements will apply to them.

These are observations for the auditor to follow up, never findings.

### 4. Hand over

Summarise: roles proposed, how many have named holders, the gaps from step 3, and a suggested interview counterpart per requirement group for the plan builder.

## Judgement notes

- An org chart shows reporting lines, not responsibilities. Use it for units and titles; take duties from policies and procedures.
- Documents describe the intended organisation. Titles may be out of date; say that the list needs confirming with the auditee before the plan is sent.
- If no document assigns responsibilities at all, say so plainly. That is useful to know before the first interview.
