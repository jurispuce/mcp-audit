import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import type { FetchLike } from '#lib/ai/llm.ts';
import { startJob } from '#lib/ai/runner.ts';
import { fakeLlmFetch } from '../../../e2e/fake-llm.mjs';
import './entities';
import { assignModels, checkModel, saveGateway } from './ai-settings';
import { registerTextArtifact } from './artifacts';
import { buildAuditPlan } from './audit-plan';
import { uploadNewVersion } from './document-versions';
import { createEngagement, type Engagement } from './engagements';
import { confirmLink, listLinks, removeLink } from './execution';
import { getItemHistory } from './items';
import { acceptInternal, addInternal } from './internal';
import { findRequirement, getSourceByCode } from './library';
import { importBuiltInSource } from './library-import';
import { addEvent, addEvidence, listEvidence, setPlanInputs } from './planning';
import { linkReceivedDocuments, receivedDocumentCandidates } from './received-documents';
import { selectRequirements } from './selection';
import { createFirstAdmin } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let human: Actor;
let e: Engagement;
let files: string;
const previous = process.env.DATA_DIR;
const req = (p: string) => findRequirement(app, getSourceByCode(app, 'nis2')!.id, `Art. 21(2)(${p})`)!.id;

beforeEach(async () => {
	files = mkdtempSync(path.join(tmpdir(), 'mcpa-received-'));
	process.env.DATA_DIR = files;
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	importBuiltInSource(
		app,
		human,
		'nis2-art21.yaml',
		path.resolve(import.meta.dirname, '../../../seed/library')
	);
	e = createEngagement(app, human, { name: 'Audit', auditeeName: 'Peak SIA', startDate: '2026-11-16' });
	selectRequirements(app, human, e.id, [req('a'), req('b'), req('i')]);
});
afterEach(() => {
	app.close();
	rmSync(files, { recursive: true, force: true });
	process.env.DATA_DIR = previous;
});

function setup() {
	const scope = registerTextArtifact(app, human, files, e.id, {
		title: 'PEAK DEFENCE - ISMS Scope',
		text: '4 Context\n4.1 Issues\n...'
	});
	const policy = registerTextArtifact(app, human, files, e.id, {
		title: 'Access control policy',
		text: '5.2 Reviews'
	});
	for (const [section, r] of [
		['5.2', 'i'],
		['5.4', 'i'],
		['6.1', 'b']
	] as const) {
		const ir = addInternal(app, human, e.id, {
			title: `Rule ${section}`,
			quote: `Rule ${section} quote`,
			section,
			artifactId: policy.id,
			implements: [{ requirementId: req(r), coverage: 'partial' }]
		});
		acceptInternal(app, human, e.id, ir.id);
	}
	const ev = addEvent(app, human, e.id, { title: 'Access interview', requirement_ids: [req('i'), req('a')] });
	const items = {
		scope: addEvidence(app, human, e.id, ev.id, {
			text: 'Approved ISMS Scope document with context analysis',
			kind: 'rule',
			requirement_ids: [req('a')]
		}),
		rule: addEvidence(app, human, e.id, ev.id, {
			text: 'Approved access rules',
			kind: 'rule',
			requirement_ids: [req('i')]
		}),
		records: addEvidence(app, human, e.id, ev.id, {
			text: 'Access review records for the last two cycles',
			kind: 'record',
			requirement_ids: [req('i')]
		})
	};
	return { scope, policy, ev, items };
}

