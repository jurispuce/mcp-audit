import type { AppDatabase } from '#lib/db/client.ts';
import {
	assertReplaceable,
	getEngagementArtifact,
	registerTextArtifact,
	sha256,
	uploadArtifacts,
	type Artifact,
	type UploadFile
} from './artifacts';
import { getEngagement } from './engagements';
import { ValidationError } from './errors';
import { listInternal } from './internal';
import { requirementDefinition, sourceDefinition } from './library';
import {
	closestPassage,
	findQuote,
	headings,
	movedSection,
	sectionAt,
	uncoveredSections,
	type Heading
} from './text-match';
import { updateEntity, type Actor, type Row } from './write';

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

/**
 * Move the internal requirements of the replaced document to its new version and check each quote
 * against the new text. Runs as the actor who added the version: when that is AI, every change is a
 * proposal for the auditor (CLAUDE.md rule 2).
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
	if (!source) return summary;
	const text = fullText(app, now.id) ?? '';
	const name = now.displayName;
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
			const quote = (r.quote as string | null) ?? '';
			const at = quote && text ? findQuote(text, quote) : null;
			if (at) {
				const old = (r.locator as string | null) ?? null;
				const section = movedSection(old, sectionAt(text, at.start));
				updateEntity(
					app,
					actor,
					requirementDefinition,
					String(r.id),
					Number(r.current_version),
					{ recheck: 'unchanged', recheck_passage: null, ...(section ? { locator: section } : {}) },
					`Quote found unchanged in ${name}${section ? `; section ${old ?? '(none)'} → ${section}` : ''}`
				);
				summary.unchanged++;
			} else {
				const near = text ? closestPassage(text, quote || String(r.text ?? '') || String(r.title)) : null;
				updateEntity(
					app,
					actor,
					requirementDefinition,
					String(r.id),
					Number(r.current_version),
					{ recheck: 'needs_review', recheck_passage: near?.passage ?? null },
					quote ? `Quote not found in ${name}` : `No quote to check against ${name}`
				);
				summary.needsReview++;
			}
		}
		return summary;
	})();
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
	const [r] = await uploadArtifacts(app, actor, filesDir, engagementId, [file], {
		kind: old.kind,
		language: old.language,
		supersedesId: old.id,
		eventId: old.eventId
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
