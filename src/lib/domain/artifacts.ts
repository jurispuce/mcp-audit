import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from '#lib/db/client.ts';
import { indexText, removeFromIndex } from '#lib/db/fts.ts';
import { engagementGuard, getEngagement } from './engagements';
import { NotFoundError, ValidationError } from './errors';
import { registerEntity } from './registry';
import {
	createEntity,
	deleteEntity,
	readRow,
	updateEntity,
	type Actor,
	type EntityDefinition,
	type Row
} from './write';

/**
 * Artifacts: documents, photos and transcripts the auditee or the auditor brings in. A file is stored
 * once under its SHA-256 (files/ab/abcdef…) and never changed; only the artifact's metadata is
 * versioned. Text is extracted at upload for PDF, DOCX and plain text, kept apart and full-text indexed.
 */

export const ARTIFACT_KINDS = [
	'policy',
	'procedure',
	'instruction',
	'risk_register',
	'record',
	'transcript',
	'photo',
	'generated_report',
	'other'
] as const;
export const KIND_LABELS: Record<string, string> = {
	policy: 'Policy',
	procedure: 'Procedure',
	instruction: 'Instruction',
	risk_register: 'Risk register',
	record: 'Record',
	transcript: 'Transcript',
	photo: 'Photo',
	generated_report: 'Generated report',
	other: 'Other'
};

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const str = (v: unknown) => (v == null ? '' : String(v)).trim();
const optional = (v: unknown) => str(v) || null;

export const artifactDefinition: EntityDefinition = registerEntity({
	type: 'artifact',
	table: 'artifact',
	columns: [
		'engagement_id',
		'kind',
		'file_hash',
		'filename',
		'mime_type',
		'size',
		'title',
		'version_label',
		'approval_date',
		'language',
		'origin',
		'state',
		'received_from',
		'received_at',
		'event_id',
		'text_status'
	],
	detailColumns: [
		'title',
		'filename',
		'kind',
		'version_label',
		'approval_date',
		'state',
		'received_from',
		'language',
		'text_status',
		'file_hash'
	],
	fieldLabels: {
		title: 'Title',
		filename: 'File',
		kind: 'Kind',
		version_label: 'Version',
		approval_date: 'Approved on',
		state: 'State',
		received_from: 'Received from',
		language: 'Language',
		text_status: 'Text',
		file_hash: 'SHA-256'
	},
	formatValue(column, value) {
		if (column === 'kind') return value ? (KIND_LABELS[String(value)] ?? String(value)) : 'Not set';
		if (column === 'state') return value === 'mentioned' ? 'Mentioned, not received' : 'Received';
		if (column === 'text_status')
			return (
				(
					{
						extracted: 'Extracted',
						failed: 'Could not be read',
						unsupported: 'Not a text format',
						none: 'No file'
					} as Record<string, string>
				)[String(value)] ?? ''
			);
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	engagementOf: (app, row) => engagementGuard(app, row.engagement_id),
	parse(input, existing) {
		const out: Row = {};
		if (!existing) {
			out.engagement_id = str(input.engagement_id);
			out.origin = str(input.origin || 'upload');
			for (const col of ['file_hash', 'filename', 'mime_type', 'received_from', 'event_id'] as const)
				out[col] = optional(input[col]);
			out.size = input.size == null ? null : Number(input.size);
			out.received_at = input.received_at == null ? null : Number(input.received_at);
			out.text_status = str(input.text_status || 'none');
		}
		if ('state' in input || !existing) out.state = input.state === 'mentioned' ? 'mentioned' : 'received';
		if ('title' in input) out.title = optional(input.title);
		if ('kind' in input) {
			const k = optional(input.kind);
			if (k && !(ARTIFACT_KINDS as readonly string[]).includes(k))
				throw new ValidationError('Unknown kind.', { kind: 'Unknown' });
			out.kind = k;
		}
		if ('version_label' in input) out.version_label = optional(input.version_label);
		if ('approval_date' in input) {
			const d = optional(input.approval_date);
			if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d))
				throw new ValidationError('Use a date such as 2026-03-01.', { approval_date: 'Not a date' });
			out.approval_date = d;
		}
		if ('language' in input) out.language = optional(input.language);
		if ('received_from' in input && existing) out.received_from = optional(input.received_from);
		return out;
	},
	search: (row) => ({
		title: (row.title as string | null) ?? null,
		filename: (row.filename as string | null) ?? null
	}),
	label: (row) => String(row.title || row.filename || 'Untitled document'),
	refLine: (row) =>
		[
			row.kind ? KIND_LABELS[String(row.kind)] : null,
			row.filename,
			row.state === 'mentioned' ? 'mentioned' : null
		]
			.filter(Boolean)
			.join(' · ') || 'Document'
});

