import { expect, test, type Page } from '@playwright/test';
import { makePdf } from '../../tests/fixtures/make-docs';
import { ADMIN, createEngagement, loginAs, seed, unique } from '../helpers';
import { call, createToken, mcpClient } from '../mcp-helpers';

test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

const tab = (page: Page, name: string) =>
	page.getByRole('navigation', { name: 'Set-up tabs' }).getByRole('link', { name }).click();

test('create an engagement: Home shows eight phases and continues to the first open one (#36)', async ({
	page
}) => {
	const { id, name, auditee } = await createEngagement(page);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
	const phases = page.getByTestId('phases').getByRole('listitem');
	await expect(phases).toHaveCount(8);
	await expect(phases.nth(0)).toContainText('Define the engagement');
	await expect(phases.nth(0)).toContainText(auditee);
	await expect(phases.nth(1)).toContainText('None selected');
	await expect(phases.nth(1).getByRole('link')).toHaveAttribute('aria-current', 'step');
	await page.getByTestId('continue').click();
	await expect(page).toHaveURL(`/e/${id}/setup/requirements`);
});

test('engagement details are editable, each save a version (#36)', async ({ page }) => {
	const { id } = await createEngagement(page);
	await page.getByRole('button', { name: 'Edit details' }).click();
	await page.getByLabel('Description').fill('Annual NIS 2 audit');
	await page.getByLabel('Report language').selectOption('lv');
	await page.getByRole('button', { name: 'Save details' }).click();
	await expect(page.getByRole('status')).toHaveText('Engagement details saved.');
	const details = page.getByTestId('engagement-details');
	await expect(details).toContainText('Annual NIS 2 audit');
	await expect(details).toContainText('report LV');
	await expect(details).toContainText('v2');
	await page.goto(`/e/${id}?item=engagement:${id}&tab=history`);
	await expect(page.getByTestId('history')).toContainText('Changed');
});

test('the engagement switcher keeps the current destination (#36)', async ({ page }) => {
	const mine = await createEngagement(page);
	const sample = (await seed(page.request)).engagement;
	await page.goto(`/e/${sample.id}/setup/risks`);
	await page.getByTestId('engagement-switcher').click();
	await expect(page).toHaveURL('/?at=setup');
	await expect(page.getByText('Choose an engagement to open its Set-up.')).toBeVisible();
	await page.getByRole('link', { name: mine.name, exact: true }).click();
	await expect(page).toHaveURL(`/e/${mine.id}/setup/requirements`);
});

test('select requirements, pin them and see assessment units follow scopes (#37, #38)', async ({ page }) => {
	const { id } = await createEngagement(page);
	await page.goto(`/e/${id}/setup/requirements`);
	const nis2 = page.getByRole('list', { name: /NIS 2 .* requirements/ });
	await nis2.getByLabel(/Art\. 21\(2\)\(b\)/).check();
	await nis2.getByLabel(/Art\. 21\(2\)\(i\)/).check();
	await page.getByRole('button', { name: 'Select ticked' }).click();
	await expect(page.getByRole('status')).toHaveText('2 selected.');
	await expect(page.getByTestId('units-count')).toHaveText('2 selected · 2 assessment units');
	await expect(page.getByTestId('selected-Art. 21(2)(b)')).toContainText('pinned v1');

	// Multiple scopes: add one, handle (i) per scope, see the units grow; removing the scope asks first.
	await tab(page, 'Scopes');
	await page.getByLabel(/Multiple scopes/).check();
	await expect(page.getByRole('status')).toHaveText('Multiple scopes.');
	await page.getByLabel('Scope name').fill('Warehouse');
	await page.getByRole('button', { name: 'Add scope' }).click();
	await expect(page.getByTestId('scope-Warehouse')).toBeVisible();
	await tab(page, 'Requirements');
	await page.getByTestId('handling-Art. 21(2)(i)').selectOption('per_scope');
	await expect(page.getByTestId('units-count')).toHaveText('2 selected · 3 assessment units');
	await tab(page, 'Scopes');
	await expect(page.getByTestId('units-count')).toContainText('3 assessment units');
	await page.getByRole('button', { name: 'Remove Warehouse' }).click();
	await expect(page.getByTestId('confirm-remove')).toContainText('It has 1 assessment unit');
	await page.getByRole('button', { name: 'Remove scope' }).click();
	await expect(page.getByTestId('scope-Warehouse')).toHaveCount(0);
	await expect(page.getByTestId('units-count')).toContainText('2 assessment units');

	// Select all in a source, and deselect one.
	await tab(page, 'Requirements');
	await page.getByRole('button', { name: 'Select all in nis2' }).click();
	await expect(page.getByTestId('units-count')).toHaveText('13 selected · 13 assessment units');
	await page.getByRole('button', { name: 'Deselect Art. 21(2)(b)' }).click();
	await expect(page.getByTestId('units-count')).toHaveText('12 selected · 12 assessment units');
});

