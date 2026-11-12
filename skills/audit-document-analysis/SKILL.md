---
name: audit-document-analysis
description: "Analyse auditee documents (policies, procedures, instructions, registers) to extract internal requirements with document and section references, and map them to the external requirements of the audit. Use this skill whenever the user uploads or points to auditee documents during an audit and wants them read, analysed, mapped to NIS 2 / ISO 27001 or other requirements, checked for coverage gaps, or turned into internal requirements or audit criteria, even if they only say 'go through these policies'."
---

# Audit document analysis

Turn the auditee's documents into internal requirements: the specific commitments the organisation has made about how it works. They serve two purposes later. They show whether the external requirements are covered by design, and they become the yardstick for testing whether practice follows the organisation's own rules.

Read `references/engagement-files.md` first.

## Where the documents live

- **App mode.** When the mcp-audit tools are available (`list_artifacts`, `get_artifact_text`, `upsert_internal_requirements`, `list_internal_requirements`), the documents were uploaded to the engagement in the app (Set-up, Documents) and their text was extracted there. Use the tools; do not write YAML files.
- **Files mode.** Without those tools, the documents are in the engagement's `documents/` folder.

### In app mode

| Step | Use |
| --- | --- |
| Find the engagement | `list_engagements`, then `get_engagement_overview` for the selected requirements (use their `ref`, for example `nis2:Art. 21(2)(i)`) |
| 1. Index | `list_artifacts`. A document whose `text` is `failed` or `unsupported` cannot be read here: say so and skip it. Titles, kinds, versions and approval dates are edited by the auditor in the documents list; tell them what you read from each document rather than writing it |
| 2. Extract | `get_artifact_text` page by page (continue with `offset = next_offset` until it is null). Each page has a `locator`; put it in `section` when the document has no numbering. Write with `upsert_internal_requirements`: one call per document with its `artifact_id`, each item with `title` (the plain restatement), `quote` and `section` |
| 3. Map | the same call's `implements`: `[{requirement: "nis2:Art. 21(2)(i)", coverage: "partial"}]`. Only selected external requirements of this engagement |
| Re-runs | `list_internal_requirements` first; update an existing one by giving its `ref` (INT-n) instead of adding a duplicate |
| Mentioned documents | `register_artifact` with `mentioned: true` and the document's name |
| 5. Criteria | `set_criteria` on the external requirement, with `mode: add` |

Everything you add lands as proposed: the auditor accepts, rejects or accepts all on Set-up, Documents. Internal requirements belong to this auditee only and never appear in another client's engagement; do not try to read or reuse another client's documents or requirements.

If a tool answers `forbidden` because AI is switched off for the engagement, stop and tell the auditor; only they can switch it on (Home, engagement details). If it answers `stale_write`, read again and redo the change on top. Everything you write shows in the app as "Claude on behalf of <auditor>"; judgement writes land as proposed for the auditor to accept.

## Steps

### 1. Index the documents

List what is in `documents/` and update `documents/documents.yaml`. The auditor often uploads files without titles or kinds: fill in title, kind, version and approval date from the document itself, and leave a field empty when the document does not say. A missing version or approval is worth noting; it is evidence about document control.

### 2. Extract internal requirements

Read each document that is not yet analysed. An internal requirement is a statement that binds someone to do something: who must do what, how often, to what standard, with what record. Look for obligation words (shall, must, is required, is responsible for, at least every; in Latvian: jā-, ir pienākums, ne retāk kā, atbild par).

For each one write an entry in `internal-requirements.yaml`:

- `text`: one obligation, restated plainly in the working language. Split compound sentences: "reviewed quarterly and approved by the CISO" is two requirements.
- `quote`: the shortest original wording that proves it, in the original language.
- `document` and `section`: precise enough to find it again in under a minute.
- `status: proposed`.

Leave out descriptions, intentions and definitions ("the company values security"). If a statement is too vague to test ("regularly", "appropriate"), still record it and add `note: not testable as written`; vagueness is itself useful to the auditor.

### 3. Map to external requirements

For each internal requirement add `implements` entries pointing at selected external requirements, with `coverage: full` or `partial` and a one-line reason when partial. One internal requirement may implement several external ones. Map only where the link is defensible to the auditee; an unmapped internal requirement is fine and stays in the file.

### 4. Report coverage

Tell the auditor, per external requirement:

- covered by which internal requirements,
- partly covered, and what is missing,
- not covered by any document received.

Call the last group "no documented rule found in the documents received", never a non-conformity. The rule may live in a document not yet sent, or the control may operate without being written down. These are questions for interviews, so list them as such.

Also report: documents that contradict each other, documents referring to other documents that were not received (add those to `documents.yaml` with `state: mentioned`), and rules that look stricter than the organisation can plausibly follow, since those are the likeliest operating failures.

### 5. Suggest criteria

Where an internal requirement gives a concrete, testable rule, propose it as an engagement-specific criterion in `criteria.yaml` with the evidence that would show it operating (for example "review records for the last two cycles").

Mark each document `analysed: true`, log the run and finish with the summary. In app mode there is nothing to mark or log: the app keeps every version. End by telling the auditor how many internal requirements wait for review on Set-up, Documents.

## Judgement notes

- Quality over count. Forty precise requirements beat two hundred paraphrased sentences; the auditor has to review every one.
- Never fill a gap from general knowledge of what such a policy "usually says".
- If a document is scanned or unreadable, say so and stop on that document rather than guessing.
- Large document sets: process one document at a time and write results after each, so a long run can be resumed.
