import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listArtifacts } from './artifacts';
import { listEngagements, listScopes } from './engagements';
import { listPeople } from './people';
import { listRisks } from './risks';
import { listAssessmentUnits, listSelected } from './selection';
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
		const dataDir = mkdtempSync(path.join(tmpdir(), 'mcpa-seed-'));
		const env = { TEST_SEED_ENABLED: 'true', DATA_DIR: dataDir };
		const { users, engagement } = await seedTestData(app, env);
		await seedTestData(app, env);
		expect(users.map((u) => u.role)).toEqual(['admin', 'auditor']);
		expect(countUsers(app)).toBe(2);
		expect(listSources(app).map((s) => s.code)).toEqual(['nis2']);
		await expect(login(app, 'auditor@example.test', SEED_PASSWORD)).resolves.toBeTruthy();

		// The prototype's sample engagement, once.
		expect(listEngagements(app).map((e) => e.name)).toEqual(['NIS 2 audit, Riga office']);
		expect(engagement).toMatchObject({
			auditeeName: 'Baltic Freight SIA',
			scopeMode: 'multiple',
			reportLanguage: 'lv'
		});
		expect(listScopes(app, engagement.id).map((s) => s.name)).toEqual(['Head office', 'Warehouse']);
		expect(listSelected(app, engagement.id)).toHaveLength(6);
		expect(listAssessmentUnits(app, engagement.id)).toHaveLength(8);
		expect(listPeople(app, engagement.auditeeId).map((p) => p.role)).toEqual([
			'Head of IT',
			'Warehouse manager'
		]);
		expect(listRisks(app, engagement.id).map((r) => r.title)).toEqual([
			'Leaver accounts stay active',
			'Backups not tested'
		]);
		expect(listArtifacts(app, engagement.id).map((a) => a.displayName)).toEqual([
			'Access control policy',
			'Backup procedure'
		]);
		app.close();
		rmSync(dataDir, { recursive: true, force: true });
	});
});
