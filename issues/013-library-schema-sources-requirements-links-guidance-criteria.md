---
title: "Library schema: sources, requirements, links, guidance, criteria"
milestone: "2 Library"
labels: ["backend", "phase-2"]
---

## What

Tables and domain functions for the reusable requirement library.

## Acceptance criteria

- [ ] Source, Requirement, RequirementLink, Guidance, Criterion as in the data model
- [ ] Requirement tree via parent_id; ref_code unique within a source
- [ ] Link types: details, explains, implements, equivalent, conflicts; implements carries coverage
- [ ] All rows versioned through the domain write function

## References

- `docs/data-model.md`
