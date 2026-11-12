---
title: "Auditor notes with \"/\" commands and \"@\" mentions"
milestone: "6 Execution and conclusion"
labels: ["frontend", "backend", "phase-6"]
---

## What

Structured note-taking that follows a live conversation.

## Acceptance criteria

- [ ] Note entity with type (note, promise, issue), text, mentions and timestamp
- [ ] Typing "/" offers requirement, document, person, promise, issue; typing "@" offers requirements, internal requirements, documents, roles and this event's planned evidence
- [ ] Keyboard and touch both work; Enter saves; mentions may contain spaces
- [ ] A promise mentioning an evidence item sets it to promised by the mentioned role
- [ ] A suspected issue appears on the Findings card of the mentioned requirement and never in shared reports
- [ ] An unknown document name creates a document in state mentioned
- [ ] Each note shows a time offset from the first note of the event

## References

- `docs/data-model.md`
- `docs/workflow-and-screens.md`
- `prototype/audit-prototype.html`
