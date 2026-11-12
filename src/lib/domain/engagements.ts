import { randomUUID } from 'node:crypto';
import { assertProfileUsable } from './ai-settings';
import { isHuman } from './guards';
import type { AppDatabase } from '#lib/db/client.ts';
import { NotFoundError, ValidationError } from './errors';
import { normalizeLanguage } from './library';
import { registerEntity } from './registry';
import { ENGAGEMENT_ROLES, type EngagementRole } from './roles';
import {
	createEntity,
	readRow,
	updateEntity,
	type Actor,
	type EntityDefinition,
	type Row,
	type WriteOp
} from './write';

/**
 * Engagement set-up: auditee, engagement, members, scopes and the engagement's own finding scale.
 * All versioned through the write function. AI may not touch plan status, the AI switch, the model
 * profile or carry-over; and nothing at all on an engagement whose AI switch is off.
 */

const str = (v: unknown) => (v == null ? '' : String(v)).trim();
const optional = (v: unknown) => str(v) || null;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function date(v: unknown, field: string, required: boolean): string | null {
	const s = str(v);
	if (!s) {
		if (required) throw new ValidationError('Choose a date.', { [field]: 'Required' });
		return null;
	}
	if (!ISO_DATE.test(s) || Number.isNaN(Date.parse(s)))
		throw new ValidationError('Use a date such as 2026-11-16.', { [field]: 'Not a date' });
	return s;
}

/** The engagement a row belongs to, with its AI switch, for the write path's guard rails. */
export function engagementGuard(
	app: AppDatabase,
	engagementId: unknown
): { id: string; aiAllowed: boolean } | null {
	if (!engagementId) return null;
	const e = app.sqlite
		.prepare('SELECT id, ai_allowed FROM engagement WHERE id = ?')
		.get(String(engagementId)) as { id: string; ai_allowed: number } | undefined;
	return e ? { id: e.id, aiAllowed: e.ai_allowed === 1 } : null;
}

const byEngagement = (app: AppDatabase, row: Row) => engagementGuard(app, row.engagement_id);

export const auditeeDefinition: EntityDefinition = registerEntity({
	type: 'auditee',
	table: 'auditee',
	columns: ['name', 'description'],
	fieldLabels: { name: 'Name', description: 'Description' },
	parse(input, existing) {
		const out: Row = {};
		if ('name' in input || !existing) {
			const name = str(input.name);
			if (!name) throw new ValidationError('Name the auditee.', { auditee: 'Required' });
			out.name = name;
		}
		if ('description' in input) out.description = optional(input.description);
		return out;
	},
	search: (row) => ({ name: row.name as string }),
	label: (row) => String(row.name),
	refLine: () => 'Auditee'
});

