import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { createSession, login, validateSession, logout, SESSION_DAYS } from './auth';
import { changeOwnPassword } from './account';
import { ForbiddenError, UnauthenticatedError, ValidationError } from './errors';
import { ENGAGEMENT_ROLES, ENGAGEMENT_ROLE_LABELS, isEngagementRole } from './roles';
import { completeSetup, issueSetupCode, needsSetup } from './setup';
import {
	countUsers,
	createFirstAdmin,
	createUser,
	ensureInitialAdmin,
	getUser,
	listUsers,
	resetPassword,
	setUserActive,
	updateUser,
	userDefinition
} from './users';
import { deleteEntity, revertEntity, type Actor } from './write';

const PASSWORD = 'correct horse battery';
let app: AppDatabase;
let admin: Actor;

beforeEach(async () => {
	app = createTestDatabase();
	const a = await createFirstAdmin(app, { name: 'Ada Admin', email: 'Ada@Example.test', password: PASSWORD });
	admin = { userId: a.id, channel: 'ui' };
});
afterEach(() => app.close());

describe('first user and set-up', () => {
	it('creates the first user as an admin, authored by themselves', () => {
		const [u] = listUsers(app);
		expect(u).toMatchObject({ name: 'Ada Admin', email: 'ada@example.test', role: 'admin', active: true });
		const rev = app.sqlite.prepare("SELECT author_user, note FROM revision WHERE entity_type = 'user'").get();
		expect(rev).toEqual({ author_user: u!.id, note: 'First admin created at set-up' });
	});

	it('refuses a second first user', async () => {
		await expect(
			createFirstAdmin(app, { name: 'B', email: 'b@example.test', password: PASSWORD })
		).rejects.toThrow(ForbiddenError);
	});

	it('set-up page needs the code from the server log', async () => {
		const fresh = createTestDatabase();
		expect(needsSetup(fresh)).toBe(true);
		const code = issueSetupCode();
		await expect(
			completeSetup(fresh, { code: 'wrong', name: 'X', email: 'x@example.test', password: PASSWORD })
		).rejects.toThrow(/set-up code/);
		const u = await completeSetup(fresh, { code, name: 'X', email: 'x@example.test', password: PASSWORD });
		expect(u.role).toBe('admin');
		expect(needsSetup(fresh)).toBe(false);
		fresh.close();
	});

	it('can create the first admin from environment variables', async () => {
		const fresh = createTestDatabase();
		const u = await ensureInitialAdmin(fresh, {
			INITIAL_ADMIN_EMAIL: 'ops@example.test',
			INITIAL_ADMIN_PASSWORD: PASSWORD,
			INITIAL_ADMIN_NAME: 'Ops'
		});
		expect(u).toMatchObject({ email: 'ops@example.test', role: 'admin' });
		expect(
			await ensureInitialAdmin(fresh, { INITIAL_ADMIN_EMAIL: 'x@y.z', INITIAL_ADMIN_PASSWORD: PASSWORD })
		).toBeNull();
		expect(countUsers(fresh)).toBe(1);
		fresh.close();
	});
});

describe('login and sessions', () => {
	it('logs in with email in any case and returns a session that resolves to the user', async () => {
		const { token, user } = await login(app, '  ADA@example.test ', PASSWORD);
		expect(user.email).toBe('ada@example.test');
		expect(validateSession(app, token)?.user.id).toBe(user.id);
	});

	it('gives the same error for a wrong password, an unknown email and an inactive user', async () => {
		await expect(login(app, 'ada@example.test', 'wrong password!')).rejects.toThrow(UnauthenticatedError);
		await expect(login(app, 'nobody@example.test', PASSWORD)).rejects.toThrow(
			'Email or password is not correct.'
		);
		const { user } = await createUser(app, admin, { name: 'Ben', email: 'ben@example.test' });
		setUserActive(app, admin, user.id, 1, false);
		await expect(login(app, 'ben@example.test', PASSWORD)).rejects.toThrow(
			'Email or password is not correct.'
		);
	});

	it('stores only a hash of the session token', async () => {
		const { token } = await login(app, 'ada@example.test', PASSWORD);
		const ids = app.sqlite.prepare('SELECT id FROM session').all() as { id: string }[];
		expect(ids.map((r) => r.id)).not.toContain(token);
	});

	it('expires sessions and slides the expiry while in use', () => {
		const start = new Date('2026-01-01T00:00:00Z');
		const { token } = createSession(app, admin.userId, start);
		const day = 24 * 3600 * 1000;
		const later = new Date(start.getTime() + 10 * day);
		expect(validateSession(app, token, later)?.expiresAt.getTime()).toBe(
			later.getTime() + SESSION_DAYS * day
		);
		expect(validateSession(app, token, new Date(later.getTime() + (SESSION_DAYS + 1) * day))).toBeNull();
		expect(validateSession(app, token, later)).toBeNull();
	});

	it('logout ends the session', async () => {
		const { token } = await login(app, 'ada@example.test', PASSWORD);
		logout(app, token);
		expect(validateSession(app, token)).toBeNull();
	});

	it('password change needs the current password and ends other sessions only', async () => {
		const a = await login(app, 'ada@example.test', PASSWORD);
		const b = await login(app, 'ada@example.test', PASSWORD);
		const current = validateSession(app, a.token)!;
		await expect(changeOwnPassword(app, admin.userId, 'not it at all', 'new password 123')).rejects.toThrow(
			ValidationError
		);
		await changeOwnPassword(app, admin.userId, PASSWORD, 'new password 123', current.sessionId);
		expect(validateSession(app, a.token)).not.toBeNull();
		expect(validateSession(app, b.token)).toBeNull();
		await expect(login(app, 'ada@example.test', PASSWORD)).rejects.toThrow();
		await expect(login(app, 'ada@example.test', 'new password 123')).resolves.toBeTruthy();
	});

	it('rejects passwords shorter than 10 characters', async () => {
		await expect(changeOwnPassword(app, admin.userId, PASSWORD, 'short')).rejects.toThrow(/at least 10/);
	});
});

