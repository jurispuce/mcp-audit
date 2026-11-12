import { clientCredentials, OAuthError, revokeToken } from '#lib/domain/oauth.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formBody, oauthErrorResponse, oauthJson, preflight } from '#lib/server/oauth-http.ts';
import type { RequestHandler } from './$types';

/** RFC 7009 token revocation: ends the whole grant. Unknown tokens still answer 200. */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const form = await formBody(request);
		revokeToken(appDatabase(), clientCredentials(request, form), form.get('token'));
		return oauthJson({});
	} catch (e) {
		if (e instanceof OAuthError) return oauthErrorResponse(e);
		throw e;
	}
};
export const OPTIONS: RequestHandler = preflight;
