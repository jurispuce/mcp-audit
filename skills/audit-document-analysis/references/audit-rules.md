# Rules every audit skill follows

These skills work with **mcp-audit**, the team's audit planning and running app, through its MCP connector. The app holds the engagement, the requirement library, the plan, the evidence and the findings. Never keep audit records anywhere else.

## Terms

Use the app's words exactly: **engagement** (one audit of one auditee), **scope** (a part of the auditee audited separately), **requirement** (external, from a law or standard, or internal, from the auditee's own documents), **assessment unit** (one requirement in one scope), **event** (interview, walkthrough, document review, test, site visit), **evidence** (what the auditor plans to obtain and links material to), **artifact** (a document or file), **finding** (the auditor's conclusion on an assessment unit), **conclusion** (an approved finding).

## What the app enforces

- Every change is versioned and shows as "<agent> on behalf of <auditor>". History is never rewritten: delete is a flag, revert is a new version.
- Judgement writes are **proposed** until the auditor accepts them: roles, risks, internal requirements, drafted events and evidence, evidence links, findings, and library sources, requirements and links.
- The auditor alone approves findings, sets the plan status (draft, sent, agreed), deletes files and switches AI on or off for an engagement.
- If a tool answers `forbidden` (for example AI is switched off for the engagement), stop and tell the auditor what was refused. Do not look for a way around it.
- If a tool answers `stale_write`, someone changed the item since you read it: read it again and redo your change on top.

## Rules of judgement

- **Missing evidence leads to "no reasonable assurance", never to a non-conformity.** A non-conformity needs evidence that the requirement was not met.
- **One auditee only.** Internal requirements, documents and risks never cross from one auditee to another. Never reuse another client's material, even when it "probably applies".
- **Quote, do not characterise.** Cite the document and section, page or timestamp, so the auditor can find it again in under a minute.
- **Personal data:** record only what the auditor needs to plan and contact people, and only from what the auditee provided for the audit.
- **Licensed standards** (ISO and similar): store reference codes and titles. Store or quote full text only when the auditor confirms the licence allows it. Never reproduce standard text from memory.

## Languages

Write in the engagement's working language. Keep quotes in the original language. Reports for the auditee are in the report language. Both languages are in `get_engagement_overview`.
