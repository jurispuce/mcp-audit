import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import '#lib/domain/entities.ts';
import { createSession } from '#lib/domain/auth.ts';
import { createEngagement } from '#lib/domain/engagements.ts';
import type { MailTransport } from '#lib/domain/email.ts';
import { inviteUser } from '#lib/domain/invitations.ts';
import { operatorNumbers, operatorTokenProblem } from '#lib/domain/operator.ts';
import { createFirstAdmin, createUser, setUserActive } from '#lib/domain/users.ts';
import type { Actor } from '#lib/domain/write.ts';
import { isOperatorPath, isPublicPath } from './access';
import { operatorStatus } from './operator-http';

/**
 * #98: the numbers an instance gives whoever runs it. Two instances stand for two tenants, each with
 * its own operator token.
 */
const TOKEN_A = 'operator-token-of-tenant-a-0123456789abcdef';
const TOKEN_B = 'operator-token-of-tenant-b-fedcba9876543210';
const envA = { OPERATOR_TOKEN: TOKEN_A };
const envB = { OPERATOR_TOKEN: TOKEN_B };
const MAIL = {
	SMTP_HOST: 'mail.example.test',
	SMTP_FROM: 'audit@example.test',
	ORIGIN: 'https://a.example.test'
};
const transport: MailTransport = { async sendMail() {} };

let a: AppDatabase;
let b: AppDatabase;
let admin: Actor;
let files: string;

const ask = (
	app: AppDatabase,
	env: Record<string, string | undefined>,
	token?: string,
	address = '198.51.100.7'
) =>
	operatorStatus(
		app,
		new Request('http://127.0.0.1:3000/api/operator/status', {
			headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
		}),
		address,
		{ env, filesDir: files }
	);

beforeEach(async () => {
	a = createTestDatabase();
	b = createTestDatabase();
	files = mkdtempSync(path.join(tmpdir(), 'operator-files-'));
	const first = await createFirstAdmin(a, {
		name: 'Ada Lovelace',
		email: 'ada@secret-firm.example.test',
		password: 'correct horse battery'
	});
	admin = { userId: first.id, channel: 'ui' };
	await createFirstAdmin(b, { name: 'Bo', email: 'bo@example.test', password: 'correct horse battery' });
});
afterEach(() => {
	a.close();
	b.close();
	rmSync(files, { recursive: true, force: true });
});

