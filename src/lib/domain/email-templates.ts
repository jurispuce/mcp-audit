/**
 * The emails the instance sends (#86): plain text with a simple HTML part. Each names the instance
 * and its address, so a person with two instances can tell them apart, and holds no secret other
 * than a single-use link or code. Wording follows the interface rules: English, sentence case.
 */

export interface Instance {
	/** What the instance is called in the shell and in emails. */
	name: string;
	/** The instance's own address, for example https://audit.example.com. */
	origin: string;
}

/** Links in emails are built from ORIGIN; without it (a private instance), from the request. */
export function instanceInfo(
	requestOrigin: string,
	env: Record<string, string | undefined> = process.env
): Instance {
	return {
		name: (env.INSTANCE_NAME ?? '').trim() || 'mcp-audit',
		origin: ((env.ORIGIN ?? '').trim() || requestOrigin).replace(/\/+$/, '')
	};
}

export interface EmailContent {
	subject: string;
	text: string;
	html: string;
}

type Block = string | { link: { href: string; label: string } } | { code: string } | { small: string };

const esc = (s: string) =>
	s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function compose(instance: Instance, subject: string, heading: string, blocks: Block[]): EmailContent {
	const footer = `Sent by ${instance.name} at ${instance.origin}. If you did not expect this message, you can ignore it; nothing happens unless the link or code is used.`;
	const text = [
		heading,
		'',
		...blocks.flatMap((b) =>
			typeof b === 'string'
				? [b, '']
				: 'link' in b
					? [`${b.link.label}:`, b.link.href, '']
					: 'code' in b
						? [`    ${b.code}`, '']
						: [b.small, '']
		),
		'--',
		footer
	].join('\n');
	const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f6f7f8;color:#14181d;font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #d5d9df;border-radius:12px">
<p style="margin:0 0 4px;font-size:13px;color:#4f5966">${esc(instance.name)}</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(heading)}</h1>
${blocks
	.map((b) =>
		typeof b === 'string'
			? `<p style="margin:0 0 16px">${esc(b)}</p>`
			: 'link' in b
				? `<p style="margin:0 0 16px"><a href="${esc(b.link.href)}" style="display:inline-block;padding:10px 16px;background:#1f5fbf;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">${esc(b.link.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#4f5966;word-break:break-all">${esc(b.link.href)}</p>`
				: 'code' in b
					? `<p style="margin:0 0 16px;font:600 28px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:4px">${esc(b.code)}</p>`
					: `<p style="margin:0 0 16px;font-size:13px;color:#4f5966">${esc(b.small)}</p>`
	)
	.join('\n')}
<p style="margin:16px 0 0;padding-top:12px;border-top:1px solid #d5d9df;font-size:13px;color:#4f5966">${esc(footer)}</p>
</div></body></html>`;
	return { subject, text, html };
}

/** "mcp-audit" alone needs no prefix; a named instance says which one is writing. */
const tagged = (instance: Instance, subject: string) =>
	instance.name === 'mcp-audit' ? `${subject} (mcp-audit)` : `${subject} (${instance.name})`;

export function testEmail(instance: Instance, input: { name: string }): EmailContent {
	return compose(instance, tagged(instance, 'Test email'), 'Email works', [
		`Hello ${input.name}, this is the test email you asked for on Settings, Email.`,
		'The instance can send invitations, sign-in codes and security notices from this address.'
	]);
}

export function invitationEmail(
	instance: Instance,
	input: { inviteeName: string; inviterName: string; link: string; days: number }
): EmailContent {
	return compose(
		instance,
		tagged(instance, `${input.inviterName} invited you`),
		`You are invited to ${instance.name}`,
		[
			`Hello ${input.inviteeName}, ${input.inviterName} invited you to ${instance.name}, where audits are planned and run.`,
			{ link: { href: input.link, label: 'Join' } },
			{
				small: `The link works once and for ${input.days} ${input.days === 1 ? 'day' : 'days'}. If it has expired, ask ${input.inviterName} to send the invitation again.`
			}
		]
	);
}

/** The first admin of an instance without passwords (#89): nobody invited them; the instance was set up for them. */
export function firstAdminEmail(
	instance: Instance,
	input: { name: string; link: string; days: number }
): EmailContent {
	return compose(instance, tagged(instance, 'Your instance is ready'), `${instance.name} is ready for you`, [
		`Hello ${input.name}, ${instance.name} was set up with you as its first admin. Join to create your passkey; then invite your colleagues on Settings, Users.`,
		{ link: { href: input.link, label: 'Join' } },
		{
			small: `The link works once and for ${input.days} ${input.days === 1 ? 'day' : 'days'}. If it has expired, ask whoever set the instance up to restart it: a new link is sent at each start until you have joined.`
		}
	]);
}

export function signInCodeEmail(
	instance: Instance,
	input: { code: string; link: string; minutes: number }
): EmailContent {
	return compose(instance, tagged(instance, `Your sign-in code is ${input.code}`), 'Your sign-in code', [
		'Enter this code on the sign-in page, in the browser where you asked for it:',
		{ code: input.code },
		{ link: { href: input.link, label: 'Sign in' } },
		{
			small: `The code and the link work once, for ${input.minutes} minutes, and only in the browser that asked for them. Nobody from ${instance.name} will ever ask you for this code.`
		}
	]);
}

export type SecurityEvent = 'passkey_added' | 'passkey_removed' | 'code_sign_in' | 'shut_out_by_admin';

const SECURITY: Record<
	SecurityEvent,
	{ subject: string; heading: string; what: (detail: string) => string }
> = {
	passkey_added: {
		subject: 'A passkey was added to your account',
		heading: 'A passkey was added',
		what: (d) => `A passkey${d ? ` named “${d}”` : ''} was added to your account.`
	},
	passkey_removed: {
		subject: 'A passkey was removed from your account',
		heading: 'A passkey was removed',
		what: (d) => `The passkey${d ? ` named “${d}”` : ''} was removed from your account.`
	},
	shut_out_by_admin: {
		subject: 'An admin ended your sessions and removed your passkeys',
		heading: 'Your sessions were ended',
		what: () =>
			'An admin ended your sessions and removed your passkeys, for example because a device was lost. Sign in with a code sent to this address and add a new passkey.'
	},
	code_sign_in: {
		subject: 'Someone signed in with a code sent to this address',
		heading: 'Sign-in with an email code',
		what: () => 'Your account was signed in to with a one-time code sent to this address.'
	}
};

export function securityNoticeEmail(
	instance: Instance,
	input: { name: string; event: SecurityEvent; detail?: string; at: Date }
): EmailContent {
	const s = SECURITY[input.event];
	const when = `${input.at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
	return compose(instance, tagged(instance, s.subject), s.heading, [
		`Hello ${input.name}, ${s.what(input.detail ?? '').replace(/^./, (c) => c.toLowerCase())} This happened on ${when}.`,
		'If this was you, there is nothing to do.',
		`If it was not you, sign in at ${instance.origin}, remove passkeys you do not recognise on Settings, Account, and tell your admin.`
	]);
}
