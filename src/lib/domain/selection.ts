import type { AppDatabase } from '#lib/db/client.ts';
import {
	engagementDefinition,
	engagementGuard,
	getEngagement,
	listScopes,
	scopeDefinition
} from './engagements';
import { NotFoundError, ValidationError } from './errors';
import { getRequirement, type Requirement } from './library';
import { registerEntity } from './registry';
import {
	createEntity,
	deleteEntity,
	readRow,
	updateEntity,
	write,
	type Actor,
	type EntityDefinition,
	type Row
} from './write';

/**
 * What the audit is run against. Selecting a requirement pins the library version at that moment;
 * later library edits do not change the engagement until someone upgrades the pin on purpose.
 * Assessment units (requirement x scope) are generated from the selection, the scopes and the
 * handling, and regenerated whenever one of those changes, reusing existing units so findings stay.
 */

export const CRITICALITY = ['high', 'medium', 'low'] as const;
export type Criticality = (typeof CRITICALITY)[number];

const byEngagement = (app: AppDatabase, row: Row) => engagementGuard(app, row.engagement_id);

export const engagementRequirementDefinition: EntityDefinition = registerEntity({
	type: 'engagement_requirement',
	table: 'engagement_requirement',
	columns: ['engagement_id', 'requirement_id', 'pinned_version', 'scope_handling', 'criticality'],
	fieldLabels: {
		pinned_version: 'Pinned version',
		scope_handling: 'Scope handling',
		criticality: 'Criticality'
	},
	formatValue(column, value) {
		if (column === 'scope_handling') return value === 'per_scope' ? 'Per scope' : 'One finding';
		if (column === 'criticality')
			return value ? String(value).charAt(0).toUpperCase() + String(value).slice(1) : 'From risks';
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	engagementOf: byEngagement,
	parse(input, existing) {
		const out: Row = {};
		if (!existing) {
			out.engagement_id = String(input.engagement_id ?? '');
			out.requirement_id = String(input.requirement_id ?? '');
		}
		if ('pinned_version' in input || !existing) out.pinned_version = Number(input.pinned_version);
		if ('scope_handling' in input || !existing) {
			const h = String(input.scope_handling ?? 'common');
			if (h !== 'common' && h !== 'per_scope')
				throw new ValidationError('Scope handling is common or per scope.');
			out.scope_handling = h;
		}
		if ('criticality' in input) {
			const c = input.criticality == null || input.criticality === '' ? null : String(input.criticality);
			if (c !== null && !(CRITICALITY as readonly string[]).includes(c))
				throw new ValidationError('Criticality is high, medium or low.');
			out.criticality = c;
		}
		return out;
	},
	label: (row) => `Selection of ${row.requirement_id}`
});

export const assessmentUnitDefinition: EntityDefinition = registerEntity({
	type: 'assessment_unit',
	table: 'assessment_unit',
	columns: ['engagement_id', 'engagement_requirement_id', 'scope_id'],
	engagementOf: byEngagement,
	parse(input, existing): Row {
		if (existing) return {};
		return {
			engagement_id: String(input.engagement_id ?? ''),
			engagement_requirement_id: String(input.engagement_requirement_id ?? ''),
			scope_id: input.scope_id == null ? null : String(input.scope_id)
		};
	},
	label: () => 'Assessment unit'
});

// ---- Reading

export interface SelectedRequirement {
	id: string;
	requirementId: string;
	refCode: string;
	title: string;
	sourceId: string;
	sourceCode: string;
	sourceTitle: string;
	/** The pinned text, as it was when selected. */
	pinned: { version: number; title: string; text: string | null };
	/** The library's current version, when it is newer than the pin. */
	newerVersion: number | null;
	scopeHandling: 'common' | 'per_scope';
	criticality: Criticality | null;
	version: number;
}

function pinnedSnapshot(app: AppDatabase, requirementId: string, version: number): Row | null {
	const rev = app.sqlite
		.prepare(
			"SELECT snapshot FROM revision WHERE entity_type = 'requirement' AND entity_id = ? AND version = ?"
		)
		.get(requirementId, version) as { snapshot: string } | undefined;
	return rev ? (JSON.parse(rev.snapshot) as Row) : null;
}

export function listSelected(app: AppDatabase, engagementId: string): SelectedRequirement[] {
	const rows = app.sqlite
		.prepare(
			`SELECT er.*, r.ref_code, r.title AS req_title, r.current_version AS req_version, r.source_id,
			        s.code AS source_code, s.title AS source_title
			   FROM engagement_requirement er JOIN requirement r ON r.id = er.requirement_id JOIN source s ON s.id = r.source_id
			  WHERE er.engagement_id = ? AND er.deleted = 0`
		)
		.all(engagementId) as Row[];
	const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
	return rows
		.map((r) => {
			const pinnedVersion = Number(r.pinned_version);
			const snap = pinnedSnapshot(app, String(r.requirement_id), pinnedVersion);
			return {
				id: String(r.id),
				requirementId: String(r.requirement_id),
				refCode: String(snap?.ref_code ?? r.ref_code),
				title: String(snap?.title ?? r.req_title),
				sourceId: String(r.source_id),
				sourceCode: String(r.source_code),
				sourceTitle: String(r.source_title),
				pinned: {
					version: pinnedVersion,
					title: String(snap?.title ?? r.req_title),
					text: (snap?.text as string | null) ?? null
				},
				newerVersion: Number(r.req_version) > pinnedVersion ? Number(r.req_version) : null,
				scopeHandling: r.scope_handling as SelectedRequirement['scopeHandling'],
				criticality: (r.criticality as Criticality | null) ?? null,
				version: Number(r.current_version)
			};
		})
		.sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle) || collator.compare(a.refCode, b.refCode));
}