// ---- Files

export function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

export function filePath(filesDir: string, hash: string): string {
	if (!/^[0-9a-f]{64}$/.test(hash)) throw new ValidationError('Bad file reference.');
	return path.join(filesDir, hash.slice(0, 2), hash);
}

/** Store bytes under their hash. Writing the same content twice is a no-op; files are never changed. */
export function storeFile(filesDir: string, bytes: Uint8Array): string {
	const hash = sha256(bytes);
	const target = filePath(filesDir, hash);
	if (!existsSync(target)) {
		mkdirSync(path.dirname(target), { recursive: true });
		const tmp = `${target}.${process.pid}.tmp`;
		writeFileSync(tmp, bytes, { mode: 0o440 });
		renameSync(tmp, target);
	}
	return hash;
}

export function readFile(filesDir: string, hash: string): Buffer {
	return readFileSync(filePath(filesDir, hash));
}

// ---- Text extraction

export interface Extracted {
	status: 'extracted' | 'failed' | 'unsupported';
	text: string;
	/** Start offset of each page in `text` (one entry for unpaged formats). */
	pageStarts: number[];
}

const TEXT_TYPES = /\.(txt|md|markdown|csv|tsv|json|ya?ml|vtt|srt|log)$/i;

/** Read the text of a PDF, DOCX or plain-text file. Never throws: a file that cannot be read gets status failed. */
export async function extractText(bytes: Uint8Array, filename: string, mimeType = ''): Promise<Extracted> {
	const name = filename.toLowerCase();
	try {
		if (name.endsWith('.pdf') || mimeType === 'application/pdf') {
			const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
			const doc = await getDocumentProxy(new Uint8Array(bytes));
			const { text } = await pdfText(doc, { mergePages: false });
			const pages = (text as string[]).map((p) => p.trim());
			return joinPages(pages);
		}
		if (
			name.endsWith('.docx') ||
			mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		) {
			const mammoth = (await import('mammoth')).default;
			const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
			return { status: 'extracted', text: normalise(value), pageStarts: [0] };
		}
		if (TEXT_TYPES.test(name) || mimeType.startsWith('text/')) {
			return {
				status: 'extracted',
				text: normalise(new TextDecoder('utf-8').decode(bytes)),
				pageStarts: [0]
			};
		}
		return { status: 'unsupported', text: '', pageStarts: [] };
	} catch {
		return { status: 'failed', text: '', pageStarts: [] };
	}
}

