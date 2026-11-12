import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '#lib/db/client.ts';
import { searchText } from '#lib/db/fts.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { ForbiddenError, NotFoundError, StaleWriteError, ValidationError } from './errors';
import { createTestEntityTables, mcpActor, testItem, testLink, uiActor } from './test-entities';
import {
	createEntity,
	deleteEntity,
	listActive,
	readRow,
	revertEntity,
	updateEntity,
	write,
	type Row
} from './write';

let app: AppDatabase;
beforeEach(() => {
	app = createTestDatabase();
	createTestEntityTables(app);
});
afterEach(() => app.close());

function revisions(id: string) {
	return app.sqlite.prepare('SELECT * FROM revision WHERE entity_id = ? ORDER BY version').all(id) as Record<
		string,
		unknown
	>[];
}

describe('domain write function (#14)', () => {
	it('creates an entity and its first revision with a full snapshot in one call', () => {
		const { row, version } = createEntity(app, uiActor, testItem, { title: 'Access control', body: 'x' });
		expect(version).toBe(1);
		expect(row).toMatchObject({ title: 'Access control', current_version: 1, deleted: 0 });
		const [rev] = revisions(String(row.id));
		expect(rev).toMatchObject({
			entity_type: 'test_item',
			version: 1,
			author_user: 'u-auditor',
			author_agent: null,
			channel: 'ui',
			reverted_from: null
		});
		expect(JSON.parse(String(rev!.snapshot))).toEqual(row);
	});

	it('gives every entity row current_version, created_at, created_by and deleted', () => {
		const now = new Date('2026-11-12T10:00:00Z');
		const { row } = createEntity(app, uiActor, testItem, { title: 'T' }, {}, { now });
		expect(row.current_version).toBe(1);
		expect(row.created_at).toBe(now.getTime());
		expect(row.created_by).toBe('u-auditor');
		expect(row.deleted).toBe(0);
	});

	it('records user and agent for an AI write, with the channel', () => {
		const { row } = createEntity(app, mcpActor, testItem, { title: 'From Claude' });
		expect(revisions(String(row.id))[0]).toMatchObject({
			author_user: 'u-auditor',
			author_agent: 'Claude',
			channel: 'mcp'
		});
	});

	it('refuses an AI write without an agent, a write without a user, and unknown channels', () => {
		expect(() => createEntity(app, { userId: 'u', channel: 'mcp' }, testItem, { title: 'x' })).toThrow(
			ForbiddenError
		);
		expect(() =>
			createEntity(app, { userId: 'u', channel: 'ai', agent: '' }, testItem, { title: 'x' })
		).toThrow(ForbiddenError);
		expect(() => createEntity(app, { userId: '', channel: 'ui' }, testItem, { title: 'x' })).toThrow(
			ForbiddenError
		);
		expect(() =>
			createEntity(app, { userId: 'u', channel: 'email' as never }, testItem, { title: 'x' })
		).toThrow(ValidationError);
		expect(app.sqlite.prepare('SELECT count(*) n FROM test_item').get()).toEqual({ n: 0 });
	});

	it('also enforces the agent rule in the database itself', () => {
		expect(() =>
			app.sqlite
				.prepare(
					"INSERT INTO revision (entity_type, entity_id, version, snapshot, author_user, channel, created_at) VALUES ('x','y',1,'{}','u','mcp',0)"
				)
				.run()
		).toThrow(/agent/);
	});

	it('writes nothing when validation fails', () => {
		expect(() => createEntity(app, uiActor, testItem, { title: '  ' })).toThrow(ValidationError);
		expect(app.sqlite.prepare('SELECT count(*) n FROM test_item').get()).toEqual({ n: 0 });
		expect(app.sqlite.prepare('SELECT count(*) n FROM revision').get()).toEqual({ n: 0 });
	});

	it('rolls back the entity row if anything later in the transaction fails', () => {
		const failing = {
			...testItem,
			search: () => {
				throw new Error('index down');
			}
		};
		expect(() => createEntity(app, uiActor, failing, { title: 'T' })).toThrow('index down');
		expect(app.sqlite.prepare('SELECT count(*) n FROM test_item').get()).toEqual({ n: 0 });
		expect(app.sqlite.prepare('SELECT count(*) n FROM revision').get()).toEqual({ n: 0 });
	});

	it('keeps revisions append-only at the database level', () => {
		const { row } = createEntity(app, uiActor, testItem, { title: 'T' });
		expect(() =>
			app.sqlite.prepare("UPDATE revision SET note = 'x' WHERE entity_id = ?").run(row.id)
		).toThrow(/append-only/);
		expect(() => app.sqlite.prepare('DELETE FROM revision WHERE entity_id = ?').run(row.id)).toThrow(
			/append-only/
		);
	});

	it('updates the full-text index with each write', () => {
		const { row } = createEntity(app, uiActor, testItem, { title: 'Supplier security' });
		expect(searchText(app.sqlite, 'supplier').map((h) => h.entityId)).toEqual([row.id]);
		updateEntity(app, uiActor, testItem, String(row.id), 1, { title: 'Vendor security' });
		expect(searchText(app.sqlite, 'supplier')).toHaveLength(0);
		expect(searchText(app.sqlite, 'vendor')).toHaveLength(1);
	});

	it('records the note given with a write', () => {
		const { row } = createEntity(app, uiActor, testItem, { title: 'T' }, { note: 'Imported from NIS 2' });
		expect(revisions(String(row.id))[0]?.note).toBe('Imported from NIS 2');
	});

	it('runs the authorize hook and skips it only when asked', () => {
		const guarded = {
			...testItem,
			authorize: () => {
				throw new ForbiddenError('no');
			}
		};
		expect(() => createEntity(app, uiActor, guarded, { title: 'T' })).toThrow(ForbiddenError);
		expect(createEntity(app, uiActor, guarded, { title: 'T' }, {}, { skipAuthorization: true }).version).toBe(
			1
		);
	});
});

