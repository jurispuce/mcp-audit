import type { AppDatabase } from '#lib/db/client.ts';
import { NotFoundError, ValidationError } from './errors';
import { requireHuman } from './guards';
import {
	getRequirement,
	LINK_LABELS,
	linkDefinition,
	listSources,
	requirementDefinition,
	requirementTree,
	sourceDefinition,
	type LinkType,
	type Requirement,
	type Source,
	type TreeNode
} from './library';
import { latestAuthorship } from './history';
import { deleteEntity, readRow, revertEntity, updateEntity, type Actor, type Row } from './write';

/**
 * Review of library changes AI proposed (#69, #70, #71): proposed sources (an import), proposed
 * requirements in published sources (additions or edits), and proposed links (a mapping). A person
 * accepts, edits or rejects each; nothing proposed is selectable or found by library search.
 * Internal requirements are reviewed in their engagement, not here.
 */

export interface MappingSummary {
	fromSourceId: string;
	fromCode: string;
	fromTitle: string;
	toSourceId: string;
	toCode: string;
	toTitle: string;
	proposed: number;
	confirmed: number;
}

export interface LibraryProposals {
	/** Imports waiting to be published. */
	sources: Source[];
	/** Proposed additions or edits in published sources. */
	changes: { source: Source; requirements: (Requirement & { by: string | null })[] }[];
	mappings: MappingSummary[];
	total: number;
}

const shared = (alias: string) => `${alias}.auditee_id IS NULL AND ${alias}.deleted = 0`;

export function listLibraryProposals(app: AppDatabase): LibraryProposals {
	const all = listSources(app, { includeProposed: true });
	const sources = all.filter((s) => s.status === 'proposed');
	const changes = all
		.filter((s) => s.status === 'active' && s.proposedCount > 0)
		.map((source) => ({
			source,
			requirements: flatten(requirementTree(app, source.id))
				.filter((r) => r.status === 'proposed')
				.map((r) => ({ ...r, by: latestAuthorship(app, 'requirement', r.id)?.by ?? null }))
		}));
	const rows = app.sqlite
		.prepare(
			`SELECT fs.id AS from_id, fs.code AS from_code, fs.title AS from_title, ts.id AS to_id, ts.code AS to_code, ts.title AS to_title,
			        sum(l.status = 'proposed') AS proposed, sum(l.status = 'confirmed') AS confirmed
			   FROM requirement_link l
			   JOIN requirement f ON f.id = l.from_id JOIN source fs ON fs.id = f.source_id
			   JOIN requirement t ON t.id = l.to_id JOIN source ts ON ts.id = t.source_id
			  WHERE l.deleted = 0 AND f.deleted = 0 AND t.deleted = 0 AND fs.id <> ts.id AND ${shared('fs')} AND ${shared('ts')}
			  GROUP BY fs.id, ts.id HAVING sum(l.status = 'proposed') > 0
			  ORDER BY fs.title, ts.title`
		)
		.all() as Row[];
	const mappings = rows.map((r) => ({
		fromSourceId: String(r.from_id),
		fromCode: String(r.from_code),
		fromTitle: String(r.from_title),
		toSourceId: String(r.to_id),
		toCode: String(r.to_code),
		toTitle: String(r.to_title),
		proposed: Number(r.proposed),
		confirmed: Number(r.confirmed)
	}));
	const total =
		sources.reduce((n, s) => n + Math.max(1, s.requirementCount), 0) +
		changes.reduce((n, c) => n + c.requirements.length, 0) +
		mappings.reduce((n, m) => n + m.proposed, 0);
	return { sources, changes, mappings, total };
}

