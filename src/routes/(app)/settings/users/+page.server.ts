import { error } from '@sveltejs/kit';
import { USER_ROLES, type UserRole } from '#lib/domain/roles.ts';
import {
	createUser,
	isAdmin,
	listUsers,
	resetPassword,
	setUserActive,
	updateUser
} from '#lib/domain/users.ts';
import { emailSettings } from '#lib/domain/email.ts';
import {
	INVITATION_DAYS,
	inviteUser,
	openInvitations,
	sendInvitationAgain,
	withdrawInvitation,
	type InvitationResult
} from '#lib/domain/invitations.ts';
import { endSessionsAndRemovePasskeys } from '#lib/domain/passkeys.ts';
import { signInMethod } from '#lib/domain/sign-in-method.ts';
import { sendSecurityNotice } from '#lib/domain/security-notices.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const app = appDatabase();
	if (!isAdmin(app, uiActor(locals))) error(403, { message: 'Only an admin can manage users.' });
	const open = openInvitations(app);
	return {
		users: listUsers(app).map((u) => ({ ...u, invitationUntil: open.get(u.id) ?? null })),
		roles: USER_ROLES,
		// Invitations go by email (#90); a one-time password on screen is for instances with passwords.
		canInvite: emailSettings().configured,
		canAdd: signInMethod() === 'password',
		now: new Date()
	};
};

/** What to tell the admin after an invitation went out, or did not. */
function invitationOutcome(action: string, r: InvitationResult) {
	return r.problem
		? {
				action,
				id: r.user.id,
				message: `${r.user.name} is listed as invited, but the email could not be sent: ${r.problem} Send the invitation again when email works.`
			}
		: {
				action,
				id: r.user.id,
				success: `Invitation sent to ${r.user.email}. The link works once, for ${INVITATION_DAYS} days.`
			};
}

function role(value: FormDataEntryValue | null): UserRole {
	return (USER_ROLES as readonly string[]).includes(String(value)) ? (value as UserRole) : 'auditor';
}

export const actions: Actions = {
	/** Invite a person by email (#90): they join by the link, with a passkey or a password of their own. */
	invite: async ({ request, locals, url }) => {
		const data = await request.formData();
		const values = formValues(data, ['name', 'email', 'role']);
		try {
			return invitationOutcome(
				'invite',
				await inviteUser(
					appDatabase(),
					uiActor(locals),
					{ name: values.name ?? '', email: values.email ?? '', role: role(data.get('role')) },
					{ origin: url.origin }
				)
			);
		} catch (e) {
			return formFailure(e, { ...values, action: 'invite' });
		}
	},
	resend: async ({ request, locals, url }) => {
		const id = String((await request.formData()).get('id'));
		try {
			return invitationOutcome(
				'resend',
				await sendInvitationAgain(appDatabase(), uiActor(locals), id, { origin: url.origin })
			);
		} catch (e) {
			return formFailure(e, { id, action: 'resend' });
		}
	},
	withdraw: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id'));
		try {
			const user = withdrawInvitation(appDatabase(), uiActor(locals), id);
			return {
				action: 'withdraw',
				id,
				success: `Invitation withdrawn. The link sent to ${user.email} no longer works.`
			};
		} catch (e) {
			return formFailure(e, { id, action: 'withdraw' });
		}
	},
	create: async ({ request, locals }) => {
		const data = await request.formData();
		const values = formValues(data, ['name', 'email', 'role']);
		try {
			const { user, temporaryPassword } = await createUser(appDatabase(), uiActor(locals), {
				name: values.name ?? '',
				email: values.email ?? '',
				role: role(data.get('role'))
			});
			return { action: 'create', oneTime: { email: user.email, password: temporaryPassword, created: true } };
		} catch (e) {
			return formFailure(e, { ...values, action: 'create' });
		}
	},
	update: async ({ request, locals }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		const values = formValues(data, ['name', 'email', 'role']);
		try {
			updateUser(appDatabase(), uiActor(locals), id, Number(data.get('base_version')), {
				name: values.name,
				email: values.email,
				role: role(data.get('role'))
			});
			return { action: 'update', id, success: 'User saved.' };
		} catch (e) {
			return formFailure(e, { ...values, id, action: 'update' });
		}
	},
	active: async ({ request, locals }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		try {
			const active = data.get('active') === 'true';
			setUserActive(appDatabase(), uiActor(locals), id, Number(data.get('base_version')), active);
			return {
				action: 'active',
				id,
				success: active ? 'User reactivated.' : 'User deactivated. Their sessions and tokens were ended.'
			};
		} catch (e) {
			return formFailure(e, { id, action: 'active' });
		}
	},
	/** A lost device: end the person's sessions and remove their passkeys (#88). */
	shutOut: async ({ request, locals, url }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		try {
			const app = appDatabase();
			const removed = endSessionsAndRemovePasskeys(app, uiActor(locals), id);
			void sendSecurityNotice(app, id, 'shut_out_by_admin', { origin: url.origin });
			return {
				action: 'shutOut',
				id,
				success: `Sessions ended and ${removed} ${removed === 1 ? 'passkey' : 'passkeys'} removed. They sign in again with ${signInMethod() === 'password' ? 'a code by email or their password' : 'a code by email'}.`
			};
		} catch (e) {
			return formFailure(e, { id, action: 'shutOut' });
		}
	},
	reset: async ({ request, locals }) => {
		const data = await request.formData();
		const id = String(data.get('id'));
		try {
			const { temporaryPassword } = await resetPassword(appDatabase(), uiActor(locals), id);
			return {
				action: 'reset',
				id,
				oneTime: { email: String(data.get('email')), password: temporaryPassword, created: false }
			};
		} catch (e) {
			return formFailure(e, { id, action: 'reset' });
		}
	}
};
