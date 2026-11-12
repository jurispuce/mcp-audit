import { randomBytes } from 'node:crypto';
import type { AppDatabase } from '#lib/db/client.ts';
import { getArtifact } from './artifacts';
import { getEngagement, type Engagement } from './engagements';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { requireHuman } from './guards';
import {
	addLink,
	getRequirement,
	linkDefinition,
	linksOf,
	normalizeLanguage,
	requirementDefinition,
	sourceDefinition,
	type LinkView
} from './library';
import { createEntity, deleteEntity, updateEntity, type Actor, type Row } from './write';

/**
 * Internal requirements: rules the auditee wrote for itself, extracted from its own documents
 * (policies, procedures). Each document becomes an internal source owned by the auditee; requirements
 * in it carry a quote in the original language, a section and implements links to external
 * requirements. They never cross to another auditee (CLAUDE.md rule 5).
 */

export interface InternalRequirement {
	id: string;
	refCode: string;
	title: string;
	text: string | null;
	quote: string | null;
	section: string | null;
	language: string;
	status: 'proposed' | 'confirmed';
	sourceId: string;
	sourceTitle: string;
	artifactId: string | null;
	engagementId: string | null;
	/** True when it comes from an earlier engagement of the same auditee. */
	carriedOver: boolean;
	implements: LinkView[];
	version: number;
}

const str = (v: unknown) => (v == null ? '' : String(v)).trim();

function toInternal(app: AppDatabase, r: Row, engagementId: string | null): InternalRequirement {
	return {
		id: String(r.id),
		refCode: String(r.ref_code),
		title: String(r.title),
		text: (r.text as string | null) ?? null,
		quote: (r.quote as string | null) ?? null,
		section: (r.locator as string | null) ?? null,
		language: String(r.language),
		status: r.status === 'proposed' ? 'proposed' : 'confirmed',
		sourceId: String(r.source_id),
		sourceTitle: String(r.source_title),
		artifactId: (r.artifact_id as string | null) ?? null,
		engagementId: (r.source_engagement_id as string | null) ?? null,
		carriedOver: !!engagementId && r.source_engagement_id !== engagementId,
		implements: linksOf(app, String(r.id)).filter((l) => l.type === 'implements' && l.direction === 'out'),
		version: Number(r.current_version)
	};
}

const INT_SELECT = `SELECT r.*, s.title AS source_title, s.artifact_id, s.engagement_id AS source_engagement_id
	FROM requirement r JOIN source s ON s.id = r.source_id
	WHERE r.deleted = 0 AND s.deleted = 0 AND r.origin = 'internal'`;

/**
 * The internal requirements an engagement works with: those extracted in it, plus, when carry-over
 * is on, those from the same auditee's earlier engagements. Never another auditee's.
 */
export function listInternal(app: AppDatabase, engagementId: string): InternalRequirement[] {
	const e = getEngagement(app, engagementId);
	const rows = app.sqlite
		.prepare(
			`${INT_SELECT} AND s.auditee_id = ? AND (s.engagement_id = ? OR ?)
			 ORDER BY CAST(substr(r.ref_code, 5) AS INTEGER), r.ref_code`
		)
		.all(e.auditeeId, e.id, e.carryOverInternal ? 1 : 0) as Row[];
	return rows.map((r) => toInternal(app, r, e.id));
}

/** Internal requirements from this auditee's other engagements: what carry-over would bring in. */
export function carryOverCandidates(app: AppDatabase, engagementId: string): InternalRequirement[] {
	const e = getEngagement(app, engagementId);
	const rows = app.sqlite
		.prepare(
			`${INT_SELECT} AND s.auditee_id = ? AND (s.engagement_id IS NULL OR s.engagement_id <> ?) AND r.status = 'confirmed'`
		)
		.all(e.auditeeId, e.id) as Row[];
	return rows.map((r) => toInternal(app, r, e.id));
}

