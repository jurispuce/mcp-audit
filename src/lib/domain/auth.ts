import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { accountKey, addressKey, assertNotLocked, clearThrottle, POLICIES, recordFailure } from './throttle';
import type { AppDatabase } from '#lib/db/client.ts';
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from './errors';
import { dummyPasswordHash, hashPassword, validatePassword, verifyPassword } from './password';
import type { UserRole } from './roles';
import type { Actor } from './write';

/**
 * Credentials, sessions and personal access tokens. These are access infrastructure, not audit data:
 * they are not versioned, and their secrets are stored only as hashes.
 */

export interface SessionUser {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	mustChangePassword: boolean;
}

export const SESSION_COOKIE = 'mcpa_session';
export const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const TOUCH_EVERY = 5 * 60 * 1000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// ---- Credentials

export async function setPassword(
	app: AppDatabase,
	userId: string,
	password: string,
	mustChange: boolean,
	now = new Date()
): Promise<void> {
	const hash = await hashPassword(validatePassword(password));
	app.sqlite
		.prepare(
			`INSERT INTO user_credential (user_id, password_hash, must_change_password, updated_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash,
			   must_change_password = excluded.must_change_password, updated_at = excluded.updated_at`
		)
		.run(userId, hash, mustChange ? 1 : 0, now.getTime());
}

export async function checkPassword(app: AppDatabase, userId: string, password: string): Promise<boolean> {
	const row = app.sqlite
		.prepare('SELECT password_hash FROM user_credential WHERE user_id = ?')
		.get(userId) as { password_hash: string } | undefined;
	if (!row) {
		await verifyPassword(password, await dummyPasswordHash());
		return false;
	}
	return verifyPassword(password, row.password_hash);
}

// ---- Sessions

interface UserJoinRow {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	active: number;
	deleted: number;
	must_change_password: number | null;
}

function toSessionUser(r: UserJoinRow): SessionUser {
	return {
		id: r.id,
		name: r.name,
		email: r.email,
		role: r.role,
		mustChangePassword: r.must_change_password === 1
	};
}

/**
 * Check email and password; on success start a session. The error never says which part was wrong.
 * Failures are counted per account and per client address; too many lock sign-in for a while, even
 * with the right password, for any email (so a lock says nothing about whether an account exists).
 */
export async function login(
	app: AppDatabase,
	email: string,
	password: string,
	now = new Date(),
	address: string | null = null
): Promise<{ token: string; expiresAt: Date; user: SessionUser }> {
	const normalized = String(email ?? '')
		.trim()
		.toLowerCase();
	const keys = [accountKey(normalized), addressKey('login', address)];
	assertNotLocked(app, keys, now);
	const row = app.sqlite
		.prepare(
			`SELECT u.id, u.name, u.email, u.role, u.active, u.deleted, c.must_change_password, c.password_hash
			   FROM "user" u LEFT JOIN user_credential c ON c.user_id = u.id WHERE u.email = ?`
		)
		.get(normalized) as (UserJoinRow & { password_hash: string | null }) | undefined;

	const hash = row?.password_hash ?? (await dummyPasswordHash());
	const ok = await verifyPassword(String(password ?? ''), hash);
	if (!row || !row.password_hash || !ok || row.active !== 1 || row.deleted === 1) {
		recordFailure(app, keys[0]!, POLICIES.account, now);
		recordFailure(app, keys[1]!, POLICIES.address, now);
		throw new UnauthenticatedError('Email or password is not correct.');
	}
	clearThrottle(app, keys[0]!);
	const { token, expiresAt } = createSession(app, row.id, now);
	return { token, expiresAt, user: toSessionUser(row) };
}

export function createSession(app: AppDatabase, userId: string, now = new Date()) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY);
	app.sqlite
		.prepare('INSERT INTO session (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
		.run(sha256(token), userId, now.getTime(), expiresAt.getTime(), now.getTime());
	return { token, expiresAt };
}

/** The user behind a session cookie, or null. Sessions slide: use keeps them alive for 30 more days. */
export function validateSession(
	app: AppDatabase,
	token: string | undefined,
	now = new Date()
): { user: SessionUser; sessionId: string; expiresAt: Date } | null {
	if (!token) return null;
	const id = sha256(token);
	const row = app.sqlite
		.prepare(
			`SELECT s.expires_at, s.last_seen_at, u.id, u.name, u.email, u.role, u.active, u.deleted, c.must_change_password
			   FROM session s JOIN "user" u ON u.id = s.user_id LEFT JOIN user_credential c ON c.user_id = u.id
			  WHERE s.id = ?`
		)
		.get(id) as (UserJoinRow & { expires_at: number; last_seen_at: number }) | undefined;
	if (!row) return null;
	if (row.expires_at <= now.getTime() || row.active !== 1 || row.deleted === 1) {
		app.sqlite.prepare('DELETE FROM session WHERE id = ?').run(id);
		return null;
	}
	let expiresAt = new Date(row.expires_at);
	if (now.getTime() - row.last_seen_at > TOUCH_EVERY) {
		expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY);
		app.sqlite
			.prepare('UPDATE session SET last_seen_at = ?, expires_at = ? WHERE id = ?')
			.run(now.getTime(), expiresAt.getTime(), id);
	}
	return { user: toSessionUser(row), sessionId: id, expiresAt };
}

