import type { AppDatabase } from '#lib/db/client.ts';
import {
	engagementDefinition,
	engagementGuard,
	getEngagement,
	listScopes,
	type Engagement
} from './engagements';
import { NotFoundError, ValidationError } from './errors';
import { requireHuman } from './guards';
import { listPeople, type Person } from './people';
import { registerEntity } from './registry';
import { criticalityOf, idList } from './risks';
import { CRITICALITY, listSelected, type Criticality } from './selection';
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
 * The plan: events (interviews, walkthroughs, reviews, tests, visits) that validate selected
 * requirements, the evidence expected at each, and the plan status for the plan as a whole.
 * AI-drafted events and evidence carry proposed = 1 until a person accepts them; they stay editable.
 */

export const EVENT_FORMATS = [
	'interview',
	'walkthrough',
	'document_review',
	'technical_test',
	'site_visit',
	'other'
] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];
export const FORMAT_LABELS: Record<EventFormat, string> = {
	interview: 'Interview',
	walkthrough: 'Walkthrough',
	document_review: 'Document review',
	technical_test: 'Technical test',
	site_visit: 'Site visit',
	other: 'Other'
};
export const EVIDENCE_KINDS = ['rule', 'record', 'observation', 'testimony', 'technical'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const KIND_LABELS: Record<EvidenceKind, string> = {
	rule: 'Rule',
	record: 'Record',
	observation: 'Observation',
	testimony: 'Testimony',
	technical: 'Technical'
};
export const EVIDENCE_STATUSES = ['planned', 'received', 'partial', 'promised', 'missing'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export const STATUS_LABELS: Record<EvidenceStatus, string> = {
	planned: 'Planned',
	received: 'Received',
	partial: 'Partly received',
	promised: 'Promised',
	missing: 'Missing'
};
export const PLAN_STATUSES = ['draft', 'sent', 'agreed'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

const str = (v: unknown) => (v == null ? '' : String(v)).trim();
const optional = (v: unknown) => str(v) || null;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function oneOf<T extends string>(v: unknown, values: readonly T[], field: string, message: string): T {
	const s = str(v)
		.toLowerCase()
		.replace(/[\s-]+/g, '_');
	if (!(values as readonly string[]).includes(s)) throw new ValidationError(message, { [field]: 'Invalid' });
	return s as T;
}

function assertSelected(app: AppDatabase, engagementId: string, ids: string[], what: string) {
	const selected = new Set(listSelected(app, engagementId).map((s) => s.requirementId));
	if (ids.some((id) => !selected.has(id)))
		throw new ValidationError(`${what} can only point at requirements selected in this engagement.`, {
			requirement_ids: 'Not selected'
		});
}

const flagLabel = (v: unknown) => (Number(v) === 1 ? 'Proposed by AI' : 'Accepted');

// ---- Entity definitions

export const eventDefinition: EntityDefinition = registerEntity({
	type: 'event',
	table: 'event',
	columns: [
		'engagement_id',
		'title',
		'format',
		'date',
		'start_time',
		'duration_min',
		'participant_ids',
		'participants_note',
		'requirement_ids',
		'status',
		'proposed',
		'location'
	],
	detailColumns: [
		'title',
		'format',
		'date',
		'start_time',
		'duration_min',
		'participants_note',
		'location',
		'status',
		'proposed'
	],
	fieldLabels: {
		title: 'Title',
		format: 'Format',
		date: 'Date',
		start_time: 'Start time',
		duration_min: 'Duration (minutes)',
		participant_ids: 'Participants',
		participants_note: 'Other participants',
		requirement_ids: 'Requirements',
		status: 'Status',
		proposed: 'Review',
		location: 'Location'
	},
	formatValue(column, value) {
		if (column === 'format') return FORMAT_LABELS[value as EventFormat] ?? String(value ?? '');
		if (column === 'status') return value === 'held' ? 'Held' : 'Planned';
		if (column === 'proposed') return flagLabel(value);
		if (column === 'participant_ids' || column === 'requirement_ids') return `${idList(value).length}`;
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	engagementOf: (app, row) => engagementGuard(app, row.engagement_id),
	/** A drafted event is a judgement: AI writes leave it proposed for a person to accept. */
	judgement: () => ({ column: 'proposed', proposed: 1 }),
	parse(input, existing) {
		const out: Row = {};
		if (!existing) out.engagement_id = str(input.engagement_id);
		if ('title' in input || !existing) {
			const t = str(input.title);
			if (!t) throw new ValidationError('Give the event a title.', { title: 'Required' });
			out.title = t;
		}
		if ('format' in input || !existing)
			out.format = oneOf(
				input.format || 'interview',
				EVENT_FORMATS,
				'format',
				'Format is interview, walkthrough, document review, technical test, site visit or other.'
			);
		if ('date' in input) {
			const d = optional(input.date);
			if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))))
				throw new ValidationError('Use a date such as 2026-11-17.', { date: 'Not a date' });
			out.date = d;
		}
		if ('start_time' in input) {
			const t = optional(input.start_time);
			if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))
				throw new ValidationError('Use a time such as 10:00.', { start_time: 'Not a time' });
			out.start_time = t;
		}
		if ('duration_min' in input || !existing) {
			const n = input.duration_min == null || input.duration_min === '' ? 60 : Number(input.duration_min);
			if (!Number.isInteger(n) || n < 5 || n > 24 * 60)
				throw new ValidationError('Duration is between 5 and 1440 minutes.', { duration_min: 'Invalid' });
			out.duration_min = n;
		}
		if ('participant_ids' in input || !existing)
			out.participant_ids = JSON.stringify(idList(input.participant_ids));
		if ('participants_note' in input) out.participants_note = optional(input.participants_note);
		if ('requirement_ids' in input || !existing)
			out.requirement_ids = JSON.stringify(idList(input.requirement_ids));
		if ('status' in input || !existing)
			out.status = oneOf(
				input.status || 'planned',
				['planned', 'held'] as const,
				'status',
				'Status is planned or held.'
			);
		if ('proposed' in input) out.proposed = input.proposed === true || Number(input.proposed) === 1 ? 1 : 0;
		else if (!existing) out.proposed = 0;
		if ('location' in input) out.location = optional(input.location);
		return out;
	},
	afterWrite(app, _actor, row) {
		if (Number(row.deleted) === 1) return;
		const engagementId = String(row.engagement_id);
		assertSelected(app, engagementId, idList(row.requirement_ids), 'An event');
		const e = getEngagement(app, engagementId);
		const people = new Set(listPeople(app, e.auditeeId).map((p) => p.id));
		if (idList(row.participant_ids).some((id) => !people.has(id)))
			throw new ValidationError('Participants are roles recorded for this auditee.', {
				participant_ids: 'Unknown role'
			});
	},
	search: (row) => ({
		title: row.title as string,
		participants_note: row.participants_note as string | null
	}),
	label: (row) => String(row.title),
	refLine: (row) =>
		[
			row.date ?? 'No date',
			row.start_time,
			FORMAT_LABELS[row.format as EventFormat],
			`${row.duration_min} min`
		]
			.filter(Boolean)
			.join(' · ')
});

