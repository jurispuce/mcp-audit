import type { AppDatabase } from '#lib/db/client.ts';
import { TooManyAttemptsError } from './errors';

/**
 * Rate limiting and lock-out for anything that checks a secret: sign-in, the first-start set-up code
 * and personal access tokens on /mcp. Failures are counted per key (an account's email, or a client
 * address) in a window; reaching the limit locks the key for a while. Stored in the database, so a
 * restart does not reset a lock.
 */

export interface ThrottlePolicy {
	/** Failures allowed within the window before the key is locked. */
	max: number;
	windowMs: number;
	lockMs: number;
}

const MINUTE = 60_000;

export const POLICIES = {
	/** Per account: 5 wrong passwords in 15 minutes lock that account's sign-in for 15 minutes. */
	account: { max: 5, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE },
	/** Per client address, across accounts: 20 failed sign-ins in 15 minutes. */
	address: { max: 20, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE },
	/** Per client address on /mcp: 30 bad tokens in 15 minutes. */
	token: { max: 30, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE },
	/** Per client address on /setup: 10 wrong codes in 15 minutes. */
	setup: { max: 10, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE }
} satisfies Record<string, ThrottlePolicy>;

interface Row {
	key: string;
	failures: number;
	window_start: number;
	locked_until: number | null;
}

function read(app: AppDatabase, key: string): Row | undefined {
	return app.sqlite.prepare('SELECT * FROM auth_throttle WHERE key = ?').get(key) as Row | undefined;
}

/** Refuse when any of the keys is locked. The message says when to try again, not which key. */
export function assertNotLocked(app: AppDatabase, keys: string[], now = new Date()): void {
	let until = 0;
	for (const key of keys) {
		const row = read(app, key);
		if (row?.locked_until && row.locked_until > now.getTime()) until = Math.max(until, row.locked_until);
	}
	if (until) {
		const seconds = Math.ceil((until - now.getTime()) / 1000);
		const minutes = Math.max(1, Math.ceil(seconds / 60));
		throw new TooManyAttemptsError(
			`Too many failed attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
			seconds
		);
	}
}

/** Count a failure; returns true when this failure locked the key. */
export function recordFailure(
	app: AppDatabase,
	key: string,
	policy: ThrottlePolicy,
	now = new Date()
): boolean {
	const t = now.getTime();
	const row = read(app, key);
	const fresh = !row || t - row.window_start > policy.windowMs;
	const failures = fresh ? 1 : row.failures + 1;
	const locked = failures >= policy.max;
	app.sqlite
		.prepare(
			`INSERT INTO auth_throttle (key, failures, window_start, locked_until) VALUES (?, ?, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, window_start = excluded.window_start,
			        locked_until = excluded.locked_until`
		)
		.run(
			key,
			locked ? 0 : failures,
			locked || fresh ? t : row!.window_start,
			locked ? t + policy.lockMs : (row?.locked_until ?? null)
		);
	return locked;
}

/** Forget a key's failures and lock: after a successful sign-in, or when an admin resets a password. */
export function clearThrottle(app: AppDatabase, key: string): void {
	app.sqlite.prepare('DELETE FROM auth_throttle WHERE key = ?').run(key);
}

export const accountKey = (email: string) => `account:${email.trim().toLowerCase()}`;
export const addressKey = (kind: 'login' | 'token' | 'setup', address: string | null | undefined) =>
	`${kind}:${address || 'unknown'}`;