export const engagementDefinition: EntityDefinition = registerEntity({
	type: 'engagement',
	table: 'engagement',
	columns: [
		'name',
		'auditee_id',
		'start_date',
		'end_date',
		'description',
		'status',
		'scope_mode',
		'finding_scale_id',
		'working_language',
		'report_language',
		'carry_over_internal',
		'ai_allowed',
		'llm_profile',
		'plan_status',
		'plan_status_at'
	],
	detailColumns: [
		'name',
		'start_date',
		'end_date',
		'working_language',
		'report_language',
		'scope_mode',
		'plan_status',
		'ai_allowed',
		'carry_over_internal',
		'description'
	],
	fieldLabels: {
		name: 'Name',
		auditee_id: 'Auditee',
		start_date: 'Start date',
		end_date: 'End date',
		description: 'Description',
		status: 'Status',
		scope_mode: 'Scopes',
		working_language: 'Working language',
		report_language: 'Report language',
		carry_over_internal: 'Carry over internal requirements',
		ai_allowed: 'AI allowed',
		llm_profile: 'Model',
		plan_status: 'Plan status',
		plan_status_at: 'Plan status set'
	},
	formatValue(column, value) {
		if (['carry_over_internal', 'ai_allowed', 'deleted'].includes(column))
			return Number(value) === 1 ? 'Yes' : 'No';
		if (column === 'scope_mode') return value === 'multiple' ? 'Several scopes' : 'One scope';
		if (column === 'working_language' || column === 'report_language')
			return String(value ?? '').toUpperCase();
		if (column === 'plan_status')
			return (
				({ draft: 'Draft', sent: 'Sent to auditee', agreed: 'Agreed' } as Record<string, string>)[
					String(value)
				] ?? ''
			);
		if (column === 'plan_status_at')
			return value ? new Date(Number(value)).toISOString().slice(0, 16).replace('T', ' ') : '';
		return value == null ? '' : String(value);
	},
	humanOnly: ['plan_status', 'plan_status_at', 'ai_allowed', 'llm_profile', 'carry_over_internal'],
	engagementOf: (_app, row) =>
		row.id ? { id: String(row.id), aiAllowed: Number(row.ai_allowed ?? 1) === 1 } : null,
	parse(input, existing) {
		const out: Row = {};
		const fields: Record<string, string> = {};
		const set = (col: string, fn: () => unknown) => {
			try {
				out[col] = fn() as Row[string];
			} catch (e) {
				if (e instanceof ValidationError)
					Object.assign(fields, Object.keys(e.fields).length ? e.fields : { [col]: e.message });
				else throw e;
			}
		};
		if ('name' in input || !existing)
			set('name', () => {
				const n = str(input.name);
				if (!n) throw new ValidationError('Name the engagement.', { name: 'Required' });
				return n;
			});
		if (!existing) out.auditee_id = str(input.auditee_id);
		if ('start_date' in input || !existing)
			set('start_date', () => date(input.start_date, 'start_date', true));
		if ('end_date' in input) set('end_date', () => date(input.end_date, 'end_date', false));
		if ('description' in input) out.description = optional(input.description);
		if ('status' in input || !existing) out.status = input.status === 'closed' ? 'closed' : 'active';
		if ('scope_mode' in input || !existing)
			out.scope_mode = input.scope_mode === 'multiple' ? 'multiple' : 'single';
		if ('finding_scale_id' in input) out.finding_scale_id = optional(input.finding_scale_id);
		if ('working_language' in input || !existing)
			set('working_language', () => normalizeLanguage(input.working_language ?? 'en'));
		if ('report_language' in input || !existing)
			set('report_language', () => normalizeLanguage(input.report_language ?? 'en'));
		for (const col of ['carry_over_internal', 'ai_allowed'] as const) {
			if (col in input)
				out[col] =
					input[col] === true || input[col] === 1 || input[col] === 'true' || input[col] === 'on' ? 1 : 0;
		}
		if (!existing && !('ai_allowed' in input)) out.ai_allowed = 1;
		if (!existing && !('carry_over_internal' in input)) out.carry_over_internal = 0;
		if ('llm_profile' in input) out.llm_profile = optional(input.llm_profile);
		if ('plan_status' in input || !existing) {
			const ps = str(input.plan_status || 'draft');
			if (!['draft', 'sent', 'agreed'].includes(ps)) fields.plan_status = 'Draft, sent or agreed';
			out.plan_status = ps;
		}
		if ('plan_status_at' in input)
			out.plan_status_at = input.plan_status_at == null ? null : Number(input.plan_status_at);
		if (Object.keys(fields).length) throw new ValidationError('Check the highlighted fields.', fields);
		return out;
	},
	afterWrite(_app, _actor, row) {
		if (row.end_date && String(row.end_date) < String(row.start_date)) {
			throw new ValidationError('The end date is before the start date.', {
				end_date: 'Before the start date'
			});
		}
	},
	search: (row) => ({ name: row.name as string, description: row.description as string | null }),
	label: (row) => String(row.name),
	refLine: (row) => `Engagement · from ${row.start_date}`
});

export const memberDefinition: EntityDefinition = registerEntity({
	type: 'engagement_member',
	table: 'engagement_member',
	columns: ['engagement_id', 'user_id', 'role'],
	fieldLabels: { role: 'Role', user_id: 'User' },
	engagementOf: byEngagement,
	parse(input, existing) {
		const out: Row = {};
		if (!existing) {
			out.engagement_id = str(input.engagement_id);
			out.user_id = str(input.user_id);
		}
		if ('role' in input || !existing) {
			if (!(ENGAGEMENT_ROLES as readonly unknown[]).includes(input.role))
				throw new ValidationError('Role is lead auditor, auditor or reviewer.');
			out.role = String(input.role);
		}
		return out;
	},
	label: (row) => String(row.role)
});

