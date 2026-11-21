import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { SoftAuthenticator } from '../../../tests/fixtures/soft-authenticator';
import './entities';
import { validateSession } from './auth';
import { EmailNotSetUpError, listEmailLog, type MailTransport } from './email';
import { ForbiddenError, TooManyAttemptsError, UnauthenticatedError, ValidationError } from './errors';
import { getItemHistory } from './items';
import {
	endSessionsAndRemovePasskeys,
	finishPasskeyRegistration,
	listPasskeys,
	relyingParty,
	removePasskey,
	startPasskeyRegistration
} from './passkeys';
import { sendSecurityNotice } from './security-notices';
import {
	CODE_GONE,
	CODE_WRONG,
	cancelSignInCode,
	finishCodeSignIn,
	pendingSignInCode,
	requestSignInCode
} from './sign-in-codes';
import { createFirstAdmin, createUser, getUser, setUserActive } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let admin: Actor;
let boId: string;
const ORIGIN = 'https://audit.example.test';
const ENV = {
	SMTP_HOST: 'mail.example.test',
	SMTP_FROM: 'audit@example.test',
	INSTANCE_NAME: 'Baltic Audit'
};
const T0 = new Date('2026-11-21T10:00:00Z');
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

let sent: Parameters<MailTransport['sendMail']>[0][];
const transport: MailTransport = {
	async sendMail(mail) {
		sent.push(mail);
	}
};
const deps = { env: ENV, transport };

beforeEach(async () => {
	app = createTestDatabase();
	sent = [];
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	admin = { userId: a.id, channel: 'ui' };
	boId = (await createUser(app, admin, { name: 'Bo', email: 'bo@example.test' })).user.id;
});
afterEach(() => app.close());

async function ask(email = 'bo@example.test', now = T0, address = '203.0.113.5', next: string | null = null) {
	const r = requestSignInCode(app, email, { origin: ORIGIN, address, now, next }, deps);
	await r.sent;
	const mail = sent.at(-1);
	return {
		token: r.token,
		expiresAt: r.expiresAt,
		code: /^\s{4}(\d{6})$/m.exec(mail?.text ?? '')?.[1] ?? '',
		link: /https:\/\/audit\.example\.test\/login\/code\?t=([\w-]+)/.exec(mail?.text ?? '')?.[1] ?? ''
	};
}

describe('asking for a sign-in code (#88)', () => {
	it('emails a six-digit code and a link that last ten minutes, and stores neither', async () => {
		const r = await ask();
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ to: 'bo@example.test' });
		expect(sent[0]!.subject).toBe(`Your sign-in code is ${r.code} (Baltic Audit)`);
		expect(r.code).toMatch(/^\d{6}$/);
		expect(r.link.length).toBeGreaterThan(20);
		expect(r.expiresAt).toEqual(later(10));
		expect(pendingSignInCode(app, r.token, T0)).toEqual({ email: 'bo@example.test', expiresAt: later(10) });
		const stored = JSON.stringify(app.sqlite.prepare('SELECT * FROM sign_in_code').all());
		expect(stored).not.toContain(r.code);
		expect(stored).not.toContain(r.link);
		expect(stored).not.toContain(r.token);
		// The log of sends says a code went out, not what it was.
		expect(JSON.stringify(listEmailLog(app))).not.toContain(r.code);
	});

	it('answers the same for an address without an account, and sends nothing', async () => {
		const known = await ask('bo@example.test');
		const unknown = await ask('nobody@example.test');
		expect(sent).toHaveLength(1);
		expect(Object.keys(unknown).sort()).toEqual(Object.keys(known).sort());
		expect(unknown.expiresAt).toEqual(known.expiresAt);
		expect(pendingSignInCode(app, unknown.token, T0)?.email).toBe('nobody@example.test');
		// A deactivated person is treated as having no account.
		setUserActive(app, admin, boId, getUser(app, boId).version, false);
		await ask('bo@example.test', later(1));
		expect(sent).toHaveLength(1);
	});

	it('needs email to be set up, and something that looks like an address', () => {
		expect(() => requestSignInCode(app, 'bo@example.test', { origin: ORIGIN }, { env: {} })).toThrow(
			EmailNotSetUpError
		);
		expect(() => requestSignInCode(app, 'not an address', { origin: ORIGIN }, deps)).toThrow(
			'Enter your email address.'
		);
	});

	it('limits requests per address asked for and per client address, for any address alike', async () => {
		for (let i = 0; i < 5; i++) await ask('nobody@example.test', T0, `198.51.100.${i}`);
		expect(() =>
			requestSignInCode(
				app,
				'nobody@example.test',
				{ origin: ORIGIN, address: '198.51.100.9', now: T0 },
				deps
			)
		).toThrow('Too many codes were asked for. Try again in 15 minutes.');
		await ask('nobody@example.test', later(16), '198.51.100.9');

		for (let i = 0; i < 10; i++) await ask(`person${i}@example.test`, T0, '203.0.113.99');
		expect(() =>
			requestSignInCode(app, 'bo@example.test', { origin: ORIGIN, address: '203.0.113.99', now: T0 }, deps)
		).toThrow(TooManyAttemptsError);
	});
});

