import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { SoftAuthenticator } from '../../../tests/fixtures/soft-authenticator';
import './entities';
import { login, validateSession } from './auth';
import { EmailNotSetUpError, type MailTransport } from './email';
import { ForbiddenError, ValidationError } from './errors';
import {
	INVITATION_DAYS,
	finishJoinWithPasskey,
	invitationProblem,
	inviteUser,
	joinOptions,
	joinWithPassword,
	joinWithoutPasskey,
	openInvitations,
	readInvitation,
	sendInvitationAgain,
	startJoinWithPasskey,
	withdrawInvitation
} from './invitations';
import { getItemHistory } from './items';
import { listPasskeys, relyingParty } from './passkeys';
import { requestSignInCode } from './sign-in-codes';
import { createFirstAdmin, createUser, getUser, resetPassword, updateUser } from './users';
import type { Actor } from './write';

let app: AppDatabase;
let admin: Actor;
const ORIGIN = 'https://audit.example.test';
const ENV = {
	SMTP_HOST: 'mail.example.test',
	SMTP_FROM: 'audit@example.test',
	INSTANCE_NAME: 'Baltic Audit',
	ORIGIN
};
const PASSKEY_ENV = { ...ENV, SIGN_IN_METHOD: 'passkey' };
const T0 = new Date('2026-11-21T10:00:00Z');
const days = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60_000);
const rp = relyingParty(ORIGIN, ENV);

let sent: Parameters<MailTransport['sendMail']>[0][];
let refuse = false;
const transport: MailTransport = {
	async sendMail(mail) {
		if (refuse) throw Object.assign(new Error('550 mailbox unavailable'), { responseCode: 550 });
		sent.push(mail);
	}
};
const deps = { env: ENV, transport };
const linkIn = (text: unknown) =>
	/https:\/\/audit\.example\.test\/join\?t=([\w-]+)/.exec(String(text))?.[1] ?? '';

beforeEach(async () => {
	app = createTestDatabase();
	sent = [];
	refuse = false;
	const a = await createFirstAdmin(app, {
		name: 'Ada',
		email: 'ada@example.test',
		password: 'correct horse battery'
	});
	admin = { userId: a.id, channel: 'ui' };
});
afterEach(() => app.close());

async function invite(
	email = 'ina@example.test',
	name = 'Ina',
	role: 'admin' | 'auditor' = 'auditor',
	now = T0
) {
	const r = await inviteUser(app, admin, { name, email, role }, { origin: ORIGIN, now }, deps);
	return { ...r, token: linkIn(sent.at(-1)?.text) };
}

describe('inviting by email (#90)', () => {
	it('creates the person as invited and sends a single-use link that names the instance and the inviter', async () => {
		const { user, problem, token } = await invite('Ina@Example.test', 'Ina', 'admin');
		expect(problem).toBeNull();
		expect(user).toMatchObject({ email: 'ina@example.test', role: 'admin', invited: true, active: true });
		const mail = sent[0]!;
		expect(mail.to).toBe('ina@example.test');
		expect(String(mail.subject)).toContain('Ada invited you');
		expect(String(mail.text)).toContain('Ada invited you to Baltic Audit');
		expect(String(mail.text)).toContain(`${INVITATION_DAYS} days`);
		expect(token).toHaveLength(43);

		// Only the hash of the link is stored.
		const rows = app.sqlite.prepare('SELECT * FROM invitation').all() as Record<string, unknown>[];
		expect(rows).toHaveLength(1);
		expect(JSON.stringify(rows)).not.toContain(token);
		// Who invited whom is in the person's history.
		const created = getItemHistory(app, 'user', user.id).at(-1)!;
		expect(created).toMatchObject({ note: 'Invited by email', authorName: 'Ada' });
		expect(openInvitations(app).get(user.id)).toEqual(days(INVITATION_DAYS));
	});

	it('is for admins, needs email set up, and refuses an address that is taken', async () => {
		const bo = (await createUser(app, admin, { name: 'Bo', email: 'bo@example.test' })).user;
		await expect(
			inviteUser(
				app,
				{ userId: bo.id, channel: 'ui' },
				{ name: 'X', email: 'x@example.test' },
				{ origin: ORIGIN },
				deps
			)
		).rejects.toThrow(ForbiddenError);
		await expect(
			inviteUser(
				app,
				admin,
				{ name: 'X', email: 'x@example.test' },
				{ origin: ORIGIN },
				{ env: {}, transport }
			)
		).rejects.toThrow(EmailNotSetUpError);
		await expect(invite('bo@example.test')).rejects.toThrow(ValidationError);
		expect(sent).toHaveLength(0);
	});

	it('says why when the mail server refuses; the person stays invited and the invitation can be sent again', async () => {
		refuse = true;
		const { user, problem } = await invite();
		expect(problem).toBeTruthy();
		expect(getUser(app, user.id).invited).toBe(true);
		refuse = false;
		const again = await sendInvitationAgain(app, admin, user.id, { origin: ORIGIN, now: T0 }, deps);
		expect(again.problem).toBeNull();
		expect(readInvitation(app, linkIn(sent.at(-1)?.text), T0).state).toBe('open');
	});

	it('keeps an invited person out until they join: no sign-in code, no password from an admin', async () => {
		const { user } = await invite();
		const r = requestSignInCode(
			app,
			'ina@example.test',
			{ origin: ORIGIN, address: '203.0.113.5', now: T0 },
			deps
		);
		await r.sent;
		expect(sent).toHaveLength(1); // the invitation only
		await expect(resetPassword(app, admin, user.id)).rejects.toThrow('Send the invitation again');
		await expect(login(app, 'ina@example.test', '', T0)).rejects.toThrow();
	});
});

