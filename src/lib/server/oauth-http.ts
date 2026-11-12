import { json } from '@sveltejs/kit';
import { OAuthError } from '#lib/domain/oauth.ts';

/**
 * HTTP details shared by the OAuth endpoints. Browser-based MCP clients (for example the MCP
 * Inspector) read the metadata and call these endpoints cross-origin, so they allow any origin;
 * they never use cookies, so that is safe.
 */
export const CORS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, POST, OPTIONS',
	'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
	'access-control-max-age': '86400'
};

export const preflight = () => new Response(null, { status: 204, headers: CORS });

export function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
	return json(body, { status, headers: { ...CORS, 'cache-control': 'no-store', ...extra } });
}

/** An OAuth error response (RFC 6749 5.2). */
export function oauthErrorResponse(e: OAuthError, extra: Record<string, string> = {}): Response {
	return oauthJson({ error: e.error, error_description: e.description }, e.status, extra);
}

/** The form body of a token or revocation request. */
export async function formBody(request: Request): Promise<URLSearchParams> {
	const type = request.headers.get('content-type') ?? '';
	if (!type.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
		throw new OAuthError('invalid_request', 'Send the request as application/x-www-form-urlencoded.');
	}
	return new URLSearchParams(await request.text());
}
