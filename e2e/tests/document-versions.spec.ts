import { ADMIN, createEngagement, expect, loginAs, sampleCopy, seed, test, unique } from '../helpers';
import { call, createToken, mcpClient } from '../mcp-helpers';

/** #76: internal requirements when the auditee's documents change. */
test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('rejecting an AI change to an accepted internal requirement brings the accepted version back', async ({
	page,
	baseURL
}) => {
	const e = await sampleCopy(page.request);
	const client = await mcpClient(baseURL!, await createToken(page, 'Versions test'));
	await call(client, 'upsert_internal_requirements', {
		engagement_id: e.id,
		requirements: [{ title: 'Leavers disabled within a day', quote: 'Disabled within one working day.' }]
	});
	await page.goto(`/e/${e.id}/setup/documents`);
	const proposedList = page.getByRole('list', { name: 'Proposed internal requirements' });
	const card = proposedList.getByRole('article').filter({ hasText: 'Leavers disabled within a day' });
	const ref = (await card.locator('.au-ref').first().textContent())!.split(' ')[0]!;
	await card.getByRole('button', { name: `Accept ${ref}` }).click();
	await expect(page.getByRole('list', { name: 'Internal requirements' })).toContainText(
		'Leavers disabled within a day'
	);

	await call(client, 'upsert_internal_requirements', {
		engagement_id: e.id,
		requirements: [
			{ ref, title: 'Leavers disabled within a week', quote: 'Disabled within five working days.' }
		]
	});
	await client.close();
	await page.reload();
	const changed = proposedList.getByRole('article').filter({ hasText: 'Leavers disabled within a week' });
	await expect(changed.getByTestId('internal-was')).toContainText('Changes an accepted requirement. Was:');
	await expect(changed.getByTestId('internal-was')).toContainText('Leavers disabled within a day');
	await expect(changed.getByTestId('internal-was')).toContainText('“Disabled within five working days.”');

	await changed.getByRole('button', { name: `Reject ${ref}` }).click();
	await expect(page.getByText('Change rejected; the accepted version is back.')).toBeVisible();
	await expect(proposedList).toHaveCount(0);
	const accepted = page.getByRole('list', { name: 'Internal requirements' });
	await expect(accepted).toContainText('Leavers disabled within a day');
	await expect(accepted).not.toContainText('within a week');
});

test('Upload new version keeps the old document, marked replaced, and refuses the same file', async ({
	page
}) => {
	const e = await sampleCopy(page.request);
	const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
	await page.goto(`/e/${e.id}/setup/documents`);
	await page.getByLabel('Upload documents').setInputFiles(file('access-v1.txt', 'Reviews every 12 months.'));
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByText('1 document added.')).toBeVisible();

	const docs = page.getByRole('list', { name: 'Documents' });
	await page.getByRole('button', { name: 'Upload new version of access-v1.txt' }).click();
	// The same file is refused.
	await page
		.getByLabel('New version of access-v1.txt')
		.setInputFiles(file('copy.txt', 'Reviews every 12 months.'));
	await page.getByRole('button', { name: 'Upload new version', exact: true }).click();
	await expect(page.getByRole('alert')).toHaveText(
		'This is the same file as access-v1.txt; nothing changed.'
	);

	await page
		.getByLabel('New version of access-v1.txt')
		.setInputFiles(file('access-v2.txt', 'Reviews every 6 months.'));
	await page.getByRole('button', { name: 'Upload new version', exact: true }).click();
	await expect(page.getByText('access-v2.txt added as the new version.')).toBeVisible();
	await expect(page.getByTestId('document-access-v2.txt')).toContainText('replaces access-v1.txt');
	await expect(page.getByTestId('document-access-v1.txt')).toHaveCount(0);

	await page.getByLabel('Show replaced versions (1)').check();
	const old = page.getByTestId('document-access-v1.txt');
	await expect(old).toContainText('Replaced by access-v2.txt');
	await expect(old.getByRole('button', { name: /Upload new version/ })).toHaveCount(0);
	await expect(docs.getByRole('article').filter({ hasText: 'access-v' })).toHaveCount(2);
});

