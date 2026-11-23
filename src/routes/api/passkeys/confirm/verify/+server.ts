import { json } from '@sveltejs/kit';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { finishPasskeyConfirm, relyingParty } from '#lib/domain/passkeys.ts';
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

/** Check the passkey asked for again; on success this session counts as freshly proven (#93). */
export const POST: RequestHandler = async (event) => {
	if (!fromThisSite(event)) return refuseOtherSite();
	const user = requireUser(event.locals);
	const data = await body<{ response: AuthenticationResponseJSON }>(event);
	try {
		await finishPasskeyConfirm(
			appDatabase(),
			user.id,
			event.locals.sessionId ?? '',
			takeChallengeCookie(event),
			data.response as AuthenticationResponseJSON,
			relyingParty(event.url.origin)
		);
		return json({ ok: true });
	} catch (e) {
		return domainFailure(event, e);
	}
};
