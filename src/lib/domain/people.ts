import type { AppDatabase } from '#lib/db/client.ts';
import { getAuditee } from './engagements';
import { NotFoundError, ValidationError } from './errors';
import { requireHuman } from './guards';
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

/** Roles at the auditee to engage with. The role is required; name, email and unit are optional. */

const str = (v: unknown) => (v == null ? '' : String(v)).trim();
const optional = (v: unknown) => str(v) || null;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const personDefinition: EntityDefinition = registerEntity({
	type: 'person',
	table: 'person',
	columns: [
		'auditee_id',
		'role',
		'name',
		'email',
		'unit',
		'responsibilities',
		'source_document',
		'source_section',
		'status'
	],
	detailColumns: [
		'role',
		'name',
		'unit',
		'email',
		'responsibilities',
		'source_document',
		'source_section',
		'status'
	],
	fieldLabels: {
		role: 'Role',
		name: 'Name',
		email: 'Email',
		unit: 'Unit',
		responsibilities: 'Responsibilities',
		source_document: 'Found in',
		source_section: 'Section',
		status: 'Status'
	},
	formatValue(column, value) {
		if (column === 'responsibilities') return parseList(value).join('; ');
		if (column === 'status') return value === 'proposed' ? 'Proposed' : 'Confirmed';
		if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	/** Roles derived by AI are proposals until a person accepts them. */
	judgement: () => ({ column: 'status', proposed: 'proposed' }),
	parse(input, existing) {
		const out: Row = {};
		if (!existing) out.auditee_id = str(input.auditee_id);
		if ('role' in input || !existing) {
			const role = str(input.role);
			if (!role) throw new ValidationError('Name the role, for example "Head of IT".', { role: 'Required' });
			out.role = role;
		}
		for (const col of ['name', 'unit', 'source_document', 'source_section'] as const)
			if (col in input) out[col] = optional(input[col]);
		if ('email' in input) {
			const email = optional(input.email);
			if (email && !EMAIL.test(email))
				throw new ValidationError('Enter an email address or leave it empty.', {
					email: 'Not an email address'
				});
			out.email = email;
		}
		if ('responsibilities' in input || !existing)
			out.responsibilities = JSON.stringify(cleanList(input.responsibilities));
		if ('status' in input || !existing) out.status = input.status === 'proposed' ? 'proposed' : 'confirmed';
		return out;
	},
	search: (row) => ({ role: row.role as string, name: row.name as string | null }),
	label: (row) => String(row.role),
	refLine: (row) => [row.name, row.unit].filter(Boolean).join(' · ') || 'Role'
});

export function cleanList(v: unknown): string[] {
	const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [];
	return list.map((x) => str(x)).filter(Boolean);
}

function parseList(v: unknown): string[] {
	if (Array.isArray(v)) return v.map(String);
	try {
		const p = JSON.parse(String(v ?? '[]'));
		return Array.isArray(p) ? p.map(String) : [];
	} catch {
		return [];
	}
}

export interface Person {
	id: string;
	role: string;
	name: string | null;
	email: string | null;
	unit: string | null;
	responsibilities: string[];
	sourceDocument: string | null;
	sourceSection: string | null;
	status: 'proposed' | 'confirmed';
	version: number;
}

function toPerson(r: Row): Person {
	return {
		id: String(r.id),
		role: String(r.role),
		name: (r.name as string | null) ?? null,
		email: (r.email as string | null) ?? null,
		unit: (r.unit as string | null) ?? null,
		responsibilities: parseList(r.responsibilities),
		sourceDocument: (r.source_document as string | null) ?? null,
		sourceSection: (r.source_section as string | null) ?? null,
		status: r.status as Person['status'],
		version: Number(r.current_version)
	};
}

export function listPeople(app: AppDatabase, auditeeId: string): Person[] {
	return (
		app.sqlite
			.prepare(
				"SELECT * FROM person WHERE auditee_id = ? AND deleted = 0 ORDER BY status = 'confirmed', created_at"
			)
			.all(auditeeId) as Row[]
	).map(toPerson);
}

export interface PersonInput {
	role: string;
	name?: string | null;
	email?: string | null;
	unit?: string | null;
	responsibilities?: string[] | string;
	source_document?: string | null;
	source_section?: string | null;
}

export function addPerson(app: AppDatabase, actor: Actor, auditeeId: string, input: PersonInput): Person {
	getAuditee(app, auditeeId);
	return toPerson(createEntity(app, actor, personDefinition, { ...input, auditee_id: auditeeId }).row);
}

function personOf(app: AppDatabase, id: string): Row {
	const row = readRow(app, personDefinition, id);
	if (!row || Number(row.deleted) === 1) throw new NotFoundError('Role not found');
	return row;
}

export function updatePerson(
	app: AppDatabase,
	actor: Actor,
	id: string,
	baseVersion: number,
	input: Partial<PersonInput>
): Person {
	return toPerson(updateEntity(app, actor, personDefinition, id, baseVersion, input).row);
}

/** Accepting a proposed role is a judgement: people only. */
export function acceptPerson(app: AppDatabase, actor: Actor, id: string): Person {
	requireHuman(actor, 'Accepting a proposed role');
	const row = personOf(app, id);
	return toPerson(
		updateEntity(
			app,
			actor,
			personDefinition,
			id,
			Number(row.current_version),
			{ status: 'confirmed' },
			'Accepted'
		).row
	);
}

export function rejectPerson(app: AppDatabase, actor: Actor, id: string): void {
	const row = personOf(app, id);
	deleteEntity(
		app,
		actor,
		personDefinition,
		id,
		Number(row.current_version),
		row.status === 'proposed' ? 'Proposal rejected' : 'Removed'
	);
}

export function acceptAllPeople(app: AppDatabase, actor: Actor, auditeeId: string): number {
	requireHuman(actor, 'Accepting proposed roles');
	return app.sqlite.transaction(() => {
		const proposed = listPeople(app, auditeeId).filter((p) => p.status === 'proposed');
		for (const p of proposed)
			updateEntity(app, actor, personDefinition, p.id, p.version, { status: 'confirmed' }, 'Accepted');
		return proposed.length;
	})();
}
