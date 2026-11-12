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

/** Auditors who use the app. A versioned entity; credentials are kept apart so snapshots never hold them. */
export const user = sqliteTable(
	'user',
	{
		...entityColumns(),
		name: text('name').notNull(),
		email: text('email').notNull(),
		role: text('role', { enum: ['admin', 'auditor'] }).notNull(),
		active: integer('active', { mode: 'boolean' }).notNull().default(true)
	},
	(t) => [uniqueIndex('user_email').on(t.email)]
);

/** Password hash per user. Not versioned and never copied into revisions. */
export const userCredential = sqliteTable('user_credential', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id),
	passwordHash: text('password_hash').notNull(),
	mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

/** Browser sessions. The id is the SHA-256 of the cookie value; the cookie value is never stored. */
export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('session_user').on(t.userId)]
);

/** Personal access tokens that identify a user to the MCP endpoint. Stored as SHA-256 only. */
export const personalToken = sqliteTable(
	'personal_token',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		name: text('name').notNull(),
		tokenHash: text('token_hash').notNull(),
		prefix: text('prefix').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
		revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
	},
	(t) => [uniqueIndex('personal_token_hash').on(t.tokenHash), index('personal_token_user').on(t.userId)]
);

/** Append-only discussion on any entity. Comments are never edited or deleted (enforced by triggers). */
export const comment = sqliteTable(
	'comment',
	{
		id: text('id').primaryKey(),
		entityType: text('entity_type').notNull(),
		entityId: text('entity_id').notNull(),
		body: text('body').notNull(),
		authorUser: text('author_user')
			.notNull()
			.references(() => user.id),
		authorAgent: text('author_agent'),
		channel: text('channel', { enum: ['ui', 'mcp', 'ai'] }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('comment_entity').on(t.entityType, t.entityId, t.createdAt)]
);

// ---- Library: shared across engagements -------------------------------------------------------

/** A law, standard or internal document whose requirements are audited against. */
export const source = sqliteTable(
	'source',
	{
		...entityColumns(),
		/** Short stable key, for example "nis2". Import matches on it. */
		code: text('code').notNull(),
		type: text('type', { enum: ['law', 'standard', 'internal'] }).notNull(),
		title: text('title').notNull(),
		edition: text('edition'),
		language: text('language').notNull(),
		licenceNote: text('licence_note'),
		/** Set for internal sources: the auditee that owns it (table arrives in #35). */
		auditeeId: text('auditee_id'),
		/** Set when the source is an uploaded document (table arrives in #41). */
		artifactId: text('artifact_id')
	},
	(t) => [uniqueIndex('source_code').on(t.code)]
);

export const requirement = sqliteTable(
	'requirement',
	{
		...entityColumns(),
		sourceId: text('source_id')
			.notNull()
			.references(() => source.id),
		refCode: text('ref_code').notNull(),
		title: text('title').notNull(),
		text: text('text'),
		language: text('language').notNull(),
		/** The requirement this one is a translation of (same requirement, another language). */
		translationOf: text('translation_of'),
		locator: text('locator'),
		parentId: text('parent_id'),
		origin: text('origin', { enum: ['external', 'internal'] }).notNull(),
		status: text('status', { enum: ['proposed', 'confirmed'] }).notNull(),
		/** Internal requirements: short quote in the original language. */
		quote: text('quote'),
		/** Order among siblings, as in the source. */
		position: integer('position').notNull().default(0)
	},
	(t) => [
		uniqueIndex('requirement_source_ref').on(t.sourceId, t.refCode),
		index('requirement_parent').on(t.parentId),
		index('requirement_translation').on(t.translationOf)
	]
);

/** Directional typed link between two requirements, within or across sources. Versioned like any item. */
export const requirementLink = sqliteTable(
	'requirement_link',
	{
		...entityColumns(),
		fromId: text('from_id')
			.notNull()
			.references(() => requirement.id),
		toId: text('to_id')
			.notNull()
			.references(() => requirement.id),
		type: text('type', { enum: ['details', 'explains', 'implements', 'equivalent', 'conflicts'] }).notNull(),
		/** Only for implements: full or partial. */
		coverage: text('coverage', { enum: ['full', 'partial'] }),
		note: text('note')
	},
	(t) => [index('requirement_link_from').on(t.fromId), index('requirement_link_to').on(t.toId)]
);

/** The auditor's "how to audit this". One per requirement, versioned separately from its text. */
export const guidance = sqliteTable(
	'guidance',
	{
		...entityColumns(),
		requirementId: text('requirement_id')
			.notNull()
			.references(() => requirement.id),
		body: text('body').notNull()
	},
	(t) => [uniqueIndex('guidance_requirement').on(t.requirementId)]
);

/** What evidence must show. engagement_id empty means a general criterion. */
export const criterion = sqliteTable(
	'criterion',
	{
		...entityColumns(),
		requirementId: text('requirement_id')
			.notNull()
			.references(() => requirement.id),
		engagementId: text('engagement_id'),
		text: text('text').notNull(),
		/** JSON array of strings. */
		expectedEvidence: text('expected_evidence', { mode: 'json' }).$type<string[]>().notNull().default([]),
		position: integer('position').notNull().default(0)
	},
	(t) => [index('criterion_requirement').on(t.requirementId)]
);
