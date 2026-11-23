import { error, json } from '@sveltejs/kit';
import { ageSessionForTests } from '#lib/domain/auth.ts';
import { seedAllowed } from '#lib/domain/seed.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Test only: make the caller's last proof of who they are look older. 404 unless TEST_SEED_ENABLED=true. */
export const POST: RequestHandler = async (event) => {
	if (!seedAllowed()) error(404, { message: 'Not found' });
	if (!event.locals.sessionId) error(401, { message: 'Sign in first' });
	const { minutes } = (await event.request.json()) as { minutes?: number };
	ageSessionForTests(appDatabase(), event.locals.sessionId, Number(minutes ?? 6));
	return json({ ok: true });
};
