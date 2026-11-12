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
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const app = appDatabase();
	if (!isAdmin(app, uiActor(locals))) error(403, { message: 'Only an admin can manage users.' });
	return { users: listUsers(app), roles: USER_ROLES };
};

function role(value: FormDataEntryValue | null): UserRole {
	return (USER_ROLES as readonly string[]).includes(String(value)) ? (value as UserRole) : 'auditor';
}

export const actions: Actions = {
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
