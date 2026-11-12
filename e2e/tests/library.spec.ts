import { expect, test, type Page } from '@playwright/test';
import { AUDITOR, loginAs, seed, unique } from '../helpers';

test.beforeEach(async ({ page }) => {
	await seed(page.request); // includes the bundled NIS 2 Article 21 source
	await loginAs(page, AUDITOR);
});

/** Import a YAML source by pasting it on the Library screen. */
async function importYaml(page: Page, yaml: string) {
	await page.goto('/library');
	await page.getByRole('button', { name: 'Import source' }).click();
	await page.getByLabel('Or paste the YAML').fill(yaml);
	await page.getByRole('button', { name: 'Import source' }).click();
	await expect(page.getByTestId('import-report')).toBeVisible();
}

test('browse NIS 2 as a tree and open a requirement in the item sheet (#25)', async ({ page }) => {
	await page.goto('/library');
	await page.getByTestId('sources').getByRole('link', { name: 'NIS 2 Directive (EU) 2022/2555' }).click();
	await expect(page).toHaveURL('/library?source=nis2');
	const tree = page.getByTestId('source-tree');
	await expect(tree).toContainText('Public EU law');
	const top = tree.locator('.au-tree > li');
	await expect(top).toHaveCount(1);
	const points = tree.locator('.au-tree > li > ul > li').nth(1).locator('> ul > li > a .au-ref');
	await expect(points).toHaveText([
		'Art. 21(2)(a)',
		'Art. 21(2)(b)',
		'Art. 21(2)(c)',
		'Art. 21(2)(d)',
		'Art. 21(2)(e)',
		'Art. 21(2)(f)',
		'Art. 21(2)(g)',
		'Art. 21(2)(h)',
		'Art. 21(2)(i)',
		'Art. 21(2)(j)'
	]);

	await tree.getByRole('link', { name: /Cryptography and encryption/ }).click();
	await expect(page).toHaveURL(/source=nis2&item=requirement:/);
	const sheet = page.getByTestId('item-sheet');
	await expect(sheet.getByRole('heading', { name: 'Cryptography and encryption' })).toBeVisible();
	await expect(sheet).toContainText('policies and procedures regarding the use of cryptography');
	await expect(sheet).toContainText('NIS 2 Directive (EU) 2022/2555');
	await sheet.getByRole('button', { name: /Art\. 21\(2\) · Minimum measures/ }).click();
	await expect(sheet.getByRole('heading', { name: 'Minimum measures' })).toBeVisible();
	await sheet.getByRole('button', { name: 'Back' }).click();
	await expect(sheet.getByRole('heading', { name: 'Cryptography and encryption' })).toBeVisible();
});

test('full-text search over code, title and text (#25)', async ({ page }) => {
	await page.goto('/library');
	await page.getByLabel('Search requirements').fill('encryption');
	await page.getByRole('button', { name: 'Search' }).click();
	const results = page.getByTestId('search-results');
	await expect(results.locator('.au-item')).toHaveCount(1);
	await expect(results).toContainText('Art. 21(2)(h)');
	await expect(results.locator('mark').first()).toHaveText(/encryption/i);

	await page.goto('/library?q=21(2)(b)');
	await expect(page.getByTestId('search-results')).toContainText('Incident handling');
	await page.getByTestId('search-results').getByRole('link', { name: 'Incident handling' }).click();
	await expect(
		page.getByTestId('item-sheet').getByRole('heading', { name: 'Incident handling' })
	).toBeVisible();
});

test('import a source from a YAML file; importing it again changes nothing (#26)', async ({ page }) => {
	const code = unique('policy');
	const yaml = `id: ${code}\ntitle: Test policy ${code}\ntype: standard\nlanguage: en\nlicence_note: Internal test\nrequirements:\n  - {id: "1", title: Scope}\n  - {id: "1.1", parent: "1", title: Applies to all staff}\n`;
	await page.goto('/library');
	await page.getByRole('button', { name: 'Import source' }).click();
	await page
		.getByLabel('YAML file')
		.setInputFiles({ name: `${code}.yaml`, mimeType: 'text/yaml', buffer: Buffer.from(yaml) });
	await page.getByRole('button', { name: 'Import source' }).click();
	const report = page.getByTestId('import-report');
	await expect(report).toContainText(`Imported Test policy ${code}`);
	await expect(report).toContainText('2 new, 0 changed, 0 restored, 0 unchanged');

	await page.getByRole('button', { name: 'Import source' }).click();
	await page
		.getByLabel('YAML file')
		.setInputFiles({ name: `${code}.yaml`, mimeType: 'text/yaml', buffer: Buffer.from(yaml) });
	await page.getByRole('button', { name: 'Import source' }).click();
	await expect(report).toContainText(`Updated Test policy ${code}`);
	await expect(report).toContainText('0 new, 0 changed, 0 restored, 2 unchanged');

	await report.getByRole('link', { name: `Open Test policy ${code}` }).click();
	await expect(page.getByTestId('source-tree').locator('.au-tree__row')).toHaveCount(2);
});

