---
title: "Users, login and sessions"
milestone: "1 Foundation"
labels: ["backend", "auth", "phase-1"]
---

## What

Local accounts for a small auditor team.

## Acceptance criteria

- [ ] User table with name, email, role; first user is created at first start
- [ ] Password login with a session cookie; every route and API call requires a session
- [ ] Logout and password change work
- [ ] Engagement membership roles (lead auditor, auditor, reviewer) are modelled even if not yet enforced

## References

- `docs/architecture.md`
- `docs/data-model.md`
