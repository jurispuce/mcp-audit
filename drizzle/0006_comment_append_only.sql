-- Comments are an append-only discussion log: they can be added, never changed or removed.
CREATE TRIGGER `comment_no_update` BEFORE UPDATE ON `comment`
BEGIN
	SELECT RAISE(ABORT, 'comments are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `comment_no_delete` BEFORE DELETE ON `comment`
BEGIN
	SELECT RAISE(ABORT, 'comments are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `comment_ai_has_agent` BEFORE INSERT ON `comment`
WHEN NEW.channel NOT IN ('ui', 'mcp', 'ai') OR (NEW.channel IN ('mcp', 'ai') AND (NEW.author_agent IS NULL OR NEW.author_agent = ''))
BEGIN
	SELECT RAISE(ABORT, 'AI comments must record the agent; channel must be ui, mcp or ai');
END;
