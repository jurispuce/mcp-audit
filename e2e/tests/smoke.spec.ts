import { expect, test } from '@playwright/test';
import { ADMIN, PASSWORD, seed, signIn } from '../helpers';

test('start, sign in and see the empty engagements list', async ({ page, request }) => {
	await seed(request);
	await signIn(page, ADMIN, PASSWORD);
	await expect(page).toHaveURL('/');
	await expect(page.getByRole('heading', { name: 'Engagements' })).toBeVisible();
	await expect(page.getByTestId('engagements-empty')).toBeVisible();
});

test('health is public and reports version and migrations', async ({ request }) => {
	const res = await request.get('/health');
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(body).toMatchObject({ status: 'ok', database: 'ok', migrations: { pending: 0 } });
	expect(body.version).toBeTruthy();
});