test('auditee description and roles; only the role is required (#39)', async ({ page }) => {
	const { id } = await createEngagement(page);
	await page.goto(`/e/${id}/setup/auditee`);
	await page.getByRole('button', { name: 'Edit description' }).click();
	await page.getByLabel('Description').fill('Logistics company, two sites.');
	await page.getByRole('button', { name: 'Save description' }).click();
	await expect(page.getByTestId('auditee-description')).toHaveText('Logistics company, two sites.');

	await page.getByRole('button', { name: 'Add person' }).click();
	await page.getByRole('button', { name: 'Add person' }).click(); // submit with no role
	await expect(page.getByLabel('Role', { exact: true })).toBeFocused();
	await page.getByLabel('Role', { exact: true }).fill('Head of IT');
	await page.getByRole('button', { name: 'Add person' }).click();
	await expect(page.getByTestId('person-Head of IT')).toContainText('No name yet');
	await page.getByRole('button', { name: 'Edit Head of IT' }).click();
	await page.getByLabel('Name (optional)').fill('Ilze Kalniņa');
	await page.getByRole('button', { name: 'Save person' }).click();
	await expect(page.getByTestId('person-Head of IT')).toContainText('Ilze Kalniņa');
});

test('risks: empty state, searchable checklist that keeps ticked items, criticality follows (#40)', async ({
	page
}) => {
	const { id } = await createEngagement(page);
	await page.goto(`/e/${id}/setup/requirements`);
	await page.getByRole('button', { name: 'Select all in nis2' }).click();
	await expect(page.getByTestId('units-count')).toContainText('13 selected');

	await tab(page, 'Risks');
	await expect(page.getByTestId('risks-empty')).toContainText('risk register');
	await page.getByRole('button', { name: 'Add risk' }).click();
	await page.getByLabel('Risk', { exact: true }).fill('Leaver accounts stay active');
	await page.getByLabel('Level').selectOption('high');
	const checklist = page.getByTestId('requirement-checklist');
	await checklist.getByLabel('Search requirements').fill('access control');
	await checklist.getByLabel(/Art\. 21\(2\)\(i\)/).check();
	await checklist.getByLabel('Search requirements').fill('multi-factor');
	await expect(checklist.getByLabel(/Art\. 21\(2\)\(i\)/)).toBeVisible(); // ticked stays visible
	await expect(checklist.getByLabel(/Art\. 21\(2\)\(b\)/)).toBeHidden();
	await checklist.getByLabel(/Art\. 21\(2\)\(j\)/).check();
	await page.getByRole('button', { name: 'Add risk' }).click();
	await expect(page.getByTestId('risk-Leaver accounts stay active')).toContainText(
		'Affects Art. 21(2)(i), Art. 21(2)(j)'
	);

	await tab(page, 'Requirements');
	await expect(page.getByTestId('selected-Art. 21(2)(i)')).toContainText('High criticality');
	await expect(page.getByTestId('selected-Art. 21(2)(i)')).toContainText(
		'From risks: Leaver accounts stay active'
	);
	await expect(page.getByTestId('selected-Art. 21(2)(b)')).toContainText('Medium criticality');
	await page.getByTestId('criticality-Art. 21(2)(b)').selectOption('low');
	await expect(page.getByTestId('selected-Art. 21(2)(b)')).toContainText('Low criticality');
	await expect(page.getByTestId('selected-Art. 21(2)(b)')).toContainText('Set by the auditor');
});

