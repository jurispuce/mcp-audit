import path from 'node:path';
import type { AppDatabase } from '#lib/db/client.ts';
import { setPassword } from './auth';
import { ForbiddenError } from './errors';
import { builtInSources, importBuiltInSource } from './library-import';
import { getSourceByCode } from './library';
import { countUsers, createFirstAdmin, createUser, listUsers, type User } from './users';
import { createEngagement, listEngagements, listScopes, getEngagement, type Engagement } from './engagements';
import { findRequirement } from './library';
import { addPerson } from './people';
import { addRisk } from './risks';
import { addScope, selectRequirements, setScopeHandling, setScopeMode, updateScope } from './selection';
import { registerTextArtifact } from './artifacts';
import { createEntity } from './write';
import { memberDefinition } from './engagements';
import type { Actor } from './write';

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
): Promise<{ users: User[]; password: string; engagement: Engagement }> {
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

	// The bundled library sources (NIS 2 Article 21), so screens have requirements to show.
	for (const b of builtInSources()) {
		if (!getSourceByCode(app, b.code)) importBuiltInSource(app, actor, b.file);
	}
	const engagement = seedSampleEngagement(app, actor, filesDir(env), users.get(SEED_USERS.auditor.email)!);
	return {
		users: Object.values(SEED_USERS).map((s) => users.get(s.email)!),
		password: SEED_PASSWORD,
		engagement
	};
}

function filesDir(env: NodeJS.ProcessEnv): string {
	return path.join(path.resolve(env.DATA_DIR ?? 'data'), 'files');
}

export const SAMPLE_ENGAGEMENT_NAME = 'NIS 2 audit, Riga office';

/**
 * The prototype's "Load sample engagement", on the bundled NIS 2 Article 21 instead of the prototype's
 * ISO 27001 sample (ISO texts are not bundled): Baltic Freight SIA with two scopes, six selected
 * requirements (two per scope), two roles, two risks and two documents. Created once.
 */
export function seedSampleEngagement(
	app: AppDatabase,
	actor: Actor,
	files: string,
	auditor: User
): Engagement {
	const existing = listEngagements(app).find((e) => e.name === SAMPLE_ENGAGEMENT_NAME);
	if (existing) return existing;
	const nis2 = getSourceByCode(app, 'nis2');
	if (!nis2) throw new Error('The NIS 2 source must be imported before the sample engagement.');
	const req = (point: string) => findRequirement(app, nis2.id, `Art. 21(2)(${point})`)!.id;

	const e = createEngagement(app, actor, {
		name: SAMPLE_ENGAGEMENT_NAME,
		auditeeName: 'Baltic Freight SIA',
		auditeeDescription: 'Logistics company, 120 employees, two sites.',
		startDate: new Date().toISOString().slice(0, 10),
		workingLanguage: 'en',
		reportLanguage: 'lv',
		description: 'Sample engagement to walk through the process.'
	});
	createEntity(app, actor, memberDefinition, { engagement_id: e.id, user_id: auditor.id, role: 'auditor' });
	const [first] = listScopes(app, e.id);
	updateScope(app, actor, first!.id, first!.version, { name: 'Head office' });
	setScopeMode(app, actor, e.id, getEngagement(app, e.id).version, 'multiple');
	const warehouse = addScope(app, actor, e.id, { name: 'Warehouse' });

	const access = req('i');
	const mfa = req('j');
	const backup = req('c');
	selectRequirements(app, actor, e.id, [req('a'), access, mfa, req('b'), backup, req('g')]);
	setScopeHandling(app, actor, e.id, [
		{ requirementId: access, scopeHandling: 'per_scope' },
		{ requirementId: mfa, scopeHandling: 'per_scope' }
	]);

	addPerson(app, actor, e.auditeeId, {
		role: 'Head of IT',
		name: 'Ilze Kalniņa',
		unit: 'IT',
		email: 'ilze.kalnina@example.com'
	});
	addPerson(app, actor, e.auditeeId, { role: 'Warehouse manager', unit: 'Warehouse' });
	addRisk(app, actor, e.id, {
		title: 'Leaver accounts stay active',
		level: 'high',
		origin: 'auditor',
		requirement_ids: [access, mfa]
	});
	addRisk(app, actor, e.id, {
		title: 'Backups not tested',
		level: 'medium',
		origin: 'auditee_register',
		requirement_ids: [backup],
		scope_ids: [String(warehouse.id)]
	});

	registerTextArtifact(app, actor, files, e.id, {
		title: 'Access control policy',
		filename: 'access-control-policy.txt',
		kind: 'policy',
		language: 'en',
		text: SAMPLE_POLICY
	});
	registerTextArtifact(app, actor, files, e.id, {
		title: 'Backup procedure',
		filename: 'backup-procedure.txt',
		language: 'en',
		text: SAMPLE_BACKUP
	});
	return getEngagement(app, e.id);
}

const SAMPLE_POLICY = `Access control policy
Baltic Freight SIA, version 2.1, approved 2026-02-10

1. Purpose
This policy sets the rules for granting, reviewing and removing access to information systems.

2. Granting access
2.1 Access is granted on the request of the employee's manager through the service desk.
2.2 The Head of IT approves administrator access.

3. Reviewing access
3.1 Managers review the access rights of their staff every six months.
3.2 The review is recorded in the service desk.

4. Removing access
4.1 Human resources notify the service desk of every leaver on the last working day.
4.2 Accounts of leavers are disabled within one working day.

5. Authentication
5.1 Remote access and administrator access use multi-factor authentication.`;

const SAMPLE_BACKUP = `Backup procedure
Baltic Freight SIA, draft

1. Daily backups of the warehouse management system are made at 02:00.
2. Backups are kept for 30 days at the second site.
3. A restore test is done once a year.`;
