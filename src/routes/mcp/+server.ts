import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { mcpActor, resolvePersonalToken } from '#lib/domain/auth.ts';
import { TooManyAttemptsError } from '#lib/domain/errors.ts';
import { endpoints, resolveAccessToken } from '#lib/domain/oauth.ts';
import { addressKey, assertNotLocked, POLICIES, recordFailure } from '#lib/domain/throttle.ts';
import { AGENT_NAME, createMcpServer } from '#lib/mcp/server.ts';
import { appDatabase } from '#lib/server/db.ts';
import { CORS } from '#lib/server/oauth-http.ts';
import type { RequestHandler } from './$types';

/**
 * MCP over Streamable HTTP, served by a fresh, stateless server per request. Two kinds of bearer
 * token work: a personal access token (`mcpa_…`, made in Settings, Access tokens, for Claude Code
 * and the Desktop bridge) or an OAuth access token (`mcpo_…`, for custom connectors, #75). Writes are
 * made by the person as user and the client as agent: "Claude on behalf of <person>".
 */
const handle: RequestHandler = async ({ request, url, getClientAddress }) => {
	const app = appDatabase();
	const throttle = addressKey('token', getClientAddress());
	try {
		assertNotLocked(app, [throttle]);
	} catch (e) {
		if (!(e instanceof TooManyAttemptsError)) throw e;
		return new Response(JSON.stringify({ error: 'too_many_attempts', message: e.message }), {
			status: 429,
			headers: { 'content-type': 'application/json', 'retry-after': String(e.retryAfterSeconds) }
		});
	}

	const token = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
	const personal = resolvePersonalToken(app, token);
	const oauth = personal ? null : resolveAccessToken(app, token, url.origin);
	if (!personal && !oauth) {
		// Count wrong tokens, not requests without one (clients probe before they send credentials).
		if (request.headers.has('authorization')) recordFailure(app, throttle, POLICIES.token);
		// RFC 9728: point the client at the metadata that says how to get a token.
		const challenge = `Bearer resource_metadata="${endpoints(url.origin).resourceMetadata}"${token ? ', error="invalid_token"' : ''}`;
		return new Response(
			JSON.stringify({
				error: token ? 'invalid_token' : 'unauthorized',
				message:
					'Sign in: add mcp-audit as a connector (OAuth), or send a personal access token, Authorization: Bearer mcpa_… (Settings, Access tokens).'
			}),
			{
				status: 401,
				headers: { ...CORS, 'content-type': 'application/json', 'www-authenticate': challenge }
			}
		);
	}

	const user = (personal ?? oauth)!.user;
	const actor = oauth ? mcpActor(user, oauth.clientName) : mcpActor(user, AGENT_NAME);
	const server = createMcpServer(app, user, actor);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	await server.connect(transport);
	try {
		const response = await transport.handleRequest(request, {
			authInfo: {
				token: 'redacted',
				clientId: personal ? personal.tokenId : oauth!.grantId,
				scopes: [],
				extra: { userId: user.id }
			}
		});
		// Browser-based MCP clients need to read the response and the session headers.
		response.headers.set('access-control-allow-origin', '*');
		response.headers.set('access-control-expose-headers', 'mcp-session-id, www-authenticate');
		return response;
	} finally {
		await server.close();
	}
};

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS });
