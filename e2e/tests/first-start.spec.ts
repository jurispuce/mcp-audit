import { expect, test } from '@playwright/test';

test('on first start, /setup creates the first admin with the code from the log', async ({
	page,
	request
}) => {
	const codeRes = await request.get('/api/test/setup-code');
	test.skip(
		codeRes.status() === 404,
		'This server already has users; first start runs once per fresh data volume.'
	);
	await page.goto('/');
	await expect(page).toHaveURL('/setup');
	await page.goto('/login');
	await expect(page).toHaveURL('/setup');

	const fill = async (code: string) => {
		await page.getByLabel('Set-up code').fill(code);
		await page.getByLabel('Your name').fill('First Admin');
		await page.getByLabel('Email').fill('first@example.test');
		await page.getByLabel('Password', { exact: true }).fill('first-admin-password');
		await page.getByLabel('Repeat password').fill('first-admin-password');
		await page.getByRole('button', { name: 'Create admin account' }).click();
	};

	await fill('wrong-code');
	await expect(page.getByRole('alert')).toContainText('set-up code is not correct');

	const { code } = await codeRes.json();
	await fill(code);
	await expect(page).toHaveURL('/');
	await expect(page.getByRole('heading', { name: 'Engagements' })).toBeVisible();

	await page.goto('/setup');
	await expect(page).toHaveURL('/');
});