export const evidenceDefinition: EntityDefinition = registerEntity({
	type: 'evidence_item',
	table: 'evidence_item',
	columns: [
		'engagement_id',
		'event_id',
		'text',
		'kind',
		'criticality',
		'requirement_ids',
		'scope_id',
		'status',
		'promised_by',
		'promised_due',
		'proposed',
		'position'
	],
	detailColumns: ['text', 'kind', 'criticality', 'status', 'promised_by', 'promised_due', 'proposed'],
	fieldLabels: {
		text: 'Expected evidence',
		kind: 'Kind',
		criticality: 'Criticality',
		requirement_ids: 'Requirements',
		scope_id: 'Scope',
		status: 'Status',
		promised_by: 'Promised by',
		promised_due: 'Promised by date',
		proposed: 'Review',
		event_id: 'Event',
		position: 'Position'
	},
	formatValue(column, value) {
		if (column === 'kind') return KIND_LABELS[value as EvidenceKind] ?? String(value ?? '');
		if (column === 'criticality') return cap(String(value ?? ''));
		if (column === 'status') return STATUS_LABELS[value as EvidenceStatus] ?? String(value ?? '');
		if (column === 'proposed') return flagLabel(value);
		if (column === 'scope_id') return value ? String(value) : 'All scopes';
		if (column === 'requirement_ids') return `${idList(value).length}`;
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	engagementOf: (app, row) => engagementGuard(app, row.engagement_id),
	judgement: () => ({ column: 'proposed', proposed: 1 }),
	parse(input, existing) {
		const out: Row = {};
		if (!existing) {
			out.engagement_id = str(input.engagement_id);
			out.event_id = str(input.event_id);
		} else if ('event_id' in input) out.event_id = str(input.event_id);
		if ('text' in input || !existing) {
			const t = str(input.text);
			if (!t) throw new ValidationError('Say what evidence you expect to see.', { text: 'Required' });
			out.text = t;
		}
		if ('kind' in input || !existing)
			out.kind = oneOf(
				input.kind || 'record',
				EVIDENCE_KINDS,
				'kind',
				'Kind is rule, record, observation, testimony or technical.'
			);
		if ('criticality' in input || !existing)
			out.criticality = oneOf(
				input.criticality || 'medium',
				CRITICALITY,
				'criticality',
				'Criticality is high, medium or low.'
			);
		if ('requirement_ids' in input || !existing)
			out.requirement_ids = JSON.stringify(idList(input.requirement_ids));
		if ('scope_id' in input) out.scope_id = optional(input.scope_id);
		if ('status' in input || !existing)
			out.status = oneOf(
				input.status || 'planned',
				EVIDENCE_STATUSES,
				'status',
				'Status is planned, received, partly received, promised or missing.'
			);
		if ('promised_by' in input) out.promised_by = optional(input.promised_by);
		if ('promised_due' in input) {
			const d = optional(input.promised_due);
			if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d))
				throw new ValidationError('Use a date such as 2026-11-20.', { promised_due: 'Not a date' });
			out.promised_due = d;
		}
		if ('proposed' in input) out.proposed = input.proposed === true || Number(input.proposed) === 1 ? 1 : 0;
		else if (!existing) out.proposed = 0;
		if ('position' in input) out.position = Number(input.position) || 0;
		return out;
	},
	afterWrite(app, _actor, row) {
		if (Number(row.deleted) === 1) return;
		const engagementId = String(row.engagement_id);
		const ev = readRow(app, eventDefinition, String(row.event_id));
		if (!ev || Number(ev.deleted) === 1 || ev.engagement_id !== engagementId)
			throw new ValidationError('Choose an event of this engagement.');
		assertSelected(app, engagementId, idList(row.requirement_ids), 'Planned evidence');
		if (row.scope_id && !listScopes(app, engagementId).some((s) => s.id === row.scope_id))
			throw new ValidationError('Unknown scope.', { scope_id: 'Unknown' });
	},
	search: (row) => ({ text: row.text as string }),
	label: (row) => String(row.text),
	refLine: (row) =>
		`Planned evidence · ${KIND_LABELS[row.kind as EvidenceKind] ?? ''} · ${cap(String(row.criticality ?? ''))}`
});

