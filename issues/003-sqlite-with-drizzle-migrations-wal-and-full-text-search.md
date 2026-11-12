---
title: "SQLite with Drizzle, migrations, WAL and full-text search"
milestone: "1 Foundation"
labels: ["backend", "phase-1"]
---

## What

Set up the database layer.

## Acceptance criteria

- [ ] Drizzle schema and migration workflow in place; migrations run at start-up
- [ ] SQLite opens in WAL mode with foreign keys on
- [ ] FTS5 is available and a helper exists to index and search text columns
- [ ] A test database can be created in memory for unit tests

## References

- `docs/architecture.md`
