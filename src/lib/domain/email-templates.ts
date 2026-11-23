import { instanceName } from './instance';

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
		name: instanceName(env),
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

/** What an instance set up from a profile tells its first admin about itself (#100). */
export interface SetUpForYou {
	/** Titles of the library sources that were loaded. */
	sources: string[];
	/** AI through a gateway was set up with the instance. */
	ai: boolean;
	passkeys: boolean;
	operator: { name: string; contact: string | null } | null;
}

/** mcp-audit in three sentences, for someone who has never seen it. */
export const WHAT_IT_IS =
	'mcp-audit is an app for planning and running audits: the requirements of laws and standards, the auditee’s documents, the plan, the meetings, the evidence and the findings are kept in one place. An AI can do the reading and the drafting, and everything it writes is a proposal that an auditor accepts or rejects. Every change is kept in a history, so it is always clear who decided what.';

function list(items: string[]): string {
	if (items.length <= 1) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * The first admin of an instance without passwords (#89): nobody invited them; the instance was set up
 * for them. Where it was set up from a profile (a tenant), the email is also their welcome (#100):
 * what the app is, where their instance is, what is already there and what to do first.
 */
export function firstAdminEmail(
	instance: Instance,
	input: { name: string; link: string; days: number; setUp?: SetUpForYou | null }
): EmailContent {
	const small = {
		small: `The link works once and for ${input.days} ${input.days === 1 ? 'day' : 'days'}. If it has expired, ask whoever set the instance up to restart it: a new link is sent at each start until you have joined.`
	};
	const s = input.setUp;
	if (!s)
		return compose(
			instance,
			tagged(instance, 'Your instance is ready'),
			`${instance.name} is ready for you`,
			[
				`Hello ${input.name}, ${instance.name} was set up with you as its first admin. Join to create your passkey; then invite your colleagues on Settings, Users.`,
				{ link: { href: input.link, label: 'Join' } },
				small
			]
		);
	const by = s.operator ? ` by ${s.operator.name}` : '';
	const there = [
		s.sources.length
			? `the library holds ${list(s.sources)}`
			: 'the library is empty, ready for the sources you add',
		s.ai ? 'the AI buttons are ready to use, within a budget' : 'AI is not set up yet',
		s.passkeys
			? 'people sign in with a passkey (the fingerprint, face or PIN of their own device), or with a code sent by email'
			: 'people sign in with their email and a password'
	];
	return compose(instance, tagged(instance, 'Your instance is ready'), `${instance.name} is ready for you`, [
		`Hello ${input.name}, ${instance.name} was set up with you as its first admin${by}.`,
		WHAT_IT_IS,
		`${instance.name} is your own instance, at ${instance.origin}. Nobody else works in it. Already set up: ${there.join('; ')}.`,
		`First, join with the link below${s.passkeys ? ' and create your passkey' : ''}. Then invite your colleagues on Settings, Users, and create your first engagement. The guide shows the five steps of an audit and how to connect your own Claude or ChatGPT to this instance:`,
		{ link: { href: `${instance.origin}/welcome/guide`, label: 'Guide' } },
		{ link: { href: input.link, label: 'Join' } },
		...(s.operator
			? [
					`Questions about the instance, your data or the AI budget go to ${s.operator.name}${s.operator.contact ? ` (${s.operator.contact})` : ''}, who runs it for you.`
				]
			: []),
		{
			small: `The link to join works once and for ${input.days} ${input.days === 1 ? 'day' : 'days'}. If it has expired, ask ${s.operator?.name ?? 'whoever set the instance up'} for a new one.`
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
