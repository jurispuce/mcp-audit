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

test('select proposed mapping links and accept them together (Library, Mapping)', async ({
	page,
	baseURL
}) => {
	const code = `sel${Date.now().toString(36)}`;
	const client = await mcpClient(baseURL!, await createToken(page, 'Select links'));
	await call(client, 'upsert_sources', { sources: [{ code, title: `Selection law ${code}`, type: 'law' }] });
	await call(client, 'upsert_requirements', {
		source: code,
		requirements: [
			{ ref: '1', title: 'Risk' },
			{ ref: '2', title: 'Access' },
			{ ref: '3', title: 'Incidents' }
		]
	});
	await call(client, 'link_requirements', {
		links: [
			{ from: `${code}:1`, to: 'nis2:Art. 21(2)(a)', type: 'details', note: 'Risk analysis' },
			{ from: `${code}:2`, to: 'nis2:Art. 21(2)(i)', type: 'details', note: 'Access control' },
			{ from: `${code}:3`, to: 'nis2:Art. 21(2)(b)', type: 'details', note: 'Incident handling' }
		]
	});
	await client.close();

	await page.goto(`/library/mapping?from=${code}&to=nis2`);
	await expect(page.getByTestId('mapping-summary')).toContainText('3 proposed links wait');
	await page.getByLabel('Select link 1 to Art. 21(2)(a)').check();
	await page.getByLabel('Select link 2 to Art. 21(2)(i)').check();
	const bar = page.getByTestId('selection-bar');
	await expect(bar).toContainText('2 of 3 selected');
	await bar.getByRole('button', { name: 'Accept selected' }).click();
	await expect(page.getByTestId('mapping-summary')).toHaveText(
		`2 of 3 requirements mapped to nis2, 1 proposed link waits`
	);
	// The URL keeps the chosen sources, and the remaining link is still proposed.
	await expect(page).toHaveURL(new RegExp(`from=${code}&to=nis2`));
	await expect(page.getByTestId('map-3').getByTestId('maplink')).toHaveAttribute('data-state', 'proposed');
});

test('select requirements of an import across rows and accept them together (Library, Review)', async ({
	page,
	baseURL
}) => {
	const code = `rev${Date.now().toString(36)}`;
	const client = await mcpClient(baseURL!, await createToken(page, 'Select review'));
	await call(client, 'upsert_sources', { sources: [{ code, title: `Review law ${code}`, type: 'law' }] });
	await call(client, 'upsert_requirements', {
		source: code,
		requirements: [
			{ ref: '1', title: 'One' },
			{ ref: '2', title: 'Two' },
			{ ref: '3', title: 'Three' }
		]
	});
	await client.close();

	await page.goto('/library/review');
	const card = page.getByTestId(`import-${code}`);
	if ((await card.locator('details').getAttribute('open')) === null)
		await card.getByText('Preview and edit the requirements').click();
	await card.getByLabel('Select 1', { exact: true }).check();
	await card.getByLabel('Select 3', { exact: true }).check();
	const bar = card.getByTestId('selection-bar');
	await expect(bar).toContainText('2 of 3 selected');
	await bar.getByRole('button', { name: 'Accept selected' }).click();
	await expect(card).toContainText('3 requirements, 1 still proposed');
	await expect(card.getByTestId('proposed-2')).toHaveAttribute('data-state', 'proposed');
});

