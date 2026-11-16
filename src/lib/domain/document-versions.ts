import type { AppDatabase } from '#lib/db/client.ts';
import {
	assertReplaceable,
	carriedOverArtifact,
	getArtifact,
	getEngagementArtifact,
	registerTextArtifact,
	sha256,
	uploadArtifacts,
	type Artifact,
	type UploadFile
} from './artifacts';
import { getEngagement } from './engagements';
import { ValidationError } from './errors';
import { internalSource, listInternal } from './internal';
import { addLink, linksOf, requirementDefinition, sourceDefinition } from './library';
import {
	closestPassage,
	findQuote,
	headings,
	movedSection,
	sectionAt,
	uncoveredSections,
	type Heading
} from './text-match';
import { createEntity, updateEntity, type Actor, type Row } from './write';

/**
 * New versions of an auditee document (#76). The auditor names the document a file replaces; the
 * internal requirements taken from the old version move to the new one and are checked against its
 * text without AI: a requirement whose quote is still there is unchanged, any other needs review.
 */

export interface RecheckSummary {
	unchanged: number;
	needsReview: number;
}

function fullText(app: AppDatabase, artifactId: string): string | null {
	const row = app.sqlite.prepare('SELECT text FROM artifact_text WHERE artifact_id = ?').get(artifactId) as
		{ text: string } | undefined;
	return row?.text ?? null;
}

/** How a requirement's quote fares in the new text: the columns to write and the revision note. */
function checkAgainst(text: string, r: Row, name: string): { patch: Row; note: string; unchanged: boolean } {
	const quote = (r.quote as string | null) ?? '';
	const at = quote && text ? findQuote(text, quote) : null;
	if (at) {
		const old = (r.locator as string | null) ?? null;
		const section = movedSection(old, sectionAt(text, at.start));
		return {
			patch: { recheck: 'unchanged', recheck_passage: null, ...(section ? { locator: section } : {}) },
			note: `Quote found unchanged in ${name}${section ? `; section ${old ?? '(none)'} → ${section}` : ''}`,
			unchanged: true
		};
	}
	const near = text ? closestPassage(text, quote || String(r.text ?? '') || String(r.title)) : null;
	return {
		patch: { recheck: 'needs_review', recheck_passage: near?.passage ?? null },
		note: quote ? `Quote not found in ${name}` : `No quote to check against ${name}`,
		unchanged: false
	};
}

/**
 * Move the internal requirements of the replaced document to its new version and check each quote
 * against the new text. Runs as the actor who added the version: when that is AI, every change is a
 * proposal for the auditor (CLAUDE.md rule 2).
 *
 * When the replaced document belongs to an earlier engagement (its requirements are carried over),
 * that engagement's records stay as they were: the accepted requirements are copied into this
 * engagement under the same INT codes, checked against the new text, and from then on carry-over
 * takes these copies, the newest version.
 */
export function recheckInternal(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	newArtifactId: string
): RecheckSummary {
	const e = getEngagement(app, engagementId);
	const now = getEngagementArtifact(app, e.id, newArtifactId);
	if (!now.supersedesId) throw new ValidationError('This document does not replace another one.');
	const summary: RecheckSummary = { unchanged: 0, needsReview: 0 };
	const source = app.sqlite
		.prepare(
			'SELECT id, current_version FROM source WHERE deleted = 0 AND engagement_id = ? AND artifact_id = ?'
		)
		.get(e.id, now.supersedesId) as { id: string; current_version: number } | undefined;
	const text = fullText(app, now.id) ?? '';
	const name = now.displayName;
	if (!source) return carryForward(app, actor, e.id, now, text);
	return app.sqlite.transaction(() => {
		updateEntity(
			app,
			actor,
			sourceDefinition,
			source.id,
			source.current_version,
			{ artifact_id: now.id, title: name },
			`Moved to the new version ${name}`
		);
		const rows = app.sqlite
			.prepare('SELECT * FROM requirement WHERE source_id = ? AND deleted = 0')
			.all(source.id) as Row[];
		for (const r of rows) {
			const check = checkAgainst(text, r, name);
			updateEntity(
				app,
				actor,
				requirementDefinition,
				String(r.id),
				Number(r.current_version),
				check.patch,
				check.note
			);
			if (check.unchanged) summary.unchanged++;
			else summary.needsReview++;
		}
		return summary;
	})();
}

