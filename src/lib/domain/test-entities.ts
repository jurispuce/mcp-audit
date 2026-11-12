import type { AppDatabase } from '#lib/db/client.ts';
import { ValidationError } from './errors';
import type { Actor, EntityDefinition, Row } from './write';

/**
 * Throwaway entity types for testing the write path in isolation: a plain item and a link row.
 * Tables are created on demand in a test database; they are not part of the app schema.
 */

const COMMON = `id TEXT PRIMARY KEY, current_version INTEGER NOT NULL, created_at INTEGER NOT NULL,
	created_by TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0`;

export function createTestEntityTables(app: AppDatabase): void {
	app.sqlite.exec(`
		CREATE TABLE test_item (${COMMON}, title TEXT NOT NULL, body TEXT);
		CREATE TABLE test_link (${COMMON}, from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL);
		CREATE TABLE test_guarded (${COMMON}, title TEXT NOT NULL, status TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, engagement_id TEXT);
	`);
}

export const testItem: EntityDefinition = {
	type: 'test_item',
	table: 'test_item',
	columns: ['title', 'body'],
	parse(input, existing) {
		const out: Row = {};
		if ('title' in input || !existing) {
			const title = String(input.title ?? '').trim();
			if (!title) throw new ValidationError('Title is required', { title: 'Required' });
			out.title = title;
		}
		if ('body' in input) out.body = input.body == null ? null : String(input.body);
		return out;
	},
	search: (row) => ({ title: row.title as string, body: row.body as string | null }),
	label: (row) => String(row.title)
};

export const testLink: EntityDefinition = {
	type: 'test_link',
	table: 'test_link',
	columns: ['from_id', 'to_id', 'type'],
	parse(input, existing) {
		const out: Row = {};
		for (const col of ['from_id', 'to_id', 'type'] as const) {
			if (col in input || !existing) {
				const v = String(input[col] ?? '').trim();
				if (!v) throw new ValidationError(`${col} is required`);
				out[col] = v;
			}
		}
		return out;
	},
	label: (row) => `${row.from_id} ${row.type} ${row.to_id}`
};

export const uiActor: Actor = { userId: 'u-auditor', channel: 'ui' };
export const mcpActor: Actor = { userId: 'u-auditor', agent: 'Claude', channel: 'mcp' };

/** Fixture engagements for guard-rail tests: id -> ai_allowed. */
export const testEngagements = new Map<string, boolean>();

/**
 * Stands in for findings, events and other judgement items until their tables exist: a status that AI
 * may only set to proposed, an approval only a person may change, and an engagement with ai_allowed.
 */
export const testGuarded: EntityDefinition = {
	type: 'test_guarded',
	table: 'test_guarded',
	columns: ['title', 'status', 'approved', 'engagement_id'],
	parse(input, existing) {
		const out: Row = {};
		if ('title' in input || !existing) out.title = String(input.title ?? 'x');
		if ('status' in input || !existing) out.status = String(input.status ?? 'confirmed');
		if ('approved' in input) out.approved = input.approved ? 1 : 0;
		if ('engagement_id' in input) out.engagement_id = (input.engagement_id as string | null) ?? null;
		return out;
	},
	judgement: () => ({ column: 'status', proposed: 'proposed' }),
	humanOnly: ['approved'],
	engagementOf: (_app, row) => {
		const id = row.engagement_id == null ? null : String(row.engagement_id);
		return id && testEngagements.has(id) ? { id, aiAllowed: testEngagements.get(id)! } : null;
	},
	label: (row) => String(row.title)
};
