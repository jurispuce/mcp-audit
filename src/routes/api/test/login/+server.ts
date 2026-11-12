import { error, json } from '@sveltejs/kit';
import { createSession, SESSION_COOKIE } from '#lib/domain/auth.ts';
import { seedAllowed } from '#lib/domain/seed.ts';
import { listUsers } from '#lib/domain/users.ts';
import { appDatabase } from '#lib/server/db.ts';
import { sessionCookieOptions } from '#lib/server/http.ts';
import type { RequestHandler } from './$types';

/** Test only: sign in as a user by email without a password. 404 unless TEST_SEED_ENABLED=true. */
export const POST: RequestHandler = async (event) => {
	if (!seedAllowed()) error(404, { message: 'Not found' });
	const { email } = (await event.request.json()) as { email?: string };
	const app = appDatabase();
	const user = listUsers(app).find((u) => u.email === String(email ?? '').toLowerCase() && u.active);
	if (!user) error(404, { message: `No active user ${email}` });
	const { token, expiresAt } = createSession(app, user.id);
	event.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(event, expiresAt));
	return json({ id: user.id, email: user.email });
};
