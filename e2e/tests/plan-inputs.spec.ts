import { ADMIN, createEngagement, expect, loginAs, seed, test } from '../helpers';

/** #79: the plan is drafted for the fieldwork time the auditor sets first. */
test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('planning inputs come first: days, hours, meetings and exceptions, with what fits', async ({ page }) => {
	const { id } = await createEngagement(page);
	await page.goto(`/e/${id}/plan/events`);
	const box = page.getByTestId('plan-inputs');
	await expect(page.getByTestId('ai-draft_plan')).toContainText('Save the planning inputs first');

	await box.getByLabel('First fieldwork day').fill('2026-11-30');
	await box.getByLabel('Last fieldwork day').fill('2026-12-02');
	await expect(page.getByTestId('plan-capacity')).toContainText(
		'3 weekdays: about 16 meetings of an hour fit'
	);
	await box.getByLabel('Last fieldwork day').fill('2026-11-30');
	await expect(page.getByTestId('plan-capacity')).toContainText('1 weekday: about 5 meetings of an hour fit');
	await box.getByLabel('Last fieldwork day').fill('2026-12-01');
	await box.getByLabel('About how many audit meetings? (optional)').fill('8');
	await box.getByLabel('Exceptions (optional)').fill('Head of IT away on 1 December');
	await box.getByRole('button', { name: 'Save planning inputs' }).click();

	await expect(page.getByRole('status')).toHaveText(
		'Planning inputs saved. Draft plan will fit the meetings into this time.'
	);
	await expect(page.getByTestId('plan-inputs-summary')).toHaveText(
		'2 fieldwork days (2026-11-30 to 2026-12-01), 09:00–17:00, lunch 12:00 (60 min). About 10 meetings of an hour fit; aiming for about 8.'
	);
	await expect(box).toContainText('Exceptions: Head of IT away on 1 December');
	await expect(page.getByTestId('ai-draft_plan')).toContainText('within the fieldwork time');

	await box.getByRole('button', { name: 'Edit planning inputs' }).click();
	await box.getByLabel('Day ends').fill('10:00');
	await box.getByRole('button', { name: 'Save planning inputs' }).click();
	await expect(box).toContainText('At least two hours after the start.');
});
