import { ADMIN, expect, loginAs, seed, test } from '../helpers';

/** #98: an instance that was given no operator token has no operator endpoint. */
test('without an operator token the endpoint does not exist, for anyone', async ({ page }) => {
	await seed(page.request);
	const url = '/api/operator/status';
	expect((await page.request.get(url)).status()).toBe(404);
	expect((await page.request.get(url, { headers: { authorization: 'Bearer anything' } })).status()).toBe(404);
	await loginAs(page, ADMIN);
	expect((await page.request.get(url)).status()).toBe(404);
});
