import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { startJob } from '#lib/ai/runner.ts';
import type { FetchLike } from '#lib/ai/llm.ts';
import { fakeLlmFetch } from '../../../e2e/fake-llm.mjs';
import { assignModels, checkModel, saveGateway } from './ai-settings';
import type { Engagement } from './engagements';
import { listFindings } from './findings';
import { addPerson, listPeople } from './people';
import { listEvents } from './planning';
import {
	acceptAllProposals,
	acceptProposalItem,
	listProposals,
	proposalSummary,
	rejectProposalItem
} from './proposals';
import { seedTestData } from './seed';
import type { Actor } from './write';

let app: AppDatabase;
let dir: string;
let e: Engagement;
let human: Actor;
const previous = process.env.DATA_DIR;
const fetch = fakeLlmFetch() as FetchLike;

beforeEach(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'mcpa-proposals-'));
	process.env.DATA_DIR = dir;
	app = createTestDatabase();
	const seeded = await seedTestData(app, { TEST_SEED_ENABLED: 'true', DATA_DIR: dir });
	e = seeded.engagement;
	human = { userId: seeded.users.find((u) => u.role === 'admin')!.id, channel: 'ui' };
	saveGateway(app, human, { baseUrl: 'http://fake' });
	await checkModel(app, human, 'fake-tools', { fetch, env: {} });
	assignModels(app, human, { default: 'fake-tools' });
});
afterEach(() => {
	app.close();
	rmSync(dir, { recursive: true, force: true });
	process.env.DATA_DIR = previous;
});

async function run(action: string) {
	await startJob(app, human, { action, context: { engagement_id: e.id } }, { fetch, env: {} }).done;
}

describe('proposals review list (#65)', () => {
	it('lists proposals across screens with the action or agent that made them', async () => {
		expect(proposalSummary(app, e.id).count).toBe(0);
		await run('derive_roles');
		await run('draft_plan');
		await run('propose_findings');
		addPerson(app, { userId: human.userId, agent: 'Claude', channel: 'mcp' }, e.auditeeId, {
			role: 'Data protection officer'
		});

		const items = listProposals(app, e.id);
		expect(items.map((p) => [p.type, p.title, p.source])).toEqual(
			expect.arrayContaining([
				['role', 'Backup administrator: Ilze Kalniņa', 'Derive roles from documents'],
				['role', 'Data protection officer', 'Claude through MCP'],
				['event', 'Backup restore walkthrough', 'Draft plan'],
				expect.arrayContaining(['finding', 'Propose finding(s)'])
			])
		);
		const summary = proposalSummary(app, e.id);
		expect(summary.count).toBe(4);
		expect(summary.byType.role).toEqual({
			count: 2,
			sources: expect.arrayContaining(['Derive roles from documents', 'Claude through MCP'])
		});
		expect(listProposals(app, e.id, 'event').map((p) => p.path)).toEqual([
			`/plan/events?event=${listEvents(app, e.id).find((x) => x.title === 'Backup restore walkthrough')!.id}`
		]);
	});

	it('accepts and rejects through each item’s own rules; findings become drafts, not approved', async () => {
		await run('derive_roles');
		await run('propose_findings');
		const role = listProposals(app, e.id, 'role')[0]!;
		acceptProposalItem(app, human, e.id, 'role', role.id);
		expect(listPeople(app, e.auditeeId).find((p) => p.id === role.id)?.status).toBe('confirmed');
		expect(() => acceptProposalItem(app, human, e.id, 'role', role.id)).toThrow(/already reviewed/);

		const ai = { userId: human.userId, agent: 'x', channel: 'ai' as const };
		const finding = listProposals(app, e.id, 'finding')[0]!;
		expect(() => acceptProposalItem(app, ai, e.id, 'finding', finding.id)).toThrow();
		expect(acceptAllProposals(app, human, e.id)).toBe(1);
		expect(listFindings(app, e.id).find((f) => f.id === finding.id)?.status).toBe('draft');
		expect(proposalSummary(app, e.id).count).toBe(0);
	});

	it('rejecting removes the proposal', async () => {
		await run('draft_plan');
		const ev = listProposals(app, e.id, 'event')[0]!;
		rejectProposalItem(app, human, e.id, 'event', ev.id);
		expect(listEvents(app, e.id).some((x) => x.id === ev.id)).toBe(false);
		expect(proposalSummary(app, e.id).count).toBe(0);
	});
});