describe('optimistic concurrency (#15)', () => {
	it('requires the version a change is based on', () => {
		const { row } = createEntity(app, uiActor, testItem, { title: 'T' });
		expect(() =>
			write(app, uiActor, testItem, {
				op: 'update',
				id: String(row.id),
				baseVersion: undefined as never,
				data: { title: 'U' }
			})
		).toThrow(ValidationError);
	});

	it('rejects a stale write and returns the current version and state', () => {
		const id = String(createEntity(app, uiActor, testItem, { title: 'v1' }).row.id);
		updateEntity(app, uiActor, testItem, id, 1, { title: 'v2' });
		try {
			updateEntity(app, uiActor, testItem, id, 1, { title: 'based on v1' });
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(StaleWriteError);
			const err = e as StaleWriteError;
			expect(err.status).toBe(409);
			expect(err.baseVersion).toBe(1);
			expect(err.currentVersion).toBe(2);
			expect(err.current).toMatchObject({ title: 'v2', current_version: 2 });
		}
		expect(readRow(app, testItem, id)).toMatchObject({ title: 'v2', current_version: 2 });
		expect(revisions(id)).toHaveLength(2);
	});

	it('applies the stale check to delete and revert too', () => {
		const id = String(createEntity(app, uiActor, testItem, { title: 'v1' }).row.id);
		updateEntity(app, uiActor, testItem, id, 1, { title: 'v2' });
		expect(() => deleteEntity(app, uiActor, testItem, id, 1)).toThrow(StaleWriteError);
		expect(() => revertEntity(app, uiActor, testItem, id, 1, 1)).toThrow(StaleWriteError);
	});

	it('does not create a version when an update changes nothing', () => {
		const id = String(createEntity(app, uiActor, testItem, { title: 'same' }).row.id);
		const res = updateEntity(app, uiActor, testItem, id, 1, { title: 'same' });
		expect(res.changed).toBe(false);
		expect(res.version).toBe(1);
		expect(revisions(id)).toHaveLength(1);
	});

	describe('two writers on separate connections to one file', () => {
		let dir: string;
		let a: AppDatabase;
		let b: AppDatabase;
		beforeEach(() => {
			dir = mkdtempSync(path.join(tmpdir(), 'mcpa-conc-'));
			a = openDatabase({ path: path.join(dir, 'app.db') });
			createTestEntityTables(a);
			b = openDatabase({ path: path.join(dir, 'app.db') });
		});
		afterEach(() => {
			a.close();
			b.close();
			rmSync(dir, { recursive: true, force: true });
		});

		it('lets the first save win and refuses the second', () => {
			const id = String(createEntity(a, uiActor, testItem, { title: 'original' }).row.id);
			// Both writers load version 1.
			const seenByA = readRow(a, testItem, id) as Row;
			const seenByB = readRow(b, testItem, id) as Row;
			expect(seenByA.current_version).toBe(1);
			expect(seenByB.current_version).toBe(1);

			updateEntity(a, { userId: 'alice', channel: 'ui' }, testItem, id, Number(seenByA.current_version), {
				title: 'Alice'
			});
			expect(() =>
				updateEntity(b, { userId: 'bob', channel: 'ui' }, testItem, id, Number(seenByB.current_version), {
					title: 'Bob'
				})
			).toThrow(StaleWriteError);

			expect(readRow(b, testItem, id)).toMatchObject({
				title: 'Alice',
				current_version: 2,
				updated_by: 'alice'
			});
		});
	});
});

