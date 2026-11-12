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
		artifactId: text('artifact_id'),
		/** Internal sources: the engagement they were extracted in (carry-over decides reuse). */
		engagementId: text('engagement_id')
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

// ---- Engagement set-up --------------------------------------------------------------------------

/** The client. Owns its people and internal sources; the boundary no data crosses. */
export const auditee = sqliteTable('auditee', {
	...entityColumns(),
	name: text('name').notNull(),
	description: text('description')
});

export const engagement = sqliteTable(
	'engagement',
	{
		...entityColumns(),
		name: text('name').notNull(),
		auditeeId: text('auditee_id')
			.notNull()
			.references(() => auditee.id),
		startDate: text('start_date').notNull(),
		endDate: text('end_date'),
		description: text('description'),
		status: text('status', { enum: ['active', 'closed'] }).notNull(),
		scopeMode: text('scope_mode', { enum: ['single', 'multiple'] }).notNull(),
		findingScaleId: text('finding_scale_id'),
		workingLanguage: text('working_language').notNull(),
		reportLanguage: text('report_language').notNull(),
		carryOverInternal: integer('carry_over_internal', { mode: 'boolean' }).notNull().default(false),
		aiAllowed: integer('ai_allowed', { mode: 'boolean' }).notNull().default(true),
		llmProfile: text('llm_profile'),
		planStatus: text('plan_status', { enum: ['draft', 'sent', 'agreed'] }).notNull(),
		planStatusAt: integer('plan_status_at', { mode: 'timestamp_ms' })
	},
	(t) => [index('engagement_auditee').on(t.auditeeId)]
);

export const engagementMember = sqliteTable(
	'engagement_member',
	{
		...entityColumns(),
		engagementId: text('engagement_id')
			.notNull()
			.references(() => engagement.id),
		userId: text('user_id')
			.notNull()
			.references(() => user.id),
		role: text('role', { enum: ['lead_auditor', 'auditor', 'reviewer'] }).notNull()
	},
	(t) => [index('engagement_member_engagement').on(t.engagementId)]
);

export const scope = sqliteTable(
	'scope',
	{
		...entityColumns(),
		engagementId: text('engagement_id')
			.notNull()
			.references(() => engagement.id),
		name: text('name').notNull(),
		description: text('description'),
		position: integer('position').notNull().default(0)
	},
	(t) => [index('scope_engagement').on(t.engagementId)]
);

/** Each engagement has its own copy of a finding scale, so editing it never changes another audit. */
export const findingScale = sqliteTable('finding_scale', {
	...entityColumns(),
	engagementId: text('engagement_id').references(() => engagement.id),
	name: text('name').notNull()
});

export const findingValue = sqliteTable(
	'finding_value',
	{
		...entityColumns(),
		findingScaleId: text('finding_scale_id')
			.notNull()
			.references(() => findingScale.id),
		code: text('code').notNull(),
		label: text('label').notNull(),
		position: integer('position').notNull(),
		tone: text('tone', { enum: ['neutral', 'ok', 'info', 'warn', 'danger'] }).notNull(),
		isNonconformity: integer('is_nonconformity', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [index('finding_value_scale').on(t.findingScaleId)]
);

/** A role at the auditee. The role is what matters; name, email and unit are optional. */
export const person = sqliteTable(
	'person',
	{
		...entityColumns(),
		auditeeId: text('auditee_id')
			.notNull()
			.references(() => auditee.id),
		role: text('role').notNull(),
		name: text('name'),
		email: text('email'),
		unit: text('unit'),
		/** JSON array of strings. */
		responsibilities: text('responsibilities', { mode: 'json' }).$type<string[]>().notNull().default([]),
		sourceDocument: text('source_document'),
		sourceSection: text('source_section'),
		status: text('status', { enum: ['proposed', 'confirmed'] }).notNull()
	},
	(t) => [index('person_auditee').on(t.auditeeId)]
);

/** The requirement selection: which library requirement, pinned at which version, handled how. */
export const engagementRequirement = sqliteTable(
	'engagement_requirement',
	{
		...entityColumns(),
		engagementId: text('engagement_id')
			.notNull()
			.references(() => engagement.id),
		requirementId: text('requirement_id')
			.notNull()
			.references(() => requirement.id),
		pinnedVersion: integer('pinned_version').notNull(),
		scopeHandling: text('scope_handling', { enum: ['common', 'per_scope'] }).notNull(),
		criticality: text('criticality', { enum: ['high', 'medium', 'low'] })
	},
	(t) => [index('engagement_requirement_engagement').on(t.engagementId)]
);

/** One requirement in one scope (scope empty when common): what a finding attaches to. Generated. */
export const assessmentUnit = sqliteTable(
	'assessment_unit',
	{
		...entityColumns(),
		engagementId: text('engagement_id')
			.notNull()
			.references(() => engagement.id),
		engagementRequirementId: text('engagement_requirement_id')
			.notNull()
			.references(() => engagementRequirement.id),
		scopeId: text('scope_id')
	},
	(t) => [index('assessment_unit_engagement').on(t.engagementId)]
);

export const risk = sqliteTable(
	'risk',
	{
		...entityColumns(),
		engagementId: text('engagement_id')
			.notNull()
			.references(() => engagement.id),
		title: text('title').notNull(),
		description: text('description'),
		origin: text('origin', { enum: ['auditee_register', 'auditor'] }).notNull(),
		level: text('level', { enum: ['high', 'medium', 'low'] }).notNull(),
		/** JSON array of library requirement ids. */
		requirementIds: text('requirement_ids', { mode: 'json' }).$type<string[]>().notNull().default([]),
		/** JSON array of scope ids; empty means all scopes. */
		scopeIds: text('scope_ids', { mode: 'json' }).$type<string[]>().notNull().default([])
	},
	(t) => [index('risk_engagement').on(t.engagementId)]
);

/** Raw material: a document, photo or transcript. Files are immutable; only this metadata is versioned. */
export const artifact = sqliteTable(
	'artifact',
	{
		...entityColumns(),
		engagementId: text('engagement_id')
			.notNull()
			.references(() => engagement.id),
		kind: text('kind'),
		fileHash: text('file_hash'),
		filename: text('filename'),
		mimeType: text('mime_type'),
		size: integer('size'),
		title: text('title'),
		versionLabel: text('version_label'),
		approvalDate: text('approval_date'),
		language: text('language'),
		origin: text('origin', { enum: ['upload', 'mcp', 'mention', 'generated'] }).notNull(),
		state: text('state', { enum: ['received', 'mentioned'] }).notNull(),
		receivedFrom: text('received_from'),
		receivedAt: integer('received_at', { mode: 'timestamp_ms' }),
		eventId: text('event_id'),
		textStatus: text('text_status', { enum: ['none', 'extracted', 'failed', 'unsupported'] }).notNull()
	},
	(t) => [index('artifact_engagement').on(t.engagementId), index('artifact_hash').on(t.fileHash)]
);

/** Text extracted from an artifact's file, with page breaks. Derived from an immutable file, so not versioned. */
export const artifactText = sqliteTable('artifact_text', {
	artifactId: text('artifact_id')
		.primaryKey()
		.references(() => artifact.id),
	text: text('text').notNull(),
	/** JSON array of page start offsets into text (one entry for unpaged files). */
	pageStarts: text('page_starts', { mode: 'json' }).$type<number[]>().notNull(),
	extractedAt: integer('extracted_at', { mode: 'timestamp_ms' }).notNull()
});
