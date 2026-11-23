import type { BrowserContext, Page } from '@playwright/test';
import { AUDITOR, expect, seed, test, unique } from '../helpers';

/**
 * #87: passkeys, with Chromium's virtual authenticator standing in for a fingerprint reader. Browsers
 * give passkeys to a host name only, so these tests reach the app at `localhost`, not at 127.0.0.1.
 */
const local = (baseURL: string) => baseURL.replace('127.0.0.1', 'localhost');

async function virtualAuthenticator(context: BrowserContext, page: Page) {
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	return { cdp, authenticatorId };
}

test.beforeEach(async ({ request }) => {
	await seed(request);
});

test('add a passkey, sign in with it, rename it and remove it', async ({ page, context, baseURL }) => {
	const base = local(baseURL!);
	const device = await virtualAuthenticator(context, page);
	const login = await page.request.post(`${base}/api/test/login`, { data: { email: AUDITOR } });
	expect(login.ok()).toBeTruthy();
	const name = unique('Laptop');

	await page.goto(`${base}/settings`);
	const section = page.getByRole('region', { name: 'Passkeys' });
	await expect(section).toBeVisible();
	await section.getByLabel('Name for the new passkey').fill(name);
	await section.getByRole('button', { name: 'Add passkey' }).click();
	await expect(section.getByRole('status')).toContainText(`Passkey “${name}” added.`);
	const item = section.getByTestId('passkey').filter({ hasText: name });
	await expect(item).toContainText('last used never');
	// The addition is in the person's history, by name.
	await page.getByRole('link', { name: 'View history' }).click();
	await expect(page.getByText(`Passkey added: ${name}`)).toBeVisible();

	// Sign out, then in again with the passkey and no email or password.
	await page.goto(`${base}/settings`);
	await page.locator('nav.au-rail').getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login/);
	await page.goto(`${base}/login?next=%2Fsettings`);
	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page).toHaveURL(`${base}/settings`);
	await expect(page.locator('nav.au-rail')).toContainText('Signed in as');
	const used = page
		.getByRole('region', { name: 'Passkeys' })
		.getByTestId('passkey')
		.filter({ hasText: name });
	await expect(used).not.toContainText('last used never');

	// Rename, then remove; a removed passkey no longer signs in.
	await used.getByRole('button', { name: `Rename passkey ${name}` }).click();
	await used.getByLabel('Name').fill(`${name} (work)`);
	await used.getByRole('button', { name: 'Save name' }).click();
	const renamed = page
		.getByRole('region', { name: 'Passkeys' })
		.getByTestId('passkey')
		.filter({ hasText: `${name} (work)` });
	await expect(renamed).toBeVisible();
	await renamed.getByRole('button', { name: `Remove passkey ${name} (work)` }).click();
	await expect(page.getByRole('region', { name: 'Passkeys' }).getByRole('status')).toContainText(
		'Passkey removed.'
	);
	await expect(page.getByRole('region', { name: 'Passkeys' }).getByText(name)).toHaveCount(0);

	await page.locator('nav.au-rail').getByRole('button', { name: 'Sign out' }).click();
	await page.goto(`${base}/login`);
	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page.getByRole('alert')).toContainText('That passkey could not be used to sign in here.');
	await expect(page).toHaveURL(/\/login/);
	await device.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: device.authenticatorId });
});

test('without a passkey on the device the prompt ends with a plain message; passwords still work', async ({
	page,
	context,
	baseURL
}) => {
	const base = local(baseURL!);
	// A device that holds no passkey for this address and whose owner dismisses the prompt.
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: false,
			automaticPresenceSimulation: true
		}
	});
	await page.goto(`${base}/login`);
	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByLabel('Password')).toBeVisible();
});

test('where the address cannot have passkeys, they are not offered', async ({ page, baseURL }) => {
	test.skip(!baseURL!.includes('127.0.0.1'), 'needs an address that is an IP');
	await page.goto('/login');
	await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toHaveCount(0);
	const res = await page.request.post('/api/passkeys/sign-in/options', {
		headers: { origin: new URL(baseURL!).origin },
		data: {}
	});
	expect(res.status()).toBe(400);
	expect((await res.json()).message).toContain('Passkeys need the app at an https address');
	// And never for a request that does not come from the app's own pages.
	const foreign = await page.request.post('/api/passkeys/sign-in/options', {
		headers: { origin: 'https://elsewhere.example' },
		data: {}
	});
	expect(foreign.status()).toBe(403);
});
