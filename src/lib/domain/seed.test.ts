import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { login } from './auth';
import { SEED_PASSWORD, seedTestData } from './seed';
import { listSources } from './library';
import { countUsers } from './users';

describe('seed', () => {
	it('refuses to run unless TEST_SEED_ENABLED=true', async () => {
		const app = createTestDatabase();
		await expect(seedTestData(app, {})).rejects.toThrow(/disabled/);
		await expect(seedTestData(app, { TEST_SEED_ENABLED: '1' })).rejects.toThrow(/disabled/);
		expect(countUsers(app)).toBe(0);
		app.close();
	});

	it('creates an admin and an auditor who can sign in, and is safe to run twice', async () => {
		const app = createTestDatabase();
		const env = { TEST_SEED_ENABLED: 'true' };
		const { users } = await seedTestData(app, env);
		await seedTestData(app, env);
		expect(users.map((u) => u.role)).toEqual(['admin', 'auditor']);
		expect(countUsers(app)).toBe(2);
		expect(listSources(app).map((s) => s.code)).toEqual(['nis2']);
		await expect(login(app, 'auditor@example.test', SEED_PASSWORD)).resolves.toBeTruthy();
		app.close();
	});
});
