---
title: "Optimistic concurrency on writes"
milestone: "1 Foundation"
labels: ["backend", "versioning", "phase-1"]
---

## What

Refuse a write that was based on an out-of-date version.

## Acceptance criteria

- [ ] Each update carries the version it was based on
- [ ] A stale write is rejected with the current version returned
- [ ] UI shows the newer version and lets the user redo the change
- [ ] Covered by tests with two concurrent writers

## References

- `docs/architecture.md`
