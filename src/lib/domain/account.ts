import type { AppDatabase } from '#lib/db/client.ts';
import { checkPassword, hasPassword, revokeSessions, setPassword } from './auth';
import { assertPasswords } from './sign-in-method';
import { ValidationError } from './errors';

/**
 * A user changes their own password. Other sessions end; the current one stays. Someone who has no
 * password yet (they joined with a passkey, or the instance had none for a while) sets their first
 * one without a current password: they are signed in, and could as well add a passkey.
 */
export async function changeOwnPassword(
	app: AppDatabase,
	userId: string,
	currentPassword: string,
	newPassword: string,
	currentSessionId?: string
): Promise<void> {
	assertPasswords();
	const first = !hasPassword(app, userId);
	if (!first && !(await checkPassword(app, userId, currentPassword))) {
		throw new ValidationError('Current password is not correct.', { current: 'Not correct' });
	}
	if (!first && currentPassword === newPassword) {
		throw new ValidationError('Choose a password you have not used here.', { password: 'Same as current' });
	}
	await setPassword(app, userId, newPassword, false);
	revokeSessions(app, userId, currentSessionId);
}
