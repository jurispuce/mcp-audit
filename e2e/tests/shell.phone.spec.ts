import { ADMIN, expect, loginAs, seed, test } from '../helpers';

let e = '';
test.beforeEach(async ({ page }) => {
	e = (await seed(page.request)).engagement.id;
	await loginAs(page, ADMIN);
});

test('on a phone: top bar and bottom bar replace the rail', async ({ page }) => {
	await page.goto(`/e/${e}/plan/events`);
	await expect(page.locator('nav.au-rail')).toBeHidden();
	await expect(page.locator('header.au-topbar')).toBeVisible();
	await expect(page.getByTestId('topbar-switcher')).toHaveText('NIS 2 audit, Riga office');
	const bar = page.locator('nav.au-bottombar');
	await expect(bar).toBeVisible();
	await expect(bar.getByRole('link')).toHaveText(['Home', 'Set-up', 'Plan', 'Run', 'Findings']);
	await expect(bar.getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'page');
});

test('on a phone: every tappable element is at least 44px high', async ({ page }) => {
	for (const route of [
		`/e/${e}`,
		`/e/${e}/setup/requirements`,
		`/e/${e}/setup/scopes`,
		`/e/${e}/setup/auditee`,
		`/e/${e}/setup/risks`,
		`/e/${e}/setup/documents`,
		`/e/${e}/plan/events`,
		`/e/${e}/plan/coverage`,
		`/e/${e}/plan/document`,
		'/settings',
		'/settings/users',
		'/settings/tokens',
		'/',
		'/library',
		'/library?source=nis2',
		'/library?q=incident'
	]) {
		await page.goto(route);
		const small = await page.evaluate(() =>
			[...document.querySelectorAll('a, button, input, select, textarea, [role="tab"]')]
				.filter((el) => {
					const r = el.getBoundingClientRect();
					const style = getComputedStyle(el);
					return (
						r.width > 0 &&
						r.height > 0 &&
						style.visibility !== 'hidden' &&
						!el.classList.contains('au-visually-hidden')
					);
				})
				// A card title link stretches over its whole card, so the card is the tap target.
				.map((el) => (el.matches('.au-item__title a') ? el.closest('.au-item')! : el))
				// A checkbox or radio inside its label: the whole label row is the tap target.
				.map((el) =>
					el.matches('label input[type="checkbox"], label input[type="radio"]') ? el.closest('label')! : el
				)
				.filter((el) => el.getBoundingClientRect().height < 44)
				.map(
					(el) =>
						`${el.tagName} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`
				)
		);
		expect(small, route).toEqual([]);
	}
});

test('on a phone: Library and Settings are reached from the engagements screen', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: 'Settings' }).click();
	await expect(page).toHaveURL('/settings');
	await page.getByTestId('topbar-switcher').click();
	await expect(page).toHaveURL('/');
});
