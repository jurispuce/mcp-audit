import type { AppDatabase } from '#lib/db/client.ts';
import { addMentionedDocument, listArtifacts, type Artifact } from './artifacts';
import { engagementGuard, getEngagement } from './engagements';
import { NotFoundError, ValidationError } from './errors';
import { requireHuman } from './guards';
import { listInternal } from './internal';
import { listPeople } from './people';
import {
	evidenceDefinition,
	eventDefinition,
	getEvent,
	listEvidence,
	personLabel,
	updateEvent,
	type EvidenceItem,
	type PlanEvent
} from './planning';
import { registerEntity } from './registry';
import { listSelected } from './selection';
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
 * Running an event: auditor notes with mentions (and what a promise or a mentioned document does),
 * evidence links from artifacts to planned evidence, and marking the event held.
 */

export const NOTE_TYPES = ['note', 'promise', 'issue'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export const MENTION_TYPES = [
	'requirement',
	'internal_requirement',
	'artifact',
	'person',
	'evidence_item'
] as const;
export type MentionType = (typeof MENTION_TYPES)[number];
export interface Mention {
	type: MentionType;
	id: string;
	label: string;
}
export const SUFFICIENCY = ['supports', 'partial', 'contradicts'] as const;
export type Sufficiency = (typeof SUFFICIENCY)[number];

const str = (v: unknown) => (v == null ? '' : String(v)).trim();

function parseMentions(v: unknown): Mention[] {
	let list: unknown = v;
	if (typeof v === 'string') {
		try {
			list = JSON.parse(v);
		} catch {
			list = [];
		}
	}
	if (!Array.isArray(list)) return [];
	return list.map((m) => {
		const type = str((m as Mention).type) as MentionType;
		if (!(MENTION_TYPES as readonly string[]).includes(type))
			throw new ValidationError(`Unknown mention type ${type}.`);
		return { type, id: str((m as Mention).id), label: str((m as Mention).label) };
	});
}

// ---- Entity definitions

export const noteDefinition: EntityDefinition = registerEntity({
	type: 'note',
	table: 'note',
	columns: ['engagement_id', 'event_id', 'type', 'text', 'mentions', 'at'],
	detailColumns: ['type', 'text'],
	fieldLabels: { type: 'Type', text: 'Note', mentions: 'Mentions', at: 'Taken at' },
	formatValue(column, value) {
		if (column === 'type')
			return value === 'promise' ? 'Promise' : value === 'issue' ? 'Suspected issue' : 'Note';
		if (column === 'mentions')
			return parseMentions(value)
				.map((m) => m.label)
				.join(', ');
		if (column === 'at') return value ? new Date(Number(value)).toISOString() : '';
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	engagementOf: (app, row) => engagementGuard(app, row.engagement_id),
	parse(input, existing) {
		const out: Row = {};
		if (!existing) {
			out.engagement_id = str(input.engagement_id);
			out.event_id = str(input.event_id);
			out.at = Number(input.at ?? Date.now());
		}
		if ('type' in input || !existing) {
			const t = str(input.type || 'note');
			if (!(NOTE_TYPES as readonly string[]).includes(t))
				throw new ValidationError('A note is a note, a promise or an issue.');
			out.type = t;
		}
		if ('text' in input || !existing) {
			const t = str(input.text);
			if (!t) throw new ValidationError('Write the note.', { text: 'Required' });
			out.text = t;
		}
		if ('mentions' in input || !existing) out.mentions = JSON.stringify(parseMentions(input.mentions));
		return out;
	},
	afterWrite(app, _actor, row) {
		if (Number(row.deleted) === 1) return;
		const ev = readRow(app, eventDefinition, String(row.event_id));
		if (!ev || ev.engagement_id !== row.engagement_id)
			throw new ValidationError('Choose an event of this engagement.');
		assertMentionsValid(app, String(row.engagement_id), parseMentions(row.mentions));
	},
	search: (row) => ({ text: row.text as string }),
	label: (row) => String(row.text).slice(0, 80),
	refLine: (row) =>
		row.type === 'promise' ? 'Promise' : row.type === 'issue' ? 'Suspected issue (auditor only)' : 'Note'
});

export const evidenceLinkDefinition: EntityDefinition = registerEntity({
	type: 'evidence_link',
	table: 'evidence_link',
	columns: [
		'engagement_id',
		'artifact_id',
		'evidence_item_id',
		'locator',
		'excerpt',
		'sufficiency',
		'status'
	],
	detailColumns: ['sufficiency', 'locator', 'excerpt', 'status'],
	fieldLabels: {
		locator: 'Where',
		excerpt: 'Excerpt',
		sufficiency: 'Sufficiency',
		status: 'Status',
		artifact_id: 'Artifact',
		evidence_item_id: 'Planned evidence'
	},
	formatValue(column, value) {
		if (column === 'sufficiency')
			return value === 'supports' ? 'Supports' : value === 'partial' ? 'Partly supports' : 'Contradicts';
		if (column === 'status') return value === 'proposed' ? 'Proposed' : 'Confirmed';
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	engagementOf: (app, row) => engagementGuard(app, row.engagement_id),
	/** Linking evidence is a judgement: AI only proposes. */
	judgement: () => ({ column: 'status', proposed: 'proposed' }),
	parse(input, existing) {
		const out: Row = {};
		if (!existing) {
			out.engagement_id = str(input.engagement_id);
			out.artifact_id = str(input.artifact_id);
			out.evidence_item_id = str(input.evidence_item_id);
		}
		if ('locator' in input) out.locator = str(input.locator) || null;
		if ('excerpt' in input) out.excerpt = str(input.excerpt) || null;
		if ('sufficiency' in input || !existing) {
			const s = str(input.sufficiency || 'supports');
			if (!(SUFFICIENCY as readonly string[]).includes(s))
				throw new ValidationError('Sufficiency is supports, partial or contradicts.', {
					sufficiency: 'Invalid'
				});
			out.sufficiency = s;
		}
		if ('status' in input || !existing) {
			const s = str(input.status || 'confirmed');
			if (s !== 'proposed' && s !== 'confirmed')
				throw new ValidationError('A link is proposed or confirmed.');
			out.status = s;
		}
		return out;
	},
	afterWrite(app, _actor, row) {
		if (Number(row.deleted) === 1) return;
		const engagementId = String(row.engagement_id);
		const a = app.sqlite
			.prepare('SELECT engagement_id, state FROM artifact WHERE id = ? AND deleted = 0')
			.get(row.artifact_id) as { engagement_id: string; state: string } | undefined;
		if (!a || a.engagement_id !== engagementId)
			throw new ValidationError('Choose an artifact of this engagement.');
		if (a.state === 'mentioned')
			throw new ValidationError('A mentioned document has not been received yet; it cannot be evidence.');
		const item = readRow(app, evidenceDefinition, String(row.evidence_item_id));
		if (!item || Number(item.deleted) === 1 || item.engagement_id !== engagementId)
			throw new ValidationError('Choose planned evidence of this engagement.');
		const dup = app.sqlite
			.prepare(
				'SELECT id FROM evidence_link WHERE artifact_id = ? AND evidence_item_id = ? AND deleted = 0 AND id <> ?'
			)
			.get(row.artifact_id, row.evidence_item_id, row.id);
		if (dup) throw new ValidationError('This artifact is already linked to that evidence.');
	},
	search: (row) => ({ excerpt: row.excerpt as string | null }),
	label: (row) => `Evidence link${row.locator ? `, ${row.locator}` : ''}`,
	refLine: (row) => `Evidence link · ${row.sufficiency} · ${row.status}`
});

// ---- Mentions

function assertMentionsValid(app: AppDatabase, engagementId: string, mentions: Mention[]) {
	const e = getEngagement(app, engagementId);
	for (const m of mentions) {
		const ok = (() => {
			switch (m.type) {
				case 'requirement':
					return listSelected(app, e.id).some((s) => s.requirementId === m.id);
				case 'internal_requirement':
					return listInternal(app, e.id).some((r) => r.id === m.id);
				case 'artifact':
					return listArtifacts(app, e.id).some((a) => a.id === m.id);
				case 'person':
					return listPeople(app, e.auditeeId).some((p) => p.id === m.id);
				case 'evidence_item':
					return listEvidence(app, e.id).some((x) => x.id === m.id);
			}
		})();
		if (!ok) throw new ValidationError(`"${m.label || m.id}" is not something this engagement knows.`);
	}
}

export interface MentionOption extends Mention {
	/** A short line under the label in the picker. */
	hint: string;
}

/** Everything "@" can mention on an event screen: requirements, internal requirements, documents, roles and this event's planned evidence. */
export function mentionOptions(app: AppDatabase, engagementId: string, eventId: string): MentionOption[] {
	const e = getEngagement(app, engagementId);
	return [
		...listSelected(app, e.id).map((s) => ({
			type: 'requirement' as const,
			id: s.requirementId,
			label: s.refCode,
			hint: s.pinned.title
		})),
		...listInternal(app, e.id)
			.filter((r) => r.status === 'confirmed')
			.map((r) => ({ type: 'internal_requirement' as const, id: r.id, label: r.refCode, hint: r.title })),
		...listArtifacts(app, e.id)
			.filter((a) => a.kind !== 'generated_report')
			.map((a) => ({
				type: 'artifact' as const,
				id: a.id,
				label: a.displayName,
				hint: a.state === 'mentioned' ? 'Document, mentioned' : 'Document'
			})),
		...listPeople(app, e.auditeeId)
			.filter((p) => p.status === 'confirmed')
			.map((p) => ({ type: 'person' as const, id: p.id, label: p.role, hint: p.name ?? 'Role' })),
		...listEvidence(app, e.id, { eventId }).map((x) => ({
			type: 'evidence_item' as const,
			id: x.id,
			label: x.text,
			hint: 'Planned evidence'
		}))
	];
}

// ---- Notes

export interface Note {
	id: string;
	eventId: string;
	type: NoteType;
	text: string;
	mentions: Mention[];
	at: Date;
	version: number;
}

const toNote = (r: Row): Note => ({
	id: String(r.id),
	eventId: String(r.event_id),
	type: r.type as NoteType,
	text: String(r.text),
	mentions: parseMentions(r.mentions),
	at: new Date(Number(r.at)),
	version: Number(r.current_version)
});

export function listNotes(
	app: AppDatabase,
	engagementId: string,
	options: { eventId?: string; type?: NoteType } = {}
): Note[] {
	const where = ['engagement_id = ?', 'deleted = 0'];
	const args: unknown[] = [engagementId];
	if (options.eventId) {
		where.push('event_id = ?');
		args.push(options.eventId);
	}
	if (options.type) {
		where.push('type = ?');
		args.push(options.type);
	}
	return (
		app.sqlite
			.prepare(`SELECT * FROM note WHERE ${where.join(' AND ')} ORDER BY at, created_at`)
			.all(...args) as Row[]
	).map(toNote);
}

export interface NoteInput {
	type?: NoteType;
	text: string;
	mentions?: Mention[];
	at?: number;
	/** For a promise: when it is due (YYYY-MM-DD). Also read from the text when it holds a date. */
	due?: string | null;
}

export interface NoteResult {
	note: Note;
	/** What else the note changed: evidence set to promised, documents recorded as mentioned. */
	effects: string[];
}

/**
 * Add a note. A promise that mentions planned evidence sets it to promised, by the mentioned role.
 * A document mention without an id records that document as mentioned (not received). A suspected
 * issue is kept for the auditor; it shows on the Findings card and never in a shared report.
 */
export function addNote(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	eventId: string,
	input: NoteInput
): NoteResult {
	getEvent(app, engagementId, eventId);
	return app.sqlite.transaction(() => {
		const effects: string[] = [];
		const mentions = (input.mentions ?? []).map((m) => {
			if (m.type === 'artifact' && !m.id) {
				const existing = listArtifacts(app, engagementId).find(
					(a) => a.displayName.toLowerCase() === m.label.toLowerCase()
				);
				if (existing) return { ...m, id: existing.id, label: existing.displayName };
				const doc = addMentionedDocument(app, actor, engagementId, m.label, { eventId });
				effects.push(`${doc.displayName} recorded as mentioned, not received`);
				return { ...m, id: doc.id, label: doc.displayName };
			}
			return m;
		});
		const type = input.type ?? 'note';
		const row = createEntity(app, actor, noteDefinition, {
			engagement_id: engagementId,
			event_id: eventId,
			type,
			text: input.text,
			mentions,
			at: input.at ?? Date.now()
		}).row;
		if (type === 'promise') {
			const e = getEngagement(app, engagementId);
			const people = listPeople(app, e.auditeeId);
			const who = mentions.find((m) => m.type === 'person');
			const person = who ? people.find((p) => p.id === who.id) : undefined;
			const due = input.due ?? /\b(\d{4}-\d{2}-\d{2})\b/.exec(input.text)?.[1] ?? null;
			for (const m of mentions.filter((x) => x.type === 'evidence_item')) {
				const item = listEvidence(app, engagementId).find((x) => x.id === m.id)!;
				if (item.status === 'received') continue;
				updateEntity(
					app,
					actor,
					evidenceDefinition,
					item.id,
					item.version,
					{
						status: 'promised',
						promised_by: person ? personLabel(person) : (item.promisedBy ?? null),
						promised_due: due ?? item.promisedDue
					},
					'Promised in a note'
				);
				effects.push(`${item.text} set to promised${person ? ` by ${person.role}` : ''}`);
			}
		}
		return { note: toNote(readRow(app, noteDefinition, String(row.id))!), effects };
	})();
}

export function updateNote(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string,
	baseVersion: number,
	input: Partial<NoteInput>
): Note {
	const row = readRow(app, noteDefinition, id);
	if (!row || Number(row.deleted) === 1 || row.engagement_id !== engagementId)
		throw new NotFoundError('Note not found');
	updateEntity(app, actor, noteDefinition, id, baseVersion, { ...input });
	return toNote(readRow(app, noteDefinition, id)!);
}

export function removeNote(app: AppDatabase, actor: Actor, engagementId: string, id: string): void {
	const row = readRow(app, noteDefinition, id);
	if (!row || Number(row.deleted) === 1 || row.engagement_id !== engagementId)
		throw new NotFoundError('Note not found');
	deleteEntity(app, actor, noteDefinition, id, Number(row.current_version), 'Note removed');
}

/**
 * Suspected issues for a requirement: issue notes that mention it, or mention planned evidence or an
 * internal requirement that belongs to it. Auditor only.
 */
export function suspectedIssues(app: AppDatabase, engagementId: string, requirementId: string): Note[] {
	const evidence = new Set(
		listEvidence(app, engagementId)
			.filter((x) => x.requirementIds.includes(requirementId))
			.map((x) => x.id)
	);
	const internal = new Set(
		listInternal(app, engagementId)
			.filter((r) => r.implements.some((l) => l.other.id === requirementId))
			.map((r) => r.id)
	);
	return listNotes(app, engagementId, { type: 'issue' }).filter((n) =>
		n.mentions.some(
			(m) =>
				(m.type === 'requirement' && m.id === requirementId) ||
				(m.type === 'evidence_item' && evidence.has(m.id)) ||
				(m.type === 'internal_requirement' && internal.has(m.id))
		)
	);
}

// ---- Event held

export function setEventHeld(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	eventId: string,
	held: boolean
): PlanEvent {
	const ev = getEvent(app, engagementId, eventId);
	if ((ev.status === 'held') === held) return ev;
	return updateEvent(app, actor, engagementId, eventId, ev.version, { status: held ? 'held' : 'planned' });
}

// ---- Evidence links

export interface EvidenceLink {
	id: string;
	artifactId: string;
	artifactTitle: string;
	evidenceItemId: string;
	evidenceText: string;
	locator: string | null;
	excerpt: string | null;
	sufficiency: Sufficiency;
	status: 'proposed' | 'confirmed';
	version: number;
}

export function listLinks(
	app: AppDatabase,
	engagementId: string,
	options: { eventId?: string; artifactId?: string; evidenceItemId?: string } = {}
): EvidenceLink[] {
	const items = new Map(listEvidence(app, engagementId).map((x) => [x.id, x]));
	const artifacts = new Map(listArtifacts(app, engagementId).map((a) => [a.id, a]));
	return (
		app.sqlite
			.prepare('SELECT * FROM evidence_link WHERE engagement_id = ? AND deleted = 0 ORDER BY created_at')
			.all(engagementId) as Row[]
	)
		.map((r) => ({
			id: String(r.id),
			artifactId: String(r.artifact_id),
			artifactTitle: artifacts.get(String(r.artifact_id))?.displayName ?? '(removed document)',
			evidenceItemId: String(r.evidence_item_id),
			evidenceText: items.get(String(r.evidence_item_id))?.text ?? '(removed evidence)',
			locator: (r.locator as string | null) ?? null,
			excerpt: (r.excerpt as string | null) ?? null,
			sufficiency: r.sufficiency as Sufficiency,
			status: r.status as EvidenceLink['status'],
			version: Number(r.current_version),
			eventId: items.get(String(r.evidence_item_id))?.eventId
		}))
		.filter(
			(l) =>
				(!options.eventId || l.eventId === options.eventId) &&
				(!options.artifactId || l.artifactId === options.artifactId) &&
				(!options.evidenceItemId || l.evidenceItemId === options.evidenceItemId)
		)
		.map(({ eventId: _e, ...l }) => l);
}

/** A confirmed link means the evidence was received (or partly, when the link only partly supports it). */
function applyConfirmed(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	link: { evidenceItemId: string; sufficiency: Sufficiency }
) {
	const item = listEvidence(app, engagementId).find((x) => x.id === link.evidenceItemId) as EvidenceItem;
	const to = link.sufficiency === 'partial' ? 'partial' : 'received';
	if (
		['planned', 'missing', 'promised'].includes(item.status) ||
		(item.status === 'partial' && to === 'received')
	)
		updateEntity(app, actor, evidenceDefinition, item.id, item.version, { status: to }, 'Evidence linked');
}

export interface LinkInput {
	artifactId: string;
	evidenceItemId: string;
	locator?: string | null;
	excerpt?: string | null;
	sufficiency?: Sufficiency;
}

/** Link an artifact to planned evidence. A person's link is confirmed at once; AI's is proposed. */
export function addEvidenceLink(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	input: LinkInput
): EvidenceLink {
	getEngagement(app, engagementId);
	return app.sqlite.transaction(() => {
		const row = createEntity(app, actor, evidenceLinkDefinition, {
			engagement_id: engagementId,
			artifact_id: input.artifactId,
			evidence_item_id: input.evidenceItemId,
			locator: input.locator ?? null,
			excerpt: input.excerpt ?? null,
			sufficiency: input.sufficiency ?? 'supports'
			// No status: a person's link is confirmed by default, AI's is forced to proposed.
		}).row;
		if (row.status === 'confirmed')
			applyConfirmed(app, actor, engagementId, {
				evidenceItemId: input.evidenceItemId,
				sufficiency: row.sufficiency as Sufficiency
			});
		return listLinks(app, engagementId).find((l) => l.id === String(row.id))!;
	})();
}

function linkOf(app: AppDatabase, engagementId: string, id: string): EvidenceLink {
	const l = listLinks(app, engagementId).find((x) => x.id === id);
	if (!l) throw new NotFoundError('Evidence link not found');
	return l;
}

export function confirmLink(app: AppDatabase, actor: Actor, engagementId: string, id: string): EvidenceLink {
	requireHuman(actor, 'Confirming an evidence link');
	return app.sqlite.transaction(() => {
		const l = linkOf(app, engagementId, id);
		if (l.status === 'proposed') {
			updateEntity(app, actor, evidenceLinkDefinition, id, l.version, { status: 'confirmed' }, 'Accepted');
			applyConfirmed(app, actor, engagementId, l);
		}
		return linkOf(app, engagementId, id);
	})();
}

export function updateLink(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string,
	baseVersion: number,
	input: Partial<Pick<LinkInput, 'locator' | 'excerpt' | 'sufficiency'>>
): EvidenceLink {
	linkOf(app, engagementId, id);
	updateEntity(app, actor, evidenceLinkDefinition, id, baseVersion, { ...input });
	return linkOf(app, engagementId, id);
}

export function removeLink(app: AppDatabase, actor: Actor, engagementId: string, id: string): void {
	const l = linkOf(app, engagementId, id);
	deleteEntity(
		app,
		actor,
		evidenceLinkDefinition,
		id,
		l.version,
		l.status === 'proposed' ? 'Proposal rejected' : 'Link removed'
	);
}

export function acceptAllLinks(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	options: { eventId?: string } = {}
): number {
	requireHuman(actor, 'Confirming evidence links');
	return app.sqlite.transaction(() => {
		const proposed = listLinks(app, engagementId, options).filter((l) => l.status === 'proposed');
		for (const l of proposed) confirmLink(app, actor, engagementId, l.id);
		return proposed.length;
	})();
}

/** Artifacts not yet linked (by a confirmed link) to any planned evidence. Generated reports are left out. */
export function inbox(app: AppDatabase, engagementId: string): Artifact[] {
	const linked = new Set(
		listLinks(app, engagementId)
			.filter((l) => l.status === 'confirmed')
			.map((l) => l.artifactId)
	);
	return listArtifacts(app, engagementId).filter(
		(a) => a.kind !== 'generated_report' && a.state === 'received' && !linked.has(a.id)
	);
}
