import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Instance-wide settings stored as key and JSON value. Not audit data, so not versioned. */
export const appSetting = sqliteTable('app_setting', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`)
});

/**
 * Columns every versioned entity carries. Entity tables are written only by the domain write
 * function (src/lib/domain/write.ts), which also appends a full snapshot to `revision`.
 */
export const entityColumns = () => ({
	id: text('id').primaryKey(),
	currentVersion: integer('current_version').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	createdBy: text('created_by').notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	updatedBy: text('updated_by').notNull(),
	deleted: integer('deleted', { mode: 'boolean' }).notNull().default(false)
});

/** Append-only history of every entity. One row per version; never updated or deleted. */
export const revision = sqliteTable(
	'revision',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id').notNull(),
		version: integer('version').notNull(),
		snapshot: text('snapshot', { mode: 'json' }).notNull(),
		authorUser: text('author_user').notNull(),
		authorAgent: text('author_agent'),
		channel: text('channel', { enum: ['ui', 'mcp', 'ai'] }).notNull(),
		note: text('note'),
		revertedFrom: integer('reverted_from'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [
		uniqueIndex('revision_entity_version').on(t.entityType, t.entityId, t.version),
		index('revision_author').on(t.authorUser)
	]
);
