# Issues

The 56 handoff issues in build order, as drafted. They have been created in GitHub (with three more for CI, tests and deployment) as linked sub-issues of milestone epics; see `docs/build-plan.md` for the mapping from handoff id to GitHub issue number. The GitHub issues are the live version.


## Milestone 1 Foundation

1. Scaffold the SvelteKit and TypeScript project
2. Docker image and Compose file with one data volume
3. SQLite with Drizzle, migrations, WAL and full-text search
4. Domain write function with revision log
5. Optimistic concurrency on writes
6. Soft delete and revert
7. Users, login and sessions
8. Personal access tokens for MCP
9. Design tokens, component CSS and app shell
10. ItemCard and ItemSheet components
11. Comments on any item
12. Backup and restore of the data volume

## Milestone 2 Library

13. Library schema: sources, requirements, links, guidance, criteria
14. Library screen with requirement tree and search
15. Import a source from a file, with NIS 2 as seed
16. Typed links between requirements
17. Guidance and general criteria
18. Languages and translation pairs

## Milestone 3 MCP and first skill

19. MCP endpoint with token auth and AI authorship
20. MCP orientation and library tools
21. MCP cross-cutting tools: comments, history, revert
22. MCP guard rails
23. audit-library-curator skill in MCP mode

## Milestone 4 Engagement set-up

24. Engagement schema: auditee, engagement, members, scopes, finding scale
25. Engagements list, create engagement and Home checklist
26. Requirement selection with pinning and assessment units
27. Scopes tab
28. Auditee tab with roles
29. Risk list with searchable multi-requirement picker
30. Document upload, storage and text extraction
31. Internal requirements and client isolation
32. MCP set-up and artifact tools
33. Set-up skills in MCP mode

## Milestone 5 Planning

34. Planning schema: events, planned evidence, plan status
35. Plan events: create, edit, remove, review AI drafts
36. Plan status for the plan as a whole
37. Coverage view
38. Planned evidence per event
39. Audit plan export
40. MCP planning tools and plan-builder skill

## Milestone 6 Execution and conclusion

41. Event screen for running an event
42. Auditor notes with "/" commands and "@" mentions
43. Artifact capture and Inbox
44. Evidence links
45. Post-event report
46. Findings screen
47. Approval into conclusions
48. Findings report export
49. MCP execution and conclusion tools with their skills
50. Global search
51. Run one real engagement end to end

## Milestone 7 In-app AI

52. LiteLLM connection and model settings
53. Background job runner for AI actions
54. Proposal bar and review list
55. The five AI buttons
56. Public endpoint readiness
