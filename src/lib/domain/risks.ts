import type { AppDatabase } from '#lib/db/client.ts';
import { engagementGuard, getEngagement, listScopes } from './engagements';
import { NotFoundError, ValidationError } from './errors';
import { registerEntity } from './registry';
import { listSelected, type Criticality } from './selection';
import {
	createEntity,
	deleteEntity,
	readRow,
	updateEntity,
	type Actor,
	type EntityDefinition,
	type Row
} from './write';

/** The risk list that drives criticality: a requirement is as critical as the highest risk linked to it. */

const str = (v: unknown) => (v == null ? '' : String(v)).trim();
export const RISK_LEVELS = ['high', 'medium', 'low'] as const;
export const RISK_ORIGINS = ['auditee_register', 'auditor'] as const;

/** A JSON array of ids as stored, or a list given by a caller, without duplicates. */
export function idList(v: unknown): string[] {
	if (typeof v === 'string') {
		try {
			const p = JSON.parse(v);
			if (Array.isArray(p)) return [...new Set(p.map(String))];
		} catch {
			return v ? [v] : [];
		}
	}
	return Array.isArray(v) ? [...new Set(v.map(String).filter(Boolean))] : [];
}

export const riskDefinition: EntityDefinition = registerEntity({
	type: 'risk',
	table: 'risk',
	columns: ['engagement_id', 'title', 'description', 'origin', 'level', 'requirement_ids', 'scope_ids'],
	detailColumns: ['title', 'level', 'origin', 'description'],
	fieldLabels: {
		title: 'Risk',
		description: 'Description',
		origin: 'Origin',
		level: 'Level',
		requirement_ids: 'Requirements',
		scope_ids: 'Scopes'
	},
	formatValue(column, value) {
		if (column === 'origin') return value === 'auditee_register' ? 'Auditee register' : 'Auditor view';
		if (column === 'level') return String(value ?? '').replace(/^./, (c) => c.toUpperCase());
		if (column === 'requirement_ids' || column === 'scope_ids') return `${idList(value).length}`;
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	engagementOf: (app, row) => engagementGuard(app, row.engagement_id),
	parse(input, existing) {
		const out: Row = {};
		if (!existing) out.engagement_id = str(input.engagement_id);
		if ('title' in input || !existing) {
			const t = str(input.title);
			if (!t) throw new ValidationError('Describe the risk.', { title: 'Required' });
			out.title = t;
		}
		if ('description' in input) out.description = str(input.description) || null;
		if ('origin' in input || !existing) {
			const o = str(input.origin || 'auditor');
			if (!(RISK_ORIGINS as readonly string[]).includes(o))
				throw new ValidationError('Origin is the auditee register or the auditor view.');
			out.origin = o;
		}
		if ('level' in input || !existing) {
			const l = str(input.level || 'medium').toLowerCase();
			if (!(RISK_LEVELS as readonly string[]).includes(l))
				throw new ValidationError('Level is high, medium or low.', { level: 'Invalid' });
			out.level = l;
		}
		if ('requirement_ids' in input || !existing)
			out.requirement_ids = JSON.stringify(idList(input.requirement_ids));
		if ('scope_ids' in input || !existing) out.scope_ids = JSON.stringify(idList(input.scope_ids));
		return out;
	},
	afterWrite(app, _actor, row) {
		if (Number(row.deleted) === 1) return;
		const engagementId = String(row.engagement_id);
		const selected = new Set(listSelected(app, engagementId).map((s) => s.requirementId));
		const notSelected = idList(row.requirement_ids).filter((id) => !selected.has(id));
		if (notSelected.length)
			throw new ValidationError('A risk can only point at requirements selected in this engagement.', {
				requirement_ids: 'Not selected'
			});
		const scopes = new Set(listScopes(app, engagementId).map((s) => s.id));
		if (idList(row.scope_ids).some((id) => !scopes.has(id)))
			throw new ValidationError('Unknown scope.', { scope_ids: 'Unknown' });
	},
	search: (row) => ({ title: row.title as string, description: row.description as string | null }),
	label: (row) => String(row.title),
	refLine: (row) => `Risk · ${String(row.level ?? '').replace(/^./, (c) => c.toUpperCase())}`
});

export interface Risk {
	id: string;
	title: string;
	description: string | null;
	origin: (typeof RISK_ORIGINS)[number];
	level: (typeof RISK_LEVELS)[number];
	requirementIds: string[];
	scopeIds: string[];
	version: number;
}

function toRisk(r: Row): Risk {
	return {
		id: String(r.id),
		title: String(r.title),
		description: (r.description as string | null) ?? null,
		origin: r.origin as Risk['origin'],
		level: r.level as Risk['level'],
		requirementIds: idList(r.requirement_ids),
		scopeIds: idList(r.scope_ids),
		version: Number(r.current_version)
	};
}

const ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function listRisks(app: AppDatabase, engagementId: string): Risk[] {
	return (
		app.sqlite
			.prepare('SELECT * FROM risk WHERE engagement_id = ? AND deleted = 0 ORDER BY created_at')
			.all(engagementId) as Row[]
	)
		.map(toRisk)
		.sort((a, b) => ORDER[a.level]! - ORDER[b.level]!);
}

export interface RiskInput {
	title: string;
	description?: string | null;
	origin?: string;
	level?: string;
	requirement_ids?: string[];
	scope_ids?: string[];
}

export function addRisk(app: AppDatabase, actor: Actor, engagementId: string, input: RiskInput): Risk {
	getEngagement(app, engagementId);
	return toRisk(createEntity(app, actor, riskDefinition, { ...input, engagement_id: engagementId }).row);
}

export function updateRisk(
	app: AppDatabase,
	actor: Actor,
	id: string,
	baseVersion: number,
	input: Partial<RiskInput>
): Risk {
	return toRisk(updateEntity(app, actor, riskDefinition, id, baseVersion, input).row);
}

export function removeRisk(app: AppDatabase, actor: Actor, id: string): void {
	const row = readRow(app, riskDefinition, id);
	if (!row || Number(row.deleted) === 1) throw new NotFoundError('Risk not found');
	deleteEntity(app, actor, riskDefinition, id, Number(row.current_version), 'Risk removed');
}

/**
 * Criticality of a selected requirement: the auditor's override if set, otherwise the highest level of
 * any risk linked to it, otherwise medium.
 */
export function criticalityOf(
	app: AppDatabase,
	engagementId: string
): Map<string, { level: Criticality; from: 'override' | 'risk' | 'default'; risks: string[] }> {
	const risks = listRisks(app, engagementId);
	const out = new Map<
		string,
		{ level: Criticality; from: 'override' | 'risk' | 'default'; risks: string[] }
	>();
	for (const s of listSelected(app, engagementId)) {
		const linked = risks.filter((r) => r.requirementIds.includes(s.requirementId));
		const top = linked.map((r) => r.level).sort((a, b) => ORDER[a]! - ORDER[b]!)[0];
		if (s.criticality)
			out.set(s.requirementId, { level: s.criticality, from: 'override', risks: linked.map((r) => r.title) });
		else if (top) out.set(s.requirementId, { level: top, from: 'risk', risks: linked.map((r) => r.title) });
		else out.set(s.requirementId, { level: 'medium', from: 'default', risks: [] });
	}
	return out;
}
