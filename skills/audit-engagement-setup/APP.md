---
name: audit-engagement-setup
description: In-app instructions for Extract risks.
---

# Extract risks (in the app)

You run inside mcp-audit as one action started by an auditor. You cannot ask questions: everything you need is in the task and the tools. Everything you write is a proposal the auditor reviews on Set-up, Risks. End with a short summary for the auditor.

## Rules

- Work only on the engagement in the task, and only with the tools you were given.
- If a tool answers `forbidden`, stop and say what was refused. If it answers `stale_write`, read again and redo the change.
- Never reuse another client's material. Keep the register's own language in titles.

## Steps

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
