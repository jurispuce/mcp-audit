import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '#lib/db/client.ts';
import { indexText, removeFromIndex } from '#lib/db/fts.ts';
import { ForbiddenError, NotFoundError, StaleWriteError, ValidationError } from './errors';

/**
 * The one write path. Every create, update, delete and revert of a versioned entity goes through
 * `write()`: it validates, checks the version the change was based on, writes the entity row and
 * appends a full snapshot to `revision`, all in one transaction.
 */

export type Channel = 'ui' | 'mcp' | 'ai';
export const CHANNELS: readonly Channel[] = ['ui', 'mcp', 'ai'];

/** Who is writing. An AI write always has both the user it acts for and the agent. */
export interface Actor {
	userId: string;
	agent?: string | null;
	channel: Channel;
}

export type SqlValue = string | number | bigint | null;
export type Row = Record<string, SqlValue>;

/** Columns managed by `write()`; never part of an entity's own data. */
export const BOOKKEEPING_COLUMNS = [
	'id',
	'current_version',
	'created_at',
	'created_by',
	'updated_at',
	'updated_by'
] as const;

export type WriteOp =
	| { op: 'create'; id?: string; data: Record<string, unknown>; note?: string }
	| { op: 'update'; id: string; baseVersion: number; data: Record<string, unknown>; note?: string }
	| { op: 'delete'; id: string; baseVersion: number; note?: string }
	| { op: 'revert'; id: string; baseVersion: number; toVersion: number; note?: string };

export interface EntityDefinition {
	/** Entity type name used in revisions, comments and `?item=<type>:<id>`. */
	type: string;
	/** SQL table name. */
	table: string;
	/** The entity's own data columns (snake_case). Revert restores exactly these plus `deleted`. */
	columns: readonly string[];
	/**
	 * Validate input and return column values. `existing` is the current row on update.
	 * Return only the columns being set.
	 */
	parse(input: Record<string, unknown>, existing: Row | null): Row;
	/** Optional: decide whether the actor may perform this write. Throw ForbiddenError to refuse. */
	authorize?(app: AppDatabase, actor: Actor, op: WriteOp, existing: Row | null): void;
	/**
	 * Optional: runs inside the same transaction after the row and revision are written.
	 * Throw to roll the whole write back (for example to keep at least one admin).
	 */
	afterWrite?(app: AppDatabase, actor: Actor, row: Row, existing: Row | null, op: WriteOp): void;
	/** Optional: text fields to keep in the full-text index. */
	search?(row: Row): Record<string, string | null>;
	/** Short human label for lists, history and the item sheet. */
	label(row: Row): string;
	/** Reference line shown above the title, for example "A.5.15 · Head office". */
	refLine?(row: Row): string;
	/** Column labels for history and the details tab. */
	fieldLabels?: Record<string, string>;
	/** Optional: how a stored value reads in the details tab and history (for example 1 -> "Yes"). */
	formatValue?(column: string, value: SqlValue): string;
	/** Optional: columns to show in the details tab, in order. Defaults to `columns`. */
	detailColumns?: readonly string[];
}

export interface WriteOptions {
	/** Skip the definition's authorize hook. Only for domain bootstrapping (first user, seed). */
	skipAuthorization?: boolean;
	/** Clock override for tests. */
	now?: Date;
}

export interface WriteResult {
	row: Row;
	version: number;
	/** False when an update changed nothing; no revision is written then. */
	changed: boolean;
}

export function assertActor(actor: Actor): void {
	if (!actor || typeof actor.userId !== 'string' || !actor.userId) {
		throw new ForbiddenError('Every write needs an authenticated user.');
	}
	if (!CHANNELS.includes(actor.channel)) {
		throw new ValidationError(`Unknown channel ${String(actor.channel)}`);
	}
	if (actor.channel !== 'ui' && !actor.agent) {
		throw new ForbiddenError('An AI write must record the agent as well as the user.');
	}
}

