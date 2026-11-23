import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticationResponseJSON,
	type AuthenticatorTransport,
	type PublicKeyCredentialCreationOptionsJSON,
	type PublicKeyCredentialRequestOptionsJSON,
	type RegistrationResponseJSON
} from '@simplewebauthn/server';
import type { AppDatabase } from '#lib/db/client.ts';
import { createSession, markSessionVerified, revokeSessions, type SessionUser } from './auth';
import { emailSettings } from './email';
import { NotFoundError, UnauthenticatedError, ValidationError } from './errors';
import { accountKey, addressKey, assertNotLocked, clearThrottle, POLICIES, recordFailure } from './throttle';
import { getUser, requireAdmin, userDefinition } from './users';
import { updateEntity, type Actor } from './write';

/**
 * Passkeys (#87): sign-in with the device's fingerprint, face or PIN instead of a password. A
 * passkey is a key pair made by the person's device for this instance's host name; the app keeps the
 * public half. Nothing here can be phished or guessed, and nothing secret is stored.
 *
 * The ceremonies are done by @simplewebauthn/server; this module keeps the challenges, the public
 * keys and the rules around them (lock-outs, who may remove what, the person's history).
 */

export interface RelyingParty {
	/** The instance's host name: what a passkey is bound to. */
	id: string;
	/** The instance's full address, which the browser must have been on. */
	origin: string;
	/** Shown by the device when it asks for the fingerprint. */
	name: string;
}

type Env = Record<string, string | undefined>;

export function relyingParty(origin: string, env: Env = process.env): RelyingParty {
	const url = new URL(origin);
	return { id: url.hostname, origin: url.origin, name: (env.INSTANCE_NAME ?? '').trim() || 'mcp-audit' };
}

/**
 * Browsers offer passkeys only over https (or on localhost, for development), and only for a host
 * name: an IP address cannot have one.
 */
export function passkeysPossible(origin: string): boolean {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	const host = url.hostname;
	const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
	if (isIp) return false;
	return url.protocol === 'https:' || host === 'localhost' || host.endsWith('.localhost');
}

export const PASSKEYS_NEED_HTTPS =
	'Passkeys need the app at an https address with a host name. This address cannot have them.';

export const CHALLENGE_COOKIE = 'mcpa_webauthn';
const CHALLENGE_MS = 5 * 60_000;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

export interface Passkey {
	id: string;
	name: string;
	synced: boolean;
	createdAt: Date;
	lastUsedAt: Date | null;
}

interface PasskeyRow {
	id: string;
	user_id: string;
	credential_id: string;
	public_key: string;
	counter: number;
	transports: string | null;
	synced: number;
	name: string;
	created_at: number;
	last_used_at: number | null;
}

const toPasskey = (r: PasskeyRow): Passkey => ({
	id: r.id,
	name: r.name,
	synced: r.synced === 1,
	createdAt: new Date(r.created_at),
	lastUsedAt: r.last_used_at == null ? null : new Date(r.last_used_at)
});

function rowsOf(app: AppDatabase, userId: string): PasskeyRow[] {
	return app.sqlite
		.prepare('SELECT * FROM passkey WHERE user_id = ? ORDER BY created_at, rowid')
		.all(userId) as PasskeyRow[];
}

export function listPasskeys(app: AppDatabase, userId: string): Passkey[] {
	return rowsOf(app, userId).map(toPasskey);
}

const transportsOf = (r: PasskeyRow) =>
	(r.transports ? (JSON.parse(r.transports) as AuthenticatorTransport[]) : undefined) ?? undefined;

// ---- Challenges

function saveChallenge(
	app: AppDatabase,
	purpose: 'register' | 'sign_in' | 'confirm',
	userId: string | null,
	challenge: string,
	now: Date
): { token: string; expiresAt: Date } {
	app.sqlite.prepare('DELETE FROM webauthn_challenge WHERE expires_at <= ?').run(now.getTime());
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(now.getTime() + CHALLENGE_MS);
	app.sqlite
		.prepare(
			'INSERT INTO webauthn_challenge (id, purpose, user_id, challenge, expires_at) VALUES (?, ?, ?, ?, ?)'
		)
		.run(sha256(token), purpose, userId, challenge, expiresAt.getTime());
	return { token, expiresAt };
}

