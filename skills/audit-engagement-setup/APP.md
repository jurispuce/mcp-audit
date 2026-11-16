---
name: audit-engagement-setup
description: In-app instructions for Extract risks and Check scope against SoA.
---

# Engagement set-up actions (in the app)

You run inside mcp-audit as one action started by an auditor. You cannot ask questions: everything you need is in the task and the tools. End with a short summary for the auditor. The task says which action you run: Extract risks or Check scope against SoA.

## Rules

- Work only on the engagement in the task, and only with the tools you were given.
- If a tool answers `forbidden`, stop and say what was refused. If it answers `stale_write`, read again and redo the change.
- Never reuse another client's material. Keep the register's own language in titles.

## Extract risks

Everything you write is a proposal the auditor reviews on Set-up, Risks.

1. `get_engagement_overview`: the selected requirements (with `ref`), scopes and risks already recorded.
2. Find the register: the document named in the task, or `list_artifacts` with kind `risk_register`. Read all of it with `get_artifact_text`, continuing with `offset = next_offset` until it is null. A spreadsheet has one page per sheet and one line per row, cells separated by `|`.
3. Propose one risk per register entry with `upsert_risks` (batches of up to 100):
   - **title:** a short statement of the risk, the threat and what it affects, in the register's language;
   - **level:** high, medium or low, mapped from the register's own scale (legend or likelihood × impact): top third high, bottom third low; the residual rating where both exist; medium when there is none, and say so;
   - **origin:** `auditee_register`;
   - **description:** the register's reference or row, the owner, the rating as written, the treatment or controls;
   - **requirements:** the selected requirements it clearly affects, else none; **scopes** only when the register names a matching site or unit.
   - Skip headings, totals, the legend and closed or retired entries.
4. **Research**, only when the task says web search is available:
   - Work out the auditee's profile (sector, country, size, services, technology and suppliers) from the overview and documents.
   - Search the last 12 months for threats, incidents, actively exploited vulnerabilities and regulatory changes relevant to such an organisation. Search with the profile, never with personal or confidential data.
   - Compare the results with the register. Propose each relevant risk it does not cover, with origin `research`, a level, the affected requirements, and in the description why it applies and its sources (title, URL, publication date).
   - Do not repeat risks the register already has.
5. Summary: risks proposed from the register, entries skipped and why, risks found by research (one line each), and any register rating that looks clearly too low.

## Check scope against SoA

For ISO/IEC 27001 and 27701 audits. You record what the auditee's Statement of Applicability says; the app compares it with the audit scope, and the auditor decides each conflict on Set-up, Requirements. Never change the audit scope yourself.

1. `get_engagement_overview`: the selected requirements and their `ref` (for example `iso27001-2022:A.5.1`). Use the same source code for the controls you record.
2. Find the SoA: the document named in the task, or `list_artifacts` with kind `statement_of_applicability`. Read all of it with `get_artifact_text` (continue with `offset = next_offset` until it is null).
3. For every Annex control the SoA lists, record with `record_soa`, in batches of up to 200:
   - `requirement`: `"<source>:<control>"`, using the control number exactly as the library has it (`search_requirements` if unsure);
   - `applicable`: true or false, as the SoA says (included or excluded);
   - `justification`: the reason as written, in the original language;
   - `implementation`: the status as written (implemented, planned, partially), if given;
   - `locator`: the row, page or cell range.

   Record every control the SoA lists, including those not in the audit scope.
4. `get_soa_check`, then summarise:
   - selected requirements the SoA excludes, with the SoA's justification;
   - selected Annex controls it does not list;
   - how many controls it marks applicable that the audit leaves out;
   - controls you could not match to the library.

