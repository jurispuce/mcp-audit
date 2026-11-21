import type { AppDatabase } from '#lib/db/client.ts';
import { emailSettings, sendEmail, type EmailDeps } from './email';
import { instanceInfo, securityNoticeEmail, type SecurityEvent } from './email-templates';

/**
 * Tell a person by email that something changed about how their account is reached (#88): a sign-in
 * by code, a passkey added or removed. Best effort: without email set up nothing is sent, and a
 * failed send is logged for admins but never fails what the person was doing.
 */
export async function sendSecurityNotice(
	app: AppDatabase,
	userId: string,
	event: SecurityEvent,
	input: { origin: string; detail?: string; at?: Date },
	deps: EmailDeps = {}
): Promise<void> {
	const env = deps.env ?? process.env;
	if (!emailSettings(env).configured) return;
	const user = app.sqlite
		.prepare('SELECT name, email FROM "user" WHERE id = ? AND deleted = 0')
		.get(userId) as { name: string; email: string } | undefined;
	if (!user) return;
	const at = input.at ?? deps.now ?? new Date();
	await sendEmail(
		app,
		{
			...securityNoticeEmail(instanceInfo(input.origin, env), {
				name: user.name,
				event,
				detail: input.detail,
				at
			}),
			to: user.email,
			kind: 'security_notice'
		},
		deps
	).catch(() => {});
}
