# Domain layer

All validation, permissions and writes live here. UI routes, API routes, MCP tools and AI jobs are thin callers.
Every create, update, delete and revert goes through the one write function in `write.ts`.
