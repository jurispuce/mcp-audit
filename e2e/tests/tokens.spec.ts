import { expect, test } from '@playwright/test';
import { AUDITOR, loginAs, seed, unique } from '../helpers';

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

test('the MCP endpoint refuses requests without a token', async ({ request }) => {
	const res = await request.post('/mcp', { data: {} });
	expect(res.status()).toBe(401);
});