/**
 * Read one internal requirement from inside an engagement. The domain refuses a requirement of another
 * auditee outright, whoever asks.
 */
export function getInternal(app: AppDatabase, engagementId: string, id: string): InternalRequirement {
	const e = getEngagement(app, engagementId);
	const row = app.sqlite
		.prepare(`${INT_SELECT.replace('WHERE r.deleted = 0 AND s.deleted = 0 AND', 'WHERE')} AND r.id = ?`)
		.get(id) as (Row & { deleted: number }) | undefined;
	if (!row) throw new NotFoundError('Internal requirement not found');
	const owner = app.sqlite.prepare('SELECT auditee_id FROM source WHERE id = ?').get(row.source_id) as {
		auditee_id: string | null;
	};
	if (owner.auditee_id !== e.auditeeId)
		throw new ForbiddenError('This requirement belongs to another auditee and cannot be read here.');
	if (Number(row.deleted) === 1) throw new NotFoundError('Internal requirement not found');
	return toInternal(app, row, e.id);
}

/** The internal source for one auditee document in this engagement, created on first use. */
function internalSource(app: AppDatabase, actor: Actor, e: Engagement, artifactId: string | null): string {
	const existing = app.sqlite
		.prepare(
			`SELECT id FROM source WHERE deleted = 0 AND auditee_id = ? AND engagement_id = ? AND artifact_id IS ?`
		)
		.get(e.auditeeId, e.id, artifactId) as { id: string } | undefined;
	if (existing) return existing.id;
	let title = 'Added by hand';
	let language = e.workingLanguage;
	if (artifactId) {
		const a = getArtifact(app, artifactId);
		if (a.fileHash == null && a.state !== 'mentioned') throw new ValidationError('Choose a document.');
		const engagementOfArtifact = app.sqlite
			.prepare('SELECT engagement_id FROM artifact WHERE id = ?')
			.get(artifactId) as {
			engagement_id: string;
		};
		if (engagementOfArtifact.engagement_id !== e.id) throw new NotFoundError('Document not found');
		title = a.displayName;
		language = a.language ?? language;
	}
	return String(
		createEntity(app, actor, sourceDefinition, {
			code: `int-${randomBytes(5).toString('hex')}`,
			type: 'internal',
			title,
			language: normalizeLanguage(language),
			auditee_id: e.auditeeId,
			artifact_id: artifactId,
			engagement_id: e.id
		}).row.id
	);
}

/** Next INT-n code for the auditee: numbers keep going across engagements so a code is never reused. */
function nextCode(app: AppDatabase, auditeeId: string): string {
	const row = app.sqlite
		.prepare(
			`SELECT max(CAST(substr(r.ref_code, 5) AS INTEGER)) AS n FROM requirement r JOIN source s ON s.id = r.source_id
			  WHERE s.auditee_id = ? AND r.ref_code LIKE 'INT-%'`
		)
		.get(auditeeId) as { n: number | null };
	return `INT-${(row.n ?? 0) + 1}`;
}

export interface InternalInput {
	title: string;
	text?: string | null;
	quote?: string | null;
	section?: string | null;
	language?: string | null;
	artifactId?: string | null;
	/** External requirements this one implements, each with full or partial coverage. */
	implements?: { requirementId: string; coverage: 'full' | 'partial'; note?: string | null }[];
}

/**
 * Add an internal requirement. A person adding by hand creates it confirmed; AI always proposes
 * (the write path forces status to proposed).
 */
