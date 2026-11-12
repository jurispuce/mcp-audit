---
name: audit-assurance-review
description: "Review the evidence for each audited requirement and scope, judge whether it gives reasonable assurance, and propose auditor findings with a written rationale (no reasonable assurance, conformity, conformity with note, minor or major non-conformity), then draft the findings report. Use this skill whenever the user asks whether there is enough evidence, wants findings or conclusions proposed or drafted, asks for the status of the audit by requirement, wants non-conformities worded, or needs the audit findings report, even if they only say 'where do we stand on A.5.18'."
---

# Audit assurance review

For each assessment unit (one requirement in one scope), decide what the evidence supports and propose a finding the auditor can defend line by line. The auditor decides; this skill does the reading, the cross-checking and the first wording.

Read `references/engagement-files.md` first. The report template is `assets/findings-report-template.md`.

## Steps

### 1. Build the unit list

From `requirements.yaml` and `scopes.yaml`: one unit per requirement when `scope_handling: common` (`<id>@all`), one per scope when `per-scope` (`<id>@<scope>`). Work on the units the auditor asked about, or all of them.

### 2. Assemble the case for each unit

Collect, for the unit:

- the requirement text and its criteria (`criteria.yaml`, then general criteria in the library source),
- internal requirements that implement it,
- planned evidence for it in this scope, with status,
- confirmed links (and proposed ones, marked as unreviewed),
- suspected issues from event notes that mention it,
- risks linked to it.

### 3. Judge sufficiency before conformity

Two separate questions, in this order:

1. **Is there enough evidence to conclude anything?** Enough means: the criteria are each addressed, the evidence is of the right kind (records for operation over time, not testimony alone), it covers the period and the scope, and high-criticality items are not resting on a single source.
2. **If yes, what does it show?**

If the answer to 1 is no, the finding is **no reasonable assurance**, and the rationale lists exactly what is missing. Missing evidence is never a non-conformity by itself. A non-conformity needs evidence that the requirement was not met.

### 4. Choose the finding

Use the engagement's own finding scale. With the default scale:

- **Conformity**: criteria met, evidence sufficient, nothing to add.
- **Conformity with positive note**: met, and something is done notably well and worth naming.
- **Conformity with auditor note**: met, but there is a weakness or improvement point that does not breach the requirement.
- **Minor non-conformity**: the requirement is breached in an isolated or limited way; the control exists and mostly works.
- **Major non-conformity**: the control is absent, has broken down, fails systematically, or the lapse touches a high risk. Several related minors on one requirement can add up to a major.
- **No reasonable assurance**: see step 3.

An internal rule that is stricter than the external requirement and is not followed is usually an auditor note or a minor against the external requirement, depending on whether the external requirement itself is still met. Say which and why.

When scopes differ, findings differ. Do not average them.

### 5. Write the rationale

Four short parts, in the working language:

1. what the requirement asks (one sentence),
2. what was examined (evidence ids with what each showed),
3. what was found, including anything that contradicts,
4. why that leads to this finding and not the neighbouring one.

For a non-conformity, state the requirement, the fact and the evidence so the auditee could verify it without the auditor present. Do not recommend fixes inside a finding.

Write each finding to `findings.yaml` with `status: proposed`, the evidence ids relied on, and a `confidence` of high, medium or low. Never overwrite a finding the auditor has set to `draft` or `approved`: put your view next to it as `review_note` if it differs.

### 6. Report

On request, fill `assets/findings-report-template.md` in the report language and save it under `reports/`. Include only findings with `status: approved`, unless the auditor asks for a draft, in which case mark the report as a draft on every page heading.

Finish with the summary: counts per finding value, units with no reasonable assurance and what would close each, and suspected issues that have no evidence yet.

## Judgement notes

- A suspected issue from notes is a lead, not evidence. It blocks proposing conformity until checked, and it cannot support a non-conformity alone.
- Proposed (unreviewed) links may inform your reading, but say that the finding depends on them.
- Be willing to say "conformity". Hedging every unit into an auditor note makes the report useless.
- Low confidence is worth stating plainly; it tells the auditor where to spend their own time.
