-- History is never rewritten: revisions can be added, never changed or removed.
CREATE TRIGGER `revision_no_update` BEFORE UPDATE ON `revision`
BEGIN
	SELECT RAISE(ABORT, 'revision is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `revision_no_delete` BEFORE DELETE ON `revision`
BEGIN
	SELECT RAISE(ABORT, 'revision is append-only');
END;
--> statement-breakpoint
-- The check drizzle cannot express: a channel is one of ui, mcp, ai; an AI channel always names the agent.
CREATE TRIGGER `revision_ai_has_agent` BEFORE INSERT ON `revision`
WHEN NEW.channel NOT IN ('ui', 'mcp', 'ai') OR (NEW.channel IN ('mcp', 'ai') AND (NEW.author_agent IS NULL OR NEW.author_agent = ''))
BEGIN
	SELECT RAISE(ABORT, 'AI writes must record the agent; channel must be ui, mcp or ai');
END;
