import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import './entities';
import { getArtifact, registerTextArtifact, uploadArtifacts } from './artifacts';
import {
	recheckMessage,
	registerNewTextVersion,
	sectionsWithoutRequirements,
	uploadNewVersion
} from './document-versions';
import { createEngagement, type Engagement } from './engagements';
import { ForbiddenError } from './errors';
import { addInternal, getInternal, keepInternal, listInternal, removeAfterRecheck } from './internal';
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
});
