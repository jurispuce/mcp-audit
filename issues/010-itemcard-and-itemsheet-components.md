---
title: "ItemCard and ItemSheet components"
milestone: "1 Foundation"
labels: ["frontend", "design", "versioning", "phase-1"]
---

## What

The one pattern used for every record.

## Acceptance criteria

- [ ] ItemCard shows reference line, title, state badge, body, meta row (version, author, time) and actions
- [ ] ItemSheet opens over any screen via `?item=<type>:<id>` with tabs Details, Links, Comments, History
- [ ] History lists versions with author, time, channel and changed fields; Revert on all but the current version, with confirmation
- [ ] Proposed (AI) and locked (approved) card states implemented

## References

- `design/components/ItemCard/README.md`
- `design/components/ItemSheet/README.md`
- `prototype/audit-prototype.html`