export interface AssessmentUnit {
	id: string;
	engagementRequirementId: string;
	requirementId: string;
	refCode: string;
	title: string;
	scopeId: string | null;
	scopeName: string;
}

export function listAssessmentUnits(app: AppDatabase, engagementId: string): AssessmentUnit[] {
	const selected = new Map(listSelected(app, engagementId).map((s) => [s.id, s]));
	const scopes = new Map(listScopes(app, engagementId).map((s) => [s.id, s.name]));
	const all = getEngagement(app, engagementId);
	const rows = app.sqlite
		.prepare('SELECT * FROM assessment_unit WHERE engagement_id = ? AND deleted = 0')
		.all(engagementId) as Row[];
	return rows
		.filter((u) => selected.has(String(u.engagement_requirement_id)))
		.map((u) => {
			const s = selected.get(String(u.engagement_requirement_id))!;
			const scopeId = (u.scope_id as string | null) ?? null;
			return {
				id: String(u.id),
				engagementRequirementId: s.id,
				requirementId: s.requirementId,
				refCode: s.refCode,
				title: s.title,
				scopeId,
				scopeName: scopeId
					? (scopes.get(scopeId) ?? '')
					: all.scopeMode === 'single'
						? (scopes.values().next().value ?? 'All')
						: 'All scopes'
			};
		});
}

// ---- Assessment units

/**
 * Bring the units in line with selection, scopes and handling: one unit per requirement, or one per
 * scope where the requirement is handled per scope in a multi-scope engagement. Existing units are kept
 * (and restored if they were removed earlier), so anything attached to them survives.
 */
