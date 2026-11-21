import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { AppDatabase } from '#lib/db/client.ts';
import { createSession, type SessionUser } from './auth';
import { EmailNotSetUpError, emailSettings, sendEmail, type EmailDeps } from './email';
import { instanceInfo, signInCodeEmail } from './email-templates';
import { TooManyAttemptsError, UnauthenticatedError, ValidationError } from './errors';
import { accountKey, addressKey, assertNotLocked, clearThrottle, POLICIES, recordFailure } from './throttle';

/**
 * Sign-in with a one-time code sent by email (#88): the way back in when a passkey is lost, and the
 * way in for a device that cannot hold one. The mailbox becomes a second key, so:
 * - a code lasts ten minutes, works once, and only in the browser that asked for it;
 * - the app answers the same whether or not the address has an account;
 * - requests and wrong codes are limited per address asked for and per client address;
 * - the code and the link are stored only as hashes, and every use is announced to the account.
 */

export const CODE_COOKIE = 'mcpa_code';
export const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (a: string, b: string) =>
	a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

interface CodeRow {
	id: string;
	user_id: string | null;
	email: string;
	code_hash: string;
	link_hash: string;
	next: string | null;
	attempts: number;
	created_at: number;
	expires_at: number;
}

export interface CodeRequestInput {
	/** The instance's address, for the link in the email. */
	origin: string;
	address?: string | null;
	/** Where to go after signing in. */
	next?: string | null;
	now?: Date;
}

/**
 * Start a sign-in by code. Always returns a token for the browser's cookie; an email is sent only
 * when the address belongs to an active person. `sent` settles when the email has gone (or was not
 * needed, or failed: a failure is logged for admins and never shown, so the screen tells nothing).
 */
