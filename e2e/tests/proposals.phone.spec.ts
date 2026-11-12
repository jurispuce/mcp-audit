import { ADMIN, expect, loginAs, sampleCopy, seed, test } from '../helpers';
import { call, createToken, mcpClient } from '../mcp-helpers';

test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('on a phone the top bar counts unreviewed proposals and leads to the review list (#65)', async ({
	page,
	baseURL
}) => {
	const e = await sampleCopy(page.request);
	const client = await mcpClient(baseURL!, await createToken(page, 'Phone proposals'));
	await call(client, 'upsert_people', {
		engagement_id: e.id,
		people: [{ role: 'Network administrator' }, { role: 'Records manager' }]
	});
	await client.close();

	await page.goto(`/e/${e.id}/plan/events`);
	const count = page.getByTestId('topbar-proposals');
	await expect(count).toHaveText('2');
	await expect(count).toHaveAccessibleName('2 proposals to review');
	expect((await count.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await count.tap();
	await expect(page).toHaveURL(new RegExp(`/e/${e.id}/proposals$`));
	await page.getByRole('button', { name: 'Reject Network administrator' }).tap();
	await expect(count).toHaveText('1');
	await page.getByRole('button', { name: 'Accept Records manager' }).tap();
	await expect(count).toHaveCount(0);
});
