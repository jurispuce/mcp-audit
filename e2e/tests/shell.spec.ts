import { expect, test } from '@playwright/test';
import { ADMIN, loginAs, seed } from '../helpers';

const routes = (e: string) => [
	'/',
	'/library',
	'/settings',
	`/e/${e}`,
	`/e/${e}/setup/requirements`,
	`/e/${e}/setup/scopes`,
	`/e/${e}/setup/auditee`,
	`/e/${e}/setup/risks`,
	`/e/${e}/setup/documents`,
	`/e/${e}/plan/events`,
	`/e/${e}/plan/document`,
	`/e/${e}/run/today`,
	`/e/${e}/run/events`,
	`/e/${e}/run/events/ev1`,
	`/e/${e}/run/inbox`,
	`/e/${e}/findings/matrix`,
	`/e/${e}/findings/to-approve`,
	`/e/${e}/findings/conclusions`,
	`/e/${e}/proposals`
];

let e = '';
test.beforeEach(async ({ page }) => {
	e = (await seed(page.request)).engagement.id;
	await loginAs(page, ADMIN);
});

test('every route from design/navigation.md exists', async ({ page }) => {
	for (const route of routes(e)) {
		const res = await page.goto(route);
		expect(res?.status(), route).toBe(200);
	}
});

test('the rail shows the five destinations in audit order, then Library and Settings', async ({ page }) => {
	await page.goto(`/e/${e}/setup/risks`);
	const rail = page.locator('nav.au-rail');
	await expect(rail).toBeVisible();
	await expect(rail.locator('.au-nav')).toHaveText([
		'Home',
		'Set-up',
		'Plan',
		'Run',
		'Findings',
		'Library',
		'Settings',
		'Sign out'
	]);
	await expect(rail.getByRole('link', { name: 'Set-up' })).toHaveAttribute('aria-current', 'page');
	await expect(
		page.getByRole('navigation', { name: 'Set-up tabs' }).getByRole('link', { name: 'Risks' })
	).toHaveAttribute('aria-current', 'page');
	await expect(page.locator('nav.au-bottombar')).toBeHidden();
});

test('a destination opens its first tab', async ({ page }) => {
	await page.goto(`/e/${e}/run`);
	await expect(page).toHaveURL(`/e/${e}/run/today`);
	await page.locator('nav.au-rail').getByRole('link', { name: 'Findings' }).click();
	await expect(page).toHaveURL(`/e/${e}/findings/matrix`);
});

test('an unknown engagement is a 404', async ({ page }) => {
	const res = await page.goto('/e/00000000-0000-0000-0000-000000000000/setup/requirements');
	expect(res?.status()).toBe(404);
});

test('outside an engagement the destinations are shown but not active', async ({ page }) => {
	await page.goto('/library');
	const rail = page.locator('nav.au-rail');
	await expect(rail.getByRole('link', { name: 'Home' })).toHaveCount(0);
	await expect(rail.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page');
});

test('the theme follows the system setting', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/');
	const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	await page.emulateMedia({ colorScheme: 'dark' });
	const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	expect(light).toBe('rgb(246, 247, 248)');
	expect(dark).toBe('rgb(17, 20, 23)');
});

test('the app can be installed: manifest and icons are public', async ({ request }) => {
	const res = await request.get('/manifest.webmanifest');
	expect(res.status()).toBe(200);
	const manifest = await res.json();
	expect(manifest).toMatchObject({ display: 'standalone', start_url: '/' });
	for (const icon of manifest.icons) expect((await request.get(icon.src)).status(), icon.src).toBe(200);
});