export const scopeDefinition: EntityDefinition = registerEntity({
	type: 'scope',
	table: 'scope',
	columns: ['engagement_id', 'name', 'description', 'position'],
	fieldLabels: { name: 'Name', description: 'Description', position: 'Position' },
	detailColumns: ['name', 'description'],
	engagementOf: byEngagement,
	parse(input, existing) {
		const out: Row = {};
		if (!existing) out.engagement_id = str(input.engagement_id);
		if ('name' in input || !existing) {
			const name = str(input.name);
			if (!name) throw new ValidationError('Name the scope.', { name: 'Required' });
			if (name.length > 120) throw new ValidationError('At most 120 characters.', { name: 'Too long' });
			out.name = name;
		}
		if ('description' in input) out.description = optional(input.description);
		if ('position' in input) out.position = Number(input.position) || 0;
		return out;
	},
	afterWrite(app, _actor, row) {
		if (Number(row.deleted) === 1) {
			const left = app.sqlite
				.prepare('SELECT count(*) AS n FROM scope WHERE engagement_id = ? AND deleted = 0')
				.get(row.engagement_id) as { n: number };
			if (left.n === 0) throw new ValidationError('An engagement always has at least one scope.');
			return;
		}
		const clash = app.sqlite
			.prepare(
				'SELECT id FROM scope WHERE engagement_id = ? AND deleted = 0 AND lower(name) = lower(?) AND id <> ?'
			)
			.get(row.engagement_id, row.name, row.id);
		if (clash)
			throw new ValidationError('There is already a scope with this name.', { name: 'Already used' });
	},
	search: (row) => ({ name: row.name as string }),
	label: (row) => String(row.name),
	refLine: () => 'Scope'
});

export const findingScaleDefinition: EntityDefinition = registerEntity({
	type: 'finding_scale',
	table: 'finding_scale',
	columns: ['engagement_id', 'name'],
	engagementOf: byEngagement,
	parse(input, existing) {
		const out: Row = {};
		if (!existing) out.engagement_id = optional(input.engagement_id);
		if ('name' in input || !existing) out.name = str(input.name) || 'Finding scale';
		return out;
	},
	label: (row) => String(row.name)
});

export const TONES = ['neutral', 'ok', 'info', 'warn', 'danger'] as const;

export const findingValueDefinition: EntityDefinition = registerEntity({
	type: 'finding_value',
	table: 'finding_value',
	columns: ['finding_scale_id', 'code', 'label', 'position', 'tone', 'is_nonconformity'],
	fieldLabels: {
		label: 'Label',
		tone: 'Tone',
		is_nonconformity: 'Non-conformity',
		position: 'Position',
		code: 'Code'
	},
	parse(input, existing) {
		const out: Row = {};
		if (!existing) out.finding_scale_id = str(input.finding_scale_id);
		if ('code' in input || !existing) out.code = str(input.code) || randomUUID().slice(0, 8);
		if ('label' in input || !existing) {
			const label = str(input.label);
			if (!label) throw new ValidationError('Give the value a label.', { label: 'Required' });
			out.label = label;
		}
		if ('position' in input || !existing) out.position = Number(input.position) || 0;
		if ('tone' in input || !existing) {
			const tone = str(input.tone || 'neutral');
			if (!(TONES as readonly string[]).includes(tone))
				throw new ValidationError('Tone is neutral, ok, info, warn or danger.');
			out.tone = tone;
		}
		if ('is_nonconformity' in input || !existing) out.is_nonconformity = input.is_nonconformity ? 1 : 0;
		return out;
	},
	label: (row) => String(row.label)
});

/** The default scale (docs/data-model.md). Missing evidence gives the first value, never a non-conformity. */
export const DEFAULT_FINDING_SCALE = [
	{ code: 'na', label: 'No reasonable assurance', tone: 'neutral', is_nonconformity: false },
	{ code: 'c', label: 'Conformity', tone: 'ok', is_nonconformity: false },
	{ code: 'cp', label: 'Conformity with positive note', tone: 'ok', is_nonconformity: false },
	{ code: 'cn', label: 'Conformity with auditor note', tone: 'info', is_nonconformity: false },
	{ code: 'minor', label: 'Minor non-conformity', tone: 'warn', is_nonconformity: true },
	{ code: 'major', label: 'Major non-conformity', tone: 'danger', is_nonconformity: true }
] as const;