export function addInternal(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	input: InternalInput
): InternalRequirement {
	const e = getEngagement(app, engagementId);
	if (!str(input.title))
		throw new ValidationError('Give the requirement a short title.', { title: 'Required' });
	return app.sqlite.transaction(() => {
		const sourceId = internalSource(app, actor, e, input.artifactId ?? null);
		const human = actor.channel === 'ui' && !actor.agent;
		const row = createEntity(app, actor, requirementDefinition, {
			source_id: sourceId,
			ref_code: nextCode(app, e.auditeeId),
			title: input.title,
			text: input.text ?? null,
			quote: input.quote ?? null,
			locator: input.section ?? null,
			language: normalizeLanguage(input.language || e.workingLanguage),
			origin: 'internal',
			status: human ? 'confirmed' : 'proposed'
		}).row;
		for (const link of input.implements ?? []) setImplements(app, actor, engagementId, String(row.id), link);
		return getInternal(app, engagementId, String(row.id));
	})();
}

export function updateInternal(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string,
	baseVersion: number,
	input: Partial<{
		title: string;
		text: string | null;
		quote: string | null;
		section: string | null;
		language: string;
	}>
): InternalRequirement {
	getInternal(app, engagementId, id);
	const patch: Row = {};
	for (const [k, v] of Object.entries(input)) patch[k === 'section' ? 'locator' : k] = v ?? null;
	updateEntity(app, actor, requirementDefinition, id, baseVersion, patch);
	return getInternal(app, engagementId, id);
}

/** Add an implements link from an internal requirement to an external one, or change its coverage. */
export function setImplements(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	internalId: string,
	link: { requirementId: string; coverage: 'full' | 'partial'; note?: string | null }
): void {
	const own = getInternal(app, engagementId, internalId);
	const target = getRequirement(app, link.requirementId);
	if (target.origin === 'internal')
		throw new ValidationError(
			'An internal requirement implements an external one, such as a law or standard.'
		);
	const existing = own.implements.find((l) => l.other.id === target.id);
	if (existing) {
		if (existing.coverage !== link.coverage || (link.note !== undefined && existing.note !== link.note)) {
			updateEntity(app, actor, linkDefinition, existing.id, existing.version, {
				coverage: link.coverage,
				...(link.note !== undefined ? { note: link.note } : {})
			});
		}
		return;
	}
	addLink(app, actor, {
		fromId: internalId,
		toId: target.id,
		type: 'implements',
		coverage: link.coverage,
		note: link.note ?? null
	});
}

/** Accepting a proposed internal requirement is a judgement: people only. */
export function acceptInternal(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string
): InternalRequirement {
	requireHuman(actor, 'Accepting a proposed internal requirement');
	const r = getInternal(app, engagementId, id);
	if (r.status === 'confirmed' && r.implements.every((l) => l.status === 'confirmed')) return r;
	app.sqlite.transaction(() => {
		if (r.status !== 'confirmed')
			updateEntity(app, actor, requirementDefinition, id, r.version, { status: 'confirmed' }, 'Accepted');
		// What it implements was proposed with it; accepting the rule accepts those links.
		for (const l of r.implements.filter((x) => x.status === 'proposed'))
			updateEntity(
				app,
				actor,
				linkDefinition,
				l.id,
				l.version,
				{ status: 'confirmed' },
				'Accepted with its internal requirement'
			);
	})();
	return getInternal(app, engagementId, id);
}

export function rejectInternal(app: AppDatabase, actor: Actor, engagementId: string, id: string): void {
	const r = getInternal(app, engagementId, id);
	if (r.carriedOver)
		throw new ValidationError(
			'This requirement comes from an earlier engagement; switch carry-over off instead.'
		);
	deleteEntity(
		app,
		actor,
		requirementDefinition,
		id,
		r.version,
		r.status === 'proposed' ? 'Proposal rejected' : 'Removed'
	);
}

export function acceptAllInternal(app: AppDatabase, actor: Actor, engagementId: string): number {
	requireHuman(actor, 'Accepting proposed internal requirements');
	return app.sqlite.transaction(() => {
		const proposed = listInternal(app, engagementId).filter((r) => r.status === 'proposed' && !r.carriedOver);
		for (const r of proposed) acceptInternal(app, actor, engagementId, r.id);
		return proposed.length;
	})();
}
