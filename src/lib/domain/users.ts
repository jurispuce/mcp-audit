import { randomUUID } from 'node:crypto';
import type { AppDatabase } from '#lib/db/client.ts';
import { revokeAllPersonalTokens, revokeSessions, setPassword } from './auth';
import { accountKey, clearThrottle } from './throttle';
import { revokeAllConnectedApps } from './oauth';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { generateTemporaryPassword, validatePassword } from './password';
import { registerEntity } from './registry';
import { USER_ROLES, type UserRole } from './roles';
import {
	createEntity,
	readRow,
	updateEntity,
	write,
	type Actor,
	type EntityDefinition,
	type Row
} from './write';

export interface User {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	active: boolean;
	version: number;
	createdAt: Date;
	updatedAt: Date;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function toUser(row: Row): User {
	return {
		id: String(row.id),
		name: String(row.name),
		email: String(row.email),
		role: row.role as UserRole,
		active: Number(row.active) === 1,
		version: Number(row.current_version),
		createdAt: new Date(Number(row.created_at)),
		updatedAt: new Date(Number(row.updated_at))
	};
}

function actorRow(app: AppDatabase, actor: Actor): Row | null {
	return app.sqlite
		.prepare('SELECT * FROM "user" WHERE id = ? AND deleted = 0')
		.get(actor.userId) as Row | null;
}

export function isAdmin(app: AppDatabase, actor: Actor): boolean {
	const me = actorRow(app, actor);
	return !!me && me.role === 'admin' && Number(me.active) === 1;
}

export function requireAdmin(app: AppDatabase, actor: Actor): void {
	if (!isAdmin(app, actor)) throw new ForbiddenError('Only an admin can do this.');
}

function activeAdminCount(app: AppDatabase): number {
	return (
		app.sqlite
			.prepare(`SELECT count(*) AS n FROM "user" WHERE role = 'admin' AND active = 1 AND deleted = 0`)
			.get() as { n: number }
	).n;
}

export const userDefinition: EntityDefinition = registerEntity({
	type: 'user',
	table: 'user',
	columns: ['name', 'email', 'role', 'active'],
	fieldLabels: { name: 'Name', email: 'Email', role: 'Role', active: 'Active', deleted: 'Deleted' },
	formatValue(column, value) {
		if (column === 'role') return value === 'admin' ? 'Admin' : 'Auditor';
		if (column === 'active' || column === 'deleted') return Number(value) === 1 ? 'Yes' : 'No';
		return value == null ? '' : String(value);
	},
	parse(input, existing) {
		const out: Row = {};
		const fields: Record<string, string> = {};
		if ('name' in input || !existing) {
			const name = String(input.name ?? '').trim();
			if (!name) fields.name = 'Required';
			else if (name.length > 120) fields.name = 'At most 120 characters';
			else out.name = name;
		}
		if ('email' in input || !existing) {
			const email = String(input.email ?? '')
				.trim()
				.toLowerCase();
			if (!EMAIL.test(email)) fields.email = 'Enter an email address';
			else out.email = email;
		}
		if ('role' in input || !existing) {
			const role = input.role ?? 'auditor';
			if (!(USER_ROLES as readonly unknown[]).includes(role)) fields.role = 'Unknown role';
			else out.role = role as string;
		}
		if ('active' in input)
			out.active = input.active === true || input.active === 1 || input.active === 'true' ? 1 : 0;
		else if (!existing) out.active = 1;
		if (Object.keys(fields).length) throw new ValidationError('Check the highlighted fields.', fields);
		return out;
	},
	authorize(app, actor, op, existing) {
		if (op.op === 'delete') throw new ForbiddenError('Users are deactivated, not deleted.');
		if (isAdmin(app, actor)) return;
		// Anyone may change their own name and email; nothing else.
		const self = existing && existing.id === actor.userId;
		const ownFields = op.op === 'update' && Object.keys(op.data).every((k) => k === 'name' || k === 'email');
		if (self && ownFields) return;
		throw new ForbiddenError('Only an admin can change other users, roles or access.');
	},
	afterWrite(app, _actor, row, existing) {
		if (existing && activeAdminCount(app) === 0) {
			throw new ValidationError('There must always be at least one active admin.');
		}
		if (Number(row.active) !== 1) {
			revokeSessions(app, String(row.id));
			revokeAllPersonalTokens(app, String(row.id));
			revokeAllConnectedApps(app, String(row.id));
		}
	},
	search: (row) => ({ name: row.name as string, email: row.email as string }),
	label: (row) => String(row.name),
	refLine: (row) => `${row.email} · ${row.role === 'admin' ? 'Admin' : 'Auditor'}`
});

export function countUsers(app: AppDatabase): number {
	return (app.sqlite.prepare('SELECT count(*) AS n FROM "user" WHERE deleted = 0').get() as { n: number }).n;
}

export function getUser(app: AppDatabase, id: string): User {
	const row = readRow(app, userDefinition, id);
	if (!row) throw new NotFoundError('User not found');
	return toUser(row);
}

export function listUsers(app: AppDatabase): User[] {
	return (
		app.sqlite
			.prepare('SELECT * FROM "user" WHERE deleted = 0 ORDER BY active DESC, name COLLATE NOCASE')
			.all() as Row[]
	).map(toUser);
}

/**
 * Create the first admin. Only possible while there are no users; the new user is recorded as
 * the author of their own account.
 */
export async function createFirstAdmin(
	app: AppDatabase,
	input: { name: string; email: string; password: string }
): Promise<User> {
	validatePassword(input.password);
	if (countUsers(app) > 0) throw new ForbiddenError('Set-up is already complete.');
	const id = randomUUID();
	const actor: Actor = { userId: id, channel: 'ui' };
	const { row } = createEntity(
		app,
		actor,
		userDefinition,
		{ name: input.name, email: input.email, role: 'admin' },
		{ id, note: 'First admin created at set-up' },
		{ skipAuthorization: true }
	);
	await setPassword(app, id, input.password, false);
	return toUser(row);
}

/** Admin adds a user. Returns a one-time password the new user must change at first login. */
export async function createUser(
	app: AppDatabase,
	actor: Actor,
	input: { name: string; email: string; role?: UserRole }
): Promise<{ user: User; temporaryPassword: string }> {
	requireAdmin(app, actor);
	const temporaryPassword = generateTemporaryPassword();
	const { row } = createEntity(app, actor, userDefinition, {
		name: input.name,
		email: input.email,
		role: input.role ?? 'auditor'
	});
	await setPassword(app, String(row.id), temporaryPassword, true);
	return { user: toUser(row), temporaryPassword };
}

export function updateUser(
	app: AppDatabase,
	actor: Actor,
	id: string,
	baseVersion: number,
	data: Partial<{ name: string; email: string; role: UserRole }>
): User {
	return toUser(updateEntity(app, actor, userDefinition, id, baseVersion, data).row);
}

/** Deactivate or reactivate a user. Deactivating ends their sessions and revokes their tokens. */
export function setUserActive(
	app: AppDatabase,
	actor: Actor,
	id: string,
	baseVersion: number,
	active: boolean
): User {
	if (!active && id === actor.userId) throw new ValidationError('You cannot deactivate yourself.');
	const { row } = write(app, actor, userDefinition, {
		op: 'update',
		id,
		baseVersion,
		data: { active },
		note: active ? 'Reactivated' : 'Deactivated'
	});
	return toUser(row);
}

/** Admin resets a user's password: a one-time password, all sessions ended. */
export async function resetPassword(
	app: AppDatabase,
	actor: Actor,
	id: string
): Promise<{ temporaryPassword: string }> {
	requireAdmin(app, actor);
	const user = getUser(app, id);
	const temporaryPassword = generateTemporaryPassword();
	await setPassword(app, id, temporaryPassword, true);
	revokeSessions(app, id);
	// A locked-out user can sign in with the new password at once.
	clearThrottle(app, accountKey(user.email));
	return { temporaryPassword };
}

/** Create the first admin from INITIAL_ADMIN_* variables when the database has no users. */
export async function ensureInitialAdmin(
	app: AppDatabase,
	env: NodeJS.ProcessEnv = process.env
): Promise<User | null> {
	const email = env.INITIAL_ADMIN_EMAIL?.trim();
	const password = env.INITIAL_ADMIN_PASSWORD;
	if (!email || !password || countUsers(app) > 0) return null;
	return createFirstAdmin(app, { name: env.INITIAL_ADMIN_NAME?.trim() || 'Admin', email, password });
}
