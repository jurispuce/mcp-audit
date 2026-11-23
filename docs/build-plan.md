# Build plan

The plan to the MVP lives in GitHub as linked issues: one roadmap issue, seven milestone epics (one per phase, each also a GitHub milestone) and 59 work issues as sub-issues of their epic. Every work issue lists what it depends on and what it unblocks.

- Roadmap: [#1](https://github.com/jurispuce/mcp-audit/issues/1)
- MVP = milestones 1 to 6. Milestone 7 (in-app AI buttons, public endpoint) comes after one real engagement has been run on the MVP.
- Issues 12, 13 and 23 (CI, test harness, deployment guide) were added to the handoff's 56 so the result is deployable and tested, not only built.
- The `issues/` folder holds the original handoff text (handoff ids 001 to 056). The GitHub issues are the live version; when they diverge, GitHub wins.

## Milestones

| # | Epic | Milestone | Usable result |
| --- | --- | --- | --- |
| 1 | [#2](https://github.com/jurispuce/mcp-audit/issues/2) | Foundation | A running container with login, the versioning mechanism, the app shell, tests and CI |
| 2 | [#3](https://github.com/jurispuce/mcp-audit/issues/3) | Library | A browsable, searchable requirement library with NIS 2 imported |
| 3 | [#4](https://github.com/jurispuce/mcp-audit/issues/4) | MCP and first skill | Claude can load, link and improve requirements through MCP |
| 4 | [#5](https://github.com/jurispuce/mcp-audit/issues/5) | Engagement set-up | An engagement with selected requirements, scopes, roles, risks, documents and internal requirements |
| 5 | [#6](https://github.com/jurispuce/mcp-audit/issues/6) | Planning | An agreed audit plan with coverage and planned evidence |
| 6 | [#7](https://github.com/jurispuce/mcp-audit/issues/7) | Execution and conclusion | Events run on a phone, evidence linked, findings approved, reports exported. End of the MVP |
| 7 | [#8](https://github.com/jurispuce/mcp-audit/issues/8) | In-app AI | The five AI buttons through LiteLLM; public endpoint hardening |
| 8 | [#85](https://github.com/jurispuce/mcp-audit/issues/85) | External tenants | An isolated, pre-set instance per external audit firm, created with one command; passkey sign-in with email recovery; an AI budget per tenant |

## Issues in build order

| Handoff | Issue | Milestone | Title | Depends on |
| --- | --- | --- | --- | --- |
| 001 | #9 | 1 | Scaffold the SvelteKit and TypeScript project | — |
| 002 | #10 | 1 | Docker image and Compose file with one data volume | #9 |
| 003 | #11 | 1 | SQLite with Drizzle, migrations, WAL and full-text search | #9 |
| 057 | #12 | 1 | CI: checks on pull requests and Docker image published to GHCR | #9, #10 |
| 058 | #13 | 1 | Test harness: unit tests on in-memory SQLite, Playwright E2E against the container, seed data | #9, #10, #11 |
| 004 | #14 | 1 | Domain write function with revision log | #11 |
| 005 | #15 | 1 | Optimistic concurrency on writes | #14 |
| 006 | #16 | 1 | Soft delete and revert | #14 |
| 007 | #17 | 1 | Users, login and sessions | #11, #14 |
| 008 | #18 | 1 | Personal access tokens for MCP | #17 |
| 009 | #19 | 1 | Design tokens, component CSS and app shell | #9 |
| 010 | #20 | 1 | ItemCard and ItemSheet components | #19, #14, #16 |
| 011 | #21 | 1 | Comments on any item | #14, #20 |
| 012 | #22 | 1 | Backup and restore of the data volume | #10, #11 |
| 059 | #23 | 1 | Deployment guide: laptop, home server and VPS, with upgrade and rollback | #10, #22, #12 |
| 013 | #24 | 2 | Library schema: sources, requirements, links, guidance, criteria | #14, #16 |
| 014 | #25 | 2 | Library screen with requirement tree and search | #24, #19, #20 |
| 015 | #26 | 2 | Import a source from a file, with NIS 2 as seed | #24 |
| 016 | #27 | 2 | Typed links between requirements | #25 |
| 017 | #28 | 2 | Guidance and general criteria | #25 |
| 018 | #29 | 2 | Languages and translation pairs | #25 |
| 019 | #30 | 3 | MCP endpoint with token auth and AI authorship | #18, #14 |
| 020 | #31 | 3 | MCP orientation and library tools | #30, #24 |
| 021 | #32 | 3 | MCP cross-cutting tools: comments, history, revert | #30, #21, #16 |
| 022 | #33 | 3 | MCP guard rails | #30, #31 |
| 023 | #34 | 3 | audit-library-curator skill in MCP mode | #31, #32, #33 |
| 024 | #35 | 4 | Engagement schema: auditee, engagement, members, scopes, finding scale | #14, #17, #24 |
| 025 | #36 | 4 | Engagements list, create engagement and Home checklist | #35, #19, #20 |
| 026 | #37 | 4 | Requirement selection with pinning and assessment units | #35, #36, #24 |
| 027 | #38 | 4 | Scopes tab | #37 |
| 028 | #39 | 4 | Auditee tab with roles | #36 |
| 029 | #40 | 4 | Risk list with searchable multi-requirement picker | #37 |
| 030 | #41 | 4 | Document upload, storage and text extraction | #36, #11 |
| 031 | #42 | 4 | Internal requirements and client isolation | #41, #37 |
| 032 | #43 | 4 | MCP set-up and artifact tools | #30, #37, #38, #39, #40, #41, #42 |
| 033 | #44 | 4 | Set-up skills in MCP mode | #43, #33 |
| 034 | #45 | 5 | Planning schema: events, planned evidence, plan status | #35, #37 |
| 035 | #46 | 5 | Plan events: create, edit, remove, review AI drafts | #45, #36 |
| 036 | #47 | 5 | Plan status for the plan as a whole | #46 |
| 037 | #48 | 5 | Coverage view | #46, #37 |
| 038 | #49 | 5 | Planned evidence per event | #46, #40 |
| 039 | #50 | 5 | Audit plan export | #49, #41 |
| 040 | #51 | 5 | MCP planning tools and plan-builder skill | #43, #48, #49, #50 |
| 041 | #52 | 6 | Event screen for running an event | #45, #49 |
| 042 | #53 | 6 | Auditor notes with "/" commands and "@" mentions | #52, #41, #39 |
| 043 | #54 | 6 | Artifact capture and Inbox | #52, #41 |
| 044 | #55 | 6 | Evidence links | #54, #49 |
| 045 | #56 | 6 | Post-event report | #55, #53, #50 |
| 046 | #57 | 6 | Findings screen | #37, #55, #53, #40 |
| 047 | #58 | 6 | Approval into conclusions | #57 |
| 048 | #59 | 6 | Findings report export | #58, #50 |
| 049 | #60 | 6 | MCP execution and conclusion tools with their skills | #43, #53, #55, #56, #57, #59 |
| 050 | #61 | 6 | Global search | #11, #20, #57 |
| 051 | #62 | 6 | Run one real engagement end to end | #34, #44, #51, #60, #61, #23 |
| 052 | #63 | 7 | LiteLLM connection and model settings | #35, #17 |
| 053 | #64 | 7 | Background job runner for AI actions | #63, #33, #43, #51, #60 |
| 054 | #65 | 7 | Proposal bar and review list | #64, #20 |
| 055 | #66 | 7 | The five AI buttons | #64, #65 |
| 056 | #67 | 7 | Public endpoint readiness | #17, #30, #10 |

## Milestone 8: external tenants

Planned on 2026-11-21 as epic [#85](https://github.com/jurispuce/mcp-audit/issues/85), which holds the decisions and the assumptions still to confirm. No handoff ids: these issues were written in GitHub.

| Issue | Title | Depends on |
| --- | --- | --- |
| #86 | Outbound email: SMTP settings, templates and a test send | — |
| #87 | Passkeys: register and sign in with WebAuthn | — |
| #88 | Email as recovery and fallback: sign in with a one-time code | #86, #87 |
| #90 | Invite people by email; they join with a passkey | #86, #87, #88 |
| #89 | Sign-in method per instance: passkeys or passwords | #87, #88, #90 |
| #91 | Pre-set instance: a tenant profile applied at first start | #86, #89, #90 |
| #92 | Tenant host behind the Cloudflare Tunnel: one isolated container per tenant | — |
| #93 | MCP connections with passkey sign-in: Claude, ChatGPT and tokens | #87, #88, #89 |
| #94 | Tenant command: create, list, suspend, resume and delete | #91, #92 |
| #95 | AI through the shared gateway: a key and a monthly budget per tenant | #91, #92, #94 |
| #96 | Backups per tenant: schedule, restore, export and deletion | #92, #94 |
| #97 | Upgrades across tenants, with a backup first and rollback | #94, #96 |
| #98 | Operator overview: health, versions, backups and usage, without reading tenant data | #94, #95, #96 |
| #99 | Tenant isolation and security review before the first external tenant | #87 to #98 |
| #100 | Onboarding pack and one pilot tenant with a real external auditor | #86 to #99 |

## Critical path

- #9 → #11 → #14 → #17 → #18 → #30 → #31 → #33 → #34
- #35 → #36 → #37 → #42 → #43 → #44
- #45 → #46 → #49 → #52 → #54 → #55 → #57 → #58 → #59 → #60 → #62
- Milestone 8, sign-in: #86 and #87 → #88 → #90 → #89 → #91; hosting: #92 → #94 → #96 → #97; then #93 → #99 → #100
