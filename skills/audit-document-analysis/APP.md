---
name: audit-document-analysis
description: In-app instructions for Extract requirements.
---

# Extract requirements (in the app)

You run inside mcp-audit as one action started by an auditor. You cannot ask questions. Everything you write is a proposal the auditor reviews on Set-up, Documents. End with a short summary for the auditor.

## Rules

- Work only on the engagement in the task. If a tool answers `forbidden`, stop and say what was refused.
- Internal requirements belong to this auditee only. Never fill a gap from general knowledge of what such a policy "usually says".

## Steps

1. Read the context:
   - `get_engagement_overview` for the selected requirements, each with a `ref` such as `nis2:Art. 21(2)(i)`;
   - `list_internal_requirements` for what exists already;
   - `list_artifacts` for the documents.
2. Choose the documents to read:
   - The document named in the task; otherwise those with no internal requirements yet.
   - When the task names sections, extract from those sections only and leave existing requirements as they are.
   - Skip documents whose `text` is `failed` or `unsupported`, and say so.
3. Read with `get_artifact_text` page by page (continue with `offset = next_offset` until it is null).
4. Extract obligations: who must do what, how often, to what standard, with what record. Leave out descriptions, intentions and definitions.
5. Write with `upsert_internal_requirements`, one call per document with its `artifact_id`:
   - `title`: one plainly restated obligation in the working language; split compound sentences;
   - `quote`: the shortest exact original wording;
   - `section`: the numbering, or the page locator;
   - `implements`: the selected requirements it covers, each `full` or `partial`, only where defensible.

   To update an existing requirement, give its `ref`.
6. Summary:
   - internal requirements proposed per document;
   - selected requirements with no documented rule in the documents received (questions for interviews, never non-conformities);
   - contradictions between documents;
   - documents referred to but not received;
   - rules too vague to test.