describe('signing in with the code (#88)', () => {
	it('the code signs the person in once, in the browser that asked, and goes where they were heading', async () => {
		const r = await ask('bo@example.test', T0, '203.0.113.5', '/e/123/plan/events');
		// Another browser has no cookie, or a different one: the code is useless there.
		expect(() => finishCodeSignIn(app, undefined, { code: r.code }, { now: T0 })).toThrow(CODE_GONE);
		const other = await ask('ada@example.test');
		expect(() => finishCodeSignIn(app, other.token, { code: r.code }, { now: T0 })).toThrow(CODE_WRONG);

		const s = finishCodeSignIn(
			app,
			r.token,
			{ code: ` ${r.code.slice(0, 3)} ${r.code.slice(3)} ` },
			{ now: later(9) }
		);
		expect(s.user).toMatchObject({ email: 'bo@example.test', role: 'auditor' });
		expect(s.next).toBe('/e/123/plan/events');
		expect(validateSession(app, s.token, later(9))?.user.id).toBe(boId);
		// Once.
		expect(() => finishCodeSignIn(app, r.token, { code: r.code }, { now: later(9) })).toThrow(CODE_GONE);
		expect(pendingSignInCode(app, r.token, later(9))).toBeNull();
	});

	it('the link from the email works the same way, and only with the cookie of the asking browser', async () => {
		const r = await ask();
		expect(() => finishCodeSignIn(app, undefined, { linkToken: r.link }, { now: T0 })).toThrow(CODE_GONE);
		expect(() => finishCodeSignIn(app, r.token, { linkToken: 'x'.repeat(43) }, { now: T0 })).toThrow(
			CODE_WRONG
		);
		expect(finishCodeSignIn(app, r.token, { linkToken: r.link }, { now: T0 }).user.email).toBe(
			'bo@example.test'
		);
	});

	it('expires after ten minutes; a cancelled code is gone', async () => {
		const r = await ask();
		expect(() => finishCodeSignIn(app, r.token, { code: r.code }, { now: later(10) })).toThrow(CODE_GONE);
		const again = await ask('bo@example.test', later(11));
		cancelSignInCode(app, again.token);
		expect(() => finishCodeSignIn(app, again.token, { code: again.code }, { now: later(11) })).toThrow(
			CODE_GONE
		);
	});

	it('wrong codes are refused, five end the code, and they count towards the sign-in lock-out', async () => {
		const r = await ask();
		const wrong = r.code === '000000' ? '000001' : '000000';
		for (let i = 0; i < 4; i++)
			expect(() =>
				finishCodeSignIn(app, r.token, { code: wrong }, { now: T0, address: `198.51.100.${i}` })
			).toThrow(UnauthenticatedError);
		expect(() =>
			finishCodeSignIn(app, r.token, { code: wrong }, { now: T0, address: '198.51.100.4' })
		).toThrow('Too many wrong codes. Ask for a new one.');
		// The right code no longer helps: the code is gone, and the account is locked like after wrong passwords.
		expect(() => finishCodeSignIn(app, r.token, { code: r.code }, { now: T0 })).toThrow(CODE_GONE);
		const next = await ask('bo@example.test', later(14), '198.51.100.50');
		expect(() => finishCodeSignIn(app, next.token, { code: next.code }, { now: later(14.5) })).toThrow(
			TooManyAttemptsError
		);
		// Fifteen minutes after the fifth wrong code the lock is over.
		expect(finishCodeSignIn(app, next.token, { code: next.code }, { now: later(15.5) }).user.id).toBe(boId);
	});

	it('for an address without an account every code is wrong, in the same words', async () => {
		const r = await ask('nobody@example.test');
		expect(() => finishCodeSignIn(app, r.token, { code: '123456' }, { now: T0 })).toThrow(CODE_WRONG);
		// Not even the code that was made (and never sent) opens anything.
		const row = app.sqlite.prepare('SELECT * FROM sign_in_code').get() as { code_hash: string };
		expect(row.code_hash).toHaveLength(64);
		for (let i = 0; i < 3; i++)
			expect(() => finishCodeSignIn(app, r.token, { code: '654321' }, { now: T0 })).toThrow(CODE_WRONG);
		expect(() => finishCodeSignIn(app, r.token, { code: '654321' }, { now: T0 })).toThrow(ValidationError);
	});

	it('a person deactivated after asking cannot use the code', async () => {
		const r = await ask();
		setUserActive(app, admin, boId, getUser(app, boId).version, false);
		expect(() => finishCodeSignIn(app, r.token, { code: r.code }, { now: T0 })).toThrow(CODE_WRONG);
	});
});