// ---- Read models

export interface PlanEvent {
	id: string;
	title: string;
	format: EventFormat;
	formatLabel: string;
	date: string | null;
	startTime: string | null;
	durationMin: number;
	participantIds: string[];
	participants: { id: string; label: string }[];
	participantsNote: string | null;
	/** Everyone, as one line: roles (with names) and the free-text note. */
	participantsLine: string;
	requirementIds: string[];
	requirements: { id: string; refCode: string; title: string }[];
	status: 'planned' | 'held';
	proposed: boolean;
	location: string | null;
	evidence: { total: number; received: number; open: number };
	version: number;
}

export function personLabel(p: Pick<Person, 'role' | 'name'>): string {
	return p.name ? `${p.role} (${p.name})` : p.role;
}

function eventSort(a: PlanEvent, b: PlanEvent): number {
	const k = (e: PlanEvent) => `${e.date ?? '9999-99-99'} ${e.startTime ?? '99:99'}`;
	return k(a).localeCompare(k(b));
}

export function listEvents(app: AppDatabase, engagementId: string): PlanEvent[] {
	const e = getEngagement(app, engagementId);
	const people = new Map(listPeople(app, e.auditeeId).map((p) => [p.id, p]));
	const reqs = new Map(listSelected(app, e.id).map((s) => [s.requirementId, s]));
	const counts = new Map(
		(
			app.sqlite
				.prepare(
					`SELECT event_id, count(*) AS total, sum(status = 'received') AS received, sum(status IN ('planned', 'promised', 'missing', 'partial')) AS open
					   FROM evidence_item WHERE engagement_id = ? AND deleted = 0 GROUP BY event_id`
				)
				.all(e.id) as { event_id: string; total: number; received: number; open: number }[]
		).map((c) => [c.event_id, c])
	);
	const rows = app.sqlite
		.prepare('SELECT * FROM event WHERE engagement_id = ? AND deleted = 0 ORDER BY created_at')
		.all(e.id) as Row[];
	return rows
		.map((r) => {
			const participantIds = idList(r.participant_ids);
			const participants = participantIds.flatMap((id) =>
				people.has(id) ? [{ id, label: personLabel(people.get(id)!) }] : []
			);
			const note = (r.participants_note as string | null) ?? null;
			const requirementIds = idList(r.requirement_ids);
			const c = counts.get(String(r.id));
			return {
				id: String(r.id),
				title: String(r.title),
				format: r.format as EventFormat,
				formatLabel: FORMAT_LABELS[r.format as EventFormat],
				date: (r.date as string | null) ?? null,
				startTime: (r.start_time as string | null) ?? null,
				durationMin: Number(r.duration_min),
				participantIds,
				participants,
				participantsNote: note,
				participantsLine: [...participants.map((p) => p.label), ...(note ? [note] : [])].join(', '),
				requirementIds,
				requirements: requirementIds.flatMap((id) => {
					const s = reqs.get(id);
					return s ? [{ id, refCode: s.refCode, title: s.pinned.title }] : [];
				}),
				status: r.status === 'held' ? 'held' : 'planned',
				proposed: Number(r.proposed) === 1,
				location: (r.location as string | null) ?? null,
				evidence: { total: c?.total ?? 0, received: c?.received ?? 0, open: c?.open ?? 0 },
				version: Number(r.current_version)
			} satisfies PlanEvent;
		})
		.sort(eventSort);
}