describe('documents already received (#83)', () => {
	it('links rule evidence to the sections of its internal requirements, or the whole document it names', () => {
		const { scope, policy, items } = setup();
		const found = receivedDocumentCandidates(app, e.id);
		expect(found.map((c) => [c.evidenceText, c.artifactName, c.locator, c.why])).toEqual([
			[
				'Approved ISMS Scope document with context analysis',
				'PEAK DEFENCE - ISMS Scope',
				null,
				'document_name'
			],
			['Approved access rules', 'Access control policy', '§ 5.2, 5.4', 'internal_requirements']
		]);
		// Records are not linked: a policy shows the rule, not that it operated.
		expect(found.some((c) => c.evidenceItemId === items.records.id)).toBe(false);

		const linked = linkReceivedDocuments(app, human, e.id);
		expect(linked).toHaveLength(2);
		const links = listLinks(app, e.id);
		expect(links.map((l) => [l.artifactId, l.locator, l.status, l.sufficiency])).toEqual([
			[scope.id, null, 'proposed', 'supports'],
			[policy.id, '§ 5.2, 5.4', 'proposed', 'supports']
		]);
		expect(getItemHistory(app, 'evidence_link', links[0]!.id)[0]!.note).toBe(
			'Received document: the whole document'
		);
		// Nothing is duplicated on a second run, and nothing is confirmed until the auditor says so.
		expect(linkReceivedDocuments(app, human, e.id)).toEqual([]);
		expect(listEvidence(app, e.id).find((x) => x.id === items.scope.id)!.status).toBe('planned');
		confirmLink(app, human, e.id, links[0]!.id);
		expect(listEvidence(app, e.id).find((x) => x.id === items.scope.id)!.status).toBe('received');
		// The sections' rules come with the link, in the document's words, and the note names them.
		expect(links[1]!.excerpt).toBe('INT-1: “Rule 5.2 quote” INT-2: “Rule 5.4 quote”');
		expect(getItemHistory(app, 'evidence_link', links[1]!.id)[0]!.note).toBe(
			'Received document: the sections of INT-1, INT-2'
		);
	});

	it('does not propose a match again once the auditor rejected it', () => {
		setup();
		linkReceivedDocuments(app, human, e.id);
		const [first] = listLinks(app, e.id);
		removeLink(app, human, e.id, first!.id);
		expect(receivedDocumentCandidates(app, e.id).map((c) => c.artifactId)).not.toContain(first!.artifactId);
		expect(linkReceivedDocuments(app, human, e.id)).toEqual([]);
	});

	it('uses the newest version of a document and only this event when asked', async () => {
		const { scope, ev } = setup();
		const other = addEvent(app, human, e.id, { title: 'Other', requirement_ids: [req('a')] });
		addEvidence(app, human, e.id, other.id, {
			text: 'Approved ISMS scope',
			kind: 'rule',
			requirement_ids: [req('a')]
		});
		expect(receivedDocumentCandidates(app, e.id, { eventId: ev.id }).every((c) => c.eventId === ev.id)).toBe(
			true
		);
		const { artifact: v2 } = await uploadNewVersion(app, human, files, e.id, scope.id, {
			name: 'PEAK DEFENCE - ISMS Scope v2.pdf',
			type: 'text/plain',
			bytes: new TextEncoder().encode('new scope')
		});
		const named = receivedDocumentCandidates(app, e.id).filter((c) => c.why === 'document_name');
		expect(named.map((c) => c.artifactId)).toEqual([v2.id, v2.id]);
	});

	it('the plan document asks only for what is still missing, and names what is already received', () => {
		const { items } = setup();
		linkReceivedDocuments(app, human, e.id);
		for (const l of listLinks(app, e.id)) confirmLink(app, human, e.id, l.id);
		const md = buildAuditPlan(app, e.id).markdown;
		const prepare = md.slice(md.indexOf('## What to prepare'), md.indexOf('## Practical arrangements'));
		expect(prepare).toContain(
			'Already received, no need to send again: Access control policy, PEAK DEFENCE - ISMS Scope.'
		);
		expect(prepare).toContain(items.records.text);
		expect(prepare).not.toContain(items.scope.text);
		expect(prepare).not.toContain(items.rule.text);
	});

	it('runs after Draft plan, so a drafted plan already points at the documents', async () => {
		setup();
		const fetch = fakeLlmFetch() as FetchLike;
		saveGateway(app, human, { baseUrl: 'http://fake' });
		await checkModel(app, human, 'fake-tools', { fetch, env: {} });
		assignModels(app, human, { default: 'fake-tools' });
		setPlanInputs(app, human, e.id, { from: '2026-11-30', to: '2026-12-01' });
		const { job, done } = startJob(
			app,
			human,
			{ action: 'draft_plan', context: { engagement_id: e.id } },
			{ fetch, env: {} }
		);
		await done;
		const links = listLinks(app, e.id);
		expect(links).toHaveLength(2);
		expect(links.every((l) => l.status === 'proposed')).toBe(true);
		const { getJob } = await import('./jobs');
		expect(getJob(app, job.id).summary).toContain(
			'2 planned evidence links to documents already received proposed.'
		);
	});
});
