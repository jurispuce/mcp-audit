---
name: audit-document-analysis
description: "Analyse the auditee documents in an mcp-audit engagement (policies, procedures, instructions, registers) to extract internal requirements with document and section references, map them to the external requirements of the audit, and recheck them when a new version of a document arrives. Use this skill whenever the user uploads or points to auditee documents during an audit and wants them read, analysed, mapped to NIS 2 / ISO 27001 or other requirements, checked for coverage gaps, compared with a new version, or turned into internal requirements or audit criteria, even if they only say 'go through these policies'."
---

# Audit document analysis

Turn the auditee's documents into internal requirements: the specific commitments the organisation has made about how it works. They serve two purposes later. They show whether the external requirements are covered by design, and they become the yardstick for testing whether practice follows the organisation's own rules.

Read `references/audit-rules.md` first. This skill works through the mcp-audit connector; if its tools are not available, tell the auditor to connect mcp-audit and stop.

## Steps

### 1. Index the documents

Find the engagement (`list_engagements`, `get_engagement_overview` for the selected requirements and their `ref`, for example `nis2:Art. 21(2)(i)`). List the documents with `list_artifacts`. A document whose `text` is `failed` or `unsupported` cannot be read: say so and skip it. Titles, kinds, versions and approval dates are edited by the auditor on Set-up, Documents: tell them what you read from each document (a missing version or approval is evidence about document control).

### 2. Extract internal requirements

Run `list_internal_requirements` first, so a re-run updates instead of duplicating. Read each document not analysed yet with `get_artifact_text`, page by page (continue with `offset = next_offset` until it is null).

An internal requirement is a statement that binds someone to do something: who must do what, how often, to what standard, with what record. Look for obligation words (shall, must, is required, is responsible for, at least every; in Latvian: jā-, ir pienākums, ne retāk kā, atbild par). Write with `upsert_internal_requirements`, one call per document with its `artifact_id`:

- `title`: one obligation, restated plainly in the working language. Split compound sentences: "reviewed quarterly and approved by the CISO" is two requirements.
- `quote`: the shortest original wording that proves it, in the original language. The quote is how the app rechecks the requirement when a new version of the document arrives, so copy it exactly.
- `section`: the document's numbering, or the page `locator` when it has none.
- To update an existing one, give its `ref` (INT-n).

Leave out descriptions, intentions and definitions. If a statement is too vague to test ("regularly", "appropriate"), still record it and say it is not testable as written.

### 3. Map to external requirements

In the same call, `implements`: `[{requirement: "nis2:Art. 21(2)(i)", coverage: "partial"}]`, only to the engagement's selected requirements. One internal requirement may implement several. Map only where the link is defensible to the auditee; an unmapped internal requirement is fine.

### 4. Report coverage

Tell the auditor, per external requirement: covered by which internal requirements, partly covered and what is missing, not covered by any document received. Call the last group "no documented rule found in the documents received", never a non-conformity: the rule may live in a document not yet sent. These are interview questions.

Also report documents that contradict each other, documents referred to but not received (record them with `register_artifact`, `mentioned: true`), and rules stricter than the organisation can plausibly follow.

### 5. Suggest criteria

Where an internal requirement gives a concrete, testable rule, propose it as a criterion with `set_criteria` (`mode: add`) on the external requirement, with the evidence that would show it operating ("review records for the last two cycles").

### 6. A new version of a document

When the auditee sends a new version, the auditor uploads it with **Upload new version** on Set-up, Documents, or you store text with `register_artifact` and `replaces` (the old document's id). The app moves the internal requirements to the new version and checks each quote against the new text: found ones are unchanged, the rest **need review**, shown next to the closest passage. For those, call `compare_with_new_version`: each one's old quote in the context of the previous version, next to the closest passage in the new one. Then propose the outcome with `propose_recheck`: `update` with a quote copied exactly from the new version (and a new title or text when the rule itself changed), or `remove` when the new version no longer has the rule, each with a reason citing the new version. The auditor accepts or rejects each proposal on Set-up, Documents. Tell the auditor which rules became weaker or were dropped: those are questions for the auditee.

A new version can also arrive in a later engagement, for a document whose internal requirements are carried over from an earlier one: `register_artifact` with `replaces` set to that document's id (from `list_internal_requirements`). The accepted requirements are copied into this engagement under the same INT codes and checked the same way; the earlier engagement keeps its records. New sections with no internal requirement are candidates for step 2.

### 7. Hand over

Tell the auditor how many internal requirements wait for review on Set-up, Documents, and the coverage gaps.

## Judgement notes

- Quality over count. Forty precise requirements beat two hundred paraphrased sentences; the auditor reviews every one.
- Never fill a gap from general knowledge of what such a policy "usually says".
- If a document is scanned or unreadable, say so and stop on that document rather than guessing.
- Large document sets: one document at a time, writing after each, so a long run can be resumed.
