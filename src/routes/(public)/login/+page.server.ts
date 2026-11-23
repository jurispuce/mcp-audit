import { fail, redirect } from '@sveltejs/kit';
import { login, SESSION_COOKIE } from '#lib/domain/auth.ts';
import { DomainError, TooManyAttemptsError } from '#lib/domain/errors.ts';
import { emailSettings } from '#lib/domain/email.ts';
import { passkeysPossible } from '#lib/domain/passkeys.ts';
import { needsSetup } from '#lib/domain/setup.ts';
import { passwordsAllowed } from '#lib/domain/sign-in-method.ts';
import { appDatabase } from '#lib/server/db.ts';
import { safeNext, sessionCookieOptions } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (needsSetup(appDatabase())) redirect(303, '/setup');
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
	// Offered only where the address can have passkeys: https with a host name, or localhost.
	return {
		// An instance that signs in with passkeys (#89) shows no password form.
		passwords: passwordsAllowed(),
		passkeys: passkeysPossible(url.origin),
		codes: emailSettings().configured
	};
};

export const actions: Actions = {
	default: async (event) => {
		const data = await event.request.formData();
		const email = String(data.get('email') ?? '');
		try {
			const { token, expiresAt, user } = await login(
				appDatabase(),
				email,
				String(data.get('password') ?? ''),
				new Date(),
				event.getClientAddress()
			);
			event.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(event, expiresAt));
			redirect(
				303,
				user.mustChangePassword ? '/settings?password=required' : safeNext(event.url.searchParams.get('next'))
			);
		} catch (e) {
			if (e instanceof TooManyAttemptsError) {
				event.setHeaders({ 'retry-after': String(e.retryAfterSeconds) });
				return fail(429, { message: e.message, email });
			}
			// Wrong email or password, or an instance without passwords.
			if (e instanceof DomainError)
				return fail(e.status === 401 ? 400 : e.status, { message: e.message, email });
			throw e;
		}
	}
};
