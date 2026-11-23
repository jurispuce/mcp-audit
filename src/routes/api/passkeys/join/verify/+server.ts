import { json } from '@sveltejs/kit';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { SESSION_COOKIE } from '#lib/domain/auth.ts';
import { finishJoinWithPasskey } from '#lib/domain/invitations.ts';
import { relyingParty } from '#lib/domain/passkeys.ts';
import { sendSecurityNotice } from '#lib/domain/security-notices.ts';
import { appDatabase } from '#lib/server/db.ts';
import { sessionCookieOptions } from '#lib/server/http.ts';
import { body } from '#lib/server/json.ts';
import {
	domainFailure,
	fromThisSite,
	refuseOtherSite,
	takeChallengeCookie
} from '#lib/server/passkeys-http.ts';
import type { RequestHandler } from './$types';

/** Check the passkey the invited person's browser made, keep it, and sign them in (#90). */
export const POST: RequestHandler = async (event) => {
	if (!fromThisSite(event)) return refuseOtherSite();
	const data = await body<{ token: string; response: RegistrationResponseJSON; name: string }>(event);
	try {
		const app = appDatabase();
		const joined = await finishJoinWithPasskey(
			app,
			data.token,
			takeChallengeCookie(event),
			data.response as RegistrationResponseJSON,
			relyingParty(event.url.origin),
			data.name
		);
		event.cookies.set(SESSION_COOKIE, joined.token, sessionCookieOptions(event, joined.expiresAt));
		// The account is told about every passkey added (#88); a failed email never undoes the join.
		void sendSecurityNotice(app, joined.userId, 'passkey_added', {
			origin: event.url.origin,
			detail: joined.passkeyName
		});
		return json({ redirect: '/' });
	} catch (e) {
		return domainFailure(event, e);
	}
};
