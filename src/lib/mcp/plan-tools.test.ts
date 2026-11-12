import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { createPersonalToken, resolvePersonalToken } from '#lib/domain/auth.ts';
import { createEngagement, updateEngagement, type Engagement } from '#lib/domain/engagements.ts';
import { getItemHistory } from '#lib/domain/items.ts';
import { findRequirement, getSourceByCode } from '#lib/domain/library.ts';
import { importBuiltInSource } from '#lib/domain/library-import.ts';
import { addPerson } from '#lib/domain/people.ts';
import { listEvents, listEvidence } from '#lib/domain/planning.ts';
import { addRisk } from '#lib/domain/risks.ts';
import { selectRequirements } from '#lib/domain/selection.ts';
import { createFirstAdmin } from '#lib/domain/users.ts';
import type { Actor } from '#lib/domain/write.ts';
import { createMcpServer } from './server';

let app: AppDatabase;
let human: Actor;
let client: Client;
let e: Engagement;
let dataDir: string;
const previous = process.env.DATA_DIR;
const req = (p: string) => findRequirement(app, getSourceByCode(app, 'nis2')!.id, `Art. 21(2)(${p})`)!.id;

async function call(name: string, args: Record<string, unknown> = {}) {
	const res = (await client.callTool({ name, arguments: args })) as {
		isError?: boolean;
		content: { text: string }[];
	};
	const text = res.content[0]?.text ?? '';
	return { isError: !!res.isError, text, data: res.isError ? null : JSON.parse(text) };
}

beforeEach(async () => {
	dataDir = mkdtempSync(path.join(tmpdir(), 'mcpa-plan-mcp-'));
	process.env.DATA_DIR = dataDir;
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
	selectRequirements(app, human, e.id, [req('b'), req('i'), req('j')]);
	addPerson(app, human, e.auditeeId, { role: 'Head of IT' });
	addRisk(app, human, e.id, { title: 'Leavers', level: 'high', requirement_ids: [req('i')] });
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
	process.env.DATA_DIR = previous;
});

describe('planning tools (#51)', () => {
	it('drafts events and evidence as proposed, matched on a second run, with coverage', async () => {
		const ev = await call('upsert_events', {
			engagement_id: e.id,
			events: [
				{
					title: 'Access interview',
					date: '2026-11-17',
					start_time: '10:00',
					participants: ['head of it'],
					requirements: ['nis2:Art. 21(2)(i)', 'nis2:Art. 21(2)(j)']
				},
				{ title: 'Incident review', format: 'document_review', requirements: ['nis2:Art. 21(2)(b)'] }
			]
		});
		expect(ev.data.events).toMatchObject([
			{ proposed: true, created: true },
			{ proposed: true, created: true }
		]);
		const again = await call('upsert_events', {
			engagement_id: e.id,
			events: [{ title: 'access interview', duration_min: 90 }]
		});
		expect(again.data.events[0]).toMatchObject({ created: false });
		expect(listEvents(app, e.id).find((x) => x.title === 'Access interview')).toMatchObject({
			durationMin: 90,
			participantsLine: 'Head of IT'
		});

		const evd = await call('upsert_evidence_items', {
			engagement_id: e.id,
			items: [
				{
					event_id: ev.data.events[0].id,
					text: 'Leaver list for 2026',
					requirements: ['nis2:Art. 21(2)(i)']
				},
				{
					event_id: ev.data.events[0].id,
					text: 'MFA configuration export',
					kind: 'technical',
					requirements: ['nis2:Art. 21(2)(j)'],
					scope: 'all'
				}
			]
		});
		expect(evd.data.items.map((x: { criticality: string }) => x.criticality)).toEqual(['high', 'medium']);
		expect(listEvidence(app, e.id).every((x) => x.proposed)).toBe(true);
		expect(getItemHistory(app, 'event', ev.data.events[0].id)[0]).toMatchObject({ authorAgent: 'Claude' });

		const cov = (await call('get_coverage', { engagement_id: e.id })).data;
		expect(cov).toMatchObject({ covered: 3, total: 3, uncovered: [] });
		expect(cov.requirements.find((r: { ref: string }) => r.ref === 'nis2:Art. 21(2)(i)')).toMatchObject({
			criticality: 'high',
			events: [{ title: 'Access interview', proposed: true }]
		});

		const list = (await call('list_events', { engagement_id: e.id })).data.events;
		expect(list[0]).toMatchObject({ title: 'Access interview', proposed: true });
		expect(list[0].evidence).toHaveLength(2);
	});

	it('refuses unknown roles, unselected requirements and other engagements; offers no plan status tool', async () => {
		expect(
			(await call('upsert_events', { engagement_id: e.id, events: [{ title: 'x', participants: ['CEO'] }] }))
				.text
		).toContain('upsert_people');
		expect(
			(
				await call('upsert_events', {
					engagement_id: e.id,
					events: [{ title: 'x', requirements: ['nis2:Art. 21(2)(a)'] }]
				})
			).text
		).toContain('selected');
		const other = createEngagement(app, human, {
			name: 'Other',
			auditeeName: 'Other SIA',
			startDate: '2026-11-16'
		});
		const ev = await call('upsert_events', { engagement_id: e.id, events: [{ title: 'Mine' }] });
		expect(
			(
				await call('upsert_evidence_items', {
					engagement_id: other.id,
					items: [{ event_id: ev.data.events[0].id, text: 'x' }]
				})
			).text
		).toContain('not found');
		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name).filter((n) => /plan_status|set_status|approve|agree/.test(n))).toEqual(
			[]
		);
		updateEngagement(app, human, e.id, e.version, { ai_allowed: false });
		expect((await call('get_coverage', { engagement_id: e.id })).text).toContain('switched off');
	});

	it('renders the plan as Markdown, or saves DOCX and PDF with the engagement documents', async () => {
		await call('upsert_events', {
			engagement_id: e.id,
			events: [{ title: 'Drafted only', requirements: ['nis2:Art. 21(2)(b)'] }]
		});
		const md = (await call('render_audit_plan', { engagement_id: e.id })).data;
		expect(md.markdown).toContain('# Audit plan');
		expect(md.markdown).not.toContain('Drafted only');
		expect(md).toMatchObject({
			drafts_left_out: 1,
			uncovered: ['Art. 21(2)(b)', 'Art. 21(2)(i)', 'Art. 21(2)(j)']
		});
		const pdf = (await call('render_audit_plan', { engagement_id: e.id, format: 'pdf' })).data;
		expect(pdf.filename).toMatch(/^audit-plan-.*\.pdf$/);
		const listed = (await call('list_artifacts', { engagement_id: e.id })).data.artifacts;
		expect(listed).toMatchObject([{ id: pdf.artifact_id, kind: 'generated_report' }]);
	});
});
