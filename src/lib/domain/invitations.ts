import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { AppDatabase } from '#lib/db/client.ts';
import { createSession, setPassword } from './auth';
import { EmailNotSetUpError, emailSettings, sendEmail, type EmailDeps } from './email';
import { firstAdminEmail, instanceInfo, invitationEmail } from './email-templates';
import { DomainError, ForbiddenError, ValidationError } from './errors';
import {
	finishPasskeyRegistration,
	passkeysPossible,
	startPasskeyRegistration,
	type RelyingParty
} from './passkeys';
import { validatePassword } from './password';
import type { UserRole } from './roles';
import { signInMethod } from './sign-in-method';
import { countUsers, getUser, requireAdmin, toUser, userDefinition, type User } from './users';
import { createEntity, updateEntity, type Actor } from './write';

/**
 * Invitations by email (#90). An admin types a colleague's name and email; the colleague gets a
 * single-use link, good for 7 days, opens it, and joins: with a passkey, or where the instance has
 * passwords, with a password of their own. Until then the person is listed as invited and cannot
 * sign in any other way. Only the SHA-256 of a link's token is stored.
 */

type Env = Record<string, string | undefined>;

export const INVITATION_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
/** Dead links are remembered this long, so they can say what happened to them. */
const KEEP_DAYS = 60;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

interface InvitationRow {
	id: string;
	user_id: string;
	email: string;
	invited_by: string;
	state: 'open' | 'used' | 'withdrawn' | 'replaced';
	created_at: number;
	expires_at: number;
}

// ---- Sending

function issue(app: AppDatabase, user: User, invitedBy: string, now: Date): string {
	const token = randomBytes(32).toString('base64url');
	app.sqlite.transaction(() => {
		// Sending again makes the earlier link useless.
		app.sqlite
			.prepare(`UPDATE invitation SET state = 'replaced' WHERE user_id = ? AND state = 'open'`)
			.run(user.id);
		app.sqlite.prepare('DELETE FROM invitation WHERE expires_at < ?').run(now.getTime() - KEEP_DAYS * DAY);
		app.sqlite
			.prepare(
				`INSERT INTO invitation (id, user_id, email, invited_by, state, created_at, expires_at)
				 VALUES (?, ?, ?, ?, 'open', ?, ?)`
			)
			.run(
				sha256(token),
				user.id,
				user.email,
				invitedBy,
				now.getTime(),
				now.getTime() + INVITATION_DAYS * DAY
			);
	})();
	return token;
}

/**
 * Send the email. A mail server that refuses is reported in words; the invitation stays open.
 * Without an inviter it is the first admin's: the instance was set up for them.
 */
async function send(
	app: AppDatabase,
	user: User,
	inviterName: string | null,
	token: string,
	origin: string,
	deps: EmailDeps
): Promise<string | null> {
	const instance = instanceInfo(origin, deps.env ?? process.env);
	const link = `${instance.origin}/join?t=${token}`;
	try {
		await sendEmail(
			app,
			{
				...(inviterName === null
					? firstAdminEmail(instance, { name: user.name, link, days: INVITATION_DAYS })
					: invitationEmail(instance, {
							inviteeName: user.name,
							inviterName,
							link,
							days: INVITATION_DAYS
						})),
				to: user.email,
				kind: 'invitation'
			},
			deps
		);
		return null;
	} catch (e) {
		if (e instanceof DomainError) return e.message;
		throw e;
	}
}

export interface InvitationResult {
	user: User;
	/** Why the email could not be sent, or null when the mail server took it. */
	problem: string | null;
}

export interface InvitationContext {
	/** The instance's address, for the link in the email. */
	origin: string;
	now?: Date;
}

