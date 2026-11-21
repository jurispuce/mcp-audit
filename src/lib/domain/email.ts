import { randomUUID } from 'node:crypto';
import { createTransport, type Transporter } from 'nodemailer';
import type { AppDatabase } from '#lib/db/client.ts';
import type { EmailContent } from './email-templates';
import { DomainError, TooManyAttemptsError } from './errors';
import { assertNotLocked, POLICIES, recordFailure } from './throttle';

/**
 * Outbound email (#86). `sendEmail` is the only place that talks to the mail server; invitations,
 * sign-in codes and security notices all go through it. Settings come from the environment, so the
 * password never reaches the database or a screen. Without them the app works as before, and what
 * needs email says why it is off.
 */

export type EmailKind = 'test' | 'invitation' | 'sign_in_code' | 'security_notice';

export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
	test: 'Test email',
	invitation: 'Invitation',
	sign_in_code: 'Sign-in code',
	security_notice: 'Security notice'
};

export interface EmailSettings {
	/** Host and sender are set: the instance can send. */
	configured: boolean;
	host: string;
	port: number;
	/** TLS from the first byte (port 465). Otherwise the connection is upgraded with STARTTLS. */
	secure: boolean;
	user: string | null;
	hasPassword: boolean;
	from: string;
	/** The settings still missing, by name. */
	missing: string[];
}

type Env = Record<string, string | undefined>;
const val = (env: Env, key: string) => (env[key] ?? '').trim();

export function emailSettings(env: Env = process.env): EmailSettings {
	const host = val(env, 'SMTP_HOST');
	const from = val(env, 'SMTP_FROM');
	const port = Number(val(env, 'SMTP_PORT')) || (val(env, 'SMTP_SECURE') === 'true' ? 465 : 587);
	const secure = val(env, 'SMTP_SECURE') ? val(env, 'SMTP_SECURE') === 'true' : port === 465;
	return {
		configured: !!host && !!from,
		host,
		port,
		secure,
		user: val(env, 'SMTP_USER') || null,
		hasPassword: !!val(env, 'SMTP_PASSWORD'),
		from,
		missing: [host ? null : 'SMTP_HOST', from ? null : 'SMTP_FROM'].filter((x): x is string => !!x)
	};
}

export const EMAIL_NOT_SET_UP =
	'Email is not set up on this instance. An admin sets SMTP_HOST and SMTP_FROM in its environment (docs/deployment.md).';

export class EmailError extends DomainError {
	override readonly status: number = 502;
	override readonly code: string = 'email';
}

export class EmailNotSetUpError extends EmailError {
	override readonly status = 409;
	override readonly code = 'email_not_set_up';
	constructor() {
		super(EMAIL_NOT_SET_UP);
	}
}

/** What a transport must do; nodemailer's transporter fits, and tests pass their own. */
export interface MailTransport {
	sendMail(mail: {
		from: string;
		to: string;
		subject: string;
		text: string;
		html: string;
		headers?: Record<string, string>;
	}): Promise<unknown>;
}

export interface EmailDeps {
	env?: Env;
	transport?: MailTransport;
	now?: Date;
	/** Where failures are written; the console by default. */
	log?: (line: string) => void;
}

let cached: { key: string; transport: Transporter } | null = null;

function transportFor(env: Env, s: EmailSettings): MailTransport {
	const key = JSON.stringify([s.host, s.port, s.secure, s.user, val(env, 'SMTP_PASSWORD')]);
	if (cached?.key !== key) {
		cached = {
			key,
			transport: createTransport({
				host: s.host,
				port: s.port,
				secure: s.secure,
				// A user name and password never travel over an unencrypted connection.
				requireTLS: !s.secure && !!s.user,
				auth: s.user ? { user: s.user, pass: val(env, 'SMTP_PASSWORD') } : undefined,
				connectionTimeout: 10_000,
				greetingTimeout: 10_000,
				socketTimeout: 20_000
			})
		};
	}
	return cached.transport;
}