/** A new version, here, of a document of an earlier engagement: copy its accepted rules and check them. */
function carryForward(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	now: Artifact,
	text: string
): RecheckSummary {
	const summary: RecheckSummary = { unchanged: 0, needsReview: 0 };
	const e = getEngagement(app, engagementId);
	const earlier = app.sqlite
		.prepare(
			`SELECT s.id, coalesce(en.name, 'an earlier engagement') AS engagement_name FROM source s
			   LEFT JOIN engagement en ON en.id = s.engagement_id
			  WHERE s.deleted = 0 AND s.type = 'internal' AND s.auditee_id = ? AND s.artifact_id = ?
			    AND s.engagement_id IS NOT ?`
		)
		.all(e.auditeeId, now.supersedesId, e.id) as { id: string; engagement_name: string }[];
	if (!earlier.length) return summary;
	const human = actor.channel === 'ui' && !actor.agent;
	const name = now.displayName;
	return app.sqlite.transaction(() => {
		const sourceId = internalSource(app, actor, e, now.id);
		for (const src of earlier) {
			const rows = app.sqlite
				.prepare(
					`SELECT * FROM requirement WHERE source_id = ? AND deleted = 0 AND status = 'confirmed'
					  ORDER BY CAST(substr(ref_code, 5) AS INTEGER), ref_code`
				)
				.all(src.id) as Row[];
			for (const r of rows) {
				const check = checkAgainst(text, r, name);
				const copy = createEntity(
					app,
					actor,
					requirementDefinition,
					{
						source_id: sourceId,
						ref_code: r.ref_code,
						title: r.title,
						text: r.text,
						quote: r.quote,
						locator: r.locator,
						language: r.language,
						origin: 'internal',
						status: human ? 'confirmed' : 'proposed',
						...check.patch
					},
					{ note: `Carried over from ${src.engagement_name} to the new version: ${check.note}` }
				).row;
				for (const l of linksOf(app, String(r.id)).filter(
					(x) => x.type === 'implements' && x.direction === 'out' && x.status === 'confirmed'
				))
					addLink(app, actor, {
						fromId: String(copy.id),
						toId: l.other.id,
						type: 'implements',
						coverage: l.coverage === 'full' ? 'full' : 'partial',
						note: l.note ?? null
					});
				if (check.unchanged) summary.unchanged++;
				else summary.needsReview++;
			}
		}
		return summary;
	})();
}

/**
 * The documents of earlier engagements whose accepted internal requirements this engagement carries
 * over, so the auditor can upload their new versions here (#76).
 */
export interface CarriedDocument {
	id: string;
	name: string;
	engagementName: string;
	requirements: number;
}

export function carriedOverDocuments(app: AppDatabase, engagementId: string): CarriedDocument[] {
	const byDoc = new Map<string, number>();
	for (const r of listInternal(app, engagementId))
		if (r.carriedOver && r.artifactId) byDoc.set(r.artifactId, (byDoc.get(r.artifactId) ?? 0) + 1);
	return [...byDoc].map(([id, n]) => {
		const a = getArtifact(app, id);
		const en = app.sqlite
			.prepare('SELECT e.name FROM artifact a JOIN engagement e ON e.id = a.engagement_id WHERE a.id = ?')
			.get(id) as { name: string } | undefined;
		return { id, name: a.displayName, engagementName: en?.name ?? 'an earlier engagement', requirements: n };
	});
}

/** Upload a new version of a document, then recheck the internal requirements taken from the old one. */
export async function uploadNewVersion(
	app: AppDatabase,
	actor: Actor,
	filesDir: string,
	engagementId: string,
	oldId: string,
	file: UploadFile
): Promise<{ artifact: Artifact; recheck: RecheckSummary }> {
	if (!file.bytes.length) throw new ValidationError('The file is empty.');
	const old = assertReplaceable(app, engagementId, oldId, sha256(file.bytes));
	const sameEngagement = !carriedOverArtifact(app, engagementId, old.id);
	const [r] = await uploadArtifacts(app, actor, filesDir, engagementId, [file], {
		kind: old.kind,
		language: old.language,
		supersedesId: old.id,
		// An event of an earlier engagement means nothing here.
		eventId: sameEngagement ? old.eventId : null
	});
	if (!r?.artifact) throw new ValidationError(r?.error ?? 'The file could not be added.');
	const recheck = recheckInternal(app, actor, engagementId, r.artifact.id);
	return { artifact: getEngagementArtifact(app, engagementId, r.artifact.id), recheck };
}

/** register_artifact with `replaces`: store the text as the new version, then recheck. */
export function registerNewTextVersion(
	app: AppDatabase,
	actor: Actor,
	filesDir: string,
	engagementId: string,
	input: Parameters<typeof registerTextArtifact>[4] & { supersedesId: string }
): { artifact: Artifact; recheck: RecheckSummary } {
	return app.sqlite.transaction(() => {
		const artifact = registerTextArtifact(app, actor, filesDir, engagementId, input);
		return { artifact, recheck: recheckInternal(app, actor, engagementId, artifact.id) };
	})();
}

/**
 * For AI's recheck (#76): each requirement that needs review after a new version, with its old quote
 * where it stood in the previous version and the closest passage where it stands in the new one, so
 * the model can compare without reading both documents whole.
 */