test('a broken file is refused with a reason and nothing is imported (#26)', async ({ page }) => {
	await page.goto('/library');
	await page.getByRole('button', { name: 'Import source' }).click();
	await page.getByLabel('Or paste the YAML').fill('id: broken\ntitle: Broken\nrequirements:\n  - {id: A}\n');
	await page.getByRole('button', { name: 'Import source' }).click();
	await expect(page.getByRole('alert')).toContainText('Requirement A has no title');
});

test('add a typed link by searching for the target; it shows from both ends and can be removed (#27)', async ({
	page
}) => {
	const code = unique('iso');
	await importYaml(
		page,
		`id: ${code}\ntitle: ISO sample ${code}\nlanguage: en\nrequirements:\n  - {id: A.5.18, title: Access rights ${code}}\n`
	);
	await page.goto('/library?source=nis2');
	await page
		.getByTestId('source-tree')
		.getByRole('link', { name: /Human resources security/ })
		.click();
	const sheet = page.getByTestId('item-sheet');
	await sheet.getByRole('tab', { name: /Links/ }).click();
	const links = sheet.getByTestId('requirement-links');
	await links.getByRole('button', { name: 'Add link' }).click();
	await links.getByLabel('This requirement').selectOption({ label: 'Implemented by' });
	await links.getByLabel('Find the other requirement').fill(`Access rights ${code}`);
	await links.getByRole('button', { name: new RegExp(`Access rights ${code}`) }).click();
	await links.getByLabel('Coverage').selectOption('partial');
	await links.getByRole('button', { name: 'Add link' }).click();

	const row = links.getByTestId('link-row');
	await expect(row).toHaveCount(1);
	await expect(links.getByRole('heading', { name: 'Implemented by' })).toBeVisible();
	await expect(row).toContainText('Partial coverage');
	await expect(sheet.getByRole('tab', { name: /Links/ })).toContainText('1');

	// The other end shows the link the other way round.
	await row.getByRole('button', { name: new RegExp(`Access rights ${code}`) }).click();
	await expect(sheet.getByRole('heading', { name: `Access rights ${code}` })).toBeVisible();
	await sheet.getByRole('tab', { name: /Links/ }).click();
	await expect(links.getByRole('heading', { name: 'Implements' })).toBeVisible();
	await expect(links.getByTestId('link-row')).toContainText('Human resources security');

	page.once('dialog', (d) => d.accept());
	await links.getByRole('button', { name: 'Remove link' }).click();
	await expect(links.getByTestId('link-row')).toHaveCount(0);
	await expect(links).toContainText('No links yet.');
});

test('guidance and criteria are edited on the requirement and versioned apart from its text (#28)', async ({
	page
}) => {
	const code = unique('crit');
	await importYaml(
		page,
		`id: ${code}\ntitle: Criteria test ${code}\nlanguage: en\nrequirements:\n  - {id: R1, title: Backups ${code}, text: Backups are taken.}\n`
	);
	await page.goto(`/library?source=${code}`);
	await page
		.getByTestId('source-tree')
		.getByRole('link', { name: new RegExp(`Backups ${code}`) })
		.click();
	const sheet = page.getByTestId('item-sheet');

	await sheet
		.getByLabel('How to audit this requirement')
		.fill('Ask for the backup log and one restore test.');
	await sheet.getByRole('button', { name: 'Save guidance' }).click();
	await expect(sheet).toContainText('Guidance version 1');
	await sheet
		.getByLabel('How to audit this requirement')
		.fill('Ask for the backup log and the last two restore tests.');
	await sheet.getByRole('button', { name: 'Save guidance' }).click();
	await expect(sheet).toContainText('Guidance version 2');

	const criteria = sheet.getByTestId('criteria');
	await criteria.getByLabel('New criterion').fill('Backups are restorable');
	await criteria.getByLabel('Expected evidence, one per line').fill('Restore test record\nBackup schedule');
	await criteria.getByRole('button', { name: 'Add criterion' }).click();
	await expect(criteria.locator('.au-criteria > li')).toHaveCount(1);
	await expect(criteria.locator('.au-evidence-list li')).toHaveText([
		'Restore test record',
		'Backup schedule'
	]);

	await criteria.getByRole('button', { name: 'Edit criterion' }).click();
	await criteria
		.locator('.au-criteria')
		.getByLabel('Expected evidence, one per line')
		.fill('Restore test record for two quarters');
	await criteria.getByRole('button', { name: 'Save criterion' }).click();
	await expect(criteria.locator('.au-evidence-list li')).toHaveText(['Restore test record for two quarters']);

	// The requirement itself is still version 1: guidance and criteria have their own history.
	await sheet.getByRole('tab', { name: /History/ }).click();
	await expect(sheet.getByTestId('history').locator('li')).toHaveCount(1);

	await sheet.getByRole('tab', { name: 'Details' }).click();
	page.once('dialog', (d) => d.accept());
	await criteria.getByRole('button', { name: 'Remove criterion' }).click();
	await expect(criteria).toContainText('No criteria yet.');
});