/** The mail server's refusal in words a person can act on. Never includes the password. */
export function describeSendError(e: unknown, s: EmailSettings): string {
	const err = e as { code?: string; responseCode?: number; response?: string; message?: string };
	const where = `${s.host}:${s.port}`;
	switch (err?.code) {
		case 'ECONNREFUSED':
		case 'ECONNECTION':
		case 'ESOCKET':
			return `Could not connect to the mail server at ${where}. Check SMTP_HOST and SMTP_PORT.`;
		case 'ETIMEDOUT':
		case 'ECONNRESET':
			return `The mail server at ${where} did not answer in time.`;
		case 'EDNS':
		case 'ENOTFOUND':
			return `The mail server name ${s.host} was not found. Check SMTP_HOST.`;
		case 'EAUTH':
			return 'The mail server refused the user name or password. Check SMTP_USER and SMTP_PASSWORD.';
		case 'ETLS':
			return `The mail server at ${where} does not offer an encrypted connection, which a user name and password need.`;
		case 'EENVELOPE':
			return `The mail server refused the address: ${String(err.response ?? err.message ?? '').slice(0, 200)}`;
	}
	const said = String(err?.response ?? err?.message ?? 'unknown error')
		.replace(/\s+/g, ' ')
		.slice(0, 240);
	return `The mail server answered: ${said}`;
}

const KEEP = 500;

function logSend(
	app: AppDatabase,
	now: Date,
	kind: EmailKind,
	recipient: string,
	status: 'sent' | 'failed',
	error: string | null
): void {
	app.sqlite
		.prepare(
			'INSERT INTO email_log (id, created_at, kind, recipient, status, error) VALUES (?, ?, ?, ?, ?, ?)'
		)
		.run(randomUUID(), now.getTime(), kind, recipient, status, error);
	app.sqlite
		.prepare(
			`DELETE FROM email_log WHERE id NOT IN (SELECT id FROM email_log ORDER BY created_at DESC, rowid DESC LIMIT ${KEEP})`
		)
		.run();
}

/**
 * Send one email. Refuses when email is not set up or the hourly limit for the recipient or the
 * instance is reached; a refusal by the mail server is logged with its reason and thrown in words,
 * so whoever triggered the send sees it.
 */
export async function sendEmail(
	app: AppDatabase,
	message: EmailContent & { to: string; kind: EmailKind },
	deps: EmailDeps = {}
): Promise<void> {
	const env = deps.env ?? process.env;
	const now = deps.now ?? new Date();
	const s = emailSettings(env);
	if (!s.configured) throw new EmailNotSetUpError();
	const to = message.to.trim().toLowerCase();
	const keys = [`email:to:${to}`, 'email:instance'];
	try {
		assertNotLocked(app, keys, now);
	} catch (e) {
		if (e instanceof TooManyAttemptsError)
			throw new TooManyAttemptsError(
				`Too many emails were sent in the last hour. Try again in ${Math.max(1, Math.ceil(e.retryAfterSeconds / 60))} minutes.`,
				e.retryAfterSeconds
			);
		throw e;
	}
	// Every send counts, delivered or not, so a failing mail server is not hammered either.
	recordFailure(app, keys[0]!, POLICIES.emailRecipient, now);
	recordFailure(app, keys[1]!, POLICIES.emailInstance, now);
	try {
		await (deps.transport ?? transportFor(env, s)).sendMail({
			from: s.from,
			to,
			subject: message.subject,
			text: message.text,
			html: message.html,
			headers: { 'X-Mcp-Audit-Kind': message.kind, 'Auto-Submitted': 'auto-generated' }
		});
	} catch (e) {
		const reason = describeSendError(e, s);
		logSend(app, now, message.kind, to, 'failed', reason);
		(deps.log ?? console.error)(`Email not sent (${message.kind} to ${to}): ${reason}`);
		throw new EmailError(reason);
	}
	logSend(app, now, message.kind, to, 'sent', null);
}

export interface EmailLogEntry {
	id: string;
	at: Date;
	kind: EmailKind;
	recipient: string;
	status: 'sent' | 'failed';
	error: string | null;
}

/** The newest sends, for admins: who was written to and whether the mail server took it. */
export function listEmailLog(app: AppDatabase, limit = 20): EmailLogEntry[] {
	return (
		app.sqlite.prepare('SELECT * FROM email_log ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as {
			id: string;
			created_at: number;
			kind: EmailKind;
			recipient: string;
			status: 'sent' | 'failed';
			error: string | null;
		}[]
	).map((r) => ({
		id: r.id,
		at: new Date(r.created_at),
		kind: r.kind,
		recipient: r.recipient,
		status: r.status,
		error: r.error
	}));
}