describe('a link (#90)', () => {
	it('works for 7 days and reading it never uses it up', async () => {
		const { token } = await invite();
		for (let i = 0; i < 3; i++)
			expect(readInvitation(app, token, days(6))).toMatchObject({
				state: 'open',
				user: { name: 'Ina', email: 'ina@example.test' },
				invitedBy: 'Ada'
			});
		const late = readInvitation(app, token, days(INVITATION_DAYS));
		expect(late.state).toBe('expired');
		expect(invitationProblem(late)).toBe('This invitation has expired. Ask Ada to send it again.');
		expect(() => joinWithoutPasskey(app, token, { env: PASSKEY_ENV, now: days(INVITATION_DAYS) })).toThrow(
			'This invitation has expired'
		);
	});

	it('works once', async () => {
		const { token, user } = await invite();
		const joined = joinWithoutPasskey(app, token, { env: PASSKEY_ENV, now: days(1) });
		expect(validateSession(app, joined.token, days(1))?.user.id).toBe(user.id);
		const after = readInvitation(app, token, days(1));
		expect(after.state).toBe('used');
		expect(invitationProblem(after)).toBe('This invitation was already used. Sign in instead.');
		expect(() => joinWithoutPasskey(app, token, { env: PASSKEY_ENV, now: days(1) })).toThrow('already used');
	});

	it('is useless once the invitation is sent again', async () => {
		const first = await invite();
		await sendInvitationAgain(app, admin, first.user.id, { origin: ORIGIN, now: days(1) }, deps);
		const second = linkIn(sent.at(-1)?.text);
		expect(second).not.toBe(first.token);
		const old = readInvitation(app, first.token, days(1));
		expect(old.state).toBe('replaced');
		expect(invitationProblem(old)).toContain('Use the link in the latest email');
		// The new link runs its own 7 days.
		expect(readInvitation(app, second, days(7.5)).state).toBe('open');
		expect(readInvitation(app, second, days(8)).state).toBe('expired');
	});

	it('stops working when withdrawn, and a new invitation brings the person back', async () => {
		const { token, user } = await invite();
		const withdrawn = withdrawInvitation(app, admin, user.id, days(1));
		expect(withdrawn).toMatchObject({ invited: true, active: false });
		const view = readInvitation(app, token, days(1));
		expect(view.state).toBe('withdrawn');
		expect(invitationProblem(view)).toContain('This invitation was withdrawn. Ask Ada');
		expect(() => joinWithoutPasskey(app, token, { env: PASSKEY_ENV, now: days(1) })).toThrow('withdrawn');
		expect(getItemHistory(app, 'user', user.id)[0]!.note).toBe('Invitation withdrawn');
		expect(openInvitations(app).has(user.id)).toBe(false);

		await sendInvitationAgain(app, admin, user.id, { origin: ORIGIN, now: days(2) }, deps);
		expect(getUser(app, user.id)).toMatchObject({ invited: true, active: true });
		expect(readInvitation(app, token, days(2)).state).toBe('withdrawn');
		expect(readInvitation(app, linkIn(sent.at(-1)?.text), days(2)).state).toBe('open');
	});

	it('stops working when the person’s email is corrected: it went to the wrong mailbox', async () => {
		const { token, user } = await invite('ian@example.test');
		updateUser(app, admin, user.id, user.version, { email: 'ina@example.test' });
		expect(readInvitation(app, token, T0).state).toBe('replaced');
		await sendInvitationAgain(app, admin, user.id, { origin: ORIGIN, now: T0 }, deps);
		expect(sent.at(-1)?.to).toBe('ina@example.test');
	});

	it('says so for a link nobody sent', () => {
		for (const token of ['', null, 'nonsense']) {
			const view = readInvitation(app, token, T0);
			expect(view.state).toBe('unknown');
			expect(invitationProblem(view)).toContain('not valid');
		}
	});
});

