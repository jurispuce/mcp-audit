import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppDatabase } from '#lib/db/client.ts';
import { ForbiddenError } from './errors';
import { countUsers, createFirstAdmin, type User } from './users';

/**
 * First start: while there are no users, /setup creates the first admin. It needs a one-time code
 * printed in the server log, so a stranger who reaches the page first cannot claim the instance.
 */

let setupCode: string | null = null;

export function needsSetup(app: AppDatabase): boolean {
	return countUsers(app) === 0;
}

/** Create (once per process) and return the set-up code. */
export function issueSetupCode(): string {
	setupCode ??= randomBytes(6).toString('hex').match(/.{4}/g)!.join('-');
	return setupCode;
}

export async function completeSetup(
	app: AppDatabase,
	input: { code: string; name: string; email: string; password: string }
): Promise<User> {
	if (!needsSetup(app)) throw new ForbiddenError('Set-up is already complete.');
	const expected = Buffer.from(issueSetupCode());
	const given = Buffer.from(
		String(input.code ?? '')
			.trim()
			.toLowerCase()
	);
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		throw new ForbiddenError('The set-up code is not correct. It is printed in the server log.');
	}
	const user = await createFirstAdmin(app, input);
	setupCode = null;
	return user;
}
