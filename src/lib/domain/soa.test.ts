import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { createMcpServer } from '#lib/mcp/server.ts';
import './entities';
import { registerTextArtifact, updateArtifact } from './artifacts';
import { createEngagement, type Engagement } from './engagements';
import { ForbiddenError, ValidationError } from './errors';
import { getItemHistory } from './items';
import { findRequirement, getSourceByCode } from './library';
import { importSourceYaml } from './library-import';
import { addEvent } from './planning';
import { addRisk, listRisks } from './risks';
import { removeFromScope } from './scope-changes';
import { listSelected, selectRequirements } from './selection';
import { keepInScope, recordSoa, soaCheck, usesSoa } from './soa';
import { createFirstAdmin } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let human: Actor;
let ai: Actor;
let e: Engagement;
let files: string;

// Codes only: a stand-in for an ISO/IEC 27001 source (titles are invented).
const ISO = `id: iso27001-test\ntitle: ISO/IEC 27001 test controls\ntype: standard\nlanguage: en\nrequirements:\n${[
	'6.1',
	'A.5',
	'A.5.1',
	'A.5.2',
	'A.7',
	'A.7.1',
	'A.7.2',
	'A.8.1'
]
	.map((r) => `  - {id: "${r}", title: Control ${r}}`)
	.join('\n')}\n`;
const iso = (ref: string) => findRequirement(app, getSourceByCode(app, 'iso27001-test')!.id, ref)!.id;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	ai = { userId: a.id, agent: 'Claude', channel: 'mcp' };
	importSourceYaml(app, human, ISO, { fileName: 'iso.yaml' });
	e = createEngagement(app, human, { name: 'ISO audit', auditeeName: 'Peak SIA', startDate: '2026-11-16' });
	files = mkdtempSync(path.join(tmpdir(), 'mcpa-soa-'));
});
afterEach(() => {
	app.close();
	rmSync(files, { recursive: true, force: true });
});

function soaDoc() {
	const d = registerTextArtifact(app, human, files, e.id, {
		title: 'SoA v1.1',
		text: 'A.5.1 | Yes\nA.7.1 | No'
	});
	return updateArtifact(app, human, d.id, d.version, { kind: 'statement_of_applicability' });
}

describe('Statement of Applicability check (#81)', () => {
	it('is only relevant to ISO/IEC 27001 and 27701 audits, and needs an SoA document', () => {
		expect(usesSoa({ code: 'iso27001-2022', title: 'x' })).toBe(true);
		expect(usesSoa({ code: 'x', title: 'ISO/IEC 27701:2019' })).toBe(true);
		expect(usesSoa({ code: 'nis2', title: 'NIS 2 Directive' })).toBe(false);
		expect(soaCheck(app, e.id)).toMatchObject({ relevant: false, soa: null });
		selectRequirements(app, human, e.id, [iso('A.5.1')]);
		expect(soaCheck(app, e.id)).toMatchObject({ relevant: true, soa: null, entries: 0, conflicts: [] });
	});

	it('flags selected controls the SoA excludes or does not list; the auditor keeps or removes them', () => {
		selectRequirements(app, human, e.id, ['6.1', 'A.5.1', 'A.5.2', 'A.7.1', 'A.7.2'].map(iso));
		const doc = soaDoc();
		// Only a document marked as SoA, only ISO controls.
		const other = registerTextArtifact(app, human, files, e.id, { title: 'Policy', text: 'x' });
		expect(() =>
			recordSoa(app, ai, e.id, other.id, [{ requirementId: iso('A.5.1'), applicable: true }])
		).toThrow(/not marked as a Statement of applicability/);
		expect(
			recordSoa(app, ai, e.id, doc.id, [
				{ requirementId: iso('A.5.1'), applicable: true, implementation: 'Implemented', locator: 'row 3' },
				{ requirementId: iso('A.5.2'), applicable: true },
				{
					requirementId: iso('A.7.1'),
					applicable: false,
					justification: 'Fully remote company, no offices.',
					locator: 'row 9'
				},
				{ requirementId: iso('A.8.1'), applicable: true }
			])
		).toEqual({ recorded: 4, updated: 0 });

		let c = soaCheck(app, e.id);
		expect(c.entries).toBe(4);
		// 6.1 is a clause, not an Annex control: not expected in the SoA.
		expect(c.conflicts.map((x) => [x.refCode, x.kind, x.justification])).toEqual([
			['A.7.1', 'excluded', 'Fully remote company, no offices.'],
			['A.7.2', 'missing', null]
		]);
		expect(c.applicableNotInScope.map((x) => x.refCode)).toEqual(['A.8.1']);

		// Deciding is the auditor's: AI cannot keep in scope, and a reason is required.
		expect(() => keepInScope(app, ai, e.id, iso('A.7.1'), 'x')).toThrow(ForbiddenError);
		expect(() => keepInScope(app, human, e.id, iso('A.7.1'), ' ')).toThrow(ValidationError);
		keepInScope(
			app,
			human,
			e.id,
			iso('A.7.1'),
			'Test that the exclusion holds: a shared co-working desk is used.'
		);
		removeFromScope(app, human, e.id, [iso('A.7.2')], 'Not in the Statement of Applicability');
		c = soaCheck(app, e.id);
		expect(c.conflicts.map((x) => [x.refCode, x.kept?.note ?? null])).toEqual([
			['A.7.1', 'Test that the exclusion holds: a shared co-working desk is used.']
		]);
		expect(listSelected(app, e.id).map((s) => s.refCode)).not.toContain('A.7.2');

		// Recording the same control again updates it, so history shows the change.
		expect(
			recordSoa(app, ai, e.id, doc.id, [
				{ requirementId: iso('A.5.2'), applicable: false, justification: 'Now excluded' }
			])
		).toEqual({ recorded: 0, updated: 1 });
		expect(soaCheck(app, e.id).conflicts.map((x) => x.refCode)).toEqual(['A.5.2', 'A.7.1']);
	});
});

