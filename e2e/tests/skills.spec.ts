import JSZip from 'jszip';
import { ADMIN, AUDITOR, expect, loginAs, seed, test } from '../helpers';

/** #80: two skill sets, shared per instance, edited by admins, downloadable for your own Claude. */
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
	await seed(page.request);
});

test('an admin edits an in-app skill, compares it with the default, and resets it', async ({ page }) => {
	await loginAs(page, ADMIN);
	await page.goto('/settings/skills?set=app');
	const card = page.getByTestId('skill-audit-plan-builder');
	await expect(card).toContainText('Default');
	await card.getByRole('link', { name: 'Open audit-plan-builder' }).click();

	const editor = page.getByLabel('Instructions (default)');
	await expect(editor).toHaveValue(/# Draft plan \(in the app\)/);
	await editor.fill(`${await editor.inputValue()}\n- Never plan meetings on Friday afternoons.`);
	await page.getByRole('button', { name: 'Save for everyone' }).click();
	await expect(page.getByRole('status')).toHaveText(
		'audit-plan-builder saved for everyone on this instance.'
	);
	await expect(page.getByLabel('Instructions (edited here)')).toHaveValue(/Friday afternoons/);

	await page.getByRole('button', { name: 'Compare with default' }).click();
	await expect(page.getByLabel('Default shipped with the app')).not.toHaveValue(/Friday afternoons/);
	await page.getByRole('link', { name: 'History' }).click();
	await expect(page.getByRole('dialog')).toContainText('audit-plan-builder (In the app)');
	await page.keyboard.press('Escape');

	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Reset to default' }).click();
	await expect(page.getByRole('status')).toHaveText(
		'audit-plan-builder is back to the default. The edit stays in its history.'
	);
	await expect(page.getByLabel('Instructions (default)')).not.toHaveValue(/Friday afternoons/);
});

test('a connector skill must keep its front matter; anyone downloads the skills as Agent Skills', async ({
	page
}) => {
	await loginAs(page, ADMIN);
	await page.goto('/settings/skills?set=connector&skill=audit-role-discovery');
	const editor = page.getByLabel('Instructions (default)');
	await editor.fill('No front matter here.');
	await page.getByRole('button', { name: 'Save for everyone' }).click();
	await expect(page.getByRole('alert')).toContainText(
		'Keep the front matter at the top: name: audit-role-discovery'
	);

	await loginAs(page, AUDITOR);
	await page.goto('/settings/skills');
	await expect(page.getByTestId('install-skills')).toContainText('/mcp');
	await expect(
		page.getByTestId('skill-audit-role-discovery').getByRole('link', { name: 'Open audit-role-discovery' })
	).toHaveText('Read');
	await page.goto('/settings/skills?set=connector&skill=audit-role-discovery');
	await expect(page.getByLabel('Instructions (default)')).toHaveAttribute('readonly', '');
	await expect(page.getByRole('button', { name: 'Save for everyone' })).toHaveCount(0);

	const all = await page.request.get('/settings/skills/download');
	expect(all.headers()['content-type']).toBe('application/zip');
	const zip = await JSZip.loadAsync(await all.body());
	const names = Object.keys(zip.files).filter((n) => !n.endsWith('/'));
	expect(names).toContain('audit-plan-builder/SKILL.md');
	expect(names).toContain('audit-plan-builder/assets/audit-plan-template.md');
	expect(names).toContain('audit-role-discovery/references/audit-rules.md');
	expect(names.some((n) => n.endsWith('APP.md'))).toBe(false);
	const one = await page.request.get('/settings/skills/download?skill=audit-event-debrief');
	expect(one.headers()['content-disposition']).toContain('audit-event-debrief.zip');
});