function flatten(nodes: TreeNode[]): TreeNode[] {
	return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function sharedSource(app: AppDatabase, id: string): Row {
	const row = readRow(app, sourceDefinition, id);
	if (!row || Number(row.deleted) === 1 || row.auditee_id) throw new NotFoundError('Source not found');
	return row;
}

function sharedRequirement(app: AppDatabase, id: string): Row {
	const row = readRow(app, requirementDefinition, id);
	if (!row || Number(row.deleted) === 1) throw new NotFoundError('Requirement not found');
	sharedSource(app, String(row.source_id));
	return row;
}

// ---- Requirements

export function acceptRequirement(app: AppDatabase, actor: Actor, id: string): Requirement {
	requireHuman(actor, 'Accepting a proposed library change');
	const row = sharedRequirement(app, id);
	if (row.status !== 'confirmed')
		updateEntity(
			app,
			actor,
			requirementDefinition,
			id,
			Number(row.current_version),
			{ status: 'confirmed' },
			'Accepted'
		);
	return getRequirement(app, id);
}

/**
 * Reject a proposal: an AI edit of a requirement goes back to its last confirmed version (as a new
 * version); a requirement AI added is removed. Both stay in the history.
 */
export function rejectRequirement(app: AppDatabase, actor: Actor, id: string): void {
	requireHuman(actor, 'Rejecting a proposed library change');
	const row = sharedRequirement(app, id);
	if (row.status !== 'proposed') throw new ValidationError('Only a proposed change can be rejected.');
	const revisions = app.sqlite
		.prepare(
			"SELECT version, snapshot FROM revision WHERE entity_type = 'requirement' AND entity_id = ? ORDER BY version DESC"
		)
		.all(id) as { version: number; snapshot: string }[];
	const lastConfirmed = revisions.find((r) => (JSON.parse(r.snapshot) as Row).status === 'confirmed');
	if (lastConfirmed)
		revertEntity(
			app,
			actor,
			requirementDefinition,
			id,
			Number(row.current_version),
			lastConfirmed.version,
			'Proposal rejected'
		);
	else deleteEntity(app, actor, requirementDefinition, id, Number(row.current_version), 'Proposal rejected');
}

/** Accept every proposed requirement of a source. */
export function acceptAllInSource(app: AppDatabase, actor: Actor, sourceId: string): number {
	requireHuman(actor, 'Accepting proposed library changes');
	sharedSource(app, sourceId);
	return app.sqlite.transaction(() => {
		const proposed = flatten(requirementTree(app, sourceId)).filter((r) => r.status === 'proposed');
		for (const r of proposed)
			updateEntity(app, actor, requirementDefinition, r.id, r.version, { status: 'confirmed' }, 'Accepted');
		return proposed.length;
	})();
}

// ---- Sources

/** Publish an imported source: it and every proposed requirement in it become part of the library. */
export function publishSource(app: AppDatabase, actor: Actor, sourceId: string): Source {
	requireHuman(actor, 'Publishing a source');
	return app.sqlite.transaction(() => {
		const row = sharedSource(app, sourceId);
		acceptAllInSource(app, actor, sourceId);
		if (row.status !== 'active')
			updateEntity(
				app,
				actor,
				sourceDefinition,
				sourceId,
				Number(row.current_version),
				{ status: 'active' },
				'Published'
			);
		return listSources(app).find((s) => s.id === sourceId)!;
	})();
}

/** Reject a whole proposed source: it, its requirements and their links are removed (kept in history). */
export function rejectSource(app: AppDatabase, actor: Actor, sourceId: string): void {
	requireHuman(actor, 'Rejecting a proposed source');
	app.sqlite.transaction(() => {
		const row = sharedSource(app, sourceId);
		if (row.status !== 'proposed')
			throw new ValidationError(
				'Only a proposed source can be rejected; a published one is changed requirement by requirement.'
			);
		const reqs = flatten(requirementTree(app, sourceId));
		const links = app.sqlite
			.prepare(
				`SELECT id, current_version FROM requirement_link WHERE deleted = 0 AND (from_id IN (SELECT id FROM requirement WHERE source_id = ?) OR to_id IN (SELECT id FROM requirement WHERE source_id = ?))`
			)
			.all(sourceId, sourceId) as { id: string; current_version: number }[];
		for (const l of links)
			deleteEntity(app, actor, linkDefinition, l.id, l.current_version, 'Source rejected');
		for (const r of reqs.reverse())
			deleteEntity(app, actor, requirementDefinition, r.id, r.version, 'Source rejected');
		deleteEntity(
			app,
			actor,
			sourceDefinition,
			sourceId,
			Number(row.current_version),
			'Proposed source rejected'
		);
	})();
}

// ---- Mapping

export interface MappingLink {
	id: string;
	version: number;
	type: LinkType;
	label: string;
	coverage: string | null;
	note: string | null;
	status: 'proposed' | 'confirmed';
	by: string | null;
	/** The requirement at the other end, in the target source. */
	target: { id: string; refCode: string; title: string };
	/** True when the link points from the target to this requirement. */
	reverse: boolean;
}

export interface MappingRow extends Requirement {
	links: MappingLink[];
}

export interface Mapping {
	from: Source;
	to: Source;
	rows: MappingRow[];
	mapped: number;
	proposed: number;
}

/** One source's requirements, each with its links (either direction) to the target source. */
export function mappingOf(app: AppDatabase, fromSourceId: string, toSourceId: string): Mapping {
	const sources = listSources(app, { includeProposed: true });
	const from = sources.find((s) => s.id === fromSourceId);
	const to = sources.find((s) => s.id === toSourceId);
	if (!from || !to) throw new NotFoundError('Source not found');
	if (from.id === to.id) throw new ValidationError('Choose another source to map to.');
	const links = app.sqlite
		.prepare(
			`SELECT l.*, f.source_id AS f_src, t.source_id AS t_src FROM requirement_link l
			   JOIN requirement f ON f.id = l.from_id JOIN requirement t ON t.id = l.to_id
			  WHERE l.deleted = 0 AND f.deleted = 0 AND t.deleted = 0
			    AND ((f.source_id = ? AND t.source_id = ?) OR (f.source_id = ? AND t.source_id = ?))
			  ORDER BY l.created_at`
		)
		.all(from.id, to.id, to.id, from.id) as Row[];
	const rows = flatten(requirementTree(app, from.id)).map((r) => ({
		...r,
		links: links
			.filter((l) => l.from_id === r.id || l.to_id === r.id)
			.map((l) => {
				const reverse = l.to_id === r.id;
				const other = getRequirement(app, String(reverse ? l.from_id : l.to_id));
				const type = l.type as LinkType;
				return {
					id: String(l.id),
					version: Number(l.current_version),
					type,
					label: reverse ? LINK_LABELS[type].backward : LINK_LABELS[type].forward,
					coverage: (l.coverage as string | null) ?? null,
					note: (l.note as string | null) ?? null,
					status: l.status === 'proposed' ? ('proposed' as const) : ('confirmed' as const),
					by: latestAuthorship(app, 'requirement_link', String(l.id))?.by ?? null,
					target: { id: other.id, refCode: other.refCode, title: other.title },
					reverse
				};
			})
	}));
	return {
		from,
		to,
		rows,
		mapped: rows.filter((r) => r.links.some((l) => l.status === 'confirmed')).length,
		proposed: rows.reduce((n, r) => n + r.links.filter((l) => l.status === 'proposed').length, 0)
	};
}

function linkRow(app: AppDatabase, id: string): Row {
	const row = readRow(app, linkDefinition, id);
	if (!row || Number(row.deleted) === 1) throw new NotFoundError('Link not found');
	sharedRequirement(app, String(row.from_id));
	sharedRequirement(app, String(row.to_id));
	return row;
}

export function acceptLink(app: AppDatabase, actor: Actor, id: string): void {
	requireHuman(actor, 'Confirming a proposed link');
	const row = linkRow(app, id);
	if (row.status !== 'confirmed')
		updateEntity(
			app,
			actor,
			linkDefinition,
			id,
			Number(row.current_version),
			{ status: 'confirmed' },
			'Accepted'
		);
}

export function rejectLink(app: AppDatabase, actor: Actor, id: string): void {
	requireHuman(actor, 'Rejecting a proposed link');
	const row = linkRow(app, id);
	deleteEntity(
		app,
		actor,
		linkDefinition,
		id,
		Number(row.current_version),
		row.status === 'proposed' ? 'Proposal rejected' : 'Link removed'
	);
}

/** Change a link's type, coverage or reason. A person's edit of a proposal keeps it proposed until accepted. */
export function editLink(
	app: AppDatabase,
	actor: Actor,
	id: string,
	baseVersion: number,
	input: { type?: string; coverage?: string | null; note?: string | null }
): void {
	linkRow(app, id);
	updateEntity(app, actor, linkDefinition, id, baseVersion, { ...input });
}

export function acceptAllLinks(
	app: AppDatabase,
	actor: Actor,
	fromSourceId: string,
	toSourceId: string
): number {
	requireHuman(actor, 'Confirming proposed links');
	return app.sqlite.transaction(() => {
		const ids = [
			...new Set(
				mappingOf(app, fromSourceId, toSourceId).rows.flatMap((r) =>
					r.links.filter((l) => l.status === 'proposed').map((l) => l.id)
				)
			)
		];
		for (const id of ids) acceptLink(app, actor, id);
		return ids.length;
	})();
}

/**
 * A person edits a proposed requirement before accepting it: reference, title, text and parent (by
 * reference in the same source). It stays proposed until accepted.
 */
export function editRequirement(
	app: AppDatabase,
	actor: Actor,
	id: string,
	baseVersion: number,
	input: { ref_code?: string; title?: string; text?: string | null; parent?: string | null }
): Requirement {
	const row = sharedRequirement(app, id);
	const data: Record<string, unknown> = {};
	if (input.ref_code !== undefined) data.ref_code = input.ref_code;
	if (input.title !== undefined) data.title = input.title;
	if (input.text !== undefined) data.text = input.text || null;
	if (input.parent !== undefined) {
		if (!input.parent) data.parent_id = null;
		else {
			const parent = app.sqlite
				.prepare('SELECT id FROM requirement WHERE source_id = ? AND ref_code = ? AND deleted = 0')
				.get(row.source_id, input.parent.trim()) as { id: string } | undefined;
			if (!parent)
				throw new ValidationError(`No requirement ${input.parent} in this source to be the parent.`, {
					parent: 'Not found'
				});
			data.parent_id = parent.id;
		}
	}
	updateEntity(app, actor, requirementDefinition, id, baseVersion, data);
	return getRequirement(app, id);
}

/** What the last confirmed version said, for showing an AI edit as a change. */
export function lastConfirmed(
	app: AppDatabase,
	id: string
): { title: string; text: string | null; refCode: string } | null {
	const revisions = app.sqlite
		.prepare(
			"SELECT snapshot FROM revision WHERE entity_type = 'requirement' AND entity_id = ? ORDER BY version DESC"
		)
		.all(id) as { snapshot: string }[];
	for (const r of revisions) {
		const snap = JSON.parse(r.snapshot) as Row;
		if (snap.status === 'confirmed')
			return {
				title: String(snap.title),
				text: (snap.text as string | null) ?? null,
				refCode: String(snap.ref_code)
			};
	}
	return null;
}
