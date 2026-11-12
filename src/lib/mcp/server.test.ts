import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { createPersonalToken, resolvePersonalToken } from '#lib/domain/auth.ts';
import { getItemHistory } from '#lib/domain/items.ts';
import {
	getGuidance,
	getSourceByCode,
	findRequirement,
	linksOf,
	requirementDefinition,
	sourceDefinition
} from '#lib/domain/library.ts';
import { importBuiltInSource } from '#lib/domain/library-import.ts';
import { createFirstAdmin } from '#lib/domain/users.ts';
import { createEntity, updateEntity, type Actor } from '#lib/domain/write.ts';
import { createMcpServer } from './server';

let app: AppDatabase;
let human: Actor;
let client: Client;

async function connect() {
	const { token } = createPersonalToken(app, human, 'Claude Desktop');
	const auth = resolvePersonalToken(app, token)!;
	const server = createMcpServer(app, auth.user);
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	await server.connect(serverSide);
	const c = new Client({ name: 'test-client', version: '1.0.0' });
	await c.connect(clientSide);
	return c;
}

async function call(name: string, args: Record<string, unknown> = {}) {
	const res = (await client.callTool({ name, arguments: args })) as {
		isError?: boolean;
		content: { type: string; text: string }[];
	};
	const text = res.content[0]?.text ?? '';
	return { isError: !!res.isError, text, data: res.isError ? null : JSON.parse(text) };
}

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Juris',
		email: 'juris@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	importBuiltInSource(app, human, 'nis2-art21.yaml');
	client = await connect();
});
afterEach(async () => {
	await client.close();
	app.close();
});

describe('MCP endpoint (#30)', () => {
	it('announces itself with instructions and the tool list', async () => {
		expect(client.getServerVersion()?.name).toBe('mcp-audit');
		expect(client.getInstructions()).toContain('on behalf of');
		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual(
			[
				'add_comment',
				'get_artifact_text',
				'get_assessment_unit',
				'get_coverage',
				'get_engagement_overview',
				'get_event_status',
				'get_history',
				'get_requirement',
				'link_evidence',
				'link_requirements',
				'list_assessment_units',
				'list_artifacts',
				'list_engagements',
				'list_events',
				'list_internal_requirements',
				'propose_finding',
				'register_artifact',
				'render_audit_plan',
				'render_findings_report',
				'render_post_event_report',
				'revert',
				'search_requirements',
				'select_requirements',
				'set_criteria',
				'set_guidance',
				'set_scope_handling',
				'upsert_events',
				'upsert_evidence_items',
				'upsert_internal_requirements',
				'upsert_notes',
				'upsert_people',
				'upsert_requirements',
				'upsert_risks',
				'upsert_scopes',
				'upsert_sources'
			].sort()
		);
		for (const t of tools) expect(t.description, t.name).toBeTruthy();
	});

	it('records the token owner as user, the AI as agent and channel MCP on every write', async () => {
		const res = await call('set_guidance', {
			requirement: 'nis2:Art. 21(2)(b)',
			body: 'Ask for the incident log.'
		});
		expect(res.isError).toBe(false);
		const [v1] = getItemHistory(app, 'guidance', res.data.id);
		expect(v1).toMatchObject({ authorUserId: human.userId, authorAgent: 'Claude', channel: 'mcp' });
	});
});

