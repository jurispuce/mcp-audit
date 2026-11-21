import { json } from '@sveltejs/kit';
import { relyingParty, startPasskeySignIn } from '#lib/domain/passkeys.ts';
import { appDatabase } from '#lib/server/db.ts';
import {
	domainFailure,
	fromThisSite,
	refuseOtherSite,
	setChallengeCookie
} from '#lib/server/passkeys-http.ts';
import type { RequestHandler } from './$types';

/** What the browser needs to ask the device for a passkey of this instance (#87). Public: nobody is signed in yet. */
export const POST: RequestHandler = async (event) => {
	if (!fromThisSite(event)) return refuseOtherSite();
	try {
		const start = await startPasskeySignIn(appDatabase(), relyingParty(event.url.origin));
		setChallengeCookie(event, start.token, start.expiresAt);
		return json(start.options);
	} catch (e) {
		return domainFailure(event, e);
	}
};
