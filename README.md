# mcp-audit

An audit planning and running app for a small auditor team: a versioned audit database with a thin responsive UI, an MCP server so Claude can work on the same records, and seven audit skills. Ships as one Docker container with one data volume.

No application code yet. This repository currently holds the design handoff: decisions, data model, design system, a clickable prototype, the skills and the build plan.

| Want to | Read |
| --- | --- |
| Understand the decisions and the stack | `docs/architecture.md` |
| See every entity and field | `docs/data-model.md` |
| See what each screen does | `docs/workflow-and-screens.md`, then open `prototype/audit-prototype.html` in a browser |
| See the MCP tools and skills | `docs/mcp-tools.md`, `skills/` |
| Start building | `CLAUDE.md`, then the roadmap issue #1 and `docs/build-plan.md` |

Work is tracked as GitHub issues: one roadmap, seven milestone epics, 59 linked work issues. The MVP is milestones 1 to 6.
