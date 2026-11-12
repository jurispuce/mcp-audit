import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { addComment, listComments } from './comments';
import { ForbiddenError, NotFoundError, StaleWriteError, ValidationError } from './errors';
import { authorshipLabel } from './history';
import { getItem, getItemComments, getItemHistory, parseItemKey, revertItem } from './items';
import { createFirstAdmin, createUser, updateUser } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let admin: Actor;
let benId: string;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	admin = { userId: a.id, channel: 'ui' };
	benId = (await createUser(app, admin, { name: 'Ben', email: 'ben@example.test' })).user.id;
});
afterEach(() => app.close());

describe('item keys', () => {
	it('parses ?item=<type>:<id>', () => {
		expect(parseItemKey('user:abc-1')).toEqual({ type: 'user', id: 'abc-1' });
		expect(parseItemKey('user:')).toBeNull();
		expect(parseItemKey(':x')).toBeNull();
		expect(parseItemKey(null)).toBeNull();
	});
});

describe('item view', () => {
	it('shows label, reference line, formatted details and counts', () => {
		const item = getItem(app, 'user', benId);
		expect(item).toMatchObject({ type: 'user', label: 'Ben', version: 1, deleted: false, lastAuthor: 'Ada' });
		expect(item.refLine).toBe('ben@example.test · Auditor');
		expect(item.details).toContainEqual({ field: 'active', label: 'Active', value: 'Yes' });
		expect(item.counts).toEqual({ links: 0, comments: 0, history: 1 });
	});

	it('refuses unknown types and ids', () => {
		expect(() => getItem(app, 'nonsense', benId)).toThrow(NotFoundError);
		expect(() => getItem(app, 'user', 'missing')).toThrow(NotFoundError);
	});
});

describe('history (#20)', () => {
	it('lists versions newest first with author, channel and the fields that changed', () => {
		updateUser(app, admin, benId, 1, { name: 'Benjamin', role: 'admin' });
		updateUser(app, { userId: benId, agent: 'Claude', channel: 'mcp' }, benId, 2, { name: 'Ben B' });
		const h = getItemHistory(app, 'user', benId);
		expect(h.map((e) => e.version)).toEqual([3, 2, 1]);
		expect(h[0]).toMatchObject({
			isCurrent: true,
			channel: 'mcp',
			authorAgent: 'Claude',
			authorName: 'Ben B'
		});
		expect(authorshipLabel(h[0]!.authorName, h[0]!.authorAgent)).toBe('Claude on behalf of Ben B');
		expect(h[1]!.changes).toEqual([
			{ field: 'name', label: 'Name', from: 'Ben', to: 'Benjamin' },
			{ field: 'role', label: 'Role', from: 'Auditor', to: 'Admin' }
		]);
		expect(h[1]!.summary).toBe('Changed name, role');
		expect(h[2]).toMatchObject({ summary: 'Created', changes: [], isCurrent: false });
	});

	it('reverts through the generic item API and records it', () => {
		updateUser(app, admin, benId, 1, { name: 'Benjamin' });
		const res = revertItem(app, admin, 'user', benId, 2, 1);
		expect(res.row).toMatchObject({ name: 'Ben', current_version: 3 });
		const h = getItemHistory(app, 'user', benId);
		expect(h[0]).toMatchObject({ summary: 'Reverted to v1', revertedFrom: 1, note: 'Reverted to v1' });
		expect(h[0]!.changes).toEqual([{ field: 'name', label: 'Name', from: 'Benjamin', to: 'Ben' }]);
	});

	it('still applies the entity rules and the stale check on revert', () => {
		updateUser(app, admin, benId, 1, { name: 'Benjamin' });
		expect(() => revertItem(app, { userId: benId, channel: 'ui' }, 'user', benId, 2, 1)).toThrow(
			ForbiddenError
		);
		expect(() => revertItem(app, admin, 'user', benId, 1, 1)).toThrow(StaleWriteError);
		expect(() => revertItem(app, admin, 'user', benId, 2, 0)).toThrow(ValidationError);
	});
});

describe('comments (#21)', () => {
	it('adds comments to any item and lists them oldest first with authorship', () => {
		addComment(app, admin, 'user', benId, 'First', new Date('2026-11-12T10:00:00Z'));
		addComment(
			app,
			{ userId: benId, agent: 'Claude', channel: 'mcp' },
			'user',
			benId,
			'Second',
			new Date('2026-11-12T10:05:00Z')
		);
		const list = getItemComments(app, 'user', benId);
		expect(list.map((c) => c.body)).toEqual(['First', 'Second']);
		expect(list[1]).toMatchObject({ authorName: 'Ben', authorAgent: 'Claude', channel: 'mcp' });
		expect(getItem(app, 'user', benId).counts.comments).toBe(2);
	});

	it('refuses empty comments and comments on items that do not exist', () => {
		expect(() => addComment(app, admin, 'user', benId, '   ')).toThrow(ValidationError);
		expect(() => addComment(app, admin, 'user', 'missing', 'x')).toThrow(NotFoundError);
		expect(() => addComment(app, admin, 'nope', benId, 'x')).toThrow(NotFoundError);
		expect(() => addComment(app, { userId: benId, channel: 'mcp' }, 'user', benId, 'x')).toThrow(
			ForbiddenError
		);
	});

	it('cannot be edited or deleted, not even directly in the database', () => {
		const c = addComment(app, admin, 'user', benId, 'Keep me');
		expect(() => app.sqlite.prepare("UPDATE comment SET body = 'changed' WHERE id = ?").run(c.id)).toThrow(
			/append-only/
		);
		expect(() => app.sqlite.prepare('DELETE FROM comment WHERE id = ?').run(c.id)).toThrow(/append-only/);
		expect(listComments(app, 'user', benId)[0]?.body).toBe('Keep me');
	});
});
