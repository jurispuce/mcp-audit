import { ADMIN, expect, loginAs, sampleCopy, seed, test } from '../helpers';

test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('on a phone at 360px: the event screen fits, every target is 44px, and a note is taken one-handed (#52)', async ({
	page
}) => {
	await page.setViewportSize({ width: 360, height: 760 });
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/run/events/${e.events[0]!.id}`);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	const small = await page.evaluate(() =>
		[...document.querySelectorAll('main a, main button, main input, main select, main textarea')]
			.filter((el) => {
				const r = el.getBoundingClientRect();
				return (
					r.width > 0 &&
					r.height > 0 &&
					getComputedStyle(el).visibility !== 'hidden' &&
					!el.classList.contains('au-visually-hidden')
				);
			})
			.map((el) => (el.matches('label input') ? el.closest('label')! : el))
			.filter((el) => el.getBoundingClientRect().height < 44)
			.map((el) => `${el.tagName} "${(el.textContent ?? '').trim().slice(0, 30)}"`)
	);
	expect(small).toEqual([]);
	await page.getByRole('button', { name: 'Mark held' }).tap();
	await expect(page.getByTestId('event-status')).toHaveText('Held');
	await page.getByLabel('Note', { exact: true }).tap();
	await page.keyboard.type('Walked through the leaver process');
	await page.getByRole('button', { name: 'Save note' }).tap();
	await expect(page.getByTestId('note')).toHaveCount(1);
});
