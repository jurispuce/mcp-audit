import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import './entities';
import { changeOwnPassword } from './account';
import { countPasswords, createSession, hasPassword, login, setPassword, validateSession } from './auth';
import type { MailTransport } from './email';
import { ForbiddenError } from './errors';
import { joinWithoutPasskey, readInvitation } from './invitations';
import { getItemHistory } from './items';
import { completeSetup, issueSetupCode, needsSetup } from './setup';
import { requestSignInCode } from './sign-in-codes';
import { NO_PASSWORDS, signInMethod, signInMethodProblem } from './sign-in-method';
import { StartupError, passkeyModeProblems, prepareInstance } from './startup';
import { createFirstAdmin, createUser, listUsers, resetPassword } from './users';
import type { Actor } from './write';

/** #89: what each sign-in method allows, the check at start, and the move from passwords to passkeys. */

let app: AppDatabase;
const ORIGIN = 'https://audit.example.test';
const MAIL = {
	SMTP_HOST: 'mail.example.test',
	SMTP_FROM: 'audit@example.test',
	INSTANCE_NAME: 'Baltic Audit'
};
const PASSKEY = {
	...MAIL,
	ORIGIN,
	SIGN_IN_METHOD: 'passkey',
	INITIAL_ADMIN_EMAIL: 'Fia@Example.test',
	INITIAL_ADMIN_NAME: 'Fia First'
};
const PASSWORD = 'correct horse battery';

let sent: Parameters<MailTransport['sendMail']>[0][];
let mailServerDown = false;
const transport: MailTransport = {
	async sendMail(mail) {
		sent.push(mail);
	},
	async verify() {
		if (mailServerDown) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
	}
};
let lines: string[];
const start = (env: Record<string, string>) =>
	prepareInstance(app, { env, deps: { transport }, log: (l) => lines.push(l) });
const linkIn = (text: unknown) =>
	/https:\/\/audit\.example\.test\/join\?t=([\w-]+)/.exec(String(text))?.[1] ?? '';

beforeEach(() => {
	app = createTestDatabase();
	sent = [];
	lines = [];
	mailServerDown = false;
});
afterEach(() => {
	vi.unstubAllEnvs();
	app.close();
});

/** An instance with passwords and two people, as it was before the move. */
async function passwordInstance(): Promise<{ admin: Actor; adaId: string; boId: string }> {
	const ada = await createFirstAdmin(app, { name: 'Ada', email: 'ada@example.test', password: PASSWORD });
	const admin: Actor = { userId: ada.id, channel: 'ui' };
	const bo = (await createUser(app, admin, { name: 'Bo', email: 'bo@example.test' })).user;
	await setPassword(app, bo.id, 'another long password', false);
	return { admin, adaId: ada.id, boId: bo.id };
}

describe('the setting', () => {
	it('is password unless it says passkey; anything else is named as a problem', () => {
		expect(signInMethod({})).toBe('password');
		expect(signInMethod({ SIGN_IN_METHOD: ' Password ' })).toBe('password');
		expect(signInMethod({ SIGN_IN_METHOD: 'PASSKEY' })).toBe('passkey');
		expect(signInMethodProblem({})).toBeNull();
		expect(signInMethodProblem({ SIGN_IN_METHOD: 'passkey' })).toBeNull();
		expect(signInMethodProblem({ SIGN_IN_METHOD: 'passkeys' })).toBe(
			'SIGN_IN_METHOD is "passkeys". Use "password" or "passkey".'
		);
	});
});

