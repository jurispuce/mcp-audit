import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { uploadArtifacts } from '#lib/domain/artifacts.ts';
import { createPersonalToken, resolvePersonalToken } from '#lib/domain/auth.ts';
import { createEngagement, updateEngagement, type Engagement } from '#lib/domain/engagements.ts';
import { addInternal, listInternal } from '#lib/domain/internal.ts';
import { getItemHistory } from '#lib/domain/items.ts';
import { importBuiltInSource } from '#lib/domain/library-import.ts';
import { listPeople } from '#lib/domain/people.ts';
import { listAssessmentUnits } from '#lib/domain/selection.ts';
import { createFirstAdmin } from '#lib/domain/users.ts';
import type { Actor } from '#lib/domain/write.ts';
import { makePdf } from '../../../tests/fixtures/make-docs';
import { createMcpServer } from './server';

let app: AppDatabase;
let human: Actor;
let client: Client;
let e: Engagement;
let dataDir: string;
const previousDataDir = process.env.DATA_DIR;

async function call(name: string, args: Record<string, unknown> = {}) {
	const res = (await client.callTool({ name, arguments: args })) as {
		isError?: boolean;
		content: { text: string }[];
	};
	const text = res.content[0]?.text ?? '';
	return { isError: !!res.isError, text, data: res.isError ? null : JSON.parse(text) };
}

beforeEach(async () => {
	dataDir = mkdtempSync(path.join(tmpdir(), 'mcpa-mcp-'));
	process.env.DATA_DIR = dataDir; // register_artifact stores files under DATA_DIR/files
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Juris',
		email: 'juris@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	importBuiltInSource(app, human, 'nis2-art21.yaml');
	e = createEngagement(app, human, {
		name: 'NIS 2 audit',
		auditeeName: 'Baltic Freight SIA',
		startDate: '2026-11-16'
	});
	const { token } = createPersonalToken(app, human, 'Claude');
	const server = createMcpServer(app, resolvePersonalToken(app, token)!.user);
	const [c, s] = InMemoryTransport.createLinkedPair();
	await server.connect(s);
	client = new Client({ name: 'test', version: '1' });
	await client.connect(c);
});
afterEach(async () => {
	await client.close();
	app.close();
	rmSync(dataDir, { recursive: true, force: true });
	process.env.DATA_DIR = previousDataDir;
});

describe('orientation (#43)', () => {
	it('list_engagements and get_engagement_overview return real data', async () => {
		expect((await call('list_engagements')).data.engagements).toMatchObject([
			{ id: e.id, name: 'NIS 2 audit', auditee: 'Baltic Freight SIA', plan_status: 'draft', ai_allowed: true }
		]);
		const o = (await call('get_engagement_overview', { engagement_id: e.id })).data;
		expect(o.engagement).toMatchObject({ id: e.id, scope_mode: 'single' });
		expect(o.phases).toHaveLength(8);
		expect(o.next).toBe('Phase 2: Select requirements');
		expect(o.scopes).toMatchObject([{ name: 'Baltic Freight SIA', units: 0 }]);
	});
});

