---
title: "Import a source from a file, with NIS 2 as seed"
milestone: "2 Library"
labels: ["backend", "frontend", "phase-2"]
---

## What

Load a standard or regulation into the library.

## Acceptance criteria

- [ ] Import accepts a YAML file in the shape used by `skills/audit-engagement-setup` (id, parent, title, text, links)
- [ ] Re-importing updates changed requirements as new versions and does not duplicate
- [ ] A NIS 2 Article 21(2) seed file is included and imports cleanly
- [ ] Source records language and licence_note

## References

- `docs/data-model.md`
- `skills/audit-engagement-setup/SKILL.md`