test('documents: upload several at once, duplicates, metadata, mentioned, download (#41)', async ({
	page
}) => {
	const { id } = await createEngagement(page);
	await page.goto(`/e/${id}/setup/documents`);
	const policy = {
		name: 'access-control-policy.pdf',
		mimeType: 'application/pdf',
		buffer: Buffer.from(makePdf(['Access control policy', 'Leavers are disabled within one working day.']))
	};
	const notes = {
		name: 'notes.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from(`Backups are tested yearly. ${unique('n')}`)
	};
	await page.getByLabel('Upload documents').setInputFiles([policy, notes]);
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByRole('status')).toHaveText('2 documents added.');
	const card = page.getByTestId('document-access-control-policy.pdf');
	await expect(card).toContainText('Kind not set');
	await expect(card).toContainText('Text read');

	await page.getByLabel('Upload documents').setInputFiles([{ ...policy, name: 'copy.pdf' }]);
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByRole('status')).toContainText(
		'copy.pdf is already here as access-control-policy.pdf'
	);

	await card.getByRole('button', { name: /Edit/ }).click();
	await card.getByLabel('Title').fill('Access control policy');
	await card.getByLabel('Kind').selectOption('policy');
	await card.getByLabel('Version').fill('2.1');
	await card.getByLabel('Approved on').fill('2026-02-10');
	await card.getByRole('button', { name: 'Save document' }).click();
	await expect(card).toContainText('Access control policy');
	await expect(card).toContainText('Policy · access-control-policy.pdf');
	await expect(card).toContainText('approved 2026-02-10');

	const download = page.waitForEvent('download');
	await card.getByRole('link', { name: 'Download' }).click();
	expect((await download).suggestedFilename()).toBe('access-control-policy.pdf');

	await page.getByRole('button', { name: 'Record a mentioned document' }).click();
	await page.getByLabel('Document name').fill('Supplier register');
	await page.getByRole('button', { name: 'Record document' }).click();
	await expect(page.getByTestId('document-Supplier register')).toContainText('Mentioned, not received');
});

test('internal requirements: add by hand with what it implements; carry-over offered to the next engagement (#42)', async ({
	page
}) => {
	const auditee = unique('Client');
	const first = await createEngagement(page, unique('2025 audit'), auditee);
	await page.goto(`/e/${first.id}/setup/requirements`);
	await page.getByRole('button', { name: 'Select all in nis2' }).click();
	await tab(page, 'Documents');
	await page.getByRole('button', { name: 'Add internal requirement' }).click();
	await page.getByLabel('Requirement', { exact: true }).fill('Leaver accounts disabled within one day');
	await page.getByLabel('Section (optional)').fill('4.2');
	const implement = page.getByLabel('Implements');
	await implement.selectOption(
		(await implement.locator('option', { hasText: 'Art. 21(2)(i)' }).getAttribute('value'))!
	);
	await page.getByRole('button', { name: 'Add internal requirement' }).click();
	const int1 = page.getByRole('list', { name: 'Internal requirements' }).getByRole('article').first();
	await expect(int1).toContainText('Added by hand § 4.2');
	await expect(int1).toContainText('Implements Art. 21(2)(i) (partial)');
	await page.goto(`/e/${first.id}`);
	await expect(page.getByTestId('phases').getByRole('listitem').nth(4)).toContainText('1 confirmed');

	const next = await createEngagement(page, unique('2026 audit'), auditee);
	await page.goto(`/e/${next.id}/setup/documents`);
	await expect(page.getByTestId('carry-over')).toContainText(
		'1 confirmed internal requirement from earlier engagements'
	);
	await page.getByRole('button', { name: 'Carry them over' }).click();
	await expect(page.getByRole('list', { name: 'Internal requirements' })).toContainText('carried over');
	await page.goto(`/e/${next.id}?item=engagement:${next.id}&tab=history`);
	await expect(page.getByTestId('history')).toContainText('Carry over internal requirements');

	// Another auditee's engagement neither lists it nor opens it.
	const other = await createEngagement(page);
	const intId = await page.request
		.get(`/e/${first.id}/setup/documents`)
		.then(async (r) => (await r.text()).match(/item=requirement:([0-9a-f-]{36})/)?.[1]);
	await page.goto(`/e/${other.id}/setup/documents?item=requirement:${intId}`);
	await expect(page.getByTestId('item-sheet')).toContainText('belongs to another auditee');
	await expect(page.getByRole('list', { name: 'Internal requirements' })).toHaveCount(0);
});