test('select drafted events and drafted evidence on Plan, Events and review them together', async ({
	page,
	baseURL
}) => {
	const e = await sampleCopy(page.request);
	const client = await mcpClient(baseURL!, await createToken(page, 'Select plan'));
	await call(client, 'upsert_events', {
		engagement_id: e.id,
		events: [{ title: 'Draft one' }, { title: 'Draft two' }, { title: 'Draft three' }]
	});
	await call(client, 'upsert_evidence_items', {
		engagement_id: e.id,
		items: [{ event_id: e.events[0]!.id, text: 'Drafted evidence on an accepted event', kind: 'record' }]
	});
	await client.close();

	await page.goto(`/e/${e.id}/plan/events`);
	await page.getByLabel('Select Draft one').check();
	await page.getByLabel('Select Draft two').check();
	const bar = page.getByTestId('selection-bar');
	await expect(bar).toContainText('2 of 3 selected');
	await bar.getByRole('button', { name: 'Accept selected' }).click();
	await expect(page.getByTestId('event-Draft one')).toHaveAttribute('data-state', 'default');
	await expect(page.getByTestId('event-Draft three')).toHaveAttribute('data-state', 'proposed');

	// With an accepted event's evidence open, its drafted evidence joins the selection.
	await page.goto(`/e/${e.id}/plan/events?event=${e.events[0]!.id}`);
	await page.getByLabel('Select evidence Drafted evidence on an accepted event').check();
	await page.getByLabel('Select Draft three').check();
	page.once('dialog', (d) => d.accept());
	await page.getByTestId('selection-bar').getByRole('button', { name: 'Reject selected' }).click();
	await expect(page.getByTestId('event-Draft three')).toHaveCount(0);
	await expect(page.getByTestId('evidence-Drafted evidence on an accepted event')).toHaveCount(0);
	await expect(page).toHaveURL(new RegExp(`event=${e.events[0]!.id}`));
});

test('select proposed evidence links on the event screen and accept them together', async ({
	page,
	baseURL
}) => {
	const e = await sampleCopy(page.request);
	const event = e.events[0]!;
	const client = await mcpClient(baseURL!, await createToken(page, 'Select links on event'));
	const status = await call(client, 'get_event_status', { engagement_id: e.id, event_id: event.id });
	const docs = (await call(client, 'list_artifacts', { engagement_id: e.id })).artifacts;
	const items = status.evidence.slice(0, 3) as { id: string }[];
	await call(client, 'link_evidence', {
		engagement_id: e.id,
		links: items.map((x, i) => ({
			artifact_id: docs[i % docs.length].id,
			evidence_item_id: x.id,
			locator: `p. ${i + 1}`,
			sufficiency: 'supports'
		}))
	});
	await client.close();

	await page.goto(`/e/${e.id}/run/events/${event.id}`);
	await expect(page.getByTestId('link-proposals')).toContainText(
		`${items.length} evidence links proposed by AI`
	);
	const boxes = page.getByRole('checkbox', { name: /^Select link / });
	await expect(page.getByTestId('proposed-link')).toHaveCount(items.length);
	await expect(boxes).toHaveCount(items.length);
	await boxes.nth(0).check();
	const bar = page.getByTestId('selection-bar');
	await expect(bar).toContainText(`1 of ${items.length} selected`);
	await bar.getByRole('button', { name: 'Accept selected' }).click();
	await expect(page.getByTestId('proposed-link')).toHaveCount(items.length - 1);
	await expect(page.getByTestId('link-proposals')).toContainText(
		`${items.length - 1} evidence ${items.length - 1 === 1 ? 'link' : 'links'} proposed by AI`
	);
});

test('when the server does not answer, Reject selected says so in the bar and keeps the screen', async ({
	page,
	baseURL
}) => {
	const e = await sampleCopy(page.request);
	const client = await mcpClient(baseURL!, await createToken(page, 'Select timeout test'));
	await call(client, 'upsert_internal_requirements', {
		engagement_id: e.id,
		requirements: [{ title: 'Rule one' }, { title: 'Rule two' }]
	});
	await client.close();

	await page.goto(`/e/${e.id}/setup/documents`);
	// As a proxy does when its own timeout runs out or it asks to sign in again.
	await page.route('**/setup/documents?/rejectSelected', (r) => r.abort('timedout'));
	await page
		.getByRole('list', { name: 'Proposed internal requirements' })
		.getByRole('checkbox')
		.first()
		.check();
	page.once('dialog', (d) => d.accept());
	await page.getByTestId('selection-bar').getByRole('button', { name: 'Reject selected' }).click();
	await expect(page.getByTestId('selection-result')).toHaveText(
		'The server did not answer. Reload the page to see what was reviewed, then try again.'
	);
	await expect(page.getByRole('list', { name: 'Proposed internal requirements' })).toContainText('Rule one');
	await expect(page.getByTestId('selection-bar')).toContainText('1 of 2 selected');
});
