import { ADMIN, expect, seed, test, unique } from '../helpers';

/** #87 on a phone: a passkey is added and used at phone size, with 44px targets. */
test('on a phone: add a passkey and sign in with it', async ({ page, context, baseURL }) => {
	await seed(page.request);
	const base = baseURL!.replace('127.0.0.1', 'localhost');
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	expect((await page.request.post(`${base}/api/test/login`, { data: { email: ADMIN } })).ok()).toBeTruthy();
	const name = unique('Phone');
	await page.goto(`${base}/settings`);
	const section = page.getByRole('region', { name: 'Passkeys' });
	await section.getByLabel('Name for the new passkey').fill(name);
	await section.getByRole('button', { name: 'Add passkey' }).tap();
	await expect(section.getByTestId('passkey').filter({ hasText: name })).toBeVisible();

	const small = await page.evaluate(() =>
		[...document.querySelectorAll('[aria-labelledby="passkeys-title"] :is(a, button, input)')]
			.filter((el) => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 44)
			.map((el) => `${el.tagName} "${(el.textContent ?? '').trim().slice(0, 30)}"`)
	);
	expect(small).toEqual([]);

	await context.clearCookies();
	await page.goto(`${base}/login`);
	await page.getByRole('button', { name: 'Sign in with a passkey' }).tap();
	await expect(page).toHaveURL(`${base}/`);

	// Tidy up: this passkey belongs to a seeded user other tests share.
	await page.goto(`${base}/settings`);
	await page.getByRole('button', { name: `Remove passkey ${name}` }).tap();
	await expect(page.getByRole('region', { name: 'Passkeys' }).getByText(name)).toHaveCount(0);
});
