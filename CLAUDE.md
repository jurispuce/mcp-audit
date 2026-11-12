# mcp-audit

An audit planning and running app: a versioned audit database with a thin responsive UI, an MCP server and audit skills. Built for a small auditor team; runs as one Docker container.

## Read first

| For | Read |
| --- | --- |
| Decisions, stack, versioning rules | `docs/architecture.md` |
| Entities and fields | `docs/data-model.md` |
| What each screen does; what the prototype simulated | `docs/workflow-and-screens.md` |
| MCP tools, skills, in-app AI | `docs/mcp-tools.md` |
| Phases and milestones | `docs/build-phases.md` |
| Issue numbers, dependencies, critical path | `docs/build-plan.md` and the GitHub roadmap issue #1 |
| Look, components, navigation, routes | `design/README.md`, `design/navigation.md`, `design/components/` |
| Behaviour reference for every screen | `prototype/audit-prototype.html` (open in a browser) |
| Work to do | The GitHub issues (sub-issues of the milestone epics); `issues/` holds the original handoff text |

## How to work

- Build issue by issue, in number order within a milestone. One issue, one branch, one pull request that references the issue.
- An issue is done when every acceptance criterion is met and covered by a test where a test makes sense.
- When an issue turns out to be wrong or incomplete, say so and update the issue before building around it.
- The prototype is the reference for behaviour and layout, not for code. It is one HTML file with in-memory data and simulated AI. Do not copy its code structure.

## Rules that must hold everywhere

1. Every create, update, delete and revert goes through the one domain write function and produces a revision. No direct table writes from routes, MCP tools or jobs.
2. Every AI write records both the user and the agent. Judgement writes by AI (evidence links, findings, drafted events, roles, internal requirements) are stored as proposed.
3. Approving a finding and changing plan status are UI-only actions.
4. History is never rewritten: delete is a flag, revert is a new version.
5. Internal requirements never cross from one auditee to another.
6. Missing evidence leads to "no reasonable assurance", never to a non-conformity.
7. Nothing assumes localhost. Every route and tool requires an authenticated user.

## Conventions

- TypeScript strict. SvelteKit for UI and API. Drizzle with SQLite.
- Domain logic lives in `src/lib/domain`; UI, API routes, MCP tools and AI jobs are thin callers.
- Styling uses `design/tokens.css` and `design/components.css` (classes prefixed `au-`). No hex values in components. Newer patterns that exist only in the prototype (coverage pills, event picker, note command menu, coverage meter) should be added to `design/components.css` when first built.
- Interface text: English, sentence case, buttons are a verb and its object. Content is stored and shown as received, in any language.
- Use the audit terms from the data model exactly: engagement, scope, requirement, event, evidence, artifact, finding, conclusion.
- Phone-first for the Event and Findings screens; tappable elements at least 44px high.

## Skills

`skills/` holds seven audit skills. They currently work in files mode (YAML and Markdown in an engagement folder). Each milestone from 3 onwards includes an issue to move the matching skills to the MCP tools. Report templates live in the skills' `assets/` folders and are the templates the app's render functions use.
