import type { Page } from '@playwright/test';
import { ADMIN, createEngagement, expect, loginAs, seed, test, unique } from '../helpers';
import { call, createToken, mcpClient } from '../mcp-helpers';

test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

/** An engagement with three selected requirements, one role and a high risk on (i). */
async function planReady(page: Page) {
	const eng = await createEngagement(page);
	await page.goto(`/e/${eng.id}/setup/requirements`);
	const nis2 = page.getByRole('list', { name: /NIS 2 .* requirements/ });
	for (const p of ['b', 'i', 'j']) await nis2.getByLabel(new RegExp(`Art\\. 21\\(2\\)\\(${p}\\)`)).check();
	await page.locator('details', { has: nis2 }).getByRole('button', { name: 'Select ticked' }).click();
	await expect(page.getByTestId('units-count')).toContainText('3 selected');
	await page.goto(`/e/${eng.id}/setup/auditee`);
	await page.getByRole('button', { name: 'Add person' }).click();
	await page.getByLabel('Role', { exact: true }).fill('Head of IT');
	await page.getByLabel('Name (optional)').fill('Ilze Kalniņa');
	await page.getByRole('button', { name: 'Add person' }).click();
	await expect(page.getByTestId('person-Head of IT')).toBeVisible();
	await page.goto(`/e/${eng.id}/setup/risks`);
	await page.getByRole('button', { name: 'Add risk' }).click();
	await page.getByLabel('Risk', { exact: true }).fill('Leaver accounts stay active');
	await page.getByLabel('Level').selectOption('high');
	await page
		.getByTestId('requirement-checklist')
		.getByLabel(/Art\. 21\(2\)\(i\)/)
		.check();
	await page.getByRole('button', { name: 'Add risk' }).click();
	await expect(page.getByTestId('risk-Leaver accounts stay active')).toBeVisible();
	return eng;
}

async function addEvent(page: Page, title: string, date: string, time: string, reqs: string[]) {
	await page.getByRole('button', { name: 'Add event' }).first().click();
	const form = page.locator('form', { has: page.getByRole('heading', { name: 'Add event' }) });
	await form.getByLabel('Event title').fill(title);
	await form.getByLabel('Date').fill(date);
	await form.getByLabel('Start time').fill(time);
	await form.getByLabel('Head of IT (Ilze Kalniņa)').check();
	for (const r of reqs)
		await form
			.getByTestId('requirement-checklist')
			.getByLabel(new RegExp(r.replace(/[()]/g, '\\$&')))
			.check();
	await form.getByRole('button', { name: 'Add event' }).click();
	await expect(page.getByTestId(`event-${title}`)).toBeVisible();
}

test('events: add, edit and remove; sorted by date and time; planned evidence with default criticality (#46, #49)', async ({
	page
}) => {
	const { id } = await planReady(page);
	await page.goto(`/e/${id}/plan/events`);
	await addEvent(page, 'Afternoon walkthrough', '2026-11-17', '14:00', ['Art. 21(2)(j)']);
	await addEvent(page, 'Access interview', '2026-11-17', '09:30', ['Art. 21(2)(i)', 'Art. 21(2)(b)']);
	await expect(page.getByRole('list', { name: 'Events' }).getByRole('heading')).toHaveText([
		'Access interview',
		'Afternoon walkthrough'
	]);
	await expect(page.getByTestId('event-Access interview')).toContainText(
		'With Head of IT (Ilze Kalniņa). Validates Art. 21(2)(b), Art. 21(2)(i).'
	);

	await page.getByRole('link', { name: 'Edit Afternoon walkthrough' }).click();
	await page.getByLabel('Event title').fill('Server room walkthrough');
	await page.getByLabel('Format').selectOption('site_visit');
	await page.getByLabel('Duration (minutes)').fill('45');
	await page.getByRole('button', { name: 'Save event' }).click();
	await expect(page.getByTestId('event-Server room walkthrough')).toContainText('Site visit · 45 min');

	await page.getByRole('link', { name: 'Plan evidence for Access interview' }).click();
	const panel = page.getByRole('region', { name: 'Planned evidence for Access interview' });
	await panel.getByLabel('What do you expect to see?').fill('Leaver list for 2026');
	await panel.getByLabel('Art. 21(2)(i)').check();
	await panel.getByRole('button', { name: 'Add evidence' }).click();
	await expect(panel.getByTestId('evidence-Leaver list for 2026')).toContainText('High criticality');
	await panel.getByLabel('What do you expect to see?').fill('Incident log');
	await panel.getByLabel('Kind').selectOption('record');
	await panel.getByLabel('Art. 21(2)(b)').check();
	await panel.getByRole('button', { name: 'Add evidence' }).click();
	await expect(panel.getByTestId('evidence-Incident log')).toContainText('Medium criticality');
	await panel.getByRole('button', { name: 'Edit evidence Incident log' }).click();
	await panel.getByLabel('Status').selectOption('promised');
	await panel.getByLabel('Promised by').fill('Head of IT');
	await panel.getByRole('button', { name: 'Save evidence' }).click();
	await expect(panel.getByTestId('evidence-Incident log')).toContainText('Promised by Head of IT');
	await panel.getByRole('button', { name: 'Remove evidence Incident log' }).click();
	await expect(panel.getByTestId('evidence-Incident log')).toHaveCount(0);

	await page.getByRole('button', { name: 'Remove Server room walkthrough' }).click();
	await expect(page.getByTestId('event-Server room walkthrough')).toHaveCount(0);
});

