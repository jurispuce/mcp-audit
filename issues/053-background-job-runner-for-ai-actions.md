---
title: "Background job runner for AI actions"
milestone: "7 In-app AI"
labels: ["ai", "backend", "phase-7"]
---

## What

Run a skill as an agent loop on the server.

## Acceptance criteria

- [ ] A job loads skill instructions and the internal tool list, calls the model and executes returned tool calls through the domain layer
- [ ] Progress is visible; a job can be cancelled; failures are reported clearly
- [ ] All writes are authored as AI on behalf of the user who started the job, channel in-app AI

## References

- `docs/mcp-tools.md`
