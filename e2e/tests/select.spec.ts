import { ADMIN, expect, loginAs, sampleCopy, seed, test } from '../helpers';
import { call, createToken, mcpClient } from '../mcp-helpers';

/** Accepting or rejecting several proposals at once, next to the per-item buttons. */
test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('select several proposals and accept or reject them together (roles, internal requirements, the review list)', async ({
	page,
	baseURL
}) => {
	const e = await sampleCopy(page.request);
	const client = await mcpClient(baseURL!, await createToken(page, 'Select test'));
	await call(client, 'upsert_people', {
		engagement_id: e.id,
		people: [{ role: 'Role A' }, { role: 'Role B' }, { role: 'Role C' }]
	});
	await call(client, 'upsert_internal_requirements', {
		engagement_id: e.id,
		requirements: [{ title: 'Rule one' }, { title: 'Rule two' }, { title: 'Rule three' }]
	});
	await call(client, 'upsert_events', {
		engagement_id: e.id,
		events: [{ title: 'Drafted event X' }, { title: 'Drafted event Y' }]
	});
	await client.close();

	// Roles: two of three, the third stays proposed.
	await page.goto(`/e/${e.id}/setup/auditee`);
	const bar = page.getByTestId('selection-bar');
	await expect(bar).toContainText('Select roles to review them together');
	await expect(bar.getByRole('button', { name: 'Accept selected' })).toBeDisabled();
	await page.getByLabel('Select Role A').check();
	await page.getByLabel('Select Role B').check();
	await expect(bar).toContainText('2 of 3 selected');
	await bar.getByRole('button', { name: 'Accept selected' }).click();
	await expect(page.getByTestId('person-Role A')).toHaveAttribute('data-state', 'default');
	await expect(page.getByTestId('person-Role C')).toHaveAttribute('data-state', 'proposed');

	// Internal requirements: Select all, then Accept selected.
	await page.goto(`/e/${e.id}/setup/documents`);
	const docs = page.getByTestId('selection-bar');
	await docs.getByRole('button', { name: 'Select all 3' }).click();
	await expect(docs).toContainText('3 of 3 selected');
	await docs.getByRole('button', { name: 'Accept selected' }).click();
	await expect(page.getByRole('list', { name: 'Proposed internal requirements' })).toHaveCount(0);
	await expect(page.getByRole('list', { name: 'Internal requirements' })).toContainText('Rule three');

	// The review list mixes types: reject a role and an event together.
	await page.goto(`/e/${e.id}/proposals`);
	await page.getByLabel('Select Role C').check();
	await page.getByLabel('Select Drafted event X').check();
	page.once('dialog', (d) => d.accept());
	await page.getByTestId('selection-bar').getByRole('button', { name: 'Reject selected' }).click();
	await expect(page.getByRole('list', { name: 'Proposals' }).getByRole('article')).toHaveCount(1);
	await expect(page.getByRole('list', { name: 'Proposals' })).toContainText('Drafted event Y');
});
