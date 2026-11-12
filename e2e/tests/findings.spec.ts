import { ADMIN, expect, loginAs, sampleCopy, seed, test } from '../helpers';
import { call, createToken, mcpClient } from '../mcp-helpers';

test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

test('findings: one card per assessment unit on the engagement’s scale; save draft, approve, reopen; matrix on desktop (#57, #58)', async ({
	page
}) => {
	const e = await sampleCopy(page.request);
	// Evidence received for (i), and a suspected issue noted.
	await page.goto(`/e/${e.id}/run/events/${e.events[0]!.id}`);
	await page.getByLabel('Status of Access review records for the last two cycles').selectOption('received');
	await expect(page.getByTestId('evidence-Access review records for the last two cycles')).toHaveAttribute(
		'data-status',
		'received'
	);
	const note = page.getByLabel('Note', { exact: true });
	await note.click();
	await note.pressSequentially('/issue');
	await page.keyboard.press('Enter');
	await note.pressSequentially('Three leavers still active @Art. 21(2)(i)');
	await page.keyboard.press('Enter');
	await note.press('Enter');
	await expect(page.getByTestId('note')).toHaveCount(1);

	await page.goto(`/e/${e.id}/findings/matrix`);
	await expect(page.getByTestId('findings-summary')).toHaveText('0 of 8 assessment units concluded.');
	await expect(page.getByRole('table', { name: 'Requirements by scope' })).toBeVisible();
	const card = page.getByTestId('unit-Art. 21(2)(i) @ Head office');
	await expect(card).toContainText('Evidence: 1 of 2 received');
	await expect(card.getByTestId('suspected-issues')).toContainText('Three leavers still active');
	await expect(card.getByLabel('Finding')).toContainText('Minor non-conformity');

	await card.getByLabel('Finding').selectOption({ label: 'Minor non-conformity' });
	await card.getByLabel('Rationale').fill('Three leaver accounts were still active after the leaving date.');
	await card.getByLabel('Access review records for the last two cycles').check();
	await card.getByRole('button', { name: 'Save draft' }).click();
	await expect(card.getByTestId('finding-status')).toHaveText('Draft');
	await card.getByRole('button', { name: 'Approve Art. 21(2)(i)' }).click();
	await expect(card.getByTestId('finding-status')).toHaveText('Conclusion');
	await expect(card).toContainText('Approved by Ada Admin');
	await expect(card.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
	await expect(page.getByTestId('findings-summary')).toHaveText('1 of 8 assessment units concluded.');

	await card.getByRole('button', { name: 'Reopen Art. 21(2)(i)' }).click();
	await expect(card.getByTestId('finding-status')).toHaveText('Draft');
});

test('missing evidence never makes a non-conformity; approve all drafts; conclusions and the findings report (#57, #58, #59)', async ({
	page
}) => {
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/findings/matrix`);
	const a = page.getByTestId('unit-Art. 21(2)(a) @ All scopes');
	await a.getByLabel('Finding').selectOption({ label: 'Major non-conformity' });
	await a.getByRole('button', { name: 'Save draft' }).click();
	await expect(a.getByRole('alert')).toContainText('no reasonable assurance');
	await a.getByLabel('Finding').selectOption({ label: 'No reasonable assurance' });
	await a.getByLabel('Rationale').fill('No risk analysis was provided.');
	await a.getByRole('button', { name: 'Save draft' }).click();
	await expect(a.getByTestId('finding-status')).toHaveText('Draft');
	const g = page.getByTestId('unit-Art. 21(2)(g) @ All scopes');
	await g.getByLabel('Finding').selectOption({ label: 'Conformity with positive note' });
	await g.getByLabel('Rationale').fill('Awareness training reaches every new employee in the first week.');
	await g.getByRole('button', { name: 'Save draft' }).click();
	await expect(g.getByTestId('finding-status')).toHaveText('Draft');

	await page
		.getByRole('navigation', { name: 'Findings tabs' })
		.getByRole('link', { name: 'To approve' })
		.click();
	await expect(page.getByRole('list', { name: 'Findings to approve' }).getByRole('article')).toHaveCount(2);
	await page.getByRole('button', { name: 'Approve all drafts' }).click();
	await expect(page.getByRole('status')).toHaveText('2 drafts approved.');

	await page
		.getByRole('navigation', { name: 'Findings tabs' })
		.getByRole('link', { name: 'Conclusions' })
		.click();
	await expect(page.getByRole('list', { name: 'Conclusions' }).getByRole('article')).toHaveCount(2);
	await page.getByText('Preview').click();
	const preview = page.getByTestId('report-preview');
	await expect(preview.getByRole('heading', { level: 1 })).toHaveText('Audita konstatējumu ziņojums');
	await expect(preview).toContainText('pozitīva piezīme');
	await page.getByRole('button', { name: 'Export report as PDF' }).click();
	await expect(page.getByRole('status')).toContainText('.pdf is ready.');
	const download = page.waitForEvent('download');
	await page.getByTestId('download-report').click();
	expect((await download).suggestedFilename()).toMatch(/^findings-report-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test('post-event report from the event screen, without suspected issues (#56)', async ({ page }) => {
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/run/events/${e.events[0]!.id}`);
	await page.getByLabel('Status of Access review records for the last two cycles').selectOption('received');
	await expect(page.getByTestId('evidence-Access review records for the last two cycles')).toHaveAttribute(
		'data-status',
		'received'
	);
	const note = page.getByLabel('Note', { exact: true });
	await note.click();
	await note.pressSequentially('/issue');
	await page.keyboard.press('Enter');
	await note.pressSequentially('auditor only remark');
	await note.press('Enter');
	await expect(page.getByTestId('note')).toHaveCount(1);
	await page.reload();
	await page.getByText('Preview').click();
	const preview = page.getByTestId('report-preview');
	await expect(preview.getByRole('heading', { level: 1 })).toHaveText('Pārskats pēc tikšanās');
	await expect(preview).toContainText('Access review records for the last two cycles');
	await expect(preview).not.toContainText('auditor only remark');
	await page.getByRole('button', { name: 'Export report as DOCX' }).click();
	await expect(page.getByRole('status')).toContainText('.docx is ready.');
});