/** An admin invites a person: the user is created as invited, and the link goes out by email. */
export async function inviteUser(
	app: AppDatabase,
	actor: Actor,
	input: { name: string; email: string; role?: UserRole },
	context: InvitationContext,
	deps: EmailDeps = {}
): Promise<InvitationResult> {
	requireAdmin(app, actor);
	if (!emailSettings(deps.env ?? process.env).configured) throw new EmailNotSetUpError();
	const now = context.now ?? deps.now ?? new Date();
	const { row } = createEntity(
		app,
		actor,
		userDefinition,
		{ name: input.name, email: input.email, role: input.role ?? 'auditor', invited: true },
		{ note: 'Invited by email' },
		{ now }
	);
	const user = toUser(row);
	const token = issue(app, user, actor.userId, now);
	return {
		user,
		problem: await send(app, user, getUser(app, actor.userId).name, token, context.origin, { ...deps, now })
	};
}

/**
 * The first admin of an instance without passwords (#89): created as invited, as the author of their
 * own account, and sent a link. Only possible while there are no users.
 */
export async function inviteFirstAdmin(
	app: AppDatabase,
	input: { name: string; email: string },
	context: InvitationContext,
	deps: EmailDeps = {}
): Promise<InvitationResult> {
	if (!emailSettings(deps.env ?? process.env).configured) throw new EmailNotSetUpError();
	const now = context.now ?? deps.now ?? new Date();
	const { user, token } = createInvitedFirstAdmin(app, input, now);
	return {
		user,
		problem: await sendFirstAdminInvitation(app, user, token, context.origin, { ...deps, now })
	};
}

/** The first half: the person and their link, with nothing sent yet. Runs inside a caller's transaction. */
export function createInvitedFirstAdmin(
	app: AppDatabase,
	input: { name: string; email: string },
	now = new Date()
): { user: User; token: string } {
	if (countUsers(app) > 0) throw new ForbiddenError('Set-up is already complete.');
	const id = randomUUID();
	const { row } = createEntity(
		app,
		{ userId: id, channel: 'ui' },
		userDefinition,
		{ name: input.name, email: input.email, role: 'admin', invited: true },
		{ id, note: 'First admin invited at set-up' },
		{ skipAuthorization: true, now }
	);
	const user = toUser(row);
	return { user, token: issue(app, user, user.id, now) };
}

/** The second half: the email. Null when the mail server took it, otherwise why not. */
export function sendFirstAdminInvitation(
	app: AppDatabase,
	user: User,
	token: string,
	origin: string,
	deps: EmailDeps = {}
): Promise<string | null> {
	return send(app, user, null, token, origin, deps);
}

/** At a later start, while the first admin has not joined: a new link. Null when there is nobody to send to. */
export async function resendFirstAdminInvitation(
	app: AppDatabase,
	context: InvitationContext,
	deps: EmailDeps = {}
): Promise<InvitationResult | null> {
	const now = context.now ?? deps.now ?? new Date();
	const row = app.sqlite
		.prepare(
			`SELECT u.id FROM "user" u
			  WHERE u.invited = 1 AND u.active = 1 AND u.deleted = 0
			    AND EXISTS (SELECT 1 FROM invitation i WHERE i.user_id = u.id AND i.invited_by = u.id)
			  LIMIT 1`
		)
		.get() as { id: string } | undefined;
	if (!row) return null;
	const user = getUser(app, row.id);
	const token = issue(app, user, user.id, now);
	return { user, problem: await send(app, user, null, token, context.origin, { ...deps, now }) };
}

/** A new link for someone who has not joined; the earlier one stops working. Undoes a withdrawal. */
export async function sendInvitationAgain(
	app: AppDatabase,
	actor: Actor,
	userId: string,
	context: InvitationContext,
	deps: EmailDeps = {}
): Promise<InvitationResult> {
	requireAdmin(app, actor);
	if (!emailSettings(deps.env ?? process.env).configured) throw new EmailNotSetUpError();
	const now = context.now ?? deps.now ?? new Date();
	let user = getUser(app, userId);
	if (!user.invited) throw new ValidationError(`${user.name} has already joined.`);
	if (!user.active)
		user = toUser(
			updateEntity(app, actor, userDefinition, user.id, user.version, { active: true }, 'Invited again', {
				now
			}).row
		);
	const token = issue(app, user, actor.userId, now);
	return {
		user,
		problem: await send(app, user, getUser(app, actor.userId).name, token, context.origin, { ...deps, now })
	};
}

