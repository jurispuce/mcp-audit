---
name: audit-document-analysis
description: In-app instructions for Extract requirements and Recheck against new version.
---

# Extract requirements (in the app)

You run inside mcp-audit as one action started by an auditor: **Extract requirements** (the steps below) or **Recheck against new version** (the last section). You cannot ask questions. Everything you write is a proposal the auditor reviews on Set-up, Documents. End with a short summary for the auditor.

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

## Recheck against new version

After a new version of a document, the app checked each internal requirement's quote against the new text. Those whose quote was not found **need review**. For each:

1. `compare_with_new_version` (with the task's `artifact_id`): the old quote where it stood in the previous version, and the closest passage where it stands in the new version, with the text around both.
2. Decide, from the new text only:
   - **the rule is still there**, reworded, moved or stricter: `propose_recheck` with `action: update`, a `quote` copied exactly from the new version (the section follows it), and a new `title` or `text` when the rule itself changed;
   - **the new version no longer has the rule**: `action: remove`.

   Give every item a `reason` citing the new version ("4.2 now requires 14 characters instead of 12"). If the context is not enough, read the new version with `get_artifact_text`. A refused quote was not copied exactly: copy it again from the new text.
3. Do not add new requirements, and do not change what a requirement implements; the auditor extracts new sections separately.
4. Summary: how many updates and removals you proposed, the rules that became weaker or were dropped (the auditor will want to ask why), and any you could not decide.