/** Read a challenge and delete it: each works once, whatever the outcome. */
function takeChallenge(
	app: AppDatabase,
	token: string | undefined,
	purpose: 'register' | 'sign_in' | 'confirm',
	now: Date
): { challenge: string; userId: string | null } {
	const expired = new ValidationError('That took too long, or was already used. Start again.');
	if (!token) throw expired;
	const id = sha256(token);
	const row = app.sqlite.prepare('SELECT * FROM webauthn_challenge WHERE id = ?').get(id) as
		{ purpose: string; user_id: string | null; challenge: string; expires_at: number } | undefined;
	app.sqlite.prepare('DELETE FROM webauthn_challenge WHERE id = ?').run(id);
	if (!row || row.purpose !== purpose || row.expires_at <= now.getTime()) throw expired;
	return { challenge: row.challenge, userId: row.user_id };
}

// ---- The person's history

/** The count on the user is what the history shows; the note says which passkey. */
function recordCount(app: AppDatabase, actorId: string, userId: string, note: string): void {
	const user = getUser(app, userId);
	const count = (
		app.sqlite.prepare('SELECT count(*) AS n FROM passkey WHERE user_id = ?').get(userId) as { n: number }
	).n;
	updateEntity(
		app,
		{ userId: actorId, channel: 'ui' },
		userDefinition,
		userId,
		user.version,
		{ passkeys: count },
		note
	);
}

// ---- Adding a passkey (the person is signed in)

export async function startPasskeyRegistration(
	app: AppDatabase,
	userId: string,
	rp: RelyingParty,
	now = new Date()
): Promise<{ options: PublicKeyCredentialCreationOptionsJSON; token: string; expiresAt: Date }> {
	if (!passkeysPossible(rp.origin)) throw new ValidationError(PASSKEYS_NEED_HTTPS);
	const user = getUser(app, userId);
	const options = await generateRegistrationOptions({
		rpName: rp.name,
		rpID: rp.id,
		userName: user.email,
		userDisplayName: user.name,
		userID: new TextEncoder().encode(user.id),
		attestationType: 'none',
		// The same authenticator is not added twice.
		excludeCredentials: rowsOf(app, userId).map((r) => ({
			id: r.credential_id,
			transports: transportsOf(r)
		})),
		// Discoverable, so signing in needs no email typed; and the device must verify the person.
		authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
	});
	return { options, ...saveChallenge(app, 'register', userId, options.challenge, now) };
}

const cleanName = (name: unknown) =>
	String(name ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 60);

