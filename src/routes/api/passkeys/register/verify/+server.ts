import { json } from '@sveltejs/kit';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { finishPasskeyRegistration, relyingParty } from '#lib/domain/passkeys.ts';
import { appDatabase } from '#lib/server/db.ts';
import { requireUser } from '#lib/server/http.ts';
import { body } from '#lib/server/json.ts';
import {
	domainFailure,
	fromThisSite,
	refuseOtherSite,
	takeChallengeCookie
} from '#lib/server/passkeys-http.ts';
import type { RequestHandler } from './$types';

/** Check the new passkey the browser made and keep its public key (#87). */
export const POST: RequestHandler = async (event) => {
	if (!fromThisSite(event)) return refuseOtherSite();
	const user = requireUser(event.locals);
	const data = await body<{ response: RegistrationResponseJSON; name: string }>(event);
	try {
		const passkey = await finishPasskeyRegistration(
			appDatabase(),
			user.id,
			takeChallengeCookie(event),
			data.response as RegistrationResponseJSON,
			relyingParty(event.url.origin),
			data.name
		);
		return json({ id: passkey.id, name: passkey.name });
	} catch (e) {
		return domainFailure(event, e);
	}
};
