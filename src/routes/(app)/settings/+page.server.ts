import { redirect } from '@sveltejs/kit';
import { changeOwnPassword } from '#lib/domain/account.ts';
import { hasPassword } from '#lib/domain/auth.ts';
import { ValidationError } from '#lib/domain/errors.ts';
import { listPasskeys, passkeysPossible, removePasskey, renamePasskey } from '#lib/domain/passkeys.ts';
import { sendSecurityNotice } from '#lib/domain/security-notices.ts';
import { passwordsAllowed } from '#lib/domain/sign-in-method.ts';
import { getUser, updateUser } from '#lib/domain/users.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, requireUser, uiActor } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const me = requireUser(locals);
	return {
		me: getUser(appDatabase(), me.id),
		passkeys: listPasskeys(appDatabase(), me.id),
		passkeysPossible: passkeysPossible(url.origin),
		// An instance that signs in with passkeys (#89) has no Password section at all.
		passwords: passwordsAllowed(),
		hasPassword: hasPassword(appDatabase(), me.id),
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
	renamePasskey: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			const p = renamePasskey(
				appDatabase(),
				requireUser(locals).id,
				String(data.get('id')),
				data.get('name')
			);
			return { success: `Passkey renamed to “${p.name}”.` };
		} catch (e) {
			return formFailure(e);
		}
	},
	removePasskey: async ({ request, locals, url }) => {
		const data = await request.formData();
		try {
			const me = requireUser(locals);
			const name = removePasskey(appDatabase(), me.id, String(data.get('id')));
			void sendSecurityNotice(appDatabase(), me.id, 'passkey_removed', { origin: url.origin, detail: name });
			return { success: 'Passkey removed. It can no longer sign in here.' };
		} catch (e) {
			return formFailure(e);
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
		return { success: 'Your password was saved. Other sessions were signed out.' };
	}
};