describe('set-up tools (#43)', () => {
	it('selects requirements, sets scopes and handling, and regenerates assessment units', async () => {
		const sel = await call('select_requirements', {
			engagement_id: e.id,
			select: ['nis2:Art. 21(2)(b)', 'nis2:Art. 21(2)(c)', 'nis2:Art. 21(2)(i)']
		});
		expect(sel.data).toMatchObject({ selected: 3, assessment_units: 3 });
		const scopes = await call('upsert_scopes', {
			engagement_id: e.id,
			mode: 'multiple',
			scopes: [{ name: 'Baltic Freight SIA', description: 'Head office' }, { name: 'Warehouse' }]
		});
		expect(scopes.data.scopes.map((s: { status: string }) => s.status)).toEqual(['updated', 'created']);
		const handling = await call('set_scope_handling', {
			engagement_id: e.id,
			items: [{ requirement: 'nis2:Art. 21(2)(i)', handling: 'per_scope' }]
		});
		expect(handling.data).toMatchObject({ changed: 1, assessment_units: 4 });
		expect(listAssessmentUnits(app, e.id)).toHaveLength(4);

		const drop = await call('upsert_scopes', {
			engagement_id: e.id,
			scopes: [{ name: 'Warehouse', drop: true }]
		});
		expect(drop.text).toContain('confirm_units_lost');
		const dropped = await call('upsert_scopes', {
			engagement_id: e.id,
			scopes: [{ name: 'Warehouse', drop: true, confirm_units_lost: true }]
		});
		expect(dropped.data.assessment_units).toBe(3);
		const de = await call('select_requirements', { engagement_id: e.id, deselect: ['nis2:Art. 21(2)(c)'] });
		expect(de.data).toMatchObject({ deselected: 1, assessment_units: 2 });
	});

	it('proposes roles for the auditor to accept, matched by role on a second run', async () => {
		const first = await call('upsert_people', {
			engagement_id: e.id,
			people: [
				{
					role: 'Head of IT',
					responsibilities: ['Approves administrator access'],
					source_document: 'Access control policy',
					source_section: '2.2'
				},
				{ role: 'Human resources', responsibilities: ['Notifies leavers'] }
			]
		});
		expect(first.data.people.map((p: { status: string }) => p.status)).toEqual(['proposed', 'proposed']);
		const again = await call('upsert_people', {
			engagement_id: e.id,
			people: [{ role: 'head of it', name: 'Ilze Kalniņa' }]
		});
		expect(again.data.people[0]).toMatchObject({ created: false });
		const people = listPeople(app, e.auditeeId);
		expect(people).toHaveLength(2);
		expect(people.find((p) => p.role === 'Head of IT')).toMatchObject({
			name: 'Ilze Kalniņa',
			sourceDocument: 'Access control policy',
			status: 'proposed'
		});
		expect(getItemHistory(app, 'person', people[0]!.id)[0]).toMatchObject({
			authorAgent: 'Claude',
			channel: 'mcp'
		});
	});

	it('records risks against selected requirements, and criticality follows', async () => {
		await call('select_requirements', {
			engagement_id: e.id,
			select: ['nis2:Art. 21(2)(i)', 'nis2:Art. 21(2)(j)']
		});
		const res = await call('upsert_risks', {
			engagement_id: e.id,
			risks: [
				{
					title: 'Leaver accounts stay active',
					level: 'high',
					origin: 'auditor',
					requirements: ['nis2:Art. 21(2)(i)']
				}
			]
		});
		expect(res.data.risks[0]).toMatchObject({ created: true, level: 'high' });
		expect(
			(
				await call('upsert_risks', {
					engagement_id: e.id,
					risks: [{ title: 'X', requirements: ['nis2:Art. 21(2)(a)'] }]
				})
			).text
		).toContain('selected');
		const o = (await call('get_engagement_overview', { engagement_id: e.id })).data;
		expect(o.requirements.find((r: { ref: string }) => r.ref === 'nis2:Art. 21(2)(i)')).toMatchObject({
			criticality: 'high',
			criticality_from: 'risk'
		});
	});

	it('refuses to work on an engagement where AI is switched off', async () => {
		updateEngagement(app, human, e.id, e.version, { ai_allowed: false });
		for (const [tool, args] of [
			['get_engagement_overview', {}],
			['list_artifacts', {}],
			['select_requirements', { select: ['nis2:Art. 21(2)(b)'] }],
			['upsert_people', { people: [{ role: 'CISO' }] }]
		] as const) {
			const res = await call(tool, { engagement_id: e.id, ...args });
			expect(res.text, tool).toContain('switched off');
		}
	});
});

