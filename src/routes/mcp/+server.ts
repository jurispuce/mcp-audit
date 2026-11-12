import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateBearer } from '#lib/domain/auth.ts';
import { TooManyAttemptsError } from '#lib/domain/errors.ts';
import { addressKey, assertNotLocked, POLICIES, recordFailure } from '#lib/domain/throttle.ts';
import { createMcpServer } from '#lib/mcp/server.ts';
import { appDatabase } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/**
 * MCP over Streamable HTTP. Every request carries a personal access token
 * (`Authorization: Bearer mcpa_…`) and is served by a fresh, stateless server for that user.
 */
const handle: RequestHandler = async ({ request, getClientAddress }) => {
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
	const auth = authenticateBearer(app, request);
	if (!auth) {
		// Count wrong tokens, not requests without one (clients probe before they send credentials).
		if (request.headers.has('authorization')) recordFailure(app, throttle, POLICIES.token);
		return new Response(
			JSON.stringify({
				error: 'unauthorized',
				message:
					'Send a personal access token: Authorization: Bearer mcpa_… (create one in Settings, Access tokens).'
			}),
			{
				status: 401,
				headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="mcp-audit"' }
			}
		);
	}
	const server = createMcpServer(app, auth.user);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	await server.connect(transport);
	try {
		return await transport.handleRequest(request, {
			authInfo: { token: 'redacted', clientId: auth.tokenId, scopes: [], extra: { userId: auth.user.id } }
		});
	} finally {
		await server.close();
	}
};

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
