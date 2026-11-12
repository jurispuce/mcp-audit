import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { createPersonalToken, resolvePersonalToken } from '#lib/domain/auth.ts';
import { listArtifacts } from '#lib/domain/artifacts.ts';
import type { Engagement } from '#lib/domain/engagements.ts';
import { listLinks } from '#lib/domain/execution.ts';
import { listFindings } from '#lib/domain/findings.ts';
import { listEvents, listEvidence } from '#lib/domain/planning.ts';
import { seedTestData } from '#lib/domain/seed.ts';
import { createMcpServer } from './server';

let app: AppDatabase;
let client: Client;
let e: Engagement;
let dir: string;
const previous = process.env.DATA_DIR;

async function call(name: string, args: Record<string, unknown> = {}) {
	const res = (await client.callTool({ name, arguments: args })) as {
		isError?: boolean;
		content: { text: string }[];
	};
	const text = res.content[0]?.text ?? '';
	return { isError: !!res.isError, text, data: res.isError ? null : JSON.parse(text) };
}

beforeEach(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'mcpa-run-mcp-'));
	process.env.DATA_DIR = dir;
	app = createTestDatabase();
	const seeded = await seedTestData(app, { TEST_SEED_ENABLED: 'true', DATA_DIR: dir });
	e = seeded.engagement;
	const { token } = createPersonalToken(app, { userId: seeded.users[0]!.id, channel: 'ui' }, 'Claude');
	const server = createMcpServer(app, resolvePersonalToken(app, token)!.user);
	const [c, s] = InMemoryTransport.createLinkedPair();
	await server.connect(s);
	client = new Client({ name: 't', version: '1' });
	await client.connect(c);
});
afterEach(async () => {
	await client.close();
	app.close();
	rmSync(dir, { recursive: true, force: true });
	process.env.DATA_DIR = previous;
});

describe('execution tools (#60)', () => {
	it('writes notes from a transcript with effects, and proposes evidence links', async () => {
		const ev = listEvents(app, e.id)[0]!;
		const status = (await call('get_event_status', { engagement_id: e.id, event_id: ev.id })).data;
		const leavers = status.evidence.find((x: { text: string }) => x.text.startsWith('Leaver'));
		const head = (await call('get_engagement_overview', { engagement_id: e.id })).data.people.find(
			(p: { role: string }) => p.role === 'Head of IT'
		);
		const notes = await call('upsert_notes', {
			engagement_id: e.id,
			event_id: ev.id,
			notes: [
				{
					text: 'Leavers are disabled by the service desk (from transcript, 04:10)',
					at: '2026-11-17T10:04:10Z'
				},
				{
					type: 'promise',
					text: 'Inferred promise: Head of IT sends the leaver list',
					due: '2026-11-20',
					mentions: [
						{ type: 'person', id: head.id, label: 'Head of IT' },
						{ type: 'evidence_item', id: leavers.id, label: leavers.text }
					]
				},
				{
					type: 'note',
					text: 'They follow a supplier register',
					mentions: [{ type: 'artifact', id: '', label: 'Supplier register' }]
				}
			]
		});
		expect(notes.data.notes.map((n: { effects: string[] }) => n.effects.length)).toEqual([0, 1, 1]);
		expect(listEvidence(app, e.id).find((x) => x.id === leavers.id)).toMatchObject({
			status: 'promised',
			promisedDue: '2026-11-20'
		});
		expect(
			listArtifacts(app, e.id).some((a) => a.displayName === 'Supplier register' && a.state === 'mentioned')
		).toBe(true);

		const t = (
			await call('register_artifact', {
				engagement_id: e.id,
				title: 'Transcript',
				text: 'leaver list shown',
				kind: 'transcript'
			})
		).data;
		const link = await call('link_evidence', {
			engagement_id: e.id,
			links: [{ artifact_id: t.id, evidence_item_id: leavers.id, sufficiency: 'supports', locator: '04:10' }]
		});
		expect(link.data.links[0]).toMatchObject({ status: 'proposed', created: true });
		expect(
			(
				await call('link_evidence', {
					engagement_id: e.id,
					links: [{ artifact_id: t.id, evidence_item_id: leavers.id, sufficiency: 'supports' }]
				})
			).data.links[0].created
		).toBe(false);
		expect(listLinks(app, e.id)[0]!.status).toBe('proposed');
		expect(listEvidence(app, e.id).find((x) => x.id === leavers.id)!.status).toBe('promised');

		const report = (await call('render_post_event_report', { engagement_id: e.id, event_id: ev.id })).data
			.markdown;
		expect(report).toContain('Pārskats pēc tikšanās');
		expect(report).not.toContain('Inferred');
	});
});

describe('conclusion tools (#60)', () => {
	it('lists and reads units, proposes findings within the rules, renders the report; never approves', async () => {
		const units = (await call('list_assessment_units', { engagement_id: e.id })).data;
		expect(units.units).toHaveLength(8);
		expect(units.finding_scale.map((v: { code: string }) => v.code)).toEqual([
			'na',
			'c',
			'cp',
			'cn',
			'minor',
			'major'
		]);
		const u = units.units.find(
			(x: { ref: string; scope: string }) => x.ref === 'nis2:Art. 21(2)(i)' && x.scope === 'Head office'
		);
		const card = (await call('get_assessment_unit', { engagement_id: e.id, unit_id: u.id })).data;
		expect(card.requirement.text).toContain('access control');
		expect(card.evidence).toHaveLength(2);

		const nc = await call('propose_finding', {
			engagement_id: e.id,
			unit_id: u.id,
			value: 'major',
			rationale: 'Leaver list missing'
		});
		expect(nc.text).toContain('no reasonable assurance');
		const na = await call('propose_finding', {
			engagement_id: e.id,
			unit_id: u.id,
			value: 'na',
			rationale: 'Leaver list not received.',
			confidence: 'high'
		});
		expect(na.data).toMatchObject({ status: 'proposed', value: 'na' });
		expect(listFindings(app, e.id)[0]).toMatchObject({ status: 'proposed' });
		expect(
			(await call('propose_finding', { engagement_id: e.id, unit_id: u.id, value: 'zz', rationale: 'x' }))
				.text
		).toContain('No finding value');

		const md = (await call('render_findings_report', { engagement_id: e.id, include_drafts: true })).data;
		expect(md).toMatchObject({ approved: 0, units: 8 });
		const pdf = (await call('render_findings_report', { engagement_id: e.id, format: 'pdf' })).data;
		expect(pdf.filename).toMatch(/^findings-report-/);

		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name).filter((n) => /approve|confirm|accept/.test(n))).toEqual([]);
	});
});