describe('password mode', () => {
	it('works as before, and someone without a password sets their first one without a current one', async () => {
		const { admin, adaId, boId } = await passwordInstance();
		expect((await login(app, 'ada@example.test', PASSWORD)).user.id).toBe(adaId);
		expect((await resetPassword(app, admin, boId)).temporaryPassword).toBeTruthy();
		await expect(changeOwnPassword(app, adaId, 'wrong', 'a brand new password')).rejects.toThrow(
			'Current password is not correct.'
		);
		await changeOwnPassword(app, adaId, PASSWORD, 'a brand new password');

		// Joined with a passkey, so no password yet.
		app.sqlite.prepare('DELETE FROM user_credential WHERE user_id = ?').run(boId);
		expect(hasPassword(app, boId)).toBe(false);
		await changeOwnPassword(app, boId, '', 'my first password here');
		expect((await login(app, 'bo@example.test', 'my first password here')).user.id).toBe(boId);
	});

	it('starts as before: the first admin from INITIAL_ADMIN_* with a password, or the set-up code', async () => {
		await start({});
		expect(needsSetup(app)).toBe(true);
		await start({ INITIAL_ADMIN_EMAIL: 'ada@example.test', INITIAL_ADMIN_PASSWORD: PASSWORD });
		expect(lines).toEqual(['Created the first admin ada@example.test from INITIAL_ADMIN_EMAIL.']);
		expect(needsSetup(app)).toBe(false);
		expect(sent).toHaveLength(0);
	});
});

describe('passkey mode', () => {
	it('refuses every way to set, check or reset a password, before anything is created', async () => {
		const { admin, adaId, boId } = await passwordInstance();
		const users = listUsers(app).length;
		vi.stubEnv('SIGN_IN_METHOD', 'passkey');
		await expect(setPassword(app, adaId, 'a brand new password', false)).rejects.toThrow(NO_PASSWORDS);
		await expect(login(app, 'ada@example.test', PASSWORD)).rejects.toThrow(ForbiddenError);
		await expect(changeOwnPassword(app, adaId, PASSWORD, 'a brand new password')).rejects.toThrow(
			NO_PASSWORDS
		);
		await expect(resetPassword(app, admin, boId)).rejects.toThrow(NO_PASSWORDS);
		await expect(createUser(app, admin, { name: 'Cy', email: 'cy@example.test' })).rejects.toThrow(
			NO_PASSWORDS
		);
		expect(listUsers(app)).toHaveLength(users);
	});

	it('has no set-up page: nobody claims the instance with a code from the log', async () => {
		vi.stubEnv('SIGN_IN_METHOD', 'passkey');
		expect(needsSetup(app)).toBe(false);
		await expect(
			completeSetup(app, {
				code: issueSetupCode(),
				name: 'Eve',
				email: 'eve@example.test',
				password: PASSWORD
			})
		).rejects.toThrow(ForbiddenError);
		expect(listUsers(app)).toHaveLength(0);
	});
});

