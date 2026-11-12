import { ADMIN, expect, loginAs, sampleCopy, seed, test } from '../helpers';

test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('event screen: mark held, evidence status with promise who and due, sorted open first (#52)', async ({
	page
}) => {
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/run/events`);
	await page
		.getByTestId('run-event-Access and identity interview')
		.getByRole('link', { name: 'Open event' })
		.click();
	await expect(page.getByTestId('event-title')).toHaveText('Access and identity interview');
	await page.getByRole('button', { name: 'Mark held' }).click();
	await expect(page.getByTestId('event-status')).toHaveText('Held');

	const rows = page.getByRole('list', { name: 'Planned evidence' }).getByRole('listitem');
	await expect(rows).toHaveCount(2);
	await page.getByLabel('Status of Access review records for the last two cycles').selectOption('received');
	await expect(page.getByTestId('evidence-Access review records for the last two cycles')).toHaveAttribute(
		'data-status',
		'received'
	);
	// Received moves to the end: open items first.
	await expect(rows.first()).toContainText('Leaver list for 2026');

	await page.getByLabel('Status of Leaver list for 2026 with account disable dates').selectOption('promised');
	await page.getByLabel('Promised by').fill('Head of IT');
	await page.getByLabel('Due').fill('2026-11-20');
	await page.getByRole('button', { name: 'Save promise' }).click();
	await expect(page.getByTestId('evidence-Leaver list for 2026 with account disable dates')).toContainText(
		'promised by Head of IT, due 2026-11-20'
	);
});

test('notes: "/" commands and "@" mentions by keyboard; a promise sets evidence promised; an unknown document is recorded as mentioned (#53)', async ({
	page
}) => {
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/run/events/${e.events[0]!.id}`);
	const note = page.getByLabel('Note', { exact: true });

	// Plain note with a requirement mention containing spaces in its title search.
	await note.click();
	await note.pressSequentially('Reviews twice a year @access con');
	await expect(page.getByRole('listbox', { name: 'Mentions' })).toBeVisible();
	await page.keyboard.press('Enter');
	await expect(note).toHaveValue(/Reviews twice a year @Art\. 21\(2\)\(i\) $/);
	await note.press('Enter');
	await expect(page.getByTestId('note')).toHaveCount(1);
	await expect(page.getByTestId('note').first()).toContainText('00:00');

	// A promise mentioning a role and planned evidence.
	await note.pressSequentially('/prom');
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('note-type')).toHaveText('Promise');
	await note.pressSequentially('@head');
	await page.keyboard.press('Enter');
	await note.pressSequentially('will send the @leaver list');
	await page.keyboard.press('Enter');
	await note.pressSequentially('by 2026-11-20');
	await note.press('Enter');
	await expect(page.getByRole('status')).toContainText('set to promised by Head of IT');
	await expect(page.getByTestId('evidence-Leaver list for 2026 with account disable dates')).toContainText(
		'promised by Head of IT (Ilze Kalniņa), due 2026-11-20'
	);

	// A suspected issue, and a document named but not received.
	await note.pressSequentially('/issue');
	await page.keyboard.press('Enter');
	await note.pressSequentially('no H1 review, they use an /doc');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Onboarding checklist');
	await expect(page.getByRole('option', { name: /New document “Onboarding checklist”/ })).toBeVisible();
	await page.keyboard.press('Enter');
	await note.press('Enter');
	await expect(page.getByRole('status')).toContainText(
		'Onboarding checklist recorded as mentioned, not received'
	);
	await expect(page.getByTestId('note').nth(2)).toContainText('Suspected issue');
	await page.goto(`/e/${e.id}/setup/documents`);
	await expect(page.getByTestId('document-Onboarding checklist')).toContainText('Mentioned, not received');
});

test('notes: touch works too, choosing from the menu by tapping (#53)', async ({ page }) => {
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/run/events/${e.events[0]!.id}`);
	const note = page.getByLabel('Note', { exact: true });
	await note.click();
	await note.pressSequentially('/');
	await page.getByRole('option', { name: /\/person/ }).click();
	await note.pressSequentially('ware');
	await page.getByRole('option', { name: /Warehouse manager/ }).click();
	await expect(note).toHaveValue('@Warehouse manager ');
	await note.pressSequentially('joins next time');
	await page.getByRole('button', { name: 'Save note' }).click();
	await expect(page.getByTestId('note')).toContainText('Warehouse manager');
});

test('capture files, link them to evidence with sufficiency; the Inbox lists what is not linked (#54, #55)', async ({
	page
}) => {
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/run/events/${e.events[0]!.id}`);
	await page.locator('input[name="files"]:not([capture])').setInputFiles([
		{
			name: 'leavers-2026.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from('name,left,disabled\nA,2026-03-01,2026-03-01\n')
		},
		{ name: 'whiteboard.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }
	]);
	await expect(page.getByRole('status')).toHaveText('2 files added.');

	await page.goto(`/e/${e.id}/run/inbox`);
	await expect(page.getByTestId('inbox-leavers-2026.csv')).toBeVisible();
	await expect(page.getByTestId('inbox-whiteboard.jpg')).toBeVisible();

	await page.goto(`/e/${e.id}/run/events/${e.events[0]!.id}`);
	const csv = page.getByTestId('artifact-leavers-2026.csv');
	await csv.getByRole('button', { name: 'Link to evidence' }).click();
	await csv
		.getByLabel('Planned evidence it shows')
		.selectOption({ label: 'Leaver list for 2026 with account disable dates' });
	await csv.getByLabel('Where (page, row, time)').fill('rows 2-41');
	await csv.getByLabel('Sufficiency').selectOption('partial');
	await csv.getByRole('button', { name: 'Link', exact: true }).click();
	await expect(csv.getByTestId('link')).toContainText('Partly supports');
	await expect(page.getByTestId('evidence-Leaver list for 2026 with account disable dates')).toHaveAttribute(
		'data-status',
		'partial'
	);
	// One artifact can support several items.
	await csv.getByRole('button', { name: 'Link to evidence' }).click();
	await csv
		.getByLabel('Planned evidence it shows')
		.selectOption({ label: 'Access review records for the last two cycles' });
	await csv.getByRole('button', { name: 'Link', exact: true }).click();
	await expect(csv.getByTestId('link')).toHaveCount(2);
	await expect(page.getByTestId('evidence-Access review records for the last two cycles')).toHaveAttribute(
		'data-status',
		'received'
	);

	await page.goto(`/e/${e.id}/run/inbox`);
	await expect(page.getByTestId('inbox-leavers-2026.csv')).toHaveCount(0);
	await expect(page.getByTestId('inbox-whiteboard.jpg')).toBeVisible();
});
