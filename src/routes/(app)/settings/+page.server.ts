import { redirect } from '@sveltejs/kit';
import { changeOwnPassword } from '#lib/domain/account.ts';
import { ValidationError } from '#lib/domain/errors.ts';
import { getUser, updateUser } from '#lib/domain/users.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, requireUser, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const me = requireUser(locals);
	return {
		me: getUser(appDatabase(), me.id),
		mustChangePassword: me.mustChangePassword || url.searchParams.get('password') === 'required'
	};
};

export const actions: Actions = {
	profile: async ({ request, locals }) => {
		const data = await request.formData();
		const values = formValues(data, ['name', 'email']);
		try {
			const actor = uiActor(locals);
			updateUser(appDatabase(), actor, actor.userId, Number(data.get('base_version')), values);
			return { success: 'Your details were saved.' };
		} catch (e) {
			return formFailure(e, values);
		}
	},
	password: async ({ request, locals }) => {
		const data = await request.formData();
		const me = requireUser(locals);
		try {
			if (data.get('password') !== data.get('confirm')) {
				throw new ValidationError('The new passwords do not match.', { confirm: 'Does not match' });
			}
			await changeOwnPassword(
				appDatabase(),
				me.id,
				String(data.get('current') ?? ''),
				String(data.get('password') ?? ''),
				locals.sessionId ?? undefined
			);
		} catch (e) {
			return formFailure(e);
		}
		if (me.mustChangePassword) redirect(303, '/');
		return { success: 'Your password was changed. Other sessions were signed out.' };
	}
};