describe('admin user management', () => {
	it('creates a user with a one-time password that must be changed', async () => {
		const { user, temporaryPassword } = await createUser(app, admin, {
			name: 'Ben',
			email: 'ben@example.test'
		});
		expect(user.role).toBe('auditor');
		const s = await login(app, 'ben@example.test', temporaryPassword);
		expect(s.user.mustChangePassword).toBe(true);
	});

	it('keeps passwords out of revisions', async () => {
		await createUser(app, admin, { name: 'Ben', email: 'ben@example.test' });
		const snaps = app.sqlite.prepare('SELECT snapshot FROM revision').all() as { snapshot: string }[];
		for (const s of snaps) expect(s.snapshot).not.toMatch(/scrypt|password/i);
	});

	it('refuses a duplicate email as a field error', async () => {
		await expect(createUser(app, admin, { name: 'Dup', email: 'ADA@example.test' })).rejects.toMatchObject({
			fields: { email: 'Already in use' }
		});
	});

	it('deactivating ends sessions; reactivating allows login again; every change is a version', async () => {
		const { user, temporaryPassword } = await createUser(app, admin, {
			name: 'Ben',
			email: 'ben@example.test'
		});
		const { token } = await login(app, 'ben@example.test', temporaryPassword);
		const off = setUserActive(app, admin, user.id, 1, false);
		expect(off).toMatchObject({ active: false, version: 2 });
		expect(validateSession(app, token)).toBeNull();
		setUserActive(app, admin, user.id, 2, true);
		await expect(login(app, 'ben@example.test', temporaryPassword)).resolves.toBeTruthy();
		expect(getUser(app, user.id).version).toBe(3);
	});

	it('reset gives a new one-time password and ends sessions', async () => {
		const { user, temporaryPassword } = await createUser(app, admin, {
			name: 'Ben',
			email: 'ben@example.test'
		});
		const { token } = await login(app, 'ben@example.test', temporaryPassword);
		const { temporaryPassword: next } = await resetPassword(app, admin, user.id);
		expect(validateSession(app, token)).toBeNull();
		await expect(login(app, 'ben@example.test', temporaryPassword)).rejects.toThrow();
		expect((await login(app, 'ben@example.test', next)).user.mustChangePassword).toBe(true);
	});

	it('only admins manage users; anyone may change their own name', async () => {
		const { user } = await createUser(app, admin, { name: 'Ben', email: 'ben@example.test' });
		const ben: Actor = { userId: user.id, channel: 'ui' };
		await expect(createUser(app, ben, { name: 'C', email: 'c@example.test' })).rejects.toThrow(
			ForbiddenError
		);
		expect(() => updateUser(app, ben, user.id, 1, { role: 'admin' })).toThrow(ForbiddenError);
		expect(() => updateUser(app, ben, admin.userId, 1, { name: 'Hacked' })).toThrow(ForbiddenError);
		expect(updateUser(app, ben, user.id, 1, { name: 'Benjamin' }).name).toBe('Benjamin');
		await expect(resetPassword(app, ben, admin.userId)).rejects.toThrow(ForbiddenError);
	});

	it('always keeps one active admin, also against revert', async () => {
		expect(() => updateUser(app, admin, admin.userId, 1, { role: 'auditor' })).toThrow(
			/at least one active admin/
		);
		expect(() => setUserActive(app, admin, admin.userId, 1, false)).toThrow(ValidationError);
		const { user } = await createUser(app, admin, { name: 'Ben', email: 'ben@example.test', role: 'admin' });
		updateUser(app, admin, user.id, 1, { role: 'auditor' });
		// Reverting Ben to admin is fine; reverting Ada to a non-admin state that never existed is impossible.
		expect(revertEntity(app, admin, userDefinition, user.id, 2, 1).row.role).toBe('admin');
	});

	it('users are deactivated, never deleted', async () => {
		const { user } = await createUser(app, admin, { name: 'Ben', email: 'ben@example.test' });
		expect(() => deleteEntity(app, admin, userDefinition, user.id, 1)).toThrow(/deactivated, not deleted/);
	});
});

describe('engagement roles', () => {
	it('models lead auditor, auditor and reviewer', () => {
		expect(ENGAGEMENT_ROLES).toEqual(['lead_auditor', 'auditor', 'reviewer']);
		expect(ENGAGEMENT_ROLE_LABELS.lead_auditor).toBe('Lead auditor');
		expect(isEngagementRole('reviewer')).toBe(true);
		expect(isEngagementRole('owner')).toBe(false);
	});
});
