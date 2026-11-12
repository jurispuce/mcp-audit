import { expect, test } from '@playwright/test';
import { ADMIN, loginAs, seed } from '../helpers';

test('on a phone the item sheet is full screen with a way back', async ({ page }) => {
	const { users } = await seed(page.request);
	await loginAs(page, ADMIN);
	const auditor = users.find((u) => u.role === 'auditor')!;
	await page.goto(`/settings?item=user:${auditor.id}`);
	const sheet = page.getByTestId('item-sheet');
	await expect(sheet).toBeVisible();
	const box = (await sheet.boundingBox())!;
	const viewport = page.viewportSize()!;
	expect(Math.round(box.width)).toBe(viewport.width);
	expect(Math.round(box.height)).toBe(viewport.height);
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toHaveCount(0);
});
