# mcp-audit

An audit planning and running app for a small auditor team: a versioned audit database with a thin responsive UI, an MCP server so Claude can work on the same records, and seven audit skills. Ships as one Docker container with one data volume.

| Want to                                | Read                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| Understand the decisions and the stack | `docs/architecture.md`                                                                  |
| See every entity and field             | `docs/data-model.md`                                                                    |
| See what each screen does              | `docs/workflow-and-screens.md`, then open `prototype/audit-prototype.html` in a browser |
| See the MCP tools and skills           | `docs/mcp-tools.md`, `skills/`                                                          |
| Start building                         | `CLAUDE.md`, then the roadmap issue #1 and `docs/build-plan.md`                         |

Work is tracked as GitHub issues: one roadmap, seven milestone epics, 59 linked work issues. The MVP is milestones 1 to 6.

## Development

Needs Node.js 22.12 or later.

```bash
npm install
npm run dev
```

The dev server runs on http://localhost:5173.

| Command          | What it does                                    |
| ---------------- | ----------------------------------------------- |
| `npm run dev`    | Development server with hot reload              |
| `npm run build`  | Production build into `build/`                  |
| `npm start`      | Run the production build (`node build`)         |
| `npm run check`  | Type check (svelte-check, TypeScript strict)    |
| `npm run lint`   | ESLint                                          |
| `npm run format` | Format with Prettier (`format:check` to verify) |
| `npm test`       | Unit tests (Vitest)                             |
| `npm run verify` | Format check, lint, type check and unit tests   |

## Code layout

| Folder           | Holds                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `src/lib/domain` | The domain layer: validation, permissions and the one write function. All rules live here. |
| `src/lib/db`     | Database connection, Drizzle schema and migrations                                         |
| `src/lib/mcp`    | The MCP endpoint and its tools (milestone 3)                                               |
| `src/routes`     | UI pages and JSON API routes; thin callers of the domain layer                             |

Imports from `src/lib` use the `#lib/...` subpath (SvelteKit 3 replaced `$lib`).