test('plan status: send, agree, back to draft and reopen; changes after sending are flagged (#47)', async ({
	page
}) => {
	const { id } = await planReady(page);
	await page.goto(`/e/${id}/plan/events`);
	await addEvent(page, 'Access interview', '2026-11-17', '09:30', ['Art. 21(2)(i)']);
	const header = page.getByTestId('plan-header');
	await expect(header.getByTestId('plan-status')).toHaveText('Plan in draft');
	await header.getByRole('button', { name: 'Mark plan as sent' }).click();
	await expect(header.getByTestId('plan-status')).toHaveText('Plan sent to auditee');
	await expect(header.getByTestId('plan-changed')).toHaveCount(0);

	await page.getByRole('link', { name: 'Edit Access interview' }).click();
	await page.getByLabel('Start time').fill('11:00');
	await page.getByRole('button', { name: 'Save event' }).click();
	await expect(header.getByTestId('plan-changed')).toHaveText('Changed since then');

	await header.getByRole('button', { name: 'Back to draft' }).click();
	await expect(header.getByTestId('plan-status')).toHaveText('Plan in draft');
	await header.getByRole('button', { name: 'Mark plan as sent' }).click();
	await header.getByRole('button', { name: 'Mark plan agreed' }).click();
	await expect(header.getByTestId('plan-status')).toHaveText('Plan agreed');
	await expect(header.getByTestId('plan-changed')).toHaveCount(0);
	await header.getByRole('button', { name: 'Reopen plan' }).click();
	await expect(header.getByTestId('plan-status')).toHaveText('Plan in draft');
	await page.goto(`/e/${id}/plan/events?item=engagement:${id}&tab=history`);
	await expect(page.getByTestId('history')).toContainText('Plan reopened');
});

test('coverage: uncovered first, add to an event from a searchable list, remove, and create a new event (#48)', async ({
	page
}) => {
	const { id } = await planReady(page);
	await page.goto(`/e/${id}/plan/events`);
	await addEvent(page, 'Access interview', '2026-11-17', '09:30', ['Art. 21(2)(i)']);
	await addEvent(page, 'Incident review', '2026-11-18', '10:00', ['Art. 21(2)(b)']);
	await page.getByRole('navigation', { name: 'Plan tabs' }).getByRole('link', { name: 'Coverage' }).click();
	await expect(page.getByTestId('coverage-summary')).toHaveText('2 of 3 requirements are in an event');
	const list = page.getByRole('list', { name: 'Requirements' });
	await expect(list.getByRole('article').first()).toContainText('Not covered');
	await expect(list.getByRole('article').first()).toContainText('Art. 21(2)(j)');

	await page.getByRole('link', { name: /Show only not covered/ }).click();
	await expect(list.getByRole('article')).toHaveCount(1);
	const j = page.getByTestId('coverage-Art. 21(2)(j)');
	await j.getByRole('button', { name: '+ Add to event' }).click();
	await j.getByLabel('Search events').fill('access');
	await expect(j.getByRole('button', { name: /Incident review/ })).toHaveCount(0);
	await j.getByRole('button', { name: /Access interview/ }).click();
	await expect(page.getByRole('status')).toHaveText('Added to Access interview.');
	await page.goto(`/e/${id}/plan/coverage`);
	await expect(page.getByTestId('coverage-summary')).toHaveText('3 of 3 requirements are in an event');
	// A requirement can sit in several events.
	const i = page.getByTestId('coverage-Art. 21(2)(i)');
	await i.getByRole('button', { name: '+ Add to event' }).click();
	await i.getByRole('button', { name: /Incident review/ }).click();
	await expect(page.getByTestId('coverage-Art. 21(2)(i)').getByRole('link')).toHaveCount(2);
	await page
		.getByTestId('coverage-Art. 21(2)(i)')
		.getByRole('button', { name: 'Remove Art. 21(2)(i) from Incident review' })
		.click();
	await expect(page.getByTestId('coverage-Art. 21(2)(i)').getByRole('link')).toHaveCount(1);

	const b = page.getByTestId('coverage-Art. 21(2)(b)');
	await b.getByRole('button', { name: '+ Add to event' }).click();
	await b.getByRole('button', { name: /Create a new event/ }).click();
	await expect(page).toHaveURL(new RegExp(`/e/${id}/plan/events\\?edit=`));
	await expect(page.getByLabel('Event title')).toHaveValue('New event for Art. 21(2)(b)');
	await expect(page.getByTestId('requirement-checklist').getByLabel(/Art\. 21\(2\)\(b\)/)).toBeChecked();
});

