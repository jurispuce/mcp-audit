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
