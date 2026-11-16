import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import './entities';
import { getArtifact, registerTextArtifact, uploadArtifacts } from './artifacts';
import {
	carriedOverDocuments,
	recheckComparison,
	recheckMessage,
	registerNewTextVersion,
	sectionsWithoutRequirements,
	uploadNewVersion
} from './document-versions';
import { createEngagement, updateEngagement, type Engagement } from './engagements';
import { ForbiddenError } from './errors';
import {
	acceptRecheckProposal,
	addInternal,
	carryOverCandidates,
	getInternal,
	keepInternal,
	listInternal,
	proposeRecheck,
	rejectRecheckProposal,
	removeAfterRecheck
} from './internal';
import type { FetchLike } from '#lib/ai/llm.ts';
import { startJob } from '#lib/ai/runner.ts';
import { fakeLlmFetch } from '../../../e2e/fake-llm.mjs';
import { assignModels, checkModel, saveGateway } from './ai-settings';
import { getJob } from './jobs';
import { getItemHistory } from './items';
import { findRequirement, getSourceByCode } from './library';
import { importBuiltInSource } from './library-import';
import { bulkMessage, listProposals, proposalSummary, reviewProposalItems } from './proposals';
import { createFirstAdmin } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let human: Actor;
let ai: Actor;
let e: Engagement;
let files: string;

const V1 = `1 Purpose
Rules for access.

3 Access control
3.1 Accounts
Users must never share their access credentials with anyone.
3.2 Passwords
Users must use unique passwords for all work-related systems.
`;
// Renumbered, one rule reworded, a new section added.
const V2 = `1 Purpose
Rules for access.

4 Access control
4.1 Accounts
Users must never share their access   credentials with anyone.
4.2 Passwords
Users must use unique passwords of at least 14 characters for all systems.
4.3 Remote access
Remote access uses multi-factor authentication.
`;

const file = (name: string, text: string) => ({
	name,
	type: 'text/plain',
	bytes: new TextEncoder().encode(text)
});
const nis2 = (point: string) =>
	findRequirement(app, getSourceByCode(app, 'nis2')!.id, `Art. 21(2)(${point})`)!;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	ai = { userId: a.id, agent: 'Claude', channel: 'mcp' };
	importBuiltInSource(
		app,
		human,
		'nis2-art21.yaml',
		path.resolve(import.meta.dirname, '../../../seed/library')
	);
	e = createEngagement(app, human, {
		name: 'Audit',
		auditeeName: 'Baltic Freight SIA',
		startDate: '2026-11-16'
	});
	files = mkdtempSync(path.join(tmpdir(), 'mcpa-versions-'));
});
afterEach(() => {
	app.close();
	rmSync(files, { recursive: true, force: true });
});

async function policyWithRules() {
	const [r] = await uploadArtifacts(app, human, files, e.id, [file('policy-v1.txt', V1)]);
	const v1 = r!.artifact!;
	const add = (title: string, quote: string | null, section: string) =>
		addInternal(app, human, e.id, {
			title,
			quote,
			section,
			artifactId: v1.id,
			implements: [{ requirementId: nis2('i').id, coverage: 'partial' }]
		});
	const shared = add(
		'No shared credentials',
		'Users must never share their access credentials with anyone.',
		'3.1'
	);
	const unique = add(
		'Unique passwords',
		'Users must use unique passwords for all work-related systems.',
		'3.2'
	);
	const noQuote = add('Visitors sign in at reception', null, '1');
	return { v1, shared, unique, noQuote };
}