describe('artifact tools (#43)', () => {
	it('lists documents, reads text in pages with locators and registers transcripts', async () => {
		const [up] = await uploadArtifacts(app, human, path.join(dataDir, 'files'), e.id, [
			{
				name: 'policy.pdf',
				type: 'application/pdf',
				bytes: makePdf([
					'Access is reviewed every six months.',
					'Leavers are disabled within one working day.'
				])
			}
		]);
		const list = (await call('list_artifacts', { engagement_id: e.id })).data.artifacts;
		expect(list).toMatchObject([
			{ id: up!.artifact!.id, filename: 'policy.pdf', state: 'received', text: 'extracted' }
		]);
		const page = (await call('get_artifact_text', { engagement_id: e.id, artifact_id: up!.artifact!.id }))
			.data;
		expect(page).toMatchObject({ locator: 'p. 1-2', next_offset: null });
		expect(page.text).toContain('one working day');

		const t = await call('register_artifact', {
			engagement_id: e.id,
			title: 'Interview with the Head of IT',
			text: 'Leavers are disabled the same day by the service desk.',
			kind: 'transcript',
			received_from: 'Fireflies'
		});
		expect(t.data).toMatchObject({ state: 'received', text: 'extracted' });
		const m = await call('register_artifact', {
			engagement_id: e.id,
			title: 'Supplier register',
			mentioned: true
		});
		expect(m.data).toMatchObject({ state: 'mentioned', text: 'none' });
		expect((await call('get_artifact_text', { engagement_id: e.id, artifact_id: m.data.id })).text).toContain(
			'mentioned'
		);

		// A document of another engagement cannot be read through this one.
		const other = createEngagement(app, human, {
			name: 'Other',
			auditeeName: 'Other SIA',
			startDate: '2026-11-16'
		});
		expect(
			(await call('get_artifact_text', { engagement_id: other.id, artifact_id: up!.artifact!.id })).text
		).toContain('not found');
	});

	it('proposes internal requirements from a document, linked to what they implement', async () => {
		const [up] = await uploadArtifacts(app, human, path.join(dataDir, 'files'), e.id, [
			{
				name: 'policy.txt',
				type: 'text/plain',
				bytes: new TextEncoder().encode('4.2 Accounts of leavers are disabled within one working day.')
			}
		]);
		const res = await call('upsert_internal_requirements', {
			engagement_id: e.id,
			artifact_id: up!.artifact!.id,
			requirements: [
				{
					title: 'Leaver accounts disabled within one working day',
					quote: 'Accounts of leavers are disabled within one working day.',
					section: '4.2',
					implements: [{ requirement: 'nis2:Art. 21(2)(i)', coverage: 'partial' }]
				}
			]
		});
		expect(res.data.internal_requirements).toMatchObject([
			{ ref: 'INT-1', status: 'proposed', created: true }
		]);
		const update = await call('upsert_internal_requirements', {
			engagement_id: e.id,
			requirements: [
				{
					ref: 'INT-1',
					title: 'Leaver accounts disabled within one working day',
					implements: [{ requirement: 'nis2:Art. 21(2)(j)', coverage: 'partial' }]
				}
			]
		});
		expect(update.data.internal_requirements[0]).toMatchObject({ created: false });
		const listed = (await call('list_internal_requirements', { engagement_id: e.id })).data
			.internal_requirements;
		expect(listed[0]).toMatchObject({
			ref: 'INT-1',
			section: '4.2',
			status: 'proposed',
			document: { id: up!.artifact!.id }
		});
		expect(listed[0].implements.map((l: { ref: string }) => l.ref)).toEqual([
			'nis2:Art. 21(2)(i)',
			'nis2:Art. 21(2)(j)'
		]);
		expect(listInternal(app, e.id)[0]!.status).toBe('proposed');
	});

	it('never reaches another auditee’s internal requirements', async () => {
		const other = createEngagement(app, human, {
			name: 'Other',
			auditeeName: 'Other SIA',
			startDate: '2026-11-16'
		});
		const secret = addInternal(app, human, other.id, { title: 'Their secret rule' });
		expect((await call('get_requirement', { requirement: secret.id, engagement_id: e.id })).text).toContain(
			'another auditee'
		);
		expect(
			(await call('get_requirement', { requirement: secret.id, engagement_id: other.id })).data.title
		).toBe('Their secret rule');
		expect(
			(await call('get_history', { entity_type: 'requirement', entity_id: secret.id, engagement_id: e.id }))
				.text
		).toContain('another auditee');
		const link = await call('upsert_internal_requirements', {
			engagement_id: e.id,
			requirements: [{ title: 'Ours', implements: [{ requirement: secret.id, coverage: 'full' }] }]
		});
		expect(link.text).toContain('another auditee');
		expect(
			(await call('list_internal_requirements', { engagement_id: e.id })).data.internal_requirements
		).toEqual([]);
		// Engagement items are only reachable with their engagement.
		expect((await call('get_history', { entity_type: 'engagement', entity_id: e.id })).text).toContain(
			'another auditee'
		);
		expect(
			(await call('get_history', { entity_type: 'engagement', entity_id: e.id, engagement_id: e.id })).isError
		).toBe(false);
	});
});
