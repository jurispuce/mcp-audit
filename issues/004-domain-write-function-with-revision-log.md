---
title: "Domain write function with revision log"
milestone: "1 Foundation"
labels: ["backend", "versioning", "phase-1"]
---

## What

Implement the one function every create, update and delete goes through, and the `revision` table behind it.

## Acceptance criteria

- [ ] `revision` table: entity_type, entity_id, version, snapshot (JSON), author_user, author_agent, channel, note, reverted_from, created_at
- [ ] A single domain function writes entity state and a full snapshot in one transaction
- [ ] Every entity row carries current_version, created_at, created_by, deleted
- [ ] Direct table writes outside the domain layer are prevented by structure and covered by a test
- [ ] Channel is one of UI, MCP, in-app AI

## References

- `docs/architecture.md`
- `docs/data-model.md`
