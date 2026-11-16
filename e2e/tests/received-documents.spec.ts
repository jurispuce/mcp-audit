import { ADMIN, expect, loginAs, sampleCopy, seed, test } from '../helpers';
import { call, createToken, mcpClient } from '../mcp-helpers';

/** #83: documents already received are linked to planned evidence, so events focus on what is missing. */
test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('link a received document to the evidence that asks for it; the event shows what is still to obtain', async ({
	page,
	baseURL
}) => {
	const e = await sampleCopy(page.request);
	const client = await mcpClient(baseURL!, await createToken(page, 'Received documents test'));
	await call(client, 'register_artifact', {
		engagement_id: e.id,
		title: 'Incident response plan',
		text: '1 Purpose\n2 Roles\n3 Escalation'
	});
	const events = (await call(client, 'list_events', { engagement_id: e.id })) as {
		events: { id: string; title: string }[];
	};
	const ev = events.events[0]!;
	await call(client, 'upsert_evidence_items', {
		engagement_id: e.id,
		items: [{ event_id: ev.id, text: 'Approved incident response plan', kind: 'rule' }]
	});
	await client.close();
	// The drafted evidence is accepted first, as the auditor would.
	await page.goto(`/e/${e.id}/proposals?type=evidence`);
	await page.getByRole('button', { name: 'Accept all' }).click();
	await expect(page.getByTestId('no-proposals')).toBeVisible();

	await page.goto(`/e/${e.id}/plan/events`);
	const offer = page.getByTestId('link-received');
	await expect(offer).toContainText('1 planned evidence item matches a document already received.');
	await offer.getByRole('button', { name: 'Link received documents' }).click();
	await expect(page.getByRole('status')).toContainText('1 link to documents already received proposed.');
	await expect(page.getByTestId('link-received')).toHaveCount(0);

	await page.goto(`/e/${e.id}/run/events/${ev.id}`);
	const counts = page.getByTestId('evidence-counts');
	const before = (await counts.textContent())!;
	const toObtain = Number(/(\d+) to obtain/.exec(before)![1]);
	const receivedBefore = Number(/(\d+) already/.exec(before)![1]);
	const row = page.getByTestId('evidence-Approved incident response plan');
	await expect(row.getByTestId('proposed-link')).toContainText(
		'Incident response plan, whole document · supports'
	);
	await row
		.getByRole('button', { name: 'Accept link Incident response plan to Approved incident response plan' })
		.click();
	await expect(counts).toHaveText(
		`${toObtain - 1} to obtain at this event, ${receivedBefore + 1} already received`
	);
	const received = page.getByTestId('already-received');
	await expect(received).toContainText('Already received');
	await received.locator('summary').click();
	await expect(received.getByTestId('evidence-Approved incident response plan')).toContainText(
		'Incident response plan (whole document)'
	);
});