describe('recheck after a new version (#76)', () => {
	it('moves the requirements to the new version: a found quote is unchanged, any other needs review', async () => {
		const { v1, shared, unique, noQuote } = await policyWithRules();
		const { artifact: v2, recheck } = await uploadNewVersion(
			app,
			human,
			files,
			e.id,
			v1.id,
			file('policy-v2.txt', V2)
		);
		expect(recheck).toEqual({ unchanged: 1, needsReview: 2 });
		expect(recheckMessage(recheck)).toBe(
			'Internal requirements checked against it: 1 unchanged, 2 need review.'
		);

		const s = getInternal(app, e.id, shared.id);
		expect(s).toMatchObject({
			artifactId: v2.id,
			sourceTitle: 'policy-v2.txt',
			recheck: 'unchanged',
			section: '4.1',
			status: 'confirmed'
		});
		expect(getItemHistory(app, 'requirement', shared.id)[0]!.note).toBe(
			'Quote found unchanged in policy-v2.txt; section 3.1 → 4.1'
		);
		const u = getInternal(app, e.id, unique.id);
		expect(u).toMatchObject({ recheck: 'needs_review', section: '3.2', status: 'confirmed' });
		expect(u.recheckPassage).toContain('unique passwords of at least 14 characters');
		expect(getItemHistory(app, 'requirement', unique.id)[0]!.note).toBe('Quote not found in policy-v2.txt');
		expect(getInternal(app, e.id, noQuote.id).recheck).toBe('needs_review');
		expect(getItemHistory(app, 'requirement', noQuote.id)[0]!.note).toBe(
			'No quote to check against policy-v2.txt'
		);
		// Links and the old document stay; the old document has no internal requirements any more.
		expect(s.implements.map((l) => l.other.refCode)).toEqual(['Art. 21(2)(i)']);
		expect(getArtifact(app, v1.id).replacedBy?.id).toBe(v2.id);
		expect(listInternal(app, e.id).filter((r) => r.artifactId === v1.id)).toEqual([]);

		// New sections are candidates for extraction; covered ones (4.1, and 4 through it) are not.
		expect(
			sectionsWithoutRequirements(app, e.id)
				.get(v2.id)
				?.map((h) => h.number)
		).toEqual(['4.2', '4.3']);
	});

	it('keep as is, keep with the new passage, or remove; one by one or several together', async () => {
		const { v1, unique, noQuote } = await policyWithRules();
		await uploadNewVersion(app, human, files, e.id, v1.id, file('policy-v2.txt', V2));
		expect(listProposals(app, e.id, 'recheck').map((p) => p.title)).toEqual([
			`${unique.refCode} Unique passwords`,
			`${noQuote.refCode} Visitors sign in at reception`
		]);
		expect(proposalSummary(app, e.id).byType.recheck.count).toBe(2);
		expect(() => keepInternal(app, ai, e.id, unique.id)).toThrow(ForbiddenError);
		expect(() => keepInternal(app, human, e.id, noQuote.id, { useNewPassage: true })).toThrow(
			/No close passage/
		);

		const kept = keepInternal(app, human, e.id, unique.id, { useNewPassage: true });
		expect(kept).toMatchObject({ recheck: null, recheckPassage: null, status: 'confirmed' });
		expect(kept.quote).toContain('unique passwords of at least 14 characters');
		expect(kept.section).toBe('4.2');
		expect(() => keepInternal(app, human, e.id, unique.id)).toThrow(/does not need review/);

		const r = reviewProposalItems(app, human, e.id, 'recheck', [noQuote.id, unique.id], 'reject');
		expect(bulkMessage(r, 'reject', ['kept', 'removed'])).toMatch(/^1 removed\. 1 skipped: /);
		expect(listInternal(app, e.id).map((x) => x.id)).not.toContain(noQuote.id);
		expect(proposalSummary(app, e.id).count).toBe(0);
	});

	it('a removed requirement is gone only after review; remove refuses one that does not need review', async () => {
		const { v1, shared } = await policyWithRules();
		await uploadNewVersion(app, human, files, e.id, v1.id, file('policy-v2.txt', V2));
		expect(() => removeAfterRecheck(app, human, e.id, shared.id)).toThrow(/does not need review/);
	});

	it('a new version Claude registers makes every recheck a proposal for the auditor', async () => {
		const v1 = registerTextArtifact(app, human, files, e.id, { title: 'Access policy', text: V1 });
		const r = addInternal(app, human, e.id, {
			title: 'No shared credentials',
			quote: 'Users must never share their access credentials with anyone.',
			section: '3.1',
			artifactId: v1.id
		});
		const gone = addInternal(app, human, e.id, {
			title: 'Unique passwords',
			quote: 'Users must use unique passwords for all work-related systems.',
			artifactId: v1.id
		});
		const { recheck } = registerNewTextVersion(app, ai, files, e.id, {
			title: 'Access policy 2026',
			text: V2,
			supersedesId: v1.id
		});
		expect(recheck).toEqual({ unchanged: 1, needsReview: 1 });
		expect(getInternal(app, e.id, r.id)).toMatchObject({
			status: 'proposed',
			recheck: 'unchanged',
			section: '4.1'
		});
		expect(listProposals(app, e.id, 'internal').map((p) => p.id)).toEqual([r.id]);
		expect(listProposals(app, e.id, 'recheck').map((p) => p.id)).toEqual([gone.id]);
		// Keeping it is the auditor's decision and accepts it.
		expect(keepInternal(app, human, e.id, gone.id).status).toBe('confirmed');
	});

	it('a document without internal requirements is replaced with nothing to recheck', async () => {
		const [r] = await uploadArtifacts(app, human, files, e.id, [file('plan.txt', 'Plan v1')]);
		const { recheck } = await uploadNewVersion(
			app,
			human,
			files,
			e.id,
			r!.artifact!.id,
			file('plan2.txt', 'Plan v2')
		);
		expect(recheck).toEqual({ unchanged: 0, needsReview: 0 });
		expect(recheckMessage(recheck)).toBeNull();
	});

	it('carry-over takes the newest version: a new version in a later engagement copies the rules there', async () => {
		const { v1, shared, unique } = await policyWithRules();
		const later = createEngagement(app, human, {
			name: 'Audit 2027',
			auditeeName: 'Baltic Freight SIA',
			startDate: '2027-11-15'
		});
		// Without carry-over the earlier document is not this engagement's.
		await expect(
			uploadNewVersion(app, human, files, later.id, v1.id, file('policy-v2.txt', V2))
		).rejects.toThrow('Document not found');
		updateEngagement(app, human, later.id, later.version, { carry_over_internal: true });
		expect(carriedOverDocuments(app, later.id)).toEqual([
			{ id: v1.id, name: 'policy-v1.txt', engagementName: 'Audit', requirements: 3 }
		]);

		const { artifact: v2, recheck } = await uploadNewVersion(
			app,
			human,
			files,
			later.id,
			v1.id,
			file('policy-v2.txt', V2)
		);
		expect(recheck).toEqual({ unchanged: 1, needsReview: 2 });
		expect(v2.eventId).toBeNull();
		// The later engagement now works with copies under the same codes, from the new version only.
		const now = listInternal(app, later.id);
		expect(now.map((r) => [r.refCode, r.artifactId, r.carriedOver, r.recheck])).toEqual([
			[shared.refCode, v2.id, false, 'unchanged'],
			[unique.refCode, v2.id, false, 'needs_review'],
			['INT-3', v2.id, false, 'needs_review']
		]);
		const copy = now.find((r) => r.refCode === shared.refCode)!;
		expect(copy).toMatchObject({ section: '4.1', status: 'confirmed' });
		expect(copy.implements.map((l) => l.other.refCode)).toEqual(['Art. 21(2)(i)']);
		expect(getItemHistory(app, 'requirement', copy.id)[0]!.note).toBe(
			'Carried over from Audit to the new version: Quote found unchanged in policy-v2.txt; section 3.1 → 4.1'
		);
		expect(carriedOverDocuments(app, later.id)).toEqual([]);
		// The earlier engagement keeps its own records, unchanged and not replaced there.
		expect(getInternal(app, e.id, shared.id)).toMatchObject({
			artifactId: v1.id,
			section: '3.1',
			recheck: null
		});
		expect(getArtifact(app, v1.id).replacedBy).toBeNull();
		// A third engagement carries over from the newest version, not both.
		const third = createEngagement(app, human, {
			name: 'Audit 2028',
			auditeeName: 'Baltic Freight SIA',
			startDate: '2028-11-13'
		});
		expect(carryOverCandidates(app, third.id).map((r) => r.artifactId)).toEqual([v2.id]);
		updateEngagement(app, human, third.id, third.version, { carry_over_internal: true });
		expect(listInternal(app, third.id).map((r) => [r.refCode, r.artifactId])).toEqual([
			[shared.refCode, v2.id]
		]);
		// The earlier document cannot get a second new version: it was replaced already.
		await expect(
			uploadNewVersion(app, human, files, third.id, v1.id, file('policy-v3.txt', `${V2}\n5 More`))
		).rejects.toThrow('was already replaced by policy-v2.txt');
	});
});

