import type { AppDatabase } from '#lib/db/client.ts';
import { checkPassword, revokeSessions, setPassword } from './auth';
import { ValidationError } from './errors';

/** A user changes their own password. Other sessions end; the current one stays. */
export async function changeOwnPassword(
	app: AppDatabase,
	userId: string,
	currentPassword: string,
	newPassword: string,
	currentSessionId?: string
): Promise<void> {
	if (!(await checkPassword(app, userId, currentPassword))) {
		throw new ValidationError('Current password is not correct.', { current: 'Not correct' });
	}
	if (currentPassword === newPassword) {
		throw new ValidationError('Choose a password you have not used here.', { password: 'Same as current' });
	}
	await setPassword(app, userId, newPassword, false);
	revokeSessions(app, userId, currentSessionId);
}