test('AI-drafted events are proposed, editable, and accepted, rejected or accepted all (#46, #51)', async ({
	page,
	baseURL
}) => {
	const { id } = await planReady(page);
	const client = await mcpClient(baseURL!, await createToken(page, unique('Claude')));
	const drafted = await call(client, 'upsert_events', {
		engagement_id: id,
		events: [
			{
				title: 'Access and identity interview',
				format: 'interview',
				date: '2026-11-17',
				start_time: '10:00',
				duration_min: 60,
				participants: ['Head of IT'],
				requirements: ['nis2:Art. 21(2)(i)', 'nis2:Art. 21(2)(j)']
			},
			{
				title: 'Incident handling interview',
				date: '2026-11-18',
				start_time: '10:00',
				requirements: ['nis2:Art. 21(2)(b)']
			},
			{ title: 'Spare session', requirements: [] }
		]
	});
	await call(client, 'upsert_evidence_items', {
		engagement_id: id,
		items: [
			{
				event_id: drafted.events[0].id,
				text: 'Leaver list for 2026',
				kind: 'record',
				requirements: ['nis2:Art. 21(2)(i)']
			}
		]
	});
	const cov = await call(client, 'get_coverage', { engagement_id: id });
	expect(cov).toMatchObject({ covered: 3, total: 3 });
	await client.close();

	await page.goto(`/e/${id}/plan/events`);
	await expect(page.getByTestId('drafts-bar')).toContainText('3 drafted events wait for review');
	await expect(page.getByTestId('event-Access and identity interview')).toHaveAttribute(
		'data-state',
		'proposed'
	);
	await page.getByRole('link', { name: 'Edit Incident handling interview' }).click();
	await page.getByLabel('Start time').fill('13:00');
	await page.getByRole('button', { name: 'Save event' }).click();
	await expect(page.getByTestId('event-Incident handling interview')).toContainText('13:00');
	await expect(page.getByTestId('event-Incident handling interview')).toHaveAttribute(
		'data-state',
		'proposed'
	);
	await page.getByRole('button', { name: 'Reject Spare session' }).click();
	await page.getByRole('button', { name: 'Accept Access and identity interview' }).click();
	await expect(page.getByTestId('event-Access and identity interview')).toHaveAttribute(
		'data-state',
		'default'
	);
	await page.getByRole('button', { name: 'Accept all' }).click();
	await expect(page.getByRole('status')).toHaveText('1 drafted event accepted.');
	await expect(page.getByTestId('drafts-bar')).toHaveCount(0);
	await page.goto(`/e/${id}/plan/events?event=${drafted.events[0].id}`);
	await expect(page.getByTestId('evidence-Leaver list for 2026')).toHaveAttribute('data-state', 'default');
});

test('audit plan: preview matches the export, DOCX and PDF are kept as generated reports, no criticality or risks (#50)', async ({
	page
}) => {
	const { id } = await planReady(page);
	await page.goto(`/e/${id}/plan/events`);
	await addEvent(page, 'Access interview', '2026-11-17', '09:30', ['Art. 21(2)(i)', 'Art. 21(2)(b)']);
	await page.getByRole('link', { name: 'Plan evidence for Access interview' }).click();
	const panel = page.getByRole('region', { name: 'Planned evidence for Access interview' });
	await panel.getByLabel('What do you expect to see?').fill('Leaver list for 2026');
	await panel.getByRole('button', { name: 'Add evidence' }).click();
	await expect(panel.getByTestId('evidence-Leaver list for 2026')).toBeVisible();

	await page.getByRole('navigation', { name: 'Plan tabs' }).getByRole('link', { name: 'Audit plan' }).click();
	const preview = page.getByTestId('plan-preview');
	await expect(preview.getByRole('heading', { level: 1 })).toHaveText('Audit plan');
	await expect(preview.getByRole('table')).toContainText('Access interview');
	await expect(preview.getByRole('table')).toContainText('Head of IT (Ilze Kalniņa)');
	await expect(preview).toContainText('Leaver list for 2026');
	await expect(preview).not.toContainText('Leaver accounts stay active');
	await expect(preview).not.toContainText(/high/i);
	await expect(page.getByTestId('uncovered')).toContainText('Art. 21(2)(j)');

	await page.getByRole('button', { name: 'Export plan as PDF' }).click();
	await expect(page.getByRole('status')).toContainText('.pdf is ready.');
	const download = page.waitForEvent('download');
	await page.getByTestId('download-export').click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/^audit-plan-\d{4}-\d{2}-\d{2}\.pdf$/);
	await page.getByRole('button', { name: 'Export plan as DOCX' }).click();
	await expect(page.getByRole('status')).toContainText('.docx is ready.');
	await expect(page.getByRole('list', { name: 'Earlier exports' }).getByRole('listitem')).toHaveCount(2);
	await page.goto(`/e/${id}/setup/documents`);
	await expect(page.getByRole('list', { name: 'Documents' })).toContainText('Generated report');
});
