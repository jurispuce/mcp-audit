import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { OTHER_INSTANCE, expect, joined, seed, test, unique } from '../helpers';
import { createToken } from '../mcp-helpers';
import { TestProvider, callbackOf } from '../oauth-client';
import { OPERATOR_TOKEN, OTHER_OPERATOR_TOKEN } from '../tenant-profile.mjs';

/**
 * #99: two instances stand for two tenants. Everything a person holds at one of them (a session, an
 * access token, an assistant's connection, a passkey) and the operator's own token of that instance
 * is tried at the other, and each is first shown to work where it was made, so a refusal means
 * something.
 *
 * Here "A" is the instance without passwords and "B" the one set up from a tenant profile. Both are
 * reached as localhost, so the browser would even offer A's passkey at B: B itself must refuse it.
 */
test.beforeEach(async ({ request }) => {
	await seed(request);
});

const MCP_CALL = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const MCP_HEADERS = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };

test('what a person holds at one tenant opens nothing at another', async ({
	page,
	browser,
	baseURL,
	playwright
}) => {
	test.skip(!OTHER_INSTANCE, 'needs a second instance');
	const A = new URL(baseURL!).origin;
	const B = new URL(OTHER_INSTANCE!).origin;
	const person = await joined(browser, page, 'Ida Isolation', 'passkey');
	// Requests of our own making: no browser, no cookie jar.
	const bare = await playwright.request.newContext();

	// ---- Each instance names itself, and only itself
	for (const origin of [A, B]) {
		const meta = await (await bare.get(`${origin}/.well-known/oauth-authorization-server`)).json();
		expect(meta.issuer).toBe(origin);
		expect(meta.token_endpoint).toBe(`${origin}/oauth/token`);
		const resource = await (await bare.get(`${origin}/.well-known/oauth-protected-resource`)).json();
		expect(resource.resource).toBe(`${origin}/mcp`);
		expect(resource.authorization_servers).toEqual([origin]);
	}

	// ---- The session cookie
	const cookie = (await person.context.cookies()).find((c) => c.name === 'mcpa_session')!;
	// Bound to the host it was set for: no Domain attribute, so never sent to a sibling name.
	expect(cookie.domain).toBe(new URL(A).hostname);
	expect(cookie.httpOnly).toBe(true);
	expect(cookie.sameSite).toBe('Lax');
	const withCookie = { cookie: `mcpa_session=${cookie.value}` };
	expect((await bare.get(`${A}/settings`, { headers: withCookie, maxRedirects: 0 })).status()).toBe(200);
	const atB = await bare.get(`${B}/settings`, { headers: withCookie, maxRedirects: 0 });
	expect(atB.status()).toBe(303);
	expect(atB.headers().location).toContain('/login');
	expect((await bare.get(`${B}/api/items/user/x`, { headers: withCookie })).status()).toBe(401);

	// ---- A personal access token
	const token = await createToken(person.page, unique('isolation'));
	const bearer = (t: string) => ({ ...MCP_HEADERS, authorization: `Bearer ${t}` });
	expect((await bare.post(`${A}/mcp`, { headers: bearer(token), data: MCP_CALL })).status()).toBe(200);
	expect((await bare.post(`${B}/mcp`, { headers: bearer(token), data: MCP_CALL })).status()).toBe(401);

	// ---- An assistant's connection (OAuth)
	const provider = new TestProvider(unique('Isolation connector'));
	const serverUrl = new URL('/mcp', A);
	expect(await auth(provider, { serverUrl })).toBe('REDIRECT');
	await person.page.goto(provider.authorizationUrl!.href);
	const callback = await callbackOf(person.page, () =>
		person.page.getByRole('button', { name: 'Allow access' }).click()
	);
	expect(await auth(provider, { serverUrl, authorizationCode: callback.searchParams.get('code')! })).toBe(
		'AUTHORIZED'
	);
	const tokens = provider.saved!;
	expect(
		(await bare.post(`${A}/mcp`, { headers: bearer(tokens.access_token), data: MCP_CALL })).status()
	).toBe(200);
	expect(
		(await bare.post(`${B}/mcp`, { headers: bearer(tokens.access_token), data: MCP_CALL })).status()
	).toBe(401);
	// B does not know the client, so it will not renew the connection either.
	const renew = await bare.post(`${B}/oauth/token`, {
		form: {
			grant_type: 'refresh_token',
			refresh_token: tokens.refresh_token!,
			client_id: String(provider.info!.client_id)
		}
	});
	expect(renew.ok()).toBe(false);
	expect(JSON.stringify(await renew.json())).not.toContain('access_token');

	// ---- The operator's token of each instance
	const numbers = (origin: string, t: string) =>
		bare.get(`${origin}/api/operator/status`, { headers: { authorization: `Bearer ${t}` } });
	expect((await numbers(A, OTHER_OPERATOR_TOKEN)).status()).toBe(200);
	expect((await numbers(B, OPERATOR_TOKEN)).status()).toBe(200);
	expect((await numbers(B, OTHER_OPERATOR_TOKEN)).status()).toBe(401);
	expect((await numbers(A, OPERATOR_TOKEN)).status()).toBe(401);
	// And none of a person's credentials is the operator's.
	expect((await numbers(A, token)).status()).toBe(401);
	expect((await numbers(A, tokens.access_token)).status()).toBe(401);

	// ---- The passkey: made for A, offered by this browser at B, refused by B
	await person.page.goto(`${B}/login`);
	await person.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(person.page.getByText('That passkey could not be used to sign in here.')).toBeVisible();
	await expect(person.page).toHaveURL(`${B}/login`);
	// Still nobody at B.
	expect((await person.page.request.get(`${B}/api/items/user/x`)).status()).toBe(401);

	await bare.dispose();
	await person.context.close();
});