export function logout(app: AppDatabase, token: string | undefined): void {
	if (token) app.sqlite.prepare('DELETE FROM session WHERE id = ?').run(sha256(token));
}

/** End every session of a user, optionally keeping the one in use. */
export function revokeSessions(app: AppDatabase, userId: string, exceptSessionId?: string): void {
	if (exceptSessionId) {
		app.sqlite.prepare('DELETE FROM session WHERE user_id = ? AND id <> ?').run(userId, exceptSessionId);
	} else {
		app.sqlite.prepare('DELETE FROM session WHERE user_id = ?').run(userId);
	}
}

// ---- Personal access tokens (for the MCP endpoint)

export const TOKEN_PREFIX = 'mcpa_';

export interface PersonalTokenInfo {
	id: string;
	name: string;
	prefix: string;
	createdAt: Date;
	lastUsedAt: Date | null;
	revokedAt: Date | null;
}

/** Create a token for the signed-in user. The token itself is returned once and never stored. */
export function createPersonalToken(
	app: AppDatabase,
	actor: Actor,
	name: string,
	now = new Date()
): { token: string; info: PersonalTokenInfo } {
	if (actor.channel !== 'ui') throw new ForbiddenError('Tokens can only be created in the app.');
	const label = String(name ?? '').trim();
	if (!label)
		throw new ValidationError('Give the token a name, for example "Claude Desktop on laptop".', {
			name: 'Required'
		});
	if (label.length > 80) throw new ValidationError('Name is too long.', { name: 'At most 80 characters' });
	const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
	const id = randomUUID();
	const prefix = token.slice(0, TOKEN_PREFIX.length + 6);
	app.sqlite
		.prepare(
			'INSERT INTO personal_token (id, user_id, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)'
		)
		.run(id, actor.userId, label, sha256(token), prefix, now.getTime());
	return { token, info: { id, name: label, prefix, createdAt: now, lastUsedAt: null, revokedAt: null } };
}

export function listPersonalTokens(app: AppDatabase, userId: string): PersonalTokenInfo[] {
	const rows = app.sqlite
		.prepare(
			`SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM personal_token
			  WHERE user_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC`
		)
		.all(userId) as {
		id: string;
		name: string;
		prefix: string;
		created_at: number;
		last_used_at: number | null;
		revoked_at: number | null;
	}[];
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		prefix: r.prefix,
		createdAt: new Date(r.created_at),
		lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : null,
		revokedAt: r.revoked_at ? new Date(r.revoked_at) : null
	}));
}

/** Revoke one token. Its owner or an admin may do this. */
export function revokePersonalToken(app: AppDatabase, actor: Actor, tokenId: string, now = new Date()): void {
	const row = app.sqlite.prepare('SELECT user_id FROM personal_token WHERE id = ?').get(tokenId) as
		{ user_id: string } | undefined;
	if (!row) throw new NotFoundError('Token not found');
	if (row.user_id !== actor.userId) {
		const me = app.sqlite.prepare('SELECT role FROM "user" WHERE id = ?').get(actor.userId) as
			{ role: string } | undefined;
		if (me?.role !== 'admin') throw new ForbiddenError('You can only revoke your own tokens.');
	}
	app.sqlite
		.prepare('UPDATE personal_token SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
		.run(now.getTime(), tokenId);
}

export function revokeAllPersonalTokens(app: AppDatabase, userId: string, now = new Date()): void {
	app.sqlite
		.prepare('UPDATE personal_token SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
		.run(now.getTime(), userId);
}

/** The user a token belongs to, or null if it is unknown, revoked or its user is inactive. */
export function resolvePersonalToken(
	app: AppDatabase,
	token: string | undefined | null,
	now = new Date()
): { user: SessionUser; tokenId: string } | null {
	if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
	const row = app.sqlite
		.prepare(
			`SELECT t.id AS token_id, t.revoked_at, u.id, u.name, u.email, u.role, u.active, u.deleted, c.must_change_password
			   FROM personal_token t JOIN "user" u ON u.id = t.user_id LEFT JOIN user_credential c ON c.user_id = u.id
			  WHERE t.token_hash = ?`
		)
		.get(sha256(token)) as (UserJoinRow & { token_id: string; revoked_at: number | null }) | undefined;
	if (!row || row.revoked_at !== null || row.active !== 1 || row.deleted === 1) return null;
	app.sqlite
		.prepare('UPDATE personal_token SET last_used_at = ? WHERE id = ?')
		.run(now.getTime(), row.token_id);
	return { user: toSessionUser(row), tokenId: row.token_id };
}

/** Read `Authorization: Bearer <token>` from a request and resolve it. Used by the MCP endpoint. */
export function authenticateBearer(app: AppDatabase, request: Request, now = new Date()) {
	const header = request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(\S+)$/i.exec(header);
	return match ? resolvePersonalToken(app, match[1], now) : null;
}

/** The actor for writes made through MCP with a token: the token owner as user, the AI as agent. */
export function mcpActor(user: SessionUser, agent: string): Actor {
	return { userId: user.id, agent: agent || 'AI assistant', channel: 'mcp' };
}
