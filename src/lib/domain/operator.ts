import { createHash, timingSafeEqual } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from '#lib/db/client.ts';
import { APP_VERSION } from '#lib/version.ts';
import { readSetting, saveSetting } from './app-settings';

/**
 * Numbers for whoever runs the instance for someone else (#98): how many people and engagements it
 * holds, how big it is and when it was last used. Counts and dates only. Nothing here reads a name,
 * a title, a document or any text of an audit, and that is what lets the operator say truthfully
 * what they can see of a tenant.
 *
 * The numbers are given to a caller that holds this instance's operator token (OPERATOR_TOKEN), which
 * is not a user and cannot sign in. Without the setting the endpoint does not exist.
 */

type Env = Record<string, string | undefined>;

export const OPERATOR_TOKEN_MIN = 32;

export function operatorToken(env: Env = process.env): string | null {
	return env.OPERATOR_TOKEN?.trim() || null;
}

/** A token short enough to guess keeps the instance from starting. */
export function operatorTokenProblem(env: Env = process.env): string | null {
	const token = operatorToken(env);
	if (!token || token.length >= OPERATOR_TOKEN_MIN) return null;
	return `OPERATOR_TOKEN is shorter than ${OPERATOR_TOKEN_MIN} characters. Use a long random value, or leave it out: the operator's numbers are then not given at all.`;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Whether the caller holds this instance's operator token. Compared without leaking where it differs. */
export function isOperatorToken(given: string | null | undefined, env: Env = process.env): boolean {
	const token = operatorToken(env);
	if (!token || !given) return false;
	return timingSafeEqual(digest(given), digest(token));
}

/** Everything the operator endpoint returns. A test holds the list to exactly these. */
export interface OperatorNumbers {
	version: string;
	/** People who can sign in. */
	users: number;
	/** People invited who have not joined yet. */
	invited: number;
	engagements: number;
	database_bytes: number;
	files_bytes: number;
	/** When someone last signed in, and when anything was last changed. */
	last_sign_in: string | null;
	last_activity: string | null;
}

const LAST_SIGN_IN = 'instance.last_sign_in';

/** Called at every sign-in: only the time is kept, not who. */
export function recordSignIn(app: AppDatabase, now = new Date()): void {
	saveSetting(app, LAST_SIGN_IN, now.toISOString(), now);
}

function directoryBytes(dir: string): number {
	let total = 0;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) total += directoryBytes(full);
		else if (entry.isFile()) {
			try {
				total += statSync(full).size;
			} catch {
				// gone meanwhile
			}
		}
	}
	return total;
}

export function operatorNumbers(app: AppDatabase, opts: { filesDir?: string } = {}): OperatorNumbers {
	const count = (sql: string) => (app.sqlite.prepare(sql).get() as { n: number }).n;
	const pages = app.sqlite.pragma('page_count', { simple: true }) as number;
	const pageSize = app.sqlite.pragma('page_size', { simple: true }) as number;
	const lastChange = (
		app.sqlite.prepare('SELECT MAX(created_at) AS at FROM revision').get() as { at: number | null }
	).at;
	return {
		version: APP_VERSION,
		users: count('SELECT COUNT(*) AS n FROM "user" WHERE deleted = 0 AND active = 1 AND invited = 0'),
		invited: count('SELECT COUNT(*) AS n FROM "user" WHERE deleted = 0 AND active = 1 AND invited = 1'),
		engagements: count('SELECT COUNT(*) AS n FROM engagement WHERE deleted = 0'),
		database_bytes: pages * pageSize,
		files_bytes: opts.filesDir ? directoryBytes(opts.filesDir) : 0,
		last_sign_in: readSetting<string | null>(app, LAST_SIGN_IN, null),
		last_activity: lastChange ? new Date(lastChange).toISOString() : null
	};
}
