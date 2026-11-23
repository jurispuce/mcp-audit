import { AUDITOR, PASSWORD, expect, loginAs, seed, test, unique } from '../helpers';

test('a user creates a token that is shown once, and can revoke it', async ({ page }) => {
	await seed(page.request);
	await loginAs(page, AUDITOR);
	await page.goto('/settings/tokens');
	const name = unique('Claude Desktop');
	await page.getByLabel('Token name').fill(name);
	await page.getByRole('button', { name: 'Create token' }).click();
	const shown = page.getByTestId('new-token');
	await expect(shown).toContainText(name);
	const token = (await shown.locator('.au-secret').textContent())!.trim();
	expect(token).toMatch(/^mcpa_/);

	await page.reload();
	await expect(page.getByTestId('new-token')).toHaveCount(0);
	await expect(page.getByText(token)).toHaveCount(0);
	const card = page.locator('.au-item', { hasText: name });
	await expect(card).toContainText('Active');

	page.on('dialog', (d) => d.accept());
	await card.getByRole('button', { name: 'Revoke token' }).click();
	await expect(card).toContainText('Revoked');
});

test('a sign-in older than 5 minutes must be renewed before a token is created (#93)', async ({ page }) => {
	await seed(page.request);
	await loginAs(page, AUDITOR);
	await page.goto('/settings/tokens');
	expect((await page.request.post('/api/test/age-session', { data: { minutes: 6 } })).ok()).toBeTruthy();
	const name = unique('Claude Code');
	await page.getByLabel('Token name').fill(name);
	await page.getByRole('button', { name: 'Create token' }).click();
	await expect(page.getByTestId('sign-in-again')).toContainText('Sign in again to create a token');
	await expect(page.getByTestId('new-token')).toHaveCount(0);

	// Signing in again is the fresh proof, and leads back here.
	await page.getByRole('button', { name: 'Sign in again' }).click();
	await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Ftokens$/);
	await page.getByLabel('Email').fill(AUDITOR);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page).toHaveURL('/settings/tokens');
	await expect(page.locator('.au-item', { hasText: name })).toHaveCount(0);
	await page.getByLabel('Token name').fill(name);
	await page.getByRole('button', { name: 'Create token' }).click();
	await expect(page.getByTestId('new-token')).toContainText(name);
});

test('the MCP endpoint refuses requests without a token', async ({ request }) => {
	const res = await request.post('/mcp', { data: {} });
	expect(res.status()).toBe(401);
});
