import { error, json } from '@sveltejs/kit';
import { seedAllowed, seedTestData } from '#lib/domain/seed.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Test only: create the seed users. 404 unless TEST_SEED_ENABLED=true. */
export const POST: RequestHandler = async () => {
	if (!seedAllowed()) error(404, { message: 'Not found' });
	const { users, password } = await seedTestData(appDatabase());
	return json({ users: users.map((u) => ({ id: u.id, email: u.email, role: u.role })), password });
};