test('a new version rechecks the internal requirements: unchanged ones move, the rest wait for review', async ({
	page
}) => {
	const e = await sampleCopy(page.request);
	const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
	await page.goto(`/e/${e.id}/setup/documents`);
	await page
		.getByLabel('Upload documents')
		.setInputFiles(
			file(
				'pw-v1.txt',
				'3 Passwords\n3.1 Length\nPasswords have at least 8 characters.\n3.2 Sharing\nPasswords are never shared.\n'
			)
		);
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByText('1 document added.')).toBeVisible();

	for (const [title, quote, section] of [
		['Minimum password length', 'Passwords have at least 8 characters.', '3.1'],
		['No shared passwords', 'Passwords are never shared.', '3.2']
	]) {
		await page.getByRole('button', { name: 'Add internal requirement' }).click();
		await page.getByLabel('Requirement', { exact: true }).fill(title!);
		await page.getByLabel('Quote in the original language (optional)').fill(quote!);
		await page.getByLabel('Document', { exact: true }).selectOption({ label: 'pw-v1.txt' });
		await page.getByLabel('Section (optional)').fill(section!);
		await page.getByRole('button', { name: 'Add internal requirement' }).click();
		await expect(page.getByText('Internal requirement added.')).toBeVisible();
	}

	await page.getByRole('button', { name: 'Upload new version of pw-v1.txt' }).click();
	await page
		.getByLabel('New version of pw-v1.txt')
		.setInputFiles(
			file(
				'pw-v2.txt',
				'5 Passwords\n5.1 Length\nPasswords have at least 14 characters.\n5.2 Sharing\nPasswords are never shared.\n5.3 Managers\nA password manager is used.\n'
			)
		);
	await page.getByRole('button', { name: 'Upload new version', exact: true }).click();
	await expect(
		page.getByText(
			'pw-v2.txt added as the new version. Internal requirements checked against it: 1 unchanged, 1 needs review.'
		)
	).toBeVisible();

	const accepted = page.getByRole('list', { name: 'Internal requirements', exact: true });
	await expect(accepted).toContainText('No shared passwords');
	await expect(accepted).toContainText('pw-v2.txt § 5.2 · quote found in this version');

	const review = page.getByRole('list', { name: 'Internal requirements to review' });
	const card = review.getByRole('article').filter({ hasText: 'Minimum password length' });
	await expect(card.getByTestId('review-compare')).toContainText('“Passwords have at least 8 characters.”');
	await expect(card.getByTestId('review-compare')).toContainText('Passwords have at least 14 characters');
	await expect(page.getByTestId('open-sections')).toContainText('5.3 Managers');

	await card.getByRole('button', { name: /^Use the new passage for / }).click();
	await expect(page.getByText(/kept\.$/)).toBeVisible();
	await expect(review).toHaveCount(0);
	await expect(
		accepted.getByTestId(/^internal-/).filter({ hasText: 'Minimum password length' })
	).toContainText('pw-v2.txt § 5.1');
	await expect(accepted).toContainText('“Passwords have at least 14 characters”');
});

test('a banner names the new version with requirements to review; carry-over takes the newest version', async ({
	page
}) => {
	const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
	const auditee = unique('Carry client');
	// The first engagement: a policy with one accepted rule.
	await createEngagement(page, unique('Audit 2026'), auditee);
	const first = page.url();
	await page.goto(`${first}/setup/documents`);
	await page
		.getByLabel('Upload documents')
		.setInputFiles(file('backup-v1.txt', '2 Backups\n2.1 Daily\nBackups run every night.\n'));
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByText('1 document added.')).toBeVisible();
	await page.getByRole('button', { name: 'Add internal requirement' }).click();
	await page.getByLabel('Requirement', { exact: true }).fill('Nightly backups');
	await page.getByLabel('Quote in the original language (optional)').fill('Backups run every night.');
	await page.getByLabel('Document', { exact: true }).selectOption({ label: 'backup-v1.txt' });
	await page.getByLabel('Section (optional)').fill('2.1');
	await page.getByRole('button', { name: 'Add internal requirement' }).click();
	await expect(page.getByText('Internal requirement added.')).toBeVisible();

	// The next engagement with the same auditee carries the rule over, then gets the new version.
	await createEngagement(page, unique('Audit 2027'), auditee);
	await page.goto(`${page.url()}/setup/documents`);
	await page.getByTestId('carry-over').getByRole('button', { name: 'Carry them over' }).click();
	await expect(page.getByRole('list', { name: 'Internal requirements', exact: true })).toContainText(
		'carried over'
	);
	const carried = page.getByTestId('carried-backup-v1.txt');
	await expect(carried).toContainText('1 internal requirement carried over');
	await carried.getByRole('button', { name: 'Upload new version of backup-v1.txt' }).click();
	await page
		.getByLabel('New version of backup-v1.txt')
		.setInputFiles(
			file('backup-v2.txt', '3 Backups\n3.1 Daily\nBackups run every night and are tested monthly.\n')
		);
	await page.getByRole('button', { name: 'Upload new version', exact: true }).click();
	await expect(
		page.getByText(
			'backup-v2.txt added as the new version. Internal requirements checked against it: 1 needs review.'
		)
	).toBeVisible();
	await expect(page.getByTestId('carried-backup-v1.txt')).toHaveCount(0);
	await expect(page.getByTestId('review-banner')).toContainText(
		'1 internal requirement needs review after a new version of backup-v1.txt.'
	);
	const review = page.getByRole('list', { name: 'Internal requirements to review' });
	const card = review.getByRole('article').filter({ hasText: 'Nightly backups' });
	await expect(card).toContainText('backup-v2.txt');
	await card.getByRole('button', { name: /^Use the new passage for / }).click();
	await expect(page.getByTestId('review-banner')).toHaveCount(0);
	const own = page.getByRole('list', { name: 'Internal requirements', exact: true });
	await expect(own).toContainText('backup-v2.txt § 3.1');
	await expect(own).not.toContainText('carried over');

	// The first engagement keeps its own record of the old version.
	await page.goto(`${first}/setup/documents`);
	const before = page.getByRole('list', { name: 'Internal requirements', exact: true });
	await expect(before).toContainText('backup-v1.txt § 2.1');
	await expect(page.getByTestId('document-backup-v1.txt')).not.toContainText('Replaced by');
});