// ---- Read models

export interface Auditee {
	id: string;
	name: string;
	description: string | null;
	version: number;
}

export interface Engagement {
	id: string;
	name: string;
	auditeeId: string;
	auditeeName: string;
	startDate: string;
	endDate: string | null;
	description: string | null;
	status: string;
	scopeMode: 'single' | 'multiple';
	findingScaleId: string | null;
	workingLanguage: string;
	reportLanguage: string;
	carryOverInternal: boolean;
	aiAllowed: boolean;
	llmProfile: string | null;
	planStatus: 'draft' | 'sent' | 'agreed';
	planStatusAt: Date | null;
	version: number;
}

function toEngagement(r: Row): Engagement {
	return {
		id: String(r.id),
		name: String(r.name),
		auditeeId: String(r.auditee_id),
		auditeeName: String(r.auditee_name ?? ''),
		startDate: String(r.start_date),
		endDate: (r.end_date as string | null) ?? null,
		description: (r.description as string | null) ?? null,
		status: String(r.status),
		scopeMode: r.scope_mode === 'multiple' ? 'multiple' : 'single',
		findingScaleId: (r.finding_scale_id as string | null) ?? null,
		workingLanguage: String(r.working_language),
		reportLanguage: String(r.report_language),
		carryOverInternal: Number(r.carry_over_internal) === 1,
		aiAllowed: Number(r.ai_allowed) === 1,
		llmProfile: (r.llm_profile as string | null) ?? null,
		planStatus: r.plan_status as Engagement['planStatus'],
		planStatusAt: r.plan_status_at ? new Date(Number(r.plan_status_at)) : null,
		version: Number(r.current_version)
	};
}

const ENG_SELECT =
	'SELECT e.*, a.name AS auditee_name FROM engagement e JOIN auditee a ON a.id = e.auditee_id';

export function listEngagements(app: AppDatabase): Engagement[] {
	return (
		app.sqlite
			.prepare(`${ENG_SELECT} WHERE e.deleted = 0 ORDER BY e.start_date DESC, e.created_at DESC`)
			.all() as Row[]
	).map(toEngagement);
}

export function getEngagement(app: AppDatabase, id: string): Engagement {
	const row = app.sqlite.prepare(`${ENG_SELECT} WHERE e.id = ? AND e.deleted = 0`).get(id) as Row | undefined;
	if (!row) throw new NotFoundError('Engagement not found');
	return toEngagement(row);
}

export function listAuditees(app: AppDatabase): Auditee[] {
	return (
		app.sqlite.prepare('SELECT * FROM auditee WHERE deleted = 0 ORDER BY name COLLATE NOCASE').all() as Row[]
	).map((r) => ({
		id: String(r.id),
		name: String(r.name),
		description: (r.description as string | null) ?? null,
		version: Number(r.current_version)
	}));
}

export function getAuditee(app: AppDatabase, id: string): Auditee {
	const r = readRow(app, auditeeDefinition, id);
	if (!r || Number(r.deleted) === 1) throw new NotFoundError('Auditee not found');
	return {
		id: String(r.id),
		name: String(r.name),
		description: (r.description as string | null) ?? null,
		version: Number(r.current_version)
	};
}

export interface Scope {
	id: string;
	name: string;
	description: string | null;
	position: number;
	version: number;
}

export function listScopes(app: AppDatabase, engagementId: string): Scope[] {
	return (
		app.sqlite
			.prepare('SELECT * FROM scope WHERE engagement_id = ? AND deleted = 0 ORDER BY position, created_at')
			.all(engagementId) as Row[]
	).map((r) => ({
		id: String(r.id),
		name: String(r.name),
		description: (r.description as string | null) ?? null,
		position: Number(r.position),
		version: Number(r.current_version)
	}));
}

export interface FindingValue {
	id: string;
	code: string;
	label: string;
	position: number;
	tone: (typeof TONES)[number];
	isNonconformity: boolean;
}

export function findingScaleOf(app: AppDatabase, engagementId: string): FindingValue[] {
	const e = getEngagement(app, engagementId);
	if (!e.findingScaleId) return [];
	return (
		app.sqlite
			.prepare('SELECT * FROM finding_value WHERE finding_scale_id = ? AND deleted = 0 ORDER BY position')
			.all(e.findingScaleId) as Row[]
	).map((r) => ({
		id: String(r.id),
		code: String(r.code),
		label: String(r.label),
		position: Number(r.position),
		tone: r.tone as FindingValue['tone'],
		isNonconformity: Number(r.is_nonconformity) === 1
	}));
}

