import { error, json } from '@sveltejs/kit';
import { expireInvitationForTests } from '#lib/domain/invitations.ts';
import { seedAllowed } from '#lib/domain/seed.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Test only: make a person's open invitation expire now. 404 unless TEST_SEED_ENABLED=true. */
export const POST: RequestHandler = async (event) => {
	if (!seedAllowed()) error(404, { message: 'Not found' });
	const { email } = (await event.request.json()) as { email?: string };
	return json({ expired: expireInvitationForTests(appDatabase(), String(email ?? '')) });
};
