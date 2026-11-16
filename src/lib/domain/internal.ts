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
import { findQuote, movedSection, sectionAt } from './text-match';
import { createEntity, deleteEntity, revertEntity, updateEntity, type Actor, type Row } from './write';

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
	/** After a new version of its document (#76): whether its quote was found in the new text. */
	recheck: 'unchanged' | 'needs_review' | null;
	/** For needs_review: the passage of the new text closest to the quote. */
	recheckPassage: string | null;
	/** For needs_review: what AI proposes after comparing with the new version, and why. */
	recheckProposal: 'update' | 'remove' | null;
	recheckReason: string | null;
	/** For a proposed change to a requirement that was accepted before: what was accepted. */
	previous: { title: string; text: string | null; quote: string | null; section: string | null } | null;
	version: number;
}

const str = (v: unknown) => (v == null ? '' : String(v)).trim();

function toInternal(
	app: AppDatabase,
	r: Row,
	engagementId: string | null,
	cache?: Map<string, ReturnType<typeof getRequirement>>
): InternalRequirement {
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
		implements: linksOf(app, String(r.id), cache).filter(
			(l) => l.type === 'implements' && l.direction === 'out'
		),
		recheck: (r.recheck as InternalRequirement['recheck']) ?? null,
		recheckPassage: (r.recheck_passage as string | null) ?? null,
		recheckProposal: (r.recheck_proposal as InternalRequirement['recheckProposal']) ?? null,
		recheckReason: (r.recheck_reason as string | null) ?? null,
		previous: r.status === 'proposed' ? previousAccepted(app, String(r.id)) : null,
		version: Number(r.current_version)
	};
}

/** The last accepted version of a requirement, read from its revisions; null when it was never accepted. */
function lastAcceptedRevision(
	app: AppDatabase,
	id: string,
	entityType = 'requirement'
): { version: number; snapshot: Row } | null {
	const revisions = app.sqlite
		.prepare(
			'SELECT version, snapshot FROM revision WHERE entity_type = ? AND entity_id = ? ORDER BY version DESC'
		)
		.all(entityType, id) as { version: number; snapshot: string }[];
	for (const r of revisions) {
		const snapshot = JSON.parse(r.snapshot) as Row;
		if (snapshot.status === 'confirmed' && Number(snapshot.deleted ?? 0) === 0)
			return { version: r.version, snapshot };
	}
	return null;
}

function previousAccepted(app: AppDatabase, id: string): InternalRequirement['previous'] {
	const last = lastAcceptedRevision(app, id);
	if (!last) return null;
	const s = last.snapshot;
	return {
		title: String(s.title),
		text: (s.text as string | null) ?? null,
		quote: (s.quote as string | null) ?? null,
		section: (s.locator as string | null) ?? null
	};
}

/**
 * Carried over: reviewed (not waiting for review after a new version), and the source's document has
 * no newer version in another engagement (that engagement copied its rules).
 */
const NEWEST = `coalesce(r.recheck, '') <> 'needs_review' AND NOT EXISTS (
	  SELECT 1 FROM artifact x JOIN engagement xe ON xe.id = x.engagement_id
	   WHERE x.supersedes_id = s.artifact_id AND x.deleted = 0 AND xe.deleted = 0
	     AND x.engagement_id IS NOT s.engagement_id)`;

const INT_SELECT = `SELECT r.*, s.title AS source_title, s.artifact_id, s.engagement_id AS source_engagement_id
	FROM requirement r JOIN source s ON s.id = r.source_id
	WHERE r.deleted = 0 AND s.deleted = 0 AND r.origin = 'internal'`;

/**
 * SQL for the rows an engagement works with (parameters: engagement id, carry-over 1 or 0): its own,
 * and with carry-over the accepted, reviewed ones of the auditee's other engagements, taken from the
 * newest version of each document. Where a later engagement received a new version of the document, its
 * copies are the ones carried over (#76).
 */
export const OWN_OR_CARRIED = `(s.engagement_id = ? OR (? AND r.status = 'confirmed' AND ${NEWEST}))`;

/**
 * The internal requirements an engagement works with: those extracted in it, plus, when carry-over
 * is on, those from the same auditee's earlier engagements. Never another auditee's.
 */
