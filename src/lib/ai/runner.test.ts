import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { assignModels, checkModel, saveGateway } from '#lib/domain/ai-settings.ts';
import type { Engagement } from '#lib/domain/engagements.ts';
import { updateEngagement, getEngagement } from '#lib/domain/engagements.ts';
import { listLinks } from '#lib/domain/execution.ts';
import { listFindings } from '#lib/domain/findings.ts';
import { getItemHistory } from '#lib/domain/items.ts';
import { listInternal } from '#lib/domain/internal.ts';
import { failInterruptedJobs, getJob, listJobs } from '#lib/domain/jobs.ts';
import { findRequirement, getSourceByCode, linksOf } from '#lib/domain/library.ts';
import { uploadLibraryDocuments } from '#lib/domain/library-documents.ts';
import { listPeople } from '#lib/domain/people.ts';
import { listEvents } from '#lib/domain/planning.ts';
import { seedTestData } from '#lib/domain/seed.ts';
import type { Actor } from '#lib/domain/write.ts';
import { fakeLlmFetch } from '../../../e2e/fake-llm.mjs';
import { makePdf } from '../../../tests/fixtures/make-docs';
import type { FetchLike } from './llm';
import { ACTION_TOOLS, cancelJob, skillInstructions, startJob } from './runner';

let app: AppDatabase;
let dir: string;
let e: Engagement;
let human: Actor;
let other: Actor;
const previous = process.env.DATA_DIR;
const fetch = fakeLlmFetch() as FetchLike;
const env = {};
const deps = { fetch, env };

beforeEach(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'mcpa-jobs-'));
	process.env.DATA_DIR = dir;
	app = createTestDatabase();
	const seeded = await seedTestData(app, { TEST_SEED_ENABLED: 'true', DATA_DIR: dir });
	e = seeded.engagement;
	human = { userId: seeded.users.find((u) => u.role === 'admin')!.id, channel: 'ui' };
	other = { userId: seeded.users.find((u) => u.role === 'auditor')!.id, channel: 'ui' };
	saveGateway(app, human, { baseUrl: 'http://fake-gateway' });
	for (const m of ['fake-tools', 'fake-slow', 'fake-broken']) await checkModel(app, human, m, { fetch, env });
	assignModels(app, human, { default: 'fake-tools' });
});
afterEach(() => {
	app.close();
	rmSync(dir, { recursive: true, force: true });
	process.env.DATA_DIR = previous;
});

async function run(action: string, context: Record<string, unknown> = {}, actor = human) {
	const { job, done } = startJob(app, actor, { action, context: { engagement_id: e.id, ...context } }, deps);
	await done;
	return getJob(app, job.id);
}

function lastRevision(type: string, id: string) {
	return getItemHistory(app, type, id).at(-1)!;
}

