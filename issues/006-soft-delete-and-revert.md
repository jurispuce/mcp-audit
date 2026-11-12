---
title: "Soft delete and revert"
milestone: "1 Foundation"
labels: ["backend", "versioning", "phase-1"]
---

## What

Deleting and reverting never rewrite history.

## Acceptance criteria

- [ ] Delete sets `deleted` in a new version; lists exclude deleted rows
- [ ] Revert to version N creates a new version copying N with reverted_from = N
- [ ] A deleted item can be restored by reverting
- [ ] Works for link rows as well as main entities

## References

- `docs/architecture.md`
