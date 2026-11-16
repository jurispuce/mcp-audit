import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import type { FetchLike } from '#lib/ai/llm.ts';
import { ACTION_TOOLS, startJob, taskText } from '#lib/ai/runner.ts';
import { fakeLlmFetch } from '../../../e2e/fake-llm.mjs';
import { makeXlsx } from '../../../tests/fixtures/make-docs';
import { assignModels, checkModel, saveGateway, saveResearch, webSearchFor } from './ai-settings';
import { uploadArtifacts } from './artifacts';
import type { Engagement } from './engagements';
import { ForbiddenError } from './errors';
import { getItemHistory } from './items';
import { getJob } from './jobs';
import { getEngagement, updateEngagement } from './engagements';
import { engagementOverview } from './overview';
import { setPlanInputs } from './planning';
import { listProposals, proposalSummary, reviewProposalItems } from './proposals';
import { acceptAllRisks, acceptRisk, addRisk, criticalityOf, listRisks, rejectRisk } from './risks';
import { seedTestData } from './seed';
import { listSelected } from './selection';
import type { Actor } from './write';

let app: AppDatabase;
let dir: string;
let e: Engagement;
let human: Actor;
const ai: () => Actor = () => ({ ...human, agent: 'Claude', channel: 'mcp' });
const previous = process.env.DATA_DIR;
const fetch = fakeLlmFetch() as FetchLike;

beforeEach(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'mcpa-risks-'));
	process.env.DATA_DIR = dir;
	app = createTestDatabase();
	const seeded = await seedTestData(app, { TEST_SEED_ENABLED: 'true', DATA_DIR: dir });
	e = seeded.engagement;
	human = { userId: seeded.users.find((u) => u.role === 'admin')!.id, channel: 'ui' };
	saveGateway(app, human, { baseUrl: 'http://fake-gateway' });
	await checkModel(app, human, 'fake-tools', { fetch, env: {} });
	assignModels(app, human, { default: 'fake-tools' });
});
afterEach(() => {
	app.close();
	rmSync(dir, { recursive: true, force: true });
	process.env.DATA_DIR = previous;
});

describe('proposed risks (#78)', () => {
	it('a risk AI writes is proposed and sets no criticality until a person accepts it', () => {
		const req = listSelected(app, e.id)[0]!.requirementId;
		const before = criticalityOf(app, e.id).get(req);
		const r = addRisk(app, ai(), e.id, { title: 'Ransomware', level: 'high', requirement_ids: [req] });
		expect(r.proposed).toBe(true);
		expect(criticalityOf(app, e.id).get(req)).toEqual(before);
		expect(engagementOverview(app, e.id).counts.risks).toBe(
			listRisks(app, e.id).filter((x) => !x.proposed).length
		);
		expect(listProposals(app, e.id, 'risk')).toMatchObject([
			{ title: 'Ransomware', detail: 'High level · auditor view · affects 1 requirement' }
		]);

		expect(() => acceptRisk(app, ai(), e.id, r.id)).toThrow(ForbiddenError);
		expect(acceptRisk(app, human, e.id, r.id).proposed).toBe(false);
		expect(criticalityOf(app, e.id).get(req)).toMatchObject({ level: 'high', from: 'risk' });
		expect(getItemHistory(app, 'risk', r.id)[0]!.note).toBe('Accepted');

		// A person's own risk is accepted from the start.
		expect(addRisk(app, human, e.id, { title: 'Mine' }).proposed).toBe(false);
	});

	it('rejects, accepts all, and reviews a selection', () => {
		const [a, b, c] = ['A', 'B', 'C'].map((t) => addRisk(app, ai(), e.id, { title: `Risk ${t}` }));
		rejectRisk(app, human, e.id, a!.id);
		expect(getItemHistory(app, 'risk', a!.id)[0]!.note).toBe('Proposal rejected');
		expect(reviewProposalItems(app, human, e.id, 'risk', [b!.id], 'accept')).toEqual({
			done: 1,
			skipped: []
		});
		expect(acceptAllRisks(app, human, e.id)).toBe(1);
		expect(listRisks(app, e.id).find((r) => r.id === c!.id)?.proposed).toBe(false);
		expect(proposalSummary(app, e.id).byType.risk.count).toBe(0);
	});
});

