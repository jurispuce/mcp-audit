import { ADMIN, expect, loginAs, sampleCopy, seed, test, unique } from '../helpers';

/** Set-up, Requirements: show and select a source's requirements for one role of the auditee (#110). */
test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('choose the auditee’s role, see only its requirements, select all of them, and keep the choice on reload', async ({
	page
}) => {
	const code = unique('nkdl')
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '');
	await page.goto('/library/import');
	await page.getByLabel('Or paste the YAML').fill(
		`id: ${code}
title: Cyber law ${code}
type: law
roles:
  - { key: essential, label: Essential entity, description: Defined in Art. 1 }
  - { key: important, label: Important entity }
requirements:
  - { id: "11", title: Management measures }
  - { id: "11(1)", parent: "11", title: Manage risks }
  - { id: "12 [essential]", parent: "11", title: Audit every two years, roles: [essential] }
  - { id: "12 [important]", parent: "11", title: Audit on the supervisor's request, roles: [important] }
`
	);
	await page.getByRole('button', { name: 'Import source' }).click();
	await expect(page.getByTestId('import-report')).toBeVisible();

	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/setup/requirements`);
	const source = page.getByTestId(`select-source-${code}`);
	const list = source.getByRole('list', { name: `Cyber law ${code} requirements` });
	await expect(list.getByRole('checkbox')).toHaveCount(4);
	await expect(source.getByRole('link', { name: 'All roles' })).toHaveAttribute('aria-current', 'true');

	await source.getByRole('link', { name: 'Important entity' }).click();
	await expect(page).toHaveURL(new RegExp(`role\\.${code}=important`));
	await expect(list.getByRole('checkbox')).toHaveCount(3);
	await expect(list).not.toContainText('Audit every two years');
	await expect(source.locator('summary')).toContainText('Important entity · 0 of 3 selected');

	await source.getByRole('button', { name: `Select all in ${code} for Important entity` }).click();
	await expect(page.getByRole('status')).toHaveText('3 selected.');
	await expect(source.locator('summary')).toContainText('3 of 3 selected');
	await expect(page.getByTestId('selected-12 [important]')).toContainText('Important entity');
	await expect(page.getByTestId('selected-12 [essential]')).toHaveCount(0);

	// The choice is in the address: a reload keeps it; All roles shows the rest again.
	await page.reload();
	await expect(source.getByRole('link', { name: 'Important entity' })).toHaveAttribute(
		'aria-current',
		'true'
	);
	await expect(list.getByRole('checkbox')).toHaveCount(3);
	await source.getByRole('link', { name: 'All roles' }).click();
	await expect(list.getByRole('checkbox')).toHaveCount(4);
	await expect(source.locator('summary')).toContainText('3 of 4 selected');
});