/** Take an invitation back before it is used: the link stops working and the person is deactivated. */
export function withdrawInvitation(app: AppDatabase, actor: Actor, userId: string, now = new Date()): User {
	requireAdmin(app, actor);
	const user = getUser(app, userId);
	if (!user.invited) throw new ValidationError(`${user.name} has already joined. Deactivate them instead.`);
	if (!user.active) return user;
	return app.sqlite.transaction(() => {
		app.sqlite
			.prepare(`UPDATE invitation SET state = 'withdrawn' WHERE user_id = ? AND state = 'open'`)
			.run(user.id);
		return toUser(
			updateEntity(
				app,
				actor,
				userDefinition,
				user.id,
				user.version,
				{ active: false },
				'Invitation withdrawn',
				{ now }
			).row
		);
	})();
}

/** For the list of users: until when each open invitation works. */
export function openInvitations(app: AppDatabase): Map<string, Date> {
	const rows = app.sqlite
		.prepare(`SELECT user_id, expires_at FROM invitation WHERE state = 'open'`)
		.all() as { user_id: string; expires_at: number }[];
	return new Map(rows.map((r) => [r.user_id, new Date(r.expires_at)]));
}

// ---- Reading a link

export type InvitationState = 'open' | 'used' | 'expired' | 'withdrawn' | 'replaced' | 'unknown';

export interface InvitationView {
	state: InvitationState;
	/** Set for every state but `unknown`. */
	user: { id: string; name: string; email: string } | null;
	invitedBy: string | null;
	/** The first admin's own invitation, sent when the instance was set up (#89). */
	first: boolean;
	expiresAt: Date | null;
}

/** What a link is worth right now. Reading never uses it up, so a mail scanner opening it does no harm. */
export function readInvitation(
	app: AppDatabase,
	token: string | null | undefined,
	now = new Date()
): InvitationView {
	const row = token
		? (app.sqlite.prepare('SELECT * FROM invitation WHERE id = ?').get(sha256(token)) as
				InvitationRow | undefined)
		: undefined;
	if (!row) return { state: 'unknown', user: null, invitedBy: null, first: false, expiresAt: null };
	const user = app.sqlite
		.prepare('SELECT id, name, email, active, invited, deleted FROM "user" WHERE id = ?')
		.get(row.user_id) as
		{ id: string; name: string; email: string; active: number; invited: number; deleted: number } | undefined;
	const inviter = app.sqlite.prepare('SELECT name FROM "user" WHERE id = ?').get(row.invited_by) as
		{ name: string } | undefined;
	const first = row.invited_by === row.user_id;
	let state: InvitationState = row.state;
	if (state === 'open') {
		if (!user || user.deleted === 1 || user.invited !== 1) state = 'used';
		else if (user.active !== 1) state = 'withdrawn';
		// The link went to an address the person no longer has here.
		else if (user.email !== row.email) state = 'replaced';
		else if (row.expires_at <= now.getTime()) state = 'expired';
	}
	return {
		state,
		user: user ? { id: user.id, name: user.name, email: user.email } : null,
		invitedBy: first ? null : (inviter?.name ?? null),
		first,
		expiresAt: new Date(row.expires_at)
	};
}

/** Why a link does not work, said plainly, with whom to ask. Null for a link that works. */
export function invitationProblem(view: InvitationView): string | null {
	const admin = view.first ? 'whoever set this instance up' : (view.invitedBy ?? 'your admin');
	switch (view.state) {
		case 'open':
			return null;
		case 'used':
			return 'This invitation was already used. Sign in instead.';
		case 'expired':
			return `This invitation has expired. Ask ${admin} to send it again.`;
		case 'withdrawn':
			return `This invitation was withdrawn. Ask ${admin} for a new one if you should have access.`;
		case 'replaced':
			return `A newer invitation replaced this one. Use the link in the latest email, or ask ${admin} to send it again.`;
		default:
			return 'This invitation link is not valid. Open the whole link from the email, or ask your admin for a new invitation.';
	}
}

