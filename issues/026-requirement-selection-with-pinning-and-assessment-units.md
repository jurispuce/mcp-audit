---
title: "Requirement selection with pinning and assessment units"
milestone: "4 Engagement set-up"
labels: ["backend", "frontend", "phase-4"]
---

## What

Choose what the audit is run against.

## Acceptance criteria

- [ ] Select all or individual requirements per source; selection is an EngagementRequirement row and is versioned
- [ ] pinned_version records the library version at selection; a later library change does not alter the engagement
- [ ] With multiple scopes, each requirement is common or per-scope
- [ ] AssessmentUnit rows are generated and regenerated when scopes or handling change, without losing existing findings

## References

- `docs/data-model.md`
- `docs/workflow-and-screens.md`
- `prototype/audit-prototype.html`
