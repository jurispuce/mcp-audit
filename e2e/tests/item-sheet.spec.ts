import { expect, test } from '@playwright/test';
import { ADMIN, loginAs, seed, unique } from '../helpers';

test('any record opens in the item sheet with details, comments and history, and can be reverted', async ({
	page
}) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
	const email = `${unique('sheet')}@example.test`;
	await page.goto('/settings/users');
	await page.getByRole('button', { name: 'Add user' }).click();
	await page.getByLabel('Name').fill('Sheet Person');
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Add user' }).click();
	const card = page.getByTestId(`user-${email}`);
	await card.getByRole('button', { name: 'Edit user' }).click();
	await card.getByLabel('Name').fill('Sheet Person Renamed');
	await card.getByRole('button', { name: 'Save user' }).click();
	await expect(card).toContainText('v2');

	// Open the sheet from the card title: the list stays underneath.
	await card.getByRole('link', { name: 'Sheet Person Renamed' }).click();
	await expect(page).toHaveURL(/\?item=user:/);
	const sheet = page.getByTestId('item-sheet');
	await expect(sheet.getByRole('heading', { name: 'Sheet Person Renamed' })).toBeVisible();
	await expect(sheet.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
	await expect(sheet).toContainText(email);
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

	// Comments: append-only, newest last.
	await sheet.getByRole('tab', { name: 'Comments' }).click();
	await expect(page).toHaveURL(/tab=comments/);
	await sheet.getByRole('textbox', { name: 'Comment' }).fill('Checked with the team lead.');
	await sheet.getByRole('button', { name: 'Add comment' }).click();
	await expect(sheet.locator('.au-comment')).toHaveCount(1);
	await expect(sheet.locator('.au-comment')).toContainText('Checked with the team lead.');
	await expect(sheet.getByRole('tab', { name: /Comments/ })).toContainText('1');
	await expect(sheet.getByRole('button', { name: /edit|delete/i })).toHaveCount(0);

	// History: versions with author, channel and changed fields; revert all but the current one.
	await sheet.getByRole('tab', { name: /History/ }).click();
	const history = sheet.getByTestId('history');
	await expect(history.locator('li')).toHaveCount(2);
	const v2 = history.locator('li[data-version="2"]');
	await expect(v2).toContainText('Changed name');
	await expect(v2.locator('.au-diff-del')).toHaveText('Sheet Person');
	await expect(v2.locator('.au-diff-ins')).toHaveText('Sheet Person Renamed');
	await expect(v2).toContainText('Ada Admin');
	await expect(v2).toContainText('UI');
	await expect(v2).toContainText('current');
	await expect(v2.getByRole('button', { name: 'Revert' })).toHaveCount(0);

	page.once('dialog', (d) => d.dismiss());
	await history.locator('li[data-version="1"]').getByRole('button', { name: 'Revert' }).click();
	await expect(history.locator('li')).toHaveCount(2);

	page.once('dialog', (d) => d.accept());
	await history.locator('li[data-version="1"]').getByRole('button', { name: 'Revert' }).click();
	await expect(history.locator('li')).toHaveCount(3);
	await expect(history.locator('li[data-version="3"]')).toContainText('Reverted to v1');
	await expect(sheet.getByRole('heading', { name: 'Sheet Person', exact: true })).toBeVisible();

	// Escape closes the sheet; the list underneath shows the reverted name.
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(page).not.toHaveURL(/item=/);
	await expect(card).toContainText('v3');
	await expect(card.getByRole('link', { name: 'Sheet Person', exact: true })).toBeVisible();
});

test('the item sheet opens directly from a URL on any screen', async ({ page }) => {
	const { users } = await seed(page.request);
	await loginAs(page, ADMIN);
	const auditor = users.find((u) => u.role === 'auditor')!;
	await page.goto(`/e/demo/plan/events?item=user:${auditor.id}&tab=history`);
	const sheet = page.getByTestId('item-sheet');
	await expect(sheet.getByRole('tab', { name: /History/ })).toHaveAttribute('aria-selected', 'true');
	await expect(sheet.getByTestId('history')).toContainText('Created');
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(page).toHaveURL('/e/demo/plan/events');
});
