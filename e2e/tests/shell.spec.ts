import { expect, test } from '@playwright/test';
import { ADMIN, loginAs, seed } from '../helpers';

const ROUTES = [
	'/',
	'/library',
	'/settings',
	'/e/demo',
	'/e/demo/setup/requirements',
	'/e/demo/setup/scopes',
	'/e/demo/setup/auditee',
	'/e/demo/setup/risks',
	'/e/demo/setup/documents',
	'/e/demo/plan/events',
	'/e/demo/plan/document',
	'/e/demo/run/today',
	'/e/demo/run/events',
	'/e/demo/run/events/ev1',
	'/e/demo/run/inbox',
	'/e/demo/findings/matrix',
	'/e/demo/findings/to-approve',
	'/e/demo/findings/conclusions',
	'/e/demo/proposals'
];

test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('every route from design/navigation.md exists', async ({ page }) => {
	for (const route of ROUTES) {
		const res = await page.goto(route);
		expect(res?.status(), route).toBe(200);
	}
});

test('the rail shows the five destinations in audit order, then Library and Settings', async ({ page }) => {
	await page.goto('/e/demo/setup/risks');
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
	await page.goto('/e/demo/run');
	await expect(page).toHaveURL('/e/demo/run/today');
	await page.locator('nav.au-rail').getByRole('link', { name: 'Findings' }).click();
	await expect(page).toHaveURL('/e/demo/findings/matrix');
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
