---
title: "Planning schema: events, planned evidence, plan status"
milestone: "5 Planning"
labels: ["backend", "phase-5"]
---

## What

Tables and domain functions for the plan.

## Acceptance criteria

- [ ] Event with title, format, date, start_time, duration, participants (roles), requirements (many), status planned or held, proposed flag
- [ ] EvidenceItem with text, kind, criticality, requirements, scope, status, promised_by, promised_due
- [ ] Plan status (draft, sent, agreed) with timestamp on the engagement

## References

- `docs/data-model.md`
