import { redirect } from '@sveltejs/kit';
import { addressKey, assertNotLocked, POLICIES, recordFailure } from '#lib/domain/throttle.ts';
import { createSession, SESSION_COOKIE } from '#lib/domain/auth.ts';
import { ForbiddenError, ValidationError } from '#lib/domain/errors.ts';
import { completeSetup, needsSetup } from '#lib/domain/setup.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formFailure, formValues, sessionCookieOptions } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	if (!needsSetup(appDatabase())) redirect(303, '/login');
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const data = await event.request.formData();
		const values = formValues(data, ['code', 'name', 'email']);
		const app = appDatabase();
		const throttle = addressKey('setup', event.getClientAddress());
		let userId: string;
		try {
			assertNotLocked(app, [throttle]);
			if (data.get('password') !== data.get('confirm')) {
				return formFailure(
					new ValidationError('The passwords do not match.', {
						confirm: 'Does not match'
					}),
					values
				);
			}
			const user = await completeSetup(app, {
				code: values.code ?? '',
				name: values.name ?? '',
				email: values.email ?? '',
				password: String(data.get('password') ?? '')
			});
			userId = user.id;
		} catch (e) {
			// A wrong set-up code counts towards the lock; the code is the only secret on this page.
			if (e instanceof ForbiddenError) recordFailure(app, throttle, POLICIES.setup);
			return formFailure(e, values);
		}
		const { token, expiresAt } = createSession(app, userId);
		event.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(event, expiresAt));
		redirect(303, '/');
	}
};
