import type { AppDatabase } from '#lib/db/client.ts';
import { countComments, listComments, type Comment } from './comments';
import { NotFoundError, ValidationError } from './errors';
import { authorshipLabel, formatValue, getHistory, humanize, type HistoryEntry } from './history';
import { entityDefinition } from './registry';
import { readRow, revertEntity, type Actor } from './write';
import './entities';

/** What the item sheet shows for any record: the same four tabs for every entity type. */
export interface ItemView {
	type: string;
	id: string;
	label: string;
	refLine: string | null;
	version: number;
	deleted: boolean;
	details: { field: string; label: string; value: string }[];
	lastAuthor: string;
	lastChannel: string;
	updatedAt: Date;
	counts: { links: number; comments: number; history: number };
}

/** Parse "user:abc" from `?item=`. */
export function parseItemKey(key: string | null | undefined): { type: string; id: string } | null {
	if (!key) return null;
	const at = key.indexOf(':');
	if (at <= 0 || at === key.length - 1) return null;
	return { type: key.slice(0, at), id: key.slice(at + 1) };
}

export function getItem(app: AppDatabase, type: string, id: string): ItemView {
	const def = entityDefinition(type);
	const row = readRow(app, def, id);
	if (!row) throw new NotFoundError(`${type} ${id} not found`);
	const history = getHistory(app, def, id);
	const latest = history[0]!;
	const columns = def.detailColumns ?? def.columns;
	return {
		type,
		id,
		label: def.label(row),
		refLine: def.refLine?.(row) ?? null,
		version: Number(row.current_version),
		deleted: Number(row.deleted) === 1,
		details: columns.map((c) => ({
			field: c,
			label: def.fieldLabels?.[c] ?? humanize(c),
			value: formatValue(def, c, row[c])
		})),
		lastAuthor: authorshipLabel(latest.authorName, latest.authorAgent),
		lastChannel: latest.channel,
		updatedAt: new Date(Number(row.updated_at)),
		counts: { links: 0, comments: countComments(app, type, id), history: history.length }
	};
}

export function getItemHistory(app: AppDatabase, type: string, id: string): HistoryEntry[] {
	return getHistory(app, entityDefinition(type), id);
}

export function getItemComments(app: AppDatabase, type: string, id: string): Comment[] {
	const def = entityDefinition(type);
	if (!readRow(app, def, id)) throw new NotFoundError(`${type} ${id} not found`);
	return listComments(app, type, id);
}

/** Revert any item to an earlier version. Creates a new version; the entity's own rules still apply. */
export function revertItem(
	app: AppDatabase,
	actor: Actor,
	type: string,
	id: string,
	baseVersion: number,
	toVersion: number
) {
	if (!Number.isInteger(toVersion) || toVersion < 1)
		throw new ValidationError('Choose a version to revert to.');
	return revertEntity(
		app,
		actor,
		entityDefinition(type),
		id,
		baseVersion,
		toVersion,
		`Reverted to v${toVersion}`
	);
}