describe('joining (#90)', () => {
	it('with a passkey: no password exists, the person is signed in, and the history says when they joined', async () => {
		const { token, user } = await invite();
		const device = new SoftAuthenticator();
		const start = await startJoinWithPasskey(app, token, rp, days(1));
		const joined = await finishJoinWithPasskey(
			app,
			token,
			start.token,
			await device.register(start.options, ORIGIN),
			rp,
			'Ina’s phone',
			days(1)
		);
		expect(joined.passkeyName).toBe('Ina’s phone');
		expect(validateSession(app, joined.token, days(1))?.user.id).toBe(user.id);
		expect(getUser(app, user.id)).toMatchObject({ invited: false, active: true, passkeys: 1 });
		expect(listPasskeys(app, user.id)).toHaveLength(1);
		expect(
			app.sqlite.prepare('SELECT count(*) AS n FROM user_credential WHERE user_id = ?').get(user.id)
		).toEqual({
			n: 0
		});
		const history = getItemHistory(app, 'user', user.id);
		expect(history[0]).toMatchObject({ note: 'Joined by invitation', authorName: 'Ina' });
		expect(history[0]!.createdAt).toEqual(days(1));
		expect(readInvitation(app, token, days(1)).state).toBe('used');
	});

	it('refuses a passkey for a dead link, and a failed passkey leaves the link open', async () => {
		const { token, user } = await invite();
		const start = await startJoinWithPasskey(app, token, rp, days(1));
		await expect(
			finishJoinWithPasskey(
				app,
				token,
				'not-the-challenge',
				await new SoftAuthenticator().register(start.options, ORIGIN),
				rp,
				'',
				days(1)
			)
		).rejects.toThrow(ValidationError);
		expect(readInvitation(app, token, days(1)).state).toBe('open');
		expect(getUser(app, user.id).invited).toBe(true);
		withdrawInvitation(app, admin, user.id, days(1));
		await expect(startJoinWithPasskey(app, token, rp, days(1))).rejects.toThrow('withdrawn');
	});

	it('with a password, where the instance has passwords', async () => {
		const { token, user } = await invite();
		await expect(
			joinWithPassword(app, token, { password: 'short', repeat: 'short' }, { env: ENV, now: days(1) })
		).rejects.toThrow(ValidationError);
		await expect(
			joinWithPassword(
				app,
				token,
				{ password: 'a long enough password', repeat: 'another one entirely' },
				{ env: ENV, now: days(1) }
			)
		).rejects.toThrow('not the same');
		expect(readInvitation(app, token, days(1)).state).toBe('open');
		const joined = await joinWithPassword(
			app,
			token,
			{ password: 'a long enough password', repeat: 'a long enough password' },
			{ env: ENV, now: days(1) }
		);
		expect(validateSession(app, joined.token, days(1))?.user.id).toBe(user.id);
		expect(getUser(app, user.id).invited).toBe(false);
		const again = await login(app, 'ina@example.test', 'a long enough password', days(1));
		expect(again.user.mustChangePassword).toBe(false);
		// Never without a passkey on an instance with passwords.
		const other = await invite('oto@example.test', 'Oto');
		expect(() => joinWithoutPasskey(app, other.token, { env: ENV, now: days(1) })).toThrow(ForbiddenError);
	});

	it('without a passkey, where the instance has none: from then on a code by email signs them in', async () => {
		const { token, user } = await invite();
		await expect(
			joinWithPassword(
				app,
				token,
				{ password: 'a long enough password', repeat: 'a long enough password' },
				{ env: PASSKEY_ENV, now: days(1) }
			)
		).rejects.toThrow(ForbiddenError);
		joinWithoutPasskey(app, token, { env: PASSKEY_ENV, now: days(1) });
		expect(getUser(app, user.id)).toMatchObject({ invited: false, passkeys: 0 });
		const before = sent.length;
		const r = requestSignInCode(
			app,
			'ina@example.test',
			{ origin: ORIGIN, address: '203.0.113.5', now: days(1) },
			deps
		);
		await r.sent;
		expect(sent).toHaveLength(before + 1);
		// Joined people are not invited again, nor withdrawn.
		await expect(sendInvitationAgain(app, admin, user.id, { origin: ORIGIN }, deps)).rejects.toThrow(
			'already joined'
		);
		expect(() => withdrawInvitation(app, admin, user.id)).toThrow('already joined');
	});

	it('offers what the instance and its address allow', () => {
		expect(joinOptions(ORIGIN, ENV)).toEqual({ passkey: true, password: true, withoutPasskey: false });
		expect(joinOptions(ORIGIN, PASSKEY_ENV)).toEqual({
			passkey: true,
			password: false,
			withoutPasskey: true
		});
		expect(joinOptions('http://192.168.1.20:3000', ENV)).toEqual({
			passkey: false,
			password: true,
			withoutPasskey: false
		});
	});
});
