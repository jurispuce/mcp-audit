---
name: audit-assurance-review
description: "Review the evidence for each audited requirement and scope in mcp-audit, judge whether it gives reasonable assurance, and propose auditor findings with a written rationale (no reasonable assurance, conformity, conformity with note, minor or major non-conformity), then draft the findings report. Use this skill whenever the user asks whether there is enough evidence, wants findings or conclusions proposed or drafted, asks for the status of the audit by requirement, wants non-conformities worded, or needs the audit findings report, even if they only say 'where do we stand on A.5.18'."
---

# Audit assurance review

For each assessment unit (one requirement in one scope), decide what the evidence supports and propose a finding the auditor can defend line by line. The auditor decides; this skill does the reading, the cross-checking and the first wording.

Read `references/audit-rules.md` first. The report template is `assets/findings-report-template.md`; the app's `render_findings_report` fills it. This skill works through the mcp-audit connector; if its tools are not available, tell the auditor to connect mcp-audit and stop.

## Steps

### 1. The units

`list_assessment_units`: every requirement-by-scope unit with evidence counts, suspected issues and its current finding, plus the engagement's finding scale (codes such as `na`, `c`, `cp`, `cn`, `minor`, `major`). Work on the units the auditor asked about, or all of them.

### 2. The case for each unit

`get_assessment_unit`: the pinned requirement text and criteria, criticality, internal rules that implement it, planned evidence with confirmed and proposed links (locator, excerpt, sufficiency), suspected issues and linked risks.

### 3. Judge sufficiency before conformity

Two separate questions, in this order:

1. **Is there enough evidence to conclude anything?** Enough means: each criterion is addressed, the evidence is of the right kind (records for operation over time, not testimony alone), it covers the period and the scope, and high-criticality items do not rest on a single source.
2. **If yes, what does it show?**

If the answer to 1 is no, the finding is **no reasonable assurance**, and the rationale lists exactly what is missing.

### 4. Choose the finding

Use the engagement's own scale. With the default scale:

- **Conformity**: criteria met, evidence sufficient, nothing to add.
- **Conformity with positive note**: met, and something is done notably well and worth naming.
- **Conformity with auditor note**: met, but with a weakness or improvement point that does not breach the requirement.
- **Minor non-conformity**: breached in an isolated or limited way; the control exists and mostly works.
- **Major non-conformity**: the control is absent, has broken down, fails systematically, or the lapse touches a high risk. Several related minors on one requirement can add up to a major.
- **No reasonable assurance**: see step 3.

An internal rule stricter than the external requirement and not followed is usually an auditor note or a minor against the external requirement, depending on whether the external requirement itself is still met. Say which and why. When scopes differ, findings differ: do not average them.

The app enforces two rules: a non-conformity must cite evidence that was obtained, and conformity cannot be proposed while a suspected issue is open.

### 5. Write the rationale

Four short parts, in the working language: what the requirement asks (one sentence); what was examined (evidence with what each showed); what was found, including anything that contradicts; why that leads to this finding and not the neighbouring one. For a non-conformity, state the requirement, the fact and the evidence so the auditee could verify it without the auditor present. Do not recommend fixes inside a finding.

Write with `propose_finding`: value code, `rationale`, `evidence_item_ids` relied on and `confidence` (high, medium, low). It lands as proposed; an approved finding is locked. You never approve: the auditor reviews proposals on Findings.

### 6. Report

`render_findings_report`: approved findings only, or `include_drafts: true` for a draft marked DRAFT; `docx` or `pdf` saves it.

Finish with the summary: counts per finding value, units with no reasonable assurance and what would close each, and suspected issues with no evidence yet.

## Judgement notes

- A suspected issue is a lead, not evidence. It blocks proposing conformity until checked, and it cannot support a non-conformity alone.
- Proposed (unreviewed) links may inform your reading, but say that the finding depends on them.
- Be willing to say "conformity". Hedging every unit into an auditor note makes the report useless.
- Low confidence is worth stating plainly; it tells the auditor where to spend their own time.
