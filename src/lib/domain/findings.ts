import type { AppDatabase } from '#lib/db/client.ts';
import { engagementGuard, findingScaleOf, getEngagement, type FindingValue } from './engagements';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { listLinks, suspectedIssues, type Note } from './execution';
import { requireHuman } from './guards';
import { listInternal } from './internal';
import { listEvidence, type EvidenceItem } from './planning';
import { registerEntity } from './registry';
import { criticalityOf, idList } from './risks';
import { listAssessmentUnits, listSelected, type Criticality } from './selection';
import {
	createEntity,
	deleteEntity,
	updateEntity,
	type Actor,
	type EntityDefinition,
	type Row
} from './write';

/**
 * Findings: one per assessment unit, valued on the engagement's own finding scale. AI proposes;
 * a person saves a draft and approves, which locks it as a conclusion until it is reopened.
 * Missing evidence leads to "no reasonable assurance", never to a non-conformity (CLAUDE.md rule 6).
 */

export const CONFIDENCE = ['high', 'medium', 'low'] as const;
const str = (v: unknown) => (v == null ? '' : String(v)).trim();

export const findingDefinition: EntityDefinition = registerEntity({
	type: 'finding',
	table: 'finding',
	columns: [
		'engagement_id',
		'assessment_unit_id',
		'finding_value_id',
		'rationale',
		'evidence_item_ids',
		'confidence',
		'status',
		'approved_by',
		'approved_at',
		'approved_version'
	],
	detailColumns: ['finding_value_id', 'rationale', 'confidence', 'status', 'approved_at'],
	fieldLabels: {
		finding_value_id: 'Finding',
		rationale: 'Rationale',
		evidence_item_ids: 'Evidence relied on',
		confidence: 'Confidence',
		status: 'Status',
		approved_by: 'Approved by',
		approved_at: 'Approved at',
		approved_version: 'Approved version'
	},
	formatValue(column, value) {
		if (column === 'status')
			return value === 'approved' ? 'Approved (conclusion)' : value === 'draft' ? 'Draft' : 'Proposed';
		if (column === 'approved_at')
			return value ? new Date(Number(value)).toISOString().slice(0, 16).replace('T', ' ') : '';
		if (column === 'evidence_item_ids') return `${idList(value).length}`;
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	engagementOf: (app, row) => engagementGuard(app, row.engagement_id),
	/** Approval fields are set by a person in the app only (CLAUDE.md rule 3). */
	humanOnly: ['approved_by', 'approved_at', 'approved_version'],
	/** A finding is a judgement: AI writes leave it proposed. */
	judgement: () => ({ column: 'status', proposed: 'proposed' }),
	parse(input, existing) {
		const out: Row = {};
		if (
			existing?.status === 'approved' &&
			!(
				input.status === 'draft' &&
				Object.keys(input).every((k) =>
					['status', 'approved_by', 'approved_at', 'approved_version'].includes(k)
				)
			)
		)
			throw new ValidationError('This finding is approved and locked. Reopen it to change it.');
		if (!existing) {
			out.engagement_id = str(input.engagement_id);
			out.assessment_unit_id = str(input.assessment_unit_id);
		}
		if ('finding_value_id' in input) out.finding_value_id = str(input.finding_value_id) || null;
		if ('rationale' in input) out.rationale = str(input.rationale) || null;
		if ('evidence_item_ids' in input || !existing)
			out.evidence_item_ids = JSON.stringify(idList(input.evidence_item_ids));
		if ('confidence' in input) {
			const c = str(input.confidence) || null;
			if (c && !(CONFIDENCE as readonly string[]).includes(c))
				throw new ValidationError('Confidence is high, medium or low.');
			out.confidence = c;
		}
		if ('status' in input || !existing) {
			const s = str(input.status || 'draft');
			if (!['proposed', 'draft', 'approved'].includes(s))
				throw new ValidationError('Status is proposed, draft or approved.');
			out.status = s;
		}
		for (const col of ['approved_by', 'approved_at', 'approved_version'] as const)
			if (col in input) out[col] = input[col] == null ? null : (input[col] as string | number);
		return out;
	},
	afterWrite(app, _actor, row) {
		if (Number(row.deleted) === 1) return;
		const engagementId = String(row.engagement_id);
		const unit = listAssessmentUnits(app, engagementId).find((u) => u.id === row.assessment_unit_id);
		if (!unit) throw new ValidationError('Choose an assessment unit of this engagement.');
		const other = app.sqlite
			.prepare('SELECT id FROM finding WHERE assessment_unit_id = ? AND deleted = 0 AND id <> ?')
			.get(row.assessment_unit_id, row.id);
		if (other) throw new ValidationError('This assessment unit already has a finding.');
		const scale = findingScaleOf(app, engagementId);
		const value = row.finding_value_id ? scale.find((v) => v.id === row.finding_value_id) : null;
		if (row.finding_value_id && !value)
			throw new ValidationError('Choose a value from the engagement’s finding scale.');
		if (row.status === 'approved' && !value)
			throw new ValidationError('Choose a finding value before approving.');
		const evidence = listEvidence(app, engagementId);
		const cited = idList(row.evidence_item_ids);
		if (cited.some((id) => !evidence.some((x) => x.id === id)))
			throw new ValidationError('Cite planned evidence of this engagement.');
		if (value?.isNonconformity) {
			// Rule 6: a non-conformity rests on evidence that was obtained, never on evidence that is missing.
			const obtained = evidence.filter(
				(x) => cited.includes(x.id) && (x.status === 'received' || x.status === 'partial')
			);
			if (!obtained.length)
				throw new ValidationError(
					'A non-conformity needs evidence that was obtained. Missing evidence means no reasonable assurance, not a non-conformity.',
					{ finding_value_id: 'Cite received evidence' }
				);
		}
	},
	search: (row) => ({ rationale: row.rationale as string | null }),
	label: (row) => `Finding${row.status === 'approved' ? ' (conclusion)' : ''}`,
	refLine: (row) => `Finding · ${row.status}`
});

// ---- The card for one assessment unit

export interface UnitCard {
	unitId: string;
	requirementId: string;
	refCode: string;
	sourceCode: string;
	title: string;
	text: string | null;
	scopeId: string | null;
	scopeName: string;
	criticality: Criticality;
	evidence: (Pick<EvidenceItem, 'id' | 'text' | 'status' | 'kind' | 'criticality'> & {
		links: {
			sufficiency: string;
			status: string;
			artifactTitle: string;
			locator: string | null;
			excerpt: string | null;
		}[];
	})[];
	evidenceSummary: {
		total: number;
		received: number;
		partial: number;
		promised: number;
		missing: number;
		planned: number;
		contradicts: number;
	};
	internalRules: { id: string; refCode: string; title: string; coverage: string | null }[];
	suspectedIssues: Pick<Note, 'id' | 'text' | 'at'>[];
	finding: Finding | null;
}

export interface Finding {
	id: string;
	unitId: string;
	value: FindingValue | null;
	rationale: string | null;
	evidenceItemIds: string[];
	confidence: string | null;
	status: 'proposed' | 'draft' | 'approved';
	approvedBy: string | null;
	approvedByName: string | null;
	approvedAt: Date | null;
	approvedVersion: number | null;
	version: number;
}

function toFinding(app: AppDatabase, r: Row, scale: FindingValue[]): Finding {
	const approvedBy = (r.approved_by as string | null) ?? null;
	const name = approvedBy
		? (
				app.sqlite.prepare('SELECT name FROM "user" WHERE id = ?').get(approvedBy) as
					{ name: string } | undefined
			)?.name
		: null;
	return {
		id: String(r.id),
		unitId: String(r.assessment_unit_id),
		value: scale.find((v) => v.id === r.finding_value_id) ?? null,
		rationale: (r.rationale as string | null) ?? null,
		evidenceItemIds: idList(r.evidence_item_ids),
		confidence: (r.confidence as string | null) ?? null,
		status: r.status as Finding['status'],
		approvedBy,
		approvedByName: name ?? null,
		approvedAt: r.approved_at ? new Date(Number(r.approved_at)) : null,
		approvedVersion: r.approved_version == null ? null : Number(r.approved_version),
		version: Number(r.current_version)
	};
}

export function listFindings(app: AppDatabase, engagementId: string): Finding[] {
	const scale = findingScaleOf(app, engagementId);
	return (
		app.sqlite
			.prepare('SELECT * FROM finding WHERE engagement_id = ? AND deleted = 0')
			.all(engagementId) as Row[]
	).map((r) => toFinding(app, r, scale));
}

/** Everything the Findings card shows for each assessment unit, in selection order. */
export function unitCards(app: AppDatabase, engagementId: string): UnitCard[] {
	const e = getEngagement(app, engagementId);
	const selected = new Map(listSelected(app, e.id).map((s) => [s.requirementId, s]));
	const crit = criticalityOf(app, e.id);
	const evidence = listEvidence(app, e.id).filter((x) => !x.proposed);
	const links = listLinks(app, e.id);
	const internal = listInternal(app, e.id).filter((r) => r.status === 'confirmed');
	const findings = new Map(listFindings(app, e.id).map((f) => [f.unitId, f]));
	return listAssessmentUnits(app, e.id).map((u) => {
		const s = selected.get(u.requirementId)!;
		const items = evidence.filter(
			(x) =>
				x.requirementIds.includes(u.requirementId) && (!x.scopeId || !u.scopeId || x.scopeId === u.scopeId)
		);
		const withLinks = items.map((x) => ({
			id: x.id,
			text: x.text,
			status: x.status,
			kind: x.kind,
			criticality: x.criticality,
			links: links
				.filter((l) => l.evidenceItemId === x.id)
				.map((l) => ({
					sufficiency: l.sufficiency,
					status: l.status,
					artifactTitle: l.artifactTitle,
					locator: l.locator,
					excerpt: l.excerpt
				}))
		}));
		const count = (st: string) => items.filter((x) => x.status === st).length;
		return {
			unitId: u.id,
			requirementId: u.requirementId,
			refCode: u.refCode,
			sourceCode: s.sourceCode,
			title: s.pinned.title,
			text: s.pinned.text,
			scopeId: u.scopeId,
			scopeName: u.scopeName,
			criticality: crit.get(u.requirementId)?.level ?? 'medium',
			evidence: withLinks,
			evidenceSummary: {
				total: items.length,
				received: count('received'),
				partial: count('partial'),
				promised: count('promised'),
				missing: count('missing'),
				planned: count('planned'),
				contradicts: withLinks.filter((x) =>
					x.links.some((l) => l.status === 'confirmed' && l.sufficiency === 'contradicts')
				).length
			},
			internalRules: internal
				.filter((r) => r.implements.some((l) => l.other.id === u.requirementId))
				.map((r) => ({
					id: r.id,
					refCode: r.refCode,
					title: r.title,
					coverage: r.implements.find((l) => l.other.id === u.requirementId)?.coverage ?? null
				})),
			suspectedIssues: suspectedIssues(app, e.id, u.requirementId).map((n) => ({
				id: n.id,
				text: n.text,
				at: n.at
			})),
			finding: findings.get(u.id) ?? null
		};
	});
}

export function unitCard(app: AppDatabase, engagementId: string, unitId: string): UnitCard {
	const c = unitCards(app, engagementId).find((x) => x.unitId === unitId);
	if (!c) throw new NotFoundError('Assessment unit not found');
	return c;
}

// ---- Commands

export interface FindingInput {
	findingValueId?: string | null;
	rationale?: string | null;
	evidenceItemIds?: string[];
	confidence?: string | null;
}

const toRow = (input: FindingInput): Row => {
	const out: Row = {};
	if (input.findingValueId !== undefined) out.finding_value_id = input.findingValueId;
	if (input.rationale !== undefined) out.rationale = input.rationale;
	if (input.evidenceItemIds !== undefined) out.evidence_item_ids = JSON.stringify(input.evidenceItemIds);
	if (input.confidence !== undefined) out.confidence = input.confidence;
	return out;
};

function findingOfUnit(app: AppDatabase, engagementId: string, unitId: string): Finding | null {
	return listFindings(app, engagementId).find((f) => f.unitId === unitId) ?? null;
}

function findingById(app: AppDatabase, engagementId: string, id: string): Finding {
	const f = listFindings(app, engagementId).find((x) => x.id === id);
	if (!f) throw new NotFoundError('Finding not found');
	return f;
}

/** A person saves the finding as a draft (creating it, or taking over a proposal). */
export function saveDraft(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	unitId: string,
	input: FindingInput,
	baseVersion?: number
): Finding {
	const existing = findingOfUnit(app, engagementId, unitId);
	if (existing) {
		updateEntity(app, actor, findingDefinition, existing.id, baseVersion ?? existing.version, {
			...toRow(input),
			status: 'draft'
		});
		return findingById(app, engagementId, existing.id);
	}
	const row = createEntity(app, actor, findingDefinition, {
		engagement_id: engagementId,
		assessment_unit_id: unitId,
		...toRow(input),
		status: 'draft'
	}).row;
	return findingById(app, engagementId, String(row.id));
}

/**
 * AI proposes a finding for a unit. A suspected issue on the requirement blocks proposing conformity;
 * an approved finding is locked.
 */
export function proposeFinding(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	unitId: string,
	input: FindingInput
): Finding {
	const card = unitCard(app, engagementId, unitId);
	const scale = findingScaleOf(app, engagementId);
	const value = input.findingValueId ? scale.find((v) => v.id === input.findingValueId) : null;
	if (value && !value.isNonconformity && value.code !== 'na' && card.suspectedIssues.length)
		throw new ValidationError(
			`A suspected issue is recorded for ${card.refCode}: "${card.suspectedIssues[0]!.text}". Conformity cannot be proposed while it is open; propose another value or leave it to the auditor.`
		);
	const existing = card.finding;
	if (existing) {
		updateEntity(app, actor, findingDefinition, existing.id, existing.version, {
			...toRow(input),
			status: 'proposed'
		});
		return findingById(app, engagementId, existing.id);
	}
	const row = createEntity(app, actor, findingDefinition, {
		engagement_id: engagementId,
		assessment_unit_id: unitId,
		...toRow(input),
		status: 'proposed'
	}).row;
	return findingById(app, engagementId, String(row.id));
}

export function acceptProposal(app: AppDatabase, actor: Actor, engagementId: string, id: string): Finding {
	requireHuman(actor, 'Accepting a proposed finding');
	const f = findingById(app, engagementId, id);
	if (f.status !== 'proposed') return f;
	updateEntity(
		app,
		actor,
		findingDefinition,
		id,
		f.version,
		{ status: 'draft' },
		'Proposal accepted as draft'
	);
	return findingById(app, engagementId, id);
}

export function rejectProposal(app: AppDatabase, actor: Actor, engagementId: string, id: string): void {
	const f = findingById(app, engagementId, id);
	if (f.status !== 'proposed') throw new ValidationError('Only a proposed finding can be rejected.');
	deleteEntity(app, actor, findingDefinition, id, f.version, 'Proposal rejected');
}

/** Approve: the finding becomes a conclusion, locked. People only, in the app; never through MCP. */
export function approveFinding(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string,
	baseVersion?: number
): Finding {
	requireHuman(actor, 'Approving a finding');
	if (actor.channel !== 'ui') throw new ForbiddenError('Approving a finding is done in the app.');
	const f = findingById(app, engagementId, id);
	if (f.status === 'approved') return f;
	if (f.status === 'proposed')
		throw new ValidationError('Accept the proposal as a draft and review it before approving.');
	updateEntity(
		app,
		actor,
		findingDefinition,
		id,
		baseVersion ?? f.version,
		{
			status: 'approved',
			approved_by: actor.userId,
			approved_at: Date.now(),
			approved_version: (baseVersion ?? f.version) + 1
		},
		'Approved'
	);
	return findingById(app, engagementId, id);
}

export function reopenFinding(app: AppDatabase, actor: Actor, engagementId: string, id: string): Finding {
	requireHuman(actor, 'Reopening a conclusion');
	const f = findingById(app, engagementId, id);
	if (f.status !== 'approved') return f;
	updateEntity(
		app,
		actor,
		findingDefinition,
		id,
		f.version,
		{ status: 'draft', approved_by: null, approved_at: null, approved_version: null },
		'Reopened'
	);
	return findingById(app, engagementId, id);
}

export function approveAllDrafts(app: AppDatabase, actor: Actor, engagementId: string): number {
	requireHuman(actor, 'Approving findings');
	return app.sqlite.transaction(() => {
		const drafts = listFindings(app, engagementId).filter((f) => f.status === 'draft' && f.value);
		for (const f of drafts) approveFinding(app, actor, engagementId, f.id);
		return drafts.length;
	})();
}
