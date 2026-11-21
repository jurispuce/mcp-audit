import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import './entities';
import { ForbiddenError } from './errors';
import { getItemHistory } from './items';
import { createFirstAdmin, createUser, getUser, setWelcomed, updateUser, userDefinition } from './users';
import { updateEntity, type Actor } from './write';

let app: AppDatabase;
let admin: Actor;
let adminId: string;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	adminId = a.id;
	admin = { userId: a.id, channel: 'ui' };
});
afterEach(() => app.close());

describe('first-time welcome (#84)', () => {
	it('a new person has not been welcomed; dismissing is versioned and can be undone', async () => {
		const { user } = await createUser(app, admin, { name: 'Bo', email: 'bo@example.test' });
		expect(user.welcomed).toBe(false);
		expect(getUser(app, adminId).welcomed).toBe(false);
		const bo: Actor = { userId: user.id, channel: 'ui' };

		expect(setWelcomed(app, bo, true).welcomed).toBe(true);
		expect(getItemHistory(app, 'user', user.id)[0]!.note).toBe('Welcome dismissed');
		// Again: nothing changes, no new version.
		const v = getUser(app, user.id).version;
		expect(setWelcomed(app, bo, true).version).toBe(v);
		expect(setWelcomed(app, bo, false).welcomed).toBe(false);
		expect(getItemHistory(app, 'user', user.id)[0]!.note).toBe('Welcome shown again');
		// The admin's own flag is untouched.
		expect(getUser(app, adminId).welcomed).toBe(false);
	});

	it('nobody dismisses it for someone else, not even an admin; an auditor still cannot change a role', async () => {
		const { user } = await createUser(app, admin, { name: 'Bo', email: 'bo@example.test' });
		expect(() => updateEntity(app, admin, userDefinition, user.id, user.version, { welcomed: true })).toThrow(
			ForbiddenError
		);
		const bo: Actor = { userId: user.id, channel: 'ui' };
		expect(() => updateUser(app, bo, user.id, user.version, { role: 'admin' })).toThrow(ForbiddenError);
		expect(updateUser(app, bo, user.id, user.version, { name: 'Bo B' }).name).toBe('Bo B');
	});
});
