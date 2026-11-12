---
title: "Docker image and Compose file with one data volume"
milestone: "1 Foundation"
labels: ["infra", "phase-1"]
---

## What

Package the app so the same image runs on a laptop, a server or a VPS.

## Acceptance criteria

- [ ] `docker compose up` starts the app with a single mounted data volume holding the SQLite file and the files folder
- [ ] No state is written outside the volume
- [ ] Compose file includes an optional, commented LiteLLM service
- [ ] App listens on a configurable host and port and assumes nothing about localhost

## References

- `docs/architecture.md`
