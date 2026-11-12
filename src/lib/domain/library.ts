import type { AppDatabase } from '#lib/db/client.ts';
import { searchText } from '#lib/db/fts.ts';
import { NotFoundError, ValidationError } from './errors';
import { registerEntity } from './registry';
import {
	createEntity,
	deleteEntity,
	readRow,
	updateEntity,
	write,
	type Actor,
	type EntityDefinition,
	type Row,
	type SqlValue
} from './write';

/**
 * The requirement library: sources, requirements in a tree, typed links between requirements,
 * guidance and criteria. Every row is a versioned entity written through `write()`.
 */

export const SOURCE_TYPES = ['law', 'standard', 'internal'] as const;
export const LINK_TYPES = ['details', 'explains', 'implements', 'equivalent', 'conflicts'] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export const COVERAGE = ['full', 'partial'] as const;

export const LINK_LABELS: Record<LinkType, { forward: string; backward: string }> = {
	details: { forward: 'Details', backward: 'Detailed by' },
	explains: { forward: 'Explains', backward: 'Explained by' },
	implements: { forward: 'Implements', backward: 'Implemented by' },
	equivalent: { forward: 'Equivalent to', backward: 'Equivalent to' },
	conflicts: { forward: 'Conflicts with', backward: 'Conflicts with' }
};

const str = (v: unknown) => (v == null ? '' : String(v)).trim();
const optional = (v: unknown) => {
	const s = str(v);
	return s ? s : null;
};

/** Accepts "en", "lv", "en-GB". Stored lower case. */
export function normalizeLanguage(v: unknown): string {
	const s = str(v).toLowerCase();
	if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(s))
		throw new ValidationError('Language must be a code such as "en" or "lv".', {
			language: 'Use a code such as en or lv'
		});
	return s;
}

function pick(input: Record<string, unknown>, existing: Row | null, col: string, key = col): boolean {
	return key in input || !existing;
}

// ---- Entity definitions

export const sourceDefinition: EntityDefinition = registerEntity({
	type: 'source',
	table: 'source',
	columns: ['code', 'type', 'title', 'edition', 'language', 'licence_note', 'auditee_id', 'artifact_id'],
	detailColumns: ['code', 'type', 'title', 'edition', 'language', 'licence_note'],
	fieldLabels: {
		code: 'Code',
		type: 'Type',
		title: 'Title',
		edition: 'Edition',
		language: 'Language',
		licence_note: 'Licence note'
	},
	parse(input, existing) {
		const out: Row = {};
		if (pick(input, existing, 'code')) {
			const code = str(input.code).toLowerCase();
			if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(code))
				throw new ValidationError('Code: letters, digits, dot, dash or underscore.', { code: 'Invalid' });
			out.code = code;
		}
		if (pick(input, existing, 'type')) {
			const type = str(input.type || 'standard');
			if (!(SOURCE_TYPES as readonly string[]).includes(type))
				throw new ValidationError('Type is law, standard or internal.', { type: 'Invalid' });
			out.type = type;
		}
		if (pick(input, existing, 'title')) {
			const title = str(input.title);
			if (!title) throw new ValidationError('Title is required.', { title: 'Required' });
			out.title = title;
		}
		if (pick(input, existing, 'language')) out.language = normalizeLanguage(input.language ?? 'en');
		for (const col of ['edition', 'licence_note', 'auditee_id', 'artifact_id'])
			if (col in input) out[col] = optional(input[col]);
		return out;
	},
	search: (row) => ({ title: row.title as string, code: row.code as string }),
	label: (row) => String(row.title),
	refLine: (row) => [row.code, row.edition, String(row.language).toUpperCase()].filter(Boolean).join(' · ')
});

