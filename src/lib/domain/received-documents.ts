import type { AppDatabase } from '#lib/db/client.ts';
import { listArtifacts, type Artifact } from './artifacts';
import { getEngagement } from './engagements';
import { evidenceLinkDefinition, listLinks } from './execution';
import { listInternal } from './internal';
import { listEvidence, type EvidenceItem } from './planning';
import { createEntity, type Actor } from './write';

/**
 * Documents already received count before the meeting (#83). For planned evidence of kind "rule" (the
 * documented rule exists and is approved), propose a link to the received document that holds it:
 * - from internal requirements: the item's requirements are implemented by confirmed internal
 *   requirements taken from that document, so the link points at their sections;
 * - by name: the item asks for the document itself ("Approved ISMS scope…"), so the whole document.
 * Links are proposals for the auditor; nothing is confirmed silently. No AI involved.
 */

export interface ReceivedLinkCandidate {
	evidenceItemId: string;
	evidenceText: string;
	eventId: string;
	artifactId: string;
	artifactName: string;
	/** "§ 4.1, 4.2" from internal requirements, or null for the whole document. */
	locator: string | null;
	why: 'internal_requirements' | 'document_name';
}

const NUM = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** The name a document goes by: its title, else the file name without company prefix and extension. */
function documentNames(a: Artifact): string[] {
	const names = new Set<string>();
	for (const raw of [a.title, a.filename]) {
		if (!raw) continue;
		const base = raw
			.replace(/(\.(pdf|docx?|xlsx?|md|txt|csv))+$/i, '')
			// Version and year marks: "v2", "v.1.1", "version 3", "(2022)", "1.1".
			.replace(/\b(?:v|ver|version)\.?\s*\d+(?:\.\d+)*\b/gi, '')
			.replace(/\(\s*\d{4}\s*\)/g, '')
			.replace(/\b\d+(?:\.\d+)+\b/g, '')
			.replace(/\s{2,}/g, ' ')
			.trim();
		// "PEAK DEFENCE - ISMS Scope" names the document "ISMS Scope".
		const last = base
			.split(/\s+[-–—]\s+/)
			.at(-1)!
			.trim();
		for (const n of [base, last]) if (n.length >= 6) names.add(n.toLowerCase().replace(/\s+/g, ' '));
	}
	if (a.kind === 'statement_of_applicability') names.add('statement of applicability');
	return [...names];
}

export function receivedDocumentCandidates(
	app: AppDatabase,
	engagementId: string,
	options: { eventId?: string } = {}
): ReceivedLinkCandidate[] {
	const e = getEngagement(app, engagementId);
	const docs = listArtifacts(app, e.id).filter((a) => a.state === 'received' && a.fileHash && !a.replacedBy);
	if (!docs.length) return [];
	const items = listEvidence(app, e.id).filter(
		(x) => x.kind === 'rule' && x.status !== 'received' && (!options.eventId || x.eventId === options.eventId)
	);
	if (!items.length) return [];
	const linked = new Set(listLinks(app, e.id).map((l) => `${l.artifactId}|${l.evidenceItemId}`));
	const byId = new Map(docs.map((d) => [d.id, d]));
	// requirement id -> document id -> sections, from confirmed internal requirements.
	const sources = new Map<string, Map<string, Set<string>>>();
	for (const r of listInternal(app, e.id)) {
		if (r.status !== 'confirmed' || !r.artifactId || !byId.has(r.artifactId)) continue;
		for (const l of r.implements) {
			if (l.status !== 'confirmed') continue;
			const perDoc = sources.get(l.other.id) ?? new Map<string, Set<string>>();
			const sections = perDoc.get(r.artifactId) ?? new Set<string>();
			if (r.section) sections.add(r.section);
			perDoc.set(r.artifactId, sections);
			sources.set(l.other.id, perDoc);
		}
	}
	const out: ReceivedLinkCandidate[] = [];
	const add = (x: EvidenceItem, d: Artifact, locator: string | null, why: ReceivedLinkCandidate['why']) => {
		const key = `${d.id}|${x.id}`;
		if (linked.has(key)) return;
		linked.add(key);
		out.push({
			evidenceItemId: x.id,
			evidenceText: x.text,
			eventId: x.eventId,
			artifactId: d.id,
			artifactName: d.displayName,
			locator,
			why
		});
	};
	for (const x of items) {
		const text = x.text.toLowerCase().replace(/\s+/g, ' ');
		// Named documents first: the item asks for the whole document.
		for (const d of docs)
			if (documentNames(d).some((n) => text.includes(n))) add(x, d, null, 'document_name');
		const perDoc = new Map<string, Set<string>>();
		for (const rid of x.requirementIds)
			for (const [docId, secs] of sources.get(rid) ?? []) {
				const s = perDoc.get(docId) ?? new Set<string>();
				for (const v of secs) s.add(v);
				perDoc.set(docId, s);
			}
		for (const [docId, secs] of perDoc) {
			const list = [...secs].sort(NUM);
			add(x, byId.get(docId)!, list.length ? `§ ${list.join(', ')}` : null, 'internal_requirements');
		}
	}
	return out;
}

/** Propose the links. Returns what was proposed; run it again and nothing is duplicated. */
export function linkReceivedDocuments(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	options: { eventId?: string } = {}
): ReceivedLinkCandidate[] {
	const candidates = receivedDocumentCandidates(app, engagementId, options);
	app.sqlite.transaction(() => {
		for (const c of candidates)
			createEntity(
				app,
				actor,
				evidenceLinkDefinition,
				{
					engagement_id: engagementId,
					artifact_id: c.artifactId,
					evidence_item_id: c.evidenceItemId,
					locator: c.locator,
					excerpt: null,
					sufficiency: 'supports',
					status: 'proposed'
				},
				{
					note:
						c.why === 'document_name'
							? 'Received document: the whole document'
							: 'Received document: sections of its internal requirements'
				}
			);
	})();
	return candidates;
}

/** "whole document" for a link without a locator. */
export const whereInDocument = (locator: string | null | undefined) => locator || 'whole document';