describe('security notices and shutting a lost device out (#88)', () => {
	const rp = relyingParty(ORIGIN, ENV);
	async function addPasskey(userId: string, name: string) {
		const device = new SoftAuthenticator();
		const start = await startPasskeyRegistration(app, userId, rp);
		return finishPasskeyRegistration(
			app,
			userId,
			start.token,
			device.register(start.options, ORIGIN),
			rp,
			name
		);
	}

	it('tells the account by email, and never fails what the person was doing', async () => {
		await sendSecurityNotice(app, boId, 'code_sign_in', { origin: ORIGIN, at: T0 }, deps);
		await sendSecurityNotice(app, boId, 'passkey_added', { origin: ORIGIN, detail: 'Phone', at: T0 }, deps);
		expect(sent.map((m) => [m.to, m.subject])).toEqual([
			['bo@example.test', 'Someone signed in with a code sent to this address (Baltic Audit)'],
			['bo@example.test', 'A passkey was added to your account (Baltic Audit)']
		]);
		expect(sent[1]!.text).toContain('a passkey named “Phone” was added');
		// Without email, or with a mail server that refuses: nothing is thrown.
		await sendSecurityNotice(app, boId, 'code_sign_in', { origin: ORIGIN }, { env: {} });
		await sendSecurityNotice(
			app,
			boId,
			'code_sign_in',
			{ origin: ORIGIN },
			{
				env: ENV,
				log: () => {},
				transport: {
					async sendMail() {
						throw new Error('down');
					}
				}
			}
		);
		expect(sent).toHaveLength(2);
	});

	it('with email set up, the last passkey can be removed: a code by email is the other way in', async () => {
		const p = await addPasskey(boId, 'Phone');
		app.sqlite.prepare('DELETE FROM user_credential WHERE user_id = ?').run(boId);
		expect(() => removePasskey(app, boId, p.id, {})).toThrow('This is your only way to sign in.');
		expect(removePasskey(app, boId, p.id, ENV)).toBe('Phone');
	});

	it("an admin ends a person's sessions and removes their passkeys; the person recovers by code", async () => {
		await addPasskey(boId, 'Phone');
		await addPasskey(boId, 'Laptop');
		const first = await ask();
		const session = finishCodeSignIn(app, first.token, { code: first.code }, { now: T0 });
		expect(validateSession(app, session.token, T0)).not.toBeNull();

		expect(() => endSessionsAndRemovePasskeys(app, { userId: boId, channel: 'ui' }, admin.userId)).toThrow(
			ForbiddenError
		);
		expect(() => endSessionsAndRemovePasskeys(app, admin, admin.userId)).toThrow(
			'Remove your own passkeys on Settings, Account.'
		);
		expect(endSessionsAndRemovePasskeys(app, admin, boId)).toBe(2);
		expect(validateSession(app, session.token, T0)).toBeNull();
		expect(listPasskeys(app, boId)).toEqual([]);
		expect(getUser(app, boId).passkeys).toBe(0);
		const entry = getItemHistory(app, 'user', boId)[0]!;
		expect(entry.note).toBe('Sessions ended and 2 passkeys removed by an admin');
		expect(entry.authorName).toBe('Ada');
		// Nothing to remove the second time; sessions are ended all the same.
		expect(endSessionsAndRemovePasskeys(app, admin, boId)).toBe(0);

		const back = await ask('bo@example.test', later(1));
		expect(finishCodeSignIn(app, back.token, { code: back.code }, { now: later(1) }).user.id).toBe(boId);
	});
});