describe('soft delete and revert (#16)', () => {
	it('deletes by setting the flag in a new version; lists exclude deleted rows', () => {
		const keep = String(createEntity(app, uiActor, testItem, { title: 'keep' }).row.id);
		const gone = String(createEntity(app, uiActor, testItem, { title: 'gone' }).row.id);
		const res = deleteEntity(app, uiActor, testItem, gone, 1, 'duplicate');
		expect(res.version).toBe(2);
		expect(readRow(app, testItem, gone)).toMatchObject({ deleted: 1, title: 'gone' });
		expect(listActive(app, testItem).map((r) => r.id)).toEqual([keep]);
		expect(revisions(gone).map((r) => r.version)).toEqual([1, 2]);
	});

	it('reverts by creating a new version that copies the old one', () => {
		const id = String(createEntity(app, uiActor, testItem, { title: 'one', body: 'first' }).row.id);
		updateEntity(app, uiActor, testItem, id, 1, { title: 'two', body: 'second' });
		updateEntity(app, uiActor, testItem, id, 2, { title: 'three' });
		const res = revertEntity(app, uiActor, testItem, id, 3, 1);
		expect(res.version).toBe(4);
		expect(res.row).toMatchObject({ title: 'one', body: 'first', current_version: 4 });
		const revs = revisions(id);
		expect(revs.map((r) => r.version)).toEqual([1, 2, 3, 4]);
		expect(revs[3]).toMatchObject({ reverted_from: 1 });
		// Earlier versions are untouched.
		expect(JSON.parse(String(revs[2]!.snapshot))).toMatchObject({ title: 'three' });
	});

	it('restores a deleted item by reverting to a version before the delete', () => {
		const id = String(createEntity(app, uiActor, testItem, { title: 'x' }).row.id);
		deleteEntity(app, uiActor, testItem, id, 1);
		expect(listActive(app, testItem)).toHaveLength(0);
		revertEntity(app, uiActor, testItem, id, 2, 1);
		expect(readRow(app, testItem, id)).toMatchObject({ deleted: 0, current_version: 3 });
		expect(listActive(app, testItem)).toHaveLength(1);
	});

	it('refuses to edit a deleted item, to delete twice, and to revert to the current version', () => {
		const id = String(createEntity(app, uiActor, testItem, { title: 'x' }).row.id);
		deleteEntity(app, uiActor, testItem, id, 1);
		expect(() => updateEntity(app, uiActor, testItem, id, 2, { title: 'y' })).toThrow(ValidationError);
		expect(() => deleteEntity(app, uiActor, testItem, id, 2)).toThrow(ValidationError);
		expect(() => revertEntity(app, uiActor, testItem, id, 2, 2)).toThrow(ValidationError);
		expect(() => revertEntity(app, uiActor, testItem, id, 2, 9)).toThrow(NotFoundError);
	});

	it('works the same for link rows', () => {
		const link = createEntity(app, uiActor, testLink, { from_id: 'a', to_id: 'b', type: 'implements' });
		const id = String(link.row.id);
		updateEntity(app, uiActor, testLink, id, 1, { type: 'details' });
		deleteEntity(app, uiActor, testLink, id, 2);
		expect(listActive(app, testLink)).toHaveLength(0);
		const restored = revertEntity(app, mcpActor, testLink, id, 3, 1);
		expect(restored.row).toMatchObject({ type: 'implements', deleted: 0, current_version: 4 });
		expect(revisions(id)[3]).toMatchObject({ reverted_from: 1, author_agent: 'Claude', channel: 'mcp' });
	});

	it('removes deleted items from search and puts restored ones back', () => {
		const id = String(createEntity(app, uiActor, testItem, { title: 'Encryption policy' }).row.id);
		deleteEntity(app, uiActor, testItem, id, 1);
		expect(searchText(app.sqlite, 'encryption')).toHaveLength(0);
		revertEntity(app, uiActor, testItem, id, 2, 1);
		expect(searchText(app.sqlite, 'encryption')).toHaveLength(1);
	});
});
