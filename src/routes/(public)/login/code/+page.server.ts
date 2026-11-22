import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { SESSION_COOKIE, type SessionUser } from '#lib/domain/auth.ts';
import { emailSettings } from '#lib/domain/email.ts';
import { DomainError, TooManyAttemptsError } from '#lib/domain/errors.ts';
import { passkeysPossible } from '#lib/domain/passkeys.ts';
import { sendSecurityNotice } from '#lib/domain/security-notices.ts';
import { needsSetup } from '#lib/domain/setup.ts';
import {
	CODE_COOKIE,
	CODE_MINUTES,
	cancelSignInCode,
	finishCodeSignIn,
	pendingSignInCode,
	requestSignInCode
} from '#lib/domain/sign-in-codes.ts';
import { appDatabase } from '#lib/server/db.ts';
import { safeNext, sessionCookieOptions } from '#lib/server/http.ts';
import type { Actions, PageServerLoad } from './$types';

/** Sign-in with a one-time code sent by email (#88). */

const cookiePath = '/login';

function signedIn(
	event: RequestEvent,
	session: { token: string; expiresAt: Date; user: SessionUser; next: string | null }
): never {
	event.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(event, session.expiresAt));
	event.cookies.delete(CODE_COOKIE, { path: cookiePath });
	// The mailbox was just used as a key: tell its owner. Not awaited, and never fails the sign-in.
	void sendSecurityNotice(appDatabase(), session.user.id, 'code_sign_in', { origin: event.url.origin });
	const next = safeNext(session.next);
	if (session.user.mustChangePassword) redirect(303, '/settings?password=required');
	// Signed in without a passkey on this device: offer to add one, every time.
	redirect(303, passkeysPossible(event.url.origin) ? `/add-passkey?next=${encodeURIComponent(next)}` : next);
}

function failure(event: RequestEvent, e: unknown, values: Record<string, string> = {}) {
	if (e instanceof TooManyAttemptsError) {
		event.setHeaders({ 'retry-after': String(e.retryAfterSeconds) });
		return fail(429, { message: e.message, ...values });
	}
	if (e instanceof DomainError)
		return fail(e.status === 401 ? 400 : e.status, { message: e.message, ...values });
	throw e;
}

export const load: PageServerLoad = (event) => {
	const { locals, url, cookies } = event;
	const app = appDatabase();
	if (needsSetup(app)) redirect(303, '/setup');
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
	if (!emailSettings().configured) redirect(303, '/login');
	const token = cookies.get(CODE_COOKIE);
	const linkToken = url.searchParams.get('t');
	let linkProblem: string | null = null;
	if (linkToken) {
		if (!token) {
			// The link was opened somewhere else than where the code was asked for (a mail app, another device).
			return { step: 'other-browser' as const, email: null, minutes: CODE_MINUTES, linkProblem: null };
		}
		try {
			signedIn(event, finishCodeSignIn(app, token, { linkToken }, { address: event.getClientAddress() }));
		} catch (e) {
			if (!(e instanceof DomainError)) throw e;
			linkProblem = e.message;
		}
	}
	const pending = pendingSignInCode(app, token);
	return {
		step: pending ? ('code' as const) : ('email' as const),
		email: pending?.email ?? null,
		minutes: CODE_MINUTES,
		linkProblem,
		// Where to go after signing in, for example back to the window an assistant opened (#93).
		next: safeNext(url.searchParams.get('next') ?? pending?.next, '')
	};
};

export const actions: Actions = {
	/** Ask for a code. The answer is the same whether or not the address has an account. */
	request: async (event) => {
		const data = await event.request.formData();
		const email = String(data.get('email') ?? '');
		try {
			const r = requestSignInCode(appDatabase(), email, {
				origin: event.url.origin,
				address: event.getClientAddress(),
				next: safeNext(String(data.get('next') ?? ''), '') || null
			});
			// Not awaited: sending takes time only for a real account, and the wait would give it away.
			void r.sent;
			event.cookies.set(CODE_COOKIE, r.token, {
				path: cookiePath,
				httpOnly: true,
				// Lax, so the cookie comes along when the link in the email is opened in this browser.
				sameSite: 'lax',
				secure: event.url.protocol === 'https:',
				expires: r.expiresAt
			});
		} catch (e) {
			return failure(event, e, { email });
		}
		redirect(303, '/login/code');
	},
	verify: async (event) => {
		const data = await event.request.formData();
		try {
			signedIn(
				event,
				finishCodeSignIn(
					appDatabase(),
					event.cookies.get(CODE_COOKIE),
					{ code: String(data.get('code') ?? '') },
					{ address: event.getClientAddress() }
				)
			);
		} catch (e) {
			return failure(event, e);
		}
	},
	/** Start over with another address. */
	cancel: async (event) => {
		cancelSignInCode(appDatabase(), event.cookies.get(CODE_COOKIE));
		event.cookies.delete(CODE_COOKIE, { path: cookiePath });
		redirect(303, '/login/code');
	}
};