function quoteIdent(name: string): string {
	if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier ${name}`);
	return `"${name}"`;
}

export function readRow(app: AppDatabase, def: EntityDefinition, id: string): Row | null {
	const row = app.sqlite.prepare(`SELECT * FROM ${quoteIdent(def.table)} WHERE id = ?`).get(id) as
		Row | undefined;
	return row ?? null;
}

/** Equal as stored: 1 and 1n, or "5" and 5, are the same value; null only equals null. */
function sameValue(a: SqlValue | undefined, b: SqlValue | undefined): boolean {
	const x = a ?? null;
	const y = b ?? null;
	if (x === null || y === null) return x === y;
	return String(x) === String(y);
}

export function write(
	app: AppDatabase,
	actor: Actor,
	def: EntityDefinition,
	op: WriteOp,
	options: WriteOptions = {}
): WriteResult {
	assertActor(actor);
	const table = quoteIdent(def.table);
	const allowed = new Set<string>([...def.columns, 'deleted']);

	const run = app.sqlite.transaction((): WriteResult => {
		try {
			return inner();
		} catch (e) {
			throw uniqueToValidation(def, e);
		}
	});

	const inner = (): WriteResult => {
		const now = (options.now ?? new Date()).getTime();
		const existing = op.op === 'create' ? null : readRow(app, def, op.id);

		if (op.op !== 'create') {
			if (!existing) throw new NotFoundError(`${def.type} ${op.id} not found`);
			if (!Number.isInteger(op.baseVersion)) {
				throw new ValidationError('baseVersion is required: send the version your change is based on.');
			}
			const currentVersion = Number(existing.current_version);
			if (currentVersion !== op.baseVersion) {
				throw new StaleWriteError(def.type, op.id, op.baseVersion, currentVersion, existing);
			}
		}

		if (!options.skipAuthorization) def.authorize?.(app, actor, op, existing);

		let changes: Row;
		let revertedFrom: number | null = null;
		switch (op.op) {
			case 'create':
			case 'update': {
				if (existing && Number(existing.deleted) === 1 && op.op === 'update') {
					throw new ValidationError(`${def.type} ${op.id} is deleted. Revert to restore it first.`);
				}
				changes = def.parse(op.data, existing);
				break;
			}
			case 'delete': {
				if (Number(existing!.deleted) === 1)
					throw new ValidationError(`${def.type} ${op.id} is already deleted.`);
				changes = { deleted: 1 };
				break;
			}
			case 'revert': {
				const currentVersion = Number(existing!.current_version);
				if (op.toVersion === currentVersion) {
					throw new ValidationError(`Version ${op.toVersion} is already the current version.`);
				}
				const rev = app.sqlite
					.prepare('SELECT snapshot FROM revision WHERE entity_type = ? AND entity_id = ? AND version = ?')
					.get(def.type, op.id, op.toVersion) as { snapshot: string } | undefined;
				if (!rev) throw new NotFoundError(`${def.type} ${op.id} has no version ${op.toVersion}`);
				const snap = JSON.parse(rev.snapshot) as Row;
				changes = {};
				for (const col of allowed) changes[col] = snap[col] ?? null;
				revertedFrom = op.toVersion;
				break;
			}
		}

		for (const col of Object.keys(changes)) {
			if (!allowed.has(col)) throw new Error(`${def.type}.parse returned unknown column ${col}`);
		}

		let id: string;
		let version: number;
		if (op.op === 'create') {
			id = op.id ?? randomUUID();
			version = 1;
			const cols = ['id', 'current_version', 'created_at', 'created_by', 'updated_at', 'updated_by'];
			const vals: SqlValue[] = [id, 1, now, actor.userId, now, actor.userId];
			for (const [col, val] of Object.entries(changes)) {
				cols.push(col);
				vals.push(val);
			}
			app.sqlite
				.prepare(
					`INSERT INTO ${table} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
				)
				.run(...vals);
		} else {
			id = op.id;
			const effective = Object.entries(changes).filter(([col, val]) => !sameValue(existing![col], val));
			if (effective.length === 0 && op.op === 'update') {
				return { row: existing!, version: Number(existing!.current_version), changed: false };
			}
			version = Number(existing!.current_version) + 1;
			const sets = ['current_version = ?', 'updated_at = ?', 'updated_by = ?'];
			const vals: SqlValue[] = [version, now, actor.userId];
			for (const [col, val] of Object.entries(changes)) {
				sets.push(`${quoteIdent(col)} = ?`);
				vals.push(val);
			}
			const res = app.sqlite
				.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ? AND current_version = ?`)
				.run(...vals, id, version - 1);
			if (res.changes !== 1) {
				const current = readRow(app, def, id)!;
				throw new StaleWriteError(def.type, id, version - 1, Number(current.current_version), current);
			}
		}

		const row = readRow(app, def, id)!;
		app.sqlite
			.prepare(
				`INSERT INTO revision (entity_type, entity_id, version, snapshot, author_user, author_agent, channel, note, reverted_from, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				def.type,
				id,
				version,
				JSON.stringify(row),
				actor.userId,
				actor.agent ?? null,
				actor.channel,
				op.note ?? null,
				revertedFrom,
				now
			);

		def.afterWrite?.(app, actor, row, existing, op);

		if (def.search) {
			if (Number(row.deleted) === 1) removeFromIndex(app.sqlite, def.type, id);
			else
				for (const [field, text] of Object.entries(def.search(row)))
					indexText(app.sqlite, def.type, id, field, text);
		}

		return { row, version, changed: true };
	};

	return run();
}