describe("AI's recheck against the new version (#76)", () => {
	async function afterNewVersion() {
		const rules = await policyWithRules();
		const { artifact: v2 } = await uploadNewVersion(
			app,
			human,
			files,
			e.id,
			rules.v1.id,
			file('policy-v2.txt', V2)
		);
		return { ...rules, v2 };
	}
	const NEW_QUOTE = 'Users must use unique passwords of at least 14 characters for all systems.';

	it('compares each requirement that needs review with the previous and the new text', async () => {
		const { v1, v2, unique, noQuote } = await afterNewVersion();
		const items = recheckComparison(app, e.id, { artifactId: v2.id });
		expect(items.map((i) => i.ref)).toEqual([unique.refCode, noQuote.refCode]);
		const u = items[0]!;
		expect(u).toMatchObject({
			document: { id: v2.id, title: 'policy-v2.txt' },
			previousDocument: { id: v1.id, title: 'policy-v1.txt' },
			closestSection: '4.2',
			proposal: null
		});
		expect(u.previousContext).toContain('3.2 Passwords');
		expect(u.closestPassage).toContain('14 characters');
		expect(u.newContext).toContain('4.2 Passwords');
		expect(items[1]!.previousContext).toBeNull();
	});

	it('a proposal is accepted or rejected by the auditor; rejecting brings back the requirement to review', async () => {
		const { unique, noQuote } = await afterNewVersion();
		expect(() =>
			proposeRecheck(app, ai, e.id, unique.id, {
				action: 'update',
				quote: 'Passwords are changed every 30 days.',
				reason: 'Changed'
			})
		).toThrow('is not in the new version');
		expect(() => proposeRecheck(app, ai, e.id, unique.id, { action: 'update', reason: 'x' })).toThrow(
			'Give the new wording'
		);
		const p = proposeRecheck(app, ai, e.id, unique.id, {
			action: 'update',
			title: 'Unique passwords of at least 14 characters',
			quote: NEW_QUOTE,
			reason: '4.2 now requires 14 characters for all systems.'
		});
		expect(p).toMatchObject({
			status: 'proposed',
			recheck: 'needs_review',
			recheckProposal: 'update',
			quote: NEW_QUOTE,
			section: '4.2',
			previous: { title: 'Unique passwords', section: '3.2' }
		});
		expect(() => keepInternal(app, human, e.id, unique.id)).toThrow('Accept or reject the proposal');
		expect(listProposals(app, e.id, 'recheck').find((x) => x.id === unique.id)!.detail).toContain(
			`Proposed: update it to “${NEW_QUOTE}” § 4.2`
		);
		expect(() => acceptRecheckProposal(app, ai, e.id, unique.id)).toThrow(ForbiddenError);

		rejectRecheckProposal(app, human, e.id, unique.id);
		expect(getInternal(app, e.id, unique.id)).toMatchObject({
			status: 'confirmed',
			recheck: 'needs_review',
			recheckProposal: null,
			title: 'Unique passwords',
			section: '3.2'
		});

		proposeRecheck(app, ai, e.id, unique.id, {
			action: 'update',
			quote: NEW_QUOTE,
			reason: '4.2 now requires 14 characters.'
		});
		expect(acceptRecheckProposal(app, human, e.id, unique.id)).toBe('updated');
		expect(getInternal(app, e.id, unique.id)).toMatchObject({
			status: 'confirmed',
			recheck: null,
			recheckProposal: null,
			recheckReason: null,
			quote: NEW_QUOTE,
			section: '4.2'
		});

		// A removal, accepted from the review list.
		proposeRecheck(app, ai, e.id, noQuote.id, { action: 'remove', reason: 'No longer in the policy.' });
		const r = reviewProposalItems(app, human, e.id, 'recheck', [noQuote.id], 'accept');
		expect(r.done).toBe(1);
		expect(listInternal(app, e.id).some((x) => x.id === noQuote.id)).toBe(false);
		expect(getItemHistory(app, 'requirement', noQuote.id)[0]!.note).toBe(
			'Removed after the new version: No longer in the policy.'
		);
	});

	it('Recheck against new version runs as an in-app action and leaves proposals', async () => {
		const { v2, unique } = await afterNewVersion();
		const fetch = fakeLlmFetch() as FetchLike;
		saveGateway(app, human, { baseUrl: 'http://fake' });
		await checkModel(app, human, 'fake-tools', { fetch, env: {} });
		assignModels(app, human, { default: 'fake-tools' });
		const { job, done } = startJob(
			app,
			human,
			{ action: 'recheck_internal', context: { engagement_id: e.id, artifact_id: v2.id } },
			{ fetch, env: {} }
		);
		await done;
		expect(getJob(app, job.id).status).toBe('succeeded');
		const u = getInternal(app, e.id, unique.id);
		expect(u).toMatchObject({ status: 'proposed', recheckProposal: 'update', section: '4.2' });
		expect(u.recheckReason).toContain('Reworded in the new version');
		expect(getItemHistory(app, 'requirement', unique.id)[0]!.authorAgent).toBe('fake-tools');
	});
});