test('Latvian and English versions sit side by side and search finds either (#29)', async ({ page }) => {
	const code = unique('lang');
	await importYaml(
		page,
		`id: ${code}-en\ntitle: Lang test EN ${code}\nlanguage: en\nrequirements:\n  - {id: X1, title: Incident reporting ${code}, text: Report significant incidents.}\n`
	);
	await importYaml(
		page,
		`id: ${code}-lv\ntitle: Lang test LV ${code}\nlanguage: lv\nrequirements:\n  - id: X1\n    title: Incidentu ziņošana ${code}\n    text: Ziņo par būtiskiem incidentiem.\n    translation_of: {source: ${code}-en, id: X1}\n`
	);

	await page.goto(`/library?source=${code}-en`);
	await page
		.getByTestId('source-tree')
		.getByRole('link', { name: new RegExp(`Incident reporting ${code}`) })
		.click();
	const versions = page.getByTestId('item-sheet').getByTestId('translations');
	await expect(versions.locator('.au-version')).toHaveCount(2);
	await expect(versions).toContainText('EN');
	await expect(versions).toContainText('LV');
	await expect(versions).toContainText('Ziņo par būtiskiem incidentiem.');

	// Search finds the Latvian text, with or without diacritics, and the English one.
	await page.goto(`/library?q=zinosana ${code}`);
	await expect(page.getByTestId('search-results')).toContainText(`Incidentu ziņošana ${code}`);
	await page.goto(`/library?q=${code}`);
	await expect(page.getByTestId('search-results').locator('.au-item')).toHaveCount(2);
});

test('pair two requirements as translations from the item sheet (#29)', async ({ page }) => {
	const code = unique('pair');
	await importYaml(
		page,
		`id: ${code}-en\ntitle: Pair EN ${code}\nlanguage: en\nrequirements:\n  - {id: P1, title: Asset inventory ${code}}\n`
	);
	await importYaml(
		page,
		`id: ${code}-lv\ntitle: Pair LV ${code}\nlanguage: lv\nrequirements:\n  - {id: P1, title: Aktīvu uzskaite ${code}}\n`
	);
	await page.goto(`/library?source=${code}-lv`);
	await page
		.getByTestId('source-tree')
		.getByRole('link', { name: new RegExp(`Aktīvu uzskaite ${code}`) })
		.click();
	const sheet = page.getByTestId('item-sheet');
	const versions = sheet.getByTestId('translations');
	await expect(versions).toContainText('Only in LV.');
	await versions.getByRole('button', { name: 'Pair with a translation' }).click();
	await versions.getByLabel('Find the same requirement in another language').fill(`inventory ${code}`);
	await versions.getByRole('button', { name: new RegExp(`Asset inventory ${code}`) }).click();
	await expect(versions.locator('.au-version')).toHaveCount(2);
	await versions.getByRole('button', { name: 'Unpair' }).click();
	await expect(versions).toContainText('Only in LV.');
});

test('text typed before the page has loaded its scripts is kept', async ({ page }) => {
	// Hold the app's JavaScript back, type, then let the page hydrate.
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	await page.route('**/_app/immutable/**', async (route) => {
		await held;
		await route.continue();
	});
	await page.goto('/library', { waitUntil: 'commit' });
	await page.getByLabel('Search requirements').fill('encryption');
	release();
	await page.waitForFunction(
		() =>
			document.querySelector('#library-q') &&
			(window as unknown as { __sveltekit_dev?: unknown }) !== undefined
	);
	await page.waitForLoadState('networkidle');
	await expect(page.getByLabel('Search requirements')).toHaveValue('encryption');
	await page.getByRole('button', { name: 'Search' }).click();
	await expect(page.getByTestId('search-results')).toContainText('Art. 21(2)(h)');
});