export function getEvent(app: AppDatabase, engagementId: string, id: string): PlanEvent {
	const ev = listEvents(app, engagementId).find((x) => x.id === id);
	if (!ev) throw new NotFoundError('Event not found');
	return ev;
}

export interface EvidenceItem {
	id: string;
	eventId: string;
	text: string;
	kind: EvidenceKind;
	criticality: Criticality;
	requirementIds: string[];
	requirementRefs: string[];
	scopeId: string | null;
	scopeName: string;
	status: EvidenceStatus;
	promisedBy: string | null;
	promisedDue: string | null;
	proposed: boolean;
	version: number;
}

const CRIT_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const OPEN_ORDER: Record<string, number> = { missing: 0, promised: 1, planned: 2, partial: 3, received: 4 };

/** Planned evidence, open and high-criticality first. */
export function listEvidence(
	app: AppDatabase,
	engagementId: string,
	options: { eventId?: string } = {}
): EvidenceItem[] {
	const refs = new Map(listSelected(app, engagementId).map((s) => [s.requirementId, s.refCode]));
	const scopes = new Map(listScopes(app, engagementId).map((s) => [s.id, s.name]));
	const rows = app.sqlite
		.prepare(
			`SELECT * FROM evidence_item WHERE engagement_id = ? AND deleted = 0 ${options.eventId ? 'AND event_id = ?' : ''} ORDER BY position, created_at`
		)
		.all(...[engagementId, ...(options.eventId ? [options.eventId] : [])]) as Row[];
	return rows
		.map((r) => {
			const requirementIds = idList(r.requirement_ids);
			const scopeId = (r.scope_id as string | null) ?? null;
			return {
				id: String(r.id),
				eventId: String(r.event_id),
				text: String(r.text),
				kind: r.kind as EvidenceKind,
				criticality: r.criticality as Criticality,
				requirementIds,
				requirementRefs: requirementIds.map((id) => refs.get(id) ?? '(deselected)'),
				scopeId,
				scopeName: scopeId ? (scopes.get(scopeId) ?? '') : 'All scopes',
				status: r.status as EvidenceStatus,
				promisedBy: (r.promised_by as string | null) ?? null,
				promisedDue: (r.promised_due as string | null) ?? null,
				proposed: Number(r.proposed) === 1,
				version: Number(r.current_version)
			};
		})
		.sort(
			(a, b) =>
				(a.status === 'received' ? 1 : 0) - (b.status === 'received' ? 1 : 0) ||
				CRIT_ORDER[a.criticality]! - CRIT_ORDER[b.criticality]! ||
				OPEN_ORDER[a.status]! - OPEN_ORDER[b.status]!
		);
}

// ---- Event commands

export interface EventInput {
	title?: string;
	format?: string;
	date?: string | null;
	start_time?: string | null;
	duration_min?: number | string | null;
	participant_ids?: string[];
	participants_note?: string | null;
	requirement_ids?: string[];
	status?: string;
	location?: string | null;
}

