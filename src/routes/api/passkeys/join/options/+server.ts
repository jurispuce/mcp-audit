import { json } from '@sveltejs/kit';
import { startJoinWithPasskey } from '#lib/domain/invitations.ts';
import { relyingParty } from '#lib/domain/passkeys.ts';
import { appDatabase } from '#lib/server/db.ts';
import { body } from '#lib/server/json.ts';
import {
	domainFailure,
	fromThisSite,
	refuseOtherSite,
	setChallengeCookie
} from '#lib/server/passkeys-http.ts';
import type { RequestHandler } from './$types';

/** What the browser needs to make a passkey for the person an invitation link belongs to (#90). */
export const POST: RequestHandler = async (event) => {
	if (!fromThisSite(event)) return refuseOtherSite();
	const data = await body<{ token: string }>(event);
	try {
		const start = await startJoinWithPasskey(appDatabase(), data.token, relyingParty(event.url.origin));
		setChallengeCookie(event, start.token, start.expiresAt);
		return json(start.options);
	} catch (e) {
		return domainFailure(event, e);
	}
};