export interface Member {
	id: string;
	userId: string;
	name: string;
	role: EngagementRole;
}

export function listMembers(app: AppDatabase, engagementId: string): Member[] {
	return (
		app.sqlite
			.prepare(
				`SELECT m.id, m.user_id, m.role, u.name FROM engagement_member m JOIN "user" u ON u.id = m.user_id
				  WHERE m.engagement_id = ? AND m.deleted = 0 ORDER BY u.name COLLATE NOCASE`
			)
			.all(engagementId) as Row[]
	).map((r) => ({
		id: String(r.id),
		userId: String(r.user_id),
		name: String(r.name),
		role: r.role as EngagementRole
	}));
}

// ---- Commands

export interface CreateEngagementInput {
	name: string;
	auditeeId?: string | null;
	auditeeName?: string | null;
	auditeeDescription?: string | null;
	startDate: string;
	endDate?: string | null;
	workingLanguage?: string;
	reportLanguage?: string;
	description?: string | null;
}

/**
 * Create an engagement with everything it starts with: the auditee (new or existing), one default
 * scope named after the auditee, its own copy of the default six-value finding scale, and the creator
 * as lead auditor. One transaction.
 */
export function createEngagement(app: AppDatabase, actor: Actor, input: CreateEngagementInput): Engagement {
	return app.sqlite.transaction(() => {
		let auditeeId = str(input.auditeeId);
		if (auditeeId) getAuditee(app, auditeeId);
		else {
			const name = str(input.auditeeName);
			if (!name) throw new ValidationError('Name the auditee.', { auditee: 'Required' });
			const same = app.sqlite
				.prepare('SELECT id FROM auditee WHERE deleted = 0 AND lower(name) = lower(?)')
				.get(name) as { id: string } | undefined;
			auditeeId =
				same?.id ??
				String(
					createEntity(app, actor, auditeeDefinition, { name, description: input.auditeeDescription ?? null })
						.row.id
				);
		}
		const scaleId = randomUUID();
		const eng = createEntity(app, actor, engagementDefinition, {
			name: input.name,
			auditee_id: auditeeId,
			start_date: input.startDate,
			end_date: input.endDate ?? null,
			description: input.description ?? null,
			working_language: input.workingLanguage ?? 'en',
			report_language: input.reportLanguage ?? 'en',
			finding_scale_id: scaleId
		}).row;
		const engagementId = String(eng.id);
		createEntity(
			app,
			actor,
			findingScaleDefinition,
			{ engagement_id: engagementId, name: 'Default finding scale' },
			{ id: scaleId }
		);
		DEFAULT_FINDING_SCALE.forEach((v, position) =>
			createEntity(app, actor, findingValueDefinition, { finding_scale_id: scaleId, position, ...v })
		);
		createEntity(app, actor, scopeDefinition, {
			engagement_id: engagementId,
			name: getAuditee(app, auditeeId).name,
			position: 0
		});
		createEntity(app, actor, memberDefinition, {
			engagement_id: engagementId,
			user_id: actor.userId,
			role: 'lead_auditor'
		});
		return getEngagement(app, engagementId);
	})();
}

export function updateEngagement(
	app: AppDatabase,
	actor: Actor,
	id: string,
	baseVersion: number,
	data: Record<string, unknown>
): Engagement {
	// AI may not set it at all (humanOnly); for a person, it must be a model that passed the check.
	if ('llm_profile' in data && isHuman(actor)) {
		const profile = typeof data.llm_profile === 'string' ? data.llm_profile.trim() : '';
		if (profile && profile !== getEngagement(app, id).llmProfile) assertProfileUsable(app, profile);
	}
	updateEntity(app, actor, engagementDefinition, id, baseVersion, data);
	return getEngagement(app, id);
}

export function updateAuditee(
	app: AppDatabase,
	actor: Actor,
	id: string,
	baseVersion: number,
	data: { name?: string; description?: string | null }
): Auditee {
	updateEntity(app, actor, auditeeDefinition, id, baseVersion, data);
	return getAuditee(app, id);
}

export type { WriteOp };
