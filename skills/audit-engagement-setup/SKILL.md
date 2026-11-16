---
name: audit-engagement-setup
description: "Set up an audit engagement in mcp-audit through its connector: select the external requirements (NIS 2, ISO 27001 or any other source), define scopes, record the auditee's roles, and build the risk list from the auditee's register and current research. Use this skill whenever the user wants to start, define, scope or prepare an audit or assessment engagement, choose which standard or requirements to audit against, decide single versus multiple scopes, import or check a risk register, or build an auditee risk list, even if they only say 'new audit for client X'."
---

# Audit engagement setup

Take an engagement far enough that planning can start. The auditor should finish knowing exactly what will be audited, in which scopes, with whom, and which risks drive the depth of the audit.

Read `references/audit-rules.md` first. This skill works through the mcp-audit connector. If its tools (`list_engagements`, `get_engagement_overview`, …) are not available, tell the auditor to connect mcp-audit and stop.

## Steps

### 1. Basics

The auditor creates the engagement in the app (Engagements, Create engagement: name, auditee, dates, languages). Find it with `list_engagements`, then read `get_engagement_overview`: it shows the phases, what is done and what is next. Ask only for what is missing, in one message.

### 2. Sources

Check with `search_requirements` that the sources the auditor wants are in the library. If one is missing, import it (see the library curator skill) or ask the auditor for its text. For public law write the reference, a short title and the text; for licensed standards, codes and titles only (see the rules).

### 3. Select requirements

Propose a selection and let the auditor cut it. Selecting everything is a valid answer; so is one clause. Prefer a smaller, defensible selection: the auditor has to reach a finding on every selected requirement in every scope. Then `select_requirements` with `select` and `deselect` lists of `"<source>:<reference>"`; each is pinned at the library's current version, so later library changes do not silently alter this engagement.

### 4. Scopes

Ask whether the organisation works the same way everywhere.

- If yes: one scope named after the auditee.
- If parts may work differently (sites, business units, subsidiaries, IT environments): several scopes. Then set each requirement to `common` (one answer for the whole organisation: governance, policy approval) or `per_scope` (practice can differ: access control at each site, physical security).

Explain the consequence: every per-scope requirement gets one finding per scope. Suggest a split and let the auditor adjust; do not over-split, because each split multiplies the evidence needed. Use `upsert_scopes` with `mode` and the scopes, then `set_scope_handling`. The result reports the number of assessment units: tell the auditor. Dropping a scope that has units needs the auditor's yes, then `confirm_units_lost: true`.

### 5. Roles

Record the roles the auditor expects to engage with, with `upsert_people`: a role is enough to plan; names are optional. If the auditee's documents are uploaded, suggest the role discovery skill to derive roles from them. Roles arrive as proposed for the auditor to accept on Set-up, Auditee.

### 6. Risk list

Push for this; it is what makes the audit risk-driven. In order of preference:

1. the auditee's own risk register (ask the auditor to upload it on Set-up, Risks),
2. a list built with the auditor from what is known about the auditee,
3. at minimum, the auditor's own view of the three to five things most likely to be wrong.

Write with `upsert_risks`: level (high, medium, low; do not score beyond that), origin (`auditee_register`, `auditor` or `research`) and the selected requirements and scopes each affects where the link is clear. Risks you write are proposed; once the auditor accepts one, the highest linked level becomes the requirement's default criticality.

#### Extracting a risk register

Find the register with `list_artifacts` (kind `risk_register`) and read all of it with `get_artifact_text`. It can be a spreadsheet (each sheet is a page, each row a line with cells separated by `|`), a PDF, a Word file, CSV or Markdown.

- **One risk per register entry.** Ignore headings, totals, the scale legend and closed or retired entries; say what you skipped.
- **Title:** a short statement of the risk in the register's own language: the threat and what it affects.
- **Level:** map the register's rating to high, medium or low using its own scale (legend or likelihood × impact matrix): the top third is high, the bottom third low. With residual and inherent ratings, use the residual one. Without a rating, use medium and say so.
- **Origin** `auditee_register`. **Description:** the register's reference or row, the owner, the rating as written, and the treatment or controls.
- **Requirements:** the selected requirements each risk clearly affects; leave the list empty when unclear. **Scopes:** only when the register names a matching site or unit.
- Send risks in batches of up to 100.

#### Checking the register against current risks

A register is often a year old or more. Use web search to check that it covers what matters now.

1. **Profile the auditee** from the overview, the scope documents and the register: sector, country, size, services, and the technology and suppliers it depends on. Search with the profile, not the auditee's name, and never with personal or confidential data, unless the auditor says otherwise.
2. **Search the last 12 months:** threats and campaigns aimed at that sector or country (ENISA, the national CERT, CISA), notable incidents at similar organisations, actively exploited vulnerabilities in technology it uses, and new or changed obligations (NIS 2 transposition, DORA, sector rules, supervisory guidance).
3. **Compare with the register.** A finding the register already covers, even in other words, is not new. One rated clearly too low is worth a line in your summary, not a new risk.
4. **Propose what is missing** with `upsert_risks`: origin `research`, a level, the selected requirements it affects, and in the description why it applies to this auditee and its sources (title, URL and publication date, at least one per risk). Prefer primary sources over news.
5. List the new risks in one line each and what you searched for, so the auditor can judge coverage.

### 7. Statement of Applicability (ISO/IEC 27001 and 27701)

When the audit covers ISO/IEC 27001 or 27701 controls, ask the auditor for the auditee's Statement of Applicability (SoA). It is uploaded on Set-up, Requirements (or as kind `statement_of_applicability` on Set-up, Documents).

1. Read it in full (`list_artifacts`, `get_artifact_text`).
2. Record every Annex control it lists with `record_soa`: applicable or excluded, the justification and implementation status as written, and the row or page. Use the control numbers as the library has them (`"<source>:A.5.1"`).
3. `get_soa_check` compares the SoA with the audit scope. It reports selected controls the SoA **excludes**, selected Annex controls it **does not list**, and controls it marks applicable that the audit leaves out.
4. Put each conflict to the auditor with the SoA's justification. **The auditor decides**: keep the control in scope, with a reason (for example to test that the exclusion is justified), or remove it. They do this on Set-up, Requirements; you never change the scope for them.

An exclusion is itself audit evidence: an excluded control with a weak justification is worth a question at the opening meeting.

### 8. Hand over

Read `get_engagement_overview` again and summarise its phases and the open points: documents not received, roles unknown, no risk register. Suggest the next step: document analysis if documents have arrived, otherwise the plan builder.

## Judgement notes

- If the auditor names a source you do not know well, ask for its text rather than guessing its content.
- Do not copy anything from another client's engagement, including risk lists that "probably apply".