describe('AI job runner (#64)', () => {
	it('every action has a skill whose instructions load, and only tools the MCP server has', () => {
		for (const action of Object.keys(ACTION_TOOLS) as (keyof typeof ACTION_TOOLS)[]) {
			expect(skillInstructions(action).length).toBeGreaterThan(500);
		}
	});

	it('Derive roles runs the skill as an agent loop and writes proposed roles as AI on behalf of the user', async () => {
		const job = await run('derive_roles');
		expect(job).toMatchObject({
			status: 'succeeded',
			model: 'fake-tools',
			label: 'Derive roles from documents'
		});
		expect(job.summary).toContain('Done');
		expect(job.steps.filter((s) => s.kind === 'tool').map((s) => s.text)).toEqual([
			'List documents',
			'Propose roles'
		]);

		const role = listPeople(app, e.auditeeId).find((p) => p.role === 'Backup administrator')!;
		expect(role.status).toBe('proposed');
		const rev = lastRevision('person', role.id);
		expect(rev).toMatchObject({
			channel: 'ai',
			authorAgent: 'fake-tools',
			note: 'Derive roles from documents'
		});
		expect(rev.authorUserId).toBe(human.userId);
	});

	it('Extract requirements, Draft plan, Process event materials and Propose finding(s) only make proposals', async () => {
		expect((await run('extract_internal')).status).toBe('succeeded');
		expect(listInternal(app, e.id).find((r) => r.title.startsWith('Backups are restored'))?.status).toBe(
			'proposed'
		);

		expect((await run('draft_plan')).status).toBe('succeeded');
		expect(listEvents(app, e.id).find((x) => x.title === 'Backup restore walkthrough')?.proposed).toBe(true);

		const ev = listEvents(app, e.id)[0]!;
		const before = listLinks(app, e.id).length;
		expect((await run('process_event', { event_id: ev.id })).status).toBe('succeeded');
		const links = listLinks(app, e.id);
		expect(links.length).toBe(before + 1);
		expect(links.filter((l) => l.status === 'proposed').length).toBeGreaterThan(0);

		expect((await run('propose_findings')).status).toBe('succeeded');
		const proposed = listFindings(app, e.id).filter((f) => f.status === 'proposed');
		expect(proposed).toHaveLength(1);
	});

	it('library actions extract a proposed source from a document and propose mappings', async () => {
		const [up] = await uploadLibraryDocuments(app, human, dir, [
			{ name: 'law.pdf', type: 'application/pdf', bytes: makePdf(['1. Risk management', '2. Backups']) }
		]);
		const { job, done } = startJob(
			app,
			human,
			{
				action: 'library_extract',
				context: { document_id: up!.document!.id, source_code: 'testlaw', source_title: 'Test law' }
			},
			deps
		);
		expect(job.engagementId).toBeNull();
		await done;
		expect(getJob(app, job.id).status).toBe('succeeded');
		const src = getSourceByCode(app, 'testlaw')!;
		expect(src).toMatchObject({ status: 'proposed', requirementCount: 2 });

		const map = startJob(
			app,
			human,
			{ action: 'library_mapping', context: { from_source: 'testlaw', to_source: 'nis2' } },
			deps
		);
		await map.done;
		expect(getJob(app, map.job.id).status).toBe('succeeded');
		const from = listJobs(app, { engagementId: null });
		expect(from.map((j) => j.action)).toEqual(['library_mapping', 'library_extract']);
		const links = linksOf(app, findRequirement(app, src.id, '1')!.id);
		expect(links.some((l) => l.status === 'proposed')).toBe(true);
	});

	it('refuses when AI is off, no model is set, the person is not a person, or it is already running', async () => {
		const off = updateEngagement(app, human, e.id, getEngagement(app, e.id).version, { ai_allowed: false });
		expect(() =>
			startJob(app, human, { action: 'draft_plan', context: { engagement_id: off.id } }, deps)
		).toThrow(/switched off/);
		updateEngagement(app, human, e.id, off.version, { ai_allowed: true });

		expect(() =>
			startJob(
				app,
				{ ...human, channel: 'mcp', agent: 'Claude' },
				{ action: 'draft_plan', context: { engagement_id: e.id } },
				deps
			)
		).toThrow(/Only a person/);
		expect(() => startJob(app, human, { action: 'nope', context: {} }, deps)).toThrow(/Unknown AI action/);
		expect(() =>
			startJob(app, human, { action: 'process_event', context: { engagement_id: e.id } }, deps)
		).toThrow(/Choose the event/);

		assignModels(app, human, { default: 'fake-slow' });
		const first = startJob(app, human, { action: 'draft_plan', context: { engagement_id: e.id } }, deps);
		expect(() =>
			startJob(app, human, { action: 'draft_plan', context: { engagement_id: e.id } }, deps)
		).toThrow(/already running/);
		cancelJob(app, human, first.job.id);
		await first.done;

		assignModels(app, human, { default: null });
		expect(() =>
			startJob(app, human, { action: 'draft_plan', context: { engagement_id: e.id } }, deps)
		).toThrow(/No model is set/);
	});

	it("uses the engagement's llm_profile model", async () => {
		updateEngagement(app, human, e.id, getEngagement(app, e.id).version, { llm_profile: 'fake-broken' });
		const job = await run('draft_plan');
		expect(job.model).toBe('fake-broken');
	});

	it('a job can be cancelled; what it proposed so far stays', async () => {
		assignModels(app, human, { default: 'fake-slow' });
		const { job, done } = startJob(
			app,
			human,
			{ action: 'draft_plan', context: { engagement_id: e.id } },
			deps
		);
		cancelJob(app, human, job.id);
		await done;
		expect(getJob(app, job.id).status).toBe('cancelled');
	});

	it('only the starter or an admin can cancel', async () => {
		assignModels(app, human, { default: 'fake-slow' });
		const { job, done } = startJob(
			app,
			other,
			{ action: 'draft_plan', context: { engagement_id: e.id } },
			deps
		);
		cancelJob(app, human, job.id); // admin
		await done;
		expect(getJob(app, job.id).status).toBe('cancelled');

		const second = startJob(app, human, { action: 'draft_plan', context: { engagement_id: e.id } }, deps);
		expect(() => cancelJob(app, other, second.job.id)).toThrow(/Only the person who started/);
		cancelJob(app, human, second.job.id);
		await second.done;
	});

	it('reports gateway failures clearly', async () => {
		assignModels(app, human, { default: 'fake-broken' });
		const job = await run('draft_plan');
		expect(job.status).toBe('failed');
		expect(job.error).toBe('The AI gateway answered 500: Upstream model exploded');
	});

	it('keeps the model on its engagement and its own tools', async () => {
		const otherEngagement = '00000000-0000-0000-0000-000000000000';
		let turn = 0;
		const sneaky: FetchLike = async () => {
			turn += 1;
			const calls =
				turn === 1
					? [
							{
								id: 'a',
								type: 'function',
								function: {
									name: 'list_artifacts',
									arguments: JSON.stringify({ engagement_id: otherEngagement })
								}
							},
							{ id: 'b', type: 'function', function: { name: 'revert', arguments: '{}' } },
							{ id: 'c', type: 'function', function: { name: 'list_artifacts', arguments: 'not json' } }
						]
					: [];
			return new Response(
				JSON.stringify({ choices: [{ message: { content: calls.length ? null : 'ok', tool_calls: calls } }] })
			);
		};
		const { job, done } = startJob(
			app,
			human,
			{ action: 'derive_roles', context: { engagement_id: e.id } },
			{ fetch: sneaky, env }
		);
		await done;
		const steps = getJob(app, job.id).steps.filter((s) => s.kind === 'tool');
		expect(steps.map((s) => s.ok)).toEqual([false, false, false]);
		expect(steps[0]!.text).toContain('works only on engagement');
		expect(steps[1]!.text).toContain('not available to this action');
	});

	it('a restart closes jobs that were running', async () => {
		assignModels(app, human, { default: 'fake-slow' });
		const { job, done } = startJob(
			app,
			human,
			{ action: 'draft_plan', context: { engagement_id: e.id } },
			deps
		);
		expect(failInterruptedJobs(app)).toBe(1);
		expect(getJob(app, job.id)).toMatchObject({
			status: 'failed',
			error: expect.stringContaining('restarted')
		});
		cancelJob(app, human, job.id);
		await done;
	});

	it('sends the assistant message back as the gateway returned it, thinking blocks included', async () => {
		const bodies: { messages: Record<string, unknown>[] }[] = [];
		const thinking = [{ type: 'thinking', thinking: '', signature: 'sig-abc' }];
		const claudeLike: FetchLike = async (_url, init) => {
			const body = JSON.parse(String(init?.body));
			bodies.push(body);
			const first = bodies.length === 1;
			return new Response(
				JSON.stringify({
					choices: [
						{
							finish_reason: first ? 'tool_calls' : 'stop',
							message: first
								? {
										role: 'assistant',
										content: null,
										thinking_blocks: thinking,
										tool_calls: [
											{ id: 't1', type: 'function', function: { name: 'list_artifacts', arguments: '{}' } }
										]
									}
								: { role: 'assistant', content: 'Nothing to propose.' }
						}
					]
				})
			);
		};
		const { job, done } = startJob(
			app,
			human,
			{ action: 'derive_roles', context: { engagement_id: e.id } },
			{ fetch: claudeLike, env }
		);
		await done;
		expect(getJob(app, job.id).status).toBe('succeeded');
		const assistant = bodies[1]!.messages.find((m) => m.role === 'assistant')!;
		expect(assistant.thinking_blocks).toEqual(thinking);
		expect(bodies[0]).toMatchObject({ max_tokens: 16000, tool_choice: 'auto' });
	});

	it("a model's refusal ends the job with a clear message", async () => {
		const refusing: FetchLike = async () =>
			new Response(
				JSON.stringify({
					choices: [{ finish_reason: 'content_filter', message: { role: 'assistant', content: '' } }]
				})
			);
		const { job, done } = startJob(
			app,
			human,
			{ action: 'derive_roles', context: { engagement_id: e.id } },
			{ fetch: refusing, env }
		);
		await done;
		expect(getJob(app, job.id)).toMatchObject({
			status: 'failed',
			error: expect.stringContaining('declined to continue')
		});
	});
});
