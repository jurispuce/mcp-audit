---
title: "LiteLLM connection and model settings"
milestone: "7 In-app AI"
labels: ["ai", "backend", "phase-7"]
---

## What

Reach any model through one gateway.

## Acceptance criteria

- [ ] Settings for LiteLLM base URL and key; model chosen per AI action
- [ ] Per-engagement llm_profile limits the engagement to one model
- [ ] A tool-calling check runs when a model is configured; a failing model cannot be assigned to an action

## References

- `docs/architecture.md`
- `docs/mcp-tools.md`
