import type { AppDatabase } from '#lib/db/client.ts';
import { getEngagementArtifact, listArtifacts } from './artifacts';
import { engagementGuard, getEngagement } from './engagements';
import { ValidationError } from './errors';
import { requireHuman } from './guards';
import { getRequirement } from './library';
import { registerEntity } from './registry';
import { engagementRequirementDefinition, listSelected } from './selection';
import { createEntity, updateEntity, type Actor, type EntityDefinition, type Row } from './write';

/**
 * The Statement of Applicability check (#81). For ISO/IEC 27001 and 27701 audits, the auditee's SoA
 * says which Annex controls apply and why. Its lines are recorded per requirement (by AI reading the
 * document, or by hand through MCP); the app then compares them with the audit scope and flags
 * conflicts. The auditor decides: keep the requirement in scope with a reason, or remove it.
 */

/** Sources whose audits use a Statement of Applicability: ISO/IEC 27001 and ISO/IEC 27701, for now. */
export function usesSoa(source: { code: string; title: string }): boolean {
	return /27001|27701/.test(`${source.code} ${source.title}`);
}

/** Annex controls (A.5.1, B.8.2.1): the requirements an SoA is expected to list. */
const ANNEX = /^[AB]\.\d/;

export const soaEntryDefinition: EntityDefinition = registerEntity({
	type: 'soa_entry',
	table: 'soa_entry',
	columns: [
		'engagement_id',
		'artifact_id',
		'requirement_id',
		'applicable',
		'justification',
		'implementation',
		'locator'
	],
	detailColumns: ['applicable', 'justification', 'implementation', 'locator'],
	fieldLabels: {
		applicable: 'Applicable',
		justification: 'Justification',
		implementation: 'Implementation',
		locator: 'Where in the SoA'
	},
	formatValue(column, value) {
		if (column === 'applicable') return Number(value) === 1 ? 'Yes' : 'No (excluded)';
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	engagementOf: (app, row) => engagementGuard(app, row.engagement_id),
	parse(input, existing) {
		const out: Row = {};
		if (!existing) {
			out.engagement_id = String(input.engagement_id);
			out.requirement_id = String(input.requirement_id);
		}
		if ('artifact_id' in input || !existing) out.artifact_id = String(input.artifact_id);
		if ('applicable' in input || !existing) {
			const a = input.applicable;
			if (typeof a !== 'boolean' && a !== 0 && a !== 1)
				throw new ValidationError('Applicable is yes or no.', { applicable: 'Required' });
			out.applicable = a === true || a === 1 ? 1 : 0;
		}
		for (const c of ['justification', 'implementation', 'locator'])
			if (c in input) out[c] = input[c] == null ? null : String(input[c]).trim().slice(0, 4000) || null;
		return out;
	},
	label: () => 'Statement of Applicability entry',
	refLine: () => 'SoA'
});

/** The SoA in use: the newest received document of that kind that no newer version replaces. */
export function currentSoa(app: AppDatabase, engagementId: string) {
	const docs = listArtifacts(app, engagementId).filter(
		(a) => a.kind === 'statement_of_applicability' && a.state === 'received' && !a.replacedBy
	);
	return docs.at(-1) ?? null;
}

export interface SoaInput {
	requirementId: string;
	applicable: boolean;
	justification?: string | null;
	implementation?: string | null;
	locator?: string | null;
}

/**
 * Record lines of the SoA document, one per control. A control recorded again (from the same or a
 * newer SoA) is updated, so its history shows what changed.
 */
export function recordSoa(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	artifactId: string,
	entries: SoaInput[]
): { recorded: number; updated: number } {
	const e = getEngagement(app, engagementId);
	const doc = getEngagementArtifact(app, e.id, artifactId);
	if (doc.kind !== 'statement_of_applicability')
		throw new ValidationError(
			`${doc.displayName} is not marked as a Statement of applicability. Set its kind on Set-up, Documents, or upload it on Set-up, Requirements.`
		);
	if (!entries.length) throw new ValidationError('No entries to record.');
	return app.sqlite.transaction(() => {
		let recorded = 0;
		let updated = 0;
		for (const x of entries) {
			const req = getRequirement(app, x.requirementId);
			if (!usesSoa({ code: req.sourceCode, title: req.sourceTitle }))
				throw new ValidationError(
					`${req.refCode} is not from ISO/IEC 27001 or 27701; a Statement of Applicability covers those controls.`
				);
			const data = {
				artifact_id: doc.id,
				applicable: x.applicable,
				justification: x.justification ?? null,
				implementation: x.implementation ?? null,
				locator: x.locator ?? null
			};
			const row = app.sqlite
				.prepare('SELECT * FROM soa_entry WHERE engagement_id = ? AND requirement_id = ? AND deleted = 0')
				.get(e.id, req.id) as Row | undefined;
			if (row) {
				updateEntity(app, actor, soaEntryDefinition, String(row.id), Number(row.current_version), data);
				updated++;
			} else {
				createEntity(app, actor, soaEntryDefinition, {
					...data,
					engagement_id: e.id,
					requirement_id: req.id
				});
				recorded++;
			}
		}
		return { recorded, updated };
	})();
}

export interface SoaConflict {
	requirementId: string;
	refCode: string;
	title: string;
	sourceCode: string;
	/** excluded: the SoA marks it not applicable; missing: an Annex control the SoA does not list. */
	kind: 'excluded' | 'missing';
	justification: string | null;
	locator: string | null;
	/** The auditor kept it in scope, and why. */
	kept: { note: string | null } | null;
}

export interface SoaCheck {
	/** Some selected requirement is from ISO/IEC 27001 or 27701. */
	relevant: boolean;
	soa: { id: string; name: string; textStatus: string } | null;
	entries: number;
	conflicts: SoaConflict[];
	/** For information: controls the SoA marks applicable that the audit scope leaves out. */
	applicableNotInScope: { requirementId: string; refCode: string; title: string }[];
}

export function soaCheck(app: AppDatabase, engagementId: string): SoaCheck {
	const e = getEngagement(app, engagementId);
	const selected = listSelected(app, e.id).filter((s) =>
		usesSoa({ code: s.sourceCode, title: s.sourceTitle })
	);
	const soa = currentSoa(app, e.id);
	const out: SoaCheck = {
		relevant: selected.length > 0,
		soa: soa ? { id: soa.id, name: soa.displayName, textStatus: soa.textStatus } : null,
		entries: 0,
		conflicts: [],
		applicableNotInScope: []
	};
	if (!out.relevant || !soa) return out;
	const rows = app.sqlite
		.prepare(
			`SELECT s.*, r.ref_code, r.title FROM soa_entry s JOIN requirement r ON r.id = s.requirement_id
			  WHERE s.engagement_id = ? AND s.artifact_id = ? AND s.deleted = 0`
		)
		.all(e.id, soa.id) as Row[];
	out.entries = rows.length;
	if (!rows.length) return out;
	const byReq = new Map(rows.map((r) => [String(r.requirement_id), r]));
	const decisions = new Map(
		(
			app.sqlite
				.prepare(
					`SELECT requirement_id, soa_decision, soa_note FROM engagement_requirement
					  WHERE engagement_id = ? AND deleted = 0`
				)
				.all(e.id) as { requirement_id: string; soa_decision: string | null; soa_note: string | null }[]
		).map((d) => [d.requirement_id, d])
	);
	for (const s of selected) {
		const entry = byReq.get(s.requirementId);
		const d = decisions.get(s.requirementId);
		const kept = d?.soa_decision === 'keep' ? { note: d.soa_note } : null;
		const base = {
			requirementId: s.requirementId,
			refCode: s.refCode,
			title: s.title,
			sourceCode: s.sourceCode,
			kept
		};
		if (entry && Number(entry.applicable) === 0)
			out.conflicts.push({
				...base,
				kind: 'excluded',
				justification: (entry.justification as string | null) ?? null,
				locator: (entry.locator as string | null) ?? null
			});
		else if (!entry && ANNEX.test(s.refCode))
			out.conflicts.push({ ...base, kind: 'missing', justification: null, locator: null });
	}
	const inScope = new Set(selected.map((s) => s.requirementId));
	out.applicableNotInScope = rows
		.filter((r) => Number(r.applicable) === 1 && !inScope.has(String(r.requirement_id)))
		.map((r) => ({
			requirementId: String(r.requirement_id),
			refCode: String(r.ref_code),
			title: String(r.title)
		}))
		.sort((a, b) => a.refCode.localeCompare(b.refCode, 'en', { numeric: true }));
	return out;
}

/** The auditor keeps a conflicting requirement in scope, with the reason. */
export function keepInScope(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	requirementId: string,
	note: string
): void {
	requireHuman(actor, 'Keeping a requirement in scope against the Statement of Applicability');
	if (!note.trim()) throw new ValidationError('Say why it stays in the audit scope.', { note: 'Required' });
	const row = app.sqlite
		.prepare(
			'SELECT * FROM engagement_requirement WHERE engagement_id = ? AND requirement_id = ? AND deleted = 0'
		)
		.get(engagementId, requirementId) as Row | undefined;
	if (!row) throw new ValidationError('That requirement is not in the audit scope.');
	updateEntity(
		app,
		actor,
		engagementRequirementDefinition,
		String(row.id),
		Number(row.current_version),
		{ soa_decision: 'keep', soa_note: note },
		'Kept in scope against the Statement of Applicability'
	);
}
