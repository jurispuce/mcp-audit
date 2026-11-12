import type { AppDatabase } from '#lib/db/client.ts';
import { setPassword } from './auth';
import { ForbiddenError } from './errors';
import { countUsers, createFirstAdmin, createUser, listUsers, type User } from './users';

/**
 * Test and development data. Refuses to run unless TEST_SEED_ENABLED=true, so it can never run in
 * production by accident. Grows with the app: engagement data is added from #35 onwards.
 */

export const SEED_PASSWORD = 'test-password-123';
export const SEED_USERS = {
	admin: { name: 'Ada Admin', email: 'admin@example.test', role: 'admin' as const },
	auditor: { name: 'Ari Auditor', email: 'auditor@example.test', role: 'auditor' as const }
};

export function seedAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.TEST_SEED_ENABLED === 'true';
}

export async function seedTestData(
	app: AppDatabase,
	env: NodeJS.ProcessEnv = process.env
): Promise<{ users: User[]; password: string }> {
	if (!seedAllowed(env))
		throw new ForbiddenError('Seeding is disabled. Set TEST_SEED_ENABLED=true in a test environment.');
	const byEmail = () => new Map(listUsers(app).map((u) => [u.email, u]));
	let users = byEmail();

	let admin = users.get(SEED_USERS.admin.email);
	if (!admin && countUsers(app) === 0) {
		admin = await createFirstAdmin(app, { ...SEED_USERS.admin, password: SEED_PASSWORD });
	}
	const actorAdmin = admin ?? listUsers(app).find((u) => u.role === 'admin' && u.active);
	if (!actorAdmin) throw new ForbiddenError('No active admin to seed with.');
	const actor = { userId: actorAdmin.id, channel: 'ui' as const };
	users = byEmail();

	for (const spec of Object.values(SEED_USERS)) {
		if (!users.get(spec.email)) {
			const { user } = await createUser(app, actor, spec);
			await setPassword(app, user.id, SEED_PASSWORD, false);
		}
	}
	users = byEmail();
	return { users: Object.values(SEED_USERS).map((s) => users.get(s.email)!), password: SEED_PASSWORD };
}