export function addEvent(app: AppDatabase, actor: Actor, engagementId: string, input: EventInput): PlanEvent {
	getEngagement(app, engagementId);
	const row = createEntity(app, actor, eventDefinition, { ...input, engagement_id: engagementId }).row;
	return getEvent(app, engagementId, String(row.id));
}

export function updateEvent(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string,
	baseVersion: number,
	input: EventInput
): PlanEvent {
	getEvent(app, engagementId, id);
	updateEntity(app, actor, eventDefinition, id, baseVersion, { ...input });
	return getEvent(app, engagementId, id);
}

/** Remove an event with its planned evidence. Both stay in the history. */
export function removeEvent(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string,
	note = 'Event removed'
): void {
	const ev = getEvent(app, engagementId, id);
	app.sqlite.transaction(() => {
		for (const x of listEvidence(app, engagementId, { eventId: id }))
			deleteEntity(app, actor, evidenceDefinition, x.id, x.version, `${note} with its event`);
		deleteEntity(app, actor, eventDefinition, id, ev.version, note);
	})();
}

/** Accepting a drafted event (and the evidence drafted with it) is a judgement: people only. */
export function acceptEvent(app: AppDatabase, actor: Actor, engagementId: string, id: string): PlanEvent {
	requireHuman(actor, 'Accepting a drafted event');
	return app.sqlite.transaction(() => {
		const ev = getEvent(app, engagementId, id);
		if (ev.proposed) updateEntity(app, actor, eventDefinition, id, ev.version, { proposed: 0 }, 'Accepted');
		for (const x of listEvidence(app, engagementId, { eventId: id }).filter((x) => x.proposed))
			updateEntity(
				app,
				actor,
				evidenceDefinition,
				x.id,
				x.version,
				{ proposed: 0 },
				'Accepted with its event'
			);
		return getEvent(app, engagementId, id);
	})();
}

export function rejectEvent(app: AppDatabase, actor: Actor, engagementId: string, id: string): void {
	removeEvent(app, actor, engagementId, id, 'Draft rejected');
}

export function acceptAllEvents(app: AppDatabase, actor: Actor, engagementId: string): number {
	requireHuman(actor, 'Accepting drafted events');
	return app.sqlite.transaction(() => {
		const drafts = listEvents(app, engagementId).filter((e) => e.proposed || e.evidence.total > 0);
		let n = 0;
		for (const ev of drafts) {
			const hadDraft = ev.proposed;
			acceptEvent(app, actor, engagementId, ev.id);
			if (hadDraft) n++;
		}
		return n;
	})();
}

/** Put a requirement into an event, or take it out: the coverage view's pills. */
export function setEventRequirement(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	eventId: string,
	requirementId: string,
	included: boolean
): PlanEvent {
	const ev = getEvent(app, engagementId, eventId);
	const has = ev.requirementIds.includes(requirementId);
	if (has === included) return ev;
	const ids = included
		? [...ev.requirementIds, requirementId]
		: ev.requirementIds.filter((r) => r !== requirementId);
	return updateEvent(app, actor, engagementId, eventId, ev.version, { requirement_ids: ids });
}

// ---- Evidence commands

export interface EvidenceInput {
	text?: string;
	kind?: string;
	criticality?: string | null;
	requirement_ids?: string[];
	scope_id?: string | null;
	status?: string;
	promised_by?: string | null;
	promised_due?: string | null;
}

/** The default criticality for evidence: the highest criticality of its requirements (risks or override). */
export function defaultCriticality(
	app: AppDatabase,
	engagementId: string,
	requirementIds: string[]
): Criticality {
	const crit = criticalityOf(app, engagementId);
	const levels = requirementIds.map((id) => crit.get(id)?.level ?? 'medium');
	return levels.sort((a, b) => CRIT_ORDER[a]! - CRIT_ORDER[b]!)[0] ?? 'medium';
}

export function addEvidence(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	eventId: string,
	input: EvidenceInput
): EvidenceItem {
	const ev = getEvent(app, engagementId, eventId);
	const requirementIds = input.requirement_ids ?? (ev.requirementIds.length === 1 ? ev.requirementIds : []);
	const row = createEntity(app, actor, evidenceDefinition, {
		...input,
		requirement_ids: requirementIds,
		criticality: input.criticality || defaultCriticality(app, engagementId, requirementIds),
		engagement_id: engagementId,
		event_id: eventId,
		position: listEvidence(app, engagementId, { eventId }).length
	}).row;
	return listEvidence(app, engagementId).find((x) => x.id === String(row.id))!;
}

