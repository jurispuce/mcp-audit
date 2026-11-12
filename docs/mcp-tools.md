# MCP tools, skills and in-app AI

## Tools

About 32 tools, grouped by phase. Write tools accept several items per call.

| Group | Tools | Purpose |
| --- | --- | --- |
| Orientation | list_engagements, get_engagement_overview | Overview returns phase progress, counts and what is missing next. |
| Library | search_requirements, get_requirement, upsert_sources, upsert_requirements, link_requirements, set_guidance, set_criteria | get_requirement returns text with links, guidance and criteria. |
| Set-up | select_requirements, upsert_scopes, set_scope_handling, upsert_people, upsert_risks | set_scope_handling regenerates assessment units. upsert_people takes roles; name and email are optional. |
| Artifacts | list_artifacts, get_artifact_text, register_artifact | Text is returned in pages with locators. register_artifact stores text or a transcript, including one fetched from a third-party MCP server. |
| Planning | upsert_events, upsert_evidence_items, get_coverage, render_audit_plan | get_coverage returns, per requirement, the events that include it. |
| Execution | upsert_notes, link_evidence, get_event_status, render_post_event_report | upsert_notes writes typed notes with mentions. |
| Conclusion | get_assessment_unit, list_assessment_units, propose_finding, render_findings_report | get_assessment_unit returns requirement, criteria, risks, evidence links with excerpts, and suspected issues. |
| Cross-cutting | add_comment, get_history, revert | Work on any entity type. |

## Rules built into the tools

- Every write is versioned with the token owner as user and the AI as agent.
- `link_evidence`, `propose_finding`, AI-created events, roles and internal requirements always land as proposed.
- No tool approves a finding, sets plan status, or deletes an artifact file.
- Tools refuse to run on an engagement where `ai_allowed` is off.
- Tools refuse cross-auditee reads of internal requirements.
- Results are compact by default and include ids.

## Skills

The seven skills in `skills/` currently run in files mode: they read and write YAML and Markdown files in an engagement folder (`references/engagement-files.md` in each skill). Each skill's reference ends with a table mapping its files to these MCP tools. Moving a skill to MCP mode means replacing file reads and writes with the tool calls; the instructions stay.

| Skill | Phase | Main tools |
| --- | --- | --- |
| audit-engagement-setup | 1 to 4 | upsert and select tools |
| audit-role-discovery | 3 | get_artifact_text, upsert_people |
| audit-document-analysis | 5 | get_artifact_text, upsert_requirements, link_requirements, set_criteria |
| audit-plan-builder | 6 | upsert_events, upsert_evidence_items, get_coverage, render_audit_plan |
| audit-event-debrief | 7 | upsert_notes, link_evidence, get_event_status, render_post_event_report |
| audit-assurance-review | 8 | get_assessment_unit, propose_finding, render_findings_report |
| audit-library-curator | after | set_guidance, set_criteria, link_requirements |

Report templates live in the skills' `assets/` folders and are used by the render tools.

## In-app AI actions

Five buttons, each running the matching skill on the server through the same internal tools.

| Button | Where | Skill | Result |
| --- | --- | --- | --- |
| Derive roles from documents | Set-up, Auditee | audit-role-discovery | Proposed roles |
| Extract requirements | Set-up, Documents | audit-document-analysis | Proposed internal requirements and links |
| Draft plan | Plan, Events | audit-plan-builder | Proposed events and planned evidence |
| Process event materials | Event screen | audit-event-debrief | Proposed evidence links, statuses, draft report |
| Propose finding(s) | Findings | audit-assurance-review | Proposed findings with rationale |

How it works:

- A button starts a background job with visible progress; it can be cancelled.
- The job is an agent loop: the server sends skill instructions and the tool list to the model through LiteLLM and executes the tool calls it returns.
- Everything written is marked proposed and versioned as AI on behalf of the user who pressed the button.
- A proposal bar on the screen leads to a review list: accept, edit or reject each, or accept all.
- Per engagement: `ai_allowed` switches AI off; `llm_profile` limits the engagement to one model. A model must pass the tool-calling check before it can run an action.