export async function finishPasskeyRegistration(
	app: AppDatabase,
	userId: string,
	token: string | undefined,
	response: RegistrationResponseJSON,
	rp: RelyingParty,
	name: unknown,
	now = new Date()
): Promise<Passkey> {
	const expected = takeChallenge(app, token, 'register', now);
	if (expected.userId !== userId)
		throw new ValidationError('That took too long, or was already used. Start again.');
	let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
	try {
		verified = await verifyRegistrationResponse({
			response,
			expectedChallenge: expected.challenge,
			expectedOrigin: rp.origin,
			expectedRPID: rp.id,
			requireUserVerification: true
		});
	} catch {
		throw new ValidationError('The passkey could not be added. Try again.');
	}
	if (!verified.verified) throw new ValidationError('The passkey could not be added. Try again.');
	const info = verified.registrationInfo;
	if (app.sqlite.prepare('SELECT 1 FROM passkey WHERE credential_id = ?').get(info.credential.id))
		throw new ValidationError('This passkey is already on an account here.');
	const label = cleanName(name) || `Passkey ${rowsOf(app, userId).length + 1}`;
	const id = randomUUID();
	app.sqlite.transaction(() => {
		app.sqlite
			.prepare(
				`INSERT INTO passkey (id, user_id, credential_id, public_key, counter, transports, synced, name, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				id,
				userId,
				info.credential.id,
				b64(info.credential.publicKey),
				info.credential.counter,
				JSON.stringify(response.response.transports ?? info.credential.transports ?? []),
				info.credentialBackedUp ? 1 : 0,
				label,
				now.getTime()
			);
		recordCount(app, userId, userId, `Passkey added: ${label}`);
	})();
	return listPasskeys(app, userId).find((p) => p.id === id)!;
}

// ---- Signing in with a passkey

export async function startPasskeySignIn(
	app: AppDatabase,
	rp: RelyingParty,
	now = new Date()
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; token: string; expiresAt: Date }> {
	if (!passkeysPossible(rp.origin)) throw new ValidationError(PASSKEYS_NEED_HTTPS);
	// No list of credentials: the device offers the passkeys it holds for this host name.
	const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: 'required' });
	return { options, ...saveChallenge(app, 'sign_in', null, options.challenge, now) };
}

const NOT_ACCEPTED = 'That passkey could not be used to sign in here.';

/**
 * Check the device's answer and start a session. Failures count towards the same lock-outs as wrong
 * passwords: per client address, and per account once the passkey names one. The message never says
 * why a passkey was refused.
 */
export async function finishPasskeySignIn(
	app: AppDatabase,
	token: string | undefined,
	response: AuthenticationResponseJSON,
	rp: RelyingParty,
	now = new Date(),
	address: string | null = null
): Promise<{ token: string; expiresAt: Date; user: SessionUser }> {
	const addressLock = addressKey('login', address);
	assertNotLocked(app, [addressLock], now);
	const expected = takeChallenge(app, token, 'sign_in', now);
	const row = app.sqlite
		.prepare(
			`SELECT p.*, u.name AS user_name, u.email, u.role, u.active, u.deleted, c.must_change_password
			   FROM passkey p JOIN "user" u ON u.id = p.user_id LEFT JOIN user_credential c ON c.user_id = u.id
			  WHERE p.credential_id = ?`
		)
		.get(String(response?.id ?? '')) as
		| (PasskeyRow & {
				user_name: string;
				email: string;
				role: SessionUser['role'];
				active: number;
				deleted: number;
				must_change_password: number | null;
		  })
		| undefined;
	const accountLock = row ? accountKey(row.email) : null;
	const fail = (): never => {
		recordFailure(app, addressLock, POLICIES.address, now);
		if (accountLock) recordFailure(app, accountLock, POLICIES.account, now);
		throw new UnauthenticatedError(NOT_ACCEPTED);
	};
	if (!row) return fail();
	assertNotLocked(app, [accountLock!], now);
	let newCounter: number;
	try {
		const verified = await verifyAuthenticationResponse({
			response,
			expectedChallenge: expected.challenge,
			expectedOrigin: rp.origin,
			expectedRPID: rp.id,
			requireUserVerification: true,
			credential: {
				id: row.credential_id,
				publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')),
				counter: row.counter,
				transports: transportsOf(row)
			}
		});
		if (!verified.verified) return fail();
		newCounter = verified.authenticationInfo.newCounter;
	} catch {
		return fail();
	}
	// A deactivated person's passkeys stay on record but open nothing.
	if (row.active !== 1 || row.deleted === 1) return fail();
	app.sqlite
		.prepare('UPDATE passkey SET counter = ?, last_used_at = ? WHERE id = ?')
		.run(newCounter, now.getTime(), row.id);
	clearThrottle(app, accountLock!);
	const session = createSession(app, row.user_id, now);
	return {
		...session,
		user: {
			id: row.user_id,
			name: row.user_name,
			email: row.email,
			role: row.role,
			mustChangePassword: row.must_change_password === 1
		}
	};
}

// ---- Asking for the passkey again (#93)

/**
 * The signed-in person proves it is still them, with one of their own passkeys, before something
 * sensitive such as creating an access token.
 */
export async function startPasskeyConfirm(
	app: AppDatabase,
	userId: string,
	rp: RelyingParty,
	now = new Date()
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; token: string; expiresAt: Date }> {
	if (!passkeysPossible(rp.origin)) throw new ValidationError(PASSKEYS_NEED_HTTPS);
	const rows = rowsOf(app, userId);
	if (!rows.length) throw new ValidationError('You have no passkey to confirm with. Sign in again instead.');
	const options = await generateAuthenticationOptions({
		rpID: rp.id,
		userVerification: 'required',
		allowCredentials: rows.map((r) => ({ id: r.credential_id, transports: transportsOf(r) }))
	});
	return { options, ...saveChallenge(app, 'confirm', userId, options.challenge, now) };
}

const NOT_CONFIRMED = 'That passkey could not confirm it is you.';

/** Check the answer; on success this session counts as freshly proven. Only the person's own passkeys count. */
export async function finishPasskeyConfirm(
	app: AppDatabase,
	userId: string,
	sessionId: string,
	token: string | undefined,
	response: AuthenticationResponseJSON,
	rp: RelyingParty,
	now = new Date()
): Promise<void> {
	const user = getUser(app, userId);
	const lock = accountKey(user.email);
	assertNotLocked(app, [lock], now);
	const expected = takeChallenge(app, token, 'confirm', now);
	const fail = (): never => {
		recordFailure(app, lock, POLICIES.account, now);
		throw new UnauthenticatedError(NOT_CONFIRMED);
	};
	if (expected.userId !== userId) return fail();
	const row = rowsOf(app, userId).find((r) => r.credential_id === String(response?.id ?? ''));
	if (!row) return fail();
	let newCounter: number;
	try {
		const verified = await verifyAuthenticationResponse({
			response,
			expectedChallenge: expected.challenge,
			expectedOrigin: rp.origin,
			expectedRPID: rp.id,
			requireUserVerification: true,
			credential: {
				id: row.credential_id,
				publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64url')),
				counter: row.counter,
				transports: transportsOf(row)
			}
		});
		if (!verified.verified) return fail();
		newCounter = verified.authenticationInfo.newCounter;
	} catch {
		return fail();
	}
	app.sqlite
		.prepare('UPDATE passkey SET counter = ?, last_used_at = ? WHERE id = ?')
		.run(newCounter, now.getTime(), row.id);
	markSessionVerified(app, sessionId, now);
}

// ---- Managing one's passkeys

function ownPasskey(app: AppDatabase, userId: string, id: string): PasskeyRow {
	const row = app.sqlite.prepare('SELECT * FROM passkey WHERE id = ? AND user_id = ?').get(id, userId) as
		PasskeyRow | undefined;
	if (!row) throw new NotFoundError('Passkey not found');
	return row;
}

export function renamePasskey(app: AppDatabase, userId: string, id: string, name: unknown): Passkey {
	const row = ownPasskey(app, userId, id);
	const label = cleanName(name);
	if (!label) throw new ValidationError('Give the passkey a name.', { name: 'Required' });
	app.sqlite.prepare('UPDATE passkey SET name = ? WHERE id = ?').run(label, row.id);
	return toPasskey({ ...row, name: label });
}

/** Whether the person can still get in without any passkey: a password, or a code by email (#88). */
export function hasOtherWayIn(app: AppDatabase, userId: string, env: Env = process.env): boolean {
	if (emailSettings(env).configured) return true;
	return !!app.sqlite
		.prepare('SELECT 1 FROM user_credential WHERE user_id = ? AND password_hash IS NOT NULL')
		.get(userId);
}

/**
 * Remove a passkey; returns its name. The last one goes only when another way in exists, so nobody
 * locks themselves out.
 */
export function removePasskey(app: AppDatabase, userId: string, id: string, env: Env = process.env): string {
	const row = ownPasskey(app, userId, id);
	if (rowsOf(app, userId).length === 1 && !hasOtherWayIn(app, userId, env))
		throw new ValidationError('This is your only way to sign in. Add another passkey before removing it.');
	app.sqlite.transaction(() => {
		app.sqlite.prepare('DELETE FROM passkey WHERE id = ?').run(row.id);
		recordCount(app, userId, userId, `Passkey removed: ${row.name}`);
	})();
	return row.name;
}

/**
 * An admin shuts a person's devices out (#88): every session ends and every passkey is removed, so
 * a lost phone or laptop opens nothing. The person comes back with a code by email (or their
 * password) and adds a new passkey. Returns how many passkeys were removed.
 */
export function endSessionsAndRemovePasskeys(app: AppDatabase, actor: Actor, userId: string): number {
	requireAdmin(app, actor);
	if (userId === actor.userId) throw new ValidationError('Remove your own passkeys on Settings, Account.');
	getUser(app, userId);
	const count = rowsOf(app, userId).length;
	app.sqlite.transaction(() => {
		revokeSessions(app, userId);
		if (count) {
			app.sqlite.prepare('DELETE FROM passkey WHERE user_id = ?').run(userId);
			recordCount(
				app,
				actor.userId,
				userId,
				`Sessions ended and ${count} ${count === 1 ? 'passkey' : 'passkeys'} removed by an admin`
			);
		}
	})();
	return count;
}