test('search finds requirements by code or text, events, documents and findings, and opens them as a sheet (#61)', async ({
	page
}) => {
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}`);
	const rail = page.getByRole('searchbox', { name: 'Search this engagement' });
	await rail.fill('Art. 21(2)(i)');
	await rail.press('Enter');
	await expect(page).toHaveURL(new RegExp(`/e/${e.id}/search\\?q=`));
	await expect(page.getByRole('region', { name: 'Requirements' })).toContainText('Human resources security');
	await page.getByLabel('Search for').fill('leavers');
	await page.getByRole('button', { name: 'Search' }).click();
	await expect(page.getByRole('region', { name: 'Documents' })).toContainText('Access control policy');
	await page.getByLabel('Search for').fill('backup walkthrough');
	await page.getByRole('button', { name: 'Search' }).click();
	await page
		.getByRole('region', { name: 'Events' })
		.getByRole('link', { name: 'Backup walkthrough' })
		.click();
	await expect(
		page.getByTestId('item-sheet').getByRole('heading', { name: 'Backup walkthrough' })
	).toBeVisible();
});

test('Claude proposes evidence links and findings through MCP; only a person approves (#55, #60)', async ({
	page,
	baseURL
}) => {
	const e = await sampleCopy(page.request);
	const client = await mcpClient(baseURL!, await createToken(page, `Claude ${e.name}`));
	const status = await call(client, 'get_event_status', { engagement_id: e.id, event_id: e.events[0]!.id });
	const leavers = status.evidence.find((x: { text: string }) => x.text.startsWith('Leaver'));
	const transcript = await call(client, 'register_artifact', {
		engagement_id: e.id,
		title: 'Interview transcript',
		kind: 'transcript',
		text: 'The Head of IT showed the leaver list: 41 leavers, 3 accounts still active.'
	});
	await call(client, 'link_evidence', {
		engagement_id: e.id,
		links: [
			{
				artifact_id: transcript.id,
				evidence_item_id: leavers.id,
				locator: 'paragraph 1',
				excerpt: '3 accounts still active',
				sufficiency: 'contradicts'
			}
		]
	});
	const units = await call(client, 'list_assessment_units', { engagement_id: e.id });
	const unit = units.units.find(
		(u: { ref: string; scope: string }) => u.ref === 'nis2:Art. 21(2)(i)' && u.scope === 'Head office'
	);
	const card = await call(client, 'get_assessment_unit', { engagement_id: e.id, unit_id: unit.id });
	expect(card.evidence[0].links[0]).toMatchObject({ status: 'proposed', sufficiency: 'contradicts' });
	await call(client, 'propose_finding', {
		engagement_id: e.id,
		unit_id: unit.id,
		value: 'na',
		rationale: 'Leaver list not yet confirmed.'
	});
	const { tools } = await client.listTools();
	expect(tools.map((t) => t.name).filter((n) => /approve/.test(n))).toEqual([]);
	await client.close();

	await page.goto(`/e/${e.id}/run/events/${e.events[0]!.id}`);
	await expect(page.getByTestId('link-proposals')).toContainText('1 evidence link proposed by AI');
	await page.getByRole('button', { name: 'Accept all' }).click();
	await expect(page.getByTestId('evidence-Leaver list for 2026 with account disable dates')).toHaveAttribute(
		'data-status',
		'received'
	);

	await page.goto(`/e/${e.id}/findings/to-approve`);
	const proposed = page.getByTestId('unit-Art. 21(2)(i) @ Head office');
	await expect(proposed.getByTestId('finding-status')).toHaveText('Proposed by AI');
	await expect(proposed.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
	await proposed.getByRole('button', { name: 'Accept proposal for Art. 21(2)(i)' }).click();
	await expect(proposed.getByTestId('finding-status')).toHaveText('Draft');
});
