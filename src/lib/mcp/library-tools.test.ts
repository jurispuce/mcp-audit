import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { createPersonalToken, resolvePersonalToken } from '#lib/domain/auth.ts';
import { getSourceByCode, searchRequirements } from '#lib/domain/library.ts';
import { uploadLibraryDocuments } from '#lib/domain/library-documents.ts';
import { importBuiltInSource } from '#lib/domain/library-import.ts';
import { mappingOf, publishSource } from '#lib/domain/library-review.ts';
import { createFirstAdmin } from '#lib/domain/users.ts';
import type { Actor } from '#lib/domain/write.ts';
import { makePdf } from '../../../tests/fixtures/make-docs';
import { createMcpServer } from './server';

let app: AppDatabase;
let human: Actor;
let client: Client;
let dir: string;

async function call(name: string, args: Record<string, unknown> = {}) {
	const res = (await client.callTool({ name, arguments: args })) as {
		isError?: boolean;
		content: { text: string }[];
	};
	const text = res.content[0]?.text ?? '';
	return { isError: !!res.isError, text, data: res.isError ? null : JSON.parse(text) };
}

beforeEach(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'mcpa-lib-'));
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Juris',
		email: 'juris@example.test',
		password: 'correct horse battery'
	});
	human = { userId: a.id, channel: 'ui' };
	importBuiltInSource(app, human, 'nis2-art21.yaml');
	const { token } = createPersonalToken(app, human, 'Claude');
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
});

describe('library import and mapping through MCP (#72, #74)', () => {
	it('reads a library document, imports a proposed source, maps it with reasons, and lists what waits', async () => {
		const [up] = await uploadLibraryDocuments(app, human, dir, [
			{
				name: 'mk397.pdf',
				type: 'application/pdf',
				bytes: makePdf(['5. Risk management', '5.1 Assess risks once a year. 6. Access control.'])
			}
		]);
		const docs = (await call('list_library_documents')).data.documents;
		expect(docs).toMatchObject([{ id: up!.document!.id, filename: 'mk397.pdf', text: 'extracted' }]);
		const page = (await call('get_library_document_text', { document_id: docs[0].id })).data;
		expect(page).toMatchObject({ locator: 'p. 1-2', next_offset: null });
		expect(page.text).toContain('Access control');

		const src = await call('upsert_sources', {
			sources: [
				{ code: 'mk397', title: 'MK noteikumi Nr. 397', type: 'law', language: 'lv', document_id: docs[0].id }
			]
		});
		expect(src.data.sources[0]).toMatchObject({ status: 'proposed', result: 'created' });
		expect(
			(await call('upsert_sources', { sources: [{ code: 'x', title: 'X', document_id: 'nope' }] })).text
		).toContain('not found');
		await call('upsert_requirements', {
			source: 'mk397',
			requirements: [
				{ ref: '5', title: 'Riska pārvaldība' },
				{ ref: '5.1', title: 'Riska novērtējums reizi gadā', parent: '5' },
				{ ref: '6', title: 'Piekļuves kontrole' }
			]
		});
		// Claude can find its own proposals; the library search for people cannot.
		expect((await call('search_requirements', { query: 'piekļuves' })).data.results[0]).toMatchObject({
			ref: '6',
			status: 'proposed'
		});
		expect(searchRequirements(app, 'piekļuves')).toEqual([]);

		const link = await call('link_requirements', {
			links: [
				{
					from: 'mk397:6',
					to: 'nis2:Art. 21(2)(i)',
					type: 'implements',
					coverage: 'partial',
					note: 'Both require access control rules'
				}
			]
		});
		expect(link.data.links[0]).toMatchObject({ status: 'created', review: 'proposed' });
		const waiting = (await call('list_library_proposals')).data;
		expect(waiting).toMatchObject({
			imports: [{ code: 'mk397', requirements: 3, proposed: 3 }],
			mappings: [{ from: 'mk397', to: 'nis2', proposed: 1 }]
		});

		publishSource(app, human, getSourceByCode(app, 'mk397')!.id);
		expect(mappingOf(app, getSourceByCode(app, 'mk397')!.id, getSourceByCode(app, 'nis2')!.id)).toMatchObject(
			{ mapped: 0, proposed: 1 }
		);
		expect((await call('list_library_documents')).data.documents[0].sources).toEqual([
			{ code: 'mk397', status: 'active' }
		]);
	});
});
