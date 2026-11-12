import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { ADMIN, expect, loginAs, sampleCopy, seed, test, unique } from '../helpers';

/**
 * #75: a remote MCP client signs in with OAuth the way claude.ai custom connectors do, using the MCP
 * SDK's own OAuth client: discovery from the 401, dynamic registration, authorization with PKCE on
 * the consent screen, token exchange, tool calls, refresh, and disconnecting in Settings.
 */
const CALLBACK = 'http://127.0.0.1:43117/callback';

class TestProvider implements OAuthClientProvider {
	info?: OAuthClientInformationMixed;
	saved?: OAuthTokens;
	verifier = '';
	authorizationUrl?: URL;
	constructor(private readonly name: string) {}
	get redirectUrl() {
		return CALLBACK;
	}
	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: this.name,
			redirect_uris: [CALLBACK],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code']
		};
	}
	clientInformation() {
		return this.info;
	}
	saveClientInformation(info: OAuthClientInformationMixed) {
		this.info = info;
	}
	tokens() {
		return this.saved;
	}
	saveTokens(tokens: OAuthTokens) {
		this.saved = tokens;
	}
	redirectToAuthorization(url: URL) {
		this.authorizationUrl = url;
	}
	saveCodeVerifier(v: string) {
		this.verifier = v;
	}
	codeVerifier() {
		return this.verifier;
	}
}

/** Where the browser was sent after the click: nothing listens there, the request itself is enough. */
async function callbackOf(page: import('@playwright/test').Page, click: () => Promise<void>): Promise<URL> {
	const request = page.waitForRequest((r) => r.url().startsWith(CALLBACK));
	await click();
	const url = new URL((await request).url());
	// The browser then fails to load it (nothing listens); let that settle before the next navigation.
	await page.waitForURL((u) => u.protocol === 'chrome-error:' || u.href.startsWith(CALLBACK));
	return url;
}

test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('discovery: /mcp answers 401 pointing at the metadata, which leads to the authorization server (#75)', async ({
	request,
	baseURL
}) => {
	const res = await request.post('/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'ping' } });
	expect(res.status()).toBe(401);
	const origin = new URL(baseURL!).origin;
	expect(res.headers()['www-authenticate']).toBe(
		`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`
	);
	const prm = await (await request.get('/.well-known/oauth-protected-resource/mcp')).json();
	expect(prm).toMatchObject({ resource: `${origin}/mcp`, authorization_servers: [origin] });
	const asm = await (await request.get('/.well-known/oauth-authorization-server')).json();
	expect(asm).toMatchObject({
		issuer: origin,
		registration_endpoint: `${origin}/oauth/register`,
		code_challenge_methods_supported: ['S256']
	});
	// The token endpoint takes form posts from other servers (no Origin header); other forms do not.
	const token = await request.post('/oauth/token', { form: { grant_type: 'authorization_code', code: 'x' } });
	expect(token.status()).toBe(401);
	expect(await token.json()).toMatchObject({ error: 'invalid_client' });
	const login = await request.post('/login', { form: { email: 'x', password: 'y' }, maxRedirects: 0 });
	expect(login.status()).toBe(403);
});

test('the MCP SDK OAuth client registers, is approved, calls tools as "<app> on behalf of <person>", and stops when disconnected (#75)', async ({
	page,
	baseURL
}) => {
	const e = await sampleCopy(page.request);
	const name = unique('Claude connector');
	const provider = new TestProvider(name);
	const serverUrl = new URL('/mcp', baseURL);

	// 1. Discover and register; the client is sent to the consent screen.
	expect(await auth(provider, { serverUrl })).toBe('REDIRECT');
	expect(provider.info?.client_id).toMatch(/^mcpc_/);
	const authUrl = provider.authorizationUrl!;
	expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
	expect(authUrl.searchParams.get('resource')).toBe(serverUrl.href);

	// 2. The person approves in the browser; the callback gets the code.
	await page.goto(authUrl.href);
	const consent = page.getByTestId('oauth-consent');
	await expect(consent).toContainText(`Connect ${name} to mcp-audit?`);
	await expect(consent).toContainText(`versioned as “${name} on behalf of Ada Admin”`);
	const callback = await callbackOf(page, () => page.getByRole('button', { name: 'Allow access' }).click());
	expect(callback.searchParams.get('code')).toBeTruthy();
	expect(callback.searchParams.get('state')).toBe(authUrl.searchParams.get('state'));
	expect(callback.searchParams.get('iss')).toBe(new URL(baseURL!).origin);

	// 3. Exchange the code (PKCE) and call tools with the access token.
	expect(await auth(provider, { serverUrl, authorizationCode: callback.searchParams.get('code')! })).toBe(
		'AUTHORIZED'
	);
	expect(provider.saved?.access_token).toMatch(/^mcpo_/);
	const client = new Client({ name: 'oauth-e2e', version: '1.0.0' });
	await client.connect(new StreamableHTTPClientTransport(serverUrl, { authProvider: provider }));
	const res = (await client.callTool({
		name: 'upsert_people',
		arguments: { engagement_id: e.id, people: [{ role: 'OAuth test role' }] }
	})) as { isError?: boolean; content: { text: string }[] };
	expect(res.isError, res.content[0]?.text).toBeFalsy();

	await page.goto(`/e/${e.id}/proposals?type=role`);
	await expect(page.getByTestId('proposal-role-OAuth test role')).toContainText(`from ${name} through MCP`);

	// 4. The refresh token rotates.
	const before = provider.saved!.refresh_token;
	await provider.saveTokens({ ...provider.saved!, access_token: 'mcpo_expired' });
	expect(await auth(provider, { serverUrl })).toBe('AUTHORIZED');
	expect(provider.saved!.refresh_token).not.toBe(before);
	await client.callTool({ name: 'list_engagements', arguments: {} });

	// 5. Settings lists the app; disconnecting it stops the client.
	await page.goto('/settings/tokens');
	const card = page.getByTestId(`app-${name}`);
	await expect(card).toContainText('Connected');
	page.once('dialog', (d) => d.accept());
	await card.getByRole('button', { name: `Disconnect ${name}` }).click();
	await expect(page.getByRole('status')).toHaveText('App disconnected. It has to be allowed again to work.');
	await expect(client.callTool({ name: 'list_engagements', arguments: {} })).rejects.toThrow();
	await client.close().catch(() => {});
});

test('denying sends access_denied back to the app; an unknown app is refused on the page (#75)', async ({
	page,
	baseURL
}) => {
	const provider = new TestProvider(unique('Denied app'));
	expect(await auth(provider, { serverUrl: new URL('/mcp', baseURL) })).toBe('REDIRECT');
	await page.goto(provider.authorizationUrl!.href);
	const callback = await callbackOf(page, () => page.getByRole('button', { name: 'Deny' }).click());
	expect(callback.searchParams.get('error')).toBe('access_denied');

	await page.goto('/oauth/authorize?client_id=mcpc_unknown&response_type=code');
	await expect(page.getByTestId('oauth-consent')).toContainText('This app is not registered with mcp-audit');
});