export function regenerateUnits(
	app: AppDatabase,
	actor: Actor,
	engagementId: string
): { created: number; removed: number; restored: number } {
	const e = getEngagement(app, engagementId);
	const scopes = listScopes(app, engagementId);
	const wanted = new Set<string>();
	for (const s of listSelected(app, engagementId)) {
		if (e.scopeMode === 'multiple' && s.scopeHandling === 'per_scope' && scopes.length)
			scopes.forEach((sc) => wanted.add(`${s.id}|${sc.id}`));
		else wanted.add(`${s.id}|`);
	}
	const existing = app.sqlite
		.prepare('SELECT * FROM assessment_unit WHERE engagement_id = ?')
		.all(engagementId) as Row[];
	const byKey = new Map(existing.map((u) => [`${u.engagement_requirement_id}|${u.scope_id ?? ''}`, u]));
	const result = { created: 0, removed: 0, restored: 0 };
	for (const key of wanted) {
		const u = byKey.get(key);
		if (!u) {
			const [erId, scopeId] = key.split('|');
			createEntity(app, actor, assessmentUnitDefinition, {
				engagement_id: engagementId,
				engagement_requirement_id: erId,
				scope_id: scopeId || null
			});
			result.created++;
		} else if (Number(u.deleted) === 1) {
			write(app, actor, assessmentUnitDefinition, {
				op: 'update',
				id: String(u.id),
				baseVersion: Number(u.current_version),
				data: { deleted: false }
			});
			result.restored++;
		}
	}
	for (const [key, u] of byKey) {
		if (!wanted.has(key) && Number(u.deleted) === 0) {
			deleteEntity(
				app,
				actor,
				assessmentUnitDefinition,
				String(u.id),
				Number(u.current_version),
				'No longer selected or scoped'
			);
			result.removed++;
		}
	}
	return result;
}

// ---- Selection commands

/** Select requirements for an engagement, pinning each at its current library version. */
export function selectRequirements(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	requirementIds: string[],
	options: { scopeHandling?: 'common' | 'per_scope' } = {}
): { selected: number; already: number } {
	return app.sqlite.transaction(() => {
		const e = getEngagement(app, engagementId);
		let selected = 0;
		let already = 0;
		for (const rid of new Set(requirementIds)) {
			const req = getRequirement(app, rid);
			assertSelectable(app, e.auditeeId, req);
			const row = app.sqlite
				.prepare('SELECT * FROM engagement_requirement WHERE engagement_id = ? AND requirement_id = ?')
				.get(engagementId, rid) as Row | undefined;
			if (row && Number(row.deleted) === 0) {
				already++;
				continue;
			}
			const data = { pinned_version: req.version, scope_handling: options.scopeHandling ?? 'common' };
			if (row)
				write(app, actor, engagementRequirementDefinition, {
					op: 'update',
					id: String(row.id),
					baseVersion: Number(row.current_version),
					data: { ...data, deleted: false }
				});
			else
				createEntity(app, actor, engagementRequirementDefinition, {
					engagement_id: engagementId,
					requirement_id: rid,
					...data
				});
			selected++;
		}
		regenerateUnits(app, actor, engagementId);
		return { selected, already };
	})();
}

/** Only external requirements, or internal ones of this engagement's own auditee, can be selected. */
function assertSelectable(app: AppDatabase, auditeeId: string, req: Requirement) {
	const src = app.sqlite.prepare('SELECT auditee_id FROM source WHERE id = ?').get(req.sourceId) as {
		auditee_id: string | null;
	};
	if (src.auditee_id && src.auditee_id !== auditeeId) throw new NotFoundError('Requirement not found');
	if (req.origin === 'internal')
		throw new ValidationError(
			'Internal requirements are criteria for external ones; they are not selected on their own.'
		);
}

export function deselectRequirements(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	requirementIds: string[]
): { removed: number } {
	return app.sqlite.transaction(() => {
		getEngagement(app, engagementId);
		let removed = 0;
		for (const rid of new Set(requirementIds)) {
			const row = app.sqlite
				.prepare(
					'SELECT * FROM engagement_requirement WHERE engagement_id = ? AND requirement_id = ? AND deleted = 0'
				)
				.get(engagementId, rid) as Row | undefined;
			if (!row) continue;
			deleteEntity(
				app,
				actor,
				engagementRequirementDefinition,
				String(row.id),
				Number(row.current_version),
				'Deselected'
			);
			removed++;
		}
		regenerateUnits(app, actor, engagementId);
		return { removed };
	})();
}

