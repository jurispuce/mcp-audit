import { expect, test } from '@playwright/test';
import { ADMIN, AUDITOR, loginAs, seed, signIn, unique } from '../helpers';

test.beforeEach(async ({ request }) => {
	await seed(request);
});

test('an admin adds a user, who signs in with the one-time password and must choose their own', async ({
	page,
	browser
}) => {
	const email = `${unique('new')}@example.test`;
	await loginAs(page, ADMIN);
	await page.goto('/settings/users');
	await page.getByRole('button', { name: 'Add user' }).click();
	await page.getByLabel('Name').fill('Nora New');
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Add user' }).click();
	const oneTime = page.getByTestId('one-time-password');
	await expect(oneTime).toContainText(email);
	const temp = (await oneTime.locator('.au-secret').textContent())!.trim();
	await expect(page.getByTestId(`user-${email}`)).toContainText('Auditor');

	const other = await browser.newPage();
	await signIn(other, email, temp);
	await expect(other).toHaveURL('/settings?password=required');
	await expect(other.getByText('Choose your own password')).toBeVisible();
	await other.goto('/');
	await expect(other).toHaveURL('/settings?password=required');
	await other.getByLabel('Current password').fill(temp);
	await other.getByLabel('New password', { exact: true }).fill('nora-own-password');
	await other.getByLabel('Repeat new password').fill('nora-own-password');
	await other.getByRole('button', { name: 'Change password' }).click();
	await expect(other).toHaveURL('/');
	await other.close();
});

test('deactivating a user ends their session; only admins see the Users tab', async ({ page, browser }) => {
	const email = `${unique('temp')}@example.test`;
	await loginAs(page, ADMIN);
	await page.goto('/settings/users');
	await page.getByRole('button', { name: 'Add user' }).click();
	await page.getByLabel('Name').fill('Tim Temp');
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Add user' }).click();
	await expect(page.getByTestId('one-time-password')).toBeVisible();

	const auditor = await browser.newPage();
	await loginAs(auditor, AUDITOR);
	await auditor.goto('/settings');
	await expect(auditor.getByRole('link', { name: 'Users' })).toHaveCount(0);
	const forbidden = await auditor.goto('/settings/users');
	expect(forbidden?.status()).toBe(403);
	await auditor.close();

	const tim = await browser.newPage();
	await loginAs(tim, email);
	await tim.goto('/settings');
	await expect(tim.getByRole('heading', { name: 'Settings' })).toBeVisible();

	page.on('dialog', (d) => d.accept());
	const card = page.getByTestId(`user-${email}`);
	await card.getByRole('button', { name: 'Deactivate user' }).click();
	await expect(card).toContainText('Deactivated');

	await tim.goto('/settings');
	await expect(tim).toHaveURL(/\/login/);
	await tim.close();
});
