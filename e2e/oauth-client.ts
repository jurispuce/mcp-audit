import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Page } from '@playwright/test';

/**
 * A remote MCP client for tests, built on the MCP SDK's own OAuth client, the way claude.ai custom
 * connectors work: it registers itself, is sent to the consent screen, and keeps what it is given.
 */
export const CALLBACK = 'http://127.0.0.1:43117/callback';

export class TestProvider implements OAuthClientProvider {
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
export async function callbackOf(page: Page, click: () => Promise<void>): Promise<URL> {
	const request = page.waitForRequest((r) => r.url().startsWith(CALLBACK));
	await click();
	const url = new URL((await request).url());
	// The browser then fails to load it (nothing listens); let that settle before the next navigation.
	await page.waitForURL((u) => u.protocol === 'chrome-error:' || u.href.startsWith(CALLBACK));
	return url;
}
