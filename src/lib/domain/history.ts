import type { AppDatabase } from '#lib/db/client.ts';
import { NotFoundError } from './errors';
import { BOOKKEEPING_COLUMNS, type Channel, type EntityDefinition, type Row } from './write';

export interface FieldChange {
	field: string;
	label: string;
	from: string;
	to: string;
}

export interface HistoryEntry {
	version: number;
	createdAt: Date;
	authorUserId: string;
	authorName: string;
	authorAgent: string | null;
	channel: Channel;
	note: string | null;
	revertedFrom: number | null;
	/** What this version changed compared with the one before it. Empty for version 1. */
	changes: FieldChange[];
	/** Short description: Created, Deleted, Restored, Reverted to v2, or the changed field names. */
	summary: string;
	isCurrent: boolean;
	snapshot: Row;
}

const IGNORED = new Set<string>(BOOKKEEPING_COLUMNS);

export function diffSnapshots(def: EntityDefinition, before: Row | null, after: Row): FieldChange[] {
	if (!before) return [];
	const changes: FieldChange[] = [];
	for (const field of Object.keys(after)) {
		if (IGNORED.has(field)) continue;
		const from = before[field] ?? null;
		const to = after[field] ?? null;
		if (String(from) !== String(to) || (from === null) !== (to === null)) {
			changes.push({
				field,
				label: def.fieldLabels?.[field] ?? humanize(field),
				from: formatValue(def, field, from),
				to: formatValue(def, field, to)
			});
		}
	}
	return changes;
}

export function formatValue(def: EntityDefinition, column: string, value: Row[string] | undefined): string {
	if (def.formatValue) return def.formatValue(column, value ?? null);
	if (column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
	return value == null ? '' : String(value);
}

export function humanize(column: string): string {
	const s = column.replace(/_/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Every version of one item, newest first, with author, channel and changed fields. */
export function getHistory(app: AppDatabase, def: EntityDefinition, id: string): HistoryEntry[] {
	const rows = app.sqlite
		.prepare(
			`SELECT r.version, r.snapshot, r.author_user, r.author_agent, r.channel, r.note, r.reverted_from, r.created_at,
			        u.name AS author_name
			   FROM revision r LEFT JOIN "user" u ON u.id = r.author_user
			  WHERE r.entity_type = ? AND r.entity_id = ?
			  ORDER BY r.version ASC`
		)
		.all(def.type, id) as {
		version: number;
		snapshot: string;
		author_user: string;
		author_agent: string | null;
		channel: Channel;
		note: string | null;
		reverted_from: number | null;
		created_at: number;
		author_name: string | null;
	}[];
	if (rows.length === 0) throw new NotFoundError(`${def.type} ${id} has no history`);

	let previous: Row | null = null;
	const entries: HistoryEntry[] = [];
	for (const r of rows) {
		const snapshot = JSON.parse(r.snapshot) as Row;
		const changes = diffSnapshots(def, previous, snapshot);
		const deletedChange = changes.find((c) => c.field === 'deleted');
		let summary: string;
		if (r.version === 1) summary = 'Created';
		else if (r.reverted_from !== null) summary = `Reverted to v${r.reverted_from}`;
		else if (deletedChange && Number(snapshot.deleted) === 1) summary = 'Deleted';
		else if (deletedChange) summary = 'Restored';
		else
			summary = changes.length ? `Changed ${changes.map((c) => c.label.toLowerCase()).join(', ')}` : 'Saved';
		entries.push({
			version: r.version,
			createdAt: new Date(r.created_at),
			authorUserId: r.author_user,
			authorName: r.author_name ?? r.author_user,
			authorAgent: r.author_agent,
			channel: r.channel,
			note: r.note,
			revertedFrom: r.reverted_from,
			changes,
			summary,
			isCurrent: false,
			snapshot
		});
		previous = snapshot;
	}
	entries[entries.length - 1]!.isCurrent = true;
	return entries.reverse();
}

/** "Name" or "Claude on behalf of Name": how authorship reads everywhere in the interface. */
export function authorshipLabel(authorName: string, agent: string | null): string {
	return agent ? `${agent} on behalf of ${authorName}` : authorName;
}

/** Who made the current version of an item, as the interface shows it, and when. */
export function latestAuthorship(
	app: AppDatabase,
	entityType: string,
	entityId: string
): { by: string; at: Date; channel: Channel } | null {
	const row = app.sqlite
		.prepare(
			`SELECT r.author_agent, r.channel, r.created_at, coalesce(u.name, r.author_user) AS name
			   FROM revision r LEFT JOIN "user" u ON u.id = r.author_user
			  WHERE r.entity_type = ? AND r.entity_id = ? ORDER BY r.version DESC LIMIT 1`
		)
		.get(entityType, entityId) as
		{ author_agent: string | null; channel: Channel; created_at: number; name: string } | undefined;
	if (!row) return null;
	return {
		by: authorshipLabel(row.name, row.author_agent),
		at: new Date(row.created_at),
		channel: row.channel
	};
}
