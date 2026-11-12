import { makePdf } from '../../tests/fixtures/make-docs';
import { ADMIN, AUDITOR, expect, loginAs, sampleCopy, seed, test, unique } from '../helpers';

/**
 * In-app AI (milestone 7) against the scripted fake gateway (e2e/fake-llm.mjs), which calls the app's
 * real tools. The AI settings are instance-wide, so these run in order.
 */
const LLM_URL = process.env.E2E_LLM_URL ?? 'http://127.0.0.1:4999';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
	await seed(page.request);
	await loginAs(page, ADMIN);
});

async function runAction(page: import('@playwright/test').Page, action: string, label: string) {
	const box = page.getByTestId(`ai-${action}`);
	await box.getByRole('button', { name: label, exact: true }).click();
	await expect(box).toHaveAttribute('data-status', 'succeeded', { timeout: 20_000 });
	return box;
}

test('an admin sets the gateway and models; a model that fails the tool-calling check cannot be assigned (#63)', async ({
	page
}) => {
	// Before set-up, the buttons say why they cannot run.
	const e = await sampleCopy(page.request);
	await page.goto(`/e/${e.id}/setup/auditee`);
	const derive = page.getByTestId('ai-derive_roles');
	if (await derive.getByText('not set up yet').isVisible()) {
		await expect(derive.getByRole('button', { name: 'Derive roles from documents' })).toBeDisabled();
	}

	await page.goto('/settings/ai');
	await page.getByLabel('Gateway address').fill(LLM_URL);
	await page.getByLabel('Gateway key').fill('sk-test-key');
	await page.getByRole('button', { name: 'Save gateway' }).click();
	await expect(page.getByRole('status')).toHaveText('Gateway saved.');
	await expect(page.getByLabel('Gateway key')).toHaveAttribute('placeholder', /A key is set/);
	await expect(page.locator('body')).not.toContainText('sk-test-key');

	await page.getByRole('button', { name: 'Load models from gateway' }).click();
	await expect(page.getByTestId('gateway-models')).toContainText('fake-tools');

	await page.getByLabel('Model name').fill('fake-notools');
	await page.getByRole('button', { name: 'Add and check model' }).click();
	await expect(page.getByRole('alert')).toContainText('fake-notools failed the tool-calling check');
	await expect(page.getByTestId('model-fake-notools')).toContainText('Failed the check');

	for (const m of ['fake-tools', 'fake-slow', 'fake-broken']) {
		await page.getByLabel('Model name').fill(m);
		await page.getByRole('button', { name: 'Add and check model' }).click();
		await expect(page.getByRole('status')).toHaveText(`${m} passed the tool-calling check.`);
	}
	const def = page.getByLabel('Default for all actions');
	await expect(def.locator('option')).toHaveText(['None', 'fake-broken', 'fake-slow', 'fake-tools']);
	await def.selectOption('fake-tools');
	await page.getByRole('button', { name: 'Save models' }).click();
	await expect(page.getByRole('status')).toHaveText('Models per action saved.');

	// An auditor cannot open AI settings.
	await loginAs(page, AUDITOR);
	const res = await page.goto('/settings/ai');
	expect(res?.status()).toBe(403);
});

test('the five buttons run their skills and produce proposals, reviewed on the screen and on the list (#64-#66)', async ({
	page
}) => {
	const e = await sampleCopy(page.request);

	// Derive roles: proposals on the screen with the bar, then on the review list.
	await page.goto(`/e/${e.id}/setup/auditee`);
	await runAction(page, 'derive_roles', 'Derive roles from documents');
	await expect(page.getByTestId('proposal-bar')).toContainText(
		'1 role proposed from “Derive roles from documents”'
	);
	await expect(page.getByTestId('person-Backup administrator')).toHaveAttribute('data-state', 'proposed');
	await expect(page.getByTestId('rail-proposals')).toContainText('1');
	await page.getByTestId('proposal-bar').getByRole('link', { name: 'Review' }).click();
	await expect(page).toHaveURL(new RegExp(`/e/${e.id}/proposals\\?type=role$`));
	const card = page.getByTestId('proposal-role-Backup administrator: Ilze Kalniņa');
	await expect(card).toContainText('Role · from Derive roles from documents');
	await card.getByRole('button', { name: /^Accept/ }).click();
	await expect(page.getByTestId('no-proposals')).toBeVisible();
	await expect(page.getByTestId('rail-proposals')).toHaveCount(0);
	await expect(page.getByTestId('job-derive_roles')).toContainText('Done');

	// Extract requirements from the documents.
	await page.goto(`/e/${e.id}/setup/documents`);
	await runAction(page, 'extract_internal', 'Extract requirements');
	await expect(page.getByRole('list', { name: 'Proposed internal requirements' })).toContainText(
		'Backups are restored as a test every quarter'
	);

	// Draft plan.
	await page.goto(`/e/${e.id}/plan/events`);
	await runAction(page, 'draft_plan', 'Draft plan');
	await expect(page.getByTestId('drafts-bar')).toContainText('1 drafted event proposed from “Draft plan”');
	await expect(page.getByTestId('event-Backup restore walkthrough')).toHaveAttribute(
		'data-state',
		'proposed'
	);

	// Process event materials.
	await page.goto(`/e/${e.id}/run/events/${e.events[0]!.id}`);
	await runAction(page, 'process_event', 'Process event materials');
	await expect(page.getByTestId('link-proposals')).toContainText('1 evidence link proposed by AI');

	// Propose findings: accepted into drafts, approval stays separate.
	await page.goto(`/e/${e.id}/findings/matrix`);
	await runAction(page, 'propose_findings', 'Propose findings');
	await expect(page.getByTestId('proposal-bar')).toContainText(
		'1 finding proposed from “Propose finding(s)”'
	);

	// Everything waits on the list; accept all of it.
	await page.goto(`/e/${e.id}/proposals`);
	await expect(page.getByRole('list', { name: 'Proposals' }).getByRole('article')).toHaveCount(4);
	await page.getByRole('button', { name: 'Accept all' }).click();
	await expect(page.getByRole('status')).toHaveText('4 proposals accepted.');
	await expect(page.getByTestId('no-proposals')).toBeVisible();
});