export interface RecheckItem {
	id: string;
	ref: string;
	title: string;
	text: string | null;
	quote: string | null;
	section: string | null;
	document: { id: string; title: string } | null;
	previousDocument: { id: string; title: string } | null;
	/** The old quote with the text around it in the previous version, when it can be found there. */
	previousContext: string | null;
	closestPassage: string | null;
	closestSection: string | null;
	/** The closest passage with the text around it in the new version. */
	newContext: string | null;
	proposal: { action: 'update' | 'remove'; reason: string | null } | null;
	version: number;
}

const AROUND = 600;
function around(text: string, start: number, end: number): string {
	const from = Math.max(0, start - AROUND);
	const to = Math.min(text.length, end + AROUND);
	return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

export function recheckComparison(
	app: AppDatabase,
	engagementId: string,
	options: { artifactId?: string } = {}
): RecheckItem[] {
	const texts = new Map<string, string>();
	const textOf = (id: string) => {
		if (!texts.has(id)) texts.set(id, fullText(app, id) ?? '');
		return texts.get(id)!;
	};
	return listInternal(app, engagementId)
		.filter(
			(r) =>
				r.recheck === 'needs_review' &&
				!r.carriedOver &&
				(!options.artifactId || r.artifactId === options.artifactId)
		)
		.map((r) => {
			const doc = r.artifactId ? getArtifact(app, r.artifactId) : null;
			const prev = doc?.supersedesId ? getArtifact(app, doc.supersedesId) : null;
			const oldText = prev ? textOf(prev.id) : '';
			const at = r.quote && oldText ? findQuote(oldText, r.quote) : null;
			const newText = doc ? textOf(doc.id) : '';
			const near = r.recheckPassage && newText ? findQuote(newText, r.recheckPassage) : null;
			return {
				id: r.id,
				ref: r.refCode,
				title: r.title,
				text: r.text,
				quote: r.quote,
				section: r.section,
				document: doc ? { id: doc.id, title: doc.displayName } : null,
				previousDocument: prev ? { id: prev.id, title: prev.displayName } : null,
				previousContext: at ? around(oldText, at.start, at.end) : null,
				closestPassage: r.recheckPassage,
				closestSection: near ? (sectionAt(newText, near.start) ?? null) : null,
				newContext: near ? around(newText, near.start, near.end) : null,
				proposal: r.recheckProposal ? { action: r.recheckProposal, reason: r.recheckReason } : null,
				version: r.version
			};
		});
}

/**
 * The new versions whose internal requirements still need review, for the banner on Documents:
 * "3 internal requirements need review after a new version of X".
 */
export function versionsNeedingReview(
	app: AppDatabase,
	engagementId: string
): { artifactId: string; name: string; previousName: string | null; count: number; proposals: number }[] {
	const out = new Map<string, { count: number; proposals: number }>();
	for (const r of listInternal(app, engagementId))
		if (r.recheck === 'needs_review' && !r.carriedOver && r.artifactId) {
			const v = out.get(r.artifactId) ?? { count: 0, proposals: 0 };
			v.count++;
			if (r.recheckProposal) v.proposals++;
			out.set(r.artifactId, v);
		}
	return [...out].map(([id, v]) => {
		const a = getArtifact(app, id);
		return {
			artifactId: id,
			name: a.displayName,
			previousName: a.supersedesId ? getArtifact(app, a.supersedesId).displayName : null,
			...v
		};
	});
}

/** "3 internal requirements unchanged, 1 needs review." or null when there were none. */
export function recheckMessage(r: RecheckSummary): string | null {
	const total = r.unchanged + r.needsReview;
	if (!total) return null;
	const parts = [
		r.unchanged ? `${r.unchanged} unchanged` : null,
		r.needsReview ? `${r.needsReview} ${r.needsReview === 1 ? 'needs' : 'need'} review` : null
	].filter(Boolean);
	return `Internal requirements checked against it: ${parts.join(', ')}.`;
}

/**
 * For each document that replaces another: the numbered sections of its text that no internal
 * requirement falls under, as candidates for extraction.
 */
export function sectionsWithoutRequirements(app: AppDatabase, engagementId: string): Map<string, Heading[]> {
	const out = new Map<string, Heading[]>();
	const versions = app.sqlite
		.prepare(
			`SELECT a.id FROM artifact a JOIN artifact_text t ON t.artifact_id = a.id
			  WHERE a.engagement_id = ? AND a.deleted = 0 AND a.supersedes_id IS NOT NULL`
		)
		.all(engagementId) as { id: string }[];
	if (!versions.length) return out;
	const internal = listInternal(app, engagementId);
	for (const v of versions) {
		const text = fullText(app, v.id) ?? '';
		const sections = internal.filter((r) => r.artifactId === v.id).map((r) => r.section);
		const open = uncoveredSections(headings(text), sections);
		if (open.length) out.set(v.id, open);
	}
	return out;
}