describe('the check at start', () => {
	it('stops on an unknown method', async () => {
		await expect(start({ SIGN_IN_METHOD: 'sso' })).rejects.toThrow(StartupError);
	});

	it('names each thing an instance without passwords lacks, and changes nothing', async () => {
		expect(passkeyModeProblems(app, { SIGN_IN_METHOD: 'passkey' })).toHaveLength(3);
		const cases: [Record<string, string>, string][] = [
			[{ ...PASSKEY, SMTP_HOST: '' }, 'SMTP_HOST and SMTP_FROM'],
			[{ ...PASSKEY, ORIGIN: '' }, 'needs ORIGIN'],
			// Browsers give passkeys only to https with a host name.
			[{ ...PASSKEY, ORIGIN: 'http://192.168.1.20:3000' }, 'needs ORIGIN'],
			[{ ...PASSKEY, INITIAL_ADMIN_EMAIL: '' }, 'needs INITIAL_ADMIN_EMAIL'],
			[{ ...PASSKEY, INITIAL_ADMIN_EMAIL: 'not-an-address' }, 'INITIAL_ADMIN_EMAIL is "not-an-address"']
		];
		for (const [env, message] of cases) {
			await expect(start(env)).rejects.toThrow(message);
			expect(listUsers(app)).toHaveLength(0);
		}
		expect(sent).toHaveLength(0);
	});

	it('invites the first admin by email; they join by the link, and a restart sends a new one until then', async () => {
		vi.stubEnv('SIGN_IN_METHOD', 'passkey');
		await start(PASSKEY);
		const [fia] = listUsers(app);
		expect(fia).toMatchObject({ name: 'Fia First', email: 'fia@example.test', role: 'admin', invited: true });
		expect(countPasswords(app)).toBe(0);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.to).toBe('fia@example.test');
		expect(String(sent[0]!.subject)).toContain('Your instance is ready');
		expect(String(sent[0]!.text)).toContain('Baltic Audit was set up with you as its first admin');
		expect(lines[0]).toContain("Sent the first admin's invitation to fia@example.test");
		expect(getItemHistory(app, 'user', fia!.id)[0]).toMatchObject({
			note: 'First admin invited at set-up',
			authorName: 'Fia First'
		});
		const first = linkIn(sent[0]!.text);
		expect(readInvitation(app, first)).toMatchObject({ state: 'open', first: true, invitedBy: null });

		// A restart before they joined: a new link, the earlier one is useless.
		await start(PASSKEY);
		expect(sent).toHaveLength(2);
		const second = linkIn(sent[1]!.text);
		expect(readInvitation(app, first).state).toBe('replaced');
		const joined = joinWithoutPasskey(app, second, { env: PASSKEY });
		expect(validateSession(app, joined.token)?.user).toMatchObject({ id: fia!.id, role: 'admin' });

		// A restart after: nothing is sent and nothing changes.
		lines = [];
		await start(PASSKEY);
		expect(sent).toHaveLength(2);
		expect(lines).toEqual([]);
		expect(listUsers(app)).toHaveLength(1);
	});

	it('says so when the first invitation cannot be sent, and still starts', async () => {
		const failing: MailTransport = {
			async sendMail() {
				throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
			}
		};
		await prepareInstance(app, {
			env: PASSKEY,
			deps: { transport: failing, log: () => {} },
			log: (l) => lines.push(l)
		});
		expect(lines[0]).toContain("The first admin's invitation to fia@example.test could not be sent");
		expect(lines[0]).toContain('Restart to send it again.');
		expect(listUsers(app)).toHaveLength(1);
	});
});

describe('moving an instance from passwords to passkeys', () => {
	const MOVED = { ...PASSKEY, INITIAL_ADMIN_EMAIL: '' };

	it('keeps the passwords and refuses to start while the mail server does not answer', async () => {
		await passwordInstance();
		mailServerDown = true;
		await expect(start(MOVED)).rejects.toThrow(
			/would delete 2 stored passwords.*Could not connect to the mail server.*Nothing was changed/s
		);
		expect(countPasswords(app)).toBe(2);
		expect((await login(app, 'ada@example.test', PASSWORD)).user.name).toBe('Ada');
	});

	it('deletes the stored passwords; people stay signed in and come back with a code by email', async () => {
		const { adaId } = await passwordInstance();
		const session = createSession(app, adaId);
		await start(MOVED);
		expect(countPasswords(app)).toBe(0);
		expect(lines[0]).toContain('Deleted 2 stored passwords');
		// Nobody is invited: the people are already here.
		expect(sent).toHaveLength(0);
		expect(listUsers(app).every((u) => !u.invited)).toBe(true);
		expect(validateSession(app, session.token)?.user.id).toBe(adaId);

		vi.stubEnv('SIGN_IN_METHOD', 'passkey');
		await expect(login(app, 'ada@example.test', PASSWORD)).rejects.toThrow(NO_PASSWORDS);
		const code = requestSignInCode(
			app,
			'bo@example.test',
			{ origin: ORIGIN, address: '203.0.113.5' },
			{ env: MOVED, transport }
		);
		await code.sent;
		expect(sent.at(-1)?.to).toBe('bo@example.test');
		// The second start finds nothing left to delete.
		lines = [];
		await start(MOVED);
		expect(lines).toEqual([]);
	});
});
