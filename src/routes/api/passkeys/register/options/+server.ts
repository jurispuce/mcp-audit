import { json } from '@sveltejs/kit';
import { relyingParty, startPasskeyRegistration } from '#lib/domain/passkeys.ts';
import { appDatabase } from '#lib/server/db.ts';
import { requireUser } from '#lib/server/http.ts';
import {
	domainFailure,
	fromThisSite,
	refuseOtherSite,
	setChallengeCookie
} from '#lib/server/passkeys-http.ts';
import type { RequestHandler } from './$types';

/** What the browser needs to make a passkey for the signed-in person (#87). */
export const POST: RequestHandler = async (event) => {
	if (!fromThisSite(event)) return refuseOtherSite();
	const user = requireUser(event.locals);
	try {
		const start = await startPasskeyRegistration(appDatabase(), user.id, relyingParty(event.url.origin));
		setChallengeCookie(event, start.token, start.expiresAt);
		return json(start.options);
	} catch (e) {
		return domainFailure(event, e);
	}
};
