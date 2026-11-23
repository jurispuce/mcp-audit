import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppDatabase } from '#lib/db/client.ts';
import { createTestDatabase } from '#lib/db/test-db.ts';
import { startFakeSmtp } from '../../../e2e/fake-smtp.mjs';
import {
	EMAIL_NOT_SET_UP,
	EmailError,
	EmailNotSetUpError,
	describeSendError,
	emailSettings,
	listEmailLog,
	sendEmail,
	type MailTransport
} from './email';
import {
	instanceInfo,
	invitationEmail,
	securityNoticeEmail,
	signInCodeEmail,
	testEmail
} from './email-templates';
import { TooManyAttemptsError } from './errors';

let app: AppDatabase;
const ENV = { SMTP_HOST: 'mail.example.test', SMTP_FROM: 'mcp-audit <audit@example.test>' };
const instance = { name: 'Baltic Audit', origin: 'https://audit.example.test' };

beforeEach(() => {
	app = createTestDatabase();
});
afterEach(() => app.close());

function recorder() {
	const sent: Parameters<MailTransport['sendMail']>[0][] = [];
	const transport: MailTransport = {
		async sendMail(mail) {
			sent.push(mail);
		}
	};
	return { sent, transport };
}

describe('email settings (#86)', () => {
	it('come from the environment; the password is never part of what is shown', () => {
		expect(emailSettings({})).toMatchObject({ configured: false, missing: ['SMTP_HOST', 'SMTP_FROM'] });
		const s = emailSettings({ ...ENV, SMTP_USER: 'u', SMTP_PASSWORD: 'secret-pass' });
		expect(s).toMatchObject({ configured: true, port: 587, secure: false, user: 'u', hasPassword: true });
		expect(JSON.stringify(s)).not.toContain('secret-pass');
		expect(emailSettings({ ...ENV, SMTP_PORT: '465' }).secure).toBe(true);
		expect(emailSettings({ ...ENV, SMTP_SECURE: 'true' })).toMatchObject({ port: 465, secure: true });
		expect(emailSettings({ ...ENV, SMTP_PORT: '465', SMTP_SECURE: 'false' }).secure).toBe(false);
	});

	it('links and names come from ORIGIN and INSTANCE_NAME, else from the request', () => {
		expect(instanceInfo('http://audit.lan:3000', {})).toEqual({
			name: 'mcp-audit',
			origin: 'http://audit.lan:3000'
		});
		expect(
			instanceInfo('http://internal:3000', {
				ORIGIN: 'https://audit.example.test/',
				INSTANCE_NAME: 'Baltic Audit'
			})
		).toEqual(instance);
	});
});

describe('templates (#86)', () => {
	it('carry the instance, and no secret other than the single-use link or code', () => {
		const inv = invitationEmail(instance, {
			inviteeName: 'Bo',
			inviterName: 'Ada',
			link: 'https://audit.example.test/join/abc',
			days: 7
		});
		expect(inv.subject).toBe('Ada invited you (Baltic Audit)');
		expect(inv.text).toContain('https://audit.example.test/join/abc');
		expect(inv.text).toContain('works once and for 7 days');
		expect(inv.html).toContain('href="https://audit.example.test/join/abc"');
		expect(inv.text).toContain('Sent by Baltic Audit at https://audit.example.test.');

		const code = signInCodeEmail(instance, {
			code: '482913',
			link: 'https://audit.example.test/login/code?t=x',
			minutes: 10
		});
		expect(code.subject).toBe('Your sign-in code is 482913 (Baltic Audit)');
		expect(code.text).toContain('482913');
		expect(code.text).toContain('for 10 minutes');

		const notice = securityNoticeEmail(instance, {
			name: 'Bo',
			event: 'passkey_added',
			detail: 'MacBook',
			at: new Date('2026-11-21T09:30:00Z')
		});
		expect(notice.subject).toBe('A passkey was added to your account (Baltic Audit)');
		expect(notice.text).toContain('a passkey named “MacBook” was added to your account.');
		expect(notice.text).toContain('2026-11-21 09:30 UTC');
		expect(testEmail({ name: 'mcp-audit', origin: 'http://x' }, { name: 'Ada' }).subject).toBe(
			'Test email (mcp-audit)'
		);
	});

	it('escapes names in the HTML part', () => {
		const inv = invitationEmail(instance, {
			inviteeName: '<b>Bo</b>',
			inviterName: 'Ada & Co',
			link: 'https://audit.example.test/join/abc',
			days: 1
		});
		expect(inv.html).not.toContain('<b>Bo</b>');
		expect(inv.html).toContain('&lt;b&gt;Bo&lt;/b&gt;');
		expect(inv.html).toContain('Ada &amp; Co');
		expect(inv.text).toContain('for 1 day.');
	});
});