/** Turn "UNIQUE constraint failed: user.email" into a validation error on that field. */
function uniqueToValidation(def: EntityDefinition, e: unknown): unknown {
	const err = e as { code?: string; message?: string };
	if (err?.code !== 'SQLITE_CONSTRAINT_UNIQUE') return e;
	const match = /UNIQUE constraint failed: ([\w.]+(?:, [\w.]+)*)/.exec(err.message ?? '');
	const columns = (match?.[1] ?? '').split(', ').map((c) => c.split('.').pop()!);
	const fields = Object.fromEntries(columns.filter(Boolean).map((c) => [c, 'Already in use']));
	const label = columns.map((c) => def.fieldLabels?.[c] ?? c).join(', ');
	return new ValidationError(`${label || 'Value'} is already in use.`, fields);
}

/** Convenience wrappers; each is one call to `write()`. */
export const createEntity = (
	app: AppDatabase,
	actor: Actor,
	def: EntityDefinition,
	data: Record<string, unknown>,
	extra: { id?: string; note?: string } = {},
	options?: WriteOptions
) => write(app, actor, def, { op: 'create', data, ...extra }, options);

export const updateEntity = (
	app: AppDatabase,
	actor: Actor,
	def: EntityDefinition,
	id: string,
	baseVersion: number,
	data: Record<string, unknown>,
	note?: string,
	options?: WriteOptions
) => write(app, actor, def, { op: 'update', id, baseVersion, data, note }, options);

export const deleteEntity = (
	app: AppDatabase,
	actor: Actor,
	def: EntityDefinition,
	id: string,
	baseVersion: number,
	note?: string,
	options?: WriteOptions
) => write(app, actor, def, { op: 'delete', id, baseVersion, note }, options);

export const revertEntity = (
	app: AppDatabase,
	actor: Actor,
	def: EntityDefinition,
	id: string,
	baseVersion: number,
	toVersion: number,
	note?: string,
	options?: WriteOptions
) => write(app, actor, def, { op: 'revert', id, baseVersion, toVersion, note }, options);

/** Rows that are not deleted. Lists never show deleted items. */
export function listActive(app: AppDatabase, def: EntityDefinition, orderBy = 'created_at'): Row[] {
	return app.sqlite
		.prepare(`SELECT * FROM ${quoteIdent(def.table)} WHERE deleted = 0 ORDER BY ${quoteIdent(orderBy)}`)
		.all() as Row[];
}
