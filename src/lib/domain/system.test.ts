import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { systemStatus } from './system';

describe('systemStatus', () => {
	it('reports ok with no pending migrations on a migrated database', () => {
		const app = createTestDatabase();
		const s = systemStatus(app);
		expect(s.status).toBe('ok');
		expect(s.database).toBe('ok');
		expect(s.migrations?.pending).toBe(0);
		expect(s.version).toBeTruthy();
		app.close();
	});

	it('reports an error when the database cannot be read', () => {
		const app = createTestDatabase();
		app.close();
		const s = systemStatus(app);
		expect(s.status).toBe('error');
		expect(s.database).toBe('error');
	});
});
