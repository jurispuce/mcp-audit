# MCP tools, skills and in-app AI

## Tools

About 47 tools, grouped by phase. Write tools accept several items per call.

| Group | Tools | Purpose |
| --- | --- | --- |
| Orientation | list_engagements, get_engagement_overview | Overview returns phase progress, counts and what is missing next. |
| Library | search_requirements, get_requirement, upsert_sources, upsert_requirements, link_requirements, set_guidance, set_criteria | get_requirement returns text with links, guidance and criteria. Sources, requirements and links written by AI are proposed until reviewed. |
| Library import | list_library_documents, get_library_document_text, list_library_proposals | Read the laws and standards uploaded on Library, Import, and see what waits on Library, Review and Mapping. |
| Set-up | select_requirements, upsert_scopes, set_scope_handling, upsert_people, upsert_risks | set_scope_handling regenerates assessment units. upsert_people takes roles; name and email are optional. |
| Artifacts | list_artifacts, get_artifact_text, register_artifact | Text is returned in pages with locators. register_artifact stores text or a transcript, including one fetched from a third-party MCP server, or records a mentioned document. |
| Internal requirements | list_internal_requirements, upsert_internal_requirements | Per auditee document, with quote, section and implements links. Always proposed. Never readable from another auditee's engagement. |
| Planning | list_events, upsert_events, upsert_evidence_items, get_coverage, render_audit_plan | Events and evidence written by AI are drafts until accepted. get_coverage returns, per requirement, the events that include it. render_audit_plan returns Markdown, or saves DOCX or PDF as a generated report. |
| Execution | get_event_status, upsert_notes, link_evidence, render_post_event_report | upsert_notes writes typed notes with mentions; a promise on planned evidence sets it to promised. link_evidence proposes links. |
| Conclusion | get_assessment_unit, list_assessment_units, propose_finding, render_findings_report | get_assessment_unit returns requirement, criteria, risks, evidence links with excerpts, and suspected issues. |
| Cross-cutting | add_comment, get_history, revert | Work on any entity type. |

## Rules built into the tools

- Every write is versioned with the token owner as user and the AI as agent.
- `link_evidence`, `propose_finding`, AI-created events, roles, internal requirements, library sources, requirements and requirement links always land as proposed.
- No tool approves a finding, sets plan status, or deletes an artifact file.
- Tools refuse to run on an engagement where `ai_allowed` is off.
- Tools refuse cross-auditee reads of internal requirements. Engagement tools take `engagement_id`; `get_requirement`, `add_comment`, `get_history` and `revert` take it too, to reach an engagement's own items.
- Results are compact by default and include ids.

## Skills

The seven skills in `skills/` currently run in files mode: they read and write YAML and Markdown files in an engagement folder (`references/engagement-files.md` in each skill). Each skill's reference ends with a table mapping its files to these MCP tools. Moving a skill to MCP mode means replacing file reads and writes with the tool calls; the instructions stay.

| Skill | Phase | Main tools |
| --- | --- | --- |
| audit-engagement-setup | 1 to 4 | upsert and select tools |
| audit-role-discovery | 3 | get_artifact_text, upsert_people |
| audit-document-analysis | 5 | get_artifact_text, upsert_internal_requirements, set_criteria |
| audit-plan-builder | 6 | list_events, upsert_events, upsert_evidence_items, get_coverage, render_audit_plan |
| audit-event-debrief | 7 | get_event_status, upsert_notes, link_evidence, render_post_event_report |
| audit-assurance-review | 8 | list_assessment_units, get_assessment_unit, propose_finding, render_findings_report |
| audit-library-curator | after | set_guidance, set_criteria, link_requirements |

Report templates live in the skills' `assets/` folders and are used by the render tools.

## In-app AI actions

Five engagement buttons and two library buttons, each running the matching skill on the server through the same internal tools.

| Button | Where | Skill | Result |
| --- | --- | --- | --- |
| Derive roles from documents | Set-up, Auditee | audit-role-discovery | Proposed roles |
| Extract requirements | Set-up, Documents | audit-document-analysis | Proposed internal requirements and links |
| Draft plan | Plan, Events | audit-plan-builder | Proposed events and planned evidence |
| Process event materials | Event screen | audit-event-debrief | Proposed evidence links, statuses, draft report |
| Propose finding(s) | Findings | audit-assurance-review | Proposed findings with rationale |
| Extract requirements | Library, Import | audit-library-curator | A proposed source with its requirements, reviewed on Library, Review |
| Propose mapping | Library, Mapping | audit-library-curator | Proposed links to the chosen source, reviewed on Library, Mapping |

How it works:

- A button starts a background job with visible progress; it can be cancelled.
- The job is an agent loop: the server sends skill instructions and the tool list to the model through LiteLLM and executes the tool calls it returns.
- Everything written is marked proposed and versioned as AI on behalf of the user who pressed the button.
- A proposal bar on the screen leads to a review list: accept, edit or reject each, or accept all.
- Per engagement: `ai_allowed` switches AI off; `llm_profile` limits the engagement to one model. A model must pass the tool-calling check before it can run an action.

Implementation (`src/lib/ai/runner.ts`):

- The job runs the MCP server in process with the actor `{ user: who pressed the button, agent: the model, channel: ai }` and the action's name as revision note, so the review list can say which action proposed what.
- Each action gets a fixed tool allowlist (`ACTION_TOOLS`): the reads it needs plus its skill's proposal writes. No render, revert or comment tools. The model cannot leave the engagement: a different `engagement_id` is refused and the job's own is filled in; library actions refuse any `engagement_id`.
- System prompt: a short preamble (no one to ask, proposals only, finish with a summary) and the skill's `SKILL.md` in app mode. The first user message carries `Action:` and `Context:` lines and the task in words.
- At most 30 rounds; tool results over 30,000 characters are cut. Jobs are recorded in `ai_job` (status, steps, summary, error); a restart closes jobs left running. Only the starter or an admin can cancel.
- Settings live in `app_setting`: `ai.gateway` (address and write-only key), `ai.models` (each with its tool-calling check), `ai.assignments` (model per action and a default).
- Tests use `e2e/fake-llm.mjs`, a scripted OpenAI-compatible gateway that calls the real tools.
