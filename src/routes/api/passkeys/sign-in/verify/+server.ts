import { json } from '@sveltejs/kit';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { SESSION_COOKIE } from '#lib/domain/auth.ts';
import { finishPasskeySignIn, relyingParty } from '#lib/domain/passkeys.ts';
import { appDatabase } from '#lib/server/db.ts';
import { safeNext, sessionCookieOptions } from '#lib/server/http.ts';
import { body } from '#lib/server/json.ts';
import {
	domainFailure,
	fromThisSite,
	refuseOtherSite,
	takeChallengeCookie
} from '#lib/server/passkeys-http.ts';
import type { RequestHandler } from './$types';

/** Check the device's answer; on success the person is signed in (#87). */
export const POST: RequestHandler = async (event) => {
	if (!fromThisSite(event)) return refuseOtherSite();
	const data = await body<{ response: AuthenticationResponseJSON; next: string }>(event);
	try {
		const { token, expiresAt, user } = await finishPasskeySignIn(
			appDatabase(),
			takeChallengeCookie(event),
			data.response as AuthenticationResponseJSON,
			relyingParty(event.url.origin),
			new Date(),
			event.getClientAddress()
		);
		event.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(event, expiresAt));
		return json({
			redirect: user.mustChangePassword ? '/settings?password=required' : safeNext(data.next ?? null)
		});
	} catch (e) {
		return domainFailure(event, e);
	}
};
