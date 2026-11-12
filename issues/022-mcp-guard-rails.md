---
title: "MCP guard rails"
milestone: "3 MCP and first skill"
labels: ["mcp", "backend", "phase-3"]
---

## What

Enforce the rules that keep AI in the proposing role.

## Acceptance criteria

- [ ] Judgement writes (links, findings, AI-created events, roles, internal requirements) are forced to status proposed
- [ ] No tool can approve a finding, set plan status or delete an artifact file
- [ ] Tools refuse on engagements with ai_allowed off
- [ ] Tools refuse cross-auditee reads of internal requirements
- [ ] Each rule has a test

## References

- `docs/architecture.md`
- `docs/mcp-tools.md`