test('a job shows progress and can be cancelled; failures are reported; the engagement model limit applies (#63, #64)', async ({
	page
}) => {
	const e = await sampleCopy(page.request);
	const limit = async (label: string) => {
		await page.goto(`/e/${e.id}`);
		await page.getByRole('button', { name: 'Edit details' }).click();
		await page.getByLabel('Model for in-app AI').selectOption({ label });
		await page.getByRole('button', { name: 'Save details' }).click();
		await expect(page.getByRole('status')).toHaveText('Engagement details saved.');
	};

	await limit('Only fake-slow');
	await expect(page.getByTestId('engagement-details')).toContainText('limited to fake-slow');
	await page.goto(`/e/${e.id}/plan/events`);
	const box = page.getByTestId('ai-draft_plan');
	await box.getByRole('button', { name: 'Draft plan' }).click();
	await expect(box).toHaveAttribute('data-status', 'running');
	await expect(box.getByRole('listitem').first()).toBeVisible();
	await box.getByRole('button', { name: 'Cancel' }).click();
	await expect(box).toHaveAttribute('data-status', 'cancelled', { timeout: 10_000 });

	await limit('Only fake-broken');
	await page.goto(`/e/${e.id}/plan/events`);
	await box.getByRole('button', { name: 'Draft plan' }).click();
	await expect(box).toHaveAttribute('data-status', 'failed', { timeout: 10_000 });
	await expect(box.getByRole('alert')).toHaveText('The AI gateway answered 500: Upstream model exploded');

	// AI switched off: the buttons are disabled and say why.
	await page.goto(`/e/${e.id}`);
	await page.getByRole('button', { name: 'Edit details' }).click();
	await page.getByLabel('AI may work on this engagement').uncheck();
	await page.getByRole('button', { name: 'Save details' }).click();
	await expect(page.getByRole('status')).toHaveText('Engagement details saved.');
	await page.goto(`/e/${e.id}/findings/matrix`);
	await expect(page.getByRole('button', { name: 'Propose findings' })).toBeDisabled();
	await expect(page.getByTestId('ai-propose_findings')).toContainText(
		'AI is switched off for this engagement'
	);
});

test('library: extract requirements from a document and propose a mapping, landing on review and mapping (#66)', async ({
	page
}) => {
	const code = unique('ailaw')
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '');
	await page.goto('/library/import');
	await page.getByLabel('Upload a law or standard').setInputFiles({
		name: `${code}.pdf`,
		mimeType: 'application/pdf',
		buffer: Buffer.from(makePdf(['1. Risk management', '2. Backups are tested.']))
	});
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByTestId(`libdoc-${code}.pdf`)).toBeVisible();
	await page.getByLabel('Library document', { exact: true }).selectOption({ label: code });
	await page.getByLabel('Source code for the import').fill(code);
	await runAction(page, 'library_extract', 'Extract requirements');

	await page.goto('/library/review');
	await expect(page.locator('main')).toContainText('Extracted by the test model');

	await page.goto(`/library/mapping?from=${code}&to=nis2`);
	await runAction(page, 'library_mapping', 'Propose mapping');
	await expect(page.getByTestId('mapping-summary')).toContainText('1 proposed link waits');
});