function selectedRow(app: AppDatabase, engagementId: string, requirementId: string): Row {
	const row = app.sqlite
		.prepare(
			'SELECT * FROM engagement_requirement WHERE engagement_id = ? AND requirement_id = ? AND deleted = 0'
		)
		.get(engagementId, requirementId) as Row | undefined;
	if (!row) throw new NotFoundError('That requirement is not selected in this engagement.');
	return row;
}

export function setScopeHandling(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	items: { requirementId: string; scopeHandling: 'common' | 'per_scope' }[]
): { changed: number } {
	return app.sqlite.transaction(() => {
		let changed = 0;
		for (const i of items) {
			const row = selectedRow(app, engagementId, i.requirementId);
			if (
				updateEntity(
					app,
					actor,
					engagementRequirementDefinition,
					String(row.id),
					Number(row.current_version),
					{ scope_handling: i.scopeHandling }
				).changed
			)
				changed++;
		}
		regenerateUnits(app, actor, engagementId);
		return { changed };
	})();
}

export function setCriticality(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	requirementId: string,
	criticality: Criticality | null
) {
	const row = selectedRow(app, engagementId, requirementId);
	return updateEntity(
		app,
		actor,
		engagementRequirementDefinition,
		String(row.id),
		Number(row.current_version),
		{ criticality }
	);
}

/** Move the pin to the library's current version: the explicit upgrade. */
export function upgradePin(app: AppDatabase, actor: Actor, engagementId: string, requirementId: string) {
	const row = selectedRow(app, engagementId, requirementId);
	const req = getRequirement(app, requirementId);
	return updateEntity(
		app,
		actor,
		engagementRequirementDefinition,
		String(row.id),
		Number(row.current_version),
		{ pinned_version: req.version },
		`Upgraded to library version ${req.version}`
	);
}

// ---- Scopes

export function setScopeMode(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	baseVersion: number,
	mode: 'single' | 'multiple'
) {
	return app.sqlite.transaction(() => {
		const e = getEngagement(app, engagementId);
		updateEntity(app, actor, engagementDefinition, engagementId, baseVersion, { scope_mode: mode });
		regenerateUnits(app, actor, e.id);
		return getEngagement(app, engagementId);
	})();
}

export function addScope(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	input: { name: string; description?: string | null }
) {
	return app.sqlite.transaction(() => {
		getEngagement(app, engagementId);
		const position = listScopes(app, engagementId).length;
		const row = createEntity(app, actor, scopeDefinition, {
			engagement_id: engagementId,
			name: input.name,
			description: input.description ?? null,
			position
		}).row;
		regenerateUnits(app, actor, engagementId);
		return row;
	})();
}

export function updateScope(
	app: AppDatabase,
	actor: Actor,
	scopeId: string,
	baseVersion: number,
	input: { name?: string; description?: string | null }
) {
	return updateEntity(app, actor, scopeDefinition, scopeId, baseVersion, input);
}

/** How many assessment units would be lost by removing a scope, so the screen can ask first. */
export function unitsInScope(app: AppDatabase, scopeId: string): number {
	return (
		app.sqlite
			.prepare('SELECT count(*) AS n FROM assessment_unit WHERE scope_id = ? AND deleted = 0')
			.get(scopeId) as { n: number }
	).n;
}

export function removeScope(app: AppDatabase, actor: Actor, scopeId: string, baseVersion: number) {
	return app.sqlite.transaction(() => {
		const row = readRow(app, scopeDefinition, scopeId);
		if (!row) throw new NotFoundError('Scope not found');
		deleteEntity(app, actor, scopeDefinition, scopeId, baseVersion, 'Scope removed');
		regenerateUnits(app, actor, String(row.engagement_id));
	})();
}

/** Assessment units the engagement would have, for the Scopes tab before anything changes. */
export function countUnits(app: AppDatabase, engagementId: string): number {
	return listAssessmentUnits(app, engagementId).length;
}
