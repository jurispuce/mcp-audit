import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ADMIN, expect, joined, loginAs, postForm, seed, test, unique, waitForMail } from '../helpers';
import { TestProvider, callbackOf } from '../oauth-client';

/**
 * #93 on an instance without passwords: an assistant connects through OAuth and the window it opens
 * signs the person in with a passkey or a code by email; an access token needs a fresh proof.
 */
test.beforeEach(async ({ request }) => {
	await seed(request);
});

test('an assistant connects through OAuth; the window signs the person in with a passkey', async ({
	page,
	browser,
	baseURL
}) => {
	const person = await joined(browser, page, 'Petra Passkey', 'passkey');
	// The assistant opens its window in a browser where nobody is signed in to this instance.
	await person.context.clearCookies();
	const name = unique('Claude connector');
	const provider = new TestProvider(name);
	const serverUrl = new URL('/mcp', baseURL);
	expect(await auth(provider, { serverUrl })).toBe('REDIRECT');

	const opened = await person.page.goto(provider.authorizationUrl!.href);
	await expect(person.page).toHaveURL(/\/login\?next=%2Foauth%2Fauthorize/);
	// Never inside a frame: the passkey prompt would not work there, and the page could be overlaid.
	expect(opened!.headers()['x-frame-options']).toBe('DENY');
	expect(opened!.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
	await expect(person.page.locator('input[type=password]')).toHaveCount(0);

	await person.page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	const consent = person.page.getByTestId('oauth-consent');
	await expect(consent).toContainText(`Connect ${name} to mcp-audit?`);
	await expect(consent).toContainText(`versioned as “${name} on behalf of Petra Passkey”`);
	const callback = await callbackOf(person.page, () =>
		person.page.getByRole('button', { name: 'Allow access' }).click()
	);
	// The answer names this instance as its issuer.
	expect(callback.searchParams.get('iss')).toBe(new URL(baseURL!).origin);
	expect(await auth(provider, { serverUrl, authorizationCode: callback.searchParams.get('code')! })).toBe(
		'AUTHORIZED'
	);

	const client = new Client({ name: 'oauth-passkey-e2e', version: '1.0.0' });
	await client.connect(new StreamableHTTPClientTransport(serverUrl, { authProvider: provider }));
	const res = (await client.callTool({ name: 'list_engagements', arguments: {} })) as { isError?: boolean };
	expect(res.isError).toBeFalsy();
	await client.close().catch(() => {});
	await person.context.close();
});

test('the same window with a code by email, on a device without a passkey', async ({
	page,
	browser,
	baseURL
}) => {
	const person = await joined(browser, page, 'Cora Code', 'without');
	await person.context.clearCookies();
	const name = unique('ChatGPT connector');
	const provider = new TestProvider(name);
	const serverUrl = new URL('/mcp', baseURL);
	expect(await auth(provider, { serverUrl })).toBe('REDIRECT');

	await person.page.goto(provider.authorizationUrl!.href);
	await person.page.getByRole('link', { name: 'Email me a sign-in code' }).click();
	await expect(person.page.getByRole('heading', { name: 'Sign in with a code' })).toBeVisible();
	await person.page.getByLabel('Email').fill(person.email);
	await person.page.getByRole('button', { name: 'Email me a sign-in code' }).click();
	const mail = await waitForMail(person.page.request, person.email, 'sign_in_code');
	await person.page.getByLabel('Sign-in code').fill(/^\s{4}(\d{6})$/m.exec(mail.text)![1]!);
	await person.page.getByRole('button', { name: 'Sign in', exact: true }).click();

	// The offer of a passkey comes first; either way the person lands on the consent screen.
	await expect(person.page).toHaveURL(/\/add-passkey\?next=%2Foauth%2Fauthorize/);
	await person.page.getByRole('link', { name: 'Continue without a passkey' }).click();
	await expect(person.page.getByTestId('oauth-consent')).toContainText(`Connect ${name} to mcp-audit?`);
	const callback = await callbackOf(person.page, () =>
		person.page.getByRole('button', { name: 'Allow access' }).click()
	);
	expect(await auth(provider, { serverUrl, authorizationCode: callback.searchParams.get('code')! })).toBe(
		'AUTHORIZED'
	);
	expect(provider.saved?.access_token).toMatch(/^mcpo_/);
	await person.context.close();
});

test('creating an access token asks for the passkey again after 5 minutes', async ({ page, browser }) => {
	const person = await joined(browser, page, 'Tom Token', 'passkey');
	const p = person.page;
	await p.goto('/settings/tokens');
	await expect(p.getByText('your passkey is asked for again')).toBeVisible();

	// Just signed in: no question.
	await p.getByLabel('Token name').fill('Claude Code on laptop');
	await p.getByRole('button', { name: 'Create token' }).click();
	await expect(p.getByTestId('new-token')).toContainText('Claude Code on laptop');

	// Six minutes later the app refuses, asks the device, and then creates the token.
	expect((await p.request.post('/api/test/age-session', { data: { minutes: 6 } })).ok()).toBeTruthy();
	const refused = await postForm(p, '/settings/tokens?/create', { name: 'Not without a check' });
	expect(await refused.text()).toContain('recheck');
	await p.reload();
	await expect(p.getByText('Not without a check')).toHaveCount(0);

	const asked = p.waitForResponse((r) => r.url().endsWith('/api/passkeys/confirm/verify'));
	await p.getByLabel('Token name').fill('Claude Desktop');
	await p.getByRole('button', { name: 'Create token' }).click();
	expect((await asked).status()).toBe(200);
	await expect(p.getByTestId('new-token')).toContainText('Claude Desktop');
	await person.context.close();
});

test('without a passkey, an old sign-in must be renewed before a token is created', async ({
	page,
	browser
}) => {
	const person = await joined(browser, page, 'Nia Nokey', 'without');
	const p = person.page;
	await p.goto('/settings/tokens');
	await expect(p.getByText('you are asked to sign in again first')).toBeVisible();
	expect((await p.request.post('/api/test/age-session', { data: { minutes: 6 } })).ok()).toBeTruthy();
	await p.getByLabel('Token name').fill('Claude Code');
	await p.getByRole('button', { name: 'Create token' }).click();
	await expect(p.getByTestId('sign-in-again')).toContainText('Sign in again to create a token');
	await expect(p.getByTestId('new-token')).toHaveCount(0);

	await p.getByRole('button', { name: 'Sign in again' }).click();
	await expect(p).toHaveURL(/\/login\?next=%2Fsettings%2Ftokens$/);
	// A code by email is the new proof, and the way leads back to the tokens.
	await p.getByRole('link', { name: 'Email me a sign-in code' }).click();
	await expect(p.getByRole('heading', { name: 'Sign in with a code' })).toBeVisible();
	await p.getByLabel('Email').fill(person.email);
	await p.getByRole('button', { name: 'Email me a sign-in code' }).click();
	const mail = await waitForMail(p.request, person.email, 'sign_in_code');
	await p.getByLabel('Sign-in code').fill(/^\s{4}(\d{6})$/m.exec(mail.text)![1]!);
	await p.getByRole('button', { name: 'Sign in', exact: true }).click();
	await p.getByRole('link', { name: 'Continue without a passkey' }).click();
	await expect(p).toHaveURL('/settings/tokens');
	await p.getByLabel('Token name').fill('Claude Code');
	await p.getByRole('button', { name: 'Create token' }).click();
	await expect(p.getByTestId('new-token')).toContainText('Claude Code');
	await person.context.close();
});

test('the guide describes the sign-in window without a password', async ({ page }) => {
	await loginAs(page, ADMIN);
	await page.goto('/guide/connect');
	await page.getByRole('tab', { name: 'Claude', exact: true }).click();
	const note = page.getByTestId('sign-in-note');
	await expect(note).toContainText('Sign in with a passkey');
	await expect(note).toContainText('Email me a sign-in code');
	await expect(page.getByRole('main')).not.toContainText(/password/i);
	const guide = await (await page.request.get('/guide/download')).text();
	expect(guide).toContain('Sign in with a passkey');
	expect(guide).not.toMatch(/password/i);
});