export function listInternal(app: AppDatabase, engagementId: string): InternalRequirement[] {
	const e = getEngagement(app, engagementId);
	const rows = app.sqlite
		.prepare(
			`${INT_SELECT} AND s.auditee_id = ? AND ${OWN_OR_CARRIED}
			 ORDER BY CAST(substr(r.ref_code, 5) AS INTEGER), r.ref_code`
		)
		.all(e.auditeeId, e.id, e.carryOverInternal ? 1 : 0) as Row[];
	const cache = new Map<string, ReturnType<typeof getRequirement>>();
	return rows.map((r) => toInternal(app, r, e.id, cache));
}

/** Internal requirements from this auditee's other engagements: what carry-over would bring in. */
export function carryOverCandidates(app: AppDatabase, engagementId: string): InternalRequirement[] {
	const e = getEngagement(app, engagementId);
	const rows = app.sqlite
		.prepare(
			`${INT_SELECT} AND s.auditee_id = ? AND (s.engagement_id IS NULL OR s.engagement_id <> ?)
			   AND r.status = 'confirmed' AND ${NEWEST}`
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
export function internalSource(
	app: AppDatabase,
	actor: Actor,
	e: Engagement,
	artifactId: string | null
): string {
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

/**
 * Reject a proposal, or remove an accepted requirement. A proposed change to a requirement that was
 * accepted before goes back to that accepted version (a new version; history stays), and implements
 * links proposed with the change go with it. A requirement that was never accepted is removed.
 */
export function rejectInternal(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string
): 'restored' | 'removed' {
	const r = getInternal(app, engagementId, id);
	if (r.carriedOver)
		throw new ValidationError(
			'This requirement comes from an earlier engagement; switch carry-over off instead.'
		);
	const last = r.status === 'proposed' ? lastAcceptedRevision(app, id) : null;
	return app.sqlite.transaction(() => {
		if (!last) {
			deleteEntity(
				app,
				actor,
				requirementDefinition,
				id,
				r.version,
				r.status === 'proposed' ? 'Proposal rejected' : 'Removed'
			);
			return 'removed' as const;
		}
		revertEntity(app, actor, requirementDefinition, id, r.version, last.version, 'Change rejected');
		for (const l of r.implements.filter((x) => x.status === 'proposed')) {
			const before = lastAcceptedRevision(app, l.id, 'requirement_link');
			if (before)
				revertEntity(app, actor, linkDefinition, l.id, l.version, before.version, 'Change rejected');
			else deleteEntity(app, actor, linkDefinition, l.id, l.version, 'Rejected with the change');
		}
		return 'restored' as const;
	})();
}

/**
 * Keep a requirement that needs review after a new version of its document: as it is, or with the
 * closest passage of the new text as its quote. Keeping is a person's decision and accepts it.
 */
export function keepInternal(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string,
	options: { useNewPassage?: boolean } = {}
): InternalRequirement {
	requireHuman(actor, 'Keeping an internal requirement after a new version');
	const r = getInternal(app, engagementId, id);
	if (r.recheck !== 'needs_review') throw new ValidationError('This requirement does not need review.');
	if (r.recheckProposal) throw new ValidationError(`Accept or reject the proposal for ${r.refCode} first.`);
	if (options.useNewPassage && !r.recheckPassage)
		throw new ValidationError('No close passage was found in the new version; edit the quote instead.');
	// With the new passage as its quote, the section is where that passage sits in the new text.
	let section: string | null = null;
	if (options.useNewPassage && r.artifactId) {
		const text = (
			app.sqlite.prepare('SELECT text FROM artifact_text WHERE artifact_id = ?').get(r.artifactId) as
				{ text: string } | undefined
		)?.text;
		const at = text ? findQuote(text, r.recheckPassage!) : null;
		section = at ? movedSection(r.section, sectionAt(text!, at.start)) : null;
	}
	updateEntity(
		app,
		actor,
		requirementDefinition,
		id,
		r.version,
		{
			recheck: null,
			recheck_passage: null,
			recheck_proposal: null,
			recheck_reason: null,
			status: 'confirmed',
			...(options.useNewPassage ? { quote: r.recheckPassage } : {}),
			...(section ? { locator: section } : {})
		},
		options.useNewPassage ? 'Kept with the passage from the new version' : 'Kept after the new version'
	);
	return getInternal(app, engagementId, id);
}

/** Remove a requirement that needs review: the new version no longer has it. */
export function removeAfterRecheck(app: AppDatabase, actor: Actor, engagementId: string, id: string): void {
	const r = getInternal(app, engagementId, id);
	if (r.recheck !== 'needs_review') throw new ValidationError('This requirement does not need review.');
	deleteEntity(app, actor, requirementDefinition, id, r.version, 'Removed: not in the new version');
}

/**
 * AI's verdict on a requirement that needs review after a new version (#76): an update (new wording,
 * quote and section from the new text) or a removal, with the reason. Stored as a proposal on the
 * requirement; the auditor accepts or rejects it. A quote must be found in the new version.
 */
export function proposeRecheck(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string,
	input: {
		action: 'update' | 'remove';
		reason: string;
		title?: string;
		text?: string | null;
		quote?: string | null;
		section?: string | null;
	}
): InternalRequirement {
	const r = getInternal(app, engagementId, id);
	if (r.carriedOver)
		throw new ValidationError(`${r.refCode} comes from an earlier engagement; it is not rechecked here.`);
	if (r.recheck !== 'needs_review')
		throw new ValidationError(`${r.refCode} does not need review after a new version.`);
	const reason = str(input.reason);
	if (!reason) throw new ValidationError('Say why, citing the new version.', { reason: 'Required' });
	const patch: Row = { status: 'proposed', recheck_proposal: input.action, recheck_reason: reason };
	if (input.action === 'update') {
		const text = r.artifactId
			? ((
					app.sqlite.prepare('SELECT text FROM artifact_text WHERE artifact_id = ?').get(r.artifactId) as
						{ text: string } | undefined
				)?.text ?? '')
			: '';
		if (input.title !== undefined) patch.title = input.title;
		if (input.text !== undefined) patch.text = input.text;
		if (input.quote) {
			const at = findQuote(text, input.quote);
			if (!at)
				throw new ValidationError(
					`The quote for ${r.refCode} is not in the new version; quote its words exactly.`
				);
			patch.quote = input.quote;
			patch.locator = input.section || movedSection(r.section, sectionAt(text, at.start)) || r.section;
		} else if (input.section !== undefined) patch.locator = input.section;
		if (!('title' in patch || 'text' in patch || 'quote' in patch || 'locator' in patch))
			throw new ValidationError(`Give the new wording, quote or section for ${r.refCode}.`);
	}
	updateEntity(app, actor, requirementDefinition, id, r.version, patch);
	return getInternal(app, engagementId, id);
}

/** Accept AI's recheck proposal: the update becomes the accepted requirement, or the removal is made. */
export function acceptRecheckProposal(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string
): 'updated' | 'removed' {
	requireHuman(actor, 'Accepting a recheck proposal');
	const r = getInternal(app, engagementId, id);
	if (!r.recheckProposal) throw new ValidationError(`There is no proposal for ${r.refCode}.`);
	return app.sqlite.transaction(() => {
		if (r.recheckProposal === 'remove') {
			deleteEntity(
				app,
				actor,
				requirementDefinition,
				id,
				r.version,
				`Removed after the new version: ${r.recheckReason ?? ''}`.trim()
			);
			return 'removed' as const;
		}
		updateEntity(
			app,
			actor,
			requirementDefinition,
			id,
			r.version,
			{
				status: 'confirmed',
				recheck: null,
				recheck_passage: null,
				recheck_proposal: null,
				recheck_reason: null
			},
			'Update after the new version accepted'
		);
		return 'updated' as const;
	})();
}

/** Reject AI's recheck proposal: the requirement goes back to how it was, still needing review. */
export function rejectRecheckProposal(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string
): void {
	requireHuman(actor, 'Rejecting a recheck proposal');
	const r = getInternal(app, engagementId, id);
	if (!r.recheckProposal) throw new ValidationError(`There is no proposal for ${r.refCode}.`);
	const before = (
		app.sqlite
			.prepare(
				`SELECT version, snapshot FROM revision WHERE entity_type = 'requirement' AND entity_id = ? AND version < ?
				  ORDER BY version DESC`
			)
			.all(id, r.version) as { version: number; snapshot: string }[]
	).find((x) => !(JSON.parse(x.snapshot) as Row).recheck_proposal);
	if (!before) throw new ValidationError(`${r.refCode} has no version from before the proposal.`);
	revertEntity(
		app,
		actor,
		requirementDefinition,
		id,
		r.version,
		before.version,
		'Proposal rejected; needs review'
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
