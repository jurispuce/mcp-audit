import { TooManyAttemptsError } from '#lib/domain/errors.ts';
import { clientCredentials, exchangeCode, OAuthError, refreshTokens } from '#lib/domain/oauth.ts';
import { addressKey, assertNotLocked, POLICIES, recordFailure } from '#lib/domain/throttle.ts';
import { appDatabase } from '#lib/server/db.ts';
import { formBody, oauthErrorResponse, oauthJson, preflight } from '#lib/server/oauth-http.ts';
import type { RequestHandler } from './$types';

/** The token endpoint: authorization_code (with PKCE) and refresh_token grants. */
export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	const app = appDatabase();
	const key = addressKey('oauth', getClientAddress());
	let basic = false;
	try {
		assertNotLocked(app, [key]);
		const form = await formBody(request);
		const creds = clientCredentials(request, form);
		basic = creds.via === 'basic';
		const grant = form.get('grant_type');
		if (grant === 'authorization_code') return oauthJson(exchangeCode(app, creds, form, url.origin));
		if (grant === 'refresh_token') return oauthJson(refreshTokens(app, creds, form, url.origin));
		throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
	} catch (e) {
		if (e instanceof TooManyAttemptsError) {
			return oauthJson({ error: 'slow_down', error_description: e.message }, 429, {
				'retry-after': String(e.retryAfterSeconds)
			});
		}
		if (e instanceof OAuthError) {
			recordFailure(app, key, POLICIES.oauth);
			return oauthErrorResponse(
				e,
				e.status === 401 && basic ? { 'www-authenticate': 'Basic realm="mcp-audit"' } : {}
			);
		}
		throw e;
	}
};
export const OPTIONS: RequestHandler = preflight;