function normalise(s: string): string {
	return s
		.replace(/\r\n?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function joinPages(pages: string[]): Extracted {
	const pageStarts: number[] = [];
	let text = '';
	for (const p of pages) {
		if (text) text += '\n\n';
		pageStarts.push(text.length);
		text += normalise(p);
	}
	return { status: text.trim() ? 'extracted' : 'failed', text, pageStarts };
}

function saveText(app: AppDatabase, artifactId: string, ex: Extracted, now: Date) {
	app.sqlite
		.prepare(
			`INSERT INTO artifact_text (artifact_id, text, page_starts, extracted_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(artifact_id) DO UPDATE SET text = excluded.text, page_starts = excluded.page_starts, extracted_at = excluded.extracted_at`
		)
		.run(artifactId, ex.text, JSON.stringify(ex.pageStarts), now.getTime());
	indexText(app.sqlite, 'artifact', artifactId, 'text', ex.text);
}

// ---- Read models

export interface Artifact {
	id: string;
	title: string | null;
	displayName: string;
	filename: string | null;
	kind: string | null;
	fileHash: string | null;
	mimeType: string | null;
	size: number | null;
	versionLabel: string | null;
	approvalDate: string | null;
	language: string | null;
	origin: string;
	state: 'received' | 'mentioned';
	receivedFrom: string | null;
	receivedAt: Date | null;
	eventId: string | null;
	textStatus: string;
	textLength: number;
	version: number;
	createdAt: Date;
}

function toArtifact(r: Row): Artifact {
	return {
		id: String(r.id),
		title: (r.title as string | null) ?? null,
		displayName: String(r.title || r.filename || 'Untitled document'),
		filename: (r.filename as string | null) ?? null,
		kind: (r.kind as string | null) ?? null,
		fileHash: (r.file_hash as string | null) ?? null,
		mimeType: (r.mime_type as string | null) ?? null,
		size: r.size == null ? null : Number(r.size),
		versionLabel: (r.version_label as string | null) ?? null,
		approvalDate: (r.approval_date as string | null) ?? null,
		language: (r.language as string | null) ?? null,
		origin: String(r.origin),
		state: r.state as Artifact['state'],
		receivedFrom: (r.received_from as string | null) ?? null,
		receivedAt: r.received_at ? new Date(Number(r.received_at)) : null,
		eventId: (r.event_id as string | null) ?? null,
		textStatus: String(r.text_status),
		textLength: Number(r.text_length ?? 0),
		version: Number(r.current_version),
		createdAt: new Date(Number(r.created_at))
	};
}

const ART_SELECT = `SELECT a.*, length(t.text) AS text_length FROM artifact a LEFT JOIN artifact_text t ON t.artifact_id = a.id`;

export function listArtifacts(
	app: AppDatabase,
	engagementId: string,
	options: { eventId?: string } = {}
): Artifact[] {
	const rows = app.sqlite
		.prepare(
			`${ART_SELECT} WHERE a.engagement_id = ? AND a.deleted = 0 ${options.eventId ? 'AND a.event_id = ?' : ''} ORDER BY a.created_at`
		)
		.all(...[engagementId, ...(options.eventId ? [options.eventId] : [])]) as Row[];
	return rows.map(toArtifact);
}

export function getArtifact(app: AppDatabase, id: string): Artifact {
	const row = app.sqlite.prepare(`${ART_SELECT} WHERE a.id = ? AND a.deleted = 0`).get(id) as Row | undefined;
	if (!row) throw new NotFoundError('Document not found');
	return toArtifact(row);
}

/** A document of one engagement; another engagement's document is "not found". */
export function getEngagementArtifact(app: AppDatabase, engagementId: string, id: string): Artifact {
	const row = app.sqlite
		.prepare('SELECT engagement_id FROM artifact WHERE id = ? AND deleted = 0')
		.get(id) as { engagement_id: string } | undefined;
	if (!row || row.engagement_id !== engagementId) throw new NotFoundError('Document not found');
	return getArtifact(app, id);
}

export interface TextPage {
	artifactId: string;
	title: string;
	offset: number;
	nextOffset: number | null;
	totalLength: number;
	/** Where the slice sits in the document, for example "p. 3" or "p. 3-4". */
	locator: string;
	text: string;
}

/** A slice of an artifact's text with a locator, for reading long documents in steps. */
export function getArtifactText(app: AppDatabase, id: string, offset = 0, maxChars = 8000): TextPage {
	const a = getArtifact(app, id);
	const row = app.sqlite
		.prepare('SELECT text, page_starts FROM artifact_text WHERE artifact_id = ?')
		.get(id) as { text: string; page_starts: string } | undefined;
	if (!row) {
		const why =
			a.state === 'mentioned' ? 'it was mentioned but not received yet' : `its text is ${a.textStatus}`;
		throw new ValidationError(`No text for "${a.displayName}": ${why}.`);
	}
	return {
		artifactId: id,
		title: a.displayName,
		...pageOf(row.text, JSON.parse(row.page_starts) as number[], offset, maxChars)
	};
}

/** A slice of extracted text, cut at a line break where possible, with a page or character locator. */
export function pageOf(
	text: string,
	starts: number[],
	offset = 0,
	maxChars = 8000
): { offset: number; nextOffset: number | null; totalLength: number; locator: string; text: string } {
	const total = text.length;
	const start = Math.max(0, Math.min(offset, total));
	let end = Math.min(total, start + Math.max(500, Math.min(maxChars, 20000)));
	if (end < total) {
		const nl = text.lastIndexOf('\n', end);
		if (nl > start + 200) end = nl;
	}
	const pageAt = (pos: number) => {
		let p = 1;
		for (let i = 0; i < starts.length; i++) if (starts[i]! <= pos) p = i + 1;
		return p;
	};
	const first = pageAt(start);
	const last = pageAt(Math.max(start, end - 1));
	const locator =
		starts.length > 1
			? first === last
				? `p. ${first}`
				: `p. ${first}-${last}`
			: `characters ${start}-${end}`;
	return {
		offset: start,
		nextOffset: end < total ? end : null,
		totalLength: total,
		locator,
		text: text.slice(start, end)
	};
}

// ---- Commands

export interface UploadFile {
	name: string;
	type: string;
	bytes: Uint8Array;
}

export interface UploadResult {
	filename: string;
	artifact: Artifact | null;
	duplicateOf: Artifact | null;
	error: string | null;
}

/**
 * Take in one or many files with nothing else required. Each file is stored once by its hash; a file
 * already in this engagement is reported as a duplicate instead of added again.
 */
export async function uploadArtifacts(
	app: AppDatabase,
	actor: Actor,
	filesDir: string,
	engagementId: string,
	files: UploadFile[],
	extra: { eventId?: string | null; kind?: string | null; origin?: 'upload' | 'mcp' } = {}
): Promise<UploadResult[]> {
	getEngagement(app, engagementId);
	const results: UploadResult[] = [];
	for (const f of files) {
		if (!f.bytes.length) {
			results.push({ filename: f.name, artifact: null, duplicateOf: null, error: 'The file is empty.' });
			continue;
		}
		if (f.bytes.length > MAX_FILE_BYTES) {
			results.push({
				filename: f.name,
				artifact: null,
				duplicateOf: null,
				error: 'The file is larger than 50 MB.'
			});
			continue;
		}
		const hash = sha256(f.bytes);
		const dup = app.sqlite
			.prepare('SELECT id FROM artifact WHERE engagement_id = ? AND file_hash = ? AND deleted = 0')
			.get(engagementId, hash) as { id: string } | undefined;
		if (dup) {
			results.push({ filename: f.name, artifact: null, duplicateOf: getArtifact(app, dup.id), error: null });
			continue;
		}
		storeFile(filesDir, f.bytes);
		const ex = await extractText(f.bytes, f.name, f.type);
		const now = new Date();
		const row = app.sqlite.transaction(() => {
			const created = createEntity(app, actor, artifactDefinition, {
				engagement_id: engagementId,
				origin: extra.origin ?? 'upload',
				state: 'received',
				file_hash: hash,
				filename: f.name,
				mime_type: f.type || null,
				size: f.bytes.length,
				received_at: now.getTime(),
				event_id: extra.eventId ?? null,
				kind: extra.kind ?? null,
				text_status: ex.status
			}).row;
			if (ex.status === 'extracted') saveText(app, String(created.id), ex, now);
			return created;
		})();
		results.push({
			filename: f.name,
			artifact: getArtifact(app, String(row.id)),
			duplicateOf: null,
			error: null
		});
	}
	return results;
}

/** A document named in an interview but not received yet: no file, state mentioned. */
export function addMentionedDocument(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	title: string,
	extra: { kind?: string | null; eventId?: string | null } = {}
): Artifact {
	getEngagement(app, engagementId);
	if (!str(title)) throw new ValidationError('Name the document.', { title: 'Required' });
	const row = createEntity(app, actor, artifactDefinition, {
		engagement_id: engagementId,
		origin: 'mention',
		state: 'mentioned',
		title,
		kind: extra.kind ?? null,
		event_id: extra.eventId ?? null,
		text_status: 'none'
	}).row;
	return getArtifact(app, String(row.id));
}

/** Store text (a transcript, or text fetched elsewhere) as an artifact. Used by register_artifact. */
export function registerTextArtifact(
	app: AppDatabase,
	actor: Actor,
	filesDir: string,
	engagementId: string,
	input: {
		title: string;
		text: string;
		kind?: string | null;
		language?: string | null;
		receivedFrom?: string | null;
		eventId?: string | null;
		filename?: string | null;
	}
): Artifact {
	getEngagement(app, engagementId);
	const text = String(input.text ?? '');
	if (!text.trim()) throw new ValidationError('The artifact has no text.');
	if (!str(input.title)) throw new ValidationError('Give the artifact a title.', { title: 'Required' });
	const bytes = new TextEncoder().encode(text);
	const hash = storeFile(filesDir, bytes);
	const now = new Date();
	return app.sqlite.transaction(() => {
		const row = createEntity(app, actor, artifactDefinition, {
			engagement_id: engagementId,
			origin: actor.channel === 'ui' ? 'upload' : 'mcp',
			state: 'received',
			file_hash: hash,
			filename:
				input.filename ||
				`${str(input.title)
					.slice(0, 60)
					.replace(/[^\p{L}\p{N}._ -]/gu, '')}.txt`,
			mime_type: 'text/plain',
			size: bytes.length,
			received_at: now.getTime(),
			received_from: input.receivedFrom ?? null,
			event_id: input.eventId ?? null,
			kind: input.kind ?? null,
			text_status: 'extracted'
		}).row;
		updateEntity(app, actor, artifactDefinition, String(row.id), 1, {
			title: input.title,
			language: input.language ?? null
		});
		saveText(app, String(row.id), { status: 'extracted', text: normalise(text), pageStarts: [0] }, now);
		return getArtifact(app, String(row.id));
	})();
}

/** A report the app generated (audit plan, post-event report, findings report), kept as an artifact. */
export function registerGeneratedArtifact(
	app: AppDatabase,
	actor: Actor,
	filesDir: string,
	engagementId: string,
	input: {
		title: string;
		filename: string;
		mimeType: string;
		bytes: Uint8Array;
		text: string;
		language?: string | null;
	}
): Artifact {
	getEngagement(app, engagementId);
	const hash = storeFile(filesDir, input.bytes);
	const now = new Date();
	return app.sqlite.transaction(() => {
		const row = createEntity(app, actor, artifactDefinition, {
			engagement_id: engagementId,
			origin: 'generated',
			state: 'received',
			file_hash: hash,
			filename: input.filename,
			mime_type: input.mimeType,
			size: input.bytes.length,
			received_at: now.getTime(),
			kind: 'generated_report',
			text_status: 'extracted'
		}).row;
		updateEntity(app, actor, artifactDefinition, String(row.id), 1, {
			title: input.title,
			language: input.language ?? null
		});
		saveText(app, String(row.id), { status: 'extracted', text: input.text, pageStarts: [0] }, now);
		return getArtifact(app, String(row.id));
	})();
}

export function updateArtifact(
	app: AppDatabase,
	actor: Actor,
	id: string,
	baseVersion: number,
	input: Partial<{
		title: string | null;
		kind: string | null;
		version_label: string | null;
		approval_date: string | null;
		language: string | null;
	}>
): Artifact {
	updateEntity(app, actor, artifactDefinition, id, baseVersion, input);
	return getArtifact(app, id);
}

/** Remove the document from the engagement's lists. The file itself stays: deleting files is not offered. */
export function removeArtifact(app: AppDatabase, actor: Actor, id: string): void {
	const row = readRow(app, artifactDefinition, id);
	if (!row || Number(row.deleted) === 1) throw new NotFoundError('Document not found');
	deleteEntity(
		app,
		actor,
		artifactDefinition,
		id,
		Number(row.current_version),
		'Removed from the engagement'
	);
	removeFromIndex(app.sqlite, 'artifact', id);
}