describe('removing requirements from the audit scope (#82)', () => {
	it('records the reason, takes them off risks, and never loses an event, evidence or finding', () => {
		selectRequirements(app, human, e.id, ['A.5.1', 'A.7.1', 'A.7.2'].map(iso));
		const risk = addRisk(app, human, e.id, {
			title: 'Break-in',
			requirement_ids: [iso('A.7.1'), iso('A.5.1')]
		});
		addEvent(app, human, e.id, { title: 'Policy interview', requirement_ids: [iso('A.5.1')] });

		expect(() => removeFromScope(app, ai, e.id, [iso('A.7.1')], 'x')).toThrow(ForbiddenError);
		expect(() => removeFromScope(app, human, e.id, [iso('A.7.1')], '')).toThrow(/Say why/);
		expect(() => removeFromScope(app, human, e.id, [iso('A.5.1')], 'x')).toThrow(
			'A.5.1 is in "Policy interview"; take it out of the event first.'
		);

		expect(
			removeFromScope(app, human, e.id, [iso('A.7.1'), iso('A.7.2')], 'No site visit in this audit')
		).toEqual({ removed: 2 });
		expect(listSelected(app, e.id).map((s) => s.refCode)).toEqual(['A.5.1']);
		const sel = app.sqlite
			.prepare('SELECT id FROM engagement_requirement WHERE requirement_id = ?')
			.get(iso('A.7.1')) as { id: string };
		expect(getItemHistory(app, 'engagement_requirement', sel.id)[0]!.note).toBe(
			'Removed from scope: No site visit in this audit'
		);
		expect(listRisks(app, e.id).find((r) => r.id === risk.id)!.requirementIds).toEqual([iso('A.5.1')]);
		// It can be selected again.
		expect(selectRequirements(app, human, e.id, [iso('A.7.1')]).selected).toBe(1);
	});
});

describe('SoA tools through MCP (#81)', () => {
	it('records the SoA and reports the check; the scope decision stays in the app', async () => {
		selectRequirements(app, human, e.id, ['A.5.1', 'A.7.1'].map(iso));
		const doc = soaDoc();
		const server = createMcpServer(app, {
			id: human.userId,
			name: 'Ada',
			email: 'ada@example.test',
			role: 'admin',
			mustChangePassword: false
		});
		const [c, s] = InMemoryTransport.createLinkedPair();
		await server.connect(s);
		const client = new Client({ name: 't', version: '1' });
		await client.connect(c);
		const call = async (name: string, args: Record<string, unknown>) => {
			const r = (await client.callTool({ name, arguments: args })) as {
				isError?: boolean;
				content: { text: string }[];
			};
			return {
				isError: !!r.isError,
				text: r.content[0]!.text,
				data: r.isError ? null : JSON.parse(r.content[0]!.text)
			};
		};
		const rec = await call('record_soa', {
			engagement_id: e.id,
			artifact_id: doc.id,
			entries: [
				{ requirement: 'iso27001-test:A.5.1', applicable: true },
				{ requirement: 'iso27001-test:A.7.1', applicable: false, justification: 'No offices' }
			]
		});
		expect(rec.data).toEqual({ recorded: 2, updated: 0, conflicts: 1 });
		const check = await call('get_soa_check', { engagement_id: e.id });
		expect(check.data.conflicts).toEqual([
			{
				requirement: 'iso27001-test:A.7.1',
				title: 'Control A.7.1',
				kind: 'excluded',
				justification: 'No offices',
				kept_in_scope: null
			}
		]);
		expect((await client.listTools()).tools.map((t) => t.name)).not.toContain('keep_in_scope');
		await client.close();
	});
});

describe('Check scope against SoA, in the app (#81)', () => {
	it('reads the SoA with the scripted gateway, records it, and leaves the scope to the auditor', async () => {
		const { fakeLlmFetch } = await import('../../../e2e/fake-llm.mjs');
		const { assignModels, checkModel, saveGateway } = await import('./ai-settings');
		const { startJob } = await import('#lib/ai/runner.ts');
		const { getJob } = await import('./jobs');
		const fetch = fakeLlmFetch() as never;
		saveGateway(app, human, { baseUrl: 'http://fake' });
		await checkModel(app, human, 'fake-tools', { fetch, env: {} });
		assignModels(app, human, { default: 'fake-tools' });
		selectRequirements(app, human, e.id, ['A.5.1', 'A.7.1', 'A.7.2'].map(iso));
		const d = registerTextArtifact(app, human, files, e.id, {
			title: 'SoA',
			text: 'Control | Title | Applicable | Justification\nA.5.1 | Policies | Yes | Required\nA.7.1 | Perimeters | No | Fully remote\nA.8.1 | Devices | Yes | Laptops\n'
		});
		const soa = updateArtifact(app, human, d.id, d.version, { kind: 'statement_of_applicability' });
		const { job, done } = startJob(
			app,
			human,
			{ action: 'check_soa', context: { engagement_id: e.id, artifact_id: soa.id } },
			{ fetch, env: {} }
		);
		await done;
		const j = getJob(app, job.id);
		expect(j.status, JSON.stringify(j.steps)).toBe('succeeded');
		const c = soaCheck(app, e.id);
		expect(c.entries).toBe(3);
		expect(c.conflicts.map((x) => [x.refCode, x.kind])).toEqual([
			['A.7.1', 'excluded'],
			['A.7.2', 'missing']
		]);
		expect(listSelected(app, e.id)).toHaveLength(3);
	});
});
