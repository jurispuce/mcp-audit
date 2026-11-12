---
title: "MCP endpoint with token auth and AI authorship"
milestone: "3 MCP and first skill"
labels: ["mcp", "backend", "phase-3"]
---

## What

Expose the domain layer over MCP in the same process.

## Acceptance criteria

- [ ] Streamable HTTP endpoint at `/mcp` using the official TypeScript SDK
- [ ] Requests authenticate with a personal token; unauthenticated requests are refused
- [ ] Every write records the token owner as user, the AI as agent and channel MCP
- [ ] Connection instructions for Claude Desktop and Claude Code documented

## References

- `docs/architecture.md`
- `docs/mcp-tools.md`