describe('orientation and library tools (#31)', () => {
	it('lists no engagements in an empty database, and refuses an unknown one', async () => {
		expect((await call('list_engagements')).data).toMatchObject({ engagements: [] });
		expect((await call('get_engagement_overview', { engagement_id: 'x' })).isError).toBe(true);
	});

	it('searches requirements compactly with ids', async () => {
		const { data } = await call('search_requirements', { query: 'cryptography' });
		expect(data.results).toHaveLength(1);
		expect(Object.keys(data.results[0]).sort()).toEqual([
			'id',
			'language',
			'ref',
			'snippet',
			'source',
			'title'
		]);
		expect(data.results[0]).toMatchObject({ ref: 'Art. 21(2)(h)', source: 'nis2' });
	});

	it('gets a requirement with parent, children, links, guidance and criteria', async () => {
		const parent = (await call('get_requirement', { requirement: 'nis2:Art. 21(2)' })).data;
		expect(parent.children).toHaveLength(10);
		await call('set_guidance', {
			requirement: 'nis2:Art. 21(2)(h)',
			body: 'Ask for the key management procedure.'
		});
		await call('set_criteria', {
			requirement: 'nis2:Art. 21(2)(h)',
			criteria: [{ text: 'Keys are rotated', expected_evidence: ['Key log'] }]
		});
		const r = (await call('get_requirement', { requirement: 'nis2:Art. 21(2)(h)' })).data;
		expect(r).toMatchObject({
			ref: 'Art. 21(2)(h)',
			parent: { ref: 'Art. 21(2)' },
			guidance: { body: 'Ask for the key management procedure.', version: 1 },
			criteria: [{ text: 'Keys are rotated', expected_evidence: ['Key log'] }]
		});
		expect(r.text).toContain('cryptography');
		expect((await call('get_requirement', { requirement: 'nis2:Art. 99' })).isError).toBe(true);
	});

	it('creates a source and requirements in bulk; upserting again changes only what was given', async () => {
		const src = await call('upsert_sources', {
			sources: [
				{
					code: 'iso27001',
					title: 'ISO/IEC 27001:2022 Annex A',
					type: 'standard',
					licence_note: 'Codes and titles only'
				}
			]
		});
		expect(src.data.sources[0]).toMatchObject({ code: 'iso27001', result: 'created' });
		const first = await call('upsert_requirements', {
			source: 'iso27001',
			requirements: [
				{ ref: 'A.5', title: 'Organizational controls' },
				{ ref: 'A.5.15', title: 'Access control', parent: 'A.5' },
				{ ref: 'A.5.18', title: 'Access rights', parent: 'A.5' }
			]
		});
		expect(first.data.requirements).toEqual({ created: 3, updated: 0, restored: 0, unchanged: 0 });
		const second = await call('upsert_requirements', {
			source: 'iso27001',
			requirements: [{ ref: 'A.5.18', text: 'Licensed text pasted by the auditor' }]
		});
		expect(second.data.requirements).toEqual({ created: 0, updated: 1, restored: 0, unchanged: 0 });
		const a518 = findRequirement(app, getSourceByCode(app, 'iso27001')!.id, 'A.5.18')!;
		expect(a518).toMatchObject({ title: 'Access rights', text: 'Licensed text pasted by the auditor' });
		expect(a518.parentId).not.toBeNull();
		expect(
			(await call('upsert_requirements', { source: 'iso27001', requirements: [{ ref: 'A.9' }] })).text
		).toContain('needs a title');
		expect(
			(await call('upsert_requirements', { source: 'nope', requirements: [{ ref: 'X', title: 'X' }] }))
				.isError
		).toBe(true);
	});

	it('links requirements across sources without duplicating', async () => {
		await call('upsert_sources', { sources: [{ code: 'iso27001', title: 'ISO' }] });
		await call('upsert_requirements', {
			source: 'iso27001',
			requirements: [{ ref: 'A.5.18', title: 'Access rights' }]
		});
		const args = {
			links: [{ from: 'iso27001:A.5.18', to: 'nis2:Art. 21(2)(i)', type: 'implements', coverage: 'partial' }]
		};
		expect((await call('link_requirements', args)).data.links[0].status).toBe('created');
		expect((await call('link_requirements', args)).data.links[0].status).toBe('exists');
		const nis = findRequirement(app, getSourceByCode(app, 'nis2')!.id, 'Art. 21(2)(i)')!;
		expect(linksOf(app, nis.id)).toMatchObject([{ label: 'Implemented by', coverage: 'partial' }]);
		const bad = await call('link_requirements', {
			links: [{ from: 'iso27001:A.5.18', to: 'nis2:Art. 21(2)(j)', type: 'implements' }]
		});
		expect(bad.text).toMatch(/coverage/);
	});

	it('sets criteria by replace and add', async () => {
		const ref = 'nis2:Art. 21(2)(c)';
		await call('set_criteria', {
			requirement: ref,
			criteria: [{ text: 'A' }, { text: 'B', expected_evidence: ['b1'] }]
		});
		const r = await call('set_criteria', {
			requirement: ref,
			criteria: [{ text: 'B', expected_evidence: ['b2'] }, { text: 'C' }]
		});
		expect(r.data).toMatchObject({ added: 1, updated: 1, removed: 1 });
		const a = await call('set_criteria', { requirement: ref, criteria: [{ text: 'D' }], mode: 'add' });
		expect(a.data).toMatchObject({ added: 1, removed: 0 });
		expect(
			(await call('get_requirement', { requirement: ref })).data.criteria.map((c: { text: string }) => c.text)
		).toEqual(['B', 'C', 'D']);
	});
});