export const requirementDefinition: EntityDefinition = registerEntity({
	type: 'requirement',
	table: 'requirement',
	columns: [
		'source_id',
		'ref_code',
		'title',
		'text',
		'language',
		'translation_of',
		'locator',
		'parent_id',
		'origin',
		'status',
		'quote',
		'position'
	],
	detailColumns: ['ref_code', 'title', 'text', 'language', 'locator', 'status'],
	fieldLabels: {
		ref_code: 'Reference',
		title: 'Title',
		text: 'Text',
		language: 'Language',
		translation_of: 'Translation of',
		locator: 'Locator',
		parent_id: 'Parent',
		origin: 'Origin',
		status: 'Status',
		quote: 'Quote',
		position: 'Position'
	},
	formatValue(column, value) {
		if (column === 'language') return String(value ?? '').toUpperCase();
		if (column === 'status') return value === 'proposed' ? 'Proposed' : 'Confirmed';
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	parse(input, existing) {
		const out: Row = {};
		if (pick(input, existing, 'source_id')) {
			if (existing && str(input.source_id) !== existing.source_id)
				throw new ValidationError('A requirement cannot move to another source.');
			out.source_id = str(input.source_id);
			if (!out.source_id) throw new ValidationError('Source is required.');
		}
		if (pick(input, existing, 'ref_code')) {
			const ref = str(input.ref_code);
			if (!ref) throw new ValidationError('Reference code is required.', { ref_code: 'Required' });
			if (ref.length > 64)
				throw new ValidationError('Reference code is too long.', { ref_code: 'At most 64 characters' });
			out.ref_code = ref;
		}
		if (pick(input, existing, 'title')) {
			const title = str(input.title);
			if (!title) throw new ValidationError('Title is required.', { title: 'Required' });
			out.title = title;
		}
		if ('text' in input) out.text = optional(input.text);
		if (pick(input, existing, 'language')) out.language = normalizeLanguage(input.language);
		for (const col of ['translation_of', 'locator', 'parent_id', 'quote'])
			if (col in input) out[col] = optional(input[col]);
		if (pick(input, existing, 'origin')) {
			const origin = str(input.origin || 'external');
			if (origin !== 'external' && origin !== 'internal')
				throw new ValidationError('Origin is external or internal.');
			out.origin = origin;
		}
		if (pick(input, existing, 'status')) {
			const status = str(input.status || 'confirmed');
			if (status !== 'proposed' && status !== 'confirmed')
				throw new ValidationError('Status is proposed or confirmed.');
			out.status = status;
		}
		if ('position' in input) out.position = Number(input.position) || 0;
		else if (!existing) out.position = 0;
		return out;
	},
	afterWrite(app, _actor, row) {
		const id = String(row.id);
		if (row.parent_id) {
			const parent = readRow(app, requirementDefinition, String(row.parent_id));
			if (!parent || parent.source_id !== row.source_id)
				throw new ValidationError('The parent must be a requirement in the same source.');
			// No cycles: walk up from the parent.
			let cursor: Row | null = parent;
			for (let i = 0; cursor && i < 64; i++) {
				if (cursor.id === id) throw new ValidationError('A requirement cannot be its own ancestor.');
				cursor = cursor.parent_id ? readRow(app, requirementDefinition, String(cursor.parent_id)) : null;
			}
		}
		if (row.translation_of) {
			const other = readRow(app, requirementDefinition, String(row.translation_of));
			if (!other || other.id === id)
				throw new ValidationError('Translation of: choose another existing requirement.');
			if (other.language === row.language)
				throw new ValidationError('A translation must be in another language.', {
					translation_of: 'Same language'
				});
		}
	},
	search: (row) => ({
		ref_code: row.ref_code as string,
		title: row.title as string,
		text: row.text as string | null
	}),
	label: (row) => String(row.title),
	refLine: (row) => `${row.ref_code} · ${String(row.language).toUpperCase()}`
});

export const linkDefinition: EntityDefinition = registerEntity({
	type: 'requirement_link',
	table: 'requirement_link',
	columns: ['from_id', 'to_id', 'type', 'coverage', 'note'],
	fieldLabels: { from_id: 'From', to_id: 'To', type: 'Type', coverage: 'Coverage', note: 'Note' },
	parse(input, existing) {
		const out: Row = {};
		for (const col of ['from_id', 'to_id'] as const) {
			if (pick(input, existing, col)) {
				if (existing && str(input[col]) !== existing[col])
					throw new ValidationError('A link cannot be moved; remove it and add a new one.');
				out[col] = str(input[col]);
				if (!out[col]) throw new ValidationError('Both ends of a link are required.');
			}
		}
		const type = 'type' in input || !existing ? str(input.type) : String(existing.type);
		if (!(LINK_TYPES as readonly string[]).includes(type))
			throw new ValidationError('Link type is details, explains, implements, equivalent or conflicts.', {
				type: 'Invalid'
			});
		if ('type' in input || !existing) out.type = type;
		if ('coverage' in input || 'type' in input || !existing) {
			const coverage = optional(input.coverage ?? (existing?.coverage as SqlValue));
			if (type === 'implements') {
				if (!coverage || !(COVERAGE as readonly string[]).includes(coverage))
					throw new ValidationError('Implements needs coverage: full or partial.', {
						coverage: 'Choose full or partial'
					});
				out.coverage = coverage;
			} else out.coverage = null;
		}
		if ('note' in input) out.note = optional(input.note);
		return out;
	},
	afterWrite(app, _actor, row) {
		if (Number(row.deleted) === 1) return;
		if (row.from_id === row.to_id) throw new ValidationError('A requirement cannot link to itself.');
		for (const end of [row.from_id, row.to_id]) {
			const r = readRow(app, requirementDefinition, String(end));
			if (!r || Number(r.deleted) === 1)
				throw new ValidationError('Both ends must be existing requirements.');
		}
		const dup = app.sqlite
			.prepare(
				'SELECT id FROM requirement_link WHERE from_id = ? AND to_id = ? AND type = ? AND deleted = 0 AND id <> ?'
			)
			.get(row.from_id, row.to_id, row.type, row.id);
		if (dup) throw new ValidationError('This link already exists.');
	},
	label: (row) => `${LINK_LABELS[row.type as LinkType]?.forward ?? row.type}`,
	refLine: (row) => `Link${row.coverage ? ` · ${row.coverage} coverage` : ''}`
});

export const guidanceDefinition: EntityDefinition = registerEntity({
	type: 'guidance',
	table: 'guidance',
	columns: ['requirement_id', 'body'],
	fieldLabels: { requirement_id: 'Requirement', body: 'Guidance' },
	detailColumns: ['body'],
	parse(input, existing) {
		const out: Row = {};
		if (!existing) out.requirement_id = str(input.requirement_id);
		if ('body' in input || !existing) {
			const body = str(input.body);
			if (body.length > 20000) throw new ValidationError('Guidance is at most 20,000 characters.');
			out.body = body;
		}
		return out;
	},
	search: (row) => ({ body: row.body as string }),
	label: () => 'Guidance'
});

export const criterionDefinition: EntityDefinition = registerEntity({
	type: 'criterion',
	table: 'criterion',
	columns: ['requirement_id', 'engagement_id', 'text', 'expected_evidence', 'position'],
	fieldLabels: {
		text: 'Criterion',
		expected_evidence: 'Expected evidence',
		engagement_id: 'Engagement',
		position: 'Position'
	},
	detailColumns: ['text', 'expected_evidence'],
	formatValue(column, value) {
		if (column === 'expected_evidence') return parseEvidence(value).join('; ');
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	parse(input, existing) {
		const out: Row = {};
		if (!existing) {
			out.requirement_id = str(input.requirement_id);
			out.engagement_id = optional(input.engagement_id);
		}
		if ('text' in input || !existing) {
			const text = str(input.text);
			if (!text) throw new ValidationError('Write the criterion.', { text: 'Required' });
			out.text = text;
		}
		if ('expected_evidence' in input || !existing)
			out.expected_evidence = JSON.stringify(cleanEvidence(input.expected_evidence));
		if ('position' in input) out.position = Number(input.position) || 0;
		return out;
	},
	search: (row) => ({ text: row.text as string }),
	label: (row) => String(row.text).slice(0, 80)
});

export function cleanEvidence(v: unknown): string[] {
	const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [];
	return list.map((x) => str(x)).filter(Boolean);
}

export function parseEvidence(v: unknown): string[] {
	if (Array.isArray(v)) return v.map(String);
	try {
		const parsed = JSON.parse(String(v ?? '[]'));
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

// ---- Read models

export interface Source {
	id: string;
	code: string;
	type: string;
	title: string;
	edition: string | null;
	language: string;
	licenceNote: string | null;
	version: number;
	requirementCount: number;
}

export interface Requirement {
	id: string;
	sourceId: string;
	sourceCode: string;
	sourceTitle: string;
	refCode: string;
	title: string;
	text: string | null;
	language: string;
	translationOf: string | null;
	parentId: string | null;
	locator: string | null;
	origin: string;
	status: string;
	position: number;
	version: number;
}

export interface TreeNode extends Requirement {
	children: TreeNode[];
}

function toRequirement(r: Row): Requirement {
	return {
		id: String(r.id),
		sourceId: String(r.source_id),
		sourceCode: String(r.source_code ?? ''),
		sourceTitle: String(r.source_title ?? ''),
		refCode: String(r.ref_code),
		title: String(r.title),
		text: (r.text as string | null) ?? null,
		language: String(r.language),
		translationOf: (r.translation_of as string | null) ?? null,
		parentId: (r.parent_id as string | null) ?? null,
		locator: (r.locator as string | null) ?? null,
		origin: String(r.origin),
		status: String(r.status),
		position: Number(r.position),
		version: Number(r.current_version)
	};
}

const REQ_SELECT = `SELECT r.*, s.code AS source_code, s.title AS source_title
	FROM requirement r JOIN source s ON s.id = r.source_id`;

/** External sources only: internal sources belong to one auditee and are listed with its engagements. */
export function listSources(app: AppDatabase): Source[] {
	const rows = app.sqlite
		.prepare(
			`SELECT s.*, (SELECT count(*) FROM requirement r WHERE r.source_id = s.id AND r.deleted = 0) AS n
			   FROM source s WHERE s.deleted = 0 AND s.auditee_id IS NULL ORDER BY s.title COLLATE NOCASE`
		)
		.all() as Row[];
	return rows.map((r) => ({
		id: String(r.id),
		code: String(r.code),
		type: String(r.type),
		title: String(r.title),
		edition: (r.edition as string | null) ?? null,
		language: String(r.language),
		licenceNote: (r.licence_note as string | null) ?? null,
		version: Number(r.current_version),
		requirementCount: Number(r.n)
	}));
}

export function getSourceByCode(app: AppDatabase, code: string): Source | null {
	return listSources(app).find((s) => s.code === code.toLowerCase()) ?? null;
}

export function getRequirement(app: AppDatabase, id: string): Requirement {
	const row = app.sqlite.prepare(`${REQ_SELECT} WHERE r.id = ?`).get(id) as Row | undefined;
	if (!row) throw new NotFoundError('Requirement not found');
	return toRequirement(row);
}

export function findRequirement(app: AppDatabase, sourceId: string, refCode: string): Requirement | null {
	const row = app.sqlite
		.prepare(`${REQ_SELECT} WHERE r.source_id = ? AND r.ref_code = ?`)
		.get(sourceId, refCode) as Row | undefined;
	return row ? toRequirement(row) : null;
}

/** Natural order for codes like "Art. 21(2)(j)", "A.5.15" and "A.5.2": numbers compare as numbers. */
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** The requirements of one source as a tree, in source order. */
export function requirementTree(app: AppDatabase, sourceId: string): TreeNode[] {
	const rows = (
		app.sqlite.prepare(`${REQ_SELECT} WHERE r.source_id = ? AND r.deleted = 0`).all(sourceId) as Row[]
	).map(toRequirement);
	const byId = new Map<string, TreeNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
	const roots: TreeNode[] = [];
	for (const node of byId.values()) {
		const parent = node.parentId ? byId.get(node.parentId) : undefined;
		(parent ? parent.children : roots).push(node);
	}
	const sort = (list: TreeNode[]) => {
		list.sort((a, b) => a.position - b.position || collator.compare(a.refCode, b.refCode));
		list.forEach((n) => sort(n.children));
	};
	sort(roots);
	return roots;
}

export interface RequirementHit extends Requirement {
	snippet: string;
}

/** Full-text search over reference code, title and text, across all external sources or one. */
export function searchRequirements(
	app: AppDatabase,
	query: string,
	options: { sourceId?: string; limit?: number; excludeId?: string } = {}
): RequirementHit[] {
	const hits = searchText(app.sqlite, query, { entityTypes: ['requirement'], limit: 200 });
	const best = new Map<string, string>();
	for (const h of hits) if (!best.has(h.entityId)) best.set(h.entityId, h.snippet);
	if (best.size === 0) return [];
	const ids = [...best.keys()];
	const rows = app.sqlite
		.prepare(
			`${REQ_SELECT} WHERE r.id IN (${ids.map(() => '?').join(',')}) AND r.deleted = 0 AND s.deleted = 0 AND s.auditee_id IS NULL`
		)
		.all(...ids) as Row[];
	const byId = new Map(rows.map((r) => [String(r.id), toRequirement(r)]));
	return ids
		.map((id) => byId.get(id))
		.filter(
			(r): r is Requirement =>
				!!r && (!options.sourceId || r.sourceId === options.sourceId) && r.id !== options.excludeId
		)
		.slice(0, options.limit ?? 50)
		.map((r) => ({ ...r, snippet: best.get(r.id) ?? '' }));
}

// ---- Links

export interface LinkView {
	id: string;
	version: number;
	type: LinkType;
	/** "Implements" when this requirement is the from end, "Implemented by" when it is the to end. */
	label: string;
	direction: 'out' | 'in';
	coverage: string | null;
	note: string | null;
	other: Requirement;
}

export function linksOf(app: AppDatabase, requirementId: string): LinkView[] {
	const rows = app.sqlite
		.prepare(
			'SELECT * FROM requirement_link WHERE deleted = 0 AND (from_id = ? OR to_id = ?) ORDER BY created_at'
		)
		.all(requirementId, requirementId) as Row[];
	return rows.map((l) => {
		const direction = l.from_id === requirementId ? 'out' : 'in';
		const type = l.type as LinkType;
		return {
			id: String(l.id),
			version: Number(l.current_version),
			type,
			label: direction === 'out' ? LINK_LABELS[type].forward : LINK_LABELS[type].backward,
			direction,
			coverage: (l.coverage as string | null) ?? null,
			note: (l.note as string | null) ?? null,
			other: getRequirement(app, String(direction === 'out' ? l.to_id : l.from_id))
		};
	});
}

export function addLink(
	app: AppDatabase,
	actor: Actor,
	input: { fromId: string; toId: string; type: string; coverage?: string | null; note?: string | null }
) {
	return createEntity(app, actor, linkDefinition, {
		from_id: input.fromId,
		to_id: input.toId,
		type: input.type,
		coverage: input.coverage ?? null,
		note: input.note ?? null
	});
}

export function removeLink(app: AppDatabase, actor: Actor, linkId: string, baseVersion: number) {
	return deleteEntity(app, actor, linkDefinition, linkId, baseVersion, 'Link removed');
}

// ---- Guidance and criteria

export interface GuidanceView {
	id: string;
	body: string;
	version: number;
}

export function getGuidance(app: AppDatabase, requirementId: string): GuidanceView | null {
	const row = app.sqlite.prepare('SELECT * FROM guidance WHERE requirement_id = ?').get(requirementId) as
		Row | undefined;
	if (!row || Number(row.deleted) === 1) return null;
	return { id: String(row.id), body: String(row.body), version: Number(row.current_version) };
}

/**
 * Create or replace the guidance of a requirement. Guidance is its own versioned item, so editing it
 * never touches the requirement's text or version. `baseVersion` is the guidance version the edit is
 * based on (omit when there is none yet).
 */
export function setGuidance(
	app: AppDatabase,
	actor: Actor,
	requirementId: string,
	body: string,
	baseVersion?: number
) {
	getRequirement(app, requirementId);
	const row = app.sqlite
		.prepare('SELECT id, current_version, deleted FROM guidance WHERE requirement_id = ?')
		.get(requirementId) as Row | undefined;
	if (!row) {
		return createEntity(app, actor, guidanceDefinition, { requirement_id: requirementId, body });
	}
	const base = baseVersion ?? Number(row.current_version);
	if (Number(row.deleted) === 1) {
		// Bring deleted guidance back as a new version with the new text.
		return write(app, actor, guidanceDefinition, {
			op: 'update',
			id: String(row.id),
			baseVersion: base,
			data: { body, deleted: 0 } as never
		});
	}
	return updateEntity(app, actor, guidanceDefinition, String(row.id), base, { body });
}

export interface CriterionView {
	id: string;
	text: string;
	expectedEvidence: string[];
	engagementId: string | null;
	version: number;
}

/** General criteria (no engagement) of a requirement, in order. */
export function criteriaOf(
	app: AppDatabase,
	requirementId: string,
	engagementId: string | null = null
): CriterionView[] {
	const rows = app.sqlite
		.prepare(
			`SELECT * FROM criterion WHERE requirement_id = ? AND deleted = 0 AND engagement_id IS ?
			  ORDER BY position, created_at`
		)
		.all(requirementId, engagementId) as Row[];
	return rows.map((c) => ({
		id: String(c.id),
		text: String(c.text),
		expectedEvidence: parseEvidence(c.expected_evidence),
		engagementId: (c.engagement_id as string | null) ?? null,
		version: Number(c.current_version)
	}));
}

export function addCriterion(
	app: AppDatabase,
	actor: Actor,
	requirementId: string,
	input: { text: string; expectedEvidence?: string[] | string; engagementId?: string | null }
) {
	getRequirement(app, requirementId);
	const position = criteriaOf(app, requirementId, input.engagementId ?? null).length;
	return createEntity(app, actor, criterionDefinition, {
		requirement_id: requirementId,
		engagement_id: input.engagementId ?? null,
		text: input.text,
		expected_evidence: input.expectedEvidence ?? [],
		position
	});
}

export function updateCriterion(
	app: AppDatabase,
	actor: Actor,
	id: string,
	baseVersion: number,
	input: { text?: string; expectedEvidence?: string[] | string }
) {
	const data: Record<string, unknown> = {};
	if (input.text !== undefined) data.text = input.text;
	if (input.expectedEvidence !== undefined) data.expected_evidence = input.expectedEvidence;
	return updateEntity(app, actor, criterionDefinition, id, baseVersion, data);
}

export function removeCriterion(app: AppDatabase, actor: Actor, id: string, baseVersion: number) {
	return deleteEntity(app, actor, criterionDefinition, id, baseVersion, 'Criterion removed');
}

// ---- Translations

/** Other language versions of the same requirement, in both directions of translation_of. */
export function translationsOf(app: AppDatabase, requirementId: string): Requirement[] {
	const me = getRequirement(app, requirementId);
	const rootId = me.translationOf ?? me.id;
	const rows = app.sqlite
		.prepare(`${REQ_SELECT} WHERE r.deleted = 0 AND (r.id = ? OR r.translation_of = ?) AND r.id <> ?`)
		.all(rootId, rootId, me.id) as Row[];
	return rows.map(toRequirement).sort((a, b) => a.language.localeCompare(b.language));
}

/** Mark a requirement as the translation of another (or clear it with null). */
export function setTranslationOf(
	app: AppDatabase,
	actor: Actor,
	requirementId: string,
	baseVersion: number,
	translationOf: string | null
) {
	let target = translationOf;
	if (target) {
		// Always point at the original, so a pair never becomes a chain.
		const other = getRequirement(app, target);
		target = other.translationOf ?? other.id;
	}
	return updateEntity(app, actor, requirementDefinition, requirementId, baseVersion, {
		translation_of: target
	});
}

/** Requirement-specific content for the item sheet. */
export function requirementExtra(app: AppDatabase, requirementId: string) {
	const req = getRequirement(app, requirementId);
	return {
		requirement: req,
		parent: req.parentId ? getRequirement(app, req.parentId) : null,
		guidance: getGuidance(app, requirementId),
		criteria: criteriaOf(app, requirementId),
		links: linksOf(app, requirementId),
		translations: translationsOf(app, requirementId)
	};
}

requirementDefinition.extra = (app, row) => requirementExtra(app, String(row.id));
requirementDefinition.linkCount = (app, row) => linksOf(app, String(row.id)).length;
