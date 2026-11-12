import type { AppDatabase } from '#lib/db/client.ts';
import { indexText } from '#lib/db/fts.ts';
import { extractText, MAX_FILE_BYTES, pageOf, sha256, storeFile, type UploadFile } from './artifacts';
import { NotFoundError, ValidationError } from './errors';
import { registerEntity } from './registry';
import { createEntity, readRow, updateEntity, type Actor, type EntityDefinition, type Row } from './write';

/**
 * The files of laws and standards kept with the library (#72), so Claude, and later the in-app AI,
 * can read them to import requirements. Shared by every engagement: no client documents here.
 */

const str = (v: unknown) => (v == null ? '' : String(v)).trim();

export const libraryDocumentDefinition: EntityDefinition = registerEntity({
	type: 'library_document',
	table: 'library_document',
	columns: ['title', 'filename', 'file_hash', 'mime_type', 'size', 'text_status'],
	detailColumns: ['title', 'filename', 'text_status', 'file_hash'],
	fieldLabels: {
		title: 'Title',
		filename: 'File',
		text_status: 'Text',
		file_hash: 'SHA-256',
		size: 'Size',
		mime_type: 'Type'
	},
	parse(input, existing) {
		const out: Row = {};
		if (!existing) {
			out.filename = str(input.filename);
			out.file_hash = str(input.file_hash);
			out.mime_type = str(input.mime_type) || null;
			out.size = Number(input.size);
			out.text_status = str(input.text_status);
			if (!out.filename || !/^[0-9a-f]{64}$/.test(String(out.file_hash)))
				throw new ValidationError('A library document needs a stored file.');
		}
		if ('title' in input) out.title = str(input.title) || null;
		return out;
	},
	search: (row) => ({ title: (row.title as string | null) ?? null, filename: row.filename as string }),
	label: (row) => String(row.title || row.filename),
	refLine: (row) => `Library document · ${row.filename}`
});

export interface LibraryDocument {
	id: string;
	title: string;
	filename: string;
	fileHash: string;
	mimeType: string | null;
	size: number;
	textStatus: string;
	textLength: number;
	/** Sources imported from this document. */
	sources: { id: string; code: string; title: string; status: string }[];
	version: number;
	createdAt: Date;
}

export function listLibraryDocuments(app: AppDatabase): LibraryDocument[] {
	const rows = app.sqlite
		.prepare(
			`SELECT d.*, length(t.text) AS text_length FROM library_document d LEFT JOIN library_document_text t ON t.document_id = d.id
			  WHERE d.deleted = 0 ORDER BY d.created_at DESC`
		)
		.all() as Row[];
	const sources = app.sqlite
		.prepare(
			'SELECT id, code, title, status, document_id FROM source WHERE deleted = 0 AND document_id IS NOT NULL'
		)
		.all() as { id: string; code: string; title: string; status: string; document_id: string }[];
	return rows.map((r) => ({
		id: String(r.id),
		title: String(r.title || r.filename),
		filename: String(r.filename),
		fileHash: String(r.file_hash),
		mimeType: (r.mime_type as string | null) ?? null,
		size: Number(r.size),
		textStatus: String(r.text_status),
		textLength: Number(r.text_length ?? 0),
		sources: sources.filter((s) => s.document_id === r.id).map(({ document_id: _d, ...s }) => s),
		version: Number(r.current_version),
		createdAt: new Date(Number(r.created_at))
	}));
}

export function getLibraryDocument(app: AppDatabase, id: string): LibraryDocument {
	const d = listLibraryDocuments(app).find((x) => x.id === id);
	if (!d) throw new NotFoundError('Library document not found');
	return d;
}

export interface UploadResult {
	filename: string;
	document: LibraryDocument | null;
	duplicateOf: LibraryDocument | null;
	error: string | null;
}

/** Upload files for import; each is stored once by its hash and its text extracted. */
export async function uploadLibraryDocuments(
	app: AppDatabase,
	actor: Actor,
	filesDir: string,
	files: UploadFile[]
): Promise<UploadResult[]> {
	const out: UploadResult[] = [];
	for (const f of files) {
		if (!f.bytes.length) {
			out.push({ filename: f.name, document: null, duplicateOf: null, error: 'The file is empty.' });
			continue;
		}
		if (f.bytes.length > MAX_FILE_BYTES) {
			out.push({
				filename: f.name,
				document: null,
				duplicateOf: null,
				error: 'The file is larger than 50 MB.'
			});
			continue;
		}
		const hash = sha256(f.bytes);
		const dup = listLibraryDocuments(app).find((d) => d.fileHash === hash);
		if (dup) {
			out.push({ filename: f.name, document: null, duplicateOf: dup, error: null });
			continue;
		}
		storeFile(filesDir, f.bytes);
		const ex = await extractText(f.bytes, f.name, f.type);
		const now = Date.now();
		const id = app.sqlite.transaction(() => {
			const row = createEntity(app, actor, libraryDocumentDefinition, {
				filename: f.name,
				file_hash: hash,
				mime_type: f.type || null,
				size: f.bytes.length,
				text_status: ex.status,
				title: f.name.replace(/\.[^.]+$/, '')
			}).row;
			if (ex.status === 'extracted') {
				app.sqlite
					.prepare(
						'INSERT INTO library_document_text (document_id, text, page_starts, extracted_at) VALUES (?, ?, ?, ?)'
					)
					.run(String(row.id), ex.text, JSON.stringify(ex.pageStarts), now);
				indexText(app.sqlite, 'library_document', String(row.id), 'text', ex.text);
			}
			return String(row.id);
		})();
		out.push({ filename: f.name, document: getLibraryDocument(app, id), duplicateOf: null, error: null });
	}
	return out;
}

export function renameLibraryDocument(
	app: AppDatabase,
	actor: Actor,
	id: string,
	baseVersion: number,
	title: string
): LibraryDocument {
	getLibraryDocument(app, id);
	updateEntity(app, actor, libraryDocumentDefinition, id, baseVersion, { title });
	return getLibraryDocument(app, id);
}

/** A page of a library document's text with a locator, for reading it in steps. */
export function getLibraryDocumentText(app: AppDatabase, id: string, offset = 0, maxChars = 8000) {
	const d = getLibraryDocument(app, id);
	const row = app.sqlite
		.prepare('SELECT text, page_starts FROM library_document_text WHERE document_id = ?')
		.get(id) as { text: string; page_starts: string } | undefined;
	if (!row)
		throw new ValidationError(
			`No text for "${d.title}": ${d.textStatus === 'failed' ? 'it could not be read' : 'it is not a text format'}.`
		);
	return {
		documentId: id,
		title: d.title,
		...pageOf(row.text, JSON.parse(row.page_starts) as number[], offset, maxChars)
	};
}

export function assertLibraryDocument(app: AppDatabase, id: string | null | undefined): void {
	if (!id) return;
	const row = readRow(app, libraryDocumentDefinition, id);
	if (!row || Number(row.deleted) === 1) throw new NotFoundError('Library document not found');
}
