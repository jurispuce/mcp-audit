import { OAuthError, registerClient } from '#lib/domain/oauth.ts';
import { TooManyAttemptsError } from '#lib/domain/errors.ts';
import { addressKey, assertNotLocked, POLICIES, recordFailure } from '#lib/domain/throttle.ts';
import { appDatabase } from '#lib/server/db.ts';
import { oauthErrorResponse, oauthJson, preflight } from '#lib/server/oauth-http.ts';
import type { RequestHandler } from './$types';

/** RFC 7591 dynamic client registration. Open, as the MCP authorization spec expects, but rate limited. */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const app = appDatabase();
	const key = addressKey('register', getClientAddress());
	try {
		assertNotLocked(app, [key]);
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			throw new OAuthError('invalid_client_metadata', 'Send the client metadata as JSON.');
		}
		recordFailure(app, key, POLICIES.register);
		return oauthJson(registerClient(app, body), 201);
	} catch (e) {
		if (e instanceof TooManyAttemptsError) {
			return oauthJson({ error: 'slow_down', error_description: e.message }, 429, {
				'retry-after': String(e.retryAfterSeconds)
			});
		}
		if (e instanceof OAuthError) return oauthErrorResponse(e);
		throw e;
	}
};
export const OPTIONS: RequestHandler = preflight;