test('Claude proposes roles and internal requirements through MCP; the auditor reviews them in the UI (#43, #44)', async ({
	page,
	baseURL
}) => {
	const { id } = await createEngagement(page);
	await page.goto(`/e/${id}/setup/requirements`);
	await page.getByRole('button', { name: 'Select all in nis2' }).click();
	await expect(page.getByTestId('units-count')).toContainText('13 selected');
	const token = await createToken(page, unique('Claude'));
	const client = await mcpClient(baseURL!, token);

	// What audit-document-analysis and audit-role-discovery do, with the text an auditor uploaded.
	const doc = await call(client, 'register_artifact', {
		engagement_id: id,
		title: 'Access control policy',
		kind: 'policy',
		text: '2.2 The Head of IT approves administrator access.\n4.2 Accounts of leavers are disabled within one working day.\n5.1 Remote access uses multi-factor authentication.'
	});
	const page1 = await call(client, 'get_artifact_text', { engagement_id: id, artifact_id: doc.id });
	expect(page1.text).toContain('one working day');
	await call(client, 'upsert_people', {
		engagement_id: id,
		people: [
			{
				role: 'Head of IT',
				responsibilities: ['Approves administrator access'],
				source_document: 'Access control policy',
				source_section: '2.2'
			}
		]
	});
	await call(client, 'upsert_internal_requirements', {
		engagement_id: id,
		artifact_id: doc.id,
		requirements: [
			{
				title: 'Leaver accounts disabled within one working day',
				quote: 'Accounts of leavers are disabled within one working day.',
				section: '4.2',
				implements: [{ requirement: 'nis2:Art. 21(2)(i)', coverage: 'partial' }]
			},
			{
				title: 'Multi-factor authentication for remote access',
				section: '5.1',
				implements: [{ requirement: 'nis2:Art. 21(2)(j)', coverage: 'partial' }]
			}
		]
	});
	await client.close();

	await page.goto(`/e/${id}/setup/auditee`);
	const role = page.getByTestId('person-Head of IT');
	await expect(role).toHaveAttribute('data-state', 'proposed');
	await expect(role).toContainText('From Access control policy § 2.2');
	await expect(role).toContainText('Approves administrator access');
	await role.getByRole('button', { name: 'Accept Head of IT' }).click();
	await expect(page.getByRole('status')).toHaveText('Head of IT accepted.');
	await expect(page.getByTestId('person-Head of IT')).toHaveAttribute('data-state', 'default');

	await tab(page, 'Documents');
	const proposals = page.getByRole('list', { name: 'Proposed internal requirements' });
	await expect(proposals.getByRole('article')).toHaveCount(2);
	await expect(proposals).toContainText('Access control policy § 4.2');
	await expect(proposals).toContainText('“Accounts of leavers are disabled within one working day.”');
	await page.getByRole('button', { name: 'Reject INT-2' }).click();
	await expect(page.getByRole('status')).toHaveText('Internal requirement rejected.');
	await page.getByRole('button', { name: 'Accept all' }).click();
	await expect(page.getByRole('status')).toHaveText('1 proposed internal requirement accepted.');
	await expect(page.getByRole('list', { name: 'Internal requirements' })).toContainText(
		'Implements Art. 21(2)(i) (partial)'
	);
	await page
		.getByTestId('internal-INT-1')
		.getByRole('link', { name: 'Leaver accounts disabled within one working day' })
		.click();
	const sheet = page.getByTestId('item-sheet');
	await sheet.getByRole('tab', { name: /History/ }).click();
	await expect(sheet.getByTestId('history')).toContainText('Claude on behalf of');
});
