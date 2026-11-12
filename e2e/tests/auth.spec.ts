import { ADMIN, expect, PASSWORD, postForm, seed, signIn, test } from '../helpers';

test.beforeEach(async ({ request }) => {
	await seed(request);
});

test('every page needs a session and sends you back after signing in', async ({ page }) => {
	await page.goto('/settings/tokens');
	await expect(page).toHaveURL('/login?next=%2Fsettings%2Ftokens');
	await page.getByLabel('Email').fill(ADMIN);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page).toHaveURL('/settings/tokens');
});

test('a wrong password gives one message that does not say which part was wrong', async ({ page }) => {
	await signIn(page, ADMIN, 'not the password');
	await expect(page.getByRole('alert')).toHaveText('Email or password is not correct.');
	await expect(page).toHaveURL(/\/login/);
});

test('API calls without a session get 401 JSON, not a redirect', async ({ request }) => {
	const res = await request.get('/api/anything', { maxRedirects: 0 });
	expect(res.status()).toBe(401);
	expect(await res.json()).toMatchObject({ code: 'unauthenticated' });
});

test('signing out ends the session', async ({ page }) => {
	await signIn(page, ADMIN, PASSWORD);
	await expect(page).toHaveURL('/');
	await postForm(page, '/logout');
	await page.goto('/settings');
	await expect(page).toHaveURL(/\/login/);
});

test('the version is shown in Settings', async ({ page }) => {
	await signIn(page, ADMIN, PASSWORD);
	await expect(page).toHaveURL('/');
	await page.goto('/settings');
	await expect(page.getByTestId('app-version')).toContainText('mcp-audit version');
});
