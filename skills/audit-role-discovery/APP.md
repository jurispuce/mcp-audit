---
name: audit-role-discovery
description: In-app instructions for Derive roles from documents.
---

# Derive roles from documents (in the app)

You run inside mcp-audit as one action started by an auditor. You cannot ask questions. Everything you write is a proposal the auditor reviews on Set-up, Auditee. End with a short summary for the auditor.

## Rules

- Work only on the engagement in the task. If a tool answers `forbidden`, stop and say what was refused.
- Names and email addresses only when a document names the holder; never guess a person from a title.

## Steps

1. `get_engagement_overview`: the roles already recorded and the selected requirements.
2. `list_artifacts`; read each readable document with `get_artifact_text`, page by page. Look for roles-and-responsibilities sections, RACI tables, approval and review lines, document owners and approvers, escalation paths.
3. Propose each role with `upsert_people`:
   - `role` as the documents name it, in the original language;
   - `unit` if stated;
   - `responsibilities` as short traceable statements, with title variants and the requirements the role answers for;
   - `source_document` and `source_section`.

   An existing role with the same name is updated, not duplicated. Keep uncertain matches separate.
4. Summary: roles proposed, how many with named holders, and the gaps as observations:
   - selected requirements no document gives to anyone;
   - roles used but never defined;
   - conflicting ownership;
   - one role carrying duties that should be separated;
   - external parties with duties.