export function requestSignInCode(
	app: AppDatabase,
	email: string,
	input: CodeRequestInput,
	deps: EmailDeps = {}
): { token: string; expiresAt: Date; sent: Promise<void> } {
	const env = deps.env ?? process.env;
	if (!emailSettings(env).configured) throw new EmailNotSetUpError();
	const now = input.now ?? deps.now ?? new Date();
	const address = String(email ?? '')
		.trim()
		.toLowerCase();
	if (!EMAIL.test(address))
		throw new ValidationError('Enter your email address.', { email: 'Enter an email address' });

	// Every request counts, for any address, so the limit says nothing about who has an account.
	const keys = [`code:account:${address}`, `code:address:${input.address || 'unknown'}`];
	try {
		assertNotLocked(app, keys, now);
	} catch (e) {
		if (e instanceof TooManyAttemptsError)
			throw new TooManyAttemptsError(
				`Too many codes were asked for. Try again in ${Math.max(1, Math.ceil(e.retryAfterSeconds / 60))} minutes.`,
				e.retryAfterSeconds
			);
		throw e;
	}
	recordFailure(app, keys[0]!, POLICIES.codeAccount, now);
	recordFailure(app, keys[1]!, POLICIES.codeAddress, now);

	const user = app.sqlite
		// Someone invited who has not joined yet (#90) gets in by their invitation link only.
		.prepare('SELECT id, name FROM "user" WHERE email = ? AND active = 1 AND deleted = 0 AND invited = 0')
		.get(address) as { id: string; name: string } | undefined;
	const token = randomBytes(32).toString('base64url');
	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	const linkToken = randomBytes(32).toString('base64url');
	const expiresAt = new Date(now.getTime() + CODE_MINUTES * 60_000);
	app.sqlite.prepare('DELETE FROM sign_in_code WHERE expires_at <= ?').run(now.getTime());
	app.sqlite
		.prepare(
			`INSERT INTO sign_in_code (id, user_id, email, code_hash, link_hash, next, attempts, created_at, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
		)
		.run(
			sha256(token),
			user?.id ?? null,
			address,
			sha256(`${token}:${code}`),
			sha256(linkToken),
			input.next ?? null,
			now.getTime(),
			expiresAt.getTime()
		);

	const instance = instanceInfo(input.origin, env);
	const sent = user
		? sendEmail(
				app,
				{
					...signInCodeEmail(instance, {
						code,
						link: `${instance.origin}/login/code?t=${linkToken}`,
						minutes: CODE_MINUTES
					}),
					to: address,
					kind: 'sign_in_code'
				},
				{ ...deps, now }
			).catch(() => {})
		: Promise.resolve();
	return { token, expiresAt, sent };
}

function read(app: AppDatabase, token: string | undefined, now: Date): CodeRow | null {
	if (!token) return null;
	const row = app.sqlite.prepare('SELECT * FROM sign_in_code WHERE id = ?').get(sha256(token)) as
		CodeRow | undefined;
	if (!row) return null;
	if (row.expires_at <= now.getTime()) {
		app.sqlite.prepare('DELETE FROM sign_in_code WHERE id = ?').run(row.id);
		return null;
	}
	return row;
}

/** The code this browser is waiting for, to show which address it went to. */
export function pendingSignInCode(
	app: AppDatabase,
	token: string | undefined,
	now = new Date()
): { email: string; expiresAt: Date } | null {
	const row = read(app, token, now);
	return row ? { email: row.email, expiresAt: new Date(row.expires_at) } : null;
}

export function cancelSignInCode(app: AppDatabase, token: string | undefined): void {
	if (token) app.sqlite.prepare('DELETE FROM sign_in_code WHERE id = ?').run(sha256(token));
}

export const CODE_GONE = 'That code has expired or was already used. Ask for a new one.';
export const CODE_WRONG = 'That code is not correct.';

/**
 * Check a typed code, or the link from the email, in the browser that asked. Wrong ones count
 * towards the same lock-outs as wrong passwords, and five wrong tries end the code.
 */
export function finishCodeSignIn(
	app: AppDatabase,
	token: string | undefined,
	proof: { code?: string | null; linkToken?: string | null },
	input: { now?: Date; address?: string | null } = {}
): { token: string; expiresAt: Date; user: SessionUser; next: string | null } {
	const now = input.now ?? new Date();
	const row = read(app, token, now);
	if (!row) throw new ValidationError(CODE_GONE);
	const keys = [accountKey(row.email), addressKey('login', input.address)];
	assertNotLocked(app, keys, now);

	const code = String(proof.code ?? '').replace(/\s+/g, '');
	const matches = proof.linkToken
		? same(sha256(proof.linkToken), row.link_hash)
		: /^\d{6}$/.test(code) && same(sha256(`${token}:${code}`), row.code_hash);
	const user = row.user_id
		? (app.sqlite
				.prepare(
					`SELECT u.id, u.name, u.email, u.role, c.must_change_password FROM "user" u
					   LEFT JOIN user_credential c ON c.user_id = u.id
					  WHERE u.id = ? AND u.active = 1 AND u.deleted = 0`
				)
				.get(row.user_id) as
				| {
						id: string;
						name: string;
						email: string;
						role: SessionUser['role'];
						must_change_password: number | null;
				  }
				| undefined)
		: undefined;
	// An address without an account goes the same way as a wrong code.
	if (!matches || !user) {
		recordFailure(app, keys[0]!, POLICIES.account, now);
		recordFailure(app, keys[1]!, POLICIES.address, now);
		if (row.attempts + 1 >= MAX_ATTEMPTS) {
			app.sqlite.prepare('DELETE FROM sign_in_code WHERE id = ?').run(row.id);
			throw new ValidationError('Too many wrong codes. Ask for a new one.');
		}
		app.sqlite.prepare('UPDATE sign_in_code SET attempts = attempts + 1 WHERE id = ?').run(row.id);
		throw new UnauthenticatedError(CODE_WRONG);
	}
	app.sqlite.prepare('DELETE FROM sign_in_code WHERE id = ?').run(row.id);
	clearThrottle(app, keys[0]!);
	const session = createSession(app, user.id, now);
	return {
		...session,
		next: row.next,
		user: {
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			mustChangePassword: user.must_change_password === 1
		}
	};
}
