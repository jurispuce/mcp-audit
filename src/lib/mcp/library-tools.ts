import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AppDatabase } from '#lib/db/client.ts';
import { getLibraryDocumentText, listLibraryDocuments } from '#lib/domain/library-documents.ts';
import { listLibraryProposals } from '#lib/domain/library-review.ts';

type Run = (fn: () => unknown) => CallToolResult;

/** Reading library documents and what waits for review (#72, #74). Shared library: no engagement. */
export function registerLibraryImportTools(server: McpServer, app: AppDatabase, run: Run) {
	server.registerTool(
		'list_library_documents',
		{
			title: 'List library documents',
			description:
				'Files of laws and standards the auditors uploaded to import from, with ids, whether their text could be read, and the sources already imported from them.',
			annotations: { readOnlyHint: true }
		},
		() =>
			run(() => ({
				documents: listLibraryDocuments(app).map((d) => ({
					id: d.id,
					title: d.title,
					filename: d.filename,
					text: d.textStatus,
					text_length: d.textLength,
					sources: d.sources.map((s) => ({ code: s.code, status: s.status }))
				}))
			}))
	);

	server.registerTool(
		'get_library_document_text',
		{
			title: 'Read a library document',
			description:
				'A library document\'s text in pages with a locator ("p. 3" for PDFs). Continue with offset = next_offset until it is null.',
			inputSchema: {
				document_id: z.string().min(1),
				offset: z.number().int().min(0).optional(),
				max_chars: z.number().int().min(500).max(20000).optional()
			},
			annotations: { readOnlyHint: true }
		},
		({ document_id, offset, max_chars }) =>
			run(() => {
				const p = getLibraryDocumentText(app, document_id, offset ?? 0, max_chars ?? 8000);
				return {
					document_id: p.documentId,
					title: p.title,
					locator: p.locator,
					offset: p.offset,
					next_offset: p.nextOffset,
					total_length: p.totalLength,
					text: p.text
				};
			})
	);

	server.registerTool(
		'list_library_proposals',
		{
			title: 'Library proposals',
			description:
				"What waits for the auditor's review in the library: proposed sources (imports), proposed requirement changes in published sources, and proposed mappings with counts.",
			annotations: { readOnlyHint: true }
		},
		() =>
			run(() => {
				const p = listLibraryProposals(app);
				return {
					total: p.total,
					imports: p.sources.map((s) => ({
						code: s.code,
						title: s.title,
						requirements: s.requirementCount,
						proposed: s.proposedCount
					})),
					changes: p.changes.map((c) => ({
						source: c.source.code,
						requirements: c.requirements.map((r) => r.refCode)
					})),
					mappings: p.mappings.map((m) => ({
						from: m.fromCode,
						to: m.toCode,
						proposed: m.proposed,
						confirmed: m.confirmed
					})),
					review_at: 'Library, Review and Library, Mapping in the app'
				};
			})
	);
}