describe('the operator endpoint (#98)', () => {
	it('gives the listed numbers to a caller with this instance’s token, and nothing else', async () => {
		const { user: anna } = await createUser(a, admin, {
			name: 'Anna Auditor',
			email: 'anna@secret-firm.example.test',
			role: 'auditor'
		});
		const { user: gone } = await createUser(a, admin, {
			name: 'Former Colleague',
			email: 'former@secret-firm.example.test',
			role: 'auditor'
		});
		setUserActive(a, admin, gone.id, gone.version, false);
		await inviteUser(
			a,
			admin,
			{ name: 'Invited Person', email: 'invited@secret-firm.example.test' },
			{ origin: MAIL.ORIGIN },
			{ env: MAIL, transport }
		);
		createEngagement(a, admin, {
			auditeeName: 'Confidential Client SIA',
			name: 'Very secret NIS 2 audit',
			startDate: '2026-11-01'
		});
		mkdirSync(path.join(files, 'ab'), { recursive: true });
		writeFileSync(path.join(files, 'ab', 'document'), 'x'.repeat(1234));
		const signedIn = new Date('2026-11-22T08:30:00.000Z');
		createSession(a, anna.id, signedIn);

		const res = ask(a, envA, TOKEN_A);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = (await res.json()) as Record<string, unknown>;
		// Exactly these fields: a new one has to be added here on purpose.
		expect(Object.keys(body).sort()).toEqual([
			'database_bytes',
			'engagements',
			'files_bytes',
			'invited',
			'last_activity',
			'last_sign_in',
			'users',
			'version'
		]);
		expect(body).toMatchObject({
			users: 2,
			invited: 1,
			engagements: 1,
			files_bytes: 1234,
			last_sign_in: '2026-11-22T08:30:00.000Z'
		});
		expect(body.database_bytes).toBeGreaterThan(4096);
		expect(String(body.last_activity)).toMatch(/^\d{4}-\d\d-\d\dT/);
		// Counts and dates only: every value is a number, a date or the version; no name, title or address.
		for (const [key, value] of Object.entries(body)) {
			if (key === 'version') continue;
			expect(
				value === null || typeof value === 'number' || /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(value)),
				key
			).toBe(true);
		}
		const text = JSON.stringify(body);
		for (const secret of ['Ada', 'Anna', 'secret-firm', 'Confidential', 'NIS 2', 'Invited'])
			expect(text).not.toContain(secret);
	});

	it('says nothing about who signed in: only when', () => {
		expect(operatorNumbers(a).last_sign_in).toBeNull();
		createSession(a, admin.userId, new Date('2026-11-23T09:00:00.000Z'));
		expect(operatorNumbers(a).last_sign_in).toBe('2026-11-23T09:00:00.000Z');
	});

	it('refuses a missing or wrong token', async () => {
		const missing = ask(a, envA);
		expect(missing.status).toBe(401);
		expect(await missing.json()).toEqual({
			message: 'The operator token is missing or wrong.',
			code: 'unauthenticated'
		});
		expect(ask(a, envA, 'wrong-token').status).toBe(401);
		expect(ask(a, envA, TOKEN_A.slice(0, -1)).status).toBe(401);
		expect(ask(a, envA, '').status).toBe(401);
		// A person's session or access token is not the operator's token.
		const session = createSession(a, admin.userId);
		expect(ask(a, envA, session.token).status).toBe(401);
	});

	it('one tenant’s token does not work on another', () => {
		expect(ask(a, envA, TOKEN_A).status).toBe(200);
		expect(ask(b, envB, TOKEN_B).status).toBe(200);
		expect(ask(b, envB, TOKEN_A).status).toBe(401);
		expect(ask(a, envA, TOKEN_B).status).toBe(401);
	});

	it('does not exist on an instance without an operator token', async () => {
		const res = ask(a, {}, TOKEN_A);
		expect(res.status).toBe(404);
		expect(ask(a, { OPERATOR_TOKEN: '  ' }, '').status).toBe(404);
	});

	it('locks an address out after 30 wrong tokens, the right one included, and leaves other addresses alone', () => {
		for (let i = 0; i < 30; i++) expect(ask(a, envA, `guess-${i}`).status).toBe(401);
		const locked = ask(a, envA, TOKEN_A);
		expect(locked.status).toBe(429);
		expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(ask(a, envA, TOKEN_A, '198.51.100.8').status).toBe(200);
		// Asking without a token is not a guess.
		for (let i = 0; i < 40; i++) expect(ask(b, envB).status).toBe(401);
		expect(ask(b, envB, TOKEN_B).status).toBe(200);
	});

	it('a token short enough to guess keeps the instance from starting', () => {
		expect(operatorTokenProblem({ OPERATOR_TOKEN: 'short' })).toContain(
			'OPERATOR_TOKEN is shorter than 32 characters.'
		);
		expect(operatorTokenProblem(envA)).toBeNull();
		expect(operatorTokenProblem({})).toBeNull();
	});

	it('is the one path that takes the operator token, and is not a public path', () => {
		expect(isOperatorPath('/api/operator/status')).toBe(true);
		expect(isOperatorPath('/api/operator/status/x')).toBe(false);
		expect(isOperatorPath('/api/operator')).toBe(false);
		expect(isOperatorPath('/api/items/user/1')).toBe(false);
		expect(isPublicPath('/api/operator/status', false)).toBe(false);
	});
});