describe('sending (#86)', () => {
	const message = { ...testEmail(instance, { name: 'Ada' }), to: 'Ada@Example.test', kind: 'test' as const };

	it('sends through the one function and logs who was written to, without the text', async () => {
		const { sent, transport } = recorder();
		await sendEmail(app, message, { env: ENV, transport });
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			from: 'mcp-audit <audit@example.test>',
			to: 'ada@example.test',
			subject: 'Test email (Baltic Audit)'
		});
		expect(sent[0]!.headers).toMatchObject({ 'X-Mcp-Audit-Kind': 'test' });
		const log = listEmailLog(app);
		expect(log.map((l) => [l.kind, l.recipient, l.status, l.error])).toEqual([
			['test', 'ada@example.test', 'sent', null]
		]);
		expect(JSON.stringify(log)).not.toContain('Email works');
	});

	it('without settings refuses and says what is missing; nothing is sent', async () => {
		const { sent, transport } = recorder();
		await expect(sendEmail(app, message, { env: {}, transport })).rejects.toThrow(EmailNotSetUpError);
		await expect(sendEmail(app, message, { env: {}, transport })).rejects.toThrow(EMAIL_NOT_SET_UP);
		expect(sent).toEqual([]);
		expect(listEmailLog(app)).toEqual([]);
	});

	it('a refused send is logged with its reason and thrown in words', async () => {
		const lines: string[] = [];
		const transport: MailTransport = {
			async sendMail() {
				throw Object.assign(new Error('Invalid login: 535 bad credentials'), { code: 'EAUTH' });
			}
		};
		const err = await sendEmail(app, message, {
			env: { ...ENV, SMTP_USER: 'u', SMTP_PASSWORD: 'secret-pass' },
			transport,
			log: (l) => lines.push(l)
		}).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(EmailError);
		expect((err as Error).message).toBe(
			'The mail server refused the user name or password. Check SMTP_USER and SMTP_PASSWORD.'
		);
		expect(listEmailLog(app)[0]).toMatchObject({ status: 'failed', error: (err as Error).message });
		expect(lines.join('\n')).toContain('Email not sent (test to ada@example.test)');
		expect(lines.join('\n')).not.toContain('secret-pass');
	});

	it('puts other refusals in words too', () => {
		const s = emailSettings(ENV);
		expect(describeSendError({ code: 'ECONNREFUSED' }, s)).toBe(
			'Could not connect to the mail server at mail.example.test:587. Check SMTP_HOST and SMTP_PORT.'
		);
		expect(describeSendError({ code: 'EDNS' }, s)).toContain('was not found');
		expect(describeSendError({ response: '554 5.7.1  Relay\n access denied' }, s)).toBe(
			'The mail server answered: 554 5.7.1 Relay access denied'
		);
	});

	it('limits email per recipient and per hour; another recipient is not affected', async () => {
		const { sent, transport } = recorder();
		const now = new Date('2026-11-21T10:00:00Z');
		for (let i = 0; i < 10; i++) await sendEmail(app, message, { env: ENV, transport, now });
		const err = await sendEmail(app, message, { env: ENV, transport, now }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(TooManyAttemptsError);
		expect((err as Error).message).toBe(
			'Too many emails were sent in the last hour. Try again in 60 minutes.'
		);
		expect(sent).toHaveLength(10);
		await sendEmail(app, { ...message, to: 'bo@example.test' }, { env: ENV, transport, now });
		expect(sent).toHaveLength(11);
		// An hour later the first address can be written to again.
		await sendEmail(app, message, { env: ENV, transport, now: new Date(now.getTime() + 61 * 60_000) });
		expect(sent).toHaveLength(12);
	});

	it('reaches a real mail server over SMTP, and reports a refused address', async () => {
		const sink = await startFakeSmtp();
		const env = { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(sink.smtpPort), SMTP_FROM: 'audit@example.test' };
		try {
			await sendEmail(app, message, { env });
			expect(sink.messages).toHaveLength(1);
			expect(sink.messages[0]).toMatchObject({
				to: 'ada@example.test',
				from: 'audit@example.test',
				subject: 'Test email (Baltic Audit)',
				kind: 'test'
			});
			expect(sink.messages[0].text).toContain('Hello Ada, this is the test email');
			expect(sink.messages[0].html).toContain('<h1');

			const err = await sendEmail(
				app,
				{ ...message, to: 'nobody@refused.test' },
				{ env, log: () => {} }
			).catch((e: unknown) => e);
			expect(err).toBeInstanceOf(EmailError);
			expect((err as Error).message).toContain('No such mailbox here');
			expect(sink.messages).toHaveLength(1);
		} finally {
			await sink.close();
		}
	});
});
