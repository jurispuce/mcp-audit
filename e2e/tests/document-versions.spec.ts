import { ADMIN, expect, loginAs, sampleCopy, seed, test } from '../helpers';
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