describe('comments, history and revert (#32)', () => {
	it('works on any item type, and a revert through MCP is recorded as AI on behalf of the user', async () => {
		const g1 = await call('set_guidance', { requirement: 'nis2:Art. 21(2)(a)', body: 'First' });
		await call('set_guidance', { requirement: 'nis2:Art. 21(2)(a)', body: 'Second', base_version: 1 });
		const id = g1.data.id;
		expect(
			(
				await call('add_comment', {
					entity_type: 'guidance',
					entity_id: id,
					body: 'Changed after the workshop'
				})
			).isError
		).toBe(false);
		const history = (await call('get_history', { entity_type: 'guidance', entity_id: id })).data.versions;
		expect(history.map((v: { version: number }) => v.version)).toEqual([2, 1]);
		expect(history[0]).toMatchObject({ author: 'Claude on behalf of Juris', channel: 'mcp', current: true });

		const rev = await call('revert', {
			entity_type: 'guidance',
			entity_id: id,
			to_version: 1,
			base_version: 2
		});
		expect(rev.data).toMatchObject({ version: 3, reverted_from: 1 });
		const [v3] = getItemHistory(app, 'guidance', id);
		expect(v3).toMatchObject({ summary: 'Reverted to v1', authorAgent: 'Claude', channel: 'mcp' });
		const req = findRequirement(app, getSourceByCode(app, 'nis2')!.id, 'Art. 21(2)(a)')!;
		expect(getGuidance(app, req.id)?.body).toBe('First');

		const req2 = (await call('get_history', { entity_type: 'requirement', entity_id: req.id })).data.versions;
		expect(req2[0].author).toBe('Juris');
		expect(
			(await call('revert', { entity_type: 'guidance', entity_id: id, to_version: 1, base_version: 1 })).text
		).toContain('stale_write');
	});
});

describe('guard rails through MCP (#33)', () => {
	it('stores AI-created internal requirements as proposed and refuses to confirm them', async () => {
		const ai: Actor = { ...human, channel: 'mcp', agent: 'Claude' };
		const internal = createEntity(app, human, sourceDefinition, {
			code: 'acme-policy',
			type: 'internal',
			title: 'Acme policy',
			language: 'en'
		}).row;
		const base = {
			source_id: internal.id,
			title: 'Review access twice a year',
			language: 'en',
			origin: 'internal'
		};
		const proposed = createEntity(app, ai, requirementDefinition, { ...base, ref_code: 'INT-1' });
		expect(proposed.row.status).toBe('proposed');
		expect(() =>
			createEntity(app, ai, requirementDefinition, { ...base, ref_code: 'INT-2', status: 'confirmed' })
		).toThrow(/AI can only propose/);
		// A person confirms it; an AI edit afterwards sends it back to proposed for review.
		const confirmed = updateEntity(app, human, requirementDefinition, String(proposed.row.id), 1, {
			status: 'confirmed'
		});
		expect(confirmed.row.status).toBe('confirmed');
		const edited = updateEntity(app, ai, requirementDefinition, String(proposed.row.id), 2, {
			title: 'Review access every six months'
		});
		expect(edited.row.status).toBe('proposed');
	});

	it('refuses to read an internal requirement of another auditee', async () => {
		const src = createEntity(app, human, sourceDefinition, {
			code: 'acme-int',
			type: 'internal',
			title: 'Acme internal',
			language: 'en',
			auditee_id: 'auditee-acme'
		}).row;
		const req = createEntity(app, human, requirementDefinition, {
			source_id: src.id,
			ref_code: 'INT-9',
			title: 'Secret rule',
			language: 'en',
			origin: 'internal'
		}).row;
		const res = await call('get_requirement', { requirement: String(req.id) });
		expect(res.isError).toBe(true);
		expect(res.text).toContain('another auditee');
		expect(
			(await call('get_history', { entity_type: 'requirement', entity_id: String(req.id) })).text
		).toContain('another auditee');
		expect(
			(await call('add_comment', { entity_type: 'requirement', entity_id: String(req.id), body: 'x' })).text
		).toContain('another auditee');
		expect((await call('search_requirements', { query: 'Secret' })).data.results).toEqual([]);
		expect(
			(
				await call('upsert_requirements', {
					source: 'acme-int',
					requirements: [{ ref: 'INT-9', title: 'x' }]
				})
			).text
		).toContain('internal source');
	});

	it('offers no tool that approves findings, sets plan status or deletes files', async () => {
		const { tools } = await client.listTools();
		for (const t of tools) expect(t.name, t.name).not.toMatch(/approve|plan_status|delete|remove/);
	});
});