describe('Extract risks from a register (#78)', () => {
	it('reads an .xlsx register and proposes its risks from the auditee register', async () => {
		const [up] = await uploadArtifacts(
			app,
			human,
			path.join(dir, 'files'),
			e.id,
			[
				{
					name: 'risk-register.xlsx',
					type: '',
					bytes: await makeXlsx({
						Register: [
							['ID', 'Risk', 'Likelihood', 'Impact', 'Owner'],
							['R-1', 'Ransomware encrypts file servers', 4, 5, 'Head of IT'],
							['R-2', 'Supplier outage stops deliveries', 2, 3, 'COO']
						]
					})
				}
			],
			{ kind: 'risk_register' }
		);
		const register = up!.artifact!;
		expect(register.textStatus).toBe('extracted');
		expect(taskText('extract_risks', { artifact_id: register.id })).toContain(register.id);
		expect(ACTION_TOOLS.extract_risks).toContain('upsert_risks');

		const { job, done } = startJob(
			app,
			human,
			{ action: 'extract_risks', context: { engagement_id: e.id, artifact_id: register.id } },
			{ fetch, env: {} }
		);
		await done;
		expect(getJob(app, job.id).status).toBe('succeeded');
		const proposed = listRisks(app, e.id).filter((r) => r.proposed);
		expect(proposed.map((r) => [r.title, r.level, r.origin, r.description])).toEqual([
			['Ransomware encrypts file servers', 'high', 'auditee_register', 'R-1, likelihood 4 × impact 5'],
			['Supplier outage stops deliveries', 'medium', 'auditee_register', 'R-2, likelihood 2 × impact 3']
		]);
		expect(listProposals(app, e.id, 'risk').map((p) => p.source)).toEqual(['Extract risks', 'Extract risks']);
	});

	it('with web search on, the job asks the gateway to search and the task asks for current risks', async () => {
		const bodies: Record<string, unknown>[] = [];
		const spy = (async (url: string, init?: RequestInit) => {
			if (String(url).endsWith('/chat/completions')) bodies.push(JSON.parse(String(init?.body)));
			return fetch(url, init);
		}) as FetchLike;
		const run = async () => {
			bodies.length = 0;
			const { done } = startJob(
				app,
				human,
				{ action: 'extract_risks', context: { engagement_id: e.id } },
				{
					fetch: spy,
					env: {}
				}
			);
			await done;
			return bodies;
		};

		expect(webSearchFor(app, 'extract_risks')).toBe(false);
		let sent = await run();
		expect(sent[0]).not.toHaveProperty('web_search_options');
		expect(JSON.stringify(sent[0]!.messages)).toContain('Web search is not available in this run');

		saveResearch(app, human, { webSearch: true });
		expect(webSearchFor(app, 'extract_risks')).toBe(true);
		expect(webSearchFor(app, 'draft_plan')).toBe(false);
		sent = await run();
		expect(
			sent.every(
				(b) => (b.web_search_options as { search_context_size: string }).search_context_size === 'medium'
			)
		).toBe(true);
		expect(JSON.stringify(sent[0]!.messages)).toContain(
			'Propose each relevant risk the register does not cover with origin research'
		);
	});

	it('a risk found by research carries its own origin', () => {
		const r = addRisk(app, ai(), e.id, { title: 'Exploited VPN appliance flaw', origin: 'research' });
		expect(r.origin).toBe('research');
		expect(listProposals(app, e.id, 'risk')[0]!.detail).toContain('found by research, not in the register');
	});

	it('Draft plan needs the planning inputs, and passes them to the model with the schedule rules (#79)', async () => {
		const bodies: Record<string, unknown>[] = [];
		const spy = (async (url: string, init?: RequestInit) => {
			if (String(url).endsWith('/chat/completions')) bodies.push(JSON.parse(String(init?.body)));
			return fetch(url, init);
		}) as FetchLike;
		updateEngagement(app, human, e.id, getEngagement(app, e.id).version, { plan_inputs: null });
		expect(() =>
			startJob(
				app,
				human,
				{ action: 'draft_plan', context: { engagement_id: e.id } },
				{ fetch: spy, env: {} }
			)
		).toThrow('Set the planning inputs first');
		setPlanInputs(app, human, e.id, {
			from: '2026-11-30',
			to: '2026-12-01',
			meetings: 5,
			exceptions: 'No calls before 10:00'
		});
		await startJob(
			app,
			human,
			{ action: 'draft_plan', context: { engagement_id: e.id } },
			{ fetch: spy, env: {} }
		).done;
		const task = JSON.stringify(bodies[0]!.messages);
		expect(task).toContain('Fieldwork: 2 days (2026-11-30, 2026-12-01)');
		expect(task).toContain('The auditor wants about 5 audit meetings');
		expect(task).toContain('No calls before 10:00');
		expect(task).toContain('opening_meeting');
	});
});
