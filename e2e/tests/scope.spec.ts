import { ADMIN, expect, loginAs, sampleCopy, seed, test } from '../helpers';

/** #82: change the audit scope while planning, from Plan, Coverage. */
test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('requirements no event covers can leave the audit scope, one or several, with a reason', async ({
	page
}) => {
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/plan/coverage?uncovered=1`);
	const summary = page.getByTestId('coverage-summary');
	const before = (await summary.textContent())!;
	const total = Number(/of (\d+)/.exec(before)![1]);
	const rows = page.getByRole('list', { name: 'Requirements' }).getByRole('article');
	const count = await rows.count();
	test.skip(count === 0, 'The sample has no uncovered requirement.');
	const first = (await rows.first().locator('.au-ref').textContent())!.split(' · ')[0]!;

	await rows
		.first()
		.getByRole('button', { name: `Remove ${first} from scope` })
		.click();
	const bar = page.getByTestId('scope-bar');
	await expect(bar).toContainText('1 selected to leave the audit scope');
	await expect(bar.getByLabel('Why they leave the audit scope')).toBeFocused();
	await bar.getByLabel('Why they leave the audit scope').fill('Not part of this year’s audit cycle');
	page.once('dialog', (d) => d.accept());
	await bar.getByRole('button', { name: 'Remove from scope' }).click();
	await expect(page.getByRole('status')).toHaveText(
		'1 requirement removed from the audit scope. Select them again on Set-up, Requirements if needed.'
	);
	await expect(summary).toContainText(`of ${total - 1} requirements`);
	await expect(page.getByTestId(`coverage-${first}`)).toHaveCount(0);
});

test('a requirement still in an event is not removed silently', async ({ page }) => {
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/plan/coverage`);
	// Covered rows offer no removal; the bar is only about requirements no event covers.
	const covered = page.locator('[data-testid^="coverage-"]').filter({ has: page.locator('.au-badge--ok') });
	await expect(covered.first().getByRole('button', { name: /Remove .* from scope/ })).toHaveCount(0);
});