function open(app: AppDatabase, token: string | null | undefined, now: Date) {
	const view = readInvitation(app, token, now);
	const problem = invitationProblem(view);
	if (problem || !view.user) throw new ValidationError(problem ?? 'This invitation link is not valid.');
	return { tokenHash: sha256(token!), user: view.user };
}

// ---- Joining

/** What the join page may offer: follows the instance's sign-in method (#89) and its address. */
export function joinOptions(
	origin: string,
	env: Env = process.env
): { passkey: boolean; password: boolean; withoutPasskey: boolean } {
	const method = signInMethod(env);
	return {
		passkey: passkeysPossible(origin),
		password: method === 'password',
		// A device that cannot hold a passkey: the person signs in with a code by email each time (#88).
		withoutPasskey: method === 'passkey'
	};
}

export interface Joined {
	token: string;
	expiresAt: Date;
	userId: string;
}

/** Use the link up, record the join in the person's history as their own act, and sign them in. */
function accept(app: AppDatabase, tokenHash: string, userId: string, now: Date): Joined {
	return app.sqlite.transaction(() => {
		const used = app.sqlite
			.prepare(`UPDATE invitation SET state = 'used' WHERE id = ? AND state = 'open'`)
			.run(tokenHash);
		if (used.changes !== 1) throw new ValidationError('This invitation was already used. Sign in instead.');
		const user = getUser(app, userId);
		updateEntity(
			app,
			{ userId, channel: 'ui' },
			userDefinition,
			userId,
			user.version,
			{ invited: false },
			'Joined by invitation',
			{ skipAuthorization: true, now }
		);
		return { ...createSession(app, userId, now), userId };
	})();
}

export async function startJoinWithPasskey(
	app: AppDatabase,
	token: string | null | undefined,
	rp: RelyingParty,
	now = new Date()
) {
	const { user } = open(app, token, now);
	return startPasskeyRegistration(app, user.id, rp, now);
}

/** The passkey is checked and kept, then the person is in. No password exists at any point. */
export async function finishJoinWithPasskey(
	app: AppDatabase,
	token: string | null | undefined,
	challengeToken: string | undefined,
	response: RegistrationResponseJSON,
	rp: RelyingParty,
	name: unknown,
	now = new Date()
): Promise<Joined & { passkeyName: string }> {
	const { tokenHash, user } = open(app, token, now);
	const passkey = await finishPasskeyRegistration(app, user.id, challengeToken, response, rp, name, now);
	return { ...accept(app, tokenHash, user.id, now), passkeyName: passkey.name };
}

/** Where the instance has passwords: the person chooses their own. */
export async function joinWithPassword(
	app: AppDatabase,
	token: string | null | undefined,
	input: { password: unknown; repeat: unknown },
	options: { env?: Env; now?: Date } = {}
): Promise<Joined> {
	const now = options.now ?? new Date();
	if (signInMethod(options.env ?? process.env) !== 'password')
		throw new ForbiddenError('This instance has no passwords. Join with a passkey.');
	const { tokenHash, user } = open(app, token, now);
	const password = validatePassword(input.password);
	if (password !== input.repeat)
		throw new ValidationError('The two passwords are not the same.', { repeat: 'Does not match' });
	await setPassword(app, user.id, password, false);
	return accept(app, tokenHash, user.id, now);
}

/** Where the instance has no passwords and the device cannot hold a passkey. */
export function joinWithoutPasskey(
	app: AppDatabase,
	token: string | null | undefined,
	options: { env?: Env; now?: Date } = {}
): Joined {
	const now = options.now ?? new Date();
	if (signInMethod(options.env ?? process.env) !== 'passkey')
		throw new ForbiddenError('Set a password to join.');
	const { tokenHash, user } = open(app, token, now);
	return accept(app, tokenHash, user.id, now);
}

/** Test only (the seeded test instance): make a person's open invitation expire now. */
export function expireInvitationForTests(app: AppDatabase, email: string, now = new Date()): number {
	return app.sqlite
		.prepare(`UPDATE invitation SET expires_at = ? WHERE email = ? AND state = 'open'`)
		.run(now.getTime() - 1, email.trim().toLowerCase()).changes;
}
