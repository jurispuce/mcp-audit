import { fail, redirect } from '@sveltejs/kit';
import { login, SESSION_COOKIE } from '#lib/domain/auth.ts';
import { UnauthenticatedError } from '#lib/domain/errors.ts';
import { needsSetup } from '#lib/domain/setup.ts';
import { appDatabase } from '#lib/server/db.ts';
import { safeNext, sessionCookieOptions } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (needsSetup(appDatabase())) redirect(303, '/setup');
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const data = await event.request.formData();
		const email = String(data.get('email') ?? '');
		try {
			const { token, expiresAt, user } = await login(
				appDatabase(),
				email,
				String(data.get('password') ?? '')
			);
			event.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(event, expiresAt));
			redirect(
				303,
				user.mustChangePassword ? '/settings?password=required' : safeNext(event.url.searchParams.get('next'))
			);
		} catch (e) {
			if (e instanceof UnauthenticatedError) return fail(400, { message: e.message, email });
			throw e;
		}
	}
};
