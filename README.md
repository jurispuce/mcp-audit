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

## Run with Docker

```bash
cp .env.example .env
docker compose up -d
```

The app listens on http://127.0.0.1:3000 by default. Everything it stores (the SQLite database and uploaded files) lives in the `mcp-audit-data` volume; the rest of the container is read-only. `GET /health` returns the version and migration state.

Settings are environment variables, listed with defaults in `.env.example`. Backups: `docs/backup.md`. To share the app with the team on a private network, set `BIND_ADDRESS` to the host's LAN or VPN address.

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

## Testing

Every issue adds its tests as it is built: unit tests for domain rules, Playwright tests for screens and flows.

| Command                        | What it runs                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                     | Unit tests (Vitest). The domain layer runs against an in-memory SQLite database created from the migrations (`createTestDatabase()`).           |
| `npm run build && npm run e2e` | Playwright end-to-end tests. Starts the production build twice with fresh data folders under `.e2e/`: one normal, one for the first-start flow. |
| `npm run seed`                 | Creates the test users in a running app (`admin@example.test` and `auditor@example.test`, password `test-password-123`).                        |

End-to-end tests can also run against containers, which is what CI does:

```bash
docker run -d -p 3000:3000 -e TEST_SEED_ENABLED=true ghcr.io/jurispuce/mcp-audit:main
docker run -d -p 3001:3000 -e TEST_SEED_ENABLED=true ghcr.io/jurispuce/mcp-audit:main
E2E_BASE_URL=http://127.0.0.1:3000 E2E_FIRST_START_URL=http://127.0.0.1:3001 npm run e2e
```

`TEST_SEED_ENABLED=true` turns on the seed and a password-free test login under `/api/test/`. Without it those endpoints do not exist; never set it in production.

Tests are organised by flow under `e2e/tests/`; files ending in `.phone.spec.ts` run with a phone viewport.

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request:

1. Format check, lint, type check and unit tests.
2. Builds the Docker image, starts it with fresh volumes and a read-only root filesystem, checks the reported version and that test endpoints are closed in a normal container, runs Playwright against it, and runs `scripts/backup-restore-check.sh`.
3. On the default branch, publishes `ghcr.io/jurispuce/mcp-audit:main` for amd64 and arm64. A tag such as `v0.1.0` publishes `:v0.1.0` and `:latest`.

A pre-commit hook (installed by `npm install`) formats and lints the staged files.

## Code layout

| Folder           | Holds                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `src/lib/domain` | The domain layer: validation, permissions and the one write function. All rules live here. |
| `src/lib/db`     | Database connection, Drizzle schema and migrations                                         |
| `src/lib/mcp`    | The MCP endpoint and its tools (milestone 3)                                               |
| `src/routes`     | UI pages and JSON API routes; thin callers of the domain layer                             |

Imports from `src/lib` use the `#lib/...` subpath with the file extension, for example `#lib/server/db.ts` (SvelteKit 3 replaced `$lib`).

## Database

SQLite in WAL mode through Drizzle. The schema is in `src/lib/db/schema.ts`; migrations in `drizzle/` run automatically when the server starts.

```bash
npx drizzle-kit generate --name=<what-changed>
```

Full-text search uses one FTS5 table; `src/lib/db/fts.ts` indexes and searches any text field. Unit tests use `createTestDatabase()`, an in-memory database with every migration applied.