function evidenceRow(app: AppDatabase, engagementId: string, id: string): Row {
	const row = readRow(app, evidenceDefinition, id);
	if (!row || Number(row.deleted) === 1 || row.engagement_id !== engagementId)
		throw new NotFoundError('Planned evidence not found');
	return row;
}

export function updateEvidence(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	id: string,
	baseVersion: number,
	input: EvidenceInput
): EvidenceItem {
	evidenceRow(app, engagementId, id);
	updateEntity(app, actor, evidenceDefinition, id, baseVersion, { ...input });
	return listEvidence(app, engagementId).find((x) => x.id === id)!;
}

export function removeEvidence(app: AppDatabase, actor: Actor, engagementId: string, id: string): void {
	const row = evidenceRow(app, engagementId, id);
	deleteEntity(app, actor, evidenceDefinition, id, Number(row.current_version), 'Planned evidence removed');
}

// ---- Coverage

export interface CoverageRow {
	requirementId: string;
	refCode: string;
	sourceCode: string;
	title: string;
	events: { id: string; title: string; date: string | null; startTime: string | null; proposed: boolean }[];
}

/** Per selected requirement, the events that include it. Uncovered requirements first. */
export function coverage(
	app: AppDatabase,
	engagementId: string
): { rows: CoverageRow[]; covered: number; total: number } {
	const events = listEvents(app, engagementId);
	const rows = listSelected(app, engagementId).map((s) => ({
		requirementId: s.requirementId,
		refCode: s.refCode,
		sourceCode: s.sourceCode,
		title: s.pinned.title,
		events: events
			.filter((e) => e.requirementIds.includes(s.requirementId))
			.map((e) => ({ id: e.id, title: e.title, date: e.date, startTime: e.startTime, proposed: e.proposed }))
	}));
	rows.sort((a, b) => (a.events.length ? 1 : 0) - (b.events.length ? 1 : 0));
	return { rows, covered: rows.filter((r) => r.events.length).length, total: rows.length };
}

// ---- Plan status

const TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
	draft: ['sent'],
	sent: ['agreed', 'draft'],
	agreed: ['draft']
};

/** The time of the last change to any event or planned evidence of the engagement, or null. */
export function lastPlanChange(app: AppDatabase, engagementId: string): Date | null {
	const row = app.sqlite
		.prepare(
			`SELECT max(r.created_at) AS at FROM revision r
			   WHERE (r.entity_type = 'event' AND r.entity_id IN (SELECT id FROM event WHERE engagement_id = ?))
			      OR (r.entity_type = 'evidence_item' AND r.entity_id IN (SELECT id FROM evidence_item WHERE engagement_id = ?))`
		)
		.get(engagementId, engagementId) as { at: number | null };
	return row.at ? new Date(row.at) : null;
}

export interface PlanState {
	status: PlanStatus;
	at: Date | null;
	/** True when an event or planned evidence changed after the plan was sent or agreed. */
	changedSince: boolean;
	next: PlanStatus[];
}

export function planState(app: AppDatabase, e: Engagement): PlanState {
	const last = lastPlanChange(app, e.id);
	return {
		status: e.planStatus,
		at: e.planStatusAt,
		changedSince:
			e.planStatus !== 'draft' && !!e.planStatusAt && !!last && last.getTime() > e.planStatusAt.getTime(),
		next: TRANSITIONS[e.planStatus]
	};
}

/**
 * Send, agree, return to draft or reopen the plan as a whole. People only, in the app. Events stay
 * editable in every state; changes afterwards are flagged by planState().
 */
export function setPlanStatus(
	app: AppDatabase,
	actor: Actor,
	engagementId: string,
	baseVersion: number,
	to: PlanStatus
): Engagement {
	requireHuman(actor, 'Changing the plan status');
	const e = getEngagement(app, engagementId);
	if (!TRANSITIONS[e.planStatus].includes(to))
		throw new ValidationError(
			`The plan is ${e.planStatus}; it can go to ${TRANSITIONS[e.planStatus].join(' or ')}.`
		);
	const notes: Record<string, string> = {
		sent: 'Plan sent to auditee',
		agreed: 'Plan agreed',
		draft: e.planStatus === 'agreed' ? 'Plan reopened' : 'Plan back to draft'
	};
	updateEntity(
		app,
		actor,
		engagementDefinition,
		engagementId,
		baseVersion,
		{ plan_status: to, plan_status_at: Date.now() },
		notes[to]
	);
	return getEngagement(app, engagementId);
}
